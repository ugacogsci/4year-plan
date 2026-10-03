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
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "public", "uga-programs.json");
const UA = "TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)";
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

  const requiredText =
    flat.match(/Complete one of the following areas of emphasis\.?/i)?.[0] ??
    flat.match(/There (?:are|is) .{0,80}areas? of emphasis to choose from within this major\.?/i)?.[0] ??
    flat.match(/(?:must|required to) (?:select|choose|complete).{0,80}area of emphasis\.?/i)?.[0] ??
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
      /coursePrefix=([A-Z]{2,5})[\s\S]{0,220}?prefix\s+courses?\s+at\s+the\s+(\d)000-level(?:\s+(?:or|and)\s+above)?/gi,
    )) {
      const code = `${prefix[1].toUpperCase()} ${prefix[2]}XXX`;
      if (!courses.some((course) => course.code === code)) {
        courses.push({ code, title: `${prefix[1].toUpperCase()} ${prefix[2]}000-level or higher courses`, credits: 0 });
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

  const optionKey = (label) => label
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:only|hours?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
function parseDetail(html) {
  const marks = [];
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
    const level = clean(title).match(
      /^(?:prefix\s+)?(\d)000(?:\/\d000)?-level(?:\s+or\s+higher)?\s*(?:courses?)?/i,
    )?.[1];
    return subject && level ? `${subject} ${level}XXX` : null;
  };

  // Course rows: each course is its own one-row table, "CODE | Title | Hours".
  // Keep whether the Bulletin printed AND immediately before the row. A
  // "Choose 1 group" block uses that word to bind a lecture to its lab.
  let previousTableEnd = 0;
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const between = clean(
      html.slice(previousTableEnd, m.index ?? previousTableEnd),
    ).slice(-120);
    let firstCourse = true;
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
      codes.forEach((code, index) => {
        marks.push({
          kind: 'course',
          at: m.index ?? 0,
          code,
          title: cells[1] ?? '',
          credits: printedCredits[index] ?? (index > 0 && code.endsWith('L') ? 1 : printedCredits[0] ?? 3),
          andPrevious:
            index > 0 ||
            /(?:^|\s)AND(?:\s|$)/i.test(rawCode) ||
            (firstCourse && /(?:^|\s)AND(?:\s|$)/i.test(between)),
        });
      });
      firstCourse = false;
    }
    previousTableEnd = (m.index ?? 0) + m[0].length;
  }

  // A subject-wide elective is rendered as a linked subject followed by prose,
  // not as a normal course code cell: "CSCI 4000/6000-level courses".
  for (const m of html.matchAll(
    /<a[^>]*>\s*([A-Z]{2,5})\s*<\/a>[\s\S]{0,240}?(?:prefix\s+)?(\d)000(?:\/\d000)?-level(?:\s+or\s+higher)?/gi,
  )) {
    marks.push({
      kind: 'course',
      at: m.index ?? 0,
      code: `${m[1].toUpperCase()} ${m[2]}XXX`,
      title: `${m[1].toUpperCase()} ${m[2]}000-level courses`,
      credits: 0,
    });
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
  for (const m of html.matchAll(/\((\d+)(?:\s*-\s*\d+)?\s*(?:&nbsp;)?\s*Hours?\)/gi)) {
    const at = m.index ?? 0;
    const before = html.slice(Math.max(0, at - 160), at);
    const label = clean(before.split(">").pop() ?? "");
    if (!label || label.length < 3 || label.length > 90) continue;
    marks.push({ kind: "area", at, label, hours: Number(m[1]) });
  }

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
          /^Area of Emphasis\b/i.test(label) ||
          /^Area of Emphasis\b/i.test(
            clean(
              html.slice(
                (m.index ?? 0) + m[0].length,
                (m.index ?? 0) + m[0].length + 520,
              ),
            ),
          ),
      });
  }

  // UGA uses both counts and credit totals: "Choose 1 course(s)" and "Choose
  // 12 credit hour(s)". They are not interchangeable.
  const numberWord = (value) =>
    ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 })[
      value.toLowerCase()
    ] ?? Number(value);
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

  const priority = { heading: 0, area: 1, rule: 2, course: 3 };
  marks.sort(
    (a2, b2) => a2.at - b2.at || priority[a2.kind] - priority[b2.kind],
  );

  const areas = [];
  let area = null;
  let group = null;
  let groupLabel = '';
  let skipGroup = false;
  let skipOptional = false;
  let structuredGroup = null;
  let structuredList = null;
  let courseBundle = null;
  const STOPS =
    /^(entrance requirements|major requirements|career information|transfer student information|other learning opportunities|student organizations|available graduate programs|college-wide requirements|general education core|university-wide requirements|four-year program of study)$/i;
  for (const mk of marks) {
    if (mk.kind === "area") {
      // Optional emphases contain hour subheadings that look exactly like the
      // required degree areas. Do not let each one reset the optional-section
      // guard. "Total Major Hours" is the reliable boundary at the end of an
      // optional emphasis and still needs to be captured as the degree total.
      const resumesRequiredDegree =
        /^(?:general|free) electives?\b/i.test(mk.label) ||
        /^total\b/i.test(mk.label);
      if (skipOptional && !resumesRequiredDegree) {
        area = null;
        group = null;
        structuredGroup = null;
        structuredList = null;
        continue;
      }
      if (resumesRequiredDegree) skipOptional = false;
      area = { label: mk.label, hours: mk.hours, groups: [] };
      areas.push(area);
      group = null;
      groupLabel = '';
      skipGroup = false;
      skipOptional = false;
      structuredGroup = null;
      structuredList = null;
      courseBundle = null;
    } else if (mk.kind === 'heading') {
      if (STOPS.test(mk.label)) {
        area = null;
        group = null;
        groupLabel = '';
        skipGroup = false;
        skipOptional = false;
        structuredGroup = null;
        structuredList = null;
        courseBundle = null;
        continue;
      }
      if (mk.optional || /^areas? of emphasis\b/i.test(mk.label)) {
        skipOptional = true;
        group = null;
        structuredGroup = null;
        structuredList = null;
        courseBundle = null;
        continue;
      }
      if (area && structuredGroup) {
        groupLabel = mk.label;
        group = structuredGroup;
        structuredList = { label: mk.label, codes: [] };
        structuredGroup.lists.push(structuredList);
        if (!structuredGroup.label && /foundations? area/i.test(mk.label))
          structuredGroup.label = 'Foundations Areas';
        continue;
      }
      groupLabel = mk.label;
      group = null;
      courseBundle = null;
      // This is a requirement that may overlap another major course, not four
      // more hours. The current planner has no overlay-constraint type. The CS
      // Application Design options already satisfy it, so omitting the duplicate
      // credit block is safer than adding an extra course.
      skipGroup = /^teamwork requirement$/i.test(mk.label);
    } else if (mk.kind === 'rule') {
      if (!area || skipGroup || skipOptional) continue;
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
      };
      area.groups.push(group);
      if (mk.structured && mk.choose !== null) structuredGroup = group;
      courseBundle = null;
    } else if (mk.kind === 'course') {
      if (!area || skipGroup || skipOptional) continue;
      if (!group) {
        group = { label: groupLabel, choose: null, hours: null, courses: [] };
        area.groups.push(group);
      }
      if (group.completeOneList) {
        if (!mk.andPrevious || !courseBundle) {
          courseBundle = [];
          group.bundles.push(courseBundle);
        }
        courseBundle.push(mk.code);
      }
      if (!group.courses.some((c) => c.code === mk.code)) {
        group.courses.push(mk);
        if (structuredList && !structuredList.codes.includes(mk.code))
          structuredList.codes.push(mk.code);
      }
    }
  }

  for (const parsedArea of areas) {
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
    return hasCourses || isElectiveArea;
  });
  const excludedPrefixes =
    flatPage
      .match(
        /excluding the following course prefixes:\s*([A-Z,\s]+?)(?:Please note|Transfer coursework)/i,
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
  return {
    areas: kept.filter((a2) => !TOTAL.test(a2.label)),
    totalCredits: total?.hours ?? null,
  };
}

const run = async () => {
  const onlyId = process.argv.includes('--id')
    ? process.argv[process.argv.indexOf('--id') + 1]
    : null;
  const undergraduateOnly = process.argv.includes('--undergraduate');
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
  } else if (undergraduateOnly && existing) {
    for (const program of existing.programs.filter((candidate) => undergraduateDegree(candidate.degree))) {
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
      const res = await fetch(`${BASE}/Program/Details/${p.id}?IDc=${p.college}`, {
        headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const title = clean(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? p.name ?? "");
      const { areas, totalCredits } = parseDetail(html);
      const emphasisGroups = parseEmphases(html);
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
    await sleep(300);
  }

  const finalPrograms =
    (onlyId || undergraduateOnly) && existing
      ? existing.programs.map(
          (program) => out.find((fresh) => fresh.id === program.id) ?? program,
        )
      : out;
  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      source: `${BASE}/Program/Details`,
      fetchedAt: new Date().toISOString(),
      count: finalPrograms.length,
      programs: finalPrograms,
    }),
  );
  console.log(`\n\n  ${finalPrograms.length} programs -> ${OUT}`);
  console.log(`  with parsed requirements: ${withReq}`);
};

run().catch((e) => { console.error(e); process.exit(1); });
