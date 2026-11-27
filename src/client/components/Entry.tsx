import { useState, type FormEvent } from "react";
import type { SessionView } from "../../shared/identity";
import { api, message } from "../api";
import { LOCAL_ADMIN_HINT, LOCAL_TRIAL_HINTS } from "../test-actors";

interface Props {
  open: boolean;
  session: SessionView;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

type LoginMode = "student" | "admin";

export function LoginRequired({ open, session, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<LoginMode>("student");
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const local = session.provenance === "test";
  const adminForm = mode === "admin";

  function switchMode(next: LoginMode) {
    setMode(next);
    setName("");
    setClassName("");
    setPassword("");
    setError("");
  }

  async function loginLocal(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(local ? "/api/development/login" : "/api/admin/login", {
        method: "POST",
        json:
          mode === "admin"
            ? { password, kind: "admin" }
            : {
                name: name.trim(),
                className: className.trim(),
                password,
                kind: "student",
              },
      });
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function logoutLocal() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(local ? "/api/development/session" : "/api/admin/session", {
        method: "DELETE",
      });
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function loginPlatform() {
    try {
      if (session.adminSession) {
        await api("/api/admin/session", { method: "DELETE" });
        await onChanged();
      }
      if (!window.frameElement) throw new Error("请从学校平台课件页面打开");
      window.frameElement.dispatchEvent(
        new CustomEvent("rdfz:lesson-identity"),
      );
      onClose();
    } catch (err) {
      setError(message(err));
    }
  }

  if (!open) return null;

  return (
    <div
      className="login-modal login-modal-gate"
      id="loginModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loginTitle"
    >
      <div className="login-card">
        <div className="brand" id="loginTitle">
          {local || adminForm
            ? mode === "admin"
              ? "管理员登录"
              : "登录拾光"
            : "请先登录"}
        </div>

        {local || adminForm ? (
          <form className="login-form" onSubmit={(e) => void loginLocal(e)}>
            <p className="lead">
              {mode === "admin"
                ? "请填写管理员密码后进入。"
                : "请填写姓名、班级和密码后进入。未登录不能使用本站。"}
            </p>
            {mode === "student" ? (
              <>
                <label>
                  姓名
                  <input
                    id="loginName"
                    value={name}
                    autoComplete="username"
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder={`例如：${LOCAL_TRIAL_HINTS[0].name}`}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  班级
                  <input
                    id="loginClass"
                    value={className}
                    onChange={(e) => setClassName(e.currentTarget.value)}
                    placeholder={`例如：${LOCAL_TRIAL_HINTS[0].className}`}
                    required
                  />
                </label>
              </>
            ) : null}
            <label>
              密码
              <input
                id="loginPassword"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder="请输入密码"
                required
                autoFocus={mode === "admin"}
              />
            </label>
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              id="btnDoLogin"
              disabled={busy}
            >
              {busy ? "正在登录…" : "登录"}
            </button>
            <p className="login-switch">
              {mode === "student" ? (
                <button
                  type="button"
                  className="btn-text-link"
                  onClick={() => switchMode("admin")}
                >
                  管理员登录
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-text-link"
                  onClick={() => switchMode("student")}
                >
                  返回用户登录
                </button>
              )}
            </p>
            {(local && session.kind !== "guest") || session.adminSession ? (
              <p>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void logoutLocal()}
                >
                  {local ? "退出测试身份" : "退出管理员登录"}
                </button>
              </p>
            ) : null}
            {local && (
              <p className="hint login-hints">
                {mode === "admin"
                  ? `试用默认密码 ${LOCAL_ADMIN_HINT.defaultPassword}`
                  : `试用：${LOCAL_TRIAL_HINTS.map(
                      (row) =>
                        `${row.name}/${row.className}（${row.defaultPassword}）`,
                    ).join("；")}`}
              </p>
            )}
          </form>
        ) : (
          <>
            <p className="lead">
              {session.platformLogin === "ready"
                ? "请使用学生身份或本站管理员身份登录。"
                : "请从学校平台的课件入口打开。"}
            </p>
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            {session.platformLogin === "ready" ? (
              <p>
                <button
                  className="btn btn-primary"
                  onClick={() => void loginPlatform()}
                >
                  使用学生身份登录
                </button>
              </p>
            ) : null}
            <p className="login-switch">
              <button
                type="button"
                className="btn-text-link"
                onClick={() => switchMode("admin")}
              >
                管理员登录
              </button>
            </p>
            {session.adminSession && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void logoutLocal()}
              >
                退出管理员登录
              </button>
            )}
          </>
        )}

        {session.kind !== "guest" && (
          <button
            type="button"
            className="btn"
            id="btnCloseLogin"
            disabled={busy}
            onClick={onClose}
          >
            返回
          </button>
        )}
      </div>
    </div>
  );
}
