/**
 * The yardstick for every major: each program's auto-built board against the
 * department's own sample sequence (public/illinois/sample-sequences.json,
 * from scripts/illinois/sample-sequences.mjs).
 *
 *   node scripts/dev/sweep/compare-sample.mjs <sweep.jsonl> [--spring <sweep.jsonl>]
 *        [--seq <sample-sequences.json>] [--checkout <dir>] [--goal ""] [--lang 2]
 *        [--json <out.json>] [--md <out.md>]
 *
 * The sweep is a sweep.mjs output (its .blocks.jsonl beside it is read too):
 * one board per degree, goal and language start. By default the no-goal
 * student who owes the language (lang 2) is compared, which is the board
 * closest to what a department's plan assumes. The first sweep should be the
 * Fall start, because the sample sequences all begin in a fall; --spring adds
 * the Spring 2027 start's coverage (its timing is not compared, since every
 * official term is one semester off from a spring start).
 *
 * For each program, three things:
 *
 *  1. Missing: courses the official sequence names that the board lacks. A row
 *     "MATH 221 or MATH 220" is met by either; a row "CHEM 102 & CHEM 103"
 *     needs both. A course the catalog will not credit beside the named one
 *     (public/illinois/exclusions.json: cross-lists, honors twins, MATH 220 for
 *     MATH 221) counts as a substitute, and so does any Composition I course
 *     for another. Optional rows ("optional, highly recommended") are not
 *     counted. Each miss gets a likely cause from the reading (the .blocks
 *     file): the reading requires it but the board lacks it (engine); the
 *     reading lists it as one option of several and the plan chose others
 *     (option); the degree page names it but the reading never asks for it
 *     (reading); or the requirements never name it and only the sequence
 *     suggests it (sequence only).
 *
 *  2. Extras: courses the board holds because the reading asked for them (or
 *     as a prerequisite the engine added) that the official sequence never
 *     names. The planner's free-elective and gen-ed fills, and the language
 *     courses, are not extras: the official plan has slots for those. An extra
 *     from an option list is first set against the official plan's own
 *     elective slots of its kind (a "technical elective" slot can hold any
 *     technical elective), by hours; only what is left is "unexplained".
 *
 *  3. Timing: a course both plans hold more than one year (two semesters)
 *     apart.
 *
 * Match score, per program (0-100): every named course either plan holds is a
 * point to win. A course both plans hold within a year of each other wins it
 * fully, one more than a year apart wins half, a missing one or an unexplained
 * extra wins nothing:  (on time + half of off-time) / (official named rows +
 * unexplained extras).
 *
 * It changes nothing; it reads files and prints.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const CHECKOUT = resolve(opt('--checkout', join(HERE, '..', '..', '..')));
const SEQ = opt('--seq', join(CHECKOUT, 'public', 'illinois', 'sample-sequences.json'));
const GOAL = opt('--goal', '');
const LANG = Number(opt('--lang', '2'));
const FALL = positional[0];
const SPRING = opt('--spring');
if (!FALL) { console.error('usage: compare-sample.mjs <fall sweep.jsonl> [--spring <sweep.jsonl>] [--json out] [--md out]'); process.exit(2); }

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readLines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- data ----------
const seqDoc = readJson(SEQ);
const seqById = new Map(seqDoc.programs.map((p) => [p.id, p]));
const catalog = new Map(readJson(join(CHECKOUT, 'public', 'illinois', 'index.json')).map((c) => [c.code, c]));
const exclusions = readJson(join(CHECKOUT, 'public', 'illinois', 'exclusions.json'));
const excl = new Map();
for (const [a, bs] of Object.entries(exclusions)) for (const b of bs) {
  if (!excl.has(a)) excl.set(a, new Set());
  if (!excl.has(b)) excl.set(b, new Set());
  excl.get(a).add(b); excl.get(b).add(a);
}
// Programs the planner offers without a degree reading ("placeholder"): every
// official course is missing for want of a reading, not because of the engine.
const placeholder = new Set();
try {
  const pj = readJson(join(CHECKOUT, 'public', 'illinois', 'programs.json'));
  for (const p of Array.isArray(pj) ? pj : pj.programs ?? []) if (p.dataStatus === 'placeholder') placeholder.add(p.id);
} catch { /* older checkouts: no status */ }
const rawPrograms = new Map(readJson(join(CHECKOUT, 'public', 'illinois-programs.json')).programs.map((p) => [p.id, p]));
const langCodes = new Set();
for (const l of readJson(join(CHECKOUT, 'public', 'illinois', 'languages.json')).languages ?? []) {
  for (const lv of l.levels ?? []) for (const opt of lv) for (const c of opt) langCodes.add(c);
}
// Language subjects: any subject with a course on the registrar's language list.
const langSubjects = new Set([...langCodes].map((c) => c.split(' ')[0]));

const COMP1 = new Set(['RHET 105', 'RHET 101', 'RHET 102', 'CMN 111', 'CMN 112', 'ESL 111', 'ESL 112', 'ESL 115']);

function boardsOf(file) {
  const m = new Map();
  for (const r of readLines(file)) if (r.goal === GOAL && r.lang === LANG) m.set(r.id, r);
  return m;
}
function blocksOf(file) {
  const bf = file.replace(/\.jsonl$/, '.blocks.jsonl');
  const m = new Map();
  if (!existsSync(bf)) return m;
  for (const b of readLines(bf)) { if (!m.has(b.id)) m.set(b.id, []); m.get(b.id).push(b); }
  return m;
}

const subj = (c) => c.split(' ')[0];
const lvl = (c) => Number(c.split(' ')[1] ?? 0);

// ---------- one program ----------
function compareOne(id, board, blocks, { timing = true } = {}) {
  const entry = seqById.get(id);
  const seq = entry?.sequences?.[0];
  if (!seq) return { id, name: board.name, status: 'no-sequence', why: entry?.none ?? 'not crawled' };

  // Board: course -> first term index (fall/spring only; boards hold no summers).
  const planIdx = new Map();
  board.terms.forEach((t, i) => { for (const c of t.codes) if (!planIdx.has(c)) planIdx.set(c, i); });
  const onBoard = (c) => planIdx.has(c);
  const subFor = (c) => {
    if (onBoard(c)) return c;
    for (const e of excl.get(c) ?? []) if (onBoard(e)) return e;
    if (COMP1.has(c)) for (const e of COMP1) if (onBoard(e)) return e;
    return null;
  };

  // What the reading says about each code.
  const inAll = new Set(); const inList = new Set(); const inGened = new Set();
  const blockOf = new Map();
  for (const b of blocks ?? []) {
    const target = b.kind === 'all' ? inAll : b.kind === 'gened' || b.kind === 'language' ? inGened : inList;
    for (const c of b.codes ?? []) { target.add(c); if (b.kind !== 'gened' && b.kind !== 'language' && !blockOf.has(c)) blockOf.set(c, b); }
    for (const fb of b.rule?.fulfilledBy ?? []) for (const c of fb) inGened.add(c);
  }
  const rawText = JSON.stringify(rawPrograms.get(id) ?? {});
  const notPlaced = new Set((board.notPlaced ?? []).map((n) => n.code));
  const electiveFill = new Set((board.electiveWhy ?? []).map((w) => w.split(':')[0].trim()));
  const addedFor = new Map((board.addedBy ?? []).map(([a, f]) => [a, f]));

  // Official terms: summer rows count as the spring before them for timing.
  const named = []; const slots = []; const officialCodes = new Set(); const suggested = new Set();
  let lastIdx = 0;
  for (const t of seq.terms) {
    const idx = t.index ?? lastIdx;
    lastIdx = idx;
    for (const r of t.rows) {
      if (r.kind === 'course') {
        // "SPAN 300-level course" opens with something code-shaped; a code
        // ending in 00 that no catalog lists is a level, so the row is a slot.
        if (r.options.flat().every((c) => !catalog.has(c) && / \d00$/.test(c))) {
          slots.push({ idx, slot: 'major-elective', hours: r.hours ?? 3, level: Number(r.options[0][0].split(' ')[1]), subjects: [...new Set(r.options.flat().map(subj))] });
          continue;
        }
        for (const o of r.options) for (const c of o) officialCodes.add(c);
        if (r.optional || r.listLike) { for (const o of r.options) for (const c of o) suggested.add(c); continue; }
        // A course named again in a later term (a two-term capstone, a
        // practicum taken every year) is one course for this comparison.
        const key = r.options.map((o) => o.join('&')).sort().join('|');
        if (named.some((n) => n.key === key)) continue;
        named.push({ idx, options: r.options, hours: r.hours ?? null, key });
      } else {
        for (const c of r.suggests ?? []) suggested.add(c);
        slots.push({ idx, slot: r.slot, hours: r.hours ?? 3, level: r.level ?? null, subjects: [...new Set([...(r.subjects ?? []), ...(r.suggests ?? []).map(subj)])] });
      }
    }
  }

  // 1. Missing and timing.
  const missing = []; const offTime = []; let matched = 0; let onTime = 0;
  const shortLists = new Map();
  // Each board course meets one official row: "ECON 102 or ECON 103" in the
  // first fall and "ECON 103 or ECON 102" in the first spring take one each.
  const used = new Set();
  for (const row of named) {
    let hit = null;
    for (const pass of [0, 1]) {
      for (const o of row.options) {
        const subs = o.map(subFor);
        if (subs.every(Boolean) && (pass === 1 || !subs.some((c) => used.has(c)))) { hit = { option: o, subs }; break; }
      }
      if (hit) break;
    }
    if (hit) for (const c of hit.subs) used.add(c);
    if (hit) {
      matched += 1;
      const j = Math.min(...hit.subs.map((c) => planIdx.get(c)));
      const d = j - row.idx;
      if (timing && Math.abs(d) > 2) offTime.push({ code: hit.option.join(' & '), official: row.idx, plan: j, by: d });
      else onTime += 1;
      continue;
    }
    // Why not: the most telling cause among the row's options.
    const codes = row.options.flat();
    const partial = codes.filter((c) => subFor(c));
    let cause;
    if (placeholder.has(id)) cause = 'not-read';
    else if (codes.every((c) => !catalog.has(c))) cause = 'not-in-catalog';
    else if (codes.some((c) => inAll.has(c))) cause = codes.some((c) => notPlaced.has(c)) ? 'engine-not-placed' : 'engine';
    else if (codes.some((c) => inList.has(c))) {
      // One choice from a list, unless the official plan takes more of that
      // list than the reading asks for: then the reading counted it short
      // (Studio Art's "First Year Curriculum" read as choose one of nine).
      cause = 'option';
      for (const b of (blocks ?? []).filter((bb) => bb.kind !== 'all' && bb.kind !== 'gened' && bb.kind !== 'language' && codes.some((c) => (bb.codes ?? []).includes(c)))) {
        const need = b.n ?? (b.hours ? Math.ceil(b.hours / 4) : null);
        const taken = named.filter((nr) => nr.options.some((o) => o.every((c) => (b.codes ?? []).includes(c)))).length;
        if (need != null && taken > need) { cause = 'reading-short'; shortLists.set(b.req, { req: b.req, label: String(b.label ?? '').slice(0, 90), need, official: taken }); break; }
      }
    }
    else if (codes.some((c) => inGened.has(c))) cause = 'gened';
    else if (codes.some((c) => rawText.includes(`"${c}"`) || rawText.includes(c))) cause = 'reading';
    else cause = 'sequence-only';
    missing.push({ code: row.options.map((o) => o.join(' & ')).join(' or '), term: row.idx, cause, ...(partial.length ? { partial } : {}) });
  }

  // 2. Extras: board courses the official plan never names.
  const covered = new Set();
  for (const c of officialCodes) { const s = subFor(c); if (s) covered.add(s); }
  for (const c of suggested) if (onBoard(c)) covered.add(c);
  const extras = [];
  for (const [c, j] of planIdx) {
    if (covered.has(c) || officialCodes.has(c)) continue;
    let kind;
    if (addedFor.has(c) && !inAll.has(c) && !inList.has(c)) kind = 'prereq';
    else if (inAll.has(c)) kind = 'required';
    else if (inList.has(c)) kind = 'option';
    else continue; // elective fill, gen ed or language: the official plan has slots for those
    if (electiveFill.has(c) && kind !== 'required') continue;
    if (langCodes.has(c) && kind !== 'required') continue;
    const from = blockOf.get(c);
    extras.push({ code: c, term: j, kind, credits: catalog.get(c)?.credits ?? 3, ...(kind === 'prereq' ? { for: addedFor.get(c) } : from ? { req: from.req, block: String(from.label ?? '').slice(0, 90), blockSize: from.choices ?? null } : {}) });
  }
  // Set the extras against the official plan's own elective slots, by hours.
  // A slot that names a subject ("300-400 level ECON course", "CMN course")
  // holds any course of that subject at or above its level; a technical or
  // plain major-elective slot holds a course from one of the reading's option
  // lists or a prerequisite, never a course the reading calls required.
  const subjSlots = slots.filter((s) => s.subjects.length && s.slot !== 'gened' && s.slot !== 'language' && s.slot !== 'free-elective').map((s) => ({ ...s, left: s.hours }));
  let technical = 0; let major = 0;
  for (const s of slots) {
    if (s.subjects.length) continue;
    if (s.slot === 'technical-elective') technical += s.hours;
    else if (s.slot === 'major-elective' || s.slot === 'other') major += s.hours;
  }
  const unexplained = [];
  for (const x of extras.sort((a, b) => (a.kind === 'required') - (b.kind === 'required') || a.term - b.term)) {
    const sj = subj(x.code);
    const slot = subjSlots.find((s) => s.subjects.includes(sj) && (s.level == null || lvl(x.code) >= s.level) && s.left >= Math.min(3, x.credits));
    if (slot) { slot.left -= x.credits; x.absorbed = 'subject slot'; continue; }
    if (x.kind !== 'required' && technical >= Math.min(3, x.credits)) { technical -= x.credits; x.absorbed = 'technical slot'; continue; }
    if (major >= Math.min(3, x.credits)) { major -= x.credits; x.absorbed = 'elective slot'; continue; }
    unexplained.push(x);
  }
  // A list the reading requires in full that the official plan never follows:
  // four or more of its courses on our board, none of them named officially.
  const namedCodes = new Set(named.flatMap((r) => r.options.flat()));
  const groups = new Map();
  for (const x of extras) if (x.kind === 'required' && x.req) groups.set(x.req, [...(groups.get(x.req) ?? []), x]);
  const takeAll = [];
  for (const [req, xs] of groups) {
    const b = (blocks ?? []).find((bb) => bb.req === req);
    if (xs.length < 4 || (b?.codes ?? []).some((c) => namedCodes.has(c))) continue;
    takeAll.push({ req, label: xs[0].block, size: xs[0].blockSize, onPlan: xs.length, unexplained: xs.filter((x) => !x.absorbed).length, hours: xs.reduce((a, x) => a + x.credits, 0), codes: xs.map((x) => x.code) });
  }

  const denom = named.length + unexplained.length;
  const score = denom ? Math.round((100 * (onTime + 0.5 * offTime.length)) / denom) : null;
  return {
    id, name: board.name, status: 'compared',
    url: entry.url,
    officialNamed: named.length, matched, onTime, offTime, missing,
    extras, unexplained, takeAll, shortLists: [...shortLists.values()],
    placeholder: placeholder.has(id),
    officialSequences: entry.sequences.length,
    officialHours: entry.totalHours ?? null,
    planCredits: board.planned ?? null,
    degreeTotal: board.degreeTotal ?? null,
    unsatisfied: (board.unsatisfied ?? []).length,
    score,
  };
}

// ---------- misread scan over the reading itself ----------
const SUBJECT_WORDS = new Map();
for (const c of catalog.values()) if (!SUBJECT_WORDS.has(c.cluster ?? subj(c.code))) SUBJECT_WORDS.set(subj(c.code), true);
const WORDS = { economics: 'ECON', mathematics: 'MATH', math: 'MATH', statistics: 'STAT', psychology: 'PSYC', sociology: 'SOC', history: 'HIST', english: 'ENGL', philosophy: 'PHIL', anthropology: 'ANTH', chemistry: 'CHEM', physics: 'PHYS', geography: 'GGIS', linguistics: 'LING', 'political science': 'PS', communication: 'CMN', biology: 'IB', 'computer science': 'CS', astronomy: 'ASTR', geology: 'GEOL', religion: 'REL', spanish: 'SPAN', french: 'FR', german: 'GER', italian: 'ITAL', portuguese: 'PORT', journalism: 'JOUR', advertising: 'ADV', finance: 'FIN', accountancy: 'ACCY', business: 'BADM', music: 'MUS', art: 'ART', theatre: 'THEA', dance: 'DANC', kinesiology: 'KIN', nutrition: 'FSHN', 'gender and women': 'GWS', 'asian american': 'AAS', 'african american': 'AFRO', 'latina/latino': 'LLS', 'east asian': 'EALC', classics: 'CLCV', 'comparative literature': 'CWL', 'atmospheric sciences': 'ATMS', 'integrative biology': 'IB', 'molecular and cellular biology': 'MCB', 'molecular & cellular biology': 'MCB' };
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function scanReading(blocksById) {
  const found = [];
  for (const [id, blocks] of blocksById) {
    // Courses the official plan names: a take-all list it follows is no misread.
    const official = new Set();
    for (const t of seqById.get(id)?.sequences?.[0]?.terms ?? []) for (const r of t.rows) if (r.kind === 'course') for (const o of r.options) for (const c of o) official.add(c);
    const followed = (b) => (b.codes ?? []).filter((c) => official.has(c)).length >= Math.max(1, Math.ceil((b.codes ?? []).length / 2));
    for (const b of blocks) {
      if (b.kind === 'gened' || b.kind === 'language') continue;
      const label = String(b.label ?? ''); const note = String(b.note ?? '');
      const both = `${label} ${note}`;
      // (a) A level rule read for the wrong subject: "11 additional hours of
      // economics at the 300- or 400-level" read as MATH.
      const lv = label.match(/(\d+) hours of 300 or 400-level ([A-Z]{2,4}) courses/);
      if (lv) {
        const phrase = note.match(/(\d+)\s+(?:additional\s+)?(?:credit\s+)?hours\s+(?:of\s+)?([a-z][a-z &/]+?)\s+(?:courses?\s+)?at the 300/i)
          ?? note.match(/(\d+)\s+(?:additional\s+)?(?:credit\s+)?hours\s+(?:of\s+)?(?:300|400)[- a-z]*?level\s+([a-z][a-z &/]+?)\s+courses?/i);
        if (phrase) {
          const word = phrase[2].trim().toLowerCase();
          const sj = WORDS[word] ?? Object.entries(WORDS).find(([w]) => word.startsWith(w))?.[1];
          if (sj && sj !== lv[2]) found.push({ id, req: b.req, type: 'level rule, wrong subject', detail: `reads "${lv[1]} hours of 300/400-level ${lv[2]}"; the page's rule names ${word} (${sj})` });
        }
      }
      // (b) A count in the words that the reading lost: "at least two courses
      // from the following" read with no number at all.
      const cnt = both.match(/\b(?:at least|minimum of|choose|select|complete|take)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:\(\d+\)\s+)?(?:additional\s+)?(?:courses?|classes)\b/i);
      if (cnt && b.n == null && b.hours == null && (b.choices ?? 0) > 1 && b.kind !== 'all') {
        found.push({ id, req: b.req, type: 'count lost', detail: `page says ${cnt[0].toLowerCase()}; the reading has no count or hours for this list of ${b.choices}` });
      }
      // (d) A take-all list whose courses are also a "choose one" list on the
      // same page: area lists (Art History's "1. Africa and the Middle East")
      // feeding a "one course before 1700" rule were each read as take-all.
      if (b.kind === 'all' && (b.choices ?? 0) >= 4 && !followed(b)) {
        const mine = new Set(b.codes ?? []);
        const other = blocks.find((o) => o !== b && (o.kind === 'choose' || o.kind === 'pool') && (o.codes ?? []).filter((c) => mine.has(c)).length >= Math.min(4, mine.size));
        if (other) found.push({ id, req: b.req, type: 'take-all list that is also a choice list', detail: `"${label.slice(0, 60)}" requires all ${b.choices} courses, but the same courses form the choice list "${String(other.label ?? '').slice(0, 60)}"` });
      }
      // (c) An option list read as "take every course": the heading says
      // choose / select / from the following / remaining hours, the block is "all".
      if (b.kind === 'all' && (b.choices ?? 0) >= 4 && !followed(b) && /\b(select|choose|selected from|from the following|from among|one of|two of|three of|remaining (?:courses|hours)|to total|at least \d|at least (?:one|two|three))\b/i.test(label)) {
        const credits = (b.rule?.choices ?? []).reduce((a, ch) => a + (ch.credits ?? 3), 0);
        found.push({ id, req: b.req, type: 'option list read as take-all', detail: `heading is a choice ("${label.slice(0, 70)}${label.length > 70 ? '...' : ''}") but every one of ${b.choices} courses (${credits} hours) is required` });
      }
    }
  }
  return found;
}

// ---------- run ----------
const fallBoards = boardsOf(FALL);
const fallBlocks = blocksOf(FALL);
const results = [];
for (const [id, board] of fallBoards) results.push(compareOne(id, board, fallBlocks.get(id)));
let springCov = null;
if (SPRING) {
  const sb = boardsOf(SPRING); const sbl = blocksOf(SPRING);
  springCov = new Map();
  for (const [id, board] of sb) {
    const r = compareOne(id, board, sbl.get(id), { timing: false });
    if (r.status === 'compared') springCov.set(id, r);
  }
}
const misreads = scanReading(fallBlocks);

// ---------- likely cause ----------
/**
 * Which side most likely made a program's board differ from the official one,
 * by the points each kind of difference costs the score:
 *  - reading: a missing course the degree page names but the reading never
 *    asks for, or a take-all list (four or more extras from one block) the
 *    official plan never follows, or a misread the reading scan found;
 *  - engine: a required course left off, other picks from a list, picks
 *    that drag in prerequisites, a course more than a year off;
 *  - sequence only: the official plan names courses the requirements never
 *    name (department advice, or requirements kept on another page).
 */
function likelyCause(r, scan) {
  const pts = { reading: 0, engine: 0, sequence: 0 };
  const why = { reading: [], engine: [], sequence: [] };
  for (const m of r.missing) {
    if (m.cause === 'not-read') { continue; }
    if (m.cause === 'not-in-catalog') { pts.sequence += 1; why.sequence.push(`${m.code} is not in our course list (new, renamed or retired)`); continue; }
    if (m.cause === 'reading-short') { pts.reading += 1; continue; }
    if (m.cause === 'reading') { pts.reading += 1; why.reading.push(`${m.code} on the page but not read as required`); }
    else if (m.cause === 'sequence-only') { pts.sequence += 1; }
    else if (m.cause === 'gened') { pts.engine += 1; why.engine.push(`${m.code} (named for a gen ed) not chosen`); }
    else if (m.cause === 'option') { pts.engine += 1; why.engine.push(`${m.code}: picked another option`); }
    else { pts.engine += 1; why.engine.push(`${m.code} required but left off${m.cause === 'engine-not-placed' ? ' (no room)' : ''}`); }
  }
  const flagged = new Set(r.takeAll.map((t) => t.req));
  // With a list counted short, the plan fills those hours from other lists:
  // those extra picks follow from the misread, not from the engine.
  const short = r.shortLists.length > 0;
  for (const x of r.unexplained) {
    if ((x.kind === 'required' && flagged.has(x.req)) || (short && x.kind === 'option')) pts.reading += 1;
    else pts.engine += 1;
  }
  for (const t of r.shortLists) why.reading.push(`"${t.label || t.req}" read as ${t.need} course${t.need > 1 ? 's' : ''} from a list; the official plan takes ${t.official} of them`);
  for (const t of r.takeAll) why.reading.push(`"${t.label || t.req}" read as take all ${t.size ?? t.onPlan} courses (${t.onPlan} on our plan, none in the official plan)`);
  if (r.placeholder) { pts.reading += r.missing.length; why.reading.unshift('no degree reading at all (placeholder program)'); }
  const pre = r.unexplained.filter((x) => x.kind === 'prereq').length;
  if (pre) why.engine.push(`${pre} prerequisite${pre > 1 ? 's' : ''} added for list picks`);
  const req = r.unexplained.filter((x) => x.kind === 'required' && !flagged.has(x.req)).length;
  if (req) why.engine.push(`${req} required-by-reading course${req > 1 ? 's' : ''} the official plan never names`);
  const opt = r.unexplained.filter((x) => x.kind === 'option').length;
  if (opt) (short ? why.reading : why.engine).push(`${opt} extra list pick${opt > 1 ? 's' : ''} beyond the official elective slots`);
  pts.engine += 0.5 * r.offTime.length;
  if (r.offTime.length) why.engine.push(`${r.offTime.length} course${r.offTime.length > 1 ? 's' : ''} more than a year off (${r.offTime.slice(0, 3).map((o) => `${o.code} ${o.by > 0 ? '+' : ''}${o.by} terms`).join(', ')})`);
  for (const f of scan) { pts.reading += 2; why.reading.unshift(`${f.type}: ${f.detail}`); }
  if (r.missing.some((m) => m.cause === 'sequence-only')) why.sequence.push(`${r.missing.filter((m) => m.cause === 'sequence-only').map((m) => m.code).slice(0, 6).join(', ')} named only in the sample sequence`);
  const top = Object.entries(pts).sort((a, b) => b[1] - a[1])[0];
  const label = top[1] === 0 ? 'none' : top[0] === 'reading' ? 'misread page' : top[0] === 'engine' ? 'engine' : 'sequence only';
  return { label, points: pts, why: why[top[0]].slice(0, 4), other: Object.entries(why).filter(([k]) => k !== top[0]).flatMap(([, v]) => v).slice(0, 3) };
}
/**
 * The score this program would have if its misread lists were read right, as
 * an estimate: courses missing because a list was counted short count as
 * placed on time, and extras from a take-all list the official plan never
 * follows (or list picks made to fill a short-counted list's hours) go away.
 * Nothing else changes, so it says how much of the gap is the reading.
 */
function readingFixedScore(r) {
  const flagged = new Set(r.takeAll.map((t) => t.req));
  const short = r.shortLists.length > 0;
  const gained = r.missing.filter((m) => m.cause === 'reading-short').length;
  const left = r.unexplained.filter((x) => !((x.kind === 'required' && flagged.has(x.req)) || (short && x.kind === 'option'))).length;
  const denom = r.officialNamed + left;
  return denom ? Math.round((100 * (r.onTime + gained + 0.5 * r.offTime.length)) / denom) : null;
}
const scanById = new Map();
for (const f of misreads) scanById.set(f.id, [...(scanById.get(f.id) ?? []), f]);
for (const r of results) if (r.status === 'compared') { r.cause = likelyCause(r, scanById.get(r.id) ?? []); r.scoreIfReadRight = readingFixedScore(r); }

// ---------- summary ----------
const cmp = results.filter((r) => r.status === 'compared' && r.officialNamed > 0);
const none = results.filter((r) => r.status === 'no-sequence');
const emptySeq = results.filter((r) => r.status === 'compared' && r.officialNamed === 0);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const totNamed = sum(cmp, (r) => r.officialNamed);
const totMatched = sum(cmp, (r) => r.matched);
const totOnTime = sum(cmp, (r) => r.onTime);
const causeCount = {};
for (const r of cmp) for (const m of r.missing) causeCount[m.cause] = (causeCount[m.cause] ?? 0) + 1;
const scores = cmp.map((r) => r.score).sort((a, b) => a - b);
const median = scores.length ? scores[Math.floor(scores.length / 2)] : null;
const summary = {
  programs: results.length,
  compared: cmp.length,
  noSequence: none.length,
  sequenceWithoutNamedCourses: emptySeq.length,
  officialNamedRows: totNamed,
  matchedRows: totMatched,
  pctContained: totNamed ? +(100 * totMatched / totNamed).toFixed(1) : null,
  pctOnTime: totNamed ? +(100 * totOnTime / totNamed).toFixed(1) : null,
  offTimeRows: sum(cmp, (r) => r.offTime.length),
  missingByCause: causeCount,
  extras: sum(cmp, (r) => r.extras.length),
  unexplainedExtras: sum(cmp, (r) => r.unexplained.length),
  programsWithUnexplainedExtras: cmp.filter((r) => r.unexplained.length).length,
  meanScore: cmp.length ? +(sum(cmp, (r) => r.score) / cmp.length).toFixed(1) : null,
  medianScore: median,
  perfect: cmp.filter((r) => r.score === 100).length,
  under50: cmp.filter((r) => r.score < 50).length,
  misreadsFound: misreads.length,
  takeAllLists: sum(cmp, (r) => r.takeAll.length),
  shortLists: sum(cmp, (r) => r.shortLists.length),
  ifReadRight: (() => {
    const xs = cmp.map((r) => r.scoreIfReadRight).sort((a, b) => a - b);
    return { meanScore: +(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1), medianScore: xs[Math.floor(xs.length / 2)] ?? null, under50: xs.filter((x) => x < 50).length, perfect: xs.filter((x) => x === 100).length };
  })(),
  overTotal: cmp.filter((r) => r.planCredits != null && r.degreeTotal != null && r.planCredits > r.degreeTotal + 6).length,
};
{
  const real = cmp.filter((r) => !r.placeholder);
  summary.withoutPlaceholders = {
    compared: real.length,
    pctContained: +(100 * sum(real, (r) => r.matched) / Math.max(1, sum(real, (r) => r.officialNamed))).toFixed(1),
    meanScore: +(sum(real, (r) => r.score) / Math.max(1, real.length)).toFixed(1),
  };
  const byCollege = {};
  for (const r of cmp) {
    const c = r.id.split('/')[0];
    const b = (byCollege[c] ??= { programs: 0, named: 0, matched: 0, score: 0, under50: 0 });
    b.programs += 1; b.named += r.officialNamed; b.matched += r.matched; b.score += r.score; if (r.score < 50) b.under50 += 1;
  }
  summary.byCollege = Object.fromEntries(Object.entries(byCollege).map(([c, b]) => [c, { programs: b.programs, pctContained: +(100 * b.matched / Math.max(1, b.named)).toFixed(1), meanScore: +(b.score / b.programs).toFixed(1), under50: b.under50 }]));
}
if (springCov) {
  const sc = [...springCov.values()].filter((r) => r.officialNamed > 0);
  summary.spring = {
    compared: sc.length,
    pctContained: +(100 * sum(sc, (r) => r.matched) / Math.max(1, sum(sc, (r) => r.officialNamed))).toFixed(1),
    unexplainedExtras: sum(sc, (r) => r.unexplained.length),
  };
}

const out = { generatedAt: new Date().toISOString(), board: FALL, spring: SPRING, goal: GOAL, lang: LANG, summary, results, misreads };
if (springCov) for (const r of results) { const s = springCov.get(r.id); if (s) r.spring = { matched: s.matched, missing: s.missing.map((m) => m.code), unexplained: s.unexplained.map((x) => x.code) }; }
const JSON_OUT = opt('--json');
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1) + '\n');

console.log(JSON.stringify(summary, null, 1));
const worst = [...cmp].sort((a, b) => a.score - b.score).slice(0, 25);
for (const r of worst) console.log(`${String(r.score).padStart(3)}  ${r.id}  named ${r.matched}/${r.officialNamed}  off ${r.offTime.length}  extra ${r.unexplained.length}  miss[${r.missing.map((m) => `${m.code}:${m.cause}`).join(', ')}]`);

// ---------- scoreboard (markdown) ----------
const MD_OUT = opt('--md');
if (MD_OUT) {
  const L = [];
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
  const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  L.push('# Sample-sequence scoreboard: our plans vs the official four-year plans');
  L.push('');
  L.push(`Generated ${out.generatedAt.slice(0, 16).replace('T', ' ')} UTC by \`scripts/dev/sweep/compare-sample.mjs\`. Boards: \`${FALL.split('/').slice(-2).join('/')}\`${SPRING ? ` and \`${SPRING.split('/').slice(-2).join('/')}\`` : ''}; student: no career goal, owes the language (lang ${LANG}), no credit. Official plans: \`public/illinois/sample-sequences.json\` (the catalog's Sample Sequence tab of each program).`);
  L.push('');
  L.push('## Overall');
  L.push('');
  L.push(`- **${summary.compared} of ${summary.programs} programs** have an official sample sequence with named courses and were compared. ${summary.noSequence} have none${summary.sequenceWithoutNamedCourses ? ` and ${summary.sequenceWithoutNamedCourses} have one that names no courses` : ''} (listed at the end).`);
  L.push(`- **Our plans contain ${summary.pctContained}% of the courses the official plans name** (${summary.matchedRows} of ${summary.officialNamedRows}), Fall 2026 start.${summary.spring ? ` Spring 2027 start: ${summary.spring.pctContained}%.` : ''}`);
  L.push(`- **${summary.pctOnTime}% are also within a year** of the official term. ${summary.offTimeRows} course placements are more than a year earlier or later.`);
  L.push(`- **Extra courses:** ${summary.unexplainedExtras} courses across ${summary.programsWithUnexplainedExtras} programs are on our plan because our reading asked for them (or as a prerequisite the plan added) and fit no slot of the official plan. Free electives, gen eds and language courses are never counted as extras.`);
  L.push(`- **Match score** (0 to 100): mean ${summary.meanScore}, median ${summary.medianScore}. ${summary.perfect} programs score 100; ${summary.under50} score under 50.`);
  const mc = summary.missingByCause;
  L.push(`- **Why official courses are missing** (${Object.values(mc).reduce((a, b) => a + b, 0)} rows): ${[
    ['option', 'our reading has it as one choice in a list and the plan picked another'],
    ['sequence-only', 'the requirements never name it; only the sample plan does'],
    ['engine-not-placed', 'our reading requires it but the plan had no room'],
    ['engine', 'our reading requires it but the plan left it off'],
    ['reading', 'the degree page names it but our reading does not ask for it'],
    ['reading-short', 'our reading asks for fewer courses from a list than the official plan takes'],
    ['not-read', 'the program has no degree reading at all (placeholder)'],
    ['not-in-catalog', 'the course is not in our course list (new, renamed or retired)'],
    ['gened', 'named for a gen ed; the plan chose another course for that gen ed'],
  ].filter(([k]) => mc[k]).map(([k, t]) => `${mc[k]} ${t}`).join('; ')}.`);
  L.push('');
  L.push(`- **Without the ${summary.compared - summary.withoutPlaceholders.compared} programs we have no degree reading for** (placeholders): ${summary.withoutPlaceholders.pctContained}% of official courses contained, mean score ${summary.withoutPlaceholders.meanScore}.`);
  L.push(`- **Misread lists found:** ${summary.takeAllLists} lists our reading requires in full that the official plan never follows, ${summary.shortLists} lists our reading counts short, and ${summary.misreadsFound} more from the page-wording scan (details below). ${summary.overTotal} programs plan more than 6 credits past the degree total.`);
  L.push(`- **If the misread lists were read right** (an estimate: the courses a short-counted list loses count as placed, and the extras from take-all lists go away; nothing else changes): mean ${summary.ifReadRight.meanScore}, median ${summary.ifReadRight.medianScore}, ${summary.ifReadRight.perfect} at 100, ${summary.ifReadRight.under50} under 50.`);
  L.push('');
  L.push('| College | Programs | Official courses in our plans | Mean score | Programs under 50 |');
  L.push('|---|---|---|---|---|');
  for (const [c, b] of Object.entries(summary.byCollege).sort((a, b2) => a[1].meanScore - b2[1].meanScore)) L.push(`| ${c} | ${b.programs} | ${b.pctContained}% | ${b.meanScore} | ${b.under50} |`);
  L.push('');
  L.push('**How the score works.** Every named course either plan holds is one point. A course both plans hold within a year of each other earns the full point; more than a year apart, half a point; a missing official course or an unexplained extra, nothing. Score = points earned / points possible. A row like "MATH 221 or MATH 220" is met by either, and a course the catalog will not credit beside the named one (cross-lists, honors versions, MATH 220 for MATH 221) counts as the same course.');
  L.push('');
  L.push('## The two known misreads');
  L.push('');
  const KNOWN = [
    ['las/economics-balas', 'Economics BALAS: "11 additional hours of economics at the 300- or 400-level" read as MATH'],
    ['las/integrative-biology-bslas', 'Integrative Biology BSLAS: "at least two courses from the following areas" lost'],
  ];
  for (const [id, title] of KNOWN) {
    const r = results.find((x) => x.id === id);
    const fs = misreads.filter((f) => f.id === id);
    L.push(`**${title}.** ${fs.length ? `Still there on this build: ${fs.map((f) => `${f.type} (${cell(f.detail)})`).join('; ')}.` : 'Not found by the scan on this build.'}`);
    if (r?.status === 'compared') {
      const lvlX = r.extras.filter((x) => /::level$/.test(x.req ?? '') || (x.kind === 'prereq' && /^MATH/.test(x.code) && id.includes('economics')));
      const parts = [`score ${r.score}`, `${r.matched}/${r.officialNamed} official courses on our plan`, `our plan ${r.planCredits} credits for a ${r.degreeTotal}-credit degree (official sequence ${r.officialHours ?? '?'} hours)`];
      if (lvlX.length) parts.push(`courses on our plan from the misread rule: ${lvlX.map((x) => x.code).join(', ')}${lvlX.every((x) => x.absorbed) ? ' (all fit the official plan\'s "supporting coursework" slots, which is why the score stays high even though the rule is wrong)' : ''}`);
      if (r.takeAll.length) parts.push(`lists read as take-all: ${r.takeAll.map((t) => `"${cell(t.label)}" (${t.onPlan} courses, ${t.hours} hours)`).join('; ')}`);
      if (r.unexplained.length) parts.push(`${r.unexplained.length} courses the official plan never has: ${r.unexplained.map((x) => x.code).join(', ')}`);
      L.push(`On the comparison: ${parts.join('; ')}.`);
    }
    L.push('');
  }
  const worst = cmp.filter((r) => !r.placeholder).sort((a, b) => a.score - b.score || b.unexplained.length - a.unexplained.length).slice(0, 25);
  L.push('## The 25 programs whose plans differ most from the official plan');
  L.push('');
  const ph = cmp.filter((r) => r.placeholder);
  if (ph.length) L.push(`Not ranked: ${ph.length} programs the planner offers with no degree reading at all (placeholders), which miss nearly every official course for that reason: ${ph.map((r) => `\`${r.id}\` (score ${r.score}, ${r.matched}/${r.officialNamed})`).join(', ')}.`);
  L.push('');
  L.push('| # | Program | Score | If read right | Official courses in our plan | >1 yr off | Extras | Likely cause | What differs |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  worst.forEach((r, i) => {
    L.push(`| ${i + 1} | [${cell(r.name)}](${r.url}) \`${r.id}\` | ${r.score} | ${r.scoreIfReadRight} | ${r.matched}/${r.officialNamed} | ${r.offTime.length} | ${r.unexplained.length} | **${r.cause.label}** | ${cell([...r.cause.why, ...r.cause.other.slice(0, r.cause.why.length ? 1 : 3)].join('; ').slice(0, 400))} |`);
  });
  L.push('');
  const tally = {};
  for (const r of worst) tally[r.cause.label] = (tally[r.cause.label] ?? 0) + 1;
  L.push(`Of these 25: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  L.push('');
  L.push('## Misreads of degree pages found across all programs');
  L.push('');
  L.push('Found by scanning every requirement our reading produced (the `.blocks.jsonl` beside the sweep) for four patterns, and by the comparison itself (a list our reading requires in full that the official plan never follows).');
  L.push('');
  const types = [...new Set(misreads.map((f) => f.type))];
  for (const t of types) {
    const fs = misreads.filter((f) => f.type === t);
    L.push(`### ${t} (${fs.length} in ${new Set(fs.map((f) => f.id)).size} programs)`);
    L.push('');
    for (const f of fs) L.push(`- \`${f.id}\` (${f.req.split('::').slice(1).join('::')}): ${cell(f.detail)}`);
    L.push('');
  }
  const blockMis = [];
  for (const r of cmp) for (const t of r.takeAll) if (!misreads.some((f) => f.req === t.req)) blockMis.push({ id: r.id, req: t.req, label: t.label, n: t.onPlan, size: t.size, hours: t.hours, codes: t.codes });
  L.push(`### Required in full by our reading, never followed by the official plan (${blockMis.length} lists in ${new Set(blockMis.map((b) => b.id)).size} programs, not already listed above)`);
  L.push('');
  for (const b of blockMis.sort((a, c) => c.n - a.n)) L.push(`- \`${b.id}\`: "${cell(b.label)}" (${b.size ?? '?'} courses, all required by our reading): ${b.n} of them (${b.hours} hours) on our plan, none in the official plan (${b.codes.slice(0, 6).join(', ')}${b.codes.length > 6 ? ', ...' : ''})`);
  L.push('');
  const shorts = cmp.flatMap((r) => r.shortLists.map((t) => ({ id: r.id, ...t })));
  L.push(`### List counted short: the official plan takes more of a list than our reading asks for (${shorts.length} lists in ${new Set(shorts.map((t) => t.id)).size} programs)`);
  L.push('');
  for (const t of shorts) L.push(`- \`${t.id}\`: "${cell(t.label)}" read as ${t.need} course${t.need > 1 ? 's' : ''}; the official plan names ${t.official} courses from it`);
  L.push('');
  L.push('## Every program');
  L.push('');
  L.push('| Program | Score | Official in ours | On time | >1 yr off | Missing (cause) | Extras | Our credits / degree | Likely cause |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of [...cmp].sort((a, b) => a.id.localeCompare(b.id))) {
    L.push(`| \`${r.id}\` | ${r.score} | ${r.matched}/${r.officialNamed} | ${r.onTime} | ${r.offTime.map((o) => `${o.code} ${o.by > 0 ? '+' : ''}${o.by}`).join(', ')} | ${r.missing.map((m) => `${m.code} (${m.cause})`).join(', ')} | ${r.unexplained.map((x) => x.code).join(', ')} | ${r.planCredits ?? '?'} / ${r.degreeTotal ?? '?'} | ${r.cause.label} |`);
  }
  L.push('');
  L.push('## Programs with no official sample sequence to compare');
  L.push('');
  for (const r of [...none, ...emptySeq]) L.push(`- \`${r.id}\`: ${r.status === 'no-sequence' ? r.why : 'the sequence names no courses (slots only)'}`);
  L.push('');
  writeFileSync(MD_OUT, L.join('\n'));
  console.log(`scoreboard -> ${MD_OUT}`);
}
