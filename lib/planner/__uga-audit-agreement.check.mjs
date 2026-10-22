/**
 * The UGA planner and UGA's audit agree on what a board meets (2026-10-22).
 *
 * The planner chooses courses until it believes each requirement is met; the
 * board's audit (components/planner/uga-board-audit.ts, the requirement bars
 * a student reads) counts again. Where the two count differently a board the
 * planner called complete reads short, and nothing on the board says why.
 * The UGA harness found two such ways on 2026-10-22, each hidden until other
 * picks moved:
 *
 *   1. A course a take-every-course row requires, listed again in a "choose"
 *      row of the same area, counted for both. The audit spends a course once
 *      inside an area (areaProgress), so Marketing and International Business
 *      Co-Major BBA's pre-med freshman read "Field of Study Curriculum -
 *      Marketing Major" 18 of 21: MARK 4700 is required and is one of the
 *      "choose 2", and the planner booked one elective, not two.
 *   2. Held credit counted once for every version of the class the list
 *      names. Anthropology AB lists ANTH 1102 and its honors ANTH 2120H as two
 *      rows of World Languages and Global Culture; a freshman holding ANTH
 *      1102 had both counted, 9 of 9 hours, so the planner booked no third
 *      course and the audit read 6 of 9.
 *
 * This check fails when the UGA adapter offers a choose row a course its own
 * area already requires (unless the area's own hours say its rows count a
 * course twice), when a pool counts one held class twice, when those
 * two boards read short again, when, over a sample of UGA degrees, a pool
 * the planner reports met is one the audit reports short, when holding one
 * more course makes a met row read unmet, or when a short board keeps a
 * prerequisite for a course it left off while a required course goes off.
 *
 *   node lib/planner/__uga-audit-agreement.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// Extensionless and '@/' imports, and uga-source.tsx transpiled, as __uga-summer.check.mjs loads it.
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));

const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
const G = await import(join(HERE, 'uga-planning-guidance.ts'));
const CT = await import(join(HERE, 'career-tracks.ts'));
const read = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; console.log(`  ok    ${name}`); return; }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}
const section = (title) => console.log(`\n${title}`);
const byId = new Map(data.courses.map((c) => [c.id, c]));
const selectionsFor = (program) => Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
const programOf = (id) => data.programs.find((p) => p.id === id);

/** A board as the workspace builds one: Spring 2027 to Spring 2030, the student's words as interests and career, the goal's track hours set. */
function board(program, { held = [], words = '', start = { season: 'Spring', year: 2027 } } = {}) {
  U.setUgaTrackHours(data, CT.ugaTrackCodes(CT.interestProfile(words)));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections: selectionsFor(program) });
  const context = { ...data.context, samplePlanCourses: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [program.id])) };
  const input = {
    requirements: loaded.blocks, context,
    prior: { known: true, courseCodes: held, exemptCodes: [], unmatchedCredits: 0 },
    horizon: { startSeason: start.season, startYear: start.year, gradSeason: 'Spring', gradYear: 2030, stated: true },
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: program.id, programName: loaded.program.name, programCollege: loaded.program.college,
    degreeTotal: program.totalCredits || null, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal,
    interests: words, career: words,
  };
  const generated = generatePlan(input);
  const audit = auditUgaBoard({ board: generated.plan, context, undergraduate: loaded, priorCodes: held, extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, validation: { minimumTermCredits: 12, priorCredits: 0 } });
  U.setUgaTrackHours(data, []);
  return { loaded, generated, audit, context };
}
const areaRow = (audit, label) => audit.areas.find((row) => row.area.label === label);

// ---------------------------------------------------------------------------
section('1. A choose row does not offer a course its own area already requires, unless the area\'s hours say its rows overlap');
{
  /*
   * Kept as printed where too few picks would be left without them, and
   * where the area's rows, read as courses apart, come to more hours than the
   * area states (uga-source.tsx ugaAreaHoursApart): TESOL and World Language
   * Education's German Education area lists GRMN 3010, 3020 and 4001 and then
   * five GRMN 3XXX courses, 24 hours read apart against the area's 15, so the
   * five count the three. Trimmed there, its boards asked for three more
   * German courses than the page does and left other rows' courses off.
   */
  const offenders = [];
  const overlapping = [];
  for (const program of data.programs.filter((p) => U.isUgaUndergraduateDegree(p))) {
    const { blocks } = U.loadUgaProgram(data, program, { emphasisSelections: selectionsFor(program) });
    const required = new Map();
    blocks.forEach((block, index) => {
      if (block.rule.kind === 'all') for (const choice of block.rule.choices) for (const code of choice.codes) if (!required.has(`${block.areaId}|${code}`)) required.set(`${block.areaId}|${code}`, index);
    });
    blocks.forEach((block, index) => {
      if (block.rule.kind !== 'choose') return;
      const listedTwice = block.rule.choices.flatMap((choice) => choice.codes).filter((code) => (required.get(`${block.areaId}|${code}`) ?? Infinity) < index);
      const others = block.rule.choices.filter((choice) => choice.codes.every((code) => !((required.get(`${block.areaId}|${code}`) ?? Infinity) < index)));
      if (listedTwice.length === 0 || others.length < block.rule.n) return;
      // The block's area and row, as printed (block ids are program::area::row).
      const [, areaIndex, rowIndex] = block.id.split('::').map(Number);
      const area = program.areas[areaIndex];
      const row = area?.groups[rowIndex];
      const pickHours = others.map((choice) => choice.credits ?? 3).sort((a, b) => a - b).slice(0, block.rule.n).reduce((sum, h) => sum + h, 0);
      const apart = area && row ? U.ugaAreaHoursApart(area, row, pickHours) : null;
      const line = `${program.name} (${program.id}) ${block.areaLabel}: ${listedTwice.join(', ')}${apart !== null ? ` (${apart} hours apart, area ${area.hours})` : ''}`;
      if (apart !== null && area.hours > 0 && apart > area.hours) overlapping.push(line);
      else offenders.push(line);
    });
  }
  console.log(`        kept as printed, the area's hours counting a course in two rows: ${overlapping.length}`);
  check("no UGA bachelor's degree offers a choose row a course a take-every-course row of the same area requires, where its rows read apart fit the area's hours", offenders.length === 0, offenders.slice(0, 8).join(' | '));
  const tesol = programOf('42194');
  const german = U.loadUgaProgram(data, tesol, { emphasisSelections: selectionsFor(tesol) }).blocks.find((b) => b.rule.kind === 'choose' && b.rule.n === 5 && b.rule.choices.some((c) => c.codes.some((code) => code.startsWith('GRMN 3'))));
  check('TESOL and World Language Education: "five GRMN 3XXX" keeps GRMN 3010 and GRMN 3020 among its picks (the area states 15 hours; its rows read apart come to 24)', Boolean(german) && german.rule.choices.some((c) => c.codes.includes('GRMN 3010')) && german.rule.choices.some((c) => c.codes.includes('GRMN 3020')) && !german.rule.sharedFirst, german ? german.rule.choices.map((c) => c.codes.join('|')).slice(0, 8).join(' ') : 'no row');
  const marketing = programOf('17378');
  const { blocks } = U.loadUgaProgram(data, marketing, {});
  const choose2 = blocks.find((b) => b.areaLabel.startsWith('Field of Study Curriculum') && /Marketing Major/.test(b.areaLabel) && b.rule.kind === 'choose' && b.rule.n === 2);
  const required = blocks.find((b) => b.areaLabel === choose2?.areaLabel && b.rule.kind === 'all');
  check('Marketing and International Business: MARK 4700 is required in the Marketing Major and no longer one of its "choose 2" (13 others remain)', Boolean(choose2 && required) && required.rule.choices.some((c) => c.codes.includes('MARK 4700')) && !choose2.rule.choices.some((c) => c.codes.includes('MARK 4700')) && choose2.rule.choices.length === 13, choose2 ? choose2.rule.choices.map((c) => c.codes.join('|')).join(' ') : 'no choose 2');
}

// ---------------------------------------------------------------------------
section('2. The boards the harness found short now read complete');
{
  const marketing = programOf('17378');
  for (const [label, words] of [['no goal', "I'm a freshman."], ['pre-med', 'I want to go to medical school.']]) {
    const { audit, generated } = board(marketing, { words });
    const row = areaRow(audit, 'Field of Study Curriculum – Marketing Major');
    check(`Marketing and International Business Co-Major BBA, freshman, ${label}: "Field of Study Curriculum - Marketing Major" ${row?.earned ?? '?'} of 21, met, with nothing left off`, Boolean(row?.satisfied) && generated.notPlaced.length === 0, `${row?.earned}/${row?.area.hours}; off: ${generated.notPlaced.map((n) => n.code).join(', ')}`);
  }
  const anthropology = programOf('51649');
  const { audit, generated } = board(anthropology, { held: ['ANTH 1102', 'ENGL 1101', 'ANTH 2002', 'ANTH 2030', 'MATH 1101'] });
  const pool = generated.pools.find((p) => p.areaLabel === 'IV. World Languages and Global Culture');
  const counted = pool ? [...pool.fromPriorCredit, ...pool.picked] : [];
  check('Anthropology AB, ANTH 1102 held: World Languages and Global Culture counts it once, not again as its honors ANTH 2120H', Boolean(pool) && pool.fromPriorCredit.filter((c) => c === 'ANTH 1102' || c === 'ANTH 2120H').length === 1, pool ? `held ${pool.fromPriorCredit.join(', ')}; booked ${pool.picked.join(', ')}` : 'no pool');
  const row = areaRow(audit, 'IV. World Languages and Global Culture');
  check(`and the board meets it: ${row?.earned ?? '?'} of 9 hours by the audit, ${pool?.hours ?? '?'} by the planner`, Boolean(row?.satisfied) && pool?.hours === row?.earned, counted.join(', '));
  const social = generated.pools.find((p) => p.areaLabel === 'V. Social Sciences');
  check('so does Social Sciences, which lists ANTH 1102 and ANTH 2120H too', Boolean(social) && social.fromPriorCredit.filter((c) => c === 'ANTH 1102' || c === 'ANTH 2120H').length === 1 && Boolean(areaRow(audit, 'V. Social Sciences')?.satisfied), social ? social.fromPriorCredit.join(', ') : 'no pool');
}

// ---------------------------------------------------------------------------
section("3. Over a sample of UGA degrees, a pool the planner reports met is met on the board's audit");
{
  // Every degree a choose row or an honors twin touched on 2026-10-22, and others the harness saw move.
  // Not Housing Management and Policy BSFCS: its page's Option I and Option II read as both required,
  // and the audit's Option II pools find their courses spent by Option I's (a reading to fix on its own).
  const ids = ['17378', '51649', '14150', '47137', '44677', '71373', '83049', '58425', '21871', '73962', '31975', '35773', '62409', '70392', '20412', '11214', '38829', '31338', '86044', '20122'];
  const programs = ids.map(programOf).filter(Boolean);
  const disagree = [];
  let pools = 0;
  for (const program of programs) {
    for (const held of [[], ['ANTH 1102', 'ENGL 1101', 'HIST 2111', 'POLS 1101']]) {
      const { generated, audit } = board(program, { held });
      for (const pool of generated.pools) {
        if (pool.hoursTarget === null || pool.hours < pool.hoursTarget) continue;
        pools += 1;
        const short = audit.issues.find((i) => i.id.startsWith(`uga-pool-${pool.requirementId}-`));
        if (short) disagree.push(`${program.name}${held.length ? ' (with credit)' : ''}: ${pool.areaLabel} / ${pool.label} ${pool.hours}/${pool.hoursTarget} by the planner, "${short.message}" on the board`);
      }
    }
  }
  check(`${programs.length} degrees, two students each: every one of the ${pools} pools the planner reports met is met on the board`, programs.length === ids.length && pools > 100 && disagree.length === 0, disagree.slice(0, 6).join(' | '));
}

// ---------------------------------------------------------------------------
section('4. Holding one more course never makes a met row read unmet');
{
  /*
   * areaProgress counted the cheapest course a one-course row holds: an
   * Ecology board that booked WILD 3580 (3 hours) as an elective beside the
   * 4-hour ANTH 4210L it booked for "Natural History" read 3 of 4 hours.
   * Where the cheapest-first count leaves an area short, the largest-first
   * count is used when it does better.
   */
  const S = await import(join(HERE, 'scheduler.ts'));
  const program = { id: 'x', college: 'x', degree: 'AB', name: 'x', totalCredits: 120, areaHours: 4, areas: [{ label: 'Natural History', hours: 4, groups: [{ label: '', choose: 1, required: false, minimumCourses: 1, cap: { hours: null, courses: 1 }, courses: [{ code: 'ANTH 4210L', title: '', credits: 4 }, { code: 'WILD 3580', title: '', credits: 3 }] }] }] };
  const read = (codes) => S.areaProgress(program, new Set(codes), new Map(), { allowCrossAreaOverlap: true })[0];
  check('one 4-hour course in a 4-hour, one-course row: met; with a 3-hour course of the row held too: still met', read(['ANTH 4210L']).satisfied && read(['ANTH 4210L', 'WILD 3580']).satisfied && read(['ANTH 4210L', 'WILD 3580']).earned === 4, JSON.stringify(read(['ANTH 4210L', 'WILD 3580'])));
  check('a 3-hour course alone still reads 3 of 4', !read(['WILD 3580']).satisfied && read(['WILD 3580']).earned === 3);
  const ecology = programOf('38829');
  const { audit } = board(ecology);
  const row = areaRow(audit, 'Natural History');
  check(`Ecology AB, freshman: "Natural History" ${row?.earned ?? '?'} of 4, met`, Boolean(row?.satisfied), JSON.stringify(row?.earned));
}

// ---------------------------------------------------------------------------
section("5. A prerequisite booked only for courses left off the board gives its seat to a required one");
{
  /*
   * An incoming Marketing and International Business student's six terms
   * (Fall 2027 to Spring 2030) held FINA 4310, booked as the prerequisite
   * of FINA 4340, which did not fit, while MGMT 5560, which International
   * Business Curriculum requires, was left off.
   */
  const marketing = programOf('17378');
  const { generated, audit } = board(marketing, { words: "I'm an incoming freshman, starting college next fall.", start: { season: 'Fall', year: 2027 } });
  const onBoard = new Set(generated.plan.terms.flatMap((t) => t.courseIds).map((id) => byId.get(id)?.code));
  const dead = generated.addedPrerequisites.filter((a) => onBoard.has(a.code) && !onBoard.has(a.requiredBy));
  check(`incoming, Fall 2027 to Spring 2030: MGMT 5560 is on the board and International Business Curriculum is met`, onBoard.has('MGMT 5560') && Boolean(areaRow(audit, 'International Business Curriculum')?.satisfied), generated.notPlaced.map((n) => n.code).join(', '));
  check('and no class listed as left off appears twice', new Set(generated.notPlaced.map((n) => n.code)).size === generated.notPlaced.length, generated.notPlaced.map((n) => n.code).join(', '));
  console.log(`        prerequisites on the board for courses that are not: ${dead.map((a) => `${a.code} for ${a.requiredBy}`).join(', ') || 'none'}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
console.log(failures === 0 ? 'ALL UGA AUDIT AGREEMENT CHECKS PASSED' : `${failures} UGA AUDIT AGREEMENT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
