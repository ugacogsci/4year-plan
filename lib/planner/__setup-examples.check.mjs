/**
 * The setup box's examples (setup-examples.ts, 2026-11-09): five per school,
 * each in that school's words, every major and minor they name one a student
 * can pick in that school's setup, none naming what the box cannot record (AP
 * credit, exam scores, study abroad), each short enough for the box on a
 * 320-pixel phone.
 *
 * Run: node lib/planner/__setup-examples.check.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const { setupExamples, SETUP_EXAMPLE_COUNT, EXAMPLE_WORDS, PLAIN_WORDS } = await import('./setup-examples.ts');
const { illinoisMinorOptions } = await import('./illinois-minors.ts');

const json = (file) => JSON.parse(readFileSync(join(ROOT, 'public', file), 'utf8'));
const rows = (j) => (Array.isArray(j) ? j : (j.programs ?? Object.values(j)));
// What each school's setup lets a student pick (onboarding.tsx): UGA's programs; Illinois's majors and its minors as setup offers them.
const picks = {
  uga: { majors: rows(json('uga-programs.json')).filter((p) => p.degree !== 'MINOR').map((p) => p.name), minors: rows(json('uga-programs.json')).filter((p) => p.degree === 'MINOR').map((p) => p.name) },
  illinois: { majors: rows(json('illinois/programs.json')).map((p) => p.name), minors: illinoisMinorOptions(json('illinois/minors/crawl.json')).filter((m) => m.checked).map((m) => m.name) },
};
// Every word an example uses for a program, and the catalog name a student would pick for it. A word missing here fails.
const CATALOG = {
  uga: { biology: /^Biology BS$/, 'computer science': /^Computer Science BS$/, math: /^Minor in Mathematics$/, finance: /^Finance BBA$/, economics: /^Economics (AB|BBA)$/, 'political science': /^Political Science (AB|BS)$/ },
  illinois: { 'integrative biology': /^Integrative Biology, BSLAS$/, 'computer science': /^Computer Science, BS$/, math: /^Mathematics Minor$/, finance: /^Finance, BS$/, economics: /^Economics, BALAS$/, 'political science': /^Political Science, BALAS$/ },
};
for (const [id, words] of Object.entries(EXAMPLE_WORDS)) {
  const named = [words.biology, words.computing, words.business, ...words.majors.split(' and ')];
  for (const word of named) {
    const pattern = CATALOG[id]?.[word];
    assert.ok(pattern, `${id}: "${word}" has a catalog name in this check`);
    assert.ok(picks[id].majors.some((name) => pattern.test(name)), `${id}: the major "${word}" can be picked (${pattern})`);
  }
  if (words.minor) {
    const pattern = CATALOG[id]?.[words.minor];
    assert.ok(pattern && picks[id].minors.some((name) => pattern.test(name)), `${id}: the minor "${words.minor}" can be picked and is checked (${pattern})`);
  }
}
assert.equal(PLAIN_WORDS.minor, null, 'a school without its own words is offered no minor');

for (const [id, short] of [['uga', 'UGA'], ['illinois', 'Illinois'], ['gatech', 'Georgia Tech'], [null, null]]) {
  const list = setupExamples(id, short);
  assert.equal(list.length, SETUP_EXAMPLE_COUNT, `${id}: five examples`);
  assert.equal(new Set(list).size, list.length, `${id}: five different examples`);
  for (const text of list) {
    if (short) assert.ok(text.includes(` at ${short}`) || text.includes(` to ${short}`), `${id}: names the school: ${text}`);
    assert.ok(!/undefined|null|\bat (?:majoring|planning|and|double)\b/.test(text), `${id}: no stray words: ${text}`);
    assert.ok(!/\bAP\b|\bIB\b|scores?\b|abroad|dual[- ]enrollment|transcript/i.test(text), `${id}: nothing the box cannot record: ${text}`);
    // Five lines of the box at 320 pixels (measured 2026-11-09 in the real box): every example here, up to 145 characters, fits; the old 165-character one ran to a sixth line.
    assert.ok(text.length <= 150, `${id}: fits the box on a 320-pixel phone (${text.length} characters): ${text}`);
    if (!EXAMPLE_WORDS[id]) assert.ok(!/\bminor\b/.test(text), `${id}: no minor where the school's setup may offer none: ${text}`);
  }
}
console.log('Setup examples: five per school, in its words, programs a student can pick, nothing the box cannot record, phone length.');
