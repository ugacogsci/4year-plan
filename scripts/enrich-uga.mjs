#!/usr/bin/env node
/**
 * Enrich the UGA course catalog with the three fields a four-year planner
 * cannot work without, and which the original scrape walked straight past.
 *
 * semantic-course-map/backend/scrape_deep_details.py already visits every
 * /Course/Details/{id} page. It reads courseObjectives and topicalOutline and
 * stops there. Those same pages publish, in plain HTML:
 *
 *   Prerequisite               "CSCI 1301-1301L or CSCI 1301E"
 *   Semester Course Offered    "Offered fall, spring and summer"
 *   page heading               "CSCI 1302 | 4 hours"
 *
 * Without prerequisites a planner cannot order a degree, and without offering
 * terms it will happily schedule a spring-only course in the fall. The map
 * data has 14,092 courses and 34 of them mention a prerequisite anywhere.
 *
 * Identifies honestly rather than spoofing a browser, because the point of
 * this project is to be the crawler a university is willing to allow.
 *
 *   node scripts/enrich-uga.mjs --limit 50        # sample first
 *   node scripts/enrich-uga.mjs                   # everything
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "..", "semantic-course-map", "frontend", "public", "data", "database_mapped_pacmap_o.json");
const OUT = join(ROOT, "data", "uga-courses.json");
const UA = "TruBot/1.0 (+https://trumizzou.com; student project; respects robots.txt)";

const CONCURRENCY = 4;
const DELAY_MS = 260;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull one labelled field out of the details page. The page renders each as a
 *  heading followed by its value, so take the text between this label and the
 *  next one rather than guessing at class names that may change. */
const LABELS = [
  'Prerequisite',
  'Corequisite',
  'Semester Course Offered',
  'Grading System',
  'Student learning Outcomes',
  'Course Objectives',
  'Topical Outline',
];
function field(text, label) {
  const i = text.indexOf(label);
  if (i < 0) return "";
  const after = text.slice(i + label.length);
  let end = after.length;
  for (const other of LABELS) {
    if (other === label) continue;
    const j = after.indexOf(other);
    if (j > -1 && j < end) end = j;
  }
  return after.slice(0, end).replace(/\s+/g, " ").trim().replace(/^[|\s]+|[|\s]+$/g, "");
}

const flatten = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " | ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/(\s*\|\s*)+/g, " | ").replace(/\s+/g, " ");

/**
 * Credit hours are not a labelled detail field on the current Bulletin. They
 * sit beside the course code above the title ("CSCI 1302 | 4 hours"). Reading
 * a nonexistent "Credit Hours" field made every one of 14,092 courses fall
 * back to three credits. Only inspect the page prefix, before Course
 * Description, so an hour count in prerequisite prose cannot be mistaken for
 * the course's own value.
 */
function creditHours(html) {
  const prefix = flatten(html).split('Course Description', 1)[0] ?? '';
  const range = prefix.match(
    /\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+hours?\b/i,
  );
  if (range) return { credits: Number(range[1]), creditsMax: Number(range[2]) };
  const fixed = prefix.match(/\b(\d+(?:\.\d+)?)\s+hours?\b/i);
  const credits = fixed ? Number(fixed[1]) : null;
  return { credits, creditsMax: credits };
}

/** "Offered fall, spring and summer" -> ["Fall","Spring"] in the planner's shape. */
function seasons(s) {
  const l = s.toLowerCase();
  const out = [];
  if (l.includes("fall")) out.push("Fall");
  if (l.includes("spring")) out.push("Spring");
  return out.length ? out : ["Fall", "Spring"];
}

/** "CSCI 1301-1301L or CSCI 1301E" -> ["CSCI 1301","CSCI 1301L","CSCI 1301E"] */
function prereqCodes(s) {
  if (!s || /^\s*$/.test(s)) return [];
  const codes = new Set();
  // Walk left to right so a bare number inherits the subject last named:
  // "AAEC 2580 or 2580E" means AAEC 2580 and AAEC 2580E, and dropping the
  // second one silently loses a real prerequisite.
  let subject = "";
  for (const m of s.matchAll(/\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\b|\b(\d{4}[A-Z]?)\b/g)) {
    if (m[1]) { subject = m[1]; codes.add(`${m[1]} ${m[2]}`); }
    else if (subject && m[3]) codes.add(`${subject} ${m[3]}`);
  }
  // "1301-1301L" ranges name the second course by number only
  for (const m of s.matchAll(/\b([A-Z]{2,4})\s?(\d{4}[A-Z]?)\s*-\s*(\d{4}[A-Z]?)\b/g)) codes.add(`${m[1]} ${m[3]}`);
  return [...codes];
}

const run = async () => {
  if (!existsSync(SRC)) { console.error(`missing source: ${SRC}`); process.exit(1); }
  const all = JSON.parse(readFileSync(SRC, "utf8"));
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : Infinity;
  const todo = all.filter((c) => c.url).slice(0, limit === Infinity ? undefined : limit);

  const done = [];
  let i = 0, ok = 0, withPre = 0, fail = 0;

  async function worker() {
    while (i < todo.length) {
      const c = todo[i++];
      const n = i;
      try {
        const res = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const t = flatten(html);
        const pre = field(t, 'Prerequisite');
        const off = field(t, 'Semester Course Offered');
        const credit = creditHours(html);
        const codes = prereqCodes(pre);
        if (codes.length) withPre++;
        done.push({
          ...c,
          credits: credit.credits ?? 3,
          creditsMax: credit.creditsMax ?? credit.credits ?? 3,
          prerequisiteText: pre,
          prerequisites: codes,
          offeredText: off,
          offeredIn: seasons(off),
        });
        ok++;
      } catch {
        fail++;
        done.push({ ...c, credits: 3, prerequisiteText: "", prerequisites: [], offeredText: "", offeredIn: ["Fall", "Spring"] });
      }
      if (n % 100 === 0 || n === todo.length) {
        process.stdout.write(`\r  ${n}/${todo.length}  ok=${ok} withPrereq=${withPre} failed=${fail}   `);
      }
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  done.sort((a, b) => `${a.subject}${a.number}`.localeCompare(`${b.subject}${b.number}`, undefined, { numeric: true }));
  writeFileSync(OUT, JSON.stringify({ source: "bulletin.uga.edu /Course/Details", fetchedAt: new Date().toISOString(), count: done.length, courses: done }));
  console.log(`\n\n  ${done.length} courses -> ${OUT}`);
  console.log(`  with prerequisites: ${withPre}  (was 34 of 14,092 before)`);
};

run().catch((e) => { console.error(e); process.exit(1); });
