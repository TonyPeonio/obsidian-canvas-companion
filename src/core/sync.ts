// The sync itself, independent of Obsidian: fetch every course, render the notes, write only
// what changed. The plugin supplies a NoteStore backed by the vault; tests use a Map.

import { CanvasClient, CanvasError } from "./canvas";
import { renderIcs } from "./ics";
import type { CourseData } from "./model";
import { mergeManaged, renderCourseSections, renderThisWeek, safeFileName } from "./notes";

export interface NoteStore {
	read(path: string): Promise<string | null>;
	write(path: string, content: string): Promise<void>;
}

export interface SyncSettings {
	coursesFolder: string;
	thisWeekPath: string;
	announcementsToKeep: number;
	includePastDue: boolean;
	icsEnabled: boolean;
	icsPath: string;
	/** Canvas course names (or codes) to leave out. */
	hiddenCourses: string[];
	/** Canvas course name → vault note name. */
	aliases: Record<string, string>;
}

export interface SyncReport {
	courses: { canvasName: string; vaultName: string; path: string; assignments: number; announcements: number; error?: string }[];
	written: string[];
	/** Fatal: nothing was synced. */
	error?: string;
}

/** The vault name for a Canvas course: the alias when one matches (name or code, case-insensitive), else the Canvas name. */
export function vaultNameFor(course: { name: string; courseCode: string }, aliases: Record<string, string>): string {
	for (const [from, to] of Object.entries(aliases)) {
		const f = from.trim().toLowerCase();
		if (!f || !to.trim()) continue;
		if (f === course.name.trim().toLowerCase() || (course.courseCode && f === course.courseCode.trim().toLowerCase())) return to.trim();
	}
	return course.name.trim();
}

export function isHidden(course: { name: string; courseCode: string }, hidden: string[]): boolean {
	return hidden.some((h) => {
		const x = h.trim().toLowerCase();
		return x.length > 0 && (x === course.name.trim().toLowerCase() || (course.courseCode && x === course.courseCode.trim().toLowerCase()));
	});
}

/** "Canvas name = Vault name" per line → map; lines without "=" are ignored. */
export function parseAliases(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const i = line.indexOf("=");
		if (i < 0) continue;
		const from = line.slice(0, i).trim();
		const to = line.slice(i + 1).trim();
		if (from && to) out[from] = to;
	}
	return out;
}

type Announcements = Awaited<ReturnType<CanvasClient["listAnnouncements"]>>;

/**
 * Announcements come in one call for all courses. Canvas refuses that whole call (401/403)
 * when the token may not read announcements in even one of them, so on refusal fall back to
 * one call per course: the readable courses still get theirs and only the refused ones are
 * reported. Any other failure (network, 5xx) is reported for every course without retrying.
 */
async function fetchAnnouncements(client: CanvasClient, courseIds: number[], perCourse: number): Promise<{ announcements: Announcements; errors: Map<number, string> }> {
	const errors = new Map<number, string>();
	if (courseIds.length === 0) return { announcements: [], errors };
	try {
		return { announcements: await client.listAnnouncements(courseIds, perCourse * courseIds.length), errors };
	} catch (err) {
		const refused = err instanceof CanvasError && (err.status === 401 || err.status === 403);
		if (!refused || courseIds.length === 1) {
			for (const id of courseIds) errors.set(id, (err as Error).message);
			return { announcements: [], errors };
		}
	}
	const announcements: Announcements = [];
	for (const id of courseIds) {
		try {
			announcements.push(...(await client.listAnnouncements([id], perCourse)));
		} catch (err) {
			errors.set(id, (err as Error).message);
		}
	}
	announcements.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
	return { announcements, errors };
}

export async function syncCanvas(client: CanvasClient, store: NoteStore, settings: SyncSettings, now: Date = new Date(), onStatus?: (s: string) => void): Promise<SyncReport> {
	const report: SyncReport = { courses: [], written: [] };
	if (!client.configured) {
		report.error = "Set the Canvas URL and access token in the plugin settings first.";
		return report;
	}
	let courses;
	try {
		onStatus?.("Listing courses…");
		courses = (await client.listCourses()).filter((c) => !isHidden(c, settings.hiddenCourses));
	} catch (err) {
		report.error = err instanceof CanvasError ? err.message : `Canvas sync failed: ${(err as Error).message}`;
		return report;
	}
	onStatus?.("Fetching announcements…");
	const { announcements, errors: announcementErrors } = await fetchAnnouncements(client, courses.map((c) => c.id), Math.max(settings.announcementsToKeep, 1));

	const folder = settings.coursesFolder.replace(/^\/+|\/+$/g, "");
	const perCourse: { vaultName: string; data: CourseData }[] = [];
	for (const course of courses) {
		onStatus?.(`Syncing ${course.name}…`);
		const data: CourseData = { course, assignments: [], announcements: announcements.filter((a) => a.courseId === course.id), grade: { score: null, grade: null } };
		try {
			data.assignments = await client.listAssignments(course.id);
		} catch (err) {
			// Canvas hides assignments for some enrollments (401/403); say so in the note and move on.
			data.error = `Assignments could not be read: ${(err as Error).message}`;
		}
		try {
			data.grade = await client.courseGrade(course.id);
		} catch {
			// Grades are optional; many courses hide them.
		}
		const announcementsError = announcementErrors.get(course.id);
		if (announcementsError) data.error = [data.error, `Announcements could not be read: ${announcementsError}`].filter(Boolean).join(" ");
		const vaultName = vaultNameFor(course, settings.aliases);
		const path = `${folder ? folder + "/" : ""}${safeFileName(vaultName)}.md`;
		const existing = await store.read(path);
		const next = mergeManaged(existing, vaultName, renderCourseSections(data, { now, announcementsToKeep: settings.announcementsToKeep, includePastDue: settings.includePastDue }));
		if (next !== existing) {
			await store.write(path, next);
			report.written.push(path);
		}
		perCourse.push({ vaultName, data });
		report.courses.push({ canvasName: course.name, vaultName, path, assignments: data.assignments.length, announcements: data.announcements.length, error: data.error });
	}

	const weekPath = settings.thisWeekPath.replace(/^\/+/, "");
	if (weekPath) {
		const week = renderThisWeek(perCourse, now);
		if ((await store.read(weekPath)) !== week) {
			await store.write(weekPath, week);
			report.written.push(weekPath);
		}
	}
	if (settings.icsEnabled && settings.icsPath.trim()) {
		const icsPath = settings.icsPath.replace(/^\/+/, "");
		const ics = renderIcs(perCourse, now);
		// DTSTAMP changes every run; compare without it so an unchanged calendar is not rewritten.
		const strip = (s: string | null) => (s ?? "").replace(/^DTSTAMP:.*$/gm, "");
		if (strip(await store.read(icsPath)) !== strip(ics)) {
			await store.write(icsPath, ics);
			report.written.push(icsPath);
		}
	}
	return report;
}
