import { describe, expect, it } from "vitest";
import { CanvasClient } from "../src/core/canvas";
import { isHidden, parseAliases, syncCanvas, vaultNameFor, type SyncSettings } from "../src/core/sync";
import { FakeHttp, MemoryStore } from "./fakes";

const now = new Date("2026-11-07T18:00:00Z");

const settings: SyncSettings = {
	coursesFolder: "Courses",
	thisWeekPath: "Courses/This week.md",
	announcementsToKeep: 5,
	includePastDue: true,
	icsEnabled: true,
	icsPath: "Courses/deadlines.ics",
	hiddenCourses: ["Orientation"],
	aliases: { "Fall 2026 CSCI-470-A Machine Learning": "CSCI 470" },
};

function canvas(): FakeHttp {
	return new FakeHttp()
		.on("/api/v1/courses", [
			{ id: 1, name: "Fall 2026 CSCI-470-A Machine Learning", course_code: "CSCI-470-A" },
			{ id: 2, name: "Linear Algebra", course_code: "MATH-332" },
			{ id: 3, name: "Orientation", course_code: "ORI" },
		])
		.on("/api/v1/announcements", [{ id: 5, context_code: "course_1", title: "Exam moved", message: "<p>To Friday</p>", posted_at: "2026-11-01T12:00:00Z", html_url: "https://c/d/5" }])
		.on("/api/v1/courses/1/assignments", [{ id: 10, name: "HW 4", due_at: "2026-11-10T06:59:00Z", points_possible: 10, html_url: "https://c/a/10", submission: { workflow_state: "unsubmitted" } }])
		.on("/api/v1/courses/2/assignments", { message: "unauthorized" }, { status: 403 })
		.on("/api/v1/courses/1/enrollments", [{ type: "StudentEnrollment", grades: { current_score: 90, current_grade: "A-" } }])
		.on("/api/v1/courses/2/enrollments", []);
}

describe("syncCanvas", () => {
	it("writes course notes, This week and the calendar; skips hidden courses; reports per-course errors", async () => {
		const http = canvas();
		const client = new CanvasClient(() => "https://school.instructure.com", () => "tok", http.request);
		const store = new MemoryStore({ "Courses/CSCI 470.md": "# CSCI 470\n\nMy own intro.\n" });
		const report = await syncCanvas(client, store, settings, now);
		expect(report.error).toBeUndefined();
		expect(report.courses.map((c) => [c.vaultName, c.assignments, c.error === undefined])).toEqual([
			["CSCI 470", 1, true],
			["Linear Algebra", 0, false],
		]);
		expect(report.written.sort()).toEqual(["Courses/CSCI 470.md", "Courses/Linear Algebra.md", "Courses/This week.md", "Courses/deadlines.ics"]);
		const ml = store.files.get("Courses/CSCI 470.md")!;
		expect(ml).toContain("My own intro.");
		expect(ml).toContain("- [ ] HW 4 📅");
		expect(ml).toContain("### Exam moved (2026-11-01)\n\nTo Friday");
		expect(ml).toContain("Current: **90% · A-**");
		expect(store.files.get("Courses/Linear Algebra.md")).toContain("> [!warning] Assignments could not be read: Canvas refused the request (403)");
		expect(store.files.get("Courses/This week.md")).toContain("CSCI 470: HW 4");
		expect(store.files.get("Courses/deadlines.ics")).toContain("SUMMARY:CSCI 470: HW 4");
		expect(store.files.has("Courses/Orientation.md")).toBe(false);

		// Second sync with identical data: nothing is rewritten.
		const again = await syncCanvas(client, store, settings, now);
		expect(again.written).toEqual([]);
	});

	it("fails cleanly without credentials or when the course list is refused", async () => {
		const store = new MemoryStore();
		const unconfigured = new CanvasClient(() => "", () => "", new FakeHttp().request);
		expect((await syncCanvas(unconfigured, store, settings, now)).error).toMatch(/set the Canvas URL and access token/i);
		const http = new FakeHttp().on("/api/v1/courses", { errors: [{ message: "Invalid access token." }] }, { status: 401 });
		const client = new CanvasClient(() => "https://x", () => "bad", http.request);
		const report = await syncCanvas(client, store, settings, now);
		expect(report.error).toMatch(/rejected the access token/);
		expect(store.writes).toEqual([]);
	});

	it("keeps assignments when announcements fail", async () => {
		const http = canvas().on("/api/v1/announcements", { message: "nope" }, { status: 500 });
		const client = new CanvasClient(() => "https://x", () => "tok", http.request);
		const store = new MemoryStore();
		const report = await syncCanvas(client, store, settings, now);
		expect(report.courses[0].assignments).toBe(1);
		expect(report.courses[0].error).toMatch(/Announcements could not be read/);
	});
});

describe("idempotent sync", () => {
	const url = () => "https://school.instructure.com";

	it("writes identical notes on two runs with identical data and touches no file the second time", async () => {
		const http = canvas();
		const client = new CanvasClient(url, () => "tok", http.request);
		const store = new MemoryStore();
		await syncCanvas(client, store, settings, now);
		const first = new Map(store.files);
		expect(store.writes.length).toBe(4);
		store.writes = [];
		// An hour later, same day: DTSTAMP would differ, nothing a reader cares about has changed.
		const again = await syncCanvas(client, store, settings, new Date(now.getTime() + 3_600_000));
		expect(again.error).toBeUndefined();
		expect(store.writes).toEqual([]);
		expect(again.written).toEqual([]);
		expect(store.files).toEqual(first);
	});

	it("keeps the user's own text outside the managed blocks when assignments change, and rewrites only what changed", async () => {
		const http = canvas();
		const client = new CanvasClient(url, () => "tok", http.request);
		const store = new MemoryStore({
			"Courses/CSCI 470.md": "---\ntags: [course]\n---\n# CSCI 470\n\nProfessor: Dr. X. Office hours Tue 2pm.\n\n## My notes\n\n- Exam covers chapters 1–5.\n",
		});
		await syncCanvas(client, store, settings, now);
		const afterFirst = store.files.get("Courses/CSCI 470.md")!;
		expect(afterFirst.startsWith("---\ntags: [course]\n---\n# CSCI 470\n\nProfessor: Dr. X. Office hours Tue 2pm.\n")).toBe(true);
		expect(afterFirst).toContain("- [ ] HW 4 📅");
		expect(afterFirst.endsWith("## My notes\n\n- Exam covers chapters 1–5.\n")).toBe(true);
		// The user adds a line in their area; Canvas marks HW 4 submitted and adds HW 5.
		store.files.set("Courses/CSCI 470.md", afterFirst + "- Ask about the curve.\n");
		http.on("/api/v1/courses/1/assignments", [
			{ id: 10, name: "HW 4", due_at: "2026-11-10T06:59:00Z", points_possible: 10, html_url: "https://c/a/10", submission: { workflow_state: "graded", score: 10, submitted_at: "2026-11-08T00:00:00Z" } },
			{ id: 11, name: "HW 5", due_at: "2026-11-17T06:59:00Z", points_possible: 10, html_url: "https://c/a/11", submission: { workflow_state: "unsubmitted" } },
		]);
		store.writes = [];
		const report = await syncCanvas(client, store, settings, now);
		const afterSecond = store.files.get("Courses/CSCI 470.md")!;
		expect(afterSecond.startsWith("---\ntags: [course]\n---\n# CSCI 470\n\nProfessor: Dr. X. Office hours Tue 2pm.\n")).toBe(true);
		expect(afterSecond.endsWith("## My notes\n\n- Exam covers chapters 1–5.\n- Ask about the curve.\n")).toBe(true);
		expect(afterSecond).toContain("- [x] HW 4 📅");
		expect(afterSecond).toContain("- [ ] HW 5 📅");
		expect(afterSecond.match(/<!-- canvas-companion:assignments -->/g)).toHaveLength(1);
		// Linear Algebra did not change, so it was not rewritten.
		expect(report.written.sort()).toEqual(["Courses/CSCI 470.md", "Courses/This week.md", "Courses/deadlines.ics"]);
		expect(store.writes).not.toContain("Courses/Linear Algebra.md");
	});

	it("keeps a note's CRLF line endings instead of rewriting it to LF on every sync", async () => {
		const http = canvas();
		const client = new CanvasClient(url, () => "tok", http.request);
		const crlf = "# CSCI 470\r\n\r\nWritten on Windows.\r\n\r\n## My notes\r\n\r\nKeep me.\r\n";
		const store = new MemoryStore({ "Courses/CSCI 470.md": crlf });
		await syncCanvas(client, store, settings, now);
		const note = store.files.get("Courses/CSCI 470.md")!;
		expect(note).not.toMatch(/[^\r]\n/);
		expect(note).toContain("Written on Windows.\r\n");
		expect(note).toContain("- [ ] HW 4 📅");
		store.writes = [];
		await syncCanvas(client, store, settings, now);
		expect(store.writes).toEqual([]);
	});
});

describe("aliases and hidden courses", () => {
	it("maps by name or code, case-insensitively, and parses the settings text", () => {
		const aliases = parseAliases("Fall 2026 CSCI-470-A Machine Learning = CSCI 470\nmath-332=Linear Algebra\nno equals here\n = empty");
		expect(aliases).toEqual({ "Fall 2026 CSCI-470-A Machine Learning": "CSCI 470", "math-332": "Linear Algebra" });
		expect(vaultNameFor({ name: "fall 2026 csci-470-a machine learning", courseCode: "" }, aliases)).toBe("CSCI 470");
		expect(vaultNameFor({ name: "Whatever", courseCode: "MATH-332" }, aliases)).toBe("Linear Algebra");
		expect(vaultNameFor({ name: "Physics II", courseCode: "PHGN-200" }, aliases)).toBe("Physics II");
		expect(isHidden({ name: "Orientation", courseCode: "ORI" }, ["orientation"])).toBe(true);
		expect(isHidden({ name: "Physics", courseCode: "PHGN" }, ["phgn", ""])).toBe(true);
		expect(isHidden({ name: "Physics", courseCode: "PHGN" }, ["Chem"])).toBe(false);
	});
});
