import { useEffect, useState } from "react";
import type { SessionView } from "../../shared/identity";
import { api, message } from "../api";
interface Props {
  open: boolean;
  session: SessionView;
  onClose: () => void;
  onChanged: () => Promise<void>;
}
export function LoginRequired({ open, session, onClose, onChanged }: Props) {
  const [actors, setActors] = useState<{ key: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState("student");
  const [retry, setRetry] = useState(0);
  const local = session.provenance === "test";
  useEffect(() => {
    if (!open) return;
    setError("");
    if (!local) return;
    const controller = new AbortController();
    void api<{ actors: typeof actors }>("/api/development/actors", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setActors(data.actors);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(message(err));
      });
    return () => controller.abort();
  }, [open, local, retry]);
  async function select(key?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/api/development/session",
        key ? { method: "POST", json: { key } } : { method: "DELETE" },
      );
      await onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  function login() {
    try {
      if (!window.frameElement) throw new Error("请从学校平台课件页面打开");
      window.frameElement.dispatchEvent(
        new CustomEvent("rdfz:lesson-identity"),
      );
      onClose();
    } catch (error) {
      setError(message(error));
    }
  }
  if (!open) return null;
  return (
    <div
      className="login-modal"
      id="loginModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loginTitle"
    >
      <div className="login-card">
        <div className="brand" id="loginTitle">
          {local ? "开发测试身份" : "请先登录"}
        </div>
        <p className="lead">
          {local
            ? "仅用于本地开发，数据与学校平台分开保存。请选择测试学生或教师。"
            : "先看也可以。要发布或领取，请使用学校平台身份登录。"}
        </p>
        {local ? (
          <div>
            {!actors.length && !error && <p role="status">正在读取测试身份…</p>}
            {actors.length > 0 && (
              <>
                <label>
                  测试身份
                  <select
                    aria-label="测试身份"
                    value={selection}
                    disabled={busy}
                    onChange={(event) => setSelection(event.target.value)}
                  >
                    {actors.map((actor) => (
                      <option key={actor.key} value={actor.key}>
                        {actor.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void select(selection)}
                  >
                    {busy ? "正在进入…" : "使用测试身份进入"}
                  </button>
                </p>
              </>
            )}
            {session.kind !== "guest" && (
              <p>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void select()}
                >
                  退出测试身份
                </button>
              </p>
            )}
          </div>
        ) : session.platformLogin === "ready" ? (
          <p>
            <button className="btn btn-primary" onClick={login}>
              使用学生身份登录
            </button>
          </p>
        ) : (
          <p className="lead">请从学校平台的课件入口打开。</p>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            {local && (
              <button
                className="btn"
                onClick={() => setRetry((value) => value + 1)}
              >
                重试读取
              </button>
            )}
          </p>
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
