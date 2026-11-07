// iCalendar export of upcoming assignments, so deadlines show up on a phone calendar that
// subscribes to the file (or imports it).

import { icsUtc, parseIso } from "./dates";
import type { CourseData } from "./model";

function escapeText(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: lines longer than 75 octets continue with a leading space. */
export function foldLine(line: string): string {
	const enc = new TextEncoder();
	const out: string[] = [];
	let current = "";
	for (const ch of line) {
		if (enc.encode(current + ch).length > 75) {
			out.push(current);
			current = " " + ch;
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out.join("\r\n");
}

export function renderIcs(courses: { vaultName: string; data: CourseData }[], now: Date): string {
	const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Canvas Companion for Obsidian//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Canvas deadlines"];
	const stamp = icsUtc(now);
	const events: { due: Date; text: string[] }[] = [];
	for (const { vaultName, data } of courses) {
		for (const a of data.assignments) {
			const due = parseIso(a.dueAt);
			if (!due || due.getTime() < now.getTime() || a.submitted) continue;
			const text = [
				"BEGIN:VEVENT",
				`UID:canvas-assignment-${a.id}@canvas-companion`,
				`DTSTAMP:${stamp}`,
				`DTSTART:${icsUtc(due)}`,
				`DTEND:${icsUtc(due)}`,
				`SUMMARY:${escapeText(`${vaultName}: ${a.name}`)}`,
			];
			if (a.pointsPossible !== null) text.push(`DESCRIPTION:${escapeText(`${a.pointsPossible} points`)}`);
			if (a.htmlUrl) text.push(`URL:${a.htmlUrl}`);
			text.push("END:VEVENT");
			events.push({ due, text });
		}
	}
	events.sort((x, y) => x.due.getTime() - y.due.getTime());
	for (const e of events) lines.push(...e.text);
	lines.push("END:VCALENDAR");
	return lines.map(foldLine).join("\r\n") + "\r\n";
}
