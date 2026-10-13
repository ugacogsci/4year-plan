/**
 * The rules every club file is held to before it is written, in one place, so
 * the reading pass's store step and the build check the same things.
 *
 *   - Nothing personal: no email address, phone number, uid= value, message
 *     link, mailto: or tel: link (DESIGN 2.3). The parser already dropped the
 *     contact names; these are the shapes that would mean one slipped through.
 *   - Nothing copied: a line we wrote about a club (`does`) may not share a
 *     run of 8 words with the club's own mission or benefits text (DESIGN 2.7).
 *     The draft rule was 12; `does` is only 20 words, so 8 is the safer limit.
 *   - `does` is short: at most 20 words and 140 characters.
 *
 * Pure functions, no file access, no network.
 */
import { EMAIL, PHONE } from './parse.mjs';

export const COPY_RUN = 8;
export const DOES_MAX_WORDS = 20;
export const DOES_MAX_CHARS = 140;

/** Lower-case words, apostrophes and accents folded, so "Illinois’" and "illinois'" are one word. */
export const wordsOf = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Every run of `n` consecutive words in a text, as space-joined strings. */
export function runsOf(text, n = COPY_RUN) {
  const w = wordsOf(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}

/** The first run of `n` words `ours` shares with `theirs` (a string or a Set from runsOf), or null. */
export function sharedRun(ours, theirs, n = COPY_RUN) {
  const pool = theirs instanceof Set ? theirs : runsOf(theirs, n);
  if (pool.size === 0) return null;
  for (const run of runsOf(ours, n)) if (pool.has(run)) return run;
  return null;
}

/** What in a string would make it personal: [] when nothing. */
export function personalIn(text) {
  const s = String(text ?? '');
  const found = [];
  if (new RegExp(EMAIL.source).test(s)) found.push('an email address');
  if (new RegExp(PHONE.source).test(s)) found.push('a phone number');
  if (/[?&]uid=/i.test(s)) found.push('uid=');
  if (/send_message/i.test(s)) found.push('send_message');
  if (/\bmailto:/i.test(s)) found.push('mailto:');
  if (/\btel:/i.test(s)) found.push('tel:');
  return found;
}

/**
 * Why a `does` line cannot ship, or null when it can. `source` is the club's
 * own mission and benefits text (a string or a Set from runsOf); without it
 * the copy rule cannot be checked, and the line does not ship.
 */
export function doesProblem(does, source) {
  if (typeof does !== 'string' || !does.trim()) return 'empty';
  const words = wordsOf(does).length;
  if (words > DOES_MAX_WORDS) return `${words} words (at most ${DOES_MAX_WORDS})`;
  if (does.length > DOES_MAX_CHARS) return `${does.length} characters (at most ${DOES_MAX_CHARS})`;
  const personal = personalIn(does);
  if (personal.length) return `holds ${personal.join(', ')}`;
  if (source === undefined || source === null) return 'the club text is not here to check it against';
  const run = sharedRun(does, source);
  if (run) return `copies "${run}" from the club's own text`;
  return null;
}
