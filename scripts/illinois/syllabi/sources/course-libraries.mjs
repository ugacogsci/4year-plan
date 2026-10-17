/**
 * Department syllabus libraries: one or a few index pages that link one file
 * or page per course.
 *
 *   app-sib      School of Integrative Biology, https://app.sib.illinois.edu/courses/all
 *                -> /course/syllabi/IB%20{NUM}[%20ONL|%20A ...].pdf (IB plus cross-lists)
 *   app-mcb      School of MCB, /courses/{100,200,300,400,advanced,labs,...} on app.mcb.illinois.edu
 *                -> /courses/syllabi/{SUBJ}_{NUM}[_{X}]_syllabus.pdf (MCB, BIOC, BIOP, NEUR)
 *   math-topics  Mathematics' master syllabi, https://math.illinois.edu/resources/course-topics-instructors
 *                -> /resources/department-resources/syllabus-{math|asrm}-{NUM} and a few PDFs
 *
 * Each run reads the index pages again (an index changes every term, so a
 * copy older than a week is revalidated) and unions what they link with the
 * research pass's list (data/syllabi/ids/), so a file the index stopped
 * linking is still kept. A file is fetched once and then answered from the
 * cache; a new link is the only new request.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCode } from '../lib/catalog.mjs';
import { DIRS } from '../lib/paths.mjs';
import { decodeEntities } from '../lib/text.mjs';
import { termMentions } from '../lib/terms.mjs';

const readJson = (name) => (existsSync(join(DIRS.ids, name)) ? JSON.parse(readFileSync(join(DIRS.ids, name), 'utf8')) : null);

/** Every href on a page matching re, absolute against base, with its label. */
function links(html, base, re) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1]).replace(/ /g, '%20'), base); } catch { continue; }
    u.hash = '';
    if (re.test(decodeURIComponent(u.pathname))) out.push({ url: u.href, label: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/**
 * lib: { id, indexes: [url], pattern: RegExp on the decoded path, seeds: () => [{url, code?}],
 *        codeOf: (decodedPath, label) => { code, section } | null }
 */
function library({ id, indexes, pattern, seeds, codeOf, note }) {
  return {
    id,
    async run({ get, log }) {
      const found = new Map(); // url -> { code, section, via }
      for (const index of indexes) {
        const g = await get(index, { source: id, maxAgeDays: 7 });
        if (g.outcome !== 'ok' || !g.bodyPath) { log(`${id}: index ${index} ${g.outcome}`); continue; }
        for (const l of links(readFileSync(g.bodyPath, 'utf8'), g.finalUrl ?? index, pattern)) {
          const k = codeOf(decodeURIComponent(new URL(l.url).pathname), l.label);
          if (k?.code && !found.has(l.url)) found.set(l.url, { ...k, via: index });
        }
      }
      const live = found.size;
      for (const s of seeds()) {
        const u = new URL(s.url).href;
        if (found.has(u)) continue;
        const k = s.code ? { code: normalizeCode(s.code), section: null } : codeOf(decodeURIComponent(new URL(u).pathname), '');
        if (k?.code) found.set(u, { ...k, via: 'research list' });
      }
      const rows = [];
      for (const [url, k] of found) {
        const g = await get(url, { source: id });
        rows.push({
          source: id, url, finalUrl: g.finalUrl, sha: g.sha, status: g.status, outcome: g.outcome,
          contentType: g.contentType ?? null, disposition: g.disposition ?? null, hintCodes: [k.code],
          hintTerm: termMentions(decodeURIComponent(url))[0]?.term ?? null, hintSection: k.section ?? null,
          kindHint: 'syllabus', foundVia: k.via, fetchedAt: g.fetchedAt ?? null,
        });
      }
      log(`${id}: ${live} links on ${indexes.length} index pages, ${found.size} with the research list, ${rows.filter((r) => r.outcome === 'ok').length} read`);
      return { rows, complete: true, note };
    },
  };
}

export const appSib = library({
  id: 'app-sib',
  indexes: ['https://app.sib.illinois.edu/courses/all'],
  pattern: /\/course\/syllabi\/.+\.pdf$/i,
  seeds: () => (readJson('app-sib_pdfs.json') ?? []).map((p) => ({ url: `https://app.sib.illinois.edu${encodeURI(p)}` })),
  // "IB 150 ONL.pdf", "IB 299 A.pdf"
  codeOf: (path) => {
    const m = path.split('/').pop().match(/^([A-Z]{2,5})\s*(\d{3})\s*([A-Z0-9]+)?\.pdf$/i);
    return m ? { code: normalizeCode(`${m[1]} ${m[2]}`), section: m[3] ?? null } : null;
  },
  note: 'courses/all index plus the research list',
});

const MCB_INDEXES = ['100', '200', '300', '400', 'advanced', 'labs', 'biochem_advanced', 'neurosci_advanced', 'group_ab_mcbds', 'graduate', 'MCB_297_syllabi', 'MCB_298_syllabi', 'MCB_493_syllabi']
  .map((p) => `https://app.mcb.illinois.edu/courses/${p}`);
export const appMcb = library({
  id: 'app-mcb',
  indexes: MCB_INDEXES,
  pattern: /\/courses\/syllabi\/.+\.pdf$/i,
  seeds: () => [
    ...(readJson('app-mcb_links.json') ?? []).map((p) => ({ url: `https://app.mcb.illinois.edu${encodeURI(p)}` })),
    // Linked from no index; the research found it by the file pattern.
    { url: 'https://app.mcb.illinois.edu/courses/syllabi/MCB_316_syllabus.pdf' },
  ],
  // "MCB_150_syllabus.pdf", "MCB_493/MCB_493_B_syllabus.pdf"
  codeOf: (path) => {
    const m = path.split('/').pop().match(/^([A-Z]{2,5})_(\d{3})(?:_([A-Z0-9]+))?_syllabus\.pdf$/i);
    return m ? { code: normalizeCode(`${m[1]} ${m[2]}`), section: m[3] ?? null } : null;
  },
  note: `${MCB_INDEXES.length} index pages plus the research list`,
});

export const mathTopics = library({
  id: 'math-topics',
  indexes: ['https://math.illinois.edu/resources/course-topics-instructors'],
  pattern: /\/resources\/department-resources\/syllabus-(math|asrm)-\d{3}|\/system\/files\/inline-files\/.*syllabus.*\.pdf$/i,
  seeds: () => Object.entries(readJson('math-topics_index.json') ?? {}).map(([code, url]) => ({ code, url })),
  // The label names the course ("MATH 241 - Calculus III"); the address does too, except for the PDFs.
  codeOf: (path, label) => {
    const fromLabel = String(label).match(/\b(MATH|ASRM)\s*(\d{3})\b/i);
    const fromPath = path.match(/(math|asrm)-(\d{3})/i) ?? path.match(/()(\d{3})-syllabus/i);
    const m = fromLabel ?? fromPath;
    if (!m) return null;
    return { code: normalizeCode(`${m[1] || 'MATH'} ${m[2]}`), section: null };
  },
  note: 'course-topics-instructors index plus the research list',
});
