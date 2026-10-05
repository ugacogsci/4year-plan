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
   - `--feed-only` reads the events feed and nothing else (its two hops),
     and re-parses the cached directory page. The page's date and text
     hashes stay as they were, so a reading pass in progress is not
     disturbed.
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
   First run 2026-10-05 over the 2026-10-04 directory: `facts.json` holds
   1,067 clubs, 1,033 with a `does` line, and 1,029 of the 1,063 shipped
   clubs carry one. Without `facts.json`, no club has a `does` line and kinds
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
- `majors`: with `subjectsAdd`, the majors the club is for when several share
  the prefix, as the planner reads them from the program name (before ":" and
  the degree). The Kinesiology Student Association is HK for "Kinesiology"
  only, not Community Health; the FSHN clubs are each for their own major.
  `tag.mjs` refuses a name that is not a program in `programs.json`.
- `does`: our own one-line description, replacing the reading pass's. It must
  pass the same rules (20 words, 140 characters, no 8-word run of the club's
  text), or the build stops.
- `hide`
- `starter`: true (shown to a student with no goal yet), `"undeclared"` (only
  to a student with no major yet: the Exploratory Students Association), or
  false (never).

Every row needs `name` (the directory's name, so a rename shows up as a
warning) and `note`.

Write the note in your own words: say what the club's page says, never quote
it. `tag.mjs` refuses any goal id the planner does not have, any subject that
is not a course prefix, and any field it does not know.

Two rules in `build.mjs` (`applyHandRules`) run after the reading pass, on
our own facts, never the club's text:
- a club about managing one's own money (personal finance, financial
  literacy, budgeting and credit, in its name or `does` line) carries no
  finance-career goal and no FIN subject: the Personal Finance Club, NextGen
  Finance Initiative, the Illinois Personal Wealth Management Club and Sprout
  UIUC on 2026-10-05;
- a party or partisan group (by its name) carries no career goal: the
  planner never sends a student to a party from a career goal, and ALMA finds
  one when asked.
A goal an override added is never taken away by either. The build prints
both lists.

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
  - 87 are for students already in graduate, law, medical or veterinary
    school, which are dropped (39 graduate, 31 law, 11 medical, 6
    veterinary; the reading pass of 2026-10-05 added the Illinois
    Jurisprudence Society, a College of Law group);
  - 1 has no link at all: Animal Liberation UIUC listed `https://example.com/`
    as its website, and the calendar names no profile for it. The parse
    drops placeholder addresses (example.com/.net/.org, the reserved
    `.example`, `.test`, `.invalid` and `.localhost` names, localhost and
    bare IPs), and the build leaves out a club with no link
    (`counts.dropped.noLink`) rather than make one up;
  - **1,063 shipped**.

**The events feed:**
`https://one.illinois.edu/ical/urbanachampaign/ical_urbanachampaign.ics`
- It redirects (302) to the same path on
  `static-prod-us-east-1.campusgroups.com`, and that host's `/robots.txt`
  answers 403.
- **Read under the one exception to the house robots rule, approved by the
  owner on 2026-10-05** (`ROBOTS_EXCEPTION` in `crawl.mjs`):
  - why it is allowed: one.illinois.edu links the feed and its own
    robots.txt allows `/ical/`; RFC 9309 section 2.3.1.3 reads a 4xx
    robots.txt as "unavailable", which means no rules;
  - what it covers: that host, paths under `/ical/urbanachampaign/`, and a
    robots.txt that answered 4xx (not 429), reached only through the feed's
    checked redirect;
  - everything else keeps the house rule: any other path or host, a 5xx or
    no answer, and a robots.txt that answers 200 (its rules then apply);
  - every request it lets through is marked `"exception": true` in
    `data/clubs/fetchlog.jsonl`, and `__clubs-parse.check.mjs` checks the
    log never shows another path on that host.
- First read 2026-10-05: 6,304,459 bytes, Last-Modified Sun, 04 Oct 2026
  04:45:40 GMT, 7,024 events from 2026-07-09 to 2027-05-12, every one
  joined to its group by slug. Later reads send `If-None-Match` and
  `If-Modified-Since`, so an unchanged feed is a 304.
- What it gives:
  - event dates per club (`events.last`, up to 3 `events.next`, `n120`),
    counted from the day the calendar was read. The feed starts in early
    July, so "the last 120 days" sees about 90 days of it in October;
  - 420 shipped clubs with an event in the last 120 days and 334 with one
    coming up; the 598 with neither are ranked x0.9, a tiebreak only;
  - OneIllinois profiles for 49 groups the page linked only to their own
    website (40 of them shipped clubs), joined on the exact group name. 35
    shipped clubs still link their own website.

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
- robots.txt has one exception, for the events feed only (see Sources).
- A run is the page plus the feed's two hops. robots.txt is added when the
  cached copy is older than a day.
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

Scoreboard on 2026-10-05, directory read 2026-10-04, calendar read
2026-10-05, reading pass stored and checked (`READING.md`, "What the
checkers found"):

| | Number | Bar |
|---|---|---|
| 1 | Goals with 3+ joinable clubs: **40 of 44**. The other 4 show the thin message: speech-language pathology 2, athletic training 0, supply chain 1, I/O psychology/HR 2 | 40 |
| 2 | Lists graded useful by the model spot check: **13 of 24** (8 mixed, 3 not useful). Every list still passes every rule (the stand-in, 24 of 24) | 20 |
| 3 | Bad picks: **0** | 0 |
| 4 | True "why" lines (spot check): **139 of 165, 84.2%** | 95% |
| + | Gold club shown / in the first 3 / in the first 6: **24 / 24 / 24** | 24 and 20 |

Before the reading pass the same board read 40 of 44 and 24 / 22 / 24. With
the readers' facts alone it fell to 39 of 44: the readers marked the Student
Academy of Audiology's audience unclear and called Retrocomputing and
Hardware a social club, which cost speech-language pathology and hardware a
club each. The check put both back by hand (`overrides.json`), and the
board is 40 of 44 again.

Pre-veterinary is not one of the thin four, but not through general
pre-health clubs: since 2026-10-05 the "Pre-Health" name rule and Alpha
Epsilon Delta's national row cover every health track except pre-vet (as the
prototype did), so a pre-vet student sees the Pre-Vet Club, VAW Global
Veterinary Outreach, and two clubs `overrides.json` adds by hand (One Health
Alliance, and PAWS for animal experience hours).

Five goals reach 3 only through clubs for their wider field, which the check
prints as a note:
- cybersecurity and game design: software engineering clubs;
- investment banking, real estate and commercial banking: finance clubs.

The model spot check (`clubs-design/eval/spotcheck-grader.md`) fills lines 2
and 4: `node lib/planner/__clubs.check.mjs --grades <file>`. What it found:

- **2026-10-05, list check, all 24 practice students** (Opus, graded without
  seeing the gold or trap lists; grades in
  `data/clubs/reading/spotcheck-2026-10-05.json`, which stays local). Board:
  40 of 44, **13 of 24 useful**, 0 bad picks, **84.2% true why lines** (139 of
  165 picks; 86 of 108 in the visible top five). Lines 2 and 4 miss their
  bars, so `--grades` fails; without it the check passes. The most common
  failures:
  - Why lines that overstate a club (17 of the 26 false; the other 9 are
    the starter lines below). Seven general pre-health clubs are
    headed "About nursing" for the nursing student. General business
    fraternities are called "a finance club" or "about accounting/CPA"
    (national rows give each one four fields). The Venture Capital
    Association is called investment banking.
  - Goals the planner cannot hear (orchestra trumpet, nonprofit for kids,
    ad-agency creative director). The major's one or two clubs come first, then three starter
    clubs labeled "A good first club while you decide", with no message
    that the goal went unheard (`empty` is set only when nothing matched).
  - Lists filled from the wider field instead of saying the goal is thin.
    Pre-PT and nursing each have one club of their own, then eight general
    pre-health clubs. With 3 picks at most per goal, the robotics student gets
    railway and transportation societies (degree subjects) in rows 6 to 10,
    while six more robotics teams are left out.

  Fixed the same day (re-graded later; the automatic check still passes,
  gold 24 / 23 / 24, 0 bad picks, 40 of 44 goals):
  - A club named for a whole family of goals says what it is: "A pre-health
    club for students heading to health professions", "A professional
    business fraternity, for students heading into business careers", "The
    ALPFA chapter, for students heading into accounting/CPA and finance"
    (`familyLine` in `lib/planner/clubs.ts`).
  - Words that name no goal the planner knows: the card says so plainly
    (`unknownGoal`), the clubs whose own facts (name, our `does` line,
    categories) hold the student's words come first, then the major's, then
    starters labelled "A general club for any student, not matched to your
    goal". The word match stems both sides, drops stop words, roles and
    relatives and any word the goal reader hears as a goal on its own ("my
    sister is pre-law"), and never counts one generic word: a word in more than
    30 clubs' facts ("research", in 47) counts for nothing alone. The count
    alone missed words a goal sentence shares with club lines in passing
    ("make money" found seven charities that raise money; "open", "travel",
    "change", "remotely", "coach"), so those are stop words too, and the stem
    keeps "planes" from "plans", "news" from "new" and "anime" from "animals"
    (review, same day).
  - Illinois Political Consulting is politics only (`overrides.json`, and a
    name rule in `tag.mjs` for "political consulting"); the student's other
    words break ties, so "management consulting" puts Illinois Consulting
    Group first.
  - Another subject of the degree, or the college, fills only after every
    club for the goal: the robotics student sees eight robotics teams.
  - The Venture Capital Association is not tagged investment banking
    (`overrides.json`); a "venture capital" student still finds it under
    entrepreneurship.
  - ALMA's search puts every club holding the asked word ("a cappella", even
    one by audition or not taking sign-ups) before clubs that are only the
    kind asked for.

- **2026-10-05, round 2** (Opus, blind; grades in
  `data/clubs/reading/grades-round2.json`): **18 of 24 useful** (6 mixed, 0
  not useful), **166 of 170 why lines true (97.6%)**. The mixed lists were the
  two finance students, the CPA, nursing, pre-PT and climate policy. Fixed the
  same day (not re-graded yet; the automatic check passes, gold 24 / 23 / 24,
  0 bad picks, 40 of 44 goals):
  - Personal-finance literacy clubs carry no finance-career goal or FIN
    subject (`applyHandRules`, above). Vantage Acquisitions Group and Illini
    Business Forum are tagged investment banking by hand (`overrides.json`;
    the Forum also gets our own `does` line naming its fields). Markets clubs
    are a near sibling of investment banking (`NEAR_SIBLINGS` in
    `lib/planner/clubs.ts`): they rank with its own clubs, and still say
    "close to". "Investment banking in Chicago" now shows Prime M&A, Illini
    Business Forum, Vantage, the Investment Portfolio Organization and the
    Equity Research Association first.
  - Within a goal its own clubs come first, then the wider field with the
    goal's best family club (one business fraternity, one general pre-health
    club), then the other family clubs (`Rank` in `clubs.ts`). A goal with
    fewer than 3 clubs of its own is thin, however many family clubs follow,
    and the thin message counts its clubs in the communities row. Pre-PT,
    nursing, accounting and five other health tracks now say so.
  - A first-year's half weight for an honor society comes after the cutoff:
    Beta Alpha Psi shows for the CPA student, after the Accounting Club and
    before the business fraternities.
  - The College of Nursing at Urbana Urban Health Program is in the nursing
    list itself (`overrides.json`: its name centers no group, and it also
    serves every student). The Black and Hispanic student nursing
    associations stay in the communities row.
  - The Kinesiology Student Association is HK for Kinesiology students only
    (`majors`), so a pre-PT kinesiology student sees it as the major's club.
    The Association of Food Technologists, the Hospitality Management
    Association, the Student Dietetic Association and NutrImpact are FSHN for
    their own majors.
  - A club fitting more of the student's goals ranks first within its goal,
    and gets `GOALS_AGREE_BONUS`. Policy and politics count by the activity
    categories and the advocacy kind (`ACTIVITY_GOALS`), so for "climate
    policy for the government" Students for Environmental Concerns and the
    Green Leadership Council (a reading-pass goal) come before the fisheries
    and wildlife societies, which leave the first ten.
  - A community the student says they belong to ("I'm a first-gen Latina
    student") brings its clubs for their goal into the main list (ALPFA, in
    the first three); only words about themselves count, never "women's
    health" or "international business".
  - When a goal is heard, the major's best club keeps its row and the
    major's other clubs wait behind the goal's (ASHRAE no longer takes the
    robotics student's fifth row).
  - Why lines: the wider field says "close to", never "is part of"; a
    national body's letters the club's name does not use are spelled out
    ("The National Band Association student chapter"), unless the line would
    run past 110 characters.
  - The word match drops a word in a phrase that gives it another sense
    (`OTHER_SENSE`): "pilot plant", "a space for", "a welcoming space",
    "Product Space". "become a pilot" no longer finds the biodiesel club, and
    "work in space" no longer finds Product Space or clubs offering "a
    supportive space".
