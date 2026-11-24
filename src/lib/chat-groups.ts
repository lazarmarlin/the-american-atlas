/**
 * Trip group chats: you and friends you pick, in one conversation
 * (messages in src/lib/messages.ts). Everyone in a group can see who's in it.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { namesFor } from "@/lib/messages";

export type ChatGroup = { id: string; name: string; ownerId: string; members: { id: string; name: string }[] };

const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GROUP_RE = /^cg-[a-z0-9]{6,24}$/;

export const createGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const name = String(row.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) throw new Error("Give the chat a name.");
    const members = [...new Set((Array.isArray(row.members) ? row.members : []).map(String))].filter((id) => USER_RE.test(id));
    if (!members.length) throw new Error("Pick at least one friend.");
    if (members.length > 12) throw new Error("Up to 12 friends in a chat.");
    return { name, members };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const ok = await sql<{ friend_id: string }>`
      select friend_id from friendships where user_id = ${context.userId} and friend_id = any(${data.members}::text[])
    `;
    if (ok.length !== data.members.length) throw new Error("You can only add friends.");
    const id = `cg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await sql`insert into chat_groups (id, name, owner_id) values (${id}, ${data.name}, ${context.userId})`;
    for (const userId of [context.userId, ...data.members]) {
      await sql`insert into chat_group_members (group_id, user_id) values (${id}, ${userId}) on conflict do nothing`;
    }
    return { id };
  });

export const listGroups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ChatGroup[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const groups = await sql<{ id: string; name: string; owner_id: string }>`
      select g.id, g.name, g.owner_id from chat_groups g
      join chat_group_members m on m.group_id = g.id and m.user_id = ${context.userId}
      order by g.created_at desc
    `;
    if (!groups.length) return [];
    const members = await sql<{ group_id: string; user_id: string }>`
      select group_id, user_id from chat_group_members where group_id = any(${groups.map((g) => g.id)}::text[])
    `;
    const names = await namesFor(sql, [...new Set(members.map((m) => m.user_id))]);
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: members
        .filter((m) => m.group_id === g.id)
        .map((m) => ({ id: m.user_id, name: m.user_id === context.userId ? "You" : names.get(m.user_id) ?? "Friend" })),
    }));
  });

/** Leave a group. The last one out takes the conversation with them. */
export const leaveGroup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown } | null)?.id ?? "");
    if (!GROUP_RE.test(id)) throw new Error("Unknown chat");
    return id;
  })
  .handler(async ({ context, data: id }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from chat_group_members where group_id = ${id} and user_id = ${context.userId}`;
    await sql`delete from message_reads where user_id = ${context.userId} and thread = ${`g:${id}`}`;
    const left = await sql<{ n: number }>`select count(*)::int as n from chat_group_members where group_id = ${id}`;
    if (!Number(left[0]?.n)) {
      await sql`delete from message_hidden where message_id in (select id from group_messages where group_id = ${id})`;
      await sql`delete from group_messages where group_id = ${id}`;
      await sql`delete from chat_groups where id = ${id}`;
    }
    return { ok: true as const };
  });
