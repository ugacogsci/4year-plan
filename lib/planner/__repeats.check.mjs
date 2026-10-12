/**
 * Courses taken more than once (repeats.ts), on the product path.
 *
 * 73 degree rows on 26 pages ask for more hours of one course than a single
 * sitting gives (minors-research/repeat-rows.json, 2026-10-08): Stage
 * Management asks for THEA 359 x 8 hours at 2 a sitting, Voice for MUSC 105
 * x 12 hours at 3. The board booked each once, so the bar read 2 of 8 and a
 * student who added THEA 359 again was told it was already in the plan.
 *
 * What this pins:
 *   - the catalog's repeat sentence read into the index (cap, same term,
 *     topics vary, a cap a term), on the wordings the 40 courses use;
 *   - what a row asks for: THEA 359 x 8 hours is four 2-hour sittings, a
 *     page past the catalog's cap keeps both figures;
 *   - the adapter's reading: which rows ask for repeats, and the two rows of
 *     the 73 that do not (ECE 496 "and Senior Thesis" is a pair, IB 490 is
 *     not in the course index);
 *   - the validator: no "Course appears twice" for a repeatable course in
 *     separate terms, but still on a course that may not be repeated, on a
 *     second sitting in one term the catalog does not allow, and past the cap;
 *   - adding a repeatable course again by hand (mayBookAgain);
 *   - a transcript with a repeatable course twice counts both sittings' hours;
 *   - the progress bar counts every sitting, and a row asking for four
 *     sittings is not full on one;
 *   - the engine books the further sittings where they fit (bookRepeats):
 *     Stage Management's THEA 359 in separate terms, never past the row's
 *     ask, with no duplicate warning, no term over 18, and a note saying how
 *     many sittings the plan books.
 *
 *   node lib/planner/__repeats.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }`));

const A = await import(join(HERE, 'autoplan.ts'));
const R = await import(join(HERE, 'repeats.ts'));
const T = await import(join(HERE, 'transcript.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { illinoisProgress } = await import(join(ROOT, 'components', 'planner', 'illinois-progress.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

// ---- 1. the catalog's sentence --------------------------------------------
console.log('The repeat rule, read from each course\'s catalog description (public/illinois-catalog.json)');
const described = new Map(JSON.parse(readFileSync(join(ROOT, 'public', 'illinois-catalog.json'), 'utf8')).courses.map((c) => [c.code, c]));
const ruleOf = (code) => { const c = described.get(code); return R.repeatRuleOf(c.description, c.creditsMax ?? c.credits); };
check('THEA 359: 12 hours, separate semesters', ruleOf('THEA 359'), { max: 12 });
check('MUSC 105: 16 undergraduate hours (the graduate figure is not ours)', ruleOf('MUSC 105'), { max: 16 });
check('THEA 119: 2 hours in one term, 8 in all', ruleOf('THEA 119'), { max: 8, sameTerm: true, termMax: 2 });
check('MUSC 454: no more than 2 hours a term', ruleOf('MUSC 454'), { max: 16, sameTerm: true, termMax: 2 });
check('THEA 419: 4 in one semester, 8 in all', ruleOf('THEA 419'), { max: 8, sameTerm: true, termMax: 4 });
check('ARTH 495: topics vary, no cap', ruleOf('ARTH 495'), { max: null, topicsVary: true });
check('ARTS 461: graduate hours are not ours', ruleOf('ARTS 461'), { max: 6 });
check('a course that may not be repeated', ruleOf('THEA 451'), null);
check('"once" is two sittings', R.repeatRuleOf('May be repeated once.', 3), { max: 6 });

const index = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois', 'index.json'), 'utf8'));
const indexed = new Map(index.map((r) => [r.code, r]));
check('the index carries THEA 359\'s rule', indexed.get('THEA 359')?.repeat, { max: 12 });
check('the index carries MUSC 450\'s same-term rule', indexed.get('MUSC 450')?.repeat, { max: 16, sameTerm: true, termMax: 2 });
check('a course that may not be repeated carries none', indexed.get('THEA 451')?.repeat, undefined);

console.log('\nWhat a row asks for');
check('THEA 359 x 8 hours: four 2-hour sittings', R.repeatAskFor(8, 2, { max: 12 }), { sittings: 4, perSitting: 2, pageHours: 8, cap: 12 });
check('MUSC 405 x 12 hours at 4: three sittings', R.repeatAskFor(12, 4, { max: 12 })?.sittings, 3);
check('a page past the cap is quoted, sittings stop at the cap', R.repeatAskFor(8, 1, { max: 2 }), { sittings: 2, perSitting: 1, pageHours: 8, cap: 2, pastCap: true });
check('one sitting is not a repeat', R.repeatAskFor(2, 2, { max: 12 }), null);
check('a course that may not be repeated asks nothing', R.repeatAskFor(8, 2, null), null);
check('2nd, 3rd, 11th', [R.ordinalWord(2), R.ordinalWord(3), R.ordinalWord(11), R.ordinalWord(21)], ['2nd', '3rd', '11th', '21st']);

// ---- 2. the product's context, as sweep.mjs builds it ---------------------
const pub = (n) => JSON.parse(readFileSync(join(ROOT, 'public', n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = index.map(hydrateIndexRow);
applyOfferings(rows, pub('illinois/offerings.json'));
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const grades = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), toGradeRow(g, byCode.get(norm(g.code))?.title ?? g.code, [])]));
const sectionFile = pub('illinois/sections.json');
const offerings = pub('illinois/offerings.json');
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : 'Fall' } : null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const summaries = pub('illinois/programs.json');
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const load = (id) => {
  const summary = summaries.find((p) => p.id === id);
  for (const r of rows) r.requirementIds = [];
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
};

console.log('\nThe adapter\'s reading of the 73 rows');
const asked = JSON.parse(readFileSync(join(HERE, '__repeats.rows.json'), 'utf8'));
let marked = 0;
const unmarked = [];
for (const id of new Set(asked.map((r) => r.program))) {
  const { blocks } = load(id);
  const read = new Set(blocks.flatMap((b) => (b.rule.choices ?? []).filter((c) => c.repeat).map((c) => c.codes[0])));
  for (const r of asked.filter((x) => x.program === id)) {
    if (read.has(r.code)) marked += 1;
    else unmarked.push(`${r.program} ${r.code}`);
  }
}
check('rows read as repeats', marked, 71);
check('rows not read as repeats (a pair, a course not in the index)', unmarked, ['engineering/computer-engineering-bs ECE 496', 'las/integrative-biology-bslas/honors IB 490']);

// ---- 3. a board, as the engine books it ----------------------------------
console.log('\nA board');
// The fewest sittings the engine books on these two boards (bookRepeats books only where a sitting fits).
const SITTINGS_359 = 2;
const SITTINGS_105 = 2;
const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: true };
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 2, languageName: 'Spanish', genEdCredits: [] };
const build = (id, prior = FRESHMAN) => {
  const L = load(id);
  const g = A.generatePlan({
    requirements: L.blocks, context, prior, horizon: HORIZON,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: id, degreeTotal: L.summary.totalCredits, interests: '', career: '', programName: L.program.name, programCollege: L.program.college,
    admissionRoute: null, residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  return { L, g };
};
const termsOf = (g, code) => g.terms.filter((t) => t.codes.includes(code)).map((t) => t.label);
const opts = (g, L) => ({ minimumTermCredits: 12, maxTermCredits: 18, programName: L.program.name, programCollege: L.program.college, priorCredits: g.credits.prior, away: g.away, language: g.language });

const sm = build('faa/theatre-bfa/stage-management');
const sittings359 = termsOf(sm.g, 'THEA 359');
console.log(`  (THEA 359 booked in ${sittings359.join(', ')})`);
check('the engine books THEA 359 again where it fits (2 to 4 sittings, one a term)', sittings359.length >= SITTINGS_359 && sittings359.length <= 4 && new Set(sittings359).size === sittings359.length, true);
check('and THEA 451 (not repeatable) once', termsOf(sm.g, 'THEA 451').length, 1);
const smIssues = A.validatePlan(sm.g.plan, context, opts(sm.g, sm.L));
check('no "Course appears twice" on the engine\'s board', smIssues.filter((i) => i.id.startsWith('ap-duplicate-')).length, 0);
check('no term over 18', sm.g.terms.filter((t) => t.credits.min > 18).map((t) => t.label), []);
check('the plan says how many sittings it books', sm.g.notes.some((n) => n.startsWith('The degree asks for 8 hours of THEA 359')), true);
const voice = build('faa/voice-bmus');
const sittings105 = termsOf(voice.g, 'MUSC 105');
console.log(`  (Voice: MUSC 105 booked in ${sittings105.join(', ')})`);
check('Voice books MUSC 105 again where it fits, one a term, never past four', sittings105.length >= SITTINGS_105 && sittings105.length <= 4 && new Set(sittings105).size === sittings105.length, true);

// The board with THEA 359 once, as the engine booked it before the further sittings, for the checks below.
const id359 = A.courseIdFor('THEA 359');
let seen359 = false;
const oneSitting = { ...sm.g.plan, terms: sm.g.plan.terms.map((t) => ({ ...t, courseIds: t.courseIds.filter((id) => id !== id359 || (seen359 ? false : (seen359 = true))) })) };

console.log('\nThe validator');
const dup = (board) => A.validatePlan(board, context, opts(sm.g, sm.L)).filter((i) => i.id.startsWith('ap-duplicate-')).map((i) => i.message);
const withIn = (board, termIndex, code) => ({ ...board, terms: board.terms.map((t, i) => (i === termIndex ? { ...t, courseIds: [...t.courseIds, A.courseIdFor(code)] } : t)) });
const t359 = oneSitting.terms.findIndex((t) => t.courseIds.includes(id359));
const others = oneSitting.terms.map((t, i) => i).filter((i) => i !== t359);
const last = oneSitting.terms.length - 1;
check('a course that may not be repeated still warns', dup(withIn(oneSitting, last === t359 ? others[0] : last, 'THEA 451')).length, 1);
check('a second THEA 359 in one term warns (separate semesters only)', dup(withIn(oneSitting, t359, 'THEA 359')).length, 1);
let four = oneSitting;
for (const i of others.slice(0, 3)) four = withIn(four, i, 'THEA 359');
check('four THEA 359 in four terms (8 hours, the row\'s ask) do not warn', dup(four).length, 0);
let crowded = four;
for (const i of others.slice(3, 5)) crowded = withIn(crowded, i, 'THEA 359');
check('a fifth and sixth (12 hours, the cap) do not warn', dup(crowded).length, 0);
check('a seventh (14 hours, past the cap) warns', dup(withIn(crowded, others[5], 'THEA 359')).length, 1);

console.log('\nAdding by hand');
const thea359 = byCode.get('THEA 359');
const free = oneSitting.terms[others[0]];
check('THEA 359 again in a term without it', R.mayBookAgain(thea359, oneSitting, id359, free.id), true);
check('not in a term that has it', R.mayBookAgain(thea359, oneSitting, id359, oneSitting.terms[t359].id), false);
check('not past the cap', R.mayBookAgain(thea359, crowded, id359, oneSitting.terms[others[5]].id), false);
check('not a course that may not be repeated', R.mayBookAgain(byCode.get('THEA 451'), oneSitting, A.courseIdFor('THEA 451'), free.id), false);
check('THEA 119 twice in one term (2 hours a term, 1 a sitting)', R.mayBookAgain({ credits: 1, repeat: { max: 8, sameTerm: true, termMax: 2 } }, { completedCourseIds: [], terms: [{ id: 'x', courseIds: ['c'] }] }, 'c', 'x'), true);
check('but not a third', R.mayBookAgain({ credits: 1, repeat: { max: 8, sameTerm: true, termMax: 2 } }, { completedCourseIds: [], terms: [{ id: 'x', courseIds: ['c', 'c'] }] }, 'c', 'x'), false);

console.log('\nA transcript with a repeated course');
const lite = index.map((r) => ({ code: r.code, title: r.title, credits: r.credits, level: r.level, cluster: r.cluster, tags: r.tags, ...(r.repeat ? { repeat: r.repeat } : {}) }));
const line = (code, title, credits, term) => ({ code, title, credits, grade: 'A', term, status: 'completed' });
const rec = T.matchTranscript({ institution: 'University of Illinois Urbana-Champaign', kind: 'transcript', courses: [line('MUSC 105', 'Voice', 3, 'Fall 2025'), line('MUSC 105', 'Voice', 3, 'Spring 2026'), line('CHEM 102', 'General Chemistry I', 3, 'Fall 2025'), line('CHEM 102', 'General Chemistry I', 3, 'Spring 2026')], exams: [], notes: [] }, 'a', lite);
check('MUSC 105 twice: both sittings\' hours count', [T.transcriptCodes(rec).filter((c) => c === 'MUSC 105').length, T.transcriptHours(rec)], [1, 3]);
check('CHEM 102 twice (not repeatable): counts once', rec.courses.filter((c) => c.code === 'CHEM 102').map((c) => c.counts), ['course', 'none']);

console.log('\nThe progress bar');
const codeOfId = new Map(rows.map((c) => [c.id, c.code]));
const codesOn = (board) => board.terms.flatMap((t) => t.courseIds.map((id) => codeOfId.get(id) ?? id));
const barOf = (board) => {
  const bars = illinoisProgress({ blocks: sm.L.blocks, byCode, pools: sm.g.pools, boardCodes: codesOn(board), priorCodes: [], satisfiedByPriorCredit: [], equivalents });
  const row = bars.find((r) => (r.codes ?? []).includes('THEA 359') && r.codes.includes('THEA 451'));
  return row ? [row.earned, row.needed] : 'row not found';
};
const one = barOf(oneSitting);
const booked = barOf(sm.g.plan);
const more = barOf(four);
check('the concentration row asks for every sitting, so one THEA 359 does not fill it', one[0] < one[1], true);
check('three more THEA 359 sittings add their 6 hours', [more[0] - one[0], more[1] - one[1]], [6, 0]);
check('the engine\'s sittings add their hours to the row', booked[0] - one[0], 2 * (sittings359.length - 1));
console.log(`  (the row reads ${one[0]} of ${one[1]} with THEA 359 once, ${booked[0]} of ${booked[1]} on the engine's board, ${more[0]} of ${more[1]} with THEA 359 four times)`);

console.log(failed ? `\n${failed} FAILED` : '\nall repeat checks pass');
if (failed) process.exitCode = 1;
