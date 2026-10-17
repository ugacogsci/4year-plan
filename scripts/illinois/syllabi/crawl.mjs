/**
 * Run source adapters, write their manifests, and extract the text of every
 * document they fetched.
 *
 *   node scripts/illinois/syllabi/crawl.mjs --sources ws-engr-getsyllabus,chem-docs,econ-docs,math-docs
 *   node scripts/illinois/syllabi/crawl.mjs --sources chem-docs --offline   (cache only, no network)
 *
 * The public sources beyond the Grainger stores and the Drupal archives
 * (research/discovery.json ranks all 32; Canvas, Box and login-only ones are
 * never run):
 *   department libraries   app-sib, app-mcb, math-topics (course-libraries.mjs)
 *   engineering            ws-engr-item (master syllabi), grainger-sites (course sites, Physics template)
 *   other public pages     small-seeds (instructor and department pages), publish-web, eui, moodle
 *   archived (Wayback)     up-wayback, ler, wayback-hosts (wayback.mjs; 3 s apart on web.archive.org)
 * Run the Wayback three in one process, and never beside another process
 * that asks web.archive.org: the spacing is kept per process.
 *
 * Sources run side by side; lib/http.mjs keeps each host to one request at a
 * time, 1.1 s apart, and at most four hosts in flight, so running them
 * together is the same politeness as running them one by one, only shorter.
 * A run is resumable: every response is cached, so a killed run picks up
 * where it stopped at no cost to the hosts.
 */
import { lookup } from './lib/cache.mjs';
import { get, head, hostReport, setOffline } from './lib/http.mjs';
import { readManifest, writeManifest } from './lib/manifest.mjs';
import { ensureDirs } from './lib/paths.mjs';
import { extractMany } from './lib/text.mjs';
import { chemDocs, econDocs, mathDocs } from './sources/drupal-docs.mjs';
import * as graingerIndex from './sources/grainger-index.mjs';
import * as getfile from './sources/ws-engr-getfile.mjs';
import * as getsyllabus from './sources/ws-engr-getsyllabus.mjs';
import * as ugaBulletin from './sources/uga-bulletin.mjs';
import { ler, upWayback, waybackHosts } from './sources/wayback.mjs';
import * as wsEngrItem from './sources/ws-engr-item.mjs';
import * as graingerSites from './sources/grainger-sites.mjs';
import { appMcb, appSib, mathTopics } from './sources/course-libraries.mjs';
import * as smallSeeds from './sources/small-seeds.mjs';
import * as eui from './sources/eui.mjs';
import * as publishWeb from './sources/publish-web.mjs';
import * as moodle from './sources/moodle.mjs';

const SOURCES = Object.fromEntries([
  getsyllabus, getfile, graingerIndex, chemDocs, econDocs, mathDocs, ugaBulletin,
  upWayback, ler, waybackHosts, wsEngrItem, graingerSites, appSib, appMcb, mathTopics, smallSeeds, eui, publishWeb, moodle,
].map((s) => [s.id, s]));
// UGA's source runs only when named: the default run is the Illinois refresh.
const DEFAULT_SOURCES = Object.keys(SOURCES).filter((id) => !id.startsWith('uga-'));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const picked = (arg('--sources') ?? DEFAULT_SOURCES.join(',')).split(',').filter(Boolean);
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
    // A source whose manifest so far was the researchers' import keeps those
    // documents when its first real run does not find them again (a file the
    // research fetched from a page that has since changed): they were read and
    // shipped, and a crawl must not quietly drop them.
    const found = new Set(out.rows.map((r) => r.sha).filter(Boolean));
    const carried = readManifest(id).filter((r) => String(r.via ?? '').startsWith('import') && r.outcome === 'ok' && r.sha && !found.has(r.sha));
    if (carried.length) log(`${id}: kept ${carried.length} imported documents this run did not find again`);
    out.rows = [...out.rows, ...carried];
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
