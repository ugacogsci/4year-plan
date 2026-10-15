/**
 * UGA's catalog, as the syllabus pipeline needs it: which codes exist, each
 * course's Bulletin page, and the objectives and topical outline the Bulletin
 * publishes for about a quarter of courses.
 *
 * Source: data/uga-courses.json (the semantic-course-map scrape, enriched by
 * scripts/enrich-uga.mjs), the same rows lib/planner/uga-data.ts adapts for
 * the browser. A code here is exactly what the planner shows: the owning
 * department plus the Bulletin's number, so "AAEC 3580-3580L" (a lecture with
 * its lab) and "CSCI 4720/6720" (a split-level course) are single codes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

const SRC = join(ROOT, 'data', 'uga-courses.json');

let cached = null;

/**
 * The Bulletin's objectives and outline arrive as one run of text (the scrape
 * flattened the page's list): "By the end of this course, students will ... .
 * By the end of this course, students will ... ." Split where the text itself
 * marks a boundary (sentence end, newline, bullet, semicolon); an outline
 * written as bare topic titles with no punctuation stays one item rather
 * than being cut by guesswork.
 */
export function splitItems(raw, max, each) {
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
  const parts = text
    .split(/\r?\n|[•·▪●]|(?<=[.?!;])\s+(?=[A-Z0-9("])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 2);
  const out = [];
  for (const p of parts) {
    if (out.length >= max) break;
    out.push(p.length > each ? `${p.slice(0, each - 1).trimEnd()}…` : p);
  }
  return out;
}

/** The owning department of "AAEC(ENVM)(FHCE)" is AAEC; the rest are cross-lists. */
export function primarySubject(subject) {
  return String(subject ?? '').split('(')[0].trim().toUpperCase();
}

export function loadUgaCatalog() {
  if (cached) return cached;
  const file = JSON.parse(readFileSync(SRC, 'utf8'));
  const rows = Array.isArray(file) ? file : file.courses;
  const byCode = new Map();
  for (const r of rows) {
    if (!r.subject || !r.number) continue;
    const subject = primarySubject(r.subject);
    const code = `${subject} ${String(r.number).trim().toUpperCase()}`;
    if (byCode.has(code)) continue; // cross-listings repeat the same course
    const level = Number(String(r.number).match(/\d+/)?.[0] ?? 0);
    byCode.set(code, {
      code,
      subject,
      number: String(r.number),
      level,
      undergraduate: level > 0 && level < 5000,
      title: r.title ?? '',
      url: r.url ?? null,
      id: r.url ? r.url.split('/').pop() : null,
      objectives: splitItems(r.course_objectives, 8, 220),
      outline: splitItems(r.topical_outline, 14, 300),
    });
  }
  // "CHEM 1211" is also the plain half of "CHEM 1211-1211L", and the lower
  // half of "CSCI 4720/6720", when the catalog has no plain row of its own.
  const alias = new Map();
  for (const code of byCode.keys()) {
    const m = code.match(/^([A-Z]{4}) (\d{4}[A-Z]{0,2})(?:[-/]\d{4}[A-Z]{0,2})+$/);
    if (m) {
      const plain = `${m[1]} ${m[2]}`;
      if (!byCode.has(plain) && !alias.has(plain)) alias.set(plain, code);
    }
  }
  cached = {
    codes: new Set(byCode.keys()),
    get: (code) => byCode.get(code) ?? null,
    all: () => [...byCode.values()],
    alias,
  };
  return cached;
}

/**
 * "chem1211", "CHEM-1211", "Chem 1211 L" -> "CHEM 1211" or "CHEM 1211L" when it is
 * a catalog code (or the plain half of one, which maps to the pair); null otherwise.
 */
export function normalizeUgaCode(raw) {
  const m = String(raw ?? '').toUpperCase().match(/^\s*([A-Z]{4})\s*[-_ ]?\s*(\d{4}\s*[A-Z]{0,2}(?:\s*[-/]\s*\d{4}\s*[A-Z]{0,2})*)\s*$/);
  if (!m) return null;
  const code = `${m[1]} ${m[2].replace(/\s+/g, '')}`;
  const cat = loadUgaCatalog();
  if (cat.codes.has(code)) return code;
  return cat.alias.get(code) ?? null;
}
