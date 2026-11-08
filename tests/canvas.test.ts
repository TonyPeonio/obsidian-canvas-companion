import { describe, expect, it } from "vitest";
import { CanvasClient, CanvasError, nextLink } from "../src/core/canvas";
import { FakeHttp } from "./fakes";

function client(http: FakeHttp, token = "tok") {
	return new CanvasClient(() => "https://school.instructure.com/", () => token, http.request);
}

describe("CanvasClient", () => {
	it("lists active courses and follows Link pagination", async () => {
		const http = new FakeHttp();
		http.routes.set("/api/v1/courses", (opts) => {
			const page = new URL(opts.url).searchParams.get("page");
			if (page === "2") return { body: [{ id: 2, name: "Linear Algebra", course_code: "MATH-332" }] };
			return {
				body: 'while(1);[{"id":1,"name":"Machine Learning","course_code":"CSCI-470","term":{"name":"Fall 2026"}},{"id":9,"access_restricted_by_date":true}]',
				link: '<https://school.instructure.com/api/v1/courses?page=2&per_page=50>; rel="next", <https://school.instructure.com/api/v1/courses?page=1>; rel="first"',
			};
		});
		const courses = await client(http).listCourses();
		expect(courses).toEqual([
			{ id: 1, name: "Machine Learning", courseCode: "CSCI-470", term: "Fall 2026" },
			{ id: 2, name: "Linear Algebra", courseCode: "MATH-332", term: undefined },
		]);
		expect(http.calls[0].headers?.Authorization).toBe("Bearer tok");
		expect(http.calls[0].url).toContain("enrollment_state=active");
	});

	it("maps assignments with submission state", async () => {
		const http = new FakeHttp().on("/api/v1/courses/1/assignments", [
			{ id: 10, name: "HW 1", due_at: "2026-11-10T06:59:00Z", points_possible: 10, html_url: "https://c/a/10", submission: { workflow_state: "graded", score: 9, submitted_at: "2026-11-09T01:00:00Z" } },
			{ id: 11, name: "HW 2", due_at: "2026-11-17T06:59:00Z", points_possible: 10, html_url: "https://c/a/11", submission: { workflow_state: "unsubmitted", score: null, missing: true } },
			{ id: 12, name: "Reading", due_at: null, points_possible: null, html_url: "https://c/a/12", submission: { workflow_state: "submitted", submitted_at: "2026-11-01T00:00:00Z" } },
			{ id: 13, name: "Pending", due_at: null, html_url: "", submission: { workflow_state: "pending_review" } },
		]);
		const list = await client(http).listAssignments(1);
		expect(list.map((a) => [a.id, a.submitted, a.graded, a.score, a.missing, a.pointsPossible])).toEqual([
			[10, true, true, 9, false, 10],
			[11, false, false, null, true, 10],
			[12, true, false, null, false, null],
			[13, true, false, null, false, null],
		]);
		expect(http.calls[0].url).toContain("include%5B%5D=submission");
	});

	it("reads announcements for several courses and grades", async () => {
		const http = new FakeHttp()
			.on("/api/v1/announcements", [
				{ id: 5, context_code: "course_1", title: "Exam moved", message: "<p>To <b>Friday</b></p>", posted_at: "2026-11-01T12:00:00Z", html_url: "https://c/d/5" },
				{ id: 6, context_code: "course_2", title: "Welcome", message: "<p>Hi</p>", posted_at: "2026-11-03T12:00:00Z", html_url: "https://c/d/6" },
				{ id: 7, context_code: "group_3", title: "ignored" },
			])
			.on("/api/v1/courses/1/enrollments", [{ type: "TeacherEnrollment" }, { type: "StudentEnrollment", grades: { current_score: 91.25, current_grade: "A-" } }])
			.on("/api/v1/courses/2/enrollments", [{ type: "StudentEnrollment", grades: {} }]);
		const c = client(http);
		const ann = await c.listAnnouncements([1, 2], 10);
		expect(ann.map((a) => [a.id, a.courseId])).toEqual([
			[6, 2],
			[5, 1],
		]);
		expect(http.calls[0].url).toContain("context_codes%5B%5D=course_1");
		expect(await c.courseGrade(1)).toEqual({ score: 91.25, grade: "A-" });
		expect(await c.courseGrade(2)).toEqual({ score: null, grade: null });
		expect(await c.listAnnouncements([], 10)).toEqual([]);
	});

	it("explains token, permission and connection problems", async () => {
		const http = new FakeHttp().on("/api/v1/users/self", { errors: [{ message: "Invalid access token." }] }, { status: 401 }).on("/api/v1/courses/7/assignments", { message: "unauthorized" }, { status: 403 });
		const c = client(http);
		await expect(c.self()).rejects.toThrow(/rejected the access token \(401\).*Approved Integrations.*Invalid access token/);
		await expect(c.listAssignments(7)).rejects.toMatchObject({ status: 403 });
		await expect(client(http, "").self()).rejects.toThrow(/access token is not set/);
		const down = new CanvasClient(
			() => "https://x",
			() => "t",
			async () => {
				throw new Error("ECONNREFUSED");
			},
		);
		await expect(down.self()).rejects.toThrow(/Cannot reach Canvas at https:\/\/x: ECONNREFUSED/);
		expect(new CanvasClient(() => "", () => "", http.request).configured).toBe(false);
	});

	it("parses Link headers", () => {
		expect(nextLink('<https://a/b?page=2>; rel="next", <https://a/b?page=9>; rel="last"')).toBe("https://a/b?page=2");
		expect(nextLink('<https://a/b?page=9>; rel="last"')).toBeUndefined();
		expect(nextLink(undefined)).toBeUndefined();
		// Canvas puts rel="current" first and may carry commas inside a URL (bookmark cursors, list params).
		expect(nextLink('<https://a/b?page=bookmark:x,y&per_page=50>; rel="current",<https://a/b?page=bookmark:z,w&per_page=50>; rel="next"')).toBe("https://a/b?page=bookmark:z,w&per_page=50");
		expect(new CanvasError("x", 401).status).toBe(401);
	});
});
