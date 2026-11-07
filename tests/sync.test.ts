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
