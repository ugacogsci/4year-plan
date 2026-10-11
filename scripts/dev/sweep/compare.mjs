/**
 * Two sweeps side by side: what got worse, board by board, most severe first.
 *
 *   node compare.mjs <before.jsonl> <after.jsonl> [--top N | --all]
 *
 * Both files come from sweep.mjs. For every metric it prints the totals in
 * each goal-and-language group, then every degree, goal and language start
 * that got worse on it, most severe first. It ends with one line per metric
 * and the boards with the most severe regressions over all metrics (--top,
 * default 40; --all prints every board).
 *
 * Why totals and a list: the totals alone hid the regressions after a930f09.
 * Pre-med planned credits rose only from 39182 to 39264 across 308 degrees,
 * a 0.2% change, and that was six Psychology concentrations each gaining an
 * eighth semester and seven credits, with SOC 100 past the MCAT spring.
 *
 * Severity, highest first: a board that threw; a new validator error; a
 * required course newly not placed or a requirement newly unmet; a track row
 * newly off the board, or newly (or later) past its Spring 2029 date; an
 * extra term; an edit-caused momentum flag on an untouched board; credits
 * beyond the degree total; a new 3+ hardest-band stack; a first-year term
 * that rose to 17 or more; a new plan-caused momentum flag; a new 2+ stack;
 * Composition I or the first math newly after year one; a second first-term
 * seminar.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (files.length !== 2) {
  console.error('usage: node compare.mjs <before.jsonl> <after.jsonl> [--top N | --all]');
  process.exit(2);
}
const topAt = args.indexOf('--top');
const TOP = args.includes('--all') ? Infinity : topAt >= 0 ? Number(args[topAt + 1]) : 40;

const readRows = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
const keyOf = (r) => `${r.id}|${r.goal}|${r.lang}`;
const before = new Map(readRows(files[0]).map((r) => [keyOf(r), r]));
const after = new Map(readRows(files[1]).map((r) => [keyOf(r), r]));
const groupOf = (r) => `${r.goal || 'no goal'}, lang ${r.lang}`;
const boardName = (r) => `${r.id} [${r.goal || 'no goal'}, lang ${r.lang}]`;

// ---- small helpers ----------------------------------------------------------
const added = (now, was) => {
  const old = new Set(was);
  return [...new Set(now)].filter((x) => !old.has(x));
};
const hardTerms = (r, n) => r.terms.filter((t) => t.hard.length >= n).map((t) => `${t.label}: ${t.hard.join(', ')}`);
const yearOneEnd = (r) => {
  const last = r.yearOne[r.yearOne.length - 1]?.label;
  return r.terms.findIndex((t) => t.label === last);
};
const afterYearOne = (r, at) => at === null || at === undefined || at.term > yearOneEnd(r);
const seminarPile = (r) => r.firstTermSeminars.length >= 2;
const LAB_PAIRS = { ...JSON.parse(readFileSync(new URL('./labpairs.json', import.meta.url), 'utf8')), 'CHEM 105': 'CHEM 104', 'MCB 245': 'MCB 244', 'MCB 247': 'MCB 246', 'MCB 251': 'MCB 250' };
const labsApart = (r) => {
  const where = new Map();
  r.terms.forEach((t, i) => t.codes.forEach((c) => where.set(c, i)));
  return Object.entries(LAB_PAIRS).filter(([lab, lec]) => where.has(lab) && where.has(lec) && where.get(lab) !== where.get(lec)).map(([lab, lec]) => `${lec}/${lab} ${r.terms[where.get(lec)].label}/${r.terms[where.get(lab)].label}`);
};
const SEMINAR_CODE = /^(LAS 10[0-2]|BUS 101|ENG 100|FAA 101|HK 125)$/;
const lateSeminars = (r) => {
  const end = yearOneEnd(r);
  const out = [];
  r.terms.forEach((t, i) => { if (i > end) for (const c of t.codes) if (SEMINAR_CODE.test(c)) out.push({ code: c, i }); });
  return out;
};
/** 'CODE ... in TERM' and 'CODE ... added to TERM' where CODE, the nearest course named before the term, is not in that term. */
const falseClaims = (r) => {
  if (!r.notes) return [];
  const where = new Map();
  r.terms.forEach((t) => t.codes.forEach((c) => where.set(c, t.label)));
  const out = [];
  for (const text of [...r.notes, ...(r.electiveWhy ?? [])]) {
    const re = /\b(?:in|to|into) ((?:Fall|Spring|Summer) 20\d\d)\b/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      const codes = [...before.matchAll(/\b([A-Z]{2,5} \d{3})\b/g)];
      if (!codes.length) continue;
      const code = codes[codes.length - 1][1];
      // Only a claim when the code sits in the same clause as the term.
      const between = before.slice(codes[codes.length - 1].index + code.length);
      if (/[.;:]\s/.test(between) || between.length > 80) continue;
      if (/\b(not|before|after|until|by)\s*$/i.test(before) || /\bnot\b/i.test(between)) continue;
      if (!where.has(code)) continue;
      if (where.get(code) !== m[1]) out.push(`${code} said ${m[1]}, is ${where.get(code)}: "${text.slice(0, 140)}"`);
    }
  }
  return out;
};

/**
 * One metric: how it totals over a group, and the regression on one board as
 * { sev, detail } or null. `better` counts boards that moved the other way,
 * so a change that trades one board for another shows as such.
 */
const METRICS = [
  {
    key: 'errors',
    title: 'Validator errors',
    total: (r) => r.errors.length,
    worse(x, y) {
      const ids = added(y.errors.map((e) => e.id), x.errors.map((e) => e.id));
      if (!ids.length) return null;
      return { sev: 100 + ids.length, detail: y.errors.filter((e) => ids.includes(e.id)).map((e) => e.message).join(' | ') };
    },
    better: (x, y) => added(x.errors.map((e) => e.id), y.errors.map((e) => e.id)).length > 0,
  },
  {
    key: 'notPlaced',
    title: 'Courses not placed',
    total: (r) => r.notPlaced.length,
    worse(x, y) {
      const codes = added(y.notPlaced.map((n) => n.code), x.notPlaced.map((n) => n.code));
      if (!codes.length) return null;
      return { sev: 90 + codes.length, detail: y.notPlaced.filter((n) => codes.includes(n.code)).map((n) => `${n.code} (${n.reason})`).join(', ') };
    },
    better: (x, y) => added(x.notPlaced.map((n) => n.code), y.notPlaced.map((n) => n.code)).length > 0,
  },
  {
    key: 'unsatisfied',
    title: 'Unsatisfied requirements',
    total: (r) => r.unsatisfied.length,
    worse(x, y) {
      const ids = added(y.unsatisfied.map((u) => u.id), x.unsatisfied.map((u) => u.id));
      if (!ids.length) return null;
      const rows = y.unsatisfied.filter((u) => ids.includes(u.id));
      // "filled-by-electives" is an hours-only row the fill covered: worth
      // listing, not worth ranking with a required course that did not fit.
      const hard = rows.some((u) => !['filled-by-electives', 'not-parsed'].includes(u.reason));
      return { sev: (hard ? 85 : 40) + rows.length, detail: rows.map((u) => `${u.label.slice(0, 70)} (${u.reason})`).join(' | ') };
    },
    better: (x, y) => added(x.unsatisfied.map((u) => u.id), y.unsatisfied.map((u) => u.id)).length > 0,
  },
  {
    key: 'trackLate',
    title: 'Track dated rows placed after Spring 2029',
    total: (r) => r.trackLate.length,
    worse(x, y) {
      // Newly late, or late and later still: SOC 100 was missing from the
      // a930f09 pre-med Clinical-Community Psychology board and sits in
      // Spring 2030 at 0407e7f, after the MCAT spring it is dated for.
      const was = new Map(x.trackLate.map((l) => [l.row, l.label]));
      const order = (label) => y.terms.findIndex((t) => t.label === label);
      const rows = y.trackLate.filter((l) => !was.has(l.row) || order(l.label) > order(was.get(l.row)));
      if (!rows.length) return null;
      return { sev: 80 + rows.length, detail: rows.map((l) => `${l.row.replace(/^[^:]+:/, '')} @ ${l.label}${was.has(l.row) ? ` (was ${was.get(l.row)})` : x.trackMissing.includes(l.row) ? ' (was not on the board)' : ''}`).join(', ') };
    },
    better: (x, y) => x.trackLate.some((l) => !y.trackLate.some((m) => m.row === l.row)),
  },
  {
    key: 'trackMissing',
    title: 'Track dated rows not on the board',
    total: (r) => r.trackMissing.length,
    worse(x, y) {
      const rows = added(y.trackMissing, x.trackMissing);
      if (!rows.length) return null;
      const was = (row) => x.trackLate.find((l) => l.row === row)?.label ?? 'on time';
      return { sev: 82 + rows.length, detail: rows.map((row) => `${row.replace(/^[^:]+:/, '')} (was ${was(row)})`).join(', ') };
    },
    better: (x, y) => added(x.trackMissing, y.trackMissing).length > 0,
  },
  {
    key: 'terms',
    title: 'Terms used',
    total: (r) => r.termsUsed,
    worse: (x, y) => (y.termsUsed > x.termsUsed ? { sev: 70 + 10 * (y.termsUsed - x.termsUsed), detail: `${x.termsUsed} -> ${y.termsUsed} (finish ${x.finish} -> ${y.finish})` } : null),
    better: (x, y) => y.termsUsed < x.termsUsed,
  },
  {
    key: 'momentumEdit',
    title: 'Edit-caused momentum flags on the untouched board',
    total: (r) => r.momentumEdit.length,
    worse(x, y) {
      const ids = added(y.momentumEdit.map((f) => f.id), x.momentumEdit.map((f) => f.id));
      if (!ids.length) return null;
      return { sev: 60 + ids.length, detail: y.momentumEdit.filter((f) => ids.includes(f.id)).map((f) => `${f.id} (${f.cause}): ${f.message.slice(0, 160)}`).join(' | ') };
    },
    better: (x, y) => added(x.momentumEdit.map((f) => f.id), y.momentumEdit.map((f) => f.id)).length > 0,
  },
  {
    key: 'beyond',
    title: 'Credits beyond the degree total',
    total: (r) => r.beyond,
    worse: (x, y) =>
      y.beyond > x.beyond
        ? { sev: 50 + (y.beyond - x.beyond), detail: `planned ${x.planned} -> ${y.planned} of ${y.degreeTotal} (beyond ${x.beyond} -> ${y.beyond})${y.filledToMax && !x.filledToMax ? ', now "Terms were filled to 18 credits"' : ''}` }
        : null,
    better: (x, y) => y.beyond < x.beyond,
  },
  {
    key: 'stack3',
    title: 'Terms with 3+ hardest-band courses',
    total: (r) => r.stack3,
    worse: (x, y) => (y.stack3 > x.stack3 ? { sev: 45 + (y.stack3 - x.stack3), detail: `${x.stack3} -> ${y.stack3}: ${hardTerms(y, 3).join('; ')}` } : null),
    better: (x, y) => y.stack3 < x.stack3,
  },
  {
    key: 'yearOneHeavy',
    title: 'Boards with a first-year term at 17+ credits',
    total: (r) => (r.yearOne.some((t) => t.cr >= 17) ? 1 : 0),
    worse(x, y) {
      const rose = y.yearOne.map((t, i) => ({ t, was: x.yearOne[i]?.cr ?? 0 })).filter(({ t, was }) => t.cr >= 17 && t.cr > was);
      if (!rose.length) return null;
      const top = Math.max(...rose.map(({ t }) => t.cr));
      // Crossing 17 is the regression; a 17 that became 18 ranks just under it.
      const crossed = rose.some(({ was }) => was < 17);
      // Where the hours came from: the later terms that got lighter.
      const lighter = y.terms
        .map((t, i) => ({ t, was: x.terms[i] }))
        .filter(({ t, was }) => was && was.label === t.label && t.cr < was.cr && !y.yearOne.some((o) => o.label === t.label))
        .map(({ t, was }) => `${t.label} ${was.cr} -> ${t.cr}`);
      return {
        sev: crossed ? 40 + 3 * (top - 16) : 38,
        detail: `${rose.map(({ t, was }) => `${t.label} ${was} -> ${t.cr}`).join(', ')}${lighter.length ? `; lighter: ${lighter.join(', ')}` : ''}`,
      };
    },
    better: (x, y) => x.yearOne.some((t) => t.cr >= 17) && !y.yearOne.some((t) => t.cr >= 17),
  },
  {
    key: 'momentumPlan',
    title: 'Plan-caused momentum flags',
    total: (r) => r.momentumPlan.length,
    worse(x, y) {
      const ids = added(y.momentumPlan.map((f) => f.id), x.momentumPlan.map((f) => f.id));
      if (!ids.length) return null;
      return { sev: 35 + ids.length, detail: y.momentumPlan.filter((f) => ids.includes(f.id)).map((f) => `${f.id}: ${f.message.slice(0, 150)}`).join(' | ') };
    },
    better: (x, y) => added(x.momentumPlan.map((f) => f.id), y.momentumPlan.map((f) => f.id)).length > 0,
  },
  {
    key: 'stack2',
    title: 'Terms with 2+ hardest-band courses',
    total: (r) => r.stack2 + r.stack3,
    worse(x, y) {
      const was = x.stack2 + x.stack3;
      const now = y.stack2 + y.stack3;
      if (now <= was) return null;
      const old = new Set(x.terms.filter((t) => t.hard.length >= 2).map((t) => t.label));
      const fresh = y.terms.filter((t) => t.hard.length >= 2 && !old.has(t.label)).map((t) => `${t.label}: ${t.hard.join(', ')}`);
      return { sev: 30 + (now - was), detail: `${was} -> ${now}: ${(fresh.length ? fresh : hardTerms(y, 2)).join('; ')}` };
    },
    better: (x, y) => y.stack2 + y.stack3 < x.stack2 + x.stack3,
  },
  {
    key: 'comp1Late',
    title: 'Composition I after year one or not on the board',
    total: (r) => (afterYearOne(r, r.comp1) ? 1 : 0),
    worse: (x, y) =>
      afterYearOne(y, y.comp1) && !afterYearOne(x, x.comp1)
        ? { sev: 25, detail: `${x.comp1?.code} ${x.comp1?.label} -> ${y.comp1 ? `${y.comp1.code} ${y.comp1.label}` : 'not on the board'}` }
        : null,
    better: (x, y) => afterYearOne(x, x.comp1) && !afterYearOne(y, y.comp1),
  },
  {
    key: 'mathLate',
    title: "The degree's first math/statistics after year one or not on the board (one rule for both)",
    total: (r) => (afterYearOne(r, r.firstMath) ? 1 : 0),
    worse: (x, y) =>
      afterYearOne(y, y.firstMath) && !afterYearOne(x, x.firstMath)
        ? { sev: 20, detail: `${x.firstMath?.code} ${x.firstMath?.label} -> ${y.firstMath ? `${y.firstMath.code} ${y.firstMath.label}` : 'none on the board'}` }
        : null,
    better: (x, y) => afterYearOne(x, x.firstMath) && !afterYearOne(y, y.firstMath),
  },
  {
    key: 'seminars',
    title: 'Two or more first-term seminars (LAS 100/101/102, orientations) in the first term',
    total: (r) => (seminarPile(r) ? 1 : 0),
    worse: (x, y) => (seminarPile(y) && y.firstTermSeminars.length > x.firstTermSeminars.length ? { sev: 10, detail: `${x.firstTermSeminars.join(', ') || 'none'} -> ${y.firstTermSeminars.join(', ')}` } : null),
    better: (x, y) => seminarPile(x) && !seminarPile(y),
  },
  {
    key: 'yearOneLight',
    title: 'A first-year term fallen under 15, or year one under 30 (CCRC pace)',
    total: (r) => r.yearOne.filter((t) => t.cr < 15).length,
    worse(x, y) {
      const fell = y.yearOne.map((t, i) => ({ t, was: x.yearOne[i]?.cr ?? 0 })).filter(({ t, was }) => t.cr < 15 && was >= 15);
      const sum = (r) => r.yearOne.reduce((s, t) => s + t.cr, 0);
      const year = sum(y) < 30 && sum(x) >= 30;
      if (!fell.length && !year) return null;
      return { sev: 39, detail: `${fell.map(({ t, was }) => `${t.label} ${was} -> ${t.cr}`).join(', ')}${year ? `${fell.length ? '; ' : ''}year one ${sum(x)} -> ${sum(y)}` : ''}` };
    },
    better: (x, y) => {
      const sum = (r) => r.yearOne.reduce((s, t) => s + t.cr, 0);
      return y.yearOne.some((t, i) => t.cr >= 15 && (x.yearOne[i]?.cr ?? 0) < 15) || (sum(x) < 30 && sum(y) >= 30);
    },
  },
  {
    key: 'seminarLate',
    title: 'First-term seminars (LAS 100-102, BUS 101, ENG 100, FAA 101, HK 125) after year one',
    total: (r) => lateSeminars(r).length,
    worse(x, y) {
      const was = new Map(lateSeminars(x).map((s) => [s.code, s.i]));
      const now = lateSeminars(y).filter((s) => !was.has(s.code) || s.i > was.get(s.code));
      if (!now.length) return null;
      return { sev: 24, detail: now.map((s) => `${s.code} ${y.terms[s.i].label}${was.has(s.code) ? ` (was ${x.terms[was.get(s.code)]?.label})` : ''}`).join(', ') };
    },
    better: (x, y) => lateSeminars(x).length > lateSeminars(y).length,
  },
  {
    key: 'labApart',
    title: 'A lab in another term than its lecture (track pairs and catalog pairs numbered one apart)',
    total: (r) => labsApart(r).length,
    worse(x, y) {
      const pair = (p) => p.split(' ').slice(0, 3).join(' ');
      const was = new Set(labsApart(x).map(pair));
      const now = labsApart(y).filter((p) => !was.has(pair(p)));
      if (!now.length) return null;
      return { sev: 44, detail: now.join(', ') };
    },
    better: (x, y) => {
      const pair = (p) => p.split(' ').slice(0, 3).join(' ');
      const now = new Set(labsApart(y).map(pair));
      return labsApart(x).some((p) => !now.has(pair(p)));
    },
  },
  {
    key: 'falseNotes',
    title: "Notes and elective reasons naming a course in a term it is not in",
    total: (r) => falseClaims(r).length,
    worse(x, y) {
      const was = new Set(falseClaims(x));
      const now = falseClaims(y).filter((c) => !was.has(c));
      if (!now.length) return null;
      return { sev: 88, detail: now.join(' | ') };
    },
    better: (x, y) => falseClaims(x).some((c) => !falseClaims(y).includes(c)),
  },
];

// ---- pair the boards --------------------------------------------------------
const pairs = [];
const problems = [];
for (const [key, x] of before) {
  const y = after.get(key);
  if (!y) problems.push(`only in ${files[0]}: ${key}`);
  else if (y.error && !x.error) problems.push(`[200] ${boardName(y)} threw after: ${y.error.split('\n')[0]}`);
  else if (x.error && !y.error) problems.push(`fixed: ${boardName(y)} threw before: ${x.error.split('\n')[0]}`);
  else if (!x.error) pairs.push({ x, y });
}
for (const key of after.keys()) if (!before.has(key)) problems.push(`only in ${files[1]}: ${key}`);

const groups = [...new Set(pairs.map(({ y }) => groupOf(y)))];
const pad = (s, n) => String(s).padStart(n);
const byBoard = new Map();
const summary = [];

console.log(`before: ${files[0]} (${before.size} boards)\nafter:  ${files[1]} (${after.size} boards)\n`);
if (problems.length) {
  console.log('== Boards that did not pair or threw ==');
  for (const p of problems) console.log(`  ${p}`);
  console.log('');
}

// Plain aggregates that are not a regression on their own but frame the rest.
{
  console.log('== Aggregates ==');
  console.log(`  ${'group'.padEnd(34)}${pad('planned before', 16)}${pad('after', 9)}${pad('terms before', 14)}${pad('after', 7)}${pad('filled to 18', 14)}`);
  for (const g of [...groups, 'all']) {
    const set = pairs.filter(({ y }) => g === 'all' || groupOf(y) === g);
    const sum = (f) => set.reduce((s, p) => s + f(p), 0);
    const fill = `${sum(({ x }) => (x.filledToMax ? 1 : 0))} -> ${sum(({ y }) => (y.filledToMax ? 1 : 0))}`;
    console.log(`  ${g.padEnd(34)}${pad(sum(({ x }) => x.planned), 16)}${pad(sum(({ y }) => y.planned), 9)}${pad(sum(({ x }) => x.termsUsed), 14)}${pad(sum(({ y }) => y.termsUsed), 7)}${pad(fill, 14)}`);
  }
  const flagCount = (set, side) => {
    const out = {};
    for (const p of set) for (const f of p[side].momentumPlan) out[f.id] = (out[f.id] ?? 0) + 1;
    return out;
  };
  console.log('  plan-caused momentum flags by id:');
  for (const g of [...groups, 'all']) {
    const set = pairs.filter(({ y }) => g === 'all' || groupOf(y) === g);
    const was = flagCount(set, 'x');
    const now = flagCount(set, 'y');
    console.log(`    ${g.padEnd(32)}${[...new Set([...Object.keys(was), ...Object.keys(now)])].sort().map((id) => `${id} ${was[id] ?? 0} -> ${now[id] ?? 0}`).join(', ')}`);
  }
  console.log(`  boards with any review edit flag (editFlags): ${pairs.filter(({ x }) => x.editFlags.length).length} -> ${pairs.filter(({ y }) => y.editFlags.length).length}\n`);
}

for (const m of METRICS) {
  const worse = [];
  let better = 0;
  for (const { x, y } of pairs) {
    const w = m.worse(x, y);
    if (w) {
      worse.push({ ...w, board: y });
      const list = byBoard.get(keyOf(y)) ?? [];
      list.push({ metric: m.key, ...w });
      byBoard.set(keyOf(y), list);
    }
    if (m.better(x, y)) better += 1;
  }
  worse.sort((a, b) => b.sev - a.sev || a.board.id.localeCompare(b.board.id) || a.board.goal.localeCompare(b.board.goal) || a.board.lang - b.board.lang);
  console.log(`== ${m.title} [${m.key}] ==`);
  console.log(`  ${'group'.padEnd(34)}${pad('before', 8)}${pad('after', 8)}${pad('delta', 8)}${pad('worse', 8)}${pad('better', 8)}`);
  let all = { was: 0, now: 0, worse: 0, better: 0 };
  for (const g of groups) {
    const set = pairs.filter(({ y }) => groupOf(y) === g);
    const was = set.reduce((s, { x }) => s + m.total(x), 0);
    const now = set.reduce((s, { y }) => s + m.total(y), 0);
    const w = worse.filter((r) => groupOf(r.board) === g).length;
    const b = set.filter(({ x, y }) => m.better(x, y)).length;
    all = { was: all.was + was, now: all.now + now, worse: all.worse + w, better: all.better + b };
    console.log(`  ${g.padEnd(34)}${pad(was, 8)}${pad(now, 8)}${pad((now - was > 0 ? '+' : '') + (now - was), 8)}${pad(w, 8)}${pad(b, 8)}`);
  }
  console.log(`  ${'all'.padEnd(34)}${pad(all.was, 8)}${pad(all.now, 8)}${pad((all.now - all.was > 0 ? '+' : '') + (all.now - all.was), 8)}${pad(all.worse, 8)}${pad(all.better, 8)}`);
  summary.push({ m, ...all });
  if (worse.length) {
    console.log('  worse, most severe first:');
    for (const w of worse) console.log(`    [${w.sev}] ${boardName(w.board)}: ${w.detail}`);
  }
  console.log('');
}

console.log('== Summary: all groups ==');
console.log(`  ${'metric'.padEnd(16)}${pad('before', 8)}${pad('after', 8)}${pad('worse', 8)}${pad('better', 8)}`);
for (const s of summary) console.log(`  ${s.m.key.padEnd(16)}${pad(s.was, 8)}${pad(s.now, 8)}${pad(s.worse, 8)}${pad(s.better, 8)}`);

const ranked = [...byBoard.entries()]
  .map(([key, list]) => ({ board: after.get(key), list: list.sort((a, b) => b.sev - a.sev), top: Math.max(...list.map((l) => l.sev)), sum: list.reduce((s, l) => s + l.sev, 0) }))
  .sort((a, b) => b.top - a.top || b.sum - a.sum || a.board.id.localeCompare(b.board.id));
console.log(`\n== Boards worse on any metric: ${ranked.length} of ${pairs.length}${ranked.length > TOP ? `, top ${TOP} by severity (--all for every one)` : ''} ==`);
for (const r of ranked.slice(0, TOP)) console.log(`  [${r.top}] ${boardName(r.board)}: ${r.list.map((l) => l.metric).join(', ')}`);
process.exit(0);
