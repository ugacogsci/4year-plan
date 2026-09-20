#!/usr/bin/env node
/**
 * UGA's published credit-from-testing tables.
 *
 * A four-year plan starts from what a student already has, and for a huge
 * share of them that is not a transcript from UGA. It is AP scores from high
 * school, an IB diploma, dual enrollment, or transfer work. Asking "what are
 * you studying" and then planning from zero credits produces a plan that is
 * wrong for a second-year transfer on day one.
 *
 * UGA publishes the exam equivalences as plain HTML tables:
 *   reg.uga.edu/student-records/credit-from-testing/uga-ap-credit-equivalences
 *   .../ib-equivalences
 *   .../cambridge-a-level-aice-credit-equivalences
 *   .../sat-subject-test-equivalences
 *
 * Each exam is a heading followed by a score/credit table:
 *   AP Score | Credit Earned
 *   4        | ARHI 2300 (3 credit hours)
 *
 * This turns them into { exam, score, courses[], credits } so onboarding can
 * ask "which AP exams did you take" and convert the answer into real course
 * credit instead of a guess.
 *
 *   node scripts/credit-from-testing.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public");
const OUT = join(OUT_DIR, "uga-exam-credit.json");
const UA = "TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)";

const SOURCES = [
  { kind: "AP", url: "https://reg.uga.edu/student-records/credit-from-testing/uga-ap-credit-equivalences/" },
  { kind: "IB", url: "https://reg.uga.edu/student-records/credit-from-testing/ib-equivalences/" },
  { kind: "AICE", url: "https://reg.uga.edu/student-records/credit-from-testing/cambridge-a-level-aice-credit-equivalences/" },
  { kind: "SAT Subject", url: "https://reg.uga.edu/student-records/credit-from-testing/sat-subject-test-equivalences/" },
];

const strip = (h) => h.replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

/**
 * "MATH 1101 (0 credit hours), MATH 1113 (0 credit hours), and MATH 2250
 * (4 credit hours)" -> three courses, 4 hours total.
 *
 * Each course carries its OWN hour count and they must be paired, not
 * summarised. Taking the first number said AP Calculus AB was worth 0 hours.
 *
 * A 0-hour course is not a mistake in the source: it means the exam exempts
 * you from that course without granting credit toward the 120. A planner has
 * to treat those differently, so they are kept and flagged rather than
 * dropped.
 */
function parseCredit(text) {
  // Courses and hour markers both appear in order. An hours figure applies to
  // every course since the previous figure, which is the only reading that
  // handles both shapes the registrar uses:
  //   "BIOL 1107, BIOL 1107L (4 credit hours)"        -> both share 4
  //   "MATH 1101 (0 ...), and MATH 2250 (4 ...)"      -> each has its own
  const courses = [...text.matchAll(/\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\b/g)]
    .map((m) => ({ code: `${m[1].toUpperCase()} ${m[2]}`, at: m.index ?? 0 }));
  const marks = [...text.matchAll(/\((\d+)\s*credit hours?\)/gi)]
    .map((m) => ({ hours: Number(m[1]), at: m.index ?? 0 }));

  const granted = [];
  const exempt = [];
  let cursor = 0;
  for (const c of courses) {
    const mark = marks.find((m) => m.at > c.at && m.at >= cursor);
    const hours = mark ? mark.hours : null;
    if (hours === 0) exempt.push(c.code);
    else granted.push({ code: c.code, hours, group: mark?.at ?? -1 });
  }
  void cursor;

  // Hours belong to the GROUP, not to each course in it, so count each
  // marker once. Double counting would have claimed AP Biology is worth 8.
  const counted = new Set();
  let credits = 0;
  for (const g of granted) {
    if (g.hours === null) continue;
    if (counted.has(g.group)) continue;
    counted.add(g.group);
    credits += g.hours;
  }

  return {
    courses: granted.map((g) => g.code),
    exemptOnly: exempt,
    credits,
    noCredit: /no credit/i.test(text) && !granted.length,
  };
}

const run = async () => {
  const entries = [];
  for (const src of SOURCES) {
    process.stdout.write(`\n${src.kind} … `);
    let html;
    try {
      const res = await fetch(src.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) { console.log(`FAILED ${e.message}`); continue; }

    // The exam name is a heading INSIDE its own table, not before it: the
    // Art History table starts at byte 78652 and its <h4> sits at 78690.
    // Pairing on "nearest preceding heading" shifted every exam by one and
    // cheerfully reported that AP Calculus BC earns you Music Theory credit.
    let found = 0;
    for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      const table = t[0];
      const inside = table.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
      const caption = table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
      const heading = strip((inside?.[1] ?? caption?.[1] ?? ""));

      for (const r of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
        if (cells.length < 2) continue;

        // AP is a bare "4". IB writes "HL 5" and "SL 4". AICE uses letters.
        const m = cells[0].match(/^(HL|SL)?\s*(\d+(?:\.\d+)?|[A-E])$/i);
        if (!m) continue;                                  // header row
        const level = m[1] ? m[1].toUpperCase() : null;
        const scoreRaw = m[2];
        const score = /^\d/.test(scoreRaw) ? Number(scoreRaw) : scoreRaw.toUpperCase();

        const { courses, exemptOnly, credits, noCredit } = parseCredit(cells[1]);
        entries.push({ kind: src.kind, exam: heading, level, score, courses, exemptOnly, credits, noCredit, raw: cells[1] });
        found++;
      }
    }
    process.stdout.write(`${found} score rows`);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const exams = [...new Set(entries.map((e) => `${e.kind}|${e.exam}`))].length;
  writeFileSync(OUT, JSON.stringify({
    source: "reg.uga.edu/student-records/credit-from-testing",
    fetchedAt: new Date().toISOString(),
    entries,
  }));
  console.log(`\n\n  ${entries.length} score rows across ${exams} exams -> ${OUT}`);
  const granting = entries.filter((e) => e.courses.length);
  console.log(`  rows that grant real course credit: ${granting.length}`);
};

run().catch((e) => { console.error(e); process.exit(1); });
