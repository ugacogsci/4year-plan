import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectSchool, makeClient, normalizeProfile, SCHOOLS, toCsv, validatePage } from './collect.mjs';

const teacher = (id, extra = {}) => ({
  legacyId: id, firstName: 'Example', lastName: `Instructor ${id}`, department: 'Test',
  numRatings: 12, avgRating: 4, avgDifficulty: 3, wouldTakeAgainPercent: 0,
  school: { id: Buffer.from('School-1101').toString('base64'), name: SCHOOLS.uga.name },
  ...extra,
});
const page = (ids, total, cursor = null) => ({ data: { search: { teachers: {
  didFallback: false, resultCount: total,
  edges: ids.map((id) => ({ node: teacher(id) })),
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
} } } });

test('unrated and missing scores stay unknown; a genuine zero percent is retained', () => {
  const rated = normalizeProfile(teacher(1), SCHOOLS.uga, 'today');
  assert.equal(rated.wouldTakeAgainPercent, 0);
  const unrated = normalizeProfile(teacher(2, { numRatings: 0, avgRating: 0, avgDifficulty: 0 }), SCHOOLS.uga, 'today');
  assert.equal(unrated.averageRating, null);
  assert.equal(unrated.averageDifficulty, null);
  assert.equal(unrated.wouldTakeAgainPercent, null);
  assert.equal(normalizeProfile(teacher(3, { wouldTakeAgainPercent: -1 }), SCHOOLS.uga, 'today').wouldTakeAgainPercent, null);
});

test('wrong-school, GraphQL errors, fallback, and stuck pagination fail closed', () => {
  assert.throws(() => normalizeProfile(teacher(1), SCHOOLS.illinois, 'today'), /different school/);
  assert.throws(() => validatePage({ errors: [{ message: 'blocked' }] }, SCHOOLS.uga, '', 'today'), /GraphQL/);
  assert.throws(() => validatePage(page([1], 2, 'same'), SCHOOLS.uga, 'same', 'today'), /did not advance/);
  assert.throws(() => validatePage(page([], 2, 'next'), SCHOOLS.uga, '', 'today'), /did not advance/);
  const fallback = page([1], 1);
  fallback.data.search.teachers.didFallback = true;
  assert.throws(() => validatePage(fallback, SCHOOLS.uga, '', 'today'), /fallback/);
});

test('stops on access denial and honors Retry-After without adding credentials', async () => {
  let calls = 0;
  const denied = makeClient({ wait: async () => {}, fetchImpl: async () => {
    calls += 1; return new Response('Forbidden', { status: 403 });
  } });
  await assert.rejects(denied(SCHOOLS.uga, ''), /access restricted/);
  assert.equal(calls, 1);
  let clock = 0;
  const starts = [];
  const limited = makeClient({ now: () => clock, wait: async (ms) => { clock += ms; }, fetchImpl: async (_url, options) => {
    starts.push(clock);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    if (starts.length === 1) return new Response('', { status: 429, headers: { 'retry-after': '12' } });
    return Response.json(page([1], 1));
  } });
  await limited(SCHOOLS.uga, '');
  await limited(SCHOOLS.uga, 'next');
  assert.deepEqual(starts, [0, 12000, 13800]);
});

test('resume uses the saved cursor; distinct IDs are counted once', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'orion-rmp-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const options = { outputDir, log: () => {} };
  await assert.rejects(collectSchool('uga', { ...options, request: async (_school, cursor) => {
    if (cursor === '') return page([1, 2], 3, 'second');
    throw new Error('Connection interrupted');
  } }), /partial collection/);
  const partial = JSON.parse(await readFile(join(outputDir, 'uga.json'), 'utf8'));
  assert.equal(partial.metadata.status, 'partial');
  assert.equal(partial.profiles.length, 2);
  const completed = await collectSchool('uga', { ...options, request: async (_school, cursor) => {
    assert.equal(cursor, 'second'); return page([2, 3], 3);
  } });
  assert.equal(completed.uniqueProfiles, 3);
  assert.equal(completed.duplicateObservations, 1);
  assert.equal(completed.status, 'complete');
  await collectSchool('uga', { ...options, request: async () => { assert.fail('Completed snapshot must not be fetched again'); } });
});

test('missing unique profiles and changing directory totals are reported as partial', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'orion-rmp-test-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  await assert.rejects(collectSchool('uga', { outputDir, log: () => {}, request: async () => page([1, 1], 2) }), /partial collection/);
  const result = JSON.parse(await readFile(join(outputDir, 'uga.summary.json'), 'utf8'));
  assert.equal(result.paginationExhausted, true);
  assert.equal(result.uniqueProfiles, 1);
  assert.equal(result.status, 'partial');
  const repaired = await collectSchool('uga', { outputDir, log: () => {}, recheck: true, request: async () => page([1, 2], 2) });
  assert.equal(repaired.status, 'complete');
  assert.equal(repaired.uniqueProfiles, 2);
  assert.equal(repaired.passes, 2);
  await assert.rejects(collectSchool('uga', { outputDir: join(outputDir, 'changed'), log: () => {}, request: async (_school, cursor) => (
    cursor === '' ? page([1], 2, 'second') : page([2, 3], 3)
  ) }), /partial collection/);
});

test('page-size bounds are enforced', () => {
  assert.throws(() => makeClient({ pageSize: 0 }), /Page size/);
  assert.throws(() => makeClient({ pageSize: 501 }), /Page size/);
  assert.throws(() => makeClient({ pageSize: Number.NaN }), /Page size/);
});

test('CSV escapes quotes, commas, newlines, and spreadsheet formulas', () => {
  const csv = toCsv([{ firstName: '=COMMAND()', lastName: 'Name, "quoted"', department: 'Line\nbreak' }]);
  assert.ok(csv.includes('"\'=COMMAND()"'));
  assert.ok(csv.includes('"Name, ""quoted"""'));
  assert.ok(csv.includes('"Line\nbreak"'));
});
