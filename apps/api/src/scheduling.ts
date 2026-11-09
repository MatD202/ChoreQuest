import { DateTime } from "luxon";
export function weekStart(date: string, zone: string) {
  const parsed = DateTime.fromISO(date, { zone });
  if (!parsed.isValid) throw new Error("Invalid date or timezone");
  return parsed.startOf("week");
}
export function allocate<T extends { effort: number; key: string }>(
  tasks: T[],
  members: { id: string; assigned: number; history: number }[],
) {
  const pool = members.map((m) => ({ ...m }));
  if (!pool.length) return [];
  return [...tasks]
    .sort((a, b) => b.effort - a.effort || a.key.localeCompare(b.key))
    .map((task) => {
      pool.sort(
        (a, b) =>
          a.assigned - b.assigned ||
          a.history - b.history ||
          a.id.localeCompare(b.id),
      );
      const selected = pool[0];
      selected.assigned += task.effort;
      return { task, assigneeId: selected.id };
    });
}
export function occurrences(
  chore: { recurrence?: string | null; preferredDay?: number | null },
  week: string,
  zone: string,
) {
  const start = weekStart(week, zone);
  const days =
    chore.recurrence === "daily"
      ? [0, 1, 2, 3, 4, 5, 6]
      : [(chore.preferredDay ?? 1) - 1];
  return days.map((day) => {
    const due = start.plus({ days: day }).endOf("day");
    return {
      key: chore.recurrence === "once" ? "once" : due.toISODate()!,
      dueAt: due.toJSDate(),
    };
  });
}
export const levelFor = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;
