import type { Reminder } from "@/lib/types";

/**
 * Due semantics. `today` is an ISO YYYY-MM-DD string (UTC — accepted MVP
 * simplification; user-timezone handling is a later refinement).
 * `latestHours` is the newest reading for the reminder's system, or null.
 */
export function isDue(reminder: Reminder, latestHours: number | null, today: string): boolean {
  if (reminder.status !== "active") return false;
  if (reminder.rule_type === "hours")
    return reminder.next_due_hours != null && latestHours != null && latestHours >= Number(reminder.next_due_hours);
  return reminder.next_due_date != null && today >= reminder.next_due_date;
}

/** Add months in pure date math, clamping to the target month's last day. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function rollForward(
  reminder: Reminder,
  done: { doneDate: string; doneHours: number | null }
): { next_due_hours: number | null; next_due_date: string | null } {
  if (reminder.rule_type === "hours") {
    const baseHours = done.doneHours ?? Number(reminder.next_due_hours ?? 0);
    return { next_due_hours: baseHours + Number(reminder.interval_hours ?? 0), next_due_date: null };
  }
  return { next_due_hours: null, next_due_date: addMonthsClamped(done.doneDate, reminder.interval_months ?? 0) };
}
