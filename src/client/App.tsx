import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus, Item } from "../shared/types";
import {
  KIOSK_IDLE_MS,
  guestActor,
  sessionView,
  type SessionView,
} from "../shared/identity";
import { api, message, setTestActor } from "./api";
import type { Panel } from "./state";
import { sortItems } from "./utils";
import { createIdleCountdown } from "./kiosk-idle";
import { useFound } from "./hooks/useFound";
import { LoginRequired } from "./components/Entry";
import { UserSettings } from "./components/UserSettings";
import { Header } from "./components/Header";
import { FoundIdentityBanner } from "./components/FoundIdentityBanner";
import { FoundPanel } from "./components/FoundPanel";
import { BrowsePanel } from "./components/BrowsePanel";
import { HistoryPanel, AdminPanel } from "./components/ItemCards";
import { LostPanel } from "./components/LostPanel";
import { MessagesPanel } from "./components/MessagesPanel";
import { DetailModal } from "./components/DetailModal";
import type { DetailAction } from "./components/DetailModal";
import { useUnreadMessages } from "./hooks/useUnreadMessages";
import "./styles/app.css";
const guestSession = sessionView(guestActor(), null, "none");
function formatIdle(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
export default function App() {
  const modalScroll = useRef(0);
  const rememberModalScroll = () => {
    modalScroll.current =
      document.querySelector<HTMLElement>("#detailModal .modal-panel")
        ?.scrollTop || 0;
  };
  const [session, setSession] = useState<SessionView>(guestSession);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionGeneration = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [testActors, setTestActors] = useState(false);
  const [panel, setPanel] = useState<Panel>("browse");
  const [needLogin, setNeedLogin] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [ai, setAi] = useState<AiStatus>({ configured: false, model: "" });
  const [detail, setDetail] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [idleLeft, setIdleLeft] = useState(KIOSK_IDLE_MS);
  const [toast, setToast] = useState({ message: "", id: 0 });
  const [matchingBusy, setMatchingBusy] = useState(false);
  const refreshGeneration = useRef(0);
  const actions = useRef(new Set<string>());
  const notify = useCallback(
    (text: string) =>
      setToast((current) => ({ message: text, id: current.id + 1 })),
    [],
  );
  useEffect(() => {
    if (!toast.message) return;
    const id = setTimeout(
      () => setToast((current) => ({ ...current, message: "" })),
      2600,
    );
    return () => clearTimeout(id);
  }, [toast.id, toast.message]);
  const signedIn = session.kind !== "guest";
  const loadSession = useCallback(async (signal?: AbortSignal) => {
    const generation = ++sessionGeneration.current;
    const data = await api<{ session: SessionView; testActors?: boolean }>(
      "/api/session",
      { signal },
    );
    if (generation !== sessionGeneration.current) return sessionRef.current;
    setSession(data.session);
    setSessionReady(true);
    setAuthError("");
    setTestActors(!!data.testActors);
    setNeedLogin(data.session.kind === "guest");
    return data.session;
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    void loadSession(ctrl.signal).catch((error) => {
      if (!ctrl.signal.aborted) setAuthError(message(error));
    });
    return () => ctrl.abort();
  }, [loadSession]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== window.location.origin ||
        event.data?.type !== "rdfz:lesson-identity-changed"
      )
        return;
      // A host notification triggers a server read; its payload never authenticates a user.
      const previous = sessionRef.current;
      void loadSession()
        .then((next) => {
          if (next.userId !== previous.userId || next.kind !== previous.kind) {
            refreshGeneration.current++;
            setItems([]);
            setDetail("");
            setPanel("browse");
            resetRef.current();
          }
        })
        .catch((error) => setAuthError(message(error)));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [loadSession]);
  function platformLogin() {
    const frame = window.frameElement;
    if (frame) frame.dispatchEvent(new CustomEvent("rdfz:lesson-identity"));
    else setAuthError("请从平台课件入口打开");
  }
  const refresh = useCallback(async () => {
    const token = ++refreshGeneration.current;
    const data = await api<{ items: Item[] }>("/api/items");
    if (token === refreshGeneration.current) setItems(sortItems(data.items));
  }, []);
  async function loginWithPassword(input: {
    name: string;
    className: string;
    password: string;
  }) {
    setAuthBusy(true);
    setAuthError("");
    try {
      const data = await api<{ actorKey: string }>("/api/test-login", {
        method: "POST",
        json: input,
      });
      setTestActor(data.actorKey);
      const next = await loadSession();
      if (next.kind === "guest") {
        setAuthError("登录失败，请检查姓名、班级和密码");
        return;
      }
      notify(`已登录为 ${next.name} · ${next.className}`);
      await refresh();
    } catch (err) {
      setAuthError(message(err));
    } finally {
      setAuthBusy(false);
    }
  }
  async function logoutToLogin() {
    setTestActor("");
    setSettingsOpen(false);
    setSettingsError("");
    setAuthError("");
    setItems([]);
    setDetail("");
    setPanel("browse");
    try {
      await loadSession();
      notify("已退出，请重新登录");
    } catch (err) {
      setNeedLogin(true);
      notify("退出失败：" + message(err));
    }
  }
  async function changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }) {
    setSettingsBusy(true);
    setSettingsError("");
    try {
      await api("/api/test-password", { method: "POST", json: input });
      setSettingsOpen(false);
      notify("密码已更新");
    } catch (err) {
      setSettingsError(message(err));
    } finally {
      setSettingsBusy(false);
    }
  }
  useEffect(() => {
    if (!signedIn) return;
    void api<AiStatus>("/api/ai/status")
      .then(setAi)
      .catch(() => {});
    void refresh().catch((err) => notify("无法连接服务器：" + message(err)));
  }, [refresh, signedIn, session.kind, session.userId, notify]);
  useEffect(() => {
    if (session.kind === "kiosk") setPanel("found");
  }, [session.kind]);
  const published = useCallback(async () => {
    await refresh();
    if (session.kind !== "kiosk") setPanel("history");
  }, [refresh, session.kind]);
  const found = useFound(ai, notify, published);
  useUnreadMessages(signedIn && session.capabilities.readMessages, (unread) => {
    notify(`有 ${unread} 条新的寻物配对消息，可在「消息」查看`);
  });
  const resetRef = useRef(found.reset);
  resetRef.current = found.reset;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (session.kind !== "kiosk" || panel !== "found") return;
    const idle = createIdleCountdown(KIOSK_IDLE_MS, () => {
      resetRef.current();
      notifyRef.current(
        "公共终端已闲置两分钟，已清空上一位的输入。终端账号仍可继续发布。",
      );
      setIdleLeft(KIOSK_IDLE_MS);
    });
    idle.start();
    setIdleLeft(KIOSK_IDLE_MS);
    const tick = window.setInterval(() => setIdleLeft(idle.remaining()), 1000);
    const bump = () => {
      idle.bump();
      setIdleLeft(KIOSK_IDLE_MS);
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      idle.stop();
      window.clearInterval(tick);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [session.kind, panel]);
  function onPanel(next: Panel) {
    if (!signedIn) {
      setNeedLogin(true);
      return;
    }
    if (session.kind === "kiosk" && next !== "found") return;
    if (next === "admin" && session.kind !== "admin") {
      notify("需要管理员权限");
      return;
    }
    if (next !== "found") found.cancel();
    setPanel(next);
    if (next !== "found")
      void refresh().catch((err) => notify("刷新列表失败：" + message(err)));
  }
  function endKiosk() {
    found.reset();
    notify("已结束本次使用并清空表单。终端仍可继续发布。");
  }
  async function remove(item: Item) {
    if (
      !confirm(`确定删除「${item.description}」吗？删除后不可恢复。`) ||
      !confirm("再次确认：真的要删除这条失物招领吗？")
    )
      return;
    if (actions.current.has(item.id)) return;
    actions.current.add(item.id);
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE" });
      setDetail("");
      await refresh();
      notify("已删除");
    } catch (err) {
      notify(message(err));
    } finally {
      actions.current.delete(item.id);
    }
  }
  async function markHighValue(item: Item) {
    if (actions.current.has(item.id)) return;
    actions.current.add(item.id);
    try {
      await api(`/api/items/${item.id}/high-value`, {
        method: "POST",
        json: { highValue: true },
      });
      await refresh();
      notify("已标为高价值。学生不能自行取消，也不能自行确认领走。");
    } catch (err) {
      notify(message(err));
    } finally {
      actions.current.delete(item.id);
    }
  }
  async function runMatching() {
    if (matchingBusy) return;
    setMatchingBusy(true);
    try {
      const data = await api<{ notice?: string }>("/api/matching/run", {
        method: "POST",
        json: {},
      });
      notify(data.notice || "已手动开启配对");
    } catch (err) {
      notify(message(err));
    } finally {
      setMatchingBusy(false);
    }
  }
  async function detailAction(action: DetailAction, body?: unknown) {
    rememberModalScroll();
    const path =
      action === "correct" || action === "reopen"
        ? "claim/correct"
        : action === "custody"
          ? "custody"
          : action === "deliver"
            ? "deliver"
            : action === "intent"
              ? "intent"
              : action === "withdraw"
                ? "withdraw"
                : "claim";
    const payload =
      action === "reopen"
        ? { reason: (body as { reason?: string } | undefined)?.reason || "" }
        : body;
    await api(`/api/items/${detail}/${path}`, {
      method: "POST",
      json: payload ?? {},
    });
    await refresh();
    notify(
      {
        claim: "已按本人身份登记领取",
        intent: "已提交领取意向，等待老师核验交付",
        deliver: "已记录真实领取人和经办管理员",
        custody: "已登记交到老师处。这还不是领取。",
        correct: "已更正交付，原记录仍保留",
        reopen: "已撤销这次交付，原记录仍保留",
        withdraw: "已撤下，公开列表不再展示",
      }[action],
    );
  }
  const filtered = items.filter((item) => {
    const q = search.trim().toLowerCase();
    const fields = [
      item.description,
      item.place,
      item.office,
      item.custody.location,
      item.custody.label,
    ];
    if (item.contactVisible)
      fields.push(item.contact, item.contactType, item.contactValue);
    return (
      (!q || fields.join(" ").toLowerCase().includes(q)) &&
      (!from || Date.parse(item.createdAt) >= Date.parse(from + "T00:00:00")) &&
      (!to || Date.parse(item.createdAt) <= Date.parse(to + "T23:59:59.999"))
    );
  });
  const selectedItem = items.find((item) => item.id === detail);
  const mine = session.userId
    ? items.filter((item) => item.ownerId === session.userId)
    : [];
  return (
    <>
      <LoginRequired
        open={!signedIn || needLogin}
        ready={sessionReady}
        onRetry={() =>
          void loadSession().catch((error) => setAuthError(message(error)))
        }
        platform={session.platformLogin === "ready"}
        onPlatformLogin={platformLogin}
        busy={authBusy}
        error={authError}
        onLogin={(input) => void loginWithPassword(input)}
      />
      {signedIn ? (
        <UserSettings
          open={settingsOpen}
          session={session}
          busy={settingsBusy}
          error={settingsError}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsError("");
          }}
          onChangePassword={(input) => void changePassword(input)}
          onLogout={() => void logoutToLogin()}
        />
      ) : null}
      {signedIn ? (
        <div className="app" id="app">
          <Header
            ai={ai}
            session={session}
            panel={panel}
            idleLabel={formatIdle(idleLeft)}
            testActors={testActors}
            onPanel={onPanel}
            onEndKiosk={endKiosk}
            onOpenSettings={() => {
              setSettingsError("");
              setSettingsOpen(true);
            }}
          />
          <main>
            {panel === "found" && session.capabilities.publishFound && (
              <FoundIdentityBanner session={session} />
            )}
            <FoundPanel
              active={panel === "found" && session.capabilities.publishFound}
              m={found}
              notify={notify}
            />
            <BrowsePanel
              active={panel === "browse"}
              items={filtered.filter((item) => item.status !== "withdrawn")}
              search={search}
              from={from}
              to={to}
              onSearch={setSearch}
              onFrom={setFrom}
              onTo={setTo}
              onOpen={setDetail}
            />
            <HistoryPanel
              active={panel === "history"}
              items={mine}
              onEdit={(item) => {
                onPanel("found");
                found.edit(item);
              }}
              onDelete={(item) => void remove(item)}
            />
            {session.capabilities.readMessages && (
              <LostPanel active={panel === "lost"} notify={notify} />
            )}
            {session.capabilities.readMessages && (
              <MessagesPanel active={panel === "messages"} notify={notify} />
            )}
            {session.kind === "admin" && (
              <AdminPanel
                active={panel === "admin"}
                items={items}
                matchingBusy={matchingBusy}
                onOpen={setDetail}
                onDelete={(item) => void remove(item)}
                onMarkHighValue={(item) => void markHighValue(item)}
                onRunMatching={() => void runMatching()}
              />
            )}
          </main>
        </div>
      ) : null}
      {signedIn && selectedItem && (
        <DetailModal
          key={
            selectedItem.id +
            selectedItem.status +
            selectedItem.highValue +
            selectedItem.custody.heldBy +
            (selectedItem.claim?.claimedAt || "") +
            selectedItem.myIntent
          }
          item={selectedItem}
          session={session}
          initialScroll={modalScroll.current}
          notify={notify}
          onClose={() => {
            rememberModalScroll();
            setDetail("");
          }}
          onDelete={(item) => void remove(item)}
          onNeedLogin={() => setNeedLogin(true)}
          onAction={detailAction}
        />
      )}
      <div
        className={"toast" + (toast.message ? " show" : "")}
        id="toast"
        role="status"
      >
        {toast.message}
      </div>
    </>
  );
}
