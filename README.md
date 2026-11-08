# Canvas Companion

An [Obsidian](https://obsidian.md) plugin that keeps your **Canvas LMS** assignments, due
dates, grades and announcements in your vault: one note per course, a **This week** note with
everything due in the next seven days, and an optional calendar feed. Nothing leaves your
machine except the requests to your school's Canvas.

- **One note per course.** `Courses/<Course>.md` with Upcoming, Past due and Done assignments
  as task lines (`- [ ] HW 4 📅 2026-11-12 ⏰ 23:59 (10 pts) [Canvas](…)`, the format the Tasks
  plugin reads; missing and late work is flagged `⚠️ missing` / `⚠️ late`), the latest
  announcements converted to markdown, and your current grade. The plugin only touches its own
  marked blocks; everything you write in the note stays.
- **This week.** Overdue work first, then one section per day across all courses. Regenerated
  on every sync.
- **Calendar feed.** An `.ics` file of upcoming deadlines you can import into or subscribe from
  a phone calendar.
- **Quiet.** Syncs when Obsidian starts and then every 60 minutes by default (settable from
  15 to 240 minutes, or off); unchanged notes are not rewritten, so nothing churns in your sync
  tool or git history.
- Free and open source, MIT licensed. No accounts beyond your Canvas token, no telemetry.

Canvas Companion is part of the Companion suite of local-first Obsidian plugins by Tony Peonio for
students and researchers: your machine does the work, every change is a diff you approve, and the
numbers are published. The others are Local Vault Agent (local Ollama agent that searches, compiles,
edits notes), Lecture Companion (live local lecture transcription, Canvas slides, Ollama summaries),
Exam Companion (day-by-day study plan, daily quizzes and flashcards), Paper Companion (Zotero search
by meaning, page-cited reading notes), Research Log Companion (append-only lab notebook with git,
parameters, data hashes), Meeting Companion (local meeting transcription, decisions, action items,
weekly digest), Job Hunt Companion (job applications as notes, resume tailoring, interview
questions), Fellowship Companion (grants and fellowships: deadlines, materials, letters,
eligibility), Code Companion (commits in the daily note, weekly report, TODOs), Teaching Companion
(local-model rubric grading with verbatim evidence) and Branching Table of Contents (parent/child
properties as a rooted family tree). All at [github.com/TonyPeonio](https://github.com/TonyPeonio).

Each works on its own; Canvas Companion and Lecture Companion use the same `Courses/<Course>.md`
note names, so Lecture Companion's notes land next to the assignments for that course.

## Requirements

- Obsidian 1.7.2 or later (desktop and mobile).
- A Canvas account at a school that has not disabled personal access tokens, and the token
  itself (next section).

## Creating a Canvas access token

The plugin signs in with a personal access token, never with your password.

1. Log in to Canvas in a browser and click **Account** (your avatar, top of the left sidebar),
   then **Settings**.
2. Scroll to **Approved Integrations** and click **+ New Access Token**.
3. Give it a purpose (e.g. `Obsidian Canvas Companion`). Leave the expiry empty for a token that
   does not expire, or set a date; the plugin tells you when a token has expired.
4. Click **Generate Token** and copy the token now; Canvas shows it only once.
5. In Obsidian: Settings → Canvas Companion, enter your Canvas URL (e.g.
   `https://school.instructure.com`) and paste the token. **Test connection** should name you
   and count your active courses.

The token is stored only in this vault's `.obsidian/plugins/canvas-companion/data.json`
(exclude that file from anything you publish). To revoke it, delete it from the same Approved
Integrations list in Canvas. If your school's Canvas has no **+ New Access Token** button, the
administrators have turned personal tokens off and the plugin cannot be used there.

## Usage

1. Run **Sync with Canvas** (ribbon icon, command palette, or wait for the automatic sync).
2. Open `Courses/This week.md` with **Open this week**, or open any course note. If the note
   does not exist yet, **Open this week** syncs first and then opens it.

Hide courses you do not care about (one name or code per line) and rename courses for the vault
with aliases (`Fall 2026 CSCI-470-A Machine Learning = CSCI 470`), so the note is called what you
call the class and Lecture Companion's notes land in the same place.

### Commands

| Command | What it does |
|---|---|
| Sync with Canvas | Fetches courses, assignments, announcements and grades, and updates the notes |
| Open this week | Opens the This week note; syncs first if it does not exist yet |

## How it works

### What the plugin reads

Every request is a read-only `GET` to your Canvas, with the token in the `Authorization`
header. The plugin never creates, changes or submits anything in Canvas.

| Endpoint | Used for |
|---|---|
| `GET /api/v1/users/self` | Test connection: your name |
| `GET /api/v1/courses?enrollment_state=active&include[]=term` | Your active courses |
| `GET /api/v1/courses/:id/assignments?include[]=submission` | Assignments with your submission state (submitted, graded, score, late, missing) |
| `GET /api/v1/announcements?context_codes[]=course_:id` | Recent announcements, one request for all courses (falls back to one per course when Canvas refuses the combined request) |
| `GET /api/v1/courses/:id/enrollments?user_id=self` | Your current score and letter grade |

Paginated lists are followed through Canvas's `Link: rel="next"` headers (up to 20 pages of 50
per list).

### When it syncs

- Once when Obsidian starts (**Sync on startup**, on by default).
- Every 60 minutes while Obsidian is open (**Sync every**, 15 to 240 minutes, or 0 for off).
- Whenever you run **Sync with Canvas**, or **Open this week** finds no note yet.

Only one sync runs at a time; the status bar shows progress and the time of the last sync.

### What it writes

Course notes are rendered into managed blocks bounded by HTML comments:

```markdown
# CSCI 470

<!-- canvas-companion:assignments -->
## Assignments
…
<!-- /canvas-companion -->
<!-- canvas-companion:announcements -->
…
<!-- /canvas-companion -->

## My notes

Anything you write here survives every sync.
```

A block already in the note is replaced in place; a missing block is added before *My notes*;
text outside the blocks (front matter included) is never touched, and a note kept in CRLF stays
CRLF. A sync with unchanged data produces a byte-identical file and skips the write. Dates are
shown in your local time. A course whose assignments or announcements Canvas hides from you
(401/403) is kept with a warning line instead of failing the whole sync; an invalid or expired
token stops the sync with a message that says how to make a new one.

The `.ics` file holds one UTC event per upcoming, unsubmitted assignment with a due date
(`DTSTART` at the due time, a stable `UID` per assignment, the course and points in the
description, the Canvas link as `URL`), folded and escaped per RFC 5545.

## Privacy and network use

The plugin talks only to the Canvas URL you set, with the token you pasted, using Obsidian's
`requestUrl`, and only through the read-only endpoints listed above. It downloads nothing but
JSON and writes only the notes and the `.ics` file described above. No analytics, no third
parties.

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm test        # unit tests (vitest), no Canvas needed
npm run build   # type-check + Obsidian review lint + production bundle
```

The core (`src/core/`) has no Obsidian dependency and is tested against an in-memory HTTP fake,
an in-process mock Canvas HTTP server (`tests/canvas-server.test.ts`) and an in-memory note
store; `src/main.ts` and `src/settings-tab.ts` are the thin Obsidian layer. To release:
bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, write
`release-notes/<version>.md`, commit, push a tag named exactly `<version>`.

## License

MIT
