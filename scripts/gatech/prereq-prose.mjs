/**
 * Georgia Tech prerequisites: Banner's table -> boolean tree -> AND-of-ORs ->
 * the Illinois prose form lib/planner/illinois-data.ts parsePrerequisites reads.
 *
 * SOURCE: the HTML that registration.banner.gatech.edu returns from
 *   courseSearchResults/getPrerequisites, getCorequisites and getRestrictions
 *   (cached by scripts/gatech/banner.mjs under data/gatech-raw/banner-catalog/).
 *   The prerequisite table has one row per condition:
 *     And/Or | ( | Test | Score | Subject (description) | Course Number | Level | Grade | )
 *
 * WRITES: nothing. Pure functions, imported by scripts/gatech/courses.mjs and
 *   scripts/gatech/measure-prereqs.mjs.
 *
 * HOW TO RUN: not on its own. `node scripts/gatech/prereq-prose.mjs --selftest`
 *   runs the worked examples at the bottom; `... --verify
 *   data/gatech-raw/banner-catalog/202608/prereq
 *   data/gatech-raw/banner-catalog/202608/lookup/subject.json` checks, for every
 *   cached table, that the AND-of-ORs accepts exactly what Banner's tree accepts.
 *
 * THE PROSE FORM, and why. The Illinois parser reads a sentence as segments
 * split on ";" (a top-level AND), and inside a segment "A or B or C" is one
 * group of alternatives. So the table is evaluated into a tree, the tree is
 * distributed into conjunctive normal form (an AND of OR-clauses, logically the
 * same requirement), and each clause is written as one segment:
 *     (CS 2050 or CS 2051 or MATH 2106) and (CS 1332 or MATH 3012 or MATH 3022)
 *  -> "CS 2050 (minimum grade C) or CS 2051 (minimum grade C) or MATH 2106
 *      (minimum grade C); CS 1332 (minimum grade C) or MATH 3012 or MATH 3022."
 * A test-score alternative ("ACT Math 28") is written as "a qualifying high
 * school/placement test score (...)", which the Illinois parser's prior-learning
 * rule (PRIOR_LEARNING = /\bhigh school\b/) reads as "a student may arrive with
 * this instead": a Calculus I board must not book precalculus for a student
 * whose SAT already places them.
 *
 * WHAT IT CANNOT KNOW
 *   - Concurrency: the table has no such column.
 *   - Banner's precedence for a run that mixes And and Or with no parentheses
 *     (about 3% of tables). Such a run is read with Or binding tighter than
 *     And: "CHEM 4511 And CHEM 2312 Or CHEM 2313" is CHEM 4511 and (CHEM 2312
 *     or CHEM 2313). Of the 25 such undergraduate tables (Fall 2026), that
 *     reading matched what the courses plainly intend in 21 (AE 2221 keeps
 *     COE 2001, CHEM 4512 keeps CHEM 4511, BIOS 3756 keeps BIOS 3755, NEUR 2010
 *     keeps PSYC 1101 ...), and where it is wrong (BIOS 3753, BIOS 4401,
 *     CHBE 2100, CHBE 2130) it asks for the lecture-and-lab pair or the linear
 *     algebra a current student takes anyway. The other reading drops a real sequence
 *     course whenever an alternative is held, which lets a plan put CHEM 4512
 *     before CHEM 4511. Every such row is flagged (mixedWithoutParens ->
 *     prereqAmbiguous in the catalog) and keeps Banner's verbatim order in prereqGT.
 *   - Old quarter-system courses (Level "... Quarter") are alternatives no
 *     current student can hold; they are evaluated as false, which removes them
 *     from an Or and removes an And-branch that needs one. Exact, not a guess.
 */

const ent = (s) =>
  String(s ?? '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const cell = (html) => ent(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The prerequisite rows, or [] when Banner says "No prerequisite information available." */
export function parsePrereqTable(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!body) return { rows: [] };
  const rows = [];
  for (const tr of body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cell(m[1]));
    if (tds.length < 9) continue;
    const [andOr, open, test, score, subject, number, level, grade, close] = tds;
    rows.push({ andOr: andOr.toLowerCase(), open, test, score, subject, number, level, grade, close });
  }
  return { rows };
}

/** Corequisites: [{ subject (description), number, title }]. */
export function parseCoreqTable(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!body) return [];
  const out = [];
  for (const tr of body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cell(m[1]));
    if (tds.length >= 2 && tds[1]) out.push({ subject: tds[0], number: tds[1], title: tds[2] ?? '' });
  }
  return out;
}

/**
 * Restrictions, as [{ heading, items }]:
 *   "Must be enrolled in one of the following Classifications:" -> ["Junior (JR)", "Senior (SR)"]
 */
export function parseRestrictions(html) {
  const out = [];
  let cur = null;
  for (const m of html.matchAll(/<span class="(status-bold|detail-popup-indentation)"[^>]*>([\s\S]*?)<\/span>/gi)) {
    const t = cell(m[2]);
    if (!t) continue;
    if (m[1] === 'status-bold') { cur = { heading: t.replace(/:$/, ''), items: [] }; out.push(cur); }
    else if (cur) cur.items.push(t);
  }
  return out;
}

const STANDINGS = [
  ['freshman', /\bfreshman\b|\bfirst[- ]year\b/i],
  ['sophomore', /\bsophomore\b|\bsecond[- ]year\b/i],
  ['junior', /\bjunior\b|\bthird[- ]year\b/i],
  ['senior', /\bsenior\b|\bfourth[- ]year\b/i],
];

/**
 * A class-standing sentence the Illinois parseStanding reads, or ''.
 * "Must be enrolled in ... Classifications: Junior, Senior" -> "Restricted to
 * students with junior or senior standing." "Cannot be enrolled in ...
 * Classifications: Freshman" -> the standings left over. Graduate-only and
 * non-undergraduate lists say nothing about an undergraduate's year.
 */
export function standingSentence(restrictions) {
  for (const r of restrictions ?? []) {
    if (!/classification/i.test(r.heading)) continue;
    const named = STANDINGS.filter(([, re]) => r.items.some((i) => re.test(i))).map(([s]) => s);
    let allowed;
    if (/^must be/i.test(r.heading)) allowed = named;
    else if (/^cannot be/i.test(r.heading)) allowed = named.length ? STANDINGS.map(([s]) => s).filter((s) => !named.includes(s)) : [];
    else continue;
    if (!allowed.length || allowed.includes('freshman')) continue;
    const words = allowed.length === 1 ? allowed[0] : `${allowed.slice(0, -1).join(', ')} or ${allowed[allowed.length - 1]}`;
    return `Restricted to students with ${words} standing.`;
  }
  return '';
}

/** Words that would split an Illinois item or segment: keep them out of labels. */
const safeLabel = (s) => s.replace(/;/g, ',').replace(/,/g, ' ').replace(/\band\b/gi, '&').replace(/\bor\b/gi, '/').replace(/\.(\s|$)/g, '$1').replace(/\s+/g, ' ').trim();

/**
 * The table as a boolean tree. Precedence: parentheses, then Or, then And
 * (see the header for why Or binds tighter; it matters only in a run that
 * mixes the two with no parentheses).
 * Returns { node, atoms, unknownSubjects, mixedWithoutParens, unbalanced }.
 */
export function prereqTreeOf(rows, { subjByDesc, known }) {
  const atoms = [];
  const rowAtoms = [];
  const unknownSubjects = new Set();
  const tokens = [];
  rows.forEach((r) => {
    /**
     * Banner writes deeper nesting as rows that hold only a parenthesis
     * (BIOS 4200 opens with two rows of a bare "(" before its first course),
     * and the row after an opening one carries no And/Or. So an operator is
     * emitted only where the row names one; a missing one between two
     * conditions (never seen) defaults to And.
     */
    const prev = tokens[tokens.length - 1];
    const opens = r.open.includes('(');
    const hasAtom = Boolean(r.test || r.subject || r.number);
    if (r.andOr === 'and' || r.andOr === 'or') tokens.push({ t: 'op', v: r.andOr });
    // A row that only closes a group (BIOS 4200 has one after BIOS 1207L) needs no operator.
    else if ((hasAtom || opens) && prev && (prev.t === 'atom' || prev.t === ')')) tokens.push({ t: 'op', v: 'and' });
    for (const _ of r.open.replace(/[^(]/g, '')) tokens.push({ t: '(' });
    let atom;
    if (!r.test && !r.subject && !r.number) {
      atom = null; // a grouping row
    } else if (r.test) {
      atom = { kind: 'test', test: r.test, score: r.score };
    } else {
      const desc = r.subject.toLowerCase();
      const codes = subjByDesc.get(desc) ?? [];
      const subj = codes.find((s) => known.has(`${s} ${r.number}`)) ?? codes[0] ?? null;
      if (!subj) unknownSubjects.add(r.subject);
      atom = {
        kind: 'course',
        code: subj ? `${subj} ${r.number}` : null,
        label: subj ? `${subj} ${r.number}` : `${r.subject} ${r.number}`,
        number: r.number,
        level: r.level,
        grade: r.grade,
        quarter: /quarter/i.test(r.level),
        placeholder: /X/i.test(r.number),
      };
    }
    rowAtoms.push(atom);
    if (atom) {
      atoms.push(atom);
      tokens.push({ t: 'atom', atom });
    }
    for (const _ of r.close.replace(/[^)]/g, '')) tokens.push({ t: ')' });
  });

  // Mixed And/Or at one parenthesis depth with no parentheses to order them.
  let mixedWithoutParens = false;
  let unbalanced = false;
  {
    const stack = [new Set()];
    for (const tk of tokens) {
      if (tk.t === '(') stack.push(new Set());
      else if (tk.t === ')') { if (stack.length > 1) stack.pop(); else unbalanced = true; }
      else if (tk.t === 'op') { stack[stack.length - 1].add(tk.v); if (stack[stack.length - 1].size > 1) mixedWithoutParens = true; }
    }
    if (stack.length !== 1) unbalanced = true;
  }

  let i = 0;
  const peek = () => tokens[i];
  const parseFactor = () => {
    const tk = tokens[i];
    if (!tk) return null;
    if (tk.t === '(') {
      i += 1;
      const e = parseExpr();
      if (tokens[i]?.t === ')') i += 1;
      return e;
    }
    if (tk.t === 'atom') { i += 1; return { op: 'atom', atom: tk.atom }; }
    // A stray ')' or op: skip it rather than loop forever.
    i += 1;
    return parseFactor();
  };
  const parseTerm = () => {
    const kids = [parseFactor()];
    while (peek()?.t === 'op' && peek().v === 'or') { i += 1; kids.push(parseFactor()); }
    const k = kids.filter(Boolean);
    return k.length === 1 ? k[0] : { op: 'or', kids: k };
  };
  function parseExpr() {
    const kids = [parseTerm()];
    while (peek()?.t === 'op' && peek().v === 'and') { i += 1; kids.push(parseTerm()); }
    const k = kids.filter(Boolean);
    return k.length === 1 ? k[0] : { op: 'and', kids: k };
  }
  let node = parseExpr();
  // Trailing tokens after an unbalanced ')': AND whatever follows onto the tree.
  while (i < tokens.length) {
    if (tokens[i].t === 'op') {
      const v = tokens[i].v;
      i += 1;
      const rest = parseExpr();
      if (rest) node = { op: v, kids: [node, rest] };
    } else i += 1;
  }
  return { node, atoms, rowAtoms, unknownSubjects: [...unknownSubjects], mixedWithoutParens, unbalanced };
}

const FALSE = { op: 'false' };

/** Quarter-system courses evaluate false; Or drops them, And with one is false. */
function withoutQuarter(node) {
  if (!node) return FALSE;
  if (node.op === 'atom') return node.atom.kind === 'course' && node.atom.quarter ? FALSE : node;
  const kids = node.kids.map(withoutQuarter);
  if (node.op === 'or') {
    const k = kids.filter((x) => x.op !== 'false');
    return k.length === 0 ? FALSE : k.length === 1 ? k[0] : { op: 'or', kids: k };
  }
  if (kids.some((x) => x.op === 'false')) return FALSE;
  return kids.length === 1 ? kids[0] : { op: 'and', kids };
}

const atomKey = (a) => (a.kind === 'test' ? `T:${a.test}:${a.score}` : `C:${a.label}`);

/** Conjunctive normal form, capped. { clauses: atom[][], complex, quarterDropped, node }. */
/**
 * Dedupe atoms inside each clause, then absorption: a clause that contains
 * every alternative of another clause adds nothing ((A)(A or B) is (A)).
 */
function simplify(clauses) {
  const deduped = clauses.map((c) => {
    const seen = new Set();
    return c.filter((a) => (seen.has(atomKey(a)) ? false : (seen.add(atomKey(a)), true)));
  });
  const keys = deduped.map((c) => new Set(c.map(atomKey)));
  return deduped.filter((c, i) => !keys.some((k, j) => j !== i && k.size <= keys[i].size && [...k].every((x) => keys[i].has(x)) && (k.size < keys[i].size || j < i)));
}

/**
 * Conjunctive normal form. { clauses: atom[][], complex, quarterDropped, node }.
 * Simplified after every product step, so ME 2016's seven "CS 13xx and
 * CS 1171" alternatives collapse to two clauses instead of 2^6 before the cap
 * is looked at.
 */
export function cnfOf(node, cap = 32) {
  const pruned = withoutQuarter(node);
  const hadQuarter = JSON.stringify(node ?? {}).includes('"quarter":true');
  if (pruned.op === 'false') return { clauses: [], complex: false, quarterDropped: hadQuarter, node: pruned };
  let complex = false;
  const go = (n) => {
    if (complex) return [];
    if (n.op === 'atom') return [[n.atom]];
    if (n.op === 'and') return simplify(n.kids.flatMap(go));
    // or: cross product of the kids' clause lists
    let acc = [[]];
    for (const k of n.kids) {
      const kc = go(k);
      const next = [];
      for (const a of acc) for (const b of kc) next.push([...a, ...b]);
      acc = simplify(next);
      if (acc.length > cap) { complex = true; return []; }
    }
    return acc;
  };
  const clauses = simplify(go(pruned));
  if (clauses.length > cap) complex = true;
  return { clauses: complex ? [] : clauses, complex, quarterDropped: hadQuarter && JSON.stringify(pruned).length !== JSON.stringify(node).length, node: pruned };
}

function courseText(a) {
  const label = a.code ?? safeLabel(a.label);
  if (a.placeholder) return `${label} (transfer credit)`;
  if (a.grade && !/^D$/i.test(a.grade)) return `${label} (minimum grade ${safeLabel(a.grade)})`;
  return label;
}

function testsText(tests) {
  const list = tests.map((t) => safeLabel(`${t.test} ${t.score}`.trim())).join(' / ');
  return `a qualifying high school/placement test score (${list})`;
}

function clauseText(clause) {
  const courses = clause.filter((a) => a.kind === 'course').map(courseText);
  const tests = clause.filter((a) => a.kind === 'test');
  const parts = [...courses, ...(tests.length ? [testsText(tests)] : [])];
  return parts.join(' or ');
}

/** Infix rendering for a tree too large for CNF: the parser reads it at low fidelity. */
function infix(node, top = true) {
  if (node.op === 'atom') return node.atom.kind === 'test' ? testsText([node.atom]) : courseText(node.atom);
  if (node.op === 'false') return '';
  const s = node.kids.map((k) => infix(k, false)).filter(Boolean).join(` ${node.op} `);
  return top ? s : `(${s})`;
}

/** The Illinois prose form (see the header). '' when nothing is left. */
export function renderIllinoisProse(cnf) {
  if (cnf.complex) {
    const s = infix(cnf.node);
    return s ? `${s}.` : '';
  }
  const parts = cnf.clauses.map(clauseText).filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : '';
}

/** Georgia Tech's own wording, as OSCAR printed it: "Undergraduate Semester level CS 1331 Minimum Grade of C". */
export function renderGTWording(rows, tree = null) {
  return rows
    .map((r, i) => {
      const op = r.andOr === 'or' || r.andOr === 'and' ? `${r.andOr} ` : '';
      const label = tree?.rowAtoms?.[i]?.label ?? `${r.subject} ${r.number}`;
      const what = r.test
        ? `${r.test} Minimum Score ${r.score}`.trim()
        : !r.subject && !r.number
          ? ''
          : `${r.level} level ${label}${r.grade ? ` Minimum Grade of ${r.grade}` : ''}`;
      return `${op}${r.open}${what}${r.close}`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

// ---------------------------------------------------------------------------
// Self-test: node scripts/gatech/prereq-prose.mjs --selftest
// ---------------------------------------------------------------------------
if (process.argv.includes('--selftest')) {
  const subjByDesc = new Map([['computer science', ['CS']], ['mathematics', ['MATH']]]);
  const known = new Set(['CS 2050', 'CS 2051', 'MATH 2106', 'CS 1332', 'MATH 3012', 'MATH 3022', 'MATH 1113', 'MATH 1499', 'CS 1331', 'CS 1322']);
  const R = (andOr, open, subject, number, grade, close, level = 'Undergraduate Semester', test = '', score = '') => ({ andOr, open, test, score, subject, number, level, grade, close });
  const cases = [
    ['CS 3510', [R('', '(', 'Computer Science', '2050', 'C', ''), R('or', '', 'Computer Science', '2051', 'C', ''), R('or', '', 'Mathematics', '2106', 'C', ')'), R('and', '(', 'Computer Science', '1332', 'C', ''), R('or', '', 'Mathematics', '3012', 'D', ''), R('or', '', 'Mathematics', '3022', 'D', ')')]],
    ['MATH 1551', [R('', '', '', '', '', '', '', 'MATH SECTION SCORE', '660'), R('or', '', '', '', '', '', '', 'ACT Math', '28'), R('or', '', 'Mathematics', '1113', 'C', ''), R('or', '', 'Mathematics', '11X3', 'T', ''), R('or', '', 'Mathematics', '1499', 'C', '')]],
    ['DNF', [R('', '(', 'Computer Science', '1331', 'C', ''), R('and', '', 'Mathematics', '3012', 'D', ')'), R('or', '(', 'Computer Science', '1322', 'C', ''), R('and', '', 'Mathematics', '3022', 'D', ')')]],
    ['quarter', [R('', '', 'Computer Science', '1331', 'C', ''), R('or', '', 'Computer Science', '1502', 'D', '', 'Undergraduate Quarter')]],
  ];
  for (const [name, rows] of cases) {
    const tree = prereqTreeOf(rows, { subjByDesc, known });
    const cnf = cnfOf(tree.node);
    console.log(`${name}:\n  GT:    ${renderGTWording(rows, tree)}\n  prose: ${renderIllinoisProse(cnf)}\n  mixed=${tree.mixedWithoutParens} complex=${cnf.complex} quarterDropped=${cnf.quarterDropped}`);
  }
  console.log(standingSentence([{ heading: 'Must be enrolled in one of the following Classifications', items: ['Junior (JR)', 'Senior (SR)'] }]));
  console.log(standingSentence([{ heading: 'Cannot be enrolled in one of the following Classifications', items: ['Freshman (FR)'] }]));
}

// ---------------------------------------------------------------------------
// Equivalence check: node scripts/gatech/prereq-prose.mjs --verify <prereq cache dir> <subject lookup json>
// For every cached table: the AND-of-ORs must accept exactly the same sets of
// courses and scores as Banner's tree, over 300 random holdings (quarter-system
// courses never held). Proves the distribution step, not Banner's precedence.
// ---------------------------------------------------------------------------
if (process.argv.includes('--verify')) {
  const { readdirSync, readFileSync } = await import('node:fs');
  const at = process.argv.indexOf('--verify');
  const dir = process.argv[at + 1];
  const subj = JSON.parse(readFileSync(process.argv[at + 2], 'utf8'));
  const subjByDesc = new Map();
  for (const s of subj) {
    const d = ent(s.description).trim().toLowerCase();
    if (!subjByDesc.has(d)) subjByDesc.set(d, []);
    subjByDesc.get(d).push(s.code);
  }
  const evalTree = (n, has) => (n.op === 'atom' ? has(n.atom) : n.op === 'false' ? false : n.op === 'and' ? n.kids.every((k) => evalTree(k, has)) : n.kids.some((k) => evalTree(k, has)));
  let tables = 0, bad = 0, complex = 0;
  for (const f of readdirSync(dir)) {
    const rows = parsePrereqTable(readFileSync(`${dir}/${f}`, 'utf8')).rows;
    if (!rows.length) continue;
    tables += 1;
    const tree = prereqTreeOf(rows, { subjByDesc, known: new Set() });
    const cnf = cnfOf(tree.node);
    if (cnf.complex) { complex += 1; continue; }
    const keys = [...new Set(tree.atoms.map(atomKey))];
    let ok = true;
    for (let t = 0; t < 300 && ok; t += 1) {
      const p = t < 2 ? t : Math.random();
      const held = new Set(keys.filter(() => Math.random() < p));
      const has = (a) => !(a.kind === 'course' && a.quarter) && held.has(atomKey(a));
      const want = evalTree(tree.node, has);
      const got = cnf.clauses.every((cl) => cl.some(has));
      if (want !== got) ok = false;
    }
    if (!ok) { bad += 1; console.log(`  NOT EQUIVALENT: ${f}`); }
  }
  console.log(`verify: ${tables} tables, ${bad} where the AND-of-ORs differs from Banner's tree, ${complex} too large for CNF`);
}
