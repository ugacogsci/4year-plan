# ORION — Four Year Planner

An unofficial degree-planning application for the University of Illinois
Urbana-Champaign and the University of Georgia. Both schools use one semester
board and deterministic planning engine, with school-specific catalogs,
requirements, credit policies and adviser capabilities.

## What students can do

- Select a university, degree and graduation term.
- Enter completed courses and AP/IB scores, or upload a transcript for review.
- Generate a semester plan and inspect prerequisites, credit loads and gaps.
- Move, remove and replace courses, explore the course map, and undo edits.
- Organize alternative plans into tabs and groups.
- Save locally, resume each school's plan, and import/export a plan file.
- Ask ALMA (Illinois) or ARCH (UGA) about the selected school and the board.

Illinois retains its offering history, language and residency rules, admission
routes, priorities, published syllabi, plan review, adviser packet and
college-aware program comparison. Active Illinois planning uses one degree;
the comparison feature evaluates a second degree using its college's rules.

UGA retains undergraduate and graduate program selection, multiple majors,
minors, certificates, emphasis choices and graduate course-level handling.
Features that need Illinois-only data are not advertised as UGA capabilities.

## Run locally

Use Node 22.13 or newer; Node 24 is used for the integrated verification.

```sh
npm ci
cp .env.example .env.local
npm run dev -- -p 3010
```

The planner works without credentials. `ANTHROPIC_API_KEY` enables transcript
reading and the adviser; `TRU_UPSTREAM` enables sourced university answers.
Missing services return a clear unavailable message. Do not commit credentials.

For an existing Cloudflare deployment, see [Deployment](docs/DEPLOYMENT.md).
Changing university during onboarding serves both schools from one deployment;
maintaining a separate code branch per university is no longer necessary.

## Verification

Run the build before the suites: the build regenerates Illinois artifacts, so
running it concurrently with tests can remove a file while a test is reading it.

```sh
npm run typecheck
npm run lint
npm run build
npm run test:full
```

`npm test` runs all planner checks except the exhaustive credit audit.
`npm run test:full` includes that audit. Each suite gets a separate log in the
temporary directory printed by the runner. Tests read shipped catalog files
and do not require model credentials or external university requests.

The shared-adapter checks exercise the actual browser loaders for both schools,
including missing-data recovery and representative degree generation. Additional
regressions cover school isolation, transcript matching, AP/IB overlaps, saved
plan migration, prerequisites, requirement allocation, map interactions and undo.

## Architecture and ownership

- `lib/planner/schools.ts`: canonical identity, data locations and capabilities.
- `components/planner/school-source.ts`: common typed school-adapter contract.
- `lib/planner/autoplan.ts`: shared generation and validation engine.
- `components/planner/planner-workspace.tsx`: shared board and user actions.
- `lib/planner/saved-board.ts`: school-scoped saved boards and legacy migration.
- `lib/planner/transcript.ts`: local matching and confirmed credit.
- `lib/planner/advisor.ts`: school-selected adviser prompt and tools.

See [Architecture](docs/ARCHITECTURE.md) and the
[unification plan and acceptance record](docs/UNIFICATION_PLAN.md).
The [Illinois reference](docs/ILLINOIS_REFERENCE.md) preserves detailed branch
history; [Integration notes](INTEGRATION.md) describe earlier development.

## Data and known limits

This remains an unofficial planning aid, not an institutional degree audit.
Source snapshots and parser coverage differ by school and program. A completed
credit total does not mean every requirement is satisfied: unresolved
requirements and prerequisite warnings remain visible.

The graduate catalog is particularly incomplete. The representative UGA
Computer Science MS regression deliberately preserves an unresolved requirement
and undergraduate-preparation warnings; it must not be described as a verified
graduate degree plan. Multi-program UGA planning combines parsed requirements;
it does not certify eligibility for a second degree.

Profiles, transcripts after confirmation, plans and chats are stored in this
browser, separately by school. Uploading a transcript sends it to the configured
model for extraction; using the adviser sends the board and conversation. These
API routes do not persist student records server-side. Clearing browser storage
removes local saves; exporting a plan provides a portable backup.

The source of truth remains each university's published catalog and adviser.
AI interprets documents and explains or requests edits; deterministic code
checks the plan.
