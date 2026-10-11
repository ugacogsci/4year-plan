'use client';

/**
 * The AP and IB credit a school grants, loaded once and shared.
 *
 * Two screens need the same table and they run minutes apart. Onboarding needs
 * it to price the exams a student reports, and the planner needs it again to
 * put those courses on the board before the first term is scheduled. Fetching
 * it twice would be two chances for one of them to quietly get nothing.
 */

import { useEffect, useState } from 'react';
import { examRows, grantCode, type ExamCreditEntry, type PriorExam, type School } from '@/lib/planner/onboarding';

export interface ExamCreditTable {
  entries: ExamCreditEntry[];
  /** The registrar's own statement of which entering terms the table covers. */
  policy: string;
  /** The page a student can check it against. */
  source: string;
}

const EMPTY: ExamCreditTable = { entries: [], policy: '', source: '' };

/**
 * Where a school's exam table lives.
 *
 * SCHOOLS carries this for UGA and nothing else, and adding Illinois to it
 * means editing lib/planner/onboarding.ts, which another agent owns. The
 * Illinois file is named here instead so the control works today; the right
 * home for this line is the School record, and it should move there.
 */
export function examCreditUrl(school: School | undefined): string | null {
  if (!school) return null;
  if (school.examCredit) return school.examCredit;
  if (school.id === 'illinois') return '/illinois-exam-credit.json';
  return null;
}

let cache: { url: string; table: Promise<ExamCreditTable> } | null = null;

export function loadExamCredit(url: string | null): Promise<ExamCreditTable> {
  if (!url) return Promise.resolve(EMPTY);
  if (cache?.url === url) return cache.table;
  const table = fetch(url)
    .then((res) => (res.ok ? (res.json() as Promise<Partial<ExamCreditTable>>) : null))
    .then((data) => ({
      entries: data?.entries ?? [],
      policy: data?.policy ?? '',
      source: data?.source ?? '',
    }))
    .catch(() => {
      // A table that did not load must not be remembered as an empty one, or a
      // student who reloads gets "no credit" for the rest of the session.
      cache = null;
      return EMPTY;
    });
  cache = { url, table };
  return table;
}

export function useExamCredit(school: School | undefined): ExamCreditTable {
  const url = examCreditUrl(school);
  /**
   * The url is stored with the table so the old school's table is never handed
   * back for the new one. Clearing it in the effect instead would mean one
   * render where a student who just switched schools is shown another school's
   * credit, and it would be a synchronous setState inside an effect.
   */
  const [loaded, setLoaded] = useState<{ url: string | null; table: ExamCreditTable }>({
    url: null,
    table: EMPTY,
  });

  useEffect(() => {
    let cancelled = false;
    void loadExamCredit(url).then((table) => {
      if (!cancelled) setLoaded({ url, table });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return loaded.url === url ? loaded.table : EMPTY;
}

/**
 * The catalog courses a student's exams actually earn them.
 *
 * Illinois writes elective credit as "HIST 1--", which is real hours in a real
 * subject and is not a course anybody can be placed out of. Those are left out
 * here, because what comes back is fed to the planner as courses already
 * taken and a board cannot hold a course the catalog does not list; so is a
 * course the catalog no longer lists (AP 2-D Art grants "ART 105"). Their
 * hours are not lost: examElectiveHours counts them.
 */
const COURSE_CODE = /^[A-Z]{2,5} \d{3,4}[A-Z]?$/;

export function examCourses(
  exams: PriorExam[],
  table: ExamCreditEntry[],
  /** Whether the catalog lists a code. Without it every well-formed code is returned. */
  known?: (code: string) => boolean,
): string[] {
  if (exams.length === 0 || table.length === 0) return [];
  const out = new Set<string>();
  for (const taken of exams) {
    for (const row of examRows(taken, table)) {
      for (const raw of row.courses) {
        const code = grantCode(raw);
        if (COURSE_CODE.test(code) && (!known || known(code))) out.add(code);
      }
    }
  }
  return [...out];
}

/**
 * Hours an exam grants that no catalog course on the board carries.
 *
 * A row's hours are its catalog courses' hours plus the rest: "ECON 1--" is
 * all rest, "RHET 105 & ENGL 1--, 7 hours" is RHET 105's four plus three,
 * "ART 105, 3 hours" is three when the catalog has no ART 105, and "ARAB 403,
 * 3 hours" when the catalog gives ARAB 403 four hours is one fewer than the
 * catalog, because the registrar grants what the table says. The catalog
 * courses themselves are counted by the plan as courses already held.
 *
 * With no catalog to price against, rows naming a real course are left to
 * the plan and only subject hours are counted, which understates and never
 * overstates.
 */
export function examElectiveHours(
  exams: PriorExam[],
  table: ExamCreditEntry[],
  /**
   * Subject-hours codes the student's record already counts ("ECON 1--" as a
   * test-credit line on their Illinois academic history). An exam that grants
   * one of those is the same credit named twice, once by the student in the
   * picker and once by the registrar on the record, and is not added again.
   */
  alreadyCounted: Set<string> = new Set(),
  /** Catalog hours by code, or null when the catalog does not list it. */
  creditsOf?: (code: string) => number | null,
): number {
  if (exams.length === 0 || table.length === 0) return 0;
  let hours = 0;
  for (const taken of exams) {
    for (const row of examRows(taken, table)) {
      if (row.noCredit || row.credits <= 0) continue;
      const codes = row.courses.map(grantCode);
      const subjectHours = codes.filter((c) => !COURSE_CODE.test(c));
      const recorded = subjectHours.some((c) => alreadyCounted.has(c.toUpperCase().replace(/\s+/g, ' ').trim()));
      const real = codes.filter((c) => COURSE_CODE.test(c));
      if (!creditsOf) {
        if (real.length > 0 || recorded) continue;
        hours += row.credits;
        continue;
      }
      const catalogHours = real.reduce((sum, c) => sum + (creditsOf(c) ?? 0), 0);
      const rest = row.credits - catalogHours;
      // The record already lists this row's subject hours; only a correction downward is kept.
      hours += recorded ? Math.min(rest, 0) : rest;
    }
  }
  return Math.round(hours * 100) / 100;
}

/**
 * Calculus has one table for students entering Grainger and one for everyone
 * else, and a student picks one in onboarding before the plan knows their
 * college. An AB 4 is MATH 220 in both, but a note, a placement and the BC
 * subscore rows differ, so the plan prices each exam from the table for the
 * college of the degree it is planning, and says so when it switched.
 */
export function alignExamsToCollege(
  exams: PriorExam[],
  table: ExamCreditEntry[],
  grainger: boolean,
): { exams: PriorExam[]; switched: Array<{ from: string; to: string }> } {
  const switched: Array<{ from: string; to: string }> = [];
  const aligned = exams.map((taken) => {
    const m = taken.exam.match(/^(.*?)\s+-\s+Entering\s+(Grainger|Any College other than Grainger)$/i);
    if (!m) return taken;
    const isGrainger = /^Grainger$/i.test(m[2]);
    if (isGrainger === grainger) return taken;
    const other = `${m[1]} - Entering ${grainger ? 'Grainger' : 'Any College other than Grainger'}`;
    const candidate = { ...taken, exam: other };
    if (examRows(candidate, table).length === 0) return taken;
    switched.push({ from: taken.exam, to: other });
    return candidate;
  });
  return { exams: aligned, switched };
}

/**
 * The exams a document names (an AP score report, the test-credit block of a
 * record), matched to rows of the registrar's table so they can be priced.
 *
 * The reader writes "AP Calculus AB" and the table writes "CALCULUS AB -
 * Entering Grainger"; names are compared as word sets after spelling them one
 * way. Calculus has two tables and the caller says which applies. A score
 * whose credit depends on a condition ("3 with a subscore of 4", "4 or 5 (if
 * English Language Score is 4 or 5)", "4 W/AURAL SUBSCORE OF 5") is resolved
 * from the subscore the document prints and the other exams it names; when
 * nothing decides it, the row granting the least is taken, because the plan
 * must not count credit the student may not have. Only an exam with a score
 * the table lists is returned.
 */
/**
 * Official exam names the registrar's table spells another way: pattern,
 * kind, and the table's name. Checked before the word comparison. "Chinese B"
 * with no dialect is deliberately absent: the table prices Mandarin and
 * Cantonese differently, and guessing would grant the wrong courses.
 */
const OFFICIAL_NAMES: Array<[RegExp, 'AP' | 'IB', string]> = [
  [/^2-?D Art\s*(?:and|&)\s*Design$/i, 'AP', 'ART STUDIO: 2-D DRAWING'],
  [/^3-?D Art\s*(?:and|&)\s*Design$/i, 'AP', 'ART STUDIO: 3-D DRAWING'],
  [/^(?:Studio Art:?\s*)?Drawing$/i, 'AP', 'ART STUDIO: DRAWING'],
  [/^World History(?::?\s*Modern)?$/i, 'AP', 'HISTORY, WORLD'],
  [/^European History$/i, 'AP', 'HISTORY EUROPEAN'],
  [/^Physics 1(?::?\s*Algebra-?\s*Based)?$/i, 'AP', 'PHYSICS 1'],
  [/^Physics 2(?::?\s*Algebra-?\s*Based)?$/i, 'AP', 'PHYSICS 2'],
  [/^Physics C:?\s*Electricity\s*(?:and|&)\s*Magnetism$/i, 'AP', 'PHYSICS C: ELEC & MAG'],
  [/^Chinese(?: Language)?\s*(?:and|&)\s*Culture$/i, 'AP', 'CHINESE'],
  [/^Japanese(?: Language)?\s*(?:and|&)\s*Culture$/i, 'AP', 'JAPANESE'],
  [/^Italian(?: Language)?\s*(?:and|&)\s*Culture$/i, 'AP', 'ITALIAN'],
  [/^French Language(?:\s*(?:and|&)\s*Culture)?$/i, 'AP', 'FRENCH LANGUAGE'],
  [/^German Language(?:\s*(?:and|&)\s*Culture)?$/i, 'AP', 'GERMAN LANGUAGE'],
  [/^Spanish Language(?:\s*(?:and|&)\s*Culture)?$/i, 'AP', 'SPANISH LANGUAGE'],
  [/^Spanish Literature(?:\s*(?:and|&)\s*Culture)?$/i, 'AP', 'SPANISH LITERATURE'],
  [/^Math(?:ematics)?:?\s*Analysis\s*(?:and|&)\s*Approaches$/i, 'IB', 'MATH: ANALYSIS & APPROACHES'],
  [/^Math(?:ematics)?:?\s*Applications?\s*(?:and|&)\s*Interpretation$/i, 'IB', 'MATH: APPLICATION & INTERPRETATION'],
  [/^Environmental Systems\s*(?:and|&)\s*Societies$/i, 'IB', 'ENVIRON SYSTEMS & SOCIETIES'],
  [/^Social\s*(?:and|&)\s*Cultural Anthropology$/i, 'IB', 'ANTHROPOLOGY'],
  [/^Sports,?\s*Exercise\s*(?:and|&)\s*Health Science$/i, 'IB', 'SPORTS, EXERCISE & HEALTH SCIENCE'],
  [/^Chinese B\W*(?:Mandarin)\W*$/i, 'IB', 'CHINESE B - MADARIN'],
  [/^Chinese B\W*(?:Cantonese)\W*$/i, 'IB', 'CHINESE B - CATONESE'],
  [/^(Spanish|French|German|Italian|Japanese|Russian|Arabic|English)\s+ab\s+initio$/i, 'IB', '$1 B AB INITIO'],
];

/** The words of an exam name, spelled one way: "Macroeconomics" and "ECON MACRO" agree. */
const words = (s: string): string[] =>
  s
    .toUpperCase()
    .replace(/\b(AP|IB|ADVANCED PLACEMENT|INTERNATIONAL BACCALAUREATE|EXAM|TEST)\b/g, ' ')
    .replace(/\bMACRO-?ECONOMICS\b/g, 'ECON MACRO')
    .replace(/\bMICRO-?ECONOMICS\b/g, 'ECON MICRO')
    .replace(/\bECONOMICS\b/g, 'ECON')
    .replace(/\bU\.?\s?S\.?(?=\s|$|,)|\bUNITED STATES\b/g, 'US')
    .replace(/\bGOV'?T\b|\bGOVERNMENT\b/g, 'GOVT')
    .replace(/\bLANG(UAGE)?\b/g, 'LANGUAGE')
    .replace(/\bLIT(ERATURE)?\b/g, 'LITERATURE')
    .replace(/\bCOMP(OSITION)?\b/g, 'COMP')
    .replace(/\bAND\b/g, '&')
    .replace(/\b(HIGHER|STANDARD) LEVEL\b/g, (m) => (m.startsWith('H') ? 'HL' : 'SL'))
    .replace(/[^A-Z0-9& ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w));

/**
 * The table's exam for a name as a document or a student writes it, or null.
 * Official names go through OFFICIAL_NAMES; others are compared as word sets.
 * Calculus resolves to the Grainger table or the other one as asked.
 */
export function resolveExam(
  f: { kind: string; exam: string },
  table: ExamCreditEntry[],
  grainger: boolean,
): { kind: string; exam: string; level: string | null } | null {
  const names = [...new Map(table.map((e) => [`${e.kind}|${e.exam}|${e.level ?? ''}`, e])).values()];
  const kind = /\bIB\b|baccalaureate/i.test(`${f.kind} ${f.exam}`) ? 'IB' : 'AP';
  // The College Board's and the IB's current names, where the registrar's
  // table uses older ones.
  const bare = f.exam.replace(/^\s*(AP|IB)\s+/i, '').replace(/\s*\b(HL|SL|Higher Level|Standard Level)\b\s*/gi, ' ').trim();
  const levelWord = f.exam.match(/\b(HL|SL|Higher Level|Standard Level)\b/i)?.[1] ?? '';
  const alias = OFFICIAL_NAMES.find(([re, forKind]) => forKind === kind && re.test(bare));
  const aliasName = alias ? bare.replace(alias[0], alias[2]) : null;
  const all = words(aliasName ? `${aliasName} ${levelWord}` : f.exam);
  // IB exams carry their level in the name ("Biology HL"); the table keeps it apart.
  const level = all.find((w) => w === 'HL' || w === 'SL') ?? null;
  const want = all.filter((w) => w !== 'HL' && w !== 'SL');
  if (want.length === 0) return null;
  const candidates = names.filter((e) => {
    if (e.kind !== kind) return false;
    if (kind === 'IB' && level && e.level && !e.level.startsWith(level)) return false;
    if (aliasName) return e.exam.toUpperCase() === aliasName.toUpperCase() || e.exam.split(/\s+-\s+Entering\b/i)[0].toUpperCase() === aliasName.toUpperCase();
    const base = e.exam.split(/\s+-\s+Entering\b/i)[0];
    return same(want, words(base));
  });
  if (candidates.length === 0) return null;
  // Calculus has a table for students entering Grainger and one for everyone else.
  // An IB exam named with no level is read as Standard Level, the level that
  // grants less, because the plan must not count credit the student may not have.
  const pick =
    candidates.find((e) => (grainger ? /Entering Grainger/i.test(e.exam) : /other than Grainger/i.test(e.exam))) ??
    (kind === 'IB' && !level ? candidates.find((e) => e.level === 'SL') : undefined) ??
    candidates.find((e) => !/Entering/i.test(e.exam)) ??
    candidates[0];
  return { kind: pick.kind, exam: pick.exam, level: pick.level ?? null };
}

/**
 * Everything the registrar's table grants for one exam, every score, for the
 * bot to answer "what do I need on AP Biology?" from the table rather than
 * from memory. IB exams named without a level list both levels.
 */
export function examSchedule(
  name: string,
  kind: string | null,
  table: ExamCreditEntry[],
  grainger: boolean,
): { exam: string; kind: string; levels: Array<{ level: string | null; scores: Array<{ score: string; courses: string[]; hours: number; details: string }> }> } | null {
  const guessKind = kind ?? (/\bIB\b|baccalaureate|\b(HL|SL)\b/i.test(name) ? 'IB' : 'AP');
  const pick = resolveExam({ kind: guessKind, exam: name }, table, grainger);
  if (!pick) return null;
  const namedLevel = /\b(HL|Higher Level)\b/i.test(name) ? 'HL' : /\b(SL|Standard Level)\b/i.test(name) ? 'SL' : null;
  const rows = table.filter((e) => e.kind === pick.kind && e.exam === pick.exam && (pick.kind !== 'IB' || !namedLevel || (e.level ?? '').startsWith(namedLevel)));
  const levels = [...new Set(rows.map((r) => r.level ?? null))];
  return {
    exam: pick.exam,
    kind: pick.kind,
    levels: levels.map((level) => {
      const mine = rows.filter((r) => (r.level ?? null) === level);
      const scores = [...new Set(mine.map((r) => String(r.score)))];
      return {
        level,
        scores: scores.map((score) => {
          const these = examRows({ kind: pick.kind, exam: pick.exam, level, score }, table);
          return {
            score,
            courses: [...new Set(these.flatMap((r) => r.courses.map(grantCode)))],
            hours: these.reduce((sum, r) => sum + r.credits, 0),
            details: these.map((r) => r.raw).join(' | '),
          };
        }),
      };
    }),
  };
}

export function matchDocumentExams(
  found: Array<{ kind: string; exam: string; score: string | null; subscore?: string | null }>,
  table: ExamCreditEntry[],
  grainger: boolean,
): PriorExam[] {
  /** The number a document gives for another exam, for "(if English Language Score is ...)". */
  const scoreOf = (pattern: RegExp): number | null => {
    const hit = found.find((f) => pattern.test(f.exam));
    const n = Number(String(hit?.score ?? '').match(/\d+/)?.[0]);
    return Number.isFinite(n) && hit ? n : null;
  };
  const out: PriorExam[] = [];
  for (const f of found) {
    const pick = resolveExam(f, table, grainger);
    if (!pick) continue;
    const score = String(f.score ?? '').match(/\d+/)?.[0] ?? '';
    if (!score) continue;
    const rowsFor = (s: string) => examRows({ kind: pick.kind, exam: pick.exam, level: pick.level ?? null, score: s }, table);
    if (rowsFor(score).length > 0) {
      out.push({ kind: pick.kind, exam: pick.exam, level: pick.level ?? null, score: /^\d+$/.test(score) ? Number(score) : score });
      continue;
    }
    // A conditional score: the phrases that start with this number.
    const phrases = [
      ...new Set(
        table
          .filter((e) => e.kind === pick.kind && e.exam === pick.exam && (e.level ?? null) === (pick.level ?? null))
          .map((e) => String(e.score))
          .filter((cell) => {
            const lead = cell.match(/^(\d+(?:\s*(?:,|or|OR)\s*\d+)*)/)?.[1] ?? '';
            return lead.split(/\s*(?:,|or|OR)\s*/).includes(score) && !/^\d+$/.test(cell);
          }),
      ),
    ];
    if (phrases.length === 0) continue;
    const sub = Number(String(f.subscore ?? '').match(/\d+/)?.[0]);
    const lang = /english literature/i.test(pick.exam) ? scoreOf(/english\s+lang/i) : null;
    const condition = (cell: string): number[] | null => {
      const m = cell.match(/(?:subscore of|english language score is)\s*([\d\s,or/]+)/i);
      return m ? (m[1].match(/\d+/g) ?? []).map(Number) : null;
    };
    const decider = Number.isFinite(sub) ? sub : lang;
    const decided = decider !== null ? phrases.find((cell) => condition(cell)?.includes(decider)) : undefined;
    const least = phrases
      .map((cell) => ({ cell, credits: rowsFor(cell).reduce((sum, r) => sum + r.credits, 0) }))
      .sort((a, b) => a.credits - b.credits)[0]?.cell;
    const chosen = decided ?? least;
    if (chosen) out.push({ kind: pick.kind, exam: pick.exam, level: pick.level ?? null, score: chosen });
  }
  return out;
}

/**
 * Gen-ed categories an exam meets with no catalog course behind them: IB
 * Environmental Systems at a 4 grants "NRES 1--" and Physical Sciences. A row
 * that grants a catalog course is left out, because that course's own
 * categories already count; the registrar's gen-ed column is read from the
 * row's text ("Gen Ed: A; B.").
 */
export function examGenEdCredits(
  exams: PriorExam[],
  table: ExamCreditEntry[],
  creditsOf: (code: string) => number | null,
): Array<{ id: string; label: string; credits: number; tags: string[] }> {
  const out: Array<{ id: string; label: string; credits: number; tags: string[] }> = [];
  for (const taken of exams) {
    for (const row of examRows(taken, table)) {
      if (row.noCredit || row.credits <= 0) continue;
      const real = row.courses.map(grantCode).filter((c) => COURSE_CODE.test(c) && creditsOf(c) !== null);
      if (real.length > 0) continue;
      const field = row.raw.match(/Gen Ed:\s*([^.]*)/i)?.[1] ?? '';
      const tags = field
        .split(/;|\n/)
        .map((t) => t.replace(/\(.*?\)/g, '').trim())
        .filter((t) => /^(Composition I|Advanced Composition|Humanities - |Nat Sci & Tech - |Social & Beh Sci - |Cultural Studies - |Quantitative Reasoning I)/.test(t));
      if (tags.length === 0) continue;
      out.push({ id: `${taken.kind} ${taken.exam} ${taken.score}`, label: `${taken.kind} ${taken.exam} (${taken.score})`, credits: row.credits, tags });
    }
  }
  return out;
}

/** Prerequisites professional schools commonly ask for, as Illinois courses. */
const PREHEALTH_PREREQS = /^(IB 15[01]|MCB 15[01]|CHEM 10[2-5]|CHEM 20[2-5]|PHYS 10[12]|PHYS 21[12]|MATH 2(20|21|31|34)|STAT 100|PSYC 100|RHET 105)$/;

/**
 * What the plan owes a student about their exam credit beyond the numbers.
 *
 * Credit the student holds twice (AP Psychology and a dual-credit PSYC 101
 * both become PSYC 100) is granted once, and the student should hear that
 * rather than wonder where three hours went. And a student headed for medical,
 * dental, PA, physical therapy or veterinary school should know that many of
 * those schools do not accept test credit for their prerequisites; the
 * Biology department's own AP page says so and advises taking IB 150 and
 * MCB 150 on campus (biology.illinois.edu/admissions/advice-advanced-placement-ap-credit).
 */
export function examCreditNotes(input: { words: string; examCodes: string[]; transcriptCodes: string[] }): string[] {
  const notes: string[] = [];
  const both = input.examCodes.filter((code) => input.transcriptCodes.includes(code));
  if (both.length > 0) {
    notes.push(`Your exam credit and your transcript both give ${both.join(', ')}. Illinois grants a course's credit once, so ${both.length === 1 ? 'it is' : 'they are'} counted once.`);
  }
  const prehealth = /\b(pre-?med\w*|medical school|med school|pre-?health|pre-?dent\w*|dental school|pharmacy|pre-?pharm\w*|physician assistant|pa school|physical therapy|pt school|pre-?pt|vet school|veterinary|pre-?vet|optometry|occupational therapy)\b/i.test(input.words);
  const science = input.examCodes.filter((code) => PREHEALTH_PREREQS.test(code));
  if (prehealth && science.length > 0) {
    notes.push(`You mentioned a health profession. Your AP/IB credit for ${science.join(', ')} counts toward this degree, but many medical, dental, PA, physical therapy and veterinary schools do not accept test credit for their prerequisites, and Illinois Biology advises taking IB 150 and MCB 150 on campus. Check each school you are aiming for; taking the course here is the safe choice.`);
  }
  return notes;
}
