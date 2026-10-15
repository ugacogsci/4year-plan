/**
 * Did the reading pass answer every document it was handed, and with usable
 * records? Run before store-facts.mjs.
 *
 *   node scripts/illinois/syllabi/check-results.mjs --excerpts excerpts-uga --results results-uga
 *
 * For each batch-NNN.jsonl under data/syllabi/state/{excerpts}, looks for
 * {results}/batch-NNN.json and reports: batches with no result file, results
 * that are not valid JSON or not { docs: [...] }, shas missing or unknown,
 * records with a kind outside the five allowed, grading components whose
 * percent weights add to far from 100 (a sign of a jumbled table), and the
 * overall counts. Exits non-zero when a batch is unanswered or malformed, so
 * a wave can be re-run for just those batches.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from './lib/paths.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const EX = join(DIRS.state, arg('--excerpts', 'excerpts'));
const RES = join(DIRS.state, arg('--results', 'results'));
const KINDS = new Set(['syllabus', 'course-policy', 'master-outline', 'course-page', 'other']);

let bad = 0;
const totals = { batches: 0, answered: 0, docs: 0, records: 0, syllabus: 0, lowConfidence: 0, oddWeights: 0 };
const unanswered = [];
for (const f of readdirSync(EX).filter((n) => /^batch-\d+\.jsonl$/.test(n)).sort()) {
  totals.batches += 1;
  const shas = readFileSync(join(EX, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).sha);
  totals.docs += shas.length;
  const rf = join(RES, f.replace(/\.jsonl$/, '.json'));
  if (!existsSync(rf)) { unanswered.push(f); continue; }
  let parsed;
  try { parsed = JSON.parse(readFileSync(rf, 'utf8')); } catch (e) { console.log(`${f}: result is not valid JSON (${e.message})`); bad += 1; unanswered.push(f); continue; }
  const docs = Array.isArray(parsed?.docs) ? parsed.docs : null;
  if (!docs) { console.log(`${f}: result has no docs array`); bad += 1; unanswered.push(f); continue; }
  totals.answered += 1;
  const got = new Set(docs.map((d) => d?.sha));
  const missing = shas.filter((s) => !got.has(s));
  const unknown = [...got].filter((s) => !shas.includes(s));
  if (missing.length || unknown.length) { console.log(`${f}: ${missing.length} documents unanswered${unknown.length ? `, ${unknown.length} shas not in the batch` : ''}`); bad += 1; }
  for (const d of docs) {
    totals.records += 1;
    if (!KINDS.has(d.kind)) { console.log(`${f}: ${String(d.sha).slice(0, 8)} has kind "${d.kind}"`); bad += 1; }
    if (d.kind === 'syllabus') totals.syllabus += 1;
    if (d.confidence === 'low') totals.lowConfidence += 1;
    const pct = (d.gradingComponents ?? []).filter((c) => c && c.unit === 'percent' && typeof c.weight === 'number');
    if (pct.length >= 2) {
      const sum = pct.reduce((n, c) => n + c.weight, 0);
      if (sum < 85 || sum > 115) { totals.oddWeights += 1; console.log(`${f}: ${String(d.sha).slice(0, 8)} ${d.codes?.[0] ?? ''} percent weights add to ${sum}${d.notes ? ` (notes: ${String(d.notes).slice(0, 80)})` : ''}`); }
    }
  }
}
console.log(JSON.stringify(totals));
if (unanswered.length) console.log(`unanswered batches: ${unanswered.join(' ')}`);
process.exit(bad || unanswered.length ? 1 : 0);
