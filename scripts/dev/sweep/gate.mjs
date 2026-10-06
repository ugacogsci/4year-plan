/**
 * The three-level verdict: may a change to the engine or the reading stand,
 * board by board?
 *
 *   node gate.mjs <before.jsonl> <after.jsonl> [--reading <blocks.jsonl>]
 *                 [--checkout <dir>] [--list] [--json <out.json>]
 *
 * Both files come from sweep.mjs (or the research's sweep6, which records the
 * same fields). The reading defaults to <after>.blocks.jsonl, which sweep.mjs
 * writes: every board, before and after, is judged on the NEW reading of the
 * pages, so a board that meets more of a page read correctly is not scored
 * as worse because the old reading asked for something else. The checkout
 * (default: the one this file is in) gives course credits, prerequisites and
 * lab pairs.
 *
 * The owner's rule (2026-10-06), ported from the research's gatepolicy.py and
 * rule.py (fix-research/misreads/tools/):
 *
 *   Real requirements: the requirement blocks (take-all, choose, pool) the
 *   board leaves unmet on the new reading; a pool counts both halves of a
 *   pair (STAT 400 & STAT 410).
 *
 *   A, never worse on any board: validator errors, prerequisite order, a lab
 *     apart from its lecture, a finish after the student's own target term
 *     (finishing later but still by the target is not a loss: 7 Psychology
 *     boards that now finish Spring 2030 instead of Fall 2029).
 *   B, deadlines and hours: career-track rows later or off the board, more
 *     than one credit further past the degree total, residency (300/400
 *     hours under 21 and lower than before), a term over 18, a new term with
 *     three hardest-band courses.
 *   C, shape: terms at 18, two hardest in a term, one subject crowding, year
 *     one heavy or light, a sequence a term apart, seminar and first-math
 *     timing, momentum flags, prerequisite notes, warnings.
 *
 *   fewer real requirements  -> blocked
 *   an A loss                -> blocked
 *   more real requirements   -> C losses allowed; a B loss only when the
 *                               arithmetic forces it: credits past the total
 *                               grew by no more than the required credits
 *                               newly placed, and a track row went off or
 *                               later only when the board has no room under
 *                               18 for it and the plan names it as needing a
 *                               summer or an extra term (degreeFirst), and never
 *                               residency, a term over 18 or a three-hardest
 *                               term; otherwise 'engine work'
 *   same real requirements   -> no B loss (else engine work); a C loss only
 *                               when the sweep-wide total of that measure is
 *                               not worse (else engine work)
 *
 * Track rows are measured on both boards with the release's own row list
 * (the before sweep's trackRows), so a change to career-tracks.ts cannot move
 * the yardstick: the research's track-aces patch showed 32 unchanged boards
 * "worse" for that reason alone. The one row whose list names fewer ways
 * than its own description, Composition I (RHET 105, "the CMN 111-112
 * sequence is another"), is read with the sequence (ROW_SEQUENCES). A requirement split into option lists
 * (::3::0 -> ::3::0::opt1) is the same requirement.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
export const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
export const keyOf = (r) => `${r.id}|${r.goal}|${r.lang}`;
/** A requirement split into option lists is the same requirement: ::3::0::opt1 is ::3::0. */
export const reqKey = (id) => String(id ?? '').replace(/::opt\d+$/, '');

// ---- what the measures need from a checkout --------------------------------

/**
 * First-term seminars and orientations, the courses the research's rule held
 * to year one (rule.py FIRST: its statics.json list and the five seminars).
 */
const FIRST_TERM = ['ACES 200', 'AHS 125', 'BUS 115', 'EDUC 102', 'ENG 177', 'ENG 300', 'LA 199', 'LAS 101', 'LAS 112', 'MUS 100', 'SHS 191', 'BUS 101', 'ENG 100', 'FAA 101', 'HK 125'];
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Credits, prerequisites and lab pairs from a checkout. The lab pairs are
 * autoplan's measuredLabs: the career tracks' pairs (labpairs.json and the
 * four compare.mjs adds) and every one- or two-credit course numbered one
 * past a course of its subject that its prerequisites let it take in the
 * same term (CHEM 103 and CHEM 102, TAM 252 and TAM 251).
 */
export function loadStatics(checkout) {
  const pub = (n) => JSON.parse(readFileSync(join(checkout, 'public', n), 'utf8'));
  const index = pub('illinois/index.json');
  const byCode = new Map(index.map((c) => [norm(c.code), c]));
  const credits = new Map(index.map((c) => [norm(c.code), c.credits]));
  const pre = new Map(Object.entries(pub('illinois/prereqs.json')).map(([k, v]) => [norm(k), v]));
  const labs = new Map(Object.entries({ ...JSON.parse(readFileSync(join(HERE, 'labpairs.json'), 'utf8')), 'MCB 151': 'MCB 150', 'IB 151': 'IB 150', 'CHEM 103': 'CHEM 102', 'CHEM 105': 'CHEM 104', 'CHEM 233': 'CHEM 232', 'MCB 245': 'MCB 244', 'MCB 247': 'MCB 246', 'MCB 251': 'MCB 250' }));
  for (const [code, spec] of pre) {
    if (!spec.parsed || labs.has(code)) continue;
    const lecture = (spec.groups ?? [])
      .filter((g) => g.concurrent && !g.priorLearning && g.any.length === 1)
      .map((g) => norm(g.any[0]))
      .find((c) => c.split(' ')[0] === code.split(' ')[0] && Number(code.split(' ')[1]) === Number(c.split(' ')[1]) + 1);
    const course = byCode.get(code);
    if (!lecture || !course || (course.creditsMax ?? course.credits) > 2 || !byCode.has(lecture)) continue;
    labs.set(code, lecture);
  }
  return { credits, pre, labs, first: new Set(FIRST_TERM) };
}

// ---- terms -----------------------------------------------------------------

const SEASON = { Spring: 0, Summer: 1, Fall: 2 };
const ordinal = (label) => {
  const m = /^(Spring|Summer|Fall) (\d{4})$/.exec(label ?? '');
  return m ? Number(m[2]) * 3 + SEASON[m[1]] : null;
};
/** The student's target finish: the row's own, or a Fall start's fourth spring and a Spring start's third fall. */
export function targetOf(r) {
  if (r.target) return r.target;
  const m = /^(Fall|Spring) (\d{4})$/.exec(r.start ?? r.terms?.[0]?.label ?? '');
  if (!m) return null;
  return m[1] === 'Fall' ? `Spring ${Number(m[2]) + 4}` : `Fall ${Number(m[2]) + 3}`;
}
export const startOf = (r) => r.start ?? r.terms?.[0]?.label ?? null;
/** Finishes after the student's own target term. */
export function pastTarget(r) {
  const f = ordinal(r.finish);
  const t = ordinal(targetOf(r));
  return f !== null && t !== null && f > t;
}

/**
 * Track rows late or off the board, measured with a given row list (the
 * release's): what sweep.mjs computes from the checkout's own rows, from
 * `rows` instead. Each key is "track:CODE/CODE".
 */
/**
 * Sequences that meet a release row as its one course does. The pre-health
 * Composition I row lists RHET 105 alone, and its own description in
 * career-tracks.ts says "RHET 105 is one way to meet Composition I (the CMN
 * 111-112 sequence is another)". The catalog will not credit RHET 105 beside
 * CMN 111 + CMN 112, so a board that books the sequence for its degree's
 * Communication Option (the ACES degrees, Animal Sciences) can never add
 * RHET 105: read by RHET 105 alone, the row was "off the board" on every
 * such pre-med and pre-PT board, and no engine could have met it. The
 * sequence meets the row in the term of CMN 112, its second half, and only
 * with CMN 111 on the board or held.
 */
const ROW_SEQUENCES = { 'RHET 105': [['CMN 111', 'CMN 112']] };

export function retrack(r, rows, due) {
  const held = new Set((r.held ?? []).map(norm));
  const termOf = (code) => r.terms.findIndex((t) => t.codes.includes(norm(code)));
  const dueIndex = r.terms.findIndex((t) => t.label === due);
  const trackLate = [];
  const trackMissing = [];
  for (const key of rows) {
    const codes = key.slice(key.indexOf(':') + 1).split('/');
    if (codes.some((c) => held.has(norm(c)))) continue;
    const sequences = codes.length === 1 ? ROW_SEQUENCES[norm(codes[0])] ?? [] : [];
    if (sequences.some((seq) => seq.every((c) => held.has(c)))) continue;
    const placed = codes.map(termOf).filter((i) => i >= 0);
    for (const seq of sequences) {
      const at = seq.map((c) => (held.has(c) ? -2 : termOf(c)));
      if (at.every((i) => i !== -1)) placed.push(Math.max(...at));
    }
    if (placed.length === 0) trackMissing.push(key);
    else if (Math.min(...placed) > dueIndex) trackLate.push({ row: key, label: r.terms[Math.min(...placed)].label });
  }
  return { trackLate, trackMissing };
}
/** Both boards' track rows by the before board's list, when the before sweep recorded it. */
export function onReleaseRows(x, y) {
  if (!x.trackRows) return { x, y };
  const due = x.trackDue ?? `Spring ${Number(String(startOf(x)).split(' ')[1]) + 3}`;
  return { x: { ...x, ...retrack(x, x.trackRows, due) }, y: { ...y, ...retrack(y, x.trackRows, due) } };
}

// ---- the measures (rule.py) --------------------------------------------------

const level = (c) => Number(/\d+/.exec(c.includes(' ') ? c.split(' ')[1] : '')?.[0] ?? 0);
const isSummer = (t) => t.label.split(' ')[0] === 'Summer';
const atOf = (r) => {
  const w = new Map();
  r.terms.forEach((t, i) => t.codes.forEach((c) => w.set(c, i)));
  return w;
};
/**
 * The last term of year one, counted from the plan's own first term: its
 * second fall or spring (a summer between them is year one too). Never the
 * school's academic year: a Spring 2027 starter's year one is Spring 2027
 * and Fall 2027, so Fall 2027 is not "year two" for her.
 */
export function yearOneEnd(r) {
  let regular = 0;
  for (let i = 0; i < r.terms.length; i++) {
    if (isSummer(r.terms[i])) continue;
    regular += 1;
    if (regular === 2) return i;
  }
  return r.terms.length - 1;
}
/**
 * Composition I begun in year one (the board's first Composition I course,
 * sweep.mjs comp1, in a term up to yearOneEnd). The validator's
 * "Composition I after the first year" warning (ap-comp1-late) names every
 * Composition I course from the third fall or spring on, so it also names
 * the second half of a two-term sequence begun in year one: CMN 112 after
 * CMN 111 for a Spring 2027 starter, whose CMN 111 can only be in Fall 2027.
 * That is not a year-one loss, and the gate does not count it as one.
 */
export const comp1InYearOne = (r) => r.comp1 != null && r.comp1.term <= yearOneEnd(r);
const minus = (a, b) => [...a].filter((v) => !b.has(v));

export function makeMeasures(S) {
  const apart = (r) => {
    const w = atOf(r);
    return new Set([...S.labs].filter(([lab, lec]) => w.has(lab) && w.has(lec) && w.get(lab) !== w.get(lec)).map(([lab]) => lab));
  };
  const splits = (r) => {
    const w = atOf(r);
    const ordn = [];
    let n = 0;
    for (const t of r.terms) {
      if (!isSummer(t)) n += 1;
      ordn.push(n);
    }
    const out = new Set();
    for (const [code, i] of w) {
      for (const g of S.pre.get(code)?.groups ?? []) {
        if (g.priorLearning) continue;
        for (const c of new Set(g.any.map(norm))) {
          if (c === code || !w.has(c)) continue;
          const gap = level(code) - level(c);
          if (c.split(' ')[0] === code.split(' ')[0] && gap > 0 && gap <= 20 && w.get(c) < i && ordn[i] - ordn[w.get(c)] >= 2) out.add(`${c}>${code}`);
        }
      }
    }
    return out;
  };
  const orphan = (r, n) => {
    if (n.requirementId || !('addedBy' in r)) return false;
    const on = atOf(r);
    const by = r.addedBy.filter(([a]) => a === n.code).map(([, b]) => b);
    return by.length > 0 && by.every((b) => !on.has(b));
  };
  const requiredOff = (r) => new Set(r.notPlaced.filter((a) => a.requirementId && (a.kind || 'all') === 'all' && !orphan(r, a)).map((a) => a.code));
  const offCount = (r) => r.notPlaced.filter((a) => !orphan(r, a)).length;
  const errkey = (id) => id.replace(/-(fa|sp|su)\d{4}-|-(fall|spring|summer)-\d{4}-/g, '-');
  const rowLate = (r) => {
    const L = r.terms.map((t) => t.label);
    const s = new Map();
    for (const z of r.trackLate) s.set(z.row, L.indexOf(z.label));
    for (const m of r.trackMissing) s.set(m, 99);
    return s;
  };
  const semLate = (r) => {
    const end = yearOneEnd(r);
    return new Set([...atOf(r)].filter(([c, i]) => S.first.has(c) && i > end).map(([c]) => c));
  };
  const semInY1 = (r) => {
    const end = yearOneEnd(r);
    return new Set([...atOf(r)].filter(([c, i]) => S.first.has(c) && i <= end).map(([c]) => c));
  };
  const mathInY1 = (r) => r.firstMath != null && r.firstMath.term <= yearOneEnd(r);
  const upper = (r) => r.residency?.upper ?? null;
  const WATCH = /^ap-(priorlearning|offering|duplicate|comp1-late|language-gap|dormant|closed|college|admission|snapshot|standing|rare|exclusion|parts|missing)-/;
  const watched = (r) => {
    // A Composition I warning on a board whose Composition I began in year one
    // (counted from the plan's first term) is a sequence's second half, not a
    // late Composition I (comp1InYearOne).
    const ks = (r.warnKeys ?? []).filter((k) => WATCH.test(k) && !(k.startsWith('ap-comp1-late-') && comp1InYearOne(r)));
    const gaps = ks.filter((k) => k.startsWith('ap-language-gap-')).length;
    return new Set([...ks.filter((k) => !k.startsWith('ap-language-gap-')), ...Array.from({ length: gaps }, (_, n) => `ap-language-gap-${n + 1}`)]);
  };
  const stackOf = (codes) => {
    const c = new Map();
    for (const k of codes) c.set(k.split(' ')[0], (c.get(k.split(' ')[0]) ?? 0) + 1);
    return c.size ? Math.max(...c.values()) : 0;
  };
  const extra = (r) => {
    const warn = r.warnKeys ?? [];
    const reg = r.terms.filter((t) => !isSummer(t));
    const stacks = reg.filter((t) => t.codes.length).slice(-2).map((t) => stackOf(t.codes));
    return {
      prereqCheck: new Set(warn.filter((k) => k.startsWith('ap-prereq-check-'))),
      thin: warn.filter((k) => k.startsWith('ap-minimum-')).length,
      atCap: reg.filter((t) => t.cr >= 18).length,
      stack2: r.terms.filter((t) => t.hard.length >= 2).length,
      crowded: stacks.filter((n) => n >= 4).length,
      crowdMax: Math.max(0, ...stacks),
    };
  };
  const firstTermLoad = (r) => {
    const end = yearOneEnd(r);
    return r.terms.filter((t, i) => i <= end && !isSummer(t)).map((t) => t.cr - t.codes.filter((c) => S.first.has(c)).reduce((s, c) => s + (S.credits.get(c) ?? 0), 0));
  };

  /**
   * Every measure on which y is worse than x (rule.py worse): the strict
   * "no board worse" rule is any of them. `splitIds` reads ::optN as its
   * parent requirement (true unless asked).
   */
  function worse(x, y, { splitIds = true } = {}) {
    const out = {};
    const e = minus(new Set(y.errors.map((i) => errkey(i.id))), new Set(x.errors.map((i) => errkey(i.id))));
    if (e.length) out.errors = e.sort();
    const n = minus(requiredOff(y), requiredOff(x));
    if (n.length) out.required = n.sort();
    if (offCount(y) > offCount(x)) out.notPlacedCount = [offCount(x), offCount(y)];
    const uid = splitIds ? reqKey : (id) => id;
    const u = minus(new Set(y.unsatisfied.map((a) => uid(a.id))), new Set(x.unsatisfied.map((a) => uid(a.id))));
    if (u.length) out.unsatisfied = u.sort();
    if (y.termsUsed > x.termsUsed) out.terms = [x.finish, y.finish];
    if (y.beyond > x.beyond + 1) out['beyond>1'] = [x.beyond, y.beyond];
    const o = minus(new Set(y.orderFaults ?? []), new Set(x.orderFaults ?? []));
    if (o.length) out.order = o.sort();
    const a = minus(apart(y), apart(x));
    if (a.length) out.labApart = a.sort();
    if (y.terms.filter((t) => t.cr > 18).length > x.terms.filter((t) => t.cr > 18).length) out.over18 = 1;
    if (y.stack3 > x.stack3) out.stack3 = [x.stack3, y.stack3];
    const sx = rowLate(x);
    const sy = rowLate(y);
    const tl = [...sy].filter(([k, p]) => p > (sx.get(k) ?? -1)).map(([k, p]) => [k.slice(k.indexOf(':') + 1), sx.has(k) ? sx.get(k) : 'on time', p]);
    if (tl.length) out.track = tl;
    const ux = upper(x);
    const uy = upper(y);
    if (ux !== null && uy !== null && uy < 21 && uy < ux) out.residency = [ux, uy];
    const s = minus(semInY1(x), semInY1(y));
    if (s.length) out.seminar = s.sort();
    if (mathInY1(x) && !mathInY1(y)) out.y1math = [x.firstMath, y.firstMath];
    const sp = minus(splits(y), splits(x));
    if (sp.length) out.split = sp.sort();
    const wn = minus(watched(y), watched(x));
    if (wn.length) out.warnings = wn.sort();
    const y17 = (r) => {
      const l = firstTermLoad(r);
      return [l.filter((c) => c >= 17).length, l.filter((c) => c >= 18).length];
    };
    const y15 = (r) => r.yearOne.filter((t) => t.cr < 15).length;
    if (y17(y)[0] > y17(x)[0] || y17(y)[1] > y17(x)[1]) out.y1heavy = [x.yearOne.map((t) => t.cr), y.yearOne.map((t) => t.cr)];
    if (y15(y) > y15(x)) out.y1light = [x.yearOne.map((t) => t.cr), y.yearOne.map((t) => t.cr)];
    const ex = extra(x);
    const ey = extra(y);
    const pc = minus(ey.prereqCheck, ex.prereqCheck);
    if (pc.length) out.prereqCheck = pc.sort();
    for (const m of ['thin', 'atCap', 'stack2', 'crowded']) if (ey[m] > ex[m]) out[m] = [ex[m], ey[m]];
    if (ey.crowdMax > Math.max(3, ex.crowdMax)) out.crowdMax = [ex.crowdMax, ey.crowdMax];
    const fx = x.firstMath?.term ?? 99;
    const fy = y.firstMath?.term ?? 99;
    if (fy > fx) out.mathLater = [fx, fy];
    const ly = minus(semLate(y), semLate(x));
    if (ly.length) out.seminarLate = ly.sort();
    const count = (r) => {
      const c = new Map();
      for (const m of r.momentumPlan) c.set(m.id, (c.get(m.id) ?? 0) + 1);
      return c;
    };
    const mx = count(x);
    const my = count(y);
    const mn = [...my].filter(([id, v]) => v > (mx.get(id) ?? 0)).map(([id]) => id);
    if (mn.length) out.momentum = mn;
    return out;
  }

  /** The sweep-wide totals of the shape measures (gatepolicy shape_totals). */
  function shapeTotals(rows) {
    const t = { atCap: 0, stack2: 0, crowded: 0, prereqCheck: 0, split: 0, seminarLate: 0, momentum: 0, y1heavy: 0, y1light: 0, y1math: 0, mathLater: 0, warnings: 0, seminar: 0 };
    for (const r of rows) {
      const x = extra(r);
      t.atCap += x.atCap;
      t.stack2 += x.stack2;
      t.crowded += x.crowded;
      t.prereqCheck += x.prereqCheck.size;
      t.split += splits(r).size;
      t.seminarLate += semLate(r).size;
      t.momentum += r.momentumPlan.length;
      t.y1heavy += r.yearOne.filter((q) => q.cr >= 17).length;
      t.y1light += r.yearOne.filter((q) => q.cr < 15).length;
      t.y1math += mathInY1(r) ? 0 : 1;
      t.mathLater += r.firstMath?.term ?? 9;
      t.warnings += watched(r).size;
      t.seminar += semLate(r).size;
    }
    return t;
  }

  return { worse, shapeTotals, semLate, splits, apart, upper, mathInY1 };
}

// ---- real requirements -------------------------------------------------------

/** Is one block met by these codes (gatepolicy met): null for a kind it does not score (gen ed, notes). */
export function metBlock(block, have, credits) {
  const r = block.rule;
  if (!['all', 'choose', 'pool'].includes(r.kind)) return null;
  const sat = r.choices.filter((c) => c.codes.some((code) => have.has(code)));
  if (r.kind === 'all') return sat.length === r.choices.length;
  if (r.kind === 'choose') return sat.length >= (r.n || 1);
  const cr = (c) => credits.get(c) ?? 3;
  const hoursOf = (c) => {
    // Both halves of a pair (STAT 400 & STAT 410) when both are on the board.
    for (const bundle of c.bundles ?? []) if (bundle.length > 1 && bundle.every((x) => have.has(x))) return bundle.reduce((s, x) => s + cr(x), 0);
    return Math.max(...c.codes.filter((code) => have.has(code)).map(cr));
  };
  const hrs = sat.reduce((s, c) => s + hoursOf(c), 0);
  let ok = true;
  if (r.hours != null) ok = ok && hrs >= r.hours - 0.01;
  if (r.n != null) ok = ok && sat.length >= r.n;
  return ok;
}
export function readingOf(blocksRows) {
  const byDegree = new Map();
  for (const b of blocksRows) {
    const list = byDegree.get(b.id) ?? [];
    list.push(b);
    byDegree.set(b.id, list);
  }
  return byDegree;
}
const codesOf = (r) => new Set(r.terms.flatMap((t) => t.codes));
/** The real requirements a board leaves unmet on a reading. */
export function unmetOn(reading, r, credits) {
  const have = codesOf(r);
  return (reading.get(r.id) ?? []).filter((b) => metBlock(b, have, credits) === false).length;
}

// ---- the verdict -------------------------------------------------------------

const A_SET = new Set(['errors', 'order', 'labApart']);
const B_SET = new Set(['track', 'beyond>1', 'residency', 'over18', 'stack3']);
const SKIP = new Set(['required', 'notPlacedCount', 'unsatisfied']);
export const VERDICTS = {
  accept: ['accept: more requirements', 'accept: more requirements, shape cost', 'accept: more requirements, forced deadline/hours cost', 'accept: same requirements', 'accept: same requirements, shape shuffled'],
  blocked: ['blocked: fewer real requirements', 'blocked: errors/order/labs/late finish'],
  engine: ['fix engine first: more requirements but an avoidable deadline/hours cost', 'fix engine first: same requirements, deadline/hours worse', 'fix engine first: same requirements, shape worse in the sweep total'],
};
export const levelOf = (v) => (v.startsWith('accept') ? 'accepted' : v.startsWith('blocked') ? 'blocked' : 'engine');

/**
 * Every changed board's verdict. `before` and `after` are Maps by keyOf;
 * `reading` is readingOf(blocks) of the new reading. Boards whose courses
 * per term are the same are not judged.
 */
export function verdicts(before, after, reading, S, { splitIds = true } = {}) {
  const M = makeMeasures(S);
  const pairs = [];
  for (const [k, x0] of before) {
    const y0 = after.get(k);
    if (!y0 || x0.error || y0.error) continue;
    pairs.push(onReleaseRows(x0, y0));
  }
  const named = new Map([...reading].map(([d, bl]) => [d, new Set(bl.filter((x) => ['all', 'choose', 'pool'].includes(x.kind)).flatMap((x) => x.codes))]));
  const ta = M.shapeTotals(pairs.map((p) => p.x));
  const tb = M.shapeTotals(pairs.map((p) => p.y));
  const shapeOk = new Set(Object.keys(tb).filter((m) => tb[m] <= ta[m]));
  if (tb.crowded <= ta.crowded) shapeOk.add('crowdMax');
  const counts = {};
  const reasons = {};
  const boards = [];
  let changed = 0;
  let strictBlocked = 0;
  const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const { x: a, y: b } of pairs) {
    if (JSON.stringify(a.terms.map((t) => t.codes)) === JSON.stringify(b.terms.map((t) => t.codes))) continue;
    const all = M.worse(a, b, { splitIds });
    const w = Object.fromEntries(Object.entries(all).filter(([m]) => !SKIP.has(m)));
    const strict = Object.keys(all).length > 0;
    changed += 1;
    if (strict) strictBlocked += 1;
    const ua = unmetOn(reading, a, S.credits);
    const ub = unmetOn(reading, b, S.credits);
    if ('terms' in w && !pastTarget(b)) delete w.terms;
    const keys = Object.keys(w);
    const tierA = keys.filter((m) => A_SET.has(m) || m === 'terms');
    const tierB = keys.filter((m) => B_SET.has(m));
    const tierC = keys.filter((m) => !A_SET.has(m) && !B_SET.has(m) && m !== 'terms');
    let v;
    const why = [];
    if (ub > ua) v = 'blocked: fewer real requirements';
    else if (tierA.length) v = 'blocked: errors/order/labs/late finish';
    else if (ub < ua) {
      if (!tierB.length) v = 'accept: more requirements' + (tierC.length ? ', shape cost' : '');
      else {
        let forced = true;
        const have = codesOf(a);
        const newly = [...codesOf(b)].filter((c) => !have.has(c) && named.get(a.id)?.has(c)).reduce((s, c) => s + (S.credits.get(c) ?? 3), 0);
        if ('beyond>1' in w) forced = forced && b.beyond - a.beyond <= newly;
        if ('track' in w) forced = forced && degreeFirst(b, w.track, S);
        if ('residency' in w || 'over18' in w || 'stack3' in w) forced = false;
        v = forced ? 'accept: more requirements, forced deadline/hours cost' : 'fix engine first: more requirements but an avoidable deadline/hours cost';
        for (const m of tierB) {
          bump(reasons, `B:${m}`);
          why.push(`B:${m}`);
        }
      }
    } else if (tierB.length) {
      v = 'fix engine first: same requirements, deadline/hours worse';
      for (const m of tierB) {
        bump(reasons, `sameB:${m}`);
        why.push(`sameB:${m}`);
      }
    } else if (tierC.some((m) => !shapeOk.has(m))) {
      v = 'fix engine first: same requirements, shape worse in the sweep total';
      for (const m of tierC.filter((m) => !shapeOk.has(m))) {
        bump(reasons, `sameC:${m}`);
        why.push(`sameC:${m}`);
      }
    } else v = 'accept: same requirements' + (tierC.length ? ', shape shuffled' : '');
    bump(counts, v);
    boards.push({ key: keyOf(b), id: b.id, goal: b.goal, lang: b.lang, verdict: v, level: levelOf(v), unmetBefore: ua, unmetAfter: ub, worse: w, why });
  }
  const levels = { accepted: 0, blocked: 0, engine: 0 };
  for (const [v, n] of Object.entries(counts)) levels[levelOf(v)] += n;
  return { changed, strictBlocked, counts, levels, reasons, boards, shape: Object.fromEntries(Object.keys(ta).map((m) => [m, [ta[m], tb[m]]])) };
}

/**
 * "The degree beats pre-med/PT when both cannot fit, and the plan then says
 * which track courses need a summer or an extra term" (the owner's decision
 * of 2026-10-06), on a board that meets more real requirements: its track
 * rows late or off the board (`rows`, gateWorse's track entries: row, where
 * it was, where it is, 99 for off) are a cost the arithmetic forces only when
 *
 *   - no row off the board has a seat under 18 anywhere: no fall or spring
 *     has as many hours to spare as any of its courses, with the lab or
 *     lecture that goes beside it, after the prerequisites it names (room is
 *     a term's, not hours summed over terms: a 4-hour CHEM 104 does not fit
 *     two terms with 2 hours each; a row that fits a term after its date
 *     belongs there, late, not off the board);
 *   - each row later than its date had no such seat up to its date;
 *   - and the board says so: every such row's course is named in the plan's
 *     own "The degree's own courses come first" sentence, which tells the
 *     student it needs a summer session or an extra term.
 *
 * The research's rule summed the hours to spare over every term and never
 * counted a row only later as forced.
 */
export function degreeFirst(b, rows, S) {
  const at = atOf(b);
  const held = new Set((b.held ?? []).map(norm));
  const regular = b.terms.map((t, i) => ({ i, free: Math.max(0, 18 - t.cr) })).filter((t) => !isSummer(b.terms[t.i]));
  const lectureOf = (code) => S.labs.get(code) ?? null;
  const labOf = (code) => [...S.labs].find(([, lec]) => lec === code)?.[0] ?? null;
  /*
   * Whether one course of a row has a seat under 18 by `last` (a term
   * index): a fall or spring with its hours to spare, after every
   * prerequisite group it names is met on the board (or held), and with its
   * lab or lecture, which go in one term: a 1-hour IB 151 has no seat on
   * its own, and CHEM 332 none without the CHEM 232 it names.
   */
  const seat = (code, last) => {
    const lecture = lectureOf(code);
    const lab = labOf(code);
    const partner = lecture ?? lab;
    const partnerAt = partner !== null && at.has(partner) ? at.get(partner) : null;
    const hours = (S.credits.get(code) ?? 3) + (partner !== null && partnerAt === null && !held.has(partner) ? S.credits.get(partner) ?? 3 : 0);
    let after = -1;
    for (const g of S.pre.get(code)?.groups ?? []) {
      if (g.priorLearning || g.concurrent) continue;
      const names = g.any.map(norm);
      if (names.some((c) => held.has(c))) continue;
      const placed = names.filter((c) => at.has(c)).map((c) => at.get(c));
      if (placed.length === 0) return false;
      after = Math.max(after, Math.min(...placed));
    }
    return regular.some((t) => t.i > after && t.i <= last && (partnerAt === null || t.i === partnerAt) && t.free >= hours);
  };
  const end = b.terms.length - 1;
  const lost = rows.filter(([, , now]) => now === 99).map(([row]) => row);
  const late = rows.filter(([, , now]) => now !== 99).map(([row]) => row);
  if (lost.some((row) => row.split('/').some((c) => seat(norm(c), end)))) return false;
  const due = b.terms.findIndex((t) => t.label === b.trackDue);
  if (late.some((row) => row.split('/').some((c) => seat(norm(c), due < 0 ? end : due)))) return false;
  const said = (b.notes ?? []).flatMap((n) => [...n.matchAll(/The degree's own courses come first, so [^.]*\./g)].map((m) => m[0])).join(' ');
  return [...lost, ...late].every((row) => row.split('/').some((c) => said.includes(c)));
}

/** The verdict as text lines. */
export function report(v, { list = false } = {}) {
  const lines = [];
  lines.push(`  boards changed: ${v.changed}; the strict "no board worse" rule blocks ${v.strictBlocked}`);
  lines.push(`  three-level: ${v.levels.accepted} accepted, ${v.levels.blocked} blocked, ${v.levels.engine} engine work first`);
  for (const group of ['accept', 'blocked', 'engine']) for (const name of VERDICTS[group]) if (v.counts[name]) lines.push(`    ${String(v.counts[name]).padStart(5)}  ${name}`);
  const reasons = Object.entries(v.reasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length) lines.push(`  why engine work (or a forced cost): ${reasons.map(([m, n]) => `${m} ${n}`).join(', ')}`);
  if (list) {
    for (const b of v.boards.filter((b) => b.level !== 'accepted').sort((a, b) => a.level.localeCompare(b.level) || a.key.localeCompare(b.key))) {
      lines.push(`    [${b.level}] ${b.id} [${b.goal || 'no goal'}, lang ${b.lang}] unmet ${b.unmetBefore} -> ${b.unmetAfter}: ${Object.entries(b.worse).map(([m, d]) => `${m} ${JSON.stringify(d).slice(0, 160)}`).join('; ')}`);
    }
  }
  return lines;
}

// ---- the command -------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
  };
  const files = args.filter((a, i) => !a.startsWith('--') && !['--reading', '--checkout', '--json'].includes(args[i - 1]));
  if (files.length !== 2) {
    console.error('usage: node gate.mjs <before.jsonl> <after.jsonl> [--reading <blocks.jsonl>] [--checkout <dir>] [--list] [--json <out.json>]');
    process.exit(2);
  }
  const readingPath = opt('--reading') ?? files[1].replace(/\.jsonl$/, '') + '.blocks.jsonl';
  if (!existsSync(readingPath)) {
    console.error(`no reading: ${readingPath} (sweep with blocks, or pass --reading)`);
    process.exit(2);
  }
  const S = loadStatics(resolve(opt('--checkout') ?? fileURLToPath(new URL('../../..', import.meta.url))));
  const before = new Map(readJsonl(files[0]).map((r) => [keyOf(r), r]));
  const after = new Map(readJsonl(files[1]).map((r) => [keyOf(r), r]));
  const v = verdicts(before, after, readingOf(readJsonl(readingPath)), S, { splitIds: !args.includes('--raw-ids') });
  console.log(`before: ${files[0]}\nafter:  ${files[1]}\nreading: ${readingPath}`);
  for (const l of report(v, { list: args.includes('--list') })) console.log(l);
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(v, null, 1));
}
