// The thin Obsidian layer: "Open this week" must open the note, or sync first when it is
// missing, or explain what to set up; it must never throw into the command palette.

import { Notice, TFile } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";
import { CanvasClient } from "../src/core/canvas";
import CanvasCompanionPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { FakeHttp } from "./fakes";

/** Just enough of `App` for the note store and for opening a file. */
function fakeApp(initial: Record<string, string> = {}) {
	const files = new Map<string, string>();
	for (const [k, v] of Object.entries(initial)) files.set(k, v);
	const folders = new Set<string>();
	const opened: string[] = [];
	const tfile = (path: string) => Object.assign(new TFile(), { path });
	const app = {
		vault: {
			getFileByPath: (p: string) => (files.has(p) ? tfile(p) : null),
			getFolderByPath: (p: string) => (folders.has(p) ? {} : null),
			createFolder: async (p: string) => void folders.add(p),
			create: async (p: string, content: string) => {
				files.set(p, content);
				return tfile(p);
			},
			modify: async (f: TFile, content: string) => void files.set(f.path, content),
			read: async (f: TFile) => files.get(f.path) ?? "",
		},
		workspace: {
			getLeaf: () => ({ openFile: async (f: TFile) => void opened.push(f.path) }),
		},
	};
	return { app, files, opened };
}

function canvasHttp(): FakeHttp {
	return new FakeHttp()
		.on("/api/v1/courses", [{ id: 1, name: "Machine Learning", course_code: "CSCI-470" }])
		.on("/api/v1/announcements", [])
		.on("/api/v1/courses/1/assignments", [{ id: 10, name: "HW 4", due_at: "2026-11-10T06:59:00Z", points_possible: 10, html_url: "https://c/a/10", submission: { workflow_state: "unsubmitted" } }])
		.on("/api/v1/courses/1/enrollments", []);
}

function plugin(http: FakeHttp, configured: boolean, initialFiles: Record<string, string> = {}) {
	const { app, files, opened } = fakeApp(initialFiles);
	const p = new CanvasCompanionPlugin() as CanvasCompanionPlugin & { app: typeof app; saveData: (d: unknown) => Promise<void>; statusEl: { setText(s: string): void } };
	p.app = app;
	p.saveData = async () => {};
	p.statusEl = { setText: () => {} };
	p.settings = { ...DEFAULT_SETTINGS, canvasUrl: configured ? "https://school.instructure.com" : "", canvasToken: configured ? "tok" : "" };
	p.canvas = new CanvasClient(
		() => p.settings.canvasUrl,
		() => p.settings.canvasToken,
		http.request,
	);
	return { p, files, opened, http };
}

beforeEach(() => {
	Notice.messages = [];
});

describe("Open this week", () => {
	it("opens the note when it exists without syncing", async () => {
		const { p, opened, http } = plugin(canvasHttp(), true, { "Courses/This week.md": "# This week\n" });
		await p.openThisWeek();
		expect(opened).toEqual(["Courses/This week.md"]);
		expect(http.calls).toEqual([]);
		expect(Notice.messages).toEqual([]);
	});

	it("syncs first when the note is missing, then opens it", async () => {
		const { p, files, opened, http } = plugin(canvasHttp(), true);
		await p.openThisWeek();
		expect(http.calls.length).toBeGreaterThan(0);
		expect(files.get("Courses/This week.md")).toContain("Machine Learning: HW 4");
		expect(files.has("Courses/Machine Learning.md")).toBe(true);
		expect(opened).toEqual(["Courses/This week.md"]);
		expect(Notice.messages.join("\n")).toMatch(/no This week note yet, syncing/);
	});

	it("explains what to configure when Canvas is not set up, and does not create an empty note", async () => {
		const { p, files, opened, http } = plugin(canvasHttp(), false);
		await p.openThisWeek();
		expect(opened).toEqual([]);
		expect(http.calls).toEqual([]);
		expect(files.size).toBe(0);
		expect(Notice.messages).toHaveLength(1);
		expect(Notice.messages[0]).toMatch(/Canvas URL and access token/);
		expect(Notice.messages[0]).toMatch(/Sync with Canvas/);
	});

	it("shows the sync error and opens nothing when the sync fails", async () => {
		const http = new FakeHttp().on("/api/v1/courses", { errors: [{ message: "Invalid access token." }] }, { status: 401 });
		const { p, files, opened } = plugin(http, true);
		await expect(p.openThisWeek()).resolves.toBeUndefined();
		expect(opened).toEqual([]);
		expect(files.size).toBe(0);
		expect(Notice.messages.some((m) => /invalid or expired/i.test(m) && /New Access Token/.test(m))).toBe(true);
	});

	it("points at the settings when no This week path is configured", async () => {
		const { p, opened, http } = plugin(canvasHttp(), true);
		p.settings.thisWeekPath = "   ";
		await p.openThisWeek();
		expect(opened).toEqual([]);
		expect(http.calls).toEqual([]);
		expect(Notice.messages).toEqual([expect.stringMatching(/no This week note is configured/) as string]);
	});

	it("never throws, even when opening the file fails", async () => {
		const { p } = plugin(canvasHttp(), true, { "Courses/This week.md": "# This week\n" });
		p.app.workspace.getLeaf = () => ({
			openFile: async () => {
				throw new Error("leaf is gone");
			},
		});
		await expect(p.openThisWeek()).resolves.toBeUndefined();
		expect(Notice.messages).toEqual([expect.stringMatching(/could not open the This week note: leaf is gone/) as string]);
	});
});
