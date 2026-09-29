# Work in progress, parked on this branch

Two packages were cut off mid-way by a usage limit. Their edits touch the
planning engine, so they are kept here as patches rather than applied: the app
on this branch is unchanged by them. Both were made against 87bb1bd and apply
cleanly to the current branch with a three-way apply:

```
git apply --3way wip/speed.patch
git apply --3way wip/fillers.patch
```

`speed.patch`: faster rebuilds without changing any board. Since the year-one
gate, generatePlan builds a plain board beside the improved one, so a rebuild
does the work at least twice. Goal: p95 under 400 ms and max under 1 s in Node,
with every board identical to before (prove it with `scripts/dev/sweep`: the
two sweeps must match on terms, codes, notes, not placed, unsatisfied,
validator issues and review flags). Touches autoplan.ts, illinois-data.ts and
quality.ts. Unfinished and unverified.

`fillers.patch`: the last filler and chooser problems from a Finance test. The
fill still books restricted seminars (BUS 315 Junior Gies Scholar Seminar,
FSHN 123 FSHN Orientation to Illinois, BIOE 100, FSHN 249); the card dropdown
still offers LAS 102 for LAS 100 and ESL 115 for RHET 105; and plan notes
promise a 'pick a value' control for variable-credit courses that does not
exist. Touches autoplan.ts, repick.ts, planner-workspace.tsx and four checks.
Unfinished and unverified.

The syllabus scraper in `scripts/illinois/syllabi/` is also unfinished: its
fetcher, robots, cache, catalog, terms and text libraries and the PDF helper
exist; classification, fact parsing, course matching, the source adapters, the
crawl and the build of `public/illinois/syllabi.json` do not. Its design (32
public sources, coverage estimates, run plan) came from a research pass;
`import-research.mjs` expects that pass's downloads, which lived only on the
Mac that ran it, so on a fresh machine skip it and let the crawl fetch them.
Canvas is excluded until the student decides; Box files are listed, never
downloaded.

Delete this folder once both patches are either merged or dropped.
