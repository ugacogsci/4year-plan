/**
 * Builds public/<school>/professor-ratings.json from Cameron's Rate My
 * Professors collection (data/ratemyprofessors/<school>.json, read only).
 *
 * Kept: rated profiles only (name, department, overall, difficulty, would
 * take again, count, profile link), one person's obvious duplicate profiles
 * merged; the day they were collected; and, per course subject, the site
 * departments its instructors are listed under (learned from the syllabi's
 * and, for Illinois, the grade history's instructor names that match exactly
 * one profile, plus Illinois's catalog subject names). Matching and wording
 * live in lib/planner/professor-ratings.ts. Prints match coverage for the
 * instructors named on each school's syllabi.
 *
 *   node scripts/professor-ratings/build.mjs            (both schools)
 *   node scripts/professor-ratings/build.mjs --school uga
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { if (spec.startsWith('.') && !/\\.[cm]?[jt]s$|\\.json$/.test(spec)) { try { return await next(spec + '.ts', ctx); } catch {} } return next(spec, ctx); }`));

const ROOT = join(HERE, '..', '..');
const R = await import(join(ROOT, 'lib', 'planner', 'professor-ratings.ts'));
const S = await import(join(ROOT, 'lib', 'planner', 'illinois-subjects.ts'));

/** Illinois: a department whose name (or one of its words) the subject's catalog name matches. */
const illinoisNamed = (subject, dept) => {
  if (!S.ILLINOIS_SUBJECT_NAMES[subject]) return false;
  if (S.subjectMatches(subject, dept)) return true;
  return dept.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !COMMON.has(w)).some((w) => S.subjectMatches(subject, w));
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Words too common in course titles or department names to say which field a course is in.
const COMMON = new Set(['science', 'sciences', 'studies', 'study', 'general', 'other', 'introduction', 'intro', 'advanced', 'special', 'topics', 'research', 'seminar', 'honors', 'applied', 'fundamentals', 'principles', 'theory', 'methods', 'selected', 'problems', 'directed', 'independent', 'professional', 'systems', 'system', 'issues', 'practice', 'practicum', 'internship', 'thesis', 'dissertation', 'readings', 'survey', 'senior', 'undergraduate', 'graduate', 'workshop', 'laboratory', 'foundations', 'contemporary', 'modern', 'world', 'international', 'american', 'global', 'special']);
const folded = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stemOf = (w) => w.slice(0, Math.max(5, w.length - 3));

/**
 * A department whose own words name what a subject's courses are about: one of
 * its words (five letters or more, not a common one) starts a word in at least
 * 8% of the subject's course titles in the catalog, and two (one, for a
 * subject of fewer than five courses).
 */
function titleNamer(courses) {
  const titles = new Map();
  for (const c of courses) {
    const subj = subjectOf(c.code ?? `${c.subject} ${c.number}`);
    const words = new Set(folded(c.title).split(/[^a-z]+/).filter((w) => w.length >= 4));
    titles.set(subj, [...(titles.get(subj) ?? []), words]);
  }
  return (subject, dept) => {
    const list = titles.get(subject) ?? [];
    if (list.length === 0) return false;
    const need = list.length < 5 ? 1 : Math.max(2, Math.ceil(list.length * 0.08));
    return folded(dept).split(/[^a-z]+/).filter((w) => w.length >= 5 && !COMMON.has(w)).some((w) => {
      const stem = stemOf(w);
      return list.filter((t) => [...t].some((x) => x.startsWith(stem))).length >= need;
    });
  };
}
const subjectOf = (code) => String(code).trim().toUpperCase().split(/[\s/-]+/)[0];

/** Every instructor name on a school's syllabi, with the course's subject. */
function syllabusNames(school) {
  const dir = join(ROOT, 'public', school, 'syllabi');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const shard = readJson(join(dir, f));
    for (const [code, records] of Object.entries(shard.courses ?? {})) {
      if (!Array.isArray(records)) continue; // index.json: counts, not syllabi
      for (const s of records) for (const name of s.instructors ?? []) out.push({ subject: subjectOf(code), name, code });
    }
  }
  return out;
}

/** Illinois's grade-history instructors ("Shaffer, Eric G"), per course. */
function illinoisGradeNames() {
  const dir = join(ROOT, 'public', 'illinois', 'course');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const shard = readJson(join(dir, f));
    for (const g of shard.instructors ?? []) for (const i of g.instructors ?? []) if (i?.name) out.push({ subject: subjectOf(g.code), name: i.name, code: g.code });
  }
  return out;
}

const args = process.argv.slice(2);
const only = args.includes('--school') ? args[args.indexOf('--school') + 1] : null;

for (const school of ['uga', 'illinois'].filter((s) => !only || s === only)) {
  const src = join(ROOT, 'data', 'ratemyprofessors', `${school}.json`);
  if (!existsSync(src)) {
    console.log(`${school}: no ${src}, skipped`);
    continue;
  }
  const raw = readJson(src);
  const fromSyllabi = syllabusNames(school);
  const learnFrom = school === 'illinois' ? [...fromSyllabi, ...illinoisGradeNames()] : fromSyllabi;
  // Who else the school's records name with a profile's last name and initial ("Singh, Gagandeep" beside "Guarav Singh").
  const profiles = R.markSameInitial(R.ratedProfiles(raw.profiles ?? []), learnFrom.map((n) => n.name));
  const catalog = school === 'uga' ? readJson(join(ROOT, 'public', 'uga-catalog.json')) : readJson(join(ROOT, 'public', 'illinois-catalog.json')).courses;
  const byTitles = titleNamer(catalog);
  const named = school === 'illinois' ? (subj, dept) => illinoisNamed(subj, dept) || byTitles(subj, dept) : byTitles;
  const subjectDepartments = R.learnSubjectDepartments(profiles, learnFrom, named, [...new Set(catalog.map((c) => subjectOf(c.code ?? `${c.subject} ${c.number}`)))]);
  const file = {
    source: 'Rate My Professors',
    school,
    schoolName: raw.metadata?.school ?? school,
    collectedAt: String(raw.metadata?.updatedAt ?? '').slice(0, 10),
    profiles,
    subjectDepartments,
  };

  // Coverage: each syllabus instructor once per subject.
  const seen = new Set();
  const counts = { instructors: 0, found: 0, not_sure: 0, none: 0, needs_first_name: 0 };
  for (const { subject, name } of fromSyllabi) {
    const w = R.wantedName(name);
    if (!w) continue;
    const key = `${subject}|${w.given[0] ?? w.initial ?? ''}|${w.lastForms[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.instructors += 1;
    const m = R.matchProfessor(file, name, subject);
    if (m.status === 'found') counts.found += 1;
    else if (m.status === 'unsure') counts.not_sure += 1;
    else if (m.status === 'needs_first_name') counts.needs_first_name += 1;
    else counts.none += 1;
  }
  file.coverage = counts;
  const out = join(ROOT, 'public', school, 'professor-ratings.json');
  writeFileSync(out, JSON.stringify(file) + '\n');
  const merged = profiles.filter((p) => p.merged).length;
  const pct = (n) => `${Math.round((n / Math.max(1, counts.instructors)) * 100)}%`;
  console.log(`${school}: ${raw.profiles.length} profiles, ${profiles.length} kept (rated; ${merged} merged from duplicates), ${Object.keys(subjectDepartments).length} subjects with departments`);
  console.log(`  syllabus instructors ${counts.instructors}: found ${counts.found} (${pct(counts.found)}), not sure ${counts.not_sure} (${pct(counts.not_sure)}), no profile ${counts.none} (${pct(counts.none)}), last name only ${counts.needs_first_name}`);
  console.log(`  wrote ${out} (${(JSON.stringify(file).length / 1024).toFixed(0)} KB)`);
}
