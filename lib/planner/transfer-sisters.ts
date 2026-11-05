/**
 * UGA's answer for the same course number at a sister school.
 *
 * Schools in one system that shares a course numbering teach the same course
 * under the same number: ENGL 1101 at every Georgia technical college, ENC
 * 1101 at every Florida college. When UGA's list for the student's own school
 * has no line for a course, or the planner holds no list for that school,
 * UGA's published answers for that number at the sister schools are the best
 * evidence there is, and better than a guess from the title.
 *
 * Only where it was measured (scripts/dev/transfer-holdout.mjs hid each
 * school's list and predicted it from its sisters'): the University System of
 * Georgia, the Technical College System of Georgia and the Florida College
 * System passed; every other group lends nothing. A code is answered only when
 * every sister list that has it gives exactly the same answer and enough of
 * them have it (scripts/data/uga-transfer-sisters.mjs builds the files). Even
 * then one school can be UGA's exception (Albany State's ACCT 2101 is only
 * ACCT 2TXX), so the line names whose answer it is and says UGA's evaluation
 * of the student's transcript decides.
 *
 * Recognising the group is precision first: Piedmont Technical College in
 * South Carolina is not Georgia Piedmont Technical College, and a "Gordon
 * College" with no place is as likely Massachusetts as Georgia. When the
 * name could be two schools in different groups, nothing is borrowed. A UGA
 * list found for the name does not decide the group by itself, because that
 * lookup matches words anywhere in the name: Columbus State Community College
 * in Ohio opens Columbus State University's list, and "Wiregrass Georgia
 * Tech" opens Georgia Tech's. The name must start with the member's own name
 * and the list must be that member's.
 */
import type { UgaTransferIndexEntry } from './transfer-official';

export interface UgaSisterMember {
  /** The member's name, aliases and former names, normalised (sisterName). */
  names: string[];
  /** Normalised words that mean a different school. */
  not?: string[];
  city: string;
  state: string;
  stateName?: string;
  /** The name alone is shared with a school elsewhere: the transcript must show the city or state too. */
  requirePlace?: boolean;
  /** When only some names are shared ("gordon college", not "gordon state college"), those names alone need the place. */
  placeNames?: string[];
  /** The school's own UGA list, when the planner holds one. */
  key?: string;
}

export interface UgaSisterGroup {
  label: string;
  /** How a label names the group's schools: "Georgia technical colleges". */
  noun: string;
  /** The group's answers, or null when the group lends nothing. */
  file: string | null;
  /** The rules the group lends under, by kind of answer. */
  lends: { course?: string; noCredit?: string; elective?: string };
  members: UgaSisterMember[];
}

export interface UgaSisterIndex {
  builtAt: string;
  groups: Record<string, UgaSisterGroup>;
}

export interface UgaSisterFile {
  group: string;
  label: string;
  builtAt: string;
  rules: { course?: string; noCredit?: string; elective?: string };
  schools: Array<{ key: string; name: string; readAt: string | null; source: string | null }>;
  /** Sending code with no space to UGA's results and the schools (indexes into schools) whose lists gave them. */
  courses: Record<string, { r: string[]; s: number[] }>;
}

/** The recognition index and the group files a record needs, loaded together. */
export interface UgaSisterTable {
  index: UgaSisterIndex;
  groups: Record<string, UgaSisterFile>;
}

export interface SisterAnswer {
  group: string;
  /** "Georgia technical colleges". */
  noun: string;
  /** UGA's results, as every sister list gives them. */
  results: string[];
  /** The sister schools whose lists gave them. */
  schools: Array<{ key: string; name: string; readAt: string | null; source: string | null }>;
}

// The portal and transcripts shorten names ("Central Piedmont Cmty Coll",
// "Gwinnett Tech"); both sides are spelled out the same way, so they compare
// word for word. The same table as the hold-out test's (transfer-holdout.mjs).
const ABBR: Record<string, string> = { cmty: 'community', cc: 'community college', coll: 'college', colg: 'college', colleg: 'college', cl: 'college', tech: 'technical', techl: 'technical', univ: 'university', u: 'university', st: 'state', inst: 'institute', mtn: 'mountain', ft: 'fort', spgs: 'springs', and: 'and' };

/** A school name normalised for comparison: lower case, punctuation dropped, abbreviations spelled out. */
export function sisterName(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[.,'’]/g, '')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w)
    .join(' ')
    .replace(/^the /, '')
    .replace(/ (main|all campuses|main campus)$/, '')
    .trim();
}

/** Whole words only: "piedmont technical college" is in "georgia piedmont technical college", "tech" is not in "technical". */
const hasPhrase = (name: string, phrase: string) => Boolean(phrase) && ` ${name} `.includes(` ${phrase} `);

// The states a name can print beside the school ("Columbus State Community
// College, Columbus, OH"), by postal code and by name, so a name that shows a
// different state from the member's is refused.
const STATE_NAMES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};

/**
 * The states a transcript's name for the school shows outside the school's
 * own name: a postal code after a comma or at the end ("..., Columbus, OH",
 * "... Gainesville FL"), or a state's name. `rest` is the normalised name with
 * the member's matched name taken off, so "University of West Georgia" does
 * not show Georgia by its own name.
 */
function statesShown(raw: string, rest: string): Set<string> {
  const shown = new Set<string>();
  for (const m of raw.matchAll(/,\s*([A-Z]{2})(?![A-Za-z])/g)) if (STATE_NAMES[m[1]]) shown.add(m[1]);
  const tail = raw.match(/\s([A-Z]{2})(\s+\d{5}(-\d{4})?)?\s*$/)?.[1];
  if (tail && STATE_NAMES[tail]) shown.add(tail);
  for (const [code, name] of Object.entries(STATE_NAMES)) if (hasPhrase(rest, name)) shown.add(code);
  return shown;
}

interface SisterHit {
  gid: string;
  member: UgaSisterMember;
  phrase: string;
}

/**
 * The group and member a transcript's school is, or null (see sisterGroupFor).
 * The members are every member the name could be within that one group (one,
 * unless two members tie on the same name), so their own lists are left out
 * of the sisters that answer for them.
 */
export function sisterMemberFor(index: UgaSisterIndex | null | undefined, school: string | null | undefined, entry: UgaTransferIndexEntry | null): { gid: string; members: UgaSisterMember[] } | null {
  if (!index || !school) return null;
  const n = sisterName(school);
  if (!n) return null;
  let top = 0;
  let hits: SisterHit[] = [];
  for (const [gid, g] of Object.entries(index.groups)) {
    for (const member of g.members) {
      if ((member.not ?? []).some((w) => hasPhrase(n, w))) continue;
      // A member's name counts only where the school's name starts: words in
      // front of it make a different school ("Wiregrass Georgia Tech" is not
      // Georgia Tech, "Central Piedmont Community College" is not Piedmont
      // Technical College).
      const phrase = member.names.filter((p) => n === p || n.startsWith(`${p} `)).sort((a, b) => b.length - a.length)[0];
      if (!phrase || phrase.length < top) continue;
      if (phrase.length > top) hits = [];
      top = phrase.length;
      hits.push({ gid, member, phrase });
    }
  }
  // The name itself must name a member of exactly one group. A UGA list found
  // for the name is not enough on its own: that lookup matches words inside
  // the name ("columbus state" in Ohio's Columbus State Community College),
  // so a list alone cannot tell which school, or which group, it is.
  const named = new Set(hits.map((h) => h.gid));
  if (named.size !== 1) return null;
  const gid = hits[0].gid;
  for (const h of hits) {
    const rest = n.slice(h.phrase.length).trim();
    // A name that shows a different state is a different school, whatever
    // its name shares with this one.
    if ([...statesShown(school, rest)].some((s) => s !== h.member.state)) return null;
    // A name shared with a school elsewhere ("Santa Fe Community College" is
    // also New Mexico's) lends only when the transcript shows the place too,
    // even when a UGA list answers to the name: the list may be the wrong one.
    if (needsPlace(h.member, h.phrase) && !placeShown(school, n, rest, h.phrase, h.member)) return null;
  }
  let members = hits.map((h) => h.member);
  if (entry) {
    // The list found must be this member's own. A list for another school
    // (or for a school in no group: a private college, a university out of
    // state) means the name and the list disagree about who it is.
    members = members.filter((m) => m.key === entry.key);
    if (members.length === 0) return null;
  }
  return index.groups[gid]?.file ? { gid, members } : null;
}

/**
 * The group of the school a transcript names, or null.
 *
 * The name must start with a member's name, alias or former name, and the
 * longest name it starts with decides who it is: "Georgia Piedmont Technical
 * College" is the Georgia college, "Piedmont Technical College" the South
 * Carolina one. Every group's members count, lending or not, so a lookalike
 * in a group that does not lend is seen and refused. `entry` is the school's
 * own UGA list (ugaSchoolEntry), when the planner holds one: it must be that
 * same member's list. Two groups claiming the name, a list and a name that
 * disagree, a different state printed beside the name, or a shared name with
 * no place: no group.
 */
export function sisterGroupFor(index: UgaSisterIndex | null | undefined, school: string | null | undefined, entry: UgaTransferIndexEntry | null): string | null {
  return sisterMemberFor(index, school, entry)?.gid ?? null;
}

function needsPlace(member: UgaSisterMember, phrase: string): boolean {
  if (!member.requirePlace) return false;
  return member.placeNames ? member.placeNames.includes(phrase) : true;
}

/**
 * Whether a transcript's name for the school also shows the member's city or
 * state ("Santa Fe College, Gainesville, FL"). The city counts only when the
 * shared name does not already contain it: "Columbus Technical Institute"
 * was a Georgia college and an Ohio one, each in a city named Columbus, so
 * "Columbus" beside it tells them apart no better than the name does; only
 * the state does. The state's name counts anywhere, since a name such as
 * "Seminole State College of Florida" places itself.
 */
function placeShown(raw: string, n: string, rest: string, phrase: string, member: UgaSisterMember): boolean {
  if (!hasPhrase(phrase, member.city) && hasPhrase(rest, member.city)) return true;
  if (member.stateName && hasPhrase(n, member.stateName)) return true;
  return new RegExp(`(^|[^A-Za-z])${member.state}([^A-Za-z]|$)`).test(raw);
}

/**
 * UGA's answer for one course at the student's school's sisters, or null: no
 * group, a group that lends nothing, or no code every sister list agrees on.
 * Call it only after the school's own list has no line for the course.
 */
export function sisterAnswer(sisters: UgaSisterTable | null | undefined, school: string | null | undefined, entry: UgaTransferIndexEntry | null, code: string): SisterAnswer | null {
  if (!sisters) return null;
  const who = sisterMemberFor(sisters.index, school, entry);
  const gid = who?.gid ?? null;
  const file = gid ? sisters.groups[gid] : null;
  if (!who || !gid || !file) return null;
  const row = file.courses[code.toUpperCase().replace(/\s+/g, '')];
  if (!row?.r?.length) return null;
  // The school's own list never votes on its own line. It has none for this
  // code when the caller asks, unless that list failed to load or the name
  // is one UGA's index does not know ("Tallahassee State College", the 2025
  // name); then the answer must still stand on enough other schools to meet
  // the rule, and the label must not count the school among its sisters.
  const own = new Set([entry?.key, ...who.members.map((m) => m.key)].filter(Boolean));
  const schools = row.s.map((i) => file.schools[i]).filter((s) => s && !own.has(s.key));
  const rule = file.rules[kindOfResults(row.r)];
  const need = Number(rule?.match(/\/(\d+)\+$/)?.[1] ?? NaN);
  if (!(schools.length >= need)) return null;
  return { group: gid, noun: sisters.index.groups[gid].noun, results: row.r, schools };
}

/** Which of a group's rules an answer falls under: a UGA course, elective credit only, or no credit. */
function kindOfResults(results: string[]): 'course' | 'elective' | 'noCredit' {
  if (results.some((r) => /^[A-Z]{2,5} \d{4}[A-Z]?$/.test(r))) return 'course';
  return results.some((r) => !/^NTFR\b/.test(r)) ? 'elective' : 'noCredit';
}

/** "Albany Technical College, Athens Technical College and 7 more" for a label; the full list goes in basis.schools. */
export function sisterNames(answer: SisterAnswer, shown = 4): string {
  const names = answer.schools.map((s) => s.name);
  if (names.length <= shown + 1) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

let indexCache: Promise<UgaSisterIndex | null> | null = null;
const fileCache = new Map<string, Promise<UgaSisterFile | null>>();

/**
 * The sister answers for the schools a reading names, loaded in the browser
 * the way UGA's own lists are (transfer-official.ts loadUgaTransfer): the
 * small recognition index, then only the files of the groups those schools
 * belong to.
 */
export async function loadUgaSisters(names: Array<string | null | undefined>, entryOf: (name: string | null | undefined) => UgaTransferIndexEntry | null): Promise<UgaSisterTable | null> {
  if (!indexCache) {
    indexCache = fetch('/uga-transfer-sisters/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<UgaSisterIndex>) : null))
      .catch(() => {
        indexCache = null;
        return null;
      });
  }
  const index = await indexCache;
  if (!index) return null;
  const gids = new Set(names.map((n) => sisterGroupFor(index, n, entryOf(n))).filter((g): g is string => Boolean(g)));
  const groups: Record<string, UgaSisterFile> = {};
  await Promise.all(
    [...gids].map(async (gid) => {
      const name = index.groups[gid]?.file;
      if (!name) return;
      if (!fileCache.has(name)) {
        fileCache.set(
          name,
          fetch(`/uga-transfer-sisters/${name}`)
            .then((r) => (r.ok ? (r.json() as Promise<UgaSisterFile>) : null))
            .catch(() => {
              fileCache.delete(name);
              return null;
            }),
        );
      }
      const file = await fileCache.get(name);
      if (file) groups[gid] = file;
    }),
  );
  return { index, groups };
}
