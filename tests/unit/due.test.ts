import { describe, it, expect } from "vitest";
import { isDue, rollForward, addMonthsClamped } from "@/lib/reminders/due";
import type { Reminder } from "@/lib/types";

const base: Reminder = {
  id: "r1", boat_id: "b1", owner_id: "u1", system_id: "s1",
  title: "Oil change", rule_type: "hours",
  interval_months: null, interval_hours: 100,
  next_due_date: null, next_due_hours: 500,
  last_done_event_id: null, status: "active", created_at: "",
};

describe("isDue", () => {
  it("hours rule: due when latest reading >= next_due_hours", () => {
    expect(isDue(base, 500, "2026-06-11")).toBe(true);
    expect(isDue(base, 510, "2026-06-11")).toBe(true);
    expect(isDue(base, 499, "2026-06-11")).toBe(false);
  });

  it("hours rule: not due when no reading exists", () => {
    expect(isDue(base, null, "2026-06-11")).toBe(false);
  });

  it("calendar rule: due when today >= next_due_date", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 12, next_due_date: "2026-06-11" };
    expect(isDue(cal, null, "2026-06-11")).toBe(true);
    expect(isDue(cal, null, "2026-06-12")).toBe(true);
    expect(isDue(cal, null, "2026-06-10")).toBe(false);
  });

  it("non-active reminders are never due", () => {
    expect(isDue({ ...base, status: "dismissed" }, 600, "2026-06-11")).toBe(false);
  });
});

describe("rollForward", () => {
  it("hours rule: next due = done hours + interval", () => {
    expect(rollForward(base, { doneDate: "2026-06-11", doneHours: 512 }))
      .toEqual({ next_due_hours: 612, next_due_date: null });
  });

  it("hours rule without done hours: rolls from previous due", () => {
    expect(rollForward(base, { doneDate: "2026-06-11", doneHours: null }))
      .toEqual({ next_due_hours: 600, next_due_date: null });
  });

  it("calendar rule: next due = done date + interval months", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 6, next_due_date: "2026-06-01" };
    expect(rollForward(cal, { doneDate: "2026-06-11", doneHours: null }))
      .toEqual({ next_due_hours: null, next_due_date: "2026-12-11" });
  });

  it("calendar rule clamps month-end overflow (Jan 31 + 1mo = Feb 28)", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: 1, next_due_date: "2026-01-31" };
    expect(rollForward(cal, { doneDate: "2026-01-31", doneHours: null }))
      .toEqual({ next_due_hours: null, next_due_date: "2026-02-28" });
  });

  it("handles negative month offsets", () => {
    expect(addMonthsClamped("2026-03-15", -1)).toBe("2026-02-15");
    expect(addMonthsClamped("2026-01-15", -2)).toBe("2025-11-15");
  });

  it("throws for calendar reminder without interval_months", () => {
    const cal: Reminder = { ...base, rule_type: "calendar", interval_hours: null, next_due_hours: null, interval_months: null, next_due_date: "2026-06-01" };
    expect(() => rollForward(cal, { doneDate: "2026-06-11", doneHours: null })).toThrow();
  });
});
