/**
 * UGA's own transfer equivalency list, one sending school per file.
 *
 *   node scripts/data/uga-transfer.mjs            (all schools below)
 *   node scripts/data/uga-transfer.mjs 005251 …   (some schools, by key)
 *
 * Source: UGA Admissions' public Transfer Equivalency Search,
 * https://apply.uga.edu/portal/transfer-equivalency . No login, and the
 * host's robots.txt allows every agent but two named crawlers (checked again
 * on each run, and the run stops if that changes). One request at a time, at
 * least 2 seconds apart, with the planner's own user agent. A run that meets
 * anything other than the plain results table (a challenge, a login) stops
 * and says so: nothing here is ever worked around.
 *
 * What is kept is facts only: the sending course code as the list prints it
 * (no space, "BIOL2107K") and the UGA result(s) for it: a UGA course
 * ("BIOL 1107"), a designation ("MATH 1GXX" core elective, "HIST 1GHX" core +
 * U.S. history, "ARTS 3TXX" elective) or "NTFR" for the list's "Not
 * Transferrable". UGA says the list is a guide, is not complete and can
 * change; the official evaluation comes after admission. So each file keeps
 * the date it was read, and the planner shows that date. Refresh once a term
 * (a data update: gate --mode data).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'uga-transfer');
const UA = 'FourYearPlanBot/1.0 (student planning project; respects robots.txt)';
const BASE = 'https://apply.uga.edu';
const PORTAL = `${BASE}/portal/transfer-equivalency`;
const GAP_MS = 2000;

/**
 * The schools UGA students most often bring credit from: the University
 * System of Georgia, the Technical College System of Georgia, and common
 * private and out-of-state feeders. `key` is the portal's own school key.
 * `match` is the lower-case words that identify the school on a transcript.
 */
export const SCHOOLS = [
  // University System of Georgia (USG)
  { key: '005248', name: 'Georgia Institute of Technology', system: 'usg', match: ['georgia institute of technology', 'georgia tech'], not: ['technical college'] },
  { key: '005251', name: 'Georgia State University', system: 'usg', match: ['georgia state university', 'georgia state'], not: ['middle georgia', 'east georgia', 'south georgia'] },
  { key: '005359', name: 'Kennesaw State University', system: 'usg', match: ['kennesaw state'] },
  { key: '005253', name: 'Georgia Southern University', system: 'usg', match: ['georgia southern'] },
  { key: '005336', name: 'Augusta University', system: 'usg', match: ['augusta university'] },
  { key: '005855', name: 'Valdosta State University', system: 'usg', match: ['valdosta state'] },
  { key: '005900', name: 'University of West Georgia', system: 'usg', match: ['university of west georgia'] },
  { key: '005252', name: 'Georgia College & State University', system: 'usg', match: ['georgia college & state', 'georgia college and state', 'georgia college'] },
  { key: '005497', name: 'University of North Georgia', system: 'usg', match: ['university of north georgia'] },
  { key: '005123', name: 'Columbus State University', system: 'usg', match: ['columbus state'] },
  { key: '005145', name: 'Clayton State University', system: 'usg', match: ['clayton state'] },
  { key: '005250', name: 'Georgia Southwestern State University', system: 'usg', match: ['georgia southwestern'] },
  { key: '005220', name: 'Fort Valley State University', system: 'usg', match: ['fort valley state'] },
  { key: '005004', name: 'Albany State University', system: 'usg', match: ['albany state'] },
  { key: '005609', name: 'Savannah State University', system: 'usg', match: ['savannah state'] },
  { key: '005439', name: 'Middle Georgia State University', system: 'usg', match: ['middle georgia state university', 'middle georgia state'] },
  { key: '004796', name: 'Georgia Gwinnett College', system: 'usg', match: ['georgia gwinnett'] },
  { key: '005167', name: 'Dalton State College', system: 'usg', match: ['dalton state'] },
  { key: '005001', name: 'Abraham Baldwin Agricultural College', system: 'usg', match: ['abraham baldwin'] },
  { key: '005078', name: 'College of Coastal Georgia', system: 'usg', match: ['coastal georgia'] },
  { key: '005200', name: 'East Georgia State College', system: 'usg', match: ['east georgia state'] },
  { key: '005237', name: 'Georgia Highlands College', system: 'usg', match: ['georgia highlands'] },
  { key: '005256', name: 'Gordon State College', system: 'usg', match: ['gordon state'] },
  { key: '005619', name: 'South Georgia State College', system: 'usg', match: ['south georgia state'] },
  { key: '005725', name: 'Atlanta Metropolitan State College', system: 'usg', match: ['atlanta metropolitan'] },
  // Technical College System of Georgia (TCSG): UGA takes general-education courses only.
  { key: '000462', name: 'Athens Technical College', system: 'tcsg', match: ['athens technical', 'athens tech'] },
  { key: '003921', name: 'Albany Technical College', system: 'tcsg', match: ['albany technical', 'albany tech'] },
  { key: '005030', name: 'Atlanta Technical College', system: 'tcsg', match: ['atlanta technical', 'atlanta tech'] },
  { key: '002620', name: 'Augusta Technical College', system: 'tcsg', match: ['augusta technical', 'augusta tech'] },
  { key: '001709', name: 'Central Georgia Technical College', system: 'tcsg', match: ['central georgia technical', 'central georgia tech'] },
  { key: '005441', name: 'Chattahoochee Technical College', system: 'tcsg', match: ['chattahoochee technical', 'chattahoochee tech'] },
  { key: '004172', name: 'Coastal Pines Technical College', system: 'tcsg', match: ['coastal pines'] },
  { key: '005704', name: 'Columbus Technical College', system: 'tcsg', match: ['columbus technical', 'columbus tech'] },
  { key: '002860', name: 'Georgia Northwestern Technical College', system: 'tcsg', match: ['georgia northwestern'] },
  { key: '003226', name: 'Georgia Piedmont Technical College', system: 'tcsg', match: ['georgia piedmont'] },
  { key: '005168', name: 'Gwinnett Technical College', system: 'tcsg', match: ['gwinnett technical', 'gwinnett tech'] },
  { key: '130352', name: 'Lanier Technical College', system: 'tcsg', match: ['lanier technical', 'lanier tech'] },
  { key: '005507', name: 'North Georgia Technical College', system: 'tcsg', match: ['north georgia technical', 'north georgia tech'] },
  { key: '005772', name: 'Oconee Fall Line Technical College', system: 'tcsg', match: ['oconee fall line'] },
  { key: '000154', name: 'Ogeechee Technical College', system: 'tcsg', match: ['ogeechee'] },
  { key: '003741', name: 'Savannah Technical College', system: 'tcsg', match: ['savannah technical', 'savannah tech'] },
  { key: '006555', name: 'South Georgia Technical College', system: 'tcsg', match: ['south georgia technical', 'south georgia tech'] },
  { key: '005652', name: 'Southeastern Technical College', system: 'tcsg', match: ['southeastern technical'] },
  { key: '005670', name: 'Southern Crescent Technical College', system: 'tcsg', match: ['southern crescent'] },
  { key: '007058', name: 'Southern Regional Technical College', system: 'tcsg', match: ['southern regional technical'] },
  { key: '006342', name: 'West Georgia Technical College', system: 'tcsg', match: ['west georgia technical', 'west georgia tech'] },
  { key: '004557', name: 'Wiregrass Georgia Technical College', system: 'tcsg', match: ['wiregrass georgia technical', 'wiregrass'] },
  // Private and out-of-state schools UGA students often come from.
  { key: '005111', name: 'Clemson University', system: 'other', match: ['clemson'] },
  { key: '005187', name: 'Emory University', system: 'other', match: ['emory university'], not: ['oxford'] },
  { key: '005186', name: 'Oxford College of Emory University', system: 'other', match: ['oxford college'] },
  { key: '005409', name: 'Mercer University', system: 'other', match: ['mercer university'] },
  { key: '005059', name: 'Berry College', system: 'other', match: ['berry college'] },
  { key: '005521', name: 'Oglethorpe University', system: 'other', match: ['oglethorpe'] },
  { key: '001005', name: 'Auburn University', system: 'other', match: ['auburn university'] },
  { key: '001830', name: 'The University of Alabama', system: 'other', match: ['university of alabama'], not: ['birmingham', 'huntsville'] },
  { key: '005818', name: 'University of South Carolina', system: 'other', match: ['university of south carolina'], not: ['aiken', 'upstate', 'beaufort'] },
  { key: '001843', name: 'University of Tennessee', system: 'other', match: ['university of tennessee'], not: ['chattanooga', 'martin'] },
  { key: '005812', name: 'University of Florida', system: 'other', match: ['university of florida'] },
  { key: '005219', name: 'Florida State University', system: 'other', match: ['florida state university'] },
  { key: '005113', name: 'College of Charleston', system: 'other', match: ['college of charleston'] },
  { key: '005816', name: 'University of North Carolina at Chapel Hill', system: 'other', match: ['chapel hill', 'unc chapel hill'] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return text;
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

/** "MATH 1GXX", "BIOL 1107L", "NTFR" as the planner reads them. */
function ugaResult(cell) {
  const s = strip(cell).toUpperCase();
  if (/NOT\s+TRANSFER/.test(s) || /^NTFR\b/.test(s)) return 'NTFR';
  const m = s.match(/^([A-Z]{2,5})\s*(\d[0-9A-Z]{3}[A-Z]{0,2})$/);
  return m ? `${m[1]} ${m[2]}` : s;
}

async function robotsAllow() {
  const text = await get(`${BASE}/robots.txt`);
  // Our agent falls under "*"; stop if "*" ever disallows the portal path.
  const blocks = text.split(/\n(?=User-agent:)/i);
  for (const block of blocks) {
    if (!/User-agent:\s*\*/i.test(block)) continue;
    for (const line of block.split('\n')) {
      const m = line.match(/^Disallow:\s*(\S*)/i);
      if (m && m[1] && ('/portal/transfer-equivalency'.startsWith(m[1]) || m[1] === '/')) return false;
    }
  }
  return true;
}

async function findKey(school) {
  const q = school.name.replace(/^The /, '').replace(/ & /g, ' ');
  const json = JSON.parse(await get(`${BASE}/manage/service/lookup?type=school&q=${encodeURIComponent(q)}`));
  const items = (json.item ?? []).map((i) => ({ ...i, name: strip(i.name) }));
  const want = school.name.toLowerCase().replace(/^the /, '');
  const hit = items.find((i) => i.name.toLowerCase().replace(/^the /, '') === want) ?? items.find((i) => i.name.toLowerCase().startsWith(want));
  if (!hit) {
    console.log(`  no exact match for ${school.name}: ${items.slice(0, 6).map((i) => `${i.name} [${i.key}] ${i.region ?? ''}`).join(' | ')}`);
    return null;
  }
  return hit.key;
}

async function main() {
  const only = process.argv.length > 2 ? new Set(process.argv.slice(2)) : null;
  if (!(await robotsAllow())) {
    console.error('robots.txt no longer allows the portal for our agent: stopping.');
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const indexPath = join(OUT, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { schools: [] };
  const readAt = new Date().toISOString().slice(0, 10);
  for (const school of SCHOOLS) {
    if (only && !only.has(school.key) && !only.has(school.name)) continue;
    const key = school.key ?? (await findKey(school));
    if (!key) continue;
    const url = `${PORTAL}?cmd=search&ceeb=${key}`;
    const html = await get(url);
    if (/g-recaptcha-response|captcha challenge|verify you are human/i.test(html) && !/<th>Transferring Course<\/th>/.test(html)) {
      console.error(`A challenge page came back for ${school.name}: stopping, nothing worked around.`);
      process.exit(3);
    }
    const listed = html.match(/Here are the results for <b>([^<]+)<\/b>/)?.[1] ?? null;
    const rows = {};
    let n = 0;
    for (const m of html.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g)) {
      const from = strip(m[1]).toUpperCase().replace(/\s+/g, '');
      const to = ugaResult(m[2]);
      if (!from || !to) continue;
      (rows[from] ??= []).includes(to) || rows[from].push(to);
      n += 1;
    }
    const file = { school: school.name, listedAs: listed, key, system: school.system, source: url, portal: PORTAL, readAt, rows: n, courses: rows };
    writeFileSync(join(OUT, `${key}.json`), JSON.stringify(file) + '\n');
    const entry = { key, name: school.name, system: school.system, match: school.match, ...(school.not ? { not: school.not } : {}), readAt, rows: n, courses: Object.keys(rows).length };
    index.schools = [...index.schools.filter((s) => s.key !== key), entry];
    console.log(`${school.name} [${key}] ${listed ?? '?'}: ${n} rows, ${Object.keys(rows).length} courses`);
  }
  index.source = PORTAL;
  index.note = "UGA Admissions' Transfer Equivalency Search. UGA calls it a guide that is not complete and can change; the official evaluation comes after admission.";
  index.legend = { number: 'a UGA course', GXX: 'general-education core elective', GHX: 'core elective that also meets the U.S. history requirement', TXX: 'transfer elective credit only', NTFR: 'does not transfer' };
  index.schools.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
}

await main();
