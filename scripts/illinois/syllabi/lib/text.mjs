/**
 * Cached bytes -> plain text, with the page structure and the warnings that
 * decide whether the text can be trusted at all.
 *
 *   PDF          pdftext.py (PyMuPDF, pypdf as fallback), one Python process per batch
 *   DOC/DOCX/RTF macOS /usr/bin/textutil -convert txt -stdout (no python-docx here)
 *   HTML         the rules below, in Node, no parser dependency
 *   text/plain   as served (the Google Docs /export?format=txt body)
 *   XLSX, images skipped and labelled; there is no OCR on this machine
 *
 * Judged by what came out, never by the HTTP 200. A 200 can be:
 *   - a scanned PDF with no text layer          -> flag "image-only"
 *   - a JavaScript shell (Notion, cs124.org)     -> flag "js-shell"
 *   - the Grainger site generator's placeholder  -> flag "template"
 *     (46 of 71 sampled courses.grainger sites were this page, titled
 *     "Course Websites | The Grainger College of Engineering")
 *   - a login form or a soft 404                  -> flag "login" / "soft-404"
 *   - a Wayback capture of an HTML error page saved as .pdf (the researchers'
 *     FR 103 file was a French department "404: Page not found" page)
 *
 * Writes data/syllabi/text/{sha}.txt (pages joined by \f) and {sha}.json:
 *   { url, type, engine, pages: [chars...], title, meta, flags, term }
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS, ROOT } from './paths.mjs';
import { detectTerm } from './terms.mjs';

const PDFTEXT = join(ROOT, 'scripts', 'illinois', 'syllabi', 'pdftext.py');

/** The first python3 that has PyMuPDF or pypdf, the way excellent-teachers.mjs finds pdfplumber. */
let pythonBin = null;
function python() {
  if (pythonBin) return pythonBin;
  for (const bin of [process.env.PYTHON, '/usr/local/bin/python3', 'python3', '/opt/homebrew/bin/python3', '/usr/bin/python3'].filter(Boolean)) {
    try {
      execFileSync(bin, ['-c', 'import importlib.util as u, sys; sys.exit(0 if (u.find_spec("pymupdf") or u.find_spec("pypdf")) else 1)'], { stdio: 'ignore' });
      pythonBin = bin;
      return bin;
    } catch {
      /* next */
    }
  }
  throw new Error('No python3 with PyMuPDF or pypdf. Set PYTHON to one (the machine default is /usr/local/bin/python3).');
}

// ---------------------------------------------------------------------------
// Type sniffing

/** "application/pdf" or 'filename="ABE483_2026_Spring.docx"' or the magic bytes. */
export function sniffType(record, head) {
  const ct = (record.contentType ?? '').toLowerCase();
  const name = (record.disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] ?? record.url ?? '').toLowerCase();
  const magic = head ? head.subarray(0, 8) : Buffer.alloc(0);
  if (magic.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0) return /\.xls\b/.test(name) ? 'xls' : 'doc';
  if (magic.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  if (magic[0] === 0x50 && magic[1] === 0x4b) {
    if (/\.xlsx\b|spreadsheet/.test(name + ct)) return 'xlsx';
    if (/\.pptx\b|presentation/.test(name + ct)) return 'pptx';
    return 'docx';
  }
  if (magic[0] === 0xff && magic[1] === 0xd8) return 'image';
  if (magic.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image';
  if (/pdf/.test(ct) || /\.pdf\b/.test(name)) return 'pdf';
  if (/wordprocessingml|\.docx\b/.test(ct + name)) return 'docx';
  if (/msword|\.doc\b/.test(ct + name)) return 'doc';
  if (/html|xml/.test(ct) || /<(!doctype|html|head|body|div|p)\b/i.test(head?.subarray(0, 2048).toString('utf8') ?? '')) return 'html';
  if (/text\/plain|\.txt\b|export\?format=txt/.test(ct + name)) return 'text';
  if (/image\//.test(ct)) return 'image';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// HTML

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', deg: '°', frac12: '½', times: '×', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '' };
export const decodeEntities = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/**
 * HTML to text that keeps the shape a parser needs.
 *
 * Table rows become one line with tab-separated cells, so a Physics
 * course-grading.html row <tr><td>Homework</td><td>15%</td></tr> reads
 * "Homework\t15%" and the grading rule can pair them. Block tags become line
 * breaks; list items get a bullet. script, style, nav and footer go first,
 * because the Drupal footer on every department page ("Privacy Policy ...
 * Copyright ... Accessibility") would otherwise look like policy text.
 */
export function htmlToText(html) {
  let h = String(html);
  const title = decodeEntities(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  h = h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|nav|footer|iframe|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ');
  h = h
    .replace(/<\/(td|th)>\s*/gi, '\t')
    .replace(/<tr\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|ul|ol|table|thead|tbody|section|article|header|main|aside|dl|dt|dd|pre|blockquote|figure|figcaption|form|fieldset|details|summary|hr|caption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(h)
    .replace(/\r/g, '')
    .replace(/[    ]+/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\t\s*/g, '\t').replace(/^\s+|\s+$/g, '').replace(/\t+$/, ''))
    .filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
    .join('\n')
    .trim();
  return { title, text };
}

// ---------------------------------------------------------------------------
// Flags

const TEMPLATE_TITLE = /^Course Websites \| The Grainger College/i;
const LOGIN_BODY = /(sign in with your|log ?in with your netid|shibboleth|enter your netid|single sign-on|you need to log in|please log in|u of i box login)/i;
const SOFT_404 = /(404[:\s-]+page not found|page not found|the requested url was not found|this page (could not|cannot) be found|file not found\.?$)/i;

function flagsFor(type, pages, title, text) {
  const flags = [];
  const chars = pages.reduce((a, b) => a + b, 0);
  if (!chars) flags.push('empty');
  if (type === 'pdf' && pages.length && chars / pages.length < 100) flags.push('image-only');
  if (type === 'html' && chars < 500) flags.push('js-shell');
  if (TEMPLATE_TITLE.test(title) && chars < 3000) flags.push('template');
  if (chars < 4000 && LOGIN_BODY.test(text)) flags.push('login');
  if (chars < 3000 && SOFT_404.test(text.slice(0, 1500) + title)) flags.push('soft-404');
  if (['xlsx', 'xls', 'pptx', 'image', 'unknown'].includes(type)) flags.push(`unsupported:${type}`);
  return flags;
}

// ---------------------------------------------------------------------------

function saveText(sha, record, type, engine, pageTexts, title, meta, hintTerm) {
  mkdirSync(DIRS.text, { recursive: true });
  const clean = pageTexts.map((p) => String(p ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\u0000/g, ''));
  const text = clean.join('\f');
  const pages = clean.map((p) => p.length);
  const flags = flagsFor(type, pages, title ?? '', text);
  const term = detectTerm(text, { title, pdfMeta: meta });
  const info = { url: record.url, sha, type, engine, pages, chars: text.length, title: title || null, meta: meta ?? null, flags, term, hintTerm: hintTerm ?? null, extractedAt: new Date().toISOString() };
  writeFileSync(join(DIRS.text, `${sha}.txt`), text);
  writeFileSync(join(DIRS.text, `${sha}.json`), JSON.stringify(info, null, 1));
  return info;
}

export function loadText(sha) {
  const f = join(DIRS.text, `${sha}.json`);
  if (!existsSync(f)) return null;
  return { info: JSON.parse(readFileSync(f, 'utf8')), text: readFileSync(join(DIRS.text, `${sha}.txt`), 'utf8') };
}

/**
 * Extract text for many cached records. Each record: { url, sha, bodyPath,
 * contentType, disposition }. Already-extracted shas are skipped unless
 * { force: true }. Returns Map(sha -> info).
 */
export function extractMany(records, { force = false, log = () => {} } = {}) {
  mkdirSync(DIRS.text, { recursive: true });
  mkdirSync(DIRS.tmp, { recursive: true });
  const out = new Map();
  const pdfJobs = [];
  for (const r of records) {
    if (!r.bodyPath || !existsSync(r.bodyPath)) continue;
    if (!force && existsSync(join(DIRS.text, `${r.sha}.json`))) { out.set(r.sha, JSON.parse(readFileSync(join(DIRS.text, `${r.sha}.json`), 'utf8'))); continue; }
    const buf = readFileSync(r.bodyPath);
    const type = sniffType(r, buf);
    if (type === 'pdf') { pdfJobs.push({ r, in: r.bodyPath, out: join(DIRS.tmp, `${r.sha}.pdf.json`) }); continue; }
    if (type === 'html') {
      const { title, text } = htmlToText(buf.toString('utf8'));
      out.set(r.sha, saveText(r.sha, r, type, 'html', [text], title, null, r.hintTerm));
      continue;
    }
    if (type === 'text') { out.set(r.sha, saveText(r.sha, r, type, 'plain', [buf.toString('utf8')], null, null, r.hintTerm)); continue; }
    if (['doc', 'docx', 'rtf'].includes(type)) {
      // textutil picks its reader from the extension, and the cache stores ".body".
      const tmp = join(DIRS.tmp, `${r.sha}.${type}`);
      copyFileSync(r.bodyPath, tmp);
      const res = spawnSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', tmp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      rmSync(tmp, { force: true });
      const text = res.status === 0 ? res.stdout : '';
      out.set(r.sha, saveText(r.sha, r, type, res.status === 0 ? 'textutil' : null, [text], null, null, r.hintTerm));
      continue;
    }
    out.set(r.sha, saveText(r.sha, r, type, null, [], null, null, r.hintTerm));
  }
  if (pdfJobs.length) {
    log(`  pdftext.py: ${pdfJobs.length} PDFs`);
    const input = pdfJobs.map((j) => JSON.stringify({ in: j.in, out: j.out })).join('\n');
    const res = spawnSync(python(), [PDFTEXT], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`pdftext.py failed: ${res.stderr.slice(0, 500)}`);
    for (const j of pdfJobs) {
      if (!existsSync(j.out)) continue;
      const got = JSON.parse(readFileSync(j.out, 'utf8'));
      rmSync(j.out, { force: true });
      out.set(j.r.sha, saveText(j.r.sha, j.r, 'pdf', got.engine, got.pages ?? [], got.meta?.title ?? null, got.meta ?? null, j.r.hintTerm));
    }
  }
  return out;
}
