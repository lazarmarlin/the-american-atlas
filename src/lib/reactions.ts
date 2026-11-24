/**
 * A thumbs-up on a friend's badge or check-in, and the list of thumbs-up on
 * yours. Targets: "badge:<badge id>" or "visit:<place id>|<visit id>".
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { namesFor } from "@/lib/messages";

const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET_RE = /^(badge:[\w:.\- ]{1,100}|visit:[\w:._ -]{1,140}\|[\w:-]{1,60})$/;

export type Like = { from: string; fromId: string; target: string; label: string; at: number };

function parseOwner(value: unknown) {
  const id = String(value ?? "");
  if (!USER_RE.test(id)) throw new Error("Unknown friend");
  return id;
}

async function friendSql(me: string, owner: string) {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const ok = await sql<{ ok: boolean }>`select true as ok from friendships where user_id = ${me} and friend_id = ${owner}`;
  if (!ok[0]?.ok) throw new Error("Add them as a friend first.");
  return sql;
}

export const react = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const target = String(row.target ?? "");
    if (!TARGET_RE.test(target)) throw new Error("Unknown");
    return { ownerId: parseOwner(row.ownerId), target, on: row.on !== false };
  })
  .handler(async ({ context, data }) => {
    const sql = await friendSql(context.userId, data.ownerId);
    if (data.on) {
      await sql`
        insert into reactions (user_id, owner_id, target) values (${context.userId}, ${data.ownerId}, ${data.target})
        on conflict do nothing
      `;
    } else {
      await sql`delete from reactions where user_id = ${context.userId} and owner_id = ${data.ownerId} and target = ${data.target}`;
    }
    return { on: data.on };
  });

/** Thumbs-up counts on a friend's things, and which ones are yours. */
export const reactionsOn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOwner((input as { ownerId?: unknown } | null)?.ownerId))
  .handler(async ({ context, data: ownerId }) => {
    const sql = await friendSql(context.userId, ownerId);
    const rows = await sql<{ target: string; n: number; mine: boolean }>`
      select target, count(*)::int as n, bool_or(user_id = ${context.userId}) as mine
      from reactions where owner_id = ${ownerId}
      group by target
    `;
    return rows.map((row) => ({ target: row.target, count: Number(row.n) || 0, mine: !!row.mine }));
  });

/** Thumbs-up on your badges and check-ins, newest first. Looking marks them seen. */
export const recentLikes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Like[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ user_id: string; target: string; created_at: unknown }>`
      select x.user_id, x.target, x.created_at from reactions x
      where x.owner_id = ${context.userId}
        and exists (select 1 from friendships f where f.user_id = ${context.userId} and f.friend_id = x.user_id)
      order by x.created_at desc
      limit 30
    `;
    await sql`
      insert into message_reads (user_id, thread, read_at) values (${context.userId}, 'likes', now())
      on conflict (user_id, thread) do update set read_at = now()
    `;
    const names = await namesFor(sql, [...new Set(rows.map((row) => row.user_id))]);
    const { badgeDefs } = await import("@/lib/badge-defs");
    const { canonicalPlace } = await import("@/lib/catalog.server");
    const out: Like[] = [];
    for (const row of rows) {
      let label = "";
      if (row.target.startsWith("badge:")) {
        const id = row.target.slice(6);
        label = `your ${(badgeDefs as { id: string; name: string }[]).find((b) => b.id === id)?.name ?? "badge"} badge`;
      } else {
        const poi = row.target.slice(6, row.target.indexOf("|"));
        label = `your visit to ${(await canonicalPlace(poi))?.name ?? "a place"}`;
      }
      const at = row.created_at instanceof Date ? row.created_at.getTime() : new Date(String(row.created_at)).getTime();
      out.push({ from: names.get(row.user_id) ?? "A friend", fromId: row.user_id, target: row.target, label, at });
    }
    return out;
  });
