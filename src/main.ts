import { Notice, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { CanvasClient } from "./core/canvas";
import type { HttpRequest } from "./core/http";
import { parseAliases, syncCanvas, type NoteStore, type SyncReport } from "./core/sync";
import { DEFAULT_SETTINGS, type CanvasCompanionSettings } from "./settings";
import { CanvasCompanionSettingTab } from "./settings-tab";

export default class CanvasCompanionPlugin extends Plugin {
	settings: CanvasCompanionSettings = { ...DEFAULT_SETTINGS };
	canvas!: CanvasClient;
	private statusEl!: HTMLElement;
	private syncing = false;
	private timer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		const http: HttpRequest = async (opts) => {
			const res = await requestUrl({
				url: opts.url,
				method: opts.method ?? "GET",
				headers: opts.headers,
				body: opts.body,
				contentType: opts.contentType,
				throw: false,
			});
			return { status: res.status, headers: res.headers, text: res.text, arrayBuffer: res.arrayBuffer };
		};
		this.canvas = new CanvasClient(
			() => this.settings.canvasUrl,
			() => this.settings.canvasToken,
			http,
		);

		this.addSettingTab(new CanvasCompanionSettingTab(this.app, this));
		this.statusEl = this.addStatusBarItem();
		this.renderStatus();

		this.addRibbonIcon("graduation-cap", "Sync with Canvas", () => void this.sync(true));
		this.addCommand({ id: "sync", name: "Sync with Canvas", callback: () => void this.sync(true) });
		this.addCommand({
			id: "open-this-week",
			name: "Open this week",
			checkCallback: (checking) => {
				const path = normalizePath(this.settings.thisWeekPath);
				if (!path) return false;
				if (!checking) void this.app.workspace.openLinkText(path, "", false);
				return true;
			},
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup && this.canvas.configured) void this.sync(false);
			this.scheduleSync();
		});
	}

	onunload(): void {
		if (this.timer !== null) window.clearInterval(this.timer);
	}

	/** (Re)arms the periodic sync from the settings. */
	scheduleSync(): void {
		if (this.timer !== null) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
		const minutes = this.settings.syncIntervalMinutes;
		if (minutes <= 0) return;
		this.timer = window.setInterval(() => void this.sync(false), minutes * 60_000);
		this.registerInterval(this.timer);
	}

	/** Runs one sync; `verbose` reports the result in a Notice, quiet runs only report errors. */
	async sync(verbose: boolean): Promise<SyncReport | null> {
		if (this.syncing) {
			if (verbose) new Notice("Canvas sync is already running.");
			return null;
		}
		if (!this.canvas.configured) {
			new Notice("Canvas Companion: set the Canvas URL and access token in settings first.", 8000);
			return null;
		}
		this.syncing = true;
		this.statusEl.setText("Canvas: syncing…");
		try {
			const store = this.noteStore();
			const report = await syncCanvas(this.canvas, store, this.syncSettings(), new Date(), (s) => this.statusEl.setText(`Canvas: ${s}`));
			if (report.error) {
				new Notice(`Canvas sync failed: ${report.error}`, 12000);
				this.renderStatus();
				return report;
			}
			this.settings.lastSync = new Date().toISOString();
			await this.saveSettings();
			this.renderStatus();
			const problems = report.courses.filter((c) => c.error);
			if (verbose) {
				const n = report.courses.length;
				new Notice(`Canvas: synced ${n} course${n === 1 ? "" : "s"}, ${report.written.length} note${report.written.length === 1 ? "" : "s"} updated.${problems.length ? ` ${problems.length} with problems (see the course notes).` : ""}`, 6000);
			} else if (problems.length) {
				new Notice(`Canvas: ${problems.length} course${problems.length === 1 ? "" : "s"} could not be fully read; details are in the course notes.`, 8000);
			}
			return report;
		} catch (err) {
			new Notice(`Canvas sync failed: ${(err as Error).message}`, 12000);
			this.renderStatus();
			return null;
		} finally {
			this.syncing = false;
		}
	}

	private renderStatus(): void {
		const last = this.settings.lastSync ? new Date(this.settings.lastSync) : null;
		if (!last || Number.isNaN(last.getTime())) {
			this.statusEl.setText("Canvas: not synced");
			return;
		}
		const hh = String(last.getHours()).padStart(2, "0");
		const mm = String(last.getMinutes()).padStart(2, "0");
		const today = new Date().toDateString() === last.toDateString();
		this.statusEl.setText(`Canvas: synced ${today ? "" : last.toISOString().slice(5, 10) + " "}${hh}:${mm}`);
	}

	private syncSettings() {
		const s = this.settings;
		return {
			coursesFolder: s.coursesFolder,
			thisWeekPath: s.thisWeekPath,
			announcementsToKeep: s.announcementsToKeep,
			includePastDue: s.includePastDue,
			icsEnabled: s.icsEnabled,
			icsPath: s.icsPath,
			hiddenCourses: s.hiddenCourses.split("\n").map((l) => l.trim()).filter(Boolean),
			aliases: parseAliases(s.aliases),
		};
	}

	private noteStore(): NoteStore {
		return {
			read: async (path) => {
				const file = this.app.vault.getFileByPath(normalizePath(path));
				return file ? this.app.vault.read(file) : null;
			},
			write: async (path, content) => {
				const normalized = normalizePath(path);
				const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
				if (folder && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
				const existing = this.app.vault.getFileByPath(normalized);
				if (existing instanceof TFile) await this.app.vault.modify(existing, content);
				else await this.app.vault.create(normalized, content);
			},
		};
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<CanvasCompanionSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
