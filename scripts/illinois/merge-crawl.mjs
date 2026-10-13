/**
 * Carry what a newer crawler reads into the shipped crawl, and nothing the
 * catalog itself changed since.
 *
 *   node scripts/illinois/merge-crawl.mjs <fresh crawl.json> [--write]
 *
 * programs.mjs has learned to read three things the shipped crawl lacks:
 *
 *   - each comment row of a requirement table, with its hours cell and
 *     position (`comments: [{text, hours, hoursText, at}]`), which the
 *     adapter needs to tell "Calculus Option - Select one of the following:"
 *     and its three rows apart from the required rows above them;
 *   - course codes printed as plain text, not links (`unlinked`), which it
 *     used to drop: ACES 101 and ETMA 339 in the ETMA tables;
 *   - the courses a code cell joins to its first with "&" (`and`):
 *     "CMN 111 & CMN 112", which it read as CMN 111 alone.
 *
 * A re-crawl also picks up whatever the catalog changed since the shipped
 * crawl, and mixing the two would make every changed plan impossible to
 * attribute. So a group takes the fresh crawl's rows only where the fresh
 * group, read the way the old crawler read it (asOldCrawler), is the shipped
 * group: the same label, the same course rows in the same order with the same
 * alternatives, and the same note. Every group that differs is listed, and
 * keeps its shipped form.
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
  console.error('usage: node scripts/illinois/merge-crawl.mjs <fresh crawl.json> [--write]');
  process.exit(2);
}
const WRITE = process.argv.includes('--write');
const SHIPPED = 'public/illinois-programs.json';

const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'));
const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
const freshById = new Map(fresh.programs.map((p) => [p.id, p]));

/** A group's identity apart from its comments, pairs and plain-text codes. */
const shape = (g) =>
  JSON.stringify([g.label ?? '', g.note ?? '', g.hours ?? null, g.choose ?? null, (g.courses ?? []).map((c) => [c.code, c.credits ?? null, c.or ?? []])]);

/**
 * The rows as the crawler before `unlinked` read them: a row whose own code is
 * plain text was dropped, so an "or" row after it went to the row above, and
 * a plain-text alternative was dropped.
 */
function asOldCrawler(group) {
  const courses = [];
  for (const row of group.courses ?? []) {
    const plain = new Set(row.unlinked ?? []);
    const or = (row.or ?? []).filter((code) => !plain.has(code));
    if (plain.has(row.code)) {
      const prev = courses[courses.length - 1];
      if (prev && or.length) prev.or = [...(prev.or ?? []), ...or];
      continue;
    }
    courses.push({ ...row, or: or.length ? or : undefined });
  }
  return { ...group, courses };
}

const programCodes = (program) => new Set(program.areas.flatMap((a) => (a.groups ?? []).flatMap((g) => (g.courses ?? []).map((c) => c.code))));

const tally = { groups: 0, comments: 0, unlinked: 0, pairs: 0, kinds: [] };
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
      if (!nextGroup || (nextArea.label ?? null) !== (area.label ?? null) || shape(asOldCrawler(nextGroup)) !== shape(asOldCrawler(group))) {
        differ.push(`${program.id} area ${ai} "${area.label ?? ''}" group ${gi} "${(group.label ?? '').slice(0, 50)}"`);
        return;
      }
      const added = (nextGroup.courses ?? []).flatMap((c) => c.unlinked ?? []);
      const pairs = (nextGroup.courses ?? []).flatMap((c) => Object.keys(c.and ?? {}));
      if (!nextGroup.comments?.length && !added.length && !pairs.length) return;
      if (nextGroup.kind !== group.kind) tally.kinds.push(`${program.id} "${(group.label ?? '').slice(0, 40)}" ${group.kind} -> ${nextGroup.kind} (plain text ${added.join(', ') || 'none'})`);
      // The fresh group whole: its comments' positions count the rows it now has.
      for (const key of ['courses', 'comments', 'summedCredits', 'kind']) {
        if (nextGroup[key] === undefined) delete group[key];
        else group[key] = nextGroup[key];
      }
      tally.groups += 1;
      tally.comments += nextGroup.comments?.length ?? 0;
      tally.unlinked += added.length;
      tally.pairs += pairs.length;
    });
  });
  program.courseCount = programCodes(program).size;
}
const extra = fresh.programs.filter((p) => !shipped.programs.some((s) => s.id === p.id)).map((p) => p.id);

console.log(`${shipped.programs.length} shipped programs; ${tally.groups} groups take the fresh rows: ${tally.comments} comment rows, ${tally.unlinked} plain-text codes, ${tally.pairs} "&" pairs`);
if (tally.kinds.length) {
  console.log(`${tally.kinds.length} groups change kind with their new rows:`);
  for (const k of tally.kinds) console.log(`  ${k}`);
}
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
