#!/usr/bin/env node
/**
 * Bring TRU's grade pipelines into the planner.
 *
 * "How hard is this class" is a planning input, not trivia: a semester with
 * three sub-2.5 courses in it is the semester a student drops out of. TRU
 * already assembled this for four universities straight from each registrar
 * or institutional-research office, so the planner reads it rather than
 * rebuilding it.
 *
 *   Mizzou    1,781 courses   MU Grade Distribution Application
 *   Texas A&M 2,946 courses   Registrar Grade Distribution Reports
 *   Illinois  2,968 courses   DAIR grade dashboard
 *   Virginia Tech 11,510      University DataCommons
 *
 * UGA is deliberately absent. Its Grade Distribution Report exists but lives
 * in a Power BI workspace behind a UGA login, so there is nothing to import
 * and the planner says so rather than inventing difficulty.
 *
 *   node scripts/import-tru-grades.mjs [--tru /path/to/zou]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public");
const argIdx = process.argv.indexOf("--tru");
const TRU = argIdx > -1 ? process.argv[argIdx + 1] : "/Users/michaelcrews/THE ADVISOR/zou";

const SCHOOLS = [
  { key: "mizzou", dir: "data", source: "MU Grade Distribution Application, Office of the University Registrar" },
  { key: "tamu", dir: "data/tamu", source: "Grade Distribution Reports, Texas A&M Office of the Registrar" },
  { key: "vt", dir: "data/vt", source: "Course Grade Distributions, Virginia Tech University DataCommons" },
  { key: "illinois", dir: "data/illinois", source: "Grade Distribution, University of Illinois DAIR" },
];

/**
 * Mizzou's registrar publishes the letter split but no GPA, so derive one the
 * same way TRU does. Without this every Mizzou course scored null difficulty.
 */
const derivedGpa = (pct) => {
  if (!Array.isArray(pct)) return null;
  const [a, b, c, d] = pct;
  const total = pct.reduce((x, y) => x + y, 0) || 100;
  return (4 * a + 3 * b + 2 * c + d) / total;
};

/**
 * Pass/fail and S/U courses publish a 0.00 GPA next to 90% A. Texas A&M's
 * ASCC 289 did exactly that and came out as the hardest course at the
 * university. A published GPA is only believed when the letter split agrees.
 */
const trustworthy = (gpa, pct) => {
  if (typeof gpa !== "number") return false;
  const derived = derivedGpa(pct);
  if (derived === null) return gpa >= 1;
  return gpa >= 1 && Math.abs(gpa - derived) <= 0.6;
};

/**
 * A single 0-100 difficulty read, so the planner can balance a term without
 * every consumer re-deriving it. Built from the average GPA, because that is
 * the one figure students mean. Withdrawals nudge it up: a course people flee
 * is harder than its GPA alone says.
 */
function difficulty(gpa, withdrawPct) {
  if (typeof gpa !== "number") return null;
  const fromGpa = Math.max(0, Math.min(100, Math.round(((4 - gpa) / 2.2) * 100)));
  const fromW = Math.min(20, Math.round((withdrawPct ?? 0) * 1.2));
  return Math.min(100, fromGpa + fromW);
}

const run = () => {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const index = {};

  for (const s of SCHOOLS) {
    const file = join(TRU, s.dir, "grades-seo.json");
    if (!existsSync(file)) { console.log(`  ${s.key.padEnd(10)} SKIPPED (no ${file})`); continue; }
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.courses;

    // Believe the published GPA when it is consistent, derive one when the
    // registrar does not publish it, and give up rather than guess otherwise.
    const effectiveGpa = (c) => {
      if (trustworthy(c.gpa, c.pct)) return c.gpa;
      const d = derivedGpa(c.pct);
      return d === null ? null : Math.round(d * 100) / 100;
    };

    const courses = list.map((c) => ({
      code: c.course,
      title: c.title ?? "",
      n: c.n ?? 0,
      sections: c.sections ?? 0,
      gpa: effectiveGpa(c),
      aPct: c.pct?.[0] ?? null,
      dfPct: c.pct ? (c.pct[3] ?? 0) + (c.pct[4] ?? 0) : null,
      withdrawPct: typeof c.qPct === "number" ? c.qPct : null,
      difficulty: difficulty(effectiveGpa(c), c.qPct),
      instructors: (c.instructors ?? []).slice(0, 12).map((i) => ({
        name: i.name, sections: i.sections, gpa: i.avg, aPct: i.aPct, withdrawPct: i.qPct,
      })),
    }));

    const out = { school: s.key, source: s.source, terms: raw.terms ?? "", count: courses.length, courses };
    writeFileSync(join(OUT_DIR, `${s.key}-grades.json`), JSON.stringify(out));

    const scored = courses.filter((c) => c.difficulty !== null);
    const hardest = [...scored].sort((a, b) => b.difficulty - a.difficulty)[0];
    index[s.key] = { count: courses.length, terms: out.terms, source: s.source };
    console.log(`  ${s.key.padEnd(10)} ${String(courses.length).padStart(6)} courses  hardest: ${hardest?.code} (${hardest?.gpa} GPA, difficulty ${hardest?.difficulty})`);
  }

  writeFileSync(join(OUT_DIR, "grades-index.json"), JSON.stringify({
    note: "UGA omitted on purpose: its Grade Distribution Report is a Power BI app behind a UGA login.",
    schools: index,
  }, null, 1));
  console.log(`\n  wrote ${Object.keys(index).length} school grade files + grades-index.json`);
};

run();
