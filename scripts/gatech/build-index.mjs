/**
 * Build Georgia Tech's browser artifacts, public/gatech/*, with the same
 * build step Illinois uses (scripts/illinois/build-index.mjs --school gatech).
 *
 * Run it from the repo root:
 *   PATH="/opt/homebrew/opt/node@23/bin:$PATH" \
 *     node --experimental-strip-types scripts/gatech/build-index.mjs
 *
 * Reads (all in public/, written by the scripts in this folder):
 *   gatech-catalog.json    courses.mjs: every course, credits, prerequisite prose from Banner
 *   gatech-programs.json   programs.mjs: every bachelor's degree, thread and option page
 *   gatech-offerings.json  offerings.mjs: which of the last nine terms each course ran in
 *   gatech-sections.json   optional, not built yet: class times for one term
 *
 * Writes public/gatech/: meta.json, index.json, prereqs.json, programs.json,
 * exclusions.json, offerings.json, grades.json (empty), course/<SUBJECT>.json
 * and program/<college>/<id>.json. public/gatech/minors/ is left alone.
 *
 * What it cannot know. Georgia Tech publishes no grade distributions, so no
 * course has grade history or a difficulty; meta.json says so. Until
 * gatech-sections.json exists there are no class times, rooms or parts of
 * term either, and meta.json says that too.
 *
 * With no public/gatech-catalog.json (a checkout without the Georgia Tech
 * crawl) it prints a note and exits 0, so `npm run build` still succeeds.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
if (!existsSync(join(PUBLIC, 'gatech-catalog.json')) || !existsSync(join(PUBLIC, 'gatech-programs.json'))) {
  console.log('No Georgia Tech data (public/gatech-catalog.json or gatech-programs.json is missing), so public/gatech was not built.');
  process.exit(0);
}

process.argv.push('--school', 'gatech');
await import('../illinois/build-index.mjs');
