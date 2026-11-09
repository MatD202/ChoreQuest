import { describe, it, expect } from "vitest";
import { allocate, occurrences, weekStart, levelFor } from "./scheduling.js";
describe("fair allocation", () => {
  it("sorts effort descending and uses weekly assigned effort before history", () => {
    expect(
      allocate(
        [
          { key: "small", effort: 5 },
          { key: "large", effort: 20 },
        ],
        [
          { id: "a", assigned: 0, history: 50 },
          { id: "b", assigned: 0, history: 10 },
        ],
      ).map((x) => [x.task.key, x.assigneeId]),
    ).toEqual([
      ["large", "b"],
      ["small", "a"],
    ]);
  });
  it("is stable and handles no members", () => {
    expect(allocate([{ key: "a", effort: 10 }], [])).toEqual([]);
    expect(
      allocate(
        [{ key: "a", effort: 10 }],
        [
          { id: "b", assigned: 0, history: 0 },
          { id: "a", assigned: 0, history: 0 },
        ],
      )[0].assigneeId,
    ).toBe("a");
  });
  it("generates timezone-aware days across DST", () => {
    const days = occurrences(
      { recurrence: "daily" },
      "2026-03-23",
      "Europe/Ljubljana",
    );
    expect(days).toHaveLength(7);
    expect(days[6].dueAt.getTime() - days[5].dueAt.getTime()).toBe(
      23 * 3600000,
    );
    expect(weekStart("2026-11-08", "Europe/Ljubljana").toISODate()).toBe(
      "2026-11-02",
    );
  });
  it("uses a permanent key for one-off chores and a preferred weekday", () => {
    expect(
      occurrences({ recurrence: "once" }, "2026-11-02", "UTC")[0].key,
    ).toBe("once");
    expect(
      occurrences(
        { recurrence: "weekly", preferredDay: 3 },
        "2026-11-02",
        "UTC",
      )[0].key,
    ).toBe("2026-11-04");
    expect(levelFor(400)).toBe(3);
  });
});
