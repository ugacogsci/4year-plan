/**
 * Runs generatePlan over real Illinois programs and prints what it could and
 * could not do.
 *
 * Run it with:  PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__autoplan.check.mjs
 * It re-execs itself with the type-stripping flag, so no build step is needed.
 *
 * TEMPORARY: the catalog half of the ADAPTER section below is a stand-in for
 * lib/planner/illinois-data.ts (catalog adaptation, the prerequisite grammar,
 * difficulty bands) so that the engine is exercised against the real files
 * rather than fixtures. Delete it and import the real module.
 *
 * The PROGRAM half no longer is. requirementRulesForArea is imported from the
 * real module and is the only thing that decides what a requirement group
 * means, because the two readings had already drifted: this harness held back
 * every elective menu behind a guard the product did not have, so a plan could
 * pass here and be wrong in the browser, or the reverse. One divergence
 * survives, marked DIVERGES, for the gen-ed table the real module has no label
 * to key on.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

// Node 23.3 keeps type stripping behind a flag, so re-exec once with it on.
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

// The repo imports without extensions, which node cannot resolve on its own.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { generatePlan, validatePlan, describeCreditTotal, courseIdFor, normaliseCode } = await import('./autoplan.ts');
// The product's own reading of a requirement group, not a second copy of it.
const { requirementRulesForProgram } = await import('./illinois-data.ts');

const read = (name) => {
  const path = join(PUBLIC, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
};

const catalogFile = read('illinois-catalog.json');
const programFile = read('illinois-programs.json');
const gradeFile = read('illinois-grades.json');
const sectionFile = read('illinois-sections.json');

if (!catalogFile) {
  console.error('public/illinois-catalog.json is missing. The crawl has not produced it yet.');
  process.exit(1);
}

// ===========================================================================
// ADAPTER START  (stand-in for lib/planner/illinois-data.ts)
// ===========================================================================

const GRAD_LEVEL = 500;

// ---- credits --------------------------------------------------------------
function creditRange(raw) {
  const min = raw.credits;
  const max = raw.creditsMax ?? raw.credits;
  if (min === null || min === undefined || max === null || max === undefined) {
    return { credits: 0, min: null, max: null, variable: false, known: false };
  }
  return { credits: min, min, max, variable: max > min, known: true };
}

// ---- cross-listings, union-find over every sameAs pair ---------------------
function buildEquivalents(courses) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of courses) {
    find(c.code);
    for (const other of c.sameAs ?? []) union(c.code, normaliseCode(other));
  }
  const classes = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    const list = classes.get(root);
    if (list) list.push(key);
    else classes.set(root, [key]);
  }
  const out = new Map();
  for (const members of classes.values()) {
    if (members.length < 2) continue;
    for (const code of members) out.set(code, members.filter((m) => m !== code).sort());
  }
  return out;
}

// ---- "Credit is not given for both X and Y" -------------------------------
const EXCLUSION = /Credit is not given (?:toward graduation )?for(?: both)?:?\s*([^.]+)\./gi;
function buildExclusions(courses, known) {
  const out = new Map();
  for (const c of courses) {
    EXCLUSION.lastIndex = 0;
    const found = new Set();
    let m;
    while ((m = EXCLUSION.exec(c.description ?? '')) !== null) {
      for (const code of codesIn(m[1])) {
        if (code !== c.code && known.has(code)) found.add(code);
      }
    }
    if (found.size) out.set(c.code, [...found].sort((a, b) => a.localeCompare(b)));
  }
  return out;
}

// ---- prerequisites, section 3 of the design note --------------------------
const CODE_RE = /\b([A-Z]{2,4})\s?(\d{3})\b/g;
const ONE_OF_SPLIT = /(?:\band\s+)?\b(?:any one of the following|one of the following|at least one of|any one of|any of|one of|either)\b\s*:?\s*/i;
const ADVISORY = /\b(recommend\w*|encouraged|helpful|preferred|desirable|suggested|may be taken|should also enroll|is useful|not required)\b/i;
const RESTRICTION = /^(?:restricted to|open to|intended for|enrollment in|for [a-z ]*students only|must be|priority|approved for)/i;
const CONCURRENT = /\b(?:concurrent(?:ly)?\s+(?:registration|enrollment|enrolled)|credit or concurrent)\b/i;
const ESC_CONSENT = /\bconsent of\b|\bpermission of\b|\bapproval of\b/i;
const ESC_STANDING = /\b(?:freshman|sophomore|junior|senior|graduate|undergraduate)\s+(?:standing|status)\b/i;
const ABBREV = /(?:\be\.g|\bi\.e|\betc|\bvs|\bDr|\bMr|\bMs|\bJr|\bSr|\bPh\.D|\bU\.S|\bNo)$/i;

function codesIn(text) {
  CODE_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = CODE_RE.exec(text)) !== null) out.push(`${m[1]} ${m[2]}`);
  return out;
}

function cleanPrereqText(text) {
  return text
    .replace(/\s+([,;.:])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*\bThis course\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const rough = text.split(/(?<=\.)\s+/);
  const out = [];
  for (const piece of rough) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + piece;
    else out.push(piece);
  }
  return out.filter(Boolean);
}

function parsePrerequisites(prereqText, selfCode, known) {
  const text = cleanPrereqText(prereqText ?? '');
  const spec = { groups: [], escape: null, text, parsed: false, confidence: 'none' };
  if (!text) return spec;

  const setEscape = (kind) => {
    if (spec.escape === null) spec.escape = kind;
    else if (spec.escape !== kind) spec.escape = 'either';
  };

  for (const sentence of splitSentences(text)) {
    for (const segment of sentence.split(/;\s*/)) {
      const seg = segment.trim();
      if (!seg) continue;
      const segCodes = codesIn(seg).filter((c) => c !== selfCode && known.has(c));

      if (ESC_CONSENT.test(seg)) setEscape('consent');
      else if (ESC_STANDING.test(seg) && /\bor\b/i.test(seg)) setEscape('standing');

      if (segCodes.length === 0) continue;
      if (ADVISORY.test(seg) || RESTRICTION.test(seg)) continue;

      const concurrent = CONCURRENT.test(seg);
      const cut = seg.search(ONE_OF_SPLIT);
      const head = cut >= 0 ? seg.slice(0, cut) : seg;
      const tail = cut >= 0 ? seg.slice(cut).replace(ONE_OF_SPLIT, '') : '';

      const made = [];
      for (const item of head.split(/,\s*(?:and\s+)?|\s+and\s+/i)) {
        const itemCodes = codesIn(item).filter((c) => c !== selfCode && known.has(c));
        if (itemCodes.length === 0) {
          if (/^or\b/i.test(item.trim()) && (ESC_CONSENT.test(item) || ESC_STANDING.test(item))) {
            setEscape(ESC_CONSENT.test(item) ? 'consent' : 'standing');
          }
          continue;
        }
        if (/^or\b/i.test(item.trim()) && made.length) {
          const prev = made[made.length - 1];
          for (const code of itemCodes) if (!prev.any.includes(code)) prev.any.push(code);
          continue;
        }
        made.push({
          any: itemCodes,
          concurrent,
          confidence: 'high',
          shape: itemCodes.length > 1 ? 'or' : 'single',
          source: item.trim(),
        });
      }
      if (tail) {
        const tailCodes = codesIn(tail).filter((c) => c !== selfCode && known.has(c));
        if (tailCodes.length) {
          made.push({ any: tailCodes, concurrent, confidence: 'high', shape: 'one-of', source: tail.trim() });
        }
      }

      // Step 6, the two ambiguous shapes.
      const bareComma = made.length > 1 && !/\band\b/i.test(seg) && !/\bor\b/i.test(seg);
      const parenSeq = /\([^)]*\)/.test(seg)
        && /\bor\b/i.test(seg)
        && (seg.match(/\(([^)]*)\)/g) ?? []).some((p) => codesIn(p).length >= 3);
      const example = /\be\.g\b/i.test(seg);
      if (bareComma || parenSeq || example) {
        for (const g of made) {
          g.confidence = 'low';
          g.shape = bareComma ? 'bare-comma' : 'paren-sequence';
        }
      }

      spec.groups.push(...made);
    }
  }

  spec.parsed = spec.groups.length > 0;
  spec.confidence = spec.groups.length === 0
    ? 'none'
    : spec.groups.some((g) => g.confidence === 'low') ? 'low' : 'high';
  return spec;
}

// ---- difficulty bands -----------------------------------------------------
function computeDifficultyBands(rows) {
  const d = rows.map((r) => r.difficulty).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!d.length) return { typical: 0, harder: 0, hardest: 0 };
  const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  return { typical: q(0.25), harder: q(0.75), hardest: q(0.9) };
}

// ---- catalog -> Course ----------------------------------------------------
function buildCatalog() {
  const raw = catalogFile.courses.map((c) => ({ ...c, code: normaliseCode(c.code) }));
  const known = new Set(raw.map((c) => c.code));
  const equivalents = buildEquivalents(raw);
  const exclusions = buildExclusions(raw, known);

  const sectionsByCode = new Map();
  if (sectionFile) {
    const termId = `${sectionFile.term}-${sectionFile.year}`;
    const termLabel = `${sectionFile.term[0].toUpperCase()}${sectionFile.term.slice(1)} ${sectionFile.year}`;
    for (const course of sectionFile.courses) {
      const parts = new Map();
      for (const s of course.sections) {
        const id = s.partOfTerm ?? '';
        // The date cell picks up trailing "Restriction(s):" and "Co-Request:"
        // prose, so cut at either. Keying only on the part id after that keeps
        // one part from splitting into two and inventing a deadline warning.
        const range = (s.dateRange ?? '').split(/\s*(?:Restriction\(s\):|Co-Request:)/)[0].trim() || null;
        const cur = parts.get(id);
        if (cur) cur.count += 1;
        else parts.set(id, { id, dateRange: range, count: 1 });
      }
      sectionsByCode.set(normaliseCode(course.code), {
        code: normaliseCode(course.code),
        termId,
        termLabel,
        total: course.sections.length,
        partsOfTerm: [...parts.values()].sort((a, b) => a.id.localeCompare(b.id)),
      });
    }
  }

  const courses = [];
  const creditRanges = new Map();
  const prereqs = new Map();
  let variableCredit = 0;
  let unknownCredit = 0;
  let lowConfidence = 0;
  let textOnly = 0;

  for (const c of raw) {
    if (c.level >= GRAD_LEVEL) continue;
    if (c.noise) continue;
    const range = creditRange(c);
    creditRanges.set(c.code, range);
    if (range.variable) variableCredit += 1;
    if (!range.known) unknownCredit += 1;

    const spec = parsePrerequisites(c.prereqText, c.code, known);
    if (spec.text) {
      prereqs.set(c.code, spec);
      if (spec.confidence === 'low') lowConfidence += 1;
      if (!spec.parsed) textOnly += 1;
    } else {
      prereqs.set(c.code, spec);
    }

    const summary = sectionsByCode.get(c.code);
    const hard = spec.groups
      .filter((g) => g.any.length === 1 && !g.concurrent && g.confidence === 'high')
      .map((g) => courseIdFor(g.any[0]));

    courses.push({
      id: courseIdFor(c.code),
      code: c.code,
      title: c.title,
      credits: range.credits,
      description: c.description ?? '',
      cluster: c.subject,
      requirementIds: [],
      prerequisites: hard,
      // Illinois publishes no offering term, so the permissive value is the
      // honest one and offeringPublished below stays empty.
      offeredIn: ['Fall', 'Spring'],
      format: 'In person',
      tags: c.genEd ?? [],
      section: undefined,
      mapPosition: undefined,
      pathwayRole: undefined,
      _url: c.url,
      _summary: summary,
    });
  }

  return { courses, creditRanges, prereqs, equivalents, exclusions, sectionsByCode, known, stats: { variableCredit, unknownCredit, lowConfidence, textOnly } };
}

// ---- programs -> PlanRequirement[] ----------------------------------------
const GENED_MAP = {
  'composition i': ['Composition I'],
  'advanced composition': ['Advanced Composition'],
  'humanities & the arts': ['Humanities - Hist & Phil', 'Humanities - Lit & Arts'],
  'natural sciences & technology': ['Nat Sci & Tech - Phys Sciences', 'Nat Sci & Tech - Life Sciences'],
  'social & behavioral sciences': ['Social & Beh Sci - Soc Sci', 'Social & Beh Sci - Beh Sci'],
  'cultural studies: non-western cultures': ['Cultural Studies - Non-West'],
  'cultural studies: us minority cultures': ['Cultural Studies - US Minority'],
  'cultural studies: western/comparative cultures': ['Cultural Studies - Western'],
  'quantitative reasoning': ['Quantitative Reasoning I', 'Quantitative Reasoning II'],
};

/**
 * DIVERGES from section 4(c): the crawler flattens the whole gen-ed table into
 * one note blob with no per-row label, so there is nothing for GENED_MAP to key
 * on. This pulls each category and its own "(N hours)" or "(N courses)" out of
 * the blob. "(N courses)" becomes a choose-N rule rather than N times three
 * hours, because the catalog never says a gen-ed course is three hours and
 * multiplying would be inventing the number.
 */
function genEdRulesFromNote(note) {
  const rules = [];
  const lower = note.toLowerCase();
  for (const [key, labels] of Object.entries(GENED_MAP)) {
    const at = lower.indexOf(key);
    if (at < 0) continue;
    const after = note.slice(at + key.length, at + key.length + 40);
    const hours = after.match(/^\s*\((\d+)\s+hours?\)/i);
    const courses = after.match(/^\s*\((\d+)\s+courses?/i);
    rules.push({
      key,
      labels,
      hours: hours ? Number.parseInt(hours[1], 10) : null,
      courses: courses ? Number.parseInt(courses[1], 10) : hours ? null : 1,
    });
  }
  return rules;
}

function adaptProgram(program, byCode) {
  const blocks = [];
  const counts = { all: 0, choose: 0, hours: 0, pool: 0, unparsed: 0, constraints: 0, totalRows: 0 };

  // The product's own reading. There is no second copy of this rule in the
  // harness any more: the elective guard that used to live here held nine of
  // the CS degree's twelve technical-elective groups back, and the product
  // never had it, so the two disagreed about the same catalog page.
  const byArea = requirementRulesForProgram(program, byCode);

  program.areas.forEach((area, ai) => {
    const areaId = `${program.id}::${ai}`;
    const read = byArea[ai];
    counts.totalRows += read.droppedTotalRows;

    for (const block of read.blocks) {
      const base = {
        id: `${areaId}::${block.groupIndex}`,
        areaId,
        areaLabel: area.label,
        label: block.label,
        hours: block.hours ?? (area.groups.length === 1 ? area.hours : null),
        note: block.note,
        url: program.url,
      };

      /**
       * DIVERGES from the real module, and only here. The crawler flattens the
       * whole gen-ed table into one note blob with no per-row label, so
       * genEdForLabel has nothing to key on and the real module can only report
       * the blob. This pulls each category and its own "(N hours)" or
       * "(N courses)" out of the blob. "(N courses)" becomes a choose-N rule
       * rather than N times three hours, because the catalog never says a
       * gen-ed course is three hours and multiplying would invent the number.
       */
      const genEd = genEdRulesFromNote(block.note);
      if (genEd.length > 0 && (/general education/i.test(area.label) || block.rows === 0)) {
        genEd.forEach((rule, ri) => {
          const sub = { ...base, id: `${base.id}::ge${ri}`, label: rule.key };
          if (rule.hours !== null) {
            counts.hours += 1;
            blocks.push({ ...sub, hours: rule.hours, rule: { kind: 'hours', hours: rule.hours, genEd: rule.labels, label: rule.key } });
          } else {
            const wanted = new Set(rule.labels);
            const pool = [...byCode.values()]
              .filter((c) => c.tags.some((t) => wanted.has(t)))
              .map((c) => ({ codes: [c.code], credits: c.credits }));
            counts.choose += 1;
            blocks.push({ ...sub, hours: null, rule: { kind: 'choose', n: rule.courses ?? 1, choices: pool } });
          }
        });
        continue;
      }

      counts[block.rule.kind] += 1;
      if (block.rule.kind === 'pool') counts.constraints += block.rule.constraints.length;
      blocks.push({ ...base, rule: block.rule });
    }
  });

  return { blocks, counts };
}

// ===========================================================================
// ADAPTER END
// ===========================================================================

const built = buildCatalog();
const byCode = new Map(built.courses.map((c) => [c.code, c]));

const gradeRows = gradeFile ? (Array.isArray(gradeFile) ? gradeFile : gradeFile.courses) : [];
const grades = new Map(gradeRows.map((r) => [normaliseCode(r.code), r]));
const bands = computeDifficultyBands(gradeRows);

const snapshotTerm = sectionFile
  ? {
      id: `${sectionFile.term}-${sectionFile.year}`,
      label: `${sectionFile.term[0].toUpperCase()}${sectionFile.term.slice(1)} ${sectionFile.year}`,
      season: sectionFile.term.toLowerCase() === 'fall' ? 'Fall' : 'Spring',
    }
  : null;

const context = {
  courses: built.courses,
  prereqs: built.prereqs,
  grades,
  sections: built.sectionsByCode,
  equivalents: built.equivalents,
  exclusions: built.exclusions,
  creditRanges: built.creditRanges,
  bands,
  offeringPublished: new Set(),
  snapshotTerm,
  gradeFootnote: gradeFile && gradeFile.terms
    ? `${gradeFile.source ?? 'Illinois registrar'}, ${gradeFile.terms}. History, not a prediction.`
    : null,
};

// --- a few of the golden prerequisite cases, so the harness parser is not a mystery
const GOLDEN = [
  ['AE 321', '[MATH 285] AND [TAM 210|TAM 211]'],
  ['CS 225', '[CS 126|CS 128|ECE 220] AND [CS 173|CS 413|MATH 213|MATH 314|MATH 412|MATH 413]'],
  ['ABE 455', '[CEE 350|NRES 401] AND [CEE 380|NRES 201]'],
  ['ACCY 201', 'two groups, self dropped, second concurrent'],
  ['ANTH 352', 'zero groups'],
  ['CHEM 360', "confidence 'low'"],
  ['CEE 202', '[CS 101|CS 124] AND [MATH 241]~conc'],
];
console.log('PREREQUISITE PARSER SPOT CHECK (harness stand-in, not the real module)');
for (const [code, expected] of GOLDEN) {
  const spec = built.prereqs.get(code);
  const shown = spec && spec.groups.length
    ? spec.groups.map((g) => `[${g.any.join('|')}]${g.concurrent ? '~conc' : ''}${g.confidence === 'low' ? '?' : ''}`).join(' AND ')
    : 'zero groups';
  console.log(`  ${code.padEnd(9)} ${shown}${spec?.escape ? `   escape=${spec.escape}` : ''}`);
  console.log(`  ${''.padEnd(9)} expected: ${expected}`);
}

console.log('');
console.log('CATALOG');
console.log(`  ${catalogFile.courses.length} rows, ${built.courses.length} undergraduate and non-noise`);
console.log(`  ${built.stats.variableCredit} variable credit, ${built.stats.unknownCredit} with no credit hours listed`);
console.log(`  ${built.stats.lowConfidence} low-confidence prerequisite specs, ${built.stats.textOnly} with text but no parsable group`);
console.log(`  ${built.equivalents.size} cross-listed codes, ${built.exclusions.size} with an exclusion clause`);
console.log(`  grades: ${gradeRows.length} rows, bands typical=${bands.typical} harder=${bands.harder} hardest=${bands.hardest}`);
console.log(`  sections: ${sectionFile ? `${sectionFile.courses.length} courses in ${snapshotTerm.label}` : 'not loaded'}`);

// --- programs to run -------------------------------------------------------
const WANTED = [
  'engineering/computer-science-bs',
  'engineering/civil-engineering-bs',
  'las/chemical-engineering-bs',
  'engineering/aerospace-engineering-bs',
  'ahs/community-health-bs/health-education-promotion',
  'las/statistics-bslas',
];

if (!programFile) {
  console.error('\npublic/illinois-programs.json is missing, so no program could be planned.');
  process.exit(1);
}
const programs = WANTED.map((id) => programFile.programs.find((p) => p.id === id)).filter(Boolean);
const extra = programFile.programs
  .filter((p) => p.courseCount > 10 && !WANTED.includes(p.id))
  .sort((a, b) => b.courseCount - a.courseCount);
while (programs.length < 5 && extra.length) programs.push(extra.shift());

const HORIZON = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 };
const NO_PRIOR = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true };

let totalPrereqErrors = 0;

for (const program of programs) {
  const { blocks, counts } = adaptProgram(program, byCode);
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: NO_PRIOR,
    horizon: HORIZON,
    programId: program.id,
    preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } },
  });

  console.log('\n' + '='.repeat(78));
  console.log(`${program.name}  [${program.degree || 'no degree code'}]`);
  console.log(program.url);
  console.log(`  requirement blocks: ${blocks.length}  (all ${counts.all}, choose ${counts.choose}, hours ${counts.hours}, pool ${counts.pool}, unparsed ${counts.unparsed}; ${counts.constraints} nested pool constraints, ${counts.totalRows} Total Hours rows dropped)`);

  const used = result.terms.filter((t) => t.codes.length > 0);
  console.log(`  terms used: ${used.length} of ${result.terms.length}`);
  console.log(`  planned credits: ${describeCreditTotal(result.credits.planned)}`);
  console.log(`  catalog degree hours from these blocks: ${result.credits.degreeTotal ?? 'not listed'}   unaccounted: ${result.credits.unaccounted ?? 'n/a'}`);

  for (const term of result.terms) {
    if (term.codes.length === 0) {
      console.log(`    ${term.label.padEnd(12)} empty`);
      continue;
    }
    const load = term.load;
    console.log(
      `    ${term.label.padEnd(12)} ${String(term.codes.length).padStart(2)} courses  ` +
        `${describeCreditTotal(term.credits).padEnd(11)}  ` +
        `band=${load.bandVerdict.padEnd(6)} (scheduler says ${load.verdict.padEnd(6)}) avg=${String(load.avgDifficulty ?? '--').padStart(2)}  ` +
        `weighed ${load.weighed}/${term.codes.length}  hardest-band ${load.hard.length}`,
    );
    console.log(`                 ${term.codes.join(', ')}`);
    for (const note of term.notes) console.log(`                 note: ${note}`);
  }

  // Independent re-check: run the hand-edit validator over the generated plan.
  // Anything the generator placed illegally shows up here as an error.
  const issues = validatePlan(result.plan, context, { minimumTermCredits: 12, maxTermCredits: 18 });
  const prereqErrors = issues.filter((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-'));
  totalPrereqErrors += prereqErrors.length;
  console.log(`  prerequisite violations in the generated plan: ${prereqErrors.length}`);
  for (const issue of prereqErrors.slice(0, 5)) console.log(`     ${issue.message}`);

  const byKind = {};
  for (const issue of issues) {
    const key = `${issue.severity}/${issue.title}`;
    byKind[key] = (byKind[key] ?? 0) + 1;
  }
  console.log('  validatePlan issues: ' + (Object.keys(byKind).length ? Object.entries(byKind).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} x${v}`).join(', ') : 'none'));

  for (const pool of result.pools) {
    const want = [
      pool.hoursTarget !== null ? `${pool.hoursTarget} hours` : null,
      pool.countTarget !== null ? `${pool.countTarget} courses` : null,
    ].filter(Boolean).join(' and ');
    console.log(
      `  pool: ${pool.areaLabel} / ${pool.label} -- wants ${want || 'an unstated amount'}; ` +
        `plan has ${pool.hours} hours in ${pool.count} courses; ` +
        `${pool.available} of ${pool.listed} listed courses in the snapshot; ${pool.alternatives.length} not taken`,
    );
    if (pool.picked.length) console.log(`        took: ${pool.picked.join(', ')}`);
    if (pool.fromPriorCredit.length) console.log(`        already had: ${pool.fromPriorCredit.join(', ')}`);
    for (const c of pool.constraints) {
      console.log(`        [${c.met ? 'met' : 'NOT MET'}] needs ${c.n}${c.from ? ` from "${c.from}"` : ''}, has ${c.picked.length}: ${c.picked.join(', ') || 'nothing'}`);
      console.log(`                catalog: ${c.text.slice(0, 120)}`);
    }
  }

  console.log(`  unsatisfied requirements: ${result.unsatisfied.length}`);
  for (const u of result.unsatisfied.slice(0, 6)) {
    console.log(`     [${u.reason}] ${u.areaLabel} / ${u.label}: ${u.message.slice(0, 130)}`);
  }
  if (result.unsatisfied.length > 6) console.log(`     ... and ${result.unsatisfied.length - 6} more`);

  console.log(`  courses that could not be placed: ${result.notPlaced.length}`);
  for (const n of result.notPlaced.slice(0, 6)) console.log(`     [${n.reason}] ${n.message}`);
  if (result.notPlaced.length > 6) console.log(`     ... and ${result.notPlaced.length - 6} more`);

  if (result.satisfiedByPriorCredit.length) {
    console.log(`  already satisfied by prior credit: ${result.satisfiedByPriorCredit.length} requirements`);
  }
  if (result.offering.message) console.log(`  offering: ${result.offering.message}`);
  for (const line of result.partsOfTerm.slice(0, 3)) console.log(`  parts of term: ${line}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- the transfer case, which is the whole reason PriorCredit exists --------
const transferProgram = programs[0];
if (transferProgram) {
  const { blocks } = adaptProgram(transferProgram, byCode);
  const transfer = {
    courseCodes: ['MATH 221', 'MATH 231', 'CS 124', 'RHET 105', 'PHYS 211'],
    exemptCodes: ['CHEM 102'],
    unmatchedCredits: 12,
    known: true,
  };
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: transfer,
    horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2029 },
    programId: transferProgram.id,
  });
  console.log('\n' + '='.repeat(78));
  console.log(`TRANSFER CASE: ${transferProgram.name}, 5 courses in hand, 12 unmatched hours, graduating a year earlier`);
  console.log(`  terms used: ${result.terms.filter((t) => t.codes.length).length} of ${result.terms.length}`);
  console.log(`  prior credits counted: ${result.credits.prior}`);
  console.log(`  planned credits: ${describeCreditTotal(result.credits.planned)}`);
  console.log(`  requirements already satisfied by prior credit: ${result.satisfiedByPriorCredit.length}`);
  for (const s of result.satisfiedByPriorCredit.slice(0, 6)) console.log(`     ${s.label || '(unlabelled group)'}: ${s.codes.join(', ')}`);
  const issues = validatePlan(result.plan, context, {});
  const prereqErrors = issues.filter((i) => i.severity === 'error' && i.id.startsWith('ap-prereq-'));
  totalPrereqErrors += prereqErrors.length;
  console.log(`  prerequisite violations: ${prereqErrors.length}`);
  console.log(`  could not place: ${result.notPlaced.length}`);
  for (const n of result.notPlaced.slice(0, 4)) console.log(`     [${n.reason}] ${n.message}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- the unknown-transcript case ------------------------------------------
if (transferProgram) {
  const { blocks } = adaptProgram(transferProgram, byCode);
  const result = generatePlan({
    requirements: blocks,
    context,
    prior: { courseCodes: [], exemptCodes: [], unmatchedCredits: 30, known: false },
    horizon: HORIZON,
    programId: transferProgram.id,
  });
  console.log('\n' + '='.repeat(78));
  console.log('UNKNOWN TRANSCRIPT CASE: student says they transferred, did not say what they took');
  for (const note of result.notes) console.log(`  note: ${note}`);
}

// --- degraded mode: prerequisites not loaded -------------------------------
if (transferProgram) {
  const { blocks } = adaptProgram(transferProgram, byCode);
  const degraded = { ...context, prereqs: undefined };
  const result = generatePlan({ requirements: blocks, context: degraded, prior: NO_PRIOR, horizon: HORIZON, programId: transferProgram.id });
  const issues = validatePlan(result.plan, degraded, {});
  console.log('\n' + '='.repeat(78));
  console.log('DEGRADED MODE: prerequisites never loaded');
  console.log(`  terms used: ${result.terms.filter((t) => t.codes.length).length}`);
  for (const note of result.notes) console.log(`  note: ${note}`);
  const unchecked = issues.find((i) => i.id === 'ap-prereqs-unloaded');
  console.log(`  validatePlan says: ${unchecked ? unchecked.message : 'NOTHING, which would be a bug'}`);
}

console.log('\n' + '='.repeat(78));
console.log(`TOTAL PREREQUISITE VIOLATIONS ACROSS EVERY GENERATED PLAN: ${totalPrereqErrors}`);
process.exit(totalPrereqErrors === 0 ? 0 : 1);
