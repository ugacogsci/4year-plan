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
 * Output: public/illinois-sections.json
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
const BASE = 'https://courses.illinois.edu/schedule';
const DELAY = 900;
const OUT = 'public/illinois-sections.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return await res.text();
    } catch (e) { if (a === 2) return null; await sleep(3000 * (a + 1)); }
  }
  return null;
}

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

/** Newest term with a subject list. Runs in September, so fall of this year is the live one. */
async function findTerm() {
  const year = new Date().getFullYear();
  for (const y of [year + 1, year, year - 1]) {
    for (const t of ['fall', 'spring', 'summer', 'winter']) {
      const html = await get(`${BASE}/${y}/${t}`);
      await sleep(400);
      if (html && /href="\/schedule\/\d{4}\/\w+\/[A-Z]{2,4}"/.test(html)) {
        const subjects = [...new Set([...html.matchAll(new RegExp(`href="/schedule/${y}/${t}/([A-Z]{2,4})"`, 'g'))].map((m) => m[1]))];
        if (subjects.length > 50) return { year: y, term: t, subjects };
      }
    }
  }
  return null;
}

const found = await findTerm();
if (!found) { console.error('no term with a subject list'); process.exit(1); }
const { year, term, subjects } = found;
console.log(`term ${term} ${year}, ${subjects.length} subjects`);

// Resume on rerun: 9,000+ requests is long enough that losing the lot to one
// crash is a real cost, so the file is written every subject and reread here.
const done = new Map();
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    if (prev.year === year && prev.term === term) for (const c of prev.courses ?? []) done.set(c.code, c);
    if (done.size) console.log(`resuming, ${done.size} courses already captured`);
  } catch {}
}

const courses = [...done.values()];
let n = 0;
for (const [si, subj] of subjects.entries()) {
  const list = await get(`${BASE}/${year}/${term}/${subj}`);
  await sleep(DELAY);
  if (!list) { console.log(`${subj}: unreachable`); continue; }
  const nums = [...new Set([...list.matchAll(new RegExp(`href="/schedule/${year}/${term}/${subj}/(\\d{3})"`, 'g'))].map((m) => m[1]))];

  let added = 0, withRoom = 0;
  for (const num of nums) {
    const code = `${subj} ${num}`;
    if (done.has(code)) continue;
    const html = await get(`${BASE}/${year}/${term}/${subj}/${num}`);
    await sleep(DELAY);
    if (!html) continue;
    const sections = parseCourse(html);
    if (!sections.length) continue;
    const row = { code, subject: subj, number: num, sections };
    courses.push(row); done.set(code, row);
    added++; if (sections.some((s) => s.building)) withRoom++;
  }
  if (nums.length && !added && !nums.some((x) => done.has(`${subj} ${x}`))) {
    console.log(`  !! ${subj}: ${nums.length} courses listed, zero sections parsed. Parser is wrong, not the data.`);
  }
  n += added;
  console.log(`${String(si + 1).padStart(3)}/${subjects.length} ${subj.padEnd(5)} ${String(nums.length).padStart(3)} courses  +${String(added).padStart(3)} new  ${String(withRoom).padStart(3)} with a room`);

  mkdirSync('public', { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    school: 'illinois', source: `${BASE}/${year}/${term}`, year, term,
    fetchedAt: new Date().toISOString(), courses,
  }));
}

const secs = courses.flatMap((c) => c.sections);
console.log(`\n${courses.length} courses, ${secs.length} sections, ${secs.filter((s) => s.building).length} with a building, ${new Set(secs.map((s) => s.building).filter(Boolean)).size} distinct buildings`);
