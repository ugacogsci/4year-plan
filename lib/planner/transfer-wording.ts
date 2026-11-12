/**
 * The plain sentence for a transfer line, by how sure its answer is.
 *
 * One helper for every place a transfer line's outcome is shown (the
 * transcript review rows, the board's column of classes at another school),
 * so the same line reads the same everywhere. The owner's wording (plan.md
 * section 1, Nov 10 2026):
 *
 *   confirmed  "Counts as ENGL 1101 at UGA (UGA's equivalency list for Georgia
 *              State University, read Nov 2026)."
 *              "Counts as 3 elective hours at UGA (LEGL 3TXX on UGA's list). Not a specific class."
 *              "Counts toward UGA's core as a core elective (HIST 1GHX). Not a specific class."
 *              "Doesn't transfer to UGA (its equivalency list: not transferable)."
 *   rule       "Doesn't transfer: UGA gives no credit for learning-support or remedial classes."
 *   likely     "Probably counts as X at Y, based on <its basis>. Not confirmed."
 *   review     "<School> hasn't reviewed this class. Its department decides after
 *              you're admitted. Counted as N hours for now."
 *   unknown    "No published answer for this class yet. <School> decides when it
 *              reviews your transcript. Counted as N hours for now."
 *              A Georgia Tech lecture whose table credit comes with a lab that
 *              earns nothing on this record says that instead (chip "Needs
 *              its lab"): the table does answer it.
 *
 * Review and unknown lines keep counting their hours (owner's decision), and
 * the sentence says so. Nothing here says a line counts "until it is
 * evaluated": the hours count now, and the school's evaluation is what
 * decides in the end. The tier itself comes from transfer-sources.ts; a
 * record saved before tiers existed is read through tierOf.
 *
 * A line the student changed (another class, hours, or off) says what it
 * counts as now first, then what the source said, never that the source
 * backs the student's pick:
 *   "Counted as HIST 172 (your choice). Before your change: Probably counts
 *    as HIST 171 at Illinois, based on its title: ... Not confirmed."
 *   "Counted as BUS 201 (your choice). No published answer for this class
 *    yet. Illinois decides when it reviews your transcript."
 */
import type { TranscriptCourseRecord } from './transcript';
import { isIdentified, labWaiting, tierOf, type TransferSourceKind, type TransferTier } from './transfer-sources';

export interface TransferWording {
  tier: TransferTier;
  sourceKind: TransferSourceKind;
  identified: boolean;
  /** Two or three words over the line. */
  chip: string;
  /** Which of the chip colours the line takes (the stylesheets' basis-* classes). */
  tone: 'course' | 'core' | 'elective' | 'none' | 'not-evaluated';
  /** The plain sentence. */
  sentence: string;
  /** The same, short, for a card on the board. */
  short: string;
  /** More of the answer's own reason, when it adds something; never for review or unknown lines. */
  detail: string | null;
  /** The student set the line to something other than the answer. */
  changed: boolean;
}

/** What a sentence calls the school. */
export function schoolWord(schoolId: string | null | undefined): string {
  return schoolId === 'uga' ? 'UGA' : schoolId === 'gatech' ? 'Georgia Tech' : 'Illinois';
}

/** Words the owner asked never to see on a line again. */
export const RETIRED_WORDING = /until (it is|it's) evaluated|until (UGA|Illinois|Georgia Tech) evaluates it|not yet evaluated/i;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-04" -> "Nov 2026"; anything else as is. */
function readWhen(readAt: string | null | undefined): string | null {
  const m = String(readAt ?? '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : null;
}

const num = (n: number) => String(Math.round(n * 100) / 100);
function hoursWords(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'its hours';
  return `${num(n)} ${n === 1 ? 'hour' : 'hours'}`;
}

/**
 * A text's sentences. A period after a lone capital, a roman numeral or
 * initials ("V. Social Sciences", "U.S. history") does not end one.
 */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const end = /[.!?]\s+(?=[A-Z])/g;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const word = text.slice(start, m.index).split(/\s+/).pop() ?? '';
    if (/^\(?(?:[A-Z]|[IVX]+|[A-Z](?:\.[A-Z])+)$/.test(word)) continue;
    out.push(text.slice(start, m.index + 1).trim());
    start = m.index + m[0].length;
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** The sentences after the first, when the basis has more to say. */
function rest(text: string): string | null {
  const more = sentences(text).slice(1).join(' ').trim();
  return more || null;
}

type LineLike = Pick<TranscriptCourseRecord, 'basis' | 'use' | 'counts'> & Partial<Pick<TranscriptCourseRecord, 'matched' | 'also' | 'proposals' | 'matchedBy' | 'equivalent' | 'genEdTags'>>;

/** Whether the student has set the line to something other than what the answer said. */
export function lineChanged(c: LineLike): boolean {
  const badge = c.basis?.badge;
  if (!badge) return false;
  if (badge === 'course') {
    if (!(c.use && c.counts === 'course')) return true;
    // Another class picked in the line's list, for every source: the answer's own class is kept on the
    // basis (transcript.ts finishTiers). A record saved before that can point elsewhere only through
    // its proposals, so a line without any still counts as its answer.
    if (!c.basis?.answer?.length && !c.proposals?.length) return false;
    const head = answerCodes(c)?.[0] ?? null;
    return head !== null && c.matched !== head;
  }
  if (badge === 'none') return c.use && c.counts !== 'none';
  return !(c.use && c.counts === 'hours');
}

const CODE = String.raw`[A-Z]{2,5} \d{3,4}[A-Z]{0,2}`;
const CODES = String.raw`${CODE}(?: \+ ${CODE})*`;
/** How the matcher's own texts name the classes a course answer books, newest first. */
const ANSWER_WORDS = [
  new RegExp(String.raw`makes it (?:UGA|Georgia Tech) (${CODES})`),
  new RegExp(String.raw`so it counts as (${CODES})\.`),
  new RegExp(String.raw`(?:lists|prints) it as (${CODES})\.`),
  new RegExp(String.raw`^Counted as (${CODES})[,.]`),
  /Composition I \((RHET 105)\)/,
];

/**
 * The classes a course line's own answer books: kept on the basis when the
 * match finished (transcript.ts finishTiers; the AI step's own), or, on a
 * record saved before that, read from the line: the matcher's pick heads the
 * proposals of the sources that offer them; otherwise the class the line
 * still counts as, or the class its basis names. Null for a line whose answer
 * is not a class.
 */
export function answerCodes(c: LineLike): string[] | null {
  const b = c.basis;
  if (!b || b.badge !== 'course') return null;
  if (b.answer?.length) return b.answer;
  const kind = tierOf({ basis: b, counts: c.counts, matchedBy: c.matchedBy ?? null, equivalent: c.equivalent ?? null, proposals: c.proposals, genEdTags: c.genEdTags })?.sourceKind;
  const head = c.proposals?.[0];
  if (head && !head.pairedWith && (kind === 'curated' || kind === 'title' || kind === 'ai' || kind === 'gatech-table' || kind === 'same-code')) {
    return [head.code, ...(c.proposals ?? []).filter((p) => p.pairedWith === head.code).map((p) => p.code)];
  }
  if (!c.proposals?.length && c.use && c.counts === 'course' && c.matched) return [c.matched, ...(c.also ?? [])];
  for (const words of ANSWER_WORDS) {
    const m = b.text.match(words);
    if (m) return m[1].split(' + ');
  }
  return null;
}

/** The line as its answer left it: the classes, hours or nothing the source gave, before any change of the student's. */
function answeredLine(line: TranscriptCourseRecord): TranscriptCourseRecord {
  const badge = line.basis?.badge;
  if (badge === 'none') return { ...line, use: false, counts: 'none', matched: null, also: undefined };
  if (badge !== 'course') return { ...line, use: true, counts: 'hours', matched: null, also: undefined };
  const codes = answerCodes(line);
  return { ...line, use: true, counts: 'course', matched: codes?.[0] ?? null, also: codes && codes.length > 1 ? codes.slice(1) : undefined };
}

/** What a line the student changed counts as now, in the sentence's words and the card's. */
function nowWords(line: TranscriptCourseRecord, kind: TransferSourceKind, label: string): { sentence: string; short: string } {
  const codes = line.matched ? [line.matched, ...(line.also ?? [])].join(' + ') : null;
  if (line.use && line.counts === 'course' && codes) {
    // One of the other classes Georgia Tech's row allows (transfer-gatech.ts tableChoices): the table's own option, still the student's pick.
    const allows = (kind === 'gatech-table' || kind === 'dept-review') && line.proposals?.some((p) => p.code === line.matched) ? `; ${label} allows ${line.also?.length ? 'them' : 'it'}` : '';
    return { sentence: `Counted as ${codes} (your choice${allows}).`, short: `Counts as ${codes} (your choice)` };
  }
  const hrs = hoursWords(line.equivalentCredits ?? line.credits ?? line.assumedCredits ?? null);
  if (line.use && line.counts === 'hours') return { sentence: `Counted as ${hrs} toward your total (your choice), not as a specific class.`, short: `Counts as ${hrs} (your choice)` };
  return { sentence: 'Not counted (your choice).', short: 'Not counted (your choice)' };
}

/**
 * The wording for one line, or null when it is not a transfer line (the
 * student's own school's class, or a class they typed).
 */
export function transferWording(
  line: TranscriptCourseRecord,
  opts: { schoolId?: string | null; catalog?: ReadonlyMap<string, { code: string; title: string }> | null } = {},
): TransferWording | null {
  const b = line.basis;
  const t = tierOf(line);
  if (!b || !t) return null;
  const here = schoolWord(opts.schoolId);
  const { tier, sourceKind } = t;
  const changed = lineChanged(line);
  // A line the student changed reads its source's answer from the line as that answer left it.
  const said = answerWords(changed ? answeredLine(line) : line, tier, sourceKind, here, opts.catalog ?? null, changed);
  let { sentence, short } = said;
  if (changed) {
    // What the line counts as now comes first (the assistant reads this sentence as the line's
    // outcome, planner-workspace.tsx prior_credit), then what the source said.
    const now = nowWords(line, sourceKind, said.label);
    const source = tier === 'review' || tier === 'unknown' ? said.sentence : `Before your change: ${b.badge === 'course' && !answerCodes(line) ? b.text : said.sentence}`;
    sentence = `${now.sentence} ${source}`;
    short = now.short;
  }
  const detailRaw = tier === 'review' || tier === 'unknown' || said.usedText ? null : rest(b.text);
  const detail = detailRaw && !RETIRED_WORDING.test(detailRaw) ? detailRaw : null;
  const wait = labWaiting(line);
  const chip = wait ? (wait.pair === 'lab' ? 'Needs its lab' : 'Needs its lecture') : chipOf(tier, b.badge, sourceKind, b.text);
  const tone: TransferWording['tone'] = b.badge === 'none' && tier !== 'unknown' && tier !== 'review' ? 'none' : tier === 'confirmed' ? 'course' : tier === 'rule' ? 'core' : tier === 'likely' ? 'elective' : 'not-evaluated';
  return { tier, sourceKind, identified: isIdentified(tier), chip, tone, sentence, short, detail, changed };
}

/**
 * The sentence and the card for a line as it stands, from its answer.
 * `asSource` (a line the student changed, read as its answer left it) leaves
 * out what a review or unknown line counts as for now.
 */
function answerWords(
  line: TranscriptCourseRecord,
  tier: TransferTier,
  sourceKind: TransferSourceKind,
  here: string,
  catalog: ReadonlyMap<string, { code: string; title: string }> | null,
  asSource: boolean,
): { sentence: string; short: string; usedText: boolean; label: string } {
  const b = line.basis!;
  const hours = line.equivalentCredits ?? line.credits ?? line.assumedCredits ?? null;
  const hrs = hoursWords(hours);
  const counted = line.use && line.counts !== 'none';
  const codes = line.matched ? [line.matched, ...(line.also ?? [])].join(' + ') : null;
  const when = readWhen(b.readAt ?? b.checked ?? null);
  const label = labelOf(b, sourceKind, here);
  const cited = `${label}${when ? `, read ${when}` : ''}`;
  const desig = line.designation ?? null;
  const tags = line.genEdTags?.length ? line.genEdTags.join(', ') : null;
  const titleOf = (code: string) => catalog?.get(code)?.title ?? line.proposals?.find((p) => p.code === code)?.title ?? null;
  const named = namedOf(b);
  const forNow = asSource ? '' : ` ${counted ? `Counted as ${hrs} for now.` : 'Not counted for now.'}`;
  let sentence: string;
  let short: string;
  let usedText = false;

  if (tier === 'review') {
    sentence = `${here} hasn't reviewed this class. Its department decides after you're admitted.${forNow}`;
    short = counted ? `Its department decides; counted as ${hrs} for now` : 'Its department decides';
  } else if (tier === 'unknown' && labWaiting(line)) {
    // Georgia Tech's table does answer it, together with a line this record does not credit (transfer-sources.ts labWaiting).
    const wait = labWaiting(line)!;
    const by = line.labAnswer?.sourceLabel ?? label;
    const other = wait.named ?? 'its lecture';
    sentence = wait.as
      ? `${by} gives Georgia Tech ${wait.as} for this lab together with its lecture, ${other}, and ${other} earns no credit on this record.${forNow} Add the lecture's page if you took it; Georgia Tech decides from your official transcript.`
      : wait.pair === 'lecture'
      ? `${by} gives the credit for this lab and its lecture together on ${other}, and ${other} earns no credit on this record.${forNow} Georgia Tech decides from your official transcript.`
      : `${by} gives this class's credit together with its lab${wait.named ? `, ${wait.named}` : ''}, and no lab line on this record earns it.${forNow} Add the lab's page if you took it; Georgia Tech decides from your official transcript.`;
    const comes = `Credit comes with ${wait.pair === 'lab' ? 'its lab' : other}`;
    short = counted ? `${comes}; counted as ${hrs} for now` : comes;
  } else if (tier === 'unknown') {
    const flag = aiFlag(sourceKind, b.text, here);
    sentence = `No published answer for this class yet.${flag ? ` ${flag}` : ''} ${here} decides when it reviews your transcript.${forNow}`;
    short = flag
      ? counted ? `May not earn credit; counted as ${hrs} for now` : 'May not earn credit'
      : counted ? `No published answer yet; counted as ${hrs} for now` : 'No published answer yet';
  } else if (b.badge === 'none') {
    const why = noneReason(sourceKind, here, b.text, line, label);
    sentence = why.sentence;
    short = why.short;
    usedText = why.usedText;
  } else if (tier === 'likely') {
    const outcome =
      b.badge === 'course' && codes
        ? `Probably counts as ${codes} at ${here}`
        : b.badge === 'core' && desig
          ? `Probably counts toward ${here}'s core as a core elective (${desig})`
          : b.badge === 'core' && tags
            ? `Probably counts as ${hrs} toward ${here}'s ${tags}`
            : b.badge === 'not-evaluated' && named?.length
              ? `Probably counts as ${named.join(' + ')} at ${here}, which ORION's course list doesn't include, so as ${hrs} here`
              : /already counts as /.test(b.text)
                ? `Probably counts as ${hrs} of elective credit (${b.text.replace(/, so this one counts as elective hours\.$/, '')})`
                : `Probably counts as ${hrs} of elective credit${electiveSubject(b.text, desig) ? ` in ${electiveSubject(b.text, desig)}` : ''} at ${here}${desig ? ` (${desig})` : ''}`;
    const miss = listMiss(b.text);
    sentence = `${outcome}, based on ${likelyBasis(sourceKind, here, label, line, titleOf)}. Not confirmed${miss ? `: ${miss}` : ''}.`;
    short = b.badge === 'course' && codes ? `Probably ${codes} at ${here}; not confirmed` : `Probably ${hrs} of credit at ${here}; not confirmed`;
  } else if (tier === 'confirmed') {
    if (b.badge === 'course' && codes) {
      // "MATH 3300 + MATH 3TXX": the list's elective hours beside the course.
      const extra = b.text.match(/; the list also shows ([^.]+?) for it\./)?.[1] ?? null;
      sentence = `Counts as ${codes} at ${here} (${cited}).${extra ? ` The list also gives ${extra} for it.` : ''}`;
      short = `Counts as ${codes} at ${here}`;
    } else if (b.badge === 'core' && desig) {
      sentence = `Counts toward ${here}'s core as a core elective (${desig} on ${cited}). Not a specific class${line.coreArea ? `; it usually fills ${line.coreArea}` : ''}.${/GHX/.test(desig) ? ` It also meets ${here}'s U.S. history requirement.` : ''}`;
      short = `${here} core elective (${desig})`;
    } else if (b.badge === 'core' && tags) {
      sentence = `Counts as ${hrs} toward ${here}'s ${tags} (${cited}). Not a specific class.`;
      short = `${hrs} toward ${tags}`;
    } else if (b.badge === 'elective' && desig) {
      sentence = `Counts as ${hrs} of elective credit at ${here} (${desig} on ${cited}). Not a specific class.`;
      short = `${hrs} of elective credit at ${here} (${desig})`;
    } else if (b.badge === 'elective' && (line.equivalent || /\d--$/.test(line.code))) {
      const printed = line.equivalent ?? line.code;
      sentence = `Counts as ${hrs} in ${printed.split(' ')[0]} at ${here} (${printed} on ${cited}). Not a specific class.`;
      short = `${hrs} in ${printed.split(' ')[0]} at ${here}`;
    } else if (b.badge === 'not-evaluated' && (named?.length || sourceKind === 'document')) {
      const names = named?.length ? named : [line.code];
      const labs = names.map((code) => labOf(code, catalog)).filter((x): x is { lab: string; base: string; title: string } => x !== null);
      const all = names.join(' + ');
      sentence = labs.length === names.length
        ? `Counts as ${all} at ${here} (${cited}): the lab${labs.length > 1 ? 's' : ''} for ${labs.map((l) => `${l.base}, ${l.title}`).join(' and ')}. ORION books ${labs.length > 1 ? 'those labs' : 'that lab'} together with ${labs.length > 1 ? 'their lectures' : 'its lecture'}, so this line counts as ${hrs}.`
        : `Counts as ${all} at ${here} (${cited}). ORION's ${here} course list doesn't include ${names.length > 1 ? 'those classes' : 'that class'}, so it counts as ${hrs}.`;
      short = `Counts as ${all} at ${here} (${hrs} here)`;
    } else {
      sentence = `${b.text}`;
      short = firstSentence(b.text);
      usedText = true;
    }
  } else {
    // A published rule that gives hours.
    if (sourceKind === 'pe-cap-rule') {
      sentence = `${hoursWords(line.equivalentCredits ?? null)} of its ${hoursWords(line.credits)} count: ${here} counts at most 1 hour of physical education from other schools.`;
      short = `${hoursWords(line.equivalentCredits ?? null)} of physical education count`;
    } else if (sourceKind === 'iai-rule' && tags) {
      sentence = `Counts as ${hrs} toward ${here}'s ${tags} (its IAI code's usual category). Not a specific class; your Transfer Course Evaluation Report decides.`;
      short = `${hrs} toward ${tags}`;
    } else if (sourceKind === 'composition-rule') {
      sentence = b.text;
      short = line.matched ? `Counts as ${codes} at ${here}, with its pair` : `${hrs}; completes Composition I`;
      usedText = true;
    } else if (sourceKind === 'iai-rule') {
      sentence = `Counts as ${hrs} at ${here}, not as a specific class. ${b.text}`;
      short = `${hrs} at ${here}`;
      usedText = true;
    } else {
      sentence = b.text;
      short = firstSentence(b.text);
      usedText = true;
    }
  }

  return { sentence, short, usedText, label };
}

/** The AI step's "may not earn credit" (transfer-ai.ts no_credit): a flag to check, while the hours still count. */
function aiFlag(kind: TransferSourceKind, text: string, here: string): string | null {
  if (kind !== 'ai' || !/^Check this one\b/.test(text)) return null;
  const why = text.match(/^Check this one: it may not earn credit at .+? \((.*)\)\. Its hours count\b/)?.[1] ?? null;
  return `Check it: ORION's AI reading says it may not earn credit at ${here}${why ? ` (${why})` : ''}.`;
}

/** The source in plain words: the basis's own label, or on a record saved before labels, the one its text gives. */
function labelOf(b: NonNullable<TranscriptCourseRecord['basis']>, kind: TransferSourceKind, here: string): string {
  return b.sourceLabel ?? legacyLabel(kind, b.text) ?? defaultLabel(kind, here);
}

/** A record saved before 2026-11-10 names its source only in its text: the same label matchTranscript gives now. */
function legacyLabel(kind: TransferSourceKind, text: string): string | null {
  switch (kind) {
    case 'uga-list':
      return text.match(/^(UGA's equivalency list for .+?) (?:makes it|gives it|marks it|\(checked)/)?.[1] ?? null;
    case 'sister': {
      const give = text.match(/^UGA's transfer lists for (\d+ other .+?\)) give /);
      if (give) return `UGA's lists for ${give[1]}`;
      const none = text.match(/ at (\d+ other [^(]+?) \((.+?): NTFR on UGA's transfer lists for each\)/);
      return none ? `UGA's lists for ${none[1]} (${none[2]})` : null;
    }
    case 'gened-guide': {
      // "Parkland College's guide to Illinois gen eds (08/01/2025 to 07/31/2026, expired)": transcript.ts guideLabel's words.
      const m = text.match(/^(.+?)'s guide to Illinois gen eds(?: \(([^)]*)\))?/);
      if (!m) return null;
      const years = m[2]?.match(/(\d{4})\D+\d{2}\/\d{2}\/(\d{4})/);
      return `${m[1]}'s ${years ? `${years[1]}-${years[2].slice(2)} ` : ''}guide to Illinois gen eds${/expired/.test(m[2] ?? '') ? ', now expired' : ''}`;
    }
    case 'document': {
      const m = text.match(/^Your (UGA|Illinois|Georgia Tech) record /);
      return m ? `your ${m[1]} record` : null;
    }
    default:
      return null;
  }
}

function defaultLabel(kind: TransferSourceKind, here: string): string {
  switch (kind) {
    case 'uga-list':
      return "UGA's equivalency list";
    case 'gatech-table':
      return "Georgia Tech's transfer table";
    case 'gened-guide':
      return 'the published gen-ed guide';
    case 'document':
      return 'your document';
    case 'sister':
      return "UGA's lists for sister schools";
    default:
      return `${here}'s published rules`;
  }
}

/**
 * The classes an answer names that ORION's catalog does not list: the
 * basis's own list, or on a record saved before 2026-11-10 (no `named`), the
 * ones its text names ("give UGA PHYS 1111L for this same course number,
 * which this planner's catalog does not list").
 */
function namedOf(b: NonNullable<TranscriptCourseRecord['basis']>): string[] | null {
  if (b.named?.length) return b.named;
  if (b.badge !== 'not-evaluated') return null;
  const m = b.text.match(new RegExp(String.raw`(?:give UGA|makes it UGA|makes it Georgia Tech) (${CODES})(?: for this same course number)?, which (?:this planner's catalog|ORION's course list) does not`));
  return m ? m[1].split(' + ') : null;
}

/** The lab a code names when the catalog books it with its lecture ("PHYS 1111L" with "PHYS 1111-1111L"). */
function labOf(code: string, catalog: ReadonlyMap<string, { code: string; title: string }> | null): { lab: string; base: string; title: string } | null {
  const m = code.match(/^([A-Z]{2,5} \d{4})L$/);
  if (!m) return null;
  const base = catalog?.get(m[1]);
  return base ? { lab: code, base: m[1], title: base.title } : catalog ? null : { lab: code, base: m[1], title: 'its lecture' };
}

function firstSentence(text: string): string {
  return (sentences(text)[0] ?? text).replace(/\.$/, '');
}

/** What a UGA line's basis says about the school's own list, when it has no row for the class. */
function listMiss(text: string): string | null {
  const miss = text.match(/^(UGA's equivalency list for .+?) \(checked [^)]*\) does not include this course/);
  if (miss) return `${miss[1]} doesn't include it`;
  const none = text.match(/^This planner does not hold (UGA's equivalency list for .+?), so /);
  return none ? `ORION doesn't hold ${none[1]}` : null;
}

/** The subject an elective names: "Elective credit in KINS", or a designation's subject. */
function electiveSubject(text: string, desig: string | null): string | null {
  return text.match(/^Elective credit in ([A-Z]{2,5})\b/)?.[1] ?? desig?.match(/^([A-Z]{2,5}) /)?.[1] ?? null;
}

/** What a likely answer rests on, named. */
function likelyBasis(
  kind: TransferSourceKind,
  here: string,
  label: string,
  line: TranscriptCourseRecord,
  titleOf: (code: string) => string | null,
): string {
  switch (kind) {
    case 'sister':
      return `${label}, for the same course number`;
    case 'curated': {
      const why = line.proposals?.find((p) => p.code === line.matched)?.why ?? line.proposals?.[0]?.why ?? null;
      return `ORION's table of common classes${why ? ` (${why.replace(/^./, (ch) => ch.toLowerCase()).replace(/\.$/, '')})` : ''}`;
    }
    case 'title': {
      const title = line.matched ? titleOf(line.matched) : null;
      return title ? `its title: ${here}'s ${line.matched} is "${title}"` : 'its title';
    }
    case 'same-code':
      return `the same code at ${here}`;
    case 'document-gened':
      return 'the categories your document prints';
    case 'ai':
      return "ORION's AI reading of the class";
    default:
      return label;
  }
}

/** A line that does not count: the sentence says why, in the source's own terms. */
function noneReason(kind: TransferSourceKind, here: string, text: string, line: TranscriptCourseRecord, label: string): { sentence: string; short: string; usedText: boolean } {
  switch (kind) {
    case 'uga-list':
      return { sentence: `Doesn't transfer to UGA (${label}${readWhen(line.basis?.readAt ?? line.basis?.checked) ? `, read ${readWhen(line.basis?.readAt ?? line.basis?.checked)}` : ''}: not transferable).`, short: "Doesn't transfer to UGA", usedText: false };
    case 'gatech-table':
      if (/on its lab/.test(text)) return { sentence: `No hours on this line: ${text.replace(/^Georgia Tech's transfer table for [^,]*? gives/, "Georgia Tech's transfer table gives")}`, short: 'Credit comes with its lab', usedText: true };
      return { sentence: `Doesn't transfer to Georgia Tech (its transfer table: no Georgia Tech credit).`, short: "Doesn't transfer to Georgia Tech", usedText: false };
    case 'document':
      return { sentence: /NTFR/.test(text) ? `Doesn't transfer to ${here} (${label} marks it NTFR).` : `Doesn't count: your document says it earns no credit.`, short: `Doesn't transfer to ${here}`, usedText: false };
    case 'sister':
      return { sentence: `Probably doesn't transfer to UGA, based on ${label}, which give no credit for the same course number. Not confirmed.`, short: "Probably doesn't transfer; not confirmed", usedText: false };
    case 'remedial-rule':
      return { sentence: `Doesn't transfer: ${here} gives no credit for learning-support or remedial classes.`, short: `Doesn't transfer (learning support)`, usedText: false };
    case 'vocational-rule':
      return { sentence: `Doesn't transfer: ${here} gives no credit for vocational (career-program) classes, and this looks like one.`, short: `Doesn't transfer (vocational)`, usedText: false };
    case 'tech-college-rule':
      return { sentence: `Doesn't transfer: UGA takes only general-education classes from a technical college, and UGA's list doesn't name this one as one.`, short: "Doesn't transfer (technical college)", usedText: false };
    case 'grade-rule':
      return { sentence: `Doesn't count: Georgia Tech gives transfer credit only for a C or better.`, short: "Doesn't count (below a C)", usedText: false };
    case 'pe-cap-rule':
      return { sentence: `Doesn't count: UGA counts at most 1 hour of physical education from other schools, and another line already uses it.`, short: "Doesn't count (PE limit)", usedText: false };
    case 'repeat-rule':
      return { sentence: `Counted once: it repeats ${line.code}, which already counts.`, short: 'Counted once (a repeat)', usedText: false };
    default:
      return { sentence: text, short: firstSentence(text), usedText: true };
  }
}

/** Two or three words over the line. */
function chipOf(tier: TransferTier, badge: string, kind: TransferSourceKind, text: string): string {
  if (tier === 'review') return 'Department decides';
  if (tier === 'unknown') return 'No answer yet';
  if (badge === 'none') {
    if (kind === 'repeat-rule') return 'Counted once';
    // Georgia Tech's ET LAB: the class does transfer, on its lab's line (transfer-gatech.ts gatechOfficialLine).
    if (kind === 'gatech-table' && /on its lab/.test(text)) return 'Credit on its lab';
    if (tier === 'likely') return 'Probably no credit';
    return kind === 'grade-rule' || kind === 'pe-cap-rule' ? 'Not counted' : "Doesn't transfer";
  }
  return tier === 'confirmed' ? 'Confirmed' : tier === 'rule' ? 'Published rule' : 'Probably';
}
