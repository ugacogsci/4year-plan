/**
 * The parts of each syllabus a fact can come from, cut out for the reader
 * that turns them into facts.
 *
 *   node scripts/illinois/syllabi/excerpt.mjs [--batch 25]
 *
 * A syllabus runs 2,000 to 60,000 characters, and the facts a student asks
 * for (what the project is worth, how many exams, whether attendance counts,
 * which book) sit in a few paragraphs of it. Each document becomes its header
 * (who, which course, which term) and the windows around the lines that
 * speak of grading, exams, materials and course policies, merged and capped,
 * so the reader sees every fact and a tenth of the text.
 *
 * Skipped: documents already read (data/syllabi/facts/{sha}.json exists;
 * --all reads them again), documents whose text flags say there is nothing to read (a scanned
 * PDF with no text layer, a JavaScript shell, the Grainger site template, a
 * login page or soft 404), and texts too short to be a syllabus.
 *
 * Writes data/syllabi/state/excerpts/batch-NNN.jsonl, one document a line:
 *   { sha, source, url, hintCodes, hintTerm, hintSection, kindHint, title, chars, header, excerpt }
 * and data/syllabi/state/excerpts/index.json listing the batches. Local only:
 * the excerpts are the instructors' words and are never committed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listManifests, readManifest } from './lib/manifest.mjs';
import { DIRS } from './lib/paths.mjs';
import { loadText } from './lib/text.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const BATCH = Number(arg('--batch', 25));
const OUT = join(DIRS.state, 'excerpts');
const FACTS = join(DIRS.state, '..', 'facts');
const ALL = process.argv.includes('--all');
/**
 * --keep-for ws-engr-getsyllabus=data/syllabi/state/read-first.json: read only
 * the listed shas of that source. The getsyllabus store holds every section
 * of every term since Fall 2023 (SE 101 has 17 sections in one term); the
 * newest three terms of a course, two sections each, answer what students ask.
 */
const KEEP_FOR = (() => {
  const v = arg('--keep-for', null);
  if (!v) return null;
  const [source, file] = v.split('=');
  return { source, shas: new Set(JSON.parse(readFileSync(file, 'utf8'))) };
})();

/** Lines that carry a fact a student asks about. */
const FACT = /\bgrad(e|es|ing)\b|\bevaluat|\bassess|\bweight|%|\bpercent|\bpoints?\b|\bexam|\bmidterm|\bfinal\b|\bquiz|\bhomework|\bproject|\bparticipat|\battendance|\blate\b|\bmake-?up|\btextbook|\brequired (text|book|material|reading)|\bmaterials\b|\bdrop(ped|s)? (the )?(lowest|two|one)|\bextra credit|\bcurve|\blab(oratory)? report|\bpaper\b|\bessay|\bpresentation/i;
const SKIP_FLAGS = new Set(['image-only', 'js-shell', 'template', 'login', 'soft-404']);
const HEADER_CHARS = 1200;
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 8;
const CAP = 12000;
/** A passage that holds the grade breakdown itself: numbers beside graded work. */
const WEIGHTS = /(\d\s*%|\bpoints?\b|\bpts\b)/i;
const GRADED = /\bgrad|\bweight|\bexam|\bhomework|\btotal|\bquiz|\bproject|\bparticipat/i;

function excerptOf(text) {
  const lines = text.replace(/\f/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, all) => l.trim() || (all[i - 1] ?? '').trim());
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (!FACT.test(l)) return;
    for (let j = Math.max(0, i - WINDOW_BEFORE); j <= Math.min(lines.length - 1, i + WINDOW_AFTER); j += 1) keep[j] = 1;
  });
  const parts = [];
  let run = [];
  lines.forEach((l, i) => {
    if (keep[i]) run.push(l);
    else if (run.length) { parts.push(run.join('\n')); run = []; }
  });
  if (run.length) parts.push(run.join('\n'));
  let out = parts.join('\n[...]\n');
  if (out.length <= CAP) return out;
  // Over the cap: keep the passages that carry the breakdown (numbers beside
  // graded work) first, then the others, and print them in document order.
  // Cutting at the cap lost the "Final grade" table at the end of a long
  // syllabus, and with it the weights a student asks about.
  const ranked = parts.map((text, i) => ({ text, i, rank: WEIGHTS.test(text) && GRADED.test(text) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  const kept = [];
  let size = 0;
  for (const p of ranked) {
    if (size + p.text.length > CAP) continue;
    kept.push(p);
    size += p.text.length + 7;
  }
  out = kept.sort((a, b) => a.i - b.i).map((p) => p.text).join('\n[...]\n');
  return kept.length < parts.length ? `${out}\n[some passages left out]` : out;
}

const docs = [];
const seen = new Set();
let skipped = 0;
for (const source of listManifests()) {
  for (const row of readManifest(source)) {
    if (row.outcome !== 'ok' || !row.sha || seen.has(row.sha)) continue;
    seen.add(row.sha);
    if (!ALL && existsSync(join(FACTS, `${row.sha}.json`))) continue;
    if (KEEP_FOR && source === KEEP_FOR.source && !KEEP_FOR.shas.has(row.sha)) continue;
    const t = loadText(row.sha);
    if (!t || t.info.flags?.some((f) => SKIP_FLAGS.has(f)) || t.text.trim().length < 400) { skipped += 1; continue; }
    const text = t.text.replace(/\f/g, '\n');
    docs.push({
      sha: row.sha, source, url: row.finalUrl ?? row.url, hintCodes: row.hintCodes ?? [], hintTerm: row.hintTerm ?? t.info.term ?? null,
      hintSection: row.hintSection ?? null, kindHint: row.kindHint ?? null, title: t.info.title ?? null, chars: text.length,
      header: text.slice(0, HEADER_CHARS), excerpt: excerptOf(text),
    });
  }
}

if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
mkdirSync(OUT, { recursive: true });
const batches = [];
for (let i = 0; i < docs.length; i += BATCH) {
  const name = `batch-${String(batches.length + 1).padStart(3, '0')}.jsonl`;
  const chunk = docs.slice(i, i + BATCH);
  writeFileSync(join(OUT, name), chunk.map((d) => JSON.stringify(d)).join('\n') + '\n');
  // The same batch as plain text for a reader that reads files a line at a time.
  writeFileSync(join(OUT, name.replace(/\.jsonl$/, '.txt')), chunk.map((d, k) => [
    `=== DOCUMENT ${k + 1} of ${chunk.length} ===`,
    `sha: ${d.sha}`, `source: ${d.source}`, `url: ${d.url}`, `course hint (from the store or URL): ${d.hintCodes.join(', ') || 'none'}`,
    `term hint: ${d.hintTerm ?? 'none'}`, `section hint: ${d.hintSection ?? 'none'}`, `title: ${d.title ?? 'none'}`, `full length: ${d.chars} characters`,
    '--- HEADER (first lines of the document) ---', d.header, '--- EXCERPT (passages about grading, exams, materials, policies) ---', d.excerpt, '',
  ].join('\n')).join('\n'));
  batches.push({ file: join(OUT, name), docs: chunk.length, shas: chunk.map((d) => d.sha) });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ at: new Date().toISOString(), docs: docs.length, skipped, batches }, null, 1));
const chars = docs.reduce((n, d) => n + d.header.length + d.excerpt.length, 0);
console.log(`${docs.length} documents in ${batches.length} batches (${skipped} skipped: no usable text); ${Math.round(chars / 1000)}k characters of excerpts, ${Math.round(chars / docs.length)} a document`);
