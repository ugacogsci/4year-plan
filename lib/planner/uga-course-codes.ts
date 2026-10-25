/**
 * How the UGA planner turns a Bulletin course row's code into the codes it
 * plans with. A row can print a lecture with its lab ("POUL 3000-3000L") or
 * an undergraduate and a graduate number together ("JURI 4600/6600"); the
 * planner books "POUL 3000" and "JURI 4600" (and "JURI 6600" on a graduate
 * board). components/planner/uga-source.tsx builds its courses with these,
 * and the career matcher (career-embedding.ts) indexes each course's meaning
 * vector under the same codes, so both read a row the same way.
 */

export const normUgaCode = (value: string): string => value.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Requirement rows normally print one code. When a row contains a combined
 * lecture/lab or joint listing, this is the stable first code; catalog rows
 * are expanded separately (listedUgaCourseCodes) so both undergraduate and
 * graduate numbers remain searchable.
 */
export function canonicalUgaCode(value: string): string {
  const code = normUgaCode(value).replace(/\s*\*+\s*$/, '');
  const match = code.match(/^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/);
  return match ? `${match[1]} ${match[2]}` : code;
}

/** Return the separately searchable codes printed on a joint UGA course row. */
export function listedUgaCourseCodes(value: string): string[] {
  const code = normUgaCode(value).replace(/\s*\*+\s*$/, '');
  const match = code.match(
    /^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:\/(\d{4}[A-Z]?))?/,
  );
  if (!match) return [canonicalUgaCode(code)];
  return [...new Set([match[2], match[3]].filter(Boolean))].map(
    (number) => `${match[1]} ${number}`,
  );
}
