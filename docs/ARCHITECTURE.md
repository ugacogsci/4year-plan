# Architecture

## Guiding idea

The product has two different jobs: determine whether a plan satisfies explicit constraints, and help a person explore good alternatives. Keep those jobs separate. Degree audit and prerequisite logic must be deterministic; semantic similarity and AI-assisted preference interpretation are advisory signals.

## Current slice

```text
React planner workspace
        |
        v
Pure planning functions  <---  Typed domain contracts
        |
        v
Illustrative in-memory catalog and program definition
```

The current app runs without accounts or a backend. Profiles and plans can be saved to local browser storage for demo purposes. `lib/planner/rules.ts` owns calculations and warnings. Components render the setup rail, four-year board, live checks, and integrated semantic course finder while dispatching user actions.

## Target shape

```text
Web client
   |
   v
Planner API  --->  Planning and audit engine
   |                    |
   v                    v
Postgres            Versioned requirement definitions
   ^
   |
Scheduled ingestion jobs ---> source snapshots + provenance
```

Suggested early stack:

- React/TypeScript client
- A small TypeScript or Python API, chosen by the team maintaining ingestion and optimization
- Postgres through a low-cost managed provider
- Scheduled GitHub Actions or provider cron jobs for refreshes
- Object storage only if raw snapshots become too large for the database

Do not introduce microservices at this stage. One deployable API with clear modules is enough.

## Core modules

`catalog`: canonical courses, aliases, credits, descriptions, and prerequisite expressions.

`programs`: catalog-year-specific programs and requirement trees.

`sections`: term-specific sections, meetings, instructors, capacity, and snapshot timestamps.

`plans`: user-authored terms, completed courses, preferences, and manual overrides.

`audit`: requirement allocation, prerequisites, residency rules, credit totals, and explanations.

`generator`: proposes plans under hard constraints and ranks alternatives using soft preferences.

`discovery`: embeddings, similarity, semantic clusters, and career/interest metadata.

## Planning contract

A future generator should accept a versioned input and return multiple scored candidates:

```ts
interface GeneratePlanInput {
  programIds: string[];
  catalogYear: string;
  completedCourseIds: string[];
  graduationTerm: string;
  preferences: {
    creditRange?: [number, number];
    avoidDays?: string[];
    preferredFormats?: string[];
    interests?: string[];
  };
}
```

Hard constraints include prerequisites, required courses, credit limits, term availability, and graduation date. Soft constraints include instructor preference, location, modality, class size, and interest similarity. Every proposed plan should carry human-readable reasons and unresolved assumptions.

## Data versioning

Never overwrite a volatile fact without retaining its source and capture time. Program rules should be keyed by catalog year. Section and capacity records should be append-only snapshots or otherwise auditable. Plans should record the requirement version against which they were last checked.

## Privacy

The demo has no accounts. Before storing real student data, define the minimum data required, retention and deletion behavior, access controls, incident response, and whether any integration brings the system under FERPA or institutional policy. Avoid collecting grades or identifiers unless they are genuinely needed.
