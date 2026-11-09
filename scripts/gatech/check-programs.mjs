/**
 * How the CourseLeaf engine reads public/gatech-programs.json, measured with
 * the engine's own adapter, not a copy of it.
 *
 * It runs adaptIllinoisPrograms (lib/planner/illinois-data.ts), the function
 * the browser and build-index both run, over the Georgia Tech degrees, and
 * sorts every requirement block it produces into one of these:
 *
 *   course      a course group the planner can book: 'all', 'choose', or a
 *               pool with a size (hours or a count)
 *   free        a free-elective block: 'hours' with no gen-ed under a Free
 *               Electives label, which the planner fills with editable
 *               elective cards
 *   open        an 'hours' block shape-programs.mjs left open on purpose,
 *               because neither the row's words nor its footnotes name a
 *               course ("Advisor approved courses"); filled the same way
 *   note        an honest note: an 'unparsed' block with no hours of its own
 *               that names no course (a zero-hour reminder such as "Economics
 *               Requirement")
 *   unbookable  a pool none of whose courses is in the engine's catalog (the
 *               research and internship rows the catalog flags as noise)
 *   UNKNOWN     everything else: a sentence that carries hours, an 'hours'
 *               block that is not free electives ("Any HUM" read as hours), a
 *               pool with no size, an Illinois gen-ed category or language rule
 *
 * Two more measures, because a block can read as a course group and still be
 * wrong:
 *   - per area, the hours its blocks can book against the hours the catalog
 *     prints for it (a row the reading dropped shows as a short area);
 *   - required rows read as optional: a row the page prints unindented with
 *     its own hours must land in an 'all' block, not in a list to pick from
 *     (the raw parse read CS 2110 as optional on every CS thread page).
 *
 * Run from the worktree root:
 *   export PATH="/opt/homebrew/opt/node@23/bin:$PATH"
 *   node scripts/gatech/check-programs.mjs                 # summary + 20 worst
 *   node scripts/gatech/check-programs.mjs --all           # one line per degree
 *   node scripts/gatech/check-programs.mjs --show <id>     # every block of one degree
 *   node scripts/gatech/check-programs.mjs --file <path>   # another programs file (a --raw parse, say)
 *   node scripts/gatech/check-programs.mjs --json <path>   # also write the per-degree table
 *
 * Course numbers: Georgia Tech's are four digits with an optional letter
 * (CHEM 1211K); setCourseNumberDigits(4, true) is applied when the adapter
 * has it. The catalog's levels (1000..9000) are read as floor(number/1000)*100
 * before the adapter's graduate cut, as the school-config contract puts it.
 * An Illinois campus gen-ed area, should one ever be appended to a Georgia
 * Tech degree, is counted apart as `campus`.
 *
 * This reads the requirements, not the plans. lib/planner/__gatech-inventory
 * builds a plan for every degree from the built artifacts in public/gatech/.
 *
 * Exit code: 0 always, unless the adapter throws (2). It reports; it does
 * not gate.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

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
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const PROGRAMS = opt('--file') ?? join(ROOT, 'public', 'gatech-programs.json');
const SHOW = opt('--show');
const JSON_OUT = opt('--json');
const ALL = args.includes('--all');

const data = await import(join(ROOT, 'lib', 'planner', 'illinois-data.ts'));
const { adaptIllinoisCatalog, adaptIllinoisPrograms } = data;
const CAMPUS = data.CAMPUS_GENED_AREA_LABEL ?? 'General Education Requirements (campus)';

let digitsNote;
if (typeof data.setCourseNumberDigits === 'function') {
  data.setCourseNumberDigits(4, true);
  digitsNote = 'setCourseNumberDigits(4, true) applied.';
} else {
  digitsNote = 'setCourseNumberDigits is not in illinois-data.ts yet (WP2); read with the Illinois 3-digit default.';
}

const catalogFile = JSON.parse(readFileSync(join(ROOT, 'public', 'gatech-catalog.json'), 'utf8'));
const programsFile = JSON.parse(readFileSync(PROGRAMS, 'utf8'));

// The catalog file prints a course's level as 1000..9000. The engine's graduate
// line is ILLINOIS_GRAD_LEVEL (500), so the level is read the way the
// school-config contract puts it, floor(number / 1000) * 100, before the
// catalog adapter drops graduate rows. Undergraduate rows only, as the browser.
const catalog = {
  ...catalogFile,
  courses: (catalogFile.courses ?? []).map((c) => {
    const n = parseInt(String(c.number ?? '').replace(/\D+$/, ''), 10);
    return { ...c, level: Number.isFinite(n) ? Math.floor(n / 1000) * 100 : c.level };
  }),
};
const { courses } = adaptIllinoisCatalog(catalog);
const norm = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const byCode = new Map(courses.map((c) => [norm(c.code), c]));

let adapted;
try {
  adapted = adaptIllinoisPrograms(programsFile, byCode);
} catch (err) {
  console.error('adaptIllinoisPrograms threw:', err);
  process.exit(2);
}

const FREE = /\bfree\s+electives?\b/i;
// An unparsed sentence is an honest note when it states no hours and names no course.
const HOURS_WORDS = /\b\d{1,2}\s*(?:-\s*\d{1,2}\s*)?(?:credit\s*)?(?:hours?|hrs?|credits?)\b/i;
const CODE_WORDS = /\b[A-Z]{2,4}\s?\d{4}[A-Z]?\b/;

/** The raw group a block was read from (its id is `${program}::${area}::${group}[::suffix]`). */
function rawGroupOf(block) {
  const [pid, ai, gi] = block.id.split('::');
  return rawById.get(pid)?.areas?.[Number(ai)]?.groups?.[Number(gi)] ?? null;
}

function classify(block) {
  const rule = block.rule;
  if (block.areaLabel === CAMPUS) return 'campus';
  const shaped = rawGroupOf(block)?.shaped?.kind;
  // An 'hours' block the shaper left open on purpose: the catalog names no course for it.
  if (rule.kind === 'hours' && shaped === 'open') return 'open';
  if (rule.kind === 'hours' && shaped === 'free' && (!rule.genEd || rule.genEd.length === 0)) return 'free';
  switch (rule.kind) {
    case 'all':
    case 'choose':
      return rule.choices.length > 0 ? 'course' : 'UNKNOWN';
    case 'pool':
      if (!(rule.choices.length > 0 && (rule.hours !== null || rule.n !== null))) return 'UNKNOWN';
      // A list none of whose courses the engine's catalog holds cannot be booked.
      return rule.choices.some((c) => c.codes.some((code) => byCode.has(norm(code)))) ? 'course' : 'unbookable';
    case 'hours':
      return (!rule.genEd || rule.genEd.length === 0) && (FREE.test(rule.label ?? '') || FREE.test(block.label ?? '') || FREE.test(block.areaLabel ?? '')) ? 'free' : 'UNKNOWN';
    case 'unparsed': {
      // An honest note: words with no hours of their own (a zero-hour reminder such as "Economics
      // Requirement"), naming no course. A sentence whose group carries hours is a requirement unread.
      const g = rawGroupOf(block);
      const sized = (g?.hours ?? 0) > 0 || (g?.comments ?? []).some((c) => c.hours > 0);
      return !sized && !HOURS_WORDS.test(rule.text) && !CODE_WORDS.test(rule.text) && !/^\s*(?:select|choose|any|lab science)\b/i.test(rule.text) ? 'note' : 'UNKNOWN';
    }
    default:
      return 'UNKNOWN';
  }
}

/** The hours a block can book, for the per-area balance. */
function bookable(block) {
  const rule = block.rule;
  const credit = (c) => c.credits ?? 0;
  switch (rule.kind) {
    case 'all':
      return rule.choices.reduce((s, c) => s + credit(c), 0);
    case 'choose': {
      // The block's own hours where the page states them ("Select two of the following" 6), else the
      // fewest hours n of its choices can make.
      if (block.hours !== null && block.hours !== undefined) return block.hours;
      const sorted = rule.choices.map(credit).sort((a, b) => a - b);
      return sorted.slice(0, rule.n).reduce((s, x) => s + x, 0);
    }
    case 'pool': {
      if (rule.hours !== null) return rule.hours;
      if (rule.n !== null) {
        // Choices the catalog prices; a list of research and graduate rows reads as 0 otherwise.
        const priced = rule.choices.filter((c) => c.credits !== null && c.credits !== undefined);
        const sorted = (priced.length >= rule.n ? priced : rule.choices).map(credit).sort((a, b) => a - b);
        return sorted.slice(0, rule.n).reduce((s, x) => s + x, 0);
      }
      return 0;
    }
    case 'hours':
      return rule.hours ?? 0;
    case 'gened':
      return 0;
    default:
      return 0;
  }
}

const rawById = new Map((programsFile.programs ?? []).map((p) => [p.id, p]));
const rows = [];
const totals = { course: 0, free: 0, open: 0, note: 0, unbookable: 0, UNKNOWN: 0, campus: 0 };
const unknownTexts = new Map();
let missingCodes = new Map();

for (const program of adapted.programs) {
  const raw = rawById.get(program.id);
  if (!raw || !(raw.areas?.length > 0)) continue;
  const blocks = adapted.blocks.get(program.id) ?? [];
  const tally = { course: 0, free: 0, open: 0, note: 0, unbookable: 0, UNKNOWN: 0, campus: 0 };
  const unknown = [];
  const byArea = new Map();
  for (const b of blocks) {
    const k = classify(b);
    tally[k] += 1;
    totals[k] += 1;
    if (k === 'UNKNOWN') {
      const what = `${b.areaLabel} | ${b.rule.kind} | ${(b.rule.text ?? b.rule.label ?? b.label ?? '').slice(0, 90)}`;
      unknown.push(what);
      const key = `${b.rule.kind}: ${(b.rule.text ?? b.rule.label ?? b.label ?? '').slice(0, 70)}`;
      unknownTexts.set(key, (unknownTexts.get(key) ?? 0) + 1);
    }
    if (k !== 'campus') byArea.set(b.areaId, (byArea.get(b.areaId) ?? 0) + bookable(b));
    for (const c of b.rule.choices ?? []) {
      for (const code of [...c.codes, ...(c.bundles ?? []).flat()]) {
        if (!byCode.has(norm(code))) missingCodes.set(norm(code), (missingCodes.get(norm(code)) ?? 0) + 1);
      }
    }
  }
  // Required rows read as required: a row the page prints unindented with its own hours (and that no
  // shaped list took) must sit in an 'all' block, or a choice of every one of its block's rows.
  const mustTake = new Set();
  for (const area of raw.areas) for (const g of area.groups ?? []) {
    if (g.shaped) continue;
    for (const r of g.courses ?? []) if (!r.indented && r.credits != null && byCode.has(norm(r.code))) mustTake.add(norm(r.code));
  }
  const taken = new Set();
  for (const b of blocks) {
    const r = b.rule;
    if (r.kind === 'all' || (r.kind === 'choose' && r.n >= r.choices.length)) for (const c of r.choices) for (const code of [...c.codes, ...(c.bundles ?? []).flat()]) taken.add(norm(code));
  }
  const optional = [...mustTake].filter((c) => !taken.has(c));
  totals.requiredNotRequired = (totals.requiredNotRequired ?? 0) + optional.length;

  // Area balance: the hours the blocks can book against the hours the catalog prints.
  const short = [];
  raw.areas.forEach((area, ai) => {
    const want = area.hours ?? 0;
    const got = byArea.get(`${program.id}::${ai}`) ?? 0;
    if (want > 0 && got + 0.5 < want) short.push(`${area.label} ${got}/${want}`);
  });
  rows.push({ id: program.id, name: raw.name, total: program.totalCredits, ...tally, unknown, short, optional });
}

rows.sort((a, b) => b.UNKNOWN - a.UNKNOWN || b.optional.length - a.optional.length || b.unbookable - a.unbookable || b.short.length - a.short.length || b.open - a.open || b.note - a.note || a.id.localeCompare(b.id));

const n = rows.length;
const clean = rows.filter((r) => r.UNKNOWN === 0).length;
const balanced = rows.filter((r) => r.short.length === 0).length;
console.log(`file: ${PROGRAMS}`);
console.log(`digits: ${digitsNote}`);
console.log(`catalog: ${byCode.size} undergraduate courses read`);
console.log(`degrees with a requirement table: ${n}`);
console.log(`blocks: course ${totals.course}, free-elective ${totals.free}, open (catalog names no course) ${totals.open}, note ${totals.note}, unbookable (every course outside the engine's catalog) ${totals.unbookable}, UNKNOWN ${totals.UNKNOWN}` + (totals.campus ? `, Illinois campus gen-ed appended ${totals.campus} (WP2 gate pending)` : ''));
console.log(`degrees with zero UNKNOWN blocks: ${clean}/${n}`);
console.log(`degrees whose every area can book its printed hours: ${balanced}/${n}`);
const optionalRows = rows.filter((r) => r.optional.length);
console.log(`required rows (unindented, with hours) not read as required: ${totals.requiredNotRequired ?? 0} in ${optionalRows.length} degrees` + (optionalRows.length ? ` (${optionalRows.slice(0, 6).map((r) => `${r.id.split('/').pop()}: ${r.optional.slice(0, 4).join(', ')}`).join('; ')})` : ''));
const missingList = [...missingCodes.entries()].sort((a, b) => b[1] - a[1]);
console.log(`course codes named in blocks but not in the undergraduate catalog: ${missingList.length}` + (missingList.length ? ` (${missingList.slice(0, 12).map(([c, k]) => `${c} x${k}`).join(', ')})` : ''));
console.log('');
if (unknownTexts.size) {
  console.log('UNKNOWN blocks by text (most common first):');
  for (const [t, k] of [...unknownTexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(k).padStart(4)}  ${t}`);
  console.log('');
}
const worst = ALL ? rows : rows.slice(0, 20);
console.log(ALL ? 'Every degree:' : '20 worst degrees (most UNKNOWN, then unbookable, short areas, open, notes):');
for (const r of worst) {
  console.log(`  ${r.id}  course ${r.course} free ${r.free} open ${r.open} note ${r.note} unbookable ${r.unbookable} UNKNOWN ${r.UNKNOWN}${r.short.length ? `  short: ${r.short.join('; ')}` : ''}${r.optional.length ? `  required rows read as optional: ${r.optional.join(', ')}` : ''}`);
  for (const u of r.unknown.slice(0, 4)) console.log(`      ? ${u}`);
}

if (SHOW) {
  const blocks = adapted.blocks.get(SHOW) ?? [];
  console.log(`\n${SHOW}: ${blocks.length} blocks`);
  for (const b of blocks) {
    const r = b.rule;
    const choices = r.choices ? ` [${r.choices.length}] ${r.choices.slice(0, 6).map((c) => (c.bundles ? c.bundles.map((s) => s.join('&')).join('|') : c.codes.join('/'))).join(', ')}${r.choices.length > 6 ? ' ...' : ''}` : '';
    const size = r.kind === 'pool' ? ` hours=${r.hours} n=${r.n}` : r.kind === 'choose' ? ` n=${r.n}` : r.kind === 'hours' ? ` hours=${r.hours}` : '';
    console.log(`  ${classify(b).padEnd(7)} ${b.id.slice(SHOW.length)}  ${b.areaLabel} / ${b.label} :: ${r.kind}${size}${choices}${r.text ? ` "${r.text.slice(0, 120)}"` : ''}`);
  }
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ digitsNote, totals, degrees: rows }, null, 1));
