/**
 * Collect public profile summaries from the same anonymous directory query
 * used by Rate My Professors. No login, cookies, tokens, or review text.
 *
 * node scripts/ratemyprofessors/collect.mjs [--school uga|illinois] [--output DIR]
 *   [--recheck] [--page-size 500]
 * Re-running resumes saved cursors. Use a new output directory for a new snapshot.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENDPOINT = 'https://www.ratemyprofessors.com/graphql';
const PAGE_SIZE = 50;
const INTERVAL_MS = 1800;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const SCHOOLS = {
  uga: { id: 1101, name: 'University of Georgia' },
  illinois: { id: 1112, name: 'University of Illinois at Urbana-Champaign' },
};
const schoolNodeId = (school) => Buffer.from(`School-${school.id}`).toString('base64');
const QUERY = `query TeacherSearchPaginationQuery($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      didFallback resultCount
      pageInfo { hasNextPage endCursor }
      edges { cursor node {
        id legacyId firstName lastName department
        avgRating numRatings avgDifficulty wouldTakeAgainPercent
        school { id name }
      } }
    }
  }
}`;

export function normalizeProfile(node, school, collectedAt) {
  if (node?.school?.id !== schoolNodeId(school)) throw new Error('Directory returned a different school.');
  if (!Number.isInteger(node.legacyId) || node.legacyId <= 0 || !Number.isInteger(node.numRatings) || node.numRatings < 0) {
    throw new Error('Invalid profile ID or review count.');
  }
  for (const field of ['firstName', 'lastName', 'department']) {
    if (typeof node[field] !== 'string') throw new Error(`Invalid profile ${field}.`);
  }
  const rated = node.numRatings > 0;
  const score = (value, min, max) => rated && Number.isFinite(value) && value >= min && value <= max ? value : null;
  return {
    id: node.legacyId,
    firstName: node.firstName.trim(),
    lastName: node.lastName.trim(),
    department: node.department.trim(),
    schoolId: school.id,
    schoolName: node.school.name,
    averageRating: score(node.avgRating, 1, 5),
    averageDifficulty: score(node.avgDifficulty, 1, 5),
    ratingCount: node.numRatings,
    wouldTakeAgainPercent: score(node.wouldTakeAgainPercent, 0, 100),
    profileUrl: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
    collectedAt,
  };
}

export function validatePage(payload, school, cursor, collectedAt) {
  if (payload?.errors?.length) throw new Error('Directory returned GraphQL errors; collection stopped.');
  const page = payload?.data?.search?.teachers;
  if (!page || page.didFallback !== false || !Number.isInteger(page.resultCount) || page.resultCount < 0 ||
      !Array.isArray(page.edges) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
    throw new Error('Unexpected directory response or fallback results.');
  }
  const { hasNextPage, endCursor } = page.pageInfo;
  if (hasNextPage && (!page.edges.length || typeof endCursor !== 'string' || !endCursor || endCursor === cursor)) {
    throw new Error('Directory pagination did not advance.');
  }
  return {
    resultCount: page.resultCount,
    hasNextPage,
    nextCursor: hasNextPage ? endCursor : null,
    profiles: page.edges.map(({ node }) => normalizeProfile(node, school, collectedAt)),
  };
}

export function makeClient({ fetchImpl = fetch, wait = sleep, now = Date.now, pageSize = PAGE_SIZE } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('Page size must be an integer between 1 and 500.');
  let nextRequestAt = 0;
  return async (school, cursor) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wait(Math.max(0, nextRequestAt - now()));
      nextRequestAt = now() + INTERVAL_MS;
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ORION public-data research (orioncogsci@gmail.com)',
        },
        body: JSON.stringify({
          operationName: 'TeacherSearchPaginationQuery', query: QUERY,
          variables: { count: pageSize, cursor: cursor ?? '', query: {
            departmentID: '', fallback: false, schoolID: schoolNodeId(school), text: '',
          } },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}: access restricted; collection stopped without retrying.`);
      }
      if (response.status === 429 || response.status >= 500) {
        const retryHeader = response.headers.get('retry-after');
        const retryMs = retryHeader === null ? 0 : /^\d+(\.\d+)?$/.test(retryHeader)
          ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - now();
        await response.body?.cancel();
        if (attempt === 3 || retryMs > 60_000) {
          throw new Error(`HTTP ${response.status}: retry later${retryHeader ? ` (Retry-After: ${retryHeader})` : ''}. Checkpoint saved.`);
        }
        nextRequestAt = now() + Math.max(5000 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0);
        continue;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}: unexpected response; collection stopped.`);
      }
      return response.json();
    }
    throw new Error('Directory request exhausted retries.');
  };
}

async function atomicWrite(path, content) {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
}

export function toCsv(profiles) {
  const fields = ['id', 'firstName', 'lastName', 'department', 'schoolId', 'schoolName', 'averageRating',
    'averageDifficulty', 'ratingCount', 'wouldTakeAgainPercent', 'profileUrl', 'collectedAt'];
  const cell = (value) => {
    let text = value == null ? '' : String(value);
    // Public names/departments are untrusted; don't execute spreadsheet formulas.
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [fields.join(','), ...profiles.map((row) => fields.map((field) => cell(row[field])).join(','))].join('\n') + '\n';
}

export async function collectSchool(key, { outputDir, request, log = console.log, recheck = false }) {
  const school = SCHOOLS[key];
  if (!school) throw new Error(`Unknown school: ${key}`);
  await mkdir(outputDir, { recursive: true });
  const checkpointPath = join(outputDir, `${key}.checkpoint.json`);
  let state;
  try { state = JSON.parse(await readFile(checkpointPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  state ??= {
    version: 1, schoolId: school.id, startedAt: new Date().toISOString(), updatedAt: null,
    pages: 0, cursor: '', exhausted: false, expectedCounts: [], seenCursors: [], duplicateProfiles: 0, profiles: [],
  };
  if (state.version !== 1 || state.schoolId !== school.id || !Array.isArray(state.profiles) || !Array.isArray(state.seenCursors)) {
    throw new Error('Checkpoint does not match this collector and school.');
  }
  state.passes ??= 1;
  if (recheck && state.pages > 0) {
    state.passes += 1;
    state.cursor = '';
    state.exhausted = false;
    state.seenCursors = [];
  }
  const profiles = new Map(state.profiles.map((profile) => [profile.id, profile]));
  const seenCursors = new Set(state.seenCursors);
  let collectionError = null;
  const save = async () => {
    state.profiles = [...profiles.values()];
    state.seenCursors = [...seenCursors];
    state.updatedAt = new Date().toISOString();
    await atomicWrite(checkpointPath, JSON.stringify(state));
  };
  try {
    while (!state.exhausted) {
      const page = validatePage(await request(school, state.cursor), school, state.cursor, new Date().toISOString());
      if (page.hasNextPage && seenCursors.has(page.nextCursor)) throw new Error('Directory repeated a prior cursor.');
      if (!state.expectedCounts.includes(page.resultCount)) state.expectedCounts.push(page.resultCount);
      for (const profile of page.profiles) {
        if (profiles.has(profile.id)) state.duplicateProfiles += 1;
        profiles.set(profile.id, profile);
      }
      if (page.nextCursor) seenCursors.add(page.nextCursor);
      state.pages += 1;
      state.cursor = page.nextCursor;
      state.exhausted = !page.hasNextPage;
      await save();
      if (state.pages % 10 === 0 || state.exhausted) log(`${key}: ${profiles.size}/${page.resultCount} unique profiles (${state.pages} pages)`);
    }
  } catch (error) {
    collectionError = error.message;
    await save();
  }
  const sorted = [...profiles.values()].sort((a, b) => a.id - b.id);
  const expectedCount = state.expectedCounts.at(-1) ?? null;
  const complete = state.exhausted && profiles.size === expectedCount && state.expectedCounts.length === 1;
  const metadata = {
    source: 'Rate My Professors', directoryUrl: `https://www.ratemyprofessors.com/search/professors/${school.id}`,
    school: school.name, schoolId: school.id, startedAt: state.startedAt, updatedAt: state.updatedAt,
    status: complete ? 'complete' : 'partial', expectedCount, observedCounts: state.expectedCounts,
    uniqueProfiles: profiles.size, ratedProfiles: sorted.filter((p) => p.ratingCount > 0).length,
    unratedProfiles: sorted.filter((p) => p.ratingCount === 0).length,
    pages: state.pages, passes: state.passes, duplicateObservations: state.duplicateProfiles, paginationExhausted: state.exhausted,
    error: collectionError,
    scope: 'All public directory profiles at collection time, including historical, duplicate-person, and unrated entries; not a current faculty roster. No review text collected. Unknown ratings are null.',
    caveat: 'Self-selected student ratings; profiles have not been matched to ORION instructor records or incorporated into recommendations.',
  };
  await atomicWrite(join(outputDir, `${key}.json`), JSON.stringify({ metadata, profiles: sorted }, null, 2) + '\n');
  await atomicWrite(join(outputDir, `${key}.csv`), toCsv(sorted));
  await atomicWrite(join(outputDir, `${key}.summary.json`), JSON.stringify(metadata, null, 2) + '\n');
  if (!complete) throw new Error(`${key}: partial collection (${profiles.size}/${expectedCount ?? 'unknown'}). ${collectionError ?? 'Directory count changed or pagination did not cover every unique profile.'}`);
  return metadata;
}

async function main() {
  const { values } = parseArgs({ options: {
    school: { type: 'string' }, output: { type: 'string' },
    recheck: { type: 'boolean', default: false }, 'page-size': { type: 'string' },
  } });
  const keys = values.school ? [values.school] : Object.keys(SCHOOLS);
  if (keys.some((key) => !SCHOOLS[key])) throw new Error('--school must be uga or illinois.');
  const outputDir = resolve(values.output ?? join(ROOT, 'data/ratemyprofessors'));
  const request = makeClient({ pageSize: values['page-size'] === undefined ? PAGE_SIZE : Number(values['page-size']) });
  const results = [];
  for (const key of keys) {
    // Stop the entire run on denied access, rate limiting, or an incomplete
    // school instead of trying to work around it with another request stream.
    results.push(await collectSchool(key, { outputDir, request, recheck: values.recheck }));
  }
  console.log(JSON.stringify({ outputDir, schools: results.map(({ school, status, uniqueProfiles, ratedProfiles }) => ({ school, status, uniqueProfiles, ratedProfiles })) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
