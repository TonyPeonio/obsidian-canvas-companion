// Canvas LMS REST client (https://canvas.instructure.com/doc/api/). Only what the plugin
// needs: who am I, my courses, each course's assignments with my submission, announcements,
// and my current grade. Pagination follows `Link: rel="next"`.

import { header, type HttpRequest } from "./http";
import type { Announcement, Assignment, CanvasCourse, CourseGrade } from "./model";

export class CanvasError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "CanvasError";
	}
}

type Json = Record<string, unknown>;

export class CanvasClient {
	constructor(
		private getBaseUrl: () => string,
		private getToken: () => string,
		private http: HttpRequest,
	) {}

	get baseUrl(): string {
		return this.getBaseUrl().trim().replace(/\/+$/, "");
	}

	get configured(): boolean {
		return this.baseUrl.length > 0 && this.getToken().trim().length > 0;
	}

	async self(): Promise<{ id: number; name: string }> {
		const me = await this.getOne("/api/v1/users/self");
		return { id: Number(me.id), name: str(me.name) || str(me.short_name) };
	}

	async listCourses(): Promise<CanvasCourse[]> {
		const rows = await this.getAll("/api/v1/courses", { enrollment_state: "active", "include[]": "term", per_page: "50" });
		return rows
			.filter((c) => typeof c.name === "string" && !c.access_restricted_by_date)
			.map((c) => ({
				id: Number(c.id),
				name: String(c.name),
				courseCode: typeof c.course_code === "string" ? c.course_code : "",
				term: typeof (c.term as Json | undefined)?.name === "string" ? String((c.term as Json).name) : undefined,
			}));
	}

	/** Every assignment of the course with the current user's submission state. */
	async listAssignments(courseId: number): Promise<Assignment[]> {
		const rows = await this.getAll(`/api/v1/courses/${courseId}/assignments`, { "include[]": "submission", per_page: "50", order_by: "due_at" });
		return rows.map((row) => toAssignment(row, courseId)).filter((a): a is Assignment => a !== null);
	}

	/** Recent announcements for the given courses, newest first. */
	async listAnnouncements(courseIds: number[], limit: number): Promise<Announcement[]> {
		if (courseIds.length === 0 || limit <= 0) return [];
		const rows = await this.getAll("/api/v1/announcements", {
			"context_codes[]": courseIds.map((id) => `course_${id}`),
			per_page: String(Math.min(100, Math.max(limit, 10))),
			// Canvas defaults to the last 14 days; ask for a wider window so a quiet course still shows something.
			start_date: new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10),
			end_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
		});
		const out: Announcement[] = [];
		for (const row of rows) {
			const code = str(row.context_code);
			const m = /^course_(\d+)$/.exec(code);
			if (!m) continue;
			out.push({
				id: Number(row.id),
				courseId: Number(m[1]),
				title: str(row.title),
				postedAt: str(row.posted_at) || str(row.created_at),
				html: str(row.message),
				url: str(row.html_url),
			});
		}
		return out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
	}

	/** The student's current score and letter grade in the course; nulls when Canvas has none. */
	async courseGrade(courseId: number): Promise<CourseGrade> {
		const rows = await this.getAll(`/api/v1/courses/${courseId}/enrollments`, { "user_id": "self", per_page: "10" });
		for (const row of rows) {
			if (row.type !== "StudentEnrollment" && row.type !== "student") continue;
			const grades = (row.grades ?? {}) as Json;
			const score = typeof grades.current_score === "number" ? grades.current_score : null;
			const grade = typeof grades.current_grade === "string" && grades.current_grade ? grades.current_grade : null;
			return { score, grade };
		}
		return { score: null, grade: null };
	}

	private async getOne(path: string, params: Record<string, string | string[]> = {}): Promise<Json> {
		const res = await this.request(this.url(path, params));
		return parseJson(res.text, res.status) as Json;
	}

	/** Follows `Link: rel="next"` pagination (capped to stay polite). */
	private async getAll(path: string, params: Record<string, string | string[]> = {}, maxPages = 20): Promise<Json[]> {
		let url: string | undefined = this.url(path, params);
		const out: Json[] = [];
		for (let page = 0; url && page < maxPages; page++) {
			const res = await this.request(url);
			const body = parseJson(res.text, res.status);
			if (!Array.isArray(body)) throw new CanvasError(`Expected a list from ${path}`);
			out.push(...(body as Json[]));
			url = nextLink(header(res.headers, "link"));
		}
		return out;
	}

	private async request(url: string): Promise<{ status: number; headers: Record<string, string>; text: string }> {
		const token = this.getToken().trim();
		if (!this.baseUrl) throw new CanvasError("Canvas URL is not set.");
		if (!token) throw new CanvasError("Canvas access token is not set.");
		let res;
		try {
			res = await this.http({ url, method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
		} catch (err) {
			throw new CanvasError(`Cannot reach Canvas at ${this.baseUrl}: ${(err as Error).message}`);
		}
		if (res.status >= 400) throw new CanvasError(describeError(res.status, res.text), res.status);
		return res;
	}

	private url(pathOrUrl: string, params: Record<string, string | string[]>): string {
		const base = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
		const qs: string[] = [];
		for (const [k, v] of Object.entries(params)) {
			for (const value of Array.isArray(v) ? v : [v]) qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(value)}`);
		}
		if (qs.length === 0) return base;
		return base + (base.includes("?") ? "&" : "?") + qs.join("&");
	}
}

export function nextLink(linkHeader: string | undefined): string | undefined {
	if (!linkHeader) return undefined;
	for (const part of linkHeader.split(",")) {
		const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
		if (m) return m[1];
	}
	return undefined;
}

function toAssignment(row: Json, courseId: number): Assignment | null {
	if (row.id === undefined) return null;
	const sub = (row.submission ?? null) as Json | null;
	const state = sub ? str(sub.workflow_state) : "";
	const score = sub && typeof sub.score === "number" ? sub.score : null;
	const graded = state === "graded" || score !== null;
	const submitted = graded || state === "submitted" || state === "pending_review" || (sub !== null && typeof sub.submitted_at === "string" && sub.submitted_at.length > 0);
	return {
		id: Number(row.id),
		courseId,
		name: str(row.name) || `Assignment ${Number(row.id)}`,
		dueAt: typeof row.due_at === "string" && row.due_at ? row.due_at : null,
		pointsPossible: typeof row.points_possible === "number" ? row.points_possible : null,
		htmlUrl: str(row.html_url),
		submitted,
		graded,
		score,
		missing: sub?.missing === true,
	};
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function parseJson(text: string, status: number): unknown {
	try {
		return JSON.parse(text.replace(/^while\(1\);/, ""));
	} catch {
		throw new CanvasError(`Canvas returned a non-JSON response (HTTP ${status}): ${text.slice(0, 200)}`, status);
	}
}

function describeError(status: number, text: string): string {
	let detail = "";
	try {
		const json = JSON.parse(text.replace(/^while\(1\);/, "")) as Json;
		const errors = json.errors;
		if (Array.isArray(errors) && typeof (errors[0] as Json | undefined)?.message === "string") detail = String((errors[0] as Json).message);
		else if (typeof json.message === "string") detail = json.message;
	} catch {
		detail = text.slice(0, 200);
	}
	if (status === 401) return `Canvas rejected the access token (401). Create a new token under Account → Settings → Approved Integrations and paste it into the plugin settings. ${detail}`.trim();
	if (status === 403) return `Canvas refused the request (403): ${detail || "no permission"}`;
	if (status === 404) return `Canvas: not found (404). Check the Canvas URL and that you are enrolled. ${detail}`.trim();
	return `Canvas returned HTTP ${status}: ${detail}`;
}
