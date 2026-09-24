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

Checks, cheapest first: `node lib/planner/__prior-credit.check.mjs` (seconds), `node lib/planner/__plan-audit.check.mjs` (about a minute), `node lib/planner/__credit-rules.check.mjs` (about ten minutes, plans every offered degree). Read the header of `__plan-audit.check.mjs` before trusting any other harness: it loads only what the browser loads, and that is the reason it exists.

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
for which terms.

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

### Getting into the college, not just finishing the degree

Course-to-course prerequisites are only one gate. The planner now also reads:
registration restrictions on every section ("Restricted to Gies College of
Business", "Restricted to Graduate"), judged against the student's own college
and major and flagged on the card when every section is closed; prerequisite
text that names another college; and "admission to a teacher education
program" style prerequisites, flagged as milestones with their own
application. `public/illinois/admission.json` holds what two colleges publish
about transferring in from elsewhere on campus, hand-read from their own pages
and dated: Gies (intercollegiate transfer for first-year students: 24 graded
hours and Composition I, ECON 102 and 103 and a math course by the end of the
first spring, competitive) and Grainger (its published transfer coursework and
GPA). When a student's own words say they are not in the college yet, those
courses become requirements placed first (Composition I included, whichever
course fills it), the review list carries the route with its source, and the
bot's `program_admission` tool checks them against the board. Only Gies and
Grainger are encoded so far; other colleges' pages are JavaScript-rendered
and were not read.

### The bot reasons before it acts

ALMA runs at high effort and has four tools for thinking rather than doing:
`compare_courses` (side by side, with eligibility in a term), `explain_choice`
(why a course is where it is, and the runners-up it beat), `what_if` (try
changes on a copy of the board and read what breaks) and `review_board` (the
planner's own read of every term: credits, load by grade history, stacked
hard courses, courses that have not run, open requirements). Its instructions
ask it to gather facts with these, weigh them against the student's priorities
and situation, state the trade-off, and only then act or recommend.

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
