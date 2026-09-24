import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  IMAGE_MEDIA_TYPES,
  TRANSCRIPT_MAX_FILES,
  type TranscriptReading,
  type TranscriptUploadBody,
  type TranscriptUploadFile,
} from '@/lib/planner/transcript';

/**
 * The transcript reader.
 *
 * A student uploads what they have, this route has the model list every course
 * line on it, and the list goes straight back to the browser. That is the whole
 * job. The matching against the catalog, the decision about which lines count
 * and the plan that follows all happen in the browser, so the server holds a
 * transcript for exactly as long as one request takes and writes nothing down:
 * no file, no log line with a course in it, no store.
 *
 * "What they have" is rarely a clean transcript. It is an Illinois record with
 * a transfer block and test credit on it, another college's transcript, the
 * Transfer Evaluation Report admissions sent, a degree audit, or a screenshot
 * of a course list from Canvas. The reader is told what each of those looks
 * like and what to keep from it: the school that taught each line, the
 * Illinois course the document itself prints as the equivalent, and a line
 * the document says earns nothing. Several files can come in one request so a
 * list that spans two screenshots is read as one list.
 *
 * The contract is the reading, nothing more: { reading: TranscriptReading }.
 * Every failure is a sentence a student can act on, because the error text is
 * rendered under the upload button.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MODEL = 'claude-opus-5';
/** About 5 MB of image, as base64, which is the model's limit per image. */
const MAX_IMAGE_BASE64 = 6_800_000;
/** About 10 MB of PDF, as base64. */
const MAX_PDF_BASE64 = 14_000_000;
/** All files of one request together. */
const MAX_TOTAL_BASE64 = 30_000_000;
const MAX_TEXT_CHARS = 300_000;

const Course = z.object({
  code: z.string().describe('The subject and catalog number exactly as printed, for example "MATH 221" or another school\'s "MAT 128". Illinois indirect credit is printed as "HIST 1--"; keep it that way.'),
  title: z.string().nullable(),
  credits: z.number().nullable().describe('Hours attempted on this line, as printed on the line itself. Null when the line prints none.'),
  grade: z.string().nullable().describe('The grade as printed (A, B+, CR, S, P, TR, T, W, F, IP). Null when none is posted.'),
  term: z.string().nullable().describe('The term, written as "Fall 2024" whatever the document prints ("FA24", "2024FA", "Fall Semester 2024"). Null when the document does not say.'),
  status: z.enum(['completed', 'in_progress', 'withdrawn', 'failed', 'transfer', 'exam', 'no_credit']),
  from: z.string().nullable().describe('The school that taught the course, when the document names one and it is not the issuer: the school named over a transfer block, the sending institution on an evaluation report, a school in parentheses beside the line. Null when the issuer taught it or nothing says.'),
  equivalent: z.string().nullable().describe('The University of Illinois course the document itself prints as this line\'s equivalent, as printed ("MATH 221", "HIST 1--"): the right-hand column of a Transfer Evaluation Report, the Illinois code beside a transfer line on a degree audit. Null when the document prints none. Never guess one.'),
  equivalent_credits: z.number().nullable().describe('The Illinois hours printed beside the equivalent, when the document prints them separately from the line\'s own hours. Null otherwise.'),
  iai: z.string().nullable().describe('An Illinois Articulation Initiative code printed beside the line, like "M1 900" or "C1 900", or null.'),
});

const Reading = z.object({
  institution: z.string().nullable().describe('The school that issued the document. Null when it is not shown.'),
  kind: z.enum(['transcript', 'degree_audit', 'transfer_report', 'course_list', 'score_report', 'other']),
  hours_unit: z.enum(['semester', 'quarter']).nullable().describe('"quarter" when the document says its hours are quarter hours (a quarter-system school), "semester" when it says semester hours, null when it does not say.'),
  courses: z.array(Course),
  exams: z.array(z.object({ kind: z.string(), exam: z.string(), score: z.string().nullable() })),
  notes: z.array(z.string()),
});

const SYSTEM = `You read what a student has uploaded to a University of Illinois Urbana-Champaign four-year degree planner: a transcript, a degree audit, a Transfer Evaluation Report, a Student Self-Service academic history, a DegreeWorks or uAchieve page, a Canvas course list, or a plain typed list. The student will review every line you return before anything counts, so completeness and fidelity matter more than judgement: return one entry per course line, as printed, in the order printed, across every file and page.

For each line:
- code: the subject and catalog number as printed. Keep another school's codes the way that school prints them ("ENGLI 1101", "MAT 128"). Illinois prints indirect credit as "HIST 1--" (hours in a subject, no particular class); keep that shape.
- title, credits, grade: as printed. Credits are the hours on the line itself; when a document prints the line's hours and Illinois hours in separate columns, credits is the line's own and equivalent_credits the Illinois hours.
- term: written as "Fall 2024" (Fall, Spring, Summer or Winter, then the four-digit year) whatever shorthand the document uses. Null when nothing says.
- status: "completed" for a passing letter grade or CR, S, P, PS, or for a course listed under a past term with no grade printed (a Canvas "past enrollments" list); "in_progress" for a current term, a course marked IP, or a current-enrollments list; "withdrawn" for W, WX, WD; "failed" for F, NC, U, or a failing grade; "transfer" for credit accepted from another institution (grade TR, T, TC, or a transfer-credit block); "exam" for test credit (AP, IB, CLEP, A-Level, proficiency or departmental exams, grade CR); "no_credit" when the document itself says the line earns nothing (developmental or remedial, marked "no credit", 0 hours granted, repeated, not transferable).
- from: the school that taught the course when the document names one and it is not the issuer. On an Illinois record, the transfer block is headed with the school's name; on an evaluation report the sending institution is named once for every line; a degree audit may put it in parentheses beside the line. Null otherwise.
- equivalent: only what the document itself prints as the Illinois equivalent of this line, as printed. A Transfer Evaluation Report has a column for it; a degree audit lists the Illinois code with the sending school's course in parentheses, in which case the Illinois code is the code and the sending school's course goes in from (school) and is not a second line. Never invent an equivalent.
- iai: an IAI code printed beside the line, else null.

For the document:
- institution: the school that issued it (the university on the letterhead, the school named in the header). A Transfer Evaluation Report from Illinois is issued by Illinois; the sending school goes in each line's from.
- kind: transcript, degree_audit (DARS, uAchieve, DegreeWorks, an audit by requirement), transfer_report (a transfer credit evaluation), course_list (Canvas, a registration list, a typed list), score_report (an AP, IB or other exam score report with no course lines), or other.
- hours_unit: "quarter" when the document states quarter hours or the school is on quarters and says so; "semester" when it states semester hours; null when it does not say. Never convert the hours yourself.
- A degree audit lists requirements still needed next to courses taken: return only courses taken or in progress, never a course the audit lists as still needed or as an option.
- exams: the AP, IB, CLEP, A-Level or other exams the document names together with a score, the exam name as printed ("Calculus AB", "Psychology", "Biology HL") and kind "AP", "IB", "CLEP" or "A-Level". Empty when it prints none. Where the registrar has already posted the exam as a course line, keep the course line too. A score report has exams and no course lines; that is a complete reading.
- notes: one sentence for anything you could not read or had to leave out, and for any reading you made that the student should check (a cut-off header, a list with no grades printed). Otherwise empty.

Do not invent lines, grades, hours or equivalents. If a line is unreadable, leave it out and say so in notes. If several files were sent, read them as one document in the order given and do not repeat a line that appears on two of them.`;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** A file the body carries, checked, or a sentence about why it was refused. */
function readFile(file: Partial<TranscriptUploadFile>, index: number): { blocks: Anthropic.ContentBlockParam[]; size: number } | { error: string } {
  const kind = file.kind;
  const fileName = (typeof file.fileName === 'string' ? file.fileName : `file ${index + 1}`).split(/[\\/]/).pop()!.slice(0, 200);
  if (kind !== 'pdf' && kind !== 'image' && kind !== 'text') {
    return { error: `${fileName}: use a PDF, a screenshot (PNG or JPG), or a text file.` };
  }
  const label: Anthropic.ContentBlockParam = { type: 'text', text: `File ${index + 1}: ${fileName}` };
  if (kind === 'text') {
    const text = typeof file.text === 'string' ? file.text : '';
    if (!text.trim()) return { error: `${fileName} is empty.` };
    if (text.length > MAX_TEXT_CHARS) return { error: `${fileName} is too long to read in one go.` };
    return { blocks: [label, { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, title: fileName }], size: text.length };
  }
  const data = typeof file.data === 'string' ? file.data.replace(/\s+/g, '') : '';
  if (!data) return { error: `${fileName} is empty.` };
  if (kind === 'pdf') {
    if (data.length > MAX_PDF_BASE64) return { error: `${fileName} is over 10 MB. Export a smaller PDF, or screenshot the course list.` };
    return { blocks: [label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: fileName }], size: data.length };
  }
  const mediaType = file.mediaType;
  if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType ?? '')) {
    return { error: `${fileName}: use a PNG, JPG, WEBP or GIF screenshot.` };
  }
  if (data.length > MAX_IMAGE_BASE64) return { error: `${fileName} is over 5 MB. A smaller screenshot works.` };
  return {
    blocks: [label, { type: 'image', source: { type: 'base64', media_type: mediaType as (typeof IMAGE_MEDIA_TYPES)[number], data } }],
    size: data.length,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<TranscriptUploadBody> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Send a file to read.' }, 400);

  const files: Array<Partial<TranscriptUploadFile>> = 'files' in body && Array.isArray(body.files) ? body.files : [body as Partial<TranscriptUploadFile>];
  if (files.length === 0) return json({ error: 'Send a file to read.' }, 400);
  if (files.length > TRANSCRIPT_MAX_FILES) return json({ error: `Up to ${TRANSCRIPT_MAX_FILES} files at a time.` }, 400);

  // The route is what needs the key, so the route is what says it is missing.
  // The sentence a student sees names no environment variable; the log does.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[transcript] ANTHROPIC_API_KEY is not set; transcript reading is off.');
    return json({ error: 'Transcript reading is not configured on this build.' }, 503);
  }

  const content: Anthropic.ContentBlockParam[] = [];
  let total = 0;
  for (const [index, file] of files.entries()) {
    const read = readFile(file, index);
    if ('error' in read) return json({ error: read.error }, 400);
    total += read.size;
    if (total > MAX_TOTAL_BASE64) return json({ error: 'Those files are too large together. Send fewer at a time.' }, 413);
    content.push(...read.blocks);
  }
  content.push({
    type: 'text',
    text: files.length === 1 ? 'Read this document and list every course line on it.' : `Read these ${files.length} files as one document and list every course line on them.`,
  });

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(Reading) },
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: 'The reader declined this file. A clearer copy, or a screenshot of just the course list, usually works.' }, 502);
    }
    if (response.stop_reason === 'max_tokens') {
      return json({ error: 'This is longer than the reader could finish in one pass. Try one page at a time.' }, 502);
    }
    const parsed = response.parsed_output;
    if (!parsed) return json({ error: 'The reader could not find a course list in this file.' }, 502);

    const clean = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);
    const reading: TranscriptReading = {
      institution: clean(parsed.institution),
      kind: parsed.kind === 'score_report' ? 'other' : parsed.kind,
      hoursUnit: parsed.hours_unit ?? null,
      courses: parsed.courses
        .map((c) => ({
          code: c.code.trim(),
          title: clean(c.title),
          credits: typeof c.credits === 'number' && Number.isFinite(c.credits) ? c.credits : null,
          grade: clean(c.grade),
          term: clean(c.term),
          status: c.status,
          from: clean(c.from),
          equivalent: clean(c.equivalent),
          equivalentCredits: typeof c.equivalent_credits === 'number' && Number.isFinite(c.equivalent_credits) ? c.equivalent_credits : null,
          iai: clean(c.iai),
        }))
        .filter((c) => c.code.length > 0),
      exams: parsed.exams.map((e) => ({ kind: e.kind.trim(), exam: e.exam.trim(), score: clean(e.score) })),
      notes: parsed.notes.map((n) => n.trim()).filter(Boolean),
    };
    // A score report has exams and no course lines, and that is a reading.
    if (reading.courses.length === 0 && reading.exams.length === 0) {
      return json({ error: 'No course lines or exam scores were found in this file.', reading }, 422);
    }
    return json({
      reading,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.warn('[transcript] the API key was rejected.');
      return json({ error: 'Transcript reading is not configured correctly on this build.' }, 503);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: 'The transcript reader is busy. Try again in a minute.' }, 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      return json({ error: 'The reader could not accept this file. A PDF export or a PNG screenshot works best.' }, 400);
    }
    if (error instanceof Anthropic.APIError) {
      return json({ error: `The transcript reader returned ${error.status ?? 'an error'}.` }, 502);
    }
    return json({ error: 'The transcript could not be read. Try again.' }, 500);
  }
}
