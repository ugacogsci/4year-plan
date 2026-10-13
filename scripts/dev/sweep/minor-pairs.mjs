/**
 * Illinois degree + minor pairs, planned the way the workspace plans them,
 * one JSONL row a pair and a scoreboard on stderr.
 *
 *   node minor-pairs.mjs <planner checkout> <out.jsonl>
 *
 * Who is planned: sweep.mjs's student (a Fall 2026 freshman with no credit,
 * a Spring 2030 finish, balanced priorities, 12 to 18 hours, two language
 * semesters owed, no goal) for each pair below: popular pairs, pairs that
 * stress the minor rules (a minor in the major's own field, a held degree the
 * release engine plans, a tight engineering degree) and a few drawn at random
 * with a fixed seed. SWEEP_START="Spring 2027" starts in spring.
 *
 * How: the degree's own plan, exactly as sweep.mjs builds it; then, for a
 * minor the planner has checked (MINOR_BETA), planBesideDegree from
 * lib/planner/illinois-minor-plan.ts, which is what the workspace calls. A
 * minor not checked is not planned, so its board is the degree's own.
 *
 * What each row says, against the degree's own plan:
 *   degreeRowsNewlyUnmet  progress rows of the degree met before, unmet now (must be 0)
 *   degreeGapsNew         the engine's own unmet degree rows and unplaced courses, new (must be 0)
 *   minorRowsMet / minorRows   the minor's rows met on the final board (illinoisProgress, its own ledger)
 *   extraHours, termsBefore, termsAfter
 *   over18ByMinor         terms over 18 hours that the degree's own plan did not have (must be 0)
 *   upperApart            300/400-level minor hours not also counted for the major (campus asks 6)
 *   needRoom              minor rows named as needing a summer or an extra term
 *
 * Options: MINOR_PAIRS="degree|minor,..." only these; MINOR_JOBS (default 1).
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { register } from 'node:module';

const [checkoutArg, outArg] = process.argv.slice(2);
if (!checkoutArg || !outArg) {
  console.error('usage: node minor-pairs.mjs <planner checkout> <out.jsonl>');
  process.exit(2);
}
const ROOT = resolve(checkoutArg);
const OUT = resolve(outArg);
const HERE = join(ROOT, 'lib', 'planner');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const POPULAR = [
  ['engineering/computer-science-bs', 'las/minors/statistics'],
  ['las/psychology-bslas', 'bus/minors/business-non-business'],
  ['las/economics-balas', 'las/minors/data-science'],
  ['las/integrative-biology-bslas', 'las/minors/chemistry'],
  ['las/political-science-balas/general-political-science', 'aces/minors/leadership-studies'],
  ['engineering/mechanical-engineering-bs', 'bus/minors/business-non-business'],
  ['las/communication-balas', 'ahs/minors/public-health'],
  ['bus/finance-bs', 'las/minors/mathematics'],
];
const MORE = [
  ['las/psychology-bslas', 'las/minors/statistics'],
  ['engineering/computer-science-bs', 'las/minors/mathematics'],
  ['engineering/mechanical-engineering-bs', 'las/minors/mathematics'],
  ['las/molecular-cellular-biology-bslas', 'ahs/minors/public-health'],
  ['bus/marketing-bs', 'media/minors/advertising'],
  ['bus/accountancy-bs', 'bus/minors/business-analytics'],
  ['las/history-balas', 'law/minors/legal-studies'],
  ['las/english-balas/english', 'media/minors/journalism'],
  ['engineering/electrical-engineering-bs', 'engineering/minors/semiconductor-engineering'],
  ['engineering/physics-bs', 'las/minors/mathematics'],
  ['ahs/kinesiology-bs', 'aces/minors/nutrition'],
  ['aces/animal-sciences-bs', 'las/minors/integrative-biology'],
  ['las/chemistry-bs', 'engineering/minors/physics'],
  ['faa/dance-ba', 'faa/minors/music'],
  ['las/anthropology-balas', 'ahs/minors/disability-studies'],
  ['las/global-studies-balas', 'las/minors/italian'],
  ['las/philosophy-balas', 'law/minors/legal-studies'],
  ['engineering/civil-engineering-bs', 'las/minors/geology'],
  ['ahs/community-health-bs/health-planning-administration', 'ahs/minors/health-administration'],
  ['bus/information-systems-bs', 'las/minors/statistics'],
  ['las/biochemistry-bs', 'las/minors/statistics'],
  ['media/advertising-bs', 'media/minors/public-relations'],
  ['aces/human-development-family-studies-bs', 'aces/minors/adult-development'],
  ['las/mathematics-bslas', 'las/minors/data-science'],
  ['engineering/industrial-engineering-bs', 'bus/minors/business-analytics'],
  ['las/astronomy-bslas', 'las/minors/geology'],
  ['aces/natural-resources-environmental-sciences-bs', 'las/minors/ecology-conservation-biology'],
  ['engineering/computer-engineering-bs', 'las/minors/statistics'],
  ['las/psychology-bslas', 'ahs/minors/speech-hearing-science'],
  ['las/economics-balas', 'las/minors/spanish'],
];

const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const summaries = pub('illinois/programs.json');
const crawl = pub('illinois/minors/crawl.json');

/** A seeded draw: four degrees the lists above do not name, each with a checked minor. */
function randomPairs(beta, n = 4) {
  let seed = 20261013;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const named = new Set([...POPULAR, ...MORE].map(([d]) => d));
  const degrees = summaries.map((p) => p.id).filter((id) => !named.has(id) && !id.startsWith('education/') && (summaries.find((p) => p.id === id)?.totalCredits ?? 0) > 0);
  const out = [];
  while (out.length < n) {
    const d = degrees[Math.floor(rand() * degrees.length)];
    const m = beta[Math.floor(rand() * beta.length)];
    if (!out.some(([x]) => x === d)) out.push([d, m]);
  }
  return out;
}

// ---- the loader, as sweep.mjs has it --------------------------------------
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const A = await import(join(HERE, 'autoplan.ts'));
const { PRIORITY_PRESETS } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { adaptIllinoisMinor, MINOR_BETA, minorIsChecked } = await import(join(HERE, 'illinois-minors.ts'));
const { planBesideDegree, degreeGaps, upperLevelApart, majorCodesOf } = await import(join(HERE, 'illinois-minor-plan.ts'));
const { livePools } = await import(join(ROOT, 'components/planner/live-pools.ts'));
const { illinoisProgress } = await import(join(ROOT, 'components/planner/illinois-progress.ts'));

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
applyOfferings(rows, offerings);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const byId = new Map(rows.map((c) => [c.id, c]));
const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionFile = pub('illinois/sections.json');
const excellentFile = pub('illinois/excellent.json');
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const seasonWord = (t) => (t === 'spring' ? 'Spring' : t === 'summer' ? 'Summer' : 'Fall');
const firstSections = new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }]));
const termSections = (meta.sectionTerms ?? []).map((t) => {
  const file = t.file === 'sections.json' ? sectionFile : pub(`illinois/${t.file}`);
  const sections = t.file === 'sections.json' ? firstSections : new Map(file.courses.map((r) => [norm(r.code), { ...r, termId: file.termId, termLabel: file.termLabel }]));
  return { id: t.id, label: t.label, season: seasonWord(String(t.term).toLowerCase()), year: t.year, sections };
});
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: firstSections,
  ...(termSections.length > 1 ? { termSections } : {}),
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  excellent: new Map(Object.entries(excellentFile.courses)),
  excellentTerms: excellentFile.terms,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const creditsOf = (code) => byCode.get(norm(code))?.credits ?? null;

const START = (process.env.SWEEP_START ?? 'Fall 2026').match(/^(Fall|Spring) (\d{4})$/);
const HORIZON = START[1] === 'Fall'
  ? { startSeason: 'Fall', startYear: Number(START[2]), gradSeason: 'Spring', gradYear: Number(START[2]) + 4, stated: true }
  : { startSeason: 'Spring', startYear: Number(START[2]), gradSeason: 'Fall', gradYear: Number(START[2]) + 3, stated: true };
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 2, languageName: 'Spanish', genEdCredits: [] };
/**
 * MINOR_IN_FALL=1: the student the app sees today, a first-year already in
 * Fall 2026 whose plan starts in Spring 2027 (adding classes has closed) with
 * the fall counted as 15 assumed hours, finishing Spring 2030: seven terms.
 */
if (process.env.MINOR_IN_FALL === '1') {
  Object.assign(HORIZON, { startSeason: 'Spring', startYear: 2027, gradSeason: 'Spring', gradYear: 2030 });
  FRESHMAN.unmatchedCredits = 15;
}
const codesOn = (g) => g.plan.terms.flatMap((t) => t.courseIds.map((id) => norm(byId.get(id)?.code ?? ''))).filter(Boolean);

function progressRows(blocks, g, programName, degreeTotal, pools) {
  return illinoisProgress({
    blocks,
    boardCodes: codesOn(g),
    priorCodes: [],
    byCode,
    pools,
    language: g.language ?? null,
    satisfiedByPriorCredit: g.satisfiedByPriorCredit ?? [],
    languages: context.languages,
    equivalents,
    degreeTotal,
    priorHours: 0,
    genEdCredits: [],
    programName,
  });
}

function measure([degreeId, minorCatalogId]) {
  const summary = summaries.find((p) => p.id === degreeId);
  if (!summary) throw new Error(`no degree ${degreeId}`);
  const raw = crawl.minors.find((m) => m.id === minorCatalogId);
  if (!raw) throw new Error(`no minor ${minorCatalogId}`);
  for (const r of rows) {
    r.requirementIds = [];
    delete r.pathwayRole;
  }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  const program = adapted.programs[0];
  attachRequirementIds(rows, blocks, facts);
  const degreeTotal = summary.totalCredits || program.totalCredits || 120;
  const input = {
    requirements: blocks,
    context,
    prior: FRESHMAN,
    horizon: { ...HORIZON },
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: PRIORITY_PRESETS.balanced },
    programId: summary.id,
    degreeTotal,
    interests: '',
    career: '',
    programName: program.name,
    programCollege: program.college,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  };
  const t0 = Date.now();
  const g0 = A.generatePlan(input);
  const minor = adaptIllinoisMinor(raw, new Map(byCode));
  const checked = minorIsChecked(minorCatalogId);
  attachRequirementIds(rows, minor.blocks, facts);
  // The rail's degree rows on a plan, as the workspace's degree check counts them.
  const degreePools = (g) => livePools({ base: g.pools.filter((p) => !p.requirementId.startsWith('minor:')), blocks, boardCodes: codesOn(g), priorCodes: [], context });
  const before = progressRows(blocks, g0, program.name, degreeTotal, degreePools(g0));
  const degreeCheck = (g) => {
    const now = progressRows(blocks, g, program.name, degreeTotal, degreePools(g));
    const lost = before.filter((row, i) => row.satisfied && !now[i]?.satisfied);
    return lost.length > 0 ? `it would leave ${lost.map((r) => r.area.label).join('; ')} short` : null;
  };
  const outcome = checked
    ? planBesideDegree(A.generatePlan, input, g0, [{ id: minor.id, name: minor.name, blocks: minor.blocks }], { heldCodes: [], creditsOf, degreeCheck })
    : null;
  const g1 = outcome?.generated ?? g0;
  const ms = Date.now() - t0;

  const after = progressRows(blocks, g1, program.name, degreeTotal, degreePools(g1));
  const newlyUnmet = before.filter((row, i) => row.satisfied && !after[i]?.satisfied).map((row) => row.area.label);
  const gaps0 = degreeGaps(g0);
  const gapsNew = [...degreeGaps(g1)].filter((id) => !gaps0.has(id));
  const minorRows = progressRows(minor.blocks, g1, minor.name, null, []).filter((r) => r.needed !== null);
  const majorCodes = majorCodesOf(g1.bookedFor ?? {}, blocks);
  const apart = upperLevelApart(minorRows.flatMap((r) => r.codes ?? []), majorCodes, creditsOf);
  const cr0 = g0.terms.map((t) => t.credits.min);
  const cr1 = g1.terms.map((t) => t.credits.min);
  const lastUsed = (g) => g.terms.reduce((last, t, i) => (t.codes.length > 0 ? i : last), -1);
  return {
    degree: degreeId,
    degreeName: program.name,
    minor: minorCatalogId,
    minorName: minor.name,
    checked,
    planned: checked && (outcome?.kept ?? 0) > 0,
    kept: outcome?.kept ?? 0,
    offered: outcome?.offered ?? 0,
    shared: (outcome?.shared ?? []).map((s) => `${s.codes.join('+')}`),
    cost: outcome?.cost ?? null,
    runs: outcome?.runs ?? 0,
    degreeRowsNewlyUnmet: newlyUnmet,
    degreeGapsNew: gapsNew,
    minorRows: minorRows.length,
    minorRowsMet: minorRows.filter((r) => r.satisfied).length,
    minorUnmet: minorRows.filter((r) => !r.satisfied).map((r) => `${r.area.label} (${r.earned}/${r.needed} ${r.unit})`),
    needRoom: (outcome?.needRoom ?? []).map((r) => `${r.label}${r.hours ? ` (${r.hours} h)` : ''}`),
    extraHours: Math.max(0, g1.credits.total.min - g0.credits.total.min),
    totalBefore: g0.credits.total.min,
    totalAfter: g1.credits.total.min,
    termsBefore: lastUsed(g0) + 1,
    termsAfter: lastUsed(g1) + 1,
    maxTermBefore: Math.max(...cr0),
    maxTermAfter: Math.max(...cr1),
    over18ByMinor: cr1.filter((c, i) => c > 18 && c > (cr0[i] ?? 0)).length,
    upperApart: apart.hours,
    upperApartCodes: apart.codes,
    ms,
  };
}

const beta = [...MINOR_BETA];
const PAIRS = process.env.MINOR_PAIRS
  ? process.env.MINOR_PAIRS.split(',').map((p) => p.split('|'))
  : [...POPULAR, ...MORE, ...randomPairs(beta)];

const out = [];
for (const pair of PAIRS) {
  let row;
  try {
    row = measure(pair);
  } catch (e) {
    row = { degree: pair[0], minor: pair[1], error: String(e?.stack ?? e).slice(0, 500) };
  }
  out.push(row);
  console.error(row.error
    ? `ERROR ${pair.join(' + ')}: ${row.error.split('\n')[0]}`
    : `${row.checked ? (row.planned ? 'planned ' : 'no room ') : 'not chk '} ${row.degreeName} + ${row.minorName}: degree newly unmet ${row.degreeRowsNewlyUnmet.length}/${row.degreeGapsNew.length}, minor ${row.minorRowsMet}/${row.minorRows}, +${row.extraHours} h, terms ${row.termsBefore}->${row.termsAfter}, over18 ${row.over18ByMinor}, apart ${row.upperApart} h, runs ${row.runs}, ${row.ms} ms`);
}
writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const ok = out.filter((r) => !r.error);
const planned = ok.filter((r) => r.planned);
console.error(`\n${out.length} pairs (${out.length - ok.length} threw): ${ok.filter((r) => r.checked).length} checked minors, ${planned.length} planned beside the degree`);
console.error(`degree rows newly unmet: ${ok.reduce((n, r) => n + r.degreeRowsNewlyUnmet.length, 0)}; engine degree gaps new: ${ok.reduce((n, r) => n + r.degreeGapsNew.length, 0)}; terms over 18 caused by the minor: ${ok.reduce((n, r) => n + r.over18ByMinor, 0)}`);
console.error(`minor rows met (planned pairs): ${planned.reduce((n, r) => n + r.minorRowsMet, 0)} of ${planned.reduce((n, r) => n + r.minorRows, 0)}; fully met: ${planned.filter((r) => r.minorRowsMet === r.minorRows).length} of ${planned.length}`);
process.exit(out.length === ok.length ? 0 : 1);
