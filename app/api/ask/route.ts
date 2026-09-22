import { NextResponse } from 'next/server';

/**
 * The answer endpoint.
 *
 * This is the seam where the TRU engine plugs into the planner. It proxies a
 * deployed TRU tenant, picking the path that matches the school the student
 * chose in onboarding. Mizzou is the root tenant; the rest are prefixed. When a
 * school has no tenant yet it says so rather than answering from a different
 * university's pages.
 *
 * Anything the planner can answer from the files already in the browser has
 * been answered before the request gets here. lib/planner/ask-router.ts decides
 * that, and only what it could not answer is forwarded.
 *
 * The contract is deliberately narrow, and it is the contract that matters more
 * than the implementation: { text, sources[] }. An answer without the page it
 * came from does not ship.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const UPSTREAM = process.env.TRU_UPSTREAM ?? '';

/** Students read these. "illinois" is an id, not a name. */
const SCHOOL_NAME: Record<string, string> = {
  mizzou: 'Mizzou', tamu: 'Texas A&M', vt: 'Virginia Tech',
  illinois: 'Illinois', uga: 'UGA',
};

// Mizzou is served at the root of the TRU deployment; every other school sits
// under its own prefix.
const PREFIX: Record<string, string> = {
  mizzou: '',
  tamu: '/tamu',
  vt: '/vt',
  illinois: '/illinois',
  uga: '/uga',
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    question?: unknown;
    school?: unknown;
    prior?: unknown;
  };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  /**
   * The previous exchange, in the shape the tenant reads: its own last answer
   * and the question that produced it. It used to be forwarded as a bare
   * string, which the tenant checks for `.q` and `.a` and silently drops, so
   * every follow-up arrived with no memory of the answer it followed.
   */
  const p = body.prior as { q?: unknown; a?: unknown } | null | undefined;
  const prior =
    p && typeof p === 'object' && typeof p.q === 'string' && typeof p.a === 'string'
      ? { q: p.q.slice(0, 400), a: p.a.slice(0, 1000) }
      : undefined;

  if (!question) {
    return NextResponse.json({ error: 'Ask something.' }, { status: 400 });
  }

  const school = typeof body.school === 'string' ? body.school : '';
  const prefix = PREFIX[school];

  if (!UPSTREAM || prefix === undefined) {
    return NextResponse.json({
      text:
        // This reaches a student in the answer bubble, so it says what they can
        // do, not what an operator can. The old copy named an environment
        // variable and printed the raw school id.
        'I can answer questions about your own schedule right here, but I cannot reach ' +
        (SCHOOL_NAME[school] ?? 'your university') +
        "'s published pages from this build. Try asking about a course on your board, " +
        'what it needs first, where it meets, or how heavy a term looks.',
      sources: [],
      contacts: [],
      grounded: false,
      locked: false,
    });
  }

  /**
   * The caller's address is forwarded so the tenant's rate limiter buckets by
   * student rather than by API key. Without it every planner user in the world
   * shares one bucket and the first busy minute locks everybody out.
   */
  const forwarded =
    req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';

  try {
    const res = await fetch(`${UPSTREAM.replace(/\/$/, '')}${prefix}/api/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      },
      body: JSON.stringify({ question, ...(prior ? { prior } : {}) }),
      signal: AbortSignal.timeout(175_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      text?: string;
      error?: string;
      sources?: unknown;
      contacts?: unknown;
      grounded?: boolean;
      locked?: boolean;
    };

    /**
     * A 400, 413 or 429 from the tenant carries its reason in `error` and no
     * text. Dropping that field rendered an empty answer bubble, which tells a
     * student nothing about why their question did not work.
     */
    if (!res.ok) {
      return NextResponse.json(
        {
          error: data.error ?? `The answer service returned ${res.status}.`,
          text: data.text ?? '',
          sources: [],
          contacts: [],
          grounded: false,
          locked: false,
        },
        { status: res.status },
      );
    }

    return NextResponse.json({
      text: data.text ?? '',
      sources: Array.isArray(data.sources) ? data.sources : [],
      // Forwarded rather than dropped: a tenant that answers with an office and
      // a phone number is answering with the part a student actually needs.
      contacts: Array.isArray(data.contacts) ? data.contacts : [],
      grounded: data.grounded ?? false,
      locked: data.locked ?? false,
    });
  } catch {
    return NextResponse.json(
      {
        text: 'The answer service did not respond. The planner above still works.',
        sources: [],
        contacts: [],
        grounded: false,
        locked: false,
      },
      { status: 200 },
    );
  }
}
