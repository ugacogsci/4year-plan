/**
 * The club file the planner ships: public/illinois/clubs.json (DESIGN 2.9).
 *
 *   node scripts/illinois/clubs/build.mjs                reads data/clubs/, writes public/illinois/clubs.json
 *   node scripts/illinois/clubs/build.mjs --dry-run      everything but the write
 *   node scripts/illinois/clubs/build.mjs --accept-drop  write even when the club count fell more than 15%
 *
 * No network. It re-spawns itself with --experimental-strip-types, because the
 * goal ids come from lib/planner/career-tracks.ts through tag.mjs.
 *
 * Inputs:
 *   data/clubs/tagged.json          tag.mjs: every group with goals, kind, audience (required)
 *   data/clubs/directory.json       parse.mjs: the page's own count, the guard, the calendar stamp (required)
 *   data/clubs/events.json          parse.mjs, when the calendar feed was read: dates per club (optional)
 *   data/clubs/texts.jsonl          the clubs' own words, read in memory for the copy rule only (optional)
 *   scripts/illinois/clubs/facts.json      the reading pass, by store-facts.mjs (optional)
 *   scripts/illinois/clubs/overrides.json  hand-checked; its goalsRemove reaches reading-pass goals too
 *   public/illinois/clubs.json      the last build: clubs the directory stopped listing stay 120 days
 *
 * What it does:
 *   - drops office accounts and groups for students already in graduate, law,
 *     medical or veterinary school, and counts each (counts.dropped);
 *   - joins the reading pass's facts where the club's text has not changed
 *     since it was read (same hash): kind, identity, audience, how to join,
 *     goals (kept only where one of the club's own directory categories agrees,
 *     tag.mjs GOAL_CATEGORIES), and `does`, our own line about the club;
 *   - joins event dates when the calendar was read: last, up to 3 next, and
 *     the number in the 120 days before the page was read;
 *   - keeps a club the directory stopped listing for 120 days after it was
 *     last seen (the grace window: Orange groups drop off around Jun 1 and
 *     Blue around Dec 16, and many re-register), then lets it go.
 *
 * Never wipes. A missing or unreadable input, a failed guard, or a file that
 * would be 15% smaller than the last one leaves public/illinois/clubs.json as
 * it was. The syllabus build empties its output when its inputs are missing,
 * which the 2026-10-02 review flagged; this one does not.
 *
 * The privacy guard refuses to write when anything personal or anything of the
 * clubs' own prose would ship: every field is on a whitelist; no string holds
 * an email address, phone number, uid=, message link, mailto: or tel:; no
 * string but a club's name runs 8 words together from a club's own text; a
 * club's `does` is at most 20 words; links are the profile or the club's own
 * website, never one made up; categories and affiliations are the directory's
 * own tag names. The mission and benefits text is read in memory for that
 * check and never written.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { ASKED_ONLY_KINDS, CLUB_KINDS, GOAL_CATEGORIES, GOAL_IDS } = await import('./tag.mjs');
const { COPY_RUN, DOES_MAX_CHARS, DOES_MAX_WORDS, doesProblem, personalIn, runsOf, sharedRun, wordsOf } = await import('./guard.mjs');

// CLUBS_DATA, CLUBS_FACTS and CLUBS_OUT point a test run somewhere else; the pipeline never sets them.
const DATA = process.env.CLUBS_DATA ? resolve(process.env.CLUBS_DATA) : join(ROOT, 'data', 'clubs');
const FACTS = process.env.CLUBS_FACTS ? resolve(process.env.CLUBS_FACTS) : join(HERE, 'facts.json');
const OVERRIDES = join(HERE, 'overrides.json');
const OUT = process.env.CLUBS_OUT ? resolve(process.env.CLUBS_OUT) : join(ROOT, 'public', 'illinois', 'clubs.json');

export const GRACE_DAYS = 120;
const SOURCE_HOST = 'one.illinois.edu';
const DROP_FOR = { grad: 'graduate', law: 'law', med: 'medical', vet: 'veterinary' };
const JOIN_BY = new Set(['application', 'audition', 'election', 'invitation']);
const FACT_AUDIENCE = new Set(['undergrad', 'both', 'grad', 'law', 'med', 'vet', 'unclear']);
const FACT_JOINING = new Set(['open', 'application', 'audition', 'election', 'invitation', 'unclear']);

/** The fields that ship, at each level. Anything else in the output stops the build. */
export const SHIPPED = {
  file: ['version', 'builtAt', 'checked', 'source', 'calendar', 'lists', 'counts', 'clubs'],
  source: ['name', 'url', 'host'],
  calendar: ['url', 'lastModified', 'read'],
  list: ['id', 'title', 'short', 'url', 'read', 'goal', 'weight', 'college', 'subject'],
  counts: ['onPage', 'parsed', 'shipped', 'dropped', 'unlisted'],
  dropped: ['office', 'graduate', 'law', 'medical', 'veterinary', 'hidden'],
  club: ['id', 'name', 'url', 'profile', 'website', 'categories', 'affiliations', 'kind', 'identity', 'national', 'audience', 'joining', 'goals', 'subjects', 'colleges', 'lists', 'does', 'thin', 'starter', 'events', 'firstSeen', 'lastSeen'],
  goal: ['id', 'from', 'list'],
  events: ['last', 'next', 'n120'],
};
const AUDIENCES = new Set(['undergrad', 'both', 'check']);
const JOININGS = new Set(['open', 'closed', 'application', 'audition', 'election', 'invitation']);
const GOAL_FROM = new Set(['list', 'national', 'name', 'reading', 'override']);
/** Longer than this is prose, whatever field it is in. The longest club name is 128 characters. */
const LONGEST_STRING = 200;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// the reading pass's facts, onto one tagged row

/**
 * One club's tagged row with its reading-pass facts applied. Returns
 * { row, used, notes } where notes count what happened (stale, goalsAdded,
 * goalsDisagreed, doesShipped, doesDropped ...). Hand-checked rows win: an
 * override's audience and kind, and a national row's kind, are never replaced.
 * `source` is the club's own text (a string or a runsOf Set) for the copy rule.
 */
export function applyFacts(row, fact, { override, source } = {}) {
  const notes = {};
  if (!fact) return { row, used: false, notes };
  if (fact.hash !== row.hash) return { row, used: false, notes: { stale: 1 } };
  const out = { ...row, goals: [...row.goals] };

  if (fact.kind && !['override', 'national'].includes(row.kindFrom)) {
    if (!CLUB_KINDS.has(fact.kind)) throw new Error(`facts.json ${row.id}: unknown kind "${fact.kind}"`);
    if (fact.kind !== out.kind) notes.kindChanged = 1;
    out.kind = fact.kind;
    out.kindFrom = 'reading';
  }
  if (typeof fact.identity === 'boolean' && typeof override?.identity !== 'boolean') out.identity = fact.identity;

  if (fact.audience && row.audienceFrom !== 'override') {
    if (!FACT_AUDIENCE.has(fact.audience)) throw new Error(`facts.json ${row.id}: unknown audience "${fact.audience}"`);
    if (DROP_FOR[fact.audience]) {
      out.audience = fact.audience;
      out.dropped = DROP_FOR[fact.audience];
      notes.droppedByReading = 1;
    } else {
      out.audience = fact.audience === 'unclear' ? 'check' : fact.audience;
    }
    out.audienceFrom = 'reading';
  }
  if (fact.joining) {
    if (!FACT_JOINING.has(fact.joining)) throw new Error(`facts.json ${row.id}: unknown joining "${fact.joining}"`);
    if (JOIN_BY.has(fact.joining)) out.joining = fact.joining;
  }

  // Goals: an asked-only kind carries none (tag.mjs holds them back the same way);
  // otherwise a goal the reader saw counts only where a directory category agrees.
  if (ASKED_ONLY_KINDS.has(out.kind)) {
    if (out.goals.length) notes.goalsHeldBack = out.goals.length;
    out.goals = [];
  } else {
    for (const id of fact.goals ?? []) {
      if (!GOAL_IDS.has(id)) throw new Error(`facts.json ${row.id}: "${id}" is not a current CAREER_TRACKS or INTEREST_TOPICS id`);
      if (out.goals.some((g) => g.id === id)) continue;
      if ((GOAL_CATEGORIES[id] ?? []).some((c) => row.categories.includes(c))) {
        out.goals.push({ id, from: 'reading' });
        notes.goalsAdded = (notes.goalsAdded ?? 0) + 1;
      } else notes.goalsDisagreed = (notes.goalsDisagreed ?? 0) + 1;
    }
  }
  for (const id of override?.goalsRemove ?? []) out.goals = out.goals.filter((g) => g.id !== id);

  if (fact.does !== undefined && fact.does !== null) {
    const problem = doesProblem(fact.does, source);
    if (problem) notes.doesDropped = problem;
    else { out.does = fact.does.trim(); notes.doesShipped = 1; }
  }
  return { row: out, used: true, notes };
}

// ---------------------------------------------------------------------------
// one shipped row

/** A tagged (or previously shipped) row as it ships: the whitelist, empty optionals left out. */
export function shipRow(row, events) {
  const out = {
    id: String(row.id),
    name: row.name,
    url: row.url,
    ...(row.profile ? { profile: row.profile } : {}),
    ...(row.website ? { website: row.website } : {}),
    categories: [...(row.categories ?? [])],
    ...(row.affiliations?.length ? { affiliations: [...row.affiliations] } : {}),
    kind: row.kind,
    identity: Boolean(row.identity),
    ...(row.national ? { national: row.national } : {}),
    audience: row.audience,
    joining: row.joining,
    goals: (row.goals ?? []).map((g) => (g.list === undefined ? { id: g.id, from: g.from } : { id: g.id, from: g.from, list: g.list })),
    ...(row.subjects?.length ? { subjects: [...row.subjects] } : {}),
    ...(row.colleges?.length ? { colleges: [...row.colleges] } : {}),
    ...(row.lists?.length ? { lists: [...row.lists] } : {}),
    ...(row.does ? { does: row.does } : {}),
    ...(row.thin ? { thin: true } : {}),
    ...(row.starter ? { starter: true } : {}),
    ...(events ? { events } : {}),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
  };
  return out;
}

/** events.json's per-club entry as it ships: { last?, next?, n120 }. */
export function shipEvents(e) {
  if (!e) return null;
  return {
    ...(e.last ? { last: e.last } : {}),
    ...(e.next?.length ? { next: e.next.slice(0, 3) } : {}),
    n120: Number(e.n120) || 0,
  };
}

// ---------------------------------------------------------------------------
// the whole file

/**
 * Build the file in memory. Throws (and nothing is written) when an input is
 * inconsistent. Returns { file, report }.
 *   tagged     data/clubs/tagged.json, parsed
 *   directory  data/clubs/directory.json, parsed
 *   events     data/clubs/events.json, parsed, or null
 *   facts      scripts/illinois/clubs/facts.json, parsed, or null
 *   texts      Map id -> the club's own mission and benefits text, or null
 *   overrides  overrides.json's `overrides`, or {}
 *   previous   the last public/illinois/clubs.json, parsed, or null
 */
export function buildClubsFile({ tagged, directory, events = null, facts = null, texts = null, overrides = {}, previous = null, builtAt = new Date().toISOString() }) {
  const problems = [];
  if (tagged?.version !== 1 || !Array.isArray(tagged.clubs)) problems.push('tagged.json is not a version-1 tag file');
  if (directory?.version !== 1 || !Array.isArray(directory.groups)) problems.push('directory.json is not a version-1 directory');
  if (problems.length) throw new Error(problems.join('; '));
  if (!directory.guard?.ok) problems.push(`directory.json's count guard failed: ${(directory.guard?.failures ?? []).join('; ') || 'no reason given'}`);
  if (tagged.checked !== directory.checked) problems.push(`tagged.json is from ${tagged.checked} but directory.json from ${directory.checked}: run tag.mjs again`);
  if (!ISO_DAY.test(String(directory.checked))) problems.push(`directory.json's checked date "${directory.checked}" is not YYYY-MM-DD`);
  if (tagged.clubs.length !== directory.groups.length) problems.push(`tagged.json has ${tagged.clubs.length} groups, directory.json ${directory.groups.length}: run tag.mjs again`);
  // The goal-id guard, again: the other session may have renamed a goal since tag.mjs ran.
  const stray = tagged.clubs.flatMap((c) => (c.goals ?? []).filter((g) => !GOAL_IDS.has(g.id)).map((g) => `${c.id} ${c.name}: ${g.id}`));
  if (stray.length) problems.push(`goal ids that are not current CAREER_TRACKS or INTEREST_TOPICS ids (run tag.mjs again): ${stray.slice(0, 8).join('; ')}`);
  if (problems.length) throw new Error(problems.join('\n  '));

  const checked = directory.checked;
  const factsById = facts?.facts ?? {};
  const report = {
    facts: { rows: Object.keys(factsById).length, used: 0, stale: 0, unknownIds: 0, kindChanged: 0, droppedByReading: 0, goalsAdded: 0, goalsDisagreed: 0, doesShipped: 0, doesDropped: [] },
    events: { calendar: Boolean(directory.calendar && events), joined: 0 },
    grace: { kept: [], expired: 0, untaggedMissing: 0 },
  };
  const tagIds = new Set(tagged.clubs.map((c) => String(c.id)));
  report.facts.unknownIds = Object.keys(factsById).filter((id) => !tagIds.has(id)).length;

  const dropped = { office: 0, graduate: 0, law: 0, medical: 0, veterinary: 0, hidden: 0 };
  const groupById = new Map(directory.groups.map((g) => [String(g.id), g]));
  const clubs = [];
  for (const tagRow of tagged.clubs) {
    let row = tagRow;
    if (!row.dropped) {
      const { row: withFacts, used, notes } = applyFacts(row, factsById[row.id], { override: overrides[row.id], source: texts?.get(row.id) ?? null });
      row = withFacts;
      if (used) report.facts.used += 1;
      for (const k of ['stale', 'kindChanged', 'droppedByReading', 'goalsAdded', 'goalsDisagreed', 'doesShipped']) report.facts[k] += notes[k] ?? 0;
      if (notes.doesDropped) report.facts.doesDropped.push(`${row.id} ${row.name}: ${notes.doesDropped}`);
    }
    if (row.dropped) { dropped[row.dropped] = (dropped[row.dropped] ?? 0) + 1; continue; }
    const ev = events?.clubs?.[row.id] ?? groupById.get(String(row.id))?.events ?? null;
    const shippedEvents = directory.calendar ? shipEvents(ev ?? { n120: 0 }) : null;
    if (ev) report.events.joined += 1;
    clubs.push(shipRow(row, shippedEvents));
  }

  // The grace window: a club the last build shipped and this directory no
  // longer lists stays, unchanged, for GRACE_DAYS after it was last seen.
  const since = addDays(checked, -GRACE_DAYS);
  for (const old of previous?.clubs ?? []) {
    if (tagIds.has(String(old.id))) continue;
    if (overrides[old.id]?.hide || DROP_FOR[overrides[old.id]?.audience]) continue;
    if (!ISO_DAY.test(String(old.lastSeen)) || old.lastSeen < since) { report.grace.expired += 1; continue; }
    clubs.push(shipRow(old, directory.calendar ? { n120: 0 } : null));
    report.grace.kept.push(`${old.id} ${old.name} (last seen ${old.lastSeen})`);
  }
  // Groups the parser carries as missing that no earlier build shipped have no tags to ship with.
  const previousIds = new Set((previous?.clubs ?? []).map((c) => String(c.id)));
  report.grace.untaggedMissing = (directory.missing ?? []).filter((g) => !previousIds.has(String(g.id)) && !g.office).length;

  clubs.sort((a, b) => a.name.localeCompare(b.name, 'en') || Number(a.id) - Number(b.id));

  const file = {
    version: 1,
    builtAt,
    checked,
    source: { name: directory.source.name, url: directory.source.url, host: directory.source.host },
    calendar: directory.calendar ? { url: directory.calendar.url, lastModified: directory.calendar.lastModified ?? null, read: directory.calendar.read } : null,
    lists: tagged.lists.map((l) => ({
      id: l.id, title: l.title, short: l.short, url: l.url, read: l.read,
      ...(l.goal ? { goal: l.goal, weight: l.weight ?? 1 } : {}),
      ...(l.college ? { college: l.college } : {}),
      ...(l.subject ? { subject: l.subject } : {}),
    })),
    counts: {
      onPage: directory.counts.onPage,
      parsed: directory.counts.parsed,
      shipped: clubs.length,
      dropped: Object.fromEntries(Object.entries(dropped).filter(([k, v]) => k !== 'hidden' || v > 0)),
      unlisted: report.grace.kept.length,
    },
    clubs,
  };
  return { file, report };
}

// ---------------------------------------------------------------------------
// the privacy guard, on the finished file

/**
 * Every reason the file must not ship; [] when it may. `texts` is a Map id ->
 * the club's own text; `vocabulary` is directory.json's tag vocabulary.
 */
export function shippedProblems(file, { texts = null, vocabulary = null } = {}) {
  const bad = [];
  const onlyKeys = (obj, allowed, where) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad.push(`${where}: field "${k}" is not on the shipped whitelist`);
  };
  onlyKeys(file, SHIPPED.file, 'file');
  onlyKeys(file.source, SHIPPED.source, 'source');
  if (file.calendar) onlyKeys(file.calendar, SHIPPED.calendar, 'calendar');
  for (const l of file.lists ?? []) onlyKeys(l, SHIPPED.list, `list ${l.id}`);
  onlyKeys(file.counts, SHIPPED.counts, 'counts');
  onlyKeys(file.counts?.dropped, SHIPPED.dropped, 'counts.dropped');

  // Every string, anywhere: nothing personal, nothing long.
  const walk = (v, path) => {
    if (typeof v === 'string') {
      const p = personalIn(v);
      if (p.length) bad.push(`${path} holds ${p.join(', ')}`);
      if (v.length > LONGEST_STRING) bad.push(`${path} is ${v.length} characters long, which is prose`);
      if (/[\r\n]/.test(v)) bad.push(`${path} has a line break, which is prose`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(file, 'clubs.json');

  const topical = vocabulary ? new Set(vocabulary.topical) : null;
  const affiliations = vocabulary ? new Set(vocabulary.affiliations) : null;
  const ids = new Set();
  for (const c of file.clubs ?? []) {
    const where = `club ${c.id} ${c.name}`;
    onlyKeys(c, SHIPPED.club, where);
    for (const g of c.goals ?? []) onlyKeys(g, SHIPPED.goal, `${where} goal`);
    if (c.events) onlyKeys(c.events, SHIPPED.events, `${where} events`);
    if (ids.has(c.id)) bad.push(`${where}: id appears twice`);
    ids.add(c.id);
    if (!/^\d+$/.test(c.id)) bad.push(`${where}: id is not a directory id`);
    // Links: the profile when there is one, else the club's own website; never one made up.
    if (c.profile && !new RegExp(`^https://${SOURCE_HOST.replace(/\./g, '\\.')}/[^/.?#]+/$`).test(c.profile)) bad.push(`${where}: profile ${c.profile} is not a ${SOURCE_HOST} profile`);
    if (c.website && !/^https?:\/\/[^\s]+$/.test(c.website)) bad.push(`${where}: website ${c.website} is not a link`);
    if (c.url !== (c.profile ?? c.website)) bad.push(`${where}: url is neither its profile nor its website`);
    if (!c.url) bad.push(`${where}: no link`);
    if (topical) for (const k of c.categories ?? []) if (!topical.has(k)) bad.push(`${where}: category "${k}" is not one of the directory's tags`);
    if (affiliations) for (const a of c.affiliations ?? []) if (!affiliations.has(a)) bad.push(`${where}: affiliation "${a}" is not one of the directory's tags`);
    if (!CLUB_KINDS.has(c.kind)) bad.push(`${where}: kind "${c.kind}"`);
    if (!AUDIENCES.has(c.audience)) bad.push(`${where}: audience "${c.audience}" does not ship`);
    if (!JOININGS.has(c.joining)) bad.push(`${where}: joining "${c.joining}"`);
    for (const g of c.goals ?? []) {
      if (!GOAL_IDS.has(g.id)) bad.push(`${where}: goal "${g.id}" is not a current goal id`);
      if (!GOAL_FROM.has(g.from)) bad.push(`${where}: goal source "${g.from}"`);
      if (g.list !== undefined && !file.lists?.[g.list]) bad.push(`${where}: goal list ${g.list} is not in lists`);
    }
    for (const i of c.lists ?? []) if (!file.lists?.[i]) bad.push(`${where}: list ${i} is not in lists`);
    if (c.does !== undefined) {
      const n = wordsOf(c.does).length;
      if (n > DOES_MAX_WORDS || c.does.length > DOES_MAX_CHARS) bad.push(`${where}: does is ${n} words, ${c.does.length} characters`);
    }
    for (const d of [c.firstSeen, c.lastSeen, c.events?.last, ...(c.events?.next ?? [])]) if (d !== undefined && !ISO_DAY.test(String(d))) bad.push(`${where}: date "${d}" is not YYYY-MM-DD`);
  }

  // Nothing of the clubs' own words: no string but a name shares an 8-word run with any club's text.
  if (texts?.size) {
    const pool = new Set();
    for (const t of texts.values()) for (const r of runsOf(t, COPY_RUN)) pool.add(r);
    const look = (v, path) => {
      if (typeof v === 'string') {
        if (wordsOf(v).length < COPY_RUN) return;
        const run = sharedRun(v, pool);
        if (run) bad.push(`${path} copies "${run}" from a club's own text`);
      } else if (Array.isArray(v)) v.forEach((x, i) => look(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'name') look(x, `${path}.${k}`);
    };
    look(file, 'clubs.json');
  }
  return bad;
}

/**
 * The count guards the finished file must pass against the last one shipped.
 * They count the clubs the directory lists now: clubs kept by the grace
 * window would otherwise hide a drop for 120 days.
 */
export function sizeProblems(file, previous, { acceptDrop = false } = {}) {
  const bad = [];
  const listed = (f) => f.clubs.length - (f.counts?.unlisted ?? 0);
  const now = listed(file);
  const md = file.checked.slice(5);
  const floor = md >= '06-01' && md <= '09-15' ? 600 : 900;
  if (now < floor) bad.push(`${now} clubs listed in the directory is under the floor of ${floor}`);
  const before = previous?.clubs ? listed(previous) : null;
  if (before && now < before * 0.85 && !acceptDrop) bad.push(`${now} clubs listed against ${before} last time, a drop over 15% (pass --accept-drop if the directory really shrank)`);
  if (file.counts.parsed < file.counts.onPage * 0.995) bad.push(`parsed ${file.counts.parsed} of the page's ${file.counts.onPage}`);
  return bad;
}

// ---------------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readJsonIf = (file) => {
  if (!existsSync(file)) return null;
  try { return readJson(file); } catch (e) { throw new Error(`${file} is not readable JSON: ${e.message}`); }
};

/**
 * The last shipped file, or null. One that does not read as a club file is
 * replaced, not trusted: the build goes on without its grace window and its
 * 15% guard, and says so (the floor still holds).
 */
function readPrevious(file) {
  if (!existsSync(file)) return null;
  try {
    const v = readJson(file);
    if (v?.version === 1 && Array.isArray(v.clubs)) return v;
  } catch {
    /* not JSON */
  }
  console.warn(`  warning: ${file.replace(`${ROOT}/`, '')} is not a readable club file; building without its grace window and its 15% guard`);
  return null;
}

/** Map id -> mission and benefits, from texts.jsonl, or null when there is none. */
export function readTexts(file) {
  if (!existsSync(file)) return null;
  const texts = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line);
    texts.set(String(t.id), [t.mission, t.benefits].filter(Boolean).join('\n'));
  }
  return texts;
}

/** One club per line, so a rebuild's diff names the clubs that changed. */
export function serialize(file) {
  const { clubs, ...head } = file;
  const top = JSON.stringify(head);
  return `${top.slice(0, -1)},"clubs":[\n${clubs.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const acceptDrop = process.argv.includes('--accept-drop');
  const stop = (why) => {
    console.error(`STOPPED, ${existsSync(OUT) ? `${OUT.replace(`${ROOT}/`, '')} left as it was` : 'nothing written'}: ${why}`);
    process.exit(1);
  };

  let inputs;
  try {
    const tagged = readJsonIf(join(DATA, 'tagged.json'));
    const directory = readJsonIf(join(DATA, 'directory.json'));
    if (!tagged) stop('no data/clubs/tagged.json; run crawl.mjs (or crawl.mjs --offline), then tag.mjs');
    if (!directory) stop('no data/clubs/directory.json; run crawl.mjs (or crawl.mjs --offline)');
    inputs = {
      tagged,
      directory,
      events: readJsonIf(join(DATA, 'events.json')),
      facts: readJsonIf(FACTS),
      texts: readTexts(join(DATA, 'texts.jsonl')),
      overrides: readJsonIf(OVERRIDES)?.overrides ?? {},
      previous: readPrevious(OUT),
    };
  } catch (e) {
    stop(e.message);
  }

  let built;
  try {
    built = buildClubsFile(inputs);
  } catch (e) {
    stop(e.message);
  }
  const { file, report } = built;
  const privacy = shippedProblems(file, { texts: inputs.texts, vocabulary: inputs.directory.vocabulary });
  if (privacy.length) stop(`the privacy guard found ${privacy.length} problem(s):\n  ${privacy.slice(0, 20).join('\n  ')}`);
  const size = sizeProblems(file, inputs.previous, { acceptDrop });
  if (size.length) stop(size.join('; '));

  const text = serialize(file);
  if (!dryRun) {
    writeFileSync(`${OUT}.tmp`, text);
    renameSync(`${OUT}.tmp`, OUT);
  }
  printReport({ file, report, inputs, text, dryRun });
}

function printReport({ file, report, inputs, text, dryRun }) {
  const c = file.counts;
  const clubs = file.clubs;
  const tally = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const gz = gzipSync(Buffer.from(text)).length;
  console.log(`${dryRun ? 'would write' : 'wrote'} ${OUT.replace(`${ROOT}/`, '')}: ${c.shipped} clubs, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB (${(gz / 1024).toFixed(0)} KB gzipped)`);
  console.log(`  directory read ${file.checked}: ${c.onPage} on the page, ${c.parsed} parsed`);
  console.log(`  dropped: ${Object.entries(c.dropped).map(([k, v]) => `${k} ${v}`).join(', ')}; kept in the ${GRACE_DAYS}-day grace window: ${c.unlisted}${report.grace.expired ? `; let go after ${GRACE_DAYS} days: ${report.grace.expired}` : ''}${report.grace.untaggedMissing ? `; missing from the directory with no earlier build to ship from: ${report.grace.untaggedMissing}` : ''}`);
  for (const g of report.grace.kept) console.log(`    grace: ${g}`);
  console.log(`  kinds: ${tally(clubs.map((x) => x.kind))}`);
  console.log(`  audience: ${tally(clubs.map((x) => x.audience))}; joining: ${tally(clubs.map((x) => x.joining))}`);
  const recommendable = clubs.filter((x) => !ASKED_ONLY_KINDS.has(x.kind));
  console.log(`  asked-only kinds (social, Greek, faith, cultural, sport): ${clubs.length - recommendable.length}; recommendable kinds: ${recommendable.length}, of which ${recommendable.filter((x) => x.goals.length || x.subjects?.length || x.colleges?.length || x.lists?.length).length} carry a goal, subject, college or list`);
  console.log(`  identity ${clubs.filter((x) => x.identity).length}; national chapters ${clubs.filter((x) => x.national).length}; starters ${clubs.filter((x) => x.starter).length}; thin ${clubs.filter((x) => x.thin).length}; with does ${clubs.filter((x) => x.does).length}`);
  console.log(`  links: ${clubs.filter((x) => x.profile).length} OneIllinois profiles, ${clubs.filter((x) => !x.profile).length} the club's own website`);
  const f = report.facts;
  console.log(inputs.facts
    ? `  reading pass (facts.json, ${f.rows} rows): used ${f.used}, stale (text changed since it was read) ${f.stale}, not in the directory ${f.unknownIds}; kinds changed ${f.kindChanged}, dropped as graduate/professional ${f.droppedByReading}, goals added ${f.goalsAdded}, goals left out for no agreeing category ${f.goalsDisagreed}, does shipped ${f.doesShipped}, does left out ${f.doesDropped.length}`
    : '  reading pass: no scripts/illinois/clubs/facts.json yet, so no `does` lines and no reading-pass goals; kinds come from names, categories and the tables');
  for (const d of f.doesDropped.slice(0, 10)) console.log(`    does left out: ${d}`);
  console.log(file.calendar
    ? `  events: calendar read ${file.calendar.read}; ${report.events.joined} clubs with any event, ${clubs.filter((x) => x.events?.n120 > 0).length} with one in the last 120 days, ${clubs.filter((x) => x.events?.next?.length).length} with one coming up`
    : '  events: the calendar feed was not read (directory.json calendar is null), so no event dates ship and no club is ranked down for having none');
  const byGoal = [...GOAL_IDS].map((id) => [id, recommendable.filter((x) => x.audience !== 'check' && x.goals.some((g) => g.id === id)).length]);
  const three = byGoal.filter(([, n]) => n >= 3).length;
  console.log(`  goals with 3+ tagged clubs of a recommendable kind and audience (before the matcher's family and major evidence): ${three} of ${byGoal.length}; under 3: ${byGoal.filter(([, n]) => n < 3).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`);
  console.log(`  privacy guard: ok (whitelisted fields; no email, phone, uid=, message link; no string over ${LONGEST_STRING} characters; ${inputs.texts ? `no ${COPY_RUN}-word run from the ${inputs.texts.size} clubs' own texts` : 'texts.jsonl absent, so the copy rule could not run and no does line shipped'})`);
}

if (isMain) main();
