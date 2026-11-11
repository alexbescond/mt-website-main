import { expect, it } from "vitest";
import { dailyCleanupDue } from "../../src/lib/schedules";

it("runs retention once per UTC day through the shared five-minute schedule, including DST changes", () => {
  for (const date of ["2026-03-29", "2026-10-25", "2026-11-04"]) {
    const midnight = Date.parse(date + "T00:00:00Z");
    const cleanupTimes = Array.from({ length: 288 }, (_, index) => midnight + index * 300000)
      .filter(scheduledTime => dailyCleanupDue({ cron: "*/5 * * * *", scheduledTime }));
    expect(cleanupTimes).toEqual([Date.parse(date + "T03:15:00Z")]);
  }
});

it("continues handling the legacy daily cron during deployment propagation", () => {
  expect(dailyCleanupDue({ cron: "17 3 * * *", scheduledTime: Date.parse("2026-11-04T03:17:00Z") })).toBe(true);
  expect(dailyCleanupDue({ cron: "0 * * * *", scheduledTime: Date.parse("2026-11-04T03:15:00Z") })).toBe(false);
});
