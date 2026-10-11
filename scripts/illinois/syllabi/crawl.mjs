/**
 * Run source adapters, write their manifests, and extract the text of every
 * document they fetched.
 *
 *   node scripts/illinois/syllabi/crawl.mjs --sources ws-engr-getsyllabus,chem-docs,econ-docs,math-docs
 *   node scripts/illinois/syllabi/crawl.mjs --sources chem-docs --offline   (cache only, no network)
 *
 * Sources run side by side; lib/http.mjs keeps each host to one request at a
 * time, 1.1 s apart, and at most four hosts in flight, so running them
 * together is the same politeness as running them one by one, only shorter.
 * A run is resumable: every response is cached, so a killed run picks up
 * where it stopped at no cost to the hosts.
 */
import { lookup } from './lib/cache.mjs';
import { get, head, hostReport, setOffline } from './lib/http.mjs';
import { writeManifest } from './lib/manifest.mjs';
import { ensureDirs } from './lib/paths.mjs';
import { extractMany } from './lib/text.mjs';
import { chemDocs, econDocs, mathDocs } from './sources/drupal-docs.mjs';
import * as graingerIndex from './sources/grainger-index.mjs';
import * as getfile from './sources/ws-engr-getfile.mjs';
import * as getsyllabus from './sources/ws-engr-getsyllabus.mjs';

const SOURCES = Object.fromEntries([getsyllabus, getfile, graingerIndex, chemDocs, econDocs, mathDocs].map((s) => [s.id, s]));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const picked = (arg('--sources') ?? Object.keys(SOURCES).join(',')).split(',').filter(Boolean);
const force = process.argv.includes('--force');
if (process.argv.includes('--offline')) setOffline(true);
for (const id of picked) if (!SOURCES[id]) throw new Error(`unknown source ${id}; known: ${Object.keys(SOURCES).join(', ')}`);

ensureDirs();
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const ctx = { get, head, log };

const results = await Promise.all(picked.map(async (id) => {
  const started = Date.now();
  try {
    const out = await SOURCES[id].run(ctx);
    const w = writeManifest(id, out.rows, { force, meta: { mode: 'crawl', complete: out.complete, note: out.note ?? null } });
    log(`${id}: ${out.rows.length} documents in ${Math.round((Date.now() - started) / 60000)} min; manifest ${w.written ? 'written' : `NOT written (${w.reason})`}`);
    return out.rows;
  } catch (e) {
    log(`${id}: FAILED ${e?.stack ?? e}`);
    return [];
  }
}));

const docs = results.flat().filter((r) => r.outcome === 'ok');
const records = docs.map((r) => ({ ...r, bodyPath: lookup(r.finalUrl ?? r.url)?.bodyPath ?? null })).filter((r) => r.bodyPath);
log(`extracting text from ${records.length} documents`);
extractMany(records, { log });
log('hosts:');
console.log(JSON.stringify(hostReport(), null, 1));
