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
		expect(ics).toContain("12.5 points");
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
		expect(foldLine("y".repeat(75))).toBe("y".repeat(75));
	});
});

/** The content lines of an iCalendar text, with RFC 5545 folding undone. */
function unfold(ics: string): string[] {
	return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter((l) => l !== "");
}

const octets = (s: string) => new TextEncoder().encode(s).length;

describe("renderIcs is valid RFC 5545", () => {
	const longName = "Project milestone 3: literature review, annotated bibliography; and a draft outline of chapters 1–3 (please read the rubric)";
	const data: CourseData = {
		course: { id: 7, name: "Fall 2026, CSCI-470; ML", courseCode: "" },
		assignments: [
			assignment({ id: 21, name: longName, dueAt: "2026-11-20T06:59:00Z", pointsPossible: 100, htmlUrl: "https://school.instructure.com/courses/7/assignments/21" }),
			assignment({ id: 22, name: "Back\\slash, semi;colon\nsecond line", dueAt: "2026-11-15T23:59:59Z", pointsPossible: null }),
			assignment({ id: 23, name: "Émoji 🎓 ünïcödé " + "ö".repeat(60), dueAt: "2026-12-01T05:00:00Z" }),
		],
		announcements: [],
		grade: { score: null, grade: null },
	};
	const ics = renderIcs([{ vaultName: "Fall 2026, CSCI-470; ML", data }], now);

	it("uses CRLF line endings only", () => {
		expect(ics).not.toMatch(/[^\r]\n/);
		expect(ics).not.toMatch(/\r[^\n]/);
		expect(ics.endsWith("\r\n")).toBe(true);
	});

	it("folds every physical line to at most 75 octets with CRLF + a single space, and unfolds back", () => {
		const physical = ics.split("\r\n");
		physical.pop(); // trailing terminator
		for (const line of physical) expect(octets(line), line).toBeLessThanOrEqual(75);
		expect(physical.some((l) => l.startsWith(" "))).toBe(true);
		expect(physical.some((l) => l.startsWith("\t"))).toBe(false);
		const logical = unfold(ics);
		expect(logical.find((l) => l.startsWith("SUMMARY:") && l.includes("Project milestone 3"))).toBe("SUMMARY:Fall 2026\\, CSCI-470\\; ML: Project milestone 3: literature review\\, annotated bibliography\\; and a draft outline of chapters 1–3 (please read the rubric)");
		// Multi-byte characters are never split across a fold.
		const unicode = logical.find((l) => l.includes("Émoji"))!;
		expect(unicode).toContain("Émoji 🎓 ünïcödé " + "ö".repeat(60));
	});

	it("escapes backslashes, semicolons, commas and newlines in SUMMARY and DESCRIPTION", () => {
		const logical = unfold(ics);
		const summary = logical.find((l) => l.startsWith("SUMMARY:") && l.includes("Back"))!;
		expect(summary).toBe("SUMMARY:Fall 2026\\, CSCI-470\\; ML: Back\\\\slash\\, semi\\;colon\\nsecond line");
		const descriptions = logical.filter((l) => l.startsWith("DESCRIPTION:"));
		expect(descriptions.length).toBe(3);
		for (const d of descriptions) {
			// Only escaped specials remain: no bare ; , or backslash.
			expect(d.replace(/\\[\\;,nN]/g, "")).not.toMatch(/[;,\\]/);
		}
		expect(descriptions.some((d) => d.includes("Fall 2026\\, CSCI-470\\; ML"))).toBe(true);
		expect(descriptions.some((d) => d.includes("100 points"))).toBe(true);
	});

	it("gives each assignment a stable UID that survives renames and re-renders", () => {
		const uids = unfold(ics).filter((l) => l.startsWith("UID:"));
		expect(uids).toHaveLength(3);
		expect(new Set(uids).size).toBe(3);
		const again = renderIcs([{ vaultName: "Fall 2026, CSCI-470; ML", data }], new Date(now.getTime() + 3_600_000));
		expect(unfold(again).filter((l) => l.startsWith("UID:"))).toEqual(uids);
		const renamed = { ...data, assignments: data.assignments.map((a) => ({ ...a, name: a.name + " (v2)" })) };
		expect(unfold(renderIcs([{ vaultName: "Other", data: renamed }], now)).filter((l) => l.startsWith("UID:"))).toEqual(uids);
		for (const uid of uids) expect(uid).toMatch(/^UID:[A-Za-z0-9@._-]+$/);
	});

	it("has DTSTAMP and a UTC DTSTART for every event, no VTIMEZONE, and no DTEND equal to DTSTART", () => {
		const logical = unfold(ics);
		const events = logical.join("\n").split("BEGIN:VEVENT").slice(1);
		expect(events).toHaveLength(3);
		for (const ev of events) {
			const lines = ev.split("\n");
			const stamp = lines.find((l) => l.startsWith("DTSTAMP:"))!;
			const start = lines.find((l) => l.startsWith("DTSTART"))!;
			expect(stamp).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
			expect(start).toMatch(/^DTSTART(;VALUE=DATE:\d{8}|:\d{8}T\d{6}Z)$/);
			const end = lines.find((l) => l.startsWith("DTEND"));
			// RFC 5545 §3.8.2.2: DTEND must be later than DTSTART; a deadline is a point in time, so omit it.
			if (end) expect(end.slice(end.indexOf(":") + 1) > start.slice(start.indexOf(":") + 1), `${start} / ${end}`).toBe(true);
			expect(lines.filter((l) => /^(DTSTAMP|DTSTART|UID|SUMMARY):/.test(l))).toHaveLength(4);
		}
		expect(ics).not.toContain("VTIMEZONE");
		expect(ics).not.toMatch(/TZID/);
		// due_at 2026-11-15T23:59:59Z stays 23:59:59 UTC, not local.
		expect(logical).toContain("DTSTART:20261115T235959Z");
		expect(logical).toContain("DTSTART:20261201T050000Z");
		expect(logical).toContain("DTSTAMP:20261107T180000Z");
		expect(logical[0]).toBe("BEGIN:VCALENDAR");
		expect(logical).toContain("VERSION:2.0");
		expect(logical.some((l) => l.startsWith("PRODID:"))).toBe(true);
		expect(logical[logical.length - 1]).toBe("END:VCALENDAR");
	});
});
