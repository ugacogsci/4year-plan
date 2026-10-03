import type { Course } from './types';

export interface CourseMention {
  text: string;
  course?: Course;
}

/** Only link catalog entries, retaining the warning's original wording. */
export function splitCourseMentions(text: string, byCode: ReadonlyMap<string, Course>): CourseMention[] {
  const tokens = /\b([A-Z]{2,8})[\s-]*(\d{3,4}[A-Z]{0,2})\b|\b(\d{3,4}[A-Z]{0,2})\b/gi;
  const parts: CourseMention[] = [];
  let cursor = 0;
  let subject = '';
  let previousEnd = 0;
  for (const match of text.matchAll(tokens)) {
    const prefix = match[1];
    const number = match[2] ?? match[3];
    let start = match.index;
    if (prefix && !/^(and|or)$/i.test(prefix)) {
      subject = prefix.toUpperCase();
    } else {
      start += match[0].lastIndexOf(number);
      // Resolve shorthand lists such as "CS 124, 128 or 173", not credit totals or years.
      if (!/^[\s,;/]*(?:(?:and|or)[\s,;/]*)?$/i.test(text.slice(previousEnd, start))) subject = '';
    }
    const course = subject ? byCode.get(`${subject} ${number.toUpperCase()}`) : undefined;
    previousEnd = match.index + match[0].length;
    if (!course) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: text.slice(start, previousEnd), course });
    cursor = previousEnd;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
