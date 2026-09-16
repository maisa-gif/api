const TIME_ZONE = process.env.SYNC_TIME_ZONE ?? "America/Sao_Paulo";

function formatIso(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

/** Today's date as YYYY-MM-DD in the app's configured timezone. */
export function todayIso(): string {
  return formatIso(new Date());
}

/**
 * Yesterday's date as YYYY-MM-DD in the app's configured timezone. Used by
 * the 8am report email, sent after salespeople finish logging the previous
 * day's sales — "today" at 8am would still be empty.
 */
export function yesterdayIso(): string {
  return formatIso(new Date(Date.now() - 24 * 60 * 60 * 1000));
}
