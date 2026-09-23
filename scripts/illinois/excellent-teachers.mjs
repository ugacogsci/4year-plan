/**
 * Teachers Ranked as Excellent by Their Students, as structured data.
 *
 * Every term, students at Illinois rate their instructors (ICES). CITL
 * publishes the instructors whose ratings cleared a fixed cutoff as a PDF, one
 * per term, in department order: the instructor's last name and first initial,
 * a star when the ratings were outstanding, "TA" for teaching assistants, and
 * the course numbers the ratings came from. It is the university's own
 * published measure of how students rated a course's teaching, and the only
 * one this planner uses: RateMyProfessors is a third party whose terms forbid
 * scraping, and the README says not to build on such data.
 *
 * The lists live in Box folders linked from citl.illinois.edu/teachers-ranked-
 * excellent, one folder per year. This script reads that page, finds the
 * folders, lists their PDFs, downloads the ones for the years asked for, has
 * pdfplumber turn each into text, and parses the entries.
 *
 * What it does not do: guess. A department heading it cannot map to a catalog
 * subject prefix is reported and its rows are kept with code null; a course
 * number that exists under no candidate prefix stays unresolved. Nothing here
 * is ever inferred from a name.
 *
 *   node scripts/illinois/excellent-teachers.mjs               # last 3 years
 *   node scripts/illinois/excellent-teachers.mjs --years 5
 *   node scripts/illinois/excellent-teachers.mjs --pdf-dir DIR  # parse PDFs already downloaded
 *
 * Needs python3 with pdfplumber (pip install pdfplumber).
 * Output: public/illinois-excellent.json
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ILLINOIS_SUBJECT_NAMES } from '../../lib/planner/illinois-subjects.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
const PAGE = 'https://citl.illinois.edu/teachers-ranked-excellent';
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const YEARS = Number(argOf('--years', '3'));
const PDF_DIR = argOf('--pdf-dir', join(ROOT, 'data', 'excellent'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'text') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(String(res.status));
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : { text: await res.text(), type: res.headers.get('content-type') ?? '' };
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Find and download the PDFs
// ---------------------------------------------------------------------------

/** Year -> Box shared-folder name, read off the CITL page's links. */
async function boxFolders() {
  const { text } = await get(PAGE);
  const out = new Map();
  // "<a href="https://uofi.box.com/s/NAME">2025</a>" in either order of appearance.
  for (const m of text.matchAll(/href="https:\/\/uofi\.box\.com\/s\/([a-z0-9]+)"[^>]*>\s*(\d{4})\s*</gi)) out.set(Number(m[2]), m[1]);
  for (const m of text.matchAll(/>\s*(\d{4})\s*<[^]{0,120}?href="https:\/\/uofi\.box\.com\/s\/([a-z0-9]+)"/gi)) if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2]);
  return out;
}

/** The PDFs inside one shared folder: Box embeds each item's typed id and name in the page. */
async function boxFiles(shared) {
  const { text } = await get(`https://uofi.box.com/s/${shared}`);
  const items = new Map();
  for (const m of text.matchAll(/"typedID":"(f_\d+)"[^{}]*?"name":"([^"]+)"|"name":"([^"]+)"[^{}]*?"typedID":"(f_\d+)"/g)) {
    const id = m[1] || m[4];
    const name = m[2] || m[3];
    if (/^tre-\d{4}-(?:spring|summer|fall|winter)\.pdf$/i.test(name)) items.set(id, name.toLowerCase());
  }
  return [...items].map(([id, name]) => ({ id, name, url: `https://uofi.box.com/index.php?rm=box_download_shared_file&shared_name=${shared}&file_id=${id}` }));
}

async function download() {
  mkdirSync(PDF_DIR, { recursive: true });
  const folders = await boxFolders();
  const years = [...folders.keys()].sort((a, b) => b - a).slice(0, YEARS);
  console.log(`CITL lists ${folders.size} years; taking ${years.join(', ')}`);
  for (const year of years) {
    const files = await boxFiles(folders.get(year));
    for (const f of files) {
      const dest = join(PDF_DIR, f.name);
      if (existsSync(dest)) { console.log(`  ${f.name}: already here`); continue; }
      const buf = await get(f.url, 'buffer');
      if (!buf || buf.subarray(0, 4).toString() !== '%PDF') { console.log(`  ${f.name}: not a PDF, skipped`); continue; }
      writeFileSync(dest, buf);
      console.log(`  ${f.name}: ${buf.length} bytes`);
      await sleep(900);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. PDF -> text -> rows
// ---------------------------------------------------------------------------

/**
 * The first Python on this machine that has pdfplumber. The shell's python3
 * and the one a Node child process finds are not always the same binary, and
 * "No module named pdfplumber" from the wrong one is not a missing package.
 * Set PYTHON to skip the search.
 */
let pythonBin = null;
function python() {
  if (pythonBin) return pythonBin;
  const candidates = [process.env.PYTHON, 'python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3.13', 'python3.12', 'python3.11'].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-c', 'import pdfplumber'], { stdio: 'ignore' });
      pythonBin = bin;
      return bin;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No python3 with pdfplumber found. Install it (pip install pdfplumber) or set PYTHON to the interpreter that has it.');
}

function pdfText(file) {
  const py = `
import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    for p in pdf.pages:
        print(p.extract_text(layout=True) or "")
        print("\\f")
`;
  return execFileSync(python(), ['-c', py, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const TERM_IN_TITLE = /based on data collected\s+(spring|summer|fall|winter)\s+(\d{4})/i;
const FOOTER = /^(?:spring|summer|fall|winter)\s+\d{4}\s+\d+$/i;
/**
 * "* Alt,M                449,451" / "  Dai,A             TA 201" / "  Augusto Sampaio,G    501,503".
 * The first-name field is one to three letters, which is what separates an
 * entry from a department heading that happens to hold a comma ("Nuclear,
 * Plasma & Radiological Engineering").
 */
const ENTRY = /^(\*)?\s*([A-Za-z][A-Za-z' .-]*?),\s*([A-Za-z]{1,3}\.?)(?:\s+(TA))?(?:\s+([\d][\d,\s]*))?$/;
const NUMBERS_ONLY = /^[\d][\d,\s]*$/;

function parseList(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\f/g, '').replace(/\s+$/, ''));
  const title = text.match(TERM_IN_TITLE);
  if (!title) throw new Error('no "Based on Data Collected <term>" line');
  const term = `${{ spring: 'sp', summer: 'su', fall: 'fa', winter: 'wi' }[title[1].toLowerCase()]}${title[2]}`;

  let unit = null;
  let started = false;
  let last = null;
  const trimmed = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i < trimmed.length; i += 1) {
    let line = trimmed[i];
    // A long name wraps: the last name sits alone on one line and ",J  501" on
    // the next. Read as two lines, the first would become a department heading
    // and every entry after it would be filed under a person's name.
    if (/^[A-Za-z][A-Za-z' .-]*$/.test(line) && i + 1 < trimmed.length && /^,\s*[A-Za-z]{1,3}\.?(?:\s|$)/.test(trimmed[i + 1])) {
      line = `${line}${trimmed[i + 1]}`;
      i += 1;
    }
    // The other wrap: a two-letter surname and its numbers on one line ("Fu
    // TA 385") and the initial alone on the next (",R"). Put the initial back
    // where the comma was.
    const initialOnly = i + 1 < trimmed.length ? trimmed[i + 1].match(/^,\s*([A-Za-z]{1,3})\.?$/) : null;
    if (initialOnly && !line.includes(',')) {
      line = line.replace(/^(\*?\s*[A-Za-z][A-Za-z' .-]*?)(\s+(?:TA\s+)?\d)/, `$1,${initialOnly[1]}$2`);
      i += 1;
    }
    if (!started) {
      if (line.toLowerCase() === 'accountancy') { started = true; unit = 'Accountancy'; }
      continue;
    }
    if (FOOTER.test(line)) continue;
    if (NUMBERS_ONLY.test(line) && last) {
      // Course numbers that wrapped onto their own line belong to the entry above.
      for (const n of line.split(/[\s,]+/).filter(Boolean)) last.numbers.push(n);
      continue;
    }
    const m = line.match(ENTRY);
    if (m) {
      const numbers = (m[5] ?? '').split(/[\s,]+/).filter((n) => /^\d{3}$/.test(n));
      last = { term, unit, lname: m[2].trim(), fname: m[3].replace('.', ''), role: m[4] ? 'TA' : 'Instructor', ranking: m[1] ? 'Outstanding' : 'Excellent', numbers };
      rows.push(last);
      continue;
    }
    // Anything else with letters and no course numbers is the next department.
    if (/[A-Za-z]/.test(line) && !/\d{3}/.test(line)) { unit = line; last = null; }
  }
  return { term, rows };
}

// ---------------------------------------------------------------------------
// 3. Department heading -> subject prefix -> catalog code
// ---------------------------------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const nameToPrefixes = new Map();
for (const [prefix, name] of Object.entries(ILLINOIS_SUBJECT_NAMES)) {
  const key = norm(name);
  nameToPrefixes.set(key, [...(nameToPrefixes.get(key) ?? []), prefix]);
}
/**
 * Department headings that are not the subject's catalog name. Only pairs that
 * were checked against the catalog by hand; an unmapped heading is reported,
 * never guessed.
 */
const UNIT_OVERRIDES = {
  'computer science': ['CS'],
  'siebel school of computing and data science': ['CS'],
  'electrical and computer engineering': ['ECE'],
  'electrical and computer engr': ['ECE'],
  'nuclear plasma and radiological engineering': ['NPRE'],
  'nuclear plasma and rad engr': ['NPRE'],
  'business administration': ['BADM', 'BUS'],
  'molecular and cellular biology': ['MCB', 'BIOC'],
  'school of molecular and cellular biology': ['MCB', 'BIOC'],
  'integrative biology': ['IB'],
  'school of integrative biology': ['IB'],
  'germanic languages and literatures': ['GER', 'SCAN', 'YDSH'],
  'spanish and portuguese': ['SPAN', 'PORT'],
  'east asian languages and cultures': ['EALC', 'CHIN', 'JAPN', 'KOR'],
  'slavic languages and literatures': ['SLAV', 'RUSS', 'BCS', 'CZCH', 'UKR', 'BULG'],
  'french and italian': ['FR', 'ITAL'],
  'classics': ['CLCV', 'GRK', 'LAT'],
  'the classics': ['CLCV', 'GRK', 'LAT'],
  'linguistics': ['LING', 'ESL', 'EIL'],
  'agricultural and biological engineering': ['ABE'],
  'agricultural and consumer economics': ['ACE'],
  'civil and environmental engineering': ['CEE'],
  'materials science and engineering': ['MSE'],
  'mechanical science and engineering': ['ME', 'TAM'],
  'aerospace engineering': ['AE'],
  'industrial and enterprise systems engineering': ['IE', 'SE'],
  'chemical and biomolecular engineering': ['CHBE'],
  'computer science and data science': ['CS'],
  'information sciences': ['IS'],
  'school of information sciences': ['IS'],
  'kinesiology and community health': ['HK'],
  'health and kinesiology': ['HK'],
  'kinesiology': ['HK'],
  'community health': ['HK'],
  'engineering technology and management for agricultural systems': ['ETMA'],
  'english as an international language': ['EIL'],
  'agricultural leadership education and communications program': ['ALEC', 'AGCM', 'AGED'],
  'agricultural leadership education and communications': ['ALEC', 'AGCM', 'AGED'],
  'latin american and caribbean studies': ['LAST'],
  'professional science masters program': ['PSM'],
  'literatures cultures and linguistics': ['SLCL'],
  'greek modern': ['GRKM'],
  'mba': ['MBA'],
  'recreation sport and tourism': ['RST'],
  'urban and regional planning': ['UP'],
  'landscape architecture': ['LA'],
  'theatre': ['THEA'],
  'dance': ['DANC'],
  'music': ['MUS', 'MUSC'],
  'art and design': ['ART', 'ARTD', 'ARTE', 'ARTF', 'ARTH', 'ARTJ', 'ARTS'],
  'school of art and design': ['ART', 'ARTD', 'ARTE', 'ARTF', 'ARTH', 'ARTJ', 'ARTS'],
  'gender and womens studies': ['GWS'],
  'latina latino studies': ['LLS'],
  'african american studies': ['AFRO'],
  'american indian studies': ['AIS'],
  'asian american studies': ['AAS'],
  'religion': ['REL'],
  'communication': ['CMN'],
  'media and cinema studies': ['MACS'],
  'journalism': ['JOUR'],
  'advertising': ['ADV'],
  'curriculum and instruction': ['CI'],
  'educational psychology': ['EPSY'],
  'education policy organization and leadership': ['EPOL'],
  'special education': ['SPED'],
  'social work': ['SOCW'],
  'school of social work': ['SOCW'],
  'labor and employment relations': ['LER'],
  'school of labor and employment relations': ['LER'],
  'natural resources and environmental sciences': ['NRES'],
  'food science and human nutrition': ['FSHN'],
  'human development and family studies': ['HDFS'],
  'animal sciences': ['ANSC'],
  'crop sciences': ['CPSC', 'HORT', 'PLPA'],
  'plant biology': ['PBIO'],
  'earth science and environmental change': ['GEOL', 'ESE'],
  'geology': ['GEOL'],
  'atmospheric sciences': ['ATMS'],
  'climate meteorology and atmospheric sciences': ['ATMS'],
  'geography and geographic information science': ['GGIS'],
  'political science': ['PS'],
  'sociology': ['SOC'],
  'anthropology': ['ANTH'],
  'psychology': ['PSYC'],
  'philosophy': ['PHIL'],
  'history': ['HIST'],
  'english': ['ENGL', 'CW', 'BTW', 'RHET', 'ESL'],
  'mathematics': ['MATH'],
  'statistics': ['STAT'],
  'physics': ['PHYS'],
  'chemistry': ['CHEM'],
  'astronomy': ['ASTR'],
  'economics': ['ECON'],
  'finance': ['FIN'],
  'accountancy': ['ACCY'],
  'speech and hearing science': ['SHS'],
  'bioengineering': ['BIOE'],
  'comparative and world literature': ['CWL'],
  'law': ['LAW'],
  'veterinary clinical medicine': ['VCM'],
  'veterinary medicine': ['VM'],
  'pathobiology': ['PATH'],
  'architecture': ['ARCH'],
  'military science': ['MILS'],
  'naval science': ['NS'],
  'aerospace studies': ['AFAS'],
  'engineering': ['ENG'],
  'general engineering': ['ENG'],
  'college of engineering': ['ENG'],
  'liberal arts and sciences': ['LAS'],
  'college of liberal arts and sciences': ['LAS'],
  'fine and applied arts': ['FAA'],
  'college of fine and applied arts': ['FAA'],
  'agricultural consumer and environmental sciences': ['ACES'],
  'college of aces': ['ACES'],
  'global studies': ['GLBL'],
  'center for global studies': ['GLBL'],
  'writing studies': ['WRIT'],
  'center for writing studies': ['WRIT'],
  'translation and interpreting studies': ['TRST'],
  'center for translation studies': ['TRST'],
  'graduate college': [],
  'applied health sciences': ['AHS'],
  'college of applied health sciences': ['AHS'],
  'interdisciplinary health sciences': ['HT'],
};

function prefixesFor(unit) {
  const key = norm(unit);
  if (UNIT_OVERRIDES[key]) return UNIT_OVERRIDES[key];
  if (nameToPrefixes.has(key)) return nameToPrefixes.get(key);
  // "Department of X", "School of X", "X (Dept.)"
  const stripped = key.replace(/^(?:department|dept|school|college|center|institute|program|division) of /, '').replace(/ (?:department|dept)$/, '');
  if (UNIT_OVERRIDES[stripped]) return UNIT_OVERRIDES[stripped];
  if (nameToPrefixes.has(stripped)) return nameToPrefixes.get(stripped);
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (!argv.includes('--pdf-dir')) await download();
const pdfs = readdirSync(PDF_DIR).filter((f) => /^tre-\d{4}-(?:spring|summer|fall|winter)\.pdf$/i.test(f)).sort();
if (pdfs.length === 0) { console.error(`no tre-*.pdf files in ${PDF_DIR}`); process.exit(1); }

const catalog = JSON.parse(readFileSync(join(ROOT, 'public', 'illinois-catalog.json'), 'utf8'));
const known = new Set(catalog.courses.map((c) => c.code.toUpperCase().replace(/\s+/g, ' ')));

const rows = [];
const terms = [];
const unmapped = new Map();
let unresolved = 0;
for (const file of pdfs) {
  const parsed = parseList(pdfText(join(PDF_DIR, file)));
  terms.push(parsed.term);
  let resolved = 0;
  for (const r of parsed.rows) {
    const prefixes = prefixesFor(r.unit);
    if (prefixes === null) unmapped.set(r.unit, (unmapped.get(r.unit) ?? 0) + 1);
    for (const number of r.numbers) {
      const codes = (prefixes ?? []).map((p) => `${p} ${number}`).filter((code) => known.has(code));
      if (codes.length > 0) resolved += 1; else unresolved += 1;
      rows.push({ term: r.term, unit: r.unit, lname: r.lname, fname: r.fname, role: r.role, ranking: r.ranking, number, codes });
    }
  }
  console.log(`${file}: ${parsed.term}, ${parsed.rows.length} entries, ${resolved} course rows resolved to a catalog code`);
}

writeFileSync(join(ROOT, 'public', 'illinois-excellent.json'), JSON.stringify({
  school: 'illinois',
  source: PAGE,
  sourceNote: 'List of Teachers Ranked as Excellent by Their Students, CITL. Faculty must clear fixed ICES cutoffs for both teaching effectiveness and course quality; TAs for teaching effectiveness only; at least five students must have responded. The list is self-described as incomplete: only instructors who used ICES and released their data appear.',
  fetchedAt: new Date().toISOString(),
  terms,
  rows,
}));

console.log(`\n${rows.length} course rows across ${terms.length} terms; ${unresolved} named a course under no catalog subject and stay unresolved`);
if (unmapped.size > 0) {
  console.log(`\n${unmapped.size} department headings could not be mapped to a subject prefix (rows kept, code null):`);
  for (const [u, n] of [...unmapped].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${u}`);
}
