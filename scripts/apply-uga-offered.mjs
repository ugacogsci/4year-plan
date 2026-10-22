#!/usr/bin/env node
/**
 * Write UGA's summer offerings into public/uga-catalog.json.
 *
 * The catalog's offeredIn came from scripts/enrich-uga.mjs, whose seasons()
 * kept "fall" and "spring" and dropped "summer", so not one of 14,092 UGA
 * courses was offered in summer and the planner could never fill a UGA
 * summer. This puts the summers back from the same source, and changes
 * nothing about fall and spring.
 *
 * Source (data provenance): the UGA Bulletin course pages,
 * https://bulletin.uga.edu/Course/Details/{id}, field "Semester Course
 * Offered" ("Offered fall, spring and summer", "Offered summer semester every
 * odd-numbered year."), read for every catalog course into offered.json by
 * the staging folder's build-offered.mjs: the syllabus pipeline's cache of
 * those pages (fetched 2026-10-15), pages fetched one at a time on 2026-10-20
 * for the rest, and the 2026-09-18 enrich-uga.mjs scrape's raw offeredText
 * where neither page read had the course. Each offered.json entry carries
 * its text, url, source and fetch time; provenance.json beside it lists the
 * crawler identity and robots check (bulletin.uga.edu/robots.txt: 404, no
 * rules). Of 14,092 courses, 8,103 name a season and 3,088 of them summer
 * (54 every other summer: 33 odd years, 21 even); 2,370 have a line naming
 * no season ("Offered every year."), 1,549 say "Not offered on a regular
 * basis." and 2,070 have no line (coverage.json beside offered.json).
 *
 * What it writes, per row:
 *   - offeredIn: the seasons the Bulletin names, Summer included; [] for a
 *     row naming none (it was ["Fall","Spring"], the enrichment's default,
 *     which could not be told from a page that names both). The planner
 *     reads [] exactly as it read that default: fall or spring, not
 *     verified, and never a summer (lib/planner/summer-offering.ts).
 *   - summerYears: "odd" or "even" for a course offered "summer semester
 *     every odd-numbered (even-numbered) year"; absent otherwise.
 * It refuses to write when any row's fall and spring would differ from the
 * catalog's now (with the default for a row naming neither), so fall and
 * spring planning cannot move.
 *
 *   node scripts/apply-uga-offered.mjs <offered.json> [public/uga-catalog.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [offeredPath, catalogArg] = process.argv.slice(2);
if (!offeredPath) {
  console.error('usage: node scripts/apply-uga-offered.mjs <offered.json> [public/uga-catalog.json]');
  process.exit(2);
}
const CATALOG = catalogArg ?? join(ROOT, 'public', 'uga-catalog.json');
const offered = JSON.parse(readFileSync(offeredPath, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));

const ORDER = ['Fall', 'Spring', 'Summer'];
const regular = (seasons) => {
  const named = seasons.filter((s) => s !== 'Summer');
  return (named.length ? named : ['Fall', 'Spring']).join(',');
};
const counts = { rows: catalog.length, noEntry: 0, summer: 0, odd: 0, even: 0, summerOnly: 0, unchanged: 0 };
const moved = [];
const out = catalog.map((row) => {
  const entry = offered[row.code];
  if (!entry) {
    counts.noEntry += 1;
    return row;
  }
  const seasons = ORDER.filter((s) => entry.seasons.includes(s));
  const offeredIn = seasons;
  if (regular(offeredIn) !== regular(row.offeredIn ?? [])) moved.push(`${row.code}: ${row.offeredIn} -> ${offeredIn} ("${entry.text}")`);
  const years = seasons.includes('Summer') && entry.summerCadence === 'odd years' ? 'odd' : seasons.includes('Summer') && entry.summerCadence === 'even years' ? 'even' : null;
  if (seasons.includes('Summer')) counts.summer += 1;
  if (seasons.length === 1 && seasons[0] === 'Summer') counts.summerOnly += 1;
  if (years) counts[years] += 1;
  // Same keys in the same order, summerYears right after offeredIn.
  const next = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'summerYears') continue;
    next[key] = key === 'offeredIn' ? offeredIn : value;
    if (key === 'offeredIn' && years) next.summerYears = years;
  }
  if (JSON.stringify(next) === JSON.stringify(row)) counts.unchanged += 1;
  return next;
});
if (moved.length > 0) {
  console.error(`Refused: ${moved.length} rows would change their fall or spring offering:\n  ${moved.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
writeFileSync(CATALOG, JSON.stringify(out));
console.log(JSON.stringify(counts));
