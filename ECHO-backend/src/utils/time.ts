/**
 * ECHO — Naive datetime utilities
 *
 * All ECHO datetimes are stored as "naive" local-time ISO strings (no Z / tz offset),
 * so they display identically on any device regardless of its timezone setting.
 * The server must run in the event's local timezone (Italy / Europe/Rome).
 *
 * Node/V8 rule: "YYYY-MM-DDTHH:mm:ss.sss" without Z → parsed as LOCAL time.
 * This is spec-defined (ES2015+) and consistent across Node 18+.
 */

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function pad3(n: number): string { return String(n).padStart(3, '0'); }

/** Format a Date as a naive local-time ISO string, e.g. "2026-06-18T17:30:00.000". */
export function toNaive(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
  );
}

/** Current server local time as a naive ISO string. */
export function nowNaive(): string {
  return toNaive(new Date());
}

// Loud, unmissable boot-time confirmation of the resolved server timezone — every
// naive-datetime computation in this file silently assumes the server's local
// timezone IS Europe/Rome (no TZ conversion happens anywhere). If a cloud host's
// container defaults to UTC (the common case) without TZ=Europe/Rome set, every
// event's data_inizio comparison drifts by 1-2h (CET/CEST offset) with no error,
// just events that seem to start/end at the wrong time. Compare against Europe/Rome.
const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(
  `[Config] Server timezone = ${resolvedTz} (process.env.TZ=${JSON.stringify(process.env['TZ'])}) ` +
  `— MUST be Europe/Rome or naive datetime comparisons (event start/end, cron) will be wrong.`
);

/**
 * Add minutes to a naive ISO string and return a naive ISO string.
 * new Date("YYYY-MM-DDTHH:mm") is parsed as LOCAL time by V8,
 * so arithmetic and back-conversion stay in the server's local timezone.
 */
export function addMinutesNaive(naiveIso: string, m: number): string {
  const d = new Date(naiveIso);
  d.setMinutes(d.getMinutes() + m);
  return toNaive(d);
}
