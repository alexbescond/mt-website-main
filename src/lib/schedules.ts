export function dailyCleanupDue(event: Pick<ScheduledController, "cron" | "scheduledTime">) {
  // Accept the old daily trigger while Cloudflare propagates schedule changes.
  if (event.cron === "17 3 * * *") return true;
  const scheduled = new Date(event.scheduledTime);
  return event.cron === "*/5 * * * *" && scheduled.getUTCHours() === 3 && scheduled.getUTCMinutes() === 15;
}
