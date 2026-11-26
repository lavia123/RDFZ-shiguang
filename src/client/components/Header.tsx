import type { AiStatus } from "../../shared/types";
import type { SessionView } from "../../shared/identity";
import type { Panel } from "../state";

interface Props {
  ai: AiStatus;
  session: SessionView;
  panel: Panel;
  idleLabel: string;
  testActors: boolean;
  onPanel: (panel: Panel) => void;
  onEndKiosk: () => void;
  onOpenSettings: () => void;
}
export function Header({
  ai,
  session,
  panel,
  idleLabel,
  testActors,
  onPanel,
  onEndKiosk,
  onOpenSettings,
}: Props) {
  const admin = session.kind === "admin";
  const kiosk = session.kind === "kiosk";
  const student = session.kind === "student";
  const badge = kiosk
    ? `公共终端 · ${session.stationName || "未命名站点"}`
    : admin
      ? `管理员 · ${session.name}`
      : student
        ? `${session.name} · ${session.className}`
        : "未登录";
  return (
    <header>
      <button
        type="button"
        className="brand-btn"
        id="backGate"
        title="回到招领列表"
        onClick={() => onPanel(kiosk ? "found" : "browse")}
      >
        拾光
      </button>
      <div className="header-right">
        <span
          className={"role-badge" + (admin ? " admin" : "")}
          id="roleBadge"
          title={
            session.provenance === "test"
              ? "本地试用登录，不是学校平台登录"
              : session.provenance === "platform"
                ? "平台已验证身份"
                : "未登录"
          }
        >
          {badge}
        </span>
        {testActors && student && (
          <button
            type="button"
            className="ai-config-btn"
            id="btnUserSettings"
            onClick={onOpenSettings}
          >
            用户设置
          </button>
        )}
        {kiosk && (
          <>
            <span className="ai-config-btn" id="kioskIdle" role="status">
              {idleLabel}后清空
            </span>
            <button
              type="button"
              className="ai-config-btn"
              id="endKiosk"
              onClick={onEndKiosk}
            >
              结束本次使用
            </button>
          </>
        )}
        {admin && (
          <span
            className="ai-config-btn admin-only"
            role="status"
            title={ai.configured ? "DeepSeek 已配置" : "DeepSeek 未配置"}
            style={{ cursor: "default" }}
          >
            <span className={"ai-dot" + (ai.configured ? " on" : "")}></span>
            <span>
              {ai.configured ? "服务器 AI 已就绪" : "服务器 AI 未配置"}
            </span>
          </span>
        )}
        <nav className="nav-tabs" aria-label="功能切换">
          {!kiosk && (
            <button
              type="button"
              data-panel="browse"
              onClick={() => onPanel("browse")}
              className={panel === "browse" ? "active" : ""}
            >
              招领浏览
            </button>
          )}
          <button
            type="button"
            className={panel === "found" ? "active" : ""}
            data-panel="found"
            onClick={() => onPanel("found")}
          >
            我捡到了
          </button>
          {student && (
            <button
              type="button"
              data-panel="lost"
              onClick={() => onPanel("lost")}
              className={panel === "lost" ? "active" : ""}
            >
              发寻物
            </button>
          )}
          {student && (
            <button
              type="button"
              data-panel="history"
              onClick={() => onPanel("history")}
              className={panel === "history" ? "active" : ""}
            >
              我发布的
            </button>
          )}
          {student && (
            <button
              type="button"
              data-panel="messages"
              onClick={() => onPanel("messages")}
              className={panel === "messages" ? "active" : ""}
            >
              消息
            </button>
          )}
          {admin && (
            <button
              type="button"
              className={panel === "admin" ? "active" : ""}
              data-panel="admin"
              id="navAdmin"
              onClick={() => onPanel("admin")}
            >
              管理交付
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
