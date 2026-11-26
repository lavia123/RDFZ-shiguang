import { appUrl } from "../paths";
import { useLayoutEffect, useRef, useState } from "react";
import type { Item } from "../../shared/types";
import type { SessionView } from "../../shared/identity";
import { formatTime, formatContactWay } from "../utils";
import { StatusBadge, ViewLogs } from "./ItemCards";
import { message } from "../api";
export type DetailAction =
  | "claim"
  | "intent"
  | "deliver"
  | "custody"
  | "correct"
  | "reopen"
  | "withdraw";
interface Props {
  initialScroll: number;
  item: Item;
  session: SessionView;
  notify: (message: string) => void;
  onClose: () => void;
  onDelete: (item: Item) => void;
  onNeedLogin: () => void;
  onAction: (action: DetailAction, body?: unknown) => Promise<void>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <div>{value}</div>
    </div>
  );
}
export function DetailModal({
  item,
  initialScroll,
  session,
  notify,
  onClose,
  onDelete,
  onNeedLogin,
  onAction,
}: Props) {
  const [claimantUserId, setClaimantUserId] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAtOpen = useRef(initialScroll);
  const working = useRef(false);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollAtOpen.current;
  }, []);
  const admin = session.kind === "admin";
  const student = session.kind === "student";
  const open = item.status === "open";
  async function run(action: DetailAction, body?: unknown) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await onAction(action, body);
    } catch (err) {
      notify(message(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function selfClaim() {
    if (
      !confirm(
        "确认东西已经给你了？这只是你自己登记，老师还没核对。",
      )
    )
      return;
    void run("claim");
  }
  function deliver() {
    if (!claimantUserId.trim()) {
      notify("请先填写领走的同学账号");
      return;
    }
    if (!confirm("确认已经核对过，可以把东西交给这位同学？")) return;
    void run("deliver", { claimantUserId: claimantUserId.trim(), note });
  }
  return (
    <div
      className="modal"
      id="detailModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detailTitle"
      >
        <div className="modal-scroll" ref={scrollRef}>
        <img id="detailImg" alt="物品照片" src={appUrl(item.image)} />
        <div className="modal-body">
          <div id="detailBadge">
            <StatusBadge item={item} />
            {item.highValue && <div className="badge badge-locked">贵重物品</div>}
          </div>
          <h2 id="detailTitle">{item.description}</h2>
          <DetailRow label="在哪捡到的" value={item.place || "没写"} />
          <DetailRow label="发布时间" value={formatTime(item.createdAt)} />
          <DetailRow label="领取地点" value={item.office || "逸夫楼316"} />
          <DetailRow label="现在在哪" value={item.custody.label} />
          {item.contactVisible && (item.contact || item.contactValue) && (
            <div id="sensitiveBlock">
              {item.contact && (
                <DetailRow label="联系人" value={item.contact} />
              )}
              {item.contactValue && (
                <DetailRow label="联系方式" value={formatContactWay(item)} />
              )}
            </div>
          )}
          {item.claimVisible && item.claim && (
            <div id="detailClaimInfo">
              <DetailRow label="领取人" value={item.claim.name} />
              <DetailRow
                label="班级"
                value={item.claim.className || "未填写"}
              />
              <DetailRow label="登记方式" value={item.claim.claimLabel} />
              <DetailRow
                label="登记时间"
                value={formatTime(item.claim.claimedAt)}
              />
              {item.claim.note && (
                <DetailRow label="备注" value={item.claim.note} />
              )}
            </div>
          )}
          {item.status === "claimed" && !item.claimVisible && (
            <div className="locked-note" id="claimHiddenNote">
              已经有人领走了。领走的人是谁，只有本人和老师能看到。
            </div>
          )}
          {admin && item.legacyVerification && (
            <DetailRow
              label="历史核对"
              value={`这是以前的记录（${formatTime(item.legacyVerification.at)}），不代表这次已经交给同学${item.legacyVerification.note ? "：" + item.legacyVerification.note : ""}`}
            />
          )}
          {admin && (
            <div id="detailViewLogs" className="claim-box">
              <strong>以前谁看过（现在不再增加）</strong>
              <div style={{ marginTop: "10px" }}>
                <ViewLogs logs={item.viewLogs ?? []} />
              </div>
              {item.claimLog.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <strong>交给谁的记录</strong>
                  {item.claimLog.map((entry, index) => (
                    <div className="view-log-item" key={entry.at + index}>
                      {entry.name} · {entry.className} ·{" "}
                      {entry.active ? "现在算数" : "已经改过"}
                      {entry.closeReason ? `：${entry.closeReason}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
        <div className="claim-dock" id="claimConditions">
          <p className="claim-hint" id="claimHint">
            {session.kind === "kiosk"
              ? "这台电脑只能发布，不能在这里领取。"
              : !open
                ? "先看上面的照片和说明。"
                : item.highValue
                  ? "这是贵重物品。你只能说「这是我的」，老师核对后才会给你。"
                  : session.kind === "guest"
                    ? "看完上面的照片和说明，登录后才能登记领取。"
                    : "如果东西已经给你了，点下面按钮自己登记。这还不是老师核对过。"}
          </p>
          {item.highValue && open && (
            <div className="locked-note" id="highValueNote">
              {item.custody.teacherReceived
                ? "东西已经在老师那里，还要老师确认给你。"
                : "东西还没交到老师那里，现在还不能领走。"}
            </div>
          )}
          <div className="modal-actions" id="detailActions">
            {session.kind === "guest" && open && (
              <button
                type="button"
                className="btn btn-primary"
                id="btnNeedLogin"
                onClick={onNeedLogin}
              >
                登录后领取
              </button>
            )}
            {session.kind === "kiosk" && (
              <p className="hint" id="kioskNoClaim">
                这台电脑只能发布，不能领取，也看不到私人消息。
              </p>
            )}
            {student && open && !item.highValue && (
              <button
                type="button"
                className="btn btn-primary"
                id="btnSelfClaim"
                disabled={busy}
                onClick={selfClaim}
              >
                我已经拿到了
              </button>
            )}
            {student && open && item.highValue && (
              <button
                type="button"
                className="btn btn-primary"
                id="btnIntent"
                disabled={busy || item.myIntent}
                onClick={() => void run("intent")}
              >
                {item.myIntent ? "已经说过这是我的" : "这是我的"}
              </button>
            )}
            {admin && open && !item.custody.teacherReceived && (
              <button
                type="button"
                className="btn btn-ghost"
                id="btnCustody"
                disabled={busy}
                onClick={() => void run("custody", { heldBy: "teacher" })}
              >
                已经交到老师那里
              </button>
            )}
            {admin && open && (
              <div className="claim-box" id="deliverBox">
                <strong>交给同学</strong>
                <p className="hint">
                  填领走的同学账号。找不到就先问学校，不要填成老师自己。
                </p>
                <label>
                  领走的同学账号
                  <input
                    id="claimUserId"
                    value={claimantUserId}
                    onChange={(e) => setClaimantUserId(e.currentTarget.value)}
                  />
                </label>
                <label>
                  补一句（可不填）
                  <input
                    id="deliverNote"
                    value={note}
                    onChange={(e) => setNote(e.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  id="confirmDeliver"
                  disabled={busy}
                  onClick={deliver}
                >
                  确认交给这位同学
                </button>
              </div>
            )}
            {admin && item.status === "claimed" && (
              <div className="claim-box" id="correctBox">
                <strong>改领走的人</strong>
                <p className="hint">原来的记录会留下，不能直接删掉。</p>
                <label>
                  改成哪位同学的账号（取消领取就留空）
                  <input
                    id="correctUserId"
                    value={claimantUserId}
                    onChange={(e) => setClaimantUserId(e.currentTarget.value)}
                  />
                </label>
                <label>
                  原因
                  <input
                    id="correctReason"
                    value={reason}
                    onChange={(e) => setReason(e.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  id="confirmCorrect"
                  disabled={busy}
                  onClick={() =>
                    void run("correct", {
                      claimantUserId: claimantUserId.trim(),
                      reason: reason.trim(),
                    })
                  }
                >
                  改成这位同学
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  id="confirmReopen"
                  disabled={busy}
                  onClick={() => void run("reopen", { reason: reason.trim() })}
                >
                  取消这次领取
                </button>
              </div>
            )}
            {(admin || item.isOwner) && item.status !== "withdrawn" && (
              <button
                type="button"
                className="btn btn-ghost"
                id="btnWithdraw"
                disabled={busy}
                onClick={() => {
                  if (confirm("撤下这条招领？别人就看不到了。")) void run("withdraw");
                }}
              >
                撤下这条
              </button>
            )}
            {admin && (
              <button
                type="button"
                className="btn btn-danger"
                id="btnAdminDelete"
                onClick={() => onDelete(item)}
              >
                删除这条
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              id="closeDetail"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
