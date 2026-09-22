/**
 * What Illinois grants for an AP or IB exam, from the registrar's own table.
 *
 * The onboarding step asks "Did you take any AP or IB exams?" and, for Illinois,
 * could never answer: the school had no exam table, so the search box accepted
 * typing and returned nothing every time, forever. That is worse than no box.
 *
 * The table exists and is published as a CSV. The Center for Innovation in
 * Teaching and Learning runs the cutoff browser at
 * citl.illinois.edu/current-cutoff-scores, and that page is a static widget
 * over
 *
 *   themes/custom/citl/PnPCutoffs/TestBasedCredit2026.csv
 *
 * which is the file the widget itself names in its own script.js. One request,
 * no HTML parsing, and the columns are the registrar's:
 *
 *   Exam Type, Level, Test Name, Score, Course Credit, Credit Earned,
 *   Placement Message, Gen Ed Fulfillment
 *
 * 2026 is the file for students entering Summer 2026, Fall 2026 or Spring 2027,
 * which is the term this planner plans. Illinois reviews the policy every year
 * and publishes each year separately, so the year is written into the output
 * and shown to the student rather than left implicit.
 *
 * ACT and SAT rows are in the same CSV and are skipped here, because the step
 * that consumes this asks about AP and IB only and a table that answered a
 * question the screen never asked would be credit nobody entered.
 *
 * Nothing is rewritten. Exam names keep the registrar's spelling, including
 * "CHINESE B - MADARIN", because a name this planner invented would not match
 * what the student is holding in their hand.
 *
 * Output: public/illinois-exam-credit.json
 */
import { writeFileSync } from 'node:fs';

const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
const PAGE = 'https://citl.illinois.edu/current-cutoff-scores';
const CSV = 'https://citl.illinois.edu/themes/custom/citl/PnPCutoffs/TestBasedCredit2026.csv';
/** The entering terms Illinois says this file covers, printed on the cutoff page. */
const POLICY = 'Summer 2026, Fall 2026 or Spring 2027';
const KINDS = new Set(['AP', 'IB']);

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * A CSV row reader that respects quotes.
 *
 * Placement messages contain commas and the occasional quoted phrase, so
 * splitting on "," drops half a sentence and shifts every column after it.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/**
 * The scores one row covers, as separate entries.
 *
 * Illinois writes a row's scores six different ways: "5", "4, 5", "4 OR 5",
 * "6,7", "4, 5, 6, 7" and, for the ACT rows this script skips, "20-34". Each
 * score becomes its own entry so the student picks the score they got rather
 * than a range they have to interpret. A cell that is not a list of whole
 * numbers is kept verbatim as a single entry, because a sentence like "3 with a
 * subscore of 0/no subscore or 1, 2, or 3" is a condition, not a number, and
 * splitting it on its commas would invent four scores Illinois never named.
 */
function scoresIn(cell) {
  const raw = cell.trim();
  if (!raw) return [];
  const parts = raw.split(/\s*(?:,|\bor\b|\bOR\b)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => /^\d{1,2}$/.test(p))) {
    return [...new Set(parts.map(Number))];
  }
  return [raw];
}

/**
 * Hours earned, from a cell that sometimes shows its working.
 *
 * "3" is most of them. "3 + 3 = 6" is a row that grants two courses and states
 * the total. "5 + 3" is the same shape with the total left off. Reading the
 * first number in either of those would halve the credit a student walks in
 * with, so the sum is taken and the stated total wins when there is one.
 */
function hoursIn(cell) {
  const raw = cell.trim();
  if (!raw) return 0;
  const stated = raw.match(/=\s*(\d+(?:\.\d+)?)\s*$/);
  if (stated) return Number(stated[1]);
  const addends = raw.match(/\d+(?:\.\d+)?/g);
  if (!addends) return 0;
  if (raw.includes('+')) {
    // "5 + 3 + 8" is the registrar showing the total without the equals sign.
    // Summing all three gave Calculus BC sixteen hours; the last number is the
    // sum of the others, so it is the total.
    const numbers = addends.map(Number);
    const last = numbers[numbers.length - 1];
    const rest = numbers.slice(0, -1).reduce((sum, n) => sum + n, 0);
    if (numbers.length >= 3 && last === rest) return last;
    return numbers.reduce((sum, n) => sum + n, 0);
  }
  return Number(addends[0]);
}

/** A code with its subject, "MATH 231", or the elective form "HIST 1--". */
const FULL_CODE = /^([A-Z]{2,5})\s?(\d{3}|\d-{2})$/;
/** The registrar's shorthand for "another course in the subject I just named". */
const BARE_NUMBER = /^(\d{3}|\d-{2})$/;

/**
 * The courses a row grants.
 *
 * Three shapes, and the second is the one that has to be got right. "MATH 181,
 * STAT 100" is two courses named in full. "ARAB 201, 202" is also two courses,
 * with the subject stated once and carried, and reading the second half as a
 * course called "202" loses a student three hours of credit they earned. A
 * semicolon starts a new subject: "IB 150, 151; MCB 150, 151" is four courses
 * in two departments.
 *
 * "HIST 1--" is the third shape, the registrar's notation for elective credit
 * in a subject where the campus has no equivalent course. It is kept exactly as
 * written: the hours are real, the course is not, and inventing a code for it
 * would put a class on a student's board that Illinois does not teach.
 *
 * Anything that is not one of the three, such as "Only available on request",
 * grants no course here. The cell is still carried verbatim in `raw`.
 */
function coursesIn(cell) {
  // "CHEM 102 & 104 LECTURE ONLY" is two courses joined with an ampersand and
  // a note about which part of them is granted. Read literally it was no
  // course at all, and AP Chemistry at a 5 came out as six hours of nothing.
  cell = String(cell ?? '').replace(/\bLECTURE ONLY\b/gi, ' ').replace(/&/g, ',');
  const raw = cell.trim();
  if (!raw || /^none$/i.test(raw)) return [];
  const out = [];
  for (const segment of raw.split(';')) {
    let subject = null;
    for (const piece of segment.split(/\s*(?:,|\band\b)\s*/)) {
      const part = piece.replace(/\s+/g, ' ').trim();
      if (!part) continue;
      const full = part.match(FULL_CODE);
      if (full) {
        // The registrar types some codes without the space, "MATH231" for
        // MATH 231. Spacing is the only thing changed here.
        subject = full[1];
        out.push(`${full[1]} ${full[2]}`);
        continue;
      }
      const bare = part.match(BARE_NUMBER);
      if (bare && subject) out.push(`${subject} ${bare[1]}`);
    }
  }
  return [...new Set(out)];
}

const csv = await get(CSV);
if (!csv) {
  console.error(`${CSV} did not load. Nothing written.`);
  process.exit(1);
}

const rows = parseCsv(csv);
const header = rows[0].map((h) => h.trim());
const need = ['Exam Type', 'Level', 'Test Name', 'Score', 'Course Credit', 'Credit Earned'];
const missing = need.filter((h) => !header.includes(h));
if (missing.length > 0) {
  // The CSV is a file Illinois maintains for its own widget and can be
  // restructured without notice. Writing a table off renamed columns would
  // silently tell students they have credit they do not have.
  console.error(`Columns changed. Missing: ${missing.join(', ')}. Nothing written.`);
  process.exit(1);
}
const at = Object.fromEntries(header.map((h, i) => [h, i]));

const entries = [];
let skipped = 0;
for (const row of rows.slice(1)) {
  const kind = (row[at['Exam Type']] ?? '').trim().toUpperCase();
  if (!KINDS.has(kind)) { skipped += 1; continue; }
  const exam = (row[at['Test Name']] ?? '').replace(/\s+/g, ' ').trim();
  if (!exam) continue;
  const level = (row[at['Level']] ?? '').trim() || null;
  const courses = coursesIn(row[at['Course Credit']] ?? '');
  const credits = hoursIn(row[at['Credit Earned']] ?? '');
  const genEd = (row[at['Gen Ed Fulfillment']] ?? '').replace(/\s+/g, ' ').trim();
  const message = (row[at['Placement Message']] ?? '').replace(/\s+/g, ' ').trim();
  const raw = [
    courses.length > 0 ? `${courses.join(', ')}, ${credits} ${credits === 1 ? 'hour' : 'hours'}` : 'No credit',
    genEd ? `Gen Ed: ${genEd}` : '',
    message,
  ].filter(Boolean).join('. ');

  for (const score of scoresIn(row[at['Score']] ?? '')) {
    entries.push({
      kind,
      exam,
      level,
      score,
      courses,
      // Illinois grants hours or it does not. There is no "exempt but no
      // credit" column in this table, which is UGA's shape, so this stays
      // empty rather than guessing which grants are placement only.
      exemptOnly: [],
      credits,
      noCredit: credits === 0,
      raw,
    });
  }
}

entries.sort((a, b) =>
  a.kind.localeCompare(b.kind) ||
  a.exam.localeCompare(b.exam) ||
  String(a.level ?? '').localeCompare(String(b.level ?? '')) ||
  String(a.score).localeCompare(String(b.score), undefined, { numeric: true }),
);

const out = {
  school: 'illinois',
  source: PAGE,
  sourceFile: CSV,
  /** Said out loud in the product, because Illinois publishes one table per year. */
  policy: `These are the credit policies for students entering Illinois in ${POLICY}.`,
  fetchedAt: new Date().toISOString(),
  entries,
};

writeFileSync(new URL('../../public/illinois-exam-credit.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);

const exams = new Set(entries.map((e) => `${e.kind}|${e.exam}`));
const ap = [...exams].filter((k) => k.startsWith('AP|')).length;
console.log(`public/illinois-exam-credit.json`);
console.log(`  ${entries.length} score rows over ${exams.size} exams, ${ap} AP and ${exams.size - ap} IB`);
console.log(`  ${entries.filter((e) => e.noCredit).length} of those grant no credit`);
console.log(`  skipped ${skipped} ACT and SAT rows, which this step does not ask about`);
console.log(`  ${out.policy}`);
