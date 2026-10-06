/**
 * Illinois sections: when a course actually meets, in which building, with whom.
 *
 * This is the piece no other tenant has. UGA's class schedule is behind CAS,
 * A&M's is behind Howdy, and Illinois's own JSON API at /cisapp/ is disallowed
 * by robots.txt. But the Course Explorer's HTML at /schedule/{y}/{term}/{SUBJ}/
 * {NUM} is server-rendered and is NOT in the disallow list, and it carries
 * every field the API does:
 *
 *   <td><div>40083</div></td>                      CRN
 *   <td><div class="app-meeting">Lecture</div>      type
 *   <td><div class="app-meeting">BL1</div>          section
 *   <td data-sort="1400"><span>2:00PM</span><span>-3:15PM</span>
 *   <td><div class="app-meeting">TR</div>           days
 *   <td><div class="app-meeting">1404 Siebel Center for Comp Sci</div>
 *   <td class="instructor"><div>Evans, C<br/>Gonzalez, D</div>
 *   <dt>Part of Term:</dt><dd>1</dd>
 *
 * Part of term is not decoration at Illinois. The drop, refund, credit/no-credit
 * and grade-replacement deadlines are different for every part of term, which
 * is a documented failure mode of the answer engine at this school, so it is
 * captured per section rather than assumed to be "1".
 *
 * Output: one file per term, public/illinois-sections-<term id>.json, for
 * example public/illinois-sections-sp2027.json. Fall 2026 was crawled before
 * terms had files of their own and lives at public/illinois-sections.json,
 * which the build still reads; this script never writes that file. The first
 * version did: its output path was fixed, so a run after Spring 2027 was
 * published would have replaced the Fall 2026 data after its first subject.
 *
 *   node scripts/illinois/schedule.mjs                     newest published term
 *   node scripts/illinois/schedule.mjs --term sp2027       one named term (fa, sp, su + year)
 *   node scripts/illinois/schedule.mjs --term sp2027 --subjects CS,REL   a trial on two subjects
 *   node scripts/illinois/schedule.mjs --term sp2027 --fresh            re-crawl a finished term
 *
 * Besides the sections, the file keeps every subject's course list as the
 * subject page printed it (`listed`), which is exactly the term's offering
 * record, so offerings.mjs reads it instead of asking for the same 186 pages
 * again.
 *
 * Resuming. A full term is about 4,600 requests and two hours, so progress is
 * written after every subject to <output>.partial and a rerun picks up where
 * it stopped. The real file is replaced only when every subject has been read,
 * so a re-crawl that dies halfway leaves yesterday's complete file in place.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { politeGet, sleep } from './polite-get.mjs';

const BASE = process.env.ILLINOIS_SCHEDULE_BASE ?? 'https://courses.illinois.edu/schedule';
const DELAY = 900;

/**
 * A "busy, try later" reply (HTTP 202 with an empty body) used to be read as a
 * page with no sections, so a busy course was skipped and a busy subject came
 * back empty, with nothing in the log. politeGet backs off and retries instead,
 * and a page it still could not read is recorded as unread, not as empty.
 */
const get = (url) => politeGet(url);

const ent = (s) => s
  .replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const text = (h) => ent(String(h).replace(/<br\s*\/?>/gi, ' | ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * "1404 Siebel Center for Comp Sci" -> room 1404, building Siebel Center...
 *
 * "Location Pending" and "n.a." are the registrar's placeholders, not rooms.
 * 2,010 Fall 2026 sections carry "Location Pending", and the first pass counted
 * it as the single most common building on campus. A planner that tells a
 * student their class is in Location Pending is worse than one that says it
 * does not know yet, so these become null and the caller has to handle absence.
 */
const NO_ROOM = /^(n\.?a\.?|arr|arranged|location pending|tba|tbd|online|-)$/i;
function splitRoom(s) {
  const t = (s ?? '').trim();
  if (!t || NO_ROOM.test(t)) return { room: null, building: null };
  // Most rooms are numbers ("1404 Siebel Center") but the registrar also uses
  // word designators: "ARR Business Instructional Fac" is an arranged room and
  // "AUD Foellinger Auditorium" is the auditorium itself. Leaving them attached
  // invents buildings that do not exist, and 257 of the 437 "buildings" in the
  // first pass were artifacts of this kind plus the placeholders above.
  // A room token is anything carrying a digit, with or without a letter prefix
  // ("1404", "B226", "L440", "E-080", "G18"), optionally slash-joined when one
  // section uses several rooms ("G3/G7/G8A"), plus the word designators the
  // registrar uses. Requiring a leading digit left 23 strings like
  // "B226 Newmark Civil Engineering Bldg" and "G18 Literatures, Cultures, &
  // Ling" counted as buildings in their own right, which also double-counted
  // the real building sitting next to them.
  const m = t.match(/^((?:[A-Z]{0,3}-?[0-9][0-9A-Za-z-]*)(?:\/[0-9A-Za-z-]+)*|ARR|AUD|ARENA|LAB|RM|STU|THEAT)\s+(.+)$/i);
  const building = (m ? m[2] : t).trim();
  if (NO_ROOM.test(building)) return { room: null, building: null };
  const room = m ? m[1] : null;
  return { room: room && NO_ROOM.test(room) ? null : room, building };
}

/**
 * Column order is not stable across terms.
 *
 * Fall 2025 rendered [control, CRN, Type, Section, Time, Day, Location,
 * Instructor]. Fall 2026 inserted a status dot and a "favorite" star, moving
 * CRN from index 1 to index 3. Reading cells by position silently produced
 * zero sections for all 186 subjects, and the crawl reported success the whole
 * way. So the header row is read first and every cell is addressed by name.
 */
/** Distinct values in order, joined. "CSP, CSP" is one section, not two. */
const uniqueJoin = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))].join(', ');

/** "n.a." and "ARRANGED" are the registrar saying it is not scheduled, not a day or a time. */
const NOT_SET = /^(n\.?a\.?|arr|arranged|tba|tbd|-)$/i;
const orNull = (v) => (v && !NOT_SET.test(String(v).trim()) ? String(v).trim() : null);

function headerIndex(html) {
  const thead = html.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!thead) return null;
  const names = [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]).toLowerCase());
  const at = (n) => names.indexOf(n);
  const idx = { crn: at('crn'), type: at('type'), section: at('section'), time: at('time'), day: at('day'), location: at('location'), instructor: at('instructor'), details: at('section details') };
  return idx.crn >= 0 && idx.location >= 0 ? idx : null;
}

function parseCourse(html) {
  const idx = headerIndex(html);
  if (!idx) return [];
  const sections = [];
  const body = html.slice(html.indexOf('<tbody>'));
  for (const rowM of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = rowM[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length <= idx.location) continue;

    const crn = text(cells[idx.crn]);
    if (!/^\d{4,6}$/.test(crn)) continue;

    // Per-meeting values, one entry per <div class="app-meeting"> in the cell.
    const perMeeting = (cell) => {
      const divs = [...String(cell ?? '').matchAll(/<div[^>]*class="[^"]*app-meeting[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
      return (divs.length ? divs : [String(cell ?? '')]).map((x) => x);
    };
    const timeCells = perMeeting(cells[idx.time]);
    const dayCells = perMeeting(cells[idx.day]);
    const locCells = perMeeting(cells[idx.location]);
    const count = Math.max(timeCells.length, dayCells.length, locCells.length);
    const meetings = [];
    for (let i = 0; i < count; i++) {
      const spans = [...String(timeCells[i] ?? '').matchAll(/<span>([^<]+)<\/span>/g)].map((m) => text(m[1]));
      const where = splitRoom(text(locCells[i] ?? ''));
      const days = text(dayCells[i] ?? '') || null;
      const meeting = {
        days: orNull(days),
        start: orNull(spans[0]),
        end: orNull((spans[1] ?? '').replace(/^-/, '')),
        room: where.room,
        building: where.building,
      };
      // A meeting whose every field is a placeholder is not a meeting. Keeping
      // it put an empty row FIRST on 53 sections, and the flat fields below read
      // meetings[0], so a course that meets TR 9:30 rendered as "time arranged
      // with the instructor".
      if (!meeting.days && !meeting.start && !meeting.building) continue;
      meetings.push(meeting);
    }
    // The summary fields describe the meeting a student plans around, which is
    // the first one with a clock time. A section with an asynchronous part
    // listed first was summarised as "time arranged" while it really met TR
    // at 9:30. meetings[] still carries every part.
    const first = meetings.find((m) => m.start) ?? meetings[0]
      ?? { days: null, start: null, end: null, room: null, building: null };
    const times = [first.start, first.end].filter(Boolean);
    const place = { room: first.room, building: first.building };

    // The details cell is one run of "Label: value" pairs, so each is cut at
    // the next label rather than at the end of the cell.
    const details = text(cells[idx.details] ?? '');
    const field = (label) => {
      const m = details.match(new RegExp(label + ':\\s*(.*?)(?=\\s+[A-Z][A-Za-z ]{2,22}:|$)'));
      return m ? m[1].trim() : null;
    };

    sections.push({
      crn,
      // A section that meets twice repeats its type, its section code and its
      // instructors once per meeting, so reading the whole cell produced
      // "CSP CSP", "Discussion/Recitation Online" and an instructor list with
      // every name twice. Each meeting is read on its own and the distinct
      // values are joined.
      type: uniqueJoin(perMeeting(cells[idx.type]).map((x) => text(x).replace(/\s*\|\s*/g, ''))) || null,
      section: uniqueJoin(perMeeting(cells[idx.section]).map((x) => text(x))) || null,
      start: first.start,
      end: first.end,
      days: first.days,
      room: place.room,
      building: place.building,
      /** Every meeting, because a section can meet in two rooms in one week and
       *  "usually in Siebel" is only honest if you can see all of them. */
      meetings,
      instructors: [...new Set(
        perMeeting(cells[idx.instructor]).flatMap((x) => text(x).split(' | ')).map((x) => x.trim()).filter(Boolean),
      )],
      partOfTerm: field('Part of Term'),
      dateRange: field('Date Range'),
      availability: field('Availability'),
    });
  }
  return sections;
}

// node scripts/illinois/schedule.mjs --parse <saved.html>
// Parses one saved page and prints what it found, so a layout change is caught
// in a second rather than after a full crawl reports 186 clean empty subjects.
if (process.argv[2] === '--parse') {
  const { readFileSync } = await import('node:fs');
  const rows = parseCourse(readFileSync(process.argv[3], 'utf8'));
  console.log(`${rows.length} sections`);
  console.log(JSON.stringify(rows.slice(0, 3), null, 1));
  console.log(`with a building: ${rows.filter((r) => r.building).length}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Which term, which file
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const FRESH = args.includes('--fresh');
const SEASON_OF_ID = { fa: 'fall', sp: 'spring', su: 'summer' };
const ID_OF_SEASON = { fall: 'fa', spring: 'sp', summer: 'su' };

/**
 * The subjects a term's index page links to, or null when it links none. Live
 * and upcoming terms print their list; past terms and not-yet-published ones
 * do not, which is how the newest published term is found.
 */
async function subjectList(y, t) {
  const html = await get(`${BASE}/${y}/${t}`);
  await sleep(DELAY);
  if (!html) return null;
  const subjects = [...new Set([...html.matchAll(new RegExp(`href="/schedule/${y}/${t}/([A-Z]{2,4})/?"`, 'g'))].map((m) => m[1]))];
  return subjects.length > 50 ? subjects : null;
}

/**
 * Newest term with a subject list, newest first. In October that is next
 * spring, not this fall: Spring 2027 is published before Fall 2027, so a run
 * on 2026-10-06 finds Spring 2027 (Fall 2027 has no list until about March).
 */
async function findTerm() {
  const year = new Date().getFullYear();
  for (const y of [year + 1, year, year - 1]) {
    for (const t of ['fall', 'summer', 'spring']) {
      const subjects = await subjectList(y, t);
      if (subjects) return { year: y, term: t, subjects };
    }
  }
  return null;
}

let found;
const termArg = flag('--term');
if (termArg) {
  const m = termArg.match(/^(fa|sp|su)(\d{4})$/);
  if (!m) { console.error(`--term takes a term id like sp2027 or fa2026, not "${termArg}"`); process.exit(2); }
  const y = Number(m[2]);
  const t = SEASON_OF_ID[m[1]];
  const subjects = await subjectList(y, t);
  if (!subjects) { console.error(`${t} ${y}: the Course Explorer lists no subjects for it, so there is nothing to crawl`); process.exit(1); }
  found = { year: y, term: t, subjects };
} else {
  found = await findTerm();
}
if (!found) { console.error('no term with a subject list'); process.exit(1); }
const { year, term, subjects } = found;
const termId = `${ID_OF_SEASON[term]}${year}`;
const OUT = `public/illinois-sections-${termId}.json`;
const WORK = `${OUT}.partial`;

const only = flag('--subjects')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null;
if (only) {
  const unknown = only.filter((s) => !subjects.includes(s));
  if (unknown.length) { console.error(`not on the ${term} ${year} subject list: ${unknown.join(', ')}`); process.exit(2); }
}
const runSubjects = only ? subjects.filter((s) => only.includes(s)) : subjects;
console.log(`term ${term} ${year} (${termId}), ${subjects.length} subjects${only ? `, this run reads ${runSubjects.join(', ')}` : ''} -> ${OUT}`);

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const sameTerm = (f) => f !== null && f.year === year && f.term === term;
const work = !FRESH && existsSync(WORK) ? readJson(WORK) : null;
const out = existsSync(OUT) ? readJson(OUT) : null;
let prev = null;
if (sameTerm(work)) {
  prev = work;
  console.log(`resuming ${WORK}`);
} else if (!FRESH && sameTerm(out) && !out.complete) {
  prev = out;
  console.log(`resuming the unfinished ${OUT}`);
} else if (!FRESH && sameTerm(out) && out.complete) {
  console.log(`${OUT} is already a complete crawl of ${term} ${year}, fetched ${out.fetchedAt}. Pass --fresh to crawl it again; the file is replaced only when the new crawl finishes.`);
  process.exit(0);
}

/** Courses with at least one section row, in crawl order. */
const courses = prev?.courses ?? [];
/** SUBJ -> the course numbers its subject page listed: this term's offering record. */
const listed = prev?.listed ?? {};
/** Course pages that were read and showed no section rows. Real, but rare enough to name. */
const noSections = new Set(prev?.noSections ?? []);
const done = new Set(courses.map((c) => c.code));
const startedAt = prev?.startedAt ?? new Date().toISOString();
if (prev) console.log(`  ${done.size} courses already captured, ${Object.keys(listed).length} subject lists already read`);

const pending = (subj) => (listed[subj] ?? []).map((num) => `${subj} ${num}`).filter((code) => !done.has(code) && !noSections.has(code));

/**
 * Complete means every subject on the term's index was read and every course
 * it listed was read. Unread pages are named in the file, so a gap is a line
 * in the output rather than a missing subject nobody notices.
 */
function body() {
  const unreadSubjects = subjects.filter((s) => !listed[s]);
  const unreadCourses = subjects.flatMap(pending);
  return {
    school: 'illinois',
    source: `${BASE}/${year}/${term}`,
    year,
    term,
    startedAt,
    fetchedAt: new Date().toISOString(),
    complete: unreadSubjects.length === 0 && unreadCourses.length === 0,
    subjects,
    unread: { subjects: unreadSubjects, courses: unreadCourses },
    noSections: [...noSections],
    listed,
    courses,
  };
}
const save = () => { mkdirSync('public', { recursive: true }); writeFileSync(WORK, JSON.stringify(body())); };

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

let n = 0;
let carried = 0;
for (const [si, subj] of runSubjects.entries()) {
  const tag = `${String(si + 1).padStart(3)}/${runSubjects.length} ${subj.padEnd(5)}`;
  if (listed[subj] && pending(subj).length === 0) { carried += 1; continue; }

  if (!listed[subj]) {
    const list = await get(`${BASE}/${year}/${term}/${subj}`);
    await sleep(DELAY);
    if (!list) { console.log(`${tag} subject page could not be read; left unread for a rerun`); save(); continue; }
    listed[subj] = [...new Set([...list.matchAll(new RegExp(`href="/schedule/${year}/${term}/${subj}/(\\d{3})"`, 'g'))].map((m) => m[1]))];
    if (listed[subj].length === 0) console.log(`  !! ${subj}: the subject page lists no courses`);
  }
  const nums = listed[subj];

  let added = 0, withRoom = 0, unread = 0;
  for (const num of nums) {
    const code = `${subj} ${num}`;
    if (done.has(code) || noSections.has(code)) continue;
    const html = await get(`${BASE}/${year}/${term}/${subj}/${num}`);
    await sleep(DELAY);
    if (!html) { unread += 1; continue; }
    const sections = parseCourse(html);
    if (!sections.length) { noSections.add(code); continue; }
    const row = { code, subject: subj, number: num, sections };
    courses.push(row); done.add(code);
    added++; if (sections.some((s) => s.building)) withRoom++;
  }
  if (nums.length && nums.every((x) => noSections.has(`${subj} ${x}`))) {
    console.log(`  !! ${subj}: ${nums.length} courses listed, zero sections parsed. Parser is wrong, not the data.`);
  }
  n += added;
  console.log(`${tag} ${String(nums.length).padStart(3)} courses  +${String(added).padStart(3)} new  ${String(withRoom).padStart(3)} with a room${unread ? `  ${unread} unread` : ''}`);
  save();
}

const final = body();
writeFileSync(WORK, JSON.stringify(final));
const runUnread = runSubjects.filter((s) => !listed[s]).length + runSubjects.flatMap(pending).length;
/**
 * A finished crawl on disk is replaced only by another finished crawl. A
 * --fresh trial on a few subjects (--fresh --subjects CS) reads everything it
 * was asked for and is still a partial term, so it stays in the .partial file;
 * renaming it over the finished file left a term of one or two subjects.
 */
const keepFinished = sameTerm(out) && out.complete && !final.complete;
if (runUnread === 0 && keepFinished) {
  console.log(`\nthis run read every page it was asked for, but ${OUT} is a complete crawl (fetched ${out.fetchedAt}) and this one covers ${Object.keys(listed).length} of ${subjects.length} subjects, so ${OUT} was kept. Progress is in ${WORK}; run without --subjects to finish the new crawl.`);
} else if (runUnread === 0) {
  renameSync(WORK, OUT);
  console.log(`\nwrote ${OUT}${final.complete ? ' (complete)' : ` (${subjects.filter((s) => !listed[s]).length} of ${subjects.length} subjects not read yet)`}`);
} else {
  console.log(`\n${runUnread} pages could not be read. Progress is in ${WORK}; rerun the same command to finish. ${OUT} was not touched.`);
}
const secs = courses.flatMap((c) => c.sections);
console.log(`${courses.length} courses, ${secs.length} sections, ${secs.filter((s) => s.building).length} with a building, ${new Set(secs.map((s) => s.building).filter(Boolean)).size} distinct buildings`);
console.log(`${Object.keys(listed).length} of ${subjects.length} subject lists read, ${Object.values(listed).reduce((a, l) => a + l.length, 0)} course listings, ${noSections.size} listed courses with no section rows${carried ? `, ${carried} subjects carried from the earlier run` : ''}, ${n} courses added this run`);
