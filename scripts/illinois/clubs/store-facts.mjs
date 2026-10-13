/**
 * Keep what a reading pass said about each club, in our own words and ids.
 *
 *   node scripts/illinois/clubs/store-facts.mjs <journal.jsonl or results.json> [...]
 *   node scripts/illinois/clubs/store-facts.mjs --dry-run <file> [...]
 *
 * The reading pass (one reader per batch that batches.mjs wrote; READING.md)
 * returns, per batch, { clubs: [{ id, hash, kind, identity, audience,
 * joining, goals, does }] }. Its journal holds every reader's result. This
 * finds every such entry, checks it, and merges it into
 * scripts/illinois/clubs/facts.json, which IS committed (DESIGN 2.7): the
 * facts must not live only in one worktree, as the syllabus facts once did.
 *
 * What is checked, entry by entry (a failed check is printed and the entry or
 * the field is left out; nothing a check rejects is stored):
 *   - the id is one batches.mjs wrote, and the hash is the one it carried: the
 *     text the reader saw is the text the hash names;
 *   - the club's text has not changed since (texts.jsonl has the same hash);
 *   - kind, audience and joining are the allowed values, identity a boolean;
 *   - every goal is a current CAREER_TRACKS or INTEREST_TOPICS id (others are
 *     dropped and reported: the build fails on an unknown id);
 *   - `does` is at most 20 words and 140 characters, holds nothing personal,
 *     and shares no run of 8 words with the club's own text. A `does` that
 *     fails is left out; the rest of the entry is kept.
 *
 * The club's own text is read in memory for the copy rule and never written.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { CLUB_KINDS, GOAL_IDS } = await import('./tag.mjs');
const { doesProblem } = await import('./guard.mjs');
const { AUDIENCE_VALUES, JOINING_VALUES, READING, readTextRows } = await import('./batches.mjs');

// CLUBS_DATA and CLUBS_FACTS point a test run somewhere else; the pipeline never sets them.
const DATA = process.env.CLUBS_DATA ? resolve(process.env.CLUBS_DATA) : join(ROOT, 'data', 'clubs');
const FACTS = process.env.CLUBS_FACTS ? resolve(process.env.CLUBS_FACTS) : join(HERE, 'facts.json');

/** Every { id, ... } entry inside a { clubs: [...] } object anywhere in a journal or results file. */
export function* entriesIn(raw, jsonl) {
  const visit = function* (v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v.clubs) && v.clubs.length > 0 && v.clubs.every((c) => c && typeof c === 'object' && (typeof c.id === 'string' || typeof c.id === 'number'))) {
      yield* v.clubs;
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) yield* visit(x);
  };
  if (jsonl) {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      yield* visit(parsed);
    }
  } else yield* visit(JSON.parse(raw));
}

/**
 * Check one reader entry. Returns { fact, problems } where fact is null when
 * the whole entry is rejected. `batchHash` is the hash batches.mjs gave the
 * club; `text` is its current texts.jsonl row.
 */
export function checkEntry(e, { batchHash, text, readAt }) {
  const problems = [];
  const id = String(e.id);
  if (!batchHash) return { fact: null, problems: [`${id}: not in any batch batches.mjs wrote`] };
  if (e.hash !== undefined && String(e.hash) !== batchHash) return { fact: null, problems: [`${id}: the reader's hash ${e.hash} is not the batch's ${batchHash}`] };
  if (!text || text.hash !== batchHash) return { fact: null, problems: [`${id}: its text changed after the batch was written; read it again`] };
  if (!CLUB_KINDS.has(e.kind)) return { fact: null, problems: [`${id}: kind "${e.kind}" is not allowed`] };
  if (!AUDIENCE_VALUES.includes(e.audience)) return { fact: null, problems: [`${id}: audience "${e.audience}" is not allowed`] };
  if (!JOINING_VALUES.includes(e.joining)) return { fact: null, problems: [`${id}: joining "${e.joining}" is not allowed`] };
  if (typeof e.identity !== 'boolean') return { fact: null, problems: [`${id}: identity must be true or false`] };
  const goals = [];
  for (const g of Array.isArray(e.goals) ? e.goals : []) {
    if (GOAL_IDS.has(g)) { if (!goals.includes(g)) goals.push(g); } else problems.push(`${id}: goal "${g}" is not a current goal id; left out`);
  }
  let does;
  if (e.does !== undefined && e.does !== null && String(e.does).trim()) {
    const why = doesProblem(String(e.does), [text.mission, text.benefits].filter(Boolean).join('\n'));
    if (why) problems.push(`${id}: does left out, ${why}`);
    else does = String(e.does).trim();
  }
  return {
    fact: { id, name: text.name, hash: batchHash, readAt, kind: e.kind, identity: e.identity, audience: e.audience, joining: e.joining, goals, ...(does ? { does } : {}) },
    problems,
  };
}

/** facts.json, one club a line, ids in order. */
export function serializeFacts(facts) {
  const ids = Object.keys(facts).sort((a, b) => Number(a) - Number(b));
  const head = {
    version: 1,
    note: 'What the reading pass said about each club, in our own words and the planner\'s goal ids (scripts/illinois/clubs/READING.md). No club\'s own text. build.mjs uses a row only while its hash matches the club\'s current text.',
    updatedAt: new Date().toISOString(),
  };
  return `${JSON.stringify(head).slice(0, -1)},"facts":{\n${ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(facts[id])}`).join(',\n')}\n}}\n`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('usage: node scripts/illinois/clubs/store-facts.mjs [--dry-run] <journal.jsonl or results.json> [...]');
    process.exit(1);
  }
  const indexFile = join(READING, 'index.json');
  if (!existsSync(indexFile)) {
    console.error(`no ${indexFile.replace(`${ROOT}/`, '')}: run batches.mjs, then the reading pass, then this`);
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const texts = readTextRows(join(DATA, 'texts.jsonl'));
  const existing = existsSync(FACTS) ? JSON.parse(readFileSync(FACTS, 'utf8')).facts ?? {} : {};
  const facts = { ...existing };
  const readAt = new Date().toISOString().slice(0, 10);

  let seen = 0;
  let stored = 0;
  let rejected = 0;
  const problems = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    for (const e of entriesIn(raw, file.endsWith('.jsonl'))) {
      seen += 1;
      const id = String(e.id);
      const r = checkEntry(e, { batchHash: index.hashes?.[id], text: texts.get(id), readAt });
      problems.push(...r.problems);
      if (!r.fact) { rejected += 1; continue; }
      facts[id] = r.fact;
      stored += 1;
    }
  }
  const missing = Object.keys(index.hashes ?? {}).filter((id) => facts[id]?.hash !== index.hashes[id]);
  if (!dryRun && stored > 0) {
    const text = serializeFacts(facts);
    writeFileSync(`${FACTS}.tmp`, text);
    renameSync(`${FACTS}.tmp`, FACTS);
  }
  console.log(`${dryRun ? 'would store' : 'stored'} ${stored} of ${seen} reader entries in ${FACTS.replace(`${ROOT}/`, '')} (${rejected} rejected); it ${dryRun ? 'would hold' : 'holds'} ${Object.keys(facts).length} clubs`);
  console.log(`  does lines: ${Object.values(facts).filter((f) => f.does).length}; clubs in the batches still without a current fact: ${missing.length}${missing.length ? ` (${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' ...' : ''})` : ''}`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (problems.length > 40) console.log(`  ... ${problems.length - 40} more`);
}

if (isMain) main();
