/**
 * The transfer checker's last step (transfer-ai.ts), offline: which lines go
 * to the model, and what its answers may and may not do to a record.
 *
 *   node lib/planner/__transfer-ai.check.mjs
 *
 * Fails when:
 *   - a line with an official, printed or student answer, a home line, or a
 *     line off for a grade would be sent;
 *   - a code the model makes up (not among that line's candidates) is applied;
 *   - "no credit" from the model takes a line's hours away (credit itself
 *     stays with the published rules: "no guessing", the owner, 2026-11-04);
 *   - a high-confidence equivalent does not count, or a medium one counts
 *     instead of being offered;
 *   - an elective verdict does not say so, or loses its hours;
 *   - the prompt or the schema stops carrying those rules.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} }
    return next(spec, ctx);
  }
`));
const T = await import(join(HERE, 'transcript.ts'));
const A = await import(join(HERE, 'transfer-ai.ts'));

let failures = 0;
const ok = (cond, name) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures += 1; };
const idx = JSON.parse(readFileSync(join(ROOT, 'public/illinois/index.json'), 'utf8'));
const lite = (Array.isArray(idx) ? idx : idx.courses).map((c) => ({ code: T.normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags }));

const line = (code, title, credits, extra = {}) => ({ code, title, credits, grade: 'A', term: 'Fall 2025', status: 'completed', ...extra });
const rec = T.matchTranscript({ institution: 'Sample State University', kind: 'transcript', hoursUnit: 'semester', notes: [], exams: [], courses: [
  line('BIO 105', 'Concepts in Biology', 3),
  line('MUS 120', 'Introduction to Music', 3),
  line('ECO 201', 'Principles of Macroeconomics', 3),
  line('ART 140', 'Ceramics I', 3),
  line('HIS 120', 'World Civilizations II', 3, { grade: 'W', status: 'withdrawn' }),
  line('PSY 210', 'Lifespan Development', 3, { equivalent: 'HDFS 105' }),
] }, 'check.pdf', lite, ['check.pdf'], null, 'illinois', null, null);

console.log('Which lines go to the model');
const lines = A.unsettledLines(rec, lite, 'illinois');
const sent = lines.map((l) => rec.courses[l.line].code);
ok(sent.includes('BIO 105') && sent.includes('MUS 120') && sent.includes('ART 140'), `lines still hours are sent (${sent.join(', ')})`);
ok(!sent.includes('ECO 201'), 'a line the curated table already counts (ECON 103) is not sent');
ok(!sent.includes('HIS 120'), 'a withdrawn line is not sent');
ok(lines.every((l) => l.candidates.length > 0 && l.candidates.length <= 20), 'each line carries 1 to 20 real candidates');
ok(lines.every((l) => l.candidates.every((k) => lite.some((c) => c.code === k.code))), 'every candidate is a course in the catalog');
const home = T.matchTranscript({ institution: 'University of Illinois Urbana-Champaign', kind: 'transcript', hoursUnit: 'semester', notes: [], exams: [], courses: [line('CS 124', 'Intro to Computer Science I', 3)] }, 'h.pdf', lite, ['h.pdf'], null, 'illinois', null, null);
ok(A.unsettledLines(home, lite, 'illinois').length === 0, "a home record's lines are never sent");

console.log('What the answers may do');
const at = (code) => lines.find((l) => rec.courses[l.line].code === code);
const bio = at('BIO 105');
const mus = at('MUS 120');
const art = at('ART 140');
const realCode = bio.candidates[0].code;
const after = A.applyDecisions(rec, lines, [
  { line: bio.line, verdict: 'equivalent', code: realCode, subject: '', level: 0, confidence: 'high', reason: 'same intro course' },
  { line: mus.line, verdict: 'equivalent', code: 'MUS 999', subject: '', level: 0, confidence: 'high', reason: 'made up' },
  { line: art.line, verdict: 'no_credit', code: '', subject: '', level: 0, confidence: 'high', reason: 'studio course' },
], lite, 'illinois');
ok(after.courses[bio.line].counts === 'course' && after.courses[bio.line].matched === realCode, `a high-confidence equivalent among the candidates counts (${realCode})`);
ok(/estimate/.test(after.courses[bio.line].basis.text) && /decides/.test(after.courses[bio.line].basis.text), 'and it is labelled an estimate the school decides');
ok(after.courses[mus.line].counts === 'hours' && after.courses[mus.line].matched == null, 'a code not among the candidates is dropped');
ok(after.courses[art.line].counts === 'hours' && after.courses[art.line].use === true, '"no credit" from the model keeps the hours counting');
ok(/may not earn credit/.test(after.courses[art.line].basis.text), 'and flags the line to check');
const medium = A.applyDecisions(rec, lines, [{ line: bio.line, verdict: 'equivalent', code: realCode, subject: '', level: 0, confidence: 'medium', reason: 'probably' }], lite, 'illinois');
ok(medium.courses[bio.line].counts === 'hours' && medium.courses[bio.line].proposals?.[0]?.code === realCode, 'a medium equivalent is offered, not counted');
const subj = bio.candidates[0].code.split(' ')[0];
const elect = A.applyDecisions(rec, lines, [{ line: art.line, verdict: 'elective', code: '', subject: subj, level: 100, confidence: 'high', reason: 'no studio match' }], lite, 'illinois');
ok(elect.courses[art.line].counts === 'hours' && elect.courses[art.line].basis.badge === 'elective' && new RegExp(`Elective credit in ${subj}`).test(elect.courses[art.line].basis.text), 'an elective verdict counts the hours and says which subject');
ok(rec.courses.every((c, i) => after.courses[i] === c || lines.some((l) => l.line === i)), 'lines that were not sent are untouched');

console.log('The words the model reads');
ok(/copied exactly from that line's candidates/.test(A.DECISION_SYSTEM) && /never write any other code/.test(A.DECISION_SYSTEM), 'the prompt forbids codes outside the candidates');
ok(/non-majors course is not the majors course/.test(A.DECISION_SYSTEM) && /upper-level course is never an introductory one/.test(A.DECISION_SYSTEM), 'the prompt carries the level and majors rules');
ok(!/rate ?my ?prof/i.test(A.DECISION_SYSTEM), 'it names no ratings site');
const shape = A.TransferDecisions.safeParse({ decisions: [{ line: 0, verdict: 'elective', code: '', subject: 'IB', level: 100, confidence: 'high', reason: 'x' }] });
ok(shape.success, 'the answer schema parses a well-formed decision');

if (failures) { console.log(`\n${failures} TRANSFER-AI CHECK(S) FAILED`); process.exit(1); }
console.log('\nall transfer-ai checks pass');
