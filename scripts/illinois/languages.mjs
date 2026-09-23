/**
 * The registrar's table of courses approved for the language requirement:
 * for each language, the course (or courses) that count as its first, second,
 * third and fourth semester. This is what turns "completion of the third
 * semester of a language other than English" from a sentence the planner
 * could only quote into three courses it can place.
 *
 * Source: https://registrar.illinois.edu/courses-approved-for-language-requirements/
 * Output: public/illinois-languages.json
 *
 * Cells read "SPAN 122 or SPAN 101" (alternatives), "FR 203 (previously 103)"
 * (an old number, dropped), "SHS 222 + 321*" (two courses together, kept as a
 * pair) and "LAST 445**" (a tutorial whose level the instructor sets, kept
 * with its note).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'https://registrar.illinois.edu/courses-approved-for-language-requirements/';
const UA = 'TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)';

const res = await fetch(URL, { headers: { 'user-agent': UA } });
if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
let html = await res.text();
html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
  [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
    c[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
  ),
);
const table = rows.filter((r) => r.length === 5 && !/^language$/i.test(r[0]));
if (table.length < 20) { console.error(`only ${table.length} rows parsed; the page layout changed`); process.exit(1); }

/** "SPAN 201 (previously 130)" -> { "SPAN 201": "SPAN 130" }: the old number, so offering history under it still counts. */
function renumbered(cell) {
  const out = {};
  const re = /([A-Z]{2,4})\s+(\d{3})\s*\(previously\s+(\d{3})\)/g;
  let m;
  while ((m = re.exec(cell)) !== null) out[`${m[1]} ${m[2]}`] = `${m[1]} ${m[3]}`;
  return out;
}

/** "SPAN 122 or SPAN 101" -> [["SPAN 122"], ["SPAN 101"]]; "SHS 222 + 321*" -> [["SHS 222", "SHS 321"]]. */
function options(cell) {
  const cleaned = cell.replace(/\([^)]*\)/g, ' ').replace(/\*+/g, ' ');
  return cleaned
    .split(/\s+or\s+/i)
    .map((alt) => {
      const codes = [];
      let subject = null;
      for (const part of alt.split(/\s*\+\s*/)) {
        const m = part.trim().match(/^([A-Z]{2,4})\s+(\d{3})$|^(\d{3})$/);
        if (!m) continue;
        if (m[1]) subject = m[1];
        const code = m[1] ? `${m[1]} ${m[2]}` : subject ? `${subject} ${m[3]}` : null;
        if (code) codes.push(code);
      }
      return codes;
    })
    .filter((codes) => codes.length > 0);
}

const languages = table.map(([name, l1, l2, l3, l4]) => ({
  name: name.replace(/\s+/g, ' ').trim(),
  levels: [options(l1), options(l2), options(l3), options(l4)],
  renumbered: Object.assign({}, renumbered(l1), renumbered(l2), renumbered(l3), renumbered(l4)),
  note: /\*/.test(`${l1}${l2}${l3}${l4}`) ? 'See the registrar\'s footnote for this row.' : null,
}));
const footnotes = [...html.matchAll(/<p[^>]*>\s*(\*+[\s\S]*?)<\/p>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

mkdirSync('public', { recursive: true });
writeFileSync('public/illinois-languages.json', JSON.stringify({ school: 'illinois', source: URL, fetchedAt: new Date().toISOString(), languages, footnotes }, null, 1));
console.log(`${languages.length} languages`);
for (const l of languages) console.log(`  ${l.name.padEnd(56)} ${l.levels.map((lv) => lv.map((o) => o.join('+')).join('|')).join('  >  ')}`);
