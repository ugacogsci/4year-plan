/**
 * Tag every OneIllinois group with the planner's own words: goal ids, kind,
 * audience, identity, subjects, colleges and the curated lists it is on.
 *
 *   node scripts/illinois/clubs/tag.mjs              reads data/clubs/directory.json, writes data/clubs/tagged.json
 *   node scripts/illinois/clubs/tag.mjs --quiet      the counts only, not the per-goal table
 *
 * No network. It re-spawns itself with --experimental-strip-types, because the
 * goal reader lives in lib/planner/career-tracks.ts.
 *
 * Evidence, strongest first (DESIGN 2.6):
 *   1. lists.json + aliases.json: a university office's list. Pre-Law
 *      Advising's list counts as the pre-law goal; Engineering Council and the
 *      Gies Council of Presidents count as a college; the Siebel School's list
 *      counts as the CS subject. Names are joined to ids only through the
 *      hand-checked alias table: automatic joins were wrong 3 times in 109.
 *   2. nationals.json: a chapter of a national body (ASME -> ME, Beta Alpha Psi
 *      -> ACCY and accounting).
 *   3. the club's NAME read by interestProfile(), the same rules that read a
 *      student's own goal sentence, so "pre-med" means one thing for courses
 *      and for clubs. On top of it, one club-name alias: "Pre-Health" (and
 *      "health professions") is every health track but pre-vet, plus nursing
 *      (HEALTH_TRACKS). Choirs,
 *      choruses and a cappella groups are arts by kind only; no goal.
 *   4. the reading pass (step 5) adds goals later, in build.mjs, kept only
 *      where a directory category agrees: GOAL_CATEGORIES below is that map.
 *      Regex over mission text NEVER tags a goal here: in the prototypes it
 *      tagged Delta Chi as law ("laws") and steel construction as UX.
 *   5. overrides.json, hand-checked, by id: audience, kind, identity, goals
 *      added or removed, course subjects added (a competition team about the
 *      major whose name does not say so: Steel Bridge -> CEE), the majors a
 *      subject several majors share is for (HK: Kinesiology only), hidden,
 *      starter (true, or 'undeclared' for a starter only a student with no
 *      major sees), and our own `does` line (applied in build.mjs).
 *
 * Who a group is for (DESIGN 2.5): office accounts and groups for students
 * already in graduate, law, medical or veterinary school are kept in
 * tagged.json with `dropped` set, so build.mjs can count them, and never
 * shipped. The directory's own "Graduate or Professional Student Focused" tag
 * is not enough to drop a group (the Pre-Physician Assistant Club carries it);
 * it, or a mission that names graduate, law, medical or veterinary students,
 * only raises audience 'check'. The mission text is read in memory for that
 * one question and never written.
 *
 * Guards, each of which stops the run before anything is written:
 *   - every goal id in the tables, and every goal tagged, is a current
 *     CAREER_TRACKS or INTEREST_TOPICS id (the other session may rename one,
 *     and a silent mismatch would orphan tags), and GOAL_CATEGORIES covers
 *     exactly those ids;
 *   - every subject is a course prefix in public/illinois/index.json, every
 *     college a college code in public/illinois/programs.json;
 *   - every list entry has an alias row and every alias row is on its list.
 * Warnings, printed every run: list names with no directory id, alias ids
 * that are gone or renamed, national rows that match no group or several,
 * overrides for groups that are gone or renamed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { interestProfile, CAREER_TRACKS, INTEREST_TOPICS } = await import(pathToFileURL(join(ROOT, 'lib', 'planner', 'career-tracks.ts')).href);
const { ILLINOIS_SUBJECT_NAMES } = await import(pathToFileURL(join(ROOT, 'lib', 'planner', 'illinois-subjects.ts')).href);
const { majorNameOf } = await import(pathToFileURL(join(ROOT, 'lib', 'planner', 'clubs.ts')).href);

// CLUBS_DATA points a test run somewhere else, as in crawl.mjs; the pipeline never sets it.
const DATA = process.env.CLUBS_DATA ? resolve(process.env.CLUBS_DATA) : join(ROOT, 'data', 'clubs');
export const TABLES = {
  lists: join(HERE, 'lists.json'),
  aliases: join(HERE, 'aliases.json'),
  nationals: join(HERE, 'nationals.json'),
  overrides: join(HERE, 'overrides.json'),
};

// ---------------------------------------------------------------------------
// the vocabulary the tags must come from

export const TRACK_IDS = CAREER_TRACKS.map((t) => t.id);
export const TOPIC_IDS = INTEREST_TOPICS.map((t) => t.id);
export const GOAL_IDS = new Set([...TRACK_IDS, ...TOPIC_IDS]);
/**
 * The tracks a general pre-health club is for: every track but pre-law and
 * pre-veterinary. Health Professions Advising covers pre-vet too, but a
 * pre-health club (Alpha Epsilon Delta, the Pre-Health Psychology
 * Association) is about human medicine and its neighbours, so it is not "for
 * your goal" to a pre-vet student; the Pre-Vet Club and the clubs named for
 * veterinary work are. The prototype drew the same line (review, 2026-10-05).
 */
export const HEALTH_TRACKS = TRACK_IDS.filter((id) => id !== 'pre-law' && id !== 'pre-veterinary');
const label = (id) => CAREER_TRACKS.find((t) => t.id === id)?.name ?? INTEREST_TOPICS.find((t) => t.id === id)?.label ?? id;

/**
 * Which directory categories make a goal plausible. The reading pass (step 5)
 * keeps a goal it read in a club's text only when one of the club's own
 * categories is in this list (DESIGN 2.6, evidence 4). Every current goal id
 * has an entry, and nothing else does; the run stops if that drifts.
 */
const H = ['Health & Human Sciences', 'Health & Wellness', 'Life & Physical Sciences'];
const T = ['Technology, Engineering & Mathematics', 'Information & Data Sciences'];
const B = ['Business'];
export const GOAL_CATEGORIES = {
  'pre-medicine': H, 'pre-dental': H, 'pre-physician-assistant': H, 'pre-physical-therapy': H, 'pre-occupational-therapy': H, 'pre-pharmacy': H, 'pre-optometry': H,
  'pre-veterinary': ['Veterinary', 'Agricultural', 'Life & Physical Sciences'],
  'pre-law': ['Law'], law: ['Law'],
  'ai-ml': T, 'data-science': [...T, ...B], 'ux-hci': [...T, 'Media Arts'], 'software-engineering': T, cybersecurity: T, 'game-design': [...T, 'Media Arts'], robotics: T, hardware: T,
  'speech-language-pathology': H, 'athletic-training': [...H, 'Athletic & Recreation'],
  finance: B, 'investment-banking': B, markets: B, 'financial-planning': B, 'real-estate': B, 'commercial-banking': B, accounting: B,
  marketing: [...B, 'Media Arts'], consulting: B, 'supply-chain': B, entrepreneurship: [...B, ...T], 'sports-business': [...B, 'Athletic & Recreation'],
  'public-health': H, 'clinical-psychology': ['Social & Behavioral Sciences', 'Health & Human Sciences'], 'io-psychology-hr': ['Social & Behavioral Sciences', ...B], neuroscience: ['Life & Physical Sciences', 'Social & Behavioral Sciences'],
  'climate-environment': ['Environmental & Sustainability'], 'public-policy': ['Ideology & Politics', 'Advocacy & Activism'], politics: ['Ideology & Politics', 'Student Governance & Councils'],
  journalism: ['Media Arts'], 'film-media': ['Media Arts'], education: ['Education, Pedagogy & Instruction'], nursing: H, biotech: ['Life & Physical Sciences', 'Technology, Engineering & Mathematics'],
};

export const CLUB_KINDS = new Set(['pre-professional', 'professional-society', 'competition-team', 'professional-fraternity', 'honor', 'consulting-investing', 'academic', 'service', 'arts-performance', 'media', 'government-advocacy', 'cultural', 'faith', 'sport-recreation', 'social', 'greek-social', 'other']);
/** Kinds never recommended from career evidence (DESIGN 2.5, 3.3): they carry no goals, so a career word never reaches them. ALMA finds them when asked. */
export const ASKED_ONLY_KINDS = new Set(['social', 'greek-social', 'faith', 'cultural', 'sport-recreation']);
const AUDIENCES = new Set(['undergrad', 'both', 'check', 'grad', 'law', 'med', 'vet']);
const DROP_FOR = { grad: 'graduate', law: 'law', med: 'medical', vet: 'veterinary' };

// ---------------------------------------------------------------------------
// the directory's categories, by what they say about a club

/** Categories that name a field of study or work: a club with one is about something a career can be. */
const FIELD = new Set(['Agricultural', 'Business', 'Education, Pedagogy & Instruction', 'Environmental & Sustainability', 'Health & Human Sciences', 'Humanities', 'Information & Data Sciences', 'Law', 'Life & Physical Sciences', 'Media Arts', 'Social & Behavioral Sciences', 'Technology, Engineering & Mathematics', 'Veterinary']);
/** Categories about what a club does, not its field. */
const ACTIVITY = new Set(['Advocacy & Activism', 'Athletic & Recreation', 'Community Service & Philanthropy', 'Health & Wellness', 'Honorary', 'Ideology & Politics', 'Performance Arts', 'Student Governance & Councils']);
/** Categories that are never a reason to recommend a club (the prototype's NEVER_A_REASON). */
const NEVER = new Set(['Club Sports', 'Faith, Religion & Spirituality', 'Graduate or Professional Student Focused', 'Identity & Culture', 'International', 'Social & Leisure', 'Social Fraternities & Sororities', 'University Housing', 'Veteran & Military Connected']);
const KNOWN_CATEGORIES = new Set([...FIELD, ...ACTIVITY, ...NEVER]);

/** "~ Affiliation:" tags that place a club at a cultural or resource center: centered on a shared identity. */
const IDENTITY_AFFILIATIONS = /\b(AACC|BNAACC|La Casa|NAH|MENA|GSRC|WRC)\b/;
const COLLEGE_OF_AFFILIATION = { 'Grainger College of Engineering': 'engineering' };

// ---------------------------------------------------------------------------
// name rules

/**
 * Who a group is for, by its name (DESIGN 2.5). A name with "Pre-", "Undergraduate" or "Future" is for
 * undergraduates whatever else it says: "Future" as in "Future Attorneys", not "Medical Students for a
 * Sustainable Future" (a medical-school group the design's plain "Future" rule would have kept) or "the Future of".
 */
const FOR_UNDERGRADS = /\bpre[-\s]|\bundergrad(uate)?s?\b|\bfuture\s+(?!of\b)[a-z]/i;
const LAW_NAME = /\blaw students?\b|\bcollege of law\b|\blaw school\b|\billinois law\b|\blaw\b[^,]*\b(society|association|foundation|journal|guild)\b|\blegal (society|association)\b|\bstudent bar association\b/i;
const MED_NAME = /\bcollege of medicine\b|\bmedical students?\b|\bmedical (and dental )?association\b|\bcimed\b/i;
const VET_NAME = /\bveterinar(y|ian|ians)\b.*\b(association|society)\b|\bassociation of (zoo|equine)\b|\bdvm\b|\bavma\b|\bcollege of veterinary medicine\b|\bveterinary students?\b/i;
const GRAD_NAME = /\bgraduate\b|\bgrad students?\b|\bdoctoral\b|\bph\.?\s?d\.?\s+students?\b|\bmba\b|\bmasters?\s+(students?|program|association)\b|\bpostdoc/i;
/** The same question asked of the mission, in memory: only ever raises 'check'. */
const GRAD_MISSION = /\b(law students|jd students|students (at|of|in) the college of law|college of law students|medical students|carle illinois college of medicine students|veterinary students|dvm students|graduate students|doctoral students|phd students|ph\.d\. students)\b/i;

/** Names that center a shared identity or background (the prototype's list, plus a few). Never inferred about a student. */
const IDENTITY = /\b(black|african|afro|hispanic|latin[aoxe]s?|latinx|latine|chicano|asian|pacific islanders?|korean|chinese|taiwanese|indian|desi|south asian|arab|palestinian|middle eastern|mena|muslims?|jewish|jews|christians?|catholics?|hindus?|sikhs?|women|woman|female|girls?|lgbtq\+?|queer|gay|lesbian|transgender|minority|minorities|first[-\s]gen(eration)?|native|indigenous|veterans?|hellenic|greek american|filipino|vietnamese|bipoc|deaf|disabled)\b/i;

/** Pre-health clubs serve every health track but pre-vet (HEALTH_TRACKS), plus nursing. */
const PRE_HEALTH = /\bpre[-\s]?health\b|\bhealth\s+professions?\b|\bfuture\s+health\s+professionals?\b/i;
const PRE_PROFESSIONAL = /\bpre[-\s]?(med|dent|health|law|vet|pharm|opt|pa\b|pt\b|ot\b|physical|occupational|physician|anesthes|genetic|podiatr|nurs|chiro|audiol)/i;
const PROF_FRAT = /\bprofessional\b.*\b(fraternity|sorority)\b|\b(engineering|business|medical|music|law|legal|agricultural|pharmacy|chemistry|dental|journalism|education|nursing|architecture|accounting)\s+(fraternity|sorority)\b|\bpre-?law (undergraduate|honou?rs? society)\b/i;
const GREEK_NAME = /\b(fraternity|sorority)\b/i;
const HONOR = /\bhonou?rs?\s+society\b/i;
const ARTS = /\b(a ?cappella|chorus|choir|chorale|glee|orchestra|symphony|philharmonic|band|ensemble|dance(?! marathon)|dancers|theat(er|re)|improv|comedy|musical|opera|singers|step team|marching|percussion|brass|jazz|strings|quartet|drumline|ballet|bhangra|k-?pop)\b/i;
const COMPETITION = /\b(team|racing|motorsports|solar car|design build fly|concrete canoe|rocketry|robotics|supermileage|off-road|robobrawl|vex|decathlon|pullers|trial team|moot court|mock trial|model united nations|debate|hackathon|case competition|steel bridge)\b/i;
const CONSULT_INVEST = /\bconsult(ing|ants?|ancy)?\b|\binvest(ing|ment|ments|ors?)?\b|\bportfolio\b|\bequity research\b|\bprivate equity\b|\bventure capital\b|\bmergers?\b|\bacquisitions?\b|\btrading\b|^quant$|\bhedge funds?\b|\basset management\b|\bwealth management\b/i;
const MEDIA = /\b(radio|tv|television|newspaper|magazine|news|press|broadcast(ing)?|podcast|journal(?! club)|wpgu|daily illini|film|video|photo(graphy)?|yearbook|publication|zine)\b/i;
const FAITH_NAME = /\b(christ|christian|catholic|church|ministr(y|ies)|fellowship|bible|gospel|jewish|hillel|chabad|muslims?|islamic|hindu|sikh|buddhis[mt]|lutheran|baptist|orthodox|newman|interfaith|faith|intervarsity|navigators|chi alpha|latter-day|cru)\b/i;

/**
 * Department names a club name can carry ("Psychology" -> PSYC). Left out: one-word names that are
 * everyday words (the prototype's list), languages and regions, whose clubs are cultural ("Polish Club",
 * "Scandinavian Club"), and offices and programs that are not majors ("Graduate College", "MBA Program").
 */
const SUBJECT_NAME_SKIP = new Set([
  'BUS', 'ENG', 'EDUC', 'ART', 'LAW', 'GLBL', 'INFO', 'HIST', 'BIOL', 'ENGL', 'LAS', 'ACES', 'AHS', 'MDIA', 'FAA', 'CAS', 'GS', 'UNIV', 'DTX', 'SOCW', 'MACS',
  'SPAN', 'FR', 'GER', 'ITAL', 'PORT', 'LAT', 'GRK', 'KOR', 'JAPN', 'CHIN', 'RUSS', 'ARAB', 'HNDI', 'TURK', 'PLSH', 'SWAH', 'HEBR', 'PERS', 'THAI', 'VIET', 'TAGL', 'CZCH', 'UKR', 'BCS',
  'BASQ', 'BULG', 'CATL', 'GRKM', 'POL', 'QUEC', 'SCAN', 'SLAV', 'SNSK', 'YDSH', 'GMC', 'LCTL', 'EIL', 'ESL', 'REL',
  'CHP', 'CIC', 'GC', 'EXP', 'MBA', 'PSM', 'HUM',
]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const SUBJECT_NAMES = Object.entries(ILLINOIS_SUBJECT_NAMES)
  .filter(([code, name]) => !SUBJECT_NAME_SKIP.has(code) && !/--|,|&| and /i.test(name) && name.length >= 6)
  .map(([code, name]) => [code, new RegExp(`\\b${escapeRe(name)}\\b`, 'i')]);

// ---------------------------------------------------------------------------
// the tables

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The four hand-checked tables, read and validated. Throws on anything that would tag wrongly. */
export function loadTables(paths = TABLES, { subjects, colleges, majors } = {}) {
  const lists = readJson(paths.lists).lists;
  const aliases = readJson(paths.aliases).lists;
  const nationals = readJson(paths.nationals).rows;
  const overrides = readJson(paths.overrides).overrides;
  validateTables({ lists, aliases, nationals, overrides }, { subjects, colleges, majors });
  return { lists, aliases, nationals, overrides };
}

/** The goal-id guard and its siblings. Collects every problem, then throws once. */
export function validateTables({ lists, aliases, nationals, overrides }, { subjects, colleges, majors } = {}) {
  const problems = [];
  const goal = (id, where) => {
    if (id === '@health') return;
    if (!GOAL_IDS.has(id)) problems.push(`${where}: "${id}" is not a current CAREER_TRACKS or INTEREST_TOPICS id`);
  };
  const subject = (code, where) => { if (subjects && !subjects.has(code)) problems.push(`${where}: subject "${code}" is not a course prefix in index.json`); };
  const college = (code, where) => { if (colleges && !colleges.has(code)) problems.push(`${where}: college "${code}" is not a programs.json college`); };

  const ids = new Set();
  for (const list of lists) {
    if (!list.id || ids.has(list.id)) problems.push(`lists.json: missing or repeated id "${list.id}"`);
    ids.add(list.id);
    if (!list.url || !list.read || !list.title || !list.short) problems.push(`lists.json ${list.id}: needs title, short, url and read`);
    const as = [list.goal, list.college, list.subject].filter(Boolean);
    if (as.length !== 1) problems.push(`lists.json ${list.id}: counts as exactly one of goal, college, subject (has ${as.length})`);
    if (list.goal) goal(list.goal, `lists.json ${list.id}`);
    if (list.college) college(list.college, `lists.json ${list.id}`);
    if (list.subject) subject(list.subject, `lists.json ${list.id}`);
    if (list.count !== list.entries.length) problems.push(`lists.json ${list.id}: count ${list.count} but ${list.entries.length} entries`);
    const rows = aliases[list.id];
    if (!rows) { problems.push(`aliases.json: no rows for list ${list.id}`); continue; }
    for (const name of list.entries) {
      const row = rows[name];
      if (!row) problems.push(`aliases.json ${list.id}: no row for "${name}"`);
      else if (row.id === null && !row.note) problems.push(`aliases.json ${list.id}: "${name}" is null without a note`);
      else if (row.id !== null && !/^\d+$/.test(String(row.id))) problems.push(`aliases.json ${list.id}: "${name}" has a malformed id`);
    }
    for (const name of Object.keys(rows)) if (!list.entries.includes(name)) problems.push(`aliases.json ${list.id}: "${name}" is not on the list`);
  }
  for (const id of Object.keys(aliases)) if (!ids.has(id)) problems.push(`aliases.json: list "${id}" is not in lists.json`);

  for (const row of nationals) {
    const where = `nationals.json ${row.national}`;
    try { new RegExp(row.match, 'i'); } catch { problems.push(`${where}: match is not a regex`); }
    for (const g of row.goals ?? []) goal(g, where);
    for (const s of row.subjects ?? []) subject(s, where);
    if (row.college) college(row.college, where);
    if (row.kind && !CLUB_KINDS.has(row.kind)) problems.push(`${where}: unknown kind "${row.kind}"`);
  }

  const FIELDS = new Set(['name', 'audience', 'kind', 'identity', 'goalsAdd', 'goalsRemove', 'subjectsAdd', 'majors', 'does', 'hide', 'starter', 'note']);
  for (const [id, o] of Object.entries(overrides)) {
    const where = `overrides.json ${id}`;
    if (!/^\d+$/.test(id)) problems.push(`${where}: the key must be a directory id`);
    for (const k of Object.keys(o)) if (!FIELDS.has(k)) problems.push(`${where}: unknown field "${k}"`);
    if (!o.note) problems.push(`${where}: every override says why in "note"`);
    if (o.audience && !AUDIENCES.has(o.audience)) problems.push(`${where}: unknown audience "${o.audience}"`);
    if (o.kind && !CLUB_KINDS.has(o.kind)) problems.push(`${where}: unknown kind "${o.kind}"`);
    for (const g of [...(o.goalsAdd ?? []), ...(o.goalsRemove ?? [])]) goal(g, where);
    for (const s of o.subjectsAdd ?? []) subject(s, where);
    if ('identity' in o && typeof o.identity !== 'boolean') problems.push(`${where}: identity is true or false`);
    if ('starter' in o && ![true, false, 'undeclared'].includes(o.starter)) problems.push(`${where}: starter is true, false or 'undeclared'`);
    // majors: the program names (programs.json, before the comma) a club on a shared subject is for. It needs a subject.
    if ('majors' in o && (!Array.isArray(o.majors) || o.majors.length === 0 || !o.majors.every((m) => typeof m === 'string' && /^[A-Z][A-Za-z&,' -]{2,60}$/.test(m)))) problems.push(`${where}: majors is a list of major names`);
    if ('majors' in o && !(o.subjectsAdd ?? []).length) problems.push(`${where}: majors scopes a subject, so the row needs subjectsAdd`);
    if (majors && Array.isArray(o.majors)) for (const m of o.majors) if (!majors.has(m)) problems.push(`${where}: major "${m}" is not a program name in programs.json (the name before ":" and the degree)`);
    if ('does' in o && (typeof o.does !== 'string' || !o.does.trim())) problems.push(`${where}: does is our own one-line description`);
  }

  const mapped = Object.keys(GOAL_CATEGORIES);
  for (const id of mapped) if (!GOAL_IDS.has(id)) problems.push(`tag.mjs GOAL_CATEGORIES: "${id}" is not a current goal id`);
  for (const id of GOAL_IDS) if (!(id in GOAL_CATEGORIES)) problems.push(`tag.mjs GOAL_CATEGORIES: no entry for goal "${id}"`);
  for (const [id, cats] of Object.entries(GOAL_CATEGORIES)) for (const c of cats) if (!KNOWN_CATEGORIES.has(c)) problems.push(`tag.mjs GOAL_CATEGORIES ${id}: unknown category "${c}"`);

  if (problems.length) throw new Error(`the tables do not hold:\n  ${problems.join('\n  ')}`);
}

// ---------------------------------------------------------------------------
// one group

/**
 * Political or campaign consulting is politics, not management consulting: the reader hears both in
 * "Illinois Political Consulting", and the spot check found it first for a management-consulting student.
 */
const POLITICAL_CONSULTING = /\b(political|politics|campaigns?|election|electoral)\s+consult(ing|ants?|ancy)?\b/i;

/** Goal ids a club's name names, through the planner's own reader, plus the club-name aliases. */
export function nameGoals(name) {
  const p = interestProfile(name);
  let ids = [...p.tracks.map((t) => t.id), ...p.topics.map((t) => t.id)];
  if (PRE_HEALTH.test(name)) ids.push(...HEALTH_TRACKS, 'nursing');
  if (POLITICAL_CONSULTING.test(name)) ids = [...ids.filter((id) => id !== 'consulting'), 'politics'];
  return [...new Set(ids)];
}

/** Who a group is for: { audience, from }. Overrides are applied by the caller. */
export function audienceOf(group, mission) {
  const name = group.name;
  if (!FOR_UNDERGRADS.test(name)) {
    if (LAW_NAME.test(name)) return { audience: 'law', from: 'name' };
    // before medicine: "Veterinary Medical Association" is a veterinary-school group
    if (VET_NAME.test(name)) return { audience: 'vet', from: 'name' };
    if (MED_NAME.test(name)) return { audience: 'med', from: 'name' };
    if (GRAD_NAME.test(name)) return { audience: 'grad', from: 'name' };
    if (group.categories.includes('Graduate or Professional Student Focused')) return { audience: 'check', from: 'category' };
    if (mission && GRAD_MISSION.test(mission) && !/\bundergrad/i.test(mission)) return { audience: 'check', from: 'text' };
  }
  return { audience: 'undergrad', from: 'default' };
}

/**
 * What kind of club, from the hand-checked tables first, then its name, then
 * its categories. The reading pass refines it later; without it (DESIGN 2.7,
 * decision 3) this is the kind that ships.
 */
export function kindOf(group, { national, override, onList = false } = {}) {
  if (override?.kind) return { kind: override.kind, from: 'override' };
  if (national?.kind) return { kind: national.kind, from: 'national' };
  const name = group.name;
  const cats = group.categories;
  const field = cats.filter((c) => FIELD.has(c));
  const activity = cats.filter((c) => ACTIVITY.has(c));
  const workish = [...field, ...activity.filter((c) => !['Athletic & Recreation', 'Performance Arts', 'Health & Wellness', 'Honorary'].includes(c))];
  // "OPERA - Organization for Prototyping ..." is an engineering club: an arts word counts only beside arts categories
  const artsField = field.every((c) => ['Media Arts', 'Humanities', 'Education, Pedagogy & Instruction'].includes(c));

  if ((cats.includes('Social Fraternities & Sororities') || GREEK_NAME.test(name)) && !PROF_FRAT.test(name) && !national) return { kind: 'greek-social', from: 'name' };
  if (HONOR.test(name)) return { kind: 'honor', from: 'name' };
  if (PROF_FRAT.test(name)) return { kind: 'professional-fraternity', from: 'name' };
  if (ARTS.test(name) && (cats.includes('Performance Arts') || artsField)) return { kind: 'arts-performance', from: 'name' };
  if (COMPETITION.test(name) && workish.length > 0) return { kind: 'competition-team', from: 'name' };
  if (national) return { kind: 'professional-society', from: 'national' };
  if (PRE_PROFESSIONAL.test(name) || PRE_HEALTH.test(name)) return { kind: 'pre-professional', from: 'name' };
  if (CONSULT_INVEST.test(name) && cats.some((c) => c === 'Business' || c === 'Information & Data Sciences' || c === 'Technology, Engineering & Mathematics')) return { kind: 'consulting-investing', from: 'name' };
  if (MEDIA.test(name) && cats.includes('Media Arts')) return { kind: 'media', from: 'name' };
  if (cats.length === 0) return { kind: 'other', from: 'category' };
  if (cats.includes('Faith, Religion & Spirituality') && field.length === 0) return { kind: 'faith', from: 'category' };
  if (FAITH_NAME.test(name) && field.length === 0) return { kind: 'faith', from: 'name' };
  // A club named for a department ("Sociology Student Organization") is about that field, whatever it ticked.
  if (nameSubjects(name).length > 0 && (field.length === 0 || (field.length === 1 && field[0] === 'Media Arts'))) return { kind: 'academic', from: 'name' };

  if (field.length === 0) {
    // No field of study: what the club does decides. Identity & Culture is the defining tag of a
    // cultural group, so it counts twice; a name that centers an identity counts once more.
    // Ties go to the first in this order, so a service club that also ticked International stays a service club.
    const n = (...xs) => xs.filter((c) => cats.includes(c)).length;
    const votes = [
      ['service', n('Community Service & Philanthropy')],
      ['government-advocacy', n('Advocacy & Activism', 'Ideology & Politics', 'Student Governance & Councils')],
      ['cultural', 2 * n('Identity & Culture') + n('International') + (IDENTITY.test(name) ? 1 : 0)],
      ['sport-recreation', n('Club Sports', 'Athletic & Recreation')],
      ['arts-performance', n('Performance Arts')],
      ['social', n('Social & Leisure', 'University Housing')],
    ];
    let [kind, best] = ['other', 0];
    for (const [k, v] of votes) if (v > best) [kind, best] = [k, v];
    // A university office listed it for a college, a subject or a goal: it is not only a social or cultural group.
    if (onList && ['cultural', 'social', 'sport-recreation'].includes(kind)) return { kind: 'academic', from: 'list' };
    return { kind, from: 'category' };
  }
  if (field.length === 1 && field[0] === 'Media Arts') return { kind: 'media', from: 'category' };
  return { kind: 'academic', from: 'category' };
}

/** Course prefixes a club's name names ("Society for Women in Physics" -> PHYS). */
export const nameSubjects = (name) => SUBJECT_NAMES.filter(([, re]) => re.test(name)).map(([code]) => code);

/**
 * Tag one group. ctx = { lists, listIdx (indexes into lists), nationalRow, override, mission, subjects }.
 * `mission` is read for the audience doubt only and never returned; `subjects`
 * (a Set of course prefixes), when given, keeps name-derived subjects to real ones.
 */
export function tagGroup(group, ctx) {
  const { lists, nationalRow: national, override } = ctx;
  const listIdx = ctx.listIdx ?? [];
  const row = {
    id: group.id,
    name: group.name,
    url: group.url,
    ...(group.profile ? { profile: group.profile } : {}),
    ...(group.website ? { website: group.website } : {}),
    // The group type (Orange, Blue, an office type) stays behind: it is the registration cycle, not quality, and is never shown.
    categories: group.categories,
    ...(group.affiliations?.length ? { affiliations: group.affiliations } : {}),
  };
  if (group.office) {
    return { ...row, office: true, kind: null, dropped: 'office', audience: null, identity: false, goals: [], lists: listIdx, firstSeen: group.firstSeen, lastSeen: group.lastSeen };
  }

  // who it is for
  let { audience, from: audienceFrom } = audienceOf(group, ctx.mission);
  if (override?.audience) { audience = override.audience; audienceFrom = 'override'; }

  // what kind of club
  const { kind, from: kindFrom } = kindOf(group, { national, override, onList: listIdx.length > 0 });

  // goals: list, national, name, override; one entry per id, strongest source first
  const goals = new Map();
  const add = (id, from, list) => { if (!goals.has(id)) goals.set(id, list === undefined ? { id, from } : { id, from, list }); };
  for (const i of listIdx) if (lists[i].goal) add(lists[i].goal, 'list', i);
  for (const g of national?.goals ?? []) for (const id of g === '@health' ? HEALTH_TRACKS : [g]) add(id, 'national');
  for (const id of nameGoals(group.name)) add(id, 'name');
  for (const id of override?.goalsAdd ?? []) add(id, 'override');
  for (const id of override?.goalsRemove ?? []) goals.delete(id);
  // Asked-only kinds carry no career goals at all: the matcher would never use them,
  // and a stray one (an anime club tagged film-media) would only confuse the check.
  const heldBack = ASKED_ONLY_KINDS.has(kind) ? [...goals.keys()] : [];
  if (heldBack.length) goals.clear();

  const subjects = new Set([...(national?.subjects ?? []), ...nameSubjects(group.name).filter((code) => !ctx.subjects || ctx.subjects.has(code)), ...(override?.subjectsAdd ?? [])]);
  const colleges = new Set();
  for (const a of group.affiliations ?? []) if (COLLEGE_OF_AFFILIATION[a]) colleges.add(COLLEGE_OF_AFFILIATION[a]);
  if (national?.college) colleges.add(national.college);
  for (const i of listIdx) if (lists[i].college) colleges.add(lists[i].college);

  const broad = group.categories.length >= 5;
  const identity = typeof override?.identity === 'boolean'
    ? override.identity
    : IDENTITY.test(group.name) || (!broad && group.categories.includes('Identity & Culture')) || (group.affiliations ?? []).some((a) => IDENTITY_AFFILIATIONS.test(a));

  let dropped = DROP_FOR[audience] ?? null;
  if (override?.hide) dropped = 'hidden';
  // true, or 'undeclared': a starter for a student with no major yet only (the Exploratory Students Association).
  const starter = override?.starter === true || override?.starter === 'undeclared' ? override.starter : null;

  return {
    ...row,
    kind,
    kindFrom,
    identity,
    ...(national ? { national: national.national } : {}),
    audience,
    audienceFrom,
    ...(dropped ? { dropped } : {}),
    joining: group.membershipClosed ? 'closed' : 'open',
    ...(group.restriction ? { restricted: true } : {}),
    goals: [...goals.values()],
    ...(heldBack.length ? { goalsHeldBack: heldBack } : {}),
    subjects: [...subjects],
    ...(override?.majors?.length ? { majors: [...override.majors] } : {}),
    colleges: [...colleges],
    lists: listIdx,
    ...(group.missionWords < 15 ? { thin: true } : {}),
    ...(starter ? { starter } : {}),
    missionWords: group.missionWords,
    hash: group.hash,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
  };
}

// ---------------------------------------------------------------------------
// the whole directory

/**
 * Tag every group. Returns { tagged, warnings, report }. Throws when a tag
 * would leave the planner's vocabulary.
 *   directory: data/clubs/directory.json, parsed
 *   texts: Map id -> mission (optional; only the audience doubt reads it)
 *   subjects: Set of course prefixes (optional; keeps name-derived subjects real)
 */
export function tagAll({ directory, texts = new Map(), tables, subjects }) {
  const { lists, aliases, nationals, overrides } = tables;
  const groups = directory.groups;
  const byId = new Map(groups.map((g) => [g.id, g]));
  const warnings = [];

  // curated lists -> ids
  const listsOf = new Map();
  const listReport = [];
  lists.forEach((list, i) => {
    const rows = aliases[list.id];
    /** @type {{ id: string, entries: number, matched: number, unmatched: string[], gone: string[], renamed: string[] }} */
    const r = { id: list.id, entries: list.entries.length, matched: 0, unmatched: [], gone: [], renamed: [] };
    for (const name of list.entries) {
      const a = rows[name];
      if (!a?.id) { r.unmatched.push(name); continue; }
      const g = byId.get(String(a.id));
      if (!g) { r.gone.push(`${name} -> ${String(a.id)}`); continue; }
      if (a.name && a.name !== g.name) r.renamed.push(`${String(a.id)}: "${String(a.name)}" is now "${String(g.name)}"`);
      r.matched += 1;
      if (!listsOf.has(g.id)) listsOf.set(g.id, []);
      if (!listsOf.get(g.id).includes(i)) listsOf.get(g.id).push(i);
    }
    for (const x of r.gone) warnings.push(`aliases.json ${list.id}: ${x} is not in the directory any more`);
    for (const x of r.renamed) warnings.push(`aliases.json ${list.id}: renamed, re-check: ${x}`);
    listReport.push(r);
  });

  // national rows -> ids
  const nationalOf = new Map();
  /** @type {{ rows: number, matched: number, none: string[], several: string[], moved: string[] }} */
  const nationalReport = { rows: nationals.length, matched: 0, none: [], several: [], moved: [] };
  const clubs = groups.filter((g) => !g.office);
  for (const row of nationals) {
    const re = new RegExp(row.match, 'i');
    const hits = clubs.filter((g) => re.test(g.name));
    if (hits.length === 0) { nationalReport.none.push(row.national); continue; }
    let hit = hits[0];
    if (hits.length > 1) {
      // Two groups under one row would double-tag; keep only the one that was checked by hand.
      hit = hits.find((g) => g.id === row.checked?.id);
      nationalReport.several.push(`${String(row.national)}: ${hits.map((g) => `${String(g.id)} ${String(g.name)}`).join(' | ')}${hit ? `; kept ${String(hit.id)}` : '; none kept'}`);
      if (!hit) continue;
    } else if (row.checked?.id && hit.id !== row.checked.id) nationalReport.moved.push(`${String(row.national)}: checked ${String(row.checked.id)}, now matches ${String(hit.id)} ${String(hit.name)}`);
    if (nationalOf.has(hit.id)) { nationalReport.several.push(`${String(hit.name)} matches ${String(nationalOf.get(hit.id).national)} and ${String(row.national)}; kept the first`); continue; }
    nationalOf.set(hit.id, row);
    nationalReport.matched += 1;
  }
  for (const n of nationalReport.none) warnings.push(`nationals.json ${n}: matches no group in this directory`);
  for (const s of nationalReport.several) warnings.push(`nationals.json: ${s}`);
  for (const m of nationalReport.moved) warnings.push(`nationals.json: re-check ${m}`);

  // overrides
  /** @type {{ rows: number, applied: number, gone: string[], renamed: string[] }} */
  const overrideReport = { rows: Object.keys(overrides).length, applied: 0, gone: [], renamed: [] };
  for (const [id, o] of Object.entries(overrides)) {
    const g = byId.get(id);
    if (!g) { overrideReport.gone.push(`${id} ${String(o.name)}`); continue; }
    if (o.name && o.name !== g.name) overrideReport.renamed.push(`${id}: "${String(o.name)}" is now "${String(g.name)}"`);
    overrideReport.applied += 1;
  }
  for (const x of overrideReport.gone) warnings.push(`overrides.json: ${x} is not in the directory any more`);
  for (const x of overrideReport.renamed) warnings.push(`overrides.json: renamed, re-check: ${x}`);

  const tagged = groups.map((g) => tagGroup(g, { lists, listIdx: listsOf.get(g.id) ?? [], nationalRow: nationalOf.get(g.id), override: overrides[g.id], mission: texts.get(g.id), subjects }));

  // the guard, on the output this time
  const stray = tagged.flatMap((c) => c.goals.filter((x) => !GOAL_IDS.has(x.id)).map((x) => `${c.id} ${c.name}: ${x.id}`));
  if (stray.length) throw new Error(`tags outside the planner's goal ids:\n  ${stray.join('\n  ')}`);

  // a category the directory added since 2026-10-04 has no place in the kind rules yet
  for (const cat of directory.vocabulary?.topical ?? []) if (!KNOWN_CATEGORIES.has(cat)) warnings.push(`the directory has a category tag.mjs does not know: "${cat}"; add it to FIELD, ACTIVITY or NEVER`);

  return { tagged, warnings, report: { lists: listReport, nationals: nationalReport, overrides: overrideReport } };
}

/** Counts for the report and for tagged.json. "Kept" means not an office and not dropped. */
export function countTags(tagged) {
  const kept = tagged.filter((c) => !c.dropped);
  const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const byGoal = {};
  for (const id of GOAL_IDS) {
    const all = kept.filter((c) => c.goals.some((g) => g.id === id));
    byGoal[id] = {
      clubs: all.length,
      joinable: all.filter((c) => c.audience !== 'check').length,
      bySource: tally(all.map((c) => c.goals.find((g) => g.id === id).from)),
    };
  }
  const dropped = { office: 0, graduate: 0, law: 0, medical: 0, veterinary: 0, hidden: 0 };
  for (const c of tagged) if (c.dropped) dropped[c.dropped] += 1;
  return {
    groups: tagged.length,
    kept: kept.length,
    dropped,
    byKind: tally(kept.map((c) => c.kind)),
    kindFrom: tally(kept.map((c) => c.kindFrom)),
    audience: tally(tagged.filter((c) => !c.office).map((c) => c.audience)),
    audienceFrom: tally(tagged.filter((c) => !c.office).map((c) => `${c.audience}:${c.audienceFrom}`)),
    identity: kept.filter((c) => c.identity).length,
    starter: kept.filter((c) => c.starter).length,
    national: kept.filter((c) => c.national).length,
    withGoals: kept.filter((c) => c.goals.length).length,
    goalsHeldBack: kept.filter((c) => c.goalsHeldBack).length,
    withSubjects: kept.filter((c) => c.subjects.length).length,
    withColleges: kept.filter((c) => c.colleges.length).length,
    onLists: kept.filter((c) => c.lists.length).length,
    thin: kept.filter((c) => c.thin).length,
    closed: kept.filter((c) => c.joining === 'closed').length,
    byGoal,
  };
}

// ---------------------------------------------------------------------------

function readTexts(file) {
  const texts = new Map();
  if (!existsSync(file)) return texts;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line);
    texts.set(t.id, [t.mission, t.benefits].filter(Boolean).join(' '));
  }
  return texts;
}

function vocabularyOnDisk() {
  const index = readJson(join(ROOT, 'public', 'illinois', 'index.json'));
  const subjects = new Set(index.map((r) => String(r.code).split(' ')[0]));
  const programs = readJson(join(ROOT, 'public', 'illinois', 'programs.json'));
  const colleges = new Set(programs.map((p) => p.college).filter(Boolean));
  // The major names clubs.ts reads from a program (majorNameOf), for overrides.json `majors`.
  const majors = new Set(programs.map((p) => majorNameOf(p.name)).filter(Boolean));
  return { subjects, colleges, majors };
}

/** A list as the app sees it (DESIGN 2.9 ClubList): what it is, where it is, and what it counts as. */
const clubList = (l) => ({
  id: l.id, title: l.title, short: l.short, url: l.url, read: l.read,
  ...(l.goal ? { goal: l.goal, weight: l.weight ?? 1 } : {}),
  ...(l.college ? { college: l.college } : {}),
  ...(l.subject ? { subject: l.subject } : {}),
});

const writeAtomic = (file, text) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};

function main() {
  const quiet = process.argv.includes('--quiet');
  const dirFile = join(DATA, 'directory.json');
  if (!existsSync(dirFile)) {
    console.error('no data/clubs/directory.json; run node scripts/illinois/clubs/crawl.mjs (or --offline) first');
    process.exit(1);
  }
  const directory = readJson(dirFile);
  const texts = readTexts(join(DATA, 'texts.jsonl'));
  const vocab = vocabularyOnDisk();
  let tables;
  let result;
  try {
    tables = loadTables(TABLES, vocab);
    result = tagAll({ directory, texts, tables, subjects: vocab.subjects });
  } catch (e) {
    console.error(`STOPPED, nothing written: ${e.message}`);
    process.exit(1);
  }
  const { tagged, warnings, report } = result;
  const counts = countTags(tagged);
  const out = {
    version: 1,
    taggedAt: new Date().toISOString(),
    checked: directory.checked,
    source: directory.source,
    goalIds: { tracks: TRACK_IDS, topics: TOPIC_IDS },
    lists: tables.lists.map(clubList),
    note: 'Tags only, in our own words and ids: no club\'s mission or benefits text, no contact names. Office and graduate/law/medical/veterinary groups are kept with `dropped` set so build.mjs can count them; they never ship.',
    counts,
    clubs: tagged,
  };
  writeAtomic(join(DATA, 'tagged.json'), `${JSON.stringify(out, null, 1)}\n`);
  printReport({ counts, report, warnings, texts, quiet, tagged, lists: tables.lists });
}

function printReport({ counts: c, report, warnings, texts, quiet, tagged, lists }) {
  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`wrote data/clubs/tagged.json: ${c.groups} groups, ${c.kept} kept (${texts.size ? `mission text read in memory for the audience doubt, ${texts.size} rows` : 'no texts.jsonl: audience from names and categories only'})`);
  console.log(`  dropped: ${line(c.dropped)}`);
  console.log(`  kinds (kept): ${line(c.byKind)}`);
  console.log(`  kind decided by: ${line(c.kindFrom)}`);
  console.log(`  audience (all clubs, offices aside): ${line(c.audience)}`);
  console.log(`  audience decided by: ${line(c.audienceFrom)}`);
  console.log(`  identity ${c.identity}; national chapters ${c.national}; starters ${c.starter}; on a list ${c.onLists}; with goals ${c.withGoals}; goals held back on asked-only kinds ${c.goalsHeldBack}; with subjects ${c.withSubjects}; with colleges ${c.withColleges}; thin ${c.thin}; closed ${c.closed}`);
  console.log('  curated lists:');
  for (const r of report.lists) {
    const keptOn = tagged.filter((t) => !t.dropped && t.lists.includes(lists.findIndex((l) => l.id === r.id))).length;
    console.log(`    ${r.id}: ${r.entries} names, ${r.matched} matched to a directory id (${keptOn} kept after drops), ${r.unmatched.length} with none: ${r.unmatched.join('; ') || '-'}`);
  }
  const n = report.nationals;
  console.log(`  nationals: ${n.rows} rows, ${n.matched} matched one group each${n.none.length ? `; none: ${n.none.join(', ')}` : ''}`);
  console.log(`  overrides: ${report.overrides.rows} rows, ${report.overrides.applied} applied`);
  const held = tagged.filter((t) => t.goalsHeldBack && !t.dropped);
  if (held.length) console.log(`  goals held back on asked-only kinds (${held.length}): ${held.map((t) => `${t.name} [${t.kind}: ${t.goalsHeldBack.join(', ')}]`).join('; ')}`);
  if (!quiet) {
    console.log('  clubs per goal id (kept; joinable = audience not "check"; by strongest source):');
    for (const id of GOAL_IDS) {
      const g = c.byGoal[id];
      console.log(`    ${id.padEnd(26)} ${String(g.clubs).padStart(3)}  joinable ${String(g.joinable).padStart(3)}  ${line(g.bySource) || '-'}  (${label(id)})`);
    }
  }
  for (const w of warnings) console.warn(`  warning: ${w}`);
}

if (isMain) main();
