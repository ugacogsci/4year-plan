/**
 * One-off: move what the discovery researchers already downloaded out of
 * /private/tmp (which macOS empties) into the git-ignored cache, keyed by the
 * URL each file really came from, so the pipeline treats it exactly as if its
 * own adapters had fetched it and never asks those hosts for it again.
 *
 *   node scripts/illinois/syllabi/import-research.mjs [--from DIR]
 *
 * DIR defaults to the discovery session's scratchpad/syllabi. Idempotent: a
 * URL already cached with the same bytes is left alone.
 *
 * A file is imported only when its source URL is known for certain: from the
 * researchers' own index (appsib_pdfs.json, appmcb_links.json,
 * getsyllabus_full.tsv, math/documents.txt, out/ischool/index.tsv,
 * eng/sites.jsonl), from the page's own <link rel="canonical">, or from a
 * sample URL the design names with its course and term (for example
 * "https://kelly-findley.github.io/materials/syllabus-f24.pdf (STAT 212 Fall
 * 2024)"). A getsyllabus file is matched by id and byte count against
 * getsyllabus_full.tsv, because the researchers' names ("ws/3100.bin",
 * "grainger/syl/2378") carry the id but not always the right one: the 940,445
 * bytes saved as 3100 match both id 3099 and id 3100 in the id list, and id
 * 3100's filename (CS598_DAG_2025_Fall.pdf) is the one the text agrees with.
 *
 * Never imported, whatever they contain:
 *   - the 12 ECON PDFs in las-hum/docs/econ-*.pdf, fetched through Box's
 *     anonymous preview-token route on public.boxcloud.com, which the design
 *     says not to use or ingest; econ102-f26.pdf and ps312-althaus.pdf, which
 *     also came out of Box (the student has not agreed to Box downloads);
 *   - every Canvas page (canvas/, pages/canvas-*.html, chem/canvas_*.html):
 *     the student has not decided on Canvas;
 *   - files whose source URL cannot be recovered (listed in the report).
 *
 * Also copies, unchanged: the id lists and CDX dumps later adapters seed from
 * (data/syllabi/ids/) and the design plus each sweep's per-course verdicts
 * (data/syllabi/research/). Canvas id lists are kept under ids/canvas/ as ids
 * only; nothing reads them until the student decides.
 *
 * Writes one manifest per source (mode "import", never "complete") and
 * data/syllabi/state/import-report.json.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { lookup, sha, store } from './lib/cache.mjs';
import { parseStoreName } from './lib/keys.mjs';
import { DATA, DIRS, ensureDirs } from './lib/paths.mjs';
import { writeManifest } from './lib/manifest.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--from');
const FROM = at >= 0 ? argv[at + 1] : '/private/tmp/claude-501/-Users-michaelcrews-THE-ADVISOR/348fb0bb-ab76-4776-87e7-d82b0f1dae46/scratchpad/syllabi';
if (!existsSync(FROM)) {
  console.error(`No research directory at ${FROM}. Pass --from DIR.`);
  process.exit(1);
}
const R = (...p) => join(FROM, ...p);
const readJson = (...p) => JSON.parse(readFileSync(R(...p), 'utf8'));

const CT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

const items = []; // { source, url, file, contentType, disposition, hintCodes, hintTerm, hintSection, kindHint, foundVia, redirectFrom, cacheOnly }
const skipped = []; // { file, reason }
const add = (it) => {
  if (!existsSync(it.file)) { skipped.push({ file: it.file, reason: 'missing' }); return; }
  // A probe that hit a missing page saved the site's 404 template: 27 of the
  // researchers' math/syl_*.html files are "Page not found | Department of
  // Mathematics", and keying one under the URL it was probing would teach the
  // cache that MATH 112's syllabus is a 404 page.
  if (/html/.test(it.contentType) && /<title>\s*(Page not found|404)/i.test(readFileSync(it.file, 'utf8').slice(0, 5000))) {
    skipped.push({ file: it.file.slice(FROM.length + 1), reason: 'a saved "Page not found" page' });
    return;
  }
  items.push(it);
};
const canonicalOf = (file) => readFileSync(file, 'utf8').match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] ?? null;

// ---------------------------------------------------------------------------
// app-sib: 77 of the 93 PDFs the index links. "IB_496_A(SP).pdf" was saved
// from "/course/syllabi/IB 496 A(SP).pdf".

{
  const links = new Set(readJson('las_sci', 'appsib_pdfs.json'));
  for (const name of readdirSync(R('las_sci', 'ibpdf'))) {
    const path = `/course/syllabi/${name.replace(/_/g, ' ')}`;
    if (!links.has(path)) { skipped.push({ file: `las_sci/ibpdf/${name}`, reason: 'not in appsib_pdfs.json' }); continue; }
    const m = name.match(/^IB_(\d{3})(?:_(.+))?\.pdf$/);
    add({
      source: 'app-sib',
      url: `https://app.sib.illinois.edu${encodeURI(path)}`,
      file: R('las_sci', 'ibpdf', name),
      contentType: CT.pdf,
      hintCodes: m ? [`IB ${m[1]}`] : [],
      hintSection: m?.[2] ?? null,
      kindHint: 'syllabus',
      foundVia: 'https://app.sib.illinois.edu/courses/all',
    });
  }
  add({ source: 'app-sib', url: 'https://app.sib.illinois.edu/courses/all', file: R('las_sci', 'appsib_all.html'), contentType: CT.html, cacheOnly: true });
}

// ---------------------------------------------------------------------------
// app-mcb: 72 PDFs; topic sections live one folder down (MCB_493/MCB_493_EPI_syllabus.pdf).

{
  const links = readJson('las_sci', 'appmcb_links.json');
  const byName = new Map(links.map((l) => [basename(l), l]));
  for (const name of readdirSync(R('las_sci', 'mcbpdf'))) {
    // MCB 316 is linked from no index page; the researchers found it by
    // probing the file pattern, /courses/syllabi/{SUBJ}_{NUM}_syllabus.pdf.
    const path = byName.get(name) ?? (/^[A-Z]{2,4}_\d{3}_syllabus\.pdf$/.test(name) ? `/courses/syllabi/${name}` : null);
    if (!path) { skipped.push({ file: `las_sci/mcbpdf/${name}`, reason: 'not in appmcb_links.json' }); continue; }
    const m = name.match(/^([A-Z]{2,4})_(\d{3})(?:_([A-Z0-9]+))?_syllabus\.pdf$/);
    add({
      source: 'app-mcb',
      url: `https://app.mcb.illinois.edu${path}`,
      file: R('las_sci', 'mcbpdf', name),
      contentType: CT.pdf,
      hintCodes: m ? [`${m[1]} ${m[2]}`] : [],
      hintSection: m?.[3] ?? null,
      kindHint: 'syllabus',
      foundVia: 'https://app.mcb.illinois.edu/courses/',
    });
  }
  for (const page of ['100', '200', '300', '400', 'advanced', 'labs', 'biochem_advanced', 'neurosci_advanced', 'group_ab_mcbds', 'graduate', 'MCB_297_syllabi', 'MCB_298_syllabi', 'MCB_493_syllabi']) {
    const f = R('las_sci', `appmcb_${page}.html`);
    if (existsSync(f)) add({ source: 'app-mcb', url: `https://app.mcb.illinois.edu/courses/${page}`, file: f, contentType: CT.html, cacheOnly: true });
  }
}

// ---------------------------------------------------------------------------
// ws.engr getsyllabus and getfile: matched by id and byte count against the
// researchers' HEAD walk. The filename in Content-Disposition is the store's
// own key: {SUBJ}{NUM}[_{SECTION}]_{YYYY}_{Fall|Spring|Summer}.{ext}

function tsv(file) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [id, bytes, type, name] = line.split('\t');
    if (name) out.set(id, { bytes: Number(bytes), type, name: name.trim() });
  }
  return out;
}
const GS = tsv(R('eng', 'getsyllabus_full.tsv'));
const GF = tsv(R('eng', 'getfile_ids.tsv'));

// The walk skipped a few ids (3811 is between 3810 and 3812 but absent), so a
// saved response header (eng/gs_3811.hdr) can stand in for the list row.
function fromHeader(file) {
  if (!existsSync(file)) return null;
  const h = readFileSync(file, 'utf8');
  const name = h.match(/filename="([^"]+)"/i)?.[1];
  const bytes = Number(h.match(/content-length:\s*(\d+)/i)?.[1]);
  return name && bytes ? { bytes, type: h.match(/content-type:\s*([^\r\n;]+)/i)?.[1] ?? '', name } : null;
}

function addStore(kind, id, file, header = null) {
  const table = kind === 'getsyllabus' ? GS : GF;
  const row = table.get(String(id)) ?? fromHeader(header);
  const size = statSync(file).size;
  if (!row || row.bytes !== size) { skipped.push({ file: file.slice(FROM.length + 1), reason: `${kind} id ${id}: ${row ? `${row.bytes} bytes in the id list, ${size} on disk` : 'not in the id list'}` }); return; }
  const ext = row.name.split('.').pop().toLowerCase();
  const parsed = kind === 'getsyllabus' ? parseStoreName(row.name) : null; // { codes, section, term }
  add({
    source: kind === 'getsyllabus' ? 'ws-engr-getsyllabus' : 'ws-engr-getfile',
    url: kind === 'getsyllabus' ? `https://ws.engr.illinois.edu/custom/getsyllabus.asp?id=${id}` : `https://ws.engr.illinois.edu/courses/getfile.asp?id=${id}`,
    file,
    contentType: CT[ext] ?? row.type,
    disposition: `inline; filename="${row.name}"`,
    hintCodes: parsed?.codes ?? [],
    hintTerm: parsed?.term ?? null,
    hintSection: parsed?.section ?? null,
    kindHint: 'syllabus',
    foundVia: `${kind} id walk (eng/${kind === 'getsyllabus' ? 'getsyllabus_full' : 'getfile_ids'}.tsv)`,
  });
}
{
  // Name -> id from the full walk, then from the per-course list, which also
  // holds ids the walk only sampled (ME330_AL1_2026_Spring.pdf is id 3601).
  const byName = new Map([...GS].map(([id, r]) => [r.name, id]));
  const byCourse = readJson('eng', 'getsyllabus_by_course.json');
  for (const list of Object.values(byCourse)) for (const [id, name] of list) if (!byName.has(name)) byName.set(name, String(id));
  for (const name of readdirSync(R('eng', 'pdfs'))) {
    const id = byName.get(name);
    if (id && !GS.has(id)) GS.set(id, { bytes: statSync(R('eng', 'pdfs', name)).size, type: 'application/pdf', name }); // named by the store itself
    if (id) addStore('getsyllabus', id, R('eng', 'pdfs', name));
    else skipped.push({ file: `eng/pdfs/${name}`, reason: 'filename not in getsyllabus_full.tsv' });
  }
  for (const name of readdirSync(R('engr'))) {
    const m = name.match(/^(?:gs-|getsyllabus-)(\d+)\.(pdf|bin)$/);
    if (m) addStore('getsyllabus', m[1], R('engr', name));
  }
  for (const name of readdirSync(R('grainger', 'syl'))) {
    const m = name.match(/^(\d+)(\.pdf)?$/);
    if (m && statSync(R('grainger', 'syl', name)).size > 300) addStore('getsyllabus', m[1], R('grainger', 'syl', name));
  }
  for (const name of readdirSync(R('ws'))) {
    const m = name.match(/^(\d+)\.bin$/);
    if (m && statSync(R('ws', name)).size > 300) addStore('getsyllabus', m[1], R('ws', name));
  }
  addStore('getsyllabus', '3811', R('eng', 'gs_3811.bin'), R('eng', 'gs_3811.hdr'));
  addStore('getfile', '831', R('grainger', 'files', '831'));
  addStore('getfile', '1015', R('eng', 'ws_1015.bin'));
  addStore('getfile', '789', R('eng', 'ws_789.bin'));
}

// ---------------------------------------------------------------------------
// Math: master syllabi ("Course Topics for Instructors") and the /document/ archive.

{
  const topics = readJson('math', 'topics_index.json'); // "MATH 241" -> URL the researchers fetched
  for (const name of readdirSync(R('math')).filter((n) => /^syl_\d+\.html$/.test(n))) {
    const num = name.match(/\d+/)[0];
    const code = `MATH ${num}`;
    // An HTML page is never keyed under a .pdf URL (topics_index maps MATH 103
    // to inline-files/103-syllabus.pdf), and a canonical link counts only when
    // it names this page ("/syllabus-math-241"), not the site root.
    const canonical = canonicalOf(R('math', name));
    const url = [topics[code], canonical].find((u) => u && /\/syllabus-(math|asrm)-\d{3}$/.test(u));
    if (!url) { skipped.push({ file: `math/${name}`, reason: 'no page URL in topics_index.json and no canonical link to it' }); continue; }
    add({ source: 'math-topics', url, file: R('math', name), contentType: CT.html, hintCodes: [code], kindHint: 'outline', foundVia: 'https://math.illinois.edu/resources/course-topics-instructors' });
  }
  const inline = [['103-syllabus.pdf', 'MATH 103', R('math', '103-syllabus.pdf')], ['482Syllabus.pdf', 'MATH 482', R('math', '482Syllabus.pdf')], ['119-syllabus.pdf', 'MATH 119', R('docs', 'math119.pdf')]];
  for (const [name, code, file] of inline) add({ source: 'math-topics', url: `https://math.illinois.edu/system/files/inline-files/${name}`, file, contentType: CT.pdf, hintCodes: [code], kindHint: 'outline', foundVia: 'https://math.illinois.edu/resources/course-topics-instructors' });
  add({ source: 'math-topics', url: 'https://math.illinois.edu/resources/course-topics-instructors', file: R('math', 'resources_course-topics-instructors.html'), contentType: CT.html, cacheOnly: true });
  add({ source: 'math-topics', url: 'https://math.illinois.edu/resources/syllabus-math-447', file: R('m447.html'), contentType: CT.html, hintCodes: ['MATH 447'], kindHint: 'outline', foundVia: 'https://math.illinois.edu/resources/course-topics-instructors' });

  // /document/{id} answers 302 to the file; documents.txt is that walk ("1238 302 https://...").
  const docs = new Map(readFileSync(R('math', 'documents.txt'), 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p[1] === '302').map((p) => [p[2], p[0]]));
  const mathDoc = (url, file, code, section) => add({ source: 'math-docs', url, file, contentType: CT.pdf, hintCodes: code ? [code] : [], hintSection: section ?? null, kindHint: 'syllabus', foundVia: docs.has(url) ? `https://math.illinois.edu/document/${docs.get(url)}` : 'math document archive', redirectFrom: docs.has(url) ? `https://math.illinois.edu/document/${docs.get(url)}` : null });
  mathDoc('https://math.illinois.edu/system/files/2021-08/257%20PL1-PL2.pdf', R('math', '25720PL1-PL2.pdf'), 'MATH 257', 'PL1');
  for (const [f, u] of [['2026-01_Syllabus.pdf', 'Syllabus.pdf'], ['2026-01_Syllabus_0.pdf', 'Syllabus_0.pdf'], ['2026-01_Syllabus_1.pdf', 'Syllabus_1.pdf'], ['2026-01_Syllabus_2.pdf', 'Syllabus_2.pdf']]) {
    mathDoc(`https://math.illinois.edu/sites/default/files/2026-01/${u}`, R('las_sci', 'mathdocs', f), null);
  }
}

// ---------------------------------------------------------------------------
// Statistics: instructor-written course descriptions, one PDF for a whole term.

add({ source: 'stat-docs', url: 'https://stat.illinois.edu/system/files/2023-10/Spring%202024%20Statistics%20Course%20Descriptions.pdf', redirectFrom: 'https://stat.illinois.edu/document/297', file: R('las_sci', 'statdesc_sp24.pdf'), contentType: CT.pdf, hintTerm: 'sp2024', kindHint: 'description', foundVia: 'https://stat.illinois.edu/document/297' });

// ---------------------------------------------------------------------------
// Chemistry Learning Center course pages (canonical links in the saved HTML).

for (const f of ['clc_courses_chem-102-hummel.html', 'hummel_policy.html', 'p_clc_courses_chem-103.html']) {
  const url = canonicalOf(R('chem', f));
  const num = f.includes('102') ? '102' : '103';
  if (url) add({ source: 'chem-docs', url, file: R('chem', f), contentType: CT.html, hintCodes: [`CHEM ${num}`], kindHint: 'syllabus', foundVia: 'https://chemistry.illinois.edu/academics/chemistry-learning-center/course-websites' });
}

// ---------------------------------------------------------------------------
// Instructor sites and one live DURP file, each named with course and term in the design.

add({ source: 'directory-sites', url: 'https://kelly-findley.github.io/materials/syllabus-f24.pdf', file: R('docs', 'stat212.pdf'), contentType: CT.pdf, hintCodes: ['STAT 212'], hintTerm: 'fa2024', kindHint: 'syllabus', foundVia: 'stat.illinois.edu directory profile' });
add({ source: 'directory-sites', url: 'https://labs.psychology.illinois.edu/~lyubansk/race/racesyll.pdf', file: R('docs', 'afro312.pdf'), contentType: CT.pdf, hintCodes: ['PSYC 312', 'AFRO 312'], hintTerm: 'fa2022', kindHint: 'syllabus', foundVia: 'psychology.illinois.edu directory profile' });
add({ source: 'up-wayback', url: 'https://web.faa.illinois.edu/app/uploads/sites/2/2024/09/UP101_Syllabus_FA24-Intro-to-City-Planning.pdf', file: R('pages', 'up101-fa24.pdf'), contentType: CT.pdf, hintCodes: ['UP 101'], hintTerm: 'fa2024', kindHint: 'syllabus', foundVia: 'Wayback CDX web.faa.illinois.edu/app/uploads/ (still live)' });

// Wayback: the only illinois.edu capture of EALC_285.pdf (the file inside is EALC 185, Spring 2003).
add({ source: 'wayback-hosts', url: 'https://web.archive.org/web/20100701164638id_/http://www.ealc.illinois.edu/ealc/resources/syllabus/EALC_285.pdf', file: R('las-hum', 'docs', 'wb-ealc285.pdf'), contentType: CT.pdf, hintCodes: ['EALC 285'], kindHint: 'syllabus', foundVia: 'Wayback CDX www.ealc.illinois.edu' });

// ---------------------------------------------------------------------------
// Grainger course sites: the 128 real sites (not the generated fallback) from
// the Fall 2026 sweep, plus TAM 210's syllabus page and the Grainger index.

{
  const rows = readFileSync(R('eng', 'sites.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const r of rows.filter((x) => x.kind === 'site')) {
    const f = R('eng', 'sites', `${r.code.replace(' ', '')}_${r.term}.html`);
    add({ source: 'grainger-sites', url: r.final, file: f, contentType: CT.html, hintCodes: [r.code], hintTerm: r.term, kindHint: 'site', foundVia: 'https://courses.grainger.illinois.edu/' });
  }
  add({ source: 'grainger-sites', url: 'https://courses.grainger.illinois.edu/tam210/fa2026/syllabus.html', file: R('docs', 'tam210.html'), contentType: CT.html, hintCodes: ['TAM 210'], hintTerm: 'fa2026', kindHint: 'syllabus', foundVia: 'https://courses.grainger.illinois.edu/' });
  add({ source: 'grainger-index', url: 'https://courses.grainger.illinois.edu/', file: R('hosts', 'grainger_index_fa2026.html'), contentType: CT.html, cacheOnly: true });
}

// Google Docs exports named in the Grainger index (CEE 330, CS 105).
for (const [id, code] of [['15CtUH5dSCL4UnGqC9cro6TSZWBSeB5Djk0hEUkAD2HI', 'CEE 330'], ['13-BOP-__lyW27Zf-LSb-MEMQfS4Gzk1eE2R4O6d6Fy0', 'CS 105']]) {
  add({ source: 'small-seeds', url: `https://docs.google.com/document/d/${id}/export?format=txt`, file: R('eng', `gd_${id}.txt`), contentType: CT.txt, hintCodes: [code], hintTerm: 'fa2026', kindHint: 'syllabus', foundVia: 'https://courses.grainger.illinois.edu/ (Syllabus column)' });
}

// ---------------------------------------------------------------------------
// iSchool course pages (the researchers' fetch index gives URL -> file).

for (const line of readFileSync(R('out', 'ischool', 'index.tsv'), 'utf8').split('\n').filter(Boolean)) {
  const [url, status, , name, type] = line.split('\t');
  if (status !== '200') continue;
  const num = url.match(/\/is(\d{3})$/i)?.[1];
  add({ source: 'ischool', url, file: R('out', 'ischool', `${name}.html`), contentType: type || CT.html, hintCodes: num ? [`IS ${num}`] : [], kindHint: 'description', foundVia: 'https://ischool.illinois.edu/academics/courses?semester=All&course_type=All' });
}

// History course guide, Fall 2017: one page, dozens of courses.
add({ source: 'hist-guides', url: 'https://history.illinois.edu/fall-2017-course-guide', file: R('las-hum', 'pages', 'hist-f17-guide.html'), contentType: CT.html, hintTerm: 'fa2017', kindHint: 'description', foundVia: 'https://history.illinois.edu/academics/course-catalog/course-descriptions-2001-17' });

// ---------------------------------------------------------------------------
// Course Explorer pages (3,115 files, "2026-fall-CS-225.html"): cache only, for
// the ce-section-info adapter, which reads Section Info (materials cost,
// proctored exams, format) from them without refetching.

const ceFiles = readdirSync(R('ce')).filter((n) => /^\d{4}-(fall|spring|summer|winter)-[A-Z]+-\d+\.html$/.test(n));
for (const name of ceFiles) {
  const [, y, t, s, n] = name.match(/^(\d{4})-(\w+)-([A-Z]+)-(\d+)\.html$/);
  add({ source: 'ce-section-info', url: `https://courses.illinois.edu/schedule/${y}/${t}/${s}/${n}`, file: R('ce', name), contentType: CT.html, cacheOnly: true });
}

// ---------------------------------------------------------------------------
// Explicitly not imported (logged so nobody wonders later).

const EXCLUDED = [
  ...readdirSync(R('las-hum', 'docs')).filter((n) => n.startsWith('econ-ECON')).map((n) => ({ file: `las-hum/docs/${n}`, reason: 'fetched through the Box preview-token route (public.boxcloud.com); the design says not to use or ingest it' })),
  { file: 'las-hum/docs/econ102-f26.pdf', reason: 'a Box file; the student has not agreed to Box downloads' },
  { file: 'las-hum/docs/ps312-althaus.pdf', reason: 'a Box file (uofi.box.com/s/87rn3n...); the student has not agreed to Box downloads' },
  { file: 'canvas/*.html, pages/canvas-*.html, chem/canvas_*.html', reason: 'Canvas: the student has not decided on Canvas' },
  { file: 'docs/ace456.pdf', reason: 'source URL unknown (ACE 456 Spring 2021; the sweeps list no public ACE 456 syllabus)' },
  { file: 'pages/edu-2015.pdf', reason: 'source URL unknown (EDUC 201 Fall 2015; the docs library has fall-2016 and spring-2019 URLs, not this one)' },
  { file: 'pages/fw-405.pdf', reason: 'source URL unknown (ASTR 405 Spring 2018)' },
  { file: 'grainger/files/ae402.bin', reason: 'source URL unknown (AE 402 outline; fa2024 or su2025 site)' },
  { file: 'las-hum/docs/span-blp.pdf', reason: 'source URL unknown (Spanish Basic Language Program)' },
  { file: 'las-hum/docs/wb-fr103.pdf', reason: 'source URL unknown, and it is a Wayback capture of an HTML 404 page, not a syllabus' },
  { file: 'las-hum/pages/eui-rhet.pdf', reason: 'source URL uncertain (RHET 105 L2, Larsen; the EUI list has only her section B3 file)' },
  { file: 'pages/ldl-links.pdf, pages/ler-offerings.pdf', reason: 'source URL unknown; not syllabi' },
];

// ---------------------------------------------------------------------------
// Store everything, then write manifests and copy the lists.

ensureDirs();
let stored = 0;
let already = 0;
const bySource = new Map();
for (const it of items) {
  const body = readFileSync(it.file);
  const hit = lookup(it.url);
  if (hit?.status === 200 && hit.bytes === body.length) already += 1;
  else {
    store(it.url, body, { status: 200, contentType: it.contentType, disposition: it.disposition ?? null, finalUrl: it.url, fetchedAt: statSync(it.file).mtime.toISOString(), via: 'import:researchers', note: it.file.slice(FROM.length + 1) });
    stored += 1;
  }
  if (it.redirectFrom && !lookup(it.redirectFrom)) store(it.redirectFrom, null, { status: 302, location: it.url, fetchedAt: statSync(it.file).mtime.toISOString(), via: 'import:researchers', note: 'redirect observed by the researchers' });
  if (it.cacheOnly) continue;
  const rec = lookup(it.url);
  if (!bySource.has(it.source)) bySource.set(it.source, []);
  bySource.get(it.source).push({
    source: it.source,
    url: it.url,
    finalUrl: it.url,
    sha: sha(it.url),
    status: 200,
    outcome: 'ok',
    contentType: it.contentType,
    disposition: it.disposition ?? null,
    hintCodes: it.hintCodes ?? [],
    hintTerm: it.hintTerm ?? null,
    hintSection: it.hintSection ?? null,
    kindHint: it.kindHint ?? null,
    foundVia: it.foundVia ?? null,
    fetchedAt: rec.fetchedAt,
    via: 'import:researchers',
  });
}
const manifests = {};
for (const [source, rows] of bySource) {
  const seen = new Set();
  const unique = rows.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
  const res = writeManifest(source, unique, { force: true, meta: { mode: 'import', complete: false, note: 'the discovery researchers\' downloads, not a full run of this source' } });
  manifests[source] = { documents: unique.length, written: res.written };
}

// Id lists, CDX dumps and listings later adapters seed from.
const IDS = [
  ['eng/getsyllabus_full.tsv', 'getsyllabus_full.tsv'],
  ['eng/getfile_ids.tsv', 'getfile_ids.tsv'],
  ['eng/getsyllabus_by_course.json', 'getsyllabus_by_course.json'],
  ['eng/wayback_syllabus_by_course.json', 'wayback_syllabus_by_course.json'],
  ['eng/items_parsed.json', 'ws-engr-items_parsed.json'],
  ['eng/portal_rows.json', 'grainger-portal_rows.json'],
  ['eng/sites.jsonl', 'grainger-sites_fa2026.jsonl'],
  ['eng/missing_ids.txt', 'getsyllabus_missing_ids.txt'],
  ['grainger_fa2026_index.json', 'grainger_fa2026_index.json'],
  ['hosts/grainger_index_fa2026.json', 'grainger_index_fa2026_rows.json'],
  ['grainger/wb-getsyllabus.txt', 'wayback-getsyllabus.txt'],
  ['math/documents.txt', 'math-documents.txt'],
  ['math/topics_index.json', 'math-topics_index.json'],
  ['chem/documents.txt', 'chem-documents.txt'],
  ['las-hum/econ-documents.txt', 'econ-documents.txt'],
  ['las_sci/stat_documents.txt', 'stat-documents.txt'],
  ['las_sci/psyc_documents.txt', 'psyc-documents.txt'],
  ['las_sci/appsib_pdfs.json', 'app-sib_pdfs.json'],
  ['las_sci/appmcb_links.json', 'app-mcb_links.json'],
  ['las_sci/appmcb_probe_missing.txt', 'app-mcb_probe_missing.txt'],
  ['las_sci/manual_urls.txt', 'instructor-site_urls.txt'],
  ['las-hum/eui-docs.json', 'eui-docs.json'],
  ['las-hum/ps-box-links.json', 'ps-box-links.json'],
  ['las-hum/cdx-course-map.json', 'wayback-hum-course-map.json'],
  ['las-hum/histguides/index.json', 'hist-guides_index.json'],
  ['econ/boxfiles.json', 'econ-box-listing.json'],
  ['up-syllabi-urls.txt', 'up-syllabi-urls.txt'],
  ['up-coverage.json', 'up-coverage.json'],
  ['ischool-urls.txt', 'ischool-urls.txt'],
  ['gies-live.tsv', 'gies-live.tsv'],
  ['law-courses.tsv', 'law-courses.tsv'],
  ['fall2026_urls.tsv', 'ce-fall2026-links.tsv'],
  ['ce_fall2026_findings.json', 'ce-fall2026-findings.json'],
  ['lms-archives/moodle_syllabus_like.json', 'moodle_syllabus_like.json'],
  ['lms-archives/publish_sites.txt', 'publish_sites.txt'],
  ['lms-archives/wiki_course_spaces.json', 'wiki_course_spaces.json'],
];
const copied = [];
const copy = (from, to) => {
  if (!existsSync(R(from))) { skipped.push({ file: from, reason: 'missing (id list)' }); return; }
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(R(from), to, { recursive: true });
  copied.push(relative(DATA, to));
};
for (const [from, to] of IDS) copy(from, join(DIRS.ids, to));
for (const dir of ['cdx', 'las-hum/cdx', 'lms-archives/cdx', 'ler']) if (existsSync(R(dir))) copy(dir, join(DIRS.ids, 'cdx', dir.replace(/\//g, '_')));
for (const f of readdirSync(R('eng')).filter((n) => /^cdx_.*\.txt$/.test(n))) copy(`eng/${f}`, join(DIRS.ids, 'cdx', 'eng', f));
for (const f of readdirSync(R('lms-archives')).filter((n) => /^(cdx|lmscdx|roots|legacy)_.*\.txt$/.test(n))) copy(`lms-archives/${f}`, join(DIRS.ids, 'cdx', 'lms-archives', f));
// Canvas ids only, for the day the student decides; nothing reads them now.
for (const f of ['canvas-ids-wayback.txt', 'canvas-sample-ids.txt', 'eng/canvas_ids.txt', 'eng/canvas_ids2.txt', 'lms-archives/canvas_cdx_all.txt']) if (existsSync(R(f))) copy(f, join(DIRS.ids, 'canvas', basename(f)));

// The design and the sweeps' per-course verdicts, plus the resumable Canvas sweep script it names.
const RESEARCH = [
  ['discovery-result.json', 'discovery-result.json'],
  ['design/merged_coverage.json', 'merged_coverage.json'],
  ['design/merge.py', 'merge.py'],
  ['las_sci/coverage.json', 'sweep-sciences-coverage.json'],
  ['las-hum/coverage.json', 'sweep-humanities-coverage.json'],
  ['coverage-professional.json', 'sweep-professional-coverage.json'],
  ['eng/labels.json', 'sweep-engineering-labels.json'],
  ['results.tsv', 'search-results.tsv'],
  ['lms-archives/canvas_id_sweep.py', 'canvas_id_sweep.py'],
];
for (const [from, to] of RESEARCH) {
  if (!existsSync(R(from))) { skipped.push({ file: from, reason: 'missing (research)' }); continue; }
  copyFileSync(R(from), join(DIRS.research, to));
  copied.push(`research/${to}`);
}

const report = { at: new Date().toISOString(), from: FROM, items: items.length, stored, alreadyCached: already, manifests, copied: copied.length, skipped, excluded: EXCLUDED };
writeFileSync(join(DIRS.state, 'import-report.json'), JSON.stringify(report, null, 1));
console.log(`imported ${items.length} files (${stored} stored, ${already} already cached), ${ceFiles.length} of them Course Explorer pages`);
for (const [s, m] of Object.entries(manifests)) console.log(`  ${s.padEnd(22)} ${String(m.documents).padStart(4)} documents`);
console.log(`copied ${copied.length} id lists and research files; skipped ${skipped.length}; excluded ${EXCLUDED.length} groups (see data/syllabi/state/import-report.json)`);
