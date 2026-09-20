# Four Year

An unofficial, visual degree-planning prototype for University of Georgia students and advisors. It combines an editable semester-by-semester plan with a constellation-style course finder descended from the existing Semantic Course Map.

This repository is a first-iteration skeleton. Its data and degree requirements are illustrative and must not be used as academic advising.

## What works

- All eight terms visible in one four-year planning board
- Drag-and-drop from the course map or between terms, plus menu-based moves
- Course removal, semantic-map search, requirement-compatible swaps, and undo
- Live checks for prerequisites, credit load, typical offering, sample capacity, and travel notes
- Inputs for three primary majors, a second major, minors, certificates, graduation term, career interests, format/time preferences, and scholarship targets
- Requirement and total-credit progress that changes with the selected primary major
- Prior-course entry through the same course finder
- Device-local save and restore for both the profile and plan
- Collapsible constellation explorer with cluster filters and prerequisite paths
- Responsive layout for desktop and mobile

## Placeholder coverage

The MVP labels its incomplete data in the interface. The Computer Science and Psychology requirement sets, every second-major/minor/certificate rule, scholarship thresholds, live capacity/meeting/location/travel signals, and generated plan are placeholders. Cognitive Science is reviewed demo content, not an official audit. The UGA Bulletin, DegreeWorks, and an advisor remain the source of truth.

Career, format, class-time, and target-GPA inputs are saved but do not rank or regenerate the sample plan yet. The scholarship minimum-credit input does drive live term-load warnings.

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

For deployed social links, set `NEXT_PUBLIC_SITE_URL` to the public origin. The
local fallback is `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Project map

```text
app/                         Route, metadata, and global theme
components/planner/          Planner UI and interaction components
components/ui/               Reusable shadcn interface primitives
lib/planner/types.ts         Domain contracts
lib/planner/rules.ts         Pure validation and progress logic
lib/planner/sample-data.ts   Clearly labeled demo catalog and plan
data/programs/               Example requirement-definition format
docs/                        Architecture, roadmap, and data-source notes
```

The prototype intentionally keeps domain rules outside React. A future API or optimizer can call the same planning functions without coupling itself to the current interface.

## Good first contributions

- Add unit tests around `lib/planner/rules.ts`
- Replace one illustrative requirement group with advisor-reviewed structured data
- Introduce a repository interface for courses and plans, keeping the sample adapter as a fallback
- Add keyboard reordering and richer drag feedback
- Connect a read-only subset of the semantic-course-map data through an import script
- Prototype one constraint-solver strategy behind a stable `generatePlan()` interface
- Interview 3-5 students or advisors and turn recurring needs into issues

Read [CONTRIBUTING.md](./CONTRIBUTING.md), [Architecture](./docs/ARCHITECTURE.md), and [Roadmap](./docs/ROADMAP.md) before expanding a major area.

## Important boundaries

- The planner must remain explainable and deterministic. An LLM can interpret preferences or explain results, but it should not decide whether a student can graduate.
- Store source timestamps and provenance with every volatile fact.
- Treat instructor reviews and third-party data as optional enrichment; confirm legal and technical access before building around them.
- Do not collect student records or sensitive academic data until authentication, privacy, retention, and FERPA implications have been reviewed.
- Keep this product clearly labeled as unofficial until UGA authorizes otherwise.

Course titles and the constellation logo in the demo were selected from the existing `semantic-course-map` project. They are copied into this repository, so there is no runtime dependency and the original project is not modified.
