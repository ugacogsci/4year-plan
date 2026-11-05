/**
 * Every transfer line decided: the lines the official lists, the table of
 * common equivalents and the title matcher could not settle go to a model,
 * once per transcript, with the target school's real candidate courses.
 *
 * Before (2026-11-04, the owner's own UGA transcript on Illinois): 32 of 43
 * transfer lines read "not yet evaluated". A university evaluates every
 * college-level course: as one of its courses, as elective credit in a
 * subject, or as no credit. This asks for exactly that, line by line, and
 * keeps the model honest:
 *   - it may only name a course from that line's candidates (codes that exist
 *     in the target catalog), never one it makes up;
 *   - an equivalent counts on its own only at high confidence; anything less
 *     is offered for the student to confirm, as the title matcher's guesses are;
 *   - whether a line earns credit at all stays with the published rules: the
 *     model's "no credit" only flags the line, and its hours keep counting;
 *   - an official list, a sister-school answer (transfer-sisters.ts), a
 *     document's printed equivalent, or the student's own choice is never
 *     sent, so it is never overridden.
 * Every decision is labelled an estimate with its one-line reason; the
 * school's own evaluation decides.
 */
import { z } from 'zod';
import { levelOf, prefixOf, proposeEquivalents, SUBJECT_MAP, titleTokens, type CatalogLite } from './transfer-match';
import { lineIsForeign, type TranscriptCourseRecord, type TranscriptRecord } from './transcript';

export type AiSchool = 'uga' | 'illinois';

export interface AiCandidate { code: string; title: string; credits: number }
export interface AiLine { line: number; code: string; title: string | null; credits: number | null; candidates: AiCandidate[]; subjects: string[] }

/** What the model returns: one entry per line, every field required (optional fields made the schema "too complex"). */
export const TransferDecisions = z.object({
  decisions: z.array(z.object({
    line: z.number().int(),
    verdict: z.enum(['equivalent', 'elective', 'no_credit']),
    code: z.string(),
    subject: z.string(),
    level: z.number().int(),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  }).strict()),
}).strict();
export type TransferDecision = z.infer<typeof TransferDecisions>['decisions'][number];

/** UGA's subjects for another school's prefix, where they differ (USG schools share UGA's). */
const UGA_SUBJECTS: Record<string, string[]> = {
  ENG: ['ENGL'], WRT: ['ENGL'], WRIT: ['ENGL'], RHET: ['ENGL'], MAT: ['MATH'], MTH: ['MATH'], STA: ['STAT'],
  CHE: ['CHEM'], CHM: ['CHEM'], PHY: ['PHYS'], BIO: ['BIOL', 'CBIO', 'PBIO'], BIOS: ['BIOL', 'CBIO'], IB: ['BIOL', 'CBIO'], MCB: ['BIOL', 'CBIO', 'BCMB'],
  PSY: ['PSYC'], SOC: ['SOCI'], ECO: ['ECON'], ECN: ['ECON'], HIS: ['HIST'], HST: ['HIST'],
  POL: ['POLS', 'INTL'], PS: ['POLS', 'INTL'], PSC: ['POLS', 'INTL'], PSCI: ['POLS', 'INTL'], GOVT: ['POLS'],
  ACC: ['ACCT'], ACCY: ['ACCT'], BUS: ['BUSN', 'MGMT', 'LEGL'], BADM: ['BUSN', 'MGMT', 'MARK', 'LEGL'], FIN: ['FINA'], MKT: ['MARK'], MKTG: ['MARK'], MGT: ['MGMT'],
  CS: ['CSCI'], CSC: ['CSCI'], CIS: ['MIST', 'CSCI'], IS: ['MIST'], SPA: ['SPAN'], FRE: ['FREN'], FR: ['FREN'], GER: ['GRMN'],
  PHI: ['PHIL'], SPC: ['COMM'], SPCH: ['COMM'], CMN: ['COMM'], ART: ['ARTS', 'ARHI', 'ARST'], ARTH: ['ARHI'], MUS: ['MUSI'],
  ANT: ['ANTH'], GEO: ['GEOG', 'GEOL'], GGIS: ['GEOG'], AST: ['ASTR'], NUT: ['NUTR', 'FDNS'], FSHN: ['NUTR', 'FDST'],
  KIN: ['KINS'], HK: ['KINS'], PE: ['PEDB'], HPE: ['PEDB'], THE: ['THEA'], REL: ['RELI'], CMLT: ['CMLT'], CWL: ['CMLT'],
};

/** The target subjects a line could be in: the map's, and its own prefix when the target catalog has it. */
function subjectsFor(prefix: string, school: AiSchool, catalogSubjects: ReadonlySet<string>): string[] {
  const mapped = school === 'uga' ? UGA_SUBJECTS[prefix] ?? [] : SUBJECT_MAP[prefix] ?? [];
  return [...new Set([...mapped, ...(catalogSubjects.has(prefix) ? [prefix] : [])])].filter((s) => catalogSubjects.has(s));
}

/** The level band a course at another school sits in: 100 to 400. */
const bandOf = (code: string) => {
  const l = levelOf(code);
  return l === null ? null : Math.min(400, Math.max(100, l >= 1000 ? Math.floor(l / 1000) * 100 : l));
};

/**
 * The lines nothing else settled: another school's, counted as hours with no
 * official, printed or student answer, and not off for a grade.
 */
export function unsettledLines(record: TranscriptRecord, catalog: CatalogLite[], school: AiSchool): AiLine[] {
  const catalogSubjects = new Set(catalog.map((c) => c.code.split(' ')[0]));
  const out: AiLine[] = [];
  record.courses.forEach((c, i) => {
    if (!settleable(record, c)) return;
    const prefix = prefixOf(c.code);
    const subjects = subjectsFor(prefix, school, catalogSubjects);
    const band = bandOf(c.code);
    const fromTitles = proposeEquivalents({ code: c.code, title: c.title, credits: c.credits }, catalog, 10, school).map((p) => ({ code: p.code, title: p.title, credits: p.credits }));
    // The same subject at a nearby level, ranked by the words the titles share.
    const words = new Set(titleTokens(c.title ?? ''));
    const pool = catalog
      .filter((k) => subjects.includes(k.code.split(' ')[0]) && (band === null || Math.abs((k.level >= 1000 ? Math.floor(k.level / 1000) * 100 : k.level) - band) <= 100))
      .map((k) => ({ k, score: titleTokens(k.title).filter((t) => words.has(t)).length }))
      .sort((a, b) => b.score - a.score || a.k.code.localeCompare(b.k.code))
      .slice(0, 14)
      .map(({ k }) => ({ code: k.code, title: k.title, credits: k.credits }));
    const seen = new Set<string>();
    const candidates = [...fromTitles, ...pool].filter((k) => (seen.has(k.code) ? false : (seen.add(k.code), true))).slice(0, 20);
    out.push({ line: i, code: c.code, title: c.title, credits: c.credits, candidates, subjects });
  });
  return out;
}

/** A line the AI may decide: another school's, still hours, nobody's answer on it yet. */
function settleable(record: TranscriptRecord, c: TranscriptCourseRecord): boolean {
  if (!c.use || !(c.status === 'completed' || c.status === 'transfer' || c.status === 'in_progress')) return false;
  if (!lineIsForeign(record, c)) return false;
  if (c.counts !== 'hours') return false;
  // UGA's answer at sister schools (transfer-sisters.ts) is a published
  // answer for the same course number, so it is settled like the school's own list's.
  if (c.matchedBy === 'official' || c.matchedBy === 'sisters' || c.matchedBy === 'printed' || c.matchedBy === 'student' || c.maybeDeclined) return false;
  if (c.basis && c.basis.from !== 'none') return false;
  return true;
}

/** The decisions applied to the record: each line's verdict, badge and one-line reason. */
export function applyDecisions(record: TranscriptRecord, lines: AiLine[], decisions: TransferDecision[], catalog: CatalogLite[], school: AiSchool): TranscriptRecord {
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const catalogSubjects = new Set(catalog.map((c) => c.code.split(' ')[0]));
  const here = school === 'uga' ? 'UGA' : 'Illinois';
  const evaluation = school === 'uga' ? "UGA's transfer evaluation" : "Illinois's Transfer Course Evaluation Report";
  const asked = new Map(lines.map((l) => [l.line, l]));
  const courses = record.courses.map((c, i) => {
    const line = asked.get(i);
    const d = decisions.find((x) => x.line === i);
    if (!line || !d) return c;
    const reason = d.reason.trim().replace(/\s+/g, ' ').slice(0, 220);
    if (d.verdict === 'equivalent') {
      const course = line.candidates.some((k) => k.code === d.code) ? byCode.get(d.code) : undefined;
      if (!course) return c;
      const proposal = { code: course.code, title: course.title, credits: course.credits, confidence: d.confidence === 'high' ? 'high' as const : 'medium' as const, why: reason };
      if (d.confidence === 'high') {
        return {
          ...c,
          matched: course.code,
          matchedBy: 'proposal' as const,
          proposals: [proposal, ...(c.proposals ?? []).filter((p) => p.code !== course.code)],
          illinoisCredits: course.credits,
          counts: 'course' as const,
          basis: { from: 'none' as const, badge: 'course' as const, text: `Counted as ${course.code}, ${course.title}: the planner's estimate (${reason}). ${evaluation} decides.`, source: c.basis?.source ?? null },
        };
      }
      return {
        ...c,
        proposals: [proposal, ...(c.proposals ?? []).filter((p) => p.code !== course.code)],
        basis: { from: 'none' as const, badge: 'not-evaluated' as const, text: `May be ${course.code}, ${course.title} (${reason}). It counts as hours until you confirm it below; ${evaluation} decides.`, source: c.basis?.source ?? null },
      };
    }
    // Whether a line earns credit at all is decided by the schools' published
    // rules (remedial, vocational, technical-college lines in transcript.ts),
    // never by the model: its "no credit" only flags the line for a check,
    // and the hours keep counting (the owner, 2026-11-04: "no guessing").
    if (d.verdict === 'no_credit') {
      return { ...c, basis: { from: 'none' as const, badge: 'not-evaluated' as const, text: `Check this one: it may not earn credit at ${here} (${reason}). Its hours count until ${evaluation} says otherwise.`, source: c.basis?.source ?? null } };
    }
    if (d.verdict === 'elective') {
      const subject = catalogSubjects.has(d.subject) ? d.subject : null;
      const level = [100, 200, 300, 400].includes(d.level) ? d.level : null;
      // Sure that none of the title matcher's guesses is the same course: they are not offered; less sure, they stay to confirm.
      return {
        ...c,
        proposals: d.confidence === 'high' ? [] : c.proposals ?? [],
        basis: { from: 'none' as const, badge: 'elective' as const, text: `Elective credit${subject ? ` in ${subject}` : ''}${level ? ` at the ${level} level` : ''}: no single ${here} course matches (${reason}). Its hours count toward your total; ${evaluation} decides.`, source: c.basis?.source ?? null },
      };
    }
    return c;
  });
  return { ...record, courses };
}

/** The request the model reads: compact, one entry per line with its candidates. */
export function decisionPrompt(school: AiSchool, from: string | null, lines: AiLine[]): string {
  return JSON.stringify({
    target: school === 'uga' ? 'University of Georgia' : 'University of Illinois Urbana-Champaign',
    sending_school: from ?? 'another college',
    lines: lines.map((l) => ({ line: l.line, code: l.code, title: l.title, credits: l.credits, subjects_here: l.subjects, candidates: l.candidates.map((k) => `${k.code} | ${k.title} | ${k.credits}`) })),
  });
}

export const DECISION_SYSTEM = `You evaluate transfer credit the way a university registrar does. For each course line from the sending school, decide how it most likely transfers to the target university, using your knowledge of what courses with these titles, codes and credit hours cover.
- verdict "equivalent": the line is the same course as one of ITS candidates (same content and level). code must be copied exactly from that line's candidates; never write any other code. A lab equals a lab; a lecture-only course does not equal a lab; a non-majors course is not the majors course; an upper-level course is never an introductory one.
- verdict "elective": college-level, but no candidate is the same course. Give subject (one of subjects_here, or the closest target subject code you can see in the candidates) and level (100, 200, 300 or 400, from the line's own level). code "".
- verdict "no_credit": only for remedial or developmental courses below college level, orientation or study-skills courses that never carry credit, or purely vocational or technical training. code "".
- confidence "high" only when a registrar would agree without looking further; "medium" when it is likely; "low" when it is a guess.
- reason: at most 15 plain words, why (for example "both are first-semester principles of microeconomics").
Return exactly one decision for every line number given.`;
