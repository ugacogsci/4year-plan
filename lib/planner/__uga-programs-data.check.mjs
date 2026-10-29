/**
 * UGA degree data guard (2026-10-29): every bachelor's degree's requirements,
 * as the planner reads them (public/uga-programs.json after
 * applyUgaProgramOverrides, through uga-source.tsx loadUgaProgram), add up
 * and can be met.
 *
 * The 2026-10-29 audit of all 161 bachelor's degrees against the Bulletin
 * found three kinds of fault no check caught, each of which a board shows
 * the student as if it were the degree:
 *
 *   1. Hours that do not add up: a program's areas come to more than its
 *      degree total (Economics AB's Required Courses counted twice, 129 of
 *      120 hours; every "all paths at once" degree, 141 to 204).
 *   2. A whole section missing: areas far short of the degree total, the
 *      rest planned as electives (Social Studies Education held 57 of 120
 *      hours), or hours the page's rows were not read for, which the board
 *      fills with electives "an advisor should confirm" (parser gaps).
 *   3. A row that can never be met: a choice of more courses than it lists,
 *      or a pool asking more hours than its courses hold (Journalism's 15
 *      hours from JOUR 5010, a one-credit course; Biochemistry's 12 from 4).
 *
 * A degree with a known fault is listed below, with what is wrong, until a
 * reader fix or an override (lib/planner/uga-program-overrides.ts) repairs
 * it; the check fails on any fault a degree does not have listed, so a
 * change to the reader or the data cannot add one unseen. A listed fault
 * that is gone is reported, to be taken off the list.
 *
 *   node lib/planner/__uga-programs-data.check.mjs
 *   UGA_PROGRAMS_FILE=<other uga-programs.json> node lib/planner/__uga-programs-data.check.mjs   (another copy of the data)
 *   UGA_DATA_REPORT=<out.json> ...   (every degree's faults and numbers, for comparing two copies)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

const read = (name) => JSON.parse(readFileSync(name === 'uga-programs.json' && process.env.UGA_PROGRAMS_FILE ? process.env.UGA_PROGRAMS_FILE : join(PUBLIC, name), 'utf8'));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => new Response(JSON.stringify(read((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
const U = await import(join(ROOT, 'components/planner/uga-source.tsx'));
const data = await U.loadUgaData();
globalThis.fetch = originalFetch;
const { ugaOverlapArea } = await import(join(HERE, 'uga-program-overrides.ts'));

/**
 * Known faults, by program id, as of the 2026-10-29 reader: each kind the
 * degree has, what it is, and the audit's top issue for the degree
 * (uga-audit/inventory.md). "over" = areas total more than the degree;
 * "short" = areas total 7 or more hours under it; "gap" = hours the page's
 * rows were not read for; "never" = a row that cannot be met. Most need a
 * hand-written override (lib/planner/uga-program-overrides.ts) or a rule
 * the reader does not have (a language sequence, a college's rules).
 */
const KNOWN = {
  // Advertising AB: unread: VI. Courses Related to the Major (3). Audit: Major Electives (15 h) missing; two prefix rows unnamed
  98779: 'gap',
  // Agricultural Engineering BSAE: unread: VI. Courses Related to the Major (2). Audit: Required emphasis scrambled across emphases, and optional
  29981: 'gap',
  // Animal and Dairy Science BSA: areas 113 of 120. Audit: Three upper-level ADSC electives dropped (7 h unnamed)
  75032: 'short',
  // Animal Biosciences BS: areas 88 of 120. Audit: Whole Required Courses block (26-28 h) missing
  27361: 'short',
  // Animal Health BSA: unread: Major Electives (13). Audit: Required courses merged into a 24-h pick (BCMB 3100, organic chem skippable); Major Electives missing
  18956: 'gap',
  // Applied Biotechnology BSAB: areas 107 of 120. Audit: Major matches (low notes)
  47637: 'short',
  // Art BFA - Animation: areas 57 of 120. Audit: Whole Required Courses section missing
  71747: 'short',
  // Art History AB: unread: Major Electives (15). Audit: ’Choose 2 to 3’ of 11 read as take all 11 (33 h)
  66399: 'gap',
  // Art: Interdisciplinary Art AB: unread: Required Courses (15). Audit: Area VI pick 2 of ten groups read as all 22 courses
  86044: 'gap',
  // Asian Languages and Literature AB: unread: VI. Courses Related to the Major (1). Audit: No major courses unless an emphasis is picked (optional); Area VI languages missing
  88637: 'gap',
  // Atmospheric Sciences BS: unread: VI. Courses Related to the Major (2); cannot be met: General Electives: 28 hours from 23. Audit: General Electives: 28-h pool of 23 h of courses, can never be met
  29248: 'gap never',
  // Biochemical Engineering BSBCHE: unread: VI. Courses Related to the Major (2). Audit: Major matches
  82357: 'gap',
  // Biochemistry and Molecular Biology BS: unread: VI. Courses Related to the Major (2); cannot be met: Major Electives: 12 hours from 4. Audit: Major Electives pool (12 h from 4 h of courses) can never be met
  95737: 'gap never',
  // Biological Engineering BSBE: unread: VI. Courses Related to the Major (2). Audit: Science electives: only STAT 3110 kept (prefix rows dropped)
  89691: 'gap',
  // Biology BS: areas 112 of 120; unread: Required Courses (1). Audit: Franklin language missing; Organismal 7 h / Lab 1 h pools (page: 3-5 h each)
  45780: 'short gap',
  // Biomedical Physiology BS: areas 111 of 120; unread: Required Courses (2). Audit: Upper-division major electives (6 h) missing
  18982: 'short gap',
  // Cellular Biology BS: areas 110 of 120. Audit: BCMB 3100 and 4010 both required (one counts); CBIO 4980R at 1 h (page 6)
  70249: 'short',
  // Chemistry BSCHEM: unread: Required Courses (2). Audit: Major matches; Franklin multicultural missing; research at 1 h
  97290: 'gap',
  // Civil Engineering BSCE: unread: Major Electives (2). Audit: Major Electives forced across all 4 tracks; one pool can never be met
  79689: 'gap',
  // Classics AB: areas 102 of 120; unread: VI. Courses Related to the Major (6). Audit: Emphasis rules flattened: a Greek or Latin plan need not include Greek/Latin
  82769: 'short gap',
  // Computer Systems Engineering BSCSE: unread: VI. Courses Related to the Major (1). Audit: Major Electives: 1 course planned instead of 4
  45516: 'gap',
  // Criminal Justice AB: unread: Major Electives (6). Audit: Area VI forces five named courses; Major Electives 21 h instead of 15
  64585: 'gap',
  // Culinary Science and Nutrition BSFCS: areas 113 of 120. Audit: NUTR 3610 booked without its lab NUTR 3610L
  12516: 'short',
  // Dance AB: unread: VI. Courses Related to the Major (3); cannot be met: Dance Technique and Performance: 6 hours from 4; Dance Technique and Performance: 4 hours from 2. Audit: OPTIONAL teacher certification (33 h) required (150 h of 120)
  71373: 'gap never',
  // Ecology AB: areas 113 of 120; unread: Natural History (1). Audit: 3 major electives held as two 1-h pools in a 3-h area; Odum rules missing
  38829: 'short gap',
  // Ecology BS: areas 109 of 120; unread: Required Courses (1). Audit: Methods 14 h / electives 1 h (page: 3-4 / 11-16); Odum rules missing
  86043: 'short gap',
  // Economics AB: areas 138 of 120; unread: VI. Courses Related to the Major (5), Required Courses (21). Audit: Required Courses double-counted (129 h); Major Electives and language missing
  77024: 'over gap',
  // Elementary Education BSED: areas 90 of 120. Audit: Student teaching EDEL 5460 at 3 h (page 12); ~15 h short
  90610: 'short',
  // Environmental Economics and Management BSES: unread: VI. Courses Related to the Major (2). Audit: Pick 12 h from four lists read as three whole lists (~34 courses)
  66704: 'gap',
  // Environmental Engineering BSENVE: unread: VI. Courses Related to the Major (1). Audit: Electives: 7 planned (6 from Group A); design-course rule lost
  73693: 'gap',
  // Environmental Resource Science BSES: areas 60 of 120. Audit: Whole Required Courses (~44 h) and Major Electives missing (60 of 120 h)
  27349: 'short',
  // Fashion Merchandising BSFCS: areas 113 of 120. Audit: Required emphasis (24-h Major Electives) missing; emphasis optional
  48680: 'short',
  // Film AB: unread: VI. Courses Related to the Major (15). Audit: All three paths required at once (126 h of 120)
  29901: 'gap',
  // Fisheries and Wildlife BSFR: areas 136 of 120; unread: VI. Courses Related to the Major (1). Audit: All three emphases required (204 h of 120); 57 h unnamed
  70392: 'over gap',
  // Food Science BSA: cannot be met: Major Electives: Areas of emphasis: Business: 25 hours from 5. Audit: Both emphases required, rows shifted between them
  35947: 'never',
  // Forestry BSFR: unread: VI. Courses Related to the Major (1). Audit: Warnell calculus/chemistry/biology rules not guaranteed
  61717: 'gap',
  // French AB: unread: VI. Courses Related to the Major (3). Audit: Area VI FREN 2001 AND 2002 read as one course
  56782: 'gap',
  // Genetics BS: areas 109 of 120. Audit: Lab ’Option 1 OR Option 2’ read as both; ’only one’ pairs both required
  83049: 'short',
  // Geography AB: areas 109 of 120; unread: VI. Courses Related to the Major (5). Audit: Franklin rules missing; GE must be upper division; GEOG labs dropped
  68705: 'short gap',
  // Geography BS: areas 109 of 120. Audit: Franklin rules missing; 4-h lab science unnamed; GE must be upper division
  22757: 'short',
  // Geology AB: areas 113 of 120; unread: VI. Courses Related to the Major (2). Audit: Major matches; Franklin rules missing; GEOL labs can be skipped
  70540: 'short gap',
  // Geology BS: unread: VI. Courses Related to the Major (2). Audit: Franklin rules missing; lecture+lab pairs lose labs
  90385: 'gap',
  // Health and Physical Education BSED: unread: VI. Courses Related to the Major (1). Audit: Both 13-h options required + 13-h gap (143 h of 120)
  28666: 'gap',
  // Health Promotion BSHP: unread: VI. Courses Related to the Major (3). Audit: Required emphasis treated as optional: default board has no Area VI
  33197: 'gap',
  // Honors Interdisciplinary Studies AB: areas 69 of 120. Audit: Self-designed: no Area VI or major (69 of 120 h)
  71506: 'short',
  // Honors Interdisciplinary Studies BS: areas 39 of 120. Audit: Self-designed: only the core on the board
  70139: 'short',
  // Honors Interdisciplinary Studies BSA: areas 105 of 120; unread: VI. Courses Related to the Major (18), Major Electives (18). Audit: Self-designed: Area VI and major missing
  92067: 'short gap',
  // Horticulture BSA: unread: VI. Courses Related to the Major (7). Audit: Major Electives pool has no HORT courses; ’6 h upper HORT’ can never be met
  33716: 'gap',
  // Housing Management and Policy BSFCS: unread: Required Courses (2). Audit: Option I AND Option II both required (page: pick one)
  28344: 'gap',
  // Human Development and Family Science BSFCS: unread: Required Courses (26). Audit: Major Electives (9 h HDFS) folded into a 26-h unnamed gap
  67554: 'gap',
  // Interdisciplinary Studies AB: areas 126 of 120. Audit: Athens + two Griffin versions all on the board at once
  76673: 'over',
  // Interdisciplinary Studies BFA: areas 87 of 120; unread: Major Electives (18). Audit: Self-designed: Area VI, primary and related subjects missing
  73709: 'short gap',
  // Interdisciplinary Studies BS: areas 39 of 120. Audit: Self-designed: no Area VI and no major (39 h + filler)
  21398: 'short',
  // International Affairs AB: unread: VI. Courses Related to the Major (6). Audit: Language through 4th term not planned; both OPTIONAL emphases required
  24662: 'gap',
  // Linguistics AB: unread: VI. Courses Related to the Major (6). Audit: Major Electives (6 h LING) missing; Area VI forces three courses
  84398: 'gap',
  // Management and International Business Co-Major BBA: unread: Upper Division General Electives (8). Audit: Upper-division electives read as 9 courses, not 9 hours; IB language + immersion missing
  11214: 'gap',
  // Mathematics BS: areas 109 of 120; unread: VI. Courses Related to the Major (2). Audit: Franklin rules missing; ’two MATH 3510+’ unnamed; picked emphasis takes all
  69357: 'short gap',
  // Mechanical Engineering BSME: unread: VI. Courses Related to the Major (2). Audit: 14+2 unnamed hours added (heading 70 h, rows 56 h): ~142 h on a 130-h degree
  20122: 'gap',
  // Microbiology BS: areas 112 of 120. Audit: Lab-skills course + two lists collapsed to ’choose 1’; 10 h unnamed
  57726: 'short',
  // Music BMus - Music Performance: unread: Major Electives (8). Audit: Pick-one Elective Track read as Piano AND Vocal tracks (132 h of 120)
  16876: 'gap',
  // Natural Resource Management and Sustainability BSFR: unread: VI. Courses Related to the Major (4). Audit: All three 32-h emphases required (181 h of 120)
  51733: 'gap',
  // Neuroscience BS: unread: Cellular Biology (1). Audit: Franklin rules missing; CBIO 4980 research at 1 h; 14 upper-division GE h
  30336: 'gap',
  // Ocean Science BS: areas 90 of 120. Audit: Three optional 0-6 h lists each required (~9-10 extra h)
  39199: 'short',
  // Parks, Recreation, and Tourism Management BSFR: unread: VI. Courses Related to the Major (3). Audit: Major Electives (10 h) became three 1-h pools; labs dropped; Warnell rules
  99141: 'gap',
  // Pharmaceutical and Biomedical Sciences BS: areas 107 of 120. Audit: Emphasis required courses read as small picks (required PMCY courses skippable)
  28389: 'short',
  // Plant Biology BS: areas 111 of 120; unread: VI. Courses Related to the Major (3). Audit: All three emphases required + 13-h gap (152 h of 120)
  62409: 'short gap',
  // Political Science AB: areas 96 of 120. Audit: Optional emphasis required on every board; Area VI language dropped
  46524: 'short',
  // Political Science BS: areas 108 of 120. Audit: SPIA rules missing (language to 3rd term, literature, 2 FA/P/R, diversity)
  12235: 'short',
  // Public Relations AB: unread: VI. Courses Related to the Major (3). Audit: Major Electives (15 h) missing; Area VI language course unnamed
  63054: 'gap',
  // Regenerative Bioscience BS: areas 111 of 120. Audit: Lab ’Group A OR Group B’ read as Group A + all 11 Group B labs
  77774: 'short',
  // Religion AB: unread: VI. Courses Related to the Major (3), Required Courses (18). Audit: Required 21 h: category rule lost, 18 h unnamed; Area VI forces LACS 1000 + 2010
  13716: 'gap',
  // Romance Languages AB: areas 201 of 120; unread: VI. Courses Related to the Major (12), Major Language: French (3). Audit: Seven options flattened into 8 required areas (183 h of 120); Area VI missing
  58425: 'over gap',
  // Russian AB: areas 141 of 120; unread: Russian and Slavic Studies Track (18), Intensive Russian Language Track (15). Audit: Both tracks required (141 h of 120); RUSS/SLAV electives unnamed
  76210: 'over gap',
  // Science Education BSED: areas 113 of 120; unread: Required Courses (4). Audit: No science content without an emphasis pick; ESCI 5460 at 1 h (page 12)
  79643: 'short gap',
  // Social Entrepreneurship for Consumer Well-Being BSFCS: unread: VI. Courses Related to the Major (9), Required Courses (15); cannot be met: Major Electives: 6 hours from 3. Audit: 24 of 37 required h unnamed; a 6-h pool holds one 3-h course
  77137: 'gap never',
  // Social Studies Education BSED: unread: Required Courses (2). Audit: Whole Required Courses (57 h) missing; language missing
  79831: 'gap',
  // Social Work BSW: areas 123 of 120; unread: Required Courses (6). Audit: Major matches (low: 6-h unnamed block; heading 46 h vs rows 40 h)
  51439: 'over gap',
  // Sociology AB: unread: VI. Courses Related to the Major (1). Audit: Methodology path: 27-h pool from 24 h of courses, can never be met
  77932: 'gap',
  // Spanish AB: unread: VI. Courses Related to the Major (3). Audit: General track AND the emphasis both required (page: pick one)
  21871: 'gap',
  // Special Education BSED: unread: VI. Courses Related to the Major (6). Audit: No major courses unless an emphasis is picked; student teaching 7 h (page 15)
  90477: 'gap',
  // TESOL and World Language Education BSED: areas 93 of 120. Audit: Areas IV-VI missing; all four languages and all six emphases required
  42194: 'short',
  // Theatre AB: areas 111 of 120. Audit: No Major Electives by default; picked emphasis requires every course
  93915: 'short',
};

/** Every fault of a loaded degree, and the numbers they come from. */
function faultsOf(program) {
  // A degree that asks the student to pick a path or emphasis is read with its first (setup's default).
  const selections = Object.fromEntries(U.ugaSelectionRequirements(program).filter((q) => q.minimum > 0).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
  const loaded = U.loadUgaProgram(data, program, { emphasisSelections: selections });
  const total = program.totalCredits ?? 0;
  const areaHours = loaded.program.areas.filter((area) => !ugaOverlapArea(area.label)).reduce((sum, area) => sum + (area.hours || 0), 0);
  const gaps = loaded.blocks.filter((block) => block.rule.kind === 'hours' && block.rule.source === 'parser-gap');
  const gapHours = gaps.reduce((sum, block) => sum + block.rule.hours, 0);
  const never = [];
  for (const block of loaded.blocks) {
    const rule = block.rule;
    const label = `${block.areaLabel}${block.label && block.label !== block.areaLabel ? `: ${block.label}` : ''}`;
    if (rule.kind === 'all' && rule.choices.length === 0) never.push(`${label}: nothing listed`);
    if (rule.kind === 'choose' && rule.n > rule.choices.length) never.push(`${label}: choose ${rule.n} of ${rule.choices.length}`);
    if (rule.kind === 'pool' && !rule.anyCourse) {
      const listed = rule.choices.reduce((sum, choice) => sum + (choice.creditsMax ?? choice.credits ?? 0), 0);
      if (rule.hours !== null && rule.hours > listed) never.push(`${label}: ${rule.hours} hours from ${listed}`);
      if (rule.n !== null && rule.n > rule.choices.length) never.push(`${label}: ${rule.n} courses from ${rule.choices.length}`);
    }
  }
  const faults = [];
  if (total > 0 && areaHours > total) faults.push('over');
  if (total > 0 && areaHours < total - 6) faults.push('short');
  if (gapHours > 0) faults.push('gap');
  if (never.length > 0) faults.push('never');
  return { faults, total, areaHours, gapHours, gaps: gaps.map((block) => `${block.areaLabel} (${block.rule.hours})`), never };
}

const programs = data.programs.filter((program) => U.isUgaUndergraduateDegree(program));
const report = {};
const unlisted = [];
const repaired = [];
for (const program of programs) {
  const found = faultsOf(program);
  report[program.id] = { name: program.name, ...found };
  const known = new Set((KNOWN[program.id] ?? '').split(' ').filter(Boolean));
  for (const kind of found.faults) if (!known.has(kind)) unlisted.push(`${program.name} (${program.id}) ${kind}: ${kind === 'never' ? found.never.join('; ') : kind === 'gap' ? found.gaps.join(', ') : `areas ${found.areaHours} of ${found.total}`}`);
  for (const kind of known) if (!found.faults.includes(kind)) repaired.push(`${program.name} (${program.id}) ${kind}`);
}
if (process.env.UGA_DATA_REPORT) writeFileSync(process.env.UGA_DATA_REPORT, JSON.stringify(report, null, 1));

const count = (kind) => Object.values(report).filter((r) => r.faults.includes(kind)).length;
console.log(`UGA bachelor's degrees: ${programs.length}; areas over the degree total ${count('over')}, 7+ hours short ${count('short')}, with unread hours ${count('gap')} (${Object.values(report).reduce((sum, r) => sum + r.gapHours, 0)} hours), with a row that cannot be met ${count('never')}`);
if (repaired.length) console.log(`  repaired, to take off the known list: ${repaired.join(' | ')}`);
if (unlisted.length) {
  console.log(`FAIL ${unlisted.length} fault(s) no known entry names:\n  ${unlisted.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS every UGA bachelor\'s degree fault is a known one');
