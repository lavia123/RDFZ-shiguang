import { appUrl } from "../paths";
import type { Item, ViewLog } from "../../shared/types";
import { formatTime } from "../utils";
export function StatusBadge({ item }: { item: Item }) {
  const claimed = item.status === "claimed";
  const withdrawn = item.status === "withdrawn";
  return (
    <div
      className={
        "badge " +
        (claimed ? "badge-claimed" : withdrawn ? "badge-locked" : "badge-open")
      }
    >
      {claimed ? "已领取" : withdrawn ? "已撤下" : "待领取"}
    </div>
  );
}
export function ViewLogs({ logs }: { logs: ViewLog[] }) {
  if (!logs.length) return <div className="view-log-empty">没有历史查看记录</div>;
  return (
    <>
      {logs.map((log, index) => (
        <div className="view-log-item" key={log.viewerId + index}>
          <div>
            <strong>
              {[log.identity || "", log.name || "", log.idNo ? `（${log.idNo}）` : ""]
                .join(" ")
                .trim() || "未知"}
            </strong>
            {log.className ? ` · ${log.className}` : ""}
          </div>
          <div className="when">{formatTime(log.unlockedAt)} 查看过联系信息</div>
        </div>
      ))}
    </>
  );
}
export function ItemCard({
  item,
  onOpen,
}: {
  item: Item;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={"item-card" + (item.status === "claimed" ? " claimed" : "")}
      onClick={() => onOpen(item.id)}
    >
      <img src={appUrl(item.image)} alt={item.description} />
      <div className="item-body">
        <StatusBadge item={item} />
        {item.highValue && (
          <>
            {" "}
            <div className="badge badge-locked">高价值</div>
          </>
        )}
        <h3>{item.description}</h3>
        <div className="meta">
          {item.place}
          <br />
          {item.custody.label}
          <br />
          {formatTime(item.createdAt)}
        </div>
      </div>
    </button>
  );
}
interface HistoryProps {
  active: boolean;
  items: Item[];
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
}
export function HistoryPanel({ active, items, onEdit, onDelete }: HistoryProps) {
  return (
    <section className={"panel" + (active ? " active" : "")} id="panel-history">
      <div className="panel-head">
        <h1>我发布的</h1>
        <p>这里是你发过的招领。换一台电脑，只要还是这个账号，也能看到。</p>
      </div>
      <div className="toolbar">
        <span className="count" id="historyCount">
          共 {items.length} 条
        </span>
      </div>
      <div className="history-list" id="historyList">
        {items.map((item) => (
          <article className="history-card" key={item.id}>
            <img src={appUrl(item.image)} alt={item.description} />
            <div>
              <StatusBadge item={item} />
              {item.highValue && <div className="badge badge-locked">高价值</div>}
              <h3>{item.description}</h3>
              <div className="meta">
                {`${item.office} · ${item.place}`}
                <br />
                {formatTime(item.createdAt)}
              </div>
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="btn btn-primary btn-edit"
                disabled={item.status !== "open"}
                onClick={() => onEdit(item)}
              >
                修改
              </button>
              <button
                type="button"
                className="btn btn-danger btn-del"
                disabled={item.status === "claimed"}
                onClick={() => onDelete(item)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="empty" id="historyEmpty" hidden={items.length > 0}>
        你还没有发过招领。
      </div>
    </section>
  );
}
interface AdminProps {
  active: boolean;
  items: Item[];
  matchingBusy?: boolean;
  onOpen: (id: string) => void;
  onDelete: (item: Item) => void;
  onMarkHighValue: (item: Item, highValue: boolean) => void;
  onRunMatching?: () => void;
}
export function AdminPanel({
  active,
  items,
  matchingBusy,
  onOpen,
  onDelete,
  onMarkHighValue,
  onRunMatching,
}: AdminProps) {
  return (
    <section className={"panel" + (active ? " active" : "")} id="panel-admin">
      <div className="panel-head">
        <h1>交给谁了</h1>
        <p>
          在这里登记交给了哪位同学。要填同学的账号，不能写成老师自己领走。寻物配对默认每天北京时间
          14:00，也可手动开启 AI 配对。
        </p>
      </div>
      <div className="toolbar">
        <span className="count" id="adminCount">
          共 {items.length} 条 · 高价值 {items.filter((item) => item.highValue).length} ·
          已领取 {items.filter((item) => item.status === "claimed").length}
        </span>
        {onRunMatching ? (
          <button
            type="button"
            className="btn btn-primary"
            id="btnRunMatching"
            disabled={!!matchingBusy}
            onClick={onRunMatching}
          >
            {matchingBusy ? "配对进行中…" : "手动开启 AI 配对"}
          </button>
        ) : null}
      </div>
      <div className="history-list" id="adminList">
        {items.map((item) => (
          <article className="admin-card" key={item.id}>
            <img src={appUrl(item.image)} alt={item.description} />
            <div>
              <StatusBadge item={item} />{" "}
              {item.highValue && <div className="badge badge-locked">高价值</div>}
              <h3>{item.description}</h3>
              <div className="meta">
                {`${item.office} · ${item.place}`}
                <br />
                {item.custody.label}
                <br />
                {item.claim
                  ? `领取人：${item.claim.name} · ${item.claim.className} · ${item.claim.claimLabel}`
                  : "尚未交付"}
                <br />
                {formatTime(item.createdAt)}
              </div>
            </div>
            <div className="view-log-col">
              <div className="col-title">交付留痕（{item.claimLog.length}）</div>
              {item.claimLog.length === 0 ? (
                <div className="view-log-empty">还没有交付记录</div>
              ) : (
                item.claimLog.map((entry, index) => (
                  <div className="view-log-item" key={entry.at + index}>
                    {entry.name || "未记录姓名"} · {entry.active ? "有效" : "已更正"}
                  </div>
                ))
              )}
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="btn btn-ghost btn-mark-high"
                onClick={() => onMarkHighValue(item, !item.highValue)}
              >
                {item.highValue ? "撤销高价值" : "标为高价值"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-view"
                onClick={() => onOpen(item.id)}
              >
                查看交付
              </button>
              <button
                type="button"
                className="btn btn-danger btn-adel"
                onClick={() => onDelete(item)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="empty" id="adminEmpty" hidden={items.length > 0}>
        当前没有帖子。
      </div>
    </section>
  );
}
