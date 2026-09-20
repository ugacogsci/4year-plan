# Integration notes

What changed in this branch, and why. Written to be reviewable against
`ugacogsci/4year-plan` upstream.

## The short version

The planner UI was already good. What it did not have was data a degree
actually runs on. The map repo scraped 14,092 UGA courses but **34 of them
mention a prerequisite**, and the requirements folder holds one file marked
`"status": "illustrative"`.

A four-year plan is an ordering problem. Without prerequisites and offering
terms there is nothing to order, so this branch goes and gets them.

## 1. Prerequisites, offering terms and credits  (the important one)

`scripts/enrich-uga.mjs`

`semantic-course-map/backend/scrape_deep_details.py` already visits every
`/Course/Details/{id}` page and reads `courseObjectives` and `topicalOutline`.
Those same pages also publish, in plain HTML:

```
Prerequisite             CSCI 1301-1301L or CSCI 1301E
Semester Course Offered  Offered fall, spring and summer
Credit Hours             3
```

The scrape walked past all three. This script re-reads the same pages and
keeps them.

| | before | after |
|---|---|---|
| courses with prerequisites | 34 | **4,843** |
| offering terms | none | all 14,092 |
| credit hours | assumed 3 | parsed |

The prerequisite parser handles the real shapes the Bulletin uses, including
boolean text (`"(MATH 2200 or MATH 2200H) and (STAT 2000)"`) and the shorthand
where a bare number inherits the preceding subject (`"AAEC 2580 or 2580E"`).
It stores both the parsed course codes and the original sentence, because
`"Permission of department"` is a real prerequisite that no parser should
silently drop.

**It identifies itself honestly.** The existing scraper sends a spoofed Firefox
user agent. This one sends `TruBot/1.0 (+url; respects robots.txt)`. Every UGA
host tested serves it normally, and a project that wants a university as a
customer should not be the project that lied to their bot detection.

## 2. The ask bar

`components/planner/ask-bar.tsx`, `app/api/ask/route.ts`

The bar across the bottom of the whiteboard sketch. Not a chat window: the
student is mid-decision on the board above it, so the answer opens in place
and the plan stays put.

The API route is a thin proxy with a deliberately narrow contract,
`{ text, sources[] }`. Set `TRU_UPSTREAM` to a deployed tenant and it returns
real answers; leave it unset and it says so and the planner still works.

An answer without the page it came from does not ship. That is the same rule
as the README's "an LLM should not decide whether a student can graduate".

## 3. Real catalog instead of the demo set

`lib/planner/uga-data.ts`, `public/uga-catalog.json`

14,092 real courses across **235 departments**, loaded on the client with the
sample catalog as fallback so this stays non-breaking.

Three fixes were needed to make real data render:

- `CourseCluster` was a union of six demo names. The real catalog has 235
  subject prefixes, so every real course failed the visibility filter and the
  map came back empty. It is now the department, and colours are derived from
  the department name so CSCI is the same colour on every load.
- The t-SNE coordinates run about -10..10 and the explorer uses `x`/`y`
  directly as CSS percentages, so half the map rendered off-canvas. They are
  normalised into a 4..96% box when the client file is built.
- The map paints a bounded slice. 14,092 absolutely positioned nodes is a
  stall, not a visualisation. Search and prerequisite checks still run over
  the whole catalog.

## 4. Whiteboard layout

- The constellation moved **above** the semester board, via flex `order` in
  `globals.css` rather than by moving JSX, to keep the diff small.
- **Upload / Share / JSON** in the header. A four-year plan is something a
  student brings to an advisor, so it has to be able to leave the browser.
  Everything stays device-local, per the README's FERPA boundary.

## Running it

Needs Node 22+ (`vinext` uses `fs/promises` `glob`). `dev.sh` pins Node 23.

```
npm install
npm run dev
node scripts/enrich-uga.mjs        # ~16 min, re-reads all 14,092 pages
```

## 5. Onboarding, and cutting the clutter

`components/planner/onboarding.tsx`, `lib/planner/onboarding.ts`, `components/planner/app-shell.tsx`

Three screens before anyone sees a planner:

1. **Which school.** UGA, Texas A&M, Mizzou, Illinois, Virginia Tech. This is
   the first decision because every answer afterwards comes from that
   university's own pages.
2. **Three open questions,** not a form:
   - What are you studying, or thinking about studying?
   - When do you want to finish, and where are you now?
   - What do you want to be doing after you graduate?
3. **Building your profile.**

The middle screen is deliberately three text boxes. A student who has failed
calculus once and is deciding between two majors cannot say that in dropdowns,
and that context is the whole reason the resulting plan is worth anything.
The answers persist in localStorage and feed the model; the structured fields
stay editable underneath.

### The page was 6,943px tall

Almost all of it was one bug. The demo catalog had six departments, so the map
legend was short and the map stage sized itself to match. The real catalog has
**235**, which stretched the legend to 5,400px and dragged the stage with it.

| | before | after |
|---|---|---|
| course finder | 5,619px | **563px** |
| whole page | 6,943px | **1,887px** |
| form fields visible on arrival | 11 | **5** |

The map is now a fixed 380px viewing box with the legend scrolling inside it,
and the profile sections are collapsed `<details>` with Programs open. Setting
an explicit `display` on a `<details>` stops the browser collapsing its own
content, so that is forced in CSS.

## 6. Prior credit, and making the school choice mean something

### The planner had no idea what you already had

Three open questions cannot tell a true first-year apart from a second-year
transfer with 45 credits or someone who passed four AP exams, and those three
students need completely different plans. A fourth onboarding step now asks.

`scripts/credit-from-testing.mjs` scrapes the registrar's published
equivalence tables: **427 score rows across 64 exams** (AP, IB, Cambridge
AICE). A student searches an exam, picks their score, and sees the courses UGA
actually grants rather than a guess.

The step distinguishes two things the source treats differently and most tools
conflate:

- **Credit** counts toward the 120.
- **Exemption** lets you skip the course and grants zero hours.

AP Calculus AB at a 4 grants MATH 2250 (4 hours) and exempts you from MATH 1101
and MATH 1113 at zero. Treating those the same overstates a student's progress
by roughly a semester.

Three parser bugs were needed to get there, all of which failed silently:

- The exam name is an `<h4>` INSIDE its own table, not before it. Pairing on
  "nearest preceding heading" shifted every exam by one and reported that AP
  Calculus BC earns Music Theory credit.
- IB scores read `HL 5`, not `5`, so 313 IB rows were dropped.
- Credit hours attach to a GROUP: `BIOL 1107, BIOL 1107L (4 credit hours)` is
  two courses sharing four hours, while `MATH 1101 (0), MATH 2250 (4)` is each
  with its own. Taking the first number valued AP Calculus at 0; summing
  naively valued AP Biology at 8 instead of 4.

Verified against four known answers: Bio 4 → 4hrs, Bio 5 → 8hrs, CS A 4 →
CSCI 1301, Calc AB 4 → MATH 2250 plus two exemptions.

### The school picker now drives everything

It previously chose an accent colour and nothing else, so picking Texas A&M
produced an A&M header above UGA's catalog, UGA's colleges in the placeholders
and a DegreeWorks reference. Every school-specific string moved into `SCHOOLS`:

| | UGA | Texas A&M | Illinois | Virginia Tech | Mizzou |
|---|---|---|---|---|---|
| portal | Athena/DegreeWorks | Howdy | Self-Service | Hokie SPA | myZou |
| college in placeholder | Franklin | Mays | LAS | Engineering | Arts & Science |
| transfer feeder | Georgia State | Blinn | Parkland | Virginia Western | Moberly Area |
| late drop | withdrawal | **Q-drop** | withdrawal | withdrawal | withdrawal |

The ask bar routes to the matching tenant path, and a school with no crawled
catalog says so and falls back to the demo set instead of quietly serving
another university's courses. The map count only says "demo courses" when the
data actually is demo.

## 7. Degree requirements, grade data, and an operational scheduler

### The blocker is gone: 878 UGA programs

The Bulletin renders as a JavaScript shell, so a crawler sees 223 words on
every path. But the endpoint pattern Orion found for courses also serves
programs:

```
POST /Program/_ViewAllPrograms          paginated list, 878 programs
GET  /Program/Details/{id}?IDc={college}   ~10,000 words each
```

`scripts/uga-programs.mjs` walks both. A detail page carries the full Area I-VI
structure, entrance requirements, the major's own required courses, total
degree hours, and a four-year program of study.

**878 programs scraped, 539 with parsed requirements, 144 of those
undergraduate degrees. Median stated total: 120 hours.**

Two parsing bugs were load-bearing:

- Anchoring area headings on a preceding `>` silently dropped Area I and Area V
  from every single program. Anchoring on the `(N Hours)` marker and reading
  backwards catches all eight.
- `Total Major Hours (120 Hours)` is the degree total, not another bucket to
  sum. Treating it as an area made Accounting BBA claim 237 hours.

### Grade data from TRU, for the four schools that have it

`scripts/import-tru-grades.mjs` pulls the pipelines TRU already built:

| school | courses | source |
|---|---|---|
| Virginia Tech | 11,510 | University DataCommons |
| Illinois | 2,968 | DAIR |
| Texas A&M | 2,946 | Registrar grade distribution reports |
| Mizzou | 1,781 | MU Grade Distribution Application |

Each course gets a 0-100 `difficulty` derived from average GPA and nudged by
the withdrawal rate, so a term can be weighed rather than counted.

Two guards were ported from TRU because both produced nonsense without them:
Mizzou publishes no GPA field at all (derive it from the letter split, or every
Mizzou course scores null), and pass/fail courses publish a 0.00 GPA next to
90% A, which made A&M's ASCC 289 the hardest course at the university.

### What UGA does not publish

Both of these are real walls, not missing effort:

- **Grade distributions.** UGA has a Grade Distribution Report; it is a Power BI
  app in a `groups/me` workspace behind a UGA login.
- **Sections, buildings, meeting times.** These live in Athena, also behind login.

So the "how hard is this class" and "what building is it in" features work at
four schools and cannot work at UGA without someone granting access. That is a
concrete, specific ask for the Innovation District conversation rather than a
vague one.

### lib/planner/scheduler.ts

Deterministic planning functions over all four inputs:

- `undergraduatePrograms` filters 878 down to the 144 a four-year planner uses
- `areaProgress` counts each course **once**, against the first area that wants
  it; without that a course satisfying two areas inflates progress twice
- `termLoad` weighs a semester by real difficulty, because 15 credits of a
  3.6-average load and 15 credits of calculus plus organic chemistry are the
  same number and nothing like the same semester
- `missingPrerequisites` treats Bulletin prerequisites as alternatives, since
  "CSCI 1301 or CSCI 1301E" is far more common than a conjunction
- `offeringConflicts` catches a spring-only course placed in a fall term

Verified end to end against the real files. A student with AP Calculus AB (4),
AP Computer Science A (4) and AP Biology (5):

```
PRIOR CREDIT  16 hrs — MATH 2250, CSCI 1301, BIOL 1107/1107L/1108/1108L
EXEMPT ONLY   MATH 1101, MATH 1113
AREA PROGRESS I. Foundation Courses 4/9 · II. Life Sciences 3/3
PREREQ        CSCI 1302 needs "CSCI 1301-1301L or CSCI 1301E" -> SATISFIED
TERM LOAD     MATH 241 + CHEM 102 + PHYS 211 + CS 225 -> avg difficulty 43, normal
```

That last prerequisite line is the whole point: an AP score from high school
unlocking a specific downstream course, checked against the registrar's own
published prerequisite text.

## Not done

- The scheduler functions are written and tested offline but are not yet wired
  into the planner UI, which still renders from sample-data.
- UGA grade and section data are behind logins (see above). Four other schools
  have grades; none have section/building data yet.
- 339 of 878 programs parsed no requirements. Most are graduate degrees with a
  different page shape, which a four-year planner does not need.
- Course objectives cover 3,452 of 14,092 (24%), so skill-based matching has
  data for about a quarter of the catalog.
- Only UGA is crawled. The other four schools have config but no catalog or
  exam tables, and the UI says so rather than pretending.
- SAT Subject equivalences parse to zero rows; that page is shaped differently
  and has not been handled.
- No section-level data (seats, meeting times) anywhere yet.
- Grades page deliberately excluded, per the whiteboard.
