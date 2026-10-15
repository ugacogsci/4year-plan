/**
 * The syllabus facts the planner ships, one file per subject.
 *
 *   node scripts/illinois/syllabi/build.mjs
 *
 * Reads data/syllabi/facts/{sha}.json (store-facts.mjs) and writes
 *   public/illinois/syllabi/{SUBJ}.json  { subject, builtAt, courses: { "CHEM 102": [syllabus, ...] } }
 *   public/illinois/syllabi/index.json   { builtAt, courses: { "CHEM 102": { count, latest } }, sources: {...} }
 *
 * Only facts ship: weights, exams, materials and short paraphrased policies,
 * each with the term, the instructors and a link to the instructor's own
 * document. The documents themselves stay in data/syllabi/, which is never
 * committed, because the instructors own their text.
 *
 * A document counts for a course when its code is a catalog code (graduate
 * numbers are not), and for that course's cross-listed twins with
 * viaCrossList set. A course's syllabi are newest term first; an undated
 * master outline sorts last.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, normalizeCode } from './lib/catalog.mjs';
import { DIRS, ROOT } from './lib/paths.mjs';
import { makeTerm, termKey, termLabel, termMentions } from './lib/terms.mjs';
import { loadUgaCatalog, normalizeUgaCode } from './lib/uga-catalog.mjs';

/**
 * --school illinois (default) | uga. Each school's facts ship to its own
 * folder (public/{school}/syllabi) and are matched against its own catalog; a
 * fact's source says which school it is (UGA's sources start with "uga-").
 * For UGA the Bulletin's own course objectives and topical outline, which it
 * publishes for about a quarter of courses, ship too, as an undated
 * master-outline entry, so a course with no uploaded syllabus still answers
 * "what is this course about".
 */
const schoolArg = process.argv.indexOf('--school');
const SCHOOL = schoolArg > 0 ? process.argv[schoolArg + 1] : 'illinois';
if (!['illinois', 'uga'].includes(SCHOOL)) throw new Error(`--school must be illinois or uga, not ${SCHOOL}`);
const isUgaSource = (source) => String(source ?? '').startsWith('uga-');

const FACTS = join(DIRS.state, '..', 'facts');
const OUT = join(ROOT, 'public', SCHOOL, 'syllabi');
const SHIP = new Set(['syllabus', 'course-policy', 'master-outline']);

const catalog = SCHOOL === 'uga' ? null : loadCatalog();
const ugaCatalog = SCHOOL === 'uga' ? loadUgaCatalog() : null;
const norm = SCHOOL === 'uga' ? normalizeUgaCode : normalizeCode;
const twinsOf = (code) => (catalog ? catalog.twins(code) : []);
const byCourse = new Map();
const counts = { documents: 0, shipped: 0, notACourseDocument: 0, noCatalogCode: 0 };
const sources = {};

/** "Fall 2024" -> "fa2024", or null. */
function writtenTerm(written) {
  const m = termMentions(written ?? '')[0];
  if (m) return m.term;
  const loose = String(written ?? '').match(/(fall|spring|summer|winter)\D{0,3}(\d{2,4})/i);
  return loose ? makeTerm(loose[1], loose[2]) : null;
}

/**
 * The document's own term wins over the term a store filed it under: the
 * getsyllabus store lists ECE 110's Fall 2025 syllabus under Spring 2025, and
 * TE 462's Spring 2025 one under Spring 2026. Either way the student is told
 * the term the syllabus itself names; listedTerm keeps the store's.
 */
function termOf(written, hint) {
  const own = writtenTerm(written);
  const listed = typeof hint === 'string' && /^(fa|sp|su|wi)\d{4}$/.test(hint) ? hint : null;
  return { term: own ?? listed, listedTerm: own && listed && own !== listed ? listed : null };
}

const short = (s, n = 200) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n) || null);

for (const f of existsSync(FACTS) ? readdirSync(FACTS).filter((n) => n.endsWith('.json')) : []) {
  const doc = JSON.parse(readFileSync(join(FACTS, f), 'utf8'));
  if (isUgaSource(doc.source) !== (SCHOOL === 'uga')) continue; // the other school's document
  counts.documents += 1;
  const x = doc.facts;
  if (!SHIP.has(x.kind)) { counts.notACourseDocument += 1; continue; }
  const codes = [...new Set([...(doc.hintCodes ?? []), ...(x.codes ?? [])].map(norm).filter(Boolean))];
  if (codes.length === 0) { counts.noCatalogCode += 1; continue; }
  const { term, listedTerm } = termOf(x.term, doc.hintTerm);
  const entry = {
    term,
    termLabel: termLabel(term),
    ...(listedTerm ? { listedFor: termLabel(listedTerm) } : {}),
    section: doc.hintSection ?? null,
    // The store's own instructor label (UGA's Bulletin names who uploaded each file) fills in when the reader found no name.
    instructors: (x.instructors?.length ? x.instructors : doc.instructorHint ? [doc.instructorHint] : []).slice(0, 4),
    kind: x.kind,
    source: doc.source,
    // A Google Doc was read through its plain-text export; a student gets the document itself.
    url: String(doc.url).replace(/^(https:\/\/docs\.google\.com\/document\/d\/[\w-]+)\/export\?format=txt$/, '$1/edit'),
    grading: {
      basis: x.gradingBasis,
      components: (x.gradingComponents ?? []).map((c) => ({ item: short(c.item, 80), weight: c.weight, unit: c.unit, note: short(c.note, 140) })),
      pointsTotal: x.pointsTotal ?? null,
      scale: short(x.gradeScale, 240),
      curve: short(x.curve),
      drop: short(x.dropPolicy),
      extraCredit: short(x.extraCredit),
    },
    exams: (x.exams ?? []).slice(0, 8).map((e) => ({ name: short(e.name, 60), when: short(e.when, 60), note: short(e.note, 140) })),
    finalExam: short(x.finalExam),
    materials: (x.materials ?? []).slice(0, 8).map((m) => ({ item: short(m.item, 160), required: m.required ?? null })),
    attendance: short(x.attendance),
    lateWork: short(x.lateWork),
    makeups: short(x.makeups),
    other: (x.other ?? []).slice(0, 4).map((o) => short(o, 160)),
    confidence: x.confidence,
  };
  counts.shipped += 1;
  sources[doc.source] = (sources[doc.source] ?? 0) + 1;
  const shipTo = new Map(codes.map((c) => [c, null]));
  for (const c of codes) for (const twin of twinsOf(c)) if (!shipTo.has(twin)) shipTo.set(twin, c);
  for (const [code, via] of shipTo) {
    const list = byCourse.get(code) ?? [];
    list.push(via ? { ...entry, viaCrossList: via } : entry);
    byCourse.set(code, list);
  }
}

if (ugaCatalog) {
  // The Bulletin's master syllabus for the course: objectives and topics, no grading.
  for (const c of ugaCatalog.all()) {
    if (c.objectives.length === 0 && c.outline.length === 0) continue;
    const list = byCourse.get(c.code) ?? [];
    list.push({
      term: null, termLabel: null, section: null, instructors: [], kind: 'master-outline', source: 'uga-bulletin-outline', url: c.url,
      grading: { basis: 'unknown', components: [], pointsTotal: null, scale: null, curve: null, drop: null, extraCredit: null },
      exams: [], finalExam: null, materials: [], attendance: null, lateWork: null, makeups: null, other: [],
      objectives: c.objectives.slice(0, 8).map((o) => short(o, 220)).filter(Boolean),
      topics: c.outline.slice(0, 14).map((t) => short(t, 120)).filter(Boolean),
      confidence: 'high',
    });
    byCourse.set(c.code, list);
    counts.outlines = (counts.outlines ?? 0) + 1;
  }
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const builtAt = new Date().toISOString();
const bySubject = new Map();
const index = {};
for (const [code, list] of byCourse) {
  // Newest first; the same document reached twice (two stores) once.
  const seen = new Set();
  const sorted = list
    .sort((a, b) => termKey(b.term) - termKey(a.term) || (a.kind === 'syllabus' ? -1 : 1))
    .filter((e) => { const k = e.url; if (seen.has(k)) return false; seen.add(k); return true; });
  const subject = code.split(' ')[0];
  if (!bySubject.has(subject)) bySubject.set(subject, {});
  bySubject.get(subject)[code] = sorted;
  index[code] = { count: sorted.length, latest: sorted[0]?.term ?? null };
}
for (const [subject, courses] of bySubject) writeFileSync(join(OUT, `${subject}.json`), JSON.stringify({ subject, builtAt, courses }));
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ builtAt, counts, sources, courses: index }));
const current = Object.values(index).filter((v) => v.latest && termKey(v.latest) >= termKey('fa2023')).length;
console.log(`[${SCHOOL}] ${counts.shipped} of ${counts.documents} documents ship${counts.outlines ? ` + ${counts.outlines} Bulletin outlines` : ''} (${counts.notACourseDocument} not a course document, ${counts.noCatalogCode} no catalog code), covering ${byCourse.size} courses in ${bySubject.size} subjects; ${current} with a syllabus from Fall 2023 or later`);
