export interface CanvasCompanionSettings {
	canvasUrl: string;
	canvasToken: string;
	coursesFolder: string;
	thisWeekPath: string;
	syncOnStartup: boolean;
	/** Minutes between automatic syncs; 0 turns them off. */
	syncIntervalMinutes: number;
	announcementsToKeep: number;
	includePastDue: boolean;
	icsEnabled: boolean;
	icsPath: string;
	/** One Canvas course name or code per line. */
	hiddenCourses: string;
	/** "Canvas name = Vault name" per line. */
	aliases: string;
	lastSync: string;
}

export const DEFAULT_SETTINGS: CanvasCompanionSettings = {
	canvasUrl: "",
	canvasToken: "",
	coursesFolder: "Courses",
	thisWeekPath: "Courses/This week.md",
	syncOnStartup: true,
	syncIntervalMinutes: 60,
	announcementsToKeep: 10,
	includePastDue: true,
	icsEnabled: false,
	icsPath: "Courses/deadlines.ics",
	hiddenCourses: "",
	aliases: "",
	lastSync: "",
};
