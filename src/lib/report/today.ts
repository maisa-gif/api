const TIME_ZONE = process.env.SYNC_TIME_ZONE ?? "America/Sao_Paulo";

/** Today's date as YYYY-MM-DD in the app's configured timezone. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
}
