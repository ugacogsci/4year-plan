/**
 * Carry the comment rows of a fresh program crawl into the shipped one, and
 * nothing else.
 *
 *   node scripts/illinois/merge-comments.mjs <fresh crawl.json> [--write]
 *
 * programs.mjs now keeps each comment row of a requirement table with its
 * hours cell and position (`comments: [{text, hours, hoursText, at}]`), which
 * the adapter needs to tell "Calculus Option - Select one of the following:"
 * and its three rows apart from the required rows above them. A re-crawl also
 * picks up whatever the catalog changed since the shipped crawl, and mixing
 * the two would make every changed plan impossible to attribute. So a group
 * takes its comments only where it is the same group in both crawls: the same
 * label, the same course rows in the same order with the same alternatives,
 * and the same note. Every group that differs is listed, and keeps its
 * shipped form.
 *
 * With --write, public/illinois-programs.json and the per-program files under
 * public/illinois/program/ are rewritten in the build's own format
 * (build-index.mjs writes each program as compact JSON). Without it, only the
 * report is printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [freshPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!freshPath) {
  console.error('usage: node scripts/illinois/merge-comments.mjs <fresh crawl.json> [--write]');
  process.exit(2);
}
const WRITE = process.argv.includes('--write');
const SHIPPED = 'public/illinois-programs.json';

const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'));
const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
const freshById = new Map(fresh.programs.map((p) => [p.id, p]));

/** A group's identity apart from its comments. */
const shape = (g) =>
  JSON.stringify([g.label ?? '', g.note ?? '', g.hours ?? null, g.choose ?? null, (g.courses ?? []).map((c) => [c.code, c.credits ?? null, c.or ?? []])]);

let carried = 0;
let groupsWithComments = 0;
const differ = [];
const missing = [];
for (const program of shipped.programs) {
  const next = freshById.get(program.id);
  if (!next) {
    missing.push(program.id);
    continue;
  }
  program.areas.forEach((area, ai) => {
    const nextArea = next.areas[ai];
    (area.groups ?? []).forEach((group, gi) => {
      const nextGroup = nextArea?.groups?.[gi];
      if (!nextGroup || (nextArea.label ?? null) !== (area.label ?? null) || shape(nextGroup) !== shape(group)) {
        differ.push(`${program.id} area ${ai} "${area.label ?? ''}" group ${gi} "${(group.label ?? '').slice(0, 50)}"`);
        return;
      }
      if (nextGroup.comments?.length) {
        group.comments = nextGroup.comments;
        groupsWithComments += 1;
        carried += nextGroup.comments.length;
      }
    });
  });
}
const extra = fresh.programs.filter((p) => !shipped.programs.some((s) => s.id === p.id)).map((p) => p.id);

console.log(`${shipped.programs.length} shipped programs; ${carried} comment rows carried into ${groupsWithComments} groups`);
console.log(`${differ.length} groups differ from the fresh crawl and keep their shipped form`);
for (const d of differ.slice(0, 60)) console.log(`  ${d}`);
if (differ.length > 60) console.log(`  ... ${differ.length - 60} more`);
if (missing.length) console.log(`${missing.length} shipped programs missing from the fresh crawl: ${missing.join(', ')}`);
if (extra.length) console.log(`${extra.length} programs in the fresh crawl only (not added): ${extra.join(', ')}`);

if (WRITE) {
  writeFileSync(SHIPPED, JSON.stringify(shipped));
  // The build's own filter (build-index.mjs SAFE_ID): a program it skipped has no file.
  const SAFE_ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/;
  for (const program of shipped.programs) {
    if (!SAFE_ID.test(program.id)) continue;
    const file = join('public/illinois/program', `${program.id}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(program));
  }
  console.log(`wrote ${SHIPPED} and ${shipped.programs.length} program files`);
}
