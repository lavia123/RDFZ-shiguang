import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, message } from "../api";
import type { LostPost } from "../../shared/lost";
import { appUrl } from "../paths";
import { simplifyDescription } from "../simplify";
import { formatReviewIssue } from "../../shared/review-labels";
import type { ReviewIssue } from "../../shared/identity";

interface Props {
  active: boolean;
  notify: (msg: string) => void;
}

function statusLabel(post: LostPost) {
  if (post.status === "found") return "已找回";
  if (post.status === "open") return "寻找中";
  return "已关闭";
}

function batchLabel(post: LostPost) {
  if (post.batchHint === "pending_batch") return " · 已发出，配对后会在消息里告诉你";
  if (post.batchHint === "no_candidates") return " · 这次还没找到像的";
  return "";
}

/** 过简描述：短词组且缺少颜色/形态等特征词。 */
export function isTooSimpleDescription(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, "");
  if (!t) return true;
  if (
    /[的色式型号折叠指针金银黑白红蓝绿黄灰粉紫橙棕]|多|双|单|大|小|新|旧|破|划痕|写有|带有|印有/.test(
      t,
    )
  )
    return false;
  if (t.length <= 4) return true;
  if (t.length <= 6 && !/[，,、．.；;\d]/.test(t)) return true;
  return false;
}

export function LostPanel({ active, notify }: Props) {
  const [posts, setPosts] = useState<LostPost[]>([]);
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState("");
  const [lostFrom, setLostFrom] = useState("");
  const [lostTo, setLostTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [listTab, setListTab] = useState<"active" | "history">("active");
  const [simpleWarned, setSimpleWarned] = useState(false);
  const [reviewIssues, setReviewIssues] = useState<ReviewIssue[]>([]);
  const [recoverTarget, setRecoverTarget] = useState<LostPost | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ posts: LostPost[] }>("/api/lost-posts?mine=1");
    setPosts(data.posts);
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh().catch((err) => notify("寻物列表没打开：" + message(err)));
  }, [active, refresh, notify]);

  useEffect(() => {
    if (recoverTarget) confirmBtnRef.current?.focus();
  }, [recoverTarget]);

  const activePosts = posts.filter((post) => post.status === "open");
  const historyPosts = posts.filter((post) => post.status !== "open");
  const shown = listTab === "active" ? activePosts : historyPosts;

  async function submit(forceSimple = false) {
    if (busy) return;
    const text = description.trim();
    if (!text) {
      notify("请先写丢了什么");
      return;
    }
    if (!forceSimple && isTooSimpleDescription(text) && !simpleWarned) {
      window.alert("写得太短了，补上颜色或样子，别人更好认。");
      setSimpleWarned(true);
      return;
    }
    setBusy(true);
    setReviewIssues([]);
    try {
      const data = await api<{ post: LostPost; notice?: string }>(
        "/api/lost-posts",
        {
          method: "POST",
          json: {
            description: text,
            place: place.trim(),
            lostFrom: lostFrom || null,
            lostTo: lostTo || null,
          },
        },
      );
      setDescription("");
      setPlace("");
      setLostFrom("");
      setLostTo("");
      setSimpleWarned(false);
      setListTab("active");
      await refresh();
      notify(data.notice || "寻物已经发出");
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setReviewIssues(err.issues);
      notify(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(post: LostPost, status: LostPost["status"]) {
    try {
      await api(`/api/lost-posts/${post.id}`, {
        method: "PATCH",
        json: { status },
      });
      if (status === "found" || status === "closed") setListTab("history");
      await refresh();
      notify(
        status === "found"
          ? "已标成找回了，可以在以前的寻物里删掉"
          : status === "closed"
            ? "这条寻物已关闭"
            : "已更新",
      );
    } catch (err) {
      notify(message(err));
    }
  }

  async function remove(post: LostPost) {
    if (!window.confirm("删掉这条寻物？删了就不能恢复。")) return;
    try {
      await api(`/api/lost-posts/${encodeURIComponent(post.id)}`, {
        method: "DELETE",
      });
      await refresh();
      notify("已删掉");
    } catch (err) {
      notify(message(err));
    }
  }

  return (
    <section
      className={"panel" + (active ? " active" : "")}
      id="panel-lost"
    >
      <div className="panel-head">
        <h1>发寻物</h1>
        <p>
          丢了什么就写在这里，不用拍照。写完点「精简一下」，去掉多余的话，只留下能认出来的特征。配对后会在「消息」里告诉你。
        </p>
      </div>
      <div className="form-grid" style={{ marginBottom: 24 }}>
        {reviewIssues.length > 0 && (
          <div className="review-issues" role="alert">
            <strong>这里需要改</strong>
            <ul>
              {reviewIssues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{formatReviewIssue(issue)}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="simplify-row">
            <label htmlFor="lostDescription">丢了什么</label>
            <button
              type="button"
              className="btn btn-ghost btn-text-extract"
              id="btnSimplify"
              onClick={() => {
                const next = simplifyDescription(description);
                if (!description.trim()) {
                  notify("先写一段描述，再点精简");
                  return;
                }
                if (next === description.trim()) {
                  notify("已经比较简短了");
                  return;
                }
                setDescription(next);
                setSimpleWarned(false);
                notify("已去掉多余的话，你还可以再改");
              }}
            >
              精简一下
            </button>
          </div>
          <span className="hint">
            写下颜色、样子、在哪丢的。问候和「谢谢」可以留给按钮删掉。
          </span>
          <textarea
            id="lostDescription"
            rows={4}
            value={description}
            onChange={(e) => {
              setDescription(e.currentTarget.value);
              setSimpleWarned(false);
            }}
            placeholder="例如：灰色保温杯，杯盖有划痕，昨天落在图书馆"
            aria-invalid={reviewIssues.some((issue) => issue.field === "description")}
          />
          {reviewIssues.some((issue) => issue.field === "description") && (
            <span className="field-error">
              {reviewIssues
                .filter((issue) => issue.field === "description")
                .map((issue) => issue.message)
                .join("；")}
            </span>
          )}
        </div>
        <label>
          可能丢在哪（可不填）
          <input
            value={place}
            onChange={(e) => setPlace(e.currentTarget.value)}
            placeholder="记不清就留空"
          />
        </label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <label>
            大概从哪天开始丢的（可不填）
            <input
              type="date"
              value={lostFrom}
              onChange={(e) => setLostFrom(e.currentTarget.value)}
            />
          </label>
          <label>
            到哪天为止（可不填）
            <input
              type="date"
              value={lostTo}
              onChange={(e) => setLostTo(e.currentTarget.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !description.trim()}
          onClick={() => void submit()}
        >
          发出寻物
        </button>
      </div>
      <div className="lost-list-tabs" role="tablist" aria-label="寻物列表">
        <button
          type="button"
          role="tab"
          aria-selected={listTab === "active"}
          className={
            "lost-list-tab" + (listTab === "active" ? " active" : "")
          }
          onClick={() => setListTab("active")}
        >
          我的寻物{activePosts.length ? `（${activePosts.length}）` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={listTab === "history"}
          className={
            "lost-list-tab" + (listTab === "history" ? " active" : "")
          }
          onClick={() => setListTab("history")}
        >
          以前的{historyPosts.length ? `（${historyPosts.length}）` : ""}
        </button>
      </div>
      <div className="card-list">
        {shown.length === 0 && (
          <p className="muted">
            {listTab === "active"
              ? "还没有正在找的东西。"
              : "还没有以前的寻物。找回或关闭后会出现在这里。"}
          </p>
        )}
        {shown.map((post) => (
          <article key={post.id} className="item-card">
            <div className="item-main">
              <h3>{post.description}</h3>
              <p className="muted">
                {post.place || "地点未填"} · {statusLabel(post)}
                {batchLabel(post)}
              </p>
              {post.image ? (
                <img src={appUrl(post.image)} alt="" className="thumb" />
              ) : null}
            </div>
            {post.status === "open" ? (
              <div className="item-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRecoverTarget(post)}
                >
                  已经找回
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void setStatus(post, "closed")}
                >
                  关闭
                </button>
              </div>
            ) : (
              <div className="item-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void remove(post)}
                >
                  删除
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {recoverTarget ? (
        <div
          className="confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recoverConfirmTitle"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecoverTarget(null);
          }}
        >
          <div className="confirm-card">
            <p id="recoverConfirmTitle">东西已经找回了？</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRecoverTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                ref={confirmBtnRef}
                autoFocus
                onClick={() => {
                  const post = recoverTarget;
                  setRecoverTarget(null);
                  if (post) void setStatus(post, "found");
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
