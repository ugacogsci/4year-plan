/**
 * Builds public/gatech-transfer/ from the raw OSCAR Transfer Articulation pages that
 * scripts/gatech/transfer-crawl.mjs saved in data/gatech-raw/transfer/. No network.
 *
 *   node scripts/gatech/transfer-build.mjs [--now 202608] [--out public/gatech-transfer] [--problems file.json]
 *
 * READS   data/gatech-raw/transfer/_states/<ST>.html.gz   school lists (code, name)
 *         data/gatech-raw/transfer/<code>.html.gz          all-subjects, all-terms report
 *         data/gatech-raw/transfer/<code>.none.json        school with no undergraduate subject
 *         data/gatech-raw/transfer/crawl-log.jsonl         read date of each report
 * WRITES  public/gatech-transfer/index.json and public/gatech-transfer/<code>.json
 *         (shape: scratchpad A2/SHAPE.md; summarised below), and prints a report:
 *         schools and rows per state, flags, and every table row it could not read.
 *
 * One OSCAR report row = one sending class (SUBJ NUM, title, level, minimum grade,
 * effective terms) "=>" one Georgia Tech target; following rows that start with an
 * And/Or connector add more targets, optionally wrapped in "(" ... ")". Targets are
 * kept in page order in `gt`; `opts` lists the alternatives (an OR of AND-groups of
 * indexes into gt) when the row has an Or. Only rows in force at `nowTerm` (to is
 * "The End of Time" or a term at or after nowTerm) are written; rows that start after
 * nowTerm are kept and flagged FUTURE.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const RAW = 'data/gatech-raw/transfer';
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const OUT = opt('out', 'public/gatech-transfer');
const NOW = opt('now', '202608');
const STATE_ORDER = ['GA', 'FL', 'AL', 'SC', 'NC', 'TN', 'IL'];

const SOURCE = 'Georgia Tech OSCAR Transfer Articulation';
const SOURCE_URL = 'https://oscar.gatech.edu/pls/bprod/wwsktrna.P_find_location';

/**
 * Words a transcript prints for a feeder school that OSCAR's short name misses ("Middle
 * Georgia State Univ" never matches "Middle Georgia State University") or that UGA's index
 * keys under another code (Lanier Tech is 130352 there, 007289 here). Written as `match` in
 * index.json (transfer-gatech.ts gatechSchoolEntry) after OSCAR's own name, since match words
 * replace the name there. No short form another school uses: not KSU (Kansas State, Kent
 * State), GSU (Georgia Southern), "Morehouse" (Morehouse School of Medicine), "Emory" (Emory &
 * Henry), "Gordon College" (Massachusetts).
 */
const MATCH = {
  '005251': ['georgia state university', 'perimeter college', 'georgia perimeter'],
  '005497': ['university of north georgia', 'ung'],
  '004796': ['georgia gwinnett college', 'ggc'],
  '005252': ['georgia college and state university', 'gcsu'],
  '005900': ['university of west georgia', 'uwg'],
  '005813': ['university of georgia', 'uga'],
  // 005411's rows start in 2008, before Middle Georgia College and Macon State merged (2013).
  '005411': ['middle georgia state university', 'middle georgia state', 'middle georgia college', 'mga'],
  '005406': ['augusta university', 'augusta state university', 'georgia regents university'],
  '007289': ['lanier technical college', 'lanier technical', 'lanier tech'],
  '007196': ['southern regional technical college', 'southern regional technical', 'southern regional tech'],
  '005160': ['miami dade college', 'miami dade community college'],
  '005110': ['clark atlanta university', 'clark atlanta'],
  '005187': ['emory university', 'emory college'],
  '005725': ['atlanta metropolitan state college', 'atlanta metropolitan', 'atlanta metro'],
};

/**
 * A school whose one row says Georgia Tech reads all its classes under another school's
 * rows ("GPC 1000 See GA State Univ Course Evals => ET DEPT ALL COURSE EVALS UNDER GA ST U"):
 * written as `see`, the code of that school. A school's row that says so but is not listed
 * here is printed in the report.
 */
const SEE = { '005711': '005251', '005273': '005497', Z97111: '005441', '000147': '004172' };
const evalsElsewhere = (rows) => rows.length === 1 && /\bEVALS UNDER\b/i.test([rows[0].title, ...rows[0].gt.map((g) => g.title)].join(' '));

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

const readGz = (p) => gunzipSync(readFileSync(p)).toString('utf8');

const SEASON = { spring: '02', summer: '05', fall: '08', winter: '01' };
/** "Fall 2008" -> "200808"; "The End of Time" -> null; "Prior Term(s)" -> "000000". */
function termCode(t) {
  const s = t.trim();
  if (/^the end of time$/i.test(s)) return null;
  if (/^prior term/i.test(s)) return '000000';
  const m = s.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (!m) return undefined;
  return m[2] + SEASON[m[1].toLowerCase()];
}

function parseCode(text) {
  const m = text.match(/^([A-Z0-9][A-Z0-9&*_]{0,9})\s+([0-9A-Z][0-9A-Z.\-/*]*)$/);
  return m ? { subj: m[1], num: m[2] } : null;
}

const hoursOf = (t) => {
  const s = t.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Cells of one <tr>: [{tag, text, raw}] */
function cellsOf(tr) {
  return [...tr.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), text: decode(m[2]) }));
}

/** GT side: [open, code, title, hours, close] -> target token(s). */
function gtPart(cells) {
  if (cells.length < 4) return null;
  const [open, code, title, hours, close] = cells.length >= 5 ? cells : [{ text: '' }, ...cells];
  const c = parseCode(code.text);
  const h = hoursOf(hours.text);
  if (!c || h === undefined) return null;
  return { open: open.text === '(', close: (close?.text || '') === ')', target: { code: `${c.subj} ${c.num}`, title: title.text, hours: h } };
}

/**
 * Turn targets + connectors (+ parens) into DNF alternatives: [[i, j], [k]] = (i AND j) OR k.
 * And binds tighter than Or; parentheses group.
 */
function alternatives(items) {
  // tokens: '(' ')' 'and' 'or' or a number (index)
  const toks = [];
  items.forEach((it, i) => {
    if (i > 0) toks.push(it.conn);
    if (it.open) toks.push('(');
    toks.push(i);
    if (it.close) toks.push(')');
  });
  let p = 0;
  const balanced = toks.filter((t) => t === '(').length === toks.filter((t) => t === ')').length;
  const work = balanced ? toks : toks.filter((t) => t !== '(' && t !== ')');
  const cross = (a, b) => a.flatMap((x) => b.map((y) => [...x, ...y]));
  function orExpr() {
    let left = andExpr();
    while (work[p] === 'or') { p++; left = [...left, ...andExpr()]; }
    return left;
  }
  function andExpr() {
    let left = atom();
    while (work[p] === 'and') { p++; left = cross(left, atom()); }
    return left;
  }
  function atom() {
    const t = work[p++];
    if (t === '(') { const e = orExpr(); if (work[p] === ')') p++; return e; }
    if (typeof t === 'number') return [[t]];
    throw new Error(`bad token ${t}`);
  }
  const res = orExpr();
  return { opts: res, balanced };
}

const COURSE_IN = /\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\b/;

function flagsFor(row, nowTerm) {
  const f = new Set();
  for (const g of row.gt) {
    const [subj, num] = g.code.split(' ');
    if (subj === 'ET') {
      if (num === 'DEPT') f.add('DEPT');
      else if (num === 'NOGT') f.add('NOGT');
      else if (num === 'LAB') f.add('LAB');
      else f.add('ET_OTHER');
      if (/credit (awarded )?(for \S+ \S+ )?w\//i.test(g.title) || num === 'LAB') {
        f.add('LAB');
        const m = g.title.match(COURSE_IN);
        row.lab = m ? `${m[1]} ${m[2]}` : /lab section/i.test(g.title) ? 'section' : null;
      }
      continue;
    }
    if (/no gt credit/i.test(g.title)) f.add('NO_GT_CREDIT');
    if (/^\dXXX$/.test(num)) f.add(subj === 'FREE' ? 'FREE' : 'ELECTIVE');
    else if (/X/.test(num)) {
      f.add(subj === 'MATH' ? 'TMATH' : 'XNUM');
    }
    if (/wellness requirement/i.test(g.title)) f.add('WELLNESS');
    if (g.hours === null) f.add('NOHOURS');
  }
  if ((row.opts || [row.gt.map((_, i) => i)]).some((o) => o.length > 1)) f.add('SPLIT');
  if (!row.minGrade) f.add('NOGRADE');
  if (row.from && row.from > nowTerm) f.add('FUTURE');
  if (row.to) f.add('ENDS');
  if (row.fromText !== undefined || row.toText !== undefined) f.add('ODD_TERM');
  if (row.oddCode) f.add('ODD_CODE');
  return [...f];
}

/** Parse one report page. Returns { pageName, subjectsEcho, rowsAll, problems } */
function parseReport(html) {
  const problems = [];
  const start = html.search(/CLASS="datadisplaytable"/i);
  if (start < 0) return { rowsAll: [], problems: [], pageName: null, empty: true, note: decode(html.slice(html.search(/pagebodydiv/i), html.search(/pagebodydiv/i) + 3000)).slice(0, 300) };
  const table = html.slice(start, html.indexOf('</table>', start));
  const trs = table.split(/<tr\b[^>]*>/i).slice(1).map((t) => t.split(/<\/tr>/i)[0]);
  const rows = [];
  let pageName = null;
  let cur = null;
  const finish = () => {
    if (!cur) return;
    const items = cur.items;
    cur.row.gt = items.map((i) => i.target);
    const conns = new Set(items.slice(1).map((i) => i.conn));
    cur.row.conn = items.length === 1 ? null : conns.size === 1 ? [...conns][0] : 'mixed';
    if (items.length > 1 && conns.has('or')) {
      try {
        const { opts, balanced } = alternatives(items);
        cur.row.opts = opts;
        if (!balanced) problems.push({ kind: 'unbalanced parens', row: `${cur.row.subj} ${cur.row.num}` });
      } catch (e) {
        problems.push({ kind: 'connector parse', row: `${cur.row.subj} ${cur.row.num}`, error: e.message });
      }
    }
    rows.push(cur.row);
    cur = null;
  };
  for (const tr of trs) {
    const cells = cellsOf(tr);
    if (!cells.length) continue;
    const texts = cells.map((c) => c.text);
    const arrow = texts.indexOf('=>');
    if (cells.every((c) => c.tag === 'th')) {
      if (texts.includes('vs.')) { pageName = texts[0]; continue; }
      if (texts.includes('Effective Terms')) continue;
    }
    if (arrow >= 0) {
      finish();
      if (arrow < 6) { problems.push({ kind: 'short source side', cells: texts.join(' | ') }); continue; }
      // A sending code Banner holds in an odd form ("PHYS)OX 253", "ENVSCI L 1"): keep the row with
      // subj = everything before the last space, num = the last word, flag ODD_CODE.
      let src = parseCode(texts[arrow - 6]);
      const oddCode = !src && /\S\s+\S+$/.test(texts[arrow - 6]);
      if (oddCode) {
        const t = texts[arrow - 6];
        const k = t.lastIndexOf(' ');
        src = { subj: t.slice(0, k).trim(), num: t.slice(k + 1) };
        problems.push({ kind: 'odd sending code (row kept, flag ODD_CODE)', cells: texts.join(' | ') });
      }
      const [fromT, toT] = texts[arrow - 1].split(/\s+-\s+/);
      let from = fromT ? termCode(fromT) : undefined;
      let to = toT !== undefined ? termCode(toT) : undefined;
      const gt = gtPart(cells.slice(arrow + 1));
      if (!src || !gt) {
        problems.push({ kind: !src ? 'source code' : 'gt side', cells: texts.join(' | ') });
        continue;
      }
      // A term name Banner prints that is not "Spring/Summer/Fall YYYY" (e.g. "Language Inst IEP:
      // Spring 2 20"): keep the row, keep the words, flag ODD_TERM. It counts as in force when its
      // end is "The End of Time" or unreadable.
      const odd = {};
      if (from === undefined) { odd.fromText = fromT || texts[arrow - 1]; from = null; }
      if (to === undefined) { odd.toText = toT || ''; to = null; }
      if (odd.fromText !== undefined || odd.toText !== undefined) problems.push({ kind: 'odd term (row kept, flag ODD_TERM)', cells: texts.join(' | ') });
      const lead = texts[arrow - 7];
      cur = {
        row: {
          subj: src.subj,
          num: src.num,
          title: texts[arrow - 5],
          level: texts[arrow - 4],
          minGrade: texts[arrow - 2] || null,
          from,
          to,
          ...odd,
          ...(oddCode ? { oddCode: true } : {}),
        },
        items: [{ ...gt, conn: null }],
      };
      continue;
    }
    const ci = cells.findIndex((c) => c.tag === 'th' && /^(and|or)$/i.test(c.text));
    if (ci >= 0) {
      const gt = gtPart(cells.slice(ci + 1));
      if (!cur || !gt) { problems.push({ kind: cur ? 'continuation gt side' : 'orphan continuation', cells: texts.join(' | ') }); continue; }
      cur.items.push({ ...gt, conn: cells[ci].text.toLowerCase() });
      continue;
    }
    if (texts.every((t) => !t) || texts.some((t) => /All Rights Reserved/i.test(t))) continue;
    problems.push({ kind: 'unknown row', cells: texts.join(' | ') });
  }
  finish();
  return { rowsAll: rows, problems, pageName };
}

function main() {
  const schools = new Map(); // code -> {code,name,state}
  for (const st of STATE_ORDER) {
    const p = join(RAW, '_states', `${st}.html.gz`);
    if (!existsSync(p)) continue;
    const html = readGz(p);
    const m = html.match(/<select name="sbgi_in"[^>]*>([\s\S]*?)<\/select>/i);
    for (const o of m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)) {
      if (!o[1]) continue;
      if (!schools.has(o[1])) schools.set(o[1], { code: o[1], name: decode(o[2]), state: st });
    }
  }
  const readAt = new Map();
  if (existsSync(join(RAW, 'crawl-log.jsonl'))) {
    for (const line of readFileSync(join(RAW, 'crawl-log.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      const e = JSON.parse(line);
      const m = (e.label || '').match(/^classes (\S+)$/);
      if (m && e.status === 200) readAt.set(m[1], e.t.slice(0, 10));
    }
  }

  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const index = [];
  const perState = {};
  const flagCount = {};
  const allProblems = [];
  const fromOdd = new Set();
  let disclaimer = null;
  let policyUrl = null;
  let latest = '';

  for (const s of schools.values()) {
    const st = (perState[s.state] ||= { listed: 0, read: 0, withRows: 0, rows: 0, rowsAllTerms: 0, dept: 0, nogt: 0 });
    st.listed++;
    const rawP = join(RAW, `${s.code}.html.gz`);
    const noneP = join(RAW, `${s.code}.none.json`);
    if (!existsSync(rawP)) {
      if (existsSync(noneP)) {
        st.read++;
        const j = JSON.parse(readFileSync(noneP, 'utf8'));
        index.push({ code: s.code, name: s.name, state: s.state, rows: 0, file: null, note: j.said || 'no undergraduate subjects listed' });
      }
      continue;
    }
    st.read++;
    const html = readGz(rawP);
    if (!disclaimer) {
      const t = decode(html);
      const m = t.match(/DISCLAIMER:([\s\S]*?)Please consult the catalog for additional information\./);
      if (m) disclaimer = `Transfer Articulation is for reference only.${m[1].replace(/^\s*Transfer Articulation is for reference only\./, '')}Please consult the catalog for additional information.`.replace(/\s+/g, ' ').trim();
      // the link's href (transfer-credit-policies), not its printed text (transfer_credit_policies)
      const u = html.match(/href="(https:\/\/registrar\.gatech\.edu\/[^"]+)"/i) || t.match(/https:\/\/registrar\.gatech\.edu\/\S+/);
      if (u) policyUrl = (u[1] || u[0]).replace(/[.,;]+$/, '');
    }
    const { rowsAll, problems, pageName, empty, note } = parseReport(html);
    for (const p of problems) allProblems.push({ school: s.code, name: s.name, ...p });
    const date = readAt.get(s.code) || null;
    if (date && date > latest) latest = date;
    const kept = rowsAll.filter((r) => r.to === null || r.to >= NOW);
    const seen = new Map();
    const rows = kept.map((r) => {
      const flags = flagsFor(r, NOW);
      for (const f of flags) flagCount[f] = (flagCount[f] || 0) + 1;
      let id = `${r.subj} ${r.num}@${r.from ?? 'odd'}`;
      const n = (seen.get(id) || 0) + 1;
      seen.set(id, n);
      if (n > 1) id += `#${n}`;
      const out = { id, subj: r.subj, num: r.num, title: r.title, minGrade: r.minGrade, from: r.from, to: r.to, gt: r.gt, conn: r.conn };
      if (r.opts) out.opts = r.opts;
      if (r.lab !== undefined) out.lab = r.lab;
      if (r.level && r.level !== 'Undergraduate') out.level = r.level;
      if (r.fromText !== undefined) out.fromText = r.fromText;
      if (r.toText !== undefined) out.toText = r.toText;
      out.flags = flags;
      if (flags.includes('DEPT')) st.dept++;
      if (flags.includes('NOGT')) st.nogt++;
      return out;
    });
    st.rows += rows.length;
    st.rowsAllTerms += rowsAll.length;
    if (rows.length) st.withRows++;
    const file = rows.length ? `${s.code}.json` : null;
    if (file) {
      const head = { code: s.code, name: s.name, state: s.state, pageName: pageName && pageName !== s.name ? pageName : undefined, readAt: date, nowTerm: NOW, rowsAllTerms: rowsAll.length };
      const body = rows.map((r) => JSON.stringify(r)).join(',\n');
      writeFileSync(join(OUT, file), JSON.stringify(head).slice(0, -1) + ',"rows":[\n' + body + '\n]}\n');
    }
    const see = evalsElsewhere(rows) ? SEE[s.code] : undefined;
    if (evalsElsewhere(rows) && !see) allProblems.push({ school: s.code, name: s.name, kind: 'evals under another school, not in SEE', row: rows[0].title });
    if (SEE[s.code] && !see) allProblems.push({ school: s.code, name: s.name, kind: 'SEE school no longer says evals under another school', row: rows[0]?.title ?? '' });
    index.push({ code: s.code, name: s.name, state: s.state, rows: rows.length, file, ...(empty ? { note: note || 'no table on page' } : {}), ...(MATCH[s.code] ? { match: [...new Set([s.name.toLowerCase(), ...MATCH[s.code]])] } : {}), ...(see ? { see } : {}) });
  }
  for (const code of [...Object.keys(MATCH), ...Object.values(SEE)]) {
    if (!index.some((e) => e.code === code && e.rows > 0)) allProblems.push({ school: code, name: '', kind: 'MATCH or SEE school has no rows' });
  }

  const statesOut = {};
  for (const st of STATE_ORDER) if (perState[st]) statesOut[st] = perState[st];
  const idx = {
    readAt: latest || null,
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    disclaimer,
    policyUrl,
    nowTerm: NOW,
    note: 'Rows in force at nowTerm only (from/to kept). Undergraduate level. A class missing from a school\'s table is not a rejection: Georgia Tech decides on official evaluation.',
    states: statesOut,
    schools: index.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name)),
  };
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(idx, null, 1) + '\n');

  // report
  console.log(`nowTerm ${NOW}  readAt ${latest}`);
  for (const [st, v] of Object.entries(statesOut)) console.log(`${st}: listed ${v.listed}, read ${v.read}, with rows ${v.withRows}, rows now ${v.rows} (all terms ${v.rowsAllTerms}), DEPT ${v.dept}, NOGT ${v.nogt}`);
  console.log('flags', JSON.stringify(flagCount));
  console.log(`problems: ${allProblems.length}`);
  const byKind = {};
  for (const p of allProblems) (byKind[p.kind] ||= []).push(p);
  for (const [k, list] of Object.entries(byKind)) {
    console.log(`  ${k}: ${list.length}`);
    for (const p of list.slice(0, 8)) console.log(`    ${p.school} ${p.name}: ${p.cells || p.row || ''} ${p.error || ''}`);
  }
  if (args.includes('--problems')) writeFileSync(opt('problems', '/dev/null'), JSON.stringify(allProblems, null, 1));
}

main();
