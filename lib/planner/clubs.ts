/**
 * Club recommendations: the shape of public/illinois/clubs.json, and the one
 * ranking that both the rail's "Clubs for your goals" section and ALMA's
 * find_clubs tool read, so the two never disagree.
 *
 * The file is built by scripts/illinois/clubs/ (crawl, tag, build) from the
 * university's own student-organization directory, OneIllinois. It holds facts
 * and tags in the planner's own words: names, directory categories, links,
 * event dates, goal ids. No club's own text and no contact names ship.
 *
 * Tags are made at build time; ranking happens here, at run time, because the
 * student's major is part of it (a chemistry student who wants a PhD is heard
 * as no goal, and the American Chemical Society is still right for them).
 * Scoring about 1,100 clubs takes well under a millisecond.
 *
 * Goals are read from the student's career words by the planner's own goal
 * reader (interestProfile in career-tracks.ts), the same reading the course
 * picker uses, so "pre-med" means one thing for CHEM 232 and for a pre-med
 * club, and "not pre-med anymore" or "my sister is pre-law" mean nothing. The
 * major's name is never read as a goal. This file imports only types from
 * career-tracks.ts; the caller passes the reader in (`hear`), so this module
 * never pulls in autoplan.ts.
 *
 * Score (DESIGN 3.3): the single strongest piece of evidence counts, not a
 * sum, plus small bonuses that order ties, times factors for the kind of club
 * and how open it is. Anything under 0.5 is dropped. Pure and deterministic:
 * the same file, student and day give the same list.
 */
import type { CareerTrack, InterestProfile, InterestTopic } from './career-tracks';

// ===========================================================================
// public/illinois/clubs.json
// ===========================================================================

export interface IllinoisClubsFile {
  version: 1;
  /** ISO time of the build. */
  builtAt: string;
  /** 'YYYY-MM-DD' the directory page was read. */
  checked: string;
  /** Where the clubs come from. Shown to students; never hard-coded in the app. */
  source: { name: string; url: string; host: string };
  /** The directory's events calendar, when the build read it. */
  calendar: { url: string; lastModified: string | null; read: string } | null;
  /** University offices' own lists. Club.lists and ClubGoal.list index into this. */
  lists: ClubList[];
  counts: {
    /** The page's own count of groups. */
    onPage: number;
    parsed: number;
    shipped: number;
    dropped: { office: number; graduate: number; law: number; medical: number; veterinary: number; hidden?: number };
    /** Clubs kept inside the 120-day grace window after the directory stopped listing them. */
    unlisted: number;
  };
  clubs: Club[];
}

export interface ClubList {
  id: string;
  /** The page's own title. */
  title: string;
  /** For a why line: "Pre-Law Advising's 2025–26 list of pre-law student orgs". */
  short: string;
  url: string;
  /** 'YYYY-MM-DD' the list was read. */
  read: string;
  /** What being on it counts as: exactly one of these. */
  goal?: string;
  weight?: number;
  college?: string;
  subject?: string;
}

export type ClubKind =
  | 'pre-professional'
  | 'professional-society'
  | 'competition-team'
  | 'professional-fraternity'
  | 'honor'
  | 'consulting-investing'
  | 'academic'
  | 'service'
  | 'arts-performance'
  | 'media'
  | 'government-advocacy'
  | 'cultural'
  | 'faith'
  | 'sport-recreation'
  | 'social'
  | 'greek-social'
  | 'other';

export type ClubAudience = 'undergrad' | 'both' | 'check';
export type ClubJoining = 'open' | 'closed' | 'application' | 'audition' | 'election' | 'invitation';
export type ClubGoalSource = 'list' | 'national' | 'name' | 'reading' | 'override';

export interface ClubGoal {
  /** A CAREER_TRACKS or INTEREST_TOPICS id. */
  id: string;
  from: ClubGoalSource;
  /** For from 'list': which list. */
  list?: number;
}

export interface ClubEvents {
  /** The latest past start date, 'YYYY-MM-DD'. */
  last?: string;
  /** Up to 3 upcoming start dates, as of the day the calendar was read. */
  next?: string[];
  /** Events in the 120 days before the calendar was read. */
  n120: number;
}

export interface Club {
  /** The directory's numeric id, "35454". */
  id: string;
  name: string;
  /** The profile when there is one, else the club's own website. Never constructed. */
  url: string;
  /** https://one.illinois.edu/<Slug>/ */
  profile?: string;
  website?: string;
  /** The directory's topical tags, verbatim. */
  categories: string[];
  /** "~ Affiliation:" tags, prefix removed. */
  affiliations?: string[];
  kind: ClubKind;
  /** Centered on a shared identity or background. Never inferred about a student. */
  identity: boolean;
  /** The national body it is a chapter of: 'ASME'. */
  national?: string;
  audience: ClubAudience;
  joining: ClubJoining;
  goals: ClubGoal[];
  /** Course prefixes it is about: 'ME'. */
  subjects?: string[];
  /** programs.json college codes: 'engineering'. */
  colleges?: string[];
  lists?: number[];
  /** At most 20 words, ours, from the reading pass. */
  does?: string;
  /** Its directory description is under 15 words. */
  thin?: true;
  /** Shown to a student with no goal yet. */
  starter?: true;
  events?: ClubEvents;
  firstSeen: string;
  /** Earlier than the file's `checked` means it is in the grace window. */
  lastSeen: string;
}

// ===========================================================================
// The student
// ===========================================================================

/** Goal names, for why lines about a goal the student did not name (the parent of a family). */
export interface GoalVocabulary {
  tracks: Array<Pick<CareerTrack, 'id' | 'name'>>;
  topics: Array<Pick<InterestTopic, 'id' | 'label'>>;
}

export interface ClubStudent {
  /** What they want to do after they graduate, in their words; '' when nothing. */
  careerText: string;
  /** hear(careerText). */
  profile: InterestProfile;
  /** The goal reader: interestProfileOf in the app (cached), interestProfile in the checks. */
  hear: (text: string) => InterestProfile;
  /** The degree's primary subject prefix ('ME'), or null. */
  primary: string | null;
  /** Every subject prefix of the degree. */
  subjects: string[];
  /** "Mechanical Engineering", from the program name; null without a program. */
  majorName: string | null;
  /** programs.json college code, or null. */
  college: string | null;
  /** Entering as a first-year: honor societies count half. */
  firstYear: boolean;
  vocabulary?: GoalVocabulary;
}

/**
 * The ClubStudent for the workspace's state.
 *   hear      = interestProfileOf (autoplan.ts), or interestProfile in a check
 *   degree    = degreeSubjects(blocks, programName) -> { primary, subjects }
 *   college   = loaded.program.college
 *   firstYear = enteringAsFirstYear(words, transcript) (review.ts)
 */
export function clubStudentOf(input: {
  careerText: string | null | undefined;
  hear: (text: string) => InterestProfile;
  programName?: string | null;
  college?: string | null;
  degree?: { primary: string | null; subjects: Iterable<string> } | null;
  firstYear?: boolean;
  vocabulary?: GoalVocabulary;
}): ClubStudent {
  const careerText = (input.careerText ?? '').trim();
  const primary = input.degree?.primary ?? null;
  const subjects = [...new Set([...(primary ? [primary] : []), ...(input.degree ? [...input.degree.subjects] : [])])];
  return {
    careerText,
    profile: input.hear(careerText),
    hear: input.hear,
    primary,
    subjects,
    majorName: majorNameOf(input.programName ?? null),
    college: input.college ?? null,
    firstYear: input.firstYear ?? false,
    ...(input.vocabulary ? { vocabulary: input.vocabulary } : {}),
  };
}

/** "Political Science: General Political Science, BALAS" -> "Political Science". */
export function majorNameOf(programName: string | null): string | null {
  if (!programName) return null;
  const name = programName.replace(/,\s*[A-Z][A-Za-z]{1,8}$/, '').split(':')[0].trim();
  return name || null;
}

// ===========================================================================
// What the rail and ALMA get
// ===========================================================================

export type ClubBasis =
  | 'list'
  | 'track'
  | 'topic'
  | 'family'
  | 'sibling'
  | 'covered'
  | 'reading'
  | 'national'
  | 'subject'
  | 'degree-subject'
  | 'college'
  | 'words'
  | 'starter'
  | 'search';

export interface ClubPick {
  club: Club;
  /** Not shown to students. Not capped at 1: the bonuses order ties. */
  score: number;
  /** The goal id this pick is under, or 'major', 'words', 'starter', 'search'. */
  goal: string;
  basis: ClubBasis;
  /** One template line, at most 110 characters. */
  why: string;
  cautions: string[];
  /** "Next event Oct 9" or "Last event Apr 2026", when the calendar says. */
  event?: string;
}

export interface ClubResult {
  /** The goals heard, in the order the student named them. */
  goals: Array<{ id: string; label: string }>;
  picks: ClubPick[];
  /** Identity-centered clubs matched by a heard goal: the folded "Communities in these fields" row. */
  communities: ClubPick[];
  /** Goals with fewer than 3 matching clubs: the card says so and links the directory. */
  thin: string[];
  /** How many clubs matched each heard goal (0.5 or more), communities aside. */
  matched: Record<string, number>;
  /**
   * 'no-words': nothing written (or ALMA cleared it); 'unheard': words, but no
   * goal the planner knows and no major match; 'no-match': goals heard, and no
   * club for them or the major.
   */
  empty?: 'no-words' | 'unheard' | 'no-match';
}

// ===========================================================================
// The model
// ===========================================================================

/** How strong each kind of evidence is. The best one counts, not a sum. */
export const EVIDENCE: Record<Exclude<ClubBasis, 'starter' | 'search'>, number> = {
  list: 1.0, // on a university office's list for the goal: Pre-Law Advising's pre-law orgs
  track: 1.0, // named for a career track the student named: Pre-Vet Club for "vet school"
  topic: 0.9, // named for a topic the student named: Illinois Consulting Group for "consulting"
  family: 0.75, // the field the topic sits in: a finance club for "investment banking"
  sibling: 0.6, // another topic in that field: a markets club for "investment banking", weaker than the field itself
  covered: 0.7, // a topic the student's track covers: a law club for "pre-law"
  national: 0.7, // the national society of the major's subject: ASME for Mechanical Engineering
  subject: 0.7, // named for the major's subject, or on its department's list
  words: 0.55, // a word the student wrote is in its name, only when no goal was heard
  reading: 0.5, // the reading pass found the goal in its page, and a directory category agrees
  'degree-subject': 0.45, // another subject of the degree
  college: 0.3, // the student's college: its affiliation tag or a college list
};
export const AGREE_BONUS = 0.15; // two different kinds of evidence agree
export const SPECIFIC_BONUS = 0.05; // named for this goal and at most one other
export const NATIONAL_BONUS = 0.03; // a chapter of a national body
export const UMBRELLA_PENALTY = 0.1; // named for 5+ goals: the club for this goal alone comes first
export const MIN_SCORE = 0.5;
export const PER_GOAL = 3;
export const RAIL_VISIBLE = 5;
export const COMMUNITIES = 3;
export const STALE_DAYS = 120;
export const RECENT_EVENT_DAYS = 180;
export const WHY_MAX = 110;

/** What a kind of club is worth for career recommendations. 0: never from career evidence (a query may find it). */
export const KIND_FACTOR: Record<ClubKind, number> = {
  'pre-professional': 1,
  'professional-society': 1,
  'competition-team': 0.95,
  'consulting-investing': 0.9,
  academic: 0.9,
  service: 0.9,
  media: 0.9,
  'arts-performance': 0.9,
  'government-advocacy': 0.9,
  other: 0.9,
  'professional-fraternity': 0.85,
  honor: 0.6,
  social: 0,
  'greek-social': 0,
  faith: 0,
  cultural: 0,
  'sport-recreation': 0,
};

export const KIND_LABEL: Record<ClubKind, string> = {
  'pre-professional': 'Pre-professional club',
  'professional-society': 'Professional society',
  'competition-team': 'Competition team',
  'professional-fraternity': 'Professional fraternity',
  honor: 'Honor society',
  'consulting-investing': 'Consulting or investing club',
  academic: 'Academic club',
  service: 'Service club',
  'arts-performance': 'Arts and performance',
  media: 'Student media',
  'government-advocacy': 'Government and advocacy',
  cultural: 'Cultural club',
  faith: 'Faith group',
  'sport-recreation': 'Sport and recreation',
  social: 'Social club',
  'greek-social': 'Fraternity or sorority',
  other: 'Student organization',
};

/** Fields a topic sits in: a club named for the parent fits a child at EVIDENCE.family (DESIGN 3.3). */
export const GOAL_FAMILY: Record<string, string[]> = {
  finance: ['investment-banking', 'markets', 'financial-planning', 'real-estate', 'commercial-banking'],
  'software-engineering': ['ai-ml', 'cybersecurity', 'game-design', 'data-science'],
};
/**
 * Families whose children also fit each other, at EVIDENCE.sibling: the finance
 * fields share recruiting and skills (an investing club is a fair pick for
 * investment banking). The software ones do not stand in for each other: a
 * data science club is not a game design club, so a game design student sees
 * the software engineering clubs and the clubs named for game design only.
 */
const SIBLINGS_FIT = new Set(['finance']);
const FAMILY_PARENT = new Map(Object.entries(GOAL_FAMILY).flatMap(([parent, kids]) => kids.map((k) => [k, parent] as const)));

/** programs.json college codes, for "Affiliated with ..." lines. */
export const COLLEGE_NAME: Record<string, string> = {
  engineering: 'the Grainger College of Engineering',
  bus: 'Gies College of Business',
  las: 'the College of Liberal Arts & Sciences',
  aces: 'the College of ACES',
  ahs: 'the College of Applied Health Sciences',
  education: 'the College of Education',
  faa: 'the College of Fine & Applied Arts',
  media: 'the College of Media',
  ischool: 'the School of Information Sciences',
  socw: 'the School of Social Work',
};
const AFFILIATION_OF_COLLEGE: Record<string, string> = { engineering: 'Grainger College of Engineering' };

/** Words that say nothing about which club fits, for the free-word fallback and the search. */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'career', 'company', 'something', 'maybe', 'really', 'professional', 'professionally', 'school',
  'graduate', 'working', 'would', 'could', 'should', 'build', 'design', 'world', 'people', 'other', 'their', 'there', 'things',
  'think', 'student', 'students', 'chicago', 'government', 'idea', 'still', 'figure', 'figuring', 'sure', 'want', 'wants',
  'like', 'with', 'into', 'some', 'what', 'which', 'where', 'when', 'then', 'than', 'this', 'that', 'those', 'these', 'going',
  'become', 'being', 'doing', 'thing', 'kinda', 'probably', 'definitely', 'eventually', 'someday', 'there', 'years', 'later',
  'undecided', 'clubs', 'club', 'organization', 'organizations', 'group', 'groups', 'society', 'societies', 'association',
  'join', 'joining', 'good', 'best', 'great', 'interested', 'looking', 'find', 'any', 'for', 'the', 'and', 'are', 'can',
  'how', 'you', 'your', 'our', 'get', 'involved', 'campus', 'illinois', 'uiuc', 'university', 'org', 'orgs', 'rso', 'rsos',
  'team', 'teams', 'have', 'has', 'not', 'yet', 'out', 'get', 'more', 'most', 'also', 'just', 'one', 'ones', 'from',
]);

// ===========================================================================
// Small helpers
// ===========================================================================

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const article = (phrase: string) => (/^[aeiou]/i.test(phrase) ? 'An' : 'A');

/** At most WHY_MAX characters, cut at a word. */
export function clip(line: string, max: number = WHY_MAX): string {
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** A Date (read in local time) or 'YYYY-MM-DD', as 'YYYY-MM-DD'. */
export const dayOf = (today: Date | string): string => (typeof today === 'string' ? today.slice(0, 10) : isoDay(today));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The label a student reads back for a goal id. */
function labeller(student: ClubStudent | null): (id: string) => string {
  const names = new Map<string, string>();
  for (const t of student?.vocabulary?.tracks ?? []) names.set(t.id, t.name);
  for (const t of student?.vocabulary?.topics ?? []) names.set(t.id, t.label);
  for (const t of student?.profile.tracks ?? []) names.set(t.id, t.name);
  for (const t of student?.profile.topics ?? []) names.set(t.id, t.label);
  return (id) => names.get(id) ?? id.replace(/-/g, ' ');
}

/** The goals a profile names, in the order named, and the topics its tracks cover. */
function goalsOf(profile: InterestProfile): { goals: string[]; tracks: Set<string>; covered: string[]; coveredBy: Map<string, string> } {
  const tracks = profile.tracks.map((t) => t.id);
  const heardTopics = profile.topics.filter((t) => profile.heard.includes(t.label)).map((t) => t.id);
  const coveredBy = new Map<string, string>();
  for (const t of profile.tracks) for (const r of t.related) if (!coveredBy.has(r)) coveredBy.set(r, t.id);
  const covered = profile.topics.map((t) => t.id).filter((id) => !heardTopics.includes(id) && coveredBy.has(id));
  return { goals: [...tracks, ...heardTopics], tracks: new Set(tracks), covered, coveredBy };
}

/** Near-duplicate names ("ASME UIUC" and "ASME at Illinois") share a key. */
const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/\b(at|of|the|uiuc|illinois|university|urbana|champaign|chapter|student|students|club|organization|association|society|inc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

/** Clubs once each: two near-identical names or two chapters of one national body keep the higher score. */
function dedupe(picks: ClubPick[]): ClubPick[] {
  const seen = new Set<string>();
  const out: ClubPick[] = [];
  for (const p of picks) {
    const keys = [`n:${nameKey(p.club.name) || p.club.id}`, ...(p.club.national ? [`c:${p.club.national}`] : [])];
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(p);
  }
  return out;
}

const byScore = (a: ClubPick, b: ClubPick) => b.score - a.score || a.club.name.localeCompare(b.club.name, 'en') || Number(a.club.id) - Number(b.club.id);

// ===========================================================================
// Cautions, events, freshness
// ===========================================================================

/** True when the club is kept only by the grace window. */
export const inGraceWindow = (club: Club, checked: string | undefined): boolean => Boolean(checked) && club.lastSeen < (checked as string);

/**
 * The labels a student should see before joining, most important first.
 * `checked` is the file's date, for the grace-window note.
 */
export function cautionsOf(club: Club, _student?: ClubStudent | null, checked?: string): string[] {
  const out: string[] = [];
  if (club.kind === 'honor') out.push('By invitation, usually by GPA or standing');
  if (club.kind === 'professional-fraternity') out.push('Recruits once a semester; check its page for dates');
  if (club.joining === 'application') out.push('By application');
  if (club.joining === 'audition') out.push('By audition');
  if (club.joining === 'election') out.push('By election');
  if (club.joining === 'invitation' && club.kind !== 'honor') out.push('By invitation');
  if (club.joining === 'closed') out.push('Not taking sign-ups on OneIllinois now; its page says how to join');
  if (club.audience === 'check') out.push('May be for graduate or professional students; check its page');
  if (inGraceWindow(club, checked)) out.push(`Not in the directory since ${shortDate(club.lastSeen)}; clubs re-register each year`);
  return out;
}

/** "Oct 4, 2026". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The card's event line: the first upcoming date still ahead ("Next event
 * Oct 9"), else the last one when within 180 days ("Last event Apr 2026"),
 * else nothing. Never "Active".
 */
export function eventLine(club: Club, today: Date | string = new Date()): string | undefined {
  const day = dayOf(today);
  const next = (club.events?.next ?? []).find((d) => d >= day);
  if (next) {
    const [, m, d] = next.split('-').map(Number);
    return `Next event ${MONTHS[m - 1]} ${d}`;
  }
  const last = club.events?.last;
  if (last && last <= day && daysBetween(last, day) <= RECENT_EVENT_DAYS) {
    const [y, m] = last.split('-').map(Number);
    return `Last event ${MONTHS[m - 1]} ${y}`;
  }
  return undefined;
}

/** How old the file is: "Oct 4, 2026", and stale after 120 days (the footer turns amber). */
export function freshness(data: Pick<IllinoisClubsFile, 'checked'>, today: Date | string = new Date()): { checked: string; label: string; days: number; stale: boolean } {
  const days = daysBetween(data.checked, dayOf(today));
  return { checked: data.checked, label: shortDate(data.checked), days, stale: days > STALE_DAYS };
}

/** The pick's why line, clipped. */
export function whyLine(pick: Pick<ClubPick, 'why'>): string {
  return clip(pick.why);
}

/**
 * The card's line under a goal with fewer than PER_GOAL clubs (DESIGN 3.4,
 * 4.1): how many matched, and the directory to browse instead of a padded
 * list. "Only 2 clubs in OneIllinois matched pre-optometry." [Browse them all]
 */
export function thinNote(data: Pick<IllinoisClubsFile, 'source'>, label: string, matched: number): { text: string; link: string; href: string } {
  const text = matched === 0
    ? `No club in ${data.source.name} matched ${label} yet.`
    : `Only ${matched} ${matched === 1 ? 'club' : 'clubs'} in ${data.source.name} matched ${label}.`;
  return { text, link: matched === 0 ? 'Browse every club' : 'Browse them all', href: data.source.url };
}

// ===========================================================================
// Scoring one club
// ===========================================================================

type EvidenceKind = 'goal' | 'major' | 'words' | 'college';
interface Evidence {
  v: number;
  kind: EvidenceKind;
  basis: ClubBasis;
  goal: string;
  why: string;
  specific?: boolean;
}

interface Context {
  data: IllinoisClubsFile;
  student: ClubStudent | null;
  goals: string[];
  tracks: Set<string>;
  covered: string[];
  coveredBy: Map<string, string>;
  label: (id: string) => string;
  words: string[];
  calendarRead: boolean;
  /** Clubs whose audience is not confirmed ('check'): only for ALMA's search, never the rail. */
  includeCheck: boolean;
}

function contextFor(data: IllinoisClubsFile, student: ClubStudent | null, profile: InterestProfile | null, careerText: string): Context {
  const g = profile ? goalsOf(profile) : { goals: [], tracks: new Set<string>(), covered: [], coveredBy: new Map<string, string>() };
  const words = g.goals.length
    ? []
    : [...new Set(careerText.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !STOPWORDS.has(w)))];
  return { data, student, ...g, label: labeller(student), words, calendarRead: Boolean(data.calendar), includeCheck: false };
}

/** Goal evidence: the student's own goals first, in the order named. */
function goalEvidence(club: Club, named: Set<string>, read: Set<string>, ctx: Context): Evidence | null {
  const { goals, tracks, covered, coveredBy, label, data } = ctx;
  const lists = data.lists;
  for (const g of goals) {
    const i = (club.lists ?? []).find((k) => lists[k]?.goal === g);
    if (i !== undefined) {
      const l = lists[i];
      return { v: EVIDENCE.list * (l.weight ?? 1), kind: 'goal', basis: 'list', goal: g, specific: true, why: `On ${l.short || l.title}` };
    }
  }
  for (const g of goals) {
    if (!named.has(g)) continue;
    const isTrack = tracks.has(g);
    return {
      v: isTrack ? EVIDENCE.track : EVIDENCE.topic,
      kind: 'goal',
      basis: isTrack ? 'track' : 'topic',
      goal: g,
      specific: named.size <= 2,
      why: isTrack ? `For your goal: ${label(g)}` : `About ${label(g)}, which you said you want`,
    };
  }
  for (const g of goals) {
    const parent = FAMILY_PARENT.get(g);
    if (parent && named.has(parent)) {
      return { v: EVIDENCE.family, kind: 'goal', basis: 'family', goal: g, why: `${article(label(parent))} ${label(parent)} club; ${label(g)} is part of ${label(parent)}` };
    }
    const child = GOAL_FAMILY[g]?.find((y) => named.has(y));
    if (child) return { v: EVIDENCE.family, kind: 'goal', basis: 'family', goal: g, why: `About ${label(child)}, part of ${label(g)}` };
  }
  // A sibling field only after every goal's own field: a finance club outranks a real-estate club for "investment banking".
  for (const g of goals) {
    const parent = FAMILY_PARENT.get(g);
    const sibling = parent && SIBLINGS_FIT.has(parent) ? GOAL_FAMILY[parent].find((y) => y !== g && named.has(y)) : undefined;
    if (sibling) return { v: EVIDENCE.sibling, kind: 'goal', basis: 'sibling', goal: g, why: `${article(label(sibling))} ${label(sibling)} club, close to ${label(g)}` };
  }
  for (const c of covered) {
    if (!named.has(c)) continue;
    const t = coveredBy.get(c) as string;
    return { v: EVIDENCE.covered, kind: 'goal', basis: 'covered', goal: t, why: `About ${label(c)}, part of ${label(t)}` };
  }
  for (const g of [...goals, ...covered]) {
    if (!read.has(g)) continue;
    return { v: EVIDENCE.reading, kind: 'goal', basis: 'reading', goal: goals.includes(g) ? g : (coveredBy.get(g) as string), why: `Its ${data.source.name} page describes ${label(g)} work` };
  }
  return null;
}

/** Major, words and college evidence; never for a club tagged for someone else's goal. */
function otherEvidence(club: Club, ctx: Context): Evidence[] {
  const out: Evidence[] = [];
  const s = ctx.student;
  const lists = ctx.data.lists;
  const onLists = (club.lists ?? []).map((i) => lists[i]).filter((l): l is ClubList => Boolean(l));
  if (s?.primary) {
    const major = s.majorName ?? s.primary;
    const listed = onLists.find((l) => l.subject === s.primary);
    if (club.subjects?.includes(s.primary)) {
      // "Named for" only when the name says it. A team about the major whose name does not (Steel Bridge,
      // hand-checked as civil engineering) is "close to" it: one prefix can hold two majors (CEE: civil and environmental).
      const namesIt = new RegExp(`\\b${escapeRe(major)}\\b`, 'i').test(club.name);
      out.push(club.national
        ? { v: EVIDENCE.national, kind: 'major', basis: 'national', goal: 'major', why: `The ${club.national} student chapter, for ${major} students` }
        : { v: EVIDENCE.subject, kind: 'major', basis: 'subject', goal: 'major', why: namesIt ? `Named for ${major}, your major` : `${article(KIND_LABEL[club.kind])} ${KIND_LABEL[club.kind].toLowerCase()} close to ${major}, your major` });
    } else if (listed) {
      out.push({ v: EVIDENCE.subject, kind: 'major', basis: 'subject', goal: 'major', why: `On ${listed.short}, for ${major} students` });
    } else {
      const other = [...(club.subjects ?? []), ...onLists.map((l) => l.subject).filter((x): x is string => Boolean(x))].find((x) => s.subjects.includes(x));
      if (other) out.push({ v: EVIDENCE['degree-subject'], kind: 'major', basis: 'degree-subject', goal: 'major', why: `About ${other}, a subject in your degree` });
    }
  }
  const word = ctx.words.find((w) => new RegExp(`\\b${escapeRe(w)}`, 'i').test(club.name));
  if (word) out.push({ v: EVIDENCE.words, kind: 'words', basis: 'words', goal: 'words', why: `Its name matches "${word}" from what you wrote` });
  if (s?.college && club.colleges?.includes(s.college)) {
    const list = onLists.find((l) => l.college === s.college);
    const aff = AFFILIATION_OF_COLLEGE[s.college];
    const why = list
      ? `Listed by ${list.short}`
      : aff && club.affiliations?.includes(aff)
        ? `Affiliated with ${COLLEGE_NAME[s.college]}`
        : `Tied to ${COLLEGE_NAME[s.college] ?? s.college}, your college`;
    out.push({ v: EVIDENCE.college, kind: 'college', basis: 'college', goal: 'major', why });
  }
  return out;
}

/**
 * One club's pick for this student, or null under the cutoff. The score is the
 * strongest evidence's; a club with any goal evidence is listed under that
 * goal, with that goal's why line, so a heading and its rows agree.
 */
function scoreClub(club: Club, ctx: Context, today: string): ClubPick | null {
  const factor = KIND_FACTOR[club.kind] ?? 0;
  if (factor === 0) return null;
  // Recommendable means an undergraduate can join (DESIGN 5.3, scoreboard 1): a club that may be
  // for graduate or professional students is never one of the rail's picks; ALMA's search can
  // return it, ranked x0.6 with the caution, when the student asks in words that fit it.
  if (club.audience === 'check' && !ctx.includeCheck) return null;
  const named = new Set(club.goals.filter((g) => g.from !== 'reading').map((g) => g.id));
  const read = new Set(club.goals.filter((g) => g.from === 'reading').map((g) => g.id));
  const ev: Evidence[] = [];
  const goal = goalEvidence(club, named, read, ctx);
  if (goal) ev.push(goal);
  // A club about a goal the student did not name is not theirs because it shares the major:
  // the Pre-Health Psychology Association is not for a Psychology student who wants HR.
  const someoneElses = ctx.goals.length > 0 && named.size + read.size > 0 && !goal;
  if (!someoneElses) ev.push(...otherEvidence(club, ctx));
  if (ev.length === 0) return null;
  ev.sort((a, b) => b.v - a.v);
  const best = ev[0];
  let score =
    best.v +
    (new Set(ev.map((e) => e.kind)).size >= 2 ? AGREE_BONUS : 0) +
    (best.kind === 'goal' && best.specific ? SPECIFIC_BONUS : 0) +
    (club.national ? NATIONAL_BONUS : 0) -
    (best.kind === 'goal' && named.size >= 5 ? UMBRELLA_PENALTY : 0);
  score *= factor;
  score *= conditionFactor(club, ctx);
  if (club.kind === 'honor' && ctx.student?.firstYear) score *= 0.5;
  if (score < MIN_SCORE) return null;
  const shown = goal ?? best;
  return {
    club,
    score,
    goal: shown.goal,
    basis: shown.basis,
    why: clip(shown.why),
    cautions: cautionsOf(club, ctx.student, ctx.data.checked),
    ...eventField(club, today),
  };
}

/** The factors for how open and how live a club is (DESIGN 3.3). */
function conditionFactor(club: Club, ctx: Pick<Context, 'calendarRead' | 'data'>): number {
  let f = 1;
  if (club.audience === 'check') f *= 0.6;
  if (club.thin) f *= 0.85;
  if (club.joining !== 'open') f *= 0.8;
  // Only when the calendar was read: without it every club would look idle.
  if (ctx.calendarRead && !(club.events && (club.events.n120 > 0 || (club.events.next?.length ?? 0) > 0))) f *= 0.9;
  if (inGraceWindow(club, ctx.data.checked)) f *= 0.7;
  return f;
}

const eventField = (club: Club, today: string): { event?: string } => {
  const e = eventLine(club, today);
  return e ? { event: e } : {};
};

// ===========================================================================
// The rail's list, and ALMA's with no query
// ===========================================================================

export interface RecommendOptions {
  /** How many picks to compute. The rail shows RAIL_VISIBLE and "Show more" the rest. */
  limit?: number;
  /** The folded communities row; false turns it off (decision 4). */
  communities?: boolean;
  /** At most this many picks per goal in the rotation. */
  perGoal?: number;
  /** The rail's visible count, for the one slot kept for the major. */
  visible?: number;
  /** Keep the last visible slot for the best major club when the goals fill the rest. */
  majorSlot?: boolean;
  /** Only these goal ids (ALMA's `goal`), and only picks for them. */
  only?: string[];
  /** Only picks for a heard goal: no major, word or college fill (a query's list). */
  goalsOnly?: boolean;
  /** Also clubs whose audience is not confirmed, at x0.6 with the caution: ALMA's search only. */
  includeCheck?: boolean;
  today?: Date | string;
}

/**
 * The clubs for one student, best first (DESIGN 3.4).
 *
 *   1. Goals in the order the student named them, at most `perGoal` each, in rounds.
 *   2. When the goals fill the visible rows, the last visible row goes to the
 *      best major club ("For your major": ASME for "design robots").
 *   3. Then the rest by score, still at most `perGoal` a goal, then without
 *      the cap rather than leave rows empty.
 *   4. No goal heard: the major's clubs, then the starter clubs when the
 *      major has fewer than three; `empty` tells the card to ask for a goal.
 *   Identity-centered clubs matched by a heard goal go to `communities`, at
 *   most 3; a major match alone never puts one there, and none is ever in `picks`.
 */
export function recommendClubs(data: IllinoisClubsFile, student: ClubStudent | null, options: RecommendOptions = {}): ClubResult {
  const limit = options.limit ?? 10;
  const perGoal = options.perGoal ?? PER_GOAL;
  const visible = Math.min(options.visible ?? RAIL_VISIBLE, limit);
  const today = dayOf(options.today ?? new Date());
  const careerText = student?.careerText ?? '';
  const ctx = contextFor(data, student, student?.profile ?? null, careerText);
  ctx.includeCheck = Boolean(options.includeCheck);
  if (options.only) {
    ctx.goals = ctx.goals.filter((g) => options.only?.includes(g));
    for (const g of options.only) if (!ctx.goals.includes(g)) ctx.goals.push(g);
    ctx.words = [];
  }
  const goalsOnly = Boolean(options.goalsOnly || options.only);

  let scored = data.clubs.map((c) => scoreClub(c, ctx, today)).filter((x): x is ClubPick => x !== null);
  if (goalsOnly) scored = scored.filter((x) => ctx.goals.includes(x.goal));
  scored.sort(byScore);
  scored = dedupe(scored);

  const general = scored.filter((x) => !x.club.identity);
  // How many clubs fit each goal, whichever goal a club ended up listed under.
  const matched: Record<string, number> = {};
  for (const g of ctx.goals) {
    const one = { ...ctx, goals: [g] };
    matched[g] = dedupe(data.clubs.map((c) => scoreClub(c, one, today)).filter((x): x is ClubPick => x !== null && x.goal === g && !x.club.identity)).length;
  }

  const picks: ClubPick[] = [];
  const count = (g: string) => picks.filter((x) => x.goal === g).length;
  const capped = (x: ClubPick) => ctx.goals.includes(x.goal) && count(x.goal) >= perGoal;
  const take = (x: ClubPick | undefined, cap = true) => {
    if (!x || picks.includes(x) || picks.length >= limit || (cap && capped(x))) return;
    picks.push(x);
  };
  for (let round = 0; round < perGoal; round += 1) for (const g of ctx.goals) take(general.find((y) => y.goal === g && !picks.includes(y)));
  if (options.majorSlot !== false && !goalsOnly && picks.length >= visible && !picks.slice(0, visible).some((x) => x.goal === 'major')) {
    const major = general.find((y) => y.goal === 'major');
    if (major) {
      const at = picks.indexOf(major);
      if (at >= 0) picks.splice(at, 1);
      picks.splice(visible - 1, 0, major);
      picks.length = Math.min(picks.length, limit);
    }
  }
  for (const x of general) take(x);
  for (const x of general) take(x, false);

  const goals = ctx.goals.map((id) => ({ id, label: ctx.label(id) }));
  const thin = ctx.goals.filter((g) => matched[g] < PER_GOAL);
  // Social, Greek and faith clubs never get here: their kind factor is 0.
  const communities = options.communities === false ? [] : scored.filter((x) => x.club.identity && ctx.goals.includes(x.goal)).slice(0, COMMUNITIES);

  let empty: ClubResult['empty'];
  if (!careerText) empty = 'no-words';
  else if (picks.length === 0) empty = ctx.goals.length ? 'no-match' : 'unheard';
  // No goal heard and fewer than three clubs for the major: the starters
  // after them, while the card asks for a goal.
  if (ctx.goals.length === 0 && !options.only && picks.length < PER_GOAL) {
    for (const club of [...data.clubs].filter((c) => c.starter).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (picks.length >= limit || picks.some((x) => x.club.id === club.id)) continue;
      picks.push({ club, score: 0, goal: 'starter', basis: 'starter', why: 'A good first club while you decide', cautions: cautionsOf(club, student, data.checked), ...eventField(club, today) });
    }
  }
  return { goals, picks, communities, thin, matched, ...(empty ? { empty } : {}) };
}

/**
 * Picks grouped the way the rail shows them: one heading per goal in the order
 * named, then "For your major", "From what you wrote" and the starters.
 */
export function groupPicks(result: ClubResult): Array<{ goal: string; heading: string; picks: ClubPick[] }> {
  const order = [...result.goals.map((g) => g.id), 'major', 'words', 'starter', 'search'];
  const labelOf = new Map(result.goals.map((g) => [g.id, g.label]));
  const headings: Record<string, string> = { major: 'For your major', words: 'From what you wrote', starter: 'Good first clubs', search: 'Matches' };
  return order
    .map((goal) => ({ goal, heading: headings[goal] ?? `For ${labelOf.get(goal) ?? goal}`, picks: result.picks.filter((p) => p.goal === goal) }))
    .filter((g) => g.picks.length > 0);
}

// ===========================================================================
// ALMA's find_clubs with a query
// ===========================================================================

/** Words in a query that ask for a kind of group, or for a community. */
interface Ask {
  word: RegExp;
  kinds?: ClubKind[];
  /** A community the student named: these words in a club's name or affiliation. */
  identity?: RegExp;
}
const ASKS: Ask[] = [
  { word: /^(latin[aoxe]s?|latinx|hispanic|chican[ao]s?)$/, identity: /\blatin|\bhispanic|\bchican|\bla casa\b/i },
  { word: /^(black|african)$/, identity: /\bblack\b|\bafrican|\bafro|\bbnaacc\b/i },
  { word: /^(asian|aapi)$/, identity: /\basian|\baacc\b|\bpacific islander/i },
  { word: /^(women|woman|female|girls?)$/, identity: /\bwom[ae]n\b|\bfemale|\bgirls?\b|\bsisters?\b|\bwrc\b/i },
  { word: /^(lgbtq?|queer|gay|lesbian|trans|transgender|nonbinary)$/, identity: /\blgbt|\bqueer|\bgay\b|\blesbian|\btrans|\bgsrc\b|\bpride\b/i },
  { word: /^(first-?gen|firstgen)$/, identity: /\bfirst[-\s]?gen/i },
  { word: /^(native|indigenous)$/, identity: /\bnative|\bindigenous|\bnah\b/i },
  { word: /^(veterans?|military)$/, identity: /\bveteran|\bmilitary/i },
  { word: /^(international)$/, identity: /\binternational/i },
  { word: /^(fraternit(y|ies)|frats?|sororit(y|ies)|greek)$/, kinds: ['greek-social', 'professional-fraternity'] },
  { word: /^(faith|church|religious|religion|christian|catholic|jewish|muslim|islamic|hindu|sikh|buddhist|bible|ministry|spiritual|worship|interfaith)$/, kinds: ['faith'] },
  { word: /^(cultural|culture|heritage)$/, kinds: ['cultural'] },
  { word: /^(sports?|intramurals?|athletic|athletics|recreation|recreational|fitness)$/, kinds: ['sport-recreation'] },
  { word: /^(cappella|acappella|choir|chorus|singing|dance|dancing|theat(er|re)|improv|comedy|band|orchestra|music|musical|performing|performance)$/, kinds: ['arts-performance'] },
  { word: /^(social|hangout|friends)$/, kinds: ['social'] },
  { word: /^(service|volunteer|volunteering|philanthropy)$/, kinds: ['service'] },
  { word: /^(honou?rs?)$/, kinds: ['honor'] },
  { word: /^(media|radio|newspaper|magazine|tv|television|podcast)$/, kinds: ['media'] },
  { word: /^(competition|competitions|competitive|compete)$/, kinds: ['competition-team'] },
  { word: /^(advocacy|activism|political|government)$/, kinds: ['government-advocacy'] },
];
const ASKED_ONLY = new Set<ClubKind>(['social', 'greek-social', 'faith', 'cultural', 'sport-recreation']);

/** A club's name, affiliations or our own line name this community. */
const communityNamed = (club: Club, re: RegExp) => re.test(club.name) || (club.affiliations ?? []).some((a) => re.test(a)) || Boolean(club.does && re.test(club.does));

/** The query's words, a light singular, and what each one asks for. */
function queryWords(query: string): Array<{ word: string; stem: string; ask: Ask | null }> {
  const raw = query.toLowerCase().replace(/a\s+cappella/g, 'cappella').replace(/first[\s-]+gen(eration)?/g, 'first-gen').split(/[^a-z0-9-]+/);
  const out: Array<{ word: string; stem: string; ask: Ask | null }> = [];
  for (const w of raw) {
    const word = w.replace(/^-+|-+$/g, '');
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    if (out.some((x) => x.word === word)) continue;
    const stem = word.length > 4 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
    out.push({ word, stem, ask: ASKS.find((a) => a.word.test(word)) ?? null });
  }
  return out;
}

interface Hit { v: number; why: string }

/** The best way one query word fits one club, or null. */
function wordHit(club: Club, q: { word: string; stem: string; ask: Ask | null }, sourceName: string): Hit | null {
  const re = new RegExp(`\\b${escapeRe(q.stem)}`, 'i');
  const hits: Hit[] = [];
  if (re.test(club.name)) hits.push({ v: 1, why: `Its name matches "${q.word}"` });
  if (q.ask?.identity) {
    if (q.ask.identity.test(club.name)) hits.push({ v: 0.95, why: `Its name matches "${q.word}"` });
    const aff = (club.affiliations ?? []).find((a) => q.ask?.identity?.test(a));
    if (aff) hits.push({ v: 0.85, why: `Affiliated with ${aff}` });
    if (club.identity && club.does && q.ask.identity.test(club.does)) hits.push({ v: 0.8, why: `Its ${sourceName} page describes a ${q.word} community` });
  }
  const aff = (club.affiliations ?? []).find((a) => re.test(a));
  if (aff) hits.push({ v: 0.8, why: `Affiliated with ${aff}` });
  if (q.ask?.kinds?.includes(club.kind)) hits.push({ v: 0.8, why: `${article(KIND_LABEL[club.kind])} ${KIND_LABEL[club.kind].toLowerCase()}` });
  const cat = club.categories.find((c) => re.test(c));
  if (cat) hits.push({ v: 0.7, why: `Listed under ${cat} in ${sourceName}` });
  if (club.does && re.test(club.does)) hits.push({ v: 0.6, why: `Its ${sourceName} page describes ${q.word}` });
  if (hits.length === 0) return null;
  return hits.sort((a, b) => b.v - a.v)[0];
}

/**
 * ALMA's find_clubs with the student's own words (DESIGN 4.2).
 *
 *   - The query is read by the same goal reader first: "pre-law" or
 *     "consulting" ranks exactly like the rail does for that goal.
 *   - Otherwise its words are matched against the club's name, affiliations,
 *     categories, kind and our own `does` line.
 *   - Social, faith, cultural, Greek and sport groups come back only when the
 *     query asks for that kind of group ("fraternity", "faith") or names the
 *     club ("chess"); identity-centered ones only when it asks for that
 *     community or kind of group ("Latina", "sorority").
 *   - Graduate, law-school and office groups are not in the file at all.
 */
export function searchClubs(data: IllinoisClubsFile, query: string, student: ClubStudent | null, options: { limit?: number; today?: Date | string } = {}): ClubResult {
  const limit = options.limit ?? 6;
  const today = dayOf(options.today ?? new Date());
  const words = queryWords(query);
  const asksCommunity = words.some((w) => w.ask?.identity);
  const hear = student?.hear;
  const profile = hear ? hear(query) : null;
  if (profile && student && (profile.tracks.length > 0 || profile.heard.length > 0)) {
    const asked: ClubStudent = { ...student, careerText: query, profile };
    const r = recommendClubs(data, asked, { limit, goalsOnly: true, communities: asksCommunity, includeCheck: true, today: options.today });
    if (asksCommunity) {
      // The community the student named first ("Latina finance": SHPE before NSBE); the field's others when none names it.
      const named = r.communities.filter((x) => words.some((w) => w.ask?.identity && communityNamed(x.club, w.ask.identity)));
      r.communities = named.length ? named : r.communities;
    }
    if (r.picks.length > 0 || r.communities.length > 0) return r;
  }

  const empty: ClubResult = { goals: [], picks: [], communities: [], thin: [], matched: {}, empty: 'no-match' };
  if (words.length === 0) return empty;
  const kindsAsked = new Set(words.flatMap((w) => w.ask?.kinds ?? []));
  const scored: Array<{ pick: ClubPick; n: number }> = [];
  for (const club of data.clubs) {
    // Identity-centered clubs only when the student asks for that community or kind of group.
    if (club.identity && !asksCommunity && !kindsAsked.has(club.kind)) continue;
    const hits = words.map((w) => wordHit(club, w, data.source.name));
    const found = hits.filter((h): h is Hit => h !== null);
    if (found.length === 0) continue;
    // A community the student named is a requirement, not one word among others:
    // "Latina business" is not answered by another community's business club.
    if (asksCommunity && !words.some((w, i) => w.ask?.identity && hits[i] !== null)) continue;
    // Kinds never picked from career words come back when asked for by kind ("fraternity",
    // "faith") or by name ("chess" finds the Chess Club).
    const namedIt = words.some((w) => new RegExp(`\\b${escapeRe(w.stem)}`, 'i').test(club.name));
    if (ASKED_ONLY.has(club.kind) && !kindsAsked.has(club.kind) && !(asksCommunity && club.kind === 'cultural') && !namedIt) continue;
    const sum = found.reduce((n, h) => n + h.v, 0);
    const score = (sum / words.length) * conditionFactor(club, { calendarRead: Boolean(data.calendar), data });
    const why = clip([...new Set(found.sort((a, b) => b.v - a.v).map((h) => h.why))].slice(0, 2).map((w, i) => (i === 0 ? w : w.charAt(0).toLowerCase() + w.slice(1))).join('; '));
    scored.push({ n: found.length, pick: { club, score, goal: 'search', basis: 'search', why, cautions: cautionsOf(club, student, data.checked), ...eventField(club, today) } });
  }
  if (scored.length === 0) return empty;
  const most = Math.max(...scored.map((x) => x.n));
  const picks = dedupe(scored.filter((x) => x.n === most).map((x) => x.pick).sort(byScore)).slice(0, limit);
  return { goals: [], picks, communities: [], thin: [], matched: {} };
}
