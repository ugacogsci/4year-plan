# Roadmap

## Current delivery: unified Illinois and UGA

The implementation and acceptance criteria are in
[UNIFICATION_PLAN.md](UNIFICATION_PLAN.md). Both school histories converge into
one application. Existing school branches remain historical references; shared
fixes should land on main.

## Next: validated student pilot

Before enabling a public pilot, review and resolve the inherited dependency
security advisories. The October 3 integration audit reported 14 high-severity
package entries (including transitive tooling); neither school branch's lockfile
was changed by this integration. Re-audit after targeted upgrades and rerun the
build, browser smoke tests and full planner suite. Keep public model endpoints
disabled until abuse controls and spending limits are in place.

1. Have advisers review representative Illinois and UGA degree fixtures.
2. Record each unresolved parser requirement and distinguish it from a real
   academic requirement that the student has not met.
3. Validate UGA graduate requirements before presenting graduate plans as
   complete; retain preparation warnings until then.
4. Test transfer/exam combinations against reviewed registrar examples.
5. Observe students creating, editing, comparing and exporting plans.

Done for this milestone means a defined set of catalog-year/program fixtures
has human review, regression coverage and documented remaining exceptions.

## After the pilot

- Improve data freshness and source provenance display.
- Reduce initial client bundle size while preserving staged catalog loading.
- Extract more workspace actions into reusable modules as behavior stabilizes.
- Expand school capabilities only when the supporting data and policy exist.
- Add a third school through the common adapter and contract suite.

Accounts, institution integrations and paid plans require a separate product
decision. They are not prerequisites for using or testing this local-save pilot.
