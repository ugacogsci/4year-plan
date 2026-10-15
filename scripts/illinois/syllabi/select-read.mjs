/**
 * Which unread documents are worth a reading pass: the newest few per course.
 *
 *   node scripts/illinois/syllabi/select-read.mjs --only uga-bulletin --per-course 3 --out data/syllabi/state/read-uga.json
 *   node scripts/illinois/syllabi/select-read.mjs --only ws-engr-getsyllabus,ws-engr-getfile --per-course 2 --out data/syllabi/state/read-illinois.json
 *
 * A store holds every section of every term (CHEM 1211 lists a dozen files;
 * SE 101 had 17 sections in one Illinois term). The newest two or three
 * documents of a course, preferring different terms and different
 * instructors, answer what students ask, and reading the rest costs tokens
 * for nothing new. Documents that already have facts are never re-selected.
 *
 * Writes a JSON list of shas for excerpt.mjs --keep <file>.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listManifests, readManifest } from './lib/manifest.mjs';
import { DIRS } from './lib/paths.mjs';
import { termKey } from './lib/terms.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const ONLY = new Set((arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const PER = Number(arg('--per-course', 3));
const OUT = arg('--out', join(DIRS.state, 'read-selected.json'));
const FACTS = join(DIRS.state, '..', 'facts');

const byCourse = new Map();
let seenDocs = 0;
let alreadyRead = 0;
for (const source of listManifests()) {
  if (ONLY.size && !ONLY.has(source)) continue;
  for (const row of readManifest(source)) {
    if (row.outcome !== 'ok' || !row.sha) continue;
    seenDocs += 1;
    if (existsSync(join(FACTS, `${row.sha}.json`))) { alreadyRead += 1; continue; }
    const info = existsSync(join(DIRS.text, `${row.sha}.json`)) ? JSON.parse(readFileSync(join(DIRS.text, `${row.sha}.json`), 'utf8')) : null;
    if (!info || (info.flags ?? []).some((f) => ['image-only', 'js-shell', 'template', 'login', 'soft-404'].includes(f))) continue;
    const code = row.hintCodes?.[0] ?? 'unknown';
    const list = byCourse.get(code) ?? [];
    list.push({ sha: row.sha, term: row.hintTerm ?? info.term ?? null, instructor: row.instructorHint ?? null, section: row.hintSection ?? null });
    byCourse.set(code, list);
  }
}

const picked = [];
for (const [, docs] of byCourse) {
  // Newest first; undated last. Then prefer a document from a term or an
  // instructor not yet picked for this course.
  docs.sort((a, b) => (b.term ? termKey(b.term) : -1) - (a.term ? termKey(a.term) : -1));
  const chosen = [];
  const terms = new Set();
  const people = new Set();
  for (const pass of [0, 1]) {
    for (const d of docs) {
      if (chosen.length >= PER) break;
      if (chosen.includes(d)) continue;
      const fresh = (!d.term || !terms.has(d.term)) && (!d.instructor || !people.has(d.instructor));
      if (pass === 0 && !fresh) continue;
      chosen.push(d);
      if (d.term) terms.add(d.term);
      if (d.instructor) people.add(d.instructor);
    }
  }
  picked.push(...chosen.map((d) => d.sha));
}

writeFileSync(OUT, JSON.stringify(picked));
console.log(`${picked.length} documents selected for ${byCourse.size} courses (${seenDocs} documents seen, ${alreadyRead} already read, up to ${PER} a course) -> ${OUT}`);
