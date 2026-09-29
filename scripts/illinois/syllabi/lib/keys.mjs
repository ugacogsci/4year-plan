/**
 * Store keys: what a document's own URL or filename says about its course,
 * section and term. These outrank anything read from the text, because the
 * store filed the document under them; "ME330_AL1_2026_Spring.pdf" is ME 330
 * section AL1 in Spring 2026 even when page one only says "Mechanics".
 *
 * Returns { codes: ["ME 330"], section, term, via } or null. Codes here are
 * raw (not yet checked against the catalog); match.mjs does that.
 */
import { makeTerm } from './terms.mjs';

const SEASON = { fa: 'fa', sp: 'sp', su: 'su', wi: 'wi' };

/**
 * Grainger getsyllabus filename: {SUBJ}{NUM}[_{SECTION}]_{YYYY}_{Fall|Spring|Summer}.{ext}
 *   "ME330_AL1_2026_Spring.pdf" -> ME 330, AL1, sp2026
 *   "CS598_DAG_2025_Fall.pdf"   -> CS 598, DAG, fa2025
 */
export function parseStoreName(name) {
  const m = String(name ?? '').match(/^([A-Z]{2,4})\s?(\d{3})(?:[_ ]([A-Z0-9]{1,5}))?[_ ](\d{4})[_ ](Fall|Spring|Summer|Winter)\.\w+$/i);
  if (!m) return null;
  return { codes: [`${m[1].toUpperCase()} ${m[2]}`], section: m[3] ?? null, term: makeTerm(m[5], m[4]), via: 'store-filename' };
}

function filenameOf(disposition) {
  return String(disposition ?? '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? null;
}

/** The key for one cached document, from its Content-Disposition filename and URL. */
export function storeKey(url, disposition) {
  const file = filenameOf(disposition);
  if (file) {
    const k = parseStoreName(file);
    if (k) return k;
  }
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = decodeURIComponent(u.pathname);
  // Wayback id_ URLs carry the original URL after the timestamp.
  if (u.host === 'web.archive.org') {
    const orig = url.match(/\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/)?.[1];
    return orig ? storeKey(orig, null) : null;
  }
  // app.sib: "/course/syllabi/IB 150 ONL.pdf"
  let m = path.match(/^\/course\/syllabi\/([A-Z]{2,4}) (\d{3})(?: (.+))?\.pdf$/i);
  if (m && u.host === 'app.sib.illinois.edu') return { codes: [`${m[1].toUpperCase()} ${m[2]}`], section: m[3] ?? null, term: null, via: 'store-path' };
  // app.mcb: "/courses/syllabi/MCB_493/MCB_493_EPI_syllabus.pdf"
  m = path.match(/\/([A-Z]{2,4})_(\d{3})(?:_([A-Z0-9]+))?_syllabus\.pdf$/i);
  if (m && u.host === 'app.mcb.illinois.edu') return { codes: [`${m[1].toUpperCase()} ${m[2]}`], section: m[3] ?? null, term: null, via: 'store-path' };
  // Grainger course sites: "/cs225al1/fa2026/..." or "/TAM210/fa2026/syllabus.html"
  m = path.match(/^\/([a-z]{2,4})(\d{3})([a-z0-9]{0,4})\/(fa|sp|su|wi)(\d{4})(?:\/|$)/i);
  if (m && /^courses\.(grainger|engr|physics)\.illinois\.edu$/.test(u.host)) {
    return { codes: [`${m[1].toUpperCase()} ${m[2]}`], section: m[3] ? m[3].toUpperCase() : null, term: `${SEASON[m[4].toLowerCase()]}${m[5]}`, via: 'site-path' };
  }
  // ATLAS / LAS course server: "/fall2025/stat437/syllabus.html", "/spring2018/ASTR/ASTR210/..."
  m = path.match(/^\/(fall|spring|summer|winter)(\d{4})\/(?:[a-z]{2,4}\/)?([a-z]{2,4})(\d{3})\b/i);
  if (m && /^courses\.(las|atlas)\.illinois\.edu$/.test(u.host)) return { codes: [`${m[3].toUpperCase()} ${m[4]}`], section: null, term: makeTerm(m[1], m[2]), via: 'site-path' };
  // DURP: "UP101_Syllabus_FA24-Intro-to-City-Planning.pdf", "UP 494 BL Syllabus SP23.pdf"
  m = path.match(/\/(UP)\s?(\d{3})([A-Z]{0,2})[-_ ]+Syllabus[-_ ]+(FA|SP|SU)(\d{2})\b/i);
  if (m) return { codes: [`UP ${m[2]}`], section: m[3] || null, term: makeTerm(m[4], m[5]), via: 'store-filename' };
  // iSchool course pages: "/academics/courses/is417"
  m = path.match(/^\/academics\/courses\/(is)(\d{3})$/i);
  if (m && u.host === 'ischool.illinois.edu') return { codes: [`IS ${m[2]}`], section: null, term: null, via: 'store-path' };
  // Math master syllabi: "/resources/syllabus-math-241", "/resources/department-resources/syllabus-asrm-210"
  m = path.match(/\/syllabus-(math|asrm|stat)-(\d{3})$/i);
  if (m && u.host === 'math.illinois.edu') return { codes: [`${m[1].toUpperCase()} ${m[2]}`], section: null, term: null, via: 'store-path' };
  return null;
}
