import { describe, expect, it } from "vitest";
import { foldLine, renderIcs } from "../src/core/ics";
import type { Assignment, CourseData } from "../src/core/model";

const now = new Date("2026-11-07T18:00:00Z");

function assignment(over: Partial<Assignment>): Assignment {
	return { id: 1, courseId: 1, name: "HW", dueAt: null, pointsPossible: 10, htmlUrl: "https://c/a/1", submitted: false, graded: false, score: null, missing: false, late: false, ...over };
}

describe("renderIcs", () => {
	it("emits one UTC event per upcoming unsubmitted assignment, sorted, with escaping", () => {
		const data: CourseData = {
			course: { id: 1, name: "ML", courseCode: "" },
			assignments: [
				assignment({ id: 2, name: "HW 4; part 2, final", dueAt: "2026-11-20T06:59:00Z", pointsPossible: 12.5 }),
				assignment({ id: 3, name: "HW 2", dueAt: "2026-11-13T06:59:00Z", htmlUrl: "" }),
				assignment({ id: 4, name: "Old", dueAt: "2026-11-01T06:59:00Z" }),
				assignment({ id: 5, name: "Done", dueAt: "2026-11-25T06:59:00Z", submitted: true }),
				assignment({ id: 6, name: "Undated" }),
			],
			announcements: [],
			grade: { score: null, grade: null },
		};
		const ics = renderIcs([{ vaultName: "ML", data }], now);
		const lines = ics.split("\r\n");
		expect(lines[0]).toBe("BEGIN:VCALENDAR");
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(ics.indexOf("UID:canvas-assignment-3@")).toBeLessThan(ics.indexOf("UID:canvas-assignment-2@"));
		expect(ics).toContain("DTSTART:20261113T065900Z");
		expect(ics).toContain("SUMMARY:ML: HW 4\\; part 2\\, final");
		expect(ics).toContain("DESCRIPTION:12.5 points");
		expect(ics).toContain("DTSTAMP:20261107T180000Z");
		expect(ics).toContain("URL:https://c/a/1");
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
	});

	it("folds long lines at 75 octets with a continuation space", () => {
		const folded = foldLine("SUMMARY:" + "x".repeat(100));
		const parts = folded.split("\r\n");
		expect(parts).toHaveLength(2);
		expect(parts[0]).toHaveLength(75);
		expect(parts[1].startsWith(" ")).toBe(true);
		expect(foldLine("short")).toBe("short");
	});
});
