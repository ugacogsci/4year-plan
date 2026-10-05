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

`compare.mjs <before.jsonl> <after.jsonl> [--top N | --all]` prints the totals
per metric and every degree and goal that got worse, worst first.

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
