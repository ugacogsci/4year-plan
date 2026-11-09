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
 *   - plans under the published total
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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
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
const ROOT_URL = new URL('../../', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('@/')) spec = ${JSON.stringify(ROOT_URL)} + spec.slice(2); if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const { generatePlan, validatePlan, courseleafOfContext } = await import(join(HERE, 'autoplan.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, setCourseNumberDigits, CAMPUS_GENED_AREA_LABEL } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { courseleafOf } = await import(join(HERE, 'school-config.ts'));
const { illinoisProgress } = await import(join(HERE, '..', '..', 'components', 'planner', 'illinois-progress.ts'));
const { livePools } = await import(join(HERE, '..', '..', 'components', 'planner', 'live-pools.ts'));

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

const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
/*
 * GATECH_PRIOR="MATH 1551,MATH 1552,CS 1301" plans every degree for a student
 * who walks in holding those courses (AP Calculus BC 5 and AP Computer
 * Science A 5 give exactly these), the way a board with exam credit is built:
 * the held codes are prior credit, never booked again, and counted by the rail.
 */
const PRIOR_CODES = (process.env.GATECH_PRIOR ?? '').split(',').map((c) => normCode(c)).filter(Boolean);
const NO_PRIOR = { courseCodes: PRIOR_CODES, exemptCodes: [], unmatchedCredits: 0, known: true };
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
  rec.planned = result.credits.planned.min + PRIOR_CODES.reduce((n, c) => n + (byCode.get(c)?.credits ?? 0), 0);
  rec.unsatisfied = result.unsatisfied.length;
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
    const pools = livePools({ base: result.pools ?? [], blocks, boardCodes, priorCodes: PRIOR_CODES, context });
    const rows = illinoisProgress({
      blocks, boardCodes, priorCodes: PRIOR_CODES, byCode, pools,
      language: result.language ?? null,
      satisfiedByPriorCredit: result.satisfiedByPriorCredit ?? [],
      equivalents: context.equivalents,
      degreeTotal: program.totalCredits ?? null,
      priorHours: 0, // held courses are counted through priorCodes
      genEdCredits: [],
      programName: program.name,
    });
    const railShort = [
      ...rows.filter((row) => row.area.hours > 0 && !row.satisfied).map((row) => `${row.area.label} ${row.earned}/${row.needed ?? row.area.hours}${row.unit ? ` ${row.unit}` : ''}`),
      ...pools.filter((pool) => (pool.hoursTarget !== null && pool.hours < pool.hoursTarget) || (pool.countTarget !== null && pool.count < pool.countTarget))
        .map((pool) => `${pool.label} (list) ${pool.hoursTarget !== null ? `${pool.hours}/${pool.hoursTarget} hr` : `${pool.count}/${pool.countTarget} courses`}`),
    ];
    rec.rail = railShort.length;
    rec.railShort = railShort;
    for (const line of railShort) note('board rail: requirement shown incomplete', summary.id, `${summary.id}: ${line}`);
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

  for (const issue of validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 })) {
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

console.log(`Georgia Tech inventory, ${HORIZON.startSeason} ${HORIZON.startYear} to ${HORIZON.gradSeason} ${HORIZON.gradYear}, from public/gatech built ${meta?.fetchedAt ?? '?'}`);
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
console.log(`  courses not placed                 ${sum('notPlaced')} in ${records.filter((r) => r.notPlaced > 0).length} degrees`);
console.log(`  plans under the published total    ${records.filter((r) => r.under).length}`);
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
