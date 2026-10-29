/**
 * UGA's university-wide and college-wide graduation rules, and the foreign
 * language as a sequence (lib/planner/uga-university-rules.ts, 2026-10-29).
 *
 * The audit of all 161 bachelor's degrees found these rules planned on none:
 * physical education, Area II's lab science, cultural diversity,
 * environmental awareness, the 39 upper-division hours, 45 of the last 60
 * hours at UGA, Franklin College's breadth rules and language, and the other
 * colleges' rules. This check reads UGA's data as the browser does
 * (uga-source.tsx over public/uga-*) and fails when:
 *
 *   1. a bachelor's degree lacks a rule its college asks for, has one it does
 *      not, a rule adds hours to the degree, or a graduate program changes;
 *   2. the language is not planned in order from where the student starts:
 *      1001, 1002, then the third semester (and on to the degree's level),
 *      in one language, the student's when named; a placement past the level
 *      plans none and meets the audit's row; a core list books another
 *      language's first semester;
 *   3. a built board leaves a rule unmet that it could meet, books physical
 *      education inside the 120, or puts a lab in another term from its
 *      lecture;
 *   4. the audit's own lines (physical education, 39 upper-division hours,
 *      45 of the last 60 at UGA) read wrong.
 *
 *   node lib/planner/__uga-university-rules.check.mjs
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

const R = await import(join(HERE, 'uga-university-rules.ts'));
const { generatePlan } = await import(join(HERE, 'autoplan.ts'));
const { DEFAULT_PRIORITIES } = await import(join(HERE, 'priorities.ts'));
const IS = await import(join(ROOT, 'components/planner/illinois-source.tsx'));
const { auditUgaBoard } = await import(join(ROOT, 'components/planner/uga-board-audit.ts'));
const read = (name) => JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; console.log(`  ok    ${name}`); return; }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
}
const section = (title) => console.log(`\n${title}`);
const byId = new Map(data.courses.map((c) => [c.id, c]));
const program = (id) => data.programs.find((p) => p.id === id);
const labels = (id) => program(id).areas.map((a) => a.label);
const raw = read('uga-programs.json').programs;

// ---------------------------------------------------------------------------
section('1. Each degree carries the rules its college asks for, and no hours more');
{
  const bachelors = data.programs.filter((p) => U.isUgaUndergraduateDegree(p));
  const every = ['Cultural Diversity Requirement', 'Environmental Awareness Requirement'];
  check('every one of the 161 bachelor\'s degrees has cultural diversity and environmental awareness', bachelors.length === 161 && bachelors.every((p) => every.every((l) => p.areas.some((a) => a.label === l))), String(bachelors.length));
  check('every one with Area II lists has the lab-science rule', bachelors.filter((p) => p.areas.some((a) => /^II\./.test(a.label))).every((p) => p.areas.some((a) => a.label === 'Core Area II Laboratory Science')));
  const before = new Map(raw.map((p) => [p.id, p]));
  check('no rule adds hours: each degree\'s total and area hours are the page\'s', bachelors.every((p) => p.totalCredits === before.get(p.id).totalCredits && p.areaHours >= 0 && p.areaHours <= before.get(p.id).areaHours + 12), bachelors.filter((p) => p.totalCredits !== before.get(p.id).totalCredits).map((p) => p.id).join(' '));
  check('graduate programs, minors and certificates are as they were', data.programs.filter((p) => !U.isUgaUndergraduateDegree(p)).every((p) => !p.areas.some((a) => R.ugaRuleArea(a.label) || R.ugaLanguageArea(a.label))));
  const franklin = ['Franklin College Literature Requirement', 'Franklin College Fine Arts, Philosophy and Religion Requirement', 'Franklin College History Requirement', 'Franklin College Social Sciences Requirement', 'Franklin College Biological Sciences Requirement', 'Franklin College Physical Sciences Requirement'];
  const has = (id, list) => list.every((l) => labels(id).includes(l));
  const none = (id, list) => list.every((l) => !labels(id).includes(l));
  check('a Franklin AB and BS (Psychology BS, English AB) and the Economics AB have Franklin\'s six, Multicultural and the language', ['69115', '86328', '77024'].every((id) => has(id, [...franklin, 'Franklin College Multicultural Requirement', 'Foreign Language Requirement'])));
  check('the BFAs, BSCHEM and BMus Music Education and Therapy have Multicultural only (Franklin College Requirements, "Degrees with Exceptions")', ['14150', '68952', '73709', '97290', '22148', '11719'].every((id) => has(id, ['Franklin College Multicultural Requirement']) && none(id, [...franklin, 'Foreign Language Requirement'])));
  check('BMus Composition, Performance and Theory have all of them', ['93244', '16876', '56733'].every((id) => has(id, [...franklin, 'Foreign Language Requirement'])));
  check('SPIA, Odum, CAES, Warnell and Public Health have their own and not Franklin\'s', has('46524', ['SPIA Literature Requirement', 'SPIA Fine Arts, Philosophy and Religion Requirement', 'Foreign Language Requirement']) && has('86043', ['Odum School Literature Requirement', 'Foreign Language Requirement']) && has('62966', ['CAES Speech Requirement', 'CAES Pre-calculus Requirement']) && has('61717', ['Warnell Calculus Requirement', 'Warnell Statistics Requirement']) && has('99141', ['Warnell Mathematics Requirement']) && none('99141', ['Warnell Calculus Requirement']) && has('33197', ['Public Health Speech Requirement']) && ['46524', '86043', '62966', '61717', '33197'].every((id) => none(id, franklin)));
  const level = (id) => R.ugaLanguageLevelOf(program(id).areas.find((a) => a.label === 'Foreign Language Requirement')?.groups[0]?.label ?? '');
  check('the language level: third for Franklin, SPIA, Odum, Social Studies Education and Grady; fourth for International Affairs, Communication Studies, Classics and Linguistics; the 3000 level for the International Business co-majors', level('69115') === 3 && level('46524') === 3 && level('86043') === 3 && level('79831') === 3 && level('84144') === 3 && level('24662') === 4 && level('52209') === 4 && level('82769') === 4 && level('84398') === 4 && level('17378') === 5 && level('11214') === 5, [level('24662'), level('17378')].join(','));
  check('business, engineering and education degrees otherwise ask for no language', none('59600', ['Foreign Language Requirement']) && none('20122', ['Foreign Language Requirement']) && none('90610', ['Foreign Language Requirement']));
  const lit = program('69115').areas.find((a) => a.label === 'Franklin College Literature Requirement').groups[0].courses.map((r) => r.code);
  check('Franklin\'s literature list reads its subject-wide line (any 2000-level ENGL) and its own courses', lit.includes('ENGL 2310') && lit.includes('CMLT 2111') && !lit.includes('ENGL 1101'));
  const fa = program('69115').areas.find((a) => a.label === 'Franklin College Fine Arts, Philosophy and Religion Requirement').groups[0].courses.map((r) => r.code);
  check('Fine Arts, Philosophy and Religion leaves out what the page rules out (PHIL 2500, 4510, 4530)', fa.includes('PHIL 2010') && !fa.includes('PHIL 2500') && !fa.includes('PHIL 4510'));
  const pe = data.courses.filter((c) => /^PEDB /.test(c.code));
  check('physical education is outside the degree\'s hours: every PEDB course is priced at 0', pe.length > 30 && pe.every((c) => c.credits === 0));
  check('a lab is held to its lecture: BIOL 1103L with BIOL 1103, ECOL 1000L with ECOL 1000', data.context.trackLabs?.get('BIOL 1103L') === 'BIOL 1103' && data.context.trackLabs?.get('ECOL 1000L') === 'ECOL 1000');
  check('each language\'s semesters follow one another where the catalog gives none (KREN 1002 after 1001, AMSL 2010 after 1020)', data.prereqs.get('KREN 1002')?.groups.some((g) => g.any.includes('KREN 1001')) && data.prereqs.get('AMSL 2010')?.groups.some((g) => g.any.includes('AMSL 1020')));
}

// ---------------------------------------------------------------------------
const TODAY_FALL = { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2031, stated: true };
function board(id, prior = {}, interests = '') {
  const p = program(id);
  const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(p).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, p, { emphasisSelections });
  const priorCredit = IS.readPriorCredit('', 0, new Map(data.context.courses.map((c) => [c.code, c])), prior.held ?? [], false, 0, prior.placed ?? null, prior.language ?? '');
  const g = generatePlan({
    requirements: loaded.blocks, context: data.context, prior: priorCredit, horizon: TODAY_FALL,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: id, electiveHoursLimit: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal, degreeTotal: p.totalCredits,
    interests, career: interests, programName: loaded.program.name, programCollege: loaded.program.college,
  });
  const audit = auditUgaBoard({ board: g.plan, context: data.context, undergraduate: loaded, priorCodes: priorCredit.courseCodes, bookedFor: g.bookedFor, extraCredits: 0, transcript: null, dualLevel: data.dualLevelCourses, languagePlaced: prior.placed ?? null, validation: { minimumTermCredits: 12, priorCredits: 0 } });
  const terms = g.plan.terms.map((t) => t.courseIds.map((cid) => byId.get(cid)?.code).filter(Boolean));
  return { g, audit, terms, codes: terms.flat(), termOf: (code) => terms.findIndex((t) => t.includes(code)), row: (label) => audit.areas.find((r) => r.area.label === label) };
}
const firstSemesters = (codes) => codes.filter((c) => /^[A-Z]{4} 10(01|10)$/.test(c) && R.ugaLanguageCourse(data.context.languages, c));

section('2. The foreign language, in order, from where the student starts');
{
  const b = board('46524');
  check('a Political Science freshman who names no language gets SPAN 1001, 1002 and 2001 in her first three terms, one after another', b.termOf('SPAN 1001') === 0 && b.termOf('SPAN 1002') === 1 && b.termOf('SPAN 2001') === 2, b.terms.slice(0, 3).join(' | '));
  check('the plan says Spanish is its choice and a tap changes it, and the language row reads met', /No language was given/.test(b.g.language?.why ?? '') && b.row('Foreign Language Requirement')?.satisfied === true);
  check('no other language\'s first semester is on the board', firstSemesters(b.codes).every((c) => c.startsWith('SPAN')), firstSemesters(b.codes).join(' '));
  const f = board('46524', { placed: 2, language: 'French' });
  check('a student who says she starts French at the third semester is booked FREN 2001 alone, and no SPAN course', f.codes.includes('FREN 2001') && !f.codes.some((c) => /^FREN 100[12]$|^SPAN 1/.test(c)) && f.g.language?.completed === 2, f.terms.slice(0, 2).join(' | '));
  const placed = board('69115', { placed: 4 });
  check('a student placed past the fourth semester is booked no language course and the audit reads the row met', placed.g.language === null && !placed.codes.some((c) => R.ugaLanguageCourse(data.context.languages, c)) && placed.row('Foreign Language Requirement')?.satisfied === true);
  const held = board('86328', { held: ['FREN 1001', 'FREN 1002'] });
  check('held FREN 1001 and 1002 continue French: FREN 2001, no Spanish', held.codes.includes('FREN 2001') && !held.codes.some((c) => c.startsWith('SPAN 1')) && /French/.test(held.g.language?.why ?? ''));
  const ib = board('17378', { language: 'Chinese' });
  check('an International Business co-major is planned to the conversation level: CHNS 1001, 1002, 2001, 2002, 3010 in order', ['CHNS 1001', 'CHNS 1002', 'CHNS 2001', 'CHNS 2002', 'CHNS 3010'].every((c, i, all) => ib.termOf(c) >= 0 && (i === 0 || ib.termOf(c) > ib.termOf(all[i - 1]))), ib.terms.slice(0, 5).join(' | '));
  const french = board('56782');
  check('a French AB is planned in French', french.g.language?.name === 'French');
  const eled = board('90610');
  check('a degree with no language requirement books no lone first semester of a language for World Languages', firstSemesters(eled.codes).length === 0, firstSemesters(eled.codes).join(' '));
}

section('3. Built boards meet the rules, physical education outside the 120, labs beside lectures');
{
  for (const [id, name] of [['69115', 'Psychology BS'], ['46524', 'Political Science AB'], ['31532', 'Accounting BBA'], ['62966', 'Poultry Science BSA']]) {
    const b = board(id);
    const open = b.audit.areas.filter((r) => (R.ugaRuleArea(r.area.label) || R.ugaLanguageArea(r.area.label)) && !r.satisfied).map((r) => r.area.label);
    check(`${name}: every university-wide and college rule reads met`, open.length === 0, open.join('; '));
    const pe = b.codes.filter((c) => /^PEDB /.test(c));
    check(`${name}: one physical education course, at 0 of the degree's hours`, pe.length === 1 && byId.get(data.byCode.get(pe[0]).id).credits === 0 && !b.audit.issues.some((i) => i.id === 'uga-rule-pe'), pe.join(' '));
    const apart = b.codes.filter((c) => data.context.trackLabs?.has(c) && b.codes.includes(data.context.trackLabs.get(c)) && b.termOf(c) !== b.termOf(data.context.trackLabs.get(c)));
    check(`${name}: no lab in another term from its lecture`, apart.length === 0, apart.join(' '));
  }
}

section('4. The audit\'s own lines');
{
  const base = { areaLabels: ['Environmental Awareness Requirement'], boardCodes: ['PEDB 1950'], priorCodes: [], creditsOf: () => 3, transferHours: 0, residentHeldHours: 0, plannedHours: 120 };
  const upper = Array.from({ length: 13 }, (_, i) => `POLS ${3000 + i * 10}`);
  check('13 courses numbered 3000-5999 meet the 39 upper-division hours; 12 do not, and the line says how many', !R.ugaUniversityIssues({ ...base, boardCodes: ['PEDB 1950', ...upper] }).some((i) => i.id === 'uga-rule-upper-division') && /has 36\. Make 3 more hours/.test(R.ugaUniversityIssues({ ...base, boardCodes: ['PEDB 1950', ...upper.slice(1)] }).find((i) => i.id === 'uga-rule-upper-division')?.message ?? ''));
  check('no PEDB course on the board or record is a line; ROTC\'s MILS 3010 and 3020 meet it', R.ugaUniversityIssues({ ...base, boardCodes: upper }).some((i) => i.id === 'uga-rule-pe') && !R.ugaUniversityIssues({ ...base, boardCodes: upper, priorCodes: ['MILS 3010', 'MILS 3020'] }).some((i) => i.id === 'uga-rule-pe'));
  const residence = (transfer, held, planned) => R.ugaUniversityIssues({ ...base, boardCodes: ['PEDB 1950', ...upper], transferHours: transfer, residentHeldHours: held, plannedHours: planned }).some((i) => i.id === 'uga-rule-residence');
  check('45 of the last 60 at UGA: a transfer with 90 hours and 30 planned misses it; with 60 and 60, or a senior with 100 UGA hours and 20 planned, does not', residence(90, 0, 30) && !residence(60, 0, 60) && !residence(0, 100, 20) && !residence(30, 75, 15));
  check('a degree without these rules (a graduate program) gets no line', R.ugaUniversityIssues({ ...base, areaLabels: ['Program of study'], boardCodes: [] }).length === 0);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
