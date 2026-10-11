/**
 * Where the syllabus pipeline keeps things, and the one user agent it sends.
 *
 * Everything under data/syllabi/ is git-ignored: raw responses, extracted
 * text, per-source manifests, the fetch log and coverage. Instructors own the
 * words in a syllabus, so the only committed output is the facts file,
 * public/illinois/syllabi.json, which holds numbers, labels and source URLs.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const DATA = join(ROOT, 'data', 'syllabi');

export const DIRS = {
  raw: join(DATA, 'raw'), // {host}/{sha[0,2]}/{sha}.body + .json, one pair per URL
  state: join(DATA, 'state'), // fetchlog.jsonl, robots/, walks/ (highest live id per ID walk)
  manifests: join(DATA, 'manifests'), // {source}.jsonl, one line per document an adapter found
  text: join(DATA, 'text'), // {sha}.txt + {sha}.json (pages, flags, detected term)
  docs: join(DATA, 'docs'), // {sha}.json: kind, codes, term, facts with evidence
  ids: join(DATA, 'ids'), // the researchers' id lists (getsyllabus_full.tsv, documents.txt ...)
  research: join(DATA, 'research'), // the discovery design and the sweeps' per-course verdicts
  tmp: join(DATA, 'tmp'),
};

export const OUT = {
  syllabi: join(ROOT, 'public', 'illinois', 'syllabi.json'),
  coverage: join(DATA, 'coverage.json'),
  coverageMd: join(ROOT, 'scripts', 'illinois', 'syllabi', 'COVERAGE.md'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
}

/**
 * The house agent, unchanged, for every host but one. The Internet Archive's
 * bot page asks automated clients to name the tool, its version and, when an
 * AI agent is driving, the model, so web.archive.org gets " syllabi/1.0" and,
 * when TRUBOT_AGENT is set (for example "claude-opus-5-5"), that too.
 * Never spoofed: a 403 to this agent means the host does not want us.
 */
export const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';
export function userAgentFor(host) {
  if (host === 'web.archive.org') {
    const agent = process.env.TRUBOT_AGENT ? ` (${process.env.TRUBOT_AGENT})` : '';
    return `${UA} syllabi/1.0${agent}`;
  }
  return UA;
}
