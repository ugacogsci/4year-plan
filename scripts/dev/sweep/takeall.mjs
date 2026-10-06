/**
 * The take-all check: requirement blocks that ask for every course of a list
 * holding two courses the catalog will not credit together.
 *
 *   node takeall.mjs <blocks.jsonl> [planner checkout] [--json]
 *
 * <blocks.jsonl> is a reading (blocks.mjs, or the <out>.blocks.jsonl beside a
 * sweep); the exclusions come from the checkout's
 * public/illinois/exclusions.json (default: the checkout this file is in).
 *
 * Why: a take-all block that holds MATH 220 and MATH 221, or CMN 101 and CMN
 * 111, cannot be met by any student. It is the mark of an option list
 * ("Calculus Option - Select one of the following") read as "take every
 * course", and it finds the misread on pages the audit never looked at: at
 * illinois-2 715d894, 64 such blocks, 11 of them in 9 unaudited degrees
 * (Agronomy, Crop Sciences x4, CS + Animal Sciences, CS + Crop Sciences,
 * Chemistry BSLAS, Mathematics BSLAS). Each pair is counted once, from each
 * choice's first code, as fix-research/misreads/tables/
 * takeall-with-exclusion-pairs.json counted them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

/** Every take-all block holding a pair the exclusions say do not both count. */
export function takeAllExclusionPairs(blocks, exclusions) {
  const excluded = new Set();
  for (const [a, list] of Object.entries(exclusions)) for (const b of list) excluded.add(`${a}|${b}`);
  const out = [];
  for (const b of blocks) {
    if (b.kind !== 'all') continue;
    const codes = (b.rule?.choices ?? []).map((c) => c.codes[0]).filter(Boolean);
    const pairs = [];
    for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) if (excluded.has(`${codes[i]}|${codes[j]}`) || excluded.has(`${codes[j]}|${codes[i]}`)) pairs.push([codes[i], codes[j]]);
    if (pairs.length) out.push({ degree: b.id, req: b.req, label: b.label, choices: codes.length, credits: b.credits, pairs });
  }
  return out;
}

export const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!args[0]) {
    console.error('usage: node takeall.mjs <blocks.jsonl> [planner checkout] [--json]');
    process.exit(2);
  }
  const checkout = resolve(args[1] ?? fileURLToPath(new URL('../../..', import.meta.url)));
  const found = takeAllExclusionPairs(readJsonl(resolve(args[0])), JSON.parse(readFileSync(join(checkout, 'public/illinois/exclusions.json'), 'utf8')));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(found, null, 1));
  } else {
    for (const f of found) console.log(`  ${f.req} "${f.label}": ${f.pairs.map((p) => p.join(' / ')).join(', ')}`);
    console.log(`take-all blocks holding two courses that do not both count: ${found.length} in ${new Set(found.map((f) => f.degree)).size} degrees`);
  }
}
