# Georgia Tech: university-wide rules and Core IMPACTS

Plain summary of `public/gatech-rules.json` and `public/gatech-core.json`.
Source: the 2026-2027 Georgia Tech Catalog (catalog.gatech.edu) and the
Registrar (registrar.gatech.edu), read 9 November 2026.

How to rebuild:

```
export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
node scripts/gatech/rules-crawl.mjs   # polite fetch into data/gatech-raw/rules/ (skips what is cached)
node scripts/gatech/rules-build.mjs   # parses the cache, writes the two JSON files
```

Every number in `gatech-rules.json` sits next to the catalog's own sentence.
The build checks each sentence against the cached page and refuses to write
if one no longer matches, so a reworded rule cannot slip through unnoticed.

## Who this applies to

- Students entering Summer 2024 or later follow **Core IMPACTS**. Students on a
  2023-2024 or older catalog keep the old core, which is published only in the
  archived catalogs (robots.txt blocks those, so it is not read here).
  https://catalog.gatech.edu/academics/undergraduate/core-curriculum/
- A "curriculum year" is Summer + Fall + Spring. Students entering Summer 2026,
  Fall 2026 or Spring 2027 follow the **2026-2027** catalog.
  https://catalog.gatech.edu/rules/2/
- A student may graduate under any one curriculum year that was in effect
  while enrolled. Changing major moves the student to the catalog in effect at
  the change. https://catalog.gatech.edu/rules/13/ , https://catalog.gatech.edu/rules/6/

## Core IMPACTS (general education)

| Area | Hours | What counts | Page |
|---|---|---|---|
| Institutional Priority | 3 | CS 1301, or another CS course the major names (degree pages use CS 1315 or CS 1371) | [institution](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/institution/) |
| Mathematics & Quantitative Skills | 4 | MATH 1552 (Architecture, Computing, Engineering, Sciences) or MATH 1712 (Business, Liberal Arts) | [mathematics](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/mathematics/) |
| Political Science & U.S. History | 3 | One of HIST 2111, HIST 2112, INTA 1200, POL 1101, PUBP 3000 | [citizenship](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/citizenship/) |
| Arts, Humanities & Ethics | 6 | Any HUM course (197 listed). At most 3 hours from one 1002/2001/2002 language course | [humanities](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/humanities/) |
| Communicating in Writing | 6 | ENGL 1101 and ENGL 1102 | [writing](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/writing/) |
| Technology, Mathematics & Sciences | 12-14 | 8 hours lab science (12 options; Engineering and Physics majors must take PHYS 2211 + 2212) plus 4-6 hours math by college: MATH 1551 + 1553 (Architecture, Engineering, Sciences), MATH 1551 + 1554 (Computing, CmpE, EE), MATH 1711 or 1551 + 1553 (everyone else) | [stem](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/stem/) |
| Social Sciences | 9 | Any SS course (194 listed). No credit for both POL 1101 and INTA 1200; ECON 2100/2101/2105/2106 give 3 hours, or 6 for ECON 2105 + 2106 | [social sciences](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/social-sciences/) |
| Field of Study | 18 | Set by each degree page | [core page](https://catalog.gatech.edu/academics/undergraduate/core-curriculum/) |

- Georgia Tech prints no core total. The seven areas add up to 43-45 hours.
  Four of them are sized from their course lists because the page states no
  number (Institutional Priority, Mathematics, Political Science & U.S.
  History, Writing).
- **One course counts for one Core IMPACTS area only.** It can also count for
  the ethics attribute, the Georgia history/constitution requirement, and the
  major. https://catalog.gatech.edu/academics/undergraduate/core-curriculum/citizenship/
- Core courses may not be taken pass/fail.
- After 30 earned hours, a student who has not finished Mathematics or Writing
  must take the next course toward it every term.

### How it plugs into the Illinois engine

- Each degree page prints every core area as its own heading with real course
  rows, so most of the core parses as ordinary required or "choose one" blocks.
- Only three placeholder rows name a category instead of courses: **Any HUM**
  (6), **Any SS** (9) and **Lab Science** (8, or 4 twice). `shape-programs.mjs`
  (run by `programs.mjs`) replaces each with a group whose rows are the area's
  approved list from `gatech-core.json`, sized by the row's hours, so the
  engine reads it as an ordinary pool and needs no gen-ed tags for it. The tags
  are still here for display: `tagsByCourse` (437 courses, to fill each course's
  `genEd`) and `engineMapping.labelToTags` (the Georgia Tech version of
  `GENED_MAP`).
- **Must be gated by school:** `adaptIllinoisPrograms` calls `withCampusGenEd`
  on every program. For a Georgia Tech degree it would append an Illinois
  "General Education Requirements (campus)" area, with the Illinois
  third-semester language requirement. Skip it for `gatech`.
- All seven Georgia Tech areas share one ledger, because a course counts once.
  Illinois gives each category its own ledger, so that setting must also
  differ by school.

## Other university requirements

- **Georgia history and constitution (legislative requirement).** The student
  must cover four things: U.S. history, Georgia history, the U.S. Constitution
  and the Georgia Constitution.
  - HIST 2111 or 2112 **taken at Georgia Tech** covers both history parts.
    AP or IB credit covers U.S. history only.
  - INTA 1200, POL 1101 or PUBP 3000 **taken at Georgia Tech** covers both
    constitution parts. AP credit for INTA 1200 or POL 1101 covers the U.S.
    Constitution only.
  - Each part can also be met by a non-credit Canvas exam, passed at 60% or
    better, ideally before 90 hours. The exam gives no credit and does not
    appear on the transcript.
  - The Political Science & U.S. History area needs only one course, so a
    student usually still owes the other pair: take a second listed course
    (it can count as Social Sciences) or take the exams. The requirement adds
    no hours.
  - Applies to students who started on or after May 1, 2023.
    https://catalog.gatech.edu/academics/undergraduate/core-curriculum/constitution-history/
- **Wellness.** One 2-hour course: APPH 1040, 1050 or 1060 (formerly HPS 1040).
  It sits on top of the 120-hour minimum, unless the student is medically
  exempted.
  https://catalog.gatech.edu/academics/undergraduate/core-curriculum/wellness-requirement/
- **Ethics attribute (ETHS).** This is not a university-wide requirement.
  Some majors require it. 41 courses carry it, and many of them also count as
  HUM or SS. https://catalog.gatech.edu/academics/undergraduate/core-curriculum/ethics/
- **Foreign language.** There is no university-wide requirement. Language is
  required by the Applied Languages and Intercultural Studies majors and by the
  International Plan option offered inside many majors. Any other major that
  needs it says so on its own page. Introductory language courses count toward
  Humanities only up to 3 hours.

## Degree, residency, standing

- **Total hours:** at least 120 plus 2 wellness hours, for 122. Each degree
  page sets its own total, often higher (Computer Science 124 + 2, Aerospace
  131). Pages differ on whether that total already includes the wellness hours.
- **Upper division:** at least 39 hours at the 3000 level or above, with at
  least 21 of them in the major.
- **Minimum GPA:** 2.00 to graduate.
  https://catalog.gatech.edu/rules/13/
- **Residency:** at least 45 hours at Georgia Tech. Of the final 45 hours, at
  most 7 may be transfer credit, so 38 must be taken at Georgia Tech.
  - Cross-enrollment (ARCHE schools) counts as residence.
  - Summer concurrent registration elsewhere does not count, and it is not
    applied to the degree during the final 45 hours.
  - Honors at graduation need 60 hours earned at Georgia Tech.
  https://catalog.gatech.edu/rules/13/ , https://catalog.gatech.edu/rules/11/
- **Class standing** is based on earned hours: Freshman 0-29, Sophomore 30-59,
  Junior 60-89, Senior 90 or more. Full-time is 12 or more hours.
  https://catalog.gatech.edu/rules/6/

## Term load and calendar

- **Maximum hours per term:**

  | Standing | Fall / Spring | Summer |
  |---|---|---|
  | Good | 21 | 16 |
  | Warning | 16 | 14 |
  | Probation | 14 | 12 |

  - During Phase 1 registration, the Institute may cap Fall and Spring loads
    at 18 hours.
  - Going over the maximum needs the major school's recommendation and
    approval from the Institute Undergraduate Curriculum Committee in advance.
  - Audited courses count toward the load.
  https://catalog.gatech.edu/rules/6/ , https://catalog.gatech.edu/rules/9/
- **Calendar:** semesters. Fall and Spring each have about 15 weeks of
  classes plus 1 week of finals. The accelerated Summer term has about 11 weeks
  plus 1 week of finals. The academic year starts with Summer.
  - Summer sessions: Full, May, Early and Late.
  - The registrar's tentative table gives dates for Summer 2027 through Fall
    2028 (for example, Fall 2027 starts Aug 23 and has finals Dec 9-16).
  - The dated 2026-2027 calendar is loaded from a registrar endpoint that
    refused this crawler (403 "Origin not allowed"). It was not worked around,
    so it is not in the data.
  https://catalog.gatech.edu/rules/2/ , https://registrar.gatech.edu/current-students/calendars

## Grades and repeats

- **Grades:** A=4, B=3, C=2, D=1, F=0, with no plus or minus grades. D is
  passing. GPA is truncated, not rounded, at two decimals. Many majors require
  a C in named courses, and each degree page says which.
- **Repeats:**
  - A course with a grade of B or higher may not be repeated.
  - A repeated course counts once for credit, and every attempt counts in the
    GPA.
  - Failing a repeat forfeits the credit from the earlier attempt.
  https://catalog.gatech.edu/rules/9/ , https://catalog.gatech.edu/rules/5/
- **Grade substitution:**
  - Allowed for up to two Georgia Tech courses with a D or F, once per course.
  - The repeat must happen before the final term.
  - The old grade then leaves the GPA.
  https://catalog.gatech.edu/policies/grading-gpa/grade-substitution/
- **Withdrawal:** courses can be dropped without penalty until 60% of the term.
- **Pass/fail:**
  - Only Free Electives may be taken pass/fail, up to 9 hours in total (a
    second degree does not add more).
  - It is never allowed for core, major, minor, certificate or institutional
    requirements.
  - Some majors allow fewer pass/fail hours (Computer Science allows 6).
  https://catalog.gatech.edu/rules/10/
- **Credit by exam:**
  - At most 9 hours of advanced-standing credit count toward the degree.
  - AP, IB and A-Level exams must be taken before enrolling.
  - CLEP is not accepted.
  - Transfer credit needs a grade of C or better and does not count in the GPA.
  https://catalog.gatech.edu/rules/12/ , https://catalog.gatech.edu/academics/undergraduate/credit-tests-scores/transfer-credit/
- **Change of major:** one unrestricted change is allowed before 60 hours.
  Industrial and Systems Engineering, Mechanical Engineering and Music
  Technology set their own conditions. https://catalog.gatech.edu/rules/6/

## What changed for Fall 2026 / Fall 2027

- The current pages mark nothing as new for Fall 2026. Fall 2026 students use
  the 2026-2027 catalog described above.
- The 2027-2028 catalog is not published yet, so Fall 2027 rules cannot be
  known. Only the registrar's tentative term dates for 2027-2028 exist.
- Dated changes still printed on the pages:
  - Core IMPACTS for students entering Summer 2024 or later.
  - The legislative-requirement rules for students starting on or after
    May 1, 2023.
  - Grade substitutions made under the pre-2019 policy count toward the
    two-course limit.
- Earlier editions sit under `/archived-catalogs/`, which robots.txt blocks,
  so the 2025-2026 and 2026-2027 text could not be compared here.
- One outdated wording: the constitution-history page still calls Social
  Sciences "Core Area E", the pre-2024 name.
