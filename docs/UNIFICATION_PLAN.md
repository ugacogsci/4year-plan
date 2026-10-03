# UIUC and UGA unification

## Intended result

One maintained application and deterministic planning engine serves Illinois and
Georgia. Students select their school and programs, confirm prior credit, build
and edit a plan, compare alternatives, and save or export the result. Each school
supplies its own catalog, requirements, credit rules, sources, terminology and
supported adviser capabilities. Unsupported schools remain unavailable.

The existing Illinois and UGA branches are inputs, not competing specifications.
Preserve the Illinois academic checks and advisory tools and UGA's program
selection, graduate planning, plan organization and editing improvements. Keep
school rules explicit; do not infer academic policy from a shared default.

## Baseline and integration strategy

### Student experience and visual structure

1. **University and setup:** one ORION entry screen with Illinois and UGA
   choices. Show the chosen school's identity, degree picker, target finish and
   prior-credit questions. Returning students can resume their saved board.
   Changing university restores that school's setup rather than carrying over
   a degree, transcript equivalency or completed-course list.
2. **Semester board:** retain the semester-column layout, readable course
   cards, credit totals and visible issue/review badges. Course details,
   replacement choices and action menus must not cover the review labels.
   Light and dark themes apply consistently to shared components.
3. **Alternatives and discovery:** tabs and groups organize candidate plans;
   the course map provides exploration without replacing the semester board.
   Each alternative retains its own report and edit history, while newly earned
   course credit cannot remain scheduled elsewhere.
4. **School-specific controls:** Illinois offers its supported academic review,
   teaching priorities, language and comparison tools. UGA offers its program
   combinations, minors, certificates, emphases and graduate choices. Do not
   display unsupported school data as an empty or misleading feature.
5. **Adviser panel:** ALMA for Illinois and ARCH for UGA, using the selected
   school's identity and tools. Distinguish sourced information, proposed edits,
   deterministic warnings and unavailable services. Keep undo available for
   supported board-edit actions.
6. **Trust and continuity:** unresolved requirements remain visible even if
   total credits are sufficient. Changing university is non-destructive; start
   over is explicit and scoped. Local saving, portable export and clear data
   limitations remain part of the product, not hidden implementation details.

### Source control

- Illinois baseline: `4ea69c3`.
- UGA baseline: `be02a98`.
- Main baseline: `2ec0ad7`.
- Integrate in an isolated `codex/unify-school-planners` checkout.
- Reconcile the existing inline `MERGE-UGA` review notes, including clean merges
  that silently change behavior.
- Keep both histories in the final merge. Do not rewrite either school branch.
- Use school selection in one deployment; preserve the existing deployment
  configuration. This task publishes source to main, not a new cloud deployment.

## Work packets and ownership

| Task | Owner | Deliverable | Acceptance evidence |
| --- | --- | --- | --- |
| E1: shared engine | Planning-engine agent | Combined prerequisite, credit, pool, scheduling and elective logic with explicit school policy | Illinois engine/audit suites plus UGA requirement and generation checks |
| W1: workspace and saved state | Workspace agent | One workspace retaining school features, multi-program selection, tabs/groups, review, export and adviser undo | Type checks, persistence regression checks, functional smoke tests |
| U1: interface and onboarding | UI agent | Shared components with consistent props, school/program selection, transcript and prior-credit controls, map and editing interactions | Type checks, lint, map tests, browser checks |
| S1: school adapters | Lead | Common contract and registry for supported schools, catalog/program loading and context, capabilities and identity | Same contract checks run for both adapters; unsupported school rejected |
| S2: transcript and adviser isolation | Lead | Selected-school transcript matching, school-specific prompt and tool selection | Cross-school transcript and adviser regressions |
| Q1: integrated verification | Lead + agents on failures | Repeatable test entry points and review of every integration change | Both schools' suites, production build, browser smoke evidence |
| D1: documentation and release | Lead | Accurate README, architecture, acceptance record; reviewed merge pushed to main | Clean final diff, completed verification record, remote main SHA verified |

## Agent workflow

Each agent owns a disjoint file set, reads both source versions and merge notes,
implements a coherent result, runs relevant checks, and fixes failures. Agents
coordinate shared types and props directly and return evidence to the lead.
Agents do not push or commit. The lead reviews diffs, investigates semantic
regressions, assigns corrections, runs integrated checks and owns the release.

## Definition of done

1. A single source tree builds and offers Illinois and UGA with real catalogs;
   unavailable data produces an honest error, never another school's catalog.
2. Both school adapters satisfy one typed contract for courses, programs,
   planning context, exam-credit source and capabilities. Both use the same
   generation/validation functions and semester-board implementation.
3. Illinois retains its language, residency, admission, college, offering,
   quality, horizon and review behavior. UGA retains its prerequisite numbering,
   equivalent variants, elective ranges, multi-major/minor/certificate/emphasis,
   graduate and undecided behavior.
4. Both schools preserve prior-course and exam credit without cross-school
   matching or duplicate counting. Transcripts are interpreted for the selected
   school. Illinois transfer-guide rules do not leak into UGA records.
5. Adviser identity, university answers and exposed tools match the selected
   school. Required-course confirmation and deterministic edit checks remain.
6. Saved boards, selected programs, tabs/groups and onboarding remain consistent
   per school. Legacy school-specific saves have explicit migration behavior.
   Storage failure does not prevent planning.
7. Type checking, lint, map interaction tests, representative UGA planning tests,
   Illinois regression suites and a production build pass. Browser smoke checks
   cover selecting each school, loading programs and creating/editing a board.
   Live paid model calls are not required for deterministic verification; missing
   credentials must leave a clear disabled state.
8. Every conflict and silent-merge risk is reviewed by the lead. Documentation
   describes the shipped behavior and records any remaining source-data limits.
9. Reviewed commits are merged into main without overwriting concurrent work,
   pushed to origin, and the remote SHA is verified.

## Boundaries

No third school, new student accounts, payment system, institutional certification
or newly scraped catalog is included. Source-data coverage limits remain visible.
Passing software tests establishes regression protection, not official approval
of every university requirement.

## Completion record

Implementation and lead review completed October 3, 2026. Three agents owned
the engine, workspace/persistence and interface work; the lead owned adapters,
transcript/adviser boundaries, release checks and the merge. Agents iterated on
review findings and did not commit or push independently.

### Reviewed integration decisions

- One shared engine and board, with an explicit school context and typed
  adapters; no fallback to another school's catalog.
- Illinois remains single-degree for active planning; its existing college-aware
  comparison tool handles a possible second degree. UGA program combinations
  remain available but do not certify eligibility for multiple degrees.
- Illinois-only career tracks, language/admission rules, transfer guides,
  adviser tools and teaching data are not offered as UGA policy.
- Transcript matching uses the selected school's normalized catalog; overlapping
  exam grants and completed-course credit are counted once.
- School-specific profiles, boards and chats preserve legacy saves. Alternative
  plans keep reports and edits while reconciling shared completed courses.
- The lead's production-browser check caught stale elective-pool warnings after
  completion. The correction preserves original requirement ownership when a
  course moves from planned to earned, without assigning unrelated held credit
  twice. A focused regression covers completion, removal and overlapping pools.
- The existing UGA Cloudflare configuration is retained for the unified source.
  No deployment or model credentials were changed.

### Verification

Final release checks use Node 24 and run in this order:

```sh
npm run typecheck
npm run lint
npm run build
npm run test:full
git diff --check
```

The build must finish before tests read its generated catalog artifacts.
Final results: typecheck passed; lint passed; production build passed;
**28 of 28 suites passed**, including the exhaustive credit audit and the new
completion/pool regression; whitespace/conflict checks passed.

Browser smoke evidence: Illinois Psychology and UGA Computer Science generate
boards; course credit, theme, map, adviser identity and switching schools were
checked. Illinois → UGA → Illinois restores distinct saved plans and courses.
The lead also checked the locally served production build, UGA generation,
alternative creation and completion. Both catalogs return HTTP 200; adviser and
transcript APIs return clear HTTP 503 errors when credentials are absent.
Paid/live model calls were not made.

After the last fix, both saved UGA alternatives were reopened in the production
build: each retained 120 total credits (4 earned + 116 planned), 12/12 displayed
requirements, no scheduled duplicate of CSCI 1301 and no false incomplete-degree
tab error. The browser reported no JavaScript errors.

Release is the merge titled `Unify Illinois and UGA planners behind shared school
adapters`, preserving both school histories. Main is fast-forwarded only from a
clean checkout, pushed without force and checked against the remote commit.

### Remaining limits and follow-up

- Software regression coverage is not an official degree audit. Source-data
  gaps remain visible; the UGA CS MS fixture retains an unread requirement and
  five undergraduate-preparation validation errors inherited from the UGA branch.
- The October 3 dependency audit reports 14 high-severity package entries,
  including transitive tooling. Both branches already used the identical
  lockfile; this integration does not upgrade dependencies. Resolve these and
  add public-endpoint abuse controls before a public pilot.
- The production build passes with a large-client-chunk warning and Vinext's
  static-route classification notice. Bundle reduction remains follow-up work.
