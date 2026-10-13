import type Anthropic from '@anthropic-ai/sdk';
import type { Source } from './ask-router';
import {
  KIND_LABEL,
  RECENT_EVENT_DAYS,
  dayOf,
  freshness,
  recommendClubs,
  searchClubs,
  whyLine,
  type ClubPick,
  type ClubResult,
  type ClubStudent,
  type IllinoisClubsFile,
} from './clubs';

/**
 * ALMA's find_clubs: the tool definition, the rules it follows, and the
 * executor the workspace calls (DESIGN 4.2).
 *
 * It lives here rather than in advisor.ts so wiring it in is three small
 * edits there (an import, an ADVISOR_TOOLS entry, an AdvisorToolName member)
 * and one case in the workspace's executor:
 *
 *   case 'find_clubs': {
 *     const loaded = await loadIllinoisClubs();
 *     return runFindClubs(input, clubStudentOf({ ... live.current ... }), loaded.ok ? loaded.value : null);
 *   }
 *
 * Read-only: it never changes the board, the goal words or the priorities, so
 * it files no undo step and needs no confirmation. Its answer and the rail's
 * "Clubs for your goals" come from the same recommendClubs, so ALMA with no
 * query names exactly the clubs the rail shows.
 */

export const FIND_CLUBS_TOOL: Anthropic.Beta.BetaTool = {
  name: 'find_clubs',
  description:
    "Student organizations at Illinois (registered student organizations, professional societies, pre-professional " +
    "and academic clubs, competition teams) from the university's own directory, OneIllinois, as of source.checked. " +
    "With no query: the clubs matched to the student's goals and major, the same list the rail's 'Clubs for your goals' " +
    'section shows. With a query: clubs for that goal, field or kind of club, in the student\'s words. Use it for every ' +
    'question about which clubs, societies, organizations or teams to join; never name a club it did not return.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: "The student's words: 'consulting', 'robotics team', 'a cappella'. Omit for the student's own goals." },
      goal: { type: 'string', description: 'One of the goals the board lists, to see more clubs for it.' },
      limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Default 6.' },
    },
    additionalProperties: false,
  },
};

/**
 * Appended next to ILLINOIS_RULES in advisorSystem, for Illinois students
 * only (the directory is Illinois's).
 */
export const CLUBS_RULES = [
  '- Clubs and student organizations: call find_clubs for any question about which clubs, organizations, societies or teams to join, or how to get involved in a field. Never answer from memory.',
  "- Name at most 4 clubs in a reply, each by the exact name find_clubs returned, and give its why in your own words. Do not paste URLs: the club pages are linked under your reply.",
  "- Say once in the conversation that the list comes from source.name, checked on source.checked, that clubs change every year, and that each club's page has the latest. When source.stale is true, say the list may be out of date.",
  '- Never name a club find_clubs did not return, even a famous one. When it returns none, say so and give source.url.',
  "- Never give officer names, emails or phone numbers; send the student to the club's page.",
  "- A question about clubs is not a change of goal. Do not call set_priorities for it: that re-picks electives. Offer once to add a new goal to their goals, and act only on a yes.",
  '- Identity, cultural, faith and fraternity or sorority groups come up only when the student asks for that kind of community. Never assume who a student is.',
  "- Pass on the cautions: an honor society is by invitation; say when a club is by application, audition or election; for a club not taking sign-ups on OneIllinois, tell the student to check its page.",
  '- For how to join or start a student organization, Quad Day or involvement fairs, use university_answer.',
].join('\n');

/** One club as ALMA reads it. */
export interface FoundClub {
  name: string;
  url: string;
  kind: string;
  categories: string[];
  for_goal: string;
  why: string;
  does?: string;
  cautions: string[];
  next_event?: string;
  last_event?: string;
}

export type FindClubsResult =
  | {
      ok: true;
      summary: string;
      source: { name: string; url: string; checked: string; stale: boolean };
      goals_used: Array<{ id: string; label: string }>;
      clubs: FoundClub[];
      communities?: FoundClub[];
      thin?: Array<{ id: string; label: string; clubs: number }>;
      none?: string;
      note: string;
      sources: Source[];
    }
  | { ok: false; reason: string; sources: Source[] };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Run find_clubs. `student` is clubStudentOf(...) for the board as it is now
 * (null before a degree or goals exist: the starters come back); `data` is the
 * loaded club file, or null when it did not load.
 */
export function runFindClubs(
  input: Record<string, unknown>,
  student: ClubStudent | null,
  data: IllinoisClubsFile | null,
  options: { today?: Date | string } = {},
): FindClubsResult {
  if (!data) {
    return {
      ok: false,
      reason: "The club list did not load, so no club can be named from it. Say so; university_answer can point the student to the university's student-organization directory.",
      sources: [],
    };
  }
  const today = options.today ?? new Date();
  const query = str(input.query);
  const goalAsked = str(input.goal);
  const asked = Number(input.limit);
  const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(10, Math.floor(asked)) : 6;

  let result: ClubResult;
  let scope: string;
  if (goalAsked) {
    const id = goalIdFor(goalAsked, student);
    if (!id) {
      result = searchClubs(data, goalAsked, student, { limit, today });
      scope = goalAsked;
    } else {
      result = recommendClubs(data, student, { only: [id], perGoal: limit, limit, communities: false, today });
      scope = result.goals[0]?.label ?? goalAsked;
    }
  } else if (query) {
    result = searchClubs(data, query, student, { limit, today });
    scope = result.goals.length ? result.goals.map((g) => g.label).join(', ') : `"${query}"`;
  } else {
    // The rail's list. Its communities row stays with the rail: ALMA raises
    // identity groups only when the student asks for that kind of community.
    result = recommendClubs(data, student, { limit, communities: false, today });
    scope = result.goals.length
      ? result.goals.map((g) => g.label).join(', ')
      : result.picks.some((p) => p.goal === 'words')
        ? 'what you wrote'
        : result.picks.some((p) => p.goal === 'major')
          ? 'your major'
          : 'getting started';
  }

  const label = new Map(result.goals.map((g) => [g.id, g.label]));
  const forGoal = (p: ClubPick) =>
    label.get(p.goal) ??
    ({ major: 'your major', words: 'what you wrote', starter: 'a first club while you decide', general: 'no goal: a general club for any student', search: query || goalAsked } as Record<string, string>)[p.goal] ??
    p.goal;
  const day = dayOf(today);
  const found = (p: ClubPick): FoundClub => {
    const next = (p.club.events?.next ?? []).find((d) => d >= day);
    const last = p.club.events?.last;
    const recent = last && last <= day && (Date.parse(day) - Date.parse(last)) / 86_400_000 <= RECENT_EVENT_DAYS;
    return {
      name: p.club.name,
      url: p.club.url,
      kind: KIND_LABEL[p.club.kind],
      categories: p.club.categories,
      for_goal: forGoal(p),
      why: whyLine(p),
      ...(p.club.does ? { does: p.club.does } : {}),
      cautions: p.cautions,
      ...(next ? { next_event: next } : {}),
      ...(recent ? { last_event: last } : {}),
    };
  };
  const clubs = result.picks.slice(0, limit).map(found);
  const communities = result.communities.map(found);
  const fresh = freshness(data, today);
  const source = { name: data.source.name, url: data.source.url, checked: data.checked, stale: fresh.stale };
  const thin = result.thin.map((id) => ({ id, label: label.get(id) ?? id, clubs: result.matched[id] ?? 0 }));
  const listed = [...clubs, ...communities];
  const sources: Source[] = listed.length
    ? listed.map((c, i) => ({ n: i + 1, title: c.name, url: c.url, host: hostOf(c.url) }))
    : [{ n: 1, title: data.source.name, url: data.source.url, host: hostOf(data.source.url) }];
  const none = clubs.length === 0 && communities.length === 0;

  return {
    ok: true,
    summary: none ? `No clubs for ${scope}` : `${clubs.length} ${clubs.length === 1 ? 'club' : 'clubs'} for ${scope}`,
    source,
    goals_used: result.goals,
    clubs,
    ...(communities.length ? { communities } : {}),
    ...(thin.length ? { thin } : {}),
    ...(none ? { none: `No club in ${data.source.name} matched ${query ? `"${query}"` : goalAsked ? `"${goalAsked}"` : "the student's goals or major"}. Say so, and give ${data.source.url} to browse every club.` } : {}),
    note: `Name only these clubs, by these names. Clubs change every year; each club page has the latest.${fresh.stale ? ` The list is from ${fresh.label} and may be out of date: say so.` : ''}${result.undecided ? ' The student says they are still deciding; these are clubs for exploring (their major\'s, or the starter clubs). Say that, not that nothing matched.' : result.unknownGoal || result.empty === 'unheard' ? ' The student\'s words name no goal the planner knows yet: say so plainly. The clubs come from their own words (for_goal "what you wrote": the club\'s name or page has those words), their major, or are general clubs; never call one a club for their goal.' : ''}`,
    sources,
  };
}

/** A goal the board lists, by id or by its label; else what the goal reader hears in the words. */
function goalIdFor(goal: string, student: ClubStudent | null): string | null {
  if (!student) return null;
  const want = goal.toLowerCase();
  for (const t of student.profile.tracks) if (t.id === want || t.name.toLowerCase() === want) return t.id;
  for (const t of student.profile.topics) if (t.id === want || t.label.toLowerCase() === want) return t.id;
  const heard = student.hear(goal);
  return heard.tracks[0]?.id ?? heard.topics.find((t) => heard.heard.includes(t.label))?.id ?? null;
}
