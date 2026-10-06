# The all-degrees sweep

The checks in `lib/planner/` pin named students. This sweep builds every
Illinois degree three ways and compares two checkouts board by board, which is
how the year-one work was held to "no degree made worse": a check that passes
can still hide a Biochemistry board that lost its senior seminar.

`sweep.mjs <planner checkout> <out.jsonl>` builds 1,848 boards: 308 degrees x
no goal / "medical school" / "physical therapy school" x two language starts
(two semesters owed, language done), a Fall 2026 freshman with no credit. Each
row records terms, courses per term, credits past the total, not placed,
unsatisfied requirements, validator issues, first-year loads, hardest-band
stacks, momentum flags, track rows late, seminars and the first math. About
five minutes with 7 workers (Node 23; it re-runs itself with
`--experimental-strip-types`).

`compare.mjs <before.jsonl> <after.jsonl> [--top N | --all]` opens with the
scoreboard (the headline numbers before and after, and the same without the
suspended ESES degree), prints the totals per metric and every degree and
goal that got worse, worst first, and ends with the three-level verdict.

Beside every sweep, `sweep.mjs` writes `<out>.blocks.jsonl`: every
requirement block as that checkout reads the pages (`blocks.mjs`). compare
judges both boards on the after sweep's file, "the new reading" (or
`--reading <file>`); `--checkout <dir>` gives the credits, prerequisites and
lab pairs (default: this checkout).

What the scoreboard counts, so a number can be trusted:

- A requirement split into option lists (`::3::0` -> `::3::0::opt1`) is the
  same requirement, not a new unmet one.
- Pre-med and pre-PT rows are measured on both boards with the release's own
  row list (the before sweep's `trackRows`): a change to `career-tracks.ts`
  cannot move the yardstick.
- A pool counts both halves of a pair (STAT 400 & STAT 410).
- The release's pre-health Composition I row (RHET 105) is met by the CMN
  111-112 sequence too, as the row's own description says; the catalog will
  not credit RHET 105 beside it (gate.mjs ROW_SEQUENCES).
- Year one is the plan's first two falls and springs, counted from its own
  first term, never the school's academic year. A validator warning
  "Composition I after the first year" on a board whose Composition I began
  in year one (CMN 112 after CMN 111 on a spring start) is not counted as a
  year-one loss; the scoreboard still shows how many plans carry it.
- An extra term is worse only when the board now finishes after the
  student's target term.
- Two sweeps with different start terms are refused (`--mixed-starts`).

`gate.mjs <before.jsonl> <after.jsonl> [--list] [--json out]` is the
three-level verdict alone (the owner's rule of 2026-10-06, ported from the
research's gatepolicy.py): never worse on errors, prerequisite order, labs
apart from lectures or a finish after the target; a board that meets more
real requirements may be worse on term shape, and on credits past the total
or pre-med/PT rows only when the arithmetic forces it; a board that meets
fewer real requirements is always blocked. Each changed board is accepted,
blocked or sent to engine work. On the research's sweeps of the parked split
(c47de54b -> cdc06dd9) it gives 629 accepted, 5 blocked and 196 engine work.

`takeall.mjs <blocks.jsonl>` lists the take-all blocks that hold two courses
the catalog will not credit together, the mark of an option list read as
"take every course" (64 at illinois-2 715d894). `blocks.mjs` prints the count
too.

**Every plan-changing step reports two sweeps**, each against its own
baseline: the default Fall 2026 start and `SWEEP_START="Spring 2027"`, which
is what a student building a plan today gets. On this 8 GB Mac run at most two
sweeps at a time (`SWEEP_JOBS=3` each).

Environment: `SWEEP_JOBS` (workers), `SWEEP_IDS` (only these degree ids),
`SWEEP_GOALS`, `SWEEP_LANGS`, `SWEEP_STUDYING` (studying words joined into the
interests as the workspace does), `SWEEP_PLAIN=1` (build with the plain engine
the year-one gate compares against), `SWEEP_NOTES=1` (keep plan notes),
`SWEEP_START="Spring 2027"` (start there instead of Fall 2026, finishing eight
falls and springs later: what a student who builds a plan after the fall add
deadline gets).

To compare against an older commit, sweep a detached worktree of it:

```
git worktree add --detach /tmp/planner-base <commit>
ln -s "$PWD/node_modules" /tmp/planner-base/node_modules
node scripts/dev/sweep/sweep.mjs /tmp/planner-base /tmp/base.jsonl
node scripts/dev/sweep/sweep.mjs . /tmp/head.jsonl
node scripts/dev/sweep/compare.mjs /tmp/base.jsonl /tmp/head.jsonl
```
