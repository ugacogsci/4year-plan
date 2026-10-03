import { schoolById, type SupportedSchoolId } from './schools';

/** Extraction only: catalog matching and the student's confirmation happen locally. */
export function transcriptSystem(schoolId: SupportedSchoolId): string {
  const school = schoolById(schoolId)!;
  return `Read the files uploaded to the ${school.name} degree planner as one document. Return every course line as printed, in order, without repeating overlapping pages. The student reviews the result before it counts.

For each course preserve its code, title, hours, grade and source institution. Normalize the term to Fall, Spring, Summer or Winter followed by the four-digit year; leave unknown fields null. Never convert hours yourself. Distinguish the issuing institution from the school that taught a transfer course (from).

The equivalent field is only a ${school.short} course explicitly printed as the destination equivalent on the document. Never infer an equivalent from a matching number or title. Keep source credit hours in credits and separately printed destination hours in equivalent_credits. A home-university audit may show the accepted home course beside the sending-school course: record the accepted code once and the sending institution in from.

Classify passing grades A through D, CR, S, P or PS and completed past-term courses as completed; current-term courses or IP as in_progress; W, WX or WD as withdrawn; F, NC or U as failed; accepted transfer credit or TR/T/TC as transfer; posted test credit as exam; explicitly uncredited, developmental, repeated-without-credit or nontransferable lines as no_credit. If the document states a different outcome, preserve that outcome. A current or future course without a final grade is in progress.

Identify document kind: transcript, degree_audit, transfer_report, course_list, score_report or other. A degree audit also prints requirements still needed: never return those alternatives as courses taken. Preserve quarter or semester hours as printed, with hours_unit identifying which. Read AP, IB, CLEP, A-Level and other exam names and scores (including any subscore) into exams, even on a score report without course lines. Preserve posted exam course lines as well.

${schoolId === 'illinois'
    ? 'Illinois examples include Student Self-Service, uAchieve and the Transfer Evaluation Report. Preserve indirect credit such as HIST 1-- and any printed IAI code in iai. Preserve printed Illinois general-education categories in gen_ed; never infer them.'
    : 'Georgia examples include Athena academic history and DegreeWorks. Preserve four-digit catalog numbers and letter suffixes such as CSCI 1301 and BIOL 1107L. Preserve only printed general-education categories in gen_ed. Leave iai null unless the document explicitly prints that field; it does not establish Georgia credit.'}

Do not invent lines, equivalents, grades or hours. Return a short note for anything unreadable, uncertain or omitted. Read all supplied files and pages; return only the structured reading.`;
}
