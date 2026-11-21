import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type Profile = {
  name: string;
  photo: string;
};

export const getProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ name: string; photo: string }>`
      select name, photo from profiles where user_id = ${context.userId}
    `;
    return { name: rows[0]?.name ?? "", photo: rows[0]?.photo ?? "" };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing profile");
    const row = input as Record<string, unknown>;
    const name = String(row.name ?? "").trim().slice(0, 40);
    if (!name) throw new Error("Add a name");
    const photo = String(row.photo ?? "");
    const uploaded = photo.startsWith("data:image/jpeg;base64,");
    const remote = /^https:\/\/\S{1,500}$/.test(photo);
    if (photo && !uploaded && !remote) throw new Error("Use a smaller photo");
    if (uploaded && photo.length > 140000) throw new Error("Use a smaller photo");
    return { name, photo };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into profiles (user_id, name, photo)
      values (${context.userId}, ${data.name}, ${data.photo})
      on conflict (user_id) do update set
        name = excluded.name,
        photo = excluded.photo,
        updated_at = now()
    `;
    return data;
  });
