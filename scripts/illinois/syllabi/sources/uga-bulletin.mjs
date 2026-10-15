/**
 * UGA's Bulletin publishes, on every course's own page, the syllabi its
 * instructors uploaded to the campus Syllabus System, with no login:
 *
 *   https://bulletin.uga.edu/Course/Details/{id}
 *     <select id="facultyInstructor"> one <option value="{syllabusId}"> per
 *     uploaded syllabus, labelled with the instructor ("Begley, James TR 11:35am-12:55pm")
 *   https://bulletin.uga.edu/Course/DownloadSyllabusFile?ID={id}&IDSyllabus={syllabusId}
 *     the file itself (PDF or Word), named like "CHEM 1211 Syllabus Spring 2025.pdf"
 *
 * University policy requires a syllabus for each course to be online, so the
 * store is large: CHEM 1211 alone lists a dozen. The adapter walks the
 * planner's own UGA catalog (data/uga-courses.json), undergraduate courses
 * first and lower-division ones before upper-division, because those sit on
 * the most plans, and downloads up to MAX_PER_COURSE files per course.
 *
 * robots.txt on bulletin.uga.edu is a 404, so the host's only rule is the
 * house pace (one request at a time, 1.1 s apart). Everything is cached, so a
 * run that is stopped picks up where it left off at no cost to the host.
 *
 *   UGA_SYLLABI_LIMIT=40   read the first 40 courses only (a pilot)
 *   UGA_SYLLABI_ALL=1      include graduate courses (5000 and up)
 *   UGA_SYLLABI_LEVELS=1,2 only these thousands (default 1,2,3,4 in that order)
 */
import { lookup } from '../lib/cache.mjs';
import { loadUgaCatalog } from '../lib/uga-catalog.mjs';
import { termMentions } from '../lib/terms.mjs';
import { readFileSync } from 'node:fs';

export const id = 'uga-bulletin';
const DETAILS = 'https://bulletin.uga.edu/Course/Details/';
const DOWNLOAD = 'https://bulletin.uga.edu/Course/DownloadSyllabusFile';
const MAX_PER_COURSE = Number(process.env.UGA_SYLLABI_MAX_PER_COURSE ?? 10);

const filenameOf = (disposition) => String(disposition ?? '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? null;

/** The <option>s of the syllabus picker: [{ syllabusId, label }]. */
export function parseSyllabusOptions(html) {
  const sel = String(html).match(/<select[^>]*id="facultyInstructor"[^>]*>([\s\S]*?)<\/select>/i);
  if (!sel) return [];
  const out = [];
  for (const m of sel[1].matchAll(/<option\s+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    out.push({ syllabusId: m[1], label });
  }
  return out;
}

/** "Begley, James TR 11:35am-12:55pm, 2:55-4:15pm" -> "Begley, James". */
export function instructorOf(label) {
  return String(label).replace(/\s+(?:[MTWRFSU]{1,5}\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm).*$/i, '').replace(/\s+[MTWRFSU]{1,5}\s*$/, '').trim() || null;
}

function courseOrder() {
  const cat = loadUgaCatalog();
  const all = process.env.UGA_SYLLABI_ALL === '1';
  const levels = (process.env.UGA_SYLLABI_LEVELS ?? '1,2,3,4').split(',').map((s) => Number(s.trim())).filter(Boolean);
  const rows = cat.all().filter((c) => c.id && (all || c.undergraduate));
  const rank = (c) => {
    const k = Math.floor(c.level / 1000);
    const i = levels.indexOf(k);
    return i === -1 ? 99 : i;
  };
  rows.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  const limit = Number(process.env.UGA_SYLLABI_LIMIT ?? 0);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export async function run({ get, log }) {
  const rows = [];
  const courses = courseOrder();
  let pages = 0;
  let withSyllabi = 0;
  let options = 0;
  const started = Date.now();
  for (const c of courses) {
    const detailsUrl = `${DETAILS}${c.id}`;
    const page = await get(detailsUrl, { source: id, accept: 'text/html', maxAgeDays: 21 });
    pages += 1;
    if (pages % 100 === 0) {
      const mins = Math.round((Date.now() - started) / 60000);
      log(`${id}: ${pages} of ${courses.length} course pages, ${withSyllabi} with syllabi, ${rows.length} files, ${mins} min`);
    }
    if (page.outcome !== 'ok') continue;
    const rec = lookup(page.finalUrl ?? detailsUrl) ?? lookup(detailsUrl);
    if (!rec?.bodyPath) continue;
    let html;
    try { html = readFileSync(rec.bodyPath, 'utf8'); } catch { continue; }
    const opts = parseSyllabusOptions(html);
    if (opts.length === 0) continue;
    withSyllabi += 1;
    options += opts.length;
    for (const o of opts.slice(0, MAX_PER_COURSE)) {
      const url = `${DOWNLOAD}?ID=${c.id}&IDSyllabus=${o.syllabusId}`;
      const g = await get(url, { source: id });
      if (g.outcome !== 'ok') continue;
      const name = filenameOf(g.disposition);
      const term = name ? termMentions(name)[0]?.term ?? null : null;
      rows.push({
        source: id, url, finalUrl: g.finalUrl ?? url, sha: g.sha, status: g.status, outcome: g.outcome,
        contentType: g.contentType ?? null, disposition: g.disposition ?? null,
        hintCodes: [c.code], hintTerm: term, hintSection: null, kindHint: 'syllabus',
        instructorHint: instructorOf(o.label), foundVia: detailsUrl, fetchedAt: g.fetchedAt ?? null,
      });
    }
  }
  const limited = Number(process.env.UGA_SYLLABI_LIMIT ?? 0) > 0;
  log(`${id}: done, ${pages} course pages, ${withSyllabi} with syllabi (${options} listed), ${rows.length} files fetched`);
  return { rows, complete: !limited, note: `${pages} Bulletin course pages${limited ? ' (limited pilot)' : ''}; up to ${MAX_PER_COURSE} files a course` };
}
