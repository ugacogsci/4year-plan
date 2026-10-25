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
numbers are closest to the goal's. "Dentist" lands next to oral biology,
anatomy and biochemistry.

It is the model the Illinois course map is built with (all-MiniLM-L6-v2).
UGA's map came from another project with a model nobody recorded, so both
schools' courses were run through this one model again, the same way, and the
student's goal is read by it too: goal and courses are measured on one
scale.

On top of "closest to the goal", two small rules keep a board sensible:

- **Variety.** A course that is almost the same as a goal course already on
  the board loses points, so a board does not get five near-identical
  classes.
- **Progression.** Introductory goal courses are nudged toward the early
  terms and advanced ones toward the later terms, and a goal course that
  leads on to another goal course in the same subject gets a small bonus.

It also never costs the degree anything: the planner builds the board both
ways, and keeps the matcher's version only if every requirement is met at
least as well. If not, the matcher picks only the electives, and if even that
would cost something, the board is built the old way.

Each class it picks says why, on its card, for example:
"Closest to your goal (veterinarian): 2nd of 7,322 UGA courses by meaning."

Before the model reads the goal, the planner drops the "I want to be a" part
("I want to be a dentist" is read as "dentist"): read whole, every goal landed
next to career-planning seminars. A goal that only says the student has not
decided yet is not matched at all.

**Three real examples** (same freshman, goal picks only; from the benchmark
below):

| Board | Words (today) | Meaning (career matcher) |
|---|---|---|
| Illinois Computer Science, "I want to be a mechanical engineer" | SE 361 Emotional Intelligence Skills, NPRE 330 Materials in Nuclear Engineering, SE 101 Engineering Graphics & Design, ECE 364, ECE 205, TAM 211 Statics, ME 200 Thermodynamics | TAM 201 Mechanics for Technology & Management, CEE 202 Engineering Risk & Uncertainty, CEE 201 Systems Engineering & Economics, ME 170 Computer-Aided Design, SE 261 Business Side of Engineering |
| UGA Psychology, "I want to be an accountant" | CMLT 3600 Gods, Ghosts, and Demons in East Asian Literature, ACCT 2101 Principles of Accounting I, FHCE 3250, TXMI 3240, THEA 3600 Fundamentals of Acting on Camera, BIOL 3900 Readings in Biology | FHCE 3200 Introduction to Personal Finance, ACCT 2101 Principles of Accounting I, TXMI 3240 Retail Planning and Buying, JURI 4600 Corporate Tax |
| UGA Psychology, "I want to be a veterinarian" | PSYC 4120 Sensation and Perception, ANTH 2800 Food, Environment, and Culture, BIOL 1108, CBIO 3050 Medical Histology, POUL 3000 Avian Surgical Techniques | VPAT 3101 Basic Veterinary Medical Terminology, ADSC 2810 Survey of Veterinary Medicine Professions, MIBO 2500 Microbiology and Health Care, POPH 3300 Introduction to Wildlife Health, PSYC 4120, ENTO 3650 Medical Entomology, BMSC 4999E Comparative Veterinary Anatomy |

(Track courses, such as the pre-veterinary track's required sciences, are
booked the same way with or without the matcher and are left out here.)

**Where it is not better.** The model is small and has gaps:

- **Dentist**: the model knows too little about dentistry; no course comes
  close enough, so it picks nothing (the old way picks nothing either). The
  pre-dental track still books the required sciences.
- **Teacher** at Illinois: it confuses "elementary school" with "Elementary
  Turkish", and a Psychology board got five beginner language courses.
- **Physical therapist** at UGA: one board got MUSI 3442 Percussion
  Techniques. **Nurse**: fewer goal picks than the old way.

**How to turn it on.** It is off for everyone by default, and with it off
every plan is exactly what it was before (checked board by board, below).

1. Once per machine that deploys the site, run
   `node scripts/career/browser-assets.mjs`. It makes the browser's copy of
   the model and its runtime in `public/career-model/` from files already on
   the machine (nothing is downloaded). That folder is not saved in git.
2. Open the planner with `?career-matcher=on` at the end of the address. The
   browser remembers it. `?career-matcher=off` turns it off again.
3. Enter a goal. The first time, the browser loads about 38 MB (the model and
   its runtime, plus 2.5 MB of course data). On this Mac, from the local dev
   server, the model was ready in 0.9 seconds and a goal took 12
   milliseconds; over a typical home connection the first download would
   take several seconds. After that the browser keeps it. The board rebuilds
   once when the matcher is ready, unless the student has already edited it.
   With the matcher on, each build runs two or three times (the degree
   check), so a rebuild takes two to three times as long.

If anything fails to load (an old browser, a missing file), the planner
quietly goes back to word matching. Nothing the student types leaves their
device for this.

**What it does not do yet.** It ranks courses by closeness to the goal; it
does not build a formal skill-by-skill plan for the career. The research
saved in `keep-planner/career/` (pathways and skills) could be a later step on
top of this.

## Technical notes

### Pieces

| File | What it is |
|---|---|
| `scripts/career/embed-courses.mjs` | Offline, once: every undergraduate course of both schools through `Xenova/all-MiniLM-L6-v2` (float model, mean pooled, normalised), text `title. title. description` cut at 1,200 characters, the recipe `scripts/illinois/map.mjs` uses. Writes `public/<school>/course-vectors.json` (codes, one scale per course) and `.bin` (384 signed bytes per course). |
| `scripts/career/onnx-int8.mjs`, `scripts/career/browser-assets.mjs` | The browser's model: the same model with its 38 large weight matrices stored as 8-bit numbers (per row for lookup tables, per column for matrix weights, rebuilt to floats by Cast and Mul nodes at the head of the graph), 86.2 MiB to 21.9 MiB, under Cloudflare's 25 MiB per-file limit. Sentence vectors agree with the float model's to cosine 0.9991 (worst) / 0.9995 (median) over 205 texts. Also copies `transformers.min.js` and the WebAssembly-only ONNX runtime (the WebGPU build that transformers.js carries needs a 26 MiB `.wasm`, over the limit). |
| `lib/planner/career-embedding.ts` | Pure: the flag (`careerMatcherOn`, key `orion.careerMatcher`), decoding the vector files, `careerFitFor` (goal against every course once), `goalLabel`, `varietyPenalty`, `progressionPoints`. |
| `lib/planner/career-embedding-browser.ts` | The browser loader: lazy dynamic imports of the runtime from `/career-model/runtime/` (`@vite-ignore`, so neither bundle includes it), `allowRemoteModels = false`, one WebAssembly thread, the model, the vectors and each goal's vector cached for the visit; any failure returns null for the rest of the visit. |
| `lib/planner/quality.ts` | With `careerFit` and a course it has a vector for, the relevance measure reads meaning: a career-track named course 1, a goal course 0.8 + 0.2 x closeness, else the degree's subjects as before. No title-word matching for that course. |
| `lib/planner/autoplan.ts` | `AutoplanInput.careerFit`, passed to every scorer (fill, gen-ed and list ranking, chooser, re-pick). `scoreElective` adds `3 x closeness` and the follow-on point. The elective fill (`careerFirstFit`) takes the best of the first six fitting courses after variety and progression. |
| `components/planner/planner-workspace.tsx` | Loads the matcher when the flag is on and the student has a goal (undergraduate boards of both schools), passes it to builds, the chooser and the re-pick, rebuilds an unedited board once when it arrives, and gives cards the reason line (`goalReasonOf`). |

### Rules

- **Goal course**: among the closest 2% of the school's undergraduate courses
  and cosine at least 0.30 (so a goal the model cannot place, "undecided",
  picks nothing). Closeness 0 to 1 within that band.
- **Variety**: cosine to the nearest goal pick already on the board; the
  penalty grows from 0 at 0.60 to 4 points at 0.85.
- **Progression**: `1.5 x (1 - 2 x |level position - term position|)`, levels
  100 to 400 against first term to last.
- **Follow-on**: 1 point when a course listing this one as a prerequisite, in
  the same subject, is also a goal course.
- Graduate courses have no vectors and keep word matching; the loader is not
  used on graduate boards.

### Proof that "off" changes nothing

Against d5769a4 (a detached copy of that commit, the same scripts):

- Illinois all-degrees sweep (`scripts/dev/sweep/sweep.mjs`), Fall 2026 and
  Spring 2027 starts: 1,848 + 1,848 boards identical in every field but the
  build time (`ms`); the requirement-block files byte-identical.
- UGA harness (`scripts/dev/uga-harness.mjs`), 20 bachelor's programs x 8
  kinds of student = 160 boards: byte-identical.
- `lib/planner` checks: 58 of 58 pass (57 before, plus
  `__career-embedding.check.mjs`); `tsc --noEmit`: 0 errors.

### Benchmark (flag on)

`scripts/career/benchmark.mjs`: 20 goals x Illinois Psychology BSLAS and
Computer Science BS x UGA Psychology BS and Computer Science BS, an incoming
freshman, built with words and with meaning (UGA through
`uga-harness.mjs` with `HARNESS_GOALS` and `HARNESS_MEANING=1`). Every
board side by side: `docs/career-benchmark.md`.

- **Degree**: 0 of 80 boards worse (unmet requirements, unplaced required
  courses, and at UGA the audit rows the board bar shows). Before the degree
  check (careerGated) 3 UGA Computer Science boards were worse: six terms
  leave room for every choice but one, and the general education course the
  matcher preferred was the one that did not fit. With the check, the
  matcher ranked every free choice on 67 boards, electives only on 9, none
  on 4 ("undecided", no goal to match) and never had to step aside.
- **My reading of the picks**, goal by goal over its four boards:
  better for 7 (software engineer, financial analyst, mechanical engineer,
  UX designer, accountant, veterinarian, public policy: the word matcher's
  "Emotional Intelligence Skills", "Gods, Ghosts, and Demons" and
  "Fundamentals of Acting on Camera" are gone); about the same for 8 (data
  scientist, lawyer, marketing, therapist, environmental scientist,
  journalist, sports management, game developer); mixed or worse for 3
  (teacher, physical therapist, nurse, above); nothing either way for 2
  (dentist, undecided).
- **Variety**: one of the 40 matcher boards has two goal electives closer
  than 0.85 (CS 124 and CS 128, Introduction to Computer Science I and II, a
  real sequence, on the Psychology software engineer board); the word
  matcher's boards have two such. The check's UX designer board's closest
  pair is 0.68.
- **Sizes**: course vectors 2.28 MiB (Illinois, 6,225 courses) and
  2.68 MiB (UGA, 7,322), plus 172 and 229 KB of index; browser model
  21.9 MiB; runtime 13.6 MiB (`.wasm`) + 0.6 MiB (`transformers.min.js`).
- **Speed**: Node, model 0.6 to 0.9 s to load, 12 to 22 ms a goal. Browser
  (local dev server): model 0.86 s, vectors 40 ms, goal 12 ms, a second goal
  or school under 0.1 s; no request left the site.

### Tuning found on the way

- The goal is embedded without its framing (`goalQuery`): read whole, "I want
  to be a ..." put career seminars first for most goals.
- Courses are ranked net of their "hub" score: UKR 201 (Second-Year
  Ukrainian) was the nearest Illinois course to "dentist", and ITAL 101 the
  25th nearest to "accountant", because their vectors sit near every short
  goal. Fifty reference occupations, none a benchmark goal, set each course's
  hub score (`scripts/career/embed-courses.mjs`).
- Known gaps (above): dentistry, "elementary" teaching versus elementary
  language courses, physical therapy at UGA, nursing.

### Later

The overnight research in `keep-planner/career/` (pathways.json,
skills.json) maps careers to skills and course pathways. It could sit on top
of this: name the skills a goal needs, embed those instead of the bare
career word, and fill the gaps the model has (dentistry, nursing) with
words a person checked.
