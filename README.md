# Canvas Companion

An [Obsidian](https://obsidian.md) plugin that keeps your **Canvas LMS** assignments, due
dates, grades and announcements in your vault: one note per course, a **This week** note with
everything due in the next seven days, and an optional calendar feed. Nothing leaves your
machine except the requests to your school's Canvas.

- **One note per course.** `Courses/<Course>.md` with Upcoming, Past due and Done assignments
  as task lines (`- [ ] HW 4 📅 2026-11-12 ⏰ 23:59 (10 pts) [Canvas](…)`, the format the Tasks
  plugin reads), the latest announcements converted to markdown, and your current grade. The
  plugin only touches its own marked blocks; everything you write in the note stays.
- **This week.** Overdue work first, then one section per day across all courses. Regenerated
  on every sync.
- **Calendar feed.** An `.ics` file of upcoming deadlines you can import into or subscribe from
  a phone calendar.
- **Quiet.** Syncs on startup and on a timer; unchanged notes are not rewritten, so nothing
  churns in your sync tool or git history.
- Free and open source, MIT licensed. No accounts beyond your Canvas token, no telemetry.

Pairs with [Lecture Companion](https://github.com/TonyPeonio/obsidian-lecture-companion)
(record lectures, pull the day's slides, summarize locally) and
[Local Vault Agent](https://github.com/TonyPeonio/obsidian-local-vault-agent) (ask "what is due
this week in Machine Learning?" against the notes this plugin writes).

## Requirements

- Obsidian 1.7.2 or later (desktop and mobile).
- A **Canvas access token**. In Canvas: Account → Settings → Approved Integrations → *New Access
  Token*. Paste it into the plugin settings; it is stored in this vault's plugin data only.

## Usage

1. Settings → Canvas Companion: enter your Canvas URL (e.g. `https://school.instructure.com`)
   and the token. **Test connection** should name you and count your active courses.
2. Run **Sync with Canvas** (ribbon icon, command palette, or wait for the automatic sync).
3. Open `Courses/This week.md`, or any course note.

Hide courses you do not care about (one name or code per line) and rename courses for the vault
with aliases (`Fall 2026 CSCI-470-A Machine Learning = CSCI 470`), so the note is called what you
call the class and Lecture Companion's notes land in the same place.

### Commands

| Command | What it does |
|---|---|
| Sync with Canvas | Fetches courses, assignments, announcements and grades, and updates the notes |
| Open this week | Opens the This week note |

## How it works

Each sync lists your active courses (`/api/v1/courses`), then for each course reads the
assignments with your submission state, the recent announcements (one request for all courses)
and your enrollment's current score. Course notes are rendered into managed blocks bounded by
HTML comments:

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
text outside the blocks is never touched. A sync with unchanged data produces a byte-identical
file and skips the write. Dates are shown in your local time. A course whose assignments Canvas
hides from you (401/403) is kept with a warning line instead of failing the whole sync.

## Privacy and network use

The plugin talks only to the Canvas URL you set, with the token you pasted, using Obsidian's
`requestUrl`. It downloads nothing but JSON and writes only the notes and the `.ics` file
described above. No analytics, no third parties.

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm test        # unit tests (vitest), no Canvas needed
npm run build   # type-check + Obsidian review lint + production bundle
```

The core (`src/core/`) has no Obsidian dependency and is tested against an in-memory HTTP fake
and note store; `src/main.ts` and `src/settings-tab.ts` are the thin Obsidian layer. To release:
bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, write
`release-notes/<version>.md`, commit, push a tag named exactly `<version>`.

## License

MIT
