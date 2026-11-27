import { Router } from "express";
import { platformScope } from "../platform-scope.js";
import type { Request } from "express";
import { HttpError, text } from "../errors.js";
import type { FileStore } from "../storage.js";
import type { LostStore } from "../lost/store.js";
import type { MessageStore } from "./store.js";
import type {
  CurrentActor,
  IsApprovedVersion,
  ResolveActor,
} from "../../shared/b-contracts.js";
import type { MatchMessage, MatchMessageView } from "../../shared/messages.js";
import { SCHOOL_ADMIN_MAILBOX } from "../../shared/messages.js";
import { foundContentRevision, isOpenFoundItem } from "../matching/found.js";

function requireMailbox(actor: CurrentActor) {
  if (actor.kind === "guest" || !actor.userId)
    throw new HttpError(401, "需要登录身份才能查看消息");
  if (actor.kind === "kiosk") throw new HttpError(403, "公共端不显示私人消息");
  return actor as CurrentActor & { userId: string };
}

function ownsMessage(
  actor: CurrentActor & { userId: string },
  msg: MatchMessage,
) {
  if (msg.recipientUserId === actor.userId) return true;
  const kind = msg.kind || "match";
  return (
    actor.kind === "admin" &&
    msg.recipientUserId === SCHOOL_ADMIN_MAILBOX &&
    (kind === "claim_dispute" || kind === "high_value_alert")
  );
}

export function messagesRouter(deps: {
  messages: MessageStore;
  lost: LostStore;
  store: FileStore;
  resolveActor: ResolveActor;
  isApprovedVersion: IsApprovedVersion;
}) {
  const router = Router();
  const actorOf = async (req: Request) =>
    deps.resolveActor({
      header: (name) => {
        const v = req.header(name);
        return v === undefined ? undefined : String(v);
      },
      body: req.body,
    });

  async function inScope(msg: Awaited<ReturnType<MessageStore["read"]>>) {
    if (!msg) return false;
    const kind = msg.kind || "match";
    if (kind !== "match") {
      if (!msg.itemId) return true;
      const found = await deps.store.read(msg.itemId);
      return !!found;
    }
    if (!platformScope.getStore()) return true;
    // Match explanations can contain content from both referenced records.
    const [lost, found] = await Promise.all([
      deps.lost.read(msg.lostPostId),
      deps.store.read(msg.itemId),
    ]);
    return !!lost && !!found;
  }

  async function decorate(
    msg: Awaited<ReturnType<MessageStore["read"]>> & object,
  ): Promise<MatchMessageView> {
    const kind = msg.kind || "match";
    const record = msg.itemId ? await deps.store.read(msg.itemId) : null;
    if (kind !== "match") {
      return {
        ...msg,
        kind,
        stale: false,
        staleReason: "",
        itemDescription: record?.item.description,
        itemImage: record?.item.image,
        itemPlace: record?.item.place,
        itemOffice: record?.item.office,
        itemStatus: record?.item.status,
      };
    }
    const lost = await deps.lost.read(msg.lostPostId);
    let stale = false;
    let staleReason = "";
    if (!lost || lost.status !== "open") {
      stale = true;
      staleReason = "寻物已关闭或已找回";
    } else if (
      !record ||
      !isOpenFoundItem(record.item, deps.isApprovedVersion)
    ) {
      stale = true;
      staleReason = "招领已领取或已撤下";
    } else if (
      lost.revision !== msg.lostRevision ||
      foundContentRevision(record.item) !== msg.itemRevision
    ) {
      stale = true;
      staleReason = "相关内容已更新，请等待下次配对";
    }
    return {
      ...msg,
      kind,
      stale,
      staleReason,
      lostDescription: lost?.description,
      itemDescription: record?.item.description,
      itemImage: record?.item.image,
      itemPlace: record?.item.place,
      itemOffice: record?.item.office,
      itemStatus: record?.item.status,
    };
  }

  router.get("/messages", async (req, res) => {
    const actor = requireMailbox(await actorOf(req));
    const personal = await deps.messages.listForUser(actor.userId);
    const shared =
      actor.kind === "admin"
        ? await deps.messages.listForUser(SCHOOL_ADMIN_MAILBOX)
        : [];
    const byId = new Map<string, (typeof personal)[number]>();
    for (const m of [...personal, ...shared]) {
      if (ownsMessage(actor, m)) byId.set(m.id, m);
    }
    const list = [...byId.values()];
    list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const visible = await Promise.all(
      list.map(async (m) => ((await inScope(m)) ? m : null)),
    );
    const messages = await Promise.all(
      visible.filter((m) => m !== null).map((m) => decorate(m)),
    );
    res.json({
      messages,
      unread: messages.filter((m) => !m.read && !m.dismissed && !m.stale)
        .length,
    });
  });

  router.get("/messages/:id", async (req, res) => {
    const actor = requireMailbox(await actorOf(req));
    const msg = await deps.messages.read(text(req.params.id));
    if (!msg || !ownsMessage(actor, msg) || !(await inScope(msg)))
      throw new HttpError(404, "消息不存在");
    res.json({ message: await decorate(msg) });
  });

  router.post("/messages/:id/read", async (req, res) => {
    const actor = requireMailbox(await actorOf(req));
    const updated = await deps.messages.mutate(
      text(req.params.id),
      async (cur) => {
        if (!cur || !ownsMessage(actor, cur) || !(await inScope(cur)))
          throw new HttpError(404, "消息不存在");
        return {
          ...cur,
          read: true,
          updatedAt: new Date().toISOString(),
        };
      },
    );
    res.json({ message: await decorate(updated!) });
  });

  router.post("/messages/:id/dismiss", async (req, res) => {
    const actor = requireMailbox(await actorOf(req));
    const updated = await deps.messages.mutate(
      text(req.params.id),
      async (cur) => {
        if (!cur || !ownsMessage(actor, cur) || !(await inScope(cur)))
          throw new HttpError(404, "消息不存在");
        return {
          ...cur,
          dismissed: true,
          read: true,
          updatedAt: new Date().toISOString(),
        };
      },
    );
    res.json({ message: await decorate(updated!) });
  });

  return router;
}
