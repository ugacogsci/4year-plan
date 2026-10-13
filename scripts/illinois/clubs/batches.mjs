/**
 * The club texts a reading pass has to read, cut into batches (DESIGN 2.7).
 *
 *   node scripts/illinois/clubs/batches.mjs              clubs whose text changed since facts.json, or never read
 *   node scripts/illinois/clubs/batches.mjs --all        every club again (after the reader's rules change)
 *   node scripts/illinois/clubs/batches.mjs --batch 25   clubs per batch (default 25)
 *   node scripts/illinois/clubs/batches.mjs --check 40   instead: the checker's sample of clubs already read
 *
 * No network, no model: it only writes files a reading pass then reads. It
 * re-spawns itself with --experimental-strip-types for the goal ids.
 *
 * Which clubs: every group tag.mjs keeps (not an office account, not dropped
 * as a graduate, law, medical or veterinary group by its name or an
 * override), whose text hash differs from the one facts.json stored for it.
 * --include-dropped adds the dropped groups that are not offices, to check
 * the name rules.
 *
 * Writes data/clubs/reading/ (git-ignored with the rest of data/clubs/; the
 * texts are the clubs' own words):
 *   batch-NNN.jsonl  one club a line: { id, hash, name, categories, affiliations, closed, mission, benefits }
 *   batch-NNN.txt    the same batch as the reader reads it, with the allowed values first
 *   index.json       { at, clubs, batches: [{ file, ids }], hashes: { id: hash }, skipped }
 * and with --check:
 *   check.jsonl / check.txt  the sample, each club's text beside the facts stored for it
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { CAREER_TRACKS, INTEREST_TOPICS } = await import(pathToFileURL(join(ROOT, 'lib', 'planner', 'career-tracks.ts')).href);
const { CLUB_KINDS } = await import('./tag.mjs');

// CLUBS_DATA and CLUBS_FACTS point a test run somewhere else; the pipeline never sets them.
const DATA = process.env.CLUBS_DATA ? resolve(process.env.CLUBS_DATA) : join(ROOT, 'data', 'clubs');
const FACTS = process.env.CLUBS_FACTS ? resolve(process.env.CLUBS_FACTS) : join(HERE, 'facts.json');
export const READING = join(DATA, 'reading');

export const AUDIENCE_VALUES = ['undergrad', 'both', 'grad', 'law', 'med', 'vet', 'unclear'];
export const JOINING_VALUES = ['open', 'application', 'audition', 'election', 'invitation', 'unclear'];
/** Characters to tokens, roughly, for the cost line. */
const CHARS_PER_TOKEN = 4;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

/** id -> { mission, benefits, hash, name } from texts.jsonl. */
export function readTextRows(file) {
  const rows = new Map();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line);
    rows.set(String(t.id), t);
  }
  return rows;
}

/** The goal ids, with the words a student reads back, as the reader must use them. */
export const goalVocabulary = () => [
  ...CAREER_TRACKS.map((t) => ({ id: t.id, label: t.name })),
  ...INTEREST_TOPICS.map((t) => ({ id: t.id, label: t.label })),
];

/**
 * The clubs to read: kept groups whose text hash differs from facts.json's.
 * Returns { todo: [{ id, hash, name, categories, affiliations, closed, mission, benefits }], skipped }.
 */
export function clubsToRead({ tagged, texts, facts, all = false, includeDropped = false }) {
  const stored = facts?.facts ?? {};
  const todo = [];
  const skipped = { office: 0, dropped: 0, unchanged: 0, noText: 0 };
  for (const c of tagged.clubs) {
    if (c.office) { skipped.office += 1; continue; }
    if (c.dropped && !includeDropped) { skipped.dropped += 1; continue; }
    const t = texts.get(String(c.id));
    if (!t) { skipped.noText += 1; continue; }
    if (!all && stored[c.id]?.hash === t.hash) { skipped.unchanged += 1; continue; }
    todo.push({
      id: String(c.id), hash: t.hash, name: c.name, categories: c.categories ?? [], affiliations: c.affiliations ?? [],
      closed: c.joining === 'closed', mission: t.mission ?? '', benefits: t.benefits ?? '',
    });
  }
  return { todo, skipped };
}

/** The header every batch file starts with: the values a reader may use, nothing else. */
export function valuesHeader() {
  return [
    'Allowed values (scripts/illinois/clubs/READING.md has the rules). Use these exact strings.',
    `  kind: ${[...CLUB_KINDS].join(' | ')}`,
    `  audience: ${AUDIENCE_VALUES.join(' | ')}`,
    `  joining: ${JOINING_VALUES.join(' | ')}`,
    '  identity: true | false',
    '  goals (ids only, zero or more):',
    ...goalVocabulary().map((g) => `    ${g.id.padEnd(26)} ${g.label}`),
  ].join('\n');
}

/** One club as the reader sees it. */
export function clubBlock(c, k, n) {
  return [
    `=== CLUB ${k} of ${n} ===`,
    `id: ${c.id}`,
    `hash: ${c.hash}`,
    `name: ${c.name}`,
    `directory categories: ${c.categories.join('; ') || 'none'}`,
    `affiliations: ${c.affiliations.join('; ') || 'none'}`,
    `membership on OneIllinois: ${c.closed ? 'closed (not taking sign-ups there)' : 'open'}`,
    "--- MISSION (the club's own words: read them, never copy them) ---",
    c.mission.trim() || '(none written)',
    '--- MEMBERSHIP BENEFITS ---',
    c.benefits.trim() || '(none written)',
    '',
  ].join('\n');
}

function writeBatches({ todo, size }) {
  mkdirSync(READING, { recursive: true });
  for (const f of readdirSync(READING)) if (/^batch-\d+\.(jsonl|txt)$/.test(f) || f === 'index.json') rmSync(join(READING, f));
  const batches = [];
  const total = Math.ceil(todo.length / size);
  for (let i = 0; i < todo.length; i += size) {
    const chunk = todo.slice(i, i + size);
    const name = `batch-${String(batches.length + 1).padStart(3, '0')}`;
    writeFileSync(join(READING, `${name}.jsonl`), chunk.map((c) => JSON.stringify(c)).join('\n') + '\n');
    writeFileSync(join(READING, `${name}.txt`), [
      `CLUB READING ${name} (${batches.length + 1} of ${total}), ${chunk.length} clubs. Return one entry for every club, with its id and hash, in this order.`,
      valuesHeader(),
      '',
      ...chunk.map((c, k) => clubBlock(c, k + 1, chunk.length)),
    ].join('\n'));
    batches.push({ file: join(READING, `${name}.txt`), ids: chunk.map((c) => c.id) });
  }
  return batches;
}

// ---------------------------------------------------------------------------
// the checker's sample

/** A small seeded shuffle, so a day's sample can be drawn again. */
function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const shuffled = (xs, rand) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * The checker's sample of clubs already read: half with goals the reader
 * gave, a quarter it marked graduate or professional, unclear or by
 * selection, a quarter at random (eval/spotcheck-grader.md). Only facts whose
 * hash still matches the text are drawn.
 */
export function checkSample({ facts, texts, tagged, n = 40, seed }) {
  const rand = seeded(seed);
  const rows = Object.values(facts?.facts ?? {}).filter((f) => texts.get(String(f.id))?.hash === f.hash);
  const withGoals = shuffled(rows.filter((f) => f.goals?.length), rand);
  const doubtful = shuffled(rows.filter((f) => !f.goals?.length && (f.audience !== 'undergrad' || f.joining !== 'open')), rand);
  const picked = [...withGoals.slice(0, Math.round(n / 2)), ...doubtful.slice(0, Math.round(n / 4))];
  const rest = shuffled(rows.filter((f) => !picked.includes(f)), rand);
  picked.push(...rest.slice(0, n - picked.length));
  const byId = new Map(tagged.clubs.map((c) => [String(c.id), c]));
  return picked.map((f) => {
    const t = texts.get(String(f.id));
    const c = byId.get(String(f.id));
    return {
      id: String(f.id), hash: f.hash, name: c?.name ?? t.name, categories: c?.categories ?? [], affiliations: c?.affiliations ?? [],
      closed: c?.joining === 'closed', mission: t.mission ?? '', benefits: t.benefits ?? '',
      stored: { kind: f.kind, identity: f.identity, audience: f.audience, joining: f.joining, goals: f.goals ?? [], does: f.does ?? null },
    };
  });
}

function writeCheck(sample) {
  mkdirSync(READING, { recursive: true });
  writeFileSync(join(READING, 'check.jsonl'), sample.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(join(READING, 'check.txt'), [
    `CLUB READING CHECK, ${sample.length} clubs. For each: is every stored value right by the club's own text? Is any run of 8 or more words in "does" copied from it?`,
    valuesHeader(),
    '',
    ...sample.map((c, k) => [
      clubBlock(c, k + 1, sample.length).trimEnd(),
      '--- STORED (what the reading pass said) ---',
      `kind: ${c.stored.kind}; identity: ${c.stored.identity}; audience: ${c.stored.audience}; joining: ${c.stored.joining}`,
      `goals: ${c.stored.goals.join(', ') || 'none'}`,
      `does: ${c.stored.does ?? '(none)'}`,
      '',
    ].join('\n')),
  ].join('\n'));
}

// ---------------------------------------------------------------------------

function main() {
  const tagFile = join(DATA, 'tagged.json');
  if (!existsSync(tagFile)) {
    console.error('no data/clubs/tagged.json; run crawl.mjs (or --offline), then tag.mjs');
    process.exit(1);
  }
  const tagged = readJson(tagFile);
  const texts = readTextRows(join(DATA, 'texts.jsonl'));
  if (texts.size === 0) {
    console.error('no data/clubs/texts.jsonl; run crawl.mjs (or crawl.mjs --offline)');
    process.exit(1);
  }
  const facts = existsSync(FACTS) ? readJson(FACTS) : null;

  const checkN = arg('--check', null);
  if (checkN !== null) {
    if (!facts) {
      console.error('no scripts/illinois/clubs/facts.json yet: run the reading pass and store-facts.mjs first');
      process.exit(1);
    }
    const sample = checkSample({ facts, texts, tagged, n: Number(checkN) || 40, seed: arg('--seed', tagged.checked) });
    writeCheck(sample);
    console.log(`wrote ${READING.replace(`${ROOT}/`, '')}/check.txt: ${sample.length} clubs for the checker (seed ${arg('--seed', tagged.checked)})`);
    return;
  }

  const size = Math.max(1, Number(arg('--batch', 25)) || 25);
  const { todo, skipped } = clubsToRead({ tagged, texts, facts, all: process.argv.includes('--all'), includeDropped: process.argv.includes('--include-dropped') });
  const batches = writeBatches({ todo, size });
  const hashes = Object.fromEntries(todo.map((c) => [c.id, c.hash]));
  writeFileSync(join(READING, 'index.json'), JSON.stringify({ at: new Date().toISOString(), checked: tagged.checked, size, clubs: todo.length, skipped, hashes, batches }, null, 1));

  const textChars = todo.reduce((n, c) => n + c.mission.length + c.benefits.length + c.name.length, 0);
  const headerChars = valuesHeader().length * batches.length;
  const words = todo.map((c) => (c.mission.match(/\S+/g) ?? []).length + (c.benefits.match(/\S+/g) ?? []).length).sort((a, b) => a - b);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;
  const empty = todo.filter((c) => !c.mission.trim() && !c.benefits.trim()).length;
  console.log(`${todo.length} clubs to read in ${batches.length} batches of up to ${size} (${READING.replace(`${ROOT}/`, '')}/batch-*.txt)`);
  console.log(`  skipped: ${skipped.office} offices, ${skipped.dropped} dropped graduate/law/medical/veterinary groups, ${skipped.unchanged} unchanged since facts.json, ${skipped.noText} with no text row`);
  console.log(`  text: ${Math.round(textChars / 1000)}k characters of mission and benefits (median ${median} words a club, ${empty} with none), plus ${Math.round(headerChars / 1000)}k of value lists`);
  console.log(`  roughly ${Math.round((textChars + headerChars) / CHARS_PER_TOKEN / 1000)}k input tokens for the readers, before their instructions; ${facts ? `facts.json holds ${Object.keys(facts.facts ?? {}).length} clubs` : 'no facts.json yet, so this is the first full pass'}`);
}

if (isMain) main();
