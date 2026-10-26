# The career matcher

## In plain words

**What it does.** When a student tells ORION what they want to do after
college ("I want to be a dentist"), the planner uses that goal to choose the
classes it is free to choose: electives, general education picks, and picks
from "choose N from this list" rows. Required courses and the degree's rules
are never touched.

**How it decided until now.** It matched words. A course was a "goal course"
if its title or description shared a word with the goal. That misses meaning:
no course is titled "dentist", so a future dentist got no goal courses at all,
and "software engineer" once picked a Materials Science course because its
title says "engineering".

**How the career matcher decides (Cameron's idea).** A small language model
turns any piece of text into a list of 384 numbers that describes what the
text is *about*. Texts about similar things get similar numbers, even when
they share no words. We run every course (title and description) through the
model once, ahead of time. When a student types a goal, their browser runs the
goal through the same model, and the planner prefers the courses whose
numbers are closest to the goal's.

It is the model the Illinois course map is built with (all-MiniLM-L6-v2).
UGA's map came from another project with a model nobody recorded, so both
schools' courses were run through this one model again, the same way, and the
student's goal is read by it too: goal and courses are measured on one
scale.

**Reading a short goal with its career.** One or two words are too little
for this small model. Alone, "dentist" came close to no course at all, and
"nurse" sat nearest lactation biology and plant nurseries. So the planner
first compares the goal, by meaning, with the 54 career pathways in ORION's
career research (each with its name and the words students use for it:
"dentist", "pre-dental", "DDS", "orthodontist"). When one is close, the goal
is read together with that pathway's summary and core skill areas (for
dentistry: general biology, general chemistry, organic chemistry,
biochemistry, physics, anatomy and physiology): 30% the student's own
words, 70% the pathway. Two pathways about equally close are both read
("marketing": marketing and sales, and advertising and public relations).
A goal no pathway is close to ("translator") is read alone, as before.

On top of "closest to the goal", four small rules keep a board sensible:

- **Variety.** A course that is almost the same as a goal course already on
  the board loses points, so a board does not get five near-identical
  classes.
- **Three per subject.** A board takes at most three goal picks from one
  subject (an Illinois Psychology board for a therapist had six PSYC goal
  picks, one for sports management six RST).
- **Beginner languages only for a language goal.** "Elementary Turkish I"
  and the like are not goal picks unless the goal is about languages
  ("Spanish teacher", "translator"): every one of them sat near "teacher",
  and a Psychology board got five.
- **Progression.** Introductory goal courses are nudged toward the early
  terms and advanced ones toward the later terms, and a goal course that
  leads on to another goal course in the same subject gets a small bonus.

It also never costs the degree anything: the planner builds the board both
ways, and keeps the matcher's version only if every requirement is met at
least as well (at UGA, as the board's own audit reads it, the reading the
board bar shows). If not, the matcher picks only the electives, and if even
that would cost something, the board is built the old way.

Each class it picks says why, on its card, for example:
"Closest to your goal (veterinarian): 2nd of 7,322 UGA courses by meaning."

Before the model reads the goal, the planner drops the "I want to be a" part
("I want to be a dentist" is read as "dentist"): read whole, every goal landed
next to career-planning seminars. A goal that only says the student has not
decided yet is not matched at all.

**Four real examples** (same freshman, goal picks only, from the benchmark
below; "before" is the matcher as first built, f384525):

| Board | Before | Now |
|---|---|---|
| UGA Psychology, "I want to be a dentist" | nothing | BIOL 4200W Science and Health Writing, LAMS 2000E Preparing for Healthcare, CHEM 1211 General Chemistry I, MIBO 3000 Introductory Applied Microbiology, BIOL 2900 Clinical Applications of Biological Science, VPAT 3900 Current Topics in One Health, BIOL 4910 Advanced Topics in Biology, ANTH 2020 Introduction to Forensic Anthropology |
| Illinois Psychology, "I want to be a teacher" | EDUC 201, HK 260, EPSY 201, HNDI 201 Elementary Hindi-Urdu I, EIL 214, TURK 201 Elementary Turkish I, EPOL 280, FR 101 Elementary French I, LAT 101 Elementary Latin I, ... | EPSY 201 Educational Psychology, HK 260 Teaching Activities I, EDUC 201 Identity and Difference in Education, EPOL 201 Foundations of Education, EPSY 236 Child Development in Education, SPED 465 Curriculum and Methods in Early Childhood, CI 435 Technology Applications for Teachers, and two general education picks |
| UGA Psychology, "I want to be a nurse" | MIBO 3000, POUL 3000 Avian Surgical Techniques, CBIO 3010 (all three by their words: their meaning was filed under "POUL 3000-3000L", and the planner asked for "POUL 3000") | BIOL 3990 Seminar in the Practice of Medicine, GRNT 3030 Medical Care of Older Adults, ANTH 3540 Multicultural Health Care, PHIL 3220 Biomedical Ethics, HIST 3433 History of Medicine, NUTR 2400, BIOL 2900, BIOL 4200W, VPAT 3900 |
| UGA Psychology, "I want to be a physical therapist" | NUTR 2100, PEDB 1010, DANC 3020, MUSI 3442 Percussion Techniques for Music Therapy | KINS 2100 Prevention and Care of Athletic Injuries, NUTR 2050 Introduction to Sport Nutrition, HPRB 3750 Foundations of Injury Prevention, ATTR 3100 Prevention and Care of Conditions in Sport, LAMS 3020E Foundations of Clinical Medicine III, RBIO 2010, PEDB 1010, DANC 2020 |

(Track courses, such as the pre-dental track's required sciences, are
booked the same way with or without the matcher and are left out here.)

**Where it is still not right.** The model is small; the pathways help, but:

- **Nurse** at Illinois: ANSC 207 The Science of Pets and How to Care for
  Them is a goal pick on both boards (it is about "care"), beside good
  ones (HK 264 Applied Medical Terminology, SOC 274 Health, Illness and
  Society, PHIL 214 Biomedical Ethics).
- **Accountant** at UGA: JURI 3355 Criminal Legal System and HIST 4765
  Museum Registration Methods beside ACCT 2101 and LEGL 2700 (accounting's
  skill areas include business law and record systems).
- **Dentist** at Illinois: the Psychology board gets two goal picks (HK 208
  Introduction to Medical Ethics, GLBL 240 Global Health); the dental
  sciences the model now finds are booked by the pre-dental track, or need
  courses first. Computer Science boards with a pre-health goal (dentist,
  veterinarian, physical therapist) have no room left for goal picks at
  Illinois; that was so before too.
- Fewer goal picks on some boards (an Illinois Psychology teacher 16 -> 9,
  sports management 22 -> 14): the weakest matches no longer count as goal
  courses, and the three-per-subject cap.

**How to turn it on.** It is off for everyone by default, and with it off
every plan is exactly what it was before (checked board by board, below).

1. Once per machine that deploys the site, run
   `node scripts/career/browser-assets.mjs`. It makes the browser's copy of
   the model and its runtime in `public/career-model/`. If the machine does
   not have the model yet (a fresh clone), it first downloads the model's
   four official files from its page, huggingface.co/Xenova/all-MiniLM-L6-v2
   (about 87 MB, once), and refuses any file that is not exactly the one the
   course vectors were made with. Neither the model nor that folder is
   saved in git.
2. Open the planner with `?career-matcher=on` at the end of the address. The
   browser remembers it. `?career-matcher=off` turns it off again.
3. Enter a goal. The first time, the browser loads about 38 MB (the model and
   its runtime, plus 2.5 MB of course data and 64 KB of career pathways). On this Mac, from the local dev
   server, the model was ready in 0.9 seconds and a goal took 12
   milliseconds; over a typical home connection the first download would
   take several seconds. After that the browser keeps it. The board rebuilds
   once when the matcher is ready, unless the student has already edited it.
   With the matcher on, each build runs two or three times (the degree
   check), so a rebuild takes two to three times as long.

If anything fails to load (an old browser, a missing file), the planner
quietly goes back to word matching. Nothing the student types leaves their
device for this.

**What it does not do yet.** It ranks courses by closeness to the goal, read
with the career's skill areas; it does not build a formal skill-by-skill
plan for the career (which skill each term covers). The research's skills
file and stages (years 1-2, 2-3, 3-4) could be that later step.

## Technical notes

### Pieces

| File | What it is |
|---|---|
| `scripts/career/embed-courses.mjs` | Offline, once: every undergraduate course of both schools through `Xenova/all-MiniLM-L6-v2` (float model, mean pooled, normalised), text `title. title. description` cut at 1,200 characters, the recipe `scripts/illinois/map.mjs` uses. Writes `public/<school>/course-vectors.json` (codes, one scale per course, hubs, `beginnerLanguage`) and `.bin` (384 signed bytes per course). `--languages-only` rewrites `beginnerLanguage` from the catalogs without the model: titles "Elementary / Beginning / First-Year / Basic" + a one- or two-word name that some course of it describes speaking or grammar for, plus Illinois's registrar table's first two semesters (68 courses at Illinois, 84 at UGA). |
| `scripts/career/embed-pathways.mjs`, `public/career-pathways.json` | The 54 pathways of the career research's `pathways.json` (kept outside the repo; the script takes its path), two vectors each, same model: `match` = "name: goal words (variants' too)", `areas` = "summary + core skill areas". 64 KB, base64 of signed bytes, with the O*NET attribution. |
| `lib/planner/uga-course-codes.ts` | `listedUgaCourseCodes`: how a UGA Bulletin row's code becomes the planner's codes ("JURI 4600/6600" -> JURI 4600, JURI 6600), shared by `uga-source.tsx` and the matcher. |
| `scripts/career/onnx-int8.mjs`, `scripts/career/browser-assets.mjs` | When transformers.js's cache has no model, `browser-assets.mjs` downloads `config.json`, `tokenizer.json`, `tokenizer_config.json` and `onnx/model.onnx` from huggingface.co/Xenova/all-MiniLM-L6-v2 into it (one request a second, the repo's crawler identity) and checks each file's SHA-256 against the copy the vectors were made with (`--no-download` only says what is missing; `CAREER_MODEL_SOURCE` points it at another copy, which is how the download was tested here). The browser's model: the same model with its 38 large weight matrices stored as 8-bit numbers (per row for lookup tables, per column for matrix weights, rebuilt to floats by Cast and Mul nodes at the head of the graph), 86.2 MiB to 21.9 MiB, under Cloudflare's 25 MiB per-file limit. Sentence vectors agree with the float model's to cosine 0.9991 (worst) / 0.9995 (median) over 205 texts. Also copies `transformers.min.js` and the WebAssembly-only ONNX runtime (the WebGPU build that transformers.js carries needs a 26 MiB `.wasm`, over the limit). |
| `lib/planner/career-embedding.ts` | Pure: the flag (`careerMatcherOn`, key `orion.careerMatcher`), decoding the vector files (`courseVectorsFrom` indexes each row under the planner's codes too, `plannerCodesOf`; `pathwayVectorsFrom`), `expandGoal` (the goal read with its pathway), `careerFitFor` (goal against every course once; beginner languages out unless the goal is about languages; `capGroup`), `goalLabel`, `varietyPenalty`, `progressionPoints`, `GOAL_GROUP_CAP`. |
| `lib/planner/career-embedding-browser.ts` | The browser loader: lazy dynamic imports of the runtime from `/career-model/runtime/` (`@vite-ignore`, so neither bundle includes it), `allowRemoteModels = false`, one WebAssembly thread, the model, the vectors, the pathways and each goal's vector cached for the visit; any failure returns null for the rest of the visit (a missing pathways file only means the goal is read alone). |
| `lib/planner/quality.ts` | With `careerFit` and a course it has a vector for, the relevance measure reads meaning: a career-track named course 1, a goal course 0.8 + 0.2 x closeness, else the degree's subjects as before. No title-word matching for that course. |
| `lib/planner/autoplan.ts` | `AutoplanInput.careerFit`, passed to every scorer (fill, gen-ed and list ranking, chooser, re-pick). `scoreElective` adds `3 x closeness` and the follow-on point. The elective fill (`careerFirstFit`) takes the best of the first six fitting courses after variety and progression, passing over a goal pick whose subject already has three (`GOAL_GROUP_CAP`, counting the general education picks closest to the goal). `careerGated` is the degree check; `AutoplanInput.careerAudit` lets the caller add its own audit to it. |
| `components/planner/planner-workspace.tsx` | Loads the matcher when the flag is on and the student has a goal (undergraduate boards of both schools), passes it to builds, the chooser and the re-pick, rebuilds an unedited board once when it arrives, and gives cards the reason line (`goalReasonOf`). At UGA it hands the build `careerAudit`: the board audit's unmet rows (`ugaAuditOn`), as the board bar counts them. |

### Rules

- **Reading the goal** (`expandGoal`): cosine of the goal to each pathway's
  `match` vector. Below 0.35 to every pathway: read alone. From 0.35 the
  pathways' share grows to 70% at 0.45 (dentist 0.59, teacher 0.50, nurse
  0.62, physical therapist 0.63; translator 0.22, read alone). Pathways
  within 0.05 of the closest are read too, two at most, each weighted by
  its cosine. The query is `normalise(0.3 x goal + 0.7 x areas)`.
- **Goal course**: among the closest 2% of the school's undergraduate courses
  (net of hubs), cosine at least 0.30 (so a goal the model cannot place
  picks nothing), and at least 15% of the way from the 2% cut to the
  closest course. Closeness 0.15 to 1 within that band.
- **Beginner languages**: a course in `beginnerLanguage` is no goal course
  unless the goal says languages, translation, interpreting, bilingual,
  ESL and the like, names a language the catalog teaches, or is read with
  a pathway whose core skills include a world language.
- **Cap**: at most 3 goal picks a board from one subject (the code's
  subject; the beginner language courses together are one group).
- **Variety**: cosine to the nearest goal pick already on the board; the
  penalty grows from 0 at 0.60 to 4 points at 0.85.
- **Progression**: `1.5 x (1 - 2 x |level position - term position|)`, levels
  100 to 400 against first term to last.
- **Follow-on**: 1 point when a course listing this one as a prerequisite, in
  the same subject, is also a goal course.
- **Codes**: a UGA row's vector is found under the row's own code and under
  each undergraduate code the planner books it as ("POUL 3000-3000L" ->
  POUL 3000, and POUL 3000L; "JURI 4600/6600" -> JURI 4600). All 7,322
  undergraduate UGA planner codes find their vector (2,273, 31%, only this
  way). Before, those fell back to word matching: 11 of 114 UGA goal picks
  in the benchmark (POUL 3000 Avian Surgical Techniques for a nurse).
- **Degree check**: the matcher's board stands only with no more unmet
  requirements, no required course unplaced that the board without it
  places, and, where the caller gives one (UGA), no more unmet audit rows.
- Graduate courses have no vectors and keep word matching; the loader is not
  used on graduate boards.

### Proof that "off" changes nothing

Against d5769a4 (a detached copy of that commit, the same scripts), run
again after these fixes:

- Illinois all-degrees sweep (`scripts/dev/sweep/sweep.mjs`), Fall 2026 and
  Spring 2027 starts: 1,848 + 1,848 boards identical in every field but the
  build time (`ms`); the requirement-block files byte-identical.
- UGA harness (`scripts/dev/uga-harness.mjs`), 20 bachelor's programs x 8
  kinds of student = 160 boards: byte-identical (programs 73962, 69115,
  31532, 29981, 71747, 70174, 45275, 99573, 79689, 35773, 90610, 27349,
  89431, 83049, 92067, 21398, 59600, 93244, 30336, 62409).
- `lib/planner` checks: 58 of 58 pass (`__career-embedding.check.mjs` now
  also pins the UGA codes, the pathways, the language rule and the cap);
  `tsc --noEmit`: 0 errors.

### Benchmark (flag on)

`scripts/career/benchmark.mjs`: 20 goals x Illinois Psychology BSLAS and
Computer Science BS x UGA Psychology BS and Computer Science BS, an incoming
freshman, built with words and with meaning (UGA through
`uga-harness.mjs` with `HARNESS_GOALS` and `HARNESS_MEANING=1`). Every
board side by side: `docs/career-benchmark.md`. Numbers below are before
these fixes (f384525) -> now.

- **Degree**: 0 of 80 boards worse, before and now (unmet requirements,
  unplaced required courses, and at UGA the audit rows the board bar
  shows). Without the audit in the degree check one board would have been:
  UGA Computer Science, environmental scientist, Social Sciences 6 of 9
  hours in the board audit's reading while the engine counted it met; the
  check now ranks only that board's electives. The matcher ranked every
  free choice on 67 -> 65 boards, electives only on 9 -> 11, none on 4
  ("undecided") and never had to step aside.
- **Piles**: boards with more than three goal picks from one subject
  16 -> 0; beginner language goal picks 5 -> 0 (the Illinois Psychology
  teacher's HNDI 201, TURK 201, FR 101, LAT 101 and POL 101).
- **UGA codes**: 11 of 114 UGA goal picks were courses whose meaning the
  matcher could not find under the planner's code, so they were picked by
  their words (POUL 3000 Avian Surgical Techniques for a nurse); now every
  UGA course is read by meaning.
- **Goal picks per board** (Illinois Psychology / Illinois CS / UGA CS /
  UGA Psychology): dentist 0/0/0/0 -> 2/0/2/8; teacher 16/6/0/7 -> 9/7/0/7;
  nurse 4/3/0/3 -> 19/11/2/9; physical therapist 5/0/1/4 -> 4/0/0/8;
  undecided 0 -> 0 everywhere.
- **My reading of the picks**, goal by goal over its four boards:
  better for 7 (dentist, teacher, nurse, physical therapist, accountant,
  therapist, financial analyst); about the same for 9 (software engineer,
  data scientist, lawyer, marketing, environmental scientist, journalist,
  veterinarian, sports management, public policy); mixed for 3 (mechanical
  engineer: GSD 103 Basics of Game Design and HK 458 Rehabilitation
  Biomechanics on the Illinois Psychology board; UX designer: Illinois now
  leans to information science and human factors, UGA Psychology lost
  graphic design for engineering graphics; game developer: more
  programming, fewer game-studies courses); undecided picks nothing, as it
  should.
- **Variety**: 2 of 80 matcher boards have two goal electives at cosine
  0.85 or more: CS 124 and CS 128 (a real sequence, Psychology software
  engineer) and KINS 2100 / ATTR 3100 (two "prevention and care" courses,
  UGA Psychology physical therapist).
- **Sizes**: course vectors 2.28 MiB (Illinois, 6,225 courses) and
  2.68 MiB (UGA, 7,322), plus 173 and 230 KB of index; career pathways
  63 KB; browser model 21.9 MiB; runtime 13.6 MiB (`.wasm`) + 0.6 MiB
  (`transformers.min.js`).
- **Speed**: Node, model 0.7 to 0.9 s to load, 14 to 21 ms a goal; the
  pathway reading adds one pass over 54 vectors (well under a
  millisecond). Browser (local dev server, before these fixes): model
  0.86 s, vectors 40 ms, goal 12 ms; no request left the site.

### Tuning found on the way

- The goal is embedded without its framing (`goalQuery`): read whole, "I want
  to be a ..." put career seminars first for most goals.
- Courses are ranked net of their "hub" score: UKR 201 (Second-Year
  Ukrainian) was the nearest Illinois course to "dentist", and ITAL 101 the
  25th nearest to "accountant", because their vectors sit near every short
  goal. Fifty reference occupations, none a benchmark goal, set each course's
  hub score (`scripts/career/embed-courses.mjs`).
- The pathway reading, tried on the benchmark goals: matching the goal
  against "name: goal words" separates pathways best (dentist: dentistry
  0.59, medicine next at 0.37); against the summary alone "therapist" went
  to occupational therapy. Reading the goal with the core skill areas alone
  turned "veterinarian" into biochemistry; with the summary too the
  veterinary courses stay. Half goal, half pathway left "nurse" near
  lactation and udder health; 30/70 does not. Adding O*NET's knowledge
  areas changed little.
- The 15% closeness floor: read with its pathway, the accountant's goal
  courses ran from ACCY 201 down to ADV 212 Advertising History, and every
  goal course earns the goal's points.
- Known gaps (above): nursing's "care" courses, accounting's law and
  records courses at UGA, dentistry on boards with no room.

### Later

The research's `skills.json` and each pathway's stages (foundations in
years 1-2, building in 2-3, advanced in 3-4) could make this a plan by
skill: which skill area each term's goal pick covers, and which areas a
board still lacks.
