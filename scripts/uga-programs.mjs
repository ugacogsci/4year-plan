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
      /^(\d)000(?:\/\d000)?-level courses?/i,
    )?.[1];
    return subject && level ? `${subject} ${level}XXX` : null;
  };

  // Course rows: each course is its own one-row table, "CODE | Title | Hours".
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    for (const r of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(
        (c) => clean(c[1]),
      );
      const code = courseCode(cells[0] ?? '', cells[1] ?? '');
      if (!code) continue;
      marks.push({
        kind: 'course',
        at: m.index ?? 0,
        code,
        title: cells[1] ?? '',
        credits: Number(cells[2]?.match(/\d+/)?.[0] ?? 3),
      });
    }
  }

  // A subject-wide elective is rendered as a linked subject followed by prose,
  // not as a normal course code cell: "CSCI 4000/6000-level courses".
  for (const m of html.matchAll(
    /<a[^>]*>\s*([A-Z]{2,5})\s*<\/a>[\s\S]{0,240}?(\d)000\/\d000-level courses?/gi,
  )) {
    marks.push({
      kind: 'course',
      at: m.index ?? 0,
      code: `${m[1].toUpperCase()} ${m[2]}XXX`,
      title: `${m[1].toUpperCase()} ${m[2]}000-level courses`,
      credits: 0,
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
      });
  }

  // UGA uses both counts and credit totals: "Choose 1 course(s)" and "Choose
  // 12 credit hour(s)". They are not interchangeable.
  const numberWord = (value) =>
    ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 })[
      value.toLowerCase()
    ] ?? Number(value);
  for (const m of html.matchAll(
    /Choose\s+(a\s+minimum\s+of\s+)?(\d+)\s+(course|credit\s+hour)\(s\)/gi,
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
    marks.push({
      kind: 'rule',
      at: m.index ?? 0,
      choose: inHours ? null : amount,
      hours: inHours ? amount : null,
      minimum: Boolean(m[1]),
      upperDivisionHours: upperDivisionHours || null,
      minimumAreas: areaMinimum ? numberWord(areaMinimum[1]) : null,
      note: m[1] ? sentence : '',
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
  const STOPS =
    /^(entrance requirements|major requirements|career information|transfer student information|other learning opportunities|student organizations|available graduate programs|college-wide requirements|general education core|university-wide requirements|four-year program of study)$/i;
  for (const mk of marks) {
    if (mk.kind === "area") {
      area = { label: mk.label, hours: mk.hours, groups: [] };
      areas.push(area);
      group = null;
      groupLabel = '';
      skipGroup = false;
      skipOptional = false;
      structuredGroup = null;
      structuredList = null;
    } else if (mk.kind === 'heading') {
      if (STOPS.test(mk.label)) {
        area = null;
        group = null;
        groupLabel = '';
        skipGroup = false;
        skipOptional = false;
        structuredGroup = null;
        structuredList = null;
        continue;
      }
      if (/^areas? of emphasis\b/i.test(mk.label)) {
        skipOptional = true;
        group = null;
        structuredGroup = null;
        structuredList = null;
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
        courses: [],
      };
      area.groups.push(group);
      if (mk.minimum && mk.choose !== null) structuredGroup = group;
    } else if (mk.kind === 'course') {
      if (!area || skipGroup || skipOptional) continue;
      if (!group) {
        group = { label: groupLabel, choose: null, hours: null, courses: [] };
        area.groups.push(group);
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
  const kept = areas.filter(
    (a2) =>
      a2.groups.some((g) => g.courses.length) ||
      /^(?:general|free) electives?\b/i.test(a2.label),
  );
  for (const keptArea of kept) {
    if (/^major electives?$/i.test(keptArea.label)) {
      keptArea.excludeCodes = majorElectiveExclusions;
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
      if (areas.length) withReq++;
      out.push({
        id: p.id, college: p.college, degree: p.degree, name: title, areas,
        totalCredits,
        areaHours: areas.reduce((sum, a) => sum + (a.hours || 0), 0),
      });
    } catch {
      out.push({ id: p.id, college: p.college, degree: p.degree, name: p.name ?? "", areas: [], totalCredits: null, areaHours: 0 });
    }
    if (i % 25 === 0 || i === programs.length) {
      process.stdout.write(`\r  ${i}/${programs.length} fetched, ${withReq} with requirements   `);
    }
    await sleep(300);
  }

  const finalPrograms =
    onlyId && existing
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
