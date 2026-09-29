/**
 * The catalog, as the syllabus pipeline needs it: which codes exist, what they
 * are called, which codes are the same course, and when each last ran.
 *
 * Sources, all already built by the planner:
 *   public/illinois/index.json        6,110 codes, titles, levels, "twins" (cross-lists)
 *   public/illinois/course/{S}.json   the catalog's own "sameAs" per course
 *   public/illinois/offerings.json    terms each code ran, plus renumbered codes
 *   public/illinois/sections.json     Fall 2026 sections: instructors, online-only
 *
 * Twins matter because one syllabus serves every code of a cross-listed
 * course: "PSYC312/AFRO312 Psychology of Race and Ethnicity" is one document
 * and two catalog rows. A document that names only one of them is still that
 * course, and build.mjs propagates it with via "cross-list of PSYC 312".
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

const PUB = join(ROOT, 'public', 'illinois');
const read = (f) => JSON.parse(readFileSync(join(PUB, f), 'utf8'));

/**
 * Courses with no syllabus to expect, by title: open seminars, independent
 * study, theses, internships, study abroad. 361-ish of 6,110. "Research
 * Methods" and "Honors Seminar in X" are real classes and are not matched.
 */
const SHELL = /\b(undergraduate open seminar|independent (study|research|reading|project)s?|individual (study|studies|research|topics|reading)|directed (study|research|reading)s?|senior thesis|honors (senior )?thesis|research or thesis|undergrad(uate)? research(?! methods)|thesis research|^thesis|internship|study abroad|special problems|co-?op(erative)? (education|work)|field experience|senior research|ug research project|research experience)\b/i;

let cached = null;

export function loadCatalog() {
  if (cached) return cached;
  const index = read('index.json');
  const offerings = existsSync(join(PUB, 'offerings.json')) ? read('offerings.json') : { courses: {}, renumbered: {}, terms: [] };
  const sections = existsSync(join(PUB, 'sections.json')) ? read('sections.json') : { courses: [] };

  const byCode = new Map();
  for (const c of index) {
    const [subject, number] = c.code.split(' ');
    byCode.set(c.code, { code: c.code, subject, number, level: c.level, title: c.title, twins: new Set(c.twins ?? []), online: !!c.online });
  }
  // The shards' sameAs fills in twins index.json lacks (it lists them per
  // direction; the catalog sometimes names only one side).
  for (const subject of new Set([...byCode.values()].map((c) => c.subject))) {
    const f = join(PUB, 'course', `${subject}.json`);
    if (!existsSync(f)) continue;
    const shard = JSON.parse(readFileSync(f, 'utf8'));
    for (const c of shard.courses ?? []) {
      const row = byCode.get(c.code);
      if (!row) continue;
      for (const s of c.sameAs ?? []) if (byCode.has(s) && s !== c.code) { row.twins.add(s); byCode.get(s).twins.add(c.code); }
    }
  }
  const fall = new Map((sections.courses ?? []).map((s) => [s.code, s]));
  const subjects = new Set([...byCode.values()].map((c) => c.subject));

  cached = {
    termId: sections.termId ?? null, // "fall-2026"
    codes: new Set(byCode.keys()),
    subjects,
    get: (code) => byCode.get(code) ?? null,
    all: () => [...byCode.values()],
    twins: (code) => [...(byCode.get(code)?.twins ?? [])],
    offered: (code) => offerings.courses?.[code] ?? [],
    offeredTerms: offerings.terms ?? [],
    renumbered: offerings.renumbered ?? {},
    fall: (code) => fall.get(code) ?? null,
    isShell: (code) => SHELL.test(byCode.get(code)?.title ?? ''),
  };
  return cached;
}

/**
 * "cs225", "CS-225", "CS 225", "Cs225" -> "CS 225" when it is a catalog code;
 * null otherwise. Numbers 500 and up are graduate and never in the catalog
 * here, so they come back null too, which is how build.mjs counts them.
 */
export function normalizeCode(raw) {
  const m = String(raw ?? '').toUpperCase().match(/^\s*([A-Z]{2,5})\s*[-_ ]?\s*(\d{3})\s*$/);
  if (!m) return null;
  const code = `${m[1]} ${m[2]}`;
  return loadCatalog().codes.has(code) ? code : null;
}

/** Lowercased word tokens of a title, for overlap checks. */
export function titleTokens(s) {
  const STOP = new Set(['and', 'of', 'the', 'in', 'to', 'for', 'a', 'an', 'intro', 'introduction', 'i', 'ii', 'iii', '&', 'with', 'on']);
  return new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
