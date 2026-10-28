/**
 * Odd picks: of the courses a board holds by the planner's own choice, how
 * many a sensible advisor would not have suggested, before and after.
 *
 *   node scripts/dev/odd-picks.mjs uga <before.jsonl> <after.jsonl> [--checkout <dir>] [--json <out.json>] [--examples N]
 *   node scripts/dev/odd-picks.mjs illinois <before.jsonl> <after.jsonl> [--reading <blocks.jsonl>] [--checkout <dir>] [--json <out.json>]
 *
 * The UGA files come from uga-harness.mjs build, the Illinois ones from
 * sweep/sweep.mjs. Both boards are read with one checkout's reading of the
 * degrees (default: this one), as gate.mjs judges both on the new reading,
 * so a pick counts the same way on either side.
 *
 * A free pick is a planned course the degree did not name outright: a pick
 * from a list (a UGA core area, a general-elective list, a major's "choose
 * from"), a general education category's pick (Illinois), a "choose N" row
 * with more courses than N, or a free elective. Required courses, the only
 * course a row allows, and prerequisites the board books for another course
 * are not picks; neither is a career track's course (pre-med, pre-PT).
 *
 * A pick is odd (the diagnosis of 2026-10-28, keep-planner/sched-fix) when
 * it is unrelated (not in the degree's own subjects, not on the program's
 * sample plan, not a course or subject the student's goal names) and either
 * not offered in the term it is planned for or not commonly taken:
 *   - offered: UGA, the Schedule of Classes (public/uga/course-offerings.json),
 *     the term itself where the file has it and otherwise the same season's
 *     newest term (Fall 2026 for a fall, Spring 2027 or 2026 for a spring);
 *     Illinois, the season in the offering history (public/illinois/
 *     offerings.json) or Spring 2027's crawled sections;
 *   - commonly taken: among the ten most taken of its list (the top 10% of a
 *     list over a hundred); a free elective among the most taken 15% of all
 *     undergraduate courses. UGA counts students enrolled in Spring, Summer
 *     and Fall 2026; Illinois, students graded in its grade reports.
 * Also counted (UGA): picks not offered in their planned term at all.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [school, beforeFile, afterFile] = process.argv.slice(2);
if (!['uga', 'illinois'].includes(school) || !beforeFile || !afterFile) {
  console.error('usage: odd-picks.mjs uga|illinois <before.jsonl> <after.jsonl> [--checkout <dir>] [--reading <blocks.jsonl>] [--json <out.json>] [--examples N]');
  process.exit(2);
}
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const ROOT = resolve(arg('--checkout') ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..'));
const EXAMPLES = Number(arg('--examples') ?? 12);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
const jsonl = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const publicJson = (name) => JSON.parse(readFileSync(join(ROOT, 'public', name), 'utf8'));

register('data:text/javascript,' + encodeURIComponent(`
  import { readFile } from 'node:fs/promises';
  import ts from ${JSON.stringify(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)};
  const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = ROOT + spec.slice(2);
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\\.[cm]?[jt]sx?$|\\.json$/.test(spec)) {
      try { return await next(spec + '.ts', ctx); } catch {}
      try { return await next(spec + '.tsx', ctx); } catch {}
    }
    return next(spec, ctx);
  }
  export async function load(url, ctx, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, ctx);
  }
`));
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);
const A = await lib('lib/planner/autoplan.ts');
// A checkout before 2026-10-28 has no open elective blocks (any-course.ts); their lists are then the sample they hold.
const AC = existsSync(join(ROOT, 'lib/planner/any-course.ts')) ? await lib('lib/planner/any-course.ts') : null;
const CT = await lib('lib/planner/career-tracks.ts');

// ---------------------------------------------------------------------------
// The school: its degrees' blocks, titles, how many take each course, when it runs
// ---------------------------------------------------------------------------
let blocksOf; // id -> requirement blocks ({ kind, codes[][], n, genEd })
let programNameOf;
let sampleOf = () => new Set();
let titleOf;
let tagsOf = () => [];
let taken;
let offered;
let undergraduate;
let prereqsOf = () => [];
const byTag = new Map();

if (school === 'uga') {
  const U = await lib('components/planner/uga-source.tsx');
  const G = await lib('lib/planner/uga-planning-guidance.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(publicJson((typeof url === 'string' ? url : url.url).replace(/^\//, ''))));
  const data = await U.loadUgaData();
  globalThis.fetch = originalFetch;
  const loaded = new Map();
  const load = (id) => {
    if (loaded.has(id)) return loaded.get(id);
    const program = data.programs.find((p) => p.id === id);
    if (!program) return null;
    // The default emphasis, as the harness builds it.
    const emphasisSelections = Object.fromEntries(U.ugaSelectionRequirements(program).map((q) => [q.id, q.options.slice(0, q.minimum).map((o) => o.id)]));
    const l = U.loadUgaProgram(data, program, { emphasisSelections });
    const labels = U.ugaSelectionRequirements(program).flatMap((q) => q.options.filter((o) => emphasisSelections[q.id]?.includes(o.id)).map((o) => o.label));
    const out = { blocks: l.blocks, name: l.program.name, sample: G.sampleCoursesFor(G.samplePlansFor(data.guidance, [id]), { [id]: labels }) };
    loaded.set(id, out);
    return out;
  };
  blocksOf = (id) => load(id)?.blocks ?? [];
  programNameOf = (id) => load(id)?.name;
  sampleOf = (id) => new Set([...(load(id)?.sample ?? [])].map(norm));
  const byCode = new Map(data.courses.map((c) => [norm(c.code), c]));
  titleOf = (code) => byCode.get(norm(code))?.title ?? '';
  prereqsOf = (code) => (data.context.prereqs.get(norm(code))?.groups ?? []).flatMap((g) => g.any.map(norm));
  const file = publicJson('uga/course-offerings.json');
  const base = (code) => (file.courses[norm(code)] ? norm(code) : norm(code).replace(/^(\S+ \d{4})[EHWS]$/, '$1'));
  const counted = ['Spring 2026', 'Summer 2026', 'Fall 2026'];
  taken = (code) => counted.reduce((n, t) => n + (file.courses[base(code)]?.[t]?.enrolled ?? 0), 0);
  const posting = new Map(file.terms.map((t) => [t.label, new Set(t.stillPosting ?? [])]));
  const has = (code, term) => (file.courses[base(code)]?.[term]?.sections ?? 0) > 0;
  offered = (code, term) => {
    const season = term.split(' ')[0];
    if (file.terms.some((t) => t.label === term) && has(code, term)) return true;
    const same = file.terms.filter((t) => t.label.startsWith(season)).map((t) => t.label);
    // A subject still posting its sections in an upcoming term is not "not offered" there.
    return same.some((t) => has(code, t) || (posting.get(t)?.has(norm(code).split(' ')[0]) && same.some((u) => u !== t && has(code, u))));
  };
  undergraduate = data.courses.map((c) => norm(c.code)).filter((c) => /^\S+ [1-5]\d{3}/.test(c));
} else {
  const index = publicJson('illinois/index.json');
  const byCode = new Map(index.map((c) => [norm(c.code), c]));
  titleOf = (code) => byCode.get(norm(code))?.title ?? '';
  tagsOf = (code) => byCode.get(norm(code))?.tags ?? [];
  for (const c of index) for (const t of c.tags ?? []) (byTag.get(t) ?? byTag.set(t, []).get(t)).push(norm(c.code));
  const reading = arg('--reading') ?? `${afterFile.replace(/\.jsonl$/, '')}.blocks.jsonl`;
  if (!existsSync(reading)) {
    console.error(`no reading file ${reading}: pass --reading <sweep>.blocks.jsonl`);
    process.exit(2);
  }
  const blocks = new Map();
  for (const b of jsonl(reading)) (blocks.get(b.id) ?? blocks.set(b.id, []).get(b.id)).push(b);
  blocksOf = (id) => (blocks.get(id) ?? []).map((b) => ({ id: b.req, areaId: b.req.split('::').slice(0, 2).join('::'), areaLabel: b.area, label: b.label, hours: b.hours, note: '', url: '', rule: b.rule }));
  const prereqs = publicJson('illinois/prereqs.json');
  prereqsOf = (code) => (prereqs[norm(code)]?.groups ?? []).flatMap((g) => g.any.map(norm));
  const programs = publicJson('illinois/programs.json');
  const names = new Map(programs.map((p) => [p.id, p.name]));
  programNameOf = (id) => names.get(id);
  const grades = new Map(publicJson('illinois/grades.json').map((g) => [norm(g.code), g.n]));
  // A course with no grade report (RHET 105) by its Fall 2026 sections, about 25 students each, twice a year, over the reports' two and a half years.
  const sections = publicJson('illinois/sections.json');
  const sectionTotal = new Map((sections.courses ?? []).map((c) => [norm(c.code), c.total ?? c.sections?.length ?? 0]));
  taken = (code) => grades.get(norm(code)) ?? (sectionTotal.get(norm(code)) ?? 0) * 125;
  const history = publicJson('illinois/offerings.json').courses;
  const spring27 = existsSync(join(ROOT, 'public/illinois-sections-sp2027.json')) ? new Set(publicJson('illinois-sections-sp2027.json').courses.map((c) => norm(c.code))) : new Set();
  offered = (code, term) => {
    const ran = history[norm(code)] ?? [];
    if (term === 'Spring 2027' && spring27.has(norm(code))) return true;
    const prefix = { Fall: 'fa', Spring: 'sp', Summer: 'su' }[term.split(' ')[0]];
    return ran.some((t) => t.startsWith(prefix));
  };
  undergraduate = index.map((c) => norm(c.code)).filter((c) => /^\S+ [1-4]\d{2}$/.test(c));
}

// The most taken 15% of undergraduate courses: a free elective among them is common.
const ranked = undergraduate.map(taken).filter((n) => n > 0).sort((a, b) => b - a);
const electiveFloor = ranked[Math.floor(ranked.length * 0.15)] ?? Infinity;

// ---------------------------------------------------------------------------
// A board's free picks
// ---------------------------------------------------------------------------
const boardOf = (row) => school === 'uga'
  ? (row.board ?? []).map((line) => { const [term, codes = ''] = line.split(': '); return { term, codes: codes.split(', ').filter(Boolean).map(norm) }; })
  : (row.terms ?? []).map((t) => ({ term: t.label, codes: t.codes.map(norm) }));
const goalOf = (row) => (school === 'uga' ? (row.kind === 'first-premed' ? 'I want to go to medical school.' : '') : row.goal ?? '');
const reading = new Map();
function readingOf(id) {
  if (reading.has(id)) return reading.get(id);
  const blocks = blocksOf(id);
  const { subjects, primary } = A.degreeSubjects(blocks, programNameOf(id));
  const required = new Set();
  const lists = [];
  for (const b of blocks) {
    const r = b.rule;
    if (r.kind === 'all') for (const ch of r.choices) { if (ch.codes.length === 1) required.add(norm(ch.codes[0])); else lists.push({ label: `${b.areaLabel} / ${b.label}`, codes: ch.codes.map(norm), source: 'choose' }); }
    else if (r.kind === 'choose') {
      const codes = r.choices.flatMap((ch) => ch.codes.map(norm));
      if (r.choices.length <= r.n) codes.forEach((c) => required.add(c));
      else lists.push({ label: `${b.areaLabel} / ${b.label}`, codes, source: 'choose' });
    } else if (r.kind === 'pool') {
      // "Any upper level course 3000-5999" is every course its rule takes, not the sample the board plans from.
      const codes = r.anyCourse && AC ? undergraduate.filter((c) => AC.anyCourseTakes(r.anyCourse, c)) : r.choices.flatMap((ch) => ch.codes.map(norm));
      lists.push({ label: `${b.areaLabel} / ${b.label}`, codes, source: 'list' });
    }
    else if (r.kind === 'gened') lists.push({ label: b.label, codes: [...new Set(r.genEd.flatMap((t) => byTag.get(t) ?? []))], source: 'gened', tags: r.genEd });
  }
  const out = { subjects, primary, required, lists: lists.map((l) => ({ ...l, set: new Set(l.codes), rank: null })), sample: sampleOf(id) };
  reading.set(id, out);
  return out;
}
const rankIn = (list) => {
  if (!list.rank) list.rank = new Map([...new Set(list.codes)].map((c) => [c, taken(c)]).sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i + 1]));
  return list.rank;
};

function picksOf(row) {
  const r = readingOf(row.id);
  const board = boardOf(row);
  const onBoard = new Set(board.flatMap((t) => t.codes));
  const profile = CT.interestProfile(goalOf(row));
  const goalCourses = new Set((profile.courses ?? []).map(norm));
  const goalSubjects = new Set(profile.subjects ?? []);
  const track = new Set([...(row.trackCodes ?? []), ...(row.trackRows ?? []).flatMap((t) => String(t).split(':').pop().split('/'))].map(norm));
  const trackWhy = new Set((row.electiveWhy ?? []).filter((w) => /: For /.test(w)).map((w) => norm(w.split(':')[0])));
  const added = new Set((row.addedBy ?? []).map(([code]) => norm(code)));
  // A prerequisite of another course on the board that no list names was booked for it.
  const prereqOfBoard = (code) => [...onBoard].some((other) => other !== code && prereqsOf(other).includes(code));
  const out = [];
  for (const t of board) {
    for (const code of t.codes) {
      if (r.required.has(code) || track.has(code) || trackWhy.has(code) || added.has(code) || prereqOfBoard(code)) continue;
      // The language sequence: the sweep plans Spanish for the language requirement.
      if (school === 'illinois' && /^SPAN [12]0\d$/.test(code)) continue;
      const list = r.lists.find((l) => l.set.has(code) && l.source !== 'gened') ?? r.lists.find((l) => l.set.has(code));
      const source = list ? list.source : 'elective';
      const subject = code.split(' ')[0];
      const related = r.subjects.has(subject) || subject === r.primary || r.sample.has(code) || goalCourses.has(code) || goalSubjects.has(subject) ||
        (profile.words ?? []).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(titleOf(code)));
      const n = taken(code);
      let common;
      if (list) {
        const rank = rankIn(list).get(code) ?? Infinity;
        common = n > 0 && rank <= Math.max(10, Math.ceil(list.set.size * 0.1));
      } else common = n > 0 && n >= electiveFloor;
      const isOffered = offered(code, t.term);
      out.push({ code, title: titleOf(code), term: t.term, source, list: list?.label ?? 'free elective', related, common, offered: isOffered, odd: !related && (!common || !isOffered), taken: n });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scoreboard
// ---------------------------------------------------------------------------
const key = (row) => (school === 'uga' ? `${row.id}|${row.kind}` : `${row.id}|${row.goal}|${row.lang}`);
const before = new Map(jsonl(beforeFile).filter((r) => r.ok !== false && !r.error).map((r) => [key(r), r]));
const after = new Map(jsonl(afterFile).filter((r) => r.ok !== false && !r.error).map((r) => [key(r), r]));
const both = [...after.keys()].filter((k) => before.has(k));
const measure = (rows) => {
  const picks = rows.flatMap((row) => picksOf(row).map((p) => ({ ...p, board: key(row), name: row.name ?? programNameOf(row.id) ?? row.id })));
  const per = (f) => (rows.length ? (picks.filter(f).length / rows.length).toFixed(2) : '-');
  const pct = (f, of = () => true) => { const all = picks.filter(of); return all.length ? `${Math.round((100 * all.filter(f).length) / all.length)}%` : '-'; };
  return { picks, boards: rows.length, perPlan: per(() => true), oddPerPlan: per((p) => p.odd), oddShare: pct((p) => p.odd), notOfferedPerPlan: per((p) => !p.offered), notOfferedShare: pct((p) => !p.offered),
    bySource: Object.fromEntries(['list', 'choose', 'gened', 'elective'].map((s) => [s, { picks: picks.filter((p) => p.source === s).length, odd: pct((p) => p.odd, (p) => p.source === s) }])),
    medianUnrelated: (() => { const xs = picks.filter((p) => !p.related).map((p) => p.taken).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : 0; })() };
};
const b = measure(both.map((k) => before.get(k)));
const a = measure(both.map((k) => after.get(k)));
const lines = [];
const say = (s = '') => lines.push(s);
say(`# Odd picks, ${school === 'uga' ? 'UGA' : 'Illinois'}: ${both.length} boards on both sides`);
say();
say('| | before | after |');
say('|---|---|---|');
say(`| free picks per plan | ${b.perPlan} | ${a.perPlan} |`);
say(`| odd picks per plan | ${b.oddPerPlan} | ${a.oddPerPlan} |`);
say(`| share of free picks that are odd | ${b.oddShare} | ${a.oddShare} |`);
say(`| picks not offered in their planned term, per plan | ${b.notOfferedPerPlan} | ${a.notOfferedPerPlan} |`);
say(`| share not offered in their planned term | ${b.notOfferedShare} | ${a.notOfferedShare} |`);
say(`| students a year in the typical unrelated pick (median) | ${b.medianUnrelated} | ${a.medianUnrelated} |`);
for (const s of ['list', 'choose', 'gened', 'elective']) if (b.bySource[s].picks || a.bySource[s].picks) say(`| ${s} picks: odd share (picks) | ${b.bySource[s].odd} (${b.bySource[s].picks}) | ${a.bySource[s].odd} (${a.bySource[s].picks}) |`);
say();
const freq = (picks) => { const m = new Map(); for (const p of picks.filter((x) => x.odd)) m.set(`${p.code} ${p.title}`, (m.get(`${p.code} ${p.title}`) ?? 0) + 1); return [...m].sort((x, y) => y[1] - x[1]); };
say(`Most frequent odd picks before: ${freq(b.picks).slice(0, EXAMPLES).map(([k, n]) => `${k} (${n})`).join('; ')}`);
say();
say(`Most frequent odd picks after: ${freq(a.picks).slice(0, EXAMPLES).map(([k, n]) => `${k} (${n})`).join('; ')}`);
console.log(lines.join('\n'));
const out = arg('--json');
if (out) writeFileSync(out, JSON.stringify({ school, boards: both.length, before: { ...b, picks: undefined }, after: { ...a, picks: undefined }, beforePicks: b.picks, afterPicks: a.picks }));
