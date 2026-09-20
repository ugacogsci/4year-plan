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

const { buildIllinoisData } = await import('./illinois-data.ts');
const { routeQuestion, sectionRowsFrom, rewriteForUpstream, splitCompound } = await import('./ask-router.ts');

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
// A real board. Four terms of a real Illinois computer science sequence, with
// the codes spelled the way the catalog spells them.
// ---------------------------------------------------------------------------

const BOARD = [
  ['fall-2026', 'Fall 2026', 'Fall', 2026, 0, ['CS 124', 'MATH 221', 'RHET 105', 'CHEM 102']],
  ['spring-2027', 'Spring 2027', 'Spring', 2027, 1, ['CS 128', 'MATH 231', 'CS 173', 'PHYS 211']],
  ['fall-2027', 'Fall 2027', 'Fall', 2027, 2, ['CS 225', 'MATH 241', 'STAT 400', 'ECON 102']],
  ['spring-2028', 'Spring 2028', 'Spring', 2028, 3, ['CS 374', 'CS 233', 'MATH 257', 'PHIL 103']],
];

function plannedFrom(board) {
  const out = [];
  for (const [termId, termLabel, season, year, index, codes] of board) {
    for (const code of codes) {
      const course = data.byCode.get(code);
      out.push({
        code,
        title: course ? course.title : code,
        credits: course ? course.credits : 0,
        termId,
        termLabel,
        season,
        year,
        index,
      });
    }
  }
  return out;
}

const csProgram =
  data.programs.find((p) => p.name === 'Computer Science, BS') ??
  data.programs.find((p) => /^Computer Science,/.test(p.name)) ??
  data.programs.find((p) => /Computer Science/.test(p.name)) ??
  null;
const csBlocks = csProgram ? data.requirementBlocks.get(csProgram.id) : null;
const programUrl = csBlocks && csBlocks.length ? csBlocks[0].url : null;
console.log(`program        ${csProgram ? csProgram.name : 'none'}  ${programUrl ?? ''}`);
console.log('');

const readSubjects = new Set([...sectionRows.keys()].map((c) => c.split(' ')[0]));
const UNCRAWLED =
  (catalog.courses.find((c) => !readSubjects.has(c.subject) && c.level < 500) ?? { code: 'ZZZ 101' }).code;
console.log(`uncrawled test course  ${UNCRAWLED}`);
console.log('');

const ctx = {
  schoolId: 'illinois',
  data,
  sectionRows,
  planned: plannedFrom(BOARD),
  completedCodes: new Set(['MATH 220']),
  selectedCode: 'CS 225',
  focusTermId: 'spring-2028',
  program: csProgram,
  programUrl,
};

/** The same board with CS 374 moved ahead of CS 225, so a prerequisite breaks. */
const BROKEN = BOARD.map((row) =>
  row[0] === 'spring-2027'
    ? [...row.slice(0, 5), ['CS 128', 'MATH 231', 'CS 374', 'PHYS 211']]
    : row[0] === 'spring-2028'
      ? [...row.slice(0, 5), ['CS 173', 'CS 233', 'MATH 257', 'PHIL 103']]
      : row,
);
const brokenCtx = { ...ctx, planned: plannedFrom(BROKEN) };

/** No card open and no column in view, so every reference has to be asked back. */
const coldCtx = { ...ctx, selectedCode: null, focusTermId: null };

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

console.log('');
process.exit(wrong === 0 && ruleFailures === 0 ? 0 : 1);
