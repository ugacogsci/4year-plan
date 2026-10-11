/**
 * Keep the facts a reading pass extracted, one file per document.
 *
 *   node scripts/illinois/syllabi/store-facts.mjs <journal.jsonl or results.json> [...]
 *
 * The reading pass (a workflow of readers over the excerpt batches that
 * excerpt.mjs writes) returns, per batch, { docs: [{ sha, kind, codes, term,
 * gradingComponents, ... }] }. Its journal holds every reader's result. This
 * joins each document's facts to what the crawl knew about it (source, URL,
 * the store's course and term hints) and writes data/syllabi/facts/{sha}.json,
 * which excerpt.mjs then skips and build.mjs reads.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from './lib/paths.mjs';

const FACTS = join(DIRS.state, '..', 'facts');
const EXCERPTS = join(DIRS.state, 'excerpts');
mkdirSync(FACTS, { recursive: true });

// What the crawl knew, by sha, from the excerpt batches.
const meta = new Map();
for (const f of existsSync(EXCERPTS) ? readdirSync(EXCERPTS).filter((n) => n.endsWith('.jsonl')) : []) {
  for (const line of readFileSync(join(EXCERPTS, f), 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(line);
    meta.set(d.sha, { source: d.source, url: d.url, hintCodes: d.hintCodes, hintTerm: d.hintTerm, hintSection: d.hintSection, title: d.title, chars: d.chars });
  }
}

/** Every { docs: [...] } object in a journal or a results file. */
function* docsIn(file) {
  const raw = readFileSync(file, 'utf8');
  const visit = function* (v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v.docs) && v.docs.every((d) => d && typeof d.sha === 'string')) { yield* v.docs; return; }
    for (const x of Array.isArray(v) ? v : Object.values(v)) yield* visit(x);
  };
  if (file.endsWith('.jsonl')) for (const line of raw.split('\n').filter(Boolean)) yield* visit(JSON.parse(line));
  else yield* visit(JSON.parse(raw));
}

let written = 0;
let unknown = 0;
for (const file of process.argv.slice(2)) {
  for (const d of docsIn(file)) {
    const m = meta.get(d.sha);
    if (!m) { unknown += 1; continue; }
    writeFileSync(join(FACTS, `${d.sha}.json`), JSON.stringify({ ...m, facts: d, readAt: new Date().toISOString() }, null, 1));
    written += 1;
  }
}
console.log(`${written} documents' facts written to ${FACTS}${unknown ? `; ${unknown} results named a sha no excerpt batch has` : ''}`);
