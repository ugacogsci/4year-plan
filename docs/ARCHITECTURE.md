# Architecture

ORION has one shared React workspace and deterministic planning engine.
School-specific data and policy enter through explicit adapters.

```text
School registry (identity, sources, capabilities)
              |
School adapter (Illinois or UGA)
  catalog / programs / planning context
              |
Shared generatePlan / validatePlan
              |
Semester board / progress / alternatives / adviser edits
              |
School-scoped local saves and portable exports
```

## School boundary

`lib/planner/schools.ts` is safe to import on the server and client. It defines
supported schools, names, catalog and exam-credit locations and capabilities.

`components/planner/school-source.ts` defines `SchoolAdapter<Data, Summary>`.
Each implementation provides `load`, `courses`, `programs`, `context` and
`loadProgram`. Program results share `SchoolProgram`: summary, normalized
requirements, requirement blocks, source URL and optional elective policy.
The existing staged source hooks remain for progressive loading; workspace
program loading and context construction use the adapters.

Illinois loads generated shards through `illinois-load.ts`, parses published
requirements and retains richer language, offering, admission and grade data.
UGA normalizes joint listings and four-digit course variants, program choices
and prerequisites in `uga-source.tsx`. Neither loader substitutes another
school's catalog after a failure.

`PlanningContext.schoolId` makes differing elective policies explicit.
Prerequisite, credit, requirement and validation contracts remain shared.
Omitted school IDs preserve historical Illinois library callers; production
adapters always supply one.

## Workspace and state

The workspace combines UGA majors/minors/certificates and emphasis choices.
Illinois actively plans one degree and uses its published college rules for
second-program comparisons. A tab holds both its course plan and the generation
report, notes and editing provenance. Switching tabs must not discard which
courses are required, electives or student-added.

Saved boards use `fourYear.board.v4.<school>`; a legacy global v4 alias and UGA
v3 entries migrate without deleting another school's save. Profiles and chats
are school-scoped as well. A save is validated before restoration. Storage
failure leaves session planning available.

School changes retain saved work. Starting over explicitly resets only the
current school. Imported plans must belong to the selected school and reference
its catalog/programs.

## Transcript and adviser boundary

Transcript requests carry a supported school ID. The reader extracts printed
facts, while local code matches against that school's normalized catalog.
Matching codes from an unrelated institution are never automatically accepted
as home-university courses. Illinois transfer guides and composition sequences
apply only to Illinois. AP/IB grants count a course once across overlapping exams.

Adviser requests carry the school ID. The server derives the name and available
tools from supported metadata. UGA never receives Illinois admission, transfer
guide, exam-policy or syllabus tools it cannot execute. Shared board edits use
the same deterministic checks as manual edits. Illinois retains its extended
review and per-turn undo.

## Verification and future schools

Run `npm run build` before `npm run test:full`; build regeneration and tests
must not run concurrently. The adapter tests load the real browser data path,
then run the shared engine. Missing-file tests, school isolation and migration
tests guard boundaries that cannot be proven by type checking alone.

A third school needs an adapter, source snapshots, declared capabilities and
the same contract tests. Add its identity only as available when its data and
planning behavior are verified. New academic rules belong in explicit adapter
policy or a documented common contract, not display-name comparisons.
