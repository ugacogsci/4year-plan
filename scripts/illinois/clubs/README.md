# Club recommendations: the data pipeline

These scripts turn Illinois's student-organization directory into
`public/illinois/clubs.json`, the file behind the rail's "Clubs for your
goals" section and ALMA's `find_clubs` tool. The matcher that reads it is
`lib/planner/clubs.ts`. The design is
`clubs-design/DESIGN.md` (kept outside the repo, in the owner's Claude project
folder).

Everything runs by hand. Nothing is scheduled, and nothing here spends model
tokens except the optional reading pass (`READING.md`).

## How to run it

Use Node 23 (`export PATH=/opt/homebrew/bin:$PATH`). Each script restarts
itself with `--experimental-strip-types` when it needs the planner's
TypeScript, so a plain `node` command works.

1. **Crawl:** `node scripts/illinois/clubs/crawl.mjs`
   - Reads the directory page and the events feed (see Sources), scrubs them
     in memory, and writes `data/clubs/directory.json`, `texts.jsonl` and,
     when the feed was read, `events.json`.
   - `--offline` re-parses the scrubbed copies in `data/clubs/raw/` with no
     network at all. Use it whenever you only changed parsing.
   - `--accept-drop` lets the group count move more than 15% from the last
     parse. Use it only when you have checked that the drop is real, such as
     just after the June registration cutoff.
   - If the count guard fails, nothing is overwritten and the scrubbed page
     is set aside as `*.rejected.html`.
2. **Tag:** `node scripts/illinois/clubs/tag.mjs` (add `--quiet` to skip the
   per-goal table)
   - Applies the hand-checked tables and the name rules, and writes
     `data/clubs/tagged.json`.
   - It prints every curated-list name with no directory match, and every
     alias, national row or override whose club was renamed or is gone.
     Read those warnings after every crawl.
3. **Reading pass (optional; needs the owner's go-ahead):** see `READING.md`.
   It has not been run yet. Without it, no club has a `does` line and kinds
   come from names, categories and the tables.
4. **Build:** `node scripts/illinois/clubs/build.mjs` (`--dry-run` first if
   you like)
   - Writes `public/illinois/clubs.json` and prints the counts.
   - It never empties or wipes the file. A missing input, a failed guard,
     a privacy-guard hit or a drop of more than 15% leaves the old file in
     place.
5. **Check:**
   `node lib/planner/__clubs.check.mjs` (about a second; `-v` prints every
   pick for every practice student)
   - Also run the other four checks:
     - `__clubs-parse.check.mjs`
     - `__clubs-tag.check.mjs`
     - `__clubs-build.check.mjs`
     - `__clubs-match.check.mjs`
   - Each exits non-zero on any failure.

Steps 1 and 2 must run in order. A change to a table needs only steps 2, 4
and 5, and makes no network request.

## The files

| File | What it is |
|---|---|
| `crawl.mjs` | The polite fetcher, and `--offline` re-parse. |
| `parse.mjs` | Scrubs the page in memory, reads every group, applies the count guard, scrubs and joins the feed. |
| `tag.mjs` | Goals, kind, audience, identity, subjects, colleges and lists for every group. |
| `lists.json` | University lists that name clubs for a goal, a college or a subject (names only). |
| `aliases.json` | Each list name joined by hand to a directory id, or `null` with a note. |
| `nationals.json` | National societies and their subjects, goals and kinds. Each row was checked against the one group it matches. |
| `overrides.json` | Hand-checked corrections by directory id. Every row says why in `note`. |
| `batches.mjs`, `store-facts.mjs`, `READING.md` | The reading pass: batches in, checked facts out to `facts.json`. |
| `build.mjs` | Joins everything, applies the filters and the 120-day grace window, runs the privacy guard, and writes the public file. |
| `guard.mjs` | The privacy and 8-word copy rules, shared by `build.mjs` and `store-facts.mjs`. |
| `data/clubs/` | Raw scrubbed copies, the fetch log, the parsed and tagged data, and the clubs' own text. It is git-ignored by its own `.gitignore` (`*`) and stays on this machine. |

### Fixing a club by hand

Add a row to `overrides.json`, keyed by the club's directory id (the number in
`cb_club_<id>`, which `tagged.json` shows as `id`). Then re-run steps 2, 4 and 5.

A row may set any of these fields:
- `audience`: `undergrad`, `both`, `check`, `grad`, `law`, `med` or `vet`.
  The last four drop the club from the file.
- `kind`
- `identity` (true or false)
- `goalsAdd` and `goalsRemove`: CAREER_TRACKS or INTEREST_TOPICS ids.
- `subjectsAdd`: course prefixes, for a team about the major whose name does
  not say so, such as Steel Bridge for CEE.
- `hide`
- `starter`

Every row needs `name` (the directory's name, so a rename shows up as a
warning) and `note`.

Write the note in your own words: say what the club's page says, never quote
it. `tag.mjs` refuses any goal id the planner does not have, any subject that
is not a course prefix, and any field it does not know.

## Sources

**The directory: OneIllinois** (CampusGroups), https://one.illinois.edu/club_signup.
- Illinois Engage is retired: its pages return 404. Do not use it.
- One request reads every group: `GET https://one.illinois.edu/club_signup?view=all&`
  (about 6.8 MB).
- The page states its own total three ways: the header count, the "All"
  badge and the sum of the type badges. The parse must match them.
- On 2026-10-04:
  - 1,197 groups on the page, and 1,197 parsed;
  - 46 of them are office accounts, which are dropped;
  - 86 are for students already in graduate, law, medical or veterinary
    school, which are dropped;
  - **1,065 shipped**.

**The events feed:**
`https://one.illinois.edu/ical/urbanachampaign/ical_urbanachampaign.ics`
- It redirects to the same path on `static-prod-us-east-1.campusgroups.com`.
- **Not read yet.** That host's `/robots.txt` answered 403 on 2026-10-04.
  The house rule, shared with the syllabus fetcher, reads any answer other
  than 200, 404 or 410 as "disallow everything", so `crawl.mjs` refused the
  feed.
- Until the owner decides otherwise:
  - the file has `calendar: null`;
  - no event dates ship;
  - no club is ranked down for having no events;
  - 76 shipped clubs link to their own website rather than a OneIllinois
    profile.

**Curated lists** (`lists.json`, read 2026-10-04):

| id | Page | Names | Counts as |
|---|---|---|---|
| `prelaw-2025-26` | https://publish.illinois.edu/prelawadvising/2025/09/10/2025-2026-pre-law-student-orgs/ | 16 (14 matched) | the pre-law goal |
| `engineering-council` | https://www.ecillinois.org/affiliated-societies | 85 (77 matched) | the engineering college |
| `gies-cop` | https://giesgroups.illinois.edu/cop/organizations/ | 30 (26 matched) | the business college |
| `siebel` | https://siebelschool.illinois.edu/student-life/student-organizations | 9 computing groups (5 matched) | the CS subject |

**Not used:**
- `ahs.illinois.edu/node/84` (404);
- the second CampusGroups site at `giesgroups.illinois.edu/club_signup`;
- `grainger.illinois.edu/students/communities`.

## When to refresh

Refresh the directory:
- before each deploy;
- on **Jun 2** and **Dec 17**, just after the Orange and Blue registration
  cutoffs. These dates come from a search snippet, so confirm them by
  comparing the counts on either side of Jun 1.
- in **early September**, when clubs re-register around Quad Day;
- **at least every 120 days**. After 120 days `__clubs.check.mjs` fails, and
  the rail's footer turns amber ("may be out of date").

A club that leaves the directory stays in the file for 120 days after it was
last seen, with a dated note. Many groups miss a registration cutoff and come
back.

Refresh the lists by hand, then fix `aliases.json` for any new or renamed
names:
- the pre-law list **each September**: Pre-Law Advising posts a new list every
  fall, so change its id, URL and dates;
- Engineering Council, the Gies Council of Presidents and the Siebel page
  **each semester**.

## Politeness and privacy rules

These are hard rules, not preferences.

**Politeness:**
- Only the house agent, `TruBot/1.0 (+https://trumizzou.com; student project;
  respects robots.txt)`, imported from `scripts/illinois/syllabi/lib/paths.mjs`.
- robots.txt is read first for every host, with the syllabus fetcher's
  `parseRobots` and `decide`. Any path it disallows is refused.
- One request at a time, at least 1.1 s apart (longer when a host's
  robots.txt sets a Crawl-delay), with no cookies and `redirect: 'manual'`.
  - The only redirect followed is the feed's.
  - A login or Shibboleth redirect ends the run.
  - A 403 ends the run.
  - A 429 or 5xx is retried once.
- A run is the page plus, once allowed, the feed's two hops. robots.txt is
  added when the cached copy is older than a day.
- Every request and every cache read is a line in `data/clubs/fetchlog.jsonl`.
- **Never fetched:**
  - `/events` (it needs a login);
  - group home pages (one request per group, and they show officer names);
  - `/upload/` logos;
  - message links;
  - `/mobile_ws/`.

**Privacy:**
- The page shows student contact names. The page is scrubbed in memory before
  anything is written: contact blocks and names, `uid=` values, message links,
  logos, scripts, the form token, emails and phone numbers are all dropped.
  The parse refuses to write if any of them survive. The unscrubbed page never
  touches the disk.
- From the feed, only the organizer's group name, the group slug, the start
  date and the event type are kept. Titles, descriptions and locations are
  dropped.
- The clubs' own mission and benefits text stays in `data/clubs/` (git-ignored).
  It is read only to settle who a club is for, for the reading pass, and for
  the copy rule.
- `public/illinois/clubs.json` ships only facts and our own words: names,
  directory categories, links, ids, dates and tags. It never holds a contact
  name, a uid, an email or a club's own prose.
- `build.mjs` refuses to write the file if:
  - a field is not on the whitelist;
  - any string looks like an email address, a phone number, `uid=`,
    `send_message`, `mailto:` or `tel:`;
  - any string runs 8 words together from a club's own text (names aside);
  - a `does` line is over 20 words.
- `__clubs.check.mjs` checks the shipped file for the same leaks again.
- The pre-law page lists group email addresses. `lists.json` keeps the names
  only.
- `facts.json`, once the reading pass runs, is committed. It holds our words
  and ids, never the clubs' text.
- The CampusGroups terms forbid reusing posted content for commercial
  purposes. Facts, links and our own one-liners keep clear of that. If the
  planner ever becomes commercial, the owner should ask Student Engagement for
  permission or an export first.

## What the check measures (DESIGN 5.3)

`__clubs.check.mjs` builds each of the 24 practice students in
`lib/planner/__clubs.personas.json` the way the workspace will. It uses:
- the goal reader `interestProfile`;
- the degree's subjects through `degreeSubjects` over the program's own
  requirement blocks;
- the college from `programs.json`;
- `enteringAsFirstYear`.

It then runs `recommendClubs` for each student and checks four things:
- the file is whole, fresh and safe to ship;
- no club a student cannot join is matched to a goal;
- every goal has 3 joinable clubs, or the card says the list is thin and
  links the directory;
- every student's list follows the rules.

Scoreboard on 2026-10-05, directory read 2026-10-04, no reading pass, no
calendar:

| | Number | Bar |
|---|---|---|
| 1 | Goals with 3+ joinable clubs: **40 of 44**. The other 4 show the thin message: speech-language pathology 2, athletic training 0, supply chain 1, I/O psychology/HR 2 | 40 |
| 2 | Lists passing every rule (stand-in until the spot check runs): **24 of 24** | 24 (20 useful once graded) |
| 3 | Bad picks: **0** | 0 |
| 4 | True "why" lines: not graded yet (needs the model spot check, `--grades`) | 95% |
| + | Gold club shown / in the first 3 / in the first 6: **24 / 22 / 24** | 24 and 20 |

Five goals reach 3 only through clubs for their wider field, which the check
prints as a note:
- cybersecurity and game design: software engineering clubs;
- investment banking, real estate and commercial banking: finance clubs.

The model spot check (`clubs-design/eval/spotcheck-grader.md`) has not been
run. Pass its output with `--grades spotcheck.json` to fill lines 2 and 4.
