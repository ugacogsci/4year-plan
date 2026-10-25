/**
 * Every degree's reading next to its catalog page, one compact file a degree.
 *
 *   node scripts/dev/audit/dump-readings.mjs --out <dir>
 *        --ill-sweeps <fall.jsonl>,<spring.jsonl> --uga-harness <harness.jsonl>
 *        [--ill-pages <dir>] [--fetch] [--school illinois|uga] [--ids a,b]
 *        [--checkout <planner checkout>] [--commit <label>]
 *
 * Why: the correctness audit (under 2% of plans missing a required class, a
 * stated reason for each one left) reads every degree page we offer beside how
 * the planner reads it and beside what the test boards left off. The sweep and
 * the harness count the misses; this puts the three side by side so a reader
 * can see whether a miss is the page, our reading of it, or the engine.
 *
 * For every Illinois bachelor degree the planner offers (openProgram: a
 * bachelor's degree with a catalog reading, not a suspended one) and every UGA
 * bachelor program (isUgaUndergraduateDegree over public/uga-programs.json),
 * it writes <out>/<school>/<id>.json and a .txt twin ("/" in an id is "__"):
 *
 *   catalog   the official page's requirement text, trimmed to the
 *             requirement lines (headings, course rows, "choose" sentences,
 *             totals; long prose cut);
 *   reading   the planner's reading from the same loaders the planner uses
 *             (Illinois: adaptIllinoisPrograms, as sweep.mjs and blocks.mjs
 *             load it; UGA: loadUgaData + loadUgaProgram with the emphasis
 *             picks the UGA harness makes), every block in plain words: take
 *             all, choose N, hours from a list, elective hours, gen ed, the
 *             language rule, rows not read; the options, tracks, emphases and
 *             concentrations and whether they are read as pick-one or take-all;
 *             the total hours;
 *   evidence  the test boards' required classes left off and unmet rows, from
 *             a sweep pair (scripts/dev/sweep/sweep.mjs, Fall 2026 and Spring
 *             2027 starts) and a UGA harness run (scripts/dev/uga-harness.mjs).
 *
 * The .txt keeps to about 4 KB: the catalog section gets what the reading and
 * the evidence leave, and long code lists are cut with "+N more" (the .json
 * has them whole). <out>/index.json lists every id with its miss counts,
 * degrees with misses first, and the baseline scoreboard. Illinois degrees the
 * planner does not offer (no courses read, not a bachelor's, suspended) are
 * listed there too, with why.
 *
 * Catalog pages are read from a cache, never fetched twice: Illinois from
 * --ill-pages (the copy scripts/illinois/sample-sequences.mjs cached, one
 * <id with "/" as "__">.html a degree) or <out>/raw/illinois/, UGA from
 * <out>/raw/uga/ (gzipped; a Bulletin detail page is about 1.5 MB). A page in
 * neither is fetched only with --fetch, politely: robots.txt first
 * (scripts/illinois/syllabi/lib/robots.mjs; a 404 means no rules, any other
 * failure means stop), the house agent (scripts/illinois/syllabi/lib/paths.mjs),
 * one request at a time per host at least 1.1 s apart (more when robots.txt
 * sets a Crawl-delay), no cookies, no redirect off the host, and three 403s
 * stop the host. UGA's detail pages are the endpoint scripts/uga-programs.mjs
 * reads: https://bulletin.uga.edu/Program/Details/{id}?IDc={college}.
 *
 * --school writes one school and keeps the other's half of index.json; --ids
 * writes only those degrees and leaves index.json alone (for a quick look).
 * The baseline of 2026-10-25 was written from the oct22-round2 "final" runs,
 * which rebuild identically at d5769a4:
 *
 *   R=keep-planner/uga-staging/harness/oct22-round2
 *   node scripts/dev/audit/dump-readings.mjs --out keep-planner/audit \
 *     --ill-sweeps $R/ill-final-fall.jsonl,$R/ill-final-spring.jsonl \
 *     --uga-harness $R/uga-final.jsonl --ill-pages keep-planner/seq/html --fetch
 *
 * Read-only for the checkout (default: the one this file is in). Node 23; it
 * re-runs itself with --experimental-strip-types. About eight minutes, nearly
 * all of it reading the 1.5 MB UGA pages.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const argv = process.argv.slice(2);
const opt = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : null);
const OUT = opt('--out') ? resolve(opt('--out')) : null;
if (!OUT || !opt('--ill-sweeps') || !opt('--uga-harness')) {
  console.error('usage: dump-readings.mjs --out <dir> --ill-sweeps <fall.jsonl>,<spring.jsonl> --uga-harness <harness.jsonl> [--ill-pages <dir>] [--fetch] [--school illinois|uga] [--ids a,b] [--checkout <dir>] [--commit <label>]');
  process.exit(2);
}
const ROOT = resolve(opt('--checkout') ?? join(HERE, '..', '..', '..'));
const FETCH = argv.includes('--fetch');
const SCHOOLS = opt('--school') ? [opt('--school')] : ['illinois', 'uga'];
const ONLY = opt('--ids') ? new Set(opt('--ids').split(',').map((s) => s.trim())) : null;
const COMMIT = opt('--commit') ?? (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || 'unknown');
const TXT_BUDGET = 4096;

const { UA } = await import(pathToFileURL(join(HERE, '..', '..', 'illinois', 'syllabi', 'lib', 'paths.mjs')).href);
const { parseRobots, decide, groupFor, ALLOW_ALL } = await import(pathToFileURL(join(HERE, '..', '..', 'illinois', 'syllabi', 'lib', 'robots.mjs')).href);
const { takeAllExclusionPairs } = await import(pathToFileURL(join(HERE, '..', 'sweep', 'takeall.mjs')).href);

// The checkout's own TypeScript, .tsx included, as scripts/dev/uga-harness.mjs loads it.
register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
      }).outputText
    };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));
const readRows = (path) => readFileSync(resolve(path), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const fileOf = (id) => id.replace(/\//g, '__');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// ---------------------------------------------------------------------------
// Polite fetching (only with --fetch, only for a page no cache holds)
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hosts = new Map();
let fetched = 0;

async function spaced(h, fn) {
  const gap = Math.max(1100, (h.crawlDelay ?? 0) * 1000);
  const wait = h.lastAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  try { return await fn(); } finally { h.lastAt = Date.now(); }
}

async function hostFor(u) {
  if (hosts.has(u.host)) return hosts.get(u.host);
  const h = { lastAt: 0, crawlDelay: null, robots: null, stopped: null, streak403: 0 };
  hosts.set(u.host, h);
  const res = await spaced(h, async () => {
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      return { status: r.status, text: r.status === 200 ? await r.text() : '' };
    } catch (e) {
      return { status: 0, text: '', error: e.message };
    }
  });
  // As the syllabus fetcher decides it: 200 gives the rules, 404/410 none, anything else stops the host.
  if (res.status === 200) h.robots = parseRobots(res.text);
  else if (res.status === 404 || res.status === 410) h.robots = ALLOW_ALL;
  else h.stopped = `robots.txt answered ${res.status || res.error}`;
  if (h.robots) h.crawlDelay = groupFor(h.robots).crawlDelay;
  console.error(`[fetch] ${u.origin}/robots.txt: ${res.status} (${h.stopped ? 'stop' : h.robots === ALLOW_ALL ? 'no rules' : 'rules'})`);
  return h;
}

/** One page, politely, or { error }. Redirects are followed only on the same host. */
async function politeGet(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const u = new URL(current);
    const h = await hostFor(u);
    if (h.stopped) return { error: `host stopped: ${h.stopped}` };
    const verdict = decide(h.robots, current);
    if (!verdict.allowed) return { error: `robots.txt: ${verdict.rule}` };
    let res = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      res = await spaced(h, async () => {
        try {
          const r = await fetch(current, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(90_000) });
          return { status: r.status, location: r.headers.get('location'), body: r.status === 200 ? await r.text() : '' };
        } catch (e) {
          return { status: 0, error: e.message };
        }
      });
      fetched += 1;
      if (res.status === 429 || res.status >= 500 || res.status === 0) {
        await sleep(10_000 * (attempt + 1));
        continue;
      }
      break;
    }
    if (res.status === 200) return { body: res.body, finalUrl: current };
    if (res.status === 403 && (h.streak403 += 1) >= 3) h.stopped = 'three 403s';
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, current);
      if (next.host !== u.host) return { error: `redirect off the host to ${next.href}` };
      current = next.href;
      continue;
    }
    return { error: `HTTP ${res.status || res.error}` };
  }
  return { error: 'too many redirects' };
}

/** A page from the caches, or fetched (with --fetch) and cached gzipped under <out>/raw/<school>/. */
async function pageFor(school, id, url, extraDirs = []) {
  for (const dir of extraDirs) {
    const f = join(dir, `${fileOf(id)}.html`);
    if (existsSync(f)) return { html: readFileSync(f, 'utf8'), cache: f, cachedAt: statSync(f).mtime.toISOString() };
  }
  const raw = join(OUT, 'raw', school);
  const gz = join(raw, `${fileOf(id)}.html.gz`);
  const meta = join(raw, `${fileOf(id)}.meta.json`);
  if (existsSync(gz)) {
    const m = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : {};
    return { html: gunzipSync(readFileSync(gz)).toString('utf8'), cache: gz, cachedAt: m.fetchedAt ?? statSync(gz).mtime.toISOString() };
  }
  if (!FETCH) return { html: null, error: 'not cached (run with --fetch)' };
  const got = await politeGet(url);
  if (got.error) return { html: null, error: got.error };
  mkdirSync(raw, { recursive: true });
  const fetchedAt = new Date().toISOString();
  writeFileSync(gz, gzipSync(got.body));
  writeFileSync(meta, JSON.stringify({ url, finalUrl: got.finalUrl, fetchedAt, bytes: bytes(got.body), agent: UA }) + '\n');
  return { html: got.body, cache: gz, cachedAt: fetchedAt };
}

// ---------------------------------------------------------------------------
// HTML to requirement lines
// ---------------------------------------------------------------------------
const NAMED = { nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', bull: '*', middot: '*', copy: '(c)', reg: '(R)', trade: '(TM)', sect: 'Sec.' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
  .replace(/[    ]/g, ' ')
  .replace(/[–—]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"');
const text = (h) => decode(String(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const CODE = /^(?:or\s+|&\s*)?([A-Z]{2,5}(?:\([A-Z]{2,5}\))*\s?\d{3,4}[A-Z]{0,2})\b/;
const KEEP_PROSE = /\b(hours?|courses?|credit|select|choose|one of|two of|at least|minimum|maximum|required|requirement|elective|must|concentration|option|track|emphasis|focus|area|GPA|grade|semester|level|total|from the following|in addition)\b/i;
/** Boilerplate every page of a school prints, which says nothing about this degree. */
const DROP_PROSE = /Student Code|residency requirements can be found|Follows the campus General Education|consult (?:their|your) academic advisor for additional guidance|^for the degree of\b|^Jump to Section$|^Select Selection$|^For more information, go to\b/i;
/** A bold run that opens its block ("<p><strong>University Requirements</strong><br/>...") is a heading. */
const BOLD_HEAD = /(?<=(?:<p[^>]*>|<div[^>]*>|<br\s*\/?>|<li[^>]*>|<td[^>]*>)\s*(?:<span[^>]*>\s*)*)<(strong|b)\b[^>]*>([\s\S]{1,400}?)<\/\1>/gi;

/**
 * The lines of a requirement section, in page order. Each line is one of
 * { t: 'h', text } a heading, { t: 'c', code, title, hrs, or, and } a course
 * row, { t: 'm', text, hrs } a list comment or area header, { t: 's', text,
 * hrs } a total row, { t: 'p', text } prose the requirement words keep.
 */
function linesOf(html) {
  let s = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<div class="tooltip">[\s\S]*?<\/div>/gi, '')
    .replace(/<caption[\s\S]*?<\/caption>/gi, '')
    .replace(/<thead[\s\S]*?<\/thead>/gi, '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '');
  const out = [];
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\u0001H${text(t)}\n`);
  s = s.replace(BOLD_HEAD, (m, tag, t) => {
    const words = text(t);
    return words.length > 0 && words.length <= 90 && !/[.:;]\s*\S/.test(words) ? `\n\u0001H${words}\n` : m;
  });
  s = s.replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi, (_, attrs, inner) => {
    const cells = [...inner.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((c) => ({ cls: c[1], html: c[2], text: text(c[2]) }));
    return `\n\u0001R${JSON.stringify({ cls: (attrs.match(/class="([^"]*)"/) ?? [])[1] ?? '', cells: cells.map((c) => c.text), comment: /courselistcomment/.test(inner) })}\n`;
  });
  s = s.replace(/<\/?(p|div|li|ul|ol|br|table|tbody|section|button|span class="courselistcomment[^"]*")[^>]*>/gi, '\n');
  for (const rawLine of s.split('\n')) {
    if (rawLine.startsWith('\u0001H')) {
      const t = rawLine.slice(2).trim();
      if (t) out.push({ t: 'h', text: t });
      continue;
    }
    if (rawLine.startsWith('\u0001R')) {
      const row = JSON.parse(rawLine.slice(2));
      const cells = row.cells.filter((c, i) => c || i === row.cells.length - 1);
      const first = cells[0] ?? '';
      const hrs = cells.length > 1 ? cells[cells.length - 1] : '';
      if (!first && !hrs) continue;
      if (/^(code|title|hours)$/i.test(first)) continue;
      const m = first.match(CODE);
      if (m && !row.comment) {
        const codes = [...first.matchAll(/[A-Z]{2,5}(?:\([A-Z]{2,5}\))*\s?\d{3,4}[A-Z]{0,2}\b/g)].map((x) => x[0].replace(/^([A-Z]+)(\d)/, '$1 $2'));
        out.push({ t: 'c', code: codes.join(' & '), title: cells.length > 2 ? cells[1] : '', hrs: /^\d|^[\d.\s-]+$/.test(hrs) ? hrs : '', or: /^or\b/i.test(first) || /orclass/.test(row.cls) });
      } else if (/listsum/.test(row.cls) || /^total\b/i.test(first)) {
        out.push({ t: 's', text: first, hrs });
      } else {
        out.push({ t: 'm', text: cells.slice(0, cells.length > 1 ? -1 : 1).join(' ').trim() || first, hrs: cells.length > 1 ? hrs : '' });
      }
      continue;
    }
    const t = text(rawLine);
    if (!t || DROP_PROSE.test(t)) continue;
    if (t.length <= 60 || KEEP_PROSE.test(t)) out.push({ t: 'p', text: t.length > 400 ? `${t.slice(0, 397)}...` : t });
  }
  // Prose repeated word for word (accordion copies, footers) is said once.
  const seen = new Set();
  return out.filter((l) => {
    if (l.t !== 'p') return true;
    if (seen.has(l.text)) return false;
    seen.add(l.text);
    return true;
  });
}

/** One CourseLeaf tab (id="<name>textcontainer"), from its opening tag to the next tab's, or ''. */
function tabOf(html, name) {
  const at = html.indexOf(`id="${name}textcontainer"`);
  if (at < 0) return '';
  const from = html.lastIndexOf('<', at);
  const rest = html.slice(at + name.length + 18);
  const next = rest.search(/id="[a-z]+textcontainer"/);
  const end = next >= 0 ? html.lastIndexOf('<', at + name.length + 18 + next) : html.length;
  return html.slice(from, end);
}

/**
 * The Illinois page's requirements: its Degree Requirements tab (one page
 * calls it Requirements), with a Supporting Electives tab after it when the
 * page has one; or the overview, when the page has neither (a hub page).
 */
function illinoisSection(html) {
  const req = tabOf(html, 'degreerequirements') || tabOf(html, 'requirements');
  if (req) {
    const extra = tabOf(html, 'supportingelectives');
    return { tab: extra ? 'Degree Requirements + Supporting Electives' : 'Degree Requirements', html: extra ? `${req}<h2>Supporting Electives</h2>${extra}` : req };
  }
  const overview = tabOf(html, '');
  return overview ? { tab: 'Overview (the page has no Degree Requirements tab)', html: overview } : { tab: null, html: '' };
}

/**
 * The UGA detail page's requirement part: from the first area (id="DegreeReq")
 * to the first of the career, transfer and program-of-study sections, and the
 * college-wide requirements apart.
 */
function ugaSections(html) {
  // The first area heading ("I. Foundation Courses (9 Hours)"); the page's
  // jump menu and overview come before it. A page without the core areas
  // starts at its Major Requirements, or at the first requirement panel.
  const areaOne = html.search(/<h[3-6][^>]*>\s*I\.\s/);
  const major = html.search(/<h[2-6][^>]*>\s*Major Requirements\s*<\/h[2-6]>/i);
  const panel = html.indexOf('id="DegreeReq"');
  const from = areaOne >= 0 ? areaOne : major >= 0 ? major : panel >= 0 ? html.lastIndexOf('<', panel) : 0;
  const tail = html.slice(from);
  const stop = tail.search(/<h[2-6][^>]*>\s*(?:Career Information|Transfer Student Information|Available Scholarships|Internship Opportunities|Student Organizations|Available Graduate Programs|Four-Year Program of Study)\s*<\/h[2-6]>/i);
  const main = stop >= 0 ? tail.slice(0, stop) : tail.slice(0, 2_000_000);
  const cw = html.search(/<h[2-6][^>]*>\s*College-wide Requirements\s*<\/h[2-6]>/i);
  const college = cw >= 0 ? html.slice(cw, cw + 60_000) : '';
  return { main, college };
}

/**
 * Compact text of catalog lines: course rows run together, long lists cut.
 * Under a heading `squeeze` matches (UGA's core areas I to V, which list
 * every approved core course), a course list is only counted.
 */
function catalogText(lines, budget, squeeze = null) {
  const rows = [];
  let run = [];
  let squeezed = false;
  const flush = () => {
    if (!run.length) return;
    if (squeezed) {
      rows.push(`  (${run.length} course${run.length === 1 ? '' : 's'} listed)`);
      run = [];
      return;
    }
    const big = run.length > 30;
    const shown = big ? run.slice(0, 8) : run;
    let line = '';
    for (const c of shown) {
      const piece = `${c.or ? 'or ' : ''}${c.code}${c.hrs ? ` (${c.hrs})` : ''}`;
      if (line && line.length + piece.length > 100) { rows.push(`  ${line}`); line = ''; }
      line = line ? `${line}${c.or ? ' ' : ', '}${piece}` : piece;
    }
    if (shown.length < run.length) line += `, ... ${run.length} courses listed`;
    if (line) rows.push(`  ${line}`);
    run = [];
  };
  let notes = [];
  const flushNotes = () => {
    // Short list comments ("Composition I [4-6]") share a line.
    let line = '';
    for (const n of notes) {
      if (line && line.length + n.length > 110) { rows.push(`  > ${line}`); line = ''; }
      line = line ? `${line} | ${n}` : n;
    }
    if (line) rows.push(`  > ${line}`);
    notes = [];
  };
  for (const l of lines) {
    if (l.t === 'c') { flushNotes(); run.push(l); continue; }
    flush();
    if (l.t === 'm' && l.text.length <= 60) { notes.push(`${l.text}${l.hrs ? ` [${l.hrs}]` : ''}`); continue; }
    flushNotes();
    if (l.t === 'h') {
      rows.push(`## ${l.text}`);
      if (squeeze) squeezed = squeeze.test(l.text) ? true : /^(VI\.|Major|Required|General Electives|Total)/i.test(l.text) ? false : squeezed;
    } else if (l.t === 'm') rows.push(`  > ${l.text.length > 200 ? `${l.text.slice(0, 197)}...` : l.text}${l.hrs ? ` [${l.hrs}]` : ''}`);
    else if (l.t === 's') rows.push(`  = ${l.text} ${l.hrs}`.trimEnd());
    else {
      const room = squeezed ? 100 : 160;
      rows.push(`  ${l.text.length > room ? `${l.text.slice(0, room - 3)}...` : l.text}`);
    }
  }
  flush();
  flushNotes();
  // Headings with nothing under them before the next heading say nothing.
  const kept = rows.filter((r, i) => !(r.startsWith('## ') && (i === rows.length - 1 || rows[i + 1].startsWith('## '))) || /\(\d/.test(r));
  let out = '';
  for (let i = 0; i < kept.length; i += 1) {
    const next = `${kept[i]}\n`;
    if (bytes(out) + bytes(next) > budget) {
      out += `  ... ${kept.length - i} more catalog lines in the .json\n`;
      break;
    }
    out += next;
  }
  return out;
}

/**
 * UGA's catalog text: the university core (areas I to V, the same approved
 * lists on every program) as one line an area, then the rest of the page.
 */
const CORE_AREA = /^(?:I|II|III|IV|V)\.\s/;
function ugaCatalogText(lines, budget) {
  const end = lines.findIndex((l) => l.t === 'h' && /^(?:VI\.\s|Major Requirements$|Entrance Requirements$|Required Courses\b|Major Electives\b)/i.test(l.text));
  if (end <= 0 || !lines.slice(0, end).some((l) => l.t === 'h' && CORE_AREA.test(l.text))) return catalogText(lines, budget, CORE_AREA);
  const areas = [];
  let cur = null;
  for (const l of lines.slice(0, end)) {
    if (l.t === 'h' && CORE_AREA.test(l.text)) { cur = { head: l.text, courses: 0, bits: [] }; areas.push(cur); continue; }
    if (!cur) continue;
    if (l.t === 'c') cur.courses += 1;
    else if (l.t === 'h' && /^preferred/i.test(l.text)) cur.bits.push('preferred courses named');
    else if (/\b(choose|at least|must)\b/i.test(l.text ?? '')) cur.bits.push(l.text.slice(0, 90));
  }
  const core = `## Core areas I-V (the university core; course lists only counted)\n${areas.map((a) => `  ${a.head}: ${a.courses} course rows${a.bits.length ? `; ${[...new Set(a.bits)].join('; ')}` : ''}`).join('\n')}\n`;
  return core + catalogText(lines.slice(end), Math.max(600, budget - bytes(core)), CORE_AREA);
}

/** Catalog lines for the .json: titles dropped inside long lists (UGA's core areas list hundreds). */
function compactLines(lines) {
  const out = [];
  let run = [];
  const flush = () => {
    const big = run.length > 30;
    for (const c of run) out.push(big ? `${c.or ? 'or ' : ''}${c.code}${c.hrs ? ` (${c.hrs})` : ''}` : `${c.or ? 'or ' : ''}${c.code}${c.title ? ` | ${c.title}` : ''}${c.hrs ? ` | ${c.hrs}` : ''}`);
    run = [];
  };
  for (const l of lines) {
    if (l.t === 'c') { run.push(l); continue; }
    flush();
    out.push(l.t === 'h' ? `## ${l.text}` : l.t === 'm' ? `> ${l.text}${l.hrs ? ` [${l.hrs}]` : ''}` : l.t === 's' ? `= ${l.text} ${l.hrs}`.trim() : l.text);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// A block in plain words
// ---------------------------------------------------------------------------
function choiceText(ch) {
  if (ch.bundles?.length) return ch.bundles.map((set) => (set.length > 1 ? `(${set.join(' + ')})` : set[0])).join(' | ');
  let t = ch.codes.join(' | ');
  if (ch.substitutes?.length) t += ` [or held: ${ch.substitutes.join(', ')}]`;
  if (ch.repeat) t += ` [x${ch.repeat.sittings ?? ch.repeat.times ?? '?'}]`;
  return t;
}
const listOf = (choices, cap) => {
  const all = choices.map(choiceText);
  // A list of dozens (a core area, "any upper-level course") is only counted in the .txt.
  if (cap && all.length > 60) return `(${all.length} courses; the list is in the .json)`;
  return cap && all.length > cap ? `${all.slice(0, cap).join(', ')}, +${all.length - cap} more` : all.join(', ');
};
const sumCredits = (choices) => choices.reduce((n, c) => n + (c.credits ?? 0), 0);

/** { kind, words, codes } for one requirement block; `cap` cuts long lists (for the .txt). */
function plainRule(b, cap) {
  const r = b.rule;
  const h = b.hours ?? null;
  switch (r.kind) {
    case 'all':
      return `TAKE ALL ${r.choices.length} (${sumCredits(r.choices)} h${h != null && h !== sumCredits(r.choices) ? `; row says ${h} h` : ''}): ${listOf(r.choices, cap)}`;
    case 'choose':
      return `CHOOSE ${r.n} of ${r.choices.length}${h != null ? ` (${h} h)` : ''}${r.list ? ' [option list split out of a required table]' : ''}${r.sharedFirst ? ' [a course another area requires goes first]' : ''}: ${listOf(r.choices, cap)}`;
    case 'pool': {
      const size = [r.hours != null ? `${r.hours} h` : null, r.n != null ? `${r.n} courses` : null].filter(Boolean).join(' / ') || 'no size stated';
      const lists = r.lists?.length > 1 ? `; lists: ${r.lists.map((l) => `${l.label || '(unnamed)'} (${l.codes.length})`).join(', ')}` : '';
      const cons = (r.constraints ?? []).map((c) => `; rule: ${c.n}${c.hours ? ` (${c.hours} h)` : ''} ${c.single ? 'from ONE list (pick one track)' : c.distinctLists ? 'from different lists' : 'from the named lists'}: "${c.text.slice(0, 120)}"`).join('');
      return `FROM LIST: ${size} from ${r.choices.length} courses${r.from === 'area' ? ' [size stated once for the whole area]' : ''}${r.joinedByOr ? ' [rows joined by OR]' : ''}${lists}${cons}: ${listOf(r.choices, cap)}`;
    }
    case 'hours':
      return `ELECTIVE HOURS: ${r.hours} h${r.minLevel ? `, ${r.minLevel}-level or above` : ''}${r.genEd?.length ? `, gen ed ${r.genEd.join('/')}` : ''}${r.exclude?.length ? `, not ${r.exclude.join(', ')}` : ''}${r.source && r.source !== 'catalog' ? ` [${r.source}]` : ''} (no courses named; the planner fills them)`;
    case 'gened':
      return `GEN ED: ${r.label || b.label}: ${[r.hours != null ? `${r.hours} h` : null, r.courses != null ? `${r.courses} course${r.courses === 1 ? '' : 's'}` : null].filter(Boolean).join(' / ') || 'size not stated'} of ${r.genEd.join(' or ')}${r.fulfilledBy?.length ? `; page says met by ${r.fulfilledBy.map((g) => g.join(' or ')).join(', ')}` : ''}${r.sizeFromCampus ? ' [size from the campus table]' : ''}`;
    case 'language':
      return `LANGUAGE: through the ${r.semesters === 4 ? 'fourth' : 'third'} semester (courses depend on the student's language and start)`;
    case 'unparsed':
      return `NOT READ (no rule; the planner cannot plan it): "${String(r.text).slice(0, cap && cap <= 6 ? 90 : 220)}"`;
    default:
      return `${String(r.kind).toUpperCase()}: ${JSON.stringify(r).slice(0, 200)}`;
  }
}
const codesOfRule = (r) => (r.choices ?? []).flatMap((c) => [...(c.bundles?.flat() ?? []), ...c.codes]).map(norm);

function readingOf(blocks) {
  return blocks.map((b, i) => ({
    ref: `R${i + 1}`,
    id: b.id,
    area: b.areaLabel ?? '',
    label: b.label ?? '',
    kind: b.rule.kind,
    hours: b.hours ?? null,
    words: plainRule(b, 0),
    note: b.note ? String(b.note).slice(0, 300) : '',
    codes: [...new Set(codesOfRule(b.rule))],
  }));
}
/** A gen-ed block in a few words, for the .txt's one gen-ed line. */
function genEdShort(b) {
  const r = b.rule;
  const size = [r.hours != null ? `${r.hours}h` : null, r.courses != null ? `${r.courses}c` : null].filter(Boolean).join('/') || '?';
  const label = String(r.label || b.label).replace(/^Cultural Studies:\s*/i, 'CS ').replace(/Natural Sciences & Technology/i, 'NST').replace(/Social (?:&|and) Behavioral Sciences/i, 'SBS').replace(/Humanities & the Arts/i, 'Hum&Arts').replace(/Quantitative Reasoning/i, 'QR').slice(0, 30);
  return `${label} ${size}${r.fulfilledBy?.length ? ` (met by ${r.fulfilledBy.map((g) => g.join('/')).join(', ')})` : ''}`;
}
function readingText(blocks, cap) {
  let lastArea = null;
  const rows = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    const area = b.areaLabel ?? '';
    if (area !== lastArea) { rows.push(`# ${area || '(no area label)'}`); lastArea = area; }
    if (cap && b.rule.kind === 'gened') {
      // A run of gen-ed blocks shares one line in the .txt (each is whole in the .json).
      let j = i;
      while (j + 1 < blocks.length && blocks[j + 1].rule.kind === 'gened' && (blocks[j + 1].areaLabel ?? '') === area) j += 1;
      rows.push(`R${i + 1}${j > i ? `-R${j + 1}` : ''} GEN ED: ${blocks.slice(i, j + 1).map(genEdShort).join('; ')}`);
      i = j;
      continue;
    }
    const label = b.label && b.label !== area ? `${b.label.slice(0, cap && cap <= 6 ? 40 : 70)}: ` : '';
    rows.push(`R${i + 1} ${label}${plainRule(b, cap)}`);
  }
  return rows.join('\n') + '\n';
}

/** Which blocks name a code, as refs. */
function refsFor(blocks, code) {
  const c = norm(code);
  return blocks.map((b, i) => (codesOfRule(b.rule).includes(c) ? `R${i + 1}` : null)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
function writeDegree(school, id, json, sections) {
  const dir = join(OUT, school);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fileOf(id)}.json`), JSON.stringify(json) + '\n');
  // The .txt: header, reading, evidence, then the catalog with what is left of
  // the budget (at least 1.4 KB of it). Lists are cut harder until it fits.
  const head = sections.head;
  let reading = '';
  let evidence = '';
  for (const [cap, lim] of [[24, 12], [12, 8], [6, 6], [3, 4]]) {
    reading = sections.reading(cap);
    evidence = sections.evidence(lim);
    if (bytes(head) + bytes(reading) + bytes(evidence) + 1400 <= TXT_BUDGET) break;
  }
  const left = Math.max(1400, TXT_BUDGET - bytes(head) - bytes(reading) - bytes(evidence) - 120);
  const txt = `${head}\n== CATALOG (requirement lines, prose trimmed; ${sections.catalogNote}) ==\n${sections.catalog(left)}\n== OUR READING (the planner's own loaders) ==\n${reading}\n== PLAN EVIDENCE at ${COMMIT} ==\n${evidence}`;
  writeFileSync(join(dir, `${fileOf(id)}.txt`), txt);
  return bytes(txt);
}

const index = { generatedAt: new Date().toISOString(), commit: COMMIT, checkout: ROOT, script: 'scripts/dev/audit/dump-readings.mjs', sources: {}, baseline: {}, illinois: [], illinoisNotOffered: [], uga: [], txtOver4k: [] };
if (existsSync(join(OUT, 'index.json'))) {
  // A run for one school keeps the other school's half of the index.
  const old = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
  for (const k of ['illinois', 'illinoisNotOffered', 'uga']) if (!SCHOOLS.includes(k === 'uga' ? 'uga' : 'illinois')) index[k] = old[k] ?? [];
  if (!SCHOOLS.includes('illinois')) { index.baseline.illinois = old.baseline?.illinois; index.sources.illinois = old.sources?.illinois; }
  if (!SCHOOLS.includes('uga')) { index.baseline.uga = old.baseline?.uga; index.sources.uga = old.sources?.uga; }
  index.txtOver4k = (old.txtOver4k ?? []).filter((t) => !SCHOOLS.includes(t.school));
}

// ---------------------------------------------------------------------------
// Illinois
// ---------------------------------------------------------------------------
const GOAL = { '': 'no goal', 'medical school': 'pre-med', 'physical therapy school': 'pre-PT' };
const boardName = (r) => `${r.start === 'Fall 2026' ? 'F26' : 'S27'} ${GOAL[r.goal] ?? r.goal} lang${r.lang}`;

if (SCHOOLS.includes('illinois')) {
  const { adaptIllinoisPrograms } = await lib('lib/planner/illinois-data.ts');
  const { hydrateIndexRow } = await lib('lib/planner/illinois-load.ts');
  const IS = await lib('components/planner/illinois-source.tsx');
  const rows = publicJson('illinois/index.json').map(hydrateIndexRow);
  const byCode = new Map(rows.map((c) => [norm(c.code), c]));
  const exclusions = publicJson('illinois/exclusions.json');
  const summaries = publicJson('illinois/programs.json').filter((s) => s.id);
  const [fallFile, springFile] = opt('--ill-sweeps').split(',');
  const sweeps = { fall: readRows(fallFile), spring: readRows(springFile) };
  const boardsOf = new Map();
  for (const side of ['fall', 'spring']) for (const r of sweeps[side]) {
    if (!boardsOf.has(r.id)) boardsOf.set(r.id, []);
    boardsOf.get(r.id).push(r);
  }
  const pageDirs = opt('--ill-pages') ? [resolve(opt('--ill-pages'))] : [];
  index.sources.illinois = {
    reading: 'public/illinois/programs.json + public/illinois/program/<id>.json through adaptIllinoisPrograms',
    readingFile: { file: 'public/illinois/programs.json', mtime: statSync(join(ROOT, 'public/illinois/programs.json')).mtime.toISOString() },
    pages: pageDirs[0] ?? join(OUT, 'raw', 'illinois'),
    sweeps: { fall: resolve(fallFile), spring: resolve(springFile) },
  };

  // The baseline, as compare.mjs's scoreboard counts it (every swept degree), and over the offered degrees alone.
  const offeredIds = new Set(summaries.filter((s) => IS.openProgram(s)).map((s) => s.id));
  const scoreOf = (list) => {
    const ok = list.filter((r) => !r.error);
    const missing = ok.filter((r) => r.notPlaced.length).length;
    return { plans: ok.length, threw: list.length - ok.length, missingRequired: missing, pct: Number(((100 * missing) / Math.max(1, ok.length)).toFixed(1)), requiredNotPlaced: ok.reduce((n, r) => n + r.notPlaced.length, 0), unmetRows: ok.reduce((n, r) => n + r.unsatisfied.length, 0) };
  };
  index.baseline.illinois = {
    measure: "plans that leave out a required class (compare.mjs 'Plans that leave out a required class': a board with any course not placed)",
    allSwept: { fall: { start: 'Fall 2026', ...scoreOf(sweeps.fall) }, spring: { start: 'Spring 2027', ...scoreOf(sweeps.spring) } },
    offeredOnly: { degrees: offeredIds.size, fall: { start: 'Fall 2026', ...scoreOf(sweeps.fall.filter((r) => offeredIds.has(r.id))) }, spring: { start: 'Spring 2027', ...scoreOf(sweeps.spring.filter((r) => offeredIds.has(r.id))) } },
  };
  if (SCHOOLS.includes('illinois') && !ONLY) index.illinoisNotOffered = [];
  const entries = [];
  let n = 0;
  for (const s of summaries) {
    if (ONLY && !ONLY.has(s.id)) continue;
    const offered = IS.openProgram(s);
    let why = null;
    if (!offered) {
      why = !IS.plannableProgram(s)
        ? (/^(AB|BA|BS|BFA|BLA|BMUS|BSLAS|BSW|BALAS|BLS|BME|BMA|BASA|BFASA)$/i.test(s.degree) ? `no courses read from the page (dataStatus ${s.dataStatus}, ${s.courseCount} courses)` : `not a bachelor's degree ("${s.degree || 'none'}")`)
        : `suspended: ${IS.suspendedNotice(s.id)}`;
      if (!ONLY) index.illinoisNotOffered.push({ id: s.id, name: s.name, why, url: s.url });
      // A degree we do not offer still gets its page and reading written, for whoever fixes it.
    }
    n += 1;
    const raw = publicJson(`illinois/program/${s.id}.json`);
    const adapted = adaptIllinoisPrograms({ school: 'illinois', source: s.url, fetchedAt: '', programs: [raw] }, new Map(byCode));
    const blocks = adapted.blocks.get(s.id) ?? [];
    const page = await pageFor('illinois', s.id, s.url, pageDirs);
    const section = page.html ? illinoisSection(page.html) : { tab: null, html: '' };
    const lines = section.html ? linesOf(section.html) : [];

    // Options, tracks and concentrations, and how they are read.
    const parts = s.id.split('/');
    const base = parts.slice(0, 2).join('/');
    const family = summaries.filter((x) => (x.id !== s.id && x.id.startsWith(`${base}/`)) || (parts.length > 2 && x.id === base));
    const takeAll = takeAllExclusionPairs(blocks.map((b) => ({ id: s.id, req: b.id, label: b.label, kind: b.rule.kind, credits: 0, rule: b.rule })), exclusions);
    const options = [];
    if (parts.length > 2) options.push(`This is the "${s.concentration ?? parts[2]}" concentration of ${base}, offered as its own degree id (the student picks one concentration; its page is read alone).`);
    else if (family.length) options.push(`Concentrations, each its own degree id (pick one): ${family.map((x) => x.id.split('/')[2]).join(', ')}.`);
    blocks.forEach((b, i) => {
      const r = b.rule;
      if (r.kind === 'choose' && r.list) options.push(`R${i + 1} is an option list: pick ${r.n} of ${r.choices.length}.`);
      if (r.kind === 'pool' && r.constraints?.some((c) => c.single)) options.push(`R${i + 1}: some courses must come from ONE of its lists (a pick-one track).`);
      if (r.kind === 'pool' && r.lists?.length > 1 && !r.constraints?.length) options.push(`R${i + 1}: ${r.lists.length} lists read as one pool (any mix counts).`);
      if ((r.choices ?? []).some((c) => c.bundles?.length > 1)) options.push(`R${i + 1}: holds a choice between sets of courses (one set taken whole).`);
      if (r.kind === 'all' && r.choices.length >= 6 && /\b(select|choose|one of|following)\b/i.test(`${b.label} ${b.note}`)) options.push(`R${i + 1}: read as TAKE ALL ${r.choices.length}, but its label or note says "${(`${b.label} ${b.note}`.match(/[^.]*\b(select|choose|one of|following)\b[^.]*/i) ?? [''])[0].trim().slice(0, 90)}" - check it is not a pick-from list.`);
    });
    for (const t of takeAll) options.push(`TAKE-ALL CHECK: ${t.req.split('::').slice(1).join('::')} "${t.label}" asks for every course but holds pairs that do not both count: ${t.pairs.map((p) => p.join(' / ')).join(', ')}.`);
    if (!blocks.length) options.push('No requirement blocks read from this page.');

    // Plan evidence.
    const boards = (boardsOf.get(s.id) ?? []).filter((r) => !r.error);
    const threw = (boardsOf.get(s.id) ?? []).filter((r) => r.error).length;
    const refOf = new Map(blocks.map((b, i) => [b.id, `R${i + 1}`]));
    const reqRef = (id) => {
      if (!id) return '?';
      if (refOf.has(id)) return refOf.get(id);
      const parent = [...refOf.keys()].find((k) => id.startsWith(`${k}::`) || k.startsWith(`${id}::`));
      return parent ? refOf.get(parent) : id.split('::').slice(1).join('::');
    };
    const left = new Map();
    const unmet = new Map();
    for (const r of boards) {
      for (const np of r.notPlaced) {
        const k = `${np.code}|${reqRef(np.requirementId)}`;
        const e = left.get(k) ?? { code: np.code, ref: reqRef(np.requirementId), kind: np.kind, reason: String(np.reason ?? '').slice(0, 160), boards: [] };
        if (!e.boards.includes(boardName(r))) e.boards.push(boardName(r));
        left.set(k, e);
      }
      for (const u of r.unsatisfied) {
        const k = reqRef(u.id);
        const e = unmet.get(k) ?? { ref: k, label: String(u.label ?? '').slice(0, 90), reasons: [], entries: 0, boards: [] };
        e.entries += 1;
        if (!e.reasons.includes(String(u.reason ?? ''))) e.reasons.push(String(u.reason ?? ''));
        if (!e.boards.includes(boardName(r))) e.boards.push(boardName(r));
        unmet.set(k, e);
      }
    }
    const misses = {
      boards: boards.length,
      threw,
      boardsMissingRequired: boards.filter((r) => r.notPlaced.length).length,
      boardsMissingFall: boards.filter((r) => r.notPlaced.length && r.start === 'Fall 2026').length,
      boardsMissingSpring: boards.filter((r) => r.notPlaced.length && r.start !== 'Fall 2026').length,
      requiredNotPlaced: boards.reduce((k, r) => k + r.notPlaced.length, 0),
      unmetRows: boards.reduce((k, r) => k + r.unsatisfied.length, 0),
    };
    const evidence = {
      boards: 'Fall 2026 and Spring 2027 starts x no goal / pre-med / pre-PT x 2 language semesters owed (lang2) or language done (lang4)',
      misses,
      leftOff: [...left.values()].sort((a, b) => b.boards.length - a.boards.length),
      unmet: [...unmet.values()].sort((a, b) => b.boards.length - a.boards.length),
    };
    const json = {
      school: 'illinois', id: s.id, name: s.name, degree: s.degree, offered, notOfferedWhy: why, url: s.url,
      totalHours: s.totalCredits || null,
      catalog: { url: s.url, cache: page.cache ?? null, cachedAt: page.cachedAt ?? null, tab: section.tab, error: page.error ?? null, lines: compactLines(lines) },
      reading: { blocks: readingOf(blocks), options, takeAll, totalHours: s.totalCredits || null, blockCount: blocks.length, unparsed: blocks.filter((b) => b.rule.kind === 'unparsed').length },
      evidence,
    };
    const fmtBoards = (list) => (list.length >= boards.length && boards.length ? 'all boards' : list.length > 3 ? `${list.length} boards` : list.join(', '));
    const evText = (lim) => [
      `boards: ${misses.boards} (F26 = Fall 2026 start, S27 = Spring 2027; no goal / pre-med / pre-PT; lang2 = two language semesters owed, lang4 = language done)${threw ? `; ${threw} threw` : ''}`,
      `missing a required class: ${misses.boardsMissingRequired}/${misses.boards} (F26 ${misses.boardsMissingFall}, S27 ${misses.boardsMissingSpring}); classes left off ${misses.requiredNotPlaced}; unmet rows ${misses.unmetRows}`,
      ...evidence.leftOff.slice(0, lim).map((e) => `LEFT OFF ${e.code} (${e.ref}, ${e.kind ?? '?'}) on ${e.boards.length} [${fmtBoards(e.boards)}]: ${e.reason.slice(0, 110)}`),
      ...(evidence.leftOff.length > lim ? [`... +${evidence.leftOff.length - lim} more left-off classes in the .json`] : []),
      ...evidence.unmet.slice(0, lim).map((e) => `UNMET ${e.ref} "${e.label.slice(0, 50)}"${e.entries > e.boards.length ? ` (${e.entries} rows)` : ''} on ${e.boards.length} [${fmtBoards(e.boards)}]: ${e.reasons.join(', ').slice(0, 100)}`),
      ...(evidence.unmet.length > lim ? [`... +${evidence.unmet.length - lim} more unmet rows in the .json`] : []),
    ].join('\n') + '\n';
    const head = [
      `${s.name} (${s.id})${offered ? '' : `  [NOT OFFERED: ${json.notOfferedWhy}]`}`,
      `total ${s.totalCredits || '?'} hours | ${s.url}`,
      `reading: ${blocks.length} blocks (${['all', 'choose', 'pool', 'hours', 'gened', 'language', 'unparsed'].map((k) => `${blocks.filter((b) => b.rule.kind === k).length} ${k}`).join(', ')})`,
      ...options.map((o) => `* ${o}`),
    ].join('\n') + '\n';
    const size = writeDegree('illinois', s.id, json, {
      head,
      catalogNote: page.html ? `${section.tab ?? 'no requirements tab'}, cached ${String(page.cachedAt).slice(0, 10)}` : `page not available: ${page.error}`,
      catalog: (budget) => (lines.length ? catalogText(lines, budget) : '(no catalog text)\n'),
      reading: (cap) => readingText(blocks, cap),
      evidence: evText,
    });
    if (size > TXT_BUDGET + 512) index.txtOver4k.push({ school: 'illinois', id: s.id, bytes: size });
    if (offered) entries.push({ id: s.id, name: s.name, file: `illinois/${fileOf(s.id)}.txt`, ...misses });
    if (n % 25 === 0) console.error(`[illinois] ${n}/${summaries.length}`);
  }
  entries.sort((a, b) => b.boardsMissingRequired - a.boardsMissingRequired || b.requiredNotPlaced - a.requiredNotPlaced || b.unmetRows - a.unmetRows || a.id.localeCompare(b.id));
  if (!ONLY) index.illinois = entries;
  console.error(`[illinois] ${n} degrees written (${entries.length} offered), ${entries.filter((e) => e.boardsMissingRequired).length} with a plan missing a required class`);
}

// ---------------------------------------------------------------------------
// UGA
// ---------------------------------------------------------------------------
if (SCHOOLS.includes('uga')) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const U = await lib('components/planner/uga-source.tsx');
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const programs = data.programs.filter((p) => U.isUgaUndergraduateDegree(p));
  const harness = readRows(opt('--uga-harness'));
  const boardsOf = new Map();
  for (const r of harness) {
    if (!boardsOf.has(r.id)) boardsOf.set(r.id, []);
    boardsOf.get(r.id).push(r);
  }
  const fileInfo = JSON.parse(readFileSync(join(ROOT, 'public/uga-programs.json'), 'utf8'));
  index.sources.uga = {
    reading: 'public/uga-programs.json through loadUgaData + loadUgaProgram (components/planner/uga-source.tsx), emphasis picks as scripts/dev/uga-harness.mjs makes them',
    readingFetchedAt: fileInfo.fetchedAt,
    pages: join(OUT, 'raw', 'uga'),
    harness: resolve(opt('--uga-harness')),
  };
  const ok = harness.filter((r) => r.ok);
  const kinds = [...new Set(harness.map((r) => r.kind))];
  const tally = (list) => ({ boards: list.length, requiredNotPlaced: list.reduce((k, r) => k + r.notPlaced, 0), unmetRows: list.reduce((k, r) => k + r.unmetRows, 0), boardsWithNotPlaced: list.filter((r) => r.notPlaced).length, boardsWithUnmet: list.filter((r) => r.unmetRows).length });
  index.baseline.uga = {
    measure: 'required classes not placed (generatePlan notPlaced) and unmet requirement rows (auditUgaBoard), summed over the harness boards',
    programs: programs.length,
    all: tally(ok),
    withoutIncoming: tally(ok.filter((r) => r.kind !== 'incoming')),
    byKind: Object.fromEntries(kinds.map((k) => [k, tally(ok.filter((r) => r.kind === k))])),
    failed: harness.length - ok.length,
  };
  const entries = [];
  let n = 0;
  for (const program of programs) {
    if (ONLY && !ONLY.has(program.id)) continue;
    n += 1;
    const selections = U.ugaSelectionRequirements(program);
    const emphasisSelections = Object.fromEntries(selections.map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
    const loaded = U.loadUgaProgram(data, program, { emphasisSelections });
    const blocks = loaded.blocks;
    const url = `https://bulletin.uga.edu/Program/Details/${program.id}?IDc=${program.college}`;
    const page = await pageFor('uga', program.id, url);
    const sections = page.html ? ugaSections(page.html) : { main: '', college: '' };
    const lines = sections.main ? linesOf(sections.main) : [];
    const collegeLines = sections.college ? linesOf(sections.college).slice(0, 80) : [];

    const options = [];
    for (const q of selections) {
      const picked = emphasisSelections[q.id] ?? [];
      options.push(`${q.label}: ${q.required ? `REQUIRED pick ${q.minimum}${q.maximum !== q.minimum ? ` to ${q.maximum}` : ''}` : `optional (up to ${q.maximum})`} of ${q.options.length}: ${q.options.map((o) => o.label).join('; ').slice(0, 300)}. Test boards use: ${picked.length ? picked.join(', ') : 'none'}.`);
    }
    program.areas.forEach((area) => area.groups.forEach((g) => {
      if (g.completeOneList && g.lists?.length) options.push(`"${g.label || area.label}": choose ONE complete course group of ${g.lists.length}.`);
    }));
    blocks.forEach((b, i) => {
      const r = b.rule;
      if (r.kind === 'pool' && r.constraints?.some((c) => c.single)) options.push(`R${i + 1}: some courses must come from ONE of its lists.`);
      if (r.kind === 'all' && r.choices.length >= 6 && /\b(select|choose|one of)\b/i.test(`${b.label} ${b.note}`)) options.push(`R${i + 1}: read as TAKE ALL ${r.choices.length}, but its label or note says choose/select - check it.`);
    });
    if (!blocks.length) options.push('No requirement blocks read from this program.');

    const boards = (boardsOf.get(program.id) ?? []).filter((r) => r.ok);
    const failed = (boardsOf.get(program.id) ?? []).filter((r) => !r.ok);
    const left = new Map();
    const unmet = new Map();
    for (const r of boards) {
      for (const code of r.notPlacedCodes ?? []) {
        const e = left.get(code) ?? { code, refs: refsFor(blocks, code), kinds: [] };
        if (!e.kinds.includes(r.kind)) e.kinds.push(r.kind);
        left.set(code, e);
      }
      for (const u of r.unmet ?? []) {
        const name = u.replace(/ \(\d+(?:\.\d+)?\/\d+(?:\.\d+)?\)$/, '');
        const e = unmet.get(name) ?? { row: name, seen: [], kinds: [] };
        if (!e.kinds.includes(r.kind)) e.kinds.push(r.kind);
        if (!e.seen.includes(u.slice(name.length).trim())) e.seen.push(u.slice(name.length).trim());
        unmet.set(name, e);
      }
    }
    const notIncoming = boards.filter((r) => r.kind !== 'incoming');
    const incoming = boards.find((r) => r.kind === 'incoming');
    const misses = {
      boards: boards.length,
      failed: failed.length,
      boardsWithNotPlaced: notIncoming.filter((r) => r.notPlaced).length,
      requiredNotPlaced: notIncoming.reduce((k, r) => k + r.notPlaced, 0),
      unmetRows: notIncoming.reduce((k, r) => k + r.unmetRows, 0),
      boardsWithUnmet: notIncoming.filter((r) => r.unmetRows).length,
      incoming: incoming ? { notPlaced: incoming.notPlaced, unmetRows: incoming.unmetRows, short: incoming.short, terms: incoming.terms } : null,
    };
    const evidence = {
      boards: `${kinds.length} harness students: ${kinds.join(', ')} ("incoming" plans six terms, Fall 2027 to Spring 2030, so its misses are counted apart)`,
      misses,
      byBoard: boards.map((r) => ({ kind: r.kind, start: r.start, finish: r.finish, terms: r.terms, total: r.total, target: r.target, notPlaced: r.notPlacedCodes ?? [], unmet: r.unmet ?? [] })),
      leftOff: [...left.values()].sort((a, b) => b.kinds.length - a.kinds.length),
      unmet: [...unmet.values()].sort((a, b) => b.kinds.length - a.kinds.length),
    };
    const json = {
      school: 'uga', id: program.id, name: program.name, degree: program.degree, college: program.college, url,
      totalHours: program.totalCredits ?? null,
      catalog: { url, cache: page.cache ?? null, cachedAt: page.cachedAt ?? null, error: page.error ?? null, lines: compactLines(lines), collegeWide: compactLines(collegeLines) },
      reading: { readingFetchedAt: fileInfo.fetchedAt, blocks: readingOf(blocks), options, emphasisSelections, totalHours: program.totalCredits ?? null, areaHours: program.areaHours ?? null, electiveHours: loaded.electiveHours, fillToDegreeTotal: loaded.fillToDegreeTotal, blockCount: blocks.length },
      evidence,
    };
    const kindsText = (list) => (list.length >= boards.length - (list.includes('incoming') ? 0 : 1) && list.length > 3 ? `${list.length} boards` : list.join(', '));
    const evText = (lim) => [
      `boards: ${evidence.boards}${failed.length ? `; ${failed.length} could not be built` : ''}`,
      `without incoming: required classes not placed ${misses.requiredNotPlaced} on ${misses.boardsWithNotPlaced}/${notIncoming.length} boards; unmet rows ${misses.unmetRows} on ${misses.boardsWithUnmet}`,
      incoming ? `incoming (${incoming.terms} terms, ${incoming.total}/${incoming.target} h): not placed ${incoming.notPlaced}, unmet rows ${incoming.unmetRows}` : 'incoming: no board',
      ...evidence.leftOff.slice(0, lim).map((e) => `LEFT OFF ${e.code} (${e.refs.join('/') || 'not named in the reading'}) [${kindsText(e.kinds)}]`),
      ...(evidence.leftOff.length > lim ? [`... +${evidence.leftOff.length - lim} more left-off classes in the .json`] : []),
      ...evidence.unmet.slice(0, lim).map((e) => `UNMET "${e.row.slice(0, 70)}" ${[...new Set(e.seen)].filter(Boolean).slice(0, 3).join(' ')} [${kindsText(e.kinds)}]`),
      ...(evidence.unmet.length > lim ? [`... +${evidence.unmet.length - lim} more unmet rows in the .json`] : []),
    ].join('\n') + '\n';
    const head = [
      `${program.name} (UGA ${program.id}, ${program.college})`,
      `total ${program.totalCredits ?? '?'} hours (areas add to ${program.areaHours ?? '?'}; general elective hours ${loaded.electiveHours}; fill to the total: ${loaded.fillToDegreeTotal ? 'yes' : 'no'}) | ${url}`,
      `reading (Bulletin read ${String(fileInfo.fetchedAt).slice(0, 10)}): ${blocks.length} blocks (${['all', 'choose', 'pool', 'hours', 'gened', 'unparsed'].map((k) => `${blocks.filter((b) => b.rule.kind === k).length} ${k}`).join(', ')})`,
      ...options.map((o) => `* ${o.length > 400 ? `${o.slice(0, 397)}...` : o}`),
    ].join('\n') + '\n';
    const size = writeDegree('uga', program.id, json, {
      head,
      catalogNote: page.html ? `Bulletin page cached ${String(page.cachedAt).slice(0, 10)}` : `page not available: ${page.error}`,
      catalog: (budget) => (lines.length ? ugaCatalogText(lines, budget) : '(no catalog text)\n'),
      reading: (cap) => readingText(blocks, cap),
      evidence: evText,
    });
    if (size > TXT_BUDGET + 512) index.txtOver4k.push({ school: 'uga', id: program.id, bytes: size });
    entries.push({ id: program.id, name: program.name, file: `uga/${fileOf(program.id)}.txt`, ...misses });
    if (n % 20 === 0) console.error(`[uga] ${n}/${programs.length}${fetched ? ` (${fetched} pages fetched)` : ''}`);
  }
  entries.sort((a, b) => b.boardsWithNotPlaced - a.boardsWithNotPlaced || b.requiredNotPlaced - a.requiredNotPlaced || b.unmetRows - a.unmetRows || (b.incoming?.notPlaced ?? 0) - (a.incoming?.notPlaced ?? 0) || a.id.localeCompare(b.id));
  if (!ONLY) index.uga = entries;
  console.error(`[uga] ${n} programs written, ${entries.filter((e) => e.boardsWithNotPlaced).length} with a board (not incoming) leaving a required class off; ${fetched} pages fetched`);
}

if (!ONLY) {
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.error(`index -> ${join(OUT, 'index.json')}; .txt over ~4.5 KB: ${index.txtOver4k.length}`);
}
