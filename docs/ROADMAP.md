# Roadmap

## Milestone 1: trustworthy manual planner

- Validate one program and one catalog year with an advisor
- Model requirement groups, alternatives, prerequisites, and double-counting rules
- Add rule-engine unit tests and fixtures
- Persist named plans through a repository interface
- Import a small, repeatable course-catalog snapshot
- Run five student usability sessions

## Milestone 2: generated starter plans

- Define hard and soft constraint contracts
- Generate two or three explainable candidate paths
- Show why each course was placed and what can replace it
- Add schedule, offering-frequency, and course-load constraints
- Compare generated plans against advisor-created fixtures

## Milestone 3: current-term decisions

- Ingest sections, meeting times, capacity, instructor, and location with timestamps
- Add time-conflict and travel-time checks
- Notify users when a volatile plan assumption changes
- Establish freshness targets and graceful stale-data behavior

## Parallel work packets

`Requirements`: encode and verify the Cognitive Science A.B. for one catalog year.

`Rules`: add tests, prerequisite expression trees, double-counting, and substitutions.

`Planner UI`: add keyboard reordering, plan comparison, completed-course management, and richer mobile map controls.

`Data`: inventory official sources and build one idempotent catalog import.

`Discovery`: adapt the current semantic map to consume canonical course IDs from this app.

`Research`: interview students/advisors, prioritize pain points, and test willingness to pay.

## Decisions still needed

- First supported program and catalog year
- Primary launch user: students, advisors, or both
- Reliable and permitted source for current sections and capacity
- Rules for substitutions, transfer credit, exceptions, and double majors
- Authentication timing and privacy policy
- Free versus paid boundary
