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

/** Today plus `days` (can be negative), as YYYY-MM-DD in the app's configured timezone. */
export function todayPlusDaysIso(days: number): string {
  return formatIso(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

/**
 * `iso` (YYYY-MM-DD) plus `days` (can be negative), as YYYY-MM-DD. Anchors
 * to noon UTC before shifting so the result doesn't depend on the
 * server's own local timezone, only on TIME_ZONE.
 */
export function isoPlusDays(iso: string, days: number): string {
  const noonUtc = new Date(`${iso}T12:00:00Z`);
  return formatIso(new Date(noonUtc.getTime() + days * 24 * 60 * 60 * 1000));
}
