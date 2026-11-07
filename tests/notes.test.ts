import { describe, expect, it } from "vitest";
import { localDate, localTime } from "../src/core/dates";
import type { Assignment, CourseData } from "../src/core/model";
import { MARK_END, bucketOf, markStart, mergeManaged, renderCourseSections, renderThisWeek, safeFileName, taskLine } from "../src/core/notes";

const now = new Date("2026-11-07T18:00:00Z");
const iso = (d: Date) => d.toISOString();

function assignment(over: Partial<Assignment>): Assignment {
	return { id: 1, courseId: 1, name: "HW", dueAt: null, pointsPossible: 10, htmlUrl: "https://c/a/1", submitted: false, graded: false, score: null, missing: false, ...over };
}

function course(assignments: Assignment[], over: Partial<CourseData> = {}): CourseData {
	return { course: { id: 1, name: "Machine Learning", courseCode: "CSCI-470" }, assignments, announcements: [], grade: { score: null, grade: null }, ...over };
}

describe("task lines and buckets", () => {
	it("formats due dates in local time and marks submitted work", () => {
		const due = new Date(now.getTime() + 86_400_000);
		const line = taskLine(assignment({ name: "HW 3", dueAt: iso(due) }));
		expect(line).toBe(`- [ ] HW 3 📅 ${localDate(due)} ⏰ ${localTime(due)} (10 pts) [Canvas](https://c/a/1)`);
		expect(taskLine(assignment({ submitted: true, graded: true, score: 8.5, dueAt: iso(due) }), { withCourse: "ML" })).toMatch(/^- \[x\] ML: HW 📅 .* \(8\.5\/10 pts\) \[Canvas\]/);
		expect(taskLine(assignment({ missing: true, htmlUrl: "", pointsPossible: null }))).toBe("- [ ] HW ⚠️ missing");
	});

	it("buckets by submission and due date", () => {
		expect(bucketOf(assignment({ submitted: true }), now)).toBe("done");
		expect(bucketOf(assignment({ dueAt: "2026-11-01T00:00:00Z" }), now)).toBe("pastDue");
		expect(bucketOf(assignment({ dueAt: "2026-11-20T00:00:00Z" }), now)).toBe("upcoming");
		expect(bucketOf(assignment({}), now)).toBe("undated");
	});
});

describe("course note rendering", () => {
	const data = course(
		[
			assignment({ id: 1, name: "Late HW", dueAt: "2026-11-01T06:59:00Z" }),
			assignment({ id: 2, name: "HW 4", dueAt: "2026-11-20T06:59:00Z" }),
			assignment({ id: 3, name: "HW 2", dueAt: "2026-11-13T06:59:00Z" }),
			assignment({ id: 4, name: "HW 1", dueAt: "2026-10-20T06:59:00Z", submitted: true, graded: true, score: 10 }),
			assignment({ id: 5, name: "Survey" }),
		],
		{ announcements: [{ id: 9, courseId: 1, title: "Welcome", postedAt: "2026-11-02T12:00:00Z", html: "<p>Hello <b>all</b></p>", url: "https://c/d/9" }], grade: { score: 93.333, grade: "A" } },
	);

	it("groups and sorts assignments, renders announcements and the grade", () => {
		const s = renderCourseSections(data, { now, announcementsToKeep: 10, includePastDue: true });
		const order = (txt: string) => [...txt.matchAll(/- \[[ x]\] ([^📅\n]+?)(?: 📅|$| \()/gm)].map((m) => m[1].trim());
		expect(s.assignments).toContain("### Upcoming");
		expect(order(s.assignments.split("### Upcoming")[1].split("###")[0])).toEqual(["HW 2", "HW 4", "Survey"]);
		expect(s.assignments).toContain("### Past due\n\n- [ ] Late HW");
		expect(s.assignments).toContain("### Done\n\n- [x] HW 1");
		expect(s.announcements).toBe("## Announcements\n\n### Welcome (2026-11-02)\n\nHello **all**\n\n[Open in Canvas](https://c/d/9)");
		expect(s.grade).toBe("## Grade\n\nCurrent: **93.33% · A**");
		const noPast = renderCourseSections(data, { now, announcementsToKeep: 0, includePastDue: false });
		expect(noPast.assignments).not.toContain("Past due");
		expect(noPast.announcements).toBe("## Announcements\n\nNo announcements.");
		expect(renderCourseSections(course([], { error: "Assignments could not be read: 403" }), { now, announcementsToKeep: 5, includePastDue: true }).assignments).toContain("> [!warning] Assignments could not be read: 403");
	});

	it("creates a fresh note with managed blocks and a My notes area", () => {
		const note = mergeManaged(null, "Machine Learning", { assignments: "## Assignments\n\n- [ ] x", grade: "## Grade\n\nCurrent: **90%**" });
		expect(note).toBe(`# Machine Learning\n\n${markStart("assignments")}\n## Assignments\n\n- [ ] x\n${MARK_END}\n${markStart("grade")}\n## Grade\n\nCurrent: **90%**\n${MARK_END}\n\n## My notes\n`);
	});

	it("replaces blocks in place, keeps user text, appends new blocks before My notes, and is idempotent", () => {
		const first = mergeManaged(null, "ML", { assignments: "## Assignments\n\n- [ ] x" });
		const edited = first.replace("## My notes\n", "## My notes\n\nRemember the curve.\n") + "\nTrailing thoughts.\n";
		const second = mergeManaged(edited, "ML", { assignments: "## Assignments\n\n- [x] x", grade: "## Grade\n\nCurrent: **88%**" });
		expect(second).toContain("- [x] x");
		expect(second).not.toContain("- [ ] x");
		expect(second).toContain("Remember the curve.");
		expect(second).toContain("Trailing thoughts.");
		expect(second.indexOf(markStart("grade"))).toBeLessThan(second.indexOf("## My notes"));
		const third = mergeManaged(second, "ML", { assignments: "## Assignments\n\n- [x] x", grade: "## Grade\n\nCurrent: **88%**" });
		expect(third).toBe(second);
	});

	it("appends blocks at the end when the note has no My notes heading", () => {
		const out = mergeManaged("# Course\n\nJust my text.\n", "Course", { assignments: "## Assignments\n\n- [ ] a" });
		expect(out).toBe(`# Course\n\nJust my text.\n\n${markStart("assignments")}\n## Assignments\n\n- [ ] a\n${MARK_END}\n`);
	});
});

describe("This week", () => {
	it("lists overdue first, then one section per day across a week boundary, course-prefixed", () => {
		const day = (offset: number, hour = 23) => {
			const d = new Date(now);
			d.setDate(d.getDate() + offset);
			d.setHours(hour, 59, 0, 0);
			return d;
		};
		const ml = course([assignment({ id: 1, name: "HW 4", dueAt: iso(day(1)) }), assignment({ id: 2, name: "Late", dueAt: iso(day(-3)) }), assignment({ id: 3, name: "Far", dueAt: iso(day(9)) }), assignment({ id: 4, name: "Done", dueAt: iso(day(2)), submitted: true })]);
		const la = course([assignment({ id: 5, courseId: 2, name: "Problem set", dueAt: iso(day(6)) }), assignment({ id: 6, courseId: 2, name: "Today thing", dueAt: iso(day(0)) })], { course: { id: 2, name: "Linear Algebra", courseCode: "" } });
		const md = renderThisWeek(
			[
				{ vaultName: "ML", data: ml },
				{ vaultName: "LA", data: la },
			],
			now,
		);
		expect(md.startsWith("# This week\n\n## Overdue\n\n- [ ] ML: Late")).toBe(true);
		const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
		expect(headings[0]).toBe("Overdue");
		expect(headings[1]).toMatch(/^Today, /);
		expect(headings[2]).toMatch(/^Tomorrow, /);
		expect(headings).toHaveLength(4);
		expect(md).toContain("LA: Problem set");
		expect(md).not.toContain("Far");
		expect(md).not.toContain("Done");
		expect(renderThisWeek([], now)).toBe("# This week\n\nNothing due in the next 7 days.\n");
	});
});

describe("safeFileName", () => {
	it("strips characters Obsidian rejects", () => {
		expect(safeFileName('Fall 2026: CSCI-470/A "ML" #1')).toBe("Fall 2026- CSCI-470-A -ML- -1");
		expect(safeFileName("   ")).toBe("Course");
	});
});
