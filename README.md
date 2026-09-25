# Four Year

## This branch: the Illinois planner

What is here now is a working planner for the University of Illinois Urbana-Champaign, built on this skeleton: the real catalog (6,110 undergraduate courses), 308 degree pages, Fall 2026 sections and DAIR grade history, with the generator, the checks and the assistant below. The school roster in `lib/planner/onboarding.ts` still lists UGA and the others; only Illinois is switched on, because only Illinois has a catalog behind it.

- Onboarding runs on every launch: three questions, AP and IB scores priced against the registrar's table, and a transcript (PDF, image or text) read once by Claude into a checklist the student confirms. Nothing about a student is stored.
- Plans reach the degree's published total with balanced terms. The graduation date outranks the hours a student asks for. Elective slots fill what the degree page does not name; tapping one lists everything eligible in that term.
- ALMA, the same name the TRU Illinois tenant uses, sits in a column beside the board. It answers anything about Illinois through TRU's published-page answerer, reads the board, and can add, remove, replace or move courses, always through the same prerequisite, standing and credit checks a drag goes through. Removing a required course needs the student's yes.

Running it:

```
cp .env.example .env.local   # set ANTHROPIC_API_KEY (transcript reading, ALMA) and TRU_UPSTREAM (university answers)
npm install                  # Node 22 or newer
npm run dev -- -p 3010
```

Without the two variables the planner runs with those features switched off and says so.

The checks need Node 23, because they load the TypeScript sources directly with type stripping (`export PATH=/opt/homebrew/bin:$PATH` on this machine). Each is one file under `lib/planner/`, run from this folder as

```
node --experimental-strip-types --disable-warning=ExperimentalWarning lib/planner/__<name>.check.mjs
```

and exits non-zero on a failure. Read the header of `__plan-audit.check.mjs` before trusting any other harness: it loads only what the browser loads, and that is the reason it exists. The checks are `__prior-credit`, `__transcript`, `__illinois-data`, `__autoplan`, `__ask-router`, `__plan-audit`, `__credit-e2e`, and the ones the sections below name (`__horizon`, `__plan-notes`, `__interests`, `__career-tracks`, `__electives`, `__college-rules`, `__review`, `__advisor-packet`), each of which takes seconds; `__repick` and `__schedule-quality` take up to a minute, and `__credit-rules` about ten, because it plans every offered degree. Three fail today, for the reasons under known gaps at the end of this section.

An unofficial, visual degree-planning prototype for University of Georgia students and advisors. It combines an editable semester-by-semester plan with a constellation-style course finder descended from the existing Semantic Course Map.

This repository is a first-iteration skeleton. Its data and degree requirements are illustrative and must not be used as academic advising.

### What makes a class a good pick

Elective slots, the order of every "choose from this list" requirement, the
chooser, the dropdown on a card and the bot's suggestions all read one scoring
function, `lib/planner/quality.ts`, over the student's priorities
(`lib/planner/priorities.ts`): lighter workload, highly rated teaching,
relevance to what they wrote, covering more requirements at once, fitting the
schedule (nothing before 9 a.m., online or in person). Each is 0, 1 or 2 and
the rail has presets. The reasons behind a pick are printed next to it in
words, and a measure the data cannot speak to is named as not known rather
than scored.

Teaching comes from the University of Illinois's own Teachers Ranked as
Excellent lists, which the Center for Innovation in Teaching and Learning
publishes each term from student ratings (https://citl.illinois.edu/teachers-ranked-excellent).
`scripts/illinois/excellent-teachers.mjs` downloads the term PDFs into
`data/excellent/` (ignored by git) and parses them with pdfplumber into
`public/illinois-excellent.json`; `build-index.mjs` folds them per course into
`public/illinois/excellent.json`. Workload comes from the grade history the
planner already had. No outside rating site is used, and the wording never
calls an instructor good or bad: it says whether they are on the list, and
for which terms. The "Lightest" preset is workload at 2 with everything else
balanced, and at 2 grade-history lightness ranks ahead of the rest.

A good pick is also one the student can take. A free elective is never a
course written for someone else (a discussion tied to another section,
graduate, thesis or arranged work, a seminar for first-years, transfers,
honors students or scholars, another department's orientation), and a course
under 3 credits only lands a plan on its total or a term on its minimum. A
course entered by application or approval ("by application", "consent of
instructor required", but not "X or consent of instructor") is never booked on
the planner's own account; a course the degree requires by name stays, and for
a goal like the Gies finance academies (FIN 390 to 396) ALMA says to apply.
`__electives.check.mjs` holds the fill to this.

### What the rail measures

The rail draws one bar per requirement the degree page prints, counted off the
board as it is now. For Illinois that is `components/planner/illinois-progress.ts`:
one row per general education category, per required-course list, per "take N
from this list" pool, per hours block and for the language sequence, each in
the unit the page sized it in (hours, courses or semesters; nothing converts
between them). A course counts once for the major and once per gen-ed
exclusive group, which is the campus rule. Hours past a row's own target are
spare, and a block whose words are "so that there are at least 128 credit
hours" is met when the board reaches 128. Georgia's Bulletin prints an hour
total on every area, so its rows stay one per area (`areaProgress`).

Blocks that name hours and no courses are read for what the page does say:
"Advanced Electives ... the 400-level coursework offered for letter grade in
ANY area" carries a level floor, "Exceptions to the list are: ASTR 100, PHYS
101 and PHYS 102, and CHEM 101" a list of exclusions, and "one course from the
Natural Science & Technology (NST) list" the category itself. The adapter
reads each once into the rule (`minLevel`, `exclude`, `genEd`); the fill takes
the best course at or above the floor while those hours are open, and the
rail counts with the same fields.

The degree's size comes from the page's sentence, else from a "Total Hours"
row of 100 or more, which is always the whole degree, never an area subtotal.
Unlabelled tables that together outweigh the degree are one pool sized by the
row pointing at them, so Community Health's 152-course Correlates List is the
18 hours of "Correlate Areas" (`lib/planner/illinois-data.ts`).

### Credit a student walks in with

Most students are not starting from zero, so the credit step and the rail
take whatever they have: their own Illinois academic history, another
college's transcript, the Transfer Evaluation Report admissions sent, a degree
audit, or a screenshot of a course list, several files at once. The reader
(`app/api/transcript/route.ts`, one model call, nothing stored) returns every
line as printed with the school that taught it, the Illinois equivalent the
document itself prints, and lines the document says earn nothing. Matching
happens in the browser (`lib/planner/transcript.ts`): an Illinois line counts as
its course; another school's line counts as the course the document prints for
it, else as the catalog's likely equivalent (`lib/planner/transfer-match.ts`, a
curated table of the courses transfer students hold most often plus title
matching, each with a confidence and a reason), else as hours toward the total,
which is what Illinois grants a transferable course at minimum. Every line has
a select saying what it counts as, and a course can be typed in with no
document. Illinois's own words set the rule: Transferology is the estimate, the
Transfer Evaluation Report is the decision, so a proposal is labelled likely
until the student or their record confirms it.

The plan is built around the credit: held courses come off the board and
satisfy prerequisites, hours with no course count toward the total and toward
class standing, a horizon the student did not state shrinks to the terms the
remaining hours need (a chain that needs one more term gets it), and the
residency rule (45 hours at Illinois, 21 at the 300 level or above,
admissions.illinois.edu/transferring-credit/) is checked against the plan and
reported when short. ALMA reads the same record (`prior_credit`), proposes
equivalents (`find_equivalent`), and records or drops credit
(`record_prior_credit`, `drop_prior_credit`), which rebuilds the board.

Counting follows what Illinois records show. Each line keeps the school that
taught it, so a record merged from an Illinois history and another college's
transcript still counts only Illinois lines toward residency. A transferred
course earns its own hours: Parkland's 5-hour calculus is MATH 221 plus an
elective hour, and a 3-hour course matched to a 4-hour one earns 3. Quarter
hours are converted at two-thirds. A held cross-listed class counts once, and
of two held courses the catalog says do not both earn credit, the smaller
counts. AP credit the student picks and their record also lists is counted
once. An AP or IB score report adds its exams to the exam list, priced by the
registrar's table (Grainger's calculus table for Grainger students). A plan
never starts in a term the record shows in progress. The student's words set
the start and end terms clause by clause ("transferring to Illinois in Fall
2027" is a start, "class of 2029" an end, "next fall" is relative), and hours
they say they have with nothing recorded raise a review row.
`lib/planner/__transcript.check.mjs` checks the arithmetic.

How the student arrived is read from their answers first and the record
second (another school's record with nothing taught at Illinois is a transfer
on its way). It picks the LAS orientation seminar (LAS 101 for a first-year,
102 for a transfer, 100 only for a student who says they are international)
and the college admission route below. ALMA's `prior_credit` reports hours
brought in beside hours that fill a requirement: a Parkland student with ENG
101 alone brings 3 hours and fills nothing.

AP and IB credit is priced from the registrar's own table
(`scripts/illinois/exam-credit.mjs` builds `public/illinois-exam-credit.json`
from the CSV behind citl.illinois.edu/current-cutoff-scores). Every exam and
score in the source, 714 of them, is checked against the app's pricing, courses
and hours both: a score that earns two rows earns both (AP Biology 5 is IB 150
and MCB 150), a grant's elective remainder is kept ("RHET 105 & ENGL 1--, 7
hours"), a course the catalog lacks still earns its hours, the registrar's typos
("JPAN") are mapped, and Grainger students are priced from Grainger's calculus
table. Official College Board and IB names ("Physics 1: Algebra-Based",
"Mathematics: Analysis and Approaches HL") resolve to the table's; subscores and
the English Literature/Language condition are read from the score report.
ALMA's `exam_credit` tool answers from the same table.

Transfer gen-eds come from published guides where they exist:
`scripts/illinois/transfer-gened.py` reads the Parkland-to-UIUC gen-ed guide
(edited by Illinois admissions and Parkland) into
`public/illinois-transfer-gened.json`, and a Parkland course the guide lists
fills its Illinois categories even with no Illinois course number. Categories an
evaluation report prints beside a line count the same way. Composition I is the
two-course sequence (ENG 101 with ENG 102, IAI C1 900 with C1 901R); one course
alone is elective hours. `lib/planner/__credit-e2e.check.mjs` runs five
students with credit through the whole pipeline on every degree and fails on a
re-booked course, a booked course that cannot earn credit beside a held one, a
validator error, a gen-ed category booked though held credit meets it, held
hours that differ from the documents, a re-booked language level, or a wrong
Composition I.

### Which terms a course actually runs in

Illinois publishes no "offered in" line, so the planner used to assume every
course runs every fall and spring. `scripts/illinois/offerings.mjs` reads the
Course Explorer's per-term subject pages for the last eight terms (one request
per subject per term, paced, backing off when the site answers a burst with an
empty 202) into `public/illinois-offerings.json`; `build-index.mjs` folds it
into `public/illinois/offerings.json`. From it, every course carries the
seasons it has run in: the scheduler will not place a spring-only course in a
fall term, a course that has run in none of the eight terms is ranked last,
marked down as an elective, and flagged on its card, and the detail panel and
the bot say which terms it ran in.

### The language requirement is planned, not quoted

Most Illinois degrees require the third (LAS Sciences and Letters: fourth)
semester of a language other than English. The university's general
education page says the requirement is also met by that many years of one
language in high school, one year counting as one semester, or by a
placement exam. The planner asks about high school language in onboarding,
reads the registrar's table of which course is each language's first to
fourth semester (`scripts/illinois/languages.mjs`, `public/illinois/languages.json`),
and books only the semesters still owed, back to back from the first term.
A student who has not answered is assumed to bring the two years Illinois
requires for freshman admission (its admissions page: two years required,
four recommended, one year counting as one college semester), and the plan
says so; "None" books the whole sequence. The sequence is placed,
in the language the student named, one they already hold a course in, one
their own words mention, or Spanish by default. Every card of the sequence
says so, and its chevron switches the whole remaining sequence to another
language. The bot sees the sequence and the reason for it.

### How the placer decides what goes where

Beyond prerequisites, standing, and credit bounds, the placer now weighs:
a course that runs in only one season adds a year, not a term, to the chain
above it; a course with no slack left goes in ahead of everything and may
displace a category filler or a course with slack; category fillers are
capped at two per term ahead of the major's own courses; a 300-level course
waits for sophomore hours and a 400-level course for junior hours unless the
chain gives no slack; electives avoid courses whose every section is
restricted to other majors and prefer courses that run every term. Set
`PLAN_DEBUG="AE 433"` when running a check harness to see why that course
was refused in each term. `lib/planner/__schedule-quality.check.mjs`
generates every degree and tallies the mistakes no rule check catches.

Courses that belong together stay together: a lab shares its lecture's term,
and once the first half of a sequence is placed (a set the degree lists, or an
"X I" and "X II" pair) the second goes in the next term it runs, so ACCY 201
is followed by 202 and ECON 102 and 103 share a year. A prerequisite worded
"credit in or exemption from X" (CHEM 102's MATH 112) is met by a higher course
in X's subject, and the plan says so instead of booking X.

Summers lighten terms but never shorten a plan: each takes 6 hours (9 only when
a fixed end is otherwise missed), at most one hardest-band course, and light
courses and gen eds first. A term away earns nothing unless it is study abroad
(15 hours by default, at most 18); an unstated end moves later so the student
keeps eight campus terms, a stated end is kept with a note on the cost, and an
LAS plan is flagged when fewer than 30 of its last 60 hours are on campus.
Spreading hard courses one a term is kept only if it leaves nothing more open,
adds no term and makes no term harder, and its note, like the note on hours
past the degree total, says what it did and why (`__plan-notes.check.mjs`).
`__horizon.check.mjs` cuts `readHorizon` out of
`components/planner/illinois-source.tsx` between the "A term in a student's
own words" comment and the "Course detail" divider, so keep those markers.

Rules added after testing five realistic incoming students (September 2026):

- A degree page with no campus General Education table (39 of them, Computer
  and Electrical Engineering, English, History and Political Science among
  them) gets the campus table appended, with its college's own language rule,
  so those plans book Composition I, the categories and the language.
- A row the crawl collapsed to one code ("CHEM 102" carrying the titles of
  CHEM 102, 103, 104 and 105) is rebuilt from the catalog titles, and "Select
  one group of courses" becomes one choice between whole sets. The plan takes
  the set the student already holds part of, else the first listed.
- A "to include" technical-elective pool counts the courses its nested
  "Select ..." rows chose toward its own hours, in the engine and on the rail.
- A prerequisite read with low confidence still orders the plan: a course
  never goes before a course its sentence names that the plan also books, and
  a suggested elective needs every named prerequisite met.
- A course titled "Senior ..." or "Capstone ..." with no stated standing is
  taken as needing senior standing.
- Composition I is due by the second term (the campus says first year).
- Grainger degrees give no hours for math below MATH 220, STAT 100, CHEM 101
  and 108, 100-level PHYS or ASTR 100, and 4 of MATH 220's 5.
- The degree's own subjects are the ones its lists are made of, not every
  department with three courses on a 400-course elective list, and its major
  subject is read from the name by word ("Computer Engineering" is ECE).
- Gen-ed categories fill the one-course Cultural Studies ones first, with
  courses that also count for a category still waiting, and prefer courses
  that run every term.

### Planning the way the student wants

What a student asks for reaches the plan through three channels, and each was
audited against realistic students before it was trusted:

- **Priorities** (`lib/planner/priorities.ts`, scored in `lib/planner/quality.ts`):
  lighter workload, highly rated teaching, relevance to their goals, covering
  requirements, and schedule wishes. Workload is scaled to Illinois's own
  difficulty bands, and a course with no grade history is weighed at the
  harder band, not given a free pass. Teaching counts the share of sections an
  excellent-listed instructor teaches. Schedule wishes (a time window, days off,
  in person or online) are judged on whether a whole registration fits the
  crawled term's sections (`meet` in `sections.json`, from `summariseSections`).
  One rule, `lib/planner/meeting-fit.ts`, decides that fit for the scorer,
  ALMA and the build, and unreadable meeting data is unknown, not a clash.
  A clash with an explicit wish is a conflict, not a nudge. Priorities reach
  electives, list picks and gen-ed picks alike; required courses never move.
- **Goals** (`lib/planner/career-tracks.ts`): nine pre-professional tracks from
  the Illinois Career Center guides and 35 interest topics, read out of the
  student's own words. A named track's required and strongly recommended
  courses get first claim on free electives and may displace the planner's own
  lesser picks; the plan cites the guide and says what did not fit.
- **Shape** (`set_plan_shape` in ALMA, `Horizon.away` and `Horizon.summers` in
  the engine): credits per term, the finish term, terms away (study abroad, a
  co-op), summers (at most 9 credits, only courses with a summer record), and
  spreading hard courses one a term when that costs nothing. Under 12 hours
  gets a part-time note, over 18 is refused with the college's rule, and a
  student with a career goal is asked before the summers after years two and
  three, the usual internship summers, get classes.

Goals are read only from what the student wants to do after graduating (the
rail's career words, starting from the About-you "after" answer, plus what ALMA
records), never from what they are studying, so "Psychology" is not a goal. The
reader honours a change of mind ("not pre-med anymore", "pre-med? nah") and
ignores other people's plans ("my sister is pre-law"); `set_priorities` can
add to a goal, replace it or clear it for good. Finance is now six topics, from
investment banking to commercial lending, and I-O psychology and HR has its
own (`__interests.check.mjs`).

A named track's courses are booked before placement, inside the room the
degree total leaves, each by a due date: the core sciences in time for the
application and pre-med PSYC 100 and SOC 100 by the MCAT, both the last spring
before the plan's last fall (Spring 2029 for a Fall 2026 freshman), reaching
down the prerequisite chain. A course that misses its date is named with the
reason, and the MCAT spring holds at most one hardest-band course where the
degree allows. A prerequisite choice goes to the track's course (MCB 244's
chemistry is CHEM 102), and the cards say which track they serve
(`__career-tracks.check.mjs`).

### What a re-pick promises

Re-pick (the Preferences button, and ALMA's `set_priorities`) swaps the
planner's own picks for the best under the current priorities; required
courses and anything the student added stay. An audit caught it taking every
career-track course off Aaliyah's pre-PT board, so `lib/planner/repick.ts` now
keeps these promises (`__repick.check.mjs` replays the students). Track
courses stay, and ALMA asks before removing one. A swap adds no prerequisite,
standing, exclusion or duplicate problem anywhere on the board, brings in a
course that runs that term and is open to the student, and keeps every term
within bounds, the degree total and every met gen-ed category. A slot under 3
credits takes only a course of the same credits. It is one pass of net
changes, so re-picking for the same priorities changes nothing. Composition I,
the language and booked prerequisites never move, half of a two-course
sequence never stands in for a whole course, and a gen-ed pick moves only for
a course that carries all its categories and is clearly better on what the
student weighted most, worse on none.

### Getting into the college, not just finishing the degree

Course-to-course prerequisites are only one gate. The planner now also reads:
registration restrictions on every section ("Restricted to Gies College of
Business", "Restricted to Graduate"), judged against the student's own college
and major and flagged on the card when every section is closed; prerequisite
text that names another college; and "admission to a teacher education
program" style prerequisites, flagged as milestones with their own
application.

`public/illinois/admission.json` holds three published routes, each hand-read
from its own page with the URL and read date. Gies intercollegiate transfer is
for first-year students: 24 graded hours, plus Composition I, ECON 102 and 103
and a math course, all by the end of the first spring; competitive. Grainger's
Engineering Undeclared is for students who entered Illinois as first-years,
applying in their second or third semester: Calculus 1 (MATH 220 or 221) and
CHEM 102 and 103, a 3.30 cumulative and 3.0 Grainger GPA with a B- or better in
each technical course, windows of May 1 to 15 (for fall) and November 15 to 30
(for spring), and at most two of the six competitive majors. Grainger's
transfer admission is for students coming from another school.
`lib/planner/admission-route.ts` picks the route from how the student entered
and the semester the plan starts in, and says why: a transfer student is told,
in the page's words, that Engineering Undeclared is not open to them, and a
student past the third semester gets no route.

When the student's words say they are not in the college yet, a route taken at
Illinois goes on the board and the review list, due by the semester they first
apply in, whatever degree is on the board: a Psychology first-year who wants
Mechanical Engineering has MATH 221 and CHEM 102 and 103 by Spring 2027.
Computer Science, CS + Bioengineering and CS + Physics are closed to on-campus
transfer, Engineering Undeclared included; ALMA says so and offers what the
Siebel School's FAQ offers, some blended CS + X majors and the CS minor.
`program_admission` returns the chosen route with its reason, the windows, the
competitive-major limit and the routes the student cannot use, and
`__plan-audit.check.mjs` holds every choice to the page. Only Gies and
Grainger are encoded so far; other colleges' pages are JavaScript-rendered and
were not read.

### The bot reasons before it acts

ALMA runs at high effort and has four tools for thinking rather than doing:
`compare_courses` (side by side, with eligibility in a term), `explain_choice`
(why a course is where it is, and the runners-up it beat), `what_if` (try
changes on a copy of the board and read what breaks) and `review_board` (the
planner's own read of every term: credits, load by grade history, stacked
hard courses, courses that have not run, open requirements). Its instructions
ask it to gather facts with these, weigh them against the student's priorities
and situation, state the trade-off, and only then act or recommend.

It also knows what a college decides and the planner cannot:
`lib/planner/college-rules.ts` holds the overload and underload rules and
offices of Grainger, Gies, Media, LAS, ACES, FAA and AHS, read from each
college's page on 2026-09-24, so a Grainger freshman asking for 20 hours hears
that Grainger grants no overload in a first semester, not "check with
advising"; other colleges get their office's name. Its instructions add LAS's
credit/no credit rule, grade replacement (Student Code 3-309), the Fall 2026
term dates (refresh each term), planning around academic warning, and a
handoff to the Dean of Students and the CARE Center
(`__college-rules.check.mjs`).

### The board review

`review_board` (`lib/planner/review.ts`, `__review.check.mjs`) reads the board
the way an advisor would. The plan keeps each term as built, so a light first
year (a term under 15 hours, or under 30 Illinois hours in year one) is flagged
only when the student's own setting or edits caused it: Emma, at 12 hours a
term, is told, and a balanced plan for a student with 42 AP hours is not. ALMA
gives Kentucky's figure once (18.4% of students taking 12 to 14 hours finished
in four years, against 35.4% at 15 or more) and leaves the choice to the
student. The review also flags a first math or statistics course after year
one, fewer than three courses in the major's subjects in year one, and hours
that count toward nothing (MATH 112 on a Mechanical Engineering board), and it
suggests summers by name, never added without a yes: Diego's chain from MATH
221 to ME 461 runs into the last term, and MATH 241 in Summer 2027 gives it a
term to spare. Every change ALMA makes, and `what_if`, reports the flags it
caused. The validator now flags Composition I from the third fall or spring
on and, for LAS and iSchool degrees, a term past 60 hours with no language
course while it is still owed; `__plan-audit` checks no generated board shows
either.

### The advisor packet

"Print for my advisor" in the Plan menu opens about two printable pages, built
in the browser from the board on screen and never stored or sent: each term
with every course's role and the requirement it fills, next term with a backup
the student can register for beside each planner pick, every assumption the
plan rests on, the open review flags, the questions only the college can
answer with who decides each, and a line that the plan is unofficial and must
be checked against the uAchieve degree audit. The code is
`lib/planner/advisor-packet.ts` and `components/planner/advisor-packet.tsx`;
`__advisor-packet.check.mjs` renders the sheet in Node through a loader hook
that transpiles `.tsx`, a pattern other checks can reuse (`PACKET_DUMP=<dir>`
writes each page).

### Known gaps

Year-one scheduling for pre-med and pre-PT boards is unfinished and tracked
separately: the track's sciences crowd the first-year seminar and the major's
own courses out of year one. `__review` fails on it (3 assertions) and so does
`__career-tracks` (1). `__illinois-data` has 2 older failures on ME 340's
credit range. The Community Health pages print their core and concentration
codes as plain text, and `scripts/illinois/programs.mjs` reads only linked
codes, so those courses are missing until the crawler reads that text and the
programs are re-crawled.

## What works

- All eight terms visible in one four-year planning board
- Drag-and-drop from the course map or between terms, plus menu-based moves
- Course removal, semantic-map search, requirement-compatible swaps, and undo
- Live checks for prerequisites, credit load, typical offering, sample capacity, and travel notes
- Inputs for three primary majors, a second major, minors, certificates, graduation term, career interests, format/time preferences, and scholarship targets
- Requirement and total-credit progress that changes with the selected primary major
- Prior-course entry through the same course finder
- Device-local save and restore for both the profile and plan
- Collapsible constellation explorer with cluster filters and prerequisite paths
- Responsive layout for desktop and mobile

## Placeholder coverage

The MVP labels its incomplete data in the interface. The Computer Science and Psychology requirement sets, every second-major/minor/certificate rule, scholarship thresholds, live capacity/meeting/location/travel signals, and generated plan are placeholders. Cognitive Science is reviewed demo content, not an official audit. The UGA Bulletin, DegreeWorks, and an advisor remain the source of truth.

Career, format, class-time, and target-GPA inputs are saved but do not rank or regenerate the sample plan yet. The scholarship minimum-credit input does drive live term-load warnings.

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

For deployed social links, set `NEXT_PUBLIC_SITE_URL` to the public origin. The
local fallback is `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

The Illinois planner's own checks, which need Node 23, are listed at the top of this file.

## Project map

```text
app/                         Route, metadata, and global theme
components/planner/          Planner UI and interaction components
components/ui/               Reusable shadcn interface primitives
lib/planner/types.ts         Domain contracts
lib/planner/rules.ts         Pure validation and progress logic
lib/planner/sample-data.ts   Clearly labeled demo catalog and plan
data/programs/               Example requirement-definition format
docs/                        Architecture, roadmap, and data-source notes
```

The prototype intentionally keeps domain rules outside React. A future API or optimizer can call the same planning functions without coupling itself to the current interface.

## Good first contributions

- Add unit tests around `lib/planner/rules.ts`
- Replace one illustrative requirement group with advisor-reviewed structured data
- Introduce a repository interface for courses and plans, keeping the sample adapter as a fallback
- Add keyboard reordering and richer drag feedback
- Connect a read-only subset of the semantic-course-map data through an import script
- Prototype one constraint-solver strategy behind a stable `generatePlan()` interface
- Interview 3-5 students or advisors and turn recurring needs into issues

Read [CONTRIBUTING.md](./CONTRIBUTING.md), [Architecture](./docs/ARCHITECTURE.md), and [Roadmap](./docs/ROADMAP.md) before expanding a major area.

## Important boundaries

- The planner must remain explainable and deterministic. An LLM can interpret preferences or explain results, but it should not decide whether a student can graduate.
- Store source timestamps and provenance with every volatile fact.
- Treat instructor reviews and third-party data as optional enrichment; confirm legal and technical access before building around them.
- Do not collect student records or sensitive academic data until authentication, privacy, retention, and FERPA implications have been reviewed.
- Keep this product clearly labeled as unofficial until UGA authorizes otherwise.

Course titles and the constellation logo in the demo were selected from the existing `semantic-course-map` project. They are copied into this repository, so there is no runtime dependency and the original project is not modified.
