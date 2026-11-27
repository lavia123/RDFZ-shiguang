import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus, Item } from "../shared/types";
import { KIOSK_IDLE_MS, type SessionView } from "../shared/identity";
import { api, message } from "./api";
import type { Panel } from "./state";
import { sortItems } from "./utils";
import { createIdleCountdown } from "./kiosk-idle";
import { useSession } from "./hooks/useSession";
import { useFound } from "./hooks/useFound";
import { LoginRequired } from "./components/Entry";
import { Header } from "./components/Header";
import { FoundIdentityBanner } from "./components/FoundIdentityBanner";
import { FoundPanel } from "./components/FoundPanel";
import { BrowsePanel } from "./components/BrowsePanel";
import { HistoryPanel, AdminPanel } from "./components/ItemCards";
import { DetailModal } from "./components/DetailModal";
import { LostPanel } from "./components/LostPanel";
import { MessagesPanel } from "./components/MessagesPanel";
import type { DetailAction } from "./components/DetailModal";
import "./styles/app.css";
function formatIdle(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
export default function App() {
  const { session, error, reload } = useSession();
  const [needLogin, setNeedLogin] = useState(false);
  if (!session)
    return (
      <main className="app">
        <p role="status">{error || "正在读取身份…"}</p>
        {error && (
          <button className="btn" onClick={() => void reload()}>
            重新读取
          </button>
        )}
      </main>
    );
  return (
    <>
      <LoginRequired
        open={needLogin}
        session={session}
        onClose={() => setNeedLogin(false)}
        onChanged={async () => {
          setNeedLogin(false);
          await reload();
        }}
      />
      <Workspace
        key={`${session.provenance}:${session.kind}:${session.userId}:${session.className}`}
        session={session}
        onLogin={() => setNeedLogin(true)}
      />
    </>
  );
}
function Workspace({
  session,
  onLogin,
}: {
  session: SessionView;
  onLogin: () => void;
}) {
  const modalScroll = useRef(0);
  const rememberModalScroll = () => {
    modalScroll.current =
      document.querySelector<HTMLElement>("#detailModal .modal-scroll")
        ?.scrollTop || 0;
  };
  const [panel, setPanel] = useState<Panel>("browse");
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
  useEffect(() => {
    const ctrl = new AbortController();
    void api<AiStatus>("/api/ai/status", { signal: ctrl.signal })
      .then(setAi)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  const refresh = useCallback(async () => {
    const token = ++refreshGeneration.current;
    const data = await api<{ items: Item[] }>("/api/items");
    if (token === refreshGeneration.current) setItems(sortItems(data.items));
  }, []);
  useEffect(() => {
    void refresh().catch((err) => notify("无法连接服务器：" + message(err)));
  }, [refresh, session.kind, notify]);
  useEffect(() => {
    if (session.kind === "kiosk") setPanel("found");
  }, [session.kind]);
  const published = useCallback(async () => {
    await refresh();
    if (session.kind !== "kiosk") setPanel("history");
  }, [refresh, session.kind]);
  const found = useFound(ai, notify, published);
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
    if (session.kind === "kiosk" && next !== "found") return;
    if (session.kind === "guest" && next !== "browse") {
      onLogin();
      return;
    }
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
  async function markHighValue(item: Item, highValue: boolean) {
    if (actions.current.has(item.id)) return;
    actions.current.add(item.id);
    try {
      await api(`/api/items/${item.id}/high-value`, {
        method: "POST",
        json: { highValue },
      });
      await refresh();
      notify(
        highValue
          ? "已标为高价值。学生不能自行确认领走。"
          : "已撤销高价值标记。",
      );
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
      const data = await api<{
        notice?: string;
        batch?: { status?: string; error?: string | null };
      }>("/api/matching/run", {
        method: "POST",
        json: {},
      });
      if (data.batch?.status === "failed") {
        notify(
          data.batch.error
            ? `配对未完成：${data.batch.error}`
            : "配对未完成",
        );
      } else {
        notify(data.notice || "已手动开启 AI 配对");
      }
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
      <div className="app" id="app">
        <Header
          ai={ai}
          session={session}
          panel={panel}
          idleLabel={formatIdle(idleLeft)}
          onPanel={onPanel}
          onEndKiosk={endKiosk}
          onLogin={onLogin}
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
          {session.kind === "student" && (
            <LostPanel
              active={panel === "lost"}
              notify={notify}
              aiConfigured={ai.configured}
            />
          )}
          {session.capabilities.readMessages && (
            <MessagesPanel
              active={panel === "messages"}
              notify={notify}
              isAdmin={session.kind === "admin"}
              onOpenItem={(itemId) => {
                setPanel("browse");
                void (async () => {
                  try {
                    await refresh();
                  } catch (err) {
                    notify("刷新列表失败：" + message(err));
                  }
                  setDetail(itemId);
                })();
              }}
            />
          )}
          {session.kind === "admin" && (
            <AdminPanel
              active={panel === "admin"}
              items={items}
              matchingBusy={matchingBusy}
              onOpen={setDetail}
              onDelete={(item) => void remove(item)}
              onMarkHighValue={(item, highValue) =>
                void markHighValue(item, highValue)
              }
              onRunMatching={() => void runMatching()}
            />
          )}
        </main>
      </div>
      {selectedItem && (
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
          onNeedLogin={() => onLogin()}
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
