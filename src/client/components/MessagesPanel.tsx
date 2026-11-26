import { useCallback, useEffect, useState } from "react";
import { api, message } from "../api";
import type { MatchMessageView } from "../../shared/messages";
import { appUrl } from "../paths";

interface Props {
  active: boolean;
  notify: (msg: string) => void;
  onUnreadChange?: () => void;
}

export function MessagesPanel({ active, notify, onUnreadChange }: Props) {
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
      notify("已标记为不是我的，相同版本不再提醒");
    } catch (err) {
      notify(message(err));
    }
  }

  return (
    <section
      className={"panel" + (active ? " active" : "")}
      id="panel-messages"
    >
      <div className="panel-head">
        <h1>消息{unread ? `（${unread} 未读）` : ""}</h1>
        <p>
          这里只给你自己看。出现的是可能相关的招领，不代表一定是你的，也不会自动领走。
        </p>
      </div>
      <div className="card-list">
        {messages.length === 0 && (
          <p className="muted">还没有消息。发出寻物并等到配对后，会出现在这里。</p>
        )}
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={"item-card" + (!msg.read && !msg.stale ? " unread" : "")}
            style={{ cursor: "pointer" }}
            onClick={() => void open(msg)}
          >
            <div className="item-main">
              <h3>可能是你要找的物品</h3>
              <p>{msg.itemDescription || msg.reason}</p>
              <p className="muted">
                {msg.stale
                  ? `已失效：${msg.staleReason}`
                  : msg.dismissed
                    ? "已标记不是我的"
                    : msg.reason}
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
            <h3>可能是你要找的物品</h3>
            <p style={{ margin: "12px 0" }}>{selected.itemDescription}</p>
            <p className="muted">{selected.reason}</p>
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
              }}
            >
              {!selected.stale && !selected.dismissed && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void dismiss(selected)}
                >
                  不是我的
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSelected(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
