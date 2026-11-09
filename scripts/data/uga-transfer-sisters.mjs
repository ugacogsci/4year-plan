/**
 * UGA's answers for the same course number at sister schools, for a line its
 * list for the student's own school does not cover.
 *
 *   node scripts/data/uga-transfer-sisters.mjs           (rebuild public/uga-transfer-sisters/)
 *   node scripts/data/uga-transfer-sisters.mjs --dry     (print the counts, write nothing)
 *
 * Schools in one system that shares a course numbering (the University System
 * of Georgia's core, the Technical College System of Georgia's statewide
 * inventory, Florida's statewide numbering at its colleges) teach the same
 * course under the same number, and UGA mostly answers it the same way at
 * each. So when a student's school has no UGA list, or its list has no line
 * for a course, UGA's own published answer for that number at the sister
 * schools is the best evidence there is. The owner's rule ("no guessing: it
 * either counts or it doesn't") allows it only where it was measured:
 * scripts/dev/transfer-holdout.mjs hides each school's list in turn and
 * predicts it from its sisters', and only the groups and rules that reached
 * the pass marks lend (scripts/data/uga-transfer-groups.json, "borrow").
 *
 * This script re-runs that test on the lists present before it writes
 * anything: a rule that no longer passes after new lists arrive is left out
 * and named, rather than trusted because it passed once. It writes
 *   public/uga-transfer-sisters/index.json  how to recognise each group's
 *       schools on a transcript (names, former names, words that rule a
 *       lookalike out, places), for every group, lending or not, so a
 *       lookalike in a group that does not lend is seen and refused;
 *   public/uga-transfer-sisters/<group>.json  one file per lending group:
 *       each course code the rule answers, the answer, and which schools'
 *       lists gave it, so the browser fetches only the group it needs.
 * The folder is beside public/uga-transfer/, not inside it, because several
 * readers load every file in that folder as a school's list.
 *
 * A code is answered only when every sister list that has it gives exactly
 * the same answer (all of its UGA results, not just the first) and at least
 * the rule's number of lists have it. "No credit" (NTFR) has its own, stricter
 * rule, and elective designations ("ACCT 2TXX", "MATH 1GXX") are lent only by
 * a group whose test passed for them (TCSG). Re-runnable: it reads whatever
 * lists are present and replaces the folder's files.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isLearningSupport, loadSchools, measure, normName } from '../dev/transfer-holdout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'uga-transfer-sisters');
const DRY = process.argv.includes('--dry');
const groupsDoc = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'uga-transfer-groups.json'), 'utf8'));

const STATES = { GA: 'georgia', FL: 'florida', SC: 'south carolina', NC: 'north carolina', AL: 'alabama', TN: 'tennessee', VA: 'virginia', MS: 'mississippi', KY: 'kentucky' };
/** How a label names a group's schools: "9 other Georgia technical colleges". */
const NOUN = { usg: 'University System of Georgia schools', tcsg: 'Georgia technical colleges', 'fl-college': 'Florida College System colleges', 'nc-cc': 'North Carolina community colleges', 'tn-cc': 'Tennessee community colleges' };

const isNtfr = (r) => /^NTFR\b/.test(r);
const isCourse = (r) => /^[A-Z]{2,5} \d{4}[A-Z]?$/.test(r);
const kindOf = (rs) => (rs.some(isCourse) ? 'course' : rs.some((r) => !isNtfr(r)) ? 'elective' : 'ntfr');
// The same normalising the hold-out test scored ("NTFR 1TXX" is no credit).
const clean = (rs) => [...new Set(rs.map((r) => (isNtfr(r) ? 'NTFR' : r)))];
const setOf = (rs) => clean(rs).sort().join(' + ');

/** "exact/unanimous/5+" -> 5. Only that kind of rule is built here, so anything else is refused. */
function sistersNeeded(rule) {
  const m = String(rule ?? '').match(/^exact\/unanimous\/(\d+)\+$/);
  if (!m) throw new Error(`Unsupported rule "${rule}": this build implements exact/unanimous/N+ only.`);
  return Number(m[1]);
}

/** The test's verdict today for one group, rule and kind; the hold-out names "no credit" ntfr. */
function stillPasses(results, gid, rule, kind) {
  return results.groups[gid]?.rules?.[rule]?.[kind === 'noCredit' ? 'ntfr' : kind]?.pass === true;
}

/**
 * The recognition index and each lending group's file, built in memory.
 * `hide` leaves schools' lists out (the bench predicts a school from its
 * sisters alone with it); `schools` and `results` can be passed in so a
 * caller that builds many times reads the lists and runs the test once.
 */
export function buildSisters({ schools = loadSchools().schools, results = measure(), hide = new Set() } = {}) {
  const index = { about: '', builtAt: new Date().toISOString(), groups: {} };
  const files = {};
  const lines = [];
  for (const [gid, g] of Object.entries(groupsDoc.groups)) {
    // Recognition data for every group: a group that does not lend still
    // claims its names, so its lookalikes are refused rather than lent to.
    const keyOf = new Map(schools.filter((s) => s.group === gid && s.member).map((s) => [s.member.name, s.key]));
    const members = g.members.map((m) => ({
      names: [...new Set([m.name, ...(m.aliases ?? []), ...(m.formerly ?? [])].map(normName))],
      ...(m.not?.length ? { not: m.not.map(normName) } : {}),
      city: normName(m.city),
      state: m.state,
      ...(STATES[m.state] ? { stateName: STATES[m.state] } : {}),
      ...(m.requirePlace ? { requirePlace: true } : {}),
      ...(m.requirePlace && m.placeNames?.length ? { placeNames: m.placeNames.map(normName) } : {}),
      ...(keyOf.has(m.name) ? { key: keyOf.get(m.name) } : {}),
    }));
    const entry = { label: g.label, noun: NOUN[gid] ?? `${g.label} schools`, file: null, lends: {}, members };
    index.groups[gid] = entry;
    // Both reasons are named when both hold: a group can pass the test on
    // today's lists (NC, Tennessee) and still lend nothing because its
    // roster is unchecked and no rule is recorded for it.
    const why = [!g.verified && "roster not checked against the system's own list", !g.borrow && 'no rule recorded in uga-transfer-groups.json'].filter(Boolean);
    if (why.length) { lines.push(`${gid.padEnd(14)} lends nothing (${why.join('; ')})`); continue; }

    // The rules that passed, each checked again on the lists present.
    const need = {};
    for (const kind of ['course', 'noCredit', 'elective']) {
      const rule = g.borrow[kind]?.rule;
      if (!rule) continue;
      if (!stillPasses(results, gid, rule, kind)) { lines.push(`${gid.padEnd(14)} ${kind}: ${rule} NO LONGER PASSES on the lists present; left out`); continue; }
      need[kind === 'noCredit' ? 'ntfr' : kind] = sistersNeeded(rule);
      entry.lends[kind] = rule;
    }
    if (Object.keys(need).length === 0) continue;

    // The group's lists, as the test grouped them (by name and state). For
    // the two Georgia systems the index's own system must agree too.
    const lists = schools.filter((s) => s.group === gid && !hide.has(s.key) && (gid === 'usg' || gid === 'tcsg' ? s.system === gid : true));
    const dropped = schools.filter((s) => s.group === gid && !hide.has(s.key) && !lists.includes(s));
    const order = lists.map((s) => ({ key: s.key, name: s.name, readAt: s.file.readAt ?? null, source: s.file.source ?? null }));
    const courses = {};
    const count = { course: 0, ntfr: 0, elective: 0 };
    const codes = new Set(lists.flatMap((s) => Object.keys(s.file.courses)));
    for (const code of [...codes].sort()) {
      // The planner turns learning-support lines off before it asks the
      // sisters, and the test did not score them, so none is lent.
      if (isLearningSupport(code)) continue;
      const voters = lists.map((s, i) => [i, s.file.courses[code]]).filter(([, rs]) => rs?.length);
      if (voters.length === 0) continue;
      const sets = new Set(voters.map(([, rs]) => setOf(rs)));
      if (sets.size !== 1) continue;
      const answer = clean(voters[0][1]);
      const kind = kindOf(answer);
      if (!need[kind] || voters.length < need[kind]) continue;
      courses[code] = { r: answer, s: voters.map(([i]) => i) };
      count[kind] += 1;
    }
    entry.file = `${gid}.json`;
    files[entry.file] = {
      group: gid,
      label: g.label,
      about: "UGA's answers for one course code at the group's schools, kept only where every list that has the code gives the same answer and at least the rule's number of lists have it (scripts/data/uga-transfer-sisters.mjs). r = UGA's results; s = the schools (indexes into schools) whose lists gave them.",
      builtAt: index.builtAt,
      rules: entry.lends,
      tested: Object.fromEntries(Object.entries(g.borrow).filter(([k, v]) => entry.lends[k] && v).map(([k, v]) => [k, { n: v.n, accuracy: v.accuracy, floor: v.floor }])),
      schools: order,
      courses,
    };
    lines.push(`${gid.padEnd(14)} ${String(lists.length).padStart(2)} lists | course ${String(count.course).padStart(4)} (${entry.lends.course ?? '-'}) | no credit ${String(count.ntfr).padStart(4)} (${entry.lends.noCredit ?? '-'}) | elective ${String(count.elective).padStart(4)} (${entry.lends.elective ?? '-'})${dropped.length ? ` | left out, system disagrees: ${dropped.map((s) => s.name).join(', ')}` : ''}`);
  }
  index.about = "How to recognise each sending-school group on a transcript, and which groups lend UGA's answer for the same course number at sister schools (scripts/data/uga-transfer-sisters.mjs, from scripts/data/uga-transfer-groups.json). Names are normalised (lower case, abbreviations spelled out). A group whose file is null lends nothing; its names are kept so a lookalike is refused.";
  return { index, files, lines };
}

function main() {
  const { schools, skipped } = loadSchools();
  const { index, files, lines } = buildSisters({ schools });
  console.log(`Sister-school answers from ${schools.length} UGA lists${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}:`);
  for (const l of lines) console.log(`  ${l}`);
  if (DRY) return;
  mkdirSync(OUT, { recursive: true });
  // Replace the folder's files, so a group that stops lending leaves no stale file behind.
  for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(join(OUT, f));
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index) + '\n');
  for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), JSON.stringify(body) + '\n');
  const size = (f) => `${(readFileSync(join(OUT, f)).length / 1024).toFixed(0)} KB`;
  console.log(`Wrote public/uga-transfer-sisters/: index.json ${size('index.json')}, ${Object.keys(files).map((f) => `${f} ${size(f)}`).join(', ')}`);
}

// Run only when called as a script; the bench imports buildSisters().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
