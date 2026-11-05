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
  // 2026-11-03 check: 13 of 24 sophomores (18982 second-nf) finished once their Fall 2026 classes were in.
  check('with a transcript, the semester in progress counted as a usual load explains it: no item', C.cannotFinish(ibState, IB, { record: 'current-assumed', transcript: true }) === null && C.recordExplains({ record: 'current-assumed', transcript: true }));
  check('a freshman with nothing on record keeps it (the owner\'s 35784 example)', C.cannotFinish(ibState, IB, { record: 'current-assumed', transcript: false }) !== null && !C.recordExplains({ record: 'current-assumed' }));
  check('a Double Dawgs rebuild pending: no item', C.cannotFinish(ibState, IB, { doubleDawgsPending: true }) === null);
  const prereq = C.finishStateOf({ notPlaced: [{ code: 'CS 4xx', title: '', reason: 'prereq-unmet' }], rows: [], totalHours: 120, degreeTotal: 120, terms: fullTerms, cap: 18 });
  check('a class kept off by a prerequisite the catalog cannot settle is not a settings problem', C.cannotFinish(prereq, IB) === null);
  const freeTerm = C.finishStateOf({ notPlaced: [{ code: 'ACCY 201', title: 'Accounting', reason: 'no-room', credits: 3 }], rows: [], totalHours: 120, degreeTotal: 120, terms: [...fullTerms.slice(1), { season: 'Fall', credits: 12 }], cap: 18 });
  check('"no room" counts even with hours free in some term (they may sit where the class cannot go yet)', C.cannotFinish(freeTerm, IB) !== null && freeTerm.maxFree === 6);
  const chain = C.finishStateOf({ notPlaced: [{ code: 'X 400', title: 'Capstone', reason: 'chain-too-long', credits: 3 }], rows: [], totalHours: 120, degreeTotal: 120, terms: [...fullTerms.slice(1), { season: 'Fall', credits: 12 }], cap: 18 });
  check('a chain too long for the terms left counts with room free', C.cannotFinish(chain, IB) !== null);
  const roomy = C.finishStateOf({ notPlaced: [], rows: ['VI. Major'], totalHours: 120, degreeTotal: 120, terms: [{ season: 'Fall', credits: 12 }, { season: 'Spring', credits: 12 }], cap: 18 });
  check('Illinois: a requirement short with room left is not a settings problem (the data, not the load)', C.cannotFinish(roomy, { ...IB, school: 'illinois' }) === null);
  // UGA (2026-11-03 check): 9 boards like this finish with a summer or a later finish, 150 others do not; nothing on the board tells them apart.
  const maybe = C.cannotFinish(roomy, IB);
  check('UGA: a requirement short with room left gets the "doesn\'t finish yet" item, blaming no setting', maybe?.maybe === true && maybe.text === "This plan doesn't finish by Spring 2030 yet: VI. Major is still short.", maybe?.text);
  const fixed = { candidate: { id: 'summer-2027', label: 'Add Summer 2027', size: 2, change: { summers: [2027] } }, fully: true, left: 0 };
  check('once a fix works it names the settings', C.settleItem(maybe, { working: [fixed], closest: null }).text === "This plan can't finish by Spring 2030 with up to 18 credits a semester and no summer classes. VI. Major is still short.", C.settleItem(maybe, { working: [fixed], closest: null }).text);
  check('when none works it says no change to the settings fixes it', C.settleItem(maybe, { working: [], closest: null }).text === "This plan doesn't finish by Spring 2030: VI. Major is still short, and no single change to your settings fixes it.", C.settleItem(maybe, { working: [], closest: null }).text);
  check('untested, the words are as shown at once', C.settleItem(maybe, null).text === maybe.text && C.settleItem(maybe, null).settled === 'untested');
  check('the longer words follow what the fixes found', /may not be the cause/.test(C.itemMessage(maybe, 'untested', 'ARCH')) && /No single change/.test(C.itemMessage(maybe, 'none', 'ARCH')) && /a change below makes it finish/.test(C.itemMessage(maybe, 'fixable', 'ARCH')) && !/one change below makes room/.test(C.itemMessage(maybe, 'none', 'ARCH')));
  check('its Ask question names what is short, not a setting', C.askQuestion(maybe) === "My plan doesn't finish by Spring 2030: VI. Major is still short. What should I change so it finishes?", C.askQuestion(maybe));
  check('doubled requirement names read once', JSON.stringify(C.plainRows(['VI. Courses Related to the Major', 'VI. Courses Related to the Major: VI. Courses Related to the Major', 'Major Electives: Life Sciences'])) === '["VI. Courses Related to the Major","Major Electives: Life Sciences"]');
  const manyOff = C.finishStateOf({ notPlaced: Array.from({ length: 9 }, (_, i) => ({ code: `AE ${300 + i}`, title: '', reason: 'no-room' })), rows: [], totalHours: 130, degreeTotal: 128, terms: fullTerms, cap: 18 });
  check('a long list at the total says some may be choices from a list', / and 6 more don't fit\. Some may be choices from a list\.$/.test(C.cannotFinish(manyOff, { ...IB, school: 'illinois' })?.text ?? ''), C.cannotFinish(manyOff, { ...IB, school: 'illinois' })?.text);
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
  // 2026-11-03 check: a term away named in About you cannot be dropped through the plan shape.
  const words = C.fixCandidates({ ...IB, away: [{ season: 'Fall', year: 2028, fromWords: true }] });
  check('a term away from the About-you words is never offered as a fix to drop', !words.some((c) => c.id.startsWith('away-')), words.map((c) => c.label).join(' | '));
  // 2026-11-03 check: 13 of 26 one-year-early boards fit everything by the usual Spring 2030.
  const early = { ...IB, finish: { season: 'Spring', year: 2029 }, defaultFinish: { season: 'Spring', year: 2030 } };
  const ec = C.fixCandidates(early);
  const usual = ec.find((c) => c.label === 'Finish in Spring 2030 instead');
  check('an early finish is offered the usual finish too', ec.some((c) => c.label === 'Finish in Fall 2029 instead') && usual && JSON.stringify(C.shapeInputOf(usual)) === '{"finish":"default"}', ec.map((c) => c.label).join(' | '));
  const oneEarly = C.fixCandidates({ ...IB, finish: { season: 'Fall', year: 2029 }, defaultFinish: { season: 'Spring', year: 2030 } });
  check('when the usual finish is one term later it is one candidate', oneEarly.filter((c) => c.id.startsWith('finish-')).length === 1 && JSON.stringify(C.shapeInputOf(oneEarly.find((c) => c.id.startsWith('finish-')))) === '{"finish":"default"}', oneEarly.map((c) => c.label).join(' | '));
  const bsUsual = C.boardSettings({ school: 'uga', terms: board, shapeSummers: [], away: [], target: null, defaultFinish: { season: 'Spring', year: 2030 } });
  check('the usual finish is kept only when it differs from the board\'s', bsUsual && bsUsual.defaultFinish === undefined);
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
  const none = C.rankFixes([C.tried(s1, two), C.tried(later, one)], C.gapOf(two) + 1);
  check('none works: the one leaving the fewest off, worded honestly', none.working.length === 0 && none.closest?.candidate.id === later.id && C.fixButtonText(none.closest) === "Finish in Fall 2030 instead: gets closer, 1 class still doesn't fit", none.closest ? C.fixButtonText(none.closest) : 'none');
  check('nothing better than now: nothing offered', C.rankFixes([C.tried(s1, two)], C.gapOf(two)).closest === null);
  /*
   * The whole reading (2026-11-03 check): 47 "everything fits" buttons left a
   * requirement short or a class off for a prerequisite, and 4 summers booked
   * a class into a summer the Bulletin does not list it for.
   */
  const whole = (o) => ({ stuck: [], shortRows: [], shortHours: 0, roomLeft: 6, leftOff: [], unmet: [], offering: [], ...o });
  const base = whole({ offering: ['ap-offering-fall-2027-x'] });
  check('everything fits only with nothing left off for any reason', !C.tried(s1, whole({ leftOff: [{ code: 'SE 494', title: '', reason: 'prereq-unmet' }] }), 0, base).fully);
  check('... and every requirement met, folded or not', !C.tried(s1, whole({ unmet: ['VI. Courses Related to the Major'] }), 0, base).fully);
  check('... and no class booked in a term it is not offered that the board did not have', !C.tried(s1, whole({ offering: ['ap-offering-fall-2027-x', 'ap-offering-summer-2027-hprb-5060'] }), 0, base).fully && C.tried(s1, whole({ offering: ['ap-offering-fall-2027-x'] }), 0, base).fully);
  const rowLeft = C.tried(s1, whole({ unmet: ['VI. Courses Related to the Major'] }), 0, base);
  check('a requirement still short is worded as one, not as a class', C.fixButtonText(rowLeft) === 'Add Summer 2027: gets closer, 1 requirement is still short', C.fixButtonText(rowLeft));
  const offLeft = C.tried(s1, whole({ offering: ['ap-offering-summer-2027-hprb-5060'] }), 0, base);
  check('a new offering problem is worded as one', C.fixButtonText(offLeft) === "Add Summer 2027: gets closer, but a class lands in a term it isn't offered", C.fixButtonText(offLeft));
  check('the closest ranks classes over requirements', C.gapOf(whole({ leftOff: [{ code: 'A', title: '', reason: 'no-room' }] })) > C.gapOf(whole({ unmet: ['x', 'y', 'z'] })));
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
  check('a row named by its instruction reads by its name', JSON.stringify(C.illinoisRowsShort([{ requirementId: 'a', label: 'Theatre Electives: Select 6 hours from', reason: 'hours-short' }])) === '["Theatre Electives"]');
}

console.log('\n=== 5. The workspace and the advisors (source) ===\n');
{
  const ws = readFileSync(join(ROOT, 'components/planner/planner-workspace.tsx'), 'utf8');
  // Since 2026-11-05 Rebuild shows "Building your plan" and runs composePlan(null) a moment later (the difficulty gate's builds take longer): the same path, deferred.
  // The Rebuild timer now builds inside a try, so the on-screen "Building your plan" state always clears (planner-workspace.tsx buildPlan, 2026-11-05).
  check('fixes are built through the Rebuild path (composePlan with a trial)', /const built = composePlan\(trialShape\(candidate\)\)/.test(ws) && /const buildPlan = useCallback\(\(\) => \{\n[^}]*?pendingBuild\.current = window\.setTimeout\(\(\) => \{\n {6}pendingBuild\.current = null;\n {6}try \{\n {8}composePlan\(null\);/.test(ws));
  check('a trial build shows nothing and saves nothing', /if \(trial\) return \{ generated, horizon, ms:/.test(ws) && /if \(!trial\) lastBuild\.current =/.test(ws));
  check('a fix pressed goes through the set_plan_shape executor', /advisorExecute\('set_plan_shape', \{ \.\.\.shapeInputOf\(fix\.candidate\), confirmed: true \}\)/.test(ws));
  check('over the student\'s own edits it asks first', /if \(boardEdited && !confirmed\) \{\n {6}setFixToConfirm\(fix\);/.test(ws) && /replaces the changes you made to the board by hand/.test(ws));
  check('the board bar passes the item to the triage', /cannotFinish: cannotItem \}\), \[issues, creditGap, school\?\.bot, cannotItem\]/.test(ws));
  check('the trying waits for "Find a fix" and says "Checking what would fix this..."', ws.includes('Find a fix') && ws.includes('Checking what would fix this...'));
  check('review_board carries cannot_finish with the note for the advisor', /cannot_finish: \{\n\s+\.\.\.cannotFinishFacts,/.test(ws));
  check('the board description carries it', ws.includes("Can't finish with the student's settings (first on the board bar)"));
  check('a class placed by hand since the build is dropped from the item', /const onBoard = new Set\(\[\.\.\.boardCodes, \.\.\.completedCodes\]\);/.test(ws));
  check('tested fixes are kept for this very board (a serial for each plan object), not for a sentence', /const fixKey = cannot \? `\$\{planSerialRef\.current\.n\}\|/.test(ws));
  check('one run at a time: a second press or a review waits for the one running', /fixRunRef\.current = \{ key, full: !opts\.quick, done \}/.test(ws) && /running\.key === key && \(running\.full \|\| opts\.quick\)\) return running\.done/.test(ws));
  check('ARCH/ALMA reading the board try smallest first and stop at the first that works or after about 8 seconds', /cf\.find\(\{ quick: true \}\)/.test(ws) && /performance\.now\(\) - started > 8000/.test(ws));
  check('a rebuilt board is read whole (every requirement, every class left off, offering) against the board on screen', /triedFix\(candidate, state, Math\.round\(built\?\.ms \?\? 0\), finishNow\)/.test(ws) && /unmet = ugaUnmet\(audit\)/.test(ws) && /offering = offeringKeys\(validatePlan\(g\.plan/.test(ws));
  check('with a transcript, the current-semester prompt silences the item', /transcript: Boolean\(transcriptRecord && \(transcriptRecord\.courses\?\.length \?\? 0\) > 0\)/.test(ws));
  check('a term away from the About-you words is marked', /\{ \.\.\.a, fromWords: true \}/.test(ws));
  check('the item\'s words settle once the fixes are tried', /const settled = settleItem\(cannot, known\);/.test(ws));
  const bar = readFileSync(join(ROOT, 'components/planner/attention-bar.tsx'), 'utf8');
  check('"Show more" lists the requirements the item stands for', /rows=\{triage\.replaced \?\? \[\]\}/.test(bar));
  const adv = readFileSync(join(ROOT, 'lib/planner/advisor.ts'), 'utf8');
  check('both prompts carry the shared rule', (adv.match(/\$\{SHARED_ADVISOR_RULES\.cannotFinish\}/g) ?? []).length === 2);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
