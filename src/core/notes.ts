// Rendering of the course notes and the This week note, and the merge that keeps the user's
// own text outside the managed blocks across syncs.

import { addDays, dayLabel, localDate, localTime, parseIso, startOfDay } from "./dates";
import { htmlToMarkdown } from "./html";
import type { Assignment, CourseData } from "./model";

export const MARK_END = "<!-- /canvas-companion -->";
export const markStart = (key: string) => `<!-- canvas-companion:${key} -->`;

export interface RenderOptions {
	now: Date;
	announcementsToKeep: number;
	includePastDue: boolean;
}

export type Bucket = "upcoming" | "pastDue" | "done" | "undated";

export function bucketOf(a: Assignment, now: Date): Bucket {
	if (a.submitted) return "done";
	const due = parseIso(a.dueAt);
	if (!due) return "undated";
	return due.getTime() < now.getTime() ? "pastDue" : "upcoming";
}

/** By due date ascending; undated last; ties by name. */
export function byDue(a: Assignment, b: Assignment): number {
	const ta = parseIso(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
	const tb = parseIso(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
	return ta - tb || a.name.localeCompare(b.name);
}

export function pointsLabel(a: Assignment): string {
	if (a.pointsPossible === null) return "";
	const pts = formatNumber(a.pointsPossible);
	if (a.graded && a.score !== null) return ` (${formatNumber(a.score)}/${pts} pts)`;
	return ` (${pts} pts)`;
}

function formatNumber(n: number): string {
	return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** One task line in the format the Tasks plugin reads (📅 due date, ⏰ time). */
export function taskLine(a: Assignment, opts: { withCourse?: string } = {}): string {
	const due = parseIso(a.dueAt);
	const box = a.submitted ? "[x]" : "[ ]";
	const name = opts.withCourse ? `${opts.withCourse}: ${a.name}` : a.name;
	const when = due ? ` 📅 ${localDate(due)} ⏰ ${localTime(due)}` : "";
	const missing = !a.submitted && a.missing ? " ⚠️ missing" : "";
	const link = a.htmlUrl ? ` [Canvas](${a.htmlUrl})` : "";
	return `- ${box} ${name}${when}${pointsLabel(a)}${missing}${link}`;
}

export function renderAssignments(data: CourseData, opts: RenderOptions): string {
	const groups: Record<Bucket, Assignment[]> = { upcoming: [], pastDue: [], done: [], undated: [] };
	for (const a of data.assignments) groups[bucketOf(a, opts.now)].push(a);
	for (const g of Object.values(groups)) g.sort(byDue);
	const out: string[] = ["## Assignments", ""];
	if (data.error) out.push(`> [!warning] ${data.error}`, "");
	const section = (title: string, items: Assignment[]) => {
		if (items.length === 0) return;
		out.push(`### ${title}`, "");
		for (const a of items) out.push(taskLine(a));
		out.push("");
	};
	section("Upcoming", [...groups.upcoming, ...groups.undated]);
	if (opts.includePastDue) section("Past due", groups.pastDue);
	section("Done", groups.done.slice().sort((a, b) => byDue(b, a)));
	if (data.assignments.length === 0 && !data.error) out.push("No assignments.", "");
	return out.join("\n").trimEnd();
}

export function renderAnnouncements(data: CourseData, opts: RenderOptions): string {
	const out: string[] = ["## Announcements", ""];
	const items = data.announcements.slice(0, opts.announcementsToKeep);
	if (items.length === 0) {
		out.push("No announcements.");
		return out.join("\n");
	}
	for (const a of items) {
		const posted = parseIso(a.postedAt);
		const when = posted ? localDate(posted) : "";
		out.push(`### ${a.title}${when ? ` (${when})` : ""}`, "");
		const body = htmlToMarkdown(a.html);
		if (body) out.push(body, "");
		if (a.url) out.push(`[Open in Canvas](${a.url})`, "");
	}
	return out.join("\n").trimEnd();
}

export function renderGrade(data: CourseData): string {
	const { score, grade } = data.grade;
	if (score === null && grade === null) return "";
	const parts: string[] = [];
	if (score !== null) parts.push(`${formatNumber(score)}%`);
	if (grade) parts.push(grade);
	return `## Grade\n\nCurrent: **${parts.join(" · ")}**`;
}

/** The managed sections of a course note, keyed by block name, in display order. */
export function renderCourseSections(data: CourseData, opts: RenderOptions): Record<string, string> {
	const sections: Record<string, string> = {
		assignments: renderAssignments(data, opts),
		announcements: renderAnnouncements(data, opts),
	};
	const grade = renderGrade(data);
	if (grade) sections.grade = grade;
	return sections;
}

function block(key: string, body: string): string {
	return `${markStart(key)}\n${body}\n${MARK_END}`;
}

/**
 * Writes the managed blocks into `existing` (or a fresh note): a block already present is
 * replaced in place, a missing one is appended, and everything else in the note stays as it
 * is. Running it twice with the same sections changes nothing.
 */
export function mergeManaged(existing: string | null, title: string, sections: Record<string, string>): string {
	if (existing === null || existing.trim() === "") {
		const parts = [`# ${title}`, "", ...Object.entries(sections).map(([k, v]) => block(k, v)), "", "## My notes", ""];
		return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
	}
	let out = existing.replace(/\r\n/g, "\n");
	const missing: string[] = [];
	for (const [key, body] of Object.entries(sections)) {
		const start = markStart(key);
		const i = out.indexOf(start);
		if (i < 0) {
			missing.push(block(key, body));
			continue;
		}
		const j = out.indexOf(MARK_END, i);
		if (j < 0) {
			missing.push(block(key, body));
			continue;
		}
		out = out.slice(0, i) + block(key, body) + out.slice(j + MARK_END.length);
	}
	if (missing.length) {
		// Before "## My notes" when present, so the user's area stays last; else at the end.
		const idx = out.indexOf("\n## My notes");
		const insert = missing.join("\n") + "\n";
		out = idx >= 0 ? out.slice(0, idx + 1) + insert + out.slice(idx + 1) : out.trimEnd() + "\n\n" + insert;
	}
	return out.endsWith("\n") ? out : out + "\n";
}

/** The This week note: overdue first, then one section per day for the next `days` days. */
export function renderThisWeek(courses: { vaultName: string; data: CourseData }[], now: Date, days = 7): string {
	const out: string[] = ["# This week", ""];
	const today = startOfDay(now);
	const end = addDays(today, days);
	const overdue: { course: string; a: Assignment }[] = [];
	const byDay = new Map<string, { course: string; a: Assignment }[]>();
	for (const { vaultName, data } of courses) {
		for (const a of data.assignments) {
			if (a.submitted) continue;
			const due = parseIso(a.dueAt);
			if (!due) continue;
			if (due.getTime() < now.getTime()) {
				overdue.push({ course: vaultName, a });
				continue;
			}
			if (due.getTime() >= end.getTime()) continue;
			const key = localDate(due);
			const list = byDay.get(key) ?? [];
			list.push({ course: vaultName, a });
			byDay.set(key, list);
		}
	}
	if (overdue.length) {
		out.push("## Overdue", "");
		for (const { course, a } of overdue.sort((x, y) => byDue(x.a, y.a))) out.push(taskLine(a, { withCourse: course }));
		out.push("");
	}
	let any = false;
	for (let i = 0; i < days; i++) {
		const day = addDays(today, i);
		const items = byDay.get(localDate(day));
		if (!items) continue;
		any = true;
		out.push(`## ${i === 0 ? "Today, " : i === 1 ? "Tomorrow, " : ""}${dayLabel(day)}`, "");
		for (const { course, a } of items.sort((x, y) => byDue(x.a, y.a))) out.push(taskLine(a, { withCourse: course }));
		out.push("");
	}
	if (!any) out.push(`Nothing due in the next ${days} days.`, "");
	return out.join("\n").trimEnd() + "\n";
}

/** A file name Obsidian accepts, from a course name. */
export function safeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/-{2,}/g, "-")
		.replace(/^[\s.-]+|[\s.-]+$/g, "")
		.trim() || "Course";
}
