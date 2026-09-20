# Contributing

Thanks for helping turn the prototype into a trustworthy planning tool.

## Before you start

1. Pick a narrowly scoped issue with a testable outcome.
2. Note whether your change affects UI, planner rules, program data, or ingestion.
3. For academic requirements, include a source URL, catalog year, and reviewer in the pull request.
4. Keep demo data explicitly labeled. Never present sample capacity or schedule data as live.

## Development workflow

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm run lint
npm run build
```

## Design rules

- Keep academic rules in `lib/planner`, not in components.
- Prefer pure functions for validation, credit allocation, prerequisites, and generation.
- Every warning should say what happened, why it matters, and which source or rule produced it.
- Preserve a manual path for every generated action.
- Add accessible controls for any behavior that is also available through drag and drop.
- Avoid adding a chatbot as the primary workflow.

## Pull request checklist

- The change is small enough to review in one sitting.
- New rule behavior has focused tests, or the pull request explains the current test gap.
- Loading, empty, and error states are covered when data access changes.
- Volatile data includes `capturedAt` or equivalent provenance.
- Screens and copy remain clear that the product is unofficial.
