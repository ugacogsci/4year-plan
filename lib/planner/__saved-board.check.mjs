/**
 * The board this device remembers, taken off the board and put back.
 *
 * Run it with:  PATH="/opt/homebrew/bin:$PATH" node lib/planner/__saved-board.check.mjs
 * It re-execs itself with the type-stripping flag. Exits non-zero on any failure.
 *
 * A live test found the harm: a student reloaded, the board came back
 * without its generation report (or was rebuilt from onboarding), every
 * elective slot, list chip, gen-ed swap chip and career-track mark was gone,
 * and ALMA's history still named courses that were no longer on the board.
 * lib/planner/saved-board.ts now saves the whole board after every change
 * and restores it on reload. This check builds real boards the way the
 * workspace does, over the files the browser loads (public/illinois/*):
 *
 *   - Aaliyah, Kinesiology, headed for physical therapy school: a track board;
 *   - Jordan, a Parkland transfer into Psychology: held credit, a forfeited
 *     course, residency, LAS 102 as his orientation row;
 *   - Emma, Psychology and pre-med with two years of Spanish, taking
 *     classes in Summer 2027 and away in Spring 2029: a language sequence, a
 *     summer column and a term abroad that earns 15 hours;
 *   - Marcus, Finance: lists that fill before the slots do;
 *
 * edits each one as a student and ALMA would (an elective slot chosen, a
 * gen-ed pick swapped, a course added by hand, a re-pick for the lightest
 * courses), writes it through writeSavedBoard, reads it back through
 * readSavedBoard, and fails when any card's role or chip (label, detail,
 * track) differs from before, when the report, settings, notes, hand-added
 * cards or re-pick signature differ, or when a board read without its report
 * would have looked the same (the check would then prove nothing). It also
 * reads a v3 entry, entries for another school and broken ones, a report
 * missing a later field, a full quota, and Start over.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PUBLIC = join(ROOT, 'public');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

// Extensionless and '@/' imports, as the app writes them.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
  if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const A = await import(join(HERE, 'autoplan.ts'));
const R = await import(join(HERE, 'repick.ts'));
const S = await import(join(HERE, 'saved-board.ts'));
const { cardRole } = await import(join(HERE, 'advisor-packet.ts'));
const { PRIORITY_PRESETS, DEFAULT_PRIORITIES, normalizePriorities } = await import(join(HERE, 'priorities.ts'));
const { adaptIllinoisPrograms, missingPrerequisiteGroups, attachRequirementIds } = await import(join(HERE, 'illinois-data.ts'));
const { hydrateIndexRow, toGradeRow, applyOfferings } = await import(join(HERE, 'illinois-load.ts'));
const { livePools } = await import(join(ROOT, 'components/planner/live-pools.ts'));

// --- the browser's load: loadIllinoisCore + buildContext ---------------------
const pub = (n) => JSON.parse(readFileSync(join(PUBLIC, n), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const meta = pub('illinois/meta.json');
const rows = pub('illinois/index.json').map(hydrateIndexRow);
const offerings = pub('illinois/offerings.json');
applyOfferings(rows, offerings);
const byCode = new Map(rows.map((c) => [norm(c.code), c]));
const byId = new Map(rows.map((c) => [c.id, c]));
const gradeRaw = new Map(pub('illinois/grades.json').map((g) => [norm(g.code), g]));
for (const c of rows) if (c.gradeFrom && gradeRaw.has(norm(c.gradeFrom))) gradeRaw.set(norm(c.code), gradeRaw.get(norm(c.gradeFrom)));
const grades = new Map([...gradeRaw].map(([code, g]) => [code, toGradeRow(g, byCode.get(code)?.title ?? code, [])]));
const sectionFile = pub('illinois/sections.json');
const excellentFile = pub('illinois/excellent.json');
const equivalents = new Map();
for (const c of rows) if (c.twins?.length) equivalents.set(norm(c.code), c.twins.map(norm));
const creditRanges = new Map();
for (const c of rows) {
  const max = c.creditsMax ?? c.credits;
  creditRanges.set(norm(c.code), { credits: c.credits, min: c.credits, max, variable: max > c.credits, known: true });
}
const season = (meta.term?.term ?? 'fall').toLowerCase();
const context = {
  courses: rows,
  prereqs: new Map(Object.entries(pub('illinois/prereqs.json'))),
  grades,
  sections: new Map(sectionFile.courses.map((r) => [norm(r.code), { ...r, termId: sectionFile.termId, termLabel: sectionFile.termLabel }])),
  equivalents,
  exclusions: new Map(Object.entries(pub('illinois/exclusions.json'))),
  excellent: new Map(Object.entries(excellentFile.courses)),
  excellentTerms: excellentFile.terms,
  creditRanges,
  bands: meta.bands,
  offeringPublished: new Set(rows.map((c) => norm(c.code))),
  offerings: new Map(Object.entries(offerings.courses)),
  offeringTerms: offerings.terms,
  offeringAliases: offerings.renumbered ? new Map(Object.entries(offerings.renumbered)) : undefined,
  languages: pub('illinois/languages.json'),
  snapshotTerm: meta.term ? { id: meta.term.id, label: meta.term.label, season: season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall' } : null,
  gradeFootnote: meta.gradeFootnote ?? null,
  prereqCheck: (s, e, t, q) => missingPrerequisiteGroups(s ?? null, e, t, q),
};
const facts = new Map(rows.map((c) => [norm(c.code), { equivalents: (c.twins ?? []).map(norm), genEd: c.tags ?? [] }]));
const summaries = pub('illinois/programs.json');

function load(programId) {
  const summary = summaries.find((p) => p.id === programId);
  if (!summary) throw new Error(`no program ${programId}`);
  for (const r of rows) {
    r.requirementIds = [];
    delete r.pathwayRole;
  }
  const adapted = adaptIllinoisPrograms({ school: 'illinois', source: summary.url, fetchedAt: '', programs: [pub(`illinois/program/${summary.id}.json`)] }, new Map(byCode));
  const blocks = adapted.blocks.get(summary.id) ?? [];
  attachRequirementIds(rows, blocks, facts);
  return { summary, program: adapted.programs[0], blocks };
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};
const ok = (msg) => console.log(`  ok   ${msg}`);

/** A map standing in for window.localStorage; `full` makes every write throw, as a full quota does. */
function memoryStorage(full = false) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

/** JSON with sorted keys, so two equal values compare equal whatever order their keys were written in. */
function canonical(value) {
  return JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

// --- the students ------------------------------------------------------------
const FRESHMAN = { courseCodes: [], exemptCodes: [], unmatchedCredits: 0, known: true, languageSemesters: 4, languageName: 'Spanish', genEdCredits: [] };
const FOUR_YEARS = { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030, stated: false };
// Jordan's Parkland record, as the transcript reader matched it (the same reading __repick uses).
const JORDAN = {
  courseCodes: ['RHET 105', 'PSYC 100', 'SPAN 101', 'SPAN 102', 'SOC 100', 'SPAN 201', 'PHIL 101', 'ENGL 101', 'PSYC 201'],
  exemptCodes: [],
  unmatchedCredits: 17,
  known: true,
  languageSemesters: 2,
  languageName: 'Spanish',
  genEdCredits: [
    { id: 'Parkland College MAT 160 #6', label: 'MAT 160 Statistics (Parkland College)', credits: 4, tags: ['Quantitative Reasoning I'] },
    { id: 'Parkland College HUM 101 #11', label: 'HUM 101 Western Culture: Antiquity to Renaissance (Parkland College)', credits: 3, tags: ['Cultural Studies - Western', 'Humanities - Lit & Arts'] },
  ],
};
const STUDENTS = [
  { name: 'Aaliyah, Kinesiology, pre-PT (track board)', program: 'ahs/kinesiology-bs/applied-exercise-science', studying: 'Kinesiology', after: 'physical therapy school', wants: { track: true } },
  {
    name: 'Jordan, Parkland transfer into Psychology',
    program: 'las/psychology-bslas',
    studying: 'Psychology',
    after: 'clinical and counseling',
    prior: JORDAN,
    horizon: { startSeason: 'Fall', startYear: 2027, gradSeason: 'Spring', gradYear: 2029, stated: true },
    arrival: A.arrivalFromWords("I'm finishing my associate's at Parkland this year and transferring to Illinois in Fall 2027 as a junior."),
    wants: { held: true },
  },
  {
    name: 'Emma, Psychology pre-med, Spanish, Summer 2027 classes, Spring 2029 abroad',
    program: 'las/psychology-bslas',
    studying: 'Psychology, pre-med.',
    after: 'I want to go to medical school so I need to keep my GPA up.',
    prior: { ...FRESHMAN, languageSemesters: 2 },
    horizon: { ...FOUR_YEARS, summers: [2027], away: [{ season: 'Spring', year: 2029, kind: 'study_abroad', credits: 15 }] },
    shape: { finish: null, away: [{ season: 'Spring', year: 2029, kind: 'study_abroad', credits: 15 }], summers: [2027], spreadHard: false },
    wants: { track: true, language: true, summer: true, away: true },
  },
  { name: 'Marcus, Finance', program: 'bus/finance-bs', studying: 'Finance', after: 'Investment banking in Chicago', wants: { pool: true } },
];

/**
 * The workspace's state for one student after a build and a few edits, in
 * the shape it saves: the board, its report, the cards added by hand, the
 * re-pick signature, and the settings.
 */
function buildEdited(st) {
  const L = load(st.program);
  const prior = st.prior ?? FRESHMAN;
  const interests = [st.studying, st.after].join(' ');
  const degreeTotal = L.summary.totalCredits || L.program.totalCredits || 120;
  const g = A.generatePlan({
    requirements: L.blocks,
    context,
    prior,
    horizon: st.horizon ?? FOUR_YEARS,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: L.summary.id,
    degreeTotal,
    interests,
    career: st.after,
    programName: L.program.name,
    programCollege: L.program.college,
    arrival: st.arrival,
    admissionRoute: null,
    residency: { hours: 45, upperLevel: 21, heldHours: 0, heldUpper: 0, source: 'check' },
  });
  let board = g.plan;
  let report = S.reportOf(g);
  const studentAdded = new Set();
  let repickedFor = R.repickSignature(DEFAULT_PRIORITIES, interests);
  const edits = [];
  const priorCodes = () => board.completedCourseIds.map((id) => norm(byId.get(id)?.code ?? ''));
  const priorCredits = A.planCreditRange(priorCodes(), context).min + prior.unmatchedCredits;
  const marksOf = (b, rep) => {
    const pools = rep ? livePools({ base: rep.pools, blocks: L.blocks, boardCodes: codesOn(b), priorCodes: priorCodes(), context }) : [];
    return {
      pools,
      marks: R.planMarks({ pools, language: rep?.language ?? null, electives: rep?.electives ?? [], genEdPicks: rep?.genEdPicks ?? [], addedPrerequisites: rep?.addedPrerequisites ?? [] }, byCode),
    };
  };
  const swapOn = (b, termId, from, to) => ({ ...b, terms: b.terms.map((t) => (t.id === termId ? { ...t, courseIds: t.courseIds.map((id) => (id === from ? to : id)) } : t)) });

  // 1. A student chooses a different course for the first elective slot (chooseElective).
  const beforeSwap = { plan: board, report };
  let afterSwap = null;
  {
    const { marks } = marksOf(board, report);
    // One of the plan's own elective picks. A list's extra course also wears
    // the elective chip (Marcus's MATH 220), but the report does not hold it.
    const picks = new Set(report.electives.map((e) => norm(e.code)));
    const slot = board.terms.flatMap((t) => t.courseIds.map((id) => ({ t, id }))).find(({ id }) => marks.get(id)?.kind === 'elective' && picks.has(norm(byId.get(id)?.code ?? '')));
    if (slot) {
      const onBoard = new Set(codesOn(board));
      const option = A.electiveOptions({ context, requirements: L.blocks, plan: board, termId: slot.t.id, prior, interests, career: st.after, programName: L.program.name, programCollege: L.program.college, priorities: DEFAULT_PRIORITIES, limit: 12 })
        .map((o) => byCode.get(norm(o.code)))
        .find((c) => c && !onBoard.has(norm(c.code)) && c.id !== slot.id);
      if (option) {
        board = swapOn(board, slot.t.id, slot.id, option.id);
        report = S.swapInReport(report, byId.get(slot.id).code, option.code, 'You chose it for this elective slot.');
        edits.push(`slot ${byId.get(slot.id).code} -> ${option.code}`);
        // The slot stays a slot with what the student chose in it (a list
        // that names the course may claim it first); unmarked, it read "added".
        if (!marksOf(board, report).marks.get(option.id)) fail(`${option.code}, chosen for an elective slot, lost the slot's mark`);
        afterSwap = { plan: board, report, slotId: slot.id };
      }
    }
  }
  // 2. A gen-ed pick swapped from its chevron (swapCourse on a 'gened' card).
  {
    const { marks } = marksOf(board, report);
    const pick = board.terms.flatMap((t) => t.courseIds.map((id) => ({ t, id }))).find(({ id }) => marks.get(id)?.kind === 'gened');
    if (pick) {
      const scorer = A.qualityScorer({ context, requirements: L.blocks, interests, career: st.after, programName: L.program.name, priorities: DEFAULT_PRIORITIES, carriedCodes: codesOn(board) });
      const onBoard = new Set(board.terms.flatMap((t) => t.courseIds));
      const other = R.genEdCandidates({ context, requirements: L.blocks, board, courseId: pick.id, scorer }).map((c) => c.course).find((c) => !onBoard.has(c.id));
      if (other) {
        board = swapOn(board, pick.t.id, pick.id, other.id);
        report = S.swapInReport(report, byId.get(pick.id).code, other.code, `You chose it for ${marks.get(pick.id).label}.`);
        edits.push(`gen ed ${byId.get(pick.id).code} -> ${other.code}`);
        if (!marksOf(board, report).marks.get(other.id)) fail(`${other.code}, swapped in for a gen-ed pick, lost the pick's mark`);
      }
    }
  }
  // 3. A course the student drags in by hand (addCourse): it reads "added".
  {
    const onBoard = new Set(codesOn(board));
    const extra = ['HIST 100', 'MUS 130', 'ASTR 100', 'GEOL 100'].map((c) => byCode.get(c)).find((c) => c && !onBoard.has(norm(c.code)));
    const last = board.terms.filter((t) => t.season !== 'Summer').at(-1);
    if (extra && last) {
      board = { ...board, terms: board.terms.map((t) => (t.id === last.id ? { ...t, courseIds: [...t.courseIds, extra.id] } : t)) };
      studentAdded.add(extra.id);
      edits.push(`added ${extra.code}`);
    }
  }
  // 4. ALMA's set_priorities: the lightest courses, re-picked (repickElectives).
  const priorities = PRIORITY_PRESETS.lightest;
  {
    const { marks, pools } = marksOf(board, report);
    const run = R.repickBoard({
      context, requirements: L.blocks, board, marks, pools, prior, interests, career: st.after,
      programName: L.program.name, programCollege: L.program.college, priorities, minimumTermCredits: 12,
      priorCredits, degreeTotal, trackPicks: report.electives.filter((e) => e.track).map((e) => e.code),
      lastSignature: repickedFor, arrival: st.arrival,
    });
    repickedFor = run.signature;
    if (run.changes.length > 0) {
      board = run.board;
      report = S.repickInReport(report, run.changes);
    }
    edits.push(`re-pick: ${run.changes.length} changed`);
  }
  const settings = {
    minimumTermCredits: 12,
    targetTermCredits: 15,
    careerInterests: st.after,
    careerCleared: false,
    priorities,
    planShape: st.shape ?? S.NO_SHAPE,
  };
  return {
    L, g, edits, marksOf, beforeSwap, afterSwap,
    saved: {
      schemaVersion: 4,
      schoolId: 'illinois',
      programId: L.summary.id,
      savedAt: new Date().toISOString(),
      board: { plan: board, report, notes: g.notes, studentAdded: [...studentAdded], repickedFor, edited: true },
      settings,
    },
  };
}

const codesOn = (b) => b.terms.flatMap((t) => t.courseIds).map((id) => norm(byId.get(id)?.code ?? ''));

/** Every card on a board with its role and its chip, as the board and ALMA read them. */
function cardsOf(state, L, marksOf) {
  const { marks } = marksOf(state.plan, state.report);
  const added = new Set(state.studentAdded);
  const out = new Map();
  for (const t of state.plan.terms) {
    for (const id of t.courseIds) {
      const course = byId.get(id);
      if (!course) continue;
      const role = cardRole(course, { marks, bookedFor: state.report?.bookedFor, blocks: L.blocks, studentAdded: added });
      const mark = marks.get(id);
      out.set(`${t.label} ${course.code}`, `${role}${mark ? ` | ${mark.kind} | ${mark.label} | ${mark.track ?? ''} | ${mark.detail}` : ''}`);
    }
  }
  return out;
}

console.log('Round trip, board by board:');
for (const st of STUDENTS) {
  const started = Date.now();
  const { L, g, edits, marksOf, saved, beforeSwap, afterSwap } = buildEdited(st);
  const storage = memoryStorage();
  const wrote = S.writeSavedBoard(storage, S.serializeBoard(saved));
  const back = S.readSavedBoard(storage, 'illinois');
  const bytes = storage.map.get(S.BOARD_KEY)?.length ?? 0;
  console.log(`${st.name} (${Date.now() - started} ms, ${Math.round(bytes / 1024)} KB saved; ${edits.join('; ')})`);
  if (!wrote) fail('writeSavedBoard refused an ordinary board');
  if (!back) {
    fail('readSavedBoard returned nothing for the board just written');
    continue;
  }
  const before = cardsOf(saved.board, L, marksOf);
  const after = cardsOf(back.board, L, marksOf);
  let differ = 0;
  for (const [card, was] of before) {
    const now = after.get(card);
    if (now !== was) {
      differ += 1;
      if (differ <= 5) fail(`${card}: "${was}" before the reload, "${now ?? 'not on the board'}" after`);
    }
  }
  for (const card of after.keys()) if (!before.has(card)) fail(`${card} is on the restored board and was not before`);
  if (differ === 0) ok(`${before.size} cards keep their role and chip`);
  const roles = [...before.values()].map((v) => v.split(' | ')[0]);
  const count = (role) => roles.filter((r) => r === role).length;
  console.log(`       roles: ${['required', 'from a list', 'elective slot', 'career track', 'language', 'gen ed pick', 'prerequisite', 'added'].map((r) => `${r} ${count(r)}`).join(', ')}`);

  // What the board is built from, and what the review reads, come back as they were.
  if (canonical(back.board.report) !== canonical(saved.board.report)) fail('the report differs after the round trip');
  if (canonical(back.board.plan) !== canonical(saved.board.plan)) fail('the terms differ after the round trip');
  // Priorities come back normalised (a preset gains notBefore: null and
  // freeDays: []), the form set_priorities stores and repickSignature reads.
  const settingsWere = { ...saved.settings, priorities: normalizePriorities(saved.settings.priorities) };
  if (canonical(back.settings) !== canonical(settingsWere)) fail(`the settings differ: ${canonical(back.settings)} against ${canonical(settingsWere)}`);
  if (R.repickSignature(back.settings.priorities, 'x') !== R.repickSignature(saved.settings.priorities, 'x')) fail('the restored priorities read as different priorities to the re-pick');
  if (canonical(back.board.notes) !== canonical(saved.board.notes)) fail('the plan notes differ after the round trip');
  if (canonical([...back.board.studentAdded].sort((a, b) => a.localeCompare(b))) !== canonical([...saved.board.studentAdded].sort((a, b) => a.localeCompare(b)))) fail('the hand-added cards differ after the round trip');
  if (back.board.repickedFor !== saved.board.repickedFor) fail('the re-pick signature differs, so a second Re-pick for the same priorities would move courses');
  if (back.board.edited !== true) fail('the board forgot it was edited, so a credit change would replace the edits without asking');
  if (back.programId !== saved.programId) fail(`the degree came back as ${back.programId}`);
  if (!back.board.report?.builtTerms || Object.keys(back.board.report.builtTerms).length !== g.terms.length) fail('builtTerms, which the review compares the board with, did not come back whole');

  // The board this student is meant to have: otherwise the check skipped what it is for.
  const kinds = new Set([...after.values()].map((v) => v.split(' | ')[0]));
  if (st.wants.track && !kinds.has('career track')) fail('no career-track card on a track board');
  if (st.wants.language && !kinds.has('language')) fail('no language card on a board with a language sequence');
  if (st.wants.pool && !kinds.has('from a list')) fail('no from-a-list card on a board with lists');
  if (st.wants.held && (back.board.plan.completedCourseIds.length === 0 || !back.board.report?.residency)) fail('the transfer board lost its held credit or its residency report');
  if (st.wants.summer && !back.board.plan.terms.some((t) => t.season === 'Summer')) fail('the summer column did not come back');
  if (st.wants.away && !(back.board.report?.away ?? []).some((a) => a.season === 'Spring' && a.year === 2029 && a.credits === 15)) fail('the term abroad and its 15 hours did not come back');
  if (!kinds.has('elective slot') && !kinds.has('gen ed pick')) fail('no elective slot or gen-ed pick: nothing the report marks was on the board');
  if (!kinds.has('added')) fail('the course added by hand is not on the board');

  // Without its report (a v3 save) the same board reads differently. If it
  // did not, the round trip above would prove nothing about the report.
  const bare = cardsOf({ ...back.board, report: null }, L, marksOf);
  const lost = [...before].filter(([card, was]) => bare.get(card) !== was).length;
  if (lost === 0) fail('the board reads the same without its report, so this check cannot see the report');
  else ok(`${lost} of ${before.size} cards would lose their role or chip without the report`);

  // Undoing the slot swap. An undo step holds the report with the board
  // (BoardState); the old step held the terms alone, and the course put
  // back in the slot came back unmarked, reading "added".
  if (afterSwap) {
    const slotCard = [...cardsOf({ ...beforeSwap, studentAdded: [] }, L, marksOf)].find(([card]) => card.endsWith(` ${byId.get(afterSwap.slotId).code}`));
    const termsOnly = cardsOf({ plan: beforeSwap.plan, report: afterSwap.report, studentAdded: [] }, L, marksOf);
    if (!slotCard) fail('the slot swapped out is missing from the board before the swap');
    else if (termsOnly.get(slotCard[0]) === slotCard[1]) fail(`undoing the terms alone left ${slotCard[0]} as it was, so this cannot show the report has to come back with them`);
    else ok(`undo with the report puts ${slotCard[0]} back as "${slotCard[1].split(' | ')[0]}"; the terms alone read "${termsOnly.get(slotCard[0])?.split(' | ')[0]}"`);
  }
}

console.log('A v3 save, from before the report was kept:');
{
  const st = STUDENTS[3];
  const L = load(st.program);
  const g = A.generatePlan({
    requirements: L.blocks, context, prior: FRESHMAN, horizon: FOUR_YEARS,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: L.summary.id, degreeTotal: L.summary.totalCredits || 120, interests: st.studying, career: st.after,
    programName: L.program.name, programCollege: L.program.college, admissionRoute: null,
  });
  const v3 = {
    schemaVersion: 3, schoolId: 'illinois', programId: L.summary.id, plan: g.plan,
    minimumTermCredits: 13, targetTermCredits: 16, careerInterests: 'investment banking', careerCleared: false,
    priorities: PRIORITY_PRESETS.teaching,
    planShape: { finish: { season: 'Fall', year: 2029 }, away: [], summers: [], spreadHard: true },
  };
  const storage = memoryStorage();
  storage.setItem(S.LEGACY_BOARD_KEY, JSON.stringify(v3));
  const back = S.readSavedBoard(storage, 'illinois');
  if (!back) fail('a v3 save did not load');
  else {
    if (canonical(back.board.plan) !== canonical(v3.plan)) fail('the v3 terms changed on the way in');
    if (back.board.report !== null) fail('a v3 save has no report, and one was made up');
    if (!back.board.edited) fail('a v3 board should count as edited, so a credit change asks before replacing it');
    if (back.settings.minimumTermCredits !== 13 || back.settings.targetTermCredits !== 16) fail('the v3 credit load did not come through');
    if (back.settings.careerInterests !== 'investment banking') fail('the v3 career words did not come through');
    if (back.settings.priorities.teaching !== 2 || back.settings.priorities.coverage !== 0) fail('the v3 priorities did not come through');
    if (!back.settings.planShape.spreadHard || back.settings.planShape.finish?.year !== 2029) fail('the v3 plan shape did not come through');
    // A board with no report reads as today: every card is required or added.
    const roles = [...cardsOf(back.board, L, (b, rep) => ({ pools: [], marks: R.planMarks({ pools: [], language: rep?.language ?? null, electives: rep?.electives ?? [], genEdPicks: rep?.genEdPicks ?? [], addedPrerequisites: rep?.addedPrerequisites ?? [] }, byCode) })).values()].map((v) => v.split(' | ')[0]);
    if (roles.some((r) => r !== 'required' && r !== 'added')) fail(`a board with no report shows marks it cannot have: ${[...new Set(roles)].join(', ')}`);
    ok(`v3 loads with no report; ${roles.length} cards read ${[...new Set(roles)].join(' or ')}`);
    S.writeSavedBoard(storage, S.serializeBoard(back));
    if (storage.getItem(S.LEGACY_BOARD_KEY) !== null) fail('the v3 entry is still there after the first v4 write, so it could come back over a newer board');
    if (!S.readSavedBoard(storage, 'illinois')) fail('the migrated board did not read back from v4');
    else ok('the first write moves it to v4 and removes the v3 entry');
  }
  // v3 without the fields later builds added reads as balanced with no shape.
  const bare = memoryStorage();
  bare.setItem(S.LEGACY_BOARD_KEY, JSON.stringify({ schemaVersion: 3, schoolId: 'illinois', programId: 'x', plan: g.plan, minimumTermCredits: 12, careerInterests: '' }));
  const old = S.readSavedBoard(bare, 'illinois');
  if (!old || old.settings.targetTermCredits !== null || canonical(old.settings.planShape) !== canonical(S.NO_SHAPE) || old.settings.priorities.workload !== DEFAULT_PRIORITIES.workload) fail('an early v3 save should read as balanced, default priorities, no shape');
  else ok('an early v3 save reads as balanced with no shape');
}

console.log('Entries that must not load:');
{
  const L = load('las/psychology-bslas');
  const plan = { schemaVersion: 1, programId: L.summary.id, graduationLabel: 'Spring 2030', completedCourseIds: [], terms: [] };
  const good = { schemaVersion: 4, schoolId: 'illinois', programId: L.summary.id, savedAt: '', board: { plan, report: null, notes: [], studentAdded: [], repickedFor: null, edited: false }, settings: {} };
  const cases = [
    ['another school\'s v4 board', S.BOARD_KEY, JSON.stringify({ ...good, schoolId: 'uga' })],
    ['another school\'s v3 board', S.LEGACY_BOARD_KEY, JSON.stringify({ schemaVersion: 3, schoolId: 'uga', programId: 'x', plan, minimumTermCredits: 12, careerInterests: '' })],
    ['a later schema', S.BOARD_KEY, JSON.stringify({ ...good, schemaVersion: 5 })],
    ['a board that is not a plan', S.BOARD_KEY, JSON.stringify({ ...good, board: { ...good.board, plan: { terms: 'no' } } })],
    ['half a JSON entry', S.BOARD_KEY, '{"schemaVersion":4,"schoolId":"illin'],
    ['a string', S.BOARD_KEY, '"hello"'],
  ];
  for (const [what, key, raw] of cases) {
    const storage = memoryStorage();
    storage.setItem(key, raw);
    let got;
    try {
      got = S.readSavedBoard(storage, 'illinois');
    } catch (error) {
      fail(`${what} threw: ${error.message}`);
      continue;
    }
    if (got) fail(`${what} loaded`);
  }
  const reading = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {}, removeItem: () => {} };
  if (S.readSavedBoard(reading, 'illinois') !== null) fail('a storage that throws on read should give no board');
  if (S.readSavedBoard(null, 'illinois') !== null) fail('no storage should give no board');
  ok('other schools, later schemas, broken entries and blocked storage give no board and never throw');

  // A report written before a later field existed keeps what it has.
  const g = A.generatePlan({
    requirements: L.blocks, context, prior: FRESHMAN, horizon: FOUR_YEARS,
    preferences: { creditsPerTerm: { min: 12, target: null, max: 18 }, priorities: DEFAULT_PRIORITIES },
    programId: L.summary.id, degreeTotal: L.summary.totalCredits || 120, interests: 'Psychology', career: '',
    programName: L.program.name, programCollege: L.program.college, admissionRoute: null,
  });
  const report = S.reportOf(g);
  const older = { ...report };
  delete older.builtTerms;
  delete older.aim;
  delete older.away;
  delete older.genEdPicks;
  const storage = memoryStorage();
  storage.setItem(S.BOARD_KEY, JSON.stringify({ ...good, board: { ...good.board, plan: g.plan, report: older } }));
  const back = S.readSavedBoard(storage, 'illinois');
  if (!back?.board.report) fail('a report missing a later field was thrown away');
  else if (canonical(back.board.report.electives) !== canonical(report.electives) || canonical(back.board.report.pools) !== canonical(report.pools) || !Array.isArray(back.board.report.genEdPicks)) fail('a report missing a later field lost what it had');
  else ok('a report missing a later field keeps its slots and lists');
  storage.setItem(S.BOARD_KEY, JSON.stringify({ ...good, board: { ...good.board, plan: g.plan, report: { pools: 'broken' } } }));
  const broken = S.readSavedBoard(storage, 'illinois');
  if (!broken || broken.board.report !== null) fail('a broken report should cost the report, not the board');
  else ok('a broken report costs the report, not the board');
}

console.log('Writing, a full quota, and Start over:');
{
  const saved = { schemaVersion: 4, schoolId: 'illinois', programId: 'x', savedAt: '', board: { plan: { schemaVersion: 1, programId: 'x', graduationLabel: '', completedCourseIds: [], terms: [] }, report: null, notes: [], studentAdded: [], repickedFor: null, edited: false }, settings: { minimumTermCredits: 12, targetTermCredits: null, careerInterests: '', careerCleared: false, priorities: DEFAULT_PRIORITIES, planShape: S.NO_SHAPE } };
  if (S.writeSavedBoard(memoryStorage(true), S.serializeBoard(saved)) !== false) fail('a full quota should report the board as not saved');
  if (S.writeSavedBoard(null, S.serializeBoard(saved)) !== false) fail('no storage should report the board as not saved');
  const storage = memoryStorage();
  storage.setItem(S.BOARD_KEY, S.serializeBoard(saved));
  storage.setItem(S.LEGACY_BOARD_KEY, '{}');
  storage.setItem(S.CHAT_KEY, JSON.stringify({ programId: 'x', messages: [{ role: 'user', content: 'Add HIST 200' }] }));
  storage.setItem('fourYear.onboarding.v2', '{"schoolId":"illinois"}');
  S.forgetBoard(storage);
  for (const key of [S.BOARD_KEY, S.LEGACY_BOARD_KEY, S.CHAT_KEY]) if (storage.getItem(key) !== null) fail(`${key} survived forgetBoard`);
  if (storage.getItem('fourYear.onboarding.v2') === null) fail('forgetBoard took the About-you answers too; only Start over clears those');
  ok('a full quota reports not saved; forgetBoard clears the board and the chat together and leaves the answers');

  let stack = [];
  for (let i = 0; i < S.UNDO_LIMIT + 5; i += 1) stack = S.pushUndo(stack, { before: { ...saved.board, notes: [String(i)] } });
  if (stack.length !== S.UNDO_LIMIT || stack.at(-1).before.notes[0] !== String(S.UNDO_LIMIT + 4)) fail(`the undo stack should keep the last ${S.UNDO_LIMIT} steps`);
  else ok(`undo keeps the last ${S.UNDO_LIMIT} steps`);
}

console.log(failures === 0 ? '\nAll saved-board checks passed.' : `\n${failures} saved-board check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
