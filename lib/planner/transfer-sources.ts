/**
 * Where a transfer line's answer comes from, and how sure the planner is.
 *
 * Every transfer line matchTranscript returns carries a tier on its basis:
 *
 *   confirmed  an official row for this exact sending school and code (UGA's
 *              equivalency list, Georgia Tech's transfer table), a published
 *              guide's row (Parkland's guide to Illinois gen eds), or the
 *              student's own document printing the university's evaluation;
 *   rule       a published rule decides it (learning support earns nothing,
 *              UGA's one hour of physical education, Illinois's two-course
 *              Composition I, an IAI code's category, a C or better at
 *              Georgia Tech);
 *   likely     an inference, always named: UGA's answer at sister schools,
 *              the planner's table of common courses, an identical title, the
 *              AI step;
 *   review     the university says its department decides (Georgia Tech's
 *              "ET DEPT" rows), so nothing is identified yet;
 *   unknown    nothing published answers it; the hours still count.
 *
 * Identified = confirmed + rule + likely (the owner's finish line, Nov 10).
 * Review and unknown lines still count their hours toward graduation (owner's
 * decision), and their sentence says so plainly (transfer-wording.ts).
 *
 * The order matchTranscript asks the sources in, per destination, is
 * TRANSFER_LAYERS below: the document's own answer, the rules that settle a
 * line before any list is read (below college level; Georgia Tech's C or
 * better), the destination's official list (officialLookup: UGA's lists
 * today, Georgia Tech's table once transfer-gatech.ts is filled), the
 * labelled likely layers, the destination's published rule modules
 * (ruleAnswer: empty stubs today), and last, unknown. Labels only: a tier
 * never changes what a line counts as.
 */
import type { SchoolKey } from './school-config';
import type { TranscriptCourseRecord } from './transcript';
import { ILLINOIS_TRANSFERRING_CREDIT, UGA_TRANSFER_FAQ, ugaLookup, type TransferBasis, type UgaTransferTable } from './transfer-official';
import { gatechLookup, type GatechHit, type GatechTransferTable } from './transfer-gatech';

export type TransferTier = 'confirmed' | 'rule' | 'likely' | 'review' | 'unknown';

/** A short machine-readable name for the source of a line's answer. */
export type TransferSourceKind =
  // confirmed
  | 'uga-list'
  | 'gatech-table'
  | 'gened-guide'
  | 'document'
  // rule
  | 'remedial-rule'
  | 'vocational-rule'
  | 'tech-college-rule'
  | 'grade-rule'
  | 'pe-cap-rule'
  | 'repeat-rule'
  | 'composition-rule'
  | 'iai-rule'
  | 'subject-elective-rule'
  | 'uga-faq-rule'
  // likely
  | 'sister'
  | 'same-code'
  | 'curated'
  | 'title'
  | 'document-gened'
  | 'ai'
  // review
  | 'dept-review'
  // unknown
  | 'none';

/** Each source's tier and a few plain words for reports. */
export const SOURCE_KINDS: Readonly<Record<TransferSourceKind, { tier: TransferTier; label: string }>> = {
  'uga-list': { tier: 'confirmed', label: "UGA's transfer equivalency list for the sending school" },
  'gatech-table': { tier: 'confirmed', label: "Georgia Tech's transfer articulation table for the sending school" },
  'gened-guide': { tier: 'confirmed', label: "a published guide to Illinois gen eds (Parkland's)" },
  document: { tier: 'confirmed', label: "the student's own record or evaluation report" },
  'remedial-rule': { tier: 'rule', label: 'learning-support and remedial classes earn no credit' },
  'vocational-rule': { tier: 'rule', label: 'vocational classes earn no credit' },
  'tech-college-rule': { tier: 'rule', label: "UGA takes only general-education classes from a technical college" },
  'grade-rule': { tier: 'rule', label: 'Georgia Tech gives transfer credit for a C or better only' },
  'pe-cap-rule': { tier: 'rule', label: 'UGA counts at most 1 hour of physical education' },
  'repeat-rule': { tier: 'rule', label: 'a class counts once' },
  'composition-rule': { tier: 'rule', label: "Illinois's two-course Composition I" },
  'iai-rule': { tier: 'rule', label: "an IAI code's usual Illinois category" },
  'subject-elective-rule': { tier: 'rule', label: "Illinois's elective credit in the subject (SUBJ 1--)" },
  'uga-faq-rule': { tier: 'rule', label: "UGA's transfer FAQ" },
  sister: { tier: 'likely', label: "UGA's answer for the same course number at sister schools" },
  'same-code': { tier: 'likely', label: 'the same code at the destination' },
  curated: { tier: 'likely', label: "the planner's table of common courses" },
  title: { tier: 'likely', label: 'an identical title in the catalog' },
  'document-gened': { tier: 'likely', label: 'gen-ed categories the sending school prints' },
  ai: { tier: 'likely', label: "the planner's AI reading of the class" },
  'dept-review': { tier: 'review', label: 'the department evaluates it after admission' },
  none: { tier: 'unknown', label: 'no published answer' },
};

/** Whether a tier counts as identified for the finish line. */
export function isIdentified(tier: TransferTier | null | undefined): boolean {
  return tier === 'confirmed' || tier === 'rule' || tier === 'likely';
}

/**
 * The sources each destination asks, in matchTranscript's order (the repo
 * check holds every line's source to its destination's list). 'document'
 * and the remedial rule come first everywhere; the official list comes
 * after the rules that settle a line before any list is read.
 */
export const TRANSFER_LAYERS: Readonly<Record<SchoolKey, readonly TransferSourceKind[]>> = {
  uga: ['document', 'remedial-rule', 'uga-list', 'sister', 'tech-college-rule', 'curated', 'title', 'uga-faq-rule', 'ai', 'pe-cap-rule', 'repeat-rule', 'none'],
  illinois: ['document', 'remedial-rule', 'vocational-rule', 'curated', 'title', 'subject-elective-rule', 'ai', 'gened-guide', 'document-gened', 'iai-rule', 'composition-rule', 'repeat-rule', 'none'],
  gatech: ['document', 'remedial-rule', 'grade-rule', 'gatech-table', 'dept-review', 'vocational-rule', 'same-code', 'curated', 'title', 'repeat-rule', 'none'],
};

/** The basis with its tier and source stamped; the tier is the source's unless `tier` says otherwise. */
export function stamp(
  basis: TransferBasis,
  sourceKind: TransferSourceKind,
  extra: { tier?: TransferTier; row?: string | null; readAt?: string | null; sourceLabel?: string | null; named?: string[] | null; answer?: string[] | null } = {},
): TransferBasis {
  const { tier, ...rest } = extra;
  return { ...basis, tier: tier ?? SOURCE_KINDS[sourceKind].tier, sourceKind, ...rest };
}

// ---- Official lists -----------------------------------------------------------

/** The tables a record's schools need, loaded by the browser before matching. */
export interface TransferTables {
  uga?: UgaTransferTable | null;
  gatech?: GatechTransferTable | null;
}

/** An official list's answer for one sending school and code, with the row that says so. */
export type OfficialHit =
  | {
      list: 'uga-list';
      /** The public/ file and key: "uga-transfer/005251.json#ENGL1101". */
      row: string;
      readAt: string;
      source: string;
      /** "UGA's equivalency list for Georgia State University". */
      label: string;
      uga: NonNullable<ReturnType<typeof ugaLookup>>;
    }
  | {
      list: 'gatech-table';
      row: string;
      readAt: string;
      source: string;
      label: string;
      gatech: GatechHit;
    };

/**
 * The destination's own list, first among the sources that are about this
 * student's school: UGA's equivalency lists (transfer-official.ts), Georgia
 * Tech's articulation table (transfer-gatech.ts; empty until that lane fills
 * gatechLookup). Illinois publishes none this planner may read.
 */
export function officialLookup(schoolId: SchoolKey, tables: TransferTables, school: string | null | undefined, code: string): OfficialHit | null {
  if (schoolId === 'uga') {
    const hit = ugaLookup(tables.uga ?? null, school, code);
    if (!hit) return null;
    return {
      list: 'uga-list',
      row: `uga-transfer/${hit.entry.key}.json#${code.toUpperCase().replace(/\s+/g, '')}`,
      readAt: hit.file.readAt,
      source: hit.file.source,
      label: `UGA's equivalency list for ${hit.entry.name}`,
      uga: hit,
    };
  }
  if (schoolId === 'gatech') {
    const hit = gatechLookup(tables.gatech ?? null, school, code);
    if (!hit) return null;
    return {
      list: 'gatech-table',
      row: `gatech-transfer/${hit.file.code}.json#${hit.rows.map((r) => r.id).join('+')}`,
      readAt: hit.file.readAt,
      source: tables.gatech?.index?.sourceUrl ?? 'https://oscar.gatech.edu/pls/bprod/wwsktrna.P_find_location',
      label: `Georgia Tech's transfer table for ${hit.entry.name}`,
      gatech: hit,
    };
  }
  return null;
}

// ---- Published rule modules -----------------------------------------------------

/** What a rule module is asked about one line. */
export interface RuleQuery {
  schoolId: SchoolKey;
  code: string;
  title: string | null;
  credits: number | null;
  grade: string | null;
  term: string | null;
  /** The sending school, as the line or the document names it. */
  school: string | null;
}

/** A rule's answer: hours or nothing, never a course (a course is a list's answer). */
export interface RuleAnswer {
  sourceKind: TransferSourceKind;
  counts: 'hours' | 'none';
  badge: TransferBasis['badge'];
  text: string;
  source: string | null;
  readAt?: string | null;
  /** Keep the title matcher's "may be" proposals on the line. */
  keepProposals?: boolean;
}

export interface TransferRuleModule {
  id: TransferSourceKind;
  schools: readonly SchoolKey[];
  /** The page the rule is published on. */
  source: string;
  /** What the rule says, in a sentence, for the people filling it in. */
  describe: string;
  answer(query: RuleQuery): RuleAnswer | null;
}

/**
 * Illinois: when Illinois has no matching class, it gives elective credit in
 * the subject ("KIN 1--"). EMPTY STUB: the Illinois lane fills it (plan I1:
 * the sending prefix to an Illinois subject, the level from the number, the
 * hours as printed; never for remedial or vocational lines, which the rules
 * before it settle). Returns nothing until then.
 */
export const ILLINOIS_SUBJECT_ELECTIVE: TransferRuleModule = {
  id: 'subject-elective-rule',
  schools: ['illinois'],
  source: ILLINOIS_TRANSFERRING_CREDIT,
  describe: "A transferable class with no matching Illinois course counts as elective hours in its subject (SUBJ 1--).",
  answer: () => null,
};

/**
 * UGA: the rules its transfer FAQ publishes for a class its lists do not name.
 * EMPTY STUB for the UGA lane (plan U2/U3). Returns nothing until then.
 */
export const UGA_FAQ_RULES: TransferRuleModule = {
  id: 'uga-faq-rule',
  schools: ['uga'],
  source: UGA_TRANSFER_FAQ,
  describe: "UGA's transfer FAQ rules for classes its equivalency lists do not name.",
  answer: () => null,
};

export const RULE_MODULES: readonly TransferRuleModule[] = [ILLINOIS_SUBJECT_ELECTIVE, UGA_FAQ_RULES];

/** The first published rule module for this destination that answers the line, after the likely layers. */
export function ruleAnswer(query: RuleQuery): RuleAnswer | null {
  for (const rule of RULE_MODULES) {
    if (!rule.schools.includes(query.schoolId)) continue;
    const answer = rule.answer(query);
    if (answer) return answer;
  }
  return null;
}

/**
 * A Georgia Tech line whose table answer gives its credit together with
 * another line that earns nothing on this record (transfer-gatech.ts
 * carryGatechLabHours): a lecture whose lab is not on the record or was
 * withdrawn ('lab'), or a lab whose credit sits on a lecture that earns none
 * ('lecture'). Its tier is unknown, since nothing credits the line as it
 * stands and it counts its own hours for now, but the table does answer it,
 * so it never reads "no published answer". `named` is the other line's code
 * when the table names it. `as` is the Georgia Tech class a lab's own row
 * gives with its lecture (Kennesaw State's CHEM 1211L is CHEM 1211K with CHEM
 * 1211; transfer-gatech.ts waitOnLecture). Null for any other line.
 */
export function labWaiting(line: Pick<TranscriptCourseRecord, 'basis' | 'labAnswer'>): { pair: 'lab' | 'lecture'; named: string | null; as?: string } | null {
  const b = line.basis;
  if (!line.labAnswer || !b || b.tier !== 'unknown') return null;
  const needs = b.text.match(/ gives Georgia Tech (.+?) for this lab together with its lecture, ([^,]+), and \2 earns no credit on this record\b/);
  if (needs) return { pair: 'lecture', named: needs[2], as: needs[1] };
  const lecture = b.text.match(/ together on ([^,]+), and \1 earns no credit on this record\b/);
  if (lecture) return { pair: 'lecture', named: lecture[1] };
  const lab = b.text.match(/ gives the credit for this class with its lab(?:, ([^,]+))?, and no lab line on this record earns\b/);
  return lab ? { pair: 'lab', named: lab[1] ?? null } : null;
}

// ---- Tiers on records saved before tiers existed ------------------------------------

/**
 * A line's tier and source: the stamped ones, or, on a record saved before
 * 2026-11-10, the ones its basis implies. Null for a line that is not a
 * transfer line (the student's own school's course, with no basis).
 */
export function tierOf(line: Pick<TranscriptCourseRecord, 'basis' | 'matchedBy' | 'counts' | 'equivalent' | 'proposals' | 'genEdTags'>): { tier: TransferTier; sourceKind: TransferSourceKind } | null {
  const b = line.basis;
  if (b?.tier && b.sourceKind) return { tier: b.tier, sourceKind: b.sourceKind };
  return legacyTier(line);
}

/** The tier a basis written before tiers implies (and what matchTranscript stamps, which the repo check compares). */
export function legacyTier(line: Pick<TranscriptCourseRecord, 'basis' | 'matchedBy' | 'counts' | 'equivalent' | 'proposals' | 'genEdTags'>): { tier: TransferTier; sourceKind: TransferSourceKind } | null {
  const b = line.basis;
  const of = (sourceKind: TransferSourceKind) => ({ tier: SOURCE_KINDS[sourceKind].tier, sourceKind });
  if (!b) return line.matchedBy === 'printed' || line.equivalent ? of('document') : null;
  const text = b.text ?? '';
  if (/^A repeat of |already counts as /.test(text)) {
    if (/already counts as /.test(text) && b.from === 'none') return { tier: 'likely', sourceKind: /the planner's estimate/.test(text) ? 'ai' : 'title' };
    return of('repeat-rule');
  }
  switch (b.from) {
    case 'document':
      return /^The document lists it for /.test(text) ? of('document-gened') : of('document');
    case 'official':
      if (/^Together with |^Completes Composition I /.test(text)) return of('composition-rule');
      if (/guide to Illinois gen eds/.test(text)) return of('gened-guide');
      return of('uga-list');
    case 'sisters':
      return of('sister');
    case 'rule':
      if (/physical education/.test(text)) return of('pe-cap-rule');
      if (/IAI code/.test(text)) return of('iai-rule');
      if (/below college level|learning support|remedial/.test(text)) return of('remedial-rule');
      if (/vocational/.test(text)) return of('vocational-rule');
      if (/technical college/.test(text)) return of('tech-college-rule');
      if (/C or better/.test(text)) return of('grade-rule');
      return { tier: 'rule', sourceKind: 'uga-faq-rule' };
    default:
      if (/the planner's estimate|^Elective credit/.test(text)) return of('ai');
      if (b.badge === 'course') {
        const why = line.proposals?.[0]?.why ?? '';
        return of(/^Its title shares/.test(why) ? 'title' : 'curated');
      }
      if (/^(May be |Check this one)/.test(text)) return { tier: 'unknown', sourceKind: 'ai' };
      return of('none');
  }
}
