import {
  distinctHeld,
  planCreditRange,
  validatePlan,
  type PlanRequirement,
  type PlanningContext,
  type PoolReport,
  type ValidateOptions,
} from '@/lib/planner/autoplan';
import { areaProgress } from '@/lib/planner/scheduler';
import { programWithHeldAnyCourse, withHeldAnyCourse, withHeldInRange } from '@/lib/planner/any-course';
import {
  degreeTermOrder,
  doubleDawgsContext,
  doubleDawgsIssues,
  doubleDawgsLedger,
  doubleDawgsProgress,
  sharedUndergraduateRequirements,
  type CombinedDegreeSource,
  type SharedCourse,
} from '@/lib/planner/double-dawgs';
import {
  lineIsForeign,
  transcriptCreditSummary,
  type TranscriptRecord,
} from '@/lib/planner/transcript';
import type { PlanIssue, PlanState } from '@/lib/planner/types';
import { requiredSummerOn, summerOnlyListed, ugaRequiredSummerOnlyMessage, ugaSummerOnlyMessage } from '@/lib/planner/summer-offering';
import { livePools, poolShortfalls } from './live-pools';
import { ugaLanguageArea, ugaLanguagePlaced, ugaRuleFamily, ugaUniversityIssues } from '@/lib/planner/uga-university-rules';

export interface UgaAuditInput {
  board: PlanState;
  context: PlanningContext;
  undergraduate: CombinedDegreeSource;
  graduate?: CombinedDegreeSource;
  priorCodes: string[];
  extraCredits: number;
  transcript?: TranscriptRecord | null;
  dualLevel?: Map<string, string>;
  validation?: ValidateOptions;
  coreCredit?: Array<{ area: string; hours: number }>;
  /** Which row each course on the board was booked for (GeneratedPlan.bookedFor), where the caller has it. */
  bookedFor?: Record<string, string | null>;
  /** The language level the student said they place past (setup's answer, PriorCredit.languageSemesters), which meets a language area of that level. */
  languagePlaced?: number | null;
}

/**
 * Codes a degree requires with no other choice that the UGA Bulletin lists
 * for summer only: every alternative of a take-every-course row, or of a
 * choose row without enough other options, is summer-only (autoplan.ts
 * requiredSummerOnly reads the same rows when it plans).
 */
function requiredSummerOnlyCodes(blocks: PlanRequirement[], context: PlanningContext): Set<string> {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const out = new Set<string>();
  for (const block of blocks) {
    const rule = block.rule;
    if (rule.kind !== 'all' && rule.kind !== 'choose') continue;
    const rows = rule.choices.map((choice) => choice.codes).filter((codes) => codes.length > 0);
    const only = rows.filter((codes) => codes.every((code) => summerOnlyListed(byCode.get(code))));
    if (only.length === 0 || (rule.kind === 'choose' && rows.length - only.length >= rule.n)) continue;
    for (const codes of only) for (const code of codes) out.add(code);
  }
  return out;
}

/**
 * The degree read with the held classes its open elective blocks take
 * ("Any upper level course 3000-5999") and its subject-wide rows' whole
 * ranges take ("3000-level or higher"), as generatePlan reads it
 * (any-course.ts), so the board's progress counts what the board was built on.
 * A minor's or certificate's courses on the board count toward those blocks
 * as held classes do, as the board was built (autoplan.ts openWithShared).
 * A course the board booked for one of the degree's own rows (`bookedFor`)
 * is that row's, as it is in the build: a Risk Management sophomore's ECOL
 * 1000, MATH 1113, HIST 2112 and RELI 1001, booked for the core, are on the
 * Non-Business sample too, and the block read 12 of 12 hours on a board the
 * build had booked 3 for (2026-10-28).
 */
function withHeldOpenBlocks(source: CombinedDegreeSource, priorCodes: string[], context: PlanningContext, planned: string[] = [], bookedFor?: Record<string, string | null>): CombinedDegreeSource {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const creditsOf = (code: string) => byCode.get(code)?.credits ?? 3;
  const programOf = (id: string) => id.split('::')[0];
  const openPrograms = new Set(source.blocks.filter((b) => b.rule.kind === 'pool' && b.rule.anyCourse).map((b) => programOf(b.id)));
  const otherRows = source.blocks.filter((b) => b.id.includes('::') && !openPrograms.has(programOf(b.id)));
  // The language sequence's courses too (uga-university-rules.ts): a requirement met by courses counted elsewhere, whose hours the open blocks may hold, as the build counts them.
  const languageRow = new Set(source.blocks.filter((b) => ugaLanguageArea(b.areaLabel)).map((b) => b.id));
  const sequence = bookedFor ? planned.filter((code) => languageRow.has(bookedFor[code.replace(/\s+/g, ' ').trim().toUpperCase()] ?? '')) : [];
  const others = openPrograms.size === 0 ? [] : [...planned.filter((code) => otherRows.some((b) => (b.rule.kind === 'all' || b.rule.kind === 'choose' || b.rule.kind === 'pool') && b.rule.choices.some((choice) => choice.codes.includes(code)))), ...sequence];
  const ownRows = new Set(source.blocks.filter((b) => openPrograms.has(programOf(b.id)) && !(b.rule.kind === 'pool' && b.rule.anyCourse) && !languageRow.has(b.id)).map((b) => b.id));
  const counted = bookedFor ? planned.filter((code) => !others.includes(code) && ownRows.has(bookedFor[code.replace(/\s+/g, ' ').trim().toUpperCase()] ?? '')) : [];
  const { requirements: open } = withHeldAnyCourse(source.blocks, [...priorCodes, ...others], {
    creditsOf,
    versionsOf: (code) => [code, ...(context.equivalents?.get(code) ?? [])],
    titleOf: (code) => byCode.get(code)?.title,
    counted,
  });
  const requirements = withHeldInRange(open, priorCodes, { creditsOf, versionsOf: (code) => [code, ...(context.equivalents?.get(code) ?? [])] });
  if (requirements === source.blocks) return source;
  return { ...source, blocks: requirements, program: programWithHeldAnyCourse(source.program, source.blocks, requirements, (code) => byCode.get(code)?.title) };
}

/** The first and last of the schedule's terms, in calendar order: "Spring 2026 to Summer 2027". */
function scheduleSpan(terms: string[]): string {
  const order = (label: string) => Number(label.match(/(\d{4})/)?.[1] ?? 0) * 3 + (/^Spring/.test(label) ? 0 : /^Summer/.test(label) ? 1 : 2);
  const sorted = [...terms].sort((a, b) => order(a) - order(b));
  return sorted.length > 1 ? `${sorted[0]} to ${sorted[sorted.length - 1]}` : sorted[0] ?? '';
}

/** Rebuild pool membership from the curriculum, including repairs to older saved plans. */
function poolsFor(
  blocks: PlanRequirement[],
  boardCodes: string[],
  priorCodes: string[],
  context: PlanningContext,
  graduate: boolean,
): PoolReport[] {
  const catalog = new Set(context.courses.map((course) => course.code));
  const base: PoolReport[] = blocks.flatMap((block) => {
    if (block.rule.kind !== 'pool') return [];
    const codes = [
      ...new Set(block.rule.choices.flatMap((choice) => choice.codes)),
    ];
    return [
      {
        requirementId: block.id,
        areaLabel: block.areaLabel,
        label: block.label,
        note: block.note,
        hoursTarget: block.rule.hours,
        countTarget: block.rule.n,
        hours: 0,
        count: 0,
        picked: [],
        fromPriorCredit: [],
        alternatives: codes,
        listed: codes.length,
        available: codes.filter((code) => catalog.has(code)).length,
        constraints: [],
        url: block.url,
      },
    ];
  });
  return livePools({
    base,
    blocks,
    boardCodes,
    priorCodes,
    context,
    shareAcrossPrograms: !graduate,
    reserveRequired: true,
    independentIds: new Set(['double-dawgs:ai-graduate-only']),
  });
}

/** One current-board audit for progress, assistant previews, replacements and export. */
export function auditUgaBoard(input: UgaAuditInput) {
  const {
    board,
    graduate,
    priorCodes,
    extraCredits,
    transcript,
  } = input;
  const context = doubleDawgsContext(board, input.context)!;
  const byId = new Map(context.courses.map((course) => [course.id, course]));
  const planned = board.terms.flatMap((term) =>
    term.courseIds.flatMap((id) => byId.get(id)?.code ?? []),
  );
  const undergraduate = withHeldOpenBlocks(input.undergraduate, priorCodes, context, planned, input.bookedFor);
  const prior = new Set(priorCodes);
  const have = new Set([...priorCodes, ...planned]);
  const ledger = doubleDawgsLedger(board, context, priorCodes, extraCredits);
  const total = planCreditRange([...have], context).min + extraCredits;
  const target =
    ledger?.requiredUniqueCredits ?? undergraduate.program.totalCredits;
  const creditsByCode = new Map(
    context.courses.map((course) => [course.code, course.credits]),
  );
  let areas =
    ledger && graduate
      ? doubleDawgsProgress(
          board,
          context,
          undergraduate.program,
          graduate.program,
          priorCodes,
          extraCredits,
        )
      : areaProgress(undergraduate.program, have, context.equivalents, {
          allowCrossAreaOverlap: true,
          creditsByCode,
          familyOf: ugaRuleFamily,
          ownerOf: ((areaOfBlock) => (code: string) => {
            const block = input.bookedFor?.[code.replace(/\s+/g, ' ').trim().toUpperCase()];
            return block ? areaOfBlock.get(block) ?? null : null;
          })(new Map(undergraduate.blocks.map((block) => [block.id, block.areaLabel]))),
        });
  // Free electives are residual degree hours, not another mandatory named list.
  areas = areas.filter(
    (row) => !/(?:^|: )(?:general|free) electives?\b/i.test(row.area.label),
  );
  // A placement past the level the degree's foreign language asks for meets it with no course (uga-university-rules.ts).
  areas = areas.map((row) => (!row.satisfied && ugaLanguagePlaced(row.area, input.languagePlaced) ? { ...row, earned: row.area.hours, percent: 100, satisfied: true } : row));
  areas = areas.map((row) => {
    const added = (input.coreCredit ?? [])
      .filter((credit) => row.area.label.endsWith(credit.area))
      .reduce((sum, credit) => sum + credit.hours, 0);
    if (!added) return row;
    const earned = Math.min(row.area.hours, row.earned + added);
    return {
      ...row,
      earned,
      percent: Math.round((earned / row.area.hours) * 100),
      satisfied: earned >= row.area.hours,
    };
  });
  const shared = (board.doubleDawgs?.shared ?? []).filter(
    (row): row is SharedCourse => Boolean(row.undergraduateCode),
  );
  const ugCodes = ledger?.undergraduateCodes ?? [...have];
  const ugBlocks = sharedUndergraduateRequirements(
    undergraduate.blocks,
    shared,
  );
  const pools = [
    // Each held class once (distinctHeld): the board's held codes carry every version and dual-level number of a class, and a Political Science senior's American Studies list read "Already taken and counted here: ... POLS 6440, POLS 8140" (2026-10-28).
    ...poolsFor(
      ugBlocks,
      ugCodes.filter((code) => !prior.has(code)),
      distinctHeld(ugCodes.filter((code) => prior.has(code) && !prior.has(context.undergraduateCounterparts?.get(code) ?? '')), context).codes,
      context,
      false,
    ),
    ...(ledger && graduate
      ? poolsFor(
          graduate.blocks,
          ledger.graduateCodes.filter((code) => !prior.has(code)),
          ledger.graduateCodes.filter((code) => prior.has(code)),
          context,
          true,
        )
      : []),
  ];
  // The board's hours, all at UGA, and the record's from another school or with no course behind them, for where the last 60 hours are earned.
  const plannedHours = planCreditRange(planned.filter((code) => !prior.has(code)), context).min;
  const transferHours = transcript
    ? transcript.courses.filter((line) => line.use && line.counts !== 'none' && (lineIsForeign(transcript, line) || line.counts === 'hours')).reduce((sum, line) => sum + (line.equivalentCredits ?? line.credits ?? line.assumedCredits ?? 0), 0)
    : 0;
  const issues: PlanIssue[] = [
    ...validatePlan(board, context, input.validation).filter(
      (issue) =>
        !issue.id.startsWith('ap-weighed-') &&
        !(
          board.doubleDawgs &&
          issue.id.startsWith('ap-minimum-') &&
          board.terms.some(
            (term) =>
              term.id === issue.termId &&
              degreeTermOrder(term) >
                degreeTermOrder(board.doubleDawgs!.undergraduateFinish),
          )
        ),
    ),
    ...doubleDawgsIssues(board, context, priorCodes, extraCredits),
    ...areas
      .filter((row) => !row.satisfied)
      .map((row) => ({
        id: `uga-area-${row.area.label}`,
        severity: 'error' as const,
        termId: '',
        title: row.area.label,
        message: `${row.area.label}: ${row.earned} of ${row.area.hours} credits. ${row.earned >= row.area.hours ? 'A required course or course-group selection is still missing.' : 'More eligible coursework is needed.'}`,
      })),
    ...poolShortfalls(pools).map((row) => ({
      id: `uga-pool-${row.requirementId}-${row.reason}`,
      severity: 'error' as const,
      termId: '',
      title: `${row.areaLabel}: ${row.label}`,
      message: row.message,
    })),
    // UGA's physical education, upper-division hours, residence and college lines (uga-university-rules.ts).
    ...ugaUniversityIssues({
      areaLabels: undergraduate.program.areas.map((area) => area.label),
      boardCodes: planned,
      priorCodes,
      creditsOf: (code) => creditsByCode.get(code) ?? 3,
      transferHours,
      residentHeldHours: Math.max(0, total - plannedHours - transferHours),
      plannedHours,
      college: undergraduate.program.college,
    }),
  ];
  if (target && total < target)
    issues.push({
      id: 'uga-total',
      severity: 'error',
      termId: '',
      title: 'Degree credits are short',
      message: `This draft has ${total} of ${target} required credits, including in-progress work that must be passed.`,
    });
  // Two rows below are information, not problems (owner, 2026-10-20, "fewer
  // pointless warnings"): a requirement the snapshot cannot fully read is for
  // an advisor to check, as Illinois's unread requirements already were, and
  // in-progress credit is true of nearly every continuing student. As
  // warnings they kept UGA boards from ever saying "Nothing needs attention"
  // (88 of 161 bachelor's programs have at least one unread requirement). The
  // rows and their words are unchanged; the board folds them under "Good to
  // know" (lib/planner/warnings-triage.ts).
  for (const block of [...ugBlocks, ...(graduate?.blocks ?? [])]) {
    if (
      block.rule.kind === 'unparsed' ||
      (block.rule.kind === 'hours' && block.rule.source === 'parser-gap')
    )
      issues.push({
        id: `uga-unverified-${block.id}`,
        severity: 'info',
        termId: '',
        title: 'Requirement needs advisor review',
        message: `${block.areaLabel}: the snapshot does not identify all required courses${block.rule.kind === 'hours' ? ` (${block.rule.hours} credit ${block.rule.hours === 1 ? 'hour' : 'hours'} unnamed)` : ''}. Credit totals alone cannot verify this requirement.`,
      });
  }
  const summary = transcriptCreditSummary(transcript);
  if (summary.pending)
    issues.push({
      id: 'uga-pending',
      severity: 'info',
      termId: '',
      title: 'In-progress credit is conditional',
      message: `Your record shows ${summary.earned} earned credits and ${summary.pending} in progress. Progress assumes the in-progress courses are passed; they are not yet earned. Rebuild after updating final grades.`,
    });
  if (summary.physicalEducation)
    issues.push({
      id: 'uga-pe',
      severity: 'info',
      termId: '',
      title: 'Physical education credit',
      message: `${summary.physicalEducation} PEDB credit is recorded separately and is not included in the 120 academic hours required for a bachelor's degree.`,
    });

  /*
   * A course the UGA Bulletin lists for summer only, on the board in a fall or
   * spring (2026-10-22). 572 UGA courses' "Semester Course Offered" line names
   * summer alone. Since the owner's decision of 2026-10-22 the planner's own
   * picks no longer book them there (summer-offering.ts summerOnlyListed), and
   * the validator above flags one a student placed, in these words, as "Not
   * offered this term" (ap-offering-), which the board bar counts as "Course
   * not offered that term". This loop is kept for a context whose seasons are
   * not published, so the card never goes quiet; it adds nothing the validator
   * already said.
   *
   * One the degree itself requires with no other choice stays on the board so
   * the degree stays whole (autoplan.ts ugaSummerOnly), and its card says so
   * plainly and points to Add a summer, instead of "check before keeping it
   * here" about a course the degree cannot do without.
   */
  const requiredSummer = requiredSummerOnlyCodes(
    [...undergraduate.blocks, ...(graduate?.blocks ?? [])],
    context,
  );
  const boardHasSummer = board.terms.some((term) => term.season === 'Summer');
  // The board's terms by code, and what the student holds, for the first summer such a course can run (requiredSummerOn).
  const termCodes = board.terms.map((term) => ({ season: term.season, label: term.label, id: term.id, codes: term.courseIds.map((id) => byId.get(id)?.code ?? '').filter(Boolean) }));
  const heldCodes = new Set(priorCodes.map((code) => code.replace(/\s+/g, ' ').trim().toUpperCase()));
  for (const term of board.terms) {
    if (term.season === 'Summer') continue;
    for (const id of term.courseIds) {
      const course = byId.get(id);
      if (!course || !summerOnlyListed(course)) continue;
      const issueId = `ap-offering-${term.id}-${id}`;
      const message = requiredSummer.has(course.code)
        ? ugaRequiredSummerOnlyMessage(course, term.label, boardHasSummer, requiredSummerOn(course, context.prereqs?.get(course.code)?.groups ?? [], termCodes, heldCodes))
        : ugaSummerOnlyMessage(course, term.label);
      const known = issues.find((issue) => issue.id === issueId);
      if (known) {
        known.message = message;
        continue;
      }
      issues.push({
        id: issueId,
        severity: 'warning',
        termId: term.id,
        courseId: id,
        title: 'Not offered this term',
        message,
      });
    }
  }

  /*
   * A course the Bulletin gives no season for, in a fall or spring UGA's
   * Schedule of Classes did not run it in (PlanningContext.scheduled): the
   * validator reads the Bulletin's seasons alone, so a Dietetics board's
   * NUTR 4070 and 4600, on the schedule in spring only, sat in a fall, and
   * an MIS board's MIST 4620E, online in summer only, in a fall, with
   * "Nothing needs attention" (2026-10-28). The schedule is one year of
   * sections, so the card says to check, not that the course never runs.
   */
  const scheduled = context.scheduled;
  if (scheduled) {
    for (const term of board.terms) {
      if (term.season === 'Summer') continue;
      for (const id of term.courseIds) {
        const course = byId.get(id);
        if (!course || prior.has(course.code) || context.offeringPublished?.has(course.code)) continue;
        const seasons = scheduled.seasons.get(course.code);
        if (!seasons || seasons.length === 0 || seasons.includes(term.season)) continue;
        const issueId = `ap-offering-${term.id}-${id}`;
        if (issues.some((issue) => issue.id === issueId)) continue;
        const ran = [...new Set(seasons)].map((season) => season.toLowerCase());
        issues.push({
          id: issueId,
          severity: 'warning',
          termId: term.id,
          courseId: id,
          title: 'Not offered this term',
          message: `${course.code} ran in the ${ran.length === 1 ? ran[0] : `${ran.slice(0, -1).join(', ')} and ${ran[ran.length - 1]}`} only on UGA's Schedule of Classes (${scheduleSpan(scheduled.terms)}), not in a ${term.season.toLowerCase()}. Check that it runs in ${term.label}, or move it to a term it runs in.`,
        });
      }
    }
  }

  // A prior undergraduate counterpart is not a graduate waiver or graduate credit.
  for (const term of board.terms)
    for (const id of term.courseIds) {
      const code = byId.get(id)?.code;
      const under = code ? input.dualLevel?.get(code) : undefined;
      if (!code || !under || !prior.has(under)) continue;
      issues.push({
        id: `uga-counterpart-${id}`,
        severity: 'warning',
        termId: term.id,
        courseId: id,
        title: 'Prior undergraduate counterpart',
        message: `${code} has undergraduate counterpart ${under} on your record. Ask the graduate advisor whether to take it, substitute another course, or obtain a formal waiver. Undergraduate credit is not automatically graduate credit.`,
      });
    }
  const programs = new Set(undergraduate.program.id.split('+'));
  if (programs.has('67412')) {
    const members = new Set(
      ugBlocks
        .filter((block) => block.id.startsWith('67412::'))
        .flatMap((block) =>
          'choices' in block.rule
            ? block.rule.choices.flatMap((choice) => choice.codes)
            : [],
        ),
    );
    const eligible = (code: string) =>
      members.has(code) ||
      context.equivalents?.get(code)?.some((alias) => members.has(alias));
    const lines = (transcript?.courses ?? []).filter(
      (line) => line.use && line.matched && eligible(line.matched),
    );
    const resident =
      lines
        .filter(
          (line) =>
            transcript &&
            !lineIsForeign(transcript, line) &&
            line.matchedBy !== 'student' &&
            ['completed', 'in_progress'].includes(line.status),
        )
        .reduce(
          (sum, line) => sum + (line.equivalentCredits ?? line.credits ?? 0),
          0,
        ) +
      planCreditRange(
        planned.filter((code) => eligible(code) && !prior.has(code)),
        context,
      ).min;
    if (resident < 15)
      issues.push({
        id: 'uga-cs-minor-residency',
        severity: 'warning',
        termId: '',
        title: 'CS minor residency needs review',
        message: `${resident} of the CS minor's 15 required UGA-resident hours are documented or planned. Transfer and exam credit do not meet this rule. Courses used for Core Areas I-V cannot also count toward the minor; confirm the allocation with your advisor.`,
      });
  }
  for (const [id, grade, minimum] of [
    ['67412', 'C', 2],
    ['28375', 'C-', 1.7],
  ] as const) {
    if (!programs.has(id)) continue;
    const members = new Set(
      ugBlocks
        .filter((block) => block.id.startsWith(`${id}::`))
        .flatMap((block) =>
          'choices' in block.rule
            ? block.rule.choices.flatMap((choice) => choice.codes)
            : [],
        ),
    );
    const points: Record<string, number> = {
      A: 4,
      'A-': 3.7,
      'B+': 3.3,
      B: 3,
      'B-': 2.7,
      'C+': 2.3,
      C: 2,
      'C-': 1.7,
      D: 1,
      F: 0,
    };
    const low = (transcript?.courses ?? []).filter(
      (line) =>
        line.use &&
        line.matched &&
        (members.has(line.matched) ||
          context.equivalents
            ?.get(line.matched)
            ?.some((alias) => members.has(alias))) &&
        line.status !== 'in_progress' &&
        points[line.grade?.toUpperCase() ?? ''] < minimum,
    );
    if (low.length)
      issues.push({
        id: `uga-grade-${id}`,
        severity: 'warning',
        termId: '',
        title: 'Program grade minimum needs review',
        message: `${low.map((line) => `${line.matched} (${line.grade})`).join(', ')} is below ${grade}, the ${id === '67412' ? 'CS minor' : 'AI Computing certificate'} minimum. Do not treat these courses as satisfying that program without an approved exception or another eligible course.`,
      });
  }
  if (
    programs.has('28375') &&
    /Data Science BS/.test(undergraduate.program.name) &&
    !['CSCI 4530', 'CSCI 4560', 'CSCI 4800', 'CSCI 4600'].some(
      (code) =>
        ugCodes.includes(code) ||
        shared.some(
          (row) => row.undergraduateCode === code && ugCodes.includes(row.code),
        ),
    )
  ) {
    issues.push({
      id: 'uga-ai-certificate-group-i',
      severity: 'error',
      termId: '',
      title: 'AI certificate Group I elective',
      message:
        'Data Science BS students must complete at least one Group I AI certificate elective: CSCI 4530, CSCI 4560, CSCI 4800, or CSCI 4600.',
    });
  }
  return {
    areas,
    pools,
    issues: [...new Map(issues.map((issue) => [issue.id, issue])).values()],
    ledger,
    total,
    target,
  };
}

/** Reject a suggested replacement if it loses any current requirement progress. */
export function ugaProgressLoss(
  before: ReturnType<typeof auditUgaBoard>,
  after: ReturnType<typeof auditUgaBoard>,
): string | null {
  for (const row of before.areas) {
    const next = after.areas.find(
      (candidate) => candidate.area.label === row.area.label,
    );
    if (
      !next ||
      next.earned < Math.min(row.earned, row.area.hours) ||
      (row.satisfied && !next.satisfied)
    )
      return `This change loses progress toward ${row.area.label}.`;
  }
  for (const pool of before.pools) {
    const next = after.pools.find(
      (candidate) => candidate.requirementId === pool.requirementId,
    );
    if (
      !next ||
      (pool.hoursTarget !== null &&
        next.hours < Math.min(pool.hours, pool.hoursTarget)) ||
      (pool.countTarget !== null &&
        next.count < Math.min(pool.count, pool.countTarget)) ||
      pool.constraints.some(
        (constraint, index) => constraint.met && !next.constraints[index]?.met,
      )
    )
      return `This change loses progress toward ${pool.areaLabel}: ${pool.label}.`;
  }
  const previous = new Set(
    before.issues
      .filter((issue) => issue.severity !== 'info')
      .map((issue) => `${issue.id}|${issue.message}`),
  );
  return (
    after.issues.find(
      (issue) =>
        issue.severity !== 'info' &&
        !previous.has(`${issue.id}|${issue.message}`) &&
        /^(double-dawgs|uga-total|ap-prereq|ap-duplicate|ap-exclusion)/.test(
          issue.id,
        ),
    )?.message ?? null
  );
}
