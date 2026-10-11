/**
 * Per-source manifests: data/syllabi/manifests/{source}.jsonl, one line per
 * document the source's adapter found, fetched or deliberately did not fetch.
 *
 *   {"source":"app-sib","url":"https://app.sib.illinois.edu/course/syllabi/IB%20150.pdf",
 *    "finalUrl":"...","sha":"3f9c...","status":200,"outcome":"ok","contentType":"application/pdf",
 *    "hintCodes":["IB 150"],"hintTerm":null,"hintSection":null,"kindHint":"syllabus",
 *    "foundVia":"https://app.sib.illinois.edu/courses/all","fetchedAt":"2026-09-27T14:18:02Z"}
 *
 * A manifest is rewritten whole at the end of a run, never appended across
 * runs, so it always describes one run. The collapse guard lives here too: a
 * run that found fewer than 90% of the documents the last run found is
 * written to {source}.jsonl.rejected instead, and the old manifest stays, so
 * one bad night (a moved index page, a host that started answering 403)
 * cannot silently empty a source.
 *
 * Beside each manifest, {source}.meta.json says what the run was:
 *   {"source":"app-sib","mode":"crawl","complete":true,"runAt":"...","subjects":["IB"],
 *    "counts":{"ok":93,"offline":0,...},"note":null}
 * "complete" is what lets coverage.json list a source under a course's
 * "checked": a run that enumerated everything and fetched everything it
 * found. The researchers' import (mode "import") and an --offline run with
 * cache misses are never complete, so IB 150 is not "checked against app-sib"
 * until the adapter has really run.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from './paths.mjs';

const file = (source) => join(DIRS.manifests, `${source}.jsonl`);

export function readManifest(source) {
  if (!existsSync(file(source))) return [];
  return readFileSync(file(source), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function listManifests() {
  if (!existsSync(DIRS.manifests)) return [];
  return readdirSync(DIRS.manifests).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
}

export function readManifestMeta(source) {
  const f = join(DIRS.manifests, `${source}.meta.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

/** Returns { written: bool, reason }. meta is written beside the manifest only when the manifest is. */
export function writeManifest(source, rows, { force = false, meta = null } = {}) {
  mkdirSync(DIRS.manifests, { recursive: true });
  const before = readManifest(source).filter((r) => r.outcome === 'ok').length;
  const now = rows.filter((r) => r.outcome === 'ok').length;
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  if (!force && (now === 0 || (before > 0 && now < before * 0.9))) {
    writeFileSync(`${file(source)}.rejected`, body);
    return { written: false, reason: `collapse guard: ${now} documents fetched against ${before} last run; kept the old manifest, this run is in ${source}.jsonl.rejected (rerun with --force to accept)` };
  }
  const tmp = `${file(source)}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file(source));
  if (meta) {
    const counts = {};
    for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    writeFileSync(join(DIRS.manifests, `${source}.meta.json`), JSON.stringify({ source, runAt: new Date().toISOString(), ...meta, counts }, null, 1));
  }
  return { written: true, reason: null };
}
