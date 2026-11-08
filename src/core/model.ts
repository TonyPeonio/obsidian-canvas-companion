// Plain data the sync works with. No Obsidian types here.

export interface CanvasCourse {
	id: number;
	name: string;
	courseCode: string;
	term?: string;
}

export interface Assignment {
	id: number;
	courseId: number;
	name: string;
	/** ISO timestamp from Canvas, or null when the assignment has no due date. */
	dueAt: string | null;
	pointsPossible: number | null;
	htmlUrl: string;
	/** The student handed something in (or it was graded). */
	submitted: boolean;
	graded: boolean;
	score: number | null;
	/** Canvas marked the submission missing. */
	missing: boolean;
	/** Canvas marked the submission late (handed in after the due date). */
	late: boolean;
}

export interface Announcement {
	id: number;
	courseId: number;
	title: string;
	postedAt: string;
	/** Canvas gives the body as HTML. */
	html: string;
	url: string;
}

export interface CourseGrade {
	/** Current score in percent, e.g. 91.3, when Canvas shows one. */
	score: number | null;
	/** Letter grade when the course has a grading scheme. */
	grade: string | null;
}

/** Everything the sync fetched for one course; `error` when part of it was refused. */
export interface CourseData {
	course: CanvasCourse;
	assignments: Assignment[];
	announcements: Announcement[];
	grade: CourseGrade;
	error?: string;
}
