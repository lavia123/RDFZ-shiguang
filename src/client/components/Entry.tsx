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
      await api("/api/development/login", {
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
      await api("/api/development/session", { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function loginPlatform() {
    try {
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
          {local
            ? mode === "admin"
              ? "管理员登录"
              : "登录拾光"
            : "请先登录"}
        </div>

        {local ? (
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
            {session.kind !== "guest" ? (
              <p>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void logoutLocal()}
                >
                  退出测试身份
                </button>
              </p>
            ) : null}
            <p className="hint login-hints">
              {mode === "admin"
                ? `试用默认密码 ${LOCAL_ADMIN_HINT.defaultPassword}`
                : `试用：${LOCAL_TRIAL_HINTS.map(
                    (row) =>
                      `${row.name}/${row.className}（${row.defaultPassword}）`,
                  ).join("；")}`}
            </p>
          </form>
        ) : (
          <>
            <p className="lead">
              {session.platformLogin === "ready"
                ? "先看也可以。要发布或领取，请使用学校平台身份登录。"
                : "请从学校平台的课件入口打开。"}
            </p>
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            {session.platformLogin === "ready" ? (
              <p>
                <button className="btn btn-primary" onClick={loginPlatform}>
                  使用学生身份登录
                </button>
              </p>
            ) : null}
          </>
        )}

        <button
          type="button"
          className="btn"
          id="btnCloseLogin"
          disabled={busy}
          onClick={onClose}
        >
          返回浏览
        </button>
      </div>
    </div>
  );
}
