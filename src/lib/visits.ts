export type Visit = {
  id: string;
  visitedOn: string | null;
  note: string;
  photo: string;
};

/** Share of the place's points each visit is worth. After the fifth, a visit is tracked and worth nothing. */
export const VISIT_SHARES = [1, 0.85, 0.5, 0.25, 0.1];

export function shareForVisit(index: number) {
  return VISIT_SHARES[index] ?? 0;
}

export function pointsForVisit(base: number, index: number) {
  return Math.round(Math.max(0, base) * shareForVisit(index));
}

export function earnedFromVisits(base: number, count: number) {
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += pointsForVisit(base, i);
  return sum;
}

/** Saved places with no visit rows still count as the first, full-points visit. */
export function visitCount(visits: Visit[] | undefined) {
  return visits && visits.length ? visits.length : 1;
}

export function earnedPoints(mark: { points: number; visits?: Visit[] }) {
  return earnedFromVisits(mark.points, visitCount(mark.visits));
}

export function freshVisit(): Visit {
  return { id: `v:${crypto.randomUUID()}`, visitedOn: null, note: "", photo: "" };
}

function cleanVisit(value: unknown): Visit | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!/^[A-Za-z0-9:._-]{1,80}$/.test(id)) return null;
  const rawDate = String(row.visitedOn ?? "").trim();
  const visitedOn = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const note = String(row.note ?? "").trim().slice(0, 500);
  const photo = String(row.photo ?? "");
  if (photo && (!photo.startsWith("data:image/jpeg;base64,") || photo.length > 140000)) {
    throw new Error("Use a smaller photo");
  }
  return { id, visitedOn, note, photo };
}

export function parseVisits(value: unknown): Visit[] {
  const rows = Array.isArray(value) ? value : [];
  const visits: Visit[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, 12)) {
    const visit = cleanVisit(row);
    if (!visit || seen.has(visit.id)) continue;
    seen.add(visit.id);
    visits.push(visit);
  }
  return visits;
}

export function readVisits(
  raw: unknown,
  fallback?: { visitedOn?: string | null; note?: string; photo?: string },
): Visit[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      parsed = [];
    }
  }
  const visits = parseVisits(parsed);
  if (visits.length) return visits;
  return [
    {
      id: "v1",
      visitedOn: fallback?.visitedOn ?? null,
      note: fallback?.note ?? "",
      photo: fallback?.photo ?? "",
    },
  ];
}

export function ensureVisits<T extends { visitedOn?: string | null; note?: string; photo?: string; visits?: Visit[] }>(
  mark: T,
): T & { visits: Visit[] } {
  const visits = readVisits(mark.visits, mark);
  const latest = visits[visits.length - 1];
  return {
    ...mark,
    visits,
    visitedOn: latest?.visitedOn ?? null,
    note: latest?.note ?? "",
    photo: latest?.photo ?? "",
  };
}
