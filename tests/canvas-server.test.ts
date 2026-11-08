// Drives the real client and sync against an in-process HTTP server that imitates Canvas:
// `while(1);` prefixes, Link-header pagination, 401/403 bodies, and the submission and
// enrollment shapes Canvas actually sends.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CanvasClient, CanvasError } from "../src/core/canvas";
import type { HttpRequest } from "../src/core/http";
import { syncCanvas, type SyncSettings } from "../src/core/sync";
import { MemoryStore } from "./fakes";

const GOOD_TOKEN = "7~goodtoken";
const now = new Date("2026-11-07T18:00:00Z");

// Courses: 1 and 2 normal, 3 forbids announcements, 4 has no assignments, 5 restricted by date.
const COURSES = [
	{ id: 1, name: "Machine Learning", course_code: "CSCI-470", term: { name: "Fall 2026" } },
	{ id: 2, name: "Linear Algebra", course_code: "MATH-332" },
	{ id: 3, name: "Quantum Mechanics", course_code: "PHGN-320" },
	{ id: 4, name: "Seminar", course_code: "SEM-100" },
	{ id: 5, name: "Old course", course_code: "OLD", access_restricted_by_date: true },
];

const ASSIGNMENTS: Record<number, unknown[]> = {
	1: [
		{ id: 10, name: "HW 1", due_at: "2026-10-20T06:59:00Z", points_possible: 10, html_url: "https://canvas.test/courses/1/assignments/10", submission: { workflow_state: "graded", score: 9, submitted_at: "2026-10-19T01:00:00Z", late: false, missing: false } },
		{ id: 11, name: "HW 2", due_at: "2026-10-27T06:59:00Z", points_possible: 10, html_url: "https://canvas.test/courses/1/assignments/11", submission: { workflow_state: "graded", score: 7, submitted_at: "2026-10-28T03:00:00Z", late: true, missing: false } },
		{ id: 12, name: "HW 3", due_at: "2026-11-03T06:59:00Z", points_possible: 10, html_url: "https://canvas.test/courses/1/assignments/12", submission: { workflow_state: "unsubmitted", score: null, submitted_at: null, late: true, missing: true } },
		{ id: 13, name: "HW 4", due_at: "2026-11-10T06:59:00Z", points_possible: 10, html_url: "https://canvas.test/courses/1/assignments/13", submission: { workflow_state: "unsubmitted", score: null, submitted_at: null, late: false, missing: false } },
		{ id: 14, name: "Reading reflection", due_at: null, points_possible: 5, html_url: "https://canvas.test/courses/1/assignments/14", submission: { workflow_state: "unsubmitted", score: null } },
	],
	2: [{ id: 20, name: "Problem set 5", due_at: "2026-11-12T06:59:00Z", points_possible: 20, html_url: "https://canvas.test/courses/2/assignments/20", submission: { workflow_state: "submitted", score: null, submitted_at: "2026-11-06T20:00:00Z", late: false } }],
	3: [{ id: 30, name: "Lab 3", due_at: "2026-11-11T06:59:00Z", points_possible: 15, html_url: "https://canvas.test/courses/3/assignments/30", submission: { workflow_state: "unsubmitted" } }],
	4: [],
};

const ANNOUNCEMENTS = [
	{ id: 100, context_code: "course_1", title: "Exam moved", message: "<p>To <b>Friday</b>.</p>", posted_at: "2026-11-01T12:00:00Z", html_url: "https://canvas.test/courses/1/discussion_topics/100" },
	{ id: 101, context_code: "course_2", title: "Office hours", message: "<p>Moved to 3pm</p>", posted_at: "2026-11-04T12:00:00Z", html_url: "https://canvas.test/courses/2/discussion_topics/101" },
	{ id: 102, context_code: "course_4", title: "Welcome", message: "<p>Hi</p>", posted_at: "2026-11-05T12:00:00Z", html_url: "https://canvas.test/courses/4/discussion_topics/102" },
];

const ENROLLMENTS: Record<number, unknown[]> = {
	1: [{ type: "StudentEnrollment", grades: { current_score: 87.5, current_grade: "B+", final_score: 60.1, final_grade: "D-" } }],
	2: [{ type: "StudentEnrollment", grades: { current_score: null, current_grade: null, final_score: null, final_grade: null } }],
	3: [],
	4: [{ type: "ObserverEnrollment", grades: { current_score: 100 } }],
};

interface Hit {
	path: string;
	query: URLSearchParams;
	auth: string | undefined;
}

class MockCanvas {
	server!: Server;
	base = "";
	hits: Hit[] = [];
	/** Courses whose announcements the token may not read. */
	forbiddenAnnouncements = new Set<number>([3]);
	perPage = 2;

	async start(): Promise<void> {
		this.server = createServer((req, res) => this.handle(req, res));
		await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
		const { port } = this.server.address() as AddressInfo;
		this.base = `http://127.0.0.1:${port}`;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve, reject) => this.server.close((err) => (err ? reject(err) : resolve())));
	}

	private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
		res.end("while(1);" + JSON.stringify(body));
	}

	private handle(req: IncomingMessage, res: ServerResponse): void {
		const url = new URL(req.url ?? "/", this.base);
		const auth = req.headers.authorization;
		this.hits.push({ path: url.pathname, query: url.searchParams, auth });
		if (auth !== `Bearer ${GOOD_TOKEN}`) {
			this.send(res, 401, { errors: [{ message: "Invalid access token." }] }, { "WWW-Authenticate": 'Bearer realm="canvas-lms"' });
			return;
		}
		if (req.headers.accept !== "application/json") {
			this.send(res, 406, { errors: [{ message: "Not acceptable" }] });
			return;
		}
		const path = url.pathname;
		if (path === "/api/v1/users/self") return this.send(res, 200, { id: 42, name: "Test Student", short_name: "Test" });
		if (path === "/api/v1/courses") return this.paginated(url, res, COURSES);
		let m = /^\/api\/v1\/courses\/(\d+)\/assignments$/.exec(path);
		if (m) {
			const rows = ASSIGNMENTS[Number(m[1])];
			if (!rows) return this.send(res, 404, { errors: [{ message: "The specified resource does not exist." }] });
			return this.paginated(url, res, rows);
		}
		m = /^\/api\/v1\/courses\/(\d+)\/enrollments$/.exec(path);
		if (m) {
			const rows = ENROLLMENTS[Number(m[1])];
			if (!rows) return this.send(res, 404, { errors: [{ message: "The specified resource does not exist." }] });
			return this.paginated(url, res, rows);
		}
		if (path === "/api/v1/announcements") {
			const codes = url.searchParams.getAll("context_codes[]");
			if (codes.some((c) => this.forbiddenAnnouncements.has(Number(c.replace("course_", ""))))) {
				return this.send(res, 403, { status: "unauthorized", errors: [{ message: "user not authorized to perform that action" }] });
			}
			return this.paginated(
				url,
				res,
				ANNOUNCEMENTS.filter((a) => codes.includes(a.context_code)),
			);
		}
		this.send(res, 404, { errors: [{ message: "The specified resource does not exist." }] });
	}

	/** Canvas-style pagination: `page` and `per_page` query params, `Link` header with rel="next". */
	private paginated(url: URL, res: ServerResponse, rows: unknown[]): void {
		const perPage = Math.min(Number(url.searchParams.get("per_page") ?? "10"), this.perPage);
		const page = Number(url.searchParams.get("page") ?? "1");
		const start = (page - 1) * perPage;
		const slice = rows.slice(start, start + perPage);
		const pages = Math.max(1, Math.ceil(rows.length / perPage));
		const link = (p: number, rel: string) => {
			const u = new URL(url);
			u.searchParams.set("page", String(p));
			u.searchParams.set("per_page", String(perPage));
			return `<${u.toString()}>; rel="${rel}"`;
		};
		const links = [link(page, "current")];
		if (page < pages) links.push(link(page + 1, "next"));
		links.push(link(1, "first"), link(pages, "last"));
		this.send(res, 200, slice, { Link: links.join(",") });
	}
}

const fetchHttp: HttpRequest = async (opts) => {
	const res = await fetch(opts.url, { method: opts.method ?? "GET", headers: opts.headers });
	const text = await res.text();
	return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, arrayBuffer: new ArrayBuffer(0) };
};

const settings: SyncSettings = {
	coursesFolder: "Courses",
	thisWeekPath: "Courses/This week.md",
	announcementsToKeep: 5,
	includePastDue: true,
	icsEnabled: true,
	icsPath: "Courses/deadlines.ics",
	hiddenCourses: [],
	aliases: {},
};

const canvas = new MockCanvas();
beforeAll(() => canvas.start());
afterAll(() => canvas.stop());
beforeEach(() => {
	canvas.hits = [];
	canvas.forbiddenAnnouncements = new Set([3]);
	canvas.perPage = 2;
});

const client = (token = GOOD_TOKEN) => new CanvasClient(() => canvas.base, () => token, fetchHttp);

describe("CanvasClient against a mock Canvas server", () => {
	it("follows Link pagination across three pages and strips the while(1); prefix", async () => {
		const courses = await client().listCourses();
		expect(courses.map((c) => c.id)).toEqual([1, 2, 3, 4]);
		expect(courses[0]).toEqual({ id: 1, name: "Machine Learning", courseCode: "CSCI-470", term: "Fall 2026" });
		const pages = canvas.hits.filter((h) => h.path === "/api/v1/courses");
		expect(pages).toHaveLength(3);
		expect(pages.map((h) => h.query.get("page"))).toEqual([null, "2", "3"]);
		expect(pages.every((h) => h.query.get("per_page") !== null)).toBe(true);
		expect(pages.every((h) => h.query.get("enrollment_state") === "active")).toBe(true);
	});

	it("surfaces a 401 as an invalid-or-expired token with instructions for a new one", async () => {
		const err = await client("stale").self().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CanvasError);
		expect((err as CanvasError).status).toBe(401);
		expect((err as Error).message).toMatch(/invalid or expired/i);
		expect((err as Error).message).toMatch(/Account → Settings → Approved Integrations → New Access Token/);
		expect((err as Error).message).toContain("Invalid access token.");
	});

	it("maps graded, unsubmitted, late, missing and undated assignments", async () => {
		const list = await client().listAssignments(1);
		expect(list.map((a) => [a.id, a.submitted, a.graded, a.score, a.late, a.missing, a.dueAt])).toEqual([
			[10, true, true, 9, false, false, "2026-10-20T06:59:00Z"],
			[11, true, true, 7, true, false, "2026-10-27T06:59:00Z"],
			[12, false, false, null, true, true, "2026-11-03T06:59:00Z"],
			[13, false, false, null, false, false, "2026-11-10T06:59:00Z"],
			[14, false, false, null, false, false, null],
		]);
		expect(await client().listAssignments(4)).toEqual([]);
		// Five rows at two per page: three requests.
		expect(canvas.hits.filter((h) => h.path === "/api/v1/courses/1/assignments")).toHaveLength(3);
	});

	it("reads the enrollment grade in every shape Canvas sends", async () => {
		expect(await client().courseGrade(1)).toEqual({ score: 87.5, grade: "B+" });
		expect(await client().courseGrade(2)).toEqual({ score: null, grade: null });
		expect(await client().courseGrade(3)).toEqual({ score: null, grade: null });
		// A non-student enrollment carries no grade of ours.
		expect(await client().courseGrade(4)).toEqual({ score: null, grade: null });
		expect(canvas.hits.filter((h) => h.path.endsWith("/enrollments")).every((h) => h.query.get("user_id") === "self")).toBe(true);
	});

	it("rejects a 403 on announcements with the Canvas message", async () => {
		await expect(client().listAnnouncements([1, 3], 10)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/403.*user not authorized/) as string });
		const ok = await client().listAnnouncements([1, 2], 10);
		expect(ok.map((a) => a.id)).toEqual([101, 100]);
	});
});

describe("syncCanvas against a mock Canvas server", () => {
	it("writes every course, warns only on the course whose announcements are forbidden, and renders each state", async () => {
		const store = new MemoryStore();
		const statuses: string[] = [];
		const report = await syncCanvas(client(), store, settings, now, (s) => statuses.push(s));
		expect(report.error).toBeUndefined();
		expect(report.courses.map((c) => [c.vaultName, c.assignments, c.announcements, c.error ?? null])).toEqual([
			["Machine Learning", 5, 1, null],
			["Linear Algebra", 1, 1, null],
			["Quantum Mechanics", 1, 0, expect.stringMatching(/Announcements could not be read: .*403/) as string],
			["Seminar", 0, 1, null],
		]);
		expect(report.written.sort()).toEqual(["Courses/Linear Algebra.md", "Courses/Machine Learning.md", "Courses/Quantum Mechanics.md", "Courses/Seminar.md", "Courses/This week.md", "Courses/deadlines.ics"]);
		expect(store.files.has("Courses/Old course.md")).toBe(false);

		const ml = store.files.get("Courses/Machine Learning.md")!;
		expect(ml).toContain("### Upcoming\n\n- [ ] HW 4 📅");
		expect(ml).toContain("- [ ] Reading reflection (5 pts) [Canvas](https://canvas.test/courses/1/assignments/14)");
		expect(ml).not.toContain("Reading reflection 📅");
		expect(ml).toContain("### Past due\n\n- [ ] HW 3 📅");
		expect(ml).toMatch(/- \[ \] HW 3 📅 \S+ ⏰ \S+ \(10 pts\) ⚠️ missing/);
		expect(ml).toMatch(/- \[x\] HW 2 📅 \S+ ⏰ \S+ \(7\/10 pts\) ⚠️ late/);
		expect(ml).toMatch(/- \[x\] HW 1 📅 \S+ ⏰ \S+ \(9\/10 pts\) \[Canvas\]/);
		expect(ml).toContain("### Exam moved (2026-11-01)\n\nTo **Friday**.");
		expect(ml).toContain("## Grade\n\nCurrent: **87.5% · B+**");

		const la = store.files.get("Courses/Linear Algebra.md")!;
		expect(la).toContain("- [x] Problem set 5 📅");
		expect(la).toContain("### Office hours (2026-11-04)");
		expect(la).not.toContain("## Grade");

		const qm = store.files.get("Courses/Quantum Mechanics.md")!;
		expect(qm).toContain("- [ ] Lab 3 📅");
		expect(qm).toMatch(/> \[!warning\] Announcements could not be read: .*403/);
		expect(qm).toContain("No announcements.");
		expect(qm).not.toContain("## Grade");

		const sem = store.files.get("Courses/Seminar.md")!;
		expect(sem).toContain("## Assignments\n\nNo assignments.");
		expect(sem).toContain("### Welcome (2026-11-05)");
		expect(sem).not.toContain("## Grade");

		const week = store.files.get("Courses/This week.md")!;
		expect(week).toContain("## Overdue\n\n- [ ] Machine Learning: HW 3");
		expect(week).toContain("Machine Learning: HW 4");
		expect(week).toContain("Quantum Mechanics: Lab 3");
		expect(week).not.toContain("Problem set 5");
		expect(week).not.toContain("Reading reflection");

		const ics = store.files.get("Courses/deadlines.ics")!;
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(ics).toContain("DTSTART:20261110T065900Z");
		expect(ics).toContain("DTSTART:20261111T065900Z");

		expect(statuses[0]).toBe("Listing courses…");
		expect(statuses).toContain("Syncing Seminar…");
		// Every request carried the token and asked for JSON.
		expect(canvas.hits.every((h) => h.auth === `Bearer ${GOOD_TOKEN}`)).toBe(true);
	});

	it("keeps every course's announcements when none are forbidden", async () => {
		canvas.forbiddenAnnouncements = new Set();
		const store = new MemoryStore();
		const report = await syncCanvas(client(), store, settings, now);
		expect(report.courses.every((c) => c.error === undefined)).toBe(true);
		// One combined (paginated) request serves all courses; no per-course fallback calls.
		const hits = canvas.hits.filter((h) => h.path === "/api/v1/announcements");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.every((h) => h.query.getAll("context_codes[]").length === 4)).toBe(true);
	});

	it("fails the whole sync with the token message on 401 and writes nothing", async () => {
		const store = new MemoryStore();
		const report = await syncCanvas(client("expired"), store, settings, now);
		expect(report.error).toMatch(/invalid or expired/i);
		expect(report.error).toMatch(/New Access Token/);
		expect(report.courses).toEqual([]);
		expect(store.writes).toEqual([]);
	});
});
