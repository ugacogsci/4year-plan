/**
 * Georgia Tech, every degree, the way the browser plans it.
 *
 * The CourseLeaf engine was written against Illinois. This asks what it does
 * with Georgia Tech's data, degree by degree, so the gaps are counted rather
 * than sampled: for every program record that has a requirement table (the
 * degree pages, and every thread, option and concentration page), a fresh
 * student's plan is generated from Fall 2026 to Spring 2030 and measured for
 *
 *   - whether a plan was built at all (a throw is a failure)
 *   - requirement rows the plan left open, and courses it could not place
 *   - rows the adapter could not read, by kind: text it quotes, hours that
 *     name no course, a pool with no size, anything Illinois-only (the campus
 *     gen-ed table, the language rule) that should never reach Georgia Tech
 *   - rows naming a course the catalog does not have
 *   - plans under the published total, and plans over it with the hours past
 *   - rows the board's rail shows incomplete, split by whether the plan also
 *     reports the shortfall (a course it could not place) or reports nothing
 *   - prerequisite violations: a course placed before (or, for a corequisite,
 *     without) what its prerequisite sentence asks for, apart from a group the
 *     exclusion rule shut, which the plan notes for an advisor (counted apart)
 *   - offering-season violations: a course placed in a season it has not run
 *     in over the nine crawled terms, or one that has not run at all
 *   - exclusion violations: two courses whose credit does not both count
 *
 * Everything is loaded the way the browser loads it (lib/planner/__plan-audit
 * explains why): the built artifacts in public/gatech/ (index.json through
 * hydrateIndexRow, prereqs.json, exclusions.json, offerings.json, and each
 * program/<id>.json through adaptIllinoisPrograms), never the raw crawl.
 *
 * It prints a table, one line per degree, then the totals and the unread rows
 * by kind with examples. Exit 0 when public/gatech/meta.json is absent ("no
 * gatech data"), so the suite stays green on a checkout without Georgia Tech.
 * Exit 1 when a plan throws, a plan holds an exclusion pair, an
 * Illinois-only row (campus gen-ed, language rule) reaches a Georgia Tech
 * degree, or the engine reads this catalog as anything but Georgia Tech's
 * (autoplan.ts courseleafOfContext, which carries Georgia Tech's switches in
 * school-config.ts to the placer); the other counts are a report, not a gate.
 *
 *   node lib/planner/__gatech-inventory.check.mjs
 *   GATECH_ONLY=computing/computer-science-bs/... node lib/planner/__gatech-inventory.check.mjs
 *   (QUALITY_ONLY=<id> works too, as in __schedule-quality)
 *   GATECH_SHOW=1   also print each plan, term by term
 *   GATECH_JSON=<path>   also write the per-degree records
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { register } from 'node:module';

/*
 * GATECH_TREE=<checkout> runs this script's measure over another copy of the
 * code and data (a frozen baseline), so a before and after are counted the
 * same way. Default: the checkout this file is in.
 */
const TREE = process.env.GATECH_TREE ? resolvePath(process.env.GATECH_TREE) : join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(TREE, 'lib', 'planner');
const PUBLIC = join(TREE, 'public');
const OUT = join(PUBLIC, 'gatech');

if (!existsSync(join(OUT, 'meta.json'))) {
  console.log('no gatech data: public/gatech/meta.json is absent (run scripts/gatech/build-index.mjs), so there is nothing to check.');
  process.exit(0);
}

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// Extensionless and '@/' imports as the app writes them (components/planner/live-pools.ts uses '@/').
const ROOT_URL = pathToFileURL(`${TREE}/`).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('@/')) spec = ${JSON.stringify(ROOT_URL)} + spec.slice(2); if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const { generatePlan, validatePlan, courseleafOfContext, distinctHeld, heldTowardDegree } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, setCourseNumberDigits, CAMPUS_GENED_AREA_LABEL } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { courseleafOf } = await import(join(HERE, 'school-config.ts'));
const { illinoisProgress } = await import(join(TREE, 'components', 'planner', 'illinois-progress.ts'));
const { livePools } = await import(join(TREE, 'components', 'planner', 'live-pools.ts'));
// What each card says it is on the board, the print packet and to TOWER (planner-workspace.tsx electiveOf, roleOf).
const { planMarks } = await import(join(HERE, 'repick.ts'));
const { cardRole } = await import(join(HERE, 'advisor-packet.ts'));

const LEAF = courseleafOf('gatech');
setCourseNumberDigits(LEAF.numberDigits, LEAF.letterSuffix);

const read = (n) => (existsSync(join(OUT, n)) ? JSON.parse(readFileSync(join(OUT, n), 'utf8')) : null);
const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

const meta = read('meta.json');
const index = (read('index.json') ?? []).map(hydrateIndexRow);
const offeringsFile = read('offerings.json');
if (offeringsFile) applyOfferings(index, offeringsFile);
const prereqs = new Map(Object.entries(read('prereqs.json') ?? {}));
const exclusions = new Map(Object.entries(read('exclusions.json') ?? {}));
const summaries = read('programs.json') ?? [];
/** Both directions of every exclusion pair, the way the engine reads them (autoplan.ts buildConflicts). */
const conflicts = new Map();
for (const [a, others] of exclusions) for (const b of others) {
  for (const [x, y] of [[normCode(a), normCode(b)], [normCode(b), normCode(a)]]) conflicts.set(x, new Set([...(conflicts.get(x) ?? []), y]));
}
/** A prerequisite group every course of which the catalog will not credit beside one already held (autoplan.ts groupClosedByExclusion). */
const closedBy = (group, held) => {
  let by = null;
  for (const raw of group.any) {
    const hit = [...(conflicts.get(normCode(raw)) ?? [])].find((other) => held.has(other));
    if (!hit) return null;
    by ??= hit;
  }
  return by;
};
const byCode = new Map(index.map((c) => [normCode(c.code), c]));

// The browser's buildContext (components/planner/illinois-source.tsx), for a school with no grades or sections.
const equivalents = new Map();
for (const c of index) if (c.twins?.length) equivalents.set(normCode(c.code), c.twins.map(normCode));
const creditRanges = new Map();
for (const c of index) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(normCode(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const offerings = offeringsFile ? new Map(Object.entries(offeringsFile.courses)) : null;
const context = {
  courses: index,
  prereqs,
  grades: new Map(),
  sections: undefined,
  equivalents: equivalents.size > 0 ? equivalents : undefined,
  exclusions,
  creditRanges,
  bands: meta?.bands ?? null,
  offeringPublished: offeringsFile ? new Set(index.map((c) => normCode(c.code))) : new Set(),
  offerings: offerings ?? undefined,
  offeringTerms: offeringsFile ? offeringsFile.terms : undefined,
  offeringAliases: offeringsFile?.renumbered ? new Map(Object.entries(offeringsFile.renumbered)) : undefined,
  snapshotTerm: null,
  gradeFootnote: meta?.gradeFootnote ?? null,
  prereqCheck: (spec, earlier, sameTerm, eq) => missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, eq),
};

/*
 * GATECH_CURRENT=1 builds each board the way the browser does for a
 * first-year student today (November 2026), with nothing entered for the
 * semester in progress: Fall 2026 is the current-semester column, the plan
 * runs Spring 2027 to Spring 2030 (seven terms), and Fall 2026 counts as
 * about 15 credits until the student adds those classes (plan-start.ts
 * horizonFor: assumedHours, currentAssumedHours; planner-workspace.tsx adds
 * them to the prior credit's hours). The default plans Fall 2026 as an
 * ordinary first term, which no first-year board in the browser does.
 */
const CURRENT = Boolean(process.env.GATECH_CURRENT);
const ASSUMED_NOW = CURRENT ? 15 : 0;
const HORIZON = CURRENT
  ? {
      startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2030, stated: false,
      began: { season: 'Fall', year: 2026 }, beganFrom: 'words', assumedTerms: [{ season: 'Fall', year: 2026 }],
      assumedHours: ASSUMED_NOW, current: { season: 'Fall', year: 2026 }, currentAssumedHours: ASSUMED_NOW, startNote: null, gradPassed: null,
    }
  : { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
/*
 * GATECH_PRIOR="MATH 1551,MATH 1552,CS 1301" plans every degree for a student
 * who walks in holding those courses (AP Calculus BC 5 and AP Computer
 * Science A 5 give exactly these), the way a board with exam credit is built:
 * the held codes are prior credit, never booked again, and counted by the rail.
 */
const PRIOR_CODES = (process.env.GATECH_PRIOR ?? '').split(',').map((c) => normCode(c)).filter(Boolean);
const NO_PRIOR = { courseCodes: PRIOR_CODES, exemptCodes: [], unmatchedCredits: ASSUMED_NOW, known: true };
const SEASON_OF_TERM = { fa: 'Fall', sp: 'Spring', su: 'Summer', wi: 'Winter' };

// ---------------------------------------------------------------------------
// What kind of row the adapter made of each requirement
// ---------------------------------------------------------------------------

const FREE = /\bfree\s+electives?\b/i;
const HOURS_WORDS = /\b\d{1,2}\s*(?:-\s*\d{1,2}\s*)?(?:credit\s*)?(?:hours?|hrs?|credits?)\b/i;
const CODE_WORDS = /\b[A-Z]{2,4}\s?\d{4}[A-Z]?\b/;

/** The crawled group a block was read from (block ids are <program>::<area>::<group>[::suffix]). */
function rawGroupOf(raw, block) {
  const [, ai, gi] = block.id.slice(raw.id.length).split('::');
  return raw.areas?.[Number(ai)]?.groups?.[Number(gi)] ?? null;
}

/** 'read' for a row the engine can plan, else the kind of row it could not read. */
function rowKind(block, group) {
  const rule = block.rule;
  if (block.areaLabel === CAMPUS_GENED_AREA_LABEL) return 'Illinois campus gen-ed area (must be none)';
  switch (rule.kind) {
    case 'all':
    case 'choose':
      return rule.choices.length > 0 ? 'read' : 'course list with no course in the catalog';
    case 'pool':
      if (rule.choices.length === 0) return 'pool with no course in the catalog';
      return rule.hours !== null || rule.n !== null ? 'read' : 'pool with no size';
    case 'hours':
      if (rule.genEd && rule.genEd.length > 0) return 'Illinois gen-ed hours (must be none)';
      if (FREE.test(`${rule.label ?? ''} ${block.label ?? ''} ${block.areaLabel ?? ''}`)) return 'read';
      return 'hours that name no course (filled with electives)';
    case 'gened':
      return 'Illinois gen-ed category (must be none)';
    case 'language':
      return 'Illinois language rule (must be none)';
    case 'unparsed': {
      // Hours the page prints beside the words (the group's own, or a comment row's) make it a requirement.
      const sized = (group?.hours ?? 0) > 0 || (group?.comments ?? []).some((c) => (c.hours ?? 0) > 0);
      if (sized) return 'text with hours beside it the adapter could not read';
      return HOURS_WORDS.test(rule.text) || CODE_WORDS.test(rule.text) || /^\s*(?:select|choose|any|lab science)\b/i.test(rule.text)
        ? 'text naming hours or courses the adapter could not read'
        : 'note (names no hours and no course)';
    }
    default:
      return `unknown rule kind ${rule.kind}`;
  }
}

// ---------------------------------------------------------------------------
// Tallies
// ---------------------------------------------------------------------------

const tally = new Map();
const note = (bucket, program, text) => {
  const t = tally.get(bucket) ?? { n: 0, programs: new Set(), examples: [] };
  t.n += 1;
  t.programs.add(program);
  if (t.examples.length < 5) t.examples.push(text);
  tally.set(bucket, t);
};

const only = process.env.GATECH_ONLY ?? process.env.QUALITY_ONLY ?? null;
const withTables = summaries.filter((s) => (s.areaCount ?? 0) > 0 && (!only || s.id === only));
const menus = summaries.filter((s) => (s.areaCount ?? 0) === 0);
const records = [];
let threw = 0;
let exclusionViolations = 0;
const started = Date.now();

for (const summary of withTables) {
  const raw = read(`program/${summary.id}.json`);
  if (!raw) {
    note('program file missing from public/gatech/program', summary.id, summary.id);
    continue;
  }
  const adapted = adaptIllinoisPrograms({ school: 'gatech', source: summary.url ?? '', fetchedAt: '', programs: [raw] }, new Map(byCode));
  const program = adapted.programs[0];
  const blocks = adapted.blocks.get(summary.id) ?? [];
  const rec = {
    id: summary.id,
    name: summary.name,
    total: program?.totalCredits ?? null,
    planned: null,
    blocks: blocks.length,
    unread: 0,
    missingCodes: adapted.dropped,
    unsatisfied: 0,
    notPlaced: 0,
    prereq: 0,
    closedPrereq: 0,
    season: 0,
    neverRan: 0,
    exclusion: 0,
    rail: 0,
    under: false,
  };
  records.push(rec);
  if (adapted.dropped > 0) note('rows naming a course the catalog does not have (dropped)', summary.id, `${summary.id}: ${adapted.dropped} rows`);
  for (const block of blocks) {
    const kind = rowKind(block, rawGroupOf(raw, block));
    if (kind === 'read' || kind.startsWith('note')) {
      if (kind.startsWith('note')) note(`row kind: ${kind}`, summary.id, `${summary.id}: ${block.label}: ${(block.rule.text ?? '').slice(0, 90)}`);
      continue;
    }
    rec.unread += 1;
    const words = block.rule.kind === 'unparsed' ? block.rule.text : block.rule.label ?? block.note ?? '';
    note(`unread: ${kind}`, summary.id, `${summary.id} [${block.areaLabel}] ${block.label}: ${String(words).replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  if (!program || blocks.length === 0) {
    note('no requirement blocks', summary.id, summary.id);
    continue;
  }

  let result;
  try {
    result = generatePlan({
      requirements: blocks,
      context,
      prior: NO_PRIOR,
      horizon: HORIZON,
      programId: summary.id,
      preferences: { creditsPerTerm: { min: 12, target: null, max: 18 } },
      degreeTotal: program.totalCredits ?? null,
      programName: program.name,
      // college rules are Illinois's (school-config collegeRules false): the workspace passes no college.
    });
  } catch (e) {
    threw += 1;
    note('generatePlan threw', summary.id, `${summary.id}: ${e.message}`);
    continue;
  }
  // Held courses count toward the total, as the board's headline counts them.
  // So do the about 15 credits counted for the semester in progress (GATECH_CURRENT), as the headline adds them.
  /*
   * A held course the plan forfeits (GeneratedPlan.forfeited: a required
   * course the catalog will not credit beside it, said in the notes) counts
   * for nothing, as the headline and the rail read it (planner-workspace.tsx
   * leaves it out of the held courses it hands illinoisProgress).
   */
  const forfeitedHeld = new Set((result.forfeited ?? []).map((f) => normCode(f.held)));
  /*
   * The held courses as the workspace reads them: the plan's own held list
   * (GeneratedPlan.plan.completedCourseIds, which names a cross-listed class
   * by both its numbers), each class once (distinctHeld), none forfeited, as
   * planner-workspace.tsx hands livePools (completedCodes) and the rail
   * (towardDegree). ME 1670 held read 15 of 18 on Mechanical Engineering's
   * Field of Study in the browser, where the workspace kept its twin CEE 1770.
   */
  const idToCode = new Map(index.map((c) => [c.id, normCode(c.code)]));
  const completedCodes = [...new Set((result.plan?.completedCourseIds ?? []).map((id) => idToCode.get(id)).filter(Boolean))];
  const towardDegree = heldTowardDegree(distinctHeld(completedCodes.filter((c) => !forfeitedHeld.has(c)), context).codes, program.college, blocks).codes;
  rec.forfeited = [...forfeitedHeld];
  /*
   * A board that holds the semester in progress as a planned term
   * (school-config planEmptyCurrentTerm, GATECH_CURRENT) counts nothing
   * assumed for it: the workspace shows no second column for that term and
   * adds no assumed hours (horizonFor boardTerms, assumedCredit).
   */
  const holdsNow = CURRENT && result.terms.some((t) => t.label === 'Fall 2026');
  rec.holdsNow = holdsNow;
  const assumedHere = holdsNow ? 0 : ASSUMED_NOW;
  rec.planned = result.credits.planned.min + towardDegree.reduce((n, c) => n + (byCode.get(c)?.credits ?? 0), 0) + assumedHere;
  rec.unsatisfied = result.unsatisfied.length;
  // Open rows that are only hours the elective cards fill ("Free Electives: 11 hours"), which are not shortfalls;
  // not one the plan says waits on the semester in progress (GATECH_CURRENT), which it reports open.
  rec.unsatisfiedFilled = result.unsatisfied.filter((u) => u.reason === 'filled-by-electives' && !u.waitingOn).length;
  rec.waiting = result.unsatisfied.filter((u) => u.waitingOn).length;
  rec.notPlaced = result.notPlaced.length;
  for (const u of result.unsatisfied) note(`unplaced requirement: ${u.reason}`, summary.id, `${summary.id}: ${u.label}: ${(u.message ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
  for (const np of result.notPlaced) note(`course not placed: ${np.reason}`, summary.id, `${summary.id}: ${np.code}${np.detail ? ` ${String(np.detail).slice(0, 80)}` : ''}`);
  if (rec.total && rec.planned < rec.total - 0.5) {
    rec.under = true;
    note('plan under the published total', summary.id, `${summary.id}: ${rec.planned} of ${rec.total}`);
  }

  /*
   * The board's own verdict. The rail and the red "This plan does not fulfill
   * the degree yet" row (planner-workspace.tsx `areas` and `issues`) count the
   * plan with components/planner/illinois-progress.ts and live-pools.ts, not
   * with the generation's unsatisfied list, and the two can disagree: a Lab
   * Science row the plan filled with BIOS 1107 and its lab 1107L read 6 of 8
   * hours on the rail. Counted here the way the board counts it, for a
   * student with nothing held, so a row the student would see as incomplete
   * is a number, not a screenshot.
   */
  {
    const boardCodes = result.terms.flatMap((term) => term.codes.map(normCode));
    const pools = livePools({ base: result.pools ?? [], blocks, boardCodes, priorCodes: completedCodes, context });
    const rows = illinoisProgress({
      blocks, boardCodes, priorCodes: towardDegree, byCode, pools,
      language: result.language ?? null,
      satisfiedByPriorCredit: result.satisfiedByPriorCredit ?? [],
      equivalents: context.equivalents,
      degreeTotal: program.totalCredits ?? null,
      priorHours: 0, // held courses are counted through priorCodes
      genEdCredits: [],
      programName: program.name,
      // The semester in progress the workspace names to the rail (GATECH_CURRENT).
      currentTerm: CURRENT && !holdsNow ? { label: 'Fall 2026', assumedHours: ASSUMED_NOW } : null,
    });
    /*
     * Every row the rail shows open, whatever its unit: a row sized in
     * courses ("Select three", "1/1 course") has area.hours 0, and counting
     * only rows with hours left Civil Engineering Transportation's
     * "Concentration Electives 2/3 course" out of this column.
     */
    const railShort = [
      ...rows.filter((row) => !row.satisfied && ((row.needed ?? 0) > 0 || row.area.hours > 0)).map((row) => `${row.area.label} ${row.earned}/${row.needed ?? row.area.hours} ${row.unit ?? 'hr'}`),
      ...pools.filter((pool) => (pool.hoursTarget !== null && pool.hours < pool.hoursTarget) || (pool.countTarget !== null && pool.count < pool.countTarget))
        .map((pool) => `${pool.label} (list) ${pool.hoursTarget !== null ? `${pool.hours}/${pool.hoursTarget} hr` : `${pool.count}/${pool.countTarget} courses`}`),
    ];
    rec.rail = railShort.length;
    rec.railShort = railShort;
    // Rows the rail says wait on the semester in progress's classes (GATECH_CURRENT).
    rec.railWaiting = rows.filter((row) => !row.satisfied && /Waiting for your /.test(row.note ?? '')).length;
    /*
     * The rail again with the held courses the plan counted in place of the
     * ones a row names (GeneratedPlan.standIns: an AP student's CHEM 1310 for
     * CHEM 1211K), which the workspace hands the rail only once it passes
     * report.standIns to illinoisProgress: the rows that would close.
     */
    if ((result.standIns ?? []).length > 0) {
      const withStandIns = illinoisProgress({
        blocks, boardCodes, priorCodes: towardDegree, byCode, pools, language: result.language ?? null,
        satisfiedByPriorCredit: result.satisfiedByPriorCredit ?? [], equivalents: context.equivalents,
        degreeTotal: program.totalCredits ?? null, priorHours: 0, genEdCredits: [], programName: program.name,
        currentTerm: CURRENT && !holdsNow ? { label: 'Fall 2026', assumedHours: ASSUMED_NOW } : null, standIns: result.standIns,
      });
      rec.railStandIn = rows.filter((row, i) => !row.satisfied && withStandIns[i]?.satisfied).length;
      rec.standIns = result.standIns.map((s) => `${s.held} for ${s.for}`);
    }
    for (const line of railShort) note('board rail: requirement shown incomplete', summary.id, `${summary.id}: ${line}`);
    /*
     * A card that reads "elective slot", free to swap, while the rail counts
     * it toward a requirement the page names courses for: a Computer Science
     * board's PHYS 2211, which Field of Study requires, read "elective slot"
     * on the board and in the print packet, and TOWER offered to swap it out
     * (2026-11-09 browser test). The marks are built as the workspace builds
     * them (repick.ts planMarks over the live pools; advisor-packet.ts cardRole).
     */
    const marks = planMarks({ pools, language: result.language ?? null, electives: result.electives ?? [], genEdPicks: result.genEdPicks ?? [], addedPrerequisites: result.addedPrerequisites ?? [] }, byCode);
    const railOf = new Map();
    for (const row of rows) for (const code of row.codes ?? []) if (!railOf.has(code)) railOf.set(code, row);
    const hoursRow = (row) => blocks.some((b) => b.rule.kind === 'hours' && row.area.label && (b.label || b.areaLabel || '').includes(row.area.label));
    rec.slotMislabeled = [];
    for (const code of new Set(boardCodes)) {
      const course = byCode.get(code);
      if (!course) continue;
      const row = railOf.get(code);
      if (!row || hoursRow(row)) continue;
      if (cardRole(course, { marks, bookedFor: result.bookedFor, blocks, studentAdded: new Set() }) === 'elective slot') rec.slotMislabeled.push(`${code} (rail: ${row.area.label})`);
    }
    for (const line of rec.slotMislabeled) note('card reads "elective slot" while the rail counts it toward a named requirement', summary.id, `${summary.id}: ${line}`);
  }

  if (process.env.GATECH_SHOW) {
    console.log(`\n${summary.id}: ${rec.planned} of ${rec.total ?? '?'} planned`);
    for (const term of result.terms) console.log(`  ${term.label.padEnd(12)} ${String(term.credits.min).padStart(4)}  ${term.codes.join(', ')}`);
    for (const u of result.unsatisfied) console.log(`  open: ${u.label}: ${(u.message ?? '').slice(0, 110)}`);
    for (const np of result.notPlaced) console.log(`  not placed: ${np.code}: ${np.reason}`);
    for (const line of rec.railShort ?? []) console.log(`  rail incomplete: ${line}`);
  }

  // Prerequisites, offerings and exclusions, read off the plan itself.
  const earlier = new Set(PRIOR_CODES);
  const planned = new Set(PRIOR_CODES);
  for (const term of result.terms) {
    const same = new Set(term.codes.map(normCode));
    for (const code of same) {
      const spec = prereqs.get(code);
      if (spec) {
        const { missing } = missingPrerequisiteGroups(spec, earlier, same, equivalents);
        /*
         * A group the exclusion rule shut is the engine's to say, not a slip:
         * an Accounting board's MGT 4026 asks for MGT 3000, which will not
         * count beside the ACCT 2102 the major requires, and the plan books
         * nothing for it and tells the student to ask an advisor
         * (withClosedPrereqNotes). Counted apart, with its examples.
         */
        const held = new Set([...earlier, ...same, code]);
        const open = missing.filter((g) => closedBy(g, held) === null);
        const noted = (result.notes ?? []).some((n) => n.startsWith(`${code} lists `));
        if (open.length === 0 && missing.length > 0 && noted) {
          rec.closedPrereq += 1;
          note('prerequisite shut by an exclusion (the plan books nothing and says to ask an advisor)', summary.id, `${summary.id} ${term.label}: ${code} needs ${missing.map((g) => `${g.any.join(' or ')}, which ${closedBy(g, held)} shuts`).join('; ')}`);
        } else if (missing.length > 0) {
          rec.prereq += 1;
          note('prerequisite violation', summary.id, `${summary.id} ${term.label}: ${code} needs ${missing.map((g) => g.any.join(' or ')).join('; ')}`);
        }
      }
      const ran = offerings?.get(code) ?? null;
      if (offerings) {
        if (!ran || ran.length === 0) {
          rec.neverRan += 1;
          note('course on the board that has not run in the nine crawled terms', summary.id, `${summary.id} ${term.label}: ${code}`);
        } else if (!ran.some((t) => SEASON_OF_TERM[t.slice(0, 2)] === term.season)) {
          rec.season += 1;
          note('offering-season violation (placed in a season it has not run in)', summary.id, `${summary.id} ${term.label}: ${code} ran ${ran.join(', ')}`);
        }
      }
      for (const other of exclusions.get(code) ?? []) {
        // A held course the plan forfeits for this one, out loud, is no second credit.
        if (forfeitedHeld.has(normCode(other))) continue;
        if (planned.has(normCode(other)) || (same.has(normCode(other)) && normCode(other) < code)) {
          rec.exclusion += 1;
          exclusionViolations += 1;
          note('exclusion violation (both courses on the board, credit counts once)', summary.id, `${summary.id} ${term.label}: ${code} with ${other}`);
        }
      }
    }
    for (const code of same) {
      earlier.add(code);
      planned.add(code);
    }
  }

  // Held hours and the hours assumed for the semester in progress, as the workspace's validateOptions passes them (countAssumedHours).
  const priorCredits = towardDegree.reduce((n, c) => n + (byCode.get(c)?.credits ?? 0), 0) + assumedHere;
  for (const issue of validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18, priorCredits })) {
    if (issue.severity === 'error') note(`validator error: ${issue.title}`, summary.id, `${summary.id}: ${issue.message.slice(0, 110)}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const seconds = Math.round((Date.now() - started) / 1000);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}~` : s);

console.log(`Georgia Tech inventory, ${HORIZON.startSeason} ${HORIZON.startYear} to ${HORIZON.gradSeason} ${HORIZON.gradYear}${CURRENT ? `, Fall 2026 in progress counted as ${ASSUMED_NOW} credits (GATECH_CURRENT)` : ''}${PRIOR_CODES.length ? `, holding ${PRIOR_CODES.join(', ')}` : ''}, from public/gatech built ${meta?.fetchedAt ?? '?'}${process.env.GATECH_TREE ? `, code and data from ${TREE}` : ''}`);
console.log(`columns: planned/total credits, requirement rows, unread rows, rows naming a course not in the catalog, open requirement rows, rows the board's rail shows incomplete, courses not placed, prerequisite / season / never-ran / exclusion violations\n`);
console.log(`${pad('program', 74)} ${padL('plan/total', 11)} ${padL('rows', 5)} ${padL('unrd', 5)} ${padL('miss', 5)} ${padL('open', 5)} ${padL('rail', 5)} ${padL('nopl', 5)} ${padL('preq', 5)} ${padL('seas', 5)} ${padL('nevr', 5)} ${padL('excl', 5)}`);
for (const r of records) {
  const pt = `${r.planned ?? '-'}/${r.total ?? '?'}${r.under ? '*' : ''}`;
  console.log(`${pad(cut(r.id, 74), 74)} ${padL(pt, 11)} ${padL(r.blocks, 5)} ${padL(r.unread, 5)} ${padL(r.missingCodes, 5)} ${padL(r.unsatisfied, 5)} ${padL(r.rail, 5)} ${padL(r.notPlaced, 5)} ${padL(r.prereq, 5)} ${padL(r.season, 5)} ${padL(r.neverRan, 5)} ${padL(r.exclusion, 5)}`);
}

const sum = (k) => records.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);
const built = records.filter((r) => r.planned !== null).length;
console.log('\nTOTALS');
console.log(`  program records ${summaries.length}: ${withTables.length} with a requirement table checked, ${menus.length} option menus with no table of their own`);
console.log(`  plans built                        ${built} of ${records.length}${threw ? `, ${threw} threw` : ''} (${seconds}s)`);
console.log(`  requirement rows                   ${sum('blocks')}, of which unread ${sum('unread')} in ${records.filter((r) => r.unread > 0).length} degrees`);
console.log(`  rows naming a course not in catalog ${sum('missingCodes')}`);
console.log(`  unplaced requirement rows          ${sum('unsatisfied')} in ${records.filter((r) => r.unsatisfied > 0).length} degrees`);
console.log(`  rows the board shows incomplete    ${sum('rail')} in ${records.filter((r) => r.rail > 0).length} degrees`);
// A row the rail shows short on a board that also reports a course it could not place is a shortfall the plan says out loud; any other is one it does not.
const railUnreported = records.filter((r) => r.rail > 0 && r.notPlaced === 0 && r.unsatisfied === r.unsatisfiedFilled);
console.log(`    of which on boards that report a course not placed ${records.filter((r) => r.rail > 0 && r.notPlaced > 0).reduce((n, r) => n + r.rail, 0)}; on boards whose plan reports nothing open ${railUnreported.reduce((n, r) => n + r.rail, 0)}`);
if (CURRENT) console.log(`    of which waiting on the Fall 2026 classes (rail and plan both say so) ${sum('railWaiting')} in ${records.filter((r) => r.railWaiting > 0).length} degrees; plan rows that wait on them ${sum('waiting')}`);
if (CURRENT) console.log(`  boards that plan Fall 2026 as their first term (nothing entered for it) ${records.filter((r) => r.holdsNow).length} of ${built}`);
console.log(`    of which a held course the plan counts in place of the named one (GeneratedPlan.standIns), closed once the workspace hands the rail report.standIns ${sum('railStandIn')} in ${records.filter((r) => r.railStandIn > 0).length} degrees`);
console.log(`  cards reading "elective slot" that the rail counts toward a named requirement ${records.reduce((n, r) => n + (r.slotMislabeled?.length ?? 0), 0)} in ${records.filter((r) => (r.slotMislabeled?.length ?? 0) > 0).length} degrees`);
console.log(`  courses not placed                 ${sum('notPlaced')} in ${records.filter((r) => r.notPlaced > 0).length} degrees`);
console.log(`  plans under the published total    ${records.filter((r) => r.under).length}`);
// Hours past the published total: prerequisites the degree does not list, and lists filled past their hours.
const over = records.filter((r) => r.total && r.planned !== null && r.planned > r.total + 0.5);
console.log(`  plans over the published total     ${over.length}, ${over.reduce((n, r) => n + (r.planned - r.total), 0)} hours past in all${over.length ? `, most ${Math.max(...over.map((r) => r.planned - r.total))}` : ''}`);
console.log(`  prerequisite violations            ${sum('prereq')} in ${records.filter((r) => r.prereq > 0).length} degrees`);
console.log(`  prerequisites an exclusion shut    ${sum('closedPrereq')} in ${records.filter((r) => r.closedPrereq > 0).length} degrees (noted on the plan for an advisor)`);
console.log(`  offering-season violations         ${sum('season')} in ${records.filter((r) => r.season > 0).length} degrees`);
console.log(`  courses that have not run          ${sum('neverRan')} in ${records.filter((r) => r.neverRan > 0).length} degrees`);
console.log(`  exclusion violations               ${exclusionViolations}`);

const unreadKinds = [...tally.entries()].filter(([k]) => k.startsWith('unread: '));
console.log('\nUNREAD ROWS BY KIND');
for (const [k, t] of unreadKinds.sort((a, b) => b[1].n - a[1].n)) console.log(`  ${pad(k.slice('unread: '.length), 64)} ${padL(t.n, 6)} rows in ${padL(t.programs.size, 4)} degrees`);
if (unreadKinds.length === 0) console.log('  none');

console.log('\nEVERY BUCKET, with examples');
for (const [bucket, t] of [...tally.entries()].sort((a, b) => b[1].programs.size - a[1].programs.size || b[1].n - a[1].n)) {
  console.log(`\n${bucket}: ${t.n} in ${t.programs.size} degrees`);
  for (const e of t.examples) console.log(`    ${e}`);
}

if (process.env.GATECH_JSON) {
  writeFileSync(process.env.GATECH_JSON, JSON.stringify(records, null, 2));
  console.log(`\nper-degree records written to ${process.env.GATECH_JSON}`);
}

// Illinois's campus gen-ed table, gen-ed categories or language rule on a Georgia Tech board is an engine leak, not a data gap.
const illinoisRows = [...tally.entries()].filter(([k]) => /must be none/.test(k)).reduce((a, [, t]) => a + t.n, 0);
/*
 * Georgia Tech's switches reach the placer only through courseleafOfContext,
 * which reads the school off the catalog's course numbers (the page's and the
 * worker's contexts name none). This context must read as Georgia Tech's, and
 * a three-digit catalog as Illinois's, or the switches would quietly stop
 * reaching Georgia Tech boards or start reaching Illinois ones.
 */
const readsGatech = courseleafOfContext(context)?.id === 'gatech';
const readsIllinois = courseleafOfContext({ courses: [{ id: 'cs-225', code: 'CS 225' }, { id: 'math-221', code: 'MATH 221' }] })?.id === 'illinois';
console.log(`\nschool read off the catalog: this one ${readsGatech ? 'Georgia Tech' : 'NOT Georgia Tech'}, a three-digit one ${readsIllinois ? 'Illinois' : 'NOT Illinois'}`);
const failed = threw > 0 || exclusionViolations > 0 || illinoisRows > 0 || (withTables.length > 0 && built === 0) || !readsGatech || !readsIllinois;
console.log(failed ? `\nFAIL: ${threw} plans threw, ${exclusionViolations} exclusion violations, ${illinoisRows} Illinois-only rows on Georgia Tech boards${readsGatech && readsIllinois ? '' : ', the engine misreads which school a catalog is'}` : '\nok');
process.exit(failed ? 1 : 0);
