/**
 * Can UGA's answer for a course at one school stand in for the same course
 * number at a sister school that shares its numbering? Measured, not assumed.
 *
 *   node scripts/dev/transfer-holdout.mjs [--report <file.md>] [--json <file.json>]
 *
 * Leave one school out: for every school in a group that shares one course
 * numbering (scripts/data/uga-transfer-groups.json), its own UGA list is
 * hidden and each of its rows is predicted from the lists of its sisters in
 * the group (the same course code), under several rules. The prediction is
 * then scored against UGA's real answer for the hidden school. A group that
 * does not share numbering ("unrelated schools") is run the same way as a
 * control, so the numbers say how much of the agreement is the shared
 * numbering and how much is just common course codes.
 *
 * Rules: how many sisters must answer (1, 2 or 3), whether they must all
 * agree (unanimous) or most of them (majority), and what must match: the
 * whole result set ("ENGL 1101" alone, or "BIOL 1107 + BIOL 1107L") or only
 * the main result (the first UGA course, else the first elective, else
 * "NTFR"). Today's simple same-code rule (a sending ENGL1101 is UGA's ENGL
 * 1101 when UGA's catalog has that course) is scored beside them.
 *
 * Membership is by name, never by state alone: a list joins a group only when
 * its name (the index name or the name the portal prints, abbreviations
 * spelled out) is a member's name, alias or former name and its state is the
 * member's state. The script reads whatever lists are present, so it can be
 * run again as lists are added; a file that cannot be read is skipped and
 * named.
 *
 * Learning-support courses (numbers starting with 0) are not scored: the
 * planner turns them off before it would borrow anything.
 *
 * Pass marks (owner's rule: no guessing, it either counts or it does not):
 * counting a specific UGA course needs 95% exact-set accuracy over at least
 * 30 predictions from at least 3 held-out schools, and the accuracy's 95%
 * confidence floor (Wilson) no more than 3 points under the mark, so a group
 * with a few lucky predictions does not pass. "Does not transfer" needs 98%
 * on the same terms. Elective credit is reported against 95% too. The
 * lowest single school is shown beside each result: one school's own
 * exceptions (an accreditation rule, an older evaluation) are what the label
 * on a borrowed answer warns about, so they are reported, not hidden in the
 * average.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'public', 'uga-transfer');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const REPORT = arg('--report');
const JSON_OUT = arg('--json');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const groupsDoc = read(join(ROOT, 'scripts', 'data', 'uga-transfer-groups.json'));
const index = read(join(DIR, 'index.json'));
const ugaCatalog = (() => {
  const u = read(join(ROOT, 'public', 'uga-catalog.json'));
  return new Set((Array.isArray(u) ? u : u.courses).filter((c) => typeof c?.code === 'string').map((c) => c.code.toUpperCase().replace(/\s+/g, ' ').trim()));
})();

// The portal prints shortened names ("Central Piedmont Cmty Coll"); the same
// spelling-out is applied to both sides, so a member's name and the portal's
// name compare word for word.
const ABBR = { cmty: 'community', cc: 'community college', coll: 'college', colg: 'college', colleg: 'college', cl: 'college', tech: 'technical', techl: 'technical', univ: 'university', u: 'university', st: 'state', inst: 'institute', mtn: 'mountain', ft: 'fort', spgs: 'springs', and: 'and' };
export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[.,'’]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w)
    .join(' ')
    .replace(/^the /, '')
    .replace(/ (main|all campuses|main campus)$/, '')
    .trim();
}

function memberNames(m) {
  return [m.name, ...(m.aliases ?? []), ...(m.formerly ?? [])].map(normName);
}

/** The listed schools, each with its state, file and the group it belongs to (by name and state). */
export function loadSchools() {
  const skipped = [];
  const out = [];
  for (const entry of index.schools) {
    let file;
    try { file = read(join(DIR, `${entry.key}.json`)); } catch (e) { skipped.push(`${entry.key} (${e.message.split('\n')[0]})`); continue; }
    const listed = String(file.listedAs ?? '');
    const state = listed.match(/,\s*([A-Z]{2})\s*$/)?.[1] ?? null;
    const printed = listed.replace(/\s+in\s+[^,]+,\s*[A-Z]{2}\s*$/, '');
    const names = [...new Set([entry.name, file.school, printed].filter(Boolean).map(normName))];
    const hits = [];
    for (const [gid, g] of Object.entries(groupsDoc.groups)) {
      for (const m of g.members) {
        if (m.state !== state) continue;
        const own = memberNames(m);
        const nots = (m.not ?? []).map(normName);
        if (names.some((n) => nots.some((w) => n.includes(w)))) continue;
        if (names.some((n) => own.includes(n))) hits.push({ gid, member: m });
      }
    }
    // Two groups claiming one list would mean a member list is wrong: the
    // list is left out of every group rather than lent to either.
    const gids = [...new Set(hits.map((h) => h.gid))];
    out.push({ key: entry.key, name: entry.name, system: entry.system, state, file, group: gids.length === 1 ? gids[0] : null, member: gids.length === 1 ? hits[0].member : null, conflict: gids.length > 1 ? gids : null });
  }
  return { schools: out, skipped };
}

// The portal now and then prints "NTFR 1TXX"; the planner reads any result
// that starts with NTFR as no credit (transfer-official.ts ugaDesignation), so
// the test does too.
const isNtfr = (r) => /^NTFR\b/.test(r);
const isCourse = (r) => /^[A-Z]{2,5} \d{4}[A-Z]?$/.test(r);
const kindOfSet = (rs) => (rs.some(isCourse) ? 'course' : rs.some((r) => !isNtfr(r)) ? 'elective' : 'ntfr');
const mainOf = (rs) => rs.find(isCourse) ?? rs.find((r) => !isNtfr(r)) ?? 'NTFR';
const setOf = (rs) => [...new Set(rs.map((r) => (isNtfr(r) ? 'NTFR' : r)))].sort().join(' + ');
const levelOf = (code) => Number(code.match(/\d/)?.[0] ?? NaN);
/**
 * A learning-support course: its number starts with 0 (ENGL 0999, MATH 0997).
 * The planner turns these off before it asks the sisters anything
 * (transcript.ts isDevelopmental), so the borrowing never decides them and
 * they are left out of the score: counted in, UGA's near-certain "no credit"
 * for them made the University System's "does not transfer" rule look
 * measured when only 6 of its 92 predictions were college courses.
 */
export const isLearningSupport = (code) => Number(code.match(/(\d{3,4})[A-Z]{0,2}$/)?.[1]?.[0] ?? NaN) === 0;

const RULES = [];
for (const compare of ['exact', 'main']) for (const agree of ['unanimous', 'majority']) for (const k of [1, 2, 3, 5]) RULES.push({ id: `${compare}/${agree}/${k}+`, compare, agree, k });

function wilsonLow(ok, n) {
  if (!n) return 0;
  const z = 1.96, p = ok / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

/** Every rule run on one group: each member's list hidden in turn and predicted from the others. */
function runGroup(members, rowFilter = () => true) {
  const answer = (rs, compare) => (compare === 'exact' ? setOf(rs) : mainOf(rs));
  const res = {};
  for (const rule of RULES) res[rule.id] = { rule, rows: 0, answered: 0, actual: { course: 0, elective: 0, ntfr: 0 }, answeredByActual: { course: 0, elective: 0, ntfr: 0 }, pred: { course: [0, 0], elective: [0, 0], ntfr: [0, 0] }, courseToNtfr: 0, ntfrToCredit: 0, perSchool: {} };
  const same = { rows: 0, applies: 0, exact: 0, contains: 0, ntfrActual: 0, perSchool: {} };
  for (const hidden of members) {
    const sisters = members.filter((s) => s !== hidden);
    for (const [code, results] of Object.entries(hidden.file.courses)) {
      if (!results?.length || isLearningSupport(code) || !rowFilter(code)) continue;
      const kind = kindOfSet(results);
      // Today's same-code rule: the sending code is a UGA catalog course.
      const m = code.match(/^([A-Z]{3,4})(\d{4})([A-Z]?)$/);
      const sameCode = m ? `${m[1]} ${m[2]}${m[3]}` : null;
      same.rows++;
      if (sameCode && ugaCatalog.has(sameCode)) {
        same.applies++;
        const ok = setOf(results) === sameCode;
        if (ok) same.exact++;
        if (results.includes(sameCode)) same.contains++;
        if (kind === 'ntfr') same.ntfrActual++;
        const ps = (same.perSchool[hidden.key] ??= [0, 0]);
        ps[0] += ok ? 1 : 0; ps[1]++;
      }
      const votes = sisters.map((s) => s.file.courses[code]).filter((r) => r?.length);
      for (const rule of RULES) {
        const r = res[rule.id];
        r.rows++;
        r.actual[kind]++;
        if (votes.length < rule.k) continue;
        const tally = new Map();
        for (const v of votes) { const a = answer(v, rule.compare); tally.set(a, (tally.get(a) ?? 0) + 1); }
        const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        const ok = rule.agree === 'unanimous' ? n === votes.length : n > votes.length / 2 && n >= rule.k;
        if (!ok) continue;
        // The kind of credit the prediction would grant, from one sister's full answer that voted for it.
        const voter = votes.find((v) => answer(v, rule.compare) === top);
        const pk = kindOfSet(voter);
        const right = answer(results, rule.compare) === top;
        r.answered++;
        r.answeredByActual[kind]++;
        r.pred[pk][0] += right ? 1 : 0;
        r.pred[pk][1]++;
        if (pk === 'course' && kind === 'ntfr') r.courseToNtfr++;
        if (pk === 'ntfr' && kind !== 'ntfr') r.ntfrToCredit++;
        const ps = (r.perSchool[hidden.key] ??= { course: [0, 0], ntfr: [0, 0], elective: [0, 0] });
        ps[pk][0] += right ? 1 : 0; ps[pk][1]++;
      }
    }
  }
  return { res, same };
}

const PASS = { course: 0.95, elective: 0.95, ntfr: 0.98 };
function verdict(r, kind, schoolsInGroup) {
  const [ok, n] = r.pred[kind];
  const schools = Object.values(r.perSchool).filter((p) => p[kind][1] > 0);
  const judged = schools.filter((p) => p[kind][1] >= 10);
  const worst = judged.length ? Math.min(...judged.map((p) => p[kind][0] / p[kind][1])) : null;
  const acc = n ? ok / n : 0;
  const low = wilsonLow(ok, n);
  const pass = n >= 30 && schools.length >= 3 && schoolsInGroup >= 3 && acc >= PASS[kind] && low >= PASS[kind] - 0.03;
  return { ok, n, acc, low, schools: schools.length, worst, pass };
}

const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`);

/** Every group's test on the lists present, as the JSON the report is written from (also read by scripts/data/uga-transfer-sisters.mjs). */
export function measure() {
  const { schools, skipped } = loadSchools();
  const byGroup = {};
  for (const s of schools) if (s.group) (byGroup[s.group] ??= []).push(s);
  const tests = [];
  for (const [gid, g] of Object.entries(groupsDoc.groups)) {
    const members = byGroup[gid] ?? [];
    tests.push({ id: gid, label: g.label, members });
    if (gid === 'usg') tests.push({ id: 'usg-core', label: 'University System of Georgia, 1000-2999 courses only', members, filter: (c) => [1, 2].includes(levelOf(c)) });
  }
  // Florida's colleges and universities share one statewide numbering, so
  // they are also tested as one group, to show whether lending across the
  // two is safe.
  tests.push({ id: 'fl-public', label: 'Florida colleges and universities together', members: [...(byGroup['fl-college'] ?? []), ...(byGroup['fl-university'] ?? [])] });
  // The control: every listed school in no numbering group (private and
  // out-of-state universities), lent to one another as if they shared numbers.
  tests.push({ id: 'control', label: 'Unrelated schools (control: no shared numbering)', members: schools.filter((s) => !s.group && !s.conflict) });

  const out = { ranAt: new Date().toISOString(), lists: schools.length, skipped, conflicts: schools.filter((s) => s.conflict).map((s) => ({ key: s.key, name: s.name, groups: s.conflict })), groups: {} };
  for (const t of tests) {
    const { res, same } = runGroup(t.members, t.filter);
    const rules = {};
    for (const [id, r] of Object.entries(res)) {
      rules[id] = {
        rows: r.rows,
        answered: r.answered,
        coverage: r.rows ? r.answered / r.rows : 0,
        coverageByActual: Object.fromEntries(Object.entries(r.actual).map(([k, n]) => [k, n ? r.answeredByActual[k] / n : null])),
        course: verdict(r, 'course', t.members.length),
        elective: verdict(r, 'elective', t.members.length),
        ntfr: verdict(r, 'ntfr', t.members.length),
        courseToNtfr: r.courseToNtfr,
        ntfrToCredit: r.ntfrToCredit,
        actual: r.actual,
      };
    }
    const sameSchools = Object.values(same.perSchool).filter((p) => p[1] >= 10);
    out.groups[t.id] = {
      label: t.label,
      members: t.members.map((s) => `${s.name} (${s.key})`),
      rules,
      sameCode: { rows: same.rows, applies: same.applies, coverage: same.rows ? same.applies / same.rows : 0, exact: same.applies ? same.exact / same.applies : null, contains: same.applies ? same.contains / same.applies : null, actuallyNtfr: same.ntfrActual, worstSchool: sameSchools.length ? Math.min(...sameSchools.map((p) => p[0] / p[1])) : null },
    };
  }
  return out;
}

function main() {
  const out = measure();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  const md = report(out);
  if (REPORT) writeFileSync(REPORT, md);
  else process.stdout.write(md);
}

function report(out) {
  const L = [];
  L.push('# Leave-one-school-out test: can a sister school\'s UGA answer stand in?', '');
  L.push(`Run ${out.ranAt.slice(0, 16).replace('T', ' ')} UTC on the ${out.lists} UGA transfer lists present in public/uga-transfer (scripts/dev/transfer-holdout.mjs; groups from scripts/data/uga-transfer-groups.json).`);
  if (out.skipped.length) L.push(`Skipped (could not be read): ${out.skipped.join(', ')}.`);
  if (out.conflicts.length) L.push(`Left out of every group (claimed by two): ${out.conflicts.map((c) => `${c.name} (${c.groups.join(', ')})`).join('; ')}.`);
  L.push('', 'How to read it: each school\'s own list is hidden and every course on it is predicted from its sisters\' lists (same course code). Rows = courses on the hidden lists; coverage = share of them the rule answers; accuracy is against UGA\'s real answer, split by what the prediction would grant: a specific UGA course, elective credit ("TXX"/"GXX"), or no credit ("NTFR"). Rule names: exact|main / unanimous|majority / sisters needed. "exact" must match UGA\'s whole answer (e.g. BIOL 1107 + BIOL 1107L); "main" only its main result. Worst = the lowest accuracy of any one hidden school with 10+ such predictions. course->NTFR = predicted a course where UGA gives no credit (the worst error).', '');
  for (const [gid, g] of Object.entries(out.groups)) {
    L.push(`## ${gid}: ${g.label}`, '');
    L.push(`Lists in the group (${g.members.length}): ${g.members.join(', ') || 'none'}.`, '');
    if (g.members.length < 2) { L.push('Too few lists to test.', ''); continue; }
    L.push('| rule | rows | coverage | course: n / acc / worst | elective: n / acc | NTFR: n / acc / worst | course->NTFR |', '|---|---|---|---|---|---|---|');
    for (const [id, r] of Object.entries(g.rules)) {
      L.push(`| ${id} | ${r.rows} | ${pct(r.coverage)} | ${r.course.n} / ${pct(r.course.acc)} / ${pct(r.course.worst)} | ${r.elective.n} / ${pct(r.elective.acc)} | ${r.ntfr.n} / ${pct(r.ntfr.acc)} / ${pct(r.ntfr.worst)} | ${r.courseToNtfr} |`);
    }
    const s = g.sameCode;
    L.push('', `Today's same-code rule (sending ENGL1101 = UGA ENGL 1101 when UGA's catalog has it): applies to ${s.applies} of ${s.rows} rows (${pct(s.coverage)}); UGA's whole answer is exactly that course ${pct(s.exact)}, includes it ${pct(s.contains)}; ${s.actuallyNtfr} of them are really "no credit"; worst school ${pct(s.worstSchool)}.`, '');
  }
  L.push('## Decision table', '');
  L.push('Pass marks: a specific UGA course needs 95% (exact) and "does not transfer" 98%, each over 30+ predictions from 3+ held-out schools, with the 95% confidence floor no more than 3 points under the mark. Best passing rule = the passing rule with the highest confidence floor (precision first). "floor" = that confidence floor; "worst" = the lowest single hidden school (10+ predictions). Elective credit is shown against 95% for reference.', '');
  L.push('| group | lists | count a course (95%) | rule: n, acc, floor, worst, share of course rows answered | does not transfer (98%) | rule: n, acc, floor, worst | elective (95%) | same-code rule exact |', '|---|---|---|---|---|---|---|---|');
  for (const [gid, g] of Object.entries(out.groups)) {
    // Precision first: of the passing rules, the one whose accuracy has the
    // highest confidence floor, not the one that answers the most.
    const best = (kind) => Object.entries(g.rules).filter(([id, r]) => id.startsWith('exact') && r[kind].pass).sort((a, b) => b[1][kind].low - a[1][kind].low)[0];
    const bc = best('course'), bn = best('ntfr'), be = best('elective');
    const v = (r, kind) => `${r[kind].n}, ${pct(r[kind].acc)}, ${pct(r[kind].low)}, ${pct(r[kind].worst)}`;
    L.push(`| ${gid} | ${g.members.length} | ${bc ? 'PASS' : 'fail'} | ${bc ? `${bc[0]}: ${v(bc[1], 'course')}, ${pct(bc[1].coverageByActual.course)}` : bestTry(g, 'course')} | ${bn ? 'PASS' : 'fail'} | ${bn ? `${bn[0]}: ${v(bn[1], 'ntfr')}` : bestTry(g, 'ntfr')} | ${be ? `PASS ${be[0]} ${pct(be[1].elective.acc)}` : 'fail'} | ${g.members.length > 1 && g.sameCode.applies ? `${pct(g.sameCode.exact)} of ${g.sameCode.applies}` : '-'} |`);
  }
  L.push('');
  return L.join('\n');
}

/** For a failing group: the closest any exact rule came, so the table says by how much it failed. */
function bestTry(g, kind) {
  const tries = Object.entries(g.rules).filter(([id, r]) => id.startsWith('exact') && r[kind].n >= 10).sort((a, b) => b[1][kind].acc - a[1][kind].acc);
  if (!tries.length) return 'too few predictions';
  const [id, r] = tries[0];
  return `best ${id}: ${r[kind].n}, ${pct(r[kind].acc)}, floor ${pct(r[kind].low)}${r[kind].schools < 3 ? `, ${r[kind].schools} school(s)` : ''}${r[kind].worst !== null ? `, worst ${pct(r[kind].worst)}` : ''}`;
}

// Run only when called as a script; the sister-school build imports measure().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
