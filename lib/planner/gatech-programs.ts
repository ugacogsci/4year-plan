/**
 * Georgia Tech's degree menu: from "the degree a student names" to the one
 * program record the planner builds from.
 *
 * Georgia Tech has 42 bachelor's degrees but 210 requirement pages. Twenty
 * degrees have one page. The other 22 are menu pages with no table of their
 * own: the student picks a concentration or option (Business Administration's
 * Accounting, Mechanical Engineering's Automotive, where "General" is the path
 * without one) or, for the thread degrees (Computer Science, Computer and
 * Electrical Engineering, Literature, Media, and Communication), two threads,
 * and every pair of threads is its own full page. A student never thinks
 * "Cybersecurity-Privacy-Theory-Computer-Science-BS"; they think "CS, with
 * Theory and Cybersecurity". This module turns the second into the first.
 *
 * Inputs are the build's own files, so the ids are the ones
 * public/gatech/program/<id>.json is written under:
 *   - programs.json, the summary list (every record, menu parents included);
 *   - program/<parent>.json for each menu parent, the raw crawled record,
 *     which carries `options` and, for a thread degree, `threadList` (each
 *     thread with the pair pages it appears on) and `optionRule`.
 * Structure comes from the data, never from a list of degree names here, so
 * a degree that gains options in a later crawl is grouped without a change.
 * When a parent's file is missing, its pages are still offered, as a plain
 * one-of list named from the summaries.
 *
 * Pure: no fetch, no React. Imported by components/planner/program-picker.tsx
 * and components/planner/onboarding.tsx.
 */

/** The fields of a programs.json row (illinois-load.ts IllinoisProgramSummary) this module reads. */
export interface MenuSummary {
  id: string;
  name: string;
  degree?: string | null;
  concentration?: string | null;
  totalCredits?: number | null;
}

/** One choice of a degree: a program record a plan can be built from. */
export interface MenuChoice {
  /** The record id, as public/gatech/program/<id>.json is named. This is what programIds stores. */
  id: string;
  /** 'Accounting', 'General (no concentration)', or a thread pair 'Theory + Media'. */
  name: string;
  totalCredits: number | null;
  /** For a thread degree: the two threads this page combines, in catalog order. */
  threads?: [string, string];
}

export type MenuDegreeKind = 'single' | 'one-of' | 'two-threads';

export interface MenuThread {
  name: string;
  /** The pair pages this thread appears on (choice ids). */
  pages: string[];
}

export interface MenuDegree {
  /** The degree page: the record itself for a 'single', the menu parent otherwise. */
  id: string;
  /** 'Computer Science, BS'. */
  name: string;
  /** Catalog degree code, for program-length defaults. */
  degree: string;
  kind: MenuDegreeKind;
  /** What the student picks, worded for "Choose ...": 'a concentration', 'an option', 'two threads'. */
  pickLabel: string;
  /** The choice can be skipped: "General" is the path without one (Mechanical Engineering, Mathematics). */
  optional: boolean;
  /** Plain-language help under the choice. */
  hint: string;
  choices: MenuChoice[];
  /** Thread degrees only: every thread in catalog order. Empty otherwise. */
  threads: MenuThread[];
}

export interface ProgramMenu {
  degrees: MenuDegree[];
}

/** The program ids build-index writes a file for (scripts/illinois/build-index.mjs SAFE_ID). */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/;

const GENERAL = /^general$/i;

/** "Bachelor of Science in Computer Science" -> "Computer Science, BS". */
export function degreeTitle(raw: string, degree = 'BS'): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  const m = name.match(/^Bachelor of Science in (.+)$/i);
  return m ? `${m[1].trim()}, ${degree}` : name;
}

/**
 * A choice's own name, without the degree it belongs to.
 * "Bachelor of Science in Mathematics with a concentration in Pure Mathematics" -> "Pure Mathematics"
 * (the catalog's typo "concentration is" included).
 */
export function choiceTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Bachelor of Science in .+? with an? (?:concentration|option) (?:in|is) /i, '')
    .trim();
}

/** The degree id a page belongs to by its id alone: 'computing/computer-science-bs/<pair>' -> 'computing/computer-science-bs'. */
function idParent(id: string): string | null {
  const parts = id.split('/');
  return parts.length >= 3 ? parts.slice(0, 2).join('/') : null;
}

/** A child page's degree name when the parent's own row is missing: the title before " - " or " (". */
function nameFromChild(name: string): string {
  return name.replace(/\s+-\s+.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

interface ParentRecord {
  id: string;
  name: string | null;
  options: Array<{ id: string; name: string }>;
  optionRule: string[];
  threadList: MenuThread[];
}

/** A program/<parent>.json body, read defensively: anything malformed is dropped, never thrown on. */
function readParent(value: unknown): ParentRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string') return null;
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((o) => {
        const row = o as Record<string, unknown> | null;
        return row && typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name }] : [];
      })
    : [];
  const threadList = Array.isArray(raw.threadList)
    ? raw.threadList.flatMap((t) => {
        const row = t as Record<string, unknown> | null;
        if (!row || typeof row.name !== 'string' || !Array.isArray(row.pages)) return [];
        return [{ name: row.name, pages: row.pages.filter((p): p is string => typeof p === 'string') }];
      })
    : [];
  const optionRule = Array.isArray(raw.optionRule) ? raw.optionRule.filter((s): s is string => typeof s === 'string') : [];
  return { id: raw.id, name: typeof raw.name === 'string' ? raw.name : null, options, optionRule, threadList };
}

/**
 * The menu parents whose files carry the threads and option names: every
 * degree id that has a plannable page under it. Fetch program/<id>.json for
 * each and hand the bodies to buildProgramMenu.
 */
export function menuParentIds(plannable: ReadonlyArray<MenuSummary>): string[] {
  const ids = new Set<string>();
  for (const row of plannable) {
    const parent = idParent(row.id);
    if (parent && SAFE_ID.test(parent)) ids.add(parent);
  }
  return [...ids].sort();
}

function pickLabelOf(choices: MenuChoice[]): string {
  const named = choices.filter((c) => !GENERAL.test(c.name.replace(/\s*\(.*\)$/, '')));
  const options = named.filter((c) => /\boption$/i.test(c.name)).length;
  const concentrations = named.length - options;
  if (options > 0 && concentrations > 0) return 'a concentration or option';
  return options > 0 ? 'an option' : 'a concentration';
}

/**
 * The degree menu.
 *
 * `summaries` is every programs.json row (parents included, for their names),
 * `plannable` the rows a plan can be built from (illinois-source.tsx
 * openProgram), and `parents` the program/<parent>.json bodies (null for one
 * that did not load).
 */
export function buildProgramMenu(input: {
  summaries: ReadonlyArray<MenuSummary>;
  plannable: ReadonlyArray<MenuSummary>;
  parents?: ReadonlyArray<unknown>;
}): ProgramMenu {
  const summaryById = new Map(input.summaries.map((row) => [row.id, row]));
  const parentById = new Map<string, ParentRecord>();
  for (const body of input.parents ?? []) {
    const record = readParent(body);
    if (record) parentById.set(record.id, record);
  }
  // Which degree a page belongs to: the parent's own option list first, the id second.
  const ownerOf = new Map<string, string>();
  for (const parent of parentById.values()) {
    for (const option of parent.options) ownerOf.set(option.id, parent.id);
  }
  const plannableIds = new Set(input.plannable.map((row) => row.id));
  const groups = new Map<string, MenuSummary[]>();
  const singles: MenuSummary[] = [];
  for (const row of input.plannable) {
    const owner = ownerOf.get(row.id) ?? idParent(row.id);
    if (!owner) {
      singles.push(row);
      continue;
    }
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner)!.push(row);
  }

  const degrees: MenuDegree[] = [];
  for (const row of singles) {
    // A degree page with a table of its own and option pages under it: its own page is the "General" path.
    if (groups.has(row.id)) continue;
    const code = row.degree || 'BS';
    degrees.push({
      id: row.id,
      name: degreeTitle(row.name, code),
      degree: code,
      kind: 'single',
      pickLabel: '',
      optional: false,
      hint: '',
      choices: [{ id: row.id, name: degreeTitle(row.name, code), totalCredits: row.totalCredits ?? null }],
      threads: [],
    });
  }

  for (const [owner, rows] of groups) {
    const parent = parentById.get(owner) ?? null;
    const parentRow = summaryById.get(owner);
    const code = parentRow?.degree || rows[0].degree || 'BS';
    const name = degreeTitle(parent?.name ?? parentRow?.name ?? nameFromChild(rows[0].name), code);
    const optional = (parent?.optionRule ?? []).some((sentence) => /\boptional\b/i.test(sentence)) || plannableIds.has(owner);
    const optionName = new Map((parent?.options ?? []).map((o) => [o.id, o.name]));
    const order = new Map((parent?.options ?? []).map((o, i) => [o.id, i]));

    const choices: MenuChoice[] = rows.map((row) => {
      const raw = optionName.get(row.id) ?? row.concentration ?? row.name.replace(/^.*?\s+-\s+/, '');
      const title = choiceTitle(raw);
      return {
        id: row.id,
        name: GENERAL.test(title) && optional ? 'General (no concentration)' : title,
        totalCredits: row.totalCredits ?? null,
      };
    });
    if (plannableIds.has(owner)) {
      const own = summaryById.get(owner)!;
      choices.push({ id: owner, name: 'General (no concentration)', totalCredits: own.totalCredits ?? null });
    }

    // Thread degrees: every page must be the pair of exactly two listed threads, or the menu falls back to one-of.
    const listed = (parent?.threadList ?? [])
      .map((t) => ({ name: t.name, pages: t.pages.filter((page) => choices.some((c) => c.id === page)) }))
      .filter((t) => t.pages.length > 0);
    let threaded = listed.length >= 2;
    if (threaded) {
      for (const choice of choices) {
        const of = listed.filter((t) => t.pages.includes(choice.id)).map((t) => t.name);
        if (of.length !== 2) {
          threaded = false;
          break;
        }
        choice.threads = [of[0], of[1]];
      }
    }
    if (!threaded) for (const choice of choices) delete choice.threads;

    if (threaded) {
      for (const choice of choices) choice.name = `${choice.threads![0]} + ${choice.threads![1]}`;
      choices.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // "General" first, then the catalog's own order, then by name for anything the parent did not list.
      choices.sort((a, b) => {
        const ga = /^general\b/i.test(a.name) ? 0 : 1;
        const gb = /^general\b/i.test(b.name) ? 0 : 1;
        if (ga !== gb) return ga - gb;
        const oa = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const ob = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
      });
    }

    const kind: MenuDegreeKind = threaded ? 'two-threads' : choices.length === 1 && !optional ? 'single' : 'one-of';
    degrees.push({
      id: owner,
      name,
      degree: code,
      kind,
      pickLabel: kind === 'two-threads' ? 'two threads' : pickLabelOf(choices),
      optional: kind === 'one-of' && optional,
      hint:
        kind === 'two-threads'
          ? 'Each pair of threads has its own requirement page. A thread that has no page with your first pick is greyed out.'
          : kind === 'one-of' && optional
            ? 'Optional. General is the path without a concentration.'
            : kind === 'one-of'
              ? 'Each choice has its own requirement page in the catalog.'
              : '',
      choices,
      threads: threaded ? listed : [],
    });
  }

  degrees.sort((a, b) => a.name.localeCompare(b.name));
  return { degrees };
}

/** Where a stored program id sits in the menu. */
export function locateProgram(menu: ProgramMenu, id: string): { degree: MenuDegree; choice: MenuChoice } | null {
  for (const degree of menu.degrees) {
    const choice = degree.choices.find((c) => c.id === id);
    if (choice) return { degree, choice };
  }
  return null;
}

/** The name a chosen record is shown under: "Computer Science, BS (Threads: Theory + Media)". */
export function choiceLabel(degree: MenuDegree, choice: MenuChoice): string {
  if (degree.kind === 'single') return degree.name;
  if (choice.threads) return `${degree.name} (Threads: ${choice.threads[0]} + ${choice.threads[1]})`;
  return `${degree.name} (${choice.name})`;
}

/** The label for a stored id, or null when the menu does not know it. */
export function programLabel(menu: ProgramMenu, id: string): string | null {
  const hit = locateProgram(menu, id);
  return hit ? choiceLabel(hit.degree, hit.choice) : null;
}

/** Threads that have a pair page with `first`, in catalog order. */
export function pairedThreads(degree: MenuDegree, first: string): string[] {
  const pages = new Set(degree.threads.find((t) => t.name === first)?.pages ?? []);
  return degree.threads.filter((t) => t.name !== first && t.pages.some((page) => pages.has(page))).map((t) => t.name);
}

/** The pair page for two threads, whichever order they were picked in; null when the catalog has no such pair. */
export function resolveThreads(degree: MenuDegree, a: string, b: string): MenuChoice | null {
  if (a === b) return null;
  return (
    degree.choices.find(
      (c) => c.threads && ((c.threads[0] === a && c.threads[1] === b) || (c.threads[0] === b && c.threads[1] === a)),
    ) ?? null
  );
}

/**
 * Every record as one flat menu row, for the setup assistant, the fit check
 * and the planner's own lists (onboarding.tsx ProgramCatalog). Named the way
 * the picker shows them, so the setup assistant and the picker agree.
 */
export function programMenuOptions(menu: ProgramMenu): Array<{ id: string; name: string; degree: string; totalCredits: number | null }> {
  return menu.degrees.flatMap((degree) =>
    degree.choices.map((choice) => ({
      id: choice.id,
      name: choiceLabel(degree, choice),
      degree: degree.degree,
      totalCredits: choice.totalCredits,
    })),
  );
}
