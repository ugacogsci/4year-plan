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
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  // Course rows: each course is its own one-row table, "CODE | Title | Hours".
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    for (const r of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[1]));
      const code = cells[0]?.match(/^([A-Z]{2,4})\s?(\d{4}[A-Z]?)$/);
      if (!code) continue;
      marks.push({
        kind: "course", at: m.index ?? 0,
        code: `${code[1]} ${code[2]}`,
        title: cells[1] ?? "",
        credits: Number(cells[2]?.match(/\d+/)?.[0] ?? 3),
      });
    }
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

  // "Choose 1 course(s) from the following:" opens a pick-one group.
  for (const m of html.matchAll(/Choose\s+(\d+)\s+course\(s\)/gi)) {
    marks.push({ kind: "rule", at: m.index ?? 0, choose: Number(m[1]) });
  }

  marks.sort((a2, b2) => a2.at - b2.at);

  const areas = [];
  let area = null;
  let group = null;
  for (const mk of marks) {
    if (mk.kind === "area") {
      area = { label: mk.label, hours: mk.hours, groups: [] };
      areas.push(area);
      group = null;
    } else if (mk.kind === "rule") {
      if (!area) continue;
      group = { label: "", choose: mk.choose, courses: [] };
      area.groups.push(group);
    } else if (mk.kind === "course") {
      if (!area) continue;
      if (!group) { group = { label: "", choose: null, courses: [] }; area.groups.push(group); }
      if (!group.courses.some((c) => c.code === mk.code)) group.courses.push(mk);
    }
  }

  // An "area" with no courses under it was a stray hours mention in prose.
  const kept = areas.filter((a2) => a2.groups.some((g) => g.courses.length));

  // "Total Major Hours (120 Hours)" is the degree total, not another bucket to
  // add up. Leaving it in the list made Accounting BBA claim 237 hours.
  const TOTAL = /^total\b/i;
  const total = kept.find((a2) => TOTAL.test(a2.label));
  return {
    areas: kept.filter((a2) => !TOTAL.test(a2.label)),
    totalCredits: total?.hours ?? null,
  };
}

const run = async () => {
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;

  process.stdout.write("listing programs");
  const seen = new Map();
  for (let page = 1; page <= 200; page++) {
    let rows;
    try { rows = await listPage(page); } catch { break; }
    const fresh = rows.filter((r) => !seen.has(r.id));
    fresh.forEach((r) => seen.set(r.id, r));
    process.stdout.write(fresh.length ? "." : "");
    if (!fresh.length) break;
    await sleep(220);
  }
  const programs = [...seen.values()].slice(0, limit === Infinity ? undefined : limit);
  console.log(`\n  ${seen.size} programs listed${programs.length < seen.size ? `, taking ${programs.length}` : ""}`);

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

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: `${BASE}/Program/Details`,
    fetchedAt: new Date().toISOString(),
    count: out.length,
    programs: out,
  }));
  console.log(`\n\n  ${out.length} programs -> ${OUT}`);
  console.log(`  with parsed requirements: ${withReq}`);
};

run().catch((e) => { console.error(e); process.exit(1); });
