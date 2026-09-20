/**
 * Plain-node check harness for lib/planner/ask-router.ts.
 *
 * Run it from anywhere:
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" node lib/planner/__ask-router.check.mjs
 * It re-execs itself with the type-stripping flag, so there is no build step.
 *
 * The router decides which side of the product answers a student. A question
 * sent to the wrong side is not a small error: a schedule question forwarded to
 * TRU gets a confident decline, and a university question answered locally gets
 * nothing at all. So this runs real questions against the real four files and
 * prints the route and the first line of every answer, rather than asserting a
 * pass count that hides what the copy actually says.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

// Node 23 keeps type stripping behind a flag, so re-exec once with it on.
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

// The repo imports without extensions, which node cannot resolve on its own.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);

const { buildIllinoisData, gradeFootnote, missingPrerequisiteGroups } = await import('./illinois-data.ts');
const { generatePlan } = await import('./autoplan.ts');
const {
  routeQuestion,
  sectionRowsFrom,
  rewriteForUpstream,
  splitCompound,
  resolveTerm,
  suggestedQuestions,
} = await import('./ask-router.ts');

const read = (name) => {
  const path = join(PUBLIC, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
};

const catalog = read('illinois-catalog.json');
const programs = read('illinois-programs.json');
const grades = read('illinois-grades.json');
const sections = read('illinois-sections.json');

if (!catalog) {
  console.error('public/illinois-catalog.json is missing. Nothing to check.');
  process.exit(1);
}

const data = buildIllinoisData({ catalog, programs, grades, sections });
const sectionRows = sectionRowsFrom(sections);

console.log('=== data loaded ===');
console.log(`catalog        ${data.coverage.catalogCourses} rows, ${data.coverage.undergraduateCourses} undergraduate`);
console.log(`grades         ${data.grades.size} courses, bands ${JSON.stringify(data.bands)}`);
console.log(`sections       ${sectionRows.size} courses, term ${data.sectionTerm ? data.sectionTerm.label : 'none'}`);
console.log(`subjects read  ${new Set([...sectionRows.keys()].map((c) => c.split(' ')[0])).size}`);
console.log(`programs       ${data.programs.length}`);

// ---------------------------------------------------------------------------
// The board, GENERATED. Not a list of codes typed into this file.
//
// This harness used to build its PlannedCourse fixtures out of literal calendar
// years and four hand-picked terms. It passed while the running product answered
// "Your board has no Fall 2026" about a Fall 2026 that was on screen, because the
// objects it checked were not the objects the app builds. So the board below is
// the product's own: buildIllinoisData -> requirementBlocks -> generatePlan, then
// flattened into PlannedCourse the way planner-workspace.tsx flattens it, field
// for field, calendar year read out of the term id the same way.
// ---------------------------------------------------------------------------

const csProgram =
  data.programs.find((p) => p.name === 'Computer Science, BS') ??
  data.programs.find((p) => p.name.startsWith('Computer Science,')) ??
  data.programs.find((p) => /Computer Science/.test(p.name)) ??
  null;
const csBlocks = csProgram ? (data.requirementBlocks.get(csProgram.id) ?? []) : [];
const programUrl = csBlocks.length ? csBlocks[0].url : null;
console.log(`program        ${csProgram ? csProgram.name : 'none'}  ${programUrl ?? ''}`);

if (!csProgram || csBlocks.length === 0) {
  console.error('The Computer Science degree page produced no requirement blocks. There is no board to check.');
  process.exit(1);
}

/** The planning context illinois-source.tsx assembles, with nothing re-parsed here. */
const prereqs = new Map();
const creditRanges = new Map();
const exclusions = new Map();
for (const [code, fact] of data.facts) {
  if (fact.prereq) prereqs.set(code, fact.prereq);
  creditRanges.set(code, fact.creditRange);
  if (fact.exclusions.length > 0) exclusions.set(code, fact.exclusions);
}
const snapshotSeason = (data.sectionTerm?.term ?? 'fall').toLowerCase();
const planContext = {
  courses: data.courses,
  prereqs,
  grades: data.grades,
  sections: data.sections,
  equivalents: data.equivalents,
  exclusions,
  creditRanges,
  bands: data.bands,
  // Illinois publishes no offering term anywhere, so no course is refused a term.
  offeringPublished: new Set(),
  snapshotTerm: data.sectionTerm
    ? {
        id: data.sectionTerm.id,
        label: data.sectionTerm.label,
        season: snapshotSeason === 'spring' ? 'Spring' : snapshotSeason === 'summer' ? 'Summer' : 'Fall',
      }
    : null,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  prereqCheck: (spec, earlier, sameTerm, equivalents) =>
    missingPrerequisiteGroups(spec ?? null, earlier, sameTerm, equivalents),
};

const generated = generatePlan({
  requirements: csBlocks,
  context: planContext,
  prior: { courseCodes: ['MATH 220'], exemptCodes: [], unmatchedCredits: 0, known: true },
  horizon: { startSeason: 'Fall', startYear: 2026, gradSeason: 'Spring', gradYear: 2030 },
  programId: csProgram.id,
  preferences: { creditsPerTerm: { min: 12, target: 15, max: 18 } },
});

/**
 * PlanTerm.year is the year of STUDY, 1 to 4. PlannedCourse.year is the calendar
 * year, and the router compares it to the year a student typed. Reading it out of
 * the term id is what planner-workspace.tsx does, for the same reason: the id is
 * not localised and the label may be.
 */
function calendarYearOf(term) {
  const fromId = String(term.id).match(/\b(20\d\d)\b/);
  if (fromId) return Number(fromId[1]);
  const fromLabel = String(term.label).match(/\b(20\d\d)\b/);
  return fromLabel ? Number(fromLabel[1]) : term.year;
}

/** One PlannedCourse per card, in the shape the workspace hands the router. */
function plannedFrom(terms) {
  const out = [];
  terms.forEach((term, index) => {
    for (const code of term.codes) {
      const course = data.byCode.get(code);
      out.push({
        code,
        title: course ? course.title : code,
        credits: course ? course.credits : 0,
        termId: term.id,
        termLabel: term.label,
        season: term.season,
        year: calendarYearOf(term),
        index,
      });
    }
  });
  return out;
}

/** The generated terms, as plain rows this file can rearrange to make a bad board. */
const BOARD = generated.terms.map((term) => ({
  id: term.id,
  label: term.label,
  season: term.season,
  year: term.year,
  codes: [...term.codes],
}));

console.log(`board          ${plannedFrom(BOARD).length} courses across ${BOARD.length} generated terms`);
for (const term of BOARD) console.log(`               ${term.label.padEnd(12)} ${term.codes.join(', ') || 'empty'}`);
for (const note of generated.notes) console.log(`  plan note    ${note}`);
console.log('');

const readSubjects = new Set([...sectionRows.keys()].map((c) => c.split(' ')[0]));
const UNCRAWLED =
  (catalog.courses.find((c) => !readSubjects.has(c.subject) && c.level < 500) ?? { code: 'ZZZ 101' }).code;
console.log(`uncrawled test course  ${UNCRAWLED}`);

/**
 * The open card, and the column it sits in.
 *
 * Chosen off the board rather than typed, and chosen for a card that publishes
 * a prerequisite with courses in it. "What do I need before this one?" against
 * a card whose catalog sentence names no course tests nothing, and the pronoun
 * questions here are the ones the last review found broken.
 */
const SELECTED =
  BOARD.flatMap((t) => t.codes).find((code) => (prereqs.get(code)?.groups ?? []).length > 0) ??
  BOARD[0].codes[0];
const FOCUS = BOARD.find((t) => t.codes.includes(SELECTED)) ?? BOARD[0];
console.log(`focus term     ${FOCUS.label} (${FOCUS.codes.length} cards)   selected card ${SELECTED}`);
console.log('');

const ctx = {
  schoolId: 'illinois',
  data,
  sectionRows,
  planned: plannedFrom(BOARD),
  // The one course the generator was told the student already holds, so the
  // completed set and the plan cannot drift apart.
  completedCodes: new Set(['MATH 220']),
  selectedCode: SELECTED,
  focusTermId: FOCUS.id,
  program: csProgram,
  programUrl,
};

/**
 * The same generated board with one course dragged in front of its prerequisite.
 *
 * Found rather than named: the first card on the board whose parsed prerequisite
 * sits in an earlier term is moved into that earlier term. A hardcoded pair goes
 * stale the moment the generator picks a different elective.
 */
function breakOrder(board) {
  const termOf = new Map();
  board.forEach((term, index) => {
    for (const code of term.codes) termOf.set(code, index);
  });
  for (const term of board) {
    for (const code of term.codes) {
      const spec = prereqs.get(code);
      for (const group of spec?.groups ?? []) {
        if (group.confidence === 'low' || group.concurrent) continue;
        const need = group.any.map((c) => c.replace(/\s+/g, ' ').trim().toUpperCase()).find((c) => termOf.has(c));
        if (need === undefined) continue;
        const from = termOf.get(code);
        const to = termOf.get(need);
        if (to === undefined || to >= from) continue;
        return {
          moved: `${code} from ${board[from].label} to ${board[to].label}, ahead of ${need}`,
          board: board.map((t, i) => ({
            ...t,
            codes: i === from ? t.codes.filter((c) => c !== code) : i === to ? [...t.codes, code] : t.codes,
          })),
        };
      }
    }
  }
  return { moved: 'nothing: no card on this board has a prerequisite earlier on it', board };
}

const broken = breakOrder(BOARD);
console.log(`broken board   ${broken.moved}`);
console.log('');
const brokenCtx = { ...ctx, planned: plannedFrom(broken.board) };

/** No card open and no column in view, so every reference has to be asked back. */
const coldCtx = { ...ctx, selectedCode: null, focusTermId: null };

// ---------------------------------------------------------------------------
// The bug report's shape, now taken off the generated board rather than retyped.
//
// "How heavy is my Spring 2028 term?" was answered "Nothing is on the board yet"
// against a board six terms wide with a full Spring 2028. The generated plan is
// that shape, so the same questions are asked with the last column in view, the
// first column in view, and nothing in view.
// ---------------------------------------------------------------------------

const LAST = BOARD[BOARD.length - 1];
/** The report's board with the last column in view, which is where it was asked. */
const wideCtx = { ...ctx, selectedCode: null, focusTermId: LAST.id };
/** The same board opened at the first column, so "next term" has somewhere to go. */
const earlyCtx = { ...wideCtx, focusTermId: BOARD[0].id };
/** A student who has not built anything yet. The only board that is truly empty. */
const emptyCtx = { ...ctx, planned: [], selectedCode: null, focusTermId: null };

console.log(`report board   ${plannedFrom(BOARD).length} courses across ${BOARD.length} terms, ${FOCUS.label} holds ${FOCUS.codes.join(', ')}`);
console.log('');

// ---------------------------------------------------------------------------
// The questions. `want` is the route this question must take.
// ---------------------------------------------------------------------------

const QUESTIONS = [
  // --- sections: the planner holds all of this and TRU holds none of it ---
  ['what building is CS 225 in?', 'local', ctx],
  ['where is CS 374?', 'local', ctx],
  ['what time does CS 225 meet?', 'local', ctx],
  ['when does MATH 241 meet?', 'local', ctx],
  ['who teaches CS 225?', 'local', ctx],
  ['what sections does CS 173 have?', 'local', ctx],
  ['is CS 128 online?', 'local', ctx],
  ['what part of term is ACCY 201 in?', 'local', ctx],
  ['how many seats are left in CS 225?', 'local', ctx],
  ['is there a waitlist for CS 225?', 'local', ctx],
  ['do any of my classes conflict?', 'local', ctx],
  ['can I get from CS 225 to MATH 241 in time?', 'local', ctx],
  ['what building is PHYS 211 in?', 'local', ctx],
  [`what building is ${UNCRAWLED} in?`, 'local', ctx],
  ['what building is this one in?', 'local', ctx],
  ['where is it?', 'local', coldCtx],
  ['what room does CHEM 102 use?', 'local', ctx],

  // --- load: TRU cannot see a board at all ---
  ['is my spring too hard?', 'local', ctx],
  ['is fall 2027 too heavy?', 'local', ctx],
  ['is my schedule too hard?', 'local', ctx],
  ['which of my classes is hardest?', 'local', ctx],
  ['what is the easiest class on my board?', 'local', ctx],
  ['is my course load manageable?', 'local', ctx],
  ['are my classes too hard next semester?', 'local', ctx],
  ['is my spring 2027 workload doable?', 'local', ctx],
  ['is my spring too hard?', 'local', coldCtx],

  // --- prerequisites: the catalog's own sentence, verbatim ---
  ['what do I need before CS 374?', 'local', ctx],
  ['what are the prerequisites for CS 225?', 'local', ctx],
  ['can I take CS 374?', 'local', ctx],
  ['am I ready for MATH 241?', 'local', ctx],
  ['what do I need before this one?', 'local', ctx],
  ['do I need anything before CS 124?', 'local', ctx],
  ['what are the prereqs for it?', 'local', coldCtx],
  ['what do I need before CS 374?', 'local', brokenCtx],
  ['is my board in the right order?', 'local', ctx],
  ['does my plan work?', 'local', ctx],

  // --- what a course is: TRU answers this with faculty biographies ---
  ['tell me about CS 225', 'local', ctx],
  ['what is CS 374 about?', 'local', ctx],
  ['how many credits is CS 225?', 'local', ctx],
  ['does CS 225 count as a gen ed?', 'local', ctx],
  ['what is MATH 231?', 'local', ctx],

  // --- degree progress: deterministic, never an LLM ---
  ['am I on track to graduate?', 'local', ctx],
  ['how many credits do I still need?', 'local', ctx],
  ['what gen eds are left?', 'local', ctx],
  ['what requirements are left?', 'local', ctx],
  ['am I missing anything for my degree?', 'local', ctx],

  // --- genuine university questions: these must reach TRU ---
  ['when is tuition due?', 'upstream', ctx],
  ['how do I get a parking permit?', 'upstream', ctx],
  ['how do I drop a class?', 'upstream', ctx],
  ['where do I go for financial aid?', 'upstream', ctx],
  ['what is the deadline to add a class?', 'upstream', ctx],
  ['how do I change my major?', 'upstream', ctx],
  ['how do I contact my advisor?', 'upstream', ctx],
  ['is there a career fair this fall?', 'upstream', ctx],
  ['what are the general education requirements at Illinois?', 'upstream', ctx],

  ['where is the Illini Union?', 'upstream', ctx],
  ['what is the Grainger College of Engineering?', 'upstream', ctx],
  ['how do I apply for graduation?', 'upstream', ctx],

  // --- grade history: TRU owns this one outright ---
  ['how hard is CS 225?', 'upstream', ctx],
  ['who grades easier in MATH 241?', 'upstream', ctx],
  ['what is the average GPA in CS 233?', 'upstream', ctx],
  ['how many students fail CHEM 102?', 'upstream', ctx],
  ['what is the withdrawal rate for MATH 241?', 'upstream', ctx],
  ['which instructor should I take for CS 374?', 'upstream', ctx],
  ['CS 225', 'upstream', ctx],

  // --- compound: one half each ---
  ['How hard is CS 225 and what are its prerequisites?', 'upstream', ctx],
  ['what building is CS 225 in and how hard is it?', 'local', ctx],

  // -------------------------------------------------------------------------
  // The four shapes the product's own fallback tells a student to ask. Every
  // one of these was measured going upstream, to an engine that holds no board,
  // no section and no parsed prerequisite. The message promises them, so the
  // router answers them.
  // -------------------------------------------------------------------------
  ['What does CS 225 need first?', 'local', ctx],
  ['How heavy is Fall 2027?', 'local', ctx],
  ['how heavy is spring 2028', 'local', ctx],
  ['Is Spring 2028 too many credits?', 'local', ctx],
  ['How heavy is my Spring 2028 term?', 'local', wideCtx],
  ['where does CS 341 meet?', 'local', wideCtx],
  ['tell me about CS 211', 'local', wideCtx],

  // --- more ways to say "what does this need first" ---
  ['what does CS 374 need first?', 'local', ctx],
  ['what does CS 425 require?', 'local', wideCtx],
  ['what comes before CS 225?', 'local', ctx],
  ['what does CS 497 need first?', 'local', wideCtx],
  ['what do I need before ECE 445?', 'local', wideCtx],
  ['what does CS 498 need first?', 'local', wideCtx],
  ['what do I have to take before CS 341?', 'local', wideCtx],

  // --- more ways to name a term, including ones the board does not run ---
  ['is my summer too hard?', 'local', ctx],
  ['how heavy is fall 2031?', 'local', ctx],
  ['how heavy is my third semester?', 'local', wideCtx],
  ['how heavy is my first semester?', 'local', wideCtx],
  ['how heavy is my last semester?', 'local', wideCtx],
  ['how heavy is my ninth semester?', 'local', wideCtx],
  ['how heavy is next term?', 'local', earlyCtx],
  ['how heavy is next term?', 'local', wideCtx],
  ['how heavy is this term?', 'local', wideCtx],
  ['is 2027 too heavy?', 'local', wideCtx],
  ['is my fall 2028 too packed?', 'local', wideCtx],
  ['which of my classes is hardest in spring 2028?', 'local', wideCtx],
  ['what is the easiest class in fall 2027?', 'local', wideCtx],

  // --- the one board that really is empty, which is the only time we say so ---
  ['How heavy is my Spring 2028 term?', 'local', emptyCtx],
  ['is my spring too hard?', 'local', emptyCtx],

  ['how hard is my third semester?', 'local', wideCtx],

  // -------------------------------------------------------------------------
  // The questions the bar's own chips ask. Three of the four it used to offer
  // were not answered: "Which term is hardest?" and "How do I drop a class?"
  // went upstream, and "Where does my first class meet?" came back with the
  // course picker. The drop question is genuinely the registrar's and stays
  // upstream; the other two are the board's and are answered here now.
  // -------------------------------------------------------------------------
  ['Where does my first class meet?', 'local', ctx],
  ['Where does my first class meet?', 'local', wideCtx],
  ['where does my earliest class meet?', 'local', coldCtx],
  ['Which term is hardest?', 'local', ctx],
  ['Which term is easiest?', 'local', ctx],
  ['which semester is hardest?', 'local', wideCtx],
  ['Which of my terms is hardest?', 'local', ctx],
  ['Where does my first class meet?', 'local', emptyCtx],
  ['Which term is hardest?', 'local', emptyCtx],

  // --- and the questions the widened detectors must NOT steal ---
  ['is CS 225 too hard?', 'upstream', ctx],
  ['is CS 374 easy?', 'upstream', ctx],
  ['is CS 225 hard for me?', 'upstream', ctx],
  ['what do I need to bring to orientation?', 'upstream', ctx],
  ['what textbook does CS 225 require?', 'upstream', ctx],
  ['what does the Grainger College of Engineering require?', 'upstream', ctx],
  ['what is the hardest class at Illinois?', 'upstream', ctx],
  ['what is the hardest semester at Illinois?', 'upstream', ctx],
  ['is the fall semester busy for everyone?', 'upstream', ctx],
  ['how do I drop a class before the deadline?', 'upstream', ctx],
  ['what does the university require before I graduate?', 'upstream', ctx],
  ['when is the deadline to add a class this fall?', 'upstream', ctx],

  // -------------------------------------------------------------------------
  // Plain board questions that name a calendar year.
  //
  // All three of these were measured going upstream and coming back with "I
  // cannot reach Illinois's published pages from this build" about terms the
  // board plainly held. The year contract was already right; there was simply
  // no route asking it anything.
  // -------------------------------------------------------------------------
  ['What am I taking in fall 2027?', 'local', ctx],
  ['What is my schedule in spring 2028?', 'local', wideCtx],
  ['Is CS 464 offered in fall 2026?', 'local', ctx],
  ['what am I taking?', 'local', ctx],
  ["what's on my board?", 'local', ctx],
  ['show me my schedule', 'local', ctx],
  ['what classes do I have in fall 2026?', 'local', ctx],
  ['what courses am I taking in spring 2027?', 'local', ctx],
  ['what am I taking on Tuesday?', 'local', ctx],
  ['what am I taking in fall 2031?', 'local', ctx],
  ['what am I taking?', 'local', emptyCtx],
  ['does CS 173 run in fall 2026?', 'local', ctx],
  ['is CS 225 offered in spring 2029?', 'local', ctx],
  ['is MATH 241 offered?', 'local', ctx],

  // --- and what the roster and offering shapes must not steal ---
  ['what classes do I still need?', 'local', ctx],
  ['what requirements do I have left?', 'local', ctx],
  ['who taught CS 225?', 'upstream', ctx],
  ['is financial aid available for summer?', 'upstream', ctx],
  ['does the library run tutoring?', 'upstream', ctx],
  ['what am I supposed to do at orientation?', 'upstream', ctx],
];

console.log('=== 1. Route and first line, one row per question ===\n');

let wrong = 0;
const seenShapes = new Map();

for (const [question, want, context] of QUESTIONS) {
  const routed = routeQuestion(question, context);
  const shape = routed.shape;
  seenShapes.set(shape, (seenShapes.get(shape) ?? 0) + 1);

  const bad = routed.kind !== want;
  if (bad) wrong += 1;

  const first =
    routed.kind === 'local'
      ? routed.answer.text.split('\n')[0]
      : `-> ${routed.question}`;
  const extra =
    routed.kind === 'local' && routed.alsoUpstream
      ? `\n            + upstream: ${routed.alsoUpstream}`
      : routed.kind === 'upstream' && routed.alsoLocal
        ? `\n            + local: ${routed.alsoLocal.text.split('\n')[0]}`
        : '';

  const tag = `${bad ? 'WRONG ' : '      '}${routed.kind}/${shape}`.padEnd(26);
  console.log(`${tag}${JSON.stringify(question)}`);
  console.log(`                          ${first}${extra}`);
}

console.log(`\n${QUESTIONS.length} questions, ${wrong} routed to the wrong side.`);
console.log(`shapes: ${[...seenShapes.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);

// ---------------------------------------------------------------------------
console.log('\n=== 2. Full text of one answer per local shape ===\n');

const SHOWCASE = [
  ['section', 'what building is CS 225 in?', ctx],
  ['section', 'when does MATH 241 meet?', ctx],
  ['section', 'what building is PHYS 211 in?', ctx],
  ['load', 'is fall 2027 too heavy?', ctx],
  ['load', 'which of my classes is hardest?', ctx],
  ['prereq', 'what do I need before CS 374?', ctx],
  ['prereq', 'what do I need before CS 374?', brokenCtx],
  ['prereq', 'is my board in the right order?', brokenCtx],
  ['course', 'tell me about CS 225', ctx],
  ['course', 'does CS 225 count as a gen ed?', ctx],
  ['section', 'who teaches CS 225?', ctx],
  ['requirements', 'am I on track to graduate?', ctx],
  ['load', 'How heavy is my Spring 2028 term?', wideCtx],
  ['load', 'is my summer too hard?', wideCtx],
  ['load', 'how heavy is next term?', wideCtx],
  ['prereq', 'What does CS 225 need first?', ctx],
  ['prereq', 'what does CS 497 need first?', wideCtx],
  ['prereq', 'what do I need before ECE 445?', wideCtx],
  ['prereq', 'what does CS 498 need first?', wideCtx],
];

for (const [, question, context] of SHOWCASE) {
  const routed = routeQuestion(question, context);
  console.log(`--- ${JSON.stringify(question)}  [${routed.kind}/${routed.shape}]`);
  if (routed.kind === 'local') {
    console.log(routed.answer.text);
    console.log(
      `  sources: ${routed.answer.sources.length ? routed.answer.sources.map((s) => `[${s.n}] ${s.host} ${s.url}`).join('  ') : '(none, grounded=' + routed.answer.grounded + ')'}`,
    );
  } else {
    console.log(`  -> ${routed.question}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
console.log('=== 3. Rules that must hold on every upstream question ===\n');

let ruleFailures = 0;
const ruleFail = (msg) => {
  ruleFailures += 1;
  console.log(`  FAIL  ${msg}`);
};

/**
 * Three ways a generated sentence has reached students looking wrong, checked
 * on every local answer this file produces rather than on the two that were
 * reported.
 *
 * 1. "null". programs.json reports label null for 358 of the 1,155 requirement
 *    areas, and interpolating one printed the four characters as a heading:
 *    "null: 32 of 49 hours." on Middle Grades Education and on Community
 *    Health. An unheaded area has to be described, or left out, never named.
 * 2. Plural agreement. "Degree Requirements, 1 hours" and "1 course rows on
 *    that page". Both were inline ternaries that had no ternary, so a list of
 *    the count nouns this product uses is checked rather than those two.
 * 3. Developer vocabulary. A "course row" is a thing in this repository, not a
 *    thing a student has.
 */
const COUNT_NOUNS =
  'hours|courses|classes|credits|sections|terms|semesters|areas|rows|degrees|subjects|students|parts|instructors|lines|grades|things|questions|areas';

function checkCopy(where, text, fail) {
  if (/\b(null|undefined|NaN)\b/.test(text)) {
    fail(`literal ${/\bnull\b/.test(text) ? 'null' : 'undefined or NaN'} in student copy: ${where}\n        ${text.split('\n').find((l) => /\b(null|undefined|NaN)\b/.test(l))}`);
  }
  const one = new RegExp(`\\b1 (${COUNT_NOUNS})\\b`, 'i').exec(text);
  if (one) fail(`plural after 1: "${one[0]}" in ${where}`);
  if (/\bcourse rows?\b|\bprogram rows?\b|\brequirementId|\bareaId|\bcourseId/i.test(text)) {
    fail(`developer vocabulary in student copy: ${where}`);
  }
}

for (const [question, , context] of QUESTIONS) {
  const routed = routeQuestion(question, context);
  const outgoing = [];
  if (routed.kind === 'upstream') outgoing.push(routed.question);
  if (routed.kind === 'local' && routed.alsoUpstream) outgoing.push(routed.alsoUpstream);

  for (const q of outgoing) {
    // TRU's clarify card refuses any question with no three-letter run, which
    // rejects a bare "CS 225", "ME 200", "IB 150" and five more two-letter
    // Illinois subjects.
    if (!/[a-z]{3,}/i.test(q)) ruleFail(`no three-letter run: ${JSON.stringify(q)}`);
    // The 1,000-character cut is silent and takes the student's half.
    if (q.length > 900) ruleFail(`over 900 chars: ${q.length}`);
    // A pronoun upstream is a question TRU cannot resolve.
    if (/\b(this one|that one|this class|this course)\b/i.test(q)) {
      ruleFail(`unresolved pronoun: ${JSON.stringify(q)}`);
    }
    // The tenant is fixed by the route path; the token only adds BM25 noise.
    if (/\bat illinois\b/i.test(q) && !/\bat illinois\b/i.test(question)) {
      ruleFail(`appended "at Illinois": ${JSON.stringify(q)}`);
    }
  }

  // Every grounded local answer ships with the page its facts came from.
  if (routed.kind === 'local' && routed.answer.grounded && routed.answer.sources.length === 0) {
    ruleFail(`grounded local answer with no source: ${JSON.stringify(question)}`);
  }
  // No em-dashes anywhere in the product's own voice.
  if (routed.kind === 'local' && /—|--/.test(routed.answer.text)) {
    ruleFail(`em-dash in local copy: ${JSON.stringify(question)}`);
  }
  // A local answer must never claim a seat count. Illinois publishes none.
  if (routed.kind === 'local' && /\bseats? (left|remaining|available)\b/i.test(routed.answer.text) && !/no seat counts/i.test(routed.answer.text)) {
    ruleFail(`seat-count claim: ${JSON.stringify(question)}`);
  }
  if (routed.kind === 'local') checkCopy(JSON.stringify(question), routed.answer.text, ruleFail);
}

// The board never leaves the device: no upstream question may carry a code the
// student did not type, unless it replaced a pronoun the student did type.
for (const [question, , context] of QUESTIONS) {
  const routed = routeQuestion(question, context);
  if (routed.kind !== 'upstream') continue;
  const typed = new Set((question.toUpperCase().match(/\b[A-Z]{2,4}\s?\d{3}\b/g) ?? []).map((c) => c.replace(/\s+/g, ' ')));
  const sent = (routed.question.toUpperCase().match(/\b[A-Z]{2,4}\s?\d{3}\b/g) ?? []).map((c) => c.replace(/\s+/g, ' '));
  for (const code of sent) {
    if (typed.has(code)) continue;
    if (/\b(this|that|it)\b/i.test(question)) continue; // a resolved pronoun is allowed
    ruleFail(`code the student never typed went upstream: ${code} from ${JSON.stringify(question)}`);
  }
}

console.log(`  ${ruleFailures === 0 ? 'all upstream and copy rules hold' : `${ruleFailures} rule failures`}`);

// ---------------------------------------------------------------------------
console.log('\n=== 4. Helpers ===\n');
console.log(`splitCompound("How hard is CS 225 and what are its prerequisites?") -> ${JSON.stringify(splitCompound('How hard is CS 225 and what are its prerequisites?'))}`);
console.log(`splitCompound("when is tuition due") -> ${JSON.stringify(splitCompound('when is tuition due'))}`);
console.log(`rewriteForUpstream("CS 225", {code:"CS 225"}) -> ${JSON.stringify(rewriteForUpstream('CS 225', { code: 'CS 225', via: 'code', rewritten: 'CS 225', unknown: false }))}`);

// ---------------------------------------------------------------------------
console.log('\n=== 5. Every planned course, routed through a section question ===\n');
for (const course of ctx.planned) {
  const routed = routeQuestion(`what building is ${course.code} in?`, ctx);
  const line = routed.kind === 'local' ? routed.answer.text.split('\n')[0] : `-> ${routed.question}`;
  console.log(`  ${course.code.padEnd(10)} ${course.termLabel.padEnd(12)} ${line}`);
}

// ---------------------------------------------------------------------------
console.log('=== 6. No answer may tell a student their board is empty ===\n');

/**
 * The defect this section exists for: "How heavy is my Spring 2028 term?" was
 * answered "Nothing is on the board yet, so there is no term to weigh." while
 * the board held twenty one courses. That is not a routing mistake, it is a
 * false statement about the student's own work, so it is checked separately and
 * over every context, not only the ones a question happens to be listed with.
 */
const EMPTINESS_CLAIM = /nothing is on (the board|your board)|board is empty|no plan yet|you have no/i;

const TERM_PHRASINGS = [
  'how heavy is my spring 2028 term?',
  'is my summer too hard?',
  'how heavy is fall 2031?',
  'how heavy is my ninth semester?',
  'how heavy is next term?',
  'how heavy is this term?',
  'how heavy is my third semester?',
  'how heavy is my last semester?',
  'is my winter too heavy?',
  'is summer 2029 too much?',
  'how heavy is 2030?',
  'is my spring too hard?',
  'is my term too heavy?',
  'which of my classes is hardest?',
  'what is the easiest class in spring 2028?',
];

let emptinessLies = 0;
const NAMED_CONTEXTS = [
  { name: 'report board, last column open', context: wideCtx },
  { name: 'report board, first column open', context: earlyCtx },
  { name: 'four term board', context: ctx },
  { name: 'four term board, nothing open', context: coldCtx },
  { name: 'empty board', context: emptyCtx },
];

for (const { name, context } of NAMED_CONTEXTS) {
  for (const question of TERM_PHRASINGS) {
    const routed = routeQuestion(question, context);
    if (routed.kind !== 'local') continue;
    const claims = EMPTINESS_CLAIM.test(routed.answer.text);
    if (claims && context.planned.length > 0) {
      emptinessLies += 1;
      console.log(`  LIE   [${name}] ${JSON.stringify(question)}\n        ${routed.answer.text.split('\n')[0]}`);
    }
  }
}
console.log(
  `  ${TERM_PHRASINGS.length} phrasings across ${NAMED_CONTEXTS.length} boards. ${
    emptinessLies === 0 ? 'No board with courses on it was called empty.' : `${emptinessLies} false claims of emptiness.`
  }`,
);
console.log('');
console.log('  The empty board, for contrast, says so:');
console.log(`    ${routeQuestion('how heavy is my spring 2028 term?', emptyCtx).answer.text}`);

// ---------------------------------------------------------------------------
console.log('\n=== 7. The term resolver, on the report board ===\n');
console.log(`  board: ${[...new Set(wideCtx.planned.map((p) => p.termLabel))].join(', ')}`);
console.log(`  column in view: ${wideCtx.focusTermId}\n`);

const TERM_CASES = [
  'how heavy is spring 2028',
  'how heavy is my spring 2028 term?',
  'is fall 2027 too heavy?',
  'how heavy is my spring?',
  'how heavy is my fall?',
  'is 2027 too heavy?',
  'how heavy is my first semester?',
  'how heavy is my third semester?',
  'how heavy is my last semester?',
  'how heavy is my ninth semester?',
  'how heavy is next term?',
  'how heavy is this term?',
  'is my summer too hard?',
  'how heavy is fall 2031?',
  'is my term too heavy?',
];

for (const question of TERM_CASES) {
  const { term, miss } = resolveTerm(question, wideCtx);
  const verdict = term ? `${term.label} (${term.via})` : `no term: ${miss.reason}${miss.asked ? ` "${miss.asked}"` : ''}`;
  console.log(`  ${JSON.stringify(question).padEnd(42)} ${verdict}`);
}

/**
 * A two term board with nothing open, which is what a student sees in the first
 * minute. A season on its own names exactly one column here, so it resolves
 * where it would have to be asked back about on a four year board.
 */
const SMALL = BOARD.slice(0, 2).map((term) => ({ ...term, codes: term.codes.slice(0, 2) }));
const smallCtx = { ...ctx, planned: plannedFrom(SMALL), selectedCode: null, focusTermId: null };

console.log(`\n  two term board, nothing open: ${SMALL.map((t) => t.label).join(', ')}\n`);
for (const question of [
  'how heavy is my fall?',
  'how heavy is my spring?',
  'how heavy is next term?',
  'how heavy is this term?',
  'is my summer too hard?',
  'how heavy is my second semester?',
]) {
  const { term, miss } = resolveTerm(question, smallCtx);
  const routed = routeQuestion(question, smallCtx);
  const verdict = term ? `${term.label} (${term.via})` : `no term: ${miss.reason}`;
  console.log(`  ${JSON.stringify(question).padEnd(38)} ${verdict}`);
  console.log(
    `      ${routed.kind}/${routed.shape}  ${routed.kind === 'local' ? routed.answer.text.split('\n')[0] : `-> ${routed.question}`}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. The chips the ask bar offers ===\n');

/**
 * The four questions the bar used to suggest were typed into the component, and
 * three of them were not answered: two went upstream and came back with the
 * cannot-reach-upstream line, and one came back with the course picker. A list
 * in one file and a router in another drift, so suggestedQuestions builds the
 * list from the board and routes every entry before returning it.
 *
 * This section is the proof that the generated list holds up on real boards
 * rather than on one demo board: every chip has to reach a grounded local
 * answer with a page behind it, on the board it was generated from.
 */
let chipFailures = 0;
// Labelled off the board rather than with a term count typed in, because the
// generated plan is whatever length the degree and the horizon make it.
const CHIP_BOARDS = [
  { name: 'generated board, last column open', context: wideCtx },
  { name: 'generated board, first column open', context: earlyCtx },
  { name: `generated board, ${FOCUS.label} open`, context: ctx },
  { name: 'generated board, nothing open', context: coldCtx },
  { name: `first ${SMALL.length} terms only`, context: smallCtx },
  { name: 'empty board', context: emptyCtx },
];

for (const { name, context } of CHIP_BOARDS) {
  const chips = suggestedQuestions(context);
  console.log(`  ${name}: ${chips.length} chip${chips.length === 1 ? '' : 's'}`);
  for (const chip of chips) {
    const routed = routeQuestion(chip, context);
    const ok =
      routed.kind === 'local' &&
      routed.shape !== 'clarify' &&
      routed.answer.grounded &&
      routed.answer.sources.length > 0;
    if (!ok) chipFailures += 1;
    console.log(`    ${ok ? '     ' : 'WRONG'} ${routed.kind}/${routed.shape}  ${JSON.stringify(chip)}`);
    console.log(
      `            ${routed.kind === 'local' ? routed.answer.text.split('\n')[0] : `-> ${routed.question}`}`,
    );
  }
}

// A board with no data at all is the ask bar's other case, and there the bar
// falls back to its own general openers rather than to a chip from here.
console.log(`\n  no context at all: ${JSON.stringify(suggestedQuestions(null))}`);
console.log(
  `  ${chipFailures === 0 ? 'every chip reaches a grounded local answer on the board it came from' : `${chipFailures} chips promise something the router does not answer`}`,
);

// ---------------------------------------------------------------------------
console.log('\n=== 9. Prose-only prerequisites, all of them ===\n');

/**
 * The 51 courses whose page says the prerequisites are published per topic in
 * the class schedule, CS 498 among them. Saying "the catalog lists no
 * prerequisite" about one of these is a false statement about the university,
 * so every one of them is routed through both shapes that could say it rather
 * than spot-checking one course.
 */
const NO_PREREQ_CLAIM = /lists no (course )?prerequisite/i;
const noteCourses = [...data.facts.entries()].filter(([, f]) => f.prereq?.note);
let noteFailures = 0;

for (const [code] of noteCourses) {
  for (const question of [`what do I need before ${code}?`, `tell me about ${code}`]) {
    const routed = routeQuestion(question, ctx);
    if (routed.kind !== 'local') continue;
    const text = routed.answer.text;
    if (NO_PREREQ_CLAIM.test(text)) {
      noteFailures += 1;
      console.log(`  CLAIM  ${JSON.stringify(question)}\n         ${text.split('\n\n').find((p) => NO_PREREQ_CLAIM.test(p))}`);
    }
    // The catalog's own sentence has to reach the student either way. Without
    // it the answer is a course that looks like it needs nothing.
    if (!text.includes(data.facts.get(code).prereq.note)) {
      noteFailures += 1;
      console.log(`  SILENT ${JSON.stringify(question)} does not print the catalog's sentence`);
    }
  }
}

console.log(`  ${noteCourses.length} courses whose prerequisites live in the class schedule.`);
console.log(
  `  ${noteFailures === 0 ? 'every one prints the catalog sentence and none is called prerequisite-free' : `${noteFailures} answers got it wrong`}`,
);
console.log(`\n  CS 498, both shapes:`);
for (const question of ['what do I need before CS 498?', 'tell me about CS 498']) {
  const routed = routeQuestion(question, ctx);
  console.log(`    ${routed.kind}/${routed.shape}  ${JSON.stringify(question)}`);
  console.log(`      ${routed.kind === 'local' ? routed.answer.text.split('\n\n').slice(0, 2).join(' ') : `-> ${routed.question}`}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. The board read back, and whether a term is one this build knows ===\n');

/**
 * Three questions the last review measured going upstream: "What am I taking in
 * fall 2027?", "What is my schedule in spring 2028?" and "Is CS 464 offered in
 * fall 2026?" Each came back saying it could not reach Illinois's pages, about
 * terms the board plainly held. Shape is asserted here, not only the side: a
 * roster question answered with a term weight is still the wrong answer.
 */
const BOARD_QUESTIONS = [
  { question: 'What am I taking in fall 2027?', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: 'What is my schedule in spring 2028?', context: wideCtx, wantKind: 'local', wantShape: 'roster' },
  { question: 'what am I taking?', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: "what's on my board?", context: coldCtx, wantKind: 'local', wantShape: 'roster' },
  { question: 'show me my schedule', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: 'what classes do I have in fall 2026?', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: 'what am I taking on Tuesday?', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: 'what am I taking in fall 2031?', context: ctx, wantKind: 'local', wantShape: 'roster' },
  { question: 'what am I taking?', context: emptyCtx, wantKind: 'local', wantShape: 'roster' },
  // A roster shape that is really a progress question, and one that is really
  // a ranking. Neither may be answered with a course list.
  { question: 'what classes do I still need?', context: ctx, wantKind: 'local', wantShape: 'requirements' },
  { question: 'what requirements do I have left?', context: ctx, wantKind: 'local', wantShape: 'requirements' },
  // Offering. Illinois publishes no offering pattern, so the only honest answer
  // names the one term this build holds.
  { question: 'Is CS 464 offered in fall 2026?', context: ctx, wantKind: 'local', wantShape: 'section' },
  { question: 'does CS 173 run in fall 2026?', context: ctx, wantKind: 'local', wantShape: 'section' },
  { question: 'is CS 225 offered in spring 2029?', context: ctx, wantKind: 'local', wantShape: 'section' },
  { question: 'is MATH 241 offered?', context: ctx, wantKind: 'local', wantShape: 'section' },
];

let boardFailures = 0;
for (const { question, context, wantKind, wantShape } of BOARD_QUESTIONS) {
  const routed = routeQuestion(question, context);
  const ok = routed.kind === wantKind && routed.shape === wantShape;
  if (!ok) boardFailures += 1;
  console.log(`  ${ok ? '     ' : 'WRONG'} ${routed.kind}/${routed.shape} (want ${wantKind}/${wantShape})  ${JSON.stringify(question)}`);
  console.log(`          ${routed.kind === 'local' ? routed.answer.text.split('\n')[0] : `-> ${routed.question}`}`);
  if (routed.kind === 'local') checkCopy(JSON.stringify(question), routed.answer.text, (m) => { boardFailures += 1; console.log(`  FAIL  ${m}`); });
}

/**
 * The offering answer may never say a course is not offered. One crawled term
 * is not evidence about any other term, and Illinois publishes no offering
 * pattern in the catalog at all.
 */
const NOT_OFFERED_CLAIM = /\b(is|are) not offered\b|\bdoes not run\b|\bnever (runs|offered)\b|\bonly (runs|offered) in\b/i;
for (const { question, context } of BOARD_QUESTIONS) {
  const routed = routeQuestion(question, context);
  if (routed.kind === 'local' && NOT_OFFERED_CLAIM.test(routed.answer.text)) {
    boardFailures += 1;
    console.log(`  FAIL  offering claim Illinois does not publish: ${JSON.stringify(question)}`);
  }
}

console.log(`\n  full text of the three the review reported:\n`);
for (const [question, context] of [
  ['What am I taking in fall 2027?', ctx],
  ['What is my schedule in spring 2028?', wideCtx],
  ['Is CS 464 offered in fall 2026?', ctx],
]) {
  const routed = routeQuestion(question, context);
  console.log(`--- ${JSON.stringify(question)}  [${routed.kind}/${routed.shape}]`);
  console.log(routed.kind === 'local' ? routed.answer.text : `-> ${routed.question}`);
  console.log('');
}
console.log(
  `  ${boardFailures === 0 ? 'every board question is answered here, by the board' : `${boardFailures} board questions went wrong`}`,
);

// ---------------------------------------------------------------------------
console.log('\n=== 11. One class under two codes, on every surface that reads grades ===\n');

/**
 * The defect: CS 468's card read "Average GPA 3.78, 82% A grades" and named
 * ADV 492 as the row it came from, while in the same session "how heavy is
 * spring 2029" said "No grade history for CS 468" and the hardest ranking left
 * it out. The registrar files a class taught under two codes under one of them,
 * and 503 undergraduate courses are in that position.
 *
 * index.json is the build's own answer to which code each one was filed under,
 * so it is the reference here: the router resolves the twin from the catalog's
 * cross-listing classes, and the two have to agree on every one of them or the
 * surfaces will disagree again.
 */
const indexRows = read('illinois/index.json') ?? [];
const crossListed = indexRows.filter((r) => r && r.gradeFrom);
let twinFailures = 0;

for (const row of crossListed) {
  const code = row.code.replace(/\s+/g, ' ').trim().toUpperCase();
  const routed = routeQuestion(`tell me about ${code}`, ctx);
  if (routed.kind !== 'local') {
    twinFailures += 1;
    console.log(`  FAIL  ${code} went upstream`);
    continue;
  }
  const text = routed.answer.text;
  if (/No grade history is published for this course/i.test(text)) {
    twinFailures += 1;
    console.log(`  DENIED ${code} has history under ${row.gradeFrom} and the card says it has none`);
  } else if (!text.includes(row.gradeFrom)) {
    // The numbers may be shown, but never without saying whose row they are.
    twinFailures += 1;
    console.log(`  SILENT ${code} shows ${row.gradeFrom}'s numbers without naming ${row.gradeFrom}`);
  }
}
console.log(`  ${crossListed.length} courses whose grades Illinois filed under their other code.`);
console.log(
  `  ${twinFailures === 0 ? 'every one is affirmed on the course card, and every one names the code it was filed under' : `${twinFailures} disagree`}`,
);

/**
 * The same courses on a board, so the term weight and the ranking are asked the
 * same question the card was. These two read ctx.data.grades directly before,
 * which is the map that has no CS 468 in it.
 */
const TWIN_BOARD_SIZE = 6;
const twinSample = crossListed.slice(0, TWIN_BOARD_SIZE).map((r) => r.code.replace(/\s+/g, ' ').trim().toUpperCase());
const twinBoard = twinSample.map((code, i) => ({
  code,
  title: data.byCode.get(code)?.title ?? code,
  credits: data.byCode.get(code)?.credits ?? 3,
  termId: BOARD[0].id,
  termLabel: BOARD[0].label,
  season: BOARD[0].season,
  year: calendarYearOf(BOARD[0]),
  index: 0,
  _i: i,
}));
const twinCtx = { ...ctx, planned: twinBoard, completedCodes: new Set(), selectedCode: null, focusTermId: BOARD[0].id };

console.log(`\n  a board of ${twinSample.length} of them, all in ${BOARD[0].label}: ${twinSample.join(', ')}\n`);
for (const question of [`how heavy is ${BOARD[0].label}?`, 'which of my classes is hardest?']) {
  const routed = routeQuestion(question, twinCtx);
  console.log(`--- ${JSON.stringify(question)}  [${routed.kind}/${routed.shape}]`);
  console.log(routed.kind === 'local' ? routed.answer.text : `-> ${routed.question}`);
  console.log('');
  if (routed.kind !== 'local') {
    twinFailures += 1;
    continue;
  }
  for (const code of twinSample) {
    if (new RegExp(`No grade history for [^.]*\\b${code}\\b`, 'i').test(routed.answer.text)) {
      twinFailures += 1;
      console.log(`  DENIED ${code} on ${JSON.stringify(question)}`);
    }
  }
  if (/\bno grade row\b/i.test(routed.answer.text) && !/0 courses/.test(routed.answer.text)) {
    const unranked = /(\d+) courses? on it (?:has|have) no grade row/i.exec(routed.answer.text);
    if (unranked && Number(unranked[1]) > 0) {
      twinFailures += 1;
      console.log(`  DENIED ${unranked[0]} on ${JSON.stringify(question)}`);
    }
  }
  checkCopy(JSON.stringify(question), routed.answer.text, (m) => { twinFailures += 1; console.log(`  FAIL  ${m}`); });
}

console.log(
  `  ${twinFailures === 0 ? 'the card, the term weight and the ranking all read the same grade row' : `${twinFailures} surfaces disagree`}`,
);

// ---------------------------------------------------------------------------
console.log('\n=== 12. Degree pages whose areas carry no heading ===\n');

/**
 * programs.json reports label null with labelKnown false for 358 of the 1,155
 * requirement areas. Interpolating one printed the four characters "null" where
 * a heading belongs: "null: 32 of 49 hours." and "Your board still has hours in
 * those: Degree Requirements, 1 hours; null, 4 hours". Two degrees were
 * reported; every degree is checked here, because the next one is only one
 * crawl away.
 */
const unheaded = data.programs.filter((p) => p.areas.some((a) => !String(a.label ?? '').trim()));
let headingFailures = 0;

for (const program of data.programs) {
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  const routed = routeQuestion('am I on track to graduate?', {
    ...ctx,
    program,
    programUrl: blocks.length ? blocks[0].url : null,
  });
  if (routed.kind !== 'local') {
    headingFailures += 1;
    console.log(`  FAIL  ${program.name} went upstream`);
    continue;
  }
  checkCopy(program.name, routed.answer.text, (m) => { headingFailures += 1; console.log(`  FAIL  ${m}`); });
}

console.log(`  ${data.programs.length} degrees routed, ${unheaded.length} of them with at least one unheaded area.`);
console.log(
  `  ${headingFailures === 0 ? 'no degree prints a heading it does not have, and every count agrees with its noun' : `${headingFailures} degrees print something wrong`}`,
);

const shown = unheaded.find((p) => p.name.endsWith('Middle Grades Education, BS')) ?? unheaded[0] ?? null;
if (shown) {
  const blocks = data.requirementBlocks.get(shown.id) ?? [];
  const routed = routeQuestion('am I on track to graduate?', {
    ...ctx,
    program: shown,
    programUrl: blocks.length ? blocks[0].url : null,
  });
  console.log(`\n--- ${shown.name}, the degree the review reported\n`);
  console.log(routed.kind === 'local' ? routed.answer.text : `-> ${routed.question}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 13. Sections Illinois marks restricted ===\n');

/**
 * 5,439 of the 12,832 Fall 2026 sections read "Open (Restricted)" or
 * "CrossListOpen (Restricted)". The availability test matched the prefix and
 * dropped the rest, so 42 percent of all sections were described to a student
 * as open. A student who builds a term around a section they cannot register
 * for loses the seat and can lose the semester.
 *
 * Every course whose sections are ALL restricted is asked about here. None of
 * those answers may say the word open without saying restricted too.
 */
let restrictionFailures = 0;
const allRestricted = [];
let restrictedRows = 0;
let totalRows = 0;
for (const course of sections?.courses ?? []) {
  const list = course.sections ?? [];
  if (list.length === 0) continue;
  totalRows += list.length;
  const marked = list.filter((s) => /\(Restricted\)/i.test((s.availability ?? '').trim()));
  restrictedRows += marked.length;
  if (marked.length === list.length) allRestricted.push(course.code);
}
console.log(`  ${restrictedRows} of ${totalRows} section rows are marked restricted`);
console.log(`  ${allRestricted.length} courses have no unrestricted section at all`);

const sampled = allRestricted.slice(0, 40);
for (const code of sampled) {
  const routed = routeQuestion(`when does ${code} meet?`, ctx);
  if (routed.kind !== 'local') continue;
  const text = routed.answer.text;
  if (!/restricted/i.test(text)) {
    restrictionFailures += 1;
    console.log(`  FAIL  ${code}: every section is restricted and the answer never says so`);
    continue;
  }
  // "open" on its own line, with no restriction anywhere, is the old bug.
  const bare = text
    .split('\n')
    .filter((line) => /\bopen\b/i.test(line) && !/restricted/i.test(line));
  if (bare.length > 0) {
    restrictionFailures += 1;
    console.log(`  FAIL  ${code}: "${bare[0].trim()}" calls a restricted section open`);
  }
}
console.log(
  `  ${sampled.length} fully restricted courses asked about, ${
    restrictionFailures === 0 ? 'every answer reports the restriction' : `${restrictionFailures} answers do not`
  }`,
);

const example = allRestricted.find((code) => (ctx.sectionRows.get(code) ?? []).length <= 4) ?? allRestricted[0];
if (example) {
  const routed = routeQuestion(`when does ${example} meet?`, ctx);
  console.log(`\n--- ${example}, every section "Open (Restricted)"\n`);
  console.log(routed.kind === 'local' ? routed.answer.text : `-> ${routed.question}`);
}

console.log('');
process.exit(
  wrong === 0 &&
    ruleFailures === 0 &&
    emptinessLies === 0 &&
    chipFailures === 0 &&
    noteFailures === 0 &&
    boardFailures === 0 &&
    twinFailures === 0 &&
    headingFailures === 0 &&
    restrictionFailures === 0
    ? 0
    : 1,
);
