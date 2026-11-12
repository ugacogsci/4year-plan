/**
 * Georgia Tech's own transfer table: OSCAR's Transfer Articulation pages
 * (wwsktrna), one sending school per file in public/gatech-transfer/, built by
 * the Georgia Tech data lane (shape: its SHAPE.md, Nov 10 2026).
 *
 *   public/gatech-transfer/index.json   { readAt, source, sourceUrl, disclaimer, policyUrl, nowTerm,
 *                                          schools: [{ code, name, state, rows, readAt?, file? }] }
 *   public/gatech-transfer/<code>.json  { code, name, state, readAt, rows: [{ id, subj, num, title,
 *                                          minGrade, from, to, gt: [{ code, title, hours }], conn,
 *                                          opts?, lab?, flags }] }
 *
 * Matching filled in Nov 12 2026 (gatechLookup, gatechOfficialLine below);
 * before that both were stubs. transcript.ts asks for them in the
 * right place (after the remedial and C-or-better rules, before the
 * vocational rule and the title matcher), and transfer-sources.ts already
 * names the tiers: a matching row is 'confirmed' ('gatech-table'), an ET DEPT
 * row is 'review' ('dept-review'), ET NOGT and "- No GT Credit" are a
 * confirmed "no credit". What the matcher has to handle (plan.md G1): And/Or
 * rows and split hours, the minimum grade and the term range of each row,
 * X electives and whether they can fill a core area, transfer math numbers
 * (11X3, 1X52), ET LAB (credit on the lab line), ET NOGT, "- No GT Credit"
 * and ET DEPT.
 */
import type { TranscriptCourseRecord } from './transcript';
import type { EquivalentProposal } from './transfer-match';
import { ugaSchoolEntry, type UgaTransferIndex } from './transfer-official';

export const GATECH_TRANSFER_TABLE = 'https://oscar.gatech.edu/pls/bprod/wwsktrna.P_find_location';

/** What a row's flags say about it (SHAPE.md). */
export type GatechRowFlag =
  | 'DEPT'
  | 'NOGT'
  | 'LAB'
  | 'NO_GT_CREDIT'
  | 'ELECTIVE'
  | 'FREE'
  | 'TMATH'
  | 'SPLIT'
  | 'NOHOURS'
  | 'NOGRADE'
  | 'FUTURE'
  | 'ENDS'
  | 'ET_OTHER';

export interface GatechTarget {
  /** "MGT 2106", "HTS 3XXX", "ET DEPT". */
  code: string;
  title: string;
  /** Null when the page leaves the hours blank. */
  hours: number | null;
}

export interface GatechRow {
  /** Stable within the file: "LEGL 2700@201105" (+ "#2" when repeated). */
  id: string;
  subj: string;
  /** Keeps suffix letters: 2700E, 1111L, 1101H. */
  num: string;
  /** The sending school's title as printed. */
  title: string;
  minGrade: string | null;
  /** Banner term codes YYYYMM (02 Spring, 05 Summer, 08 Fall); `to` null is "The End of Time". */
  from: string;
  to: string | null;
  gt: GatechTarget[];
  conn: null | 'and' | 'or' | 'mixed';
  /** For "or"/"mixed": alternatives, each an AND-group of indexes into gt. */
  opts?: number[][];
  /** With flag LAB: the line that carries the credit. */
  lab?: string;
  flags: GatechRowFlag[];
}

export interface GatechTransferIndexEntry {
  /** OSCAR's school code, e.g. "005813". */
  code: string;
  name: string;
  state: string;
  rows: number;
  readAt?: string;
  /** "005813.json", or null when the school has no rows. Absent: "<code>.json" when rows > 0. */
  file?: string | null;
  /** Lower-case words that identify the school on a transcript, if the data lane adds them. */
  match?: string[];
  /** The school whose rows Georgia Tech reads this one's classes under (Georgia Perimeter College: Georgia State, "ALL COURSE EVALS UNDER GA ST U"). */
  see?: string;
}

export interface GatechTransferIndex {
  readAt: string;
  source?: string;
  sourceUrl?: string;
  /** Georgia Tech's own disclaimer, verbatim. */
  disclaimer?: string;
  policyUrl?: string;
  /** The term that decides "effective now". */
  nowTerm?: string;
  schools: GatechTransferIndexEntry[];
}

export interface GatechTransferSchool {
  code: string;
  name: string;
  state: string;
  readAt: string;
  rowsAllTerms?: number;
  rows: GatechRow[];
}

export interface GatechTransferTable {
  index: GatechTransferIndex | null;
  /** By OSCAR code. */
  schools: Record<string, GatechTransferSchool>;
  /** The OSCAR code each school name the reading gave was recognised as (transcript name -> code). */
  names?: Record<string, string>;
}

/** Rows of the table for one sending school and code. */
export interface GatechHit {
  entry: GatechTransferIndexEntry;
  file: GatechTransferSchool;
  rows: GatechRow[];
}

/** A school's name the way transcripts and OSCAR both print it, compared loosely. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/^the /, '').replace(/\s+/g, ' ').trim();
}

/**
 * The index entry for a school named on a transcript: its own match words
 * when the index has them, else its name, the longest name the transcript's
 * name contains ("University of Georgia" never matches "University of West
 * Georgia": the words must appear in that order with nothing between).
 *
 * OSCAR prints names short ("Abraham Baldwin Agriclt Coll"), so a name is
 * also recognised through UGA's transfer index (public/uga-transfer/
 * index.json, whose match words are curated): both are keyed by the same
 * school code (005001 is Abraham Baldwin in both; 11 of the first 18 codes
 * OSCAR was read for are in UGA's index, with the same school each time).
 * A code UGA keys a school under that has no rows here is not taken (UGA's
 * 005439 is Middle Georgia State; here it is Macon State College, empty, and
 * Middle Georgia State is 005411). A school whose classes Georgia Tech reads
 * under another's rows (`see`) gives that school.
 */
export function gatechSchoolEntry(
  index: GatechTransferIndex | null | undefined,
  name: string | null | undefined,
  ugaIndex: UgaTransferIndex | null = null,
): GatechTransferIndexEntry | null {
  if (!index || !name) return null;
  const follow = (e: GatechTransferIndexEntry | null) => (e?.see ? index.schools.find((s) => s.code === e.see) ?? e : e);
  // UGA's index: its curated words, unless a word before them makes the name another school's.
  let uga: { entry: GatechTransferIndexEntry; len: number } | null = null;
  const viaUga = ugaSchoolEntry(ugaIndex, name);
  if (viaUga) {
    const same = index.schools.find((s) => s.code === viaUga.key);
    const lower = name.toLowerCase().replace(/\s+/g, ' ');
    const word = viaUga.match.filter((w) => lower.includes(w)).sort((a, b) => b.length - a.length)[0] ?? null;
    const qualified = word !== null && qualifiedAt(lower, lower.indexOf(word));
    if (same && same.rows > 0 && !qualified) uga = { entry: same, len: word ? shortKey(nameKey(word)).length : 0 };
  }
  // Georgia Tech's own names, as printed and in OSCAR's short form.
  const plain = ` ${nameKey(name)} `;
  const short = ` ${shortKey(nameKey(name))} `;
  let best: GatechTransferIndexEntry | null = null;
  let bestLen = 0;
  for (const s of index.schools) {
    const words = s.match?.length ? s.match.map(nameKey) : [nameKey(s.name)];
    for (const w of words) {
      if (!w) continue;
      const len = shortKey(w).length;
      if (len <= bestLen) continue;
      const at = [plain.indexOf(` ${w} `), short.indexOf(` ${shortKey(w)} `)];
      const ok = (at[0] >= 0 && !qualifiedAt(plain, at[0] + 1)) || (at[1] >= 0 && !qualifiedAt(short, at[1] + 1));
      if (ok) {
        best = s;
        bestLen = len;
      }
    }
  }
  // A longer Georgia Tech name wins over UGA's shorter word: "Mercer University Atlanta" is 005025, not Mercer's Macon campus.
  if (uga && !(best && best.rows > 0 && bestLen > uga.len)) return follow(uga.entry);
  return follow(best);
}

/** OSCAR's short form of a name key: "university of south carolina lancaster" reads as "univ south carolina lancaster". */
function shortKey(key: string): string {
  return key.replace(/\buniversity\b/g, 'univ').replace(/\b(?:of|at)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Words that make the name after them another school's: "St. Thomas
 * University" (Florida) is not Thomas University (Georgia), and "Kentucky
 * Wesleyan College" is not Wesleyan College (Georgia). The last word of each
 * state's name, "saint" and the compass words.
 */
const QUALIFIER = /^(?:st|ste|saint|north|south|east|west|northern|southern|eastern|western|middle|central|upper|lower|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|hampshire|jersey|mexico|york|carolina|dakota|ohio|oklahoma|oregon|pennsylvania|rhode|island|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming)$/;

/** Whether the word just before position `at` of a name is one of those. */
function qualifiedAt(name: string, at: number): boolean {
  if (at <= 0) return false;
  const before = name.slice(0, at).trim().split(/\s+/).pop()?.replace(/[^a-z]/g, '') ?? '';
  return QUALIFIER.test(before);
}

let indexCache: Promise<GatechTransferIndex | null> | null = null;
let ugaIndexCache: Promise<UgaTransferIndex | null> | null = null;
const schoolCache = new Map<string, Promise<GatechTransferSchool | null>>();

/**
 * Georgia Tech's table for the schools a reading names, loaded in the
 * browser: the index, then only those schools' files. Nothing when the files
 * are not there yet.
 */
export async function loadGatechTransfer(names: Array<string | null | undefined>): Promise<GatechTransferTable> {
  if (!indexCache) {
    indexCache = fetch('/gatech-transfer/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<GatechTransferIndex>) : null))
      .then((j) => (j && Array.isArray(j.schools) ? j : null))
      .catch(() => {
        indexCache = null;
        return null;
      });
  }
  const index = await indexCache;
  const schools: Record<string, GatechTransferSchool> = {};
  if (!index) return { index: null, schools };
  if (!ugaIndexCache) {
    ugaIndexCache = fetch('/uga-transfer/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<UgaTransferIndex>) : null))
      .then((j) => (j && Array.isArray(j.schools) ? j : null))
      .catch(() => {
        ugaIndexCache = null;
        return null;
      });
  }
  const ugaIndex = await ugaIndexCache;
  const entries = new Map<string, GatechTransferIndexEntry>();
  const recognised: Record<string, string> = {};
  for (const n of names) {
    const e = gatechSchoolEntry(index, n, ugaIndex);
    if (!e || !n) continue;
    recognised[n] = e.code;
    if (e.rows > 0 && e.file !== null) entries.set(e.code, e);
  }
  await Promise.all(
    [...entries.values()].map(async (e) => {
      const file = e.file ?? `${e.code}.json`;
      if (!schoolCache.has(e.code)) {
        schoolCache.set(
          e.code,
          fetch(`/gatech-transfer/${file}`)
            .then((r) => (r.ok ? (r.json() as Promise<GatechTransferSchool>) : null))
            .then((j) => (j && Array.isArray(j.rows) ? j : null))
            .catch(() => {
              schoolCache.delete(e.code);
              return null;
            }),
        );
      }
      const loaded = await schoolCache.get(e.code);
      if (loaded) schools[e.code] = loaded;
    }),
  );
  return { index, schools, names: recognised };
}

/** "ENGL 1101" -> ["ENGL", "1101"]; "MATH 1113H" keeps its letter; Troy's lab "BIO L100" is ["BIO", "L100"]. */
function splitCode(code: string): [string, string] | null {
  const m = code.toUpperCase().replace(/\s+/g, ' ').trim().match(/^([A-Z&]{1,6})\s?([A-Z]?\d[0-9A-Z]{0,5})$/);
  return m ? [m[1], m[2]] : null;
}

/** A row in force for a class taken now: not one that starts after the table's term. */
const inForce = (r: GatechRow) => !r.flags.includes('FUTURE');

/**
 * Georgia Tech's rows for a sending course: the school the line or the
 * document names (as the loader recognised it, else by name), then the rows
 * for its subject and number, the one in force now (the newest when the
 * table keeps two). An honors or online section printed with its letter
 * (ENGL 1101H, MATH 1113E) reads the plain number's row when the table has
 * no row of its own for it. Null when the table says nothing.
 */
export function gatechLookup(table: GatechTransferTable | null | undefined, school: string | null | undefined, code: string): GatechHit | null {
  if (!table?.index || !school) return null;
  const known = table.names?.[school];
  const entry = known ? table.index.schools.find((s) => s.code === known) ?? null : gatechSchoolEntry(table.index, school);
  if (!entry) return null;
  const file = table.schools[entry.code];
  if (!file) return null;
  const parts = splitCode(code);
  if (!parts) return null;
  const [subj, num] = parts;
  const rowsFor = (n: string) => file.rows.filter((r) => r.subj.toUpperCase() === subj && r.num.toUpperCase() === n);
  let rows = rowsFor(num);
  if (rows.length === 0 && /^\d{4}[HE]$/.test(num)) rows = rowsFor(num.slice(0, 4));
  if (rows.length === 0) return null;
  const now = rows.filter(inForce);
  const pool = now.length ? now : rows;
  const newest = [...pool].sort((a, b) => b.from.localeCompare(a.from))[0];
  return { entry, file, rows: [newest] };
}

const isDept = (t: GatechTarget) => /^ET\s+DEPT\b/i.test(t.code);
const isNoCredit = (t: GatechTarget) => /^ET\s+NOGT\b/i.test(t.code) || /no gt credit/i.test(t.title);
const isLab = (t: GatechTarget) => /^ET\s+LAB\b/i.test(t.code);
/**
 * The table's own codes, never a Georgia Tech class: ET LAB, ET NOGT, ET
 * DEPT, and the rarer ET TRAN ("See Math Transfer Policy") and ET INSF
 * ("Insufficient Grade"), with the "- No GT Credit" rows.
 */
const isMarker = (t: GatechTarget) => /^ET\s/i.test(t.code) || isNoCredit(t);
/** ET TRAN, ET INSF and any other ET code but LAB and NOGT: Georgia Tech decides, as for ET DEPT. */
const isReview = (t: GatechTarget) => isMarker(t) && !isLab(t) && !isNoCredit(t);
/** "HUM 1XXX", "FREE 2XXX", "MATH 11X3", "APPH 11XX": hours of a kind, not one class. */
const isElective = (t: GatechTarget) => /^[A-Z]{2,5} \d?[0-9X]*X[0-9X]*$/.test(t.code);
const sumHours = (ts: GatechTarget[]) => ts.reduce((n, t) => n + (t.hours ?? 0), 0);

/**
 * The targets a row gives: all of them for an And row, else the
 * alternative that names a real class (not only the table's ET codes or
 * "department reviews") and whose hours are closest to the class's own (a
 * 4-hour class reads "ARBC 2001 + ARBC 2XXX", a 3-hour one "ARBC 2001"). A
 * real class wins every tie: Georgia State's PHYS 2211L reads PHYS 2211, not
 * ET NOGT ("Verify PHYS 2211"), though its 1 hour is nearer ET NOGT's 0
 * (2026-11-12 review); with no PHYS 2211 lecture that earns credit on the
 * record, the lab counts its own hour instead (carryGatechLabHours,
 * waitOnLecture). When every choice is only codes, credit on the lab
 * comes first, then a review, then no credit. The others are named in the
 * sentence, and the ones that are a class ORION lists are the student's to
 * pick (tableChoices).
 */
function chosenTargets(row: GatechRow, credits: number | null): { picked: GatechTarget[]; others: GatechTarget[][] } {
  if (!row.opts?.length || (row.conn !== 'or' && row.conn !== 'mixed')) return { picked: row.gt, others: [] };
  const groups = row.opts.map((g) => g.map((i) => row.gt[i]).filter((t): t is GatechTarget => Boolean(t))).filter((g) => g.length > 0);
  if (groups.length === 0) return { picked: row.gt, others: [] };
  const rank = (g: GatechTarget[]) => (g.every(isMarker) ? (g.some(isLab) ? 1 : g.some(isNoCredit) ? 3 : 2) : g.some(isDept) ? 0.5 : 0);
  const distance = (g: GatechTarget[]) => (credits === null ? 0 : Math.abs(sumHours(g) - credits));
  const order = groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || distance(a.g) - distance(b.g) || a.i - b.i);
  return { picked: order[0].g, others: order.slice(1).map((o) => o.g) };
}

/** Letter grades, best first; a "T" prefix (a transfer grade, "TC-") reads as the grade. */
const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const gradeRank = (g: string | null | undefined) => GRADE_ORDER.indexOf(String(g ?? '').trim().toUpperCase().match(/^T?([A-DF][+-]?)$/)?.[1] ?? '');
/** A letter grade below a row's minimum ("C-" under "C"); a pass grade or an unread minimum is never below. */
function belowGrade(grade: string | null | undefined, min: string | null | undefined): boolean {
  const g = gradeRank(grade);
  const m = gradeRank(min);
  return g >= 0 && m >= 0 && g > m;
}

/** A class code as a table or a transcript prints one: "CHEM 1211L", "CH 125", Troy's "BIO L100", "CEM 1895". */
const LINE_CODE = /\b([A-Z]{2,5}) ?([A-Z]?\d{3,5}[A-Z]{0,2})\b/;
/** The line an ET LAB answer names: the row's lab code, else the code in the target's title ("Credit Awarded w/CH 125"). Null for "w/Lab Section". */
function labNamed(row: GatechRow, target: GatechTarget): string | null {
  const own = row.lab && row.lab !== 'section' ? row.lab.match(LINE_CODE) : null;
  const titled = target.title.match(LINE_CODE);
  const m = own ?? titled;
  return m ? `${m[1]} ${m[2]}` : null;
}
/** A lab line: its number ends in L ("CHYS 161L"), or starts with one (Troy's "BIO L100"), or its title is a lab's ("Organic Chemistry Lab"). */
function looksLab(code: string, title: string | null): boolean {
  return /\d+L$|\sL\d{3}$/.test(code.toUpperCase().trim()) || (/\blab(oratory)?\s*$/i.test(title ?? '') && !/(&|\band|\bwith|w\/)\s*lab(oratory)?\s*$/i.test(title ?? ''));
}

const listOf = (ts: GatechTarget[]) => [...new Set(ts.map((t) => t.code))].join(' + ');
/** A choice in words: "ET LAB" and "ET DEPT" are the table's codes, not classes. */
const sayChoice = (ts: GatechTarget[]) =>
  ts.every(isLab) ? 'credit on its lab' : ts.every(isDept) ? "its department's review" : ts.every(isNoCredit) ? 'no credit' : ts.every(isReview) ? `"${ts.map((t) => t.title).join('; ')}"` : listOf(ts);

/**
 * The classes a row allows that ORION's catalog lists, as the line's
 * proposals: the review row's select offers a line's proposals
 * (transcript-upload.tsx countsOptions), so the student can pick the one
 * Georgia Tech gives them (CS 1371 on a row that also allows CS 1301). The
 * row's own class heads the list, so a student who set the line to hours or
 * to nothing can set it back; an Or row's other choices follow. The first
 * class of a choice is what the line counts as; the rest of that choice ride
 * with it (setLineCounts reads pairedWith). A choice that is only hours (an
 * elective, a class the catalog does not list, ET DEPT) is the select's
 * "Hours toward the total" already, and adds none. The line still counts as
 * the row's first choice until the student picks. `others` is how many of the
 * list are an Or row's other choices.
 */
function tableChoices(others: GatechTarget[][], picked: GatechTarget[], known: ReadonlyMap<string, { code: string; title: string; credits: number }>, label: string): { list: EquivalentProposal[]; others: number } {
  const classes = (g: GatechTarget[]) => [...new Set(g.filter((t) => !isMarker(t) && !isElective(t)).map((t) => t.code))].filter((c) => known.has(c));
  const choice = (held: string[], why: string, seen: Set<string>): EquivalentProposal[] =>
    held.flatMap((code, i) => {
      const k = known.get(code);
      if (!k || seen.has(code)) return [];
      seen.add(code);
      return [{ code, title: k.title, credits: k.credits, confidence: 'high' as const, why, ...(i > 0 ? { pairedWith: held[0] } : {}) }];
    });
  const own = classes(picked);
  const seen = new Set(picked.map((t) => t.code));
  const out: EquivalentProposal[] = [];
  for (const g of others) {
    const held = classes(g);
    // A choice that starts with the line's own class would add to it when the student picks it back.
    if (held.length === 0 || seen.has(held[0])) continue;
    out.push(...choice(held, `${label} also allows ${listOf(g)} for it.`, seen));
  }
  return { list: [...choice(own, `${label} makes it ${listOf(picked)}.`, new Set()), ...out], others: out.length };
}

/**
 * The line Georgia Tech's row makes of a transcript line, its basis stamped
 * 'gatech-table' (confirmed) or 'dept-review' (review):
 *   - a Georgia Tech class ORION's catalog lists: counts as that class;
 *   - a class the catalog does not list: confirmed, counted as hours, named;
 *   - an elective ("HUM 1XXX", "FREE 1XXX", "MATH 11X3"): hours of that kind;
 *   - ET NOGT or "- No GT Credit": no credit;
 *   - ET LAB: the credit is given on the lab line, so this line adds none;
 *   - ET DEPT with no other answer: the department reviews it; the hours count for now.
 */
export function gatechOfficialLine(
  base: TranscriptCourseRecord,
  hit: GatechHit,
  ctx: { off: boolean; row: string; readAt: string; label: string; known: ReadonlyMap<string, { code: string; title: string; credits: number }> },
): TranscriptCourseRecord | null {
  const row = hit.rows[0];
  if (!row || row.gt.length === 0) return null;
  const { off, readAt, label, known } = ctx;
  const source = GATECH_TRANSFER_TABLE;
  const tag = (sourceKind: 'gatech-table' | 'dept-review', tier: 'confirmed' | 'review') => ({ tier, sourceKind, row: ctx.row, readAt, sourceLabel: label });
  const { picked, others } = chosenTargets(row, base.credits ?? null);
  const choices = tableChoices(others, picked, known, label);
  const offer = choices.list.length ? { proposals: choices.list } : {};
  const otherWords = choices.others
    ? ` The table allows ${[picked, ...others].map(sayChoice).join(' or ')}; pick another below if Georgia Tech gives you that one.`
    : others.length ? ` The table also allows ${others.map(sayChoice).join(' or ')}.` : '';

  if (picked.some(isNoCredit) || picked.every((t) => /^ET\s+NOGT\b/i.test(t.code))) {
    // Not the line's status: that is the document's, saved, and read again
    // when the record is matched for UGA or Illinois (readingOfRecord), where
    // a 'no_credit' status reads "your document says it earns no credit" and
    // hides the line's choices. The student can still count it.
    return {
      ...base,
      counts: 'none',
      use: false,
      ...offer,
      basis: { from: 'official', badge: 'none', text: `${label} gives no Georgia Tech credit for it.${otherWords}`, source, checked: readAt, ...tag('gatech-table', 'confirmed') },
    };
  }
  // The row's own minimum grade (C on most rows, C- on some): a C- under a C row is no credit.
  if (!off && belowGrade(base.grade, row.minGrade)) {
    return {
      ...base,
      counts: 'none',
      use: false,
      basis: { from: 'rule', badge: 'none', text: `${label} needs a ${row.minGrade} or better in this class, so a ${base.grade} does not count. Change it if Georgia Tech evaluates it otherwise.`, source, checked: readAt, tier: 'rule', sourceKind: 'grade-rule', row: ctx.row, readAt, sourceLabel: label },
    };
  }
  if (picked.length === 1 && isLab(picked[0])) {
    // Where the table puts the credit: the code it names, or its lab section.
    // Georgia State's GEOG 1112L names its lecture, GEOG 1112: the credit is on the lecture.
    const named = labNamed(row, picked[0]);
    const onLecture = named !== null && looksLab(base.code, base.title) && !looksLab(named, null);
    const where = onLecture
      ? `gives the credit for this lab and its lecture together on ${named} (not on its lab line)`
      : `gives the credit for this class on its lab${named ? `, ${named}` : row.lab === 'section' ? ' section' : ''}`;
    return {
      ...base,
      counts: 'none',
      use: false,
      ...offer,
      basis: { from: 'official', badge: 'none', text: `${label} ${where}, so this line adds no hours of its own.${otherWords}`, source, checked: readAt, ...tag('gatech-table', 'confirmed') },
    };
  }
  const real = picked.filter((t) => !isMarker(t));
  if (real.length === 0) {
    // ET DEPT: Georgia Tech's department decides after admission. ET TRAN
    // ("See Math Transfer Policy") and ET INSF ("Insufficient Grade") are
    // the table's notes, not classes: Georgia Tech decides those too.
    const notes = picked.filter((t) => isReview(t) && !isDept(t));
    const why = notes.length && !picked.some(isDept)
      ? `${label} says "${notes.map((t) => t.title).join('; ')}" for this class rather than naming a Georgia Tech class, so Georgia Tech decides after admission.`
      : `${label} says its department evaluates this class after admission.`;
    return {
      ...base,
      counts: off || base.credits === null ? 'none' : 'hours',
      use: !off && base.credits !== null,
      ...offer,
      basis: { from: 'official', badge: 'not-evaluated', text: `${why}${otherWords}`, source, checked: readAt, ...tag('dept-review', 'review') },
    };
  }
  const courses = real.filter((t) => !isElective(t));
  const held = [...new Set(courses.map((t) => t.code))].filter((c) => known.has(c));
  const electives = real.filter(isElective);
  if (held.length > 0) {
    const [first, ...also] = held;
    const extra = electives.length ? `; the table also gives ${listOf(electives)} for it` : '';
    return {
      ...base,
      matched: first,
      matchedBy: 'official',
      // The catalog hours of the classes the board books, and no more: MATH
      // 2250 at UGA is MATH 1551 (2 hours) and MATH 1XXX (2 hours), and the
      // elective's 2 hours count through transcriptCreditAdjustment (the
      // line's 4 less MATH 1551's 2). Adding them here cancelled them.
      illinoisCredits: held.reduce((n, c) => n + (known.get(c)?.credits ?? 0), 0),
      counts: off ? 'none' : 'course',
      use: !off,
      ...(also.length ? { also } : {}),
      ...offer,
      basis: { from: 'official', badge: 'course', text: `${label} makes it Georgia Tech ${listOf(courses)}${extra}.${otherWords}`, source, checked: readAt, ...tag('gatech-table', 'confirmed') },
    };
  }
  if (courses.length > 0) {
    const named = [...new Set(courses.map((t) => t.code))];
    return {
      ...base,
      counts: off || base.credits === null ? 'none' : 'hours',
      use: !off && base.credits !== null,
      ...offer,
      basis: { from: 'official', badge: 'not-evaluated', text: `${label} makes it Georgia Tech ${listOf(real)}, which ORION's course list does not include, so it counts as hours.${otherWords}`, source, checked: readAt, ...tag('gatech-table', 'confirmed'), named },
    };
  }
  const desig = listOf(electives);
  return {
    ...base,
    counts: off || base.credits === null ? 'none' : 'hours',
    use: !off && base.credits !== null,
    designation: desig,
    ...offer,
    basis: { from: 'official', badge: 'elective', text: `${label} gives it ${desig} (${electives.map((t) => t.title).filter(Boolean)[0] ?? 'elective credit'}): hours toward your total, not one specific class.${otherWords}`, source, checked: readAt, ...tag('gatech-table', 'confirmed') },
  };
}

const codeKey = (code: string) => code.toUpperCase().replace(/\s+/g, '');
const earnsHours = (c: TranscriptCourseRecord) => (c.status === 'completed' || c.status === 'in_progress' || c.status === 'transfer') && (c.credits ?? 0) > 0;
/** The OSCAR school a line's Georgia Tech answer was read from ("005359"), by its row. */
const oscarOf = (c: TranscriptCourseRecord) => (c.labAnswer?.row ?? c.basis?.row)?.match(/^gatech-transfer\/([^/]+)\.json#/)?.[1] ?? null;
/** The same sending school: the same table file when both lines were read from one (a second page may print "Kennesaw State Univ"), else the same name. */
const sameSchool = (a: TranscriptCourseRecord, b: TranscriptCourseRecord) => {
  const x = oscarOf(a);
  const y = oscarOf(b);
  return x && y ? x === y : (a.from ?? '') === (b.from ?? '');
};
const hoursText = (n: number) => `${Math.round(n * 100) / 100} ${n === 1 ? 'hour' : 'hours'}`;
/** A class's code without its section letters, in codeKey form: honors "CHEM 1211H", KSU's "PHYS 2211ZM" and "CHEM 1211" are all CHEM1211. */
const baseKey = (code: string) => {
  const m = code.toUpperCase().trim().match(/^([A-Z&]{1,6})\s?(\d{3,5})[A-Z]{0,2}$/);
  return m ? `${m[1]}${m[2]}` : codeKey(code);
};
/** A lab by its code, letters before the L too (Emory's "CHEM 202ZL"), or its title. */
const labLine = (c: TranscriptCourseRecord) => /\d[A-Z]?L$/.test(codeKey(c.code)) || labLike(c.code, c.title);
/**
 * The class's ordinary lab for a lecture printed with a section letter
 * (2026-11-12 review: UGA's GEOL 1121H, a "w/Lab Section" row, beside GEOL
 * 1121L; KSU's CHEM 1211Z, whose row names its own CHEM 1211Y, beside CHEM
 * 1211L): codeKey form, null for a plain number or a lab's own code.
 */
const sectionLab = (code: string) => {
  const m = code.toUpperCase().trim().match(/^([A-Z&]{1,6})\s?(\d{3,5})([A-Z]{1,2})$/);
  return m && !m[3].endsWith('L') ? `${m[1]}${m[2]}L` : null;
};
/** A line whose own answer is "the credit is on another line" (ET LAB), and that does not count on its own. */
const restsOnLab = (c: TranscriptCourseRecord) => c.basis?.sourceKind === 'gatech-table' && c.basis.badge === 'none' && !(c.use && c.counts !== 'none');

/**
 * Tests for the codes, best first, that a lecture's credit may sit on: the code the
 * table names ("CHEM 1211L"; Savannah Tech's "CHEM 1211LL" read as one L),
 * the lecture's own code with an L ("CHEM 1211L" for a "w/Lab Section" row),
 * Troy's L-numbered lab ("BIO L100" for BIO 1100), and another line printed
 * with the lecture's own code.
 */
function carrierKeys(lecture: TranscriptCourseRecord, named: string | null): Array<(code: string) => boolean> {
  const own = codeKey(lecture.code);
  const m = lecture.code.toUpperCase().match(/^([A-Z&]{1,6})\s?(\d{3,5})[A-Z]?$/);
  const keys = [...new Set([...(named ? [codeKey(named), codeKey(named).replace(/L{2,}$/, 'L')] : []), `${own}L`])];
  return [
    ...keys.map((k) => (code: string) => codeKey(code) === k),
    // "BIO L100", printed with its space, never "BIOL 100".
    ...(m ? [(code: string) => new RegExp(`^${m[1]}\\s+L${m[2].slice(-3)}$`).test(code.toUpperCase().trim())] : []),
    (code: string) => codeKey(code) === own,
  ];
}

/**
 * The note a line that carries other lines' hours adds to its sentence, and
 * the hours: "Georgia Tech gives CHEM 1211's credit on this line too, so it
 * counts 4 hours: its own 1 and CHEM 1211's 3."
 */
function carryNote(own: number, from: Array<{ code: string; hours: number }>): { note: string; hours: number } {
  const hours = from.reduce((n, f) => n + f.hours, 0);
  const names = from.map((f) => `${f.code}'s`).join(' and ');
  return { hours, note: ` Georgia Tech gives ${names} credit on this line too, so it counts ${hoursText(own + hours)}: its own ${Math.round(own * 100) / 100} and ${from.map((f) => `${f.code}'s ${Math.round(f.hours * 100) / 100}`).join(' and ')}.` };
}

/** The line without the hours another line's credit added to it: its printed equivalentCredits and sentence back. */
function withoutCarry(c: TranscriptCourseRecord): TranscriptCourseRecord {
  if (!c.carried) return c;
  const { carried, ...rest } = c;
  const text = rest.basis?.text;
  return {
    ...rest,
    equivalentCredits: carried.printed,
    ...(rest.basis && text && carried.note && text.endsWith(carried.note) ? { basis: { ...rest.basis, text: text.slice(0, text.length - carried.note.length) } } : {}),
  };
}

/** `c` with the given lines' hours carried onto it (see carryGatechLabHours). */
function withCarry(c: TranscriptCourseRecord, from: Array<{ code: string; term: string | null; hours: number }>): TranscriptCourseRecord {
  const printed = c.equivalentCredits ?? null;
  const own = printed ?? c.credits ?? 0;
  const { note, hours } = carryNote(own, from);
  return {
    ...c,
    equivalentCredits: own + hours,
    carried: { lines: from.map((f) => ({ code: f.code, term: f.term })), printed, note },
    ...(c.basis ? { basis: { ...c.basis, text: `${c.basis.text}${note}` } } : {}),
  };
}

/**
 * ET LAB, settled across the transcript: Georgia Tech gives a lecture's
 * credit on another line, mostly its lab (KSU CHEM 1211, 3 hours, "Credit
 * Awarded w/ CHEM 1211L"; CHEM 1211L, 1 hour, is CHEM 1211K, 4). The lecture
 * line adds no hours of its own, so the line that carries the credit earns
 * both lines' hours; before this the plan held 1 of the 4
 * (transcriptCreditAdjustment settles CHEM 1211K's 4 catalog hours against
 * the lab's 1).
 *
 * The carrying line is found whatever the row prints: a code (KSU's CHEM
 * 1211L, Alabama Huntsville's 3-digit CH 125, Troy's BIO L100, read from the
 * row or from the target's title), or "w/Lab Section" (UGA's CHEM 1211, read
 * as CHEM 1211L on the same school's lines). It has to count: a lab that was
 * withdrawn, or is not on the record, carries nothing, and then the lecture
 * counts its own hours for now, saying why (an unknown line: Georgia Tech
 * decides), never zero (2026-11-12 review: 3 of every 4 hours were lost on
 * 186 of the 584 ET LAB rows). When the lab arrives later (another page,
 * transcript-upload.tsx addTo) the lecture goes back to the table's answer.
 * A line carries one lecture: a retaken lecture counts once, and a second
 * lecture naming the same lab counts as elective hours. The other way round,
 * a lab whose class needs its lecture does not book that class while no
 * lecture on the record earns it (waitOnLecture).
 *
 * The carried hours sit in the carrying line's equivalentCredits, so every
 * total reads them, and `carried` keeps the document's own figure:
 * readingOfRecord gives that back, so matching the record for UGA or
 * Illinois starts from what was printed. A lecture that earned nothing (a W,
 * or a D under the C-or-better rule) adds none. Printed hours only, so
 * matching the same record again gives the same answer. Changes the array's
 * slots (copies, never the line objects) and returns it.
 */
export function carryGatechLabHours(courses: TranscriptCourseRecord[], table: GatechTransferTable | null | undefined): TranscriptCourseRecord[] {
  if (!table) return courses;
  // A table without the school a line's answer came from (a file that did not load) settles nothing: the pairs stay as they are.
  const fileOf = (row: string | null | undefined) => row?.match(/^gatech-transfer\/([^/]+)\.json#/)?.[1] ?? null;
  if (courses.some((c) => [fileOf(c.basis?.row), fileOf(c.labAnswer?.row)].some((f) => f !== null && !table.schools[f]))) return courses;
  // Settled afresh: no carried hours, and a lab that waited on its lecture books its row's class again.
  for (let i = 0; i < courses.length; i++) courses[i] = withLabClass(withoutCarry(courses[i]));
  type Pending = { i: number; answer: NonNullable<TranscriptCourseRecord['basis']>; named: string | null; section: boolean; onLecture: boolean };
  const pending: Pending[] = [];
  courses.forEach((c, i) => {
    if (!earnsHours(c)) return;
    // The table's answer: on the line (ET LAB), or kept while the line counted its own hours (no lab yet).
    const waiting = c.labAnswer && c.use && c.counts === 'hours' && c.basis?.sourceKind === 'none' ? c.labAnswer : null;
    const answer = waiting ?? (c.counts === 'none' && c.basis?.sourceKind === 'gatech-table' && c.basis.badge === 'none' ? c.basis : null);
    const ref = answer?.row?.match(/^gatech-transfer\/([^/]+)\.json#(.+)$/);
    const row = ref ? table.schools[ref[1]]?.rows.find((r) => r.id === ref[2]) : null;
    if (!answer || !row) return;
    const { picked } = chosenTargets(row, c.credits ?? null);
    if (picked.length !== 1 || !isLab(picked[0])) return;
    const named = labNamed(row, picked[0]);
    pending.push({ i, answer, named, section: row.lab === 'section' || !named, onLecture: named !== null && looksLab(c.code, c.title) && !looksLab(named, null) });
  });
  const isPending = new Set(pending.map((p) => p.i));
  const carry = new Map<number, Array<{ code: string; term: string | null; hours: number }>>();
  // The lectures that name each carrying line, settled below: one lecture per line.
  const claims = new Map<number, Pending[]>();
  for (const p of pending) {
    const lecture = courses[p.i];
    const fits = (c: TranscriptCourseRecord, j: number) => j !== p.i && !isPending.has(j) && sameSchool(c, lecture) && earnsHours(c) && c.use && c.counts !== 'none';
    // Of two lines a test finds (a lab taken twice), the one of the lecture's own term.
    const pick = (test: (c: TranscriptCourseRecord) => boolean) => {
      const hits = courses.flatMap((c, j) => (fits(c, j) && test(c) ? [j] : []));
      return hits.find((j) => (courses[j].term ?? null) === (lecture.term ?? null)) ?? hits[0] ?? -1;
    };
    let at = -1;
    for (const is of carrierKeys(lecture, p.named)) {
      at = pick((c) => is(c.code));
      if (at >= 0) break;
    }
    // A "w/Lab Section" row and a lab numbered one past its lecture (Austin Peay's PHYS 2110 and PHYS 2111 Lab).
    if (at < 0 && p.section) {
      const m = lecture.code.toUpperCase().match(/^([A-Z&]{1,6})\s?(\d{3,5})$/);
      if (m) at = pick((c) => codeKey(c.code) === `${m[1]}${Number(m[2]) + 1}` && looksLab(c.code, c.title));
    }
    // An honors or other section of the lecture beside the class's ordinary lab (GEOL 1121H and GEOL 1121L).
    const sibling = at < 0 ? sectionLab(lecture.code) : null;
    if (sibling) at = pick((c) => codeKey(c.code) === sibling);
    if (at >= 0) {
      claims.set(at, [...(claims.get(at) ?? []), p]);
      continue;
    }
    if (lecture.labAnswer) continue;
    // No line on the record carries the credit: the lecture's hours count on it for now.
    const a = p.answer;
    const label = a.sourceLabel ?? "Georgia Tech's transfer table";
    const own = hoursText(lecture.credits ?? 0);
    const text = p.onLecture
      ? `${label} gives the credit for this lab and its lecture together on ${p.named}, and ${p.named} earns no credit on this record, so this line counts its own ${own} for now. Georgia Tech decides from your official transcript.`
      : `${label} gives the credit for this class with its lab${p.named ? `, ${p.named}` : ''}, and no lab line on this record earns that credit, so this line counts its own ${own} for now. Add the lab's page if you took it; Georgia Tech decides from your official transcript.`;
    courses[p.i] = {
      ...lecture,
      counts: 'hours',
      use: true,
      labAnswer: a,
      basis: { from: 'none', badge: 'not-evaluated', text, source: a.source ?? GATECH_TRANSFER_TABLE, checked: a.checked ?? null, tier: 'unknown', sourceKind: 'none', row: a.row ?? null, readAt: a.readAt ?? null, sourceLabel: label },
    };
  }
  // One lecture per carrying line: Georgia Tech gives the class once
  // (2026-11-12 review: a retaken CHEM 1211 put 7 hours on Kennesaw State's
  // CHEM 1211L). The lecture the line is numbered after wins (Florida
  // Atlantic's PHY 2048 for PHY 2048L, which PHY 2043 names too), then the
  // lecture of the line's own term, then the first. The same lecture again
  // (retaken) is a repeat and counts once; another lecture naming the same
  // line counts as elective hours, the counts-once rule for a second class
  // like one already counted (transcript.ts matchTranscript).
  for (const [at, ps] of claims) {
    const line = courses[at];
    const natural = (p: Pending) => (codeKey(line.code) === `${codeKey(courses[p.i].code)}L` ? 0 : 1);
    const ofTerm = (p: Pending) => ((courses[p.i].term ?? null) === (line.term ?? null) ? 0 : 1);
    const [first, ...rest] = [...ps].sort((a, b) => natural(a) - natural(b) || ofTerm(a) - ofTerm(b) || a.i - b.i);
    // A lecture that counted its own hours while it waited goes back to the table's answer.
    const settled = (p: Pending): TranscriptCourseRecord => {
      const { labAnswer, ...c } = courses[p.i];
      return labAnswer ? { ...c, counts: 'none', use: false, basis: labAnswer } : c;
    };
    const lecture = courses[first.i];
    courses[first.i] = settled(first);
    carry.set(at, [{ code: lecture.code, term: lecture.term, hours: lecture.credits ?? 0 }]);
    const what = line.matched ? [line.matched, ...(line.also ?? [])].join(' + ') : line.designation ?? line.basis?.named?.join(' + ') ?? 'hours';
    for (const p of rest) {
      const c = settled(p);
      courses[p.i] = codeKey(c.code) === codeKey(lecture.code)
        ? { ...c, counts: 'none', use: false, matchNote: `a repeat of ${c.code}; it counts once`, basis: { ...p.answer, badge: 'none', text: `A repeat of ${c.code}; it counts once.`, tier: 'rule', sourceKind: 'repeat-rule' } }
        : {
            ...c,
            counts: 'hours',
            use: true,
            matchNote: `${line.code} already counts as ${what} with ${lecture.code}`,
            basis: { ...p.answer, badge: 'elective', text: `Georgia Tech gives its credit on ${line.code}, which already counts as ${what} with ${lecture.code}, so this one counts as elective hours.`, tier: 'rule', sourceKind: 'repeat-rule' },
          };
    }
  }
  for (const [j, from] of carry) {
    const c = courses[j];
    // A waiting lab the student booked as its table's class: its lecture is here now, so the table's answer stands.
    const booked = c.labClass && c.use && c.counts === 'course' && c.matched === c.labClass.matched ? tableClass(c) : c;
    courses[j] = withCarry(booked, from);
  }
  waitOnLecture(courses, table, new Set(carry.keys()));
  return courses;
}

/** A lab by its code (CHEM 1211L, BIO L100) or a title ("Laboratory Biology I", "General Chemistry Lab II"), not a class "& Lab" or a recitation. */
function labLike(code: string, ...titles: Array<string | null | undefined>): boolean {
  return looksLab(code, null) || titles.some((t) => /\blab(oratory)?\b/i.test(t ?? '') && !/(&|\band|\bwith|w\/)\s*lab(oratory)?\b/i.test(t ?? ''));
}

/** A lab that waited on its lecture (waitOnLecture) with its row's class booked again, so the record is settled afresh. */
function withLabClass(c: TranscriptCourseRecord): TranscriptCourseRecord {
  if (!c.labClass || !c.labAnswer || !c.use || c.counts !== 'hours' || c.basis?.sourceKind !== 'none') return c;
  return tableClass(c);
}

/** A lab that waited on its lecture, back to its table's class and answer. */
function tableClass(c: TranscriptCourseRecord): TranscriptCourseRecord {
  if (!c.labClass || !c.labAnswer) return c;
  const { labClass, labAnswer, ...rest } = c;
  const { proposals, ...booked } = labClass;
  return {
    ...rest,
    matched: booked.matched,
    matchedBy: booked.matchedBy,
    ...(booked.also?.length ? { also: booked.also } : {}),
    illinoisCredits: booked.illinoisCredits,
    ...(proposals ? { proposals } : {}),
    counts: 'course',
    use: true,
    basis: labAnswer,
  };
}

/**
 * The lecture a lab line's class needs, by its code at the sending school:
 * every lecture whose ET LAB answer puts its credit on this line (Kennesaw
 * State's CHEM 1211, "Credit Awarded w/ CHEM 1211L", for CHEM 1211L; found
 * the way carryGatechLabHours finds the line), then the class a note among
 * the lab's own row's answers names ("Verify PHYS 2211", "Credit
 * Awarded with CHEM 150", "Check Student has CHM 2045"). The lecture rows
 * come first: their codes are the school's own, where a note may misprint
 * one (Augusta's "Verify Course CHEM 12121" for CHEM 1212). None for a line
 * no lecture's credit rests on.
 */
function labLectures(lab: TranscriptCourseRecord, row: GatechRow, file: GatechTransferSchool): string[] {
  const own = codeKey(lab.code);
  const out: string[] = [];
  const add = (code: string) => {
    if (codeKey(code) !== own && !out.some((c) => codeKey(c) === codeKey(code))) out.push(code);
  };
  for (const r of file.rows) {
    const t = r.id === row.id ? undefined : r.gt.find(isLab);
    if (!t) continue;
    const lecture = `${r.subj} ${r.num}`;
    const named = labNamed(r, t);
    // A lab whose credit sits on its lecture (Georgia State's GEOG 1112L): the other way round.
    if (named !== null && looksLab(lecture, r.title) && !looksLab(named, null)) continue;
    // carrierKeys's last test is a line printed with the lecture's own code: here that is the lecture itself.
    const tests = carrierKeys({ ...lab, code: lecture }, named).slice(0, -1);
    const m = lecture.match(/^([A-Z&]{1,6}) (\d{3,5})$/);
    const past = (r.lab === 'section' || !named) && m !== null && own === `${m[1]}${Number(m[2]) + 1}` && looksLab(lab.code, lab.title);
    if (past || tests.some((is) => is(lab.code))) add(lecture);
  }
  if (row.opts?.length && (row.conn === 'or' || row.conn === 'mixed')) {
    for (const g of row.opts) {
      const notes = g.map((i) => row.gt[i]).filter((t): t is GatechTarget => Boolean(t));
      if (notes.length === 0 || !notes.every((t) => isLab(t) || isNoCredit(t))) continue;
      for (const t of notes) {
        const m = t.title.match(LINE_CODE) ?? (isLab(t) && row.lab && row.lab !== 'section' ? row.lab.match(LINE_CODE) : null);
        if (m) add(`${m[1]} ${m[2]}`);
      }
    }
  }
  return out;
}

/**
 * A lab whose row's class is its lecture and lab together, when no lecture
 * on the record earns that credit (not there, withdrawn, or below the
 * grade): Kennesaw State's CHEM 1211L is CHEM 1211K (4 hours) and its CHEM
 * 1211's credit is "Awarded w/ CHEM 1211L"; Georgia State's PHYS 2211L is
 * "PHYS 2211 or ET NOGT, Verify PHYS 2211". The class is not booked as done
 * (the plan never scheduled it for a student holding 1 hour of it,
 * 2026-11-12 review: "Confirmed: Counts as PHYS 2211" for the lab alone).
 * The lab counts its own hours for now, says why, and keeps the class among
 * its choices (proposals); its answer and class are kept (labAnswer,
 * labClass), so it books the class again when the lecture arrives on
 * another page (withLabClass). `carrying` are the lines that carry a
 * lecture's credit already. Changes the array's slots.
 */
function waitOnLecture(courses: TranscriptCourseRecord[], table: GatechTransferTable, carrying: ReadonlySet<number>): void {
  courses.forEach((lab, j) => {
    const b = lab.basis;
    const booked = lab.matched;
    if (carrying.has(j) || !b || b.sourceKind !== 'gatech-table' || b.badge !== 'course' || lab.matchedBy !== 'official' || !booked || !lab.use || lab.counts !== 'course' || !earnsHours(lab)) return;
    const ref = b.row?.match(/^gatech-transfer\/([^/]+)\.json#(.+)$/);
    const file = ref ? table.schools[ref[1]] : null;
    const row = ref && file ? file.rows.find((r) => r.id === ref[2]) : null;
    if (!file || !row) return;
    // A lab, by its code or either title: a lecture-numbered class that carries another's credit (UGA's PHYS 2212, named by PHYS 1252) keeps its answer.
    if (!labLike(lab.code, lab.title, row.title)) return;
    const lectures = labLectures(lab, row, file);
    if (lectures.length === 0) return;
    const keys = new Set(lectures.map(codeKey));
    // The lecture printed with another section letter (honors CHEM 1211H for CHEM 1211; USC's BIOL 101 beside the table's BIOL 101A), never another lab: Georgia Southern's CHEM 2212L still waits on CHEM 2211L.
    const bases = new Set(lectures.filter((l) => !/\d[A-Z]?L$/.test(codeKey(l)) && !looksLab(l, null)).map(baseKey));
    const on = courses.filter((c, k) => k !== j && sameSchool(c, lab) && (keys.has(codeKey(c.code)) || (bases.has(baseKey(c.code)) && !labLine(c))));
    // A lecture that counts: as a class (the student's pick too), or as hours.
    if (on.some((c) => earnsHours(c) && c.use && c.counts !== 'none')) return;
    // Named in the sentence: the lecture on the record, else the one the lab is numbered after (GEOL 1121 for GEOL 1121L), else the first.
    const lecture = on[0]?.code ?? lectures.find((l) => `${codeKey(l)}L` === codeKey(lab.code)) ?? lectures[0];
    const label = b.sourceLabel ?? "Georgia Tech's transfer table";
    const { matchedBy, also, illinoisCredits, proposals, ...rest } = lab;
    const cls = [booked, ...(also ?? [])];
    // The class stays the student's to pick, as a possible choice: it is the table's answer only with the lecture.
    const choices = proposals?.map((p) => (cls.includes(p.code) ? { ...p, confidence: 'medium' as const, why: `${label} gives ${cls.join(' + ')} for this lab together with its lecture, ${lecture}.` } : p));
    const text = `${label} gives Georgia Tech ${cls.join(' + ')} for this lab together with its lecture, ${lecture}, and ${lecture} earns no credit on this record, so this line counts its own ${hoursText(lab.credits ?? 0)} for now. Add the lecture's page if you took it; Georgia Tech decides from your official transcript.`;
    courses[j] = {
      ...rest,
      matched: null,
      matchedBy: null,
      illinoisCredits: null,
      counts: 'hours',
      use: true,
      ...(choices ? { proposals: choices } : {}),
      labAnswer: { ...b, answer: b.answer ?? cls },
      labClass: { matched: booked, matchedBy, ...(also?.length ? { also } : {}), illinoisCredits: illinoisCredits ?? null, ...(proposals ? { proposals } : {}) },
      // 'elective', not 'not-evaluated': the class is the table's answer with the lecture, not a "may be" the plan holds as done (transfer-maybe.ts maybeLines).
      basis: { from: 'none', badge: 'elective', text, source: b.source ?? GATECH_TRANSFER_TABLE, checked: b.checked ?? null, tier: 'unknown', sourceKind: 'none', row: b.row ?? null, readAt: b.readAt ?? null, sourceLabel: label },
    };
  });
}

/**
 * The carried hours again after the student changed a line (setLineCounts),
 * no table needed: a lecture the student now counts on its own (hours, or a
 * class) carries nothing, and one set back to not counting carries again, so
 * the pair never counts the lecture twice. New array; the lines that change
 * are copies.
 */
export function settleGatechCarry(courses: TranscriptCourseRecord[]): TranscriptCourseRecord[] {
  if (!courses.some((c) => c.carried)) return courses;
  return courses.map((c, j) => {
    if (!c.carried) return c;
    const lines = c.carried.lines;
    const from = lines.flatMap((l) => {
      const lecture = courses.find((x, k) => k !== j && sameSchool(x, c) && codeKey(x.code) === codeKey(l.code) && (x.term ?? null) === (l.term ?? null));
      return lecture && earnsHours(lecture) && restsOnLab(lecture) ? [{ code: lecture.code, term: lecture.term, hours: lecture.credits ?? 0 }] : [];
    });
    const bare = withoutCarry(c);
    if (from.length === 0) return { ...bare, carried: { lines, printed: c.carried.printed, note: '' } };
    const next = withCarry(bare, from);
    return { ...next, carried: { ...next.carried!, lines } };
  });
}
