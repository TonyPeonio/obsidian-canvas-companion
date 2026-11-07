// Local-time formatting. Canvas sends UTC timestamps; students think in their own clock.

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time. */
export function localDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH:mm in local time. */
export function localTime(d: Date): string {
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 2026-11-09" in local time. */
export function dayLabel(d: Date): string {
	return `${DAYS[d.getDay()]} ${localDate(d)}`;
}

/** Midnight (local) of the day containing `d`. */
export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
	const out = new Date(d);
	out.setDate(out.getDate() + n);
	return out;
}

/** Parses an ISO timestamp; null for empty or unparseable input. */
export function parseIso(s: string | null | undefined): Date | null {
	if (!s) return null;
	const t = Date.parse(s);
	return Number.isFinite(t) ? new Date(t) : null;
}

/** YYYYMMDDTHHMMSSZ, the iCalendar UTC form. */
export function icsUtc(d: Date): string {
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
