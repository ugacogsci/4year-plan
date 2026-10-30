/**
 * What a student reads when an AI call fails: the model's account is out of
 * credit, the key is wrong, the model is overloaded, the network dropped.
 *
 * Never the API's own words. An out-of-credit account once showed students
 * "The advisor's model answered 400: Your credit balance is too low to access
 * the Anthropic API..." (2026-10-30). The planner itself needs no AI, so the
 * message says the plan still works. The detail goes to the server log, where
 * the people running the site can read it, and never a key.
 */

/** The sentence for any failure the student cannot fix, naming who failed ("The advisor", "ALMA"). */
export function aiUnavailable(who = 'The advisor'): string {
  return `${who} is unavailable right now - your plan still works; try again in a bit.`;
}

/** Too many questions at once (the model's own rate limit): worth a retry soon. */
export function aiBusy(who = 'The advisor'): string {
  return `${who} is getting a lot of questions right now. Try again in a minute; your plan still works.`;
}

/** For the server log: status, type and the first line of the message, never headers or keys. */
export function aiFailureForLog(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error).slice(0, 200);
  const e = error as { status?: unknown; name?: unknown; message?: unknown; error?: { error?: { type?: unknown } } };
  const type = e.error?.error?.type;
  const message = typeof e.message === 'string' ? e.message.split('\n')[0].replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…') : '';
  return [typeof e.status === 'number' ? e.status : null, typeof e.name === 'string' ? e.name : null, typeof type === 'string' ? type : null, message.slice(0, 200)]
    .filter(Boolean)
    .join(' ');
}

/** Whether the account behind the key has run out of credit (the API answers 400 with this text). */
export function isOutOfCredit(error: unknown): boolean {
  const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
  return /credit balance|billing|purchase credits|plans? & billing/i.test(message);
}
