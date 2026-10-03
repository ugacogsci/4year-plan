import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const root = new URL('../../', import.meta.url);
register('data:text/javascript,' + encodeURIComponent(`
  const root = ${JSON.stringify(root.href)};
  export async function resolve(spec, context, next) {
    if (spec.startsWith('@/')) spec = root + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]s$/.test(spec)) {
      try { return await next(spec + '.ts', context); } catch {}
    }
    return next(spec, context);
  }
`));

const { matchTranscript, transcriptCodes, transcriptHours, lineIsForeign, isHomeTranscript, normalizeCourseCode } = await import('./transcript.ts');
const { applyExamCredit } = await import('./onboarding.ts');
const { advisorTools, advisorSystem } = await import('./advisor.ts');
const { transcriptSystem } = await import('./transcript-reader.ts');
const { SCHOOL_CAPABILITIES, isSupportedSchool, readySchools } = await import('./schools.ts');
const { examCourses, examElectiveHours } = await import('../../components/planner/exam-credit.ts');
const read = (path) => JSON.parse(readFileSync(new URL(`public/${path}`, root), 'utf8'));
const catalogs = {
  illinois: read('illinois/index.json'),
  uga: read('uga-catalog.json').map((course) => ({ ...course, code: normalizeCourseCode(course.code) })),
};
const line = (code, extra = {}) => ({ code, title: null, credits: 4, grade: 'A', term: 'Fall 2025', status: 'completed', ...extra });
const doc = (institution, courses) => ({ institution, kind: 'transcript', courses, exams: [], notes: [] });
const match = (school, institution, courses) => matchTranscript(doc(institution, courses), 'test.txt', catalogs[school], ['test.txt'], null, school);

for (const [id, institution, code] of [
  ['illinois', 'University of Illinois Urbana-Champaign', 'MATH 221'],
  ['uga', 'University of Georgia', 'CSCI 1301'],
]) {
  const record = match(id, institution, [line(code)]);
  assert.equal(record.schoolId, id);
  assert.equal(record.home, true);
  assert.deepEqual(transcriptCodes(record), [code]);
  assert.equal(transcriptHours(record), 0, 'a matched course is not also unmatched elective hours');
  assert.equal(lineIsForeign(record, record.courses[0]), false);
  const repeat = match(id, institution, [line(code), line(code, { term: 'Spring 2026' })]);
  assert.deepEqual(transcriptCodes(repeat), [code]);
  assert.equal(repeat.courses.filter((course) => course.use).length, 1);
}
assert.equal(isHomeTranscript('University of Georgia', 'illinois'), false);
assert.equal(isHomeTranscript('University of Illinois Chicago', 'illinois'), false);
assert.equal(isHomeTranscript('Georgia State University', 'uga'), false);
assert.equal(isHomeTranscript('University of North Georgia', 'uga'), false);
const away = match('uga', 'Other College', [line('CSCI 1301')]);
assert.deepEqual(transcriptCodes(away), [], 'another institution using the same course number is not UGA credit');
assert.equal(transcriptHours(away), 4);
const printed = match('uga', 'Other College', [line('CS 101', { equivalent: 'CSCI 1301' })]);
assert.deepEqual(transcriptCodes(printed), ['CSCI 1301']);
const iai = match('uga', 'Parkland College', [line('ENG 101', { iai: 'C1 900', genEdText: 'Composition I' }), line('ENG 102', { iai: 'C1 901' })]);
assert.deepEqual(transcriptCodes(iai), []);
assert(iai.courses.every((course) => !course.genEdTags?.length));
assert(!iai.notes.some((note) => /RHET 105|Illinois decides|Transferology/.test(note)));

const ugaTable = read('uga-exam-credit.json').entries;
const exam = (exam, score, kind = 'AP', level = null) => ({ exam, score, kind, level });
const ab = exam('Mathematics: Calculus AB and Calculus AB Subscore', 5);
const bc = exam('Mathematics: Calculus BC', 5);
const language = exam('English Language & Composition', 5);
const literature = exam('English Literature & Composition', 5);
for (const exams of [[ab, bc], [bc, ab]]) {
  const credit = applyExamCredit(exams, ugaTable);
  assert.equal(credit.credits, 8);
  assert.deepEqual(credit.creditCourses.sort(), ['MATH 2250', 'MATH 2260']);
}
assert.equal(applyExamCredit([language, literature], ugaTable).credits, 6);
assert.equal(applyExamCredit([exam('Italian', 7, 'IB', 'SL')], ugaTable).credits, 10);
assert.equal(applyExamCredit([ab, ab], ugaTable).credits, 4);
assert.equal(applyExamCredit([exam(ab.exam, 3)], ugaTable).credits, 0);
assert.deepEqual(applyExamCredit([exam(ab.exam, 3)], ugaTable).exemptCourses.sort(), ['MATH 1101', 'MATH 1113']);
const ugaCredits = (code) => catalogs.uga.find((course) => course.code === code)?.credits ?? null;
assert.equal(examCourses([ab, bc], ugaTable).reduce((sum, code) => sum + (ugaCredits(code) ?? 0), 0) + examElectiveHours([ab, bc], ugaTable, new Set(), ugaCredits), 8);

const ugaNames = advisorTools('uga').map((tool) => tool.name);
const illinoisNames = advisorTools('illinois').map((tool) => tool.name);
assert(ugaNames.includes('university_answer') && ugaNames.includes('replace_course'));
for (const name of ['course_syllabus', 'program_admission', 'exam_credit', 'record_prior_credit', 'planner_answer']) {
  assert(!ugaNames.includes(name));
  assert(illinoisNames.includes(name));
}
const ugaPrompt = advisorSystem('ARCH', 'University of Georgia', 'UGA', 'uga');
assert(ugaPrompt.includes('University of Georgia'));
assert(!/Grainger|Gies|Parkland|CARE Center|Illinois/.test(ugaPrompt));
assert(!/Grainger|Gies|Parkland|Illinois/.test(transcriptSystem('uga')));
assert(advisorSystem('ALMA').includes('Illinois'));
assert(transcriptSystem('illinois').includes('IAI'));
assert.equal(SCHOOL_CAPABILITIES.uga.syllabi, false);
assert.equal(SCHOOL_CAPABILITIES.illinois.syllabi, true);
assert.equal(isSupportedSchool('vt'), false);
assert.deepEqual(readySchools().map((school) => school.id).sort(), ['illinois', 'uga']);
assert(readySchools().every((school) => school.catalog && school.examCredit));
console.log('School isolation passed: transcript identity, foreign-code collisions, transfer guides, AP/IB overlaps, prompts, tools and supported-school registry.');
