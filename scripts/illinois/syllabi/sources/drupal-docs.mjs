/**
 * The Drupal media archives of three departments, one walk each:
 *
 *   https://{host}/document/{id}  302 -> /sites/default/files/{YYYY-MM}/{file}
 *
 * The departments' own pages that linked these files are gone or behind a
 * login now, but the files are public and the ids are a finite range. The
 * walk reads each Location header without following it (one request per id),
 * keeps the files whose names carry a course number in the department's
 * subjects, and downloads only those. A 307, or a Location into a login,
 * means the file is protected and is recorded as such, never fetched.
 *
 *   chem-docs  chemistry.illinois.edu  ids 1-4,700  general chemistry syllabi and course policies (CHEM 101-105, 202, 204)
 *   econ-docs  economics.illinois.edu  ids 1-1,400  term syllabi named course, title, instructor and term
 *   math-docs  math.illinois.edu       ids 1-1,550  term section syllabi, 2020-2022 and 2026
 */
import { normalizeCode } from '../lib/catalog.mjs';
import { termMentions } from '../lib/terms.mjs';

/** "CHEM102_Syllabus_FA24.pdf", "Econ 302 - Smith - Spring 2024.pdf", "math-241-syllabus.pdf" -> catalog codes. */
function codesIn(file, subjects) {
  const re = new RegExp(`(?<![A-Za-z])(${subjects.join('|')})[\\s_.-]*(\\d{3})(?!\\d)`, 'gi');
  return [...new Set([...file.matchAll(re)].map((m) => normalizeCode(`${m[1]} ${m[2]}`)).filter(Boolean))];
}

function drupalDocs({ id, host, max, subjects, keep = () => true }) {
  return {
    id,
    async run({ get, log }) {
      const rows = [];
      let redirects = 0;
      for (let n = 1; n <= max; n += 1) {
        const url = `https://${host}/document/${n}`;
        const r = await get(url, { source: id, follow: false });
        if (n % 250 === 0) log(`${id}: ${n}/${max} ids, ${redirects} files, ${rows.length} course documents`);
        if (r.outcome === 'login') continue;
        if (r.outcome !== 'redirect') continue;
        redirects += 1;
        const location = r.location ?? r.finalUrl;
        const file = decodeURIComponent(location.split('/').pop() ?? '');
        const codes = codesIn(file, subjects);
        if (codes.length === 0 || !keep(file)) continue;
        const g = await get(location, { source: id });
        rows.push({
          source: id, url: location, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
          contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: codes,
          hintTerm: termMentions(file)[0]?.term ?? null, hintSection: null, kindHint: 'syllabus', foundVia: url, fetchedAt: g.fetchedAt ?? null,
        });
      }
      log(`${id}: done, ${redirects} files behind ${max} ids, ${rows.length} course documents`);
      return { rows, complete: true, note: `ids 1-${max}` };
    },
  };
}

export const chemDocs = drupalDocs({
  id: 'chem-docs', host: 'chemistry.illinois.edu', max: 4700, subjects: ['CHEM'],
  // The archive also holds exam keys, worksheets and slides; the research kept policy, syllabus and course-information files.
  keep: (f) => /syllab|polic|course[\s_-]*info|information/i.test(f),
});
export const econDocs = drupalDocs({ id: 'econ-docs', host: 'economics.illinois.edu', max: 1400, subjects: ['ECON'] });
export const mathDocs = drupalDocs({
  id: 'math-docs', host: 'math.illinois.edu', max: 1550, subjects: ['MATH', 'ASRM', 'STAT'],
  keep: (f) => !/\b(exam|quiz|worksheet|solution|key|homework|hw\d)\b/i.test(f),
});
