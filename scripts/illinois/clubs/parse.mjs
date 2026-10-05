/**
 * The OneIllinois directory page and events feed, as facts.
 *
 * crawl.mjs calls this; it never touches the network. Run
 *   node scripts/illinois/clubs/crawl.mjs --offline
 * to re-parse what data/clubs/raw/ holds.
 *
 * Privacy, before anything is written (DESIGN 2.3):
 *   - scrubDirectory() runs on the page in memory, straight off the wire. It
 *     drops every "Contact:" block and /send_message_boot?club_id=&uid= link,
 *     every uid= value, every <img> (logos live under /upload/, which
 *     robots.txt disallows), every script but the one that states the count,
 *     the form's _csrf token, and anything shaped like an email address or a
 *     phone number. The contact names it saw are then blanked wherever else
 *     they appear (a mission that names its president), and the result is
 *     checked: if a name, a uid=, a message link or an email survives, it
 *     throws and nothing is written. The names themselves are never stored.
 *   - scrubFeed() keeps a whitelist of iCalendar lines: the organizer's
 *     display name (the group), the CONTACT link (it carries the slug), the
 *     start time and the event type. SUMMARY, DESCRIPTION, LOCATION, UID, URL
 *     and the organizer's mailto go.
 *   Only the scrubbed copies are cached under data/clubs/raw/.
 *
 * Parse rules (DESIGN 2.4), each fixing something a prototype got wrong:
 *   - id is the numeric CampusGroups id from cb_club_<id>, as a string. 112 of
 *     the entries link their title to their own website, so they carry no
 *     slug; a slug id would lose them.
 *   - profile is https://one.illinois.edu/<Slug>/ and comes from exactly two
 *     places: an on-host href in the entry ("/<Slug>/" or "/<Slug>/home/"), or
 *     the events feed, whose CONTACT link names the slug, joined on the exact
 *     group name. It is never built from an off-site link: the prototype made
 *     https://one.illinois.edu/www.aim-illinois.com/ that way, 78 times.
 *   - url is the profile when there is one, else the club's own website. A
 *     placeholder link is never a website: example.com/.net/.org, the
 *     reserved .example, .test, .invalid and .localhost names, localhost and
 *     bare IP addresses (Animal Liberation UIUC, id 36823, listed
 *     https://example.com/ on 2026-10-04). It is dropped and reported.
 *   - categories are split by matching the page's own tag list (41 tags, read
 *     from its "Group Category" menu), never on commas: "Technology,
 *     Engineering & Mathematics" is one tag.
 *   - the count guard ties the parse to the page's own number. The prototype
 *     parsed a download that ended early, at "Women's Glee Club", and lost the
 *     alphabetical tail (Women's Undergraduate Law Society, WPGU-FM 107.1 ...)
 *     without an error.
 *
 * Outputs (data/clubs/, never committed: data/clubs/.gitignore is "*"):
 *   directory.json  facts per group, no prose: ids, names, links, tags, type,
 *                   membership facts, word counts, text hash, first/last seen
 *   texts.jsonl     { id, name, hash, mission, benefits } for the reading pass
 *   events.json     per group: event dates and event types, nothing else
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOST = 'one.illinois.edu';
export const SOURCE = { name: 'OneIllinois', url: 'https://one.illinois.edu/club_signup', page: 'https://one.illinois.edu/club_signup?view=all&', host: HOST };

/** The five group types on 2026-10-04 with their filter ids. Orange and Blue are the registration cycle, not quality. */
export const GROUP_TYPES = [
  { id: '86564', name: 'Orange Student Organization', office: false },
  { id: '86567', name: 'Blue Student Organization', office: false },
  { id: '86875', name: 'Student Services & Support', office: true },
  { id: '86879', name: 'ACES Departments & Programs', office: true },
  { id: '86873', name: 'Grainger Departments & Programs', office: true },
];
const OFFICE = new Set(GROUP_TYPES.filter((t) => t.office).map((t) => t.name));

/** The 41 tags of 2026-10-04. The page's own menu wins; a difference is printed, not fatal. */
export const KNOWN_TAGS = [
  'Advocacy & Activism', 'Agricultural', 'Athletic & Recreation', 'Business', 'Club Sports',
  'Community Service & Philanthropy', 'Education, Pedagogy & Instruction', 'Environmental & Sustainability',
  'Faith, Religion & Spirituality', 'Graduate or Professional Student Focused', 'Health & Human Sciences',
  'Health & Wellness', 'Honorary', 'Humanities', 'Identity & Culture', 'Ideology & Politics',
  'Information & Data Sciences', 'International', 'Law', 'Life & Physical Sciences', 'Media Arts',
  'Performance Arts', 'Social & Behavioral Sciences', 'Social & Leisure', 'Social Fraternities & Sororities',
  'Student Governance & Councils', 'Technology, Engineering & Mathematics', 'University Housing',
  'Veteran & Military Connected', 'Veterinary',
  '~ Affiliation: Asian American Cultural Center (AACC)',
  '~ Affiliation: Bruce D. Nesbitt African American Cultural Center (BNAACC)',
  '~ Affiliation: Diversity & Social Justice Education (DSJE)',
  '~ Affiliation: Gender & Sexuality Resource Center (GSRC)',
  '~ Affiliation: Grainger College of Engineering',
  '~ Affiliation: International Education',
  '~ Affiliation: La Casa Cultural Latina (La Casa)',
  '~ Affiliation: Native American House (NAH)',
  '~ Affiliation: Office of Civic Life (OCL)',
  '~ Affiliation: Salaam Middle East & North Africa (MENA) Cultural Center',
  "~ Affiliation: Women's Resources Center (WRC)",
];
const AFFILIATION = '~ Affiliation: ';

/** The only redirect the feed may take (DESIGN 2.2). */
export const FEED_REDIRECT = { host: 'static-prod-us-east-1.campusgroups.com', pathPrefix: '/ical/' };

const GRACE_DAYS = 120;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// text helpers

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '' };
export const decodeEntities = (s) =>
  String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/** Inline HTML to one line of text. */
const inline = (html) => decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** A mission or benefits paragraph to text, keeping its line breaks. */
function prose(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

const words = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The same name, typed two ways: curly vs straight quotes, odd spaces, case. */
export const sameName = (s) => String(s ?? '').normalize('NFKC').replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
/** Looser, for the event join's fallback only: no punctuation, "&" = "and". */
export const looseName = (s) => sameName(s).replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Personal-data shapes. EMAIL is applied everywhere, PHONE to text only (it
// needs separators, so ids and dates do not match: 6551790, 2026-10-04).
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
export const PHONE = /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 'YYYY-MM-DD' in Champaign's time zone. */
const CENTRAL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
export const centralDate = (d) => CENTRAL.format(d);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// privacy: the directory page

/**
 * Drop contact people, uids, message links, logos, scripts, the form token,
 * emails and phone numbers from the page, in memory. Throws if any survive.
 * Returns { html, report } where report holds counts only, never a name.
 */
export function scrubDirectory(raw) {
  const report = { bytesIn: raw.length, contactBlocks: 0, messageLinks: 0, names: 0, namesBlanked: 0, namesKeptAsClubNames: 0, oneWordNames: 0, uids: 0, images: 0, scripts: 0, emails: 0, phones: 0 };
  let html = raw;

  // 1. The contact people, read once, kept in memory only.
  const people = new Set();
  for (const m of html.matchAll(/<a\b[^>]*send_message[^>]*>([\s\S]*?)<\/a>/gi)) {
    const shown = inline(m[1]);
    if (shown) people.add(shown);
    const title = m[0].match(/title="Send a Message to ([^"]*)"/i);
    if (title && inline(title[1])) people.add(inline(title[1]));
  }
  report.names = people.size;

  // 2. The blocks that show them: "<div ...><p ...><span class='mdi mdi-comment-text-outline'></span> Contact: <a ...>Name</a></p></div>",
  //    then any message link the template might put elsewhere.
  html = html.replace(/<div\b[^>]*>\s*<p\b[^>]*>\s*<span\b[^>]*mdi-comment-text-outline[^>]*>\s*<\/span>\s*Contact:[\s\S]*?<\/p>\s*<\/div>/gi, () => { report.contactBlocks += 1; return ''; });
  html = html.replace(/<a\b[^>]*send_message[^>]*>[\s\S]*?<\/a>/gi, () => { report.messageLinks += 1; return ''; });
  html = html.replace(/\s(?:title|aria-label|aria-description)="Send a Message[^"]*"/gi, '');

  // 3. Logos, scripts (all but the count), styles, the CSRF token, uids.
  html = html.replace(/<img\b[^>]*>/gi, () => { report.images += 1; return ''; });
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => {
    if (/clubsCount|allClubCount/.test(m) && !/uid=|send_message|@/.test(m)) return m;
    report.scripts += 1;
    return '';
  });
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/(name="_csrf"\s+value=")[^"]*(")/gi, '$1$2');
  html = html.replace(/[?&]uid=[^&"'\s)]*/gi, () => { report.uids += 1; return ''; });
  html = html.replace(/(["'(])\/upload\/[^"')]*/gi, '$1');

  // 4. The contact names wherever else they appear. Only names of two or more
  //    words are searched for; a one-word display name ("Admin") is gone with
  //    its block and would blank real words if searched. A display name that
  //    is part of a group's own name is the group's account, not a person.
  const groupNames = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => sameName(inline(m[1])));
  const searchable = [];
  for (const p of people) {
    if (p.split(/\s+/).length < 2) { report.oneWordNames += 1; continue; }
    const key = sameName(p);
    if (groupNames.some((g) => g.includes(key))) { report.namesKeptAsClubNames += 1; continue; }
    searchable.push(p);
  }
  const NAMES = searchable.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${searchable.sort((a, b) => b.length - a.length).map((n) => escapeRe(n).replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
    : null;
  // Each text node and each double-quoted attribute value is decoded first, so
  // "jdoe&#64;illinois.edu" or "Jos&eacute; ..." is caught too, and re-encoded
  // only when something was blanked; markup itself is left alone.
  const clean = (raw, isText) => {
    const text = decodeEntities(raw);
    let t = text.replace(EMAIL, () => { report.emails += 1; return '[email]'; });
    if (isText) t = t.replace(PHONE, () => { report.phones += 1; return '[phone]'; });
    if (NAMES) t = t.replace(NAMES, () => { report.namesBlanked += 1; return '[name]'; });
    if (t === text) return raw;
    const enc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return isText ? enc : enc.replace(/"/g, '&quot;');
  };
  html = html.replace(/>([^<]+)</g, (_, t) => `>${clean(t, true)}<`);
  html = html.replace(/(\s[\w:-]+=")([^"]*)(")/g, (_, a, v, b) => `${a}${clean(v, false)}${b}`);
  html = html.replace(EMAIL, () => { report.emails += 1; return '[email]'; });

  // 5. Fail closed, on the decoded page as well as the markup.
  const left = [];
  const decoded = decodeEntities(html);
  if (/send_message/i.test(html)) left.push('a send_message link');
  if (/[?&]uid=/i.test(decoded)) left.push('a uid= value');
  if (/Send a Message/i.test(decoded)) left.push('a "Send a Message" label');
  if (/<img\b/i.test(html)) left.push('an <img>');
  if (new RegExp(EMAIL.source).test(decoded)) left.push('an email address');
  if (NAMES && new RegExp(NAMES.source, 'iu').test(decoded)) left.push('a contact name');
  // A template change could show contacts some other way, with no message
  // link to learn the names from. Missions rarely say "Contact:"; hundreds of
  // them means the contact blocks were not recognized.
  const labels = (decoded.match(/\bContact\s*:/g) ?? []).length;
  if (labels > 25) left.push(`${labels} "Contact:" labels (contacts shown in a way this scrubber does not know)`);
  if (left.length) throw new Error(`privacy scrub left ${left.join(', ')} in the directory page; nothing was written`);
  report.bytesOut = html.length;
  return { html, report };
}

// ---------------------------------------------------------------------------
// privacy: the events feed

/** RFC 5545 unfolding: a line break followed by one space or tab continues the line. */
const unfold = (text) => String(text ?? '').replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '').split(/\r\n|\n|\r/);

/** 'NAME;P1=a;P2="b:c":value' -> { name, params: {P1: 'a', P2: 'b:c'}, value }, quotes respected; null without a ':'. */
function contentLine(line) {
  const parts = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted || (c !== ';' && c !== ':')) continue;
    parts.push(line.slice(start, i));
    start = i + 1;
    if (c !== ':') continue;
    const [name, ...ps] = parts;
    const params = {};
    for (const p of ps) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '').replace(/\^'/g, '"').replace(/\^n/g, ' ').replace(/\^\^/g, '^');
    }
    return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
  }
  return null;
}

const quoteParam = (s) => `"${String(s).replace(/\^/g, '^^').replace(/"/g, "^'")}"`;

/**
 * Keep only what DESIGN 2.3 allows from the feed: ORGANIZER's CN (the group
 * name, mailto dropped), CONTACT (the slug), DTSTART and the event_type
 * CATEGORIES. Returns { ics, report }.
 */
export function scrubFeed(raw) {
  const out = [];
  const report = { bytesIn: raw.length, events: 0, linesIn: 0, linesKept: 0 };
  let inEvent = false;
  let depth = 0; // nested components inside a VEVENT (VALARM) are dropped whole
  for (const line of unfold(raw)) {
    if (!line) continue;
    report.linesIn += 1;
    if (/^BEGIN:VEVENT$/i.test(line)) { inEvent = true; depth = 0; out.push('BEGIN:VEVENT'); report.events += 1; continue; }
    if (/^END:VEVENT$/i.test(line)) { inEvent = false; out.push('END:VEVENT'); continue; }
    if (!inEvent) {
      if (/^(BEGIN|END):VCALENDAR$/i.test(line) || /^(VERSION|PRODID|X-WR-CALNAME|X-WR-TIMEZONE):/i.test(line)) out.push(line);
      continue;
    }
    if (/^BEGIN:/i.test(line)) { depth += 1; continue; }
    if (/^END:/i.test(line)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    const cl = contentLine(line);
    if (!cl) continue;
    if (cl.name === 'ORGANIZER' && cl.params.CN) out.push(`ORGANIZER;CN=${quoteParam(cl.params.CN.replace(EMAIL, '').trim())}:`);
    else if (cl.name === 'CONTACT') {
      const m = cl.value.match(/^https:\/\/one\.illinois\.edu\/([A-Za-z0-9_-]+)\/rsvp_boot\b/);
      if (m) out.push(`CONTACT:https://one.illinois.edu/${m[1]}/`);
    } else if (cl.name === 'DTSTART') out.push(line);
    else if (cl.name === 'CATEGORIES' && /event_type/i.test(cl.params['X-CG-CATEGORY'] ?? '')) out.push(`CATEGORIES;X-CG-CATEGORY=event_type:${cl.value.replace(EMAIL, '')}`);
  }
  const ics = `${out.join('\r\n')}\r\n`;
  if (new RegExp(EMAIL.source).test(ics) || /mailto:|^(SUMMARY|DESCRIPTION|LOCATION|UID|URL)[;:]/im.test(ics)) throw new Error('feed scrub left an address or a text field; nothing was written');
  report.linesKept = out.length;
  report.bytesOut = ics.length;
  return { ics, report };
}

/** The scrubbed feed -> [{ name, slug, date: 'YYYY-MM-DD' (Central), type }]. */
export function parseFeed(ics) {
  const events = [];
  let calendar = null;
  let ev = null;
  const counts = { events: 0, noOrganizer: 0, noStart: 0 };
  for (const line of unfold(ics)) {
    if (/^BEGIN:VEVENT$/i.test(line)) { ev = {}; continue; }
    if (/^END:VEVENT$/i.test(line)) {
      counts.events += 1;
      if (!ev.date) counts.noStart += 1;
      else if (!ev.name && !ev.slug) counts.noOrganizer += 1;
      else events.push(ev);
      ev = null;
      continue;
    }
    const cl = contentLine(line);
    if (!cl) continue;
    if (!ev) { if (cl.name === 'X-WR-CALNAME') calendar = cl.value; continue; }
    if (cl.name === 'ORGANIZER') ev.name = cl.params.CN?.trim() || null;
    else if (cl.name === 'CONTACT') ev.slug = cl.value.match(/^https:\/\/one\.illinois\.edu\/([A-Za-z0-9_-]+)\//)?.[1] ?? null;
    else if (cl.name === 'CATEGORIES') ev.type = cl.value.trim() || null;
    else if (cl.name === 'DTSTART') ev.date = startDate(cl);
  }
  return { calendar, events, counts };
}

/** DTSTART in its three shapes: UTC ("...Z"), local with TZID (or floating), or a date. */
function startDate(cl) {
  const v = cl.value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) return centralDate(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T\d{6})?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ---------------------------------------------------------------------------
// the directory page

/** "/<Slug>/" or "/<Slug>/home/" on one.illinois.edu -> the slug; anything else -> null. A slug never has a dot. */
export function profileSlug(href) {
  let u;
  try { u = new URL(String(href).trim(), `https://${HOST}/`); } catch { return null; }
  if (u.host !== HOST || u.search) return null;
  return u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(?:home\/?)?$/)?.[1] ?? null;
}

/**
 * A host that is never a club's real site: the names reserved for examples
 * and tests (RFC 2606, RFC 6761: example.com/.net/.org, .example, .test,
 * .invalid, .localhost), localhost, and bare IP addresses.
 */
export function placeholderHost(hostname) {
  const h = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return (
    h === 'localhost' ||
    /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/.test(h) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ||
    h.startsWith('[')
  );
}

/** True when href is an http(s) link to a placeholder host (placeholderHost). */
export function placeholderLink(href) {
  let u;
  try { u = new URL(String(href).trim()); } catch { return false; }
  return /^https?:$/.test(u.protocol) && placeholderHost(u.hostname);
}

/** An off-site http(s) link, trimmed, or null. Never a placeholder (placeholderHost). */
export function offSite(href) {
  let u;
  try { u = new URL(String(href).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.host === HOST || !u.host.includes('.') || placeholderHost(u.hostname)) return null;
  return String(href).trim();
}

/**
 * Split "Agricultural, Technology, Engineering & Mathematics, ~ Affiliation: X"
 * by the tag list, longest tag first, never on commas. Unknown text is kept
 * aside so the caller can report it.
 */
export function splitTags(rest, vocabulary) {
  const tags = [];
  const unknown = [];
  const vocab = [...vocabulary].sort((a, b) => b.length - a.length);
  let s = String(rest ?? '').trim();
  while (s) {
    const hit = vocab.find((t) => s.startsWith(t) && (s.length === t.length || /^\s*,/.test(s.slice(t.length))));
    const take = hit ?? s.match(/^[^,]*/)[0];
    (hit ? tags : unknown).push(take.trim());
    s = s.slice(take.length).replace(/^\s*,\s*/, '').trim();
  }
  return { tags, unknown: unknown.filter(Boolean) };
}

/** The page's own statements: its count, its tag list and its group types. */
export function pageFacts(html) {
  const stated = [];
  const loadAll = html.match(/Load all\s+([\d,]+)\s+groups/i);
  if (loadAll) stated.push({ from: 'Load all N groups', n: +loadAll[1].replace(/,/g, '') });
  const header = html.match(/getElementById\('clubsCount'\)\.innerHTML\s*=\s*'\((\d+)\)'/);
  if (header) stated.push({ from: "header count '(N)'", n: +header[1] });
  const all = html.match(/allClubCountEl\.innerHTML\s*=\s*'(\d+)'/);
  if (all) stated.push({ from: "'All' filter badge", n: +all[1] });

  const types = [];
  for (const m of html.matchAll(/href="club_signup\?group_type=(\d+)&(?:amp;)?category_tags="[^>]*>([\s\S]*?)<\/a>/g)) {
    const badge = m[2].match(/<span class="badge[^"]*">\s*([\d,]+)\s*<\/span>/);
    types.push({ id: m[1], name: inline(m[2].replace(/<span class="badge[\s\S]*?<\/span>/, '')), count: badge ? +badge[1].replace(/,/g, '') : null });
  }
  if (types.length && types.every((t) => t.count != null)) stated.push({ from: 'sum of the group-type badges', n: types.reduce((a, t) => a + t.count, 0) });

  const select = html.match(/<select\b[^>]*id="select_category_tags"[^>]*>([\s\S]*?)<\/select>/);
  const vocabulary = select ? [...select[1].matchAll(/<option value="(\d+)">([\s\S]*?)<\/option>/g)].map((m) => inline(m[2])) : [];
  return { stated, types, vocabulary, complete: /<\/html>/i.test(html.slice(-4096)) };
}

/** Every group entry on the page, as facts plus its own text (kept apart). */
export function parseDirectory(html) {
  const page = pageFacts(html);
  const vocabulary = page.vocabulary.length ? page.vocabulary : KNOWN_TAGS;
  const typeNames = [...new Set([...page.types.map((t) => t.name), ...GROUP_TYPES.map((t) => t.name)])].sort((a, b) => b.length - a.length);
  const groups = [];
  const problems = [];
  const chunks = html.split(/<li\b[^>]*\bclass="list-group-item"[^>]*>/).slice(1);
  for (const raw of chunks) {
    const it = raw.slice(0, raw.indexOf('</fieldset>') >= 0 ? raw.indexOf('</fieldset>') : raw.length);
    const id = it.match(/\bid="cb_club_(\d+)"/)?.[1];
    if (!id) { problems.push({ problem: 'entry without a cb_club_ id' }); continue; }
    const h2 = it.match(/<h2\b[^>]*class="media-heading[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
    const name = inline(h2?.[1]) || inline(it.match(/<legend>\s*<span class="sr-only">([\s\S]*?)<\/span>/)?.[1]);
    if (!name) { problems.push({ id, problem: 'no name' }); continue; }

    // Links: the title's href and the "Website" link. On-host -> profile; off-site -> website.
    const hrefs = [];
    const titleHref = h2?.[1].match(/<a\b[^>]*href="([^"]*)"/)?.[1];
    if (titleHref) hrefs.push(decodeEntities(titleHref));
    const site = it.match(/<a\b[^>]*href="([^"]*)"[^>]*>\s*<span class="mdi mdi-web"><\/span>\s*Website\s*<\/a>/);
    if (site) hrefs.push(decodeEntities(site[1]));
    let slug = null;
    let website = null;
    const odd = [];
    const placeholders = [];
    for (const h of hrefs) {
      const s = profileSlug(h);
      if (s) { slug ??= s; continue; }
      const w = offSite(h);
      if (w) { website ??= w; continue; }
      if (placeholderLink(h)) { if (!placeholders.includes(h.trim())) placeholders.push(h.trim()); continue; }
      if (h.trim()) odd.push(h.trim());
    }
    if (odd.length) problems.push({ id, name, problem: 'a link that is neither a profile nor a website', links: odd });
    if (placeholders.length) problems.push({ id, name, problem: 'a placeholder link (a reserved or test address), dropped', links: placeholders });

    const grey = inline(it.match(/<p class="h5 media-heading grey-element">([\s\S]*?)<\/p>/)?.[1]);
    const type = typeNames.find((t) => grey === t || grey.startsWith(`${t} - `)) ?? null;
    if (!type) problems.push({ id, name, problem: 'unknown group type', text: grey.slice(0, 80) });
    const { tags, unknown } = splitTags(type ? grey.slice(type.length).replace(/^\s*-\s*/, '') : '', vocabulary);
    if (unknown.length) problems.push({ id, name, problem: 'tag text outside the tag list', unknown });

    const restriction = inline(it.match(new RegExp(`id="email_restriction_${id}"[^>]*>([\\s\\S]*?)</div>`))?.[1]);
    const desc = it.match(/<div class="desc-block[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '';
    // The clubs' own words, for texts.jsonl only. Blanked again after decoding, belt and braces.
    const own = (s) => prose(s).replace(EMAIL, '[email]').replace(PHONE, '[phone]');
    const mission = own(it.match(new RegExp(`id="club_${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1]?.replace(/^\s*<strong>\s*Mission\s*<\/strong>\s*(<br\s*\/?>)?/i, ''));
    const benefits = own(it.match(new RegExp(`id="club_whatwedo_${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1]?.replace(/^\s*<strong>\s*Membership Benefits\s*<\/strong>\s*(<br\s*\/?>)?/i, ''));

    groups.push({
      id,
      name,
      type,
      office: OFFICE.has(type),
      slug,
      website,
      placeholder: placeholders.length > 0,
      categories: tags.filter((t) => !t.startsWith(AFFILIATION)),
      affiliations: tags.filter((t) => t.startsWith(AFFILIATION)).map((t) => t.slice(AFFILIATION.length)),
      membershipClosed: /membership is closed|data-original-title="Membership Closed"/i.test(it),
      restriction: /restricted to/i.test(restriction) ? restriction : null,
      membershipTerm: inline(desc.match(/<p>([\s\S]*?)<\/p>/)?.[1]) || null,
      dues: inline(desc.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]) || null,
      mission,
      benefits,
    });
  }
  const seen = new Map();
  for (const g of groups) {
    if (seen.has(g.id)) problems.push({ id: g.id, name: g.name, problem: 'duplicate id' });
    seen.set(g.id, g);
  }
  return { page, vocabulary, groups: [...seen.values()], problems };
}

// ---------------------------------------------------------------------------
// the count guard

/**
 * DESIGN 2.4: the parse must match the page's own number (short by no more
 * than 0.5%), the number must be at least 900 (600 from Jun 1 to Sep 15,
 * until the June drop is measured), all five group types must be there, and
 * the count must be within 15% of the last parse unless --accept-drop.
 */
export function countGuard({ page, parsed, byType, previous, checked, acceptDrop }) {
  const failures = [];
  const warnings = [];
  const ns = [...new Set(page.stated.map((s) => s.n))];
  const onPage = page.stated[0]?.n ?? null;
  if (onPage == null) failures.push("the page's own group count was not found (template changed?)");
  if (ns.length > 1) warnings.push(`the page states different counts: ${page.stated.map((s) => `${s.n} (${s.from})`).join(', ')}`);
  if (!page.complete) failures.push('the page ended before </html> (a cut-off download)');
  if (onPage != null) {
    if (parsed < onPage * 0.995) failures.push(`parsed ${parsed} groups, the page says ${onPage}: ${onPage - parsed} missing`);
    else if (parsed > onPage * 1.005) failures.push(`parsed ${parsed} groups, more than the page's ${onPage}`);
    else if (parsed !== onPage) warnings.push(`parsed ${parsed} groups, the page says ${onPage}`);
    const md = checked.slice(5);
    const floor = md >= '06-01' && md <= '09-15' ? 600 : 900;
    if (onPage < floor) failures.push(`the page lists ${onPage} groups, under the floor of ${floor}`);
  }
  for (const t of GROUP_TYPES) if (!byType[t.name]) failures.push(`no group of type "${t.name}"`);
  if (previous && previous > 0 && Math.abs(parsed - previous) / previous > 0.15) {
    const msg = `parsed ${parsed} groups, ${previous} last time (more than 15% apart)`;
    if (acceptDrop) warnings.push(`${msg}; accepted with --accept-drop`);
    else failures.push(`${msg}; pass --accept-drop if that is real`);
  }
  return { ok: failures.length === 0, onPage, failures, warnings };
}

// ---------------------------------------------------------------------------
// the feed join

/**
 * Give profiles to the groups the page links off-site, from the feed (exact
 * name, one slug, not another group's), then hang every event on its group:
 * by slug first, by the loose name when the slug is unknown.
 * `today` is the day the page was read, so a re-parse gives the same numbers.
 */
export function joinFeed(groups, events, today) {
  const bySlug = new Map();
  for (const g of groups) if (g.slug) bySlug.set(g.slug.toLowerCase(), g);
  const byName = new Map();
  for (const g of groups) {
    const k = sameName(g.name);
    byName.set(k, byName.has(k) ? null : g); // null = two groups share the name
  }

  // Slugs the feed shows under each exact name.
  const feedSlugs = new Map();
  for (const e of events) {
    if (!e.name || !e.slug) continue;
    const k = sameName(e.name);
    if (!feedSlugs.has(k)) feedSlugs.set(k, new Set());
    feedSlugs.get(k).add(e.slug);
  }
  const recovered = { profiles: 0, ambiguous: 0, slugTaken: 0 };
  for (const g of groups) {
    if (g.slug) continue;
    const slugs = feedSlugs.get(sameName(g.name));
    if (!slugs || byName.get(sameName(g.name)) !== g) continue;
    if (slugs.size !== 1) { recovered.ambiguous += 1; continue; }
    const [slug] = slugs;
    if (bySlug.has(slug.toLowerCase())) { recovered.slugTaken += 1; continue; }
    g.slug = slug;
    g.slugFrom = 'feed';
    bySlug.set(slug.toLowerCase(), g);
    recovered.profiles += 1;
  }

  const byLoose = new Map();
  for (const g of groups) {
    const k = looseName(g.name);
    byLoose.set(k, byLoose.has(k) ? null : g);
  }
  const perGroup = new Map();
  const counts = { events: events.length, bySlug: 0, byName: 0, unjoined: 0, unjoinedOrganizers: 0 };
  const unjoinedOrganizers = new Set();
  for (const e of events) {
    let g = e.slug ? bySlug.get(e.slug.toLowerCase()) : null;
    if (g) counts.bySlug += 1;
    else if (e.name && (g = byLoose.get(looseName(e.name)))) counts.byName += 1;
    if (!g) { counts.unjoined += 1; unjoinedOrganizers.add(e.slug ?? e.name); continue; }
    if (!perGroup.has(g.id)) perGroup.set(g.id, []);
    perGroup.get(g.id).push([e.date, e.type ?? null]);
  }
  counts.unjoinedOrganizers = unjoinedOrganizers.size;

  const since = addDays(today, -120);
  const clubs = {};
  for (const [id, list] of [...perGroup.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[1]).localeCompare(String(b[1]))));
    const past = list.filter(([d]) => d < today);
    const next = [...new Set(list.filter(([d]) => d >= today).map(([d]) => d))].slice(0, 3);
    clubs[id] = {
      last: past.length ? past[past.length - 1][0] : null,
      next,
      n120: past.filter(([d]) => d >= since).length,
      events: list,
    };
  }
  return { clubs, counts, recovered };
}

// ---------------------------------------------------------------------------
// the whole parse

/**
 * Parse the scrubbed page and feed, run the guard, join, and return what
 * writeOutputs() writes. Nothing here reads or writes files except `previous`,
 * which the caller passes in (the last directory.json, or null).
 */
export function parseAll({ html, htmlMeta, ics, icsMeta, previous, acceptDrop = false }) {
  const checked = centralDate(new Date(htmlMeta.fetchedAt));
  const dir = parseDirectory(html);
  const byType = {};
  for (const g of dir.groups) byType[g.type ?? 'unknown'] = (byType[g.type ?? 'unknown'] ?? 0) + 1;
  const guard = countGuard({ page: dir.page, parsed: dir.groups.length, byType, previous: previous?.counts?.parsed ?? null, checked, acceptDrop });

  const feed = ics ? parseFeed(ics) : null;
  // Event dates are judged from the day the calendar was read (the ClubEvents
  // fields say "as of the day the calendar was read"), which is the day the
  // page was read when one run reads both. Fixed by the feed's own stamp, so a
  // re-parse gives the same numbers.
  const eventsDay = icsMeta?.fetchedAt ? centralDate(new Date(icsMeta.fetchedAt)) : checked;
  const join = feed ? joinFeed(dir.groups, feed.events, eventsDay) : { clubs: {}, counts: null, recovered: null };

  const prevById = new Map((previous?.groups ?? []).map((g) => [g.id, g]));
  const groups = dir.groups.map((g) => {
    const profile = g.slug ? `https://${HOST}/${g.slug}/` : null;
    const hash = sha16(`${g.name}\n${g.mission}\n${g.benefits}`);
    const ev = join.clubs[g.id];
    return {
      id: g.id,
      name: g.name,
      type: g.type,
      office: g.office,
      url: profile ?? g.website ?? null,
      ...(profile ? { profile, profileFrom: g.slugFrom ?? 'page' } : {}),
      ...(g.website ? { website: g.website } : {}),
      categories: g.categories,
      ...(g.affiliations.length ? { affiliations: g.affiliations } : {}),
      membershipClosed: g.membershipClosed,
      ...(g.restriction ? { restriction: g.restriction } : {}),
      membershipTerm: g.membershipTerm,
      ...(g.dues ? { dues: g.dues } : {}),
      missionWords: words(g.mission),
      benefitsWords: words(g.benefits),
      hash,
      ...(ev ? { events: { last: ev.last, next: ev.next, n120: ev.n120 } } : {}),
      firstSeen: prevById.get(g.id)?.firstSeen ?? checked,
      lastSeen: checked,
    };
  });
  const texts = dir.groups.map((g, i) => ({ id: g.id, name: g.name, hash: groups[i].hash, mission: g.mission, benefits: g.benefits }));

  // Groups the last parse had and this one does not, kept for the 120-day grace window (DESIGN 2.5).
  const now = new Set(groups.map((g) => g.id));
  const missing = [...(previous?.groups ?? []), ...(previous?.missing ?? [])]
    .filter((g) => !now.has(g.id) && g.lastSeen >= addDays(checked, -GRACE_DAYS))
    .filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i);

  const clubs = groups.filter((g) => !g.office);
  const vocabulary = {
    topical: dir.vocabulary.filter((t) => !t.startsWith(AFFILIATION)),
    affiliations: dir.vocabulary.filter((t) => t.startsWith(AFFILIATION)).map((t) => t.slice(AFFILIATION.length)),
    added: dir.vocabulary.filter((t) => !KNOWN_TAGS.includes(t)),
    gone: KNOWN_TAGS.filter((t) => !dir.vocabulary.includes(t)),
  };
  const counts = {
    onPage: guard.onPage,
    onPageFrom: dir.page.stated.map((s) => `${s.n} (${s.from})`),
    parsed: groups.length,
    byType,
    offices: groups.length - clubs.length,
    clubs: clubs.length,
    links: {
      profileFromPage: groups.filter((g) => g.profileFrom === 'page').length,
      profileFromFeed: groups.filter((g) => g.profileFrom === 'feed').length,
      websiteOnly: groups.filter((g) => !g.profile && g.website).length,
      websiteHttp: groups.filter((g) => (g.website ?? '').startsWith('http:')).length,
      placeholdersDropped: dir.groups.filter((g) => g.placeholder).length,
      none: groups.filter((g) => !g.url).length,
    },
    clubLinks: {
      profile: clubs.filter((g) => g.profile).length,
      websiteOnly: clubs.filter((g) => !g.profile && g.website).length,
      none: clubs.filter((g) => !g.url).length,
    },
    membershipClosed: groups.filter((g) => g.membershipClosed).length,
    restricted: groups.filter((g) => g.restriction).length,
    noCategories: groups.filter((g) => !g.categories.length).length,
    noMission: groups.filter((g) => !g.missionWords).length,
    missionWordsMedian: median(groups.map((g) => g.missionWords).filter(Boolean)),
    events: {
      day: feed ? eventsDay : null,
      groupsWithAny: groups.filter((g) => g.events).length,
      groupsN120: groups.filter((g) => g.events?.n120 > 0).length,
      clubsN120: clubs.filter((g) => g.events?.n120 > 0).length,
      clubsUpcoming: clubs.filter((g) => g.events?.next?.length).length,
      clubsActive: clubs.filter((g) => g.events?.n120 > 0 || g.events?.next?.length).length,
    },
    missing: missing.length,
    problems: dir.problems.length,
  };

  const dates = feed ? feed.events.map((e) => e.date).sort((a, b) => a.localeCompare(b)) : [];
  const calendar = icsMeta && feed ? {
    url: icsMeta.url,
    finalUrl: icsMeta.finalUrl,
    lastModified: icsMeta.lastModified ?? null,
    etag: icsMeta.etag ?? null,
    read: centralDate(new Date(icsMeta.fetchedAt)),
    name: feed.calendar,
    events: feed.counts.events,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  } : null;

  const directory = {
    version: 1,
    source: SOURCE,
    checked,
    fetchedAt: htmlMeta.fetchedAt,
    calendar,
    guard,
    counts,
    vocabulary,
    groupTypes: dir.page.types.map((t) => ({ ...t, office: OFFICE.has(t.name) })),
    problems: dir.problems,
    groups,
    missing,
  };
  const eventsFile = feed ? { version: 1, today: eventsDay, calendar, counts: join.counts, recovered: join.recovered, clubs: join.clubs } : null;
  return { directory, texts, events: eventsFile, guard };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ---------------------------------------------------------------------------
// writing

/** Last-resort check on everything about to be written: no address, number, uid or message link. */
export function assertClean(label, text, { allowProse = false } = {}) {
  const bad = [];
  if (new RegExp(EMAIL.source).test(text)) bad.push('an email address');
  if (/[?&]uid=/i.test(text)) bad.push('uid=');
  if (/send_message/i.test(text)) bad.push('send_message');
  if (!allowProse && new RegExp(PHONE.source).test(text)) bad.push('a phone number');
  if (bad.length) throw new Error(`${label} would hold ${bad.join(', ')}; nothing was written`);
}

const writeAtomic = (file, text) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};

/** Write directory.json, texts.jsonl and (when there is a feed) events.json into dir. */
export function writeOutputs(dir, { directory, texts, events }) {
  const d = `${JSON.stringify(directory, null, 1)}\n`;
  const t = texts.map((x) => JSON.stringify(x)).join('\n') + '\n';
  const e = events ? `${JSON.stringify(events)}\n` : null;
  assertClean('directory.json', d);
  // texts.jsonl is the clubs' own words for the reading pass; its emails and
  // phone numbers are already blanked, and a bare 3-3-4 run in prose ("Room
  // 101 ...") is not worth failing a build over, so only the hard rules apply.
  assertClean('texts.jsonl', t, { allowProse: true });
  if (e) assertClean('events.json', e);
  writeAtomic(join(dir, 'directory.json'), d);
  writeAtomic(join(dir, 'texts.jsonl'), t);
  if (e) writeAtomic(join(dir, 'events.json'), e);
  return { directory: Buffer.byteLength(d), texts: Buffer.byteLength(t), events: e ? Buffer.byteLength(e) : 0 };
}

/** The last directory.json, or null. */
export function readPrevious(dir) {
  const f = join(dir, 'directory.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
