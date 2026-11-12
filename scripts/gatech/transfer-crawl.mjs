/**
 * Polite reader for Georgia Tech's public OSCAR Transfer Articulation pages
 * (Banner 8 self-service "wwsktrna", no login). Saves raw pages only; the
 * parser is scripts/gatech/transfer-build.mjs.
 *
 * REQUEST CHAIN (all POST, application/x-www-form-urlencoded, no cookies sent):
 *   wwsktrna.P_find_school           state_in=GA&nation_in=            -> school list for a state
 *   wwsktrna.P_find_subj_levl        state_in, nation_in, sbgi_in, term_in=   -> that school's
 *                                    subject, level and term choices
 *   wwsktrna.P_find_subj_levl_classes  state_in, nation_in, sel_subj (every subject the school
 *                                    offers), levl_in=US, term_in=999999 ("See Equivalent Data
 *                                    from All Terms"), sbgi_in, school_in=  -> every row, with
 *                                    minimum grade and effective term range
 *   (wwtraneq.P_TranEq_Rpt is one request per school but drops min grade and term ranges.)
 *
 * WRITES (data/gatech-raw/transfer/, gitignored):
 *   _states/<ST>.html.gz      a state's school list
 *   <code>.subj.html.gz       a school's subject/level page
 *   <code>.html.gz            a school's all-subjects, all-terms report
 *   <code>.none.json          the school has no rows ("No Equivalent Course available for this school")
 *                             or offers no undergraduate subject: nothing more to ask
 *   crawl-log.jsonl           one line per request
 * A file already on disk is never asked for again, so a stopped run resumes.
 *
 * POLITENESS: one request at a time, GAP_MS (6 s) after each reply before the next,
 *   User-Agent 'ORION-planner-data/1.0'. Stops at once on a non-200, a 429, any redirect,
 *   or a page that reads like a challenge/login. A network error or a reply of the wrong
 *   shape waits 60 s; 3 in a row stops the run. Stops when the disk has under 1.5 GB free.
 *
 * USAGE:
 *   node scripts/gatech/transfer-crawl.mjs --states GA,FL,AL,SC,NC,TN,IL [--max 400]
 *        [--first 005813,005451] [--dry]
 * Exit code 0 = finished, 2 = stopped by a block/error rule (reason in the log and stdout).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const BASE = 'https://oscar.gatech.edu/pls/bprod/';
const UA = 'ORION-planner-data/1.0';
const GAP_MS = 6000;
const ERROR_WAIT_MS = 60_000;
const MIN_FREE = 1.5 * 1024 ** 3;
const ROOT = 'data/gatech-raw/transfer';
const WALL = /captcha|are you a robot|cf-chl|cloudflare ray id|just a moment\.\.\.|access denied|request rejected|login\.gatech\.edu|sso\.gatech\.edu|\/cas\/login|twbkwbis\.P_ValLogin/i;

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const STATES = opt('states', 'GA').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const MAX = Number(opt('max', '2000'));
const FIRST = opt('first', '').split(',').filter(Boolean);
const DRY = args.includes('--dry');

class Stop extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(join(ROOT, '_states'), { recursive: true });
const LOG = join(ROOT, 'crawl-log.jsonl');
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

let requests = 0;
let consecutiveErrors = 0;
let lastEnd = 0;

function freeBytes() {
  const s = statfsSync('/');
  return s.bavail * s.bsize;
}

/** One polite POST. Returns the body text, or throws Stop. Retries only network/shape errors. */
async function post(proc, fields, expect, label) {
  for (;;) {
    if (requests >= MAX) throw new Stop(`request cap ${MAX} reached`);
    if (freeBytes() < MIN_FREE) throw new Stop(`disk free under 1.5 GB (${(freeBytes() / 1024 ** 3).toFixed(2)} GB)`);
    const wait = lastEnd + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const body = fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const t0 = Date.now();
    requests++;
    let res, text;
    try {
      res = await fetch(BASE + proc, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
        body,
        signal: AbortSignal.timeout(180_000),
      });
      text = await res.text();
    } catch (e) {
      lastEnd = Date.now();
      consecutiveErrors++;
      log({ proc, label, error: String(e && e.message || e), ms: lastEnd - t0, consecutiveErrors });
      console.log(`  network error on ${label}: ${e && e.message} (${consecutiveErrors} in a row)`);
      if (consecutiveErrors >= 3) throw new Stop(`3 consecutive errors (last: ${e && e.message})`);
      await sleep(ERROR_WAIT_MS);
      continue;
    }
    lastEnd = Date.now();
    const entry = { proc, label, status: res.status, bytes: text.length, ms: lastEnd - t0 };
    if (res.status >= 300 && res.status < 400) {
      log({ ...entry, location: res.headers.get('location') });
      throw new Stop(`redirect ${res.status} to ${res.headers.get('location')} on ${label}`);
    }
    if (res.status !== 200) {
      log(entry);
      throw new Stop(`HTTP ${res.status} on ${label}`);
    }
    if (WALL.test(text)) {
      log({ ...entry, wall: true });
      throw new Stop(`challenge/login-looking page on ${label}`);
    }
    if (!expect(text)) {
      consecutiveErrors++;
      log({ ...entry, badShape: true, consecutiveErrors });
      console.log(`  unexpected page shape on ${label} (${consecutiveErrors} in a row)`);
      writeFileSync(join(ROOT, `_bad_${label.replace(/[^A-Za-z0-9]+/g, '_')}_${Date.now()}.html.gz`), gzipSync(text));
      if (consecutiveErrors >= 3) throw new Stop(`3 consecutive bad pages (last on ${label})`);
      await sleep(ERROR_WAIT_MS);
      continue;
    }
    consecutiveErrors = 0;
    log(entry);
    return text;
  }
}

const options = (html, name) => {
  const m = html.match(new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`, 'i'));
  if (!m) return null;
  return [...m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi)].map((o) => ({ value: o[1], text: o[2].trim() }));
};
const footer = (t) => /All Rights Reserved By Georgia Tech/i.test(t);
const readGz = (p) => gunzipSync(readFileSync(p)).toString('utf8');

async function stateList(st) {
  const p = join(ROOT, '_states', `${st}.html.gz`);
  let html;
  if (existsSync(p)) html = readGz(p);
  else {
    html = await post('wwsktrna.P_find_school', [['state_in', st], ['nation_in', '']], (t) => footer(t) && options(t, 'sbgi_in'), `state ${st}`);
    writeFileSync(p, gzipSync(html));
  }
  return options(html, 'sbgi_in').filter((o) => o.value);
}

async function school(st, code, name) {
  const out = join(ROOT, `${code}.html.gz`);
  const none = join(ROOT, `${code}.none.json`);
  if (existsSync(out) || existsSync(none)) return 'cached';
  const sp = join(ROOT, `${code}.subj.html.gz`);
  let subjHtml;
  if (existsSync(sp)) subjHtml = readGz(sp);
  else {
    subjHtml = await post(
      'wwsktrna.P_find_subj_levl',
      [['state_in', st], ['nation_in', ''], ['sbgi_in', code], ['term_in', '']],
      (t) => footer(t) && (options(t, 'sel_subj') || /No Equivalent Course available for this school/i.test(t)),
      `subj ${code}`,
    );
    writeFileSync(sp, gzipSync(subjHtml));
  }
  const subjects = (options(subjHtml, 'sel_subj') || []).map((o) => o.value).filter(Boolean);
  const levels = (options(subjHtml, 'levl_in') || []).map((o) => o.value);
  const terms = (options(subjHtml, 'term_in') || []).map((o) => o.value);
  if (!subjects.length || !levels.includes('US')) {
    const said = /No Equivalent Course available for this school/i.test(subjHtml) ? 'No Equivalent Course available for this school' : null;
    writeFileSync(none, JSON.stringify({ code, name, state: st, subjects: subjects.length, levels, said, readAt: new Date().toISOString().slice(0, 10) }));
    return `no undergraduate subjects (subjects ${subjects.length}, levels ${levels.join('/') || 'none'})`;
  }
  const term = terms.includes('999999') ? '999999' : terms[0];
  const fields = [['state_in', st], ['nation_in', '']];
  for (const s of subjects) fields.push(['sel_subj', s]);
  fields.push(['levl_in', 'US'], ['term_in', term], ['sbgi_in', code], ['school_in', '']);
  const html = await post(
    'wwsktrna.P_find_subj_levl_classes',
    fields,
    (t) => footer(t), // a school with no undergraduate rows still ends with the footer; the parser counts rows
    `classes ${code}`,
  );
  writeFileSync(out, gzipSync(html));
  const rows = (html.match(/=>/g) || []).length;
  return `${subjects.length} subjects, ${rows} rows, ${(html.length / 1024).toFixed(0)} KB`;
}

async function main() {
  console.log(`states ${STATES.join(',')}  cap ${MAX} requests  free ${(freeBytes() / 1024 ** 3).toFixed(2)} GB`);
  log({ start: true, states: STATES, max: MAX });
  try {
    for (const st of STATES) {
      const list = await stateList(st);
      const order = [...list.filter((o) => FIRST.includes(o.value)), ...list.filter((o) => !FIRST.includes(o.value))];
      console.log(`${st}: ${list.length} schools`);
      if (DRY) continue;
      let i = 0;
      for (const o of order) {
        i++;
        const r = await school(st, o.value, o.text);
        if (r !== 'cached') console.log(`  ${st} ${i}/${list.length} ${o.value} ${o.text}: ${r}  [req ${requests}]`);
      }
    }
  } catch (e) {
    if (e instanceof Stop) {
      log({ stop: e.message, requests });
      console.log(`STOPPED: ${e.message}  (requests this run: ${requests})`);
      process.exit(2);
    }
    throw e;
  }
  log({ done: true, requests });
  console.log(`done. requests this run: ${requests}  free ${(freeBytes() / 1024 ** 3).toFixed(2)} GB`);
}

main();
