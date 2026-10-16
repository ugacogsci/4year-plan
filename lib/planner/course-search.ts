function searchableText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** All query words must match, in any order; partial words and compact codes work too. */
export function searchCourseCatalog<T extends { code: string; title: string }>(
  courses: readonly T[],
  query: string,
  excludedCodes: ReadonlySet<string> = new Set(),
): T[] {
  const words = searchableText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return courses.filter((course) => {
    const code = course.code.replace(/\s+/g, ' ').trim().toUpperCase();
    if (excludedCodes.has(code)) return false;
    const text = searchableText(`${code} ${code.replace(/\s+/g, '')} ${course.title}`);
    return words.every((word) => text.includes(word));
  });
}
