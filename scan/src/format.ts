/**
 * The time of issue with an explicit time zone (specification 9.1, item 3): local time with its UTC
 * offset, or UTC where local time is UTC.
 */

const PARTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};


/** The offset of local time from UTC at an instant, as "+02:00". */
function offset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Formats a time in Unix seconds in the conventions of `locale`: local time followed by its offset,
 * as "10 Oct 2026, 13:13:59 (UTC+02:00)", or followed by "UTC" where local time is UTC.
 */
export function formatTime(seconds: number, locale: string): string {
  const date = new Date(seconds * 1000);
  if (date.getTimezoneOffset() === 0) return `${new Intl.DateTimeFormat(locale, { ...PARTS, timeZone: "UTC" }).format(date)} UTC`;
  return `${new Intl.DateTimeFormat(locale, PARTS).format(date)} (UTC${offset(date)})`;
}
