/**
 * Turn the five raw Illinois crawls into the slim artifacts the browser loads.
 *
 * Run it from the repo root:
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" \
 *     node --experimental-strip-types scripts/illinois/build-index.mjs
 *
 * Why this file exists. public/illinois-catalog.json alone is 5.95 MB and the
 * five raw files together are about 12 MB and the section crawl is still growing.
 * Three ways of getting that to a browser are closed to this app:
 *
 *   - `import catalog from '../../public/illinois-catalog.json'` inlines 5.95 MB
 *     into the Cloudflare Worker bundle and breaks the deploy.
 *   - reading the files with fs in a server component: there is no fs at runtime
 *     on Workers.
 *   - fetching the raw catalog from the client: 1.19 MB gzip, parsed before
 *     first paint, and most of those bytes are descriptions no first screen
 *     shows.
 *
 * So the split is by screen, not by source file. What every screen needs about
 * every course at once (code, title, credits, subject, level, gen ed,
 * difficulty, map position) goes in one index. What one screen needs about one
 * course (description, the prerequisite sentence, instructor history, the
 * individual section rows and their buildings) goes in a per-subject shard that
 * loads when a card is opened.
 *
 * Every adapter comes from lib/planner/illinois-data.ts. That module is free of
 * React, fetch and fs precisely so this script and the browser run the same code
 * over the same bytes. If the two ever disagreed about what a prerequisite
 * means, the board would block a student the detail panel calls eligible.
 *
 * Re-runnable by design. The section crawl is still running, so this will be run
 * again. It wipes the two shard trees first, because a subject that vanished
 * from a re-crawl would otherwise keep serving yesterday's file and nothing
 * would look wrong, and it prints how many courses had section data at the
 * moment it ran.
 */

import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIllinoisData, gradeFootnote } from '../../lib/planner/illinois-data.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'illinois');

const RAW = {
  catalog: 'illinois-catalog.json',
  programs: 'illinois-programs.json',
  grades: 'illinois-grades.json',
  sections: 'illinois-sections.json',
  map: 'illinois-map.json',
};

const normCode = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// ---------------------------------------------------------------------------
// Reading, writing, measuring
// ---------------------------------------------------------------------------

/** A missing input is a normal state here: the section crawl may not be done. */
function readRaw(name) {
  try {
    const text = readFileSync(join(PUBLIC, name), 'utf8');
    return { json: JSON.parse(text), bytes: Buffer.byteLength(text) };
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'missing' : `unreadable: ${err.message}`;
    return { json: null, bytes: 0, error: reason };
  }
}

/**
 * Cloudflare serves brotli to every browser this app supports, so gzip is the
 * pessimistic number rather than the real one. Both are printed because the spec
 * quotes gzip and a later reader should not have to guess which was meant.
 */
function measure(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf).length,
    brotli: brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }).length,
  };
}

const bytesOf = (value, pretty = false) =>
  Buffer.from(pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value), 'utf8');

const written = [];

/**
 * Compact JSON, not pretty JSON, for everything the browser fetches. Two-space
 * indentation adds about 200 KB to index.json alone, and a size measured on a
 * pretty file is a measurement of the whitespace.
 */
function write(relPath, value, { pretty = false, group = 'core' } = {}) {
  const buf = bytesOf(value, pretty);
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
  const row = { path: relPath, group, ...measure(buf) };
  written.push(row);
  return row;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const size = (n) => (n >= 1024 * 1024 ? mb(n) : kb(n));
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---------------------------------------------------------------------------
// Load the raw crawls
// ---------------------------------------------------------------------------

const startedAt = Date.now();
const raw = Object.fromEntries(Object.entries(RAW).map(([key, name]) => [key, readRaw(name)]));

if (!raw.catalog.json) {
  console.error(`public/${RAW.catalog} is ${raw.catalog.error}. There is no index to build.`);
  process.exit(1);
}

/** Build notes, plain and short. They ship in meta.json so the UI can be honest. */
const notes = [];
for (const [key, name] of Object.entries(RAW)) {
  if (!raw[key].json) notes.push(`${name} is ${raw[key].error}.`);
}

console.log('BEFORE, the raw crawls in public/');
console.log(`  ${pad('file', 24)} ${padL('raw', 10)} ${padL('gzip', 10)}`);
let rawTotal = 0;
let rawGzipTotal = 0;
for (const [key, name] of Object.entries(RAW)) {
  const r = raw[key];
  if (!r.json) {
    console.log(`  ${pad(name, 24)} ${padL('-', 10)} ${padL('-', 10)}  ${r.error}`);
    continue;
  }
  const m = measure(readFileSync(join(PUBLIC, name)));
  rawTotal += m.raw;
  rawGzipTotal += m.gzip;
  console.log(`  ${pad(name, 24)} ${padL(size(m.raw), 10)} ${padL(size(m.gzip), 10)}`);
}
console.log(`  ${pad('TOTAL', 24)} ${padL(mb(rawTotal), 10)} ${padL(size(rawGzipTotal), 10)}`);
console.log('');

const data = buildIllinoisData({
  catalog: raw.catalog.json,
  programs: raw.programs.json,
  grades: raw.grades.json,
  sections: raw.sections.json,
});

/**
 * The map is a separate crawl and buildIllinoisData does not read it, because x
 * and y are a fact about a drawing, not a fact about a course.
 */
const mapByCode = new Map();
for (const row of raw.map.json?.courses ?? []) {
  if (!row?.code || typeof row.x !== 'number' || typeof row.y !== 'number') continue;
  mapByCode.set(normCode(row.code), { x: row.x, y: row.y });
}

// Wiped before anything is written, so a subject or a degree that disappeared
// from a re-crawl cannot keep serving yesterday's file.
rmSync(join(OUT, 'course'), { recursive: true, force: true });
rmSync(join(OUT, 'program'), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// index.json, one row per undergraduate course
// ---------------------------------------------------------------------------

/**
 * Four fields of Course are deliberately absent from an index row, and the
 * loader puts each of them back with the same value adaptIllinoisCourse uses.
 *
 * offeredIn and offeringKnown are the same two values on all 6,110 rows, so
 * storing them is 317 KB of parse work to learn nothing.
 *
 * format is stored only as `online: true`, because 'In person' is the value for
 * all but a handful of courses.
 *
 * requirementIds and pathwayRole: buildIllinoisData attaches them for all 308
 * programs at once, so a course used by forty degrees would carry forty ids, and
 * the planner only ever shows one degree. The loader re-attaches them from the
 * one program file the student chose.
 *
 * description: absent rather than empty, for the reason a database index has no
 * body column. The loader marks these rows detailLoaded false so that a blank
 * description cannot render as a course with nothing to say about itself.
 *
 * section: derived from the SectionSummary in sections.json by sectionSnapshot,
 * so storing it here would ship the same facts twice and let the two drift.
 */
const indexRows = [];
let positioned = 0;
for (const course of data.courses) {
  const code = normCode(course.code);
  const fact = data.facts.get(code);
  const pos = mapByCode.get(code);
  // A cross-listed course's grade history is filed under whichever code the
  // registrar reported, and it is the same of students either way. CS 468 was
  // telling students "no grade history is published for this course" while the
  // identical ADV 492 showed a 3.78 average from 114 grades. 501 undergraduate
  // courses were in that position. The twin's row is used and the code it came
  // from is recorded, so the surface can say whose numbers these are.
  const twins = (data.equivalents.get(code) ?? []).filter((t) => t !== code);
  const ownGrade = data.grades.get(code);
  const twinCode = ownGrade ? null : twins.find((t) => data.grades.get(t));
  const grade = ownGrade ?? (twinCode ? data.grades.get(twinCode) : undefined);

  const row = {
    id: course.id,
    code: course.code,
    title: course.title,
    credits: course.credits,
    cluster: course.cluster,
    level: fact?.level ?? 0,
  };
  if (course.creditsMax !== undefined) row.creditsMax = course.creditsMax;
  if (course.tags.length > 0) row.tags = course.tags;
  if (course.prerequisites.length > 0) row.prerequisites = course.prerequisites;
  if (course.format === 'Online') row.online = true;
  /**
   * Difficulty is the only number from the grade file that rides in the index.
   * The constellation colours by it and the search sorts by it, both before any
   * card is opened, so the alternative is a blocking second request in front of
   * the first paint. Every other grade number stays in grades.json. Both files
   * are written in the same run from the same rows, so they cannot disagree.
   */
  if (grade && typeof grade.difficulty === 'number') row.difficulty = grade.difficulty;
  // When the numbers are the twin's, say so. They are the same class under two
  // codes, so the figures are right, but a student looking at CS 468 should be
  // able to see that the registrar filed them under ADV 492.
  if (grade && twinCode) row.gradeFrom = twinCode;
  if (pos) {
    row.mapPosition = pos;
    positioned += 1;
  }

  indexRows.push(row);
}

const indexRow = write('index.json', indexRows, { group: 'first paint' });

/**
 * Two alternatives, measured rather than argued about, and printed at the end so
 * a later reader can reopen the decision with real numbers instead of a claim.
 */
const altIndexNoMap = measure(
  bytesOf(
    indexRows.map((r) => {
      const { mapPosition: _drop, ...rest } = r;
      return rest;
    }),
  ),
);
const altIndexNoDifficulty = measure(
  bytesOf(
    indexRows.map((r) => {
      const { difficulty: _drop, ...rest } = r;
      return rest;
    }),
  ),
);

// ---------------------------------------------------------------------------
// prereqs.json, grades.json, sections.json
// ---------------------------------------------------------------------------

const indexCodes = new Set(indexRows.map((r) => normCode(r.code)));

/**
 * Keyed by code, because a PrereqSpec carries no code of its own. The two files
 * below are arrays instead, because their rows already carry one and a key would
 * ship every course code twice.
 *
 * Both the sentence and each group's own clause are kept. They are 46 KB gzip
 * between them and they are what a prerequisite error quotes back at a student.
 * A message that says "missing a prerequisite" without naming the sentence it
 * read is not something anyone can check.
 */
const prereqs = {};
let prereqNoteOnly = 0;
for (const [code, fact] of data.facts) {
  if (!indexCodes.has(code)) continue;
  if (!fact.prereq) continue;
  /**
   * A spec with no groups and no sentence is still shipped when it carries a
   * note.
   *
   * 51 undergraduate rows say some version of "See Class Schedule or
   * departmental course information for topics and prerequisites" and list
   * nothing parsable. Dropping them here is what let CS 498 reach the browser
   * with no entry at all, and a missing entry is read as "the catalog lists no
   * prerequisite for this course", which is a false statement about Illinois.
   */
  if (!fact.prereq.parsed && fact.prereq.text.length === 0 && !fact.prereq.note) continue;
  if (!fact.prereq.parsed && fact.prereq.note) prereqNoteOnly += 1;
  prereqs[code] = fact.prereq;
}
write('prereqs.json', prereqs);

/**
 * Instructor rows are stripped out here and shipped in the subject shards
 * instead. They are two thirds of the grade file and nobody reads an instructor
 * history until they open one course. instructorCount stays so a card can say
 * how many there are before fetching them.
 */
const slimGrades = [];
let orphanGrades = 0;
for (const [code, row] of data.grades) {
  if (!indexCodes.has(code)) {
    orphanGrades += 1;
    continue;
  }
  slimGrades.push({
    code: row.code,
    n: row.n,
    sections: row.sections,
    gpa: row.gpa,
    aPct: row.aPct,
    dfPct: row.dfPct,
    withdrawPct: row.withdrawPct,
    difficulty: row.difficulty,
    instructorCount: (row.instructors ?? []).length,
  });
}
write('grades.json', slimGrades);

/**
 * termId and termLabel are hoisted out of the rows. They are the same two
 * strings on every summary, and the loader stamps them back so what a component
 * holds is a whole SectionSummary rather than a near-miss that every call site
 * has to patch.
 *
 * The file is written only when there is section data. An empty sections.json
 * and a missing one mean different things: no sections crawled at all, versus a
 * term in which nothing is offered. The loader treats the 404 as the first.
 */
let sectionCount = 0;
if (data.sectionTerm) {
  const rows = [];
  for (const [code, summary] of data.sections) {
    if (!indexCodes.has(code)) continue;
    const { termId: _t, termLabel: _l, ...rest } = summary;
    rows.push(rest);
  }
  sectionCount = rows.length;
  write('sections.json', {
    termId: data.sectionTerm.id,
    termLabel: data.sectionTerm.label,
    capturedAt: data.sectionTerm.fetchedAt,
    courses: rows,
  });
}

// ---------------------------------------------------------------------------
// programs.json, the picker list, with no course rows in it
// ---------------------------------------------------------------------------

const defById = new Map(data.programDefs.map((d) => [d.id, d]));
const programList = [];
for (const program of raw.programs.json?.programs ?? []) {
  const def = defById.get(program.id);
  const blocks = data.requirementBlocks.get(program.id) ?? [];
  programList.push({
    id: program.id,
    name: program.name,
    degree: program.degree,
    college: program.college,
    concentration: program.concentration,
    url: program.url,
    totalCredits: def?.totalCredits ?? null,
    courseCount: program.courseCount,
    areaCount: program.areas?.length ?? 0,
    blockCount: blocks.length,
    // 'catalog' only when the crawl actually enumerated course rows.
    // 'placeholder' is the honest word for a degree page whose tables we could
    // not read, and the picker has to be able to tell a student which it is.
    dataStatus: def?.dataStatus ?? 'placeholder',
  });
}
write('programs.json', programList);

// ---------------------------------------------------------------------------
// course/{SUBJECT}.json, the on-demand detail
// ---------------------------------------------------------------------------

const catalogBySubject = new Map();
for (const row of raw.catalog.json.courses ?? []) {
  if (!row?.subject) continue;
  if (!catalogBySubject.has(row.subject)) catalogBySubject.set(row.subject, []);
  catalogBySubject.get(row.subject).push(row);
}

const sectionsBySubject = new Map();
let coursesInSectionFile = 0;
for (const course of raw.sections.json?.courses ?? []) {
  if (!course?.subject) continue;
  coursesInSectionFile += 1;
  if (!sectionsBySubject.has(course.subject)) sectionsBySubject.set(course.subject, []);
  sectionsBySubject.get(course.subject).push(course);
}

const instructorsBySubject = new Map();
for (const [code, row] of data.grades) {
  if ((row.instructors ?? []).length === 0) continue;
  const subject = code.split(' ')[0];
  if (!instructorsBySubject.has(subject)) instructorsBySubject.set(subject, []);
  instructorsBySubject.get(subject).push({ code: row.code, instructors: row.instructors });
}

/**
 * A subject becomes a filename, so it is checked rather than trusted. All 194
 * Illinois prefixes are plain letters today, but a crawl that one day yields
 * "N/A" must not be able to write outside public/illinois/course.
 */
const SAFE_SUBJECT = /^[A-Z][A-Z0-9]{0,9}$/;

const shardRows = [];
const skippedSubjects = [];
for (const [subject, courses] of [...catalogBySubject].sort(([a], [b]) => a.localeCompare(b))) {
  if (!SAFE_SUBJECT.test(subject)) {
    skippedSubjects.push(subject);
    continue;
  }
  shardRows.push(
    write(
      `course/${subject}.json`,
      {
        subject,
        // Graduate and independent-study rows are in the shard even though they
        // are not in the index. A prerequisite or a cross-listing can point at
        // one, and a detail panel that cannot name the course it links to is
        // worse than extra bytes in a file nobody fetches until they click.
        courses,
        sections: sectionsBySubject.get(subject) ?? [],
        instructors: instructorsBySubject.get(subject) ?? [],
      },
      { group: 'on demand' },
    ),
  );
}
if (skippedSubjects.length > 0) {
  notes.push(`Skipped ${skippedSubjects.length} subject shards whose prefix is not a safe filename.`);
}

// ---------------------------------------------------------------------------
// program/{id}.json, one file per degree, verbatim
// ---------------------------------------------------------------------------

/**
 * Program ids carry slashes ("bus/accountancy-bs"), so these nest one or two
 * directories deep. Each file is the raw crawled program, unadapted: the browser
 * runs adaptIllinoisPrograms over it, which is the only way the requirement ids
 * a saved plan holds can match the ones a later build would produce.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/;
const programRows = [];
const skippedPrograms = [];
for (const program of raw.programs.json?.programs ?? []) {
  if (!SAFE_ID.test(program.id)) {
    skippedPrograms.push(program.id);
    continue;
  }
  programRows.push(write(`program/${program.id}.json`, program, { group: 'on demand' }));
}
if (skippedPrograms.length > 0) {
  notes.push(`Skipped ${skippedPrograms.length} program files whose id is not a safe path.`);
}

// ---------------------------------------------------------------------------
// meta.json, written last so it can report on the others
// ---------------------------------------------------------------------------

const coverage = data.coverage;

if (!raw.sections.json) {
  notes.push('No section data in this build. No building, day, time or part of term can be shown.');
}
if (!raw.map.json) {
  notes.push('No map data in this build. The constellation has no positions.');
}
if (raw.map.json && positioned < indexRows.length) {
  notes.push(`${indexRows.length - positioned} indexed courses have no map position.`);
}

/**
 * Whether the program re-crawl has landed.
 *
 * Before the parser fix every program course row carried credits null and echoed
 * the course code back as its title, and a requirement table built on that adds
 * up to nothing and names no courses. The build reports the real counts so the
 * UI can say the hours are unknown instead of printing a column of blanks.
 */
const programCourseRows = (raw.programs.json?.programs ?? []).flatMap((p) =>
  (p.areas ?? []).flatMap((a) => (a.groups ?? []).flatMap((g) => g.courses ?? [])),
);
const rowsWithCredits = programCourseRows.filter((r) => typeof r.credits === 'number').length;
const rowsWithTitle = programCourseRows.filter((r) => r.title && r.title !== r.code).length;
if (programCourseRows.length > 0 && rowsWithCredits === 0) {
  notes.push('No program course row carries credits in this crawl, so requirement hours cannot be summed.');
} else if (rowsWithCredits < programCourseRows.length) {
  notes.push(`${programCourseRows.length - rowsWithCredits} of ${programCourseRows.length} program course rows have no credits.`);
}
if (programCourseRows.length > 0 && rowsWithTitle === 0) {
  notes.push('No program course row carries a title in this crawl, only codes.');
}

const topLevel = written.filter((r) => !r.path.includes('/'));
/**
 * Course exclusions, as their own small artifact.
 *
 * "Credit is not given for both MATH 221 and either MATH 220 or MATH 234" is a
 * correctness constraint, not a nicety: a plan that books MATH 221 on top of a
 * held MATH 220 has sold the student four credits that will not count, and the
 * headline total counts them twice.
 *
 * They lived only in the full catalog adapter, which loads after the plan is
 * already generated, so exclusions were never once checked against a generated
 * plan. 562 courses carry one. The whole table is a few KB, so it ships with
 * the index and the constraint is available from the first paint.
 */
const exclusionRows = {};
for (const [code, fact] of data.facts) {
  if (fact.exclusions && fact.exclusions.length) exclusionRows[code] = fact.exclusions;
}
write('exclusions.json', exclusionRows);

const artifacts = {};
for (const row of topLevel) artifacts[row.path] = { raw: row.raw, gzip: row.gzip };

const meta = {
  school: 'illinois',
  /**
   * The cache-busting version for every other file in this directory. public/
   * assets are not content hashed, so the loader appends ?v=<fetchedAt> to each
   * fetch and everything downstream re-fetches exactly once after a rebuild.
   */
  fetchedAt: new Date().toISOString(),
  sources: {
    catalog: {
      source: raw.catalog.json.source,
      fetchedAt: raw.catalog.json.fetchedAt,
      courses: raw.catalog.json.courses?.length ?? 0,
    },
    programs: raw.programs.json
      ? {
          source: raw.programs.json.source,
          fetchedAt: raw.programs.json.fetchedAt,
          programs: raw.programs.json.programs?.length ?? 0,
        }
      : null,
    grades: data.gradeProvenance,
    sections: raw.sections.json
      ? {
          source: raw.sections.json.source,
          fetchedAt: raw.sections.json.fetchedAt,
          courses: coursesInSectionFile,
        }
      : null,
    map: raw.map.json
      ? {
          method: raw.map.json.method,
          builtAt: raw.map.json.builtAt,
          count: raw.map.json.count ?? mapByCode.size,
        }
      : null,
  },
  term: data.sectionTerm,
  bands: data.bands,
  gradeFootnote: gradeFootnote(data.gradeProvenance),
  coverage,
  counts: {
    indexed: indexRows.length,
    positioned,
    withPrereqSpec: Object.keys(prereqs).length,
    withGrades: slimGrades.length,
    withSections: sectionCount,
    programs: programList.length,
    programsWithCourses: programList.filter((p) => p.dataStatus === 'catalog').length,
    programCourseRows: programCourseRows.length,
    programRowsWithCredits: rowsWithCredits,
    programRowsWithTitle: rowsWithTitle,
    orphanGradeRows: orphanGrades,
    subjectShards: shardRows.length,
    programFiles: programRows.length,
  },
  /** The shard names, so a caller can tell a missing subject from a failed fetch. */
  subjects: shardRows.map((r) => r.path.slice('course/'.length, -'.json'.length)),
  artifacts,
  notes,
};

const metaRow = write('meta.json', meta, { pretty: true, group: 'first paint' });

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const firstPaint = written.filter((r) => r.group === 'first paint');
const core = written.filter((r) => r.group === 'core');

console.log('AFTER, public/illinois/');
console.log(`  ${pad('file', 24)} ${padL('raw', 10)} ${padL('gzip', 10)} ${padL('brotli', 10)}`);
for (const row of [...firstPaint, ...core]) {
  console.log(
    `  ${pad(row.path, 24)} ${padL(size(row.raw), 10)} ${padL(size(row.gzip), 10)} ${padL(size(row.brotli), 10)}`,
  );
}
const shardBytes = shardRows.map((r) => r.raw);
const programBytes = programRows.map((r) => r.raw);
console.log(
  `  ${pad(`course/*.json (${shardRows.length})`, 24)} ${padL(size(sum(shardRows, 'raw')), 10)} ${padL(size(sum(shardRows, 'gzip')), 10)} ${padL(size(sum(shardRows, 'brotli')), 10)}  never all fetched`,
);
console.log(
  `  ${pad(`program/*.json (${programRows.length})`, 24)} ${padL(size(sum(programRows, 'raw')), 10)} ${padL(size(sum(programRows, 'gzip')), 10)} ${padL(size(sum(programRows, 'brotli')), 10)}  never all fetched`,
);
console.log('');

const fpGzip = sum(firstPaint, 'gzip');
const fpBrotli = sum(firstPaint, 'brotli');
const coreGzip = fpGzip + sum(core, 'gzip');
const coreBrotli = fpBrotli + sum(core, 'brotli');
const catalogGzip = measure(readFileSync(join(PUBLIC, RAW.catalog))).gzip;

console.log('WHAT ONE BROWSER ACTUALLY FETCHES');
console.log(`  ${pad('meta.json alone', 38)} ${padL(size(metaRow.gzip), 9)} gzip  term, coverage, provenance`);
console.log(`  ${pad('+ index.json', 38)} ${padL(size(fpGzip), 9)} gzip  board, search and constellation are usable`);
console.log(`  ${pad('+ prereqs, grades, sections, programs', 38)} ${padL(size(coreGzip), 9)} gzip  validation is live`);
console.log(`  ${pad('the same, brotli, which is what ships', 38)} ${padL(size(coreBrotli), 9)} br`);
console.log(`  ${pad('one subject shard', 38)} ${padL(size(median(shardBytes)), 9)} raw   median, largest ${size(Math.max(0, ...shardBytes))}`);
console.log(`  ${pad('one program file', 38)} ${padL(size(median(programBytes)), 9)} raw   median, largest ${size(Math.max(0, ...programBytes))}`);
console.log(`  ${pad('the old way, raw catalog alone', 38)} ${padL(size(catalogGzip), 9)} gzip  plus ${size(raw.catalog.bytes)} of JSON to parse`);
console.log(
  `  first paint is ${(catalogGzip / fpGzip).toFixed(1)}x smaller than the raw catalog, and the raw catalog has no grades, sections or map in it.`,
);
console.log('');

console.log('DECISIONS, MEASURED');
console.log(
  `  map positions in index.json cost ${size(indexRow.gzip - altIndexNoMap.gzip)} gzip. Splitting them into a second file`,
);
console.log('  would make the board interactive sooner and the constellation no sooner, so they stay.');
console.log(
  `  difficulty in index.json costs ${size(indexRow.gzip - altIndexNoDifficulty.gzip)} gzip and removes a blocking request before the map can colour.`,
);
console.log('');

console.log('COVERAGE AT THE MOMENT THIS RAN');
console.log(`  ${padL(coverage.catalogCourses, 6)} catalog courses, ${coverage.undergraduateCourses} undergraduate and not noise`);
console.log(`  ${padL(positioned, 6)} have a map position`);
console.log(`  ${padL(coverage.withParsedPrereq, 6)} have a parsed prerequisite, ${coverage.withLowConfidencePrereq} of those low confidence`);
console.log(`  ${padL(coverage.withPrereqTextOnly, 6)} have a prerequisite sentence the parser could not read`);
console.log(
  `  ${padL(coverage.withPrereqNoteOnly, 6)} say in prose that they have prerequisites and list none, ${prereqNoteOnly} of those shipped in prereqs.json`,
);
console.log(`  ${padL(coverage.withStandingRequirement, 6)} require a class standing before a student can register`);
console.log(`  ${padL(coverage.withGrades, 6)} have grade history, ${coverage.withoutGrades} do not`);
console.log(
  `  ${padL(sectionCount, 6)} have section data for ${coverage.sectionTerm ?? 'no term'}` +
    (raw.sections.json
      ? `, from a crawl file holding ${coursesInSectionFile} courses when this ran`
      : ' (no section file)'),
);
console.log(`  ${padL(coverage.programs, 6)} programs, ${coverage.programsWithCourses} with readable course rows`);
console.log(
  `  ${padL(coverage.programsWithGenEd, 6)} carry a campus general education table, ${coverage.genEdCategories} categories in all, ` +
    `${coverage.genEdCategoriesFromCampus} of them sized from the campus table because no degree page states a number`,
);
console.log(
  `  ${padL(programCourseRows.length, 6)} program course rows, ${rowsWithCredits} with credits, ${rowsWithTitle} with a title of their own`,
);
console.log('');

if (notes.length > 0) {
  console.log('NOTES, also written into meta.json');
  for (const note of notes) console.log(`  ${note}`);
  console.log('');
}

console.log(`Wrote ${written.length} files to public/illinois in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
