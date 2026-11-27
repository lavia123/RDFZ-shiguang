import { useCallback, useEffect, useState } from "react";
import { api, message } from "../api";
import type { MatchMessageView } from "../../shared/messages";
import { appUrl } from "../paths";

interface Props {
  active: boolean;
  notify: (msg: string) => void;
  isAdmin?: boolean;
  onOpenItem?: (itemId: string) => void;
  onUnreadChange?: () => void;
}

function titleOf(msg: MatchMessageView, isAdmin: boolean) {
  if (msg.kind === "claim_dispute")
    return msg.title || msg.option || "同学联系管理员";
  if (msg.kind === "high_value_alert")
    return msg.title || "可能的高价值物品";
  return isAdmin ? "配对提醒" : "可能是你要找的物品";
}

export function MessagesPanel({
  active,
  notify,
  isAdmin,
  onOpenItem,
  onUnreadChange,
}: Props) {
  const [messages, setMessages] = useState<MatchMessageView[]>([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<MatchMessageView | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<{ messages: MatchMessageView[]; unread: number }>(
      "/api/messages",
    );
    setMessages(data.messages);
    setUnread(data.unread);
    onUnreadChange?.();
  }, [onUnreadChange]);

  useEffect(() => {
    if (!active) return;
    void refresh().catch((err) => notify("加载消息失败：" + message(err)));
  }, [active, refresh, notify]);

  async function open(msg: MatchMessageView) {
    setSelected(msg);
    if (!msg.read) {
      try {
        const data = await api<{ message: MatchMessageView }>(
          `/api/messages/${msg.id}/read`,
          { method: "POST", json: {} },
        );
        setSelected(data.message);
        await refresh();
      } catch (err) {
        notify(message(err));
      }
    }
  }

  async function dismiss(msg: MatchMessageView) {
    try {
      await api(`/api/messages/${msg.id}/dismiss`, {
        method: "POST",
        json: {},
      });
      setSelected(null);
      await refresh();
      notify(
        msg.kind === "match"
          ? "已标记为不是我的，相同版本不再提醒"
          : "已忽略这条消息",
      );
    } catch (err) {
      notify(message(err));
    }
  }

  function goItem(msg: MatchMessageView) {
    if (!msg.itemId || !onOpenItem) return;
    setSelected(null);
    onOpenItem(msg.itemId);
  }

  return (
    <section
      className={"panel" + (active ? " active" : "")}
      id="panel-messages"
    >
      <div className="panel-head">
        <h1>消息{unread ? `（${unread} 未读）` : ""}</h1>
        <p>
          {isAdmin
            ? "这里有同学的联系申请，以及系统提示的可能高价值招领。点开后可跳到招领详情。"
            : "这里只给你自己看。出现的是可能相关的招领，不代表一定是你的，也不会自动领走。"}
        </p>
      </div>
      <div className="card-list">
        {messages.length === 0 && (
          <p className="muted">
            {isAdmin
              ? "还没有消息。"
              : "还没有消息。发出寻物并等到配对后，会出现在这里。"}
          </p>
        )}
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={"item-card" + (!msg.read && !msg.stale ? " unread" : "")}
            style={{ cursor: "pointer" }}
            onClick={() => void open(msg)}
          >
            <div className="item-main">
              <h3>{titleOf(msg, !!isAdmin)}</h3>
              <p>{msg.itemDescription || msg.reason}</p>
              <p className="muted">
                {msg.stale
                  ? `已失效：${msg.staleReason}`
                  : msg.dismissed
                    ? "已忽略"
                    : msg.option || msg.reason}
              </p>
            </div>
            {msg.itemImage ? (
              <img src={appUrl(msg.itemImage)} alt="" className="thumb" />
            ) : null}
          </article>
        ))}
      </div>
      {selected && (
        <div
          className="login-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="login-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <h3>{titleOf(selected, !!isAdmin)}</h3>
            {selected.option ? (
              <p style={{ margin: "12px 0", fontWeight: 600 }}>
                {selected.option}
              </p>
            ) : null}
            <p style={{ margin: "12px 0" }}>
              {selected.itemDescription || selected.reason}
            </p>
            <p className="muted">{selected.reason}</p>
            {selected.fromName ? (
              <p className="muted" style={{ marginTop: 8 }}>
                来自：{selected.fromName}
                {selected.fromClassName ? ` · ${selected.fromClassName}` : ""}
              </p>
            ) : null}
            {selected.itemPlace || selected.itemOffice ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {[selected.itemPlace, selected.itemOffice]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {selected.itemImage ? (
              <img
                src={appUrl(selected.itemImage)}
                alt=""
                style={{
                  width: "100%",
                  borderRadius: 12,
                  marginTop: 12,
                  maxHeight: 240,
                  objectFit: "cover",
                }}
              />
            ) : null}
            {selected.stale ? (
              <p className="muted" style={{ marginTop: 12 }}>
                {selected.staleReason}。不能继续当作有效领取入口。
              </p>
            ) : selected.kind === "high_value_alert" ||
              selected.kind === "claim_dispute" ? (
              <p className="muted" style={{ marginTop: 12 }}>
                可打开招领详情核对处理。
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>
                请到招领列表核对详情。匹配不会自动完成领取。
              </p>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              {!selected.stale && !selected.dismissed && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void dismiss(selected)}
                >
                  {selected.kind === "match" ? "不是我的" : "忽略"}
                </button>
              )}
              {selected.itemId && onOpenItem ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => goItem(selected)}
                >
                  打开招领
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSelected(null)}
                >
                  关闭
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
