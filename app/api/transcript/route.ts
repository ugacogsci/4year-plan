import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { IMAGE_MEDIA_TYPES, type TranscriptReading, type TranscriptUploadBody } from '@/lib/planner/transcript';

/**
 * The transcript reader.
 *
 * A student uploads a transcript, this route has the model list every course
 * line on it, and the list goes straight back to the browser. That is the whole
 * job. The matching against the catalog, the decision about which lines count
 * and the plan that follows all happen in the browser, so the server holds a
 * transcript for exactly as long as one request takes and writes nothing down:
 * no file, no log line with a course in it, no store.
 *
 * The contract is the reading, nothing more: { reading: TranscriptReading }.
 * Every failure is a sentence a student can act on, because the error text is
 * rendered under the upload button.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MODEL = 'claude-opus-5';
/** About 10 MB of file, as base64. */
const MAX_BASE64_CHARS = 14_000_000;
const MAX_TEXT_CHARS = 300_000;

const Course = z.object({
  code: z.string().describe('The subject and catalog number exactly as printed, for example "MATH 221".'),
  title: z.string().nullable(),
  credits: z.number().nullable().describe('Hours attempted on this line. Null when the line prints none.'),
  grade: z.string().nullable().describe('The grade as printed (A, B+, CR, S, W, F). Null when none is posted yet.'),
  term: z.string().nullable().describe('The term as printed, for example "Fall 2025".'),
  status: z.enum(['completed', 'in_progress', 'withdrawn', 'failed', 'transfer', 'exam']),
});

const Reading = z.object({
  institution: z.string().nullable(),
  courses: z.array(Course),
  exams: z.array(z.object({ kind: z.string(), exam: z.string(), score: z.string().nullable() })),
  notes: z.array(z.string()),
});

const SYSTEM = `You read university transcripts for a four-year degree planner. The student uploaded this file themselves and will review every line you return before anything counts, so completeness matters more than judgement: return one entry per course line, as printed, in the order printed.

- code: the subject and catalog number as printed ("MATH 221"). Keep another school's codes the way that school prints them.
- credits: the hours attempted on that line, as a number. Null when the line prints none.
- grade: as printed. Null when no grade is posted.
- term: as printed, for example "Fall 2025". Null when the transcript does not say.
- status: "completed" for a passing letter grade or CR, S, P, PS; "failed" for F, NC, U, or a line the transcript marks as earning no credit; "withdrawn" for W, WX, WD; "in_progress" for a current term or a line with no grade yet; "exam" for test credit (AP, IB, CLEP, proficiency or departmental exams); "transfer" for credit accepted from another institution.
- exams: the AP, IB, CLEP or other exams the transcript names together with a score. Empty when it prints none.
- institution: the school that issued the transcript. Null when it is not shown.
- notes: one sentence for anything you could not read or had to leave out. Otherwise empty.

Do not invent lines, grades or hours. If a line is unreadable, leave it out and say so in notes.`;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<TranscriptUploadBody> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Send a file to read.' }, 400);

  const kind = body.kind;
  if (kind !== 'pdf' && kind !== 'image' && kind !== 'text') {
    return json({ error: 'Use a PDF, a screenshot (PNG or JPG), or a text file.' }, 400);
  }
  const fileName = (typeof body.fileName === 'string' ? body.fileName : 'transcript').split(/[\\/]/).pop()!.slice(0, 200);

  // The route is what needs the key, so the route is what says it is missing.
  // The sentence a student sees names no environment variable; the log does.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[transcript] ANTHROPIC_API_KEY is not set; transcript reading is off.');
    return json({ error: 'Transcript reading is not configured on this build.' }, 503);
  }

  const content: Anthropic.ContentBlockParam[] = [];
  if (kind === 'text') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return json({ error: 'That file is empty.' }, 400);
    if (text.length > MAX_TEXT_CHARS) return json({ error: 'That file is too long to read in one go.' }, 413);
    content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, title: fileName });
  } else {
    const data = typeof body.data === 'string' ? body.data.replace(/\s+/g, '') : '';
    if (!data) return json({ error: 'That file is empty.' }, 400);
    if (data.length > MAX_BASE64_CHARS) return json({ error: 'That file is over 10 MB.' }, 413);
    if (kind === 'pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: fileName });
    } else {
      const mediaType = body.mediaType;
      if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType ?? '')) {
        return json({ error: 'Use a PNG, JPG, WEBP or GIF screenshot.' }, 400);
      }
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType as (typeof IMAGE_MEDIA_TYPES)[number], data },
      });
    }
  }
  content.push({ type: 'text', text: 'Read this transcript and list every course line on it.' });

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
      return json({ error: 'This transcript is longer than the reader could finish in one pass. Try one page at a time.' }, 502);
    }
    const parsed = response.parsed_output;
    if (!parsed) return json({ error: 'The reader could not find a course list in this file.' }, 502);

    const reading: TranscriptReading = {
      institution: parsed.institution?.trim() || null,
      courses: parsed.courses
        .map((c) => ({
          code: c.code.trim(),
          title: c.title?.trim() || null,
          credits: typeof c.credits === 'number' && Number.isFinite(c.credits) ? c.credits : null,
          grade: c.grade?.trim() || null,
          term: c.term?.trim() || null,
          status: c.status,
        }))
        .filter((c) => c.code.length > 0),
      exams: parsed.exams.map((e) => ({ kind: e.kind.trim(), exam: e.exam.trim(), score: e.score?.trim() || null })),
      notes: parsed.notes.map((n) => n.trim()).filter(Boolean),
    };
    if (reading.courses.length === 0) {
      return json({ error: 'No course lines were found in this file.', reading }, 422);
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
