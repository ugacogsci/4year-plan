#!/usr/bin/env node
/**
 * UGA degree requirements, the piece the planner cannot work without.
 *
 * The 4year-plan repo ships one requirements file marked "illustrative". A
 * plan needs the real thing: which courses a major requires, how they are
 * grouped, how many hours each group needs, and where a student gets to
 * choose.
 *
 * The Bulletin renders as a JavaScript shell, so a plain crawl of
 * bulletin.uga.edu returns 223 words on every path. But the same internal
 * endpoint pattern Orion found for courses also serves programs:
 *
 *   POST /Program/_ViewAllPrograms   (paginated list)
 *   GET  /Program/Details/{id}?IDc={college}
 *
 * A detail page carries ~10,000 words: the Area I-VI structure, entrance
 * requirements, required courses, total major hours, and a four-year program
 * of study. Each course is its own one-row table, "CODE | Title | Hours",
 * preceded by an area heading like "I. Foundation Courses (9 Hours)" and
 * sometimes a rule, "Choose 1 course(s) from the following:".
 *
 *   node scripts/uga-programs.mjs --limit 5     # sample
 *   node scripts/uga-programs.mjs               # everything
 *   node scripts/uga-programs.mjs --undergraduate        # bachelor's degrees only, the rest kept
 *   node scripts/uga-programs.mjs --degrees MINOR,CERT-UG  # those kinds only, the rest kept
 *   node scripts/uga-programs.mjs --levels       # only the level ranges of bachelor's
 *                                                # subject-wide rows ("3000-level or higher"),
 *                                                # every other field of the file kept as it is
 *   node scripts/uga-programs.mjs --cache <dir>  # bachelor's degrees re-read from saved pages
 *                                                # ({id}.html.gz or prog-{id}.html.gz), no fetching;
 *                                                # a degree with no saved page is kept as it is
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "public", "uga-programs.json");
const UA = "FourYearPlanBot/1.0 (student planning project; respects robots.txt)";
const BASE = "https://bulletin.uga.edu";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clean = (h) =>
  h.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const undergraduateDegree = (degree) =>
  degree === 'AB' || /^B[A-Z]+$/.test(degree);

/**
 * The levels a subject-wide row takes, as the page words it after the first
 * level: "POLS prefix course 3000-level or higher" is 3000 to 5999, "AFAM
 * prefix courses 2000-level or below" 1000 to 2999, "1000/2000-level" both.
 * The row's code keeps its first level ("POLS 3XXX"); levelFrom and levelTo
 * (first digits) are set only where they differ from it. Read as the first
 * level alone, a Political Science senior's ten 4000-level POLS classes
 * counted for none of the major's 18 hours "3000-level or higher" (2026-10-28).
 */
function levelRange(level, second, qualifier) {
  const n = Number(level);
  const to = second ? Number(second) : /higher|above/i.test(qualifier ?? '') ? 5 : n;
  const from = /below/i.test(qualifier ?? '') ? 1 : n;
  return { ...(from !== n ? { levelFrom: from } : {}), ...(to !== n ? { levelTo: Math.max(to, from) } : {}) };
}

/**
 * An emphasis's name as its section's heading or paragraph prints it: "Area
 * of Emphasis in Acting (19 hours)" is Acting, "Business Analytics (12
 * hours) (Optional)" Business Analytics; null for a heading over several
 * ("Areas of Emphasis").
 */
function emphasisName(label) {
  const text = clean(label).replace(/\s*\((?:\d+(?:\s*-\s*\d+)?\s*(?:credit\s+)?hours?|optional)\)/gi, '').trim();
  if (!text || /^areas? of emphasis$/i.test(text)) return null;
  const named = text.match(/^Areas? of Emphasis(?:\s+in|\s*[-:])\s+(.+)$/i)?.[1];
  return (named ?? text).replace(/^Optional\s*[-:]\s*/i, '').trim() || null;
}

/** One emphasis however the page words its name (parseEmphases, withSections). */
const emphasisKey = (label) => label
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(?:only|hours?)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Areas of emphasis are not ordinary optional prose. Some programs require
 * one, while others let a student add one to the base major. Keep their names
 * and course pools separate so setup can ask the student explicitly and the
 * planner can constrain the matching requirement instead of mixing every
 * emphasis into one elective list.
 */
function parseEmphases(html) {
  const flat = clean(html);
  const paragraphTexts = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => clean(match[1]))
    .filter(Boolean);
  const headingElements = [...html.matchAll(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi)]
    .map((match) => ({
      at: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      label: clean(match[1]),
    }));
  const elements = [];
  for (const match of html.matchAll(/<(p|h[3-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(match[2]);
    const named = text.match(
      /^Area of Emphasis(?:\s+in|\s*[-:])\s+(.+?)(?:\s*\(\s*Optional\s*\))?$/i,
    );
    if (!named) continue;
    const label = clean(named[1]).replace(/\s*\(\d+(?:\s*-\s*\d+)?\s*hours?\)\s*$/i, '');
    if (
      !label ||
      label.length > 100 ||
      /\b(?:should|must|will|may|recognition|completion|requirements?)\b/i.test(label)
    ) continue;
    elements.push({ at: match.index ?? 0, end: (match.index ?? 0) + match[0].length, label });
  }

  const fourYearAt = html.search(/<h4\b[^>]*id=["']Four-Year Program of Study["']/i);
  const requiredPathText = paragraphTexts.find((text) =>
    /^Complete one of the following\s*:/i.test(text) ||
    /^Complete the .{0,100}\btrack\b\s+OR\s+the Area of Emphasis/i.test(text),
  ) ?? '';
  if (requiredPathText) {
    for (const heading of headingElements) {
      if (!/\bTrack$/i.test(heading.label)) continue;
      if (!requiredPathText.toLowerCase().includes(heading.label.toLowerCase())) continue;
      elements.push(heading);
    }
  }
  const markers = elements
    .filter((element) => fourYearAt < 0 || element.at < fourYearAt)
    .filter(
      (element, index, all) =>
        all.findIndex((candidate) => candidate.at === element.at && candidate.label === element.label) === index,
    )
    .sort((left, right) => left.at - right.at);
  if (markers.length === 0) return [];

  /*
   * The page's own words for a choice of one the degree requires, which a
   * later line may read as an optional add-on: Plant Biology's "Select one
   * Area of Emphasis", Natural Resource Management's "Choose an Area of
   * Emphasis below", Science Education's "Choose 1 group(s) from the
   * following: Area of Emphasis in Biology ..." (2026-10-29 audit: their
   * boards held every emphasis, or none and no major).
   */
  const requiredText =
    flat.match(/Complete one of the following areas of emphasis\.?/i)?.[0] ??
    flat.match(/There (?:are|is) .{0,80}areas? of emphasis to choose from within this major\.?/i)?.[0] ??
    flat.match(/(?:must|required to) (?:select|choose|complete).{0,80}area of emphasis\.?/i)?.[0] ??
    flat.match(/\b(?:Select one Area of Emphasis|Choose an Area of Emphasis below|Choose one of the following areas of emphasis|Students should select an Area of Emphasis)\b/i)?.[0] ??
    flat.match(/Choose 1 group\(s\) from the following:?\s*(?=Area of Emphasis\b)/i)?.[0] ??
    flat.match(/(?<!\bor\s)\bChoose (?:an? )?Area of Emphasis in [^.]{0,120}?\bor\b[^.]{0,60}/i)?.[0] ??
    requiredPathText ??
    '';
  const optionalText =
    flat.match(/Students? (?:may|have the option to).{0,100}(?:area|areas) of emphasis\.?/i)?.[0] ??
    flat.match(/may elect to specialize.{0,100}(?:area|areas) of emphasis\.?/i)?.[0] ??
    '';
  const minimum = requiredText ? 1 : 0;

  const areaHeadings = [...html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)].map((match) => {
    const text = clean(match[1]);
    const hours = Number(text.match(/\((\d+)(?:\s*-\s*\d+)?\s*hours?\)/i)?.[1] ?? 0);
    return {
      at: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      label: text.replace(/\s*\(\d+(?:\s*-\s*\d+)?\s*hours?\)\s*$/i, ''),
      hours,
    };
  });

  const parsedOptions = markers.map((marker, index) => {
    const nextArea = areaHeadings.find((heading) => heading.at > marker.at)?.at ?? html.length;
    const next = Math.min(markers[index + 1]?.at ?? html.length, nextArea, fourYearAt < 0 ? html.length : fourYearAt);
    const segment = html.slice(marker.end, next);
    const courses = [];
    for (const table of segment.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      for (const row of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => clean(cell[1]));
        const codeMatch = (cells[0] ?? '').toUpperCase().match(
          /^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/,
        );
        if (!codeMatch) continue;
        const code = `${codeMatch[1]} ${codeMatch[2]}`;
        if (courses.some((course) => course.code === code)) continue;
        const credits = Number((cells[2] ?? '').match(/\d+(?:\.\d+)?/)?.[0] ?? 3);
        courses.push({ code, title: cells[1] ?? code, credits });
      }
    }
    for (const prefix of segment.matchAll(
      /coursePrefix=([A-Z]{2,5})[\s\S]{0,220}?prefix\s+courses?\s+at\s+the\s+(\d)000-level(\s+(?:or|and)\s+above)?/gi,
    )) {
      const code = `${prefix[1].toUpperCase()} ${prefix[2]}XXX`;
      if (!courses.some((course) => course.code === code)) {
        courses.push({ code, ...levelRange(prefix[2], null, prefix[3] ? 'above' : null), title: `${prefix[1].toUpperCase()} ${prefix[2]}000-level${prefix[3] ? ' or higher' : ''} courses`, credits: 0 });
      }
    }
    const precedingArea = [...areaHeadings].reverse().find((heading) => heading.at < marker.at) ?? null;
    const precedingOptionHeading = [...headingElements].reverse().find(
      (heading) =>
        heading.at < marker.at &&
        heading.at > (precedingArea?.at ?? -1) &&
        /\(\d+(?:\s*-\s*\d+)?\s*hours?\)/i.test(heading.label),
    );
    const headingHours = Number(
      precedingOptionHeading?.label.match(/\((\d+)(?:\s*-\s*\d+)?\s*hours?\)/i)?.[1] ?? 0,
    );
    const statedHours = Number(
      clean(segment).match(/Choose\s+(\d+)(?:\s+to\s+\d+)?\s+credit\s+hours?/i)?.[1] ?? 0,
    );
    return {
      id: marker.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label: marker.label,
      hours: statedHours || headingHours || precedingArea?.hours || null,
      areaLabel: precedingArea?.label ?? null,
      courses,
      parts: [{
        areaLabel: precedingArea?.label ?? null,
        hours: statedHours || headingHours || null,
        replaceArea: precedingArea
          ? !/<table[\s\S]*?<\/table>/i.test(html.slice(precedingArea.end, marker.at))
          : false,
        courses,
      }],
    };
  });

  const optionKey = emphasisKey;
  const optionOrder = [];
  const optionsByKey = new Map();
  for (const option of parsedOptions) {
    const key = optionKey(option.label);
    if (!key) continue;
    if (!optionsByKey.has(key)) optionOrder.push(key);
    const previous = optionsByKey.get(key);
    if (!previous) {
      optionsByKey.set(key, option);
      continue;
    }
    const parts = [...previous.parts, ...option.parts];
    const courses = parts.flatMap((part) => part.courses).filter(
      (course, index, all) => all.findIndex((candidate) => candidate.code === course.code) === index,
    );
    optionsByKey.set(key, {
      ...previous,
      hours: Math.max(previous.hours ?? 0, option.hours ?? 0) || null,
      areaLabel: parts.every((part) => part.areaLabel === parts[0].areaLabel) ? parts[0].areaLabel : null,
      courses,
      parts,
    });
  }
  const options = optionOrder.map((key) => optionsByKey.get(key));
  const maximum = /multiple areas of emphasis/i.test(flat) ? options.length : 1;
  const includesTrack = markers.some((marker) => /\bTrack$/i.test(marker.label));

  const areaLabels = new Set(options.map((option) => option.areaLabel).filter(Boolean));
  return [{
    id: includesTrack ? 'degree-path' : 'areas-of-emphasis',
    label: includesTrack ? 'Degree path' : 'Areas of emphasis',
    minimum,
    maximum,
    note: requiredText || optionalText || 'Select an area of emphasis if you plan to complete one.',
    replacesArea: minimum > 0 && areaLabels.size === 1 ? [...areaLabels][0] : null,
    options,
  }];
}

async function listPage(page) {
  const res = await fetch(`${BASE}/Program/_ViewAllPrograms`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE}/Program/Index`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `page=${page}&keyword=&enteredCoursePrefix=&enteredCourseNumber=`,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const out = [];
  // Each card is an anchor to the detail page; the visible text is the degree
  // abbreviation and the program name sits in the surrounding card.
  for (const m of html.matchAll(/<a[^>]+href="\/Program\/Details\/(\d+)\?IDc=([A-Z]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    out.push({ id: m[1], college: m[2], degree: clean(m[3]) });
  }
  // Card titles are the nearest preceding entry-card text block.
  const titles = [...html.matchAll(/class="entry-card--text"[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map((m) => clean(m[1]));
  out.forEach((p, i) => { p.name = titles[i] ?? ""; });
  return out;
}

/**
 * Pull the requirement structure out of a detail page.
 *
 * Walks the document once in order. An area heading opens a bucket, a <b>
 * opens a group inside it, a "Choose N" line sets that group's rule, and every
 * one-row course table that follows belongs to whatever is currently open.
 */
export function parseDetail(html, degree = null) {
  const marks = [];
  const numberWord = (value) =>
    ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 })[
      value.toLowerCase()
    ] ?? Number(value);
  const flatPage = clean(html);
  const majorElectiveExclusions = [
    ...flatPage.matchAll(
      /\b([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:\/\d{4}[A-Z]?)?\s+may not be counted as a Major Elective/gi,
    ),
  ].map((match) => `${match[1].toUpperCase()} ${match[2].toUpperCase()}`);

  /**
   * The Bulletin prints several real course-code shapes that the first pass
   * rejected: CSCI 4470/6470, CSCI 1301-1301L, CSCI(ARTI) 4530/6530 and rows
   * carrying a footnote star. The undergraduate half is the code used by the
   * planner and by prerequisites; the full title still makes the joint listing
   * visible to a student.
   */
  /*
   * The level words of a subject-wide row, the words the Bulletin prints
   * after the subject in its own cell or paragraph: "4000/6000-level courses"
   * (an undergraduate course and its graduate number, one level), "prefix
   * courses at the 3000-level or above", "numbered 3000-5999", "at the
   * 4000-5000 level", "2000-level or below", "prefix courses" or nothing at
   * all (any level). The first level is the row's code ("POLS 3XXX"), the
   * rest its range (levelRange). Read one form at a time, the scrape dropped
   * or cut short the rows the 2026-10-29 audit listed: Philosophy's six PHIL
   * courses "numbered 3010 and higher" and Entomology's "ENTO prefix
   * courses" (18 and 21 hours planned as unnamed electives), "3000-level and
   * above" read as the 3000s alone, Art's "ARHI 3000/4000" as one level.
   * An exception the words name ("excluding 3500") is left to the note.
   * Null where the words are not a row's ("(German/European History)").
   */
  const levelWords = (title) => {
    const text = clean(title)
      .replace(/\((?:except|excluding)\b[^)]*\)?|,?\s*\b(?:except|excluding)\b.*$/i, ' ')
      .replace(/\(\s*\d+(?:\.\d+)?(?:\s*-\s*\d+)?\s*(?:credit\s+)?hours?\b[^)]*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const levels = [...text.matchAll(/\b([1-9])\d{3}\b/g)].map((m) => Number(m[1]));
    const undergraduate = levels.filter((level) => level <= 5);
    if (undergraduate.length === 0) {
      if (levels.length > 0 || /\bfrom the following\b|:\s*$/i.test(text)) return null;
      if (/^upper[- ]division\b/i.test(text)) return { level: '3', range: { levelTo: 5 } };
      if (!/^(?:prefix\b|courses?\b|course\(s\)|literature\b|studio\b|electives?\b|[*^#\s]*$)/i.test(text) && !/\bat any level\b/i.test(text)) return null;
      return { level: '2', range: { levelFrom: 1, levelTo: 5 } };
    }
    const first = undergraduate[0];
    const from = /\bor below\b/i.test(text) ? 1 : Math.min(...undergraduate);
    const to = /\b(?:and|or)\s+(?:above|higher)\b|\b(?:above|higher)\b/i.test(text) ? 5 : Math.max(...undergraduate);
    return { level: String(first), range: { ...(from !== first ? { levelFrom: from } : {}), ...(to !== first ? { levelTo: to } : {}) } };
  };
  /** A subject-wide row's title from its levels: "POLS 3000-level or higher courses". */
  const levelTitle = (subject, { level, range }) => {
    const from = range.levelFrom ?? Number(level);
    const to = range.levelTo ?? Number(level);
    if (from === 1 && to === 5) return `${subject} courses at any level`;
    if (to === 5 && from < 5) return `${subject} ${from}000-level or higher courses`;
    if (from === 1 && Number(level) > 1) return `${subject} ${level}000-level or below courses`;
    return `${subject} ${from}000${to !== from ? `/${to}000` : ''}-level courses`;
  };

  const courseCode = (rawCode, title = '') => {
    const raw = clean(rawCode)
      .replace(/\s*\*+\s*$/, '')
      .trim()
      .toUpperCase();
    const ordinary = raw.match(
      /^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)/,
    );
    if (ordinary) return `${ordinary[1]} ${ordinary[2]}`;

    // The major-elective row is split across two cells: "CSCI" and
    // "4000/6000-level courses". It is a real twelve-hour pool, not one course.
    const subject = raw.match(/^([A-Z]{2,5})$/)?.[1];
    const level = levelWords(title)?.level;
    return subject && level ? `${subject} ${level}XXX` : null;
  };
  /** The level range a two-cell subject row's title words ("4000/6000-level courses", "3000-level or above"). */
  // "4000/6000-level" is an undergraduate course and its graduate number, not two levels (levelWords).
  const titleRange = (code, title) => (code.match(/ (\d)XXX$/) ? levelWords(title)?.range ?? {} : {});

  // Course rows: each course is its own one-row table, "CODE | Title | Hours".
  // Keep whether the Bulletin printed AND before the row. A "Choose 1 group"
  // block uses that word to bind a lecture to its lab.
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    for (const r of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(
        (c) => clean(c[1]),
      );
      const rawCode = cells[0] ?? '';
      const linkedCodes = [
        ...rawCode.toUpperCase().matchAll(/\b([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)\b/g),
      ].map((match) => `${match[1]} ${match[2]}`);
      const fallback = courseCode(rawCode, cells[1] ?? '');
      const codes = [...new Set(linkedCodes.length ? linkedCodes : fallback ? [fallback] : [])];
      if (codes.length === 0) continue;
      const printedCredits = [...(cells[2] ?? '').matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
      /*
       * "(12 hours)" after the code is the hours the degree asks of a
       * variable-credit course: WFED 5460 (12 hours) prints 1-12, and the
       * least of the range booked student teaching as a one-hour class
       * beside a full load (2026-10-29 audit). "MUSI 1810 (4 hours)" on a
       * two-hour lesson is the same course twice, four hours in all.
       */
      const stated = rawCode.match(/\((\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*hours?\)/i);
      /*
       * Above the most one sitting gives ("ARST 4370 (12 hours)" on a
       * three-hour course, "MUSI 1810 (4 hours)" on a two-hour lesson), the
       * course taken again: one booking of the page's hours on a row to take
       * (the walk below), its printed hours in a list to pick from. The
       * planner's repeats need the catalog's repeat rule, which UGA's file
       * has not, and a pick-list booking of twelve hours read 57 of 60 on a
       * board whose record held the course at three.
       */
      const statedHours = stated && Number(stated[1]) > 0 && Number(stated[1]) <= Math.max(...printedCredits, 0) ? Number(stated[1]) : null;
      const repeatHours = stated && statedHours === null && Number(stated[1]) > Math.max(...printedCredits, 0) ? Number(stated[1]) : null;
      const marker = rawCode.replace(/\([^)]*\)/g, ' ').match(/\s([*^#]+)(?=\s|$)/)?.[1] ?? null;
      codes.forEach((code, index) => {
        marks.push({
          kind: 'course',
          at: m.index ?? 0,
          code,
          ...titleRange(code, cells[1] ?? ''),
          title: cells[1] ?? '',
          credits: (index === 0 ? statedHours : null) ?? printedCredits[index] ?? (index > 0 && code.endsWith('L') ? 1 : printedCredits[0] ?? 3),
          ...(index === 0 && statedHours === null && codes.length === 1 && printedCredits.length === 2 && printedCredits[1] > printedCredits[0] ? { creditsMax: printedCredits[1] } : {}),
          ...(marker ? { marker } : {}),
          ...(index === 0 && repeatHours ? { repeatHours } : {}),
          // The page prints a pair's second row "AND CHEM 2211L". Read anywhere in the
          // cell or in the text before the table, "and" bound unrelated rows ("World
          // Languages and Global Culture Core Courses", RELI 4202 to AFAM 4170).
          andPrevious: index > 0 || /^AND\s/.test(rawCode),
        });
      });
    }
  }

  /*
   * A subject-wide row printed as prose, not a course table: a linked
   * subject at the start of its own paragraph or list item, and the words
   * after it to the end of that element (levelWords). Two subjects joined by
   * "or" share the words after the second ("AAEC or ENVM prefix courses at
   * the 3000-4000 level"). Each row reads only its own words: read up to 240
   * characters on, Communication Studies' "COMM prefix courses numbered
   * 3000-5999" took the "2000-level credit" of the note after it. A subject
   * linked inside a sentence is not a row, nor one inside a course table
   * (the table loop above reads those).
   */
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  for (const m of html.matchAll(/<a[^>]*>\s*([A-Z]{2,5})\s*<\/a>/g)) {
    const at = m.index ?? 0;
    if (tables.some(([start, end]) => at > start && at < end)) continue;
    const opened = html.slice(Math.max(0, at - 600), at);
    const elementStart = Math.max(opened.lastIndexOf('<p'), opened.lastIndexOf('<li'));
    if (elementStart < 0) continue;
    const lead = clean(opened.slice(elementStart).replace(/^<[^>]*>/, ''));
    if (!/^(?:AND\s+)?[*^#\s]*(?:[A-Z]{2,5}\s*(?:,|or|and|&|\/)\s*)*$/i.test(lead)) continue;
    const rest = html.slice(at + m[0].length, at + m[0].length + 600);
    const stop = rest.search(/<\/(?:p|li|div)>|<(?:p|li|table|h\d|div|br)\b/i);
    let words = clean(rest.slice(0, stop < 0 ? 400 : stop));
    const shared = words.match(/^(?:(?:,|or|and|&|\/)\s*[A-Z]{2,5}\s*)+(.*)$/);
    if (shared && /^(?:,|or|and|&|\/)/i.test(words)) words = shared[1];
    const read = levelWords(words);
    if (!read) continue;
    const subject = m[1].toUpperCase();
    const marker = words.replace(/\([^)]*\)/g, ' ').match(/([*^#]+)\s*$/)?.[1] ?? null;
    marks.push({
      kind: 'course',
      at,
      code: `${subject} ${read.level}XXX`,
      ...read.range,
      title: levelTitle(subject, read),
      credits: 0,
      ...(marker ? { marker } : {}),
      // No level words of its own: a header line above it may give one ("1000/2000-level courses from the following prefixes:").
      ...(/\b[1-9]\d{3}\b/.test(words) || /^upper/i.test(words) ? {} : { noLevel: true }),
    });
  }

  /*
   * Rows the page prints as a plain paragraph, not a course table or a
   * linked subject (paragraphs, below):
   *   - "AND STAT 4520", "THEA 5353/7353": a course;
   *   - "Upper division courses", "Courses numbered 3000 and above",
   *     "Upper-division electives": any course at the 3000 level or higher,
   *     the "12 hours numbered 3000+" of a General Electives area the
   *     planner booked at any level (Psychology 17 hours, Religion 18,
   *     Arabic 18, 2026-10-29 audit);
   *   - "Courses at any level", "Any discipline course at any level": any
   *     course, a row of its own outside a General Electives area (the
   *     Grady majors' Major Electives were missing: 102 of 120 hours);
   *   - "1000/2000-level courses from the following prefixes:", "Any
   *     upper-level course in the following prefix:": the levels of the
   *     subject rows under it that name none;
   *   - a sentence that recommends or suggests ("It is recommended that
   *     students complement course work in the major with courses in the
   *     following prefixes:"): the rows after it are advice, not
   *     requirements (Physics' recommended PHYS 4102/4202/4702 were an
   *     18-hour pool no board could meet);
   *   - a footnote ("* Only one of these courses can be used to fulfill
   *     this requirement", "^3000-level or above"): read against the rows
   *     carrying its marker.
   */
  const UPPER_ROW = /^(?:any\s+)?(?:upper[- ](?:division|level)\b|courses?\s+(?:numbered\s+)?3000(?:-level)?\s+(?:and|or)\s+(?:above|higher)|courses?\s+should\s+be\s+3\s+(?:credit\s+)?hours(?:\s+each)?\s+and\s+numbered\s+3000\s+and\s+above|any\s+prefix\s+courses\s+at\s+3000-level\s+or\s+above|3000-level\s+course\s+or\s+higher,\s+any\s+prefix)/i;
  const ANY_ROW = /^(?:any\s+(?:level\b|courses?\b(?!\s+(?:with|in)\b)|discipline\b|prefix\s+courses\s+at\s+any\s+level|general\s+elective)|courses?(?:\(s\))?\s+(?:at|from|in)\s+any\b|general\s+electives?(?:\s+(?:courses?|coursework))?(?:\s+at\s+any\s+level)?\.?$|elective\s+courses?\.?$)/i;
  const ADVICE = /\b(?:recommend(?:ed|s)?|suggested|strongly\s+encouraged|encouraged\s+to)\b/i;
  /*
   * Lines whose rows are met by courses the degree counts elsewhere, not
   * more hours: "All students must complete at least one 3-credit hour
   * course in each of the following six areas somewhere in the degree
   * program" (Agricultural Education), "This major requires the completion
   * of one course in each of the following prefixes" (Social Studies
   * Education, whose core courses meet it), and a language rule's list of
   * languages ("Competency in one Foreign Language through the 3rd
   * semester ... AMSL"). Read as rows, each subject became a course to add:
   * Social Studies Education boards planned 142 of 120 hours.
   */
  const ELSEWHERE = /\bsomewhere in the degree program\b|\bone course in each of the following prefixes\b|^Foreign Language required, if not taken\b/i;
  for (const m of html.matchAll(/<p\b[^>]*>((?:(?!<\/?p\b)[\s\S])*?)<\/p>/gi)) {
    const at = m.index ?? 0;
    if (/coursePrefix=/i.test(m[1]) || tables.some(([start, end]) => at > start && at < end)) continue;
    const text = clean(m[1]);
    if (!text || /^Choose\b/i.test(text)) continue;
    // "Area of Emphasis in Plant Ecology and Environment (14-16 hours)": an emphasis's section starts (the walk), as under a heading.
    const named = text.match(/^Area of Emphasis(?:\s+in|\s*[-:])\s+(.+?)(?:\s*\(\s*Optional\s*\))?$/i);
    if (named && named[1].length <= 100 && !/\b(?:should|must|will|may|recognition|completion|requirements?)\b/i.test(named[1])) {
      marks.push({ kind: 'heading', at, level: 7, label: text, optional: true });
      continue;
    }
    const single = text.match(/^(AND\s+)?([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:\/\d{4}[A-Z]?)?(?:-\d{4}[A-Z]?(?:\/\d{4}[A-Z]?)?)?\s*[*^#]*$/);
    if (single) {
      const code = `${single[2]} ${single[3]}`;
      marks.push({ kind: 'course', at, code, title: code, credits: code.endsWith('L') ? 1 : 3, andPrevious: Boolean(single[1]) });
      continue;
    }
    /*
     * "(At least one 3000/4000-level course in each of three geographical
     * areas.)", "Choose courses from three different groups.": the choice
     * above draws on that many of its lists (a constraint, the walk below).
     * Without it, History's nine hours over seven regional lists could all
     * come from one.
     */
    const spread = text.match(/^\(?\s*(?:At least one\b[^.]*?\bin each of|Choose courses from)\s+(one|two|three|four|five|six|\d+)\b[^.]*?\b(?:different\s+)?(?:areas?|groups?|lists?)\b/i);
    if (spread) {
      marks.push({ kind: 'spread', at, n: numberWord(spread[1]), text: text.replace(/^\(|\)$/g, '') });
      continue;
    }
    // "Note: These courses must be upper-division." under Advertising's "ADPR prefix", "EMST prefix" rows: their levels, read after them.
    if (/^Note:\s*These courses must be upper[- ]division\b/i.test(text)) {
      marks.push({ kind: 'levels', at, read: { level: '3', range: { levelTo: 5 } }, above: true });
      continue;
    }
    /*
     * Grady's Major Electives: "Complete a minor/certificate ... OR Complete
     * 15 credit hours from no more than two disciplines. The following
     * prefixes may not be used to satisfy this requirement: ADPR, EMST,
     * JOUR, ...". The hours from any course outside those subjects (a minor
     * meets them too); with no row, the four Grady degrees' boards had no
     * Major Electives (102 of 120 hours, 2026-10-29 audit).
     */
    const outside = text.match(/\bOR Complete (\d+) credit hours from no more than \w+ disciplines\b/i);
    if (outside) {
      marks.push({ kind: 'rule', at, choose: null, hours: Number(outside[1]), minimum: false, upperDivisionHours: null, minimumAreas: null, note: text.slice(0, 300), grouped: false, structured: false });
      marks.push({ kind: 'course', at: at + 1, code: 'ANY 1XXX', title: 'Any course at any level', credits: 0 });
      const barred = text.match(/prefixes may not be used to satisfy this requirement:\s*([A-Z]{2,5}(?:,?\s*(?:and\s+)?[A-Z]{2,5})*)/)?.[1]?.match(/[A-Z]{2,5}/g);
      if (barred) marks.push({ kind: 'exclude', at: at + 2, prefixes: barred });
      continue;
    }
    // "Complete the following Professional Development course (1 hour) during junior year": a row of courses to take, of its own.
    if (/^Complete the following\b/i.test(text)) {
      marks.push({ kind: 'rule', at, choose: null, hours: null, minimum: false, upperDivisionHours: null, minimumAreas: null, note: text.slice(0, 200), grouped: false, structured: false });
      continue;
    }
    const footnotes = text.match(/^[*^#]/) ? [...text.matchAll(/([*^#]+)\s*((?:(?![*^#]).)+)/g)].map((f) => ({ marker: f[1], text: f[2].trim() })) : [];
    if (footnotes.length) {
      for (const footnote of footnotes) marks.push({ kind: 'footnote', at, ...footnote });
      continue;
    }
    if (ELSEWHERE.test(text)) {
      marks.push({ kind: 'advice', at });
      continue;
    }
    if (text.length > 160) {
      if (ADVICE.test(text)) marks.push({ kind: 'advice', at });
      continue;
    }
    if (UPPER_ROW.test(text) && !/\bany level\b|following|prefix(?:es)?\s*:|chosen focus|one (?:department|subject)|same discipline|:\s*$/i.test(text)) {
      marks.push({ kind: 'course', at, code: 'ANY 3XXX', title: 'Any course at the 3000 level or higher', credits: 0 });
    } else if (ANY_ROW.test(text) && !/approval|chosen with|foreign language|:\s*$/i.test(text)) {
      marks.push({ kind: 'course', at, code: 'ANY 1XXX', title: 'Any course at any level', credits: 0, anyLevel: true });
    } else if (/(?:following|listed below)[^.]*:?\s*$|prefix(?:\(es\)|es)?\s*:\s*$/i.test(text) && /\b[1-9]000\b|upper[- ](?:level|division)/i.test(text)) {
      const read = levelWords(text.replace(/^any\s+/i, '').replace(/^upper[- ]level\b/i, 'upper-division'));
      if (read && !(read.range.levelFrom === 1 && read.range.levelTo === 5)) marks.push({ kind: 'levels', at, read });
    } else if (ADVICE.test(text)) {
      marks.push({ kind: 'advice', at });
    }
  }

  // Some elective buckets are intentionally campus-wide and therefore have
  // no linked subject code. Preserve those rows as expandable wildcards so
  // the planner can enforce upper-division and non-business hour splits.
  for (const m of html.matchAll(/Any\s+upper[- ]level\s+course\s+3000\s*-\s*5999/gi)) {
    marks.push({
      kind: 'course',
      at: m.index ?? 0,
      code: 'ANY 3XXX',
      title: 'Any upper-level course (3000-5999)',
      credits: 0,
    });
  }
  for (const m of html.matchAll(/Any\s+course\s*\*/gi)) {
    marks.push({
      kind: 'course',
      at: m.index ?? 0,
      code: 'ANY 1XXX',
      title: 'Any undergraduate course',
      credits: 0,
    });
  }

  // A few programs publish the broad elective rule as prose instead of a
  // linked table. English is the important example: five three-hour ENGL
  // electives at the 3000/4000 levels, followed by many optional emphases.
  for (const m of html.matchAll(
    /Choose\s+(one|two|three|four|five|six|\d+)\s+(\d+)-hour\s+([A-Z]{2,5})\s+electives?\s+at\s+the\s+(\d)000\/(\d)000\s+levels?/gi,
  )) {
    const amount =
      ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 })[
        m[1].toLowerCase()
      ] ?? Number(m[1]);
    marks.push({
      kind: 'rule',
      at: m.index ?? 0,
      choose: null,
      hours: amount * Number(m[2]),
      minimum: false,
      upperDivisionHours: null,
      minimumAreas: null,
      note: clean(m[0]),
      grouped: false,
    });
    for (const level of [m[4], m[5]]) {
      marks.push({
        kind: 'course',
        at: (m.index ?? 0) + 1,
        code: `${m[3].toUpperCase()} ${level}XXX`,
        title: `${m[3].toUpperCase()} ${level}000-level electives`,
        credits: 0,
      });
    }
  }

  for (const m of html.matchAll(/Students\s+may\s+choose\s+to\s+add\s+an\s+Area\s+of\s+Emphasis/gi)) {
    marks.push({
      kind: 'heading',
      at: m.index ?? 0,
      level: 6,
      label: 'Areas of Emphasis',
      optional: true,
    });
  }

  // Area headings. Anchor on the "(N Hours)" marker and read the label
  // backwards to the previous tag, because requiring the label to follow a
  // ">" silently dropped Area I and Area V on every program.
  // Not the hours of a row ("WFED 5460 (12 hours)", "MUSI courses 3000-level
  // and above (8 hours)", "Upper division courses (0-1 hours)"), nor of a
  // footnote or an instruction ("Provide a detailed log of pre-professional
  // experiences (40 hours)"): each opened a requirement area of its own.
  for (const m of html.matchAll(/\((\d+)(?:\s*-\s*\d+)?\s*(?:&nbsp;)?\s*Hours?\)/gi)) {
    const at = m.index ?? 0;
    const before = html.slice(Math.max(0, at - 160), at);
    const label = clean(before.split(">").pop() ?? "");
    if (!label || label.length < 3 || label.length > 90) continue;
    if (tables.some(([start, end]) => at > start && at < end)) continue;
    const opened = html.slice(Math.max(0, at - 800), at);
    const element = [...opened.matchAll(/<(h[3-6]|p|td|li)\b/gi)].pop();
    if (element && !/^h/i.test(element[1])) {
      const lead = opened.slice(element.index ?? 0);
      if (/coursePrefix=/i.test(lead) || /^[*^#]|^(?:provide|upper[- ]division|choose|complete the following|any)\b/i.test(clean(lead.replace(/^<[^>]*>/, '')))) continue;
    }
    // How deep the heading is (4 for an h4, 7 for a paragraph): a deeper one inside an area may be part of it (the walk below).
    marks.push({ kind: "area", at, label, hours: Number(m[1]), depth: element && /^h/i.test(element[1]) ? Number(element[1][1]) : 7 });
  }

  /*
   * An area of emphasis as the page names one ("Area of Emphasis in Acting",
   * "Area of Emphasis: Data Analytics"), which a student adds or picks. Social
   * Studies Education's "Area of Emphasis Content Courses (21 hours)" is a
   * required part of its Required Courses; read as an optional emphasis,
   * it and every row after it were dropped, and boards held 57 of 120 hours.
   */
  const EMPHASIS_NAMED = /^Areas? of Emphasis(?:\s+in\b|\s*[-:(]|\s*$)/i;

  // Section and group headings are meaningful on UGA pages. Without them the
  // Application Design and Systems Design lists become anonymous, and courses
  // under Entrance Requirements leak backward into Area VI.
  for (const m of html.matchAll(/<h([3-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const label = clean(m[2]);
    if (label)
      marks.push({
        kind: 'heading',
        at: m.index ?? 0,
        level: Number(m[1]),
        label,
        optional:
          EMPHASIS_NAMED.test(label) ||
          EMPHASIS_NAMED.test(
            clean(
              html.slice(
                (m.index ?? 0) + m[0].length,
                (m.index ?? 0) + m[0].length + 520,
              ),
            ),
          ),
        // A list the page recommends or suggests, or the Double Dawgs graduate courses: advice, not the degree.
        advice: /\b(?:recommended|suggested|double dawgs?)\b/i.test(label),
      });
  }

  // UGA uses both counts and credit totals: "Choose 1 course(s)" and "Choose
  // 12 credit hour(s)". They are not interchangeable.
  for (const m of html.matchAll(
    /Choose\s+(a\s+minimum\s+of\s+)?(\d+)\s+(course|credit\s+hour|group)\(s\)/gi,
  )) {
    const before = clean(
      html.slice(Math.max(0, (m.index ?? 0) - 420), m.index ?? 0),
    );
    if (
      /Area of Emphasis in Artificial Intelligence should select/i.test(before)
    )
      continue;
    const amount = Number(m[2]);
    const inHours = /credit/i.test(m[3]);
    const grouped = /group/i.test(m[3]);
    const after = clean(html.slice(m.index ?? 0, (m.index ?? 0) + 900));
    const sentence =
      after.match(/^Choose\b.*?(?:\.(?=\s)|$)/i)?.[0] ?? '';
    const upperDivisionHours = Number(
      sentence.match(/(?:totaling|total of)\s+(\d+)\s+upper[- ]division hours?/i)?.[1] ??
        0,
    );
    const areaMinimum = sentence.match(
      /at least\s+(one|two|three|four|five|six|\d+)\s+of\s+the\s+following\s+(?:\w+\s+)?areas?/i,
    );
    const distinctAreas = /each course must come from a different area/i.test(
      after,
    );
    marks.push({
      kind: 'rule',
      at: m.index ?? 0,
      choose: inHours ? null : amount,
      hours: inHours ? amount : null,
      minimum: Boolean(m[1]),
      upperDivisionHours: upperDivisionHours || null,
      minimumAreas: areaMinimum
        ? numberWord(areaMinimum[1])
        : distinctAreas
          ? amount
          : null,
      note: m[1] ? sentence : '',
      grouped,
      structured: Boolean(m[1]) || distinctAreas,
    });
  }

  /*
   * "Choose 5 to 7 courses from the following" and "Choose 12 to 18 credit
   * hours": the least they ask for. "Choose a maximum of 2 course(s)" is a
   * list a student may take from, not a requirement: a group of its own
   * that asks for none, so its subject row does not join the take-every-
   * course row above it (Communication Studies' COMM 2XXX).
   */
  for (const m of html.matchAll(/Choose\s+(\d+)\s+to\s+(\d+)\s+(courses?|credit\s+hours?)\b/gi)) {
    const inHours = /credit/i.test(m[3]);
    // "Choose 0 to 21 credit hours" asks for none: a list to take from, as "a maximum of" below.
    const least = Number(m[1]);
    marks.push({ kind: 'rule', at: m.index ?? 0, choose: least === 0 ? 0 : inHours ? null : least, hours: inHours && least > 0 ? least : null, ...(!inHours && least > 0 ? { most: Number(m[2]) } : {}), minimum: true, upperDivisionHours: null, minimumAreas: null, note: clean(html.slice(m.index ?? 0, (m.index ?? 0) + 300)).match(/^Choose\b.*?(?:\.(?=\s)|:|$)/i)?.[0] ?? '', grouped: false, structured: false });
  }
  /*
   * "Select six courses from below. At least one course must be taken from
   * Group B.": one choice over the headed lists below it (the walk reads
   * them as lists, as "Choose 12 credit hours" over its lists), and a list's
   * own "Choose 1 to 6 courses" is its least (a constraint, below), not a
   * row of its own: read as rows, Environmental Engineering's 18 hours of
   * Major Electives were Group B's one course and 15 unnamed hours.
   */
  for (const m of html.matchAll(/\b(?:Select|Choose)\s+(one|two|three|four|five|six|seven|eight|\d+)\s+courses\s+from\s+(?:below|the following(?=\s+groups))\b/gi)) {
    const amount = ({ seven: 7, eight: 8 })[m[1].toLowerCase()] ?? numberWord(m[1]);
    marks.push({ kind: 'rule', at: m.index ?? 0, choose: amount, hours: null, minimum: false, upperDivisionHours: null, minimumAreas: null, note: clean(html.slice(m.index ?? 0, (m.index ?? 0) + 400)).match(/^(?:Select|Choose)\b.*?(?:\.(?=\s)|$)(?:\s+At least[^.]*\.)*/i)?.[0] ?? '', grouped: false, structured: true, overGroups: true, ownArea: true });
  }
  /*
   * "Choose course(s) from the following:", no number: a row of its own, one
   * course. Astrophysics' Area VI asks for Calculus III and then, on this
   * line, Physics II; read into the Calculus row, either one met both.
   */
  for (const m of html.matchAll(/Choose\s+course\(s\)\s+from\s+the\s+following/gi)) {
    marks.push({ kind: 'rule', at: m.index ?? 0, choose: 1, hours: null, minimum: false, upperDivisionHours: null, minimumAreas: null, note: '', grouped: false, structured: false });
  }
  for (const m of html.matchAll(/Choose\s+a\s+maximum\s+of\s+(\d+)\s+(?:course|credit\s+hour)\(s\)/gi)) {
    marks.push({ kind: 'rule', at: m.index ?? 0, choose: 0, hours: null, minimum: false, upperDivisionHours: null, minimumAreas: null, note: clean(m[0]), grouped: false, structured: false });
  }

  // Minor and certificate pages write the rule as prose over named groups:
  // "Choose a total of 4 courses from Group 1 and Group 2." One rule for the
  // area, its groups the lists it draws on (structured, as "Choose a minimum
  // of ..." above); a group's own "Choose 2 to 3 courses" is kept in the note.
  for (const m of html.matchAll(
    /Choose\s+a\s+total\s+of\s+(one|two|three|four|five|six|\d+)\s+(courses?|credit\s+hours?|hours?)\s+from\s+(?:the\s+)?groups?\b/gi,
  )) {
    const amount = numberWord(m[1]);
    const inHours = /hour/i.test(m[2]);
    const after = clean(html.slice(m.index ?? 0, (m.index ?? 0) + 900));
    marks.push({
      kind: 'rule',
      at: m.index ?? 0,
      choose: inHours ? null : amount,
      hours: inHours ? amount : null,
      minimum: false,
      upperDivisionHours: null,
      minimumAreas: null,
      note: after.match(/^Choose\b.*?(?:\.(?=\s)|$)/i)?.[0] ?? '',
      grouped: false,
      structured: true,
      overGroups: true,
    });
  }

  const priority = { heading: 0, area: 1, rule: 2, levels: 3, advice: 3, course: 4, exclude: 5, footnote: 5 };
  /*
   * Nothing from the Four-Year Program of Study on: it repeats the degree's
   * courses term by term, and its lines read as more requirements (Music
   * Education's "upper-division elective (1 hour)" became an area, and its
   * terms' courses rows to take again; Real Estate and International
   * Business's internship advice another).
   */
  const fourYearAt = html.search(/<h4\b[^>]*id=["']Four-Year Program of Study["']/i);
  const ordered = marks
    .filter((mark) => fourYearAt < 0 || mark.at < fourYearAt)
    .sort((a2, b2) => a2.at - b2.at || priority[a2.kind] - priority[b2.kind]);

  const areas = [];
  let area = null;
  let group = null;
  let groupLabel = '';
  let skipGroup = false;
  let structuredGroup = null;
  let structuredList = null;
  let courseBundle = null;
  /** After a sentence that recommends courses: its rows are advice (the paragraphs above). */
  let skipRows = false;
  /** The levels a header line gives the subject rows under it that name none. */
  let headerLevels = null;
  /** The area's rows that carry a footnote marker, for the footnote that follows them. */
  let markedRows = [];
  /** The areas from an elective area printed after an emphasis to the next top area: placed last (the area marks below). */
  let late = false;
  /** The last area an h4 (or higher) heads, and the hours of the deeper areas printed under it since. */
  let topArea = null;
  let topParts = 0;
  /*
   * An area of emphasis or a degree path, read as its own rows (groups,
   * as an area's) for the emphasis it is (run: withSections), and kept off
   * the degree's areas: read into them, Plant Biology required all three
   * of its emphases (152 of 120 hours); skipped, a picked emphasis was
   * every course it listed in one take-every-course row (Terry's Data
   * Analytics nine courses for a twelve-hour emphasis). `section` is the
   * one being read (label null: an "Areas of Emphasis" heading over them),
   * `sectionArea` the degree's area it sits in.
   */
  let section = null;
  let sectionArea = null;
  /** The part of an emphasis being read that has hours of its own (the area marks below). */
  let sectionPart = null;
  const sections = [];
  const sectionAreas = [];
  const enterSection = (label) => {
    const name = emphasisName(label);
    if (!section) sectionArea = area;
    // A heading, then the paragraph naming the same emphasis under it.
    if (name && section?.label && emphasisKey(section.label) === emphasisKey(name)) return;
    section = { label: name, areaLabel: sectionArea?.label ?? null, groups: [] };
    sectionPart = null;
    if (name) {
      sections.push(section);
      if (sectionArea) sectionArea.sections = true;
    }
    area = name ? { label: name, hours: 0, groups: section.groups } : null;
    if (area) sectionAreas.push(area);
    group = null;
    groupLabel = name ?? '';
    skipGroup = false;
    structuredGroup = null;
    structuredList = null;
    courseBundle = null;
    skipRows = false;
    headerLevels = null;
    markedRows = [];
  };
  const CORE_AREA_LABEL = /^(?:I|II|III|IV|V|VI)\.\s/;
  const STOPS =
    /^(entrance requirements|major requirements|career information|transfer student information|other learning opportunities|student organizations|available graduate programs|college-wide requirements|general education core|university-wide requirements|four-year program of study)$/i;
  for (const mk of ordered) {
    if (mk.kind === "area") {
      // Optional emphases contain hour subheadings that look exactly like the
      // required degree areas. Do not let each one reset the optional-section
      // guard. "Total Major Hours" is the reliable boundary at the end of an
      // optional emphasis and still needs to be captured as the degree total.
      // And "Major Electives", printed after an optional area of emphasis on the Risk Management and Real Estate pages (2026-10-28).
      const resumesRequiredDegree =
        /^(?:general|free|major) electives?\b/i.test(mk.label) ||
        /^total\b/i.test(mk.label);
      // An hours line inside an emphasis ("Area of Emphasis in Acting (19 hours)") is the emphasis's own; its area, or a degree's elective area, is the degree's again.
      if (section && !resumesRequiredDegree && mk.depth > 4) {
        const own = emphasisKey(emphasisName(mk.label) ?? '') === emphasisKey(section.label ?? '');
        if (section.label && own && section.hours == null) section.hours = mk.hours;
        /*
         * A part of the emphasis with hours of its own ("Aquatic Sciences
         * Restricted Elective(s) (3 hours)", "Open Major Electives (9
         * hours)"): an area of its own when the emphasis is picked, as it
         * was read before, not rows of the area the emphasis is printed in,
         * where each part's courses, listed in its other parts too, counted
         * once on the board and in every part for the planner.
         */
        if (area && !own) {
          groupLabel = mk.label;
          sectionPart = { label: mk.label, hours: mk.hours };
        }
        group = null;
        continue;
      }
      /*
       * Terry's "Major Electives (6 hours)", printed after an optional
       * emphasis on the Risk Management and Real Estate pages: read since
       * 2026-10-28, and kept after the degree's other areas, where
       * uga-program-overrides.ts had added it, so the areas before keep
       * their block ids on saved boards (93328::10::0 is Upper Division
       * General Electives).
       */
      if (degree === 'BBA' && section && resumesRequiredDegree && /^major electives?\b/i.test(mk.label)) late = true;
      else if (mk.depth <= 4) late = false;
      section = null;
      sectionPart = null;
      /*
       * A heading deeper than the area's, whose hours fit in what is left of
       * the area's, is a part of that area, not one beside it: Social
       * Studies Education's "Required Courses (57 hours)" holds "Area of
       * Emphasis Content Courses (21 hours)" and "Major Courses", and read
       * as an area of its own the 21 hours were counted twice (135 of 120).
       * Its rows are one group of the area, a list to choose its hours from
       * where they come to more. Only under an area that has rows of its
       * own: Terry's "Required Courses (39 hours)" is only the heading over
       * "Terry Foundations First Core (15)" and the major's courses, each an
       * area the boards (and saved boards' rows) know. A heading's only: a
       * paragraph's hours ("Complete four courses (12 hours) of ECON
       * Electives or one area of emphasis") stay an area of their own, as
       * before, which uga-program-overrides.ts reads (62927).
       */
      if (area && !resumesRequiredDegree && area.depth <= 4 && mk.depth > area.depth && mk.depth <= 6 && area.parts + mk.hours <= area.hours && !CORE_AREA_LABEL.test(area.label) && area.groups.some((existing) => existing.courses.length > 0)) {
        area.parts += mk.hours;
        groupLabel = mk.label;
        group = { label: mk.label, choose: null, hours: null, partHours: mk.hours, courses: [] };
        area.groups.push(group);
        structuredGroup = null;
        structuredList = null;
        courseBundle = null;
        skipRows = false;
        headerLevels = null;
        continue;
      }
      area = { label: mk.label, hours: mk.hours, groups: [], depth: mk.depth, parts: 0, ...(late ? { late } : {}) };
      areas.push(area);
      if (mk.depth <= 4) {
        topArea = area;
        topParts = 0;
      } else if (topArea) topParts += mk.hours;
      group = null;
      groupLabel = '';
      skipGroup = false;
      structuredGroup = null;
      structuredList = null;
      courseBundle = null;
      skipRows = false;
      headerLevels = null;
      markedRows = [];
    } else if (mk.kind === 'heading') {
      skipRows = false;
      headerLevels = null;
      sectionPart = null;
      if (STOPS.test(mk.label)) {
        area = null;
        section = null;
        group = null;
        groupLabel = '';
        skipGroup = false;
        structuredGroup = null;
        structuredList = null;
        courseBundle = null;
        continue;
      }
      if (mk.optional || EMPHASIS_NAMED.test(mk.label)) {
        enterSection(mk.label);
        continue;
      }
      /*
       * A "Choose" line with no rows of its own, then headed lists: one
       * choice over all of them. Environmental Economics' "Choose 12 credit
       * hours" over Social Sciences, Natural Sciences, Policy and Methods
       * was read as the four lists to take whole, about 34 courses.
       */
      if (area && !structuredGroup && group?.fromRule && group.courses.length === 0 && !group.completeOneList && group.choose !== 0) {
        structuredGroup = group;
      }
      if (area && structuredGroup) {
        groupLabel = mk.label;
        group = structuredGroup;
        structuredList = { label: mk.label, codes: [] };
        structuredGroup.lists.push(structuredList);
        if (!structuredGroup.label && /foundations? area/i.test(mk.label))
          structuredGroup.label = 'Foundations Areas';
        skipGroup = Boolean(mk.advice);
        continue;
      }
      groupLabel = mk.label;
      group = null;
      courseBundle = null;
      // This is a requirement that may overlap another major course, not four
      // more hours. The current planner has no overlay-constraint type. The CS
      // Application Design options already satisfy it, so omitting the duplicate
      // credit block is safer than adding an extra course.
      skipGroup = /^teamwork requirement$/i.test(mk.label) || Boolean(mk.advice);
    } else if (mk.kind === 'rule') {
      skipRows = false;
      headerLevels = null;
      if (!area || skipGroup) continue;
      /*
       * "Choose three courses from the following groups" after an area's
       * parts ("Major Electives (15-20 hours)": Natural History (4), then
       * Methods/Skills (3-4), then the three courses): the area's rest,
       * not a row of the last part. Read into Methods/Skills, Ecology's
       * three major electives asked for a 3-hour area's hours.
       */
      if (mk.ownArea && !section && area.depth > 4 && topArea && !topArea.groups.some((g) => g.courses.length)) {
        area = { label: topArea.label, hours: Math.max(topArea.hours - topParts, (mk.choose ?? 0) * 3), groups: [], depth: area.depth, parts: 0 };
        areas.push(area);
        markedRows = [];
      }
      if (structuredGroup?.overGroups && structuredList && structuredList.codes.length === 0 && !mk.structured) {
        // "Choose 1 to 6 courses from the following" under "Group B" of "Select six courses from below": at least one from Group B.
        if ((mk.choose ?? 0) > 0) (structuredGroup.constraints ??= []).push({ text: `At least ${mk.choose} from ${structuredList.label}.`, n: mk.choose, lists: [structuredList], single: true });
        continue;
      }
      structuredGroup = null;
      structuredList = null;
      group = {
        label: groupLabel,
        choose: mk.choose,
        hours: mk.hours,
        note: mk.note,
        upperDivisionHours: mk.upperDivisionHours,
        minimumAreas: mk.minimumAreas,
        lists: [],
        completeOneList: mk.grouped,
        bundles: [],
        courses: [],
        fromRule: true,
        ...(mk.most ? { most: mk.most } : {}),
        ...(section && sectionPart ? { part: sectionPart } : {}),
      };
      area.groups.push(group);
      if (mk.structured && (mk.choose !== null || mk.overGroups)) structuredGroup = group;
      if (mk.overGroups) group.overGroups = true;
      courseBundle = null;
    } else if (mk.kind === 'levels' && mk.above) {
      for (const row of group?.courses ?? []) {
        const subject = row.noLevel ? row.code.match(/^([A-Z]{2,5}) [1-9]XXX$/)?.[1] : null;
        if (!subject) continue;
        delete row.levelFrom;
        delete row.levelTo;
        Object.assign(row, { code: `${subject} ${mk.read.level}XXX`, ...mk.read.range, title: levelTitle(subject, mk.read) });
      }
    } else if (mk.kind === 'levels') {
      headerLevels = mk.read;
    } else if (mk.kind === 'spread') {
      if (group) group.spread = { n: mk.n, text: mk.text };
    } else if (mk.kind === 'exclude') {
      if (area) area.excludePrefixes = [...new Set([...(area.excludePrefixes ?? []), ...mk.prefixes])];
    } else if (mk.kind === 'advice') {
      if (area) skipRows = true;
    } else if (mk.kind === 'footnote') {
      if (!area) continue;
      // The rows above it with its marker, since the last footnote with the same marker.
      const rows = markedRows.filter((marked) => marked.marker === mk.marker);
      markedRows = markedRows.filter((marked) => marked.marker !== mk.marker);
      if (rows.length === 0) continue;
      const levels = /\b[1-9]000\b/.test(mk.text) ? levelWords(mk.text) : null;
      if (/^only one of these (?:courses?|options?)\b/i.test(mk.text)) {
        /*
         * "* Only one of these courses can be used to fulfill this
         * requirement": the starred courses of a row of courses to take are
         * a choice of one. Cellular Biology required both BCMB 3100 and
         * BCMB 4010, Computer Systems Engineering ECSE 2170 and ENGR 2170.
         */
        for (const owner of new Set(rows.map((marked) => marked.group))) {
          const starred = rows.filter((marked) => marked.group === owner).map((marked) => marked.row);
          if (starred.length < 2 || owner.choose !== null || owner.hours != null || owner.lists?.length) continue;
          owner.courses = owner.courses.filter((row) => !starred.includes(row));
          const at = area.groups.indexOf(owner);
          area.groups.splice(at + 1, 0, { label: owner.label, choose: 1, hours: null, note: mk.text, courses: starred });
        }
      } else if (levels && !(levels.range.levelFrom === 1 && levels.range.levelTo === 5)) {
        // "^3000-level or above" under Fisheries and Wildlife's "WILD prefix course^" rows.
        for (const { row, group: owner } of rows) {
          const subject = row.code.match(/^([A-Z]{2,5}) [1-9]XXX$/)?.[1];
          if (!subject || !row.noLevel) continue;
          const was = row.code;
          delete row.levelFrom;
          delete row.levelTo;
          Object.assign(row, { code: `${subject} ${levels.level}XXX`, ...levels.range, title: levelTitle(subject, levels) });
          for (const list of owner.lists ?? []) list.codes = list.codes.map((code) => (code === was ? row.code : code));
        }
      }
    } else if (mk.kind === 'course') {
      if (!area || skipGroup || skipRows) continue;
      // Any course at any level is what a General Electives area's own hours already are.
      if (mk.anyLevel && /^(?:general|free) electives?$/i.test(area.label)) continue;
      const { marker, creditsMax, anyLevel, repeatHours, ...row } = mk;
      if (row.noLevel && headerLevels) {
        const subject = row.code.split(' ')[0];
        delete row.levelFrom;
        delete row.levelTo;
        Object.assign(row, { code: `${subject} ${headerLevels.level}XXX`, ...headerLevels.range, title: levelTitle(subject, headerLevels) });
      }
      if (!group) {
        group = { label: groupLabel, choose: null, hours: null, courses: [], ...(section && sectionPart ? { part: sectionPart } : {}) };
        area.groups.push(group);
      }
      /*
       * A variable-credit course in a list to pick from, at three hours where
       * its range allows: at the least of it (INTB 4800's 1-6, an
       * internship) the planner's three-hour picks left it off every list
       * that offers it, and a board that took it booked one hour of a
       * three-hour choice.
       */
      /*
       * "ARST 3500 (6 hours)" on a three-hour studio, a row to take: the
       * course twice, booked as one six-hour course so the area's rows come
       * to its hours (Art's Required Courses read 57 of 60 with it at
       * three). In a list to pick from, the course's own hours.
       */
      if (repeatHours && group.choose === null && group.hours == null && !group.lists?.length) row.credits = repeatHours;
      if (creditsMax && row.credits < 3 && creditsMax >= 3 && ((group.choose ?? 0) > 0 || group.hours != null) && !/internship|independent|research|thesis|special (?:problems|topics)|directed|practicum|study tour|seminar|cooperative/i.test(row.title)) row.credits = 3;
      if (group.completeOneList) {
        if (!row.andPrevious || !courseBundle) {
          courseBundle = [];
          group.bundles.push(courseBundle);
        }
        courseBundle.push(row.code);
      }
      if (!group.courses.some((c) => c.code === row.code)) {
        group.courses.push(row);
        if (marker) markedRows.push({ row, group, marker });
        if (structuredList && !structuredList.codes.includes(row.code))
          structuredList.codes.push(row.code);
      }
    }
  }
  for (const parsedArea of [...areas, ...sectionAreas]) {
    parsedArea.ruled = parsedArea.groups.some((parsedGroup) => parsedGroup.fromRule);
    for (const parsedGroup of parsedArea.groups) {
      // A part's rows that come to more than its hours are a list to take its hours from.
      if (parsedGroup.partHours && parsedGroup.choose === null && parsedGroup.hours == null && parsedGroup.courses.reduce((sum, row) => sum + row.credits, 0) > parsedGroup.partHours) parsedGroup.hours = parsedGroup.partHours;
      delete parsedGroup.partHours;
      delete parsedGroup.fromRule;
      delete parsedGroup.overGroups;
      if (parsedGroup.spread && (parsedGroup.lists?.length ?? 0) >= parsedGroup.spread.n) {
        (parsedGroup.constraints ??= []).push({ text: parsedGroup.spread.text, n: parsedGroup.spread.n, lists: parsedGroup.lists, single: false, distinctLists: true });
      }
      delete parsedGroup.spread;
      for (const row of parsedGroup.courses) delete row.noLevel;
    }
  }

  /*
   * "Choose 1 to 2 courses from the following": as many as the area's hours
   * leave room for, within the range. Journalism's Required Courses (30
   * hours) end with one or two specialty courses, one where the student
   * took the six-hour JOUR 5090; read as one, a board with JOUR 5091 read
   * 27 of 30 hours.
   */
  for (const parsedArea of areas) {
    for (const ranged of parsedArea.groups) {
      if (!ranged.most || ranged.choose === null || ranged.lists?.length || ranged.courses.length === 0) continue;
      const others = parsedArea.groups.filter((g) => g !== ranged && g.courses.length > 0).reduce((sum, g) => sum + (g.hours ?? (g.choose !== null ? Math.min(...g.courses.map((row) => row.credits || 3)) * g.choose : g.courses.reduce((hours, row) => hours + row.credits, 0))), 0);
      const room = parsedArea.hours - others;
      if (room > ranged.choose * 3) ranged.choose = Math.min(ranged.most, Math.ceil(room / 3));
    }
    for (const ranged of parsedArea.groups) delete ranged.most;
  }
  for (const parsedArea of sectionAreas) for (const ranged of parsedArea.groups) delete ranged.most;
  /*
   * "Choose 9 to 15 credit hours from the following" and then "Choose a
   * maximum of 6 credit hours from the following" (Biological Science's
   * Major Electives, 15 hours): one choice of the area's hours from both
   * lists, at least the first's least from the first. Read apart, the
   * second asked for none and the area 9 of its 15 hours, which the board
   * could never show met.
   */
  for (const parsedArea of areas) {
    parsedArea.groups.forEach((first, index) => {
      const capped = parsedArea.groups[index + 1];
      const most = Number(capped?.note?.match(/^Choose a maximum of (\d+) credit hour/i)?.[1] ?? 0);
      if (!capped || capped.choose !== 0 || !most || first.hours == null || first.choose !== null || first.lists?.length || first.courses.length === 0 || capped.courses.length === 0) return;
      const others = parsedArea.groups.filter((g) => g !== first && g !== capped && g.courses.length > 0).reduce((sum, g) => sum + (g.hours ?? (g.choose !== null ? g.choose * 3 : g.courses.reduce((hours, row) => hours + row.credits, 0))), 0);
      // The choice's hours (the area's, less its other rows, or the line's own where more), and so the least from the first list.
      const total = Math.max(first.hours, parsedArea.hours - others);
      if (total <= 0 || first.hours + most < total) return;
      const least = total - most;
      const lists = [{ label: 'List 1', codes: first.courses.map((row) => row.code) }, { label: 'List 2', codes: capped.courses.map((row) => row.code) }];
      first.hours = total;
      first.note = `${first.note ?? ''} At most ${most} hours from the second list.`.trim();
      first.lists = lists;
      first.constraints = [{ text: `At least ${least} hours from the first list.`, n: Math.ceil(least / 3), lists: [lists[0]], single: true, hours: least }];
      first.courses = [...first.courses, ...capped.courses.filter((row) => !first.courses.some((own) => own.code === row.code))];
      capped.courses = [];
    });
  }
  for (const parsedArea of [...areas, ...sectionAreas]) {
    for (const parsedGroup of parsedArea.groups) {
      if (parsedGroup.completeOneList && parsedGroup.bundles?.length) {
        const credits = new Map(
          parsedGroup.courses.map((course) => [course.code, course.credits]),
        );
        parsedGroup.lists = parsedGroup.bundles.map((codes, index) => ({
          label: `Course group ${index + 1}`,
          codes,
        }));
        parsedGroup.bundleSize = Math.min(
          ...parsedGroup.bundles.map((codes) => codes.length),
        );
        parsedGroup.hours = Math.min(
          ...parsedGroup.bundles.map((codes) =>
            codes.reduce((sum, code) => sum + (credits.get(code) ?? 0), 0),
          ),
        );
        parsedGroup.choose = null;
        parsedGroup.note = 'Choose one complete course group.';
        delete parsedGroup.bundles;
      }
      if (parsedGroup.lists)
        parsedGroup.lists = parsedGroup.lists.filter(
          (list) => list.codes.length > 0,
        );
    }
  }

  /*
   * A part's heading under an area with no rows of its own, whose rows hold
   * more than the part's hours and what the area states: the area's rows.
   * Art's "Required Courses (60 Hours)" opens with "Required Studio Courses
   * (15 hours):" and then its electives and art history lists, 60 hours in
   * all; read as an area of 15 beside an empty one, the BFA boards held 72
   * of 120 hours (2026-10-29 audit, "Studio Electives missing").
   */
  const ownHours = (owner) => owner.groups
    .filter((g) => g.courses.length > 0)
    .reduce((sum, g) => sum + (g.hours ?? (g.choose !== null ? g.choose * 3 : g.courses.reduce((hours, row) => hours + row.credits, 0))), 0);
  for (let index = areas.length - 2; index >= 0; index -= 1) {
    const parent = areas[index];
    const part = areas[index + 1];
    // The area's one part: Terry's "General Electives (24 hours)" over two parts keeps both, each an area.
    const sibling = areas[index + 2];
    if (parent.groups.some((g) => g.courses.length) || parent.depth > 4 || part.depth <= parent.depth || (sibling && sibling.depth > parent.depth) || CORE_AREA_LABEL.test(parent.label)) continue;
    const held = ownHours(part);
    if (held <= part.hours + 3 || held > parent.hours + 3) continue;
    for (const g of part.groups) if (!g.label) g.label = part.label;
    parent.groups = part.groups;
    areas.splice(index + 1, 1);
  }
  for (const parsedArea of [...areas, ...sectionAreas]) {
    delete parsedArea.depth;
    delete parsedArea.parts;
  }
  const lateAreas = areas.filter((a2) => a2.late);
  areas.splice(0, areas.length, ...areas.filter((a2) => !a2.late), ...lateAreas);
  for (const parsedArea of lateAreas) delete parsedArea.late;

  // "Total Major Hours (120 Hours)" is the degree total, not another bucket to
  // add up. Leaving it in the list made Accounting BBA claim 237 hours.
  const TOTAL = /^total\b/i;
  const total = areas.find((a2) => TOTAL.test(a2.label));
  // General/free electives legitimately name hours without naming courses.
  // Other empty areas are usually parent headings or prose mentions, so they
  // remain excluded instead of becoming invented requirements.
  const kept = areas.filter((a2, index) => {
    const hasCourses = a2.groups.some((g) => g.courses.length);
    const isElectiveArea = /^(?:general|free) electives?\b/i.test(a2.label);
    if (!hasCourses && isElectiveArea) {
      let childHours = 0;
      for (let next = index + 1; next < areas.length; next += 1) {
        const child = areas[next];
        if (!/electives?\b/i.test(child.label)) break;
        childHours += child.hours;
        if (childHours >= a2.hours) break;
      }
      // A heading such as "General Electives (24 Hours)" is sometimes only a
      // parent for named child buckets. Keep the measurable children and do
      // not count the parent a second time.
      if (childHours === a2.hours) return false;
    }
    // An area whose rows are all its emphases' (Special Education's Required Courses): where the picked one goes.
    if (hasCourses || isElectiveArea || a2.sections) return true;
    /*
     * An elective area the page states a rule for but no courses ("Major
     * Electives (13 hours): Choose 13 credit hours from the following:
     * Major Elective courses", Animal Health): the degree's, for an advisor
     * to name. Left out, its hours went to general electives with nothing
     * on the board saying the major asks for them (2026-10-29 audit).
     */
    return a2.ruled && /\belectives?\b/i.test(a2.label) && a2.hours > 0;
  });
  for (const keptArea of [...areas, ...sectionAreas]) {
    delete keptArea.sections;
    delete keptArea.ruled;
  }
  // "*Excluding the following course prefixes: ACCT, BUSN, ..., RMIN." The
  // International Business co-major pages end the list with a period, which
  // the reading before stopped at, and their Non-Business blocks took
  // ACCT 1160 as a non-business course.
  const excludedPrefixes =
    flatPage
      .match(
        /[Ee]xcluding (?:the following course prefixes|courses with the following prefixes):\s*([A-Z]{2,5}(?:,\s*(?:or\s+)?[A-Z]{2,5})*)/,
      )?.[1]
      ?.match(/[A-Z]{2,5}/g) ?? [];
  for (const keptArea of kept) {
    if (/^major electives?$/i.test(keptArea.label)) {
      keptArea.excludeCodes = majorElectiveExclusions;
    }
    if (/non-business/i.test(keptArea.label) && excludedPrefixes.length > 0) {
      keptArea.excludePrefixes = [...new Set(excludedPrefixes)];
    }
  }
  /*
   * Where a picked emphasis goes: into the area it is printed in where that
   * area's own rows leave its hours (Plant Biology's Required Courses, 33
   * hours, about 19 of them its own rows), or an area of its own where they
   * fill it (Terry's emphases, printed under the major's required courses,
   * are courses the major's other rows also count).
   */
  const read = sections
    .map((one) => ({ ...one, groups: one.groups.filter((g) => g.courses.length > 0) }))
    .filter((one) => one.groups.length > 0)
    .map((one) => {
      const owner = areas.find((a2) => a2.label === one.areaLabel);
      const room = owner ? owner.hours - ownHours(owner) : 0;
      return { ...one, areaLabel: owner && (room >= 3 || ownHours(owner) === 0) ? one.areaLabel : null, alone: Boolean(owner) && ownHours(owner) === 0 };
    });
  return {
    areas: kept.filter((a2) => !TOTAL.test(a2.label)),
    totalCredits: total?.hours ?? null,
    sections: read,
  };
}

/**
 * Each emphasis or path with the rows its section on the page holds
 * (parseDetail's sections), one part for each of the degree's areas it sits
 * in (Health Promotion's emphases have an Area VI part and a major part):
 * its required courses and its own "Choose" rows, which the planner adds to
 * the area when the student picks it (uga-source.tsx selectedUgaProgram).
 * An emphasis no section was read for keeps the courses parseEmphases found.
 */
function withSections(emphasisGroups, sections) {
  return emphasisGroups.map((emphasis) => ({
    ...emphasis,
    // An area whose rows are all emphases' has no major without one (Special Education's Required Courses): a choice the degree requires.
    minimum: emphasis.minimum || (emphasis.options.length > 1 && sections.some((one) => one.alone && emphasis.options.some((option) => emphasisKey(option.label) === emphasisKey(one.label))) ? 1 : 0),
    options: emphasis.options.map((option) => {
      const own = sections.filter((read) => emphasisKey(read.label) === emphasisKey(option.label));
      if (own.length === 0) return option;
      const parts = own.map((one) => ({
        areaLabel: one.areaLabel,
        hours: one.hours ?? null,
        replaceArea: false,
        courses: one.groups.flatMap((g) => g.courses).filter((course, index, all) => all.findIndex((other) => other.code === course.code) === index),
        groups: one.groups,
      }));
      return {
        ...option,
        hours: parts.reduce((sum, part) => sum + (part.hours ?? 0), 0) || option.hours,
        areaLabel: parts.every((part) => part.areaLabel === parts[0].areaLabel) ? parts[0].areaLabel : null,
        courses: parts.flatMap((part) => part.courses),
        parts,
      };
    }),
  }));
}

/** A program's subject-wide rows ("POLS 3XXX"), with the area each sits in. */
function subjectRows(program) {
  return program.areas.flatMap((area) => area.groups.flatMap((group) => group.courses
    .filter((row) => /^[A-Z]{2,5} [1-9]XXX$/.test(row.code) && !row.code.startsWith('ANY '))
    .map((row) => ({ area, row }))));
}

/**
 * The file's program with each subject-wide row's level range as the page
 * reads it now (levelRange), matched by area and code; nothing else changes.
 */
function withLevels(program, fresh) {
  const freshRows = subjectRows(fresh);
  return {
    ...program,
    areas: program.areas.map((area) => ({
      ...area,
      groups: area.groups.map((group) => ({
        ...group,
        courses: group.courses.map((row) => {
          if (!/^[A-Z]{2,5} [1-9]XXX$/.test(row.code) || row.code.startsWith('ANY ')) return row;
          const now = freshRows.find((x) => x.area.label === area.label && x.row.code === row.code)?.row;
          if (!now) return row;
          const { levelFrom, levelTo, ...rest } = row;
          return { ...rest, title: now.title, ...(now.levelFrom ? { levelFrom: now.levelFrom } : {}), ...(now.levelTo ? { levelTo: now.levelTo } : {}) };
        }),
      })),
    })),
  };
}

const run = async () => {
  const onlyId = process.argv.includes('--id')
    ? process.argv[process.argv.indexOf('--id') + 1]
    : null;
  const undergraduateOnly = process.argv.includes('--undergraduate');
  const levelsOnly = process.argv.includes('--levels');
  const degrees = process.argv.includes('--degrees')
    ? process.argv[process.argv.indexOf('--degrees') + 1].split(',')
    : null;
  const cacheDir = process.argv.includes('--cache')
    ? process.argv[process.argv.indexOf('--cache') + 1]
    : null;
  /** A saved detail page, or null where the folder has none. */
  const savedPage = (id) => {
    for (const name of [`${id}.html.gz`, `prog-${id}.html.gz`, `${id}.html`]) {
      const file = join(cacheDir, name);
      if (!existsSync(file)) continue;
      return name.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
    }
    return null;
  };
  const limit = process.argv.includes('--limit')
    ? Number(process.argv[process.argv.indexOf('--limit') + 1])
    : Infinity;

  let existing = null;
  if (existsSync(OUT)) existing = JSON.parse(readFileSync(OUT, 'utf8'));

  const seen = new Map();
  if (onlyId) {
    const found = existing?.programs?.find((program) => program.id === onlyId);
    if (!found) throw new Error(`Program ${onlyId} is not in ${OUT}`);
    seen.set(found.id, found);
  } else if (cacheDir && existing) {
    for (const program of existing.programs.filter((candidate) => undergraduateDegree(candidate.degree) && savedPage(candidate.id) !== null)) {
      seen.set(program.id, program);
    }
  } else if (undergraduateOnly && existing) {
    for (const program of existing.programs.filter((candidate) => undergraduateDegree(candidate.degree))) {
      seen.set(program.id, program);
    }
  } else if (degrees && existing) {
    for (const program of existing.programs.filter((candidate) => degrees.includes(candidate.degree))) {
      seen.set(program.id, program);
    }
  } else if (levelsOnly && existing) {
    for (const program of existing.programs.filter((candidate) => undergraduateDegree(candidate.degree) && subjectRows(candidate).length > 0)) {
      seen.set(program.id, program);
    }
  } else {
    process.stdout.write('listing programs');
    for (let page = 1; page <= 200; page++) {
      let rows;
      try {
        rows = await listPage(page);
      } catch {
        break;
      }
      const fresh = rows.filter((r) => !seen.has(r.id));
      fresh.forEach((r) => seen.set(r.id, r));
      process.stdout.write(fresh.length ? '.' : '');
      if (!fresh.length) break;
      await sleep(220);
    }
  }
  const programs = [...seen.values()].slice(
    0,
    limit === Infinity ? undefined : limit,
  );
  console.log(
    `${onlyId ? '' : '\n  '}${seen.size} programs listed${programs.length < seen.size ? `, taking ${programs.length}` : ''}`,
  );

  const out = [];
  let i = 0, withReq = 0;
  for (const p of programs) {
    i++;
    try {
      let html = cacheDir ? savedPage(p.id) : null;
      if (html === null) {
        const res = await fetch(`${BASE}/Program/Details/${p.id}?IDc=${p.college}`, {
          headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      }
      const title = clean(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? p.name ?? "");
      const { areas, totalCredits, sections } = parseDetail(html, p.degree);
      const emphasisGroups = withSections(parseEmphases(html), sections);
      if (areas.length) withReq++;
      out.push({
        id: p.id, college: p.college, degree: p.degree, name: title, areas,
        totalCredits,
        areaHours: areas.reduce((sum, a) => sum + (a.hours || 0), 0),
        emphasisGroups,
      });
    } catch {
      out.push({ id: p.id, college: p.college, degree: p.degree, name: p.name ?? "", areas: [], totalCredits: null, areaHours: 0, emphasisGroups: [] });
    }
    if (i % 25 === 0 || i === programs.length) {
      process.stdout.write(`\r  ${i}/${programs.length} fetched, ${withReq} with requirements   `);
    }
    if (!cacheDir) await sleep(levelsOnly || degrees ? 1000 : 300);
  }

  const finalPrograms =
    levelsOnly && existing
      ? existing.programs.map((program) => {
          const fresh = out.find((candidate) => candidate.id === program.id);
          return fresh && fresh.areas.length ? withLevels(program, fresh) : program;
        })
      : (onlyId || undergraduateOnly || degrees || cacheDir) && existing
      ? existing.programs.map(
          (program) => out.find((fresh) => fresh.id === program.id) ?? program,
        )
      : out;
  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      source: `${BASE}/Program/Details`,
      fetchedAt: cacheDir && existing ? existing.fetchedAt : new Date().toISOString(),
      count: finalPrograms.length,
      programs: finalPrograms,
    }),
  );
  console.log(`\n\n  ${finalPrograms.length} programs -> ${OUT}`);
  console.log(`  with parsed requirements: ${withReq}`);
};

// Run when called, not when a check imports parseDetail to read a saved page.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
