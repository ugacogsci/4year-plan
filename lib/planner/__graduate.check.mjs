/**
 * Illinois graduate and professional programs, read: a scoreboard over every
 * program and hand-checked fixtures.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__graduate.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 * GRAD_VERBOSE=1 prints every program's row; GRAD_SHOW=<id,id> prints those
 * programs' blocks.
 *
 * "Reads right" (illinois-graduate.ts) means the fewest hours that meet every
 * requirement the reader found are the total the page states, within one, and
 * nothing had to be quoted instead of read. Hours the page counts but names
 * nothing for are a parser-gap block that does not count, so a page that
 * prints 4 hours of thesis and a 32-hour total is short, not right.
 *
 * Held here:
 *   - the crawl: every program on the four index pages read, by kind; the
 *     index traps (nested concentrations, "index.html#text", a missing slash);
 *     no email address or phone number stored;
 *   - the shape: every id starts with "grad:", no block is campus gen-ed or a
 *     language requirement, options are never summed (each option's reading
 *     has its own total and its own blocks), and UGA's graduate settings are
 *     today's literals;
 *   - the courses: every 500-level-and-up course in the catalog crawl, with
 *     its hours, and none of them in the undergraduate files;
 *   - programs.json is what this crawl reads today (a stale menu fails);
 *   - the fixtures below, read against their pages by hand on 2026-10-13;
 *   - an engine run of four fixtures with the graduate settings;
 *   - the scoreboard does not fall below the floor recorded here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

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

const G = await import('./illinois-graduate.ts');
const { generatePlan } = await import('./autoplan.ts');
const { missingPrerequisiteGroups, attachRequirementIds } = await import('./illinois-data.ts');
const { hydrateIndexRow, applyOfferings } = await import('./illinois-load.ts');
const crawler = await import('../../scripts/illinois/graduate.mjs');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
};
const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();

const crawl = pub('illinois/graduate/crawl.json');
const menu = pub('illinois/graduate/programs.json');
const gradRows = pub('illinois/graduate/courses.json');
const undergradRows = pub('illinois/index.json');
const byCode = new Map();
for (const r of undergradRows) byCode.set(norm(r.code), r);
for (const r of gradRows) byCode.set(norm(r.code), r);
const pages = new Map(crawl.programs.map((p) => [p.id, p]));

// ---------------------------------------------------------------- the crawl
console.log('THE CRAWL (public/illinois/graduate/crawl.json)');
const count = (kind) => crawl.programs.filter((p) => p.kind === kind).length;
check(count('masters') >= 155, "master's-type degree pages read (156 on the index, plus three Professional Science Master's)", `${count('masters')}`);
check(count('doctoral') >= 88, 'doctoral degree pages read (PhD, EdD, DMA, DSW, JSD)', `${count('doctoral')}`);
check(count('certificate') >= 40, 'graduate certificate pages read', `${count('certificate')}`);
check(count('minor') >= 30, 'graduate minor pages read', `${count('minor')}`);
check(['professional/law-jd', 'professional/medicine-md', 'professional/dvm-doctor-veterinary-medicine', 'professional/medical-scholars-program'].every((id) => pages.has(id)), 'the four professional pages read (JD, MD, DVM, MD-PhD)');
check(count('concentration') >= 20 && crawl.programs.filter((p) => p.kind === 'concentration').every((p) => (p.parents ?? []).length > 0), 'concentration pages read only for degrees that require one', `${count('concentration')}`);
const raw = JSON.stringify(crawl);
check(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(raw) && !/\(?\b\d{3}\)?[ .-]\d{3}-\d{4}\b/.test(raw), 'no email address or phone number is stored');
check(!crawl.programs.some((p) => p.facts.some((f) => f.text.length > 220 || !f.url.startsWith('https://catalog.illinois.edu/'))), 'facts are short sentences of our own, each with its link');
const cells = [];
for (const p of crawl.programs) for (const o of p.options) for (const a of o.areas) {
  cells.push(a.label ?? '');
  for (const g of a.groups) cells.push(g.label ?? '', g.note ?? '', ...(g.comments ?? []).map((c) => c.text));
}
check(cells.every((c) => c.length <= crawler.CELL_MAX + 2), `no stored table cell is a paragraph (each ${crawler.CELL_MAX} characters at most)`, `longest ${Math.max(...cells.map((c) => c.length))}`);

const idx = `<div id="textcontainer"><ul><li><a href="/graduate/las/x-ma/">X, MA</a><ul><li><a href="/graduate/las/concentration/y/">Y</a></li></ul></li>
<li><a href="/graduate/bus/badm/z-cert/index.html#text">Z, GCRT</a></li><li><a href="/graduate/las/policy-economics-ms">P, MS</a></li><li><a href="/graduate/certificates/">all</a></li></ul></main>`;
const links = crawler.graduateLinks(idx, 'degree');
check(links.length === 3 && links[0].nested.length === 1 && links[1].path === '/graduate/bus/badm/z-cert/' && links[2].path === '/graduate/las/policy-economics-ms/', 'graduateLinks: nested concentration, "index.html#text", missing slash, index page left out', links.map((l) => l.path).join(' '));
check(crawler.degreeOf('Computer Science, MCS') === 'MCS' && crawler.degreeOf('Architectural Studies, MS (post professional)') === 'MS' && crawler.degreeOf('Agricultural Systems, MS - Professional Science Masters') === 'MS' && crawler.degreeOf('Medieval Studies') === null, 'degreeOf reads the degree after the last comma');
check(crawler.hoursRange('12-16').max === 16 && crawler.hoursRange('32 or 36').min === 32 && crawler.hoursRange('0 or 4').max === 4, 'hoursRange reads "12-16", "32 or 36", "0 or 4"');

// ---------------------------------------------------------------- the reading
console.log('\nTHE READING (lib/planner/illinois-graduate.ts)');
const readings = G.adaptIllinoisGraduatePrograms(crawl, byCode);
const byId = new Map(readings.map((r) => [r.id, r]));
check(readings.every((r) => r.id.startsWith(G.GRAD_ID_PREFIX) && r.blocks.every((b) => b.id.startsWith(G.GRAD_ID_PREFIX) && b.areaId.startsWith(G.GRAD_ID_PREFIX))), 'every program and block id starts with "grad:"');
const genEd = readings.filter((r) => r.blocks.some((b) => b.rule.kind === 'gened' || b.rule.kind === 'language'));
check(genEd.length === 0, 'no graduate program asks for campus gen-ed or a language semester', genEd.map((r) => r.id).slice(0, 5).join(', '));
// Options: each reading of a several-option page carries that option's total and only that option's areas.
let summed = 0;
for (const page of G.menuPages(crawl).filter((p) => p.options.length > 1)) {
  page.options.forEach((o, i) => {
    const r = byId.get(`${G.GRAD_ID_PREFIX}${page.id}${G.GRAD_OPTION_SEPARATOR}${i + 1}`);
    if (!r || r.totalCredits !== o.totalCredits || r.blocks.some((b) => !b.id.endsWith('::gap') && Number(b.id.split('::')[1]) >= o.areas.length)) summed += 1;
  });
}
check(summed === 0, 'options are alternatives: every option reads alone, with its own total', `${summed} wrong`);
check(G.parseGraduateId('grad:las/history-ma~2')?.optionIndex === 1 && G.parseGraduateId('grad:las/history-ma')?.optionIndex === null && G.parseGraduateId('las/x') === null, 'parseGraduateId reads a page id and an option');

const uga = G.graduatePlanSettings('uga');
check(
  uga.minimumTermCredits === 9 && uga.targetTermCredits === 9 && Object.values(uga.standingHours).every((h) => h === 0) &&
    uga.electiveLevelRange.min === 600 && uga.electiveLevelRange.maxExclusive === 1000 &&
    uga.autoPrerequisiteLevelRange.min === 600 && uga.autoPrerequisiteLevelRange.maxExclusive === 1000 &&
    uga.caveat.startsWith('UGA considers 9 graduate credits a normal full-time fall or spring load.'),
  "graduatePlanSettings('uga') is exactly what UGA graduate plans use today",
);
const ill = G.graduatePlanSettings('illinois');
check(ill.electiveLevelRange.min === 500 && ill.autoPrerequisiteLevelRange.min === 500 && ill.confirmed === false, "graduatePlanSettings('illinois'): 500-799 electives and automatic prerequisites, load not confirmed yet");

// ---------------------------------------------------------------- the courses
console.log('\nTHE COURSES (public/illinois/graduate/courses.json, prereqs.json)');
const catalog = pub('illinois-catalog.json');
const catalogGrad = (catalog.courses ?? []).filter((c) => (c.level ?? 0) >= 500);
check(gradRows.length === new Set(catalogGrad.map((c) => norm(c.code))).size, 'every 500-level-and-up course in the catalog crawl is in the graduate list', `${gradRows.length} of ${catalogGrad.length}`);
check(gradRows.every((r) => r.level >= 500 && r.title && typeof r.credits === 'number'), 'each row has a level of 500 or more, a title and hours');
check(!undergradRows.some((r) => r.level >= 500), 'the undergraduate course list still holds no graduate course');
const thesisRow = gradRows.find((r) => r.code === 'CS 599');
check(thesisRow?.noise === true && thesisRow.creditsMax >= 16, 'CS 599 Thesis Research is kept, flagged as a thesis row, with its 0-16 hours', JSON.stringify(thesisRow && { credits: thesisRow.credits, creditsMax: thesisRow.creditsMax, noise: thesisRow.noise }));
const prereqs = pub('illinois/graduate/prereqs.json');
check(Object.keys(prereqs).length > 2000 && Object.keys(prereqs).every((code) => byCode.has(code) && Number(code.split(' ')[1]) >= 500), 'prerequisites for over 2,000 graduate courses, keyed by graduate codes', `${Object.keys(prereqs).length}`);
const ugOnly = Object.entries(prereqs).filter(([, spec]) => (spec.groups ?? []).some((g) => /^\s*(for )?undergraduates?( students)?( only)?\s*:/i.test(g.source ?? '')));
check(ugOnly.length === 0, 'no clause written only for undergraduates is kept', ugOnly.slice(0, 3).map(([c]) => c).join(', '));
const named = new Set();
for (const p of crawl.programs) for (const o of p.options) for (const a of o.areas) for (const g of a.groups) for (const c of g.courses) named.add(norm(c.code));
const missing = [...named].filter((c) => !byCode.has(c));
check(missing.length <= 40, 'course codes the programs name that no course list has stay few (retired or renamed numbers)', `${missing.length}: ${missing.slice(0, 6).join(', ')}`);

// ---------------------------------------------------------------- the menu
console.log('\nTHE MENU (public/illinois/graduate/programs.json)');
const fresh = new Map();
for (const page of G.menuPages(crawl)) for (const r of G.adaptIllinoisGraduateProgram(page, byCode)) fresh.set(r.id, r);
const stale = menu.programs.filter((s) => !fresh.has(s.id) || fresh.get(s.id).status !== s.status || fresh.get(s.id).readHours !== s.readHours);
check(menu.programs.length === fresh.size && stale.length === 0, 'programs.json is what the crawl reads today (run scripts/illinois/graduate-build.mjs after any change)', `${menu.programs.length} rows, ${fresh.size} read, ${stale.length} differ`);
const options = G.graduateProgramOptions(menu.programs);
check(options.graduateDegrees.length > 300 && options.graduateCertificates.length >= 40 && options.graduateDegrees.every((o) => o.id.startsWith('grad:') && o.additionalCredits === o.totalCredits && o.totalCredits > 0), 'graduateProgramOptions: degrees and certificates as { id, name, totalCredits, additionalCredits }', `${options.graduateDegrees.length} degrees, ${options.graduateCertificates.length} certificates, ${options.graduateMinors.length} minors`);
const tagged = [...options.graduateDegrees, ...options.graduateCertificates];
const statusOf = new Map(menu.programs.map((x) => [x.id, x.status]));
check(tagged.every((o) => o.checked === (statusOf.get(o.id) === 'reads right') && o.name.endsWith(G.GRADUATE_NOT_CHECKED_TAG) === !o.checked) && G.graduateDisplayName(tagged.find((o) => !o.checked)?.name ?? '') === menu.programs.find((x) => x.id === tagged.find((o) => !o.checked)?.id)?.name, 'graduateProgramOptions: a reading not checked yet says "(not checked yet)" in its name, as the minors do; a checked one does not', `${tagged.filter((o) => o.checked).length} checked, ${tagged.filter((o) => !o.checked).length} tagged`);
// The browser loaders, fed from public/ instead of the network.
const localFetch = async (url) => {
  try { return { ok: true, json: async () => JSON.parse(readFileSync(join(PUBLIC, url.replace(/^\//, '')), 'utf8')) }; } catch { return { ok: false, json: async () => null }; }
};
const menuLoaded = await G.loadIllinoisGraduatePrograms(localFetch);
const histSummary = menuLoaded.find((x) => x.id === 'grad:las/history-ma~2');
const histLoaded = histSummary ? await G.loadIllinoisGraduateProgram(histSummary, byCode, localFetch) : null;
const catalogLoaded = await G.loadIllinoisGraduateCatalog(localFetch);
check(menuLoaded.length === menu.programs.length && histLoaded?.blocks.length === byId.get('grad:las/history-ma~2').blocks.length && histLoaded.program.totalCredits === 32 && catalogLoaded?.courses.length === gradRows.length && catalogLoaded.sections.length === 2, 'the browser loaders read the menu, one option of a page (History MA non-thesis) and the graduate course files', `${menuLoaded.length} rows, ${histLoaded?.blocks.length} blocks, ${catalogLoaded?.sections.length} section terms`);
const loaded = { summary: menu.programs.find((s) => s.id === 'grad:engineering/computer-science-mcs') };
const req = G.programRequirementsOf(byId.get('grad:engineering/computer-science-mcs'), byCode);
check(req.totalCredits === 32 && req.areas.length >= 1 && loaded.summary?.plannable, 'programRequirementsOf gives the rail a ProgramRequirements for MCS');

const fakeCore = { index: undergradRows.map(hydrateIndexRow), prereqs: new Map(), offerings: new Map(), sections: new Map(), sectionTerms: null };
fakeCore.byCode = new Map(fakeCore.index.map((c) => [norm(c.code), c]));
fakeCore.byId = new Map(fakeCore.index.map((c) => [c.id, c]));
const merged = G.withGraduateCourses(fakeCore, { courses: gradRows, prereqs, offerings: pub('illinois/graduate/offerings.json'), sections: [pub('illinois/graduate/sections.json')] });
check(merged.byCode.has('CS 599') && !fakeCore.byCode.has('CS 599') && merged.index.length === undergradRows.length + gradRows.length && merged.prereqs.has('CS 598') && merged.sections.size > 1000, 'withGraduateCourses adds the graduate rows, prerequisites and sections to a copy of the core', `${merged.index.length} rows, ${merged.sections.size} with sections`);

const board = await G.loadIllinoisGraduateForBoard(merged, menu.programs.find((x) => x.id === 'grad:engineering/computer-science-mcs'), localFetch);
const cs598 = merged.byCode.get('CS 598');
check(board?.blocks.length > 0 && (cs598?.requirementIds ?? []).some((id) => id.startsWith('grad:engineering/computer-science-mcs')), 'loadIllinoisGraduateForBoard points CS 598 at the MCS requirement that wants it', `${(cs598?.requirementIds ?? []).join(', ')}`);

// ---------------------------------------------------------------- fixtures
console.log('\nFIXTURES (read against their pages by hand, 2026-10-13)');
const r = (id) => byId.get(id);
const kindsOf = (x) => (x?.blocks ?? []).map((b) => b.rule.kind);
const codesOf = (x) => (x?.blocks ?? []).flatMap((b) => (b.rule.choices ?? []).flatMap((c) => c.codes));

// MCS: four hour rows, no course named on the page; 12 hours from CS 500-590 and CS 598.
const mcs = r('grad:engineering/computer-science-mcs');
const mcsPool = mcs?.blocks.find((b) => b.rule.kind === 'pool' && b.rule.choices.some((c) => c.codes[0] === 'CS 598'));
check(mcs?.status === 'reads right' && mcs.totalCredits === 32 && mcsPool?.rule.hours === 12 && mcsPool.rule.choices.every((c) => /^CS 5(?:[0-8]\d|90|97|98)$/.test(c.codes[0])), 'Computer Science MCS: 32 hours, a 12-hour pool of CS 500-590, 597 and 598', `${mcs?.readHours} read, ${mcsPool?.rule.choices.length} pool courses`);
check(pages.get('engineering/computer-science-mcs').rules.campusHours === 24 && pages.get('engineering/computer-science-mcs').typicalLength?.value === 3, 'Computer Science MCS: 24 hours on campus, three consecutive semesters');
// CS MS (thesis): CS 599 for 4 hours, 32 in all.
const csms = r('grad:engineering/computer-science-ms');
check(csms?.totalCredits === 32 && csms.blocks.some((b) => b.rule.kind === 'all' && b.rule.choices.some((c) => c.codes[0] === 'CS 599' && c.credits === 4)), 'Computer Science MS: CS 599 thesis research, 4 hours, 32 in all', csms?.why);
// CS PhD: three entering routes, never added together.
const csphd = ['~1', '~2', '~3'].map((s) => r(`grad:engineering/computer-science-phd${s}`));
check(csphd.map((x) => x?.totalCredits).join() === '64,72,96' && csphd.every((x) => x.blocks.some((b) => (b.rule.choices ?? []).some((c) => c.codes[0] === 'CS 599' && c.credits === 32))), 'Computer Science PhD: three routes of 64, 72 and 96 hours, each with 32 hours of CS 599', csphd.map((x) => `${x?.totalCredits}:${x?.status}`).join(' '));
// History MA: thesis and non-thesis, 32 each; the thesis table's own rows add to 40, so it is not right.
const histT = r('grad:las/history-ma~1');
const histN = r('grad:las/history-ma~2');
check(histT?.optionLabel === 'Thesis Option' && histN?.optionLabel === 'Non-Thesis Option' && histT.totalCredits === 32 && histN.totalCredits === 32, 'History MA: a Thesis Option and a Non-Thesis Option of 32 hours each, never 64');
check(histN?.status === 'reads right' && histT?.status === 'not yet checked' && histT.readHours === 40, 'History MA: the non-thesis route reads right; the thesis table prints 40 hours of rows under a 32-hour total and is flagged', `${histT?.readHours}`);
check(pages.get('las/history-ma').rules.min500Hours === 16 && pages.get('las/history-ma').thesis === 'both', 'History MA: 16 hours at the 500 level, thesis and non-thesis routes');
// ECE MEng: requirements printed only as rules rows; non-thesis.
const meng = r('grad:engineering/electrical-computer-engineering-meng');
check(meng?.status === 'reads right' && codesOf(meng).includes('ECE 596') && pages.get('engineering/electrical-computer-engineering-meng').thesis === 'non-thesis', 'ECE MEng: 32 hours read from the rules rows, ECE 596 project, non-thesis', meng?.why);
// MBA: Illinois offers only the online iMBA, with three entering routes.
const mba = ['~1', '~2', '~3'].map((s) => r(`grad:bus/business-administration-online-mba${s}`));
check(mba.map((x) => x?.totalCredits).join() === '72,36,48' && !pages.has('bus/mba'), 'MBA: only the online iMBA, three routes of 72, 36 and 48 hours (no on-campus MBA page)');
// "MAcc": the Master of Accounting Science.
const mas = r('grad:bus/accountancy-mas');
check(mas?.status === 'reads right' && mas.totalCredits === 32 && pages.get('bus/accountancy-mas').rules.campusHours === 32 && kindsOf(mas).filter((k) => k === 'pool').length >= 2, 'Accountancy MAS (Illinois has no MAcc): 32 hours, all on campus, choose-one lists', mas?.why);
// MSW: two entering routes; a concentration is required; 36 or 48 hours at the 500 level.
const msw = pages.get('socw/social-work-msw');
check(msw?.options.map((o) => o.totalCredits).join() === '44,64' && msw.rules.concentrationRequired === true && msw.rules.min500Text === '36 or 48', 'Social Work MSW: 44 hours with a BSW, 64 without, a concentration required');
check(r('grad:socw/social-work-msw~1')?.status === 'not yet checked', 'Social Work MSW: the degree page itself is not yet checked (its courses are on the concentration pages)');
const mswClinical = ['~1', '~2'].map((x) => r(`grad:socw/social-work-msw/advanced-clinical${x}`));
check(mswClinical.map((x) => x?.totalCredits).join() === '44,64' && mswClinical.every((x) => x.kind === 'masters' && x.degree === 'MSW'), 'Social Work MSW, Advanced Clinical Practice: its concentration page is offered as the degree, 44 hours with a BSW and 64 without', mswClinical.map((x) => `${x?.totalCredits}:${x?.status}`).join(' '));
check(menu.programs.filter((x) => x.pageId === 'socw/social-work-msw').every((x) => x.pickConcentration && !x.plannable), 'Social Work MSW: the degree row itself is not offered; a student picks one of its concentrations');
check(!byId.has('grad:las/concentration/medieval-studies'), 'an add-on concentration (Medieval Studies, 24 hours inside an MA) is not offered as a degree');
// MPH: core 28 + a 20-hour concentration = 48.
const mph = r('grad:ahs/public-health-mph');
check(mph?.totalCredits === 48 && codesOf(mph).includes('HK 517') && pages.get('ahs/public-health-mph').rules.concentrationRequired === true, 'Public Health MPH: 48 hours, HK 517 in the core, a concentration required', mph?.why);
// JD: 90 hours; the first year printed as courses; 18 hours a semester at most.
const jd = r('grad:professional/law-jd');
check(jd?.totalCredits === 90 && codesOf(jd).includes('LAW 601') && pages.get('professional/law-jd').rules.maxTermHours === 18 && jd.status === 'not yet checked', 'Law JD: 90 hours, LAW 601 in the first year, 18 a semester at most, upper years not read', jd?.why);
// DVM: no requirements on the page.
const dvm = r('grad:professional/dvm-doctor-veterinary-medicine');
check(dvm?.blocks.length === 0 && dvm.status === 'not yet checked' && !G.graduateProgramOptions(menu.programs).graduateDegrees.some((o) => o.id === dvm.id), 'Veterinary Medicine DVM: the page lists no requirements, so it is not offered');
// MD: a fixed curriculum of 189 hours.
const md = r('grad:professional/medicine-md');
check(md?.totalCredits === 189 && codesOf(md).includes('BSE 612') && menu.programs.find((x) => x.id === md.id)?.held && !G.graduateProgramOptions(menu.programs).graduateDegrees.some((o) => o.id === md.id), 'Medicine MD (Carle Illinois): 189 hours, BSE 612 in the first phase; read, but held from the menu (a fixed curriculum)', md?.why);
check(Object.keys(G.GRADUATE_HELD).every((id) => pages.has(id)), 'every held page is in the crawl');
// A graduate certificate and a graduate minor.
const cf = r('grad:engineering/computing-fundamentals-cert');
check(cf?.status === 'reads right' && cf.totalCredits === 20 && cf.kind === 'certificate', 'Computing Fundamentals certificate: 20 hours, reads right', cf?.why);
const statMinor = r('grad:las/minors/statistics');
check(statMinor?.kind === 'minor' && statMinor.totalCredits === 12, 'Statistics graduate minor: 12 hours', statMinor?.why);
// Shapes read here: (h) hours over lists, (t) a course list tab.
const bioe = r('grad:engineering/bioengineering-ms~1');
const fundamental = bioe?.blocks.find((b) => b.label === 'Fundamental Courses');
check(fundamental?.rule.kind === 'pool' && fundamental.rule.hours === 12 && fundamental.rule.choices.length > 30, '(h) Bioengineering MS: "Fundamental Courses 12" is one 12-hour list over its three category lists', `${fundamental?.rule.kind} ${fundamental?.rule.choices?.length}`);
const edm = r('grad:education/curriculum-instruction-edm');
const foundations = edm?.blocks.find((b) => b.label === 'Foundations Hours');
check(edm?.status === 'reads right' && foundations?.rule.kind === 'pool' && foundations.rule.hours === 8 && codesOf(edm).includes('EPOL 402'), '(t) Curriculum & Instruction EdM: the Foundations course list tab is the 8 Foundations hours', edm?.why);
// Tables after the last option are lists both options draw on, not part of the last option.
const mip = r('grad:las/molecular-integrative-physiology-phd~2');
const menuRow = mip?.blocks.find((b) => /Course Menu/.test(b.label));
check(menuRow?.rule.kind === 'pool' && menuRow.rule.hours === 6 && !mip.blocks.some((b) => b.rule.kind === 'all' && b.rule.choices.length > 10) && mip.status === 'not yet checked', "Molecular & Integrative Physiology PhD: the Course Menu tables are the 6 menu hours of both routes, not 15 required courses", `${menuRow?.rule.kind} ${menuRow?.rule.hours} ${mip?.status}`);
// A required course the current course listing does not have keeps a reading from reading right.
const soc = r('grad:las/sociology-ma');
const chlh = r('grad:ahs/community-health-ms');
check(soc?.status === 'not yet checked' && /SOC 500/.test(soc.why) && /SOC 485/.test(soc.why) && soc.readHours === soc.totalCredits, 'Sociology MA: the hours add up, but SOC 500 and SOC 485 are not in the course listing, so it is not yet checked', soc?.why);
check(chlh?.status === 'not yet checked' && /not in the current course catalog/.test(chlh.why) && codesOf(chlh).includes('CHLH 540') && !codesOf(chlh).includes('HK 540'), 'Community Health MS: its CHLH courses are not in the course listing (and are not mapped to HK, whose numbers differ)', chlh?.why);
check(r('grad:ler/human-resources-industrial-relations-mhrir~2')?.status === 'reads right', 'HRIR MHRIR: one retired course (LER 540) inside a long list does not stop the list from being planned');
// A course list sized only in its own label.
const mvs = r('grad:veterinary/applied-veterinary-sciences-mvs');
const mvsElectives = mvs?.blocks.find((b) => /^Electives/.test(b.label));
check(mvs?.status === 'reads right' && mvsElectives?.rule.kind === 'pool' && mvsElectives.rule.hours === 12 && mvs.readHours === 32, 'Applied Veterinary Sciences MVS: "Electives (minimum 12 credit hours)" is a 12-hour list, 20 required + 12 = the stated 32', `${mvsElectives?.rule.kind} ${mvsElectives?.rule.hours} ${mvs?.readHours}`);
check(G.listHoursOf('Electives (minimum 12 credit hours)') === 12 && G.listHoursOf('Elective Courses (choose 4 credits)') === 4 && G.listHoursOf('Select at least 7 hours from the following courses:') === 7 && G.listHoursOf('Remaining hours to total 32 hours from the following list of courses') === null && G.listHoursOf('Research hours (2 max applied toward degree)') === null, 'listHoursOf: a minimum, "choose N credits" and "select at least N hours" size a list; "to total 32" and a maximum do not');
// A PhD that reads right whole.
const phdRight = readings.filter((x) => x.kind === 'doctoral' && x.status === 'reads right');
check(phdRight.length >= 20, 'at least 20 doctoral routes read right', `${phdRight.length}`);

// ---------------------------------------------------------------- the engine
console.log('\nTHE ENGINE (four fixtures planned with the graduate settings)');
const rows = [...undergradRows, ...gradRows].map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
const gradOfferings = pub('illinois/graduate/offerings.json');
applyOfferings(rows, { ...offerings, courses: { ...offerings.courses, ...gradOfferings.courses } });
const planBy = new Map(rows.map((c) => [norm(c.code), c]));
const meta = pub('illinois/meta.json');
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map([...Object.entries(pub('illinois/prereqs.json')), ...Object.entries(prereqs)]),
  grades: new Map(),
  sections: new Map(),
  equivalents: new Map(),
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries({ ...offerings.courses, ...gradOfferings.courses })),
  offeringTerms: offerings.terms,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : 'Fall' } : null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: [], genEd: c.tags ?? [] }]));
const settings = G.graduatePlanSettings('illinois');
for (const [id, horizon] of [
  ['grad:engineering/computer-science-mcs', { startSeason: 'Fall', startYear: 2026, gradSeason: 'Fall', gradYear: 2027, stated: true }],
  ['grad:engineering/computing-fundamentals-cert', { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2027, stated: true }],
  ['grad:engineering/electrical-computer-engineering-meng', { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2027, stated: true }],
  ['grad:las/history-ma~2', { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2028, stated: true }],
]) {
  const reading = r(id);
  for (const c of rows) c.requirementIds = [];
  attachRequirementIds(rows, reading.blocks, facts);
  let g = null;
  let error = '';
  try {
    g = generatePlan({
      requirements: reading.blocks,
      context,
      prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true },
      horizon,
      preferences: { creditsPerTerm: { min: settings.minimumTermCredits, target: settings.targetTermCredits, max: 18 } },
      programId: reading.id,
      degreeTotal: reading.totalCredits,
      programName: reading.name,
      programCollege: reading.college,
      standingHours: settings.standingHours,
      electiveLevelRange: settings.electiveLevelRange,
      autoPrerequisiteLevelRange: settings.autoPrerequisiteLevelRange,
    });
  } catch (e) { error = e.message; }
  const booked = Object.entries(g?.bookedFor ?? {}).filter(([, why]) => why && String(why).startsWith('grad:')).map(([code]) => code);
  const open = (g?.unsatisfied ?? []).filter((u) => u.reason !== 'filled-by-electives');
  const grad = booked.filter((code) => Number(norm(code).split(' ')[1]) >= 400);
  const unmetAll = (g?.unsatisfied ?? []).filter((u) => u.requirementId.startsWith('grad:') && reading.blocks.find((b) => b.id === u.requirementId)?.rule.kind === 'all');
  check(g !== null && grad.length >= 1 && unmetAll.length === 0, `${reading.name}: planned, ${grad.length} graduate-level courses booked for its requirements, no required row unmet`, error || `${booked.length} booked, ${(g?.electives ?? []).length} elective cards, open: ${open.map((u) => `${u.reason} ${u.label.slice(0, 30)}`).join('; ') || 'none'}`);
}

// ---------------------------------------------------------------- scoreboard
console.log('\nTHE SCOREBOARD');
const kinds = ['masters', 'doctoral', 'other', 'certificate', 'minor', 'professional'];
for (const kind of kinds) {
  const k = readings.filter((x) => x.kind === kind);
  const right = k.filter((x) => x.status === 'reads right');
  console.log(`  ${kind.padEnd(13)} ${String(right.length).padStart(3)} of ${String(k.length).padStart(3)} read right  (${k.filter((x) => x.status === 'reads right' && x.openHours === 0).length} name every course; ${k.filter((x) => x.blocks.length === 0).length} with nothing to read)`);
}
const right = readings.filter((x) => x.status === 'reads right');
const reasons = {};
for (const x of readings.filter((y) => y.status !== 'reads right')) {
  const why = x.why.replace(/\s*\([^)]*\)/g, '').replace(/[\d.]+/g, 'N').replace(/required courses? (?:is|are) not/, 'required course(s) not');
  reasons[why] = (reasons[why] ?? 0) + 1;
}
console.log(`  ${right.length} of ${readings.length} readings (pages and their options) read right`);
for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)} not yet checked: ${why}`);
if (process.env.GRAD_VERBOSE === '1') for (const x of readings) console.log(`  ${x.status === 'reads right' ? 'right' : 'check'} ${String(x.totalCredits ?? '?').padStart(3)} stated ${String(x.readHours).padStart(5)} read  ${x.id}  ${x.why}`);
for (const id of (process.env.GRAD_SHOW ?? '').split(',').filter(Boolean)) {
  for (const x of readings.filter((y) => y.id.includes(id))) {
    console.log(`\n  ${x.id}: ${x.status}, ${x.readHours} of ${x.totalCredits} (${x.why})`);
    for (const b of x.blocks) console.log(`    ${b.rule.kind.padEnd(8)} ${String(b.hours ?? '-').padStart(3)}h ${(b.rule.choices ?? []).length} choices  ${b.label.slice(0, 70)}`);
  }
}

// 222 on the crawl of 2026-10-13: 222, less Sociology MA and PhD held for SOC 500 and SOC 485 (220),
// plus the Applied Veterinary Sciences MVS and the Minoritarian Aesthetics minor sized from their labels.
const FLOOR = Number(process.env.GRAD_FLOOR ?? 222);
check(right.length >= FLOOR, `the scoreboard holds its floor (${FLOOR})`, `${right.length}`);

console.log(failures ? `\n${failures} FAILED` : '\nall graduate checks pass');
process.exit(failures ? 1 : 0);
