import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CanvasCompanionPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

export class CanvasCompanionSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: CanvasCompanionPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		new Setting(containerEl).setName("Canvas").setHeading();

		new Setting(containerEl)
			.setName("Canvas URL")
			.setDesc("Your school's Canvas address, e.g. https://school.instructure.com")
			.addText((t) =>
				t.setPlaceholder("https://school.instructure.com").setValue(s.canvasUrl).onChange(async (v) => {
					s.canvasUrl = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Access token")
			.setDesc("In Canvas: Account → Settings → Approved Integrations → New Access Token. Stored only in this vault's plugin data.")
			.addText((t) => {
				t.setPlaceholder("paste token").setValue(s.canvasToken).onChange(async (v) => {
					s.canvasToken = v.trim();
					await save();
				});
				t.inputEl.type = "password";
				t.inputEl.autocomplete = "off";
			})
			.addButton((b) =>
				b.setButtonText("Test connection").onClick(async () => {
					try {
						const me = await this.plugin.canvas.self();
						const courses = await this.plugin.canvas.listCourses();
						new Notice(`Connected as ${me.name}: ${courses.length} active course${courses.length === 1 ? "" : "s"}.`, 8000);
					} catch (err) {
						new Notice(`Connection failed: ${(err as Error).message}`, 12000);
					}
				}),
			);

		new Setting(containerEl).setName("Notes").setHeading();

		new Setting(containerEl)
			.setName("Courses folder")
			.setDesc("One note per course is kept here. Your own text outside the managed blocks is preserved on every sync.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.coursesFolder).setValue(s.coursesFolder).onChange(async (v) => {
					s.coursesFolder = v.trim() || DEFAULT_SETTINGS.coursesFolder;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("This week note")
			.setDesc("Everything due in the next seven days across courses, regenerated on every sync. Leave empty to skip it.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.thisWeekPath).setValue(s.thisWeekPath).onChange(async (v) => {
					s.thisWeekPath = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Announcements to keep per course")
			.addSlider((sl) =>
				sl.setLimits(0, 30, 1).setValue(s.announcementsToKeep).onChange(async (v) => {
					s.announcementsToKeep = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Show past-due unsubmitted assignments")
			.setDesc("Off hides the Past due group in course notes (This week still lists overdue work).")
			.addToggle((t) =>
				t.setValue(s.includePastDue).onChange(async (v) => {
					s.includePastDue = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Hidden courses")
			.setDesc("Canvas course names or codes to leave out, one per line.")
			.addTextArea((t) => {
				t.setPlaceholder("PE 101\nOrientation").setValue(s.hiddenCourses).onChange(async (v) => {
					s.hiddenCourses = v;
					await save();
				});
				t.inputEl.rows = 3;
				t.inputEl.addClass("canvas-companion-textarea");
			});

		new Setting(containerEl)
			.setName("Course name aliases")
			.setDesc("Rename a course for the vault: one 'Canvas name = Vault name' per line. The Canvas course code works too.")
			.addTextArea((t) => {
				t.setPlaceholder("Fall 2026 CSCI-470-A Machine Learning = CSCI 470").setValue(s.aliases).onChange(async (v) => {
					s.aliases = v;
					await save();
				});
				t.inputEl.rows = 3;
				t.inputEl.addClass("canvas-companion-textarea");
			});

		new Setting(containerEl).setName("Sync").setHeading();

		new Setting(containerEl)
			.setName("Sync on startup")
			.addToggle((t) =>
				t.setValue(s.syncOnStartup).onChange(async (v) => {
					s.syncOnStartup = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Sync every (minutes)")
			.setDesc("0 turns automatic syncing off; the command and ribbon icon still work.")
			.addSlider((sl) =>
				sl.setLimits(0, 240, 15).setValue(s.syncIntervalMinutes).onChange(async (v) => {
					s.syncIntervalMinutes = v;
					await save();
					this.plugin.scheduleSync();
				}),
			);

		new Setting(containerEl).setName("Calendar feed").setHeading();

		new Setting(containerEl)
			.setName("Write an .ics file of upcoming deadlines")
			.setDesc("Subscribe to or import the file in a calendar app. Updated on every sync.")
			.addToggle((t) =>
				t.setValue(s.icsEnabled).onChange(async (v) => {
					s.icsEnabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Calendar file path")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.icsPath).setValue(s.icsPath).onChange(async (v) => {
					s.icsPath = v.trim() || DEFAULT_SETTINGS.icsPath;
					await save();
				}),
			);
	}
}
