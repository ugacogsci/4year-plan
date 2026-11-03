/**
 * "This plan can't finish with your settings" (cannot-finish.ts): when it
 * shows, what it says, the fixes it tries and how they are ranked, how the
 * board bar takes it (warnings-triage.ts), and what ARCH and ALMA get.
 *
 * Why (owner, 2026-11-03): UGA Accounting + International Business for a
 * freshman left MATH 2200 off and the board said only "Plan does not finish
 * the degree yet". Now the bar names the class and the setting that is the
 * limit, offers fixes that were built first, and the advisors say the same.
 *
 *   node --experimental-strip-types lib/planner/__cannot-finish.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

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
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
    }
    return next(spec, ctx);
  }`));

const C = await import(join(HERE, 'cannot-finish.ts'));
const W = await import(join(HERE, 'warnings-triage.ts'));

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes += 1; return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}
const issue = (id, severity, title, message = `${title}.`) => ({ id, severity, title, message, termId: '' });

// The 35784 freshman: seven terms Spring 2027 to Spring 2030, full at 18, MATH 2200 left off for room.
const IB = {
  school: 'uga', finish: { season: 'Spring', year: 2030 }, start: { season: 'Spring', year: 2027 },
  cap: 18, target: null, summers: [], away: [],
};
const fullTerms = Array.from({ length: 7 }, (_, i) => ({ season: i % 2 ? 'Fall' : 'Spring', credits: 17 }));
const ibState = C.finishStateOf({
  notPlaced: [{ code: 'MATH 2200', title: 'Calculus', reason: 'no-room' }],
  rows: ['III. Quantitative Reasoning'], totalHours: 135, degreeTotal: 120, terms: fullTerms, cap: 18,
});

console.log('\n=== 1. When the item shows, and what it says ===\n');
{
  const item = C.cannotFinish(ibState, IB, { record: 'current-assumed' });
  check("the owner's wording for 35784", item?.text === "This plan can't finish by Spring 2030 with up to 18 credits a semester and no summer classes. MATH 2200 (Calculus) doesn't fit.", item?.text);
  check('it names the finish, the load and no summers as the limits', JSON.stringify(item?.limits) === '["finish","load","summer"]', JSON.stringify(item?.limits));
  check('the current-semester prompt that counts the term as a full load does not silence it', item !== null);
  for (const record of ['said', 'earlier', 'current-empty']) {
    check(`the record prompt (${record}) explains the shortfall: no item`, C.cannotFinish(ibState, IB, { record }) === null);
  }
  check('a Double Dawgs rebuild pending: no item', C.cannotFinish(ibState, IB, { doubleDawgsPending: true }) === null);
  const prereq = C.finishStateOf({ notPlaced: [{ code: 'CS 4xx', title: '', reason: 'prereq-unmet' }], rows: [], totalHours: 120, degreeTotal: 120, terms: fullTerms, cap: 18 });
  check('a class kept off by a prerequisite the catalog cannot settle is not a settings problem', C.cannotFinish(prereq, IB) === null);
  const freeTerm = C.finishStateOf({ notPlaced: [{ code: 'ACCY 201', title: 'Accounting', reason: 'no-room', credits: 3 }], rows: [], totalHours: 120, degreeTotal: 120, terms: [...fullTerms.slice(1), { season: 'Fall', credits: 12 }], cap: 18 });
  check('"no room" while a term still has room for the class is the engine, not the settings: no item', C.cannotFinish(freeTerm, IB) === null && freeTerm.maxFree === 6);
  const chain = C.finishStateOf({ notPlaced: [{ code: 'X 400', title: 'Capstone', reason: 'chain-too-long', credits: 3 }], rows: [], totalHours: 120, degreeTotal: 120, terms: [...fullTerms.slice(1), { season: 'Fall', credits: 12 }], cap: 18 });
  check('a chain too long for the terms left counts with room free', C.cannotFinish(chain, IB) !== null);
  const roomy = C.finishStateOf({ notPlaced: [], rows: ['VI. Major'], totalHours: 120, degreeTotal: 120, terms: [{ season: 'Fall', credits: 12 }, { season: 'Spring', credits: 12 }], cap: 18 });
  check('a requirement short with room left is not a settings problem (the data, not the load)', C.cannotFinish(roomy, IB) === null);
  const tight = C.finishStateOf({ notPlaced: [], rows: ['VI. Major'], totalHours: 114, degreeTotal: 120, terms: fullTerms, cap: 18 });
  const t = C.cannotFinish(tight, IB);
  check('a requirement short with no room is', t !== null && /VI\. Major is still short\.$/.test(t.text), t?.text);
  const pastTotal = C.finishStateOf({ notPlaced: [], rows: [], totalHours: 136, degreeTotal: 120, terms: fullTerms, cap: 18 });
  check('a pre-med board that finishes its degree but goes past the total: no item', C.cannotFinish(pastTotal, IB) === null);
  const many = C.finishStateOf({ notPlaced: ['A 1', 'B 2', 'C 3', 'D 4', 'E 5'].map((code) => ({ code, title: `Course ${code}`, reason: 'chain-too-long' })), rows: [], totalHours: 105, degreeTotal: 120, terms: fullTerms.map((t) => ({ ...t, credits: 13 })), cap: 18 });
  const m = C.cannotFinish(many, { ...IB, target: 12, summers: [2028], away: [{ season: 'Fall', year: 2028 }] });
  check('a few classes, then "and N more"; the student\'s own load; a summer; a term away', m?.text === "This plan can't finish by Spring 2030 with about 12 credits a semester and Fall 2028 away. A 1 (Course A 1), B 2 (Course B 2), C 3 (Course C 3) and 2 more don't fit.", m?.text);
  const overrode = C.finishStateOf({ notPlaced: [{ code: 'MATH 2200', title: 'Calculus', reason: 'no-room', credits: 4 }], rows: [], totalHours: 120, degreeTotal: 120, terms: fullTerms, cap: 18 });
  const o = C.cannotFinish(overrode, { ...IB, target: 12 });
  check('12 asked for, the plan already at 17 a semester: the limit is the cap, not "about 12"', /with up to 18 credits a semester/.test(o?.text ?? '') && !C.fixCandidates({ ...IB, target: 12 }, 6, overrode).some((c) => c.id.startsWith('load-')), o?.text);
  check('every word a student reads is plain (no row, pool, requirement id, notPlaced, kind)', ![item, t, m].some((x) => /\b(row|pool|requirement id|notPlaced|kind)\b/i.test(x?.text ?? '')));
  check('no ratings site, no other product', ![item, t, m].some((x) => /rate ?my|TRU\b/i.test(x?.text ?? '')));
}

console.log('\n=== 2. The fixes it tries ===\n');
{
  // PlanTerm.year is the plan's year (1 to 4): the calendar year comes from the label (35784 once read "by Spring 4").
  const board = [
    { label: 'Spring 2027', season: 'Spring', year: 1, courseIds: ['a'] },
    { label: 'Summer 2027', season: 'Summer', year: 1, courseIds: ['b'] },
    { label: 'Fall 2027', season: 'Fall', year: 2, courseIds: ['c'] },
    { label: 'Summer 2028', season: 'Summer', year: 2, courseIds: [] },
    { label: 'Spring 2030', season: 'Spring', year: 4, courseIds: ['d'] },
  ];
  const bs = C.boardSettings({ school: 'uga', terms: board, shapeSummers: [2029], away: [], target: null });
  check('the board\'s settings read calendar years from the labels', bs && C.termLabel(bs.finish) === 'Spring 2030' && C.termLabel(bs.start) === 'Spring 2027' && JSON.stringify(bs.summers) === '[2027,2029]', JSON.stringify(bs));
  const ib = C.fixCandidates(IB);
  check('at the cap: no load fix', !ib.some((c) => c.id.startsWith('load-')), ib.map((c) => c.id).join());
  check('a summer first (the first two inside the plan), then a later finish, then two summers', ib.map((c) => c.label).join(' | ') === 'Add Summer 2027 | Add Summer 2028 | Finish in Fall 2030 instead | Add Summer 2027 and Summer 2028', ib.map((c) => c.label).join(' | '));
  const light = C.fixCandidates({ ...IB, target: 12 });
  check("the student's own 12: a step to 15 first, never above the cap", light[0].label === 'Take up to 15 credits a semester' && light.every((c) => (c.change.target ?? 0) <= 18), light.map((c) => c.label).join(' | '));
  const away = C.fixCandidates({ ...IB, away: [{ season: 'Fall', year: 2028, kind: 'study_abroad', credits: 15 }] });
  const drop = away.find((c) => c.id.startsWith('away-'));
  check('a term away: "Drop the Fall 2028 term away"', drop?.label === 'Drop the Fall 2028 term away' && drop.change.away.length === 0, drop?.label);
  const dropped = C.fixCandidates({ ...IB, droppedSummers: [2027] });
  check('a summer the student took off is never offered back', !dropped.some((c) => c.change.summers?.includes(2027)), dropped.map((c) => c.label).join());
  const shape = C.shapeInputOf(ib[2]);
  check('a later finish is one set_plan_shape finish', JSON.stringify(shape) === '{"finish":"Fall 2030"}', JSON.stringify(shape));
  check('a summer is set_plan_shape summers with the ones the plan has', JSON.stringify(C.shapeInputOf(C.fixCandidates({ ...IB, summers: [2029] })[0])) === '{"summers":[2027,2029]}');
  const awayShape = C.shapeInputOf({ id: 'x', label: '', size: 1, change: { away: [{ season: 'Spring', year: 2029, kind: 'study_abroad', credits: 15 }] } });
  check('a term away kept keeps what it is and earns', JSON.stringify(awayShape) === '{"away":[{"term":"Spring 2029","kind":"study_abroad","credits":15}]}', JSON.stringify(awayShape));
  check('a Spring finish: summers before it only', JSON.stringify(C.summersInside(IB)) === '[2027,2028,2029]');
  check('a Fall finish: its summer too', JSON.stringify(C.summersInside({ ...IB, start: { season: 'Fall', year: 2027 }, finish: { season: 'Fall', year: 2030 } })) === '[2028,2029,2030]');
}

console.log('\n=== 3. How the tried fixes are ranked and worded ===\n');
{
  const [s1, s2, later] = C.fixCandidates(IB);
  const fits = { stuck: [], shortRows: [], shortHours: 0, roomLeft: 6 };
  const one = { stuck: [{ code: 'MATH 2200', title: '', reason: 'no-room' }], shortRows: [], shortHours: 0, roomLeft: 0 };
  const r = C.rankFixes([C.tried(later, fits), C.tried(s2, fits), C.tried(s1, one)], 1);
  check('only the ones that make it finish, smallest change first', r.working.map((t) => t.candidate.id).join() === 'summer-2028,finish-Fall 2030' && r.closest === null, r.working.map((t) => t.candidate.id).join());
  check('"Add Summer 2028: everything fits"', C.fixButtonText(r.working[0]) === 'Add Summer 2028: everything fits', C.fixButtonText(r.working[0]));
  const two = { ...one, stuck: [...one.stuck, { code: 'X 1', title: '', reason: 'no-room' }] };
  const none = C.rankFixes([C.tried(s1, two), C.tried(later, one)], 3);
  check('none works: the one leaving the fewest off, worded honestly', none.working.length === 0 && none.closest?.candidate.id === later.id && C.fixButtonText(none.closest) === "Finish in Fall 2030 instead: gets closer, 1 class still doesn't fit", none.closest ? C.fixButtonText(none.closest) : 'none');
  check('nothing better than now: nothing offered', C.rankFixes([C.tried(s1, two)], 2).closest === null);
  const item = C.cannotFinish(ibState, IB);
  const facts = C.forAdvisor(item, r, IB);
  check('ARCH/ALMA get the classes, the limiting settings and the tested fixes with their set_plan_shape input',
    facts.says === item.text && facts.classes_that_do_not_fit[0].startsWith('MATH 2200') && facts.limiting_settings.finish === 'Spring 2030' && facts.limiting_settings.summers === 'none'
      && facts.tested_fixes[0].fix === 'Add Summer 2028' && facts.tested_fixes[0].result === 'the plan finishes' && JSON.stringify(facts.tested_fixes[0].set_plan_shape) === '{"summers":[2028]}', JSON.stringify(facts));
  check('untested, it says so', C.forAdvisor(item, null, IB).tested_fixes === 'not tested yet');
  check('the Ask question names the settings', C.askQuestion(item) === "My plan can't finish by Spring 2030 with up to 18 credits a semester and no summer classes. What should I change so it finishes?", C.askQuestion(item));
}

console.log('\n=== 4. The board bar takes it in place of the generic rows ===\n');
{
  const rows = [
    issue('degree-incomplete', 'error', 'Plan does not fulfill the degree yet', 'This draft does not finish: III. Quantitative Reasoning.'),
    issue('uga-area-III. Quantitative Reasoning', 'warning', 'III. Quantitative Reasoning', 'III. Quantitative Reasoning: 0 of 3 credits.'),
    issue('ap-prereq-order-x', 'error', 'Prerequisite later in the plan'),
  ];
  const plain = W.triageIssues(rows);
  check('without it, the bar says "Requirement not met"', plain.prominent.some((k) => k.key === 'degree'));
  const item = C.cannotFinish(ibState, IB);
  const t = W.triageIssues(rows, { cannotFinish: { text: item.text, message: item.text } });
  check('with it, the item is first and the generic one is gone', t.prominent[0].key === W.CANNOT_FINISH_ID && t.prominent[0].label === item.text && !t.prominent.some((k) => k.key === 'degree'), t.prominent.map((k) => k.key).join());
  check('the bar does not grow', t.prominent.length === plain.prominent.length, `${plain.prominent.length} -> ${t.prominent.length}`);
  check('the requirement rows stay under Show more', t.more.some((r) => r.issue.id === 'uga-area-III. Quantitative Reasoning') && t.more.some((r) => r.issue.id === 'degree-incomplete'));
  check('other things that matter stay', t.prominent.some((k) => k.key === 'prereq-order'));
  const gap = { said: null, recorded: 0, assumed: 15, currentTerm: 'Fall 2026', currentAssumed: 15, currentClasses: 0 };
  check('the current-semester prompt is "current-assumed"', W.recordKind(gap) === 'current-assumed');
  check('said hours not on the record are "said"', W.recordKind({ said: 60, recorded: 0, assumed: 0 }) === 'said');
  check('earlier terms not recorded are "earlier"', W.recordKind({ said: null, recorded: 0, assumed: 30, currentTerm: 'Fall 2026', currentAssumed: 15 }) === 'earlier');
  check('the current term counted as nothing is "current-empty"', W.recordKind({ said: null, recorded: 0, assumed: 0, currentTerm: 'Fall 2026', currentAssumed: 0, currentClasses: 0 }) === 'current-empty');
  const withPrompt = W.triageIssues(rows, { credit: gap, cannotFinish: { text: item.text, message: item.text } });
  check('beside the current-semester prompt: the item first, then the prompt', withPrompt.prominent[0].key === W.CANNOT_FINISH_ID && withPrompt.prominent[1].key === 'record', withPrompt.prominent.map((k) => k.key).join());
  const flags = W.rankedFlags(t);
  check('ARCH/ALMA read it first in the ranked flags, and the rows it stands for', flags[0] === `now, on the board: ${item.text}` && flags.some((f) => f.includes("the can't-finish item stands for it")), flags.slice(0, 3).join(' / '));
  check('UGA rows short: the area named, the summary rows not', JSON.stringify(C.ugaRowsShort(rows)) === '["III. Quantitative Reasoning"]', JSON.stringify(C.ugaRowsShort(rows)));
  check('Illinois rows short: room reasons only, not a row waiting on a prerequisite', JSON.stringify(C.illinoisRowsShort([
    { requirementId: 'a', label: 'Core', reason: 'did-not-fit' }, { requirementId: 'b', label: 'Tech', reason: 'not-parsed' }, { requirementId: 'c', label: 'Lab', reason: 'did-not-fit' },
  ], [{ reason: 'prereq-unmet', requirementId: 'c' }])) === '["Core"]');
}

console.log('\n=== 5. The workspace and the advisors (source) ===\n');
{
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  check('fixes are built through the Rebuild path (composePlan with a trial)', /const built = composePlan\(trialShape\(candidate\)\)/.test(ws) && /const buildPlan = useCallback\(\(\) => \{\n {4}composePlan\(null\);/.test(ws));
  check('a trial build shows nothing and saves nothing', /if \(trial\) return \{ generated, horizon, ms:/.test(ws) && /if \(!trial\) lastBuild\.current =/.test(ws));
  check('a fix pressed goes through the set_plan_shape executor', /advisorExecute\('set_plan_shape', \{ \.\.\.shapeInputOf\(fix\.candidate\), confirmed: true \}\)/.test(ws));
  check('over the student\'s own edits it asks first', /if \(boardEdited && !confirmed\) \{\n {6}setFixToConfirm\(fix\);/.test(ws) && /replaces the changes you made to the board by hand/.test(ws));
  check('the board bar passes the item to the triage', /cannotFinish: cannotItem \}\), \[issues, creditGap, school\?\.bot, cannotItem\]/.test(ws));
  check('the trying waits for "Find a fix" and says "Checking what would fix this..."', ws.includes('Find a fix') && ws.includes('Checking what would fix this...'));
  check('review_board carries cannot_finish with the note for the advisor', /cannot_finish: \{\n\s+\.\.\.cannotFinishFacts,/.test(ws));
  check('the board description carries it', ws.includes("Can't finish with the student's settings (first on the board bar)"));
  const adv = readFileSync(join(ROOT, 'lib/planner/advisor.ts'), 'utf8');
  check('both prompts carry the shared rule', (adv.match(/\$\{SHARED_ADVISOR_RULES\.cannotFinish\}/g) ?? []).length === 2);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
