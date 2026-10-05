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
    /** noLink: a club whose only link was a placeholder (example.com) and the calendar named no profile for it. */
    dropped: { office: number; graduate: number; law: number; medical: number; veterinary: number; hidden?: number; noLink?: number };
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
  /**
   * The majors it is for, when its subject is shared by several (HK holds
   * Kinesiology and Community Health; FSHN holds Food Science, Hospitality
   * Management and the nutrition majors). Set by hand in overrides.json. With
   * it, the subject counts only for a student in one of these majors.
   */
  majors?: string[];
  /** programs.json college codes: 'engineering'. */
  colleges?: string[];
  lists?: number[];
  /** At most 20 words, ours, from the reading pass. */
  does?: string;
  /** Its directory description is under 15 words. */
  thin?: true;
  /**
   * Shown to a student with no goal yet. 'undeclared': only to a student with
   * no major yet (the Exploratory Students Association is the Division of
   * Exploratory Studies' group), never to a declared major.
   */
  starter?: true | 'undeclared';
  events?: ClubEvents;
  firstSeen: string;
  /** Earlier than the file's `checked` means it is in the grace window. */
  lastSeen: string;
}

// ===========================================================================
// The student
// ===========================================================================

/**
 * Goal names, for why lines about a goal the student did not name (the parent
 * of a family); and a topic's subjects, so a student with no goal heard sees
 * the clubs of their major's field (marketing clubs for an Advertising major).
 */
export interface GoalVocabulary {
  tracks: Array<Pick<CareerTrack, 'id' | 'name'>>;
  topics: Array<Pick<InterestTopic, 'id' | 'label'> & { subjects?: string[] }>;
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
  /**
   * The goal id this pick is under, or 'major', 'words', 'search'; 'starter'
   * (a first club, for a student who is deciding or wrote nothing) or
   * 'general' (a starter shown to a student whose goal the planner does not
   * know: labelled general, never "while you decide").
   */
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
  /**
   * Identity-centered clubs matched by a heard goal: the folded "Communities in
   * these fields" row. A club for a community the student says they belong to
   * ("I'm a first-gen Latina student") is in `picks` instead.
   */
  communities: ClubPick[];
  /** Goals with fewer than 3 matching clubs: the card says so and links the directory. */
  thin: string[];
  /** How many clubs matched each heard goal (0.5 or more), communities and clubs named for a whole family of goals aside. */
  matched: Record<string, number>;
  /** For a thin goal: how many of its own clubs are in `communities` (thinNote counts them), when any are. */
  communityMatched?: Record<string, number>;
  /**
   * 'no-words': nothing written (or ALMA cleared it); 'unheard': words, but no
   * goal the planner knows and no major match; 'no-match': goals heard, and no
   * club for them or the major.
   */
  empty?: 'no-words' | 'unheard' | 'no-match';
  /**
   * The student's words say they are still deciding ("I have no idea yet",
   * "undecided") and name no goal. The card says so instead of "nothing
   * matched": the starter clubs are for exploring, which is what they asked.
   */
  undecided?: true;
  /**
   * Words that name a goal the planner does not know ("work for a nonprofit
   * that helps kids") and do not say the student is still deciding. The card
   * says so plainly above the list, which holds the clubs whose own facts
   * match their words, then their major's, then general clubs.
   */
  unknownGoal?: true;
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
  // No goal heard: words the student wrote are in its name (0.75), or in our own line about it or its
  // directory categories (WORDS_FACTS, 0.65); +0.05 when two or more of their words are (WORDS_MORE).
  words: 0.75,
  reading: 0.5, // the reading pass found the goal in its page, and a directory category agrees
  'degree-subject': 0.45, // another subject of the degree
  college: 0.3, // the student's college: its affiliation tag or a college list
};
export const AGREE_BONUS = 0.15; // two different kinds of evidence agree
/** It fits two or more of the goals the student named: "climate policy" and an advocacy group for the climate. */
export const GOALS_AGREE_BONUS = 0.15;
export const SPECIFIC_BONUS = 0.05; // named for this goal and at most one other
export const NATIONAL_BONUS = 0.03; // a chapter of a national body
export const UMBRELLA_PENALTY = 0.1; // named for 5+ goals: the club for this goal alone comes first
export const WORDS_FACTS = 0.65; // no goal heard: the student's words in our `does` line or its categories, not its name
export const WORDS_MORE = 0.05; // ... two or more of their words, not one
export const WORDS_CLOSE = 0.05; // ... only words close to theirs ("children" for "kids"), none of their own
/** No goal heard: a club tagged for a topic whose subjects include the major (a marketing club for Advertising). */
export const MAJOR_FIELD = 0.65;
/** A goal heard: each specific word of theirs in a club's facts adds this, at most twice, after the cutoff; a tiebreak only. */
export const WORDS_TIE = 0.02;
/**
 * How specific a word is, by how many clubs' facts (name, `does`, categories)
 * hold it: in at most SPECIFIC_DF it counts 1, in at most COMMON_DF it counts
 * a half, and in more ("research" is in 47) it never counts. A club matches
 * the student's words when they add up to 1: one specific word, or two common
 * ones, never one generic word.
 */
export const SPECIFIC_DF = 20;
export const COMMON_DF = 30;
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
/**
 * Siblings close enough to rank with the goal's own clubs, ahead of clubs for
 * the whole field. Investment banking and markets recruit through the same
 * investing clubs: stock pitches, valuation and financial models, the skills
 * the investment-banking topic itself hears ("valuation", "financial
 * modeling"). The why line still says "close to": an equity research club is
 * not an investment banking club. A finance club for the whole field (fintech,
 * quant) and the farther siblings (real estate, insurance) come after them.
 */
export const NEAR_SIBLINGS: Record<string, string[]> = { 'investment-banking': ['markets'], markets: ['investment-banking'] };

/**
 * Policy and politics are what a club does, so the directory's activity
 * categories and the government-and-advocacy kind say a club fits them; a
 * field category ("Business", "Health") is too broad to say a club fits a
 * goal. Used only to count how many of the student's goals a club fits
 * (GOALS_AGREE_BONUS): an environmental advocacy group fits "climate policy"
 * twice, a fisheries society once.
 */
const ACTIVITY_GOALS: Record<string, string[]> = {
  'Ideology & Politics': ['public-policy', 'politics'],
  'Advocacy & Activism': ['public-policy'],
  'Student Governance & Councils': ['politics'],
};
const KIND_GOALS: Partial<Record<ClubKind, string[]>> = { 'government-advocacy': ['public-policy', 'politics'] };

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

/**
 * Words that say the student has not chosen yet. Read only when no goal is
 * heard: "not sure between pre-med and pre-PT" names two goals and is not
 * undecided here.
 */
const UNDECIDED =
  /\b(undecided|undeclared|unsure|indecisive|no idea|no clue|(not sure|not certain|don'?t know|do not know)(?=\s*(yet|what|which|where|about|$|[.,;!?]))|not decided|haven'?t decided|have not decided|still deciding|still figuring|figur(e|ing) (it|that|things) out|dunno|idk|exploring|explore my options|open to anything|keep(ing)? my options open)\b/i;

/** True when the words say the student is still deciding (UNDECIDED). */
export const soundsUndecided = (careerText: string): boolean => UNDECIDED.test(careerText);

/** A starter's why line for a student still deciding or with no words, and for one whose goal the planner does not know. */
export const STARTER_WHY = 'A good first club while you decide';
export const GENERAL_WHY = 'A general club for any student, not matched to your goal';

// ===========================================================================
// Clubs named for a whole family of goals
// ===========================================================================

/** Every health track but pre-law and pre-vet, plus nursing: the goals a general pre-health club carries (tag.mjs HEALTH_TRACKS). */
const HEALTH_GOAL = /^(pre-(?!law$|veterinary$)[a-z-]+|nursing)$/;
const BUSINESS_GOALS = new Set(['finance', 'consulting', 'accounting', 'marketing']);
export const PRE_HEALTH_WHY = 'A pre-health club for students heading to health professions';
export const BUSINESS_FRATERNITY_WHY = 'A professional business fraternity, for students heading into business careers';

/**
 * What a club named for a whole family of goals is, for its why line, or
 * null. A general pre-health club carries every health track (from its name,
 * a national row or an override), and a business fraternity's national row
 * names four business fields; neither is "about nursing" or "a finance club",
 * so the line says what the club is (review, 2026-10-05). Any other national
 * row with two or more goals names the chapter and its fields. Goals from a
 * list or the reading pass do not count: they are about this club alone.
 */
export function familyLine(club: Club, label: (id: string) => string): string | null {
  const own = club.goals.filter((g) => g.from !== 'reading' && g.from !== 'list');
  if (own.filter((g) => HEALTH_GOAL.test(g.id)).length >= 5) return PRE_HEALTH_WHY;
  const national = own.filter((g) => g.from === 'national');
  if (national.length < 2) return null;
  if (club.kind === 'professional-fraternity' && national.every((g) => BUSINESS_GOALS.has(g.id))) return BUSINESS_FRATERNITY_WHY;
  const fields = national.map((g) => label(g.id));
  return chapterLine(club, (body) => `The ${body} chapter, for students heading into ${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}`);
}

/**
 * How a why line names a club's national body. Its letters when the club's
 * own name uses them ("ALPFA Illinois"); otherwise the body's name as the
 * club's name gives it, without the campus and "Student Chapter": "National
 * Band Association", never "NBA", which reads as basketball (spot check,
 * round 2). A student sees letters they cannot place as often as not.
 */
export function nationalName(club: Pick<Club, 'name' | 'national'>): string {
  const letters = club.national ?? club.name;
  if (!club.national || new RegExp(`\\b${escapeRe(club.national)}\\b`, 'i').test(club.name)) return letters;
  // "National Band Association, UIUC Collegiate Chapter": the comma before the campus or chapter ends the body's
  // name; a comma inside it ("Heating, Refrigeration & Air-Conditioning") does not.
  const spelled = club.name
    .split(/\s+[–—-]\s+|\s+\/\s+/)[0]
    .replace(/,\s*(uiuc|u of i|university|illinois|urbana|collegiate|student|chapter)\b.*$/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+(at|of)\s+(the\s+)?(university of illinois|uiuc|u of i)\b.*$/i, '')
    .replace(/\s+(uiuc|university of illinois)\b.*$/i, '')
    .replace(/\s+(student\s+)?(chapter|section|branch|subunit)\b.*$/i, '')
    .trim();
  return spelled || letters;
}

/** A line naming the national body spelled out (nationalName), or by its letters when that would run past WHY_MAX. */
function chapterLine(club: Club, line: (body: string) => string): string {
  const spelled = line(nationalName(club));
  return spelled.length <= WHY_MAX ? spelled : line(club.national ?? club.name);
}

// ===========================================================================
// The student's own words, against a club's facts
// ===========================================================================

/**
 * Words that say nothing about which club fits, on top of STOPWORDS: roles
 * and titles ("director" found the National Band Association's band
 * directors for an ad agency's creative director), family ("my sister is
 * pre-law"), and the verbs of a goal sentence.
 */
const WORD_STOP = new Set([
  'work', 'works', 'worked', 'job', 'jobs', 'play', 'playing', 'help', 'helps', 'helping', 'make', 'making', 'doing', 'get', 'got',
  'director', 'directors', 'manager', 'managers', 'analyst', 'analysts', 'officer', 'executive', 'assistant', 'associate', 'coordinator',
  'specialist', 'lead', 'leader', 'leaders', 'head', 'chief', 'owner', 'founder', 'intern', 'internship', 'internships', 'position', 'role',
  'firm', 'firms', 'companies', 'big', 'small', 'top', 'pro', 'careers', 'field', 'fields', 'industry', 'day', 'life', 'kind', 'lot', 'lots',
  'love', 'hope', 'plan', 'plans', 'dream', 'goal', 'goals', 'future', 'graduation', 'degree', 'major', 'minor', 'college', 'class', 'classes',
  'course', 'courses', 'sister', 'brother', 'mom', 'mother', 'dad', 'father', 'parent', 'parents', 'friend', 'friends', 'cousin', 'aunt',
  'uncle', 'roommate', 'girlfriend', 'boyfriend', 'family', 'pre', 'non', 'new', 'own', 'way', 'well', 'too', 'very', 'much', 'many',
  'who', 'why', 'was', 'were', 'will', 'did', 'does', 'all', 'but', 'its', 'his', 'her', 'she', 'him', 'they', 'them', 'use', 'run',
  'people', 'person', 'actually', 'anymore', 'instead', 'either', 'both', 'year', 'something', 'someone', 'things', 'stuff', 'place',
  // Words a goal sentence uses that club lines also use in passing, and that are in too few of them for the
  // count to rule out (review, 2026-10-05): "make money" found seven charities that raise money, "open a
  // bakery" a tango club open to beginners, "travel the world" teams that travel to competitions.
  'open', 'opening', 'money', 'earn', 'earning', 'pay', 'paid', 'salary', 'rich', 'wealthy', 'change', 'changes', 'changing',
  'difference', 'impact', 'matter', 'travel', 'travels', 'traveling', 'travelling', 'remote', 'remotely', 'home', 'office', 'desk',
  'outside', 'fun', 'real', 'full', 'time', 'success', 'successful', 'opportunity', 'opportunities', 'connections', 'area', 'areas',
  'related', 'save', 'saving', 'live', 'lives', 'living', 'grow', 'growing', 'global', 'country', 'city', 'state', 'states', 'united',
  'america', 'public', 'coach', 'coaching', 'personal', 'becoming',
]);

/**
 * Words the stem would fold into another word: "planes" into "plan", "news"
 * into "new", "anime" into "animal", "minority" into "minor". Kept apart.
 */
const KEEP_APART: Record<string, string> = {
  plane: 'plane',
  planes: 'plane',
  news: 'news',
  anime: 'anime',
  minority: 'minorit',
  minorities: 'minorit',
};

/** Short forms and irregular words, as the stems they stand for. Applied to a club's facts as to the student's words. */
const WORD_FORMS: Record<string, string[]> = {
  ad: ['advertis'],
  ads: ['advertis'],
  kid: ['child', 'youth'],
  kids: ['child', 'youth'],
  children: ['child'],
  childhood: ['child'],
};

/**
 * A light English stem: plurals, then one derivational ending, then a final
 * e, a or y, so "musicians" and "musical" are "music", "orchestral" and
 * "orchestra" one word, "advertising" and "advertisement" one word, and
 * "policy" never "police".
 */
export function stem(word: string): string {
  let s = word.toLowerCase();
  if (WORD_FORMS[s]) return WORD_FORMS[s][0];
  if (KEEP_APART[s]) return KEEP_APART[s];
  if (s.length <= 3) return s;
  if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (/(sh|ch|x|z|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (/[^su]s$/.test(s) && !s.endsWith('is')) s = s.slice(0, -1);
  const endings: Array<[string, string]> = [
    ['ization', 'ize'], ['ational', 'ate'], ['ation', 'ate'], ['ments', ''], ['ment', ''], ['ings', ''], ['ing', ''], ['ians', ''], ['ian', ''],
    ['ists', ''], ['ist', ''], ['ical', 'ic'], ['ance', ''], ['ence', ''], ['ant', ''], ['ent', ''], ['ers', ''], ['er', ''], ['ed', ''],
    ['ive', ''], ['ity', ''], ['ness', ''], ['al', ''],
  ];
  for (const [end, put] of endings) {
    if (s.endsWith(end) && s.length - end.length + put.length >= 4) {
      s = s.slice(0, -end.length) + put;
      break;
    }
  }
  if (s.length > 4 && /[eay]$/.test(s)) s = s.endsWith('y') ? `${s.slice(0, -1)}i` : s.slice(0, -1);
  return s;
}

/** A text's words, lower case, "non-profit" as one word. */
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/\bnon[-\s]+(profit)/g, 'non$1')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);

const stemsOf = (word: string): string[] => WORD_FORMS[word] ?? [stem(word)];

/**
 * Words with a common sense that has nothing to do with a goal, in the
 * phrases that give that sense away: "a pilot plant" or "a pilot program" is
 * not flying, and "a space for ace students", "a welcoming space" or "Product
 * Space" is not outer space. In a club's facts the word is dropped there, so
 * "become a pilot" no longer finds a biodiesel club and "work in space" no
 * longer finds a comedy club (review, 2026-10-05). Where the word means the
 * goal ("drone pilots", "the Illinois Space Society") it still counts. The
 * other word of the phrase stays.
 */
const OTHER_SENSE: Array<[RegExp, string]> = [
  [/\bpilot(s|ed|ing)?(?=[\s-]+(plant|plants|program|programs|project|projects|study|studies|test|tests|testing|phase|run|runs|scale|site|sites|course|courses|class|classes|episode|episodes|cohort|cohorts|year)\b)/gi, ' '],
  [/\b(safe|safer|shared|inclusive|welcoming|brave|open|creative|collaborative|community|campus|third|maker|makers|study|work|working|practice|rehearsal|living|green|physical|virtual|online|meeting|event|events|social|common|white|blank|product|design|supportive|comfortable|positive|dedicated|quiet|judgment-free|judgement-free)([\s-]+)spaces?\b/gi, '$1$2'],
  [/\bspaces?(?=\s+(for|to|where|in which|that|of belonging)\b)/gi, ' '],
];
/** A club's own facts with the other-sense words taken out (OTHER_SENSE). */
export const withoutOtherSense = (text: string): string => OTHER_SENSE.reduce((t, [re, put]) => t.replace(re, put), text);

/** One word of the student's, with the stems it matches. */
export interface StudentWord {
  word: string;
  stems: string[];
}

/**
 * The words of the student's goal sentence worth matching against a club's
 * facts: not a stop word, not a role or a relative, and not a word the goal
 * reader hears as a goal on its own. The last keeps out a goal the reader set
 * aside on purpose: "my sister is pre-law" hears no goal, and "law" must not
 * come back as a word match.
 */
export function studentWords(text: string, hear?: (t: string) => InterestProfile): StudentWord[] {
  const out: StudentWord[] = [];
  for (const word of tokens(text)) {
    if (out.some((w) => w.word === word)) continue;
    if (STOPWORDS.has(word) || WORD_STOP.has(word)) continue;
    if (!WORD_FORMS[word] && word.length < 3) continue;
    if (hear) {
      const p = hear(word);
      if (p.tracks.length > 0 || p.heard.length > 0) continue;
    }
    out.push({ word, stems: stemsOf(word) });
  }
  return out;
}

interface FactWord {
  /** The word as the club's facts have it. */
  form: string;
  where: 'name' | 'does' | 'category';
  category?: string;
}
interface FactIndex {
  /** How many clubs' facts hold each stem. */
  df: Map<string, number>;
  /** Club id -> stem -> where it first appears: the name, then our `does` line, then a category. */
  byClub: Map<string, Map<string, FactWord>>;
}
const FACTS = new WeakMap<IllinoisClubsFile, FactIndex>();

/** The stems of every club's name, `does` line and categories, built once per file. */
function factIndex(data: IllinoisClubsFile): FactIndex {
  const had = FACTS.get(data);
  if (had) return had;
  const df = new Map<string, number>();
  const byClub = new Map<string, Map<string, FactWord>>();
  for (const club of data.clubs) {
    const own = new Map<string, FactWord>();
    const add = (text: string, where: FactWord['where'], category?: string) => {
      for (const form of tokens(text)) for (const s of stemsOf(form)) if (!own.has(s)) own.set(s, { form, where, ...(category ? { category } : {}) });
    };
    add(withoutOtherSense(club.name), 'name');
    if (club.does) add(withoutOtherSense(club.does), 'does');
    for (const c of club.categories) add(c, 'category', c);
    byClub.set(club.id, own);
    for (const s of own.keys()) df.set(s, (df.get(s) ?? 0) + 1);
  }
  const index = { df, byClub };
  FACTS.set(data, index);
  return index;
}

/**
 * Directory categories that name a field (tag.mjs FIELD), plus Performance
 * Arts, the field of a music or theatre major's own clubs. A word match
 * counts as in the student's field when the club shares one of these with
 * the clubs of their major: "bridges" for a Civil Engineering student is
 * Steel Bridge, not the Life-Line Bridge Foundation, a charity.
 */
const FIELD_CATEGORIES = new Set([
  'Agricultural', 'Business', 'Education, Pedagogy & Instruction', 'Environmental & Sustainability', 'Health & Human Sciences', 'Humanities',
  'Information & Data Sciences', 'Law', 'Life & Physical Sciences', 'Media Arts', 'Social & Behavioral Sciences',
  'Technology, Engineering & Mathematics', 'Veterinary', 'Performance Arts',
]);

/** The field categories of the clubs about the student's major (its subject, or on its department's list). */
function majorFieldsOf(data: IllinoisClubsFile, primary: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!primary) return out;
  for (const club of data.clubs) {
    const about = club.subjects?.includes(primary) || (club.lists ?? []).some((i) => data.lists[i]?.subject === primary);
    if (about) for (const c of club.categories) if (FIELD_CATEGORIES.has(c)) out.add(c);
  }
  return out;
}

/** How much one stem counts, by how many clubs hold it. */
const specificity = (df: number): number => (df <= SPECIFIC_DF ? 1 : df <= COMMON_DF ? 0.5 : 0);

interface WordsMatch {
  /** The weights added up: 1 or more is a match. */
  weight: number;
  /** One of their words is in the club's name. */
  inName: boolean;
  found: Array<{ word: string; fact: FactWord }>;
}

/** The student's words in one club's facts, or null when none counts. */
function wordsMatch(club: Club, words: StudentWord[], index: FactIndex): WordsMatch | null {
  const facts = index.byClub.get(club.id);
  if (!facts || words.length === 0) return null;
  let weight = 0;
  let inName = false;
  const found: WordsMatch['found'] = [];
  for (const w of words) {
    let best: { v: number; fact: FactWord } | null = null;
    for (const s of w.stems) {
      const fact = facts.get(s);
      if (!fact) continue;
      const v = specificity(index.df.get(s) ?? 0);
      if (v > 0 && (!best || v > best.v)) best = { v, fact };
    }
    if (!best) continue;
    weight += best.v;
    if (best.fact.where === 'name') inName = true;
    found.push({ word: w.word, fact: best.fact });
  }
  return found.length ? { weight, inName, found } : null;
}

/** "from what you wrote" when the club's word is the student's, "close to what you wrote" for "children" against "kids". */
const sameWord = (a: string, b: string) => a === b || (!WORD_FORMS[a] && !WORD_FORMS[b] && stem(a) === stem(b));
const fromWhat = (found: WordsMatch['found']) => (found.every((f) => sameWord(f.fact.form, f.word)) ? 'from what you wrote' : 'close to what you wrote');

/** The why line for a words match: the club's own words, quoted, and where they are. */
function wordsWhy(m: WordsMatch, sourceName: string): string {
  const inName = m.found.filter((f) => f.fact.where === 'name');
  if (inName.length) return `Its name has "${inName[0].fact.form}", ${fromWhat(inName.slice(0, 1))}`;
  const inDoes = m.found.filter((f) => f.fact.where === 'does').slice(0, 2);
  if (inDoes.length) return `Its ${sourceName} page mentions ${inDoes.map((f) => `"${f.fact.form}"`).join(' and ')}, ${fromWhat(inDoes)}`;
  const cat = m.found[0].fact.category ?? m.found[0].fact.form;
  return `Listed under ${cat} in ${sourceName}, ${fromWhat(m.found.slice(0, 1))}`;
}

// ===========================================================================
// Small helpers
// ===========================================================================

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const article = (phrase: string) => (/^[aeiou]/i.test(phrase) ? 'An' : 'A');
/**
 * A kind as a noun phrase for a why line: "a service club", "an arts and
 * performance group". Four KIND_LABELs are field names, not nouns, and read
 * "An arts and performance" on their own.
 */
const KIND_NOUN: Partial<Record<ClubKind, string>> = {
  'arts-performance': 'arts and performance group',
  media: 'student media group',
  'government-advocacy': 'government and advocacy group',
  'sport-recreation': 'sport and recreation club',
};
const kindPhrase = (kind: ClubKind) => {
  const noun = KIND_NOUN[kind] ?? KIND_LABEL[kind].toLowerCase();
  return `${article(noun)} ${noun}`;
};

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

/** Goal words the planner hears, for the card that heard none. */
export const EXAMPLE_GOALS = ['pre-law', 'consulting', 'data science', 'journalism'];

/**
 * The card's words above the list when there is no goal to show clubs for
 * (DESIGN 4.1), or null when the list speaks for itself. A student who says
 * they are still deciding is told the list is for exploring, not that their
 * words "matched nothing": not having chosen is an answer, not a miss. A
 * student who named a goal the planner does not know is told so plainly, and
 * where the clubs below came from instead.
 */
export function emptyNote(result: Pick<ClubResult, 'empty' | 'undecided' | 'unknownGoal'> & { picks?: Array<Pick<ClubPick, 'goal'>> }, careerText: string): string | null {
  if (result.empty === 'no-words') return 'Say what you want to do after you graduate, and clubs for it show up here.';
  // Before the 'unheard' test: a student with a major gets its clubs, so `empty` is unset, and is still
  // deciding all the same (find_clubs tells ALMA so whenever `undecided` is set).
  if (result.undecided) return 'You said you are still deciding, so here are clubs for exploring. When a goal comes to mind, add it and clubs for it show up here.';
  if (result.empty !== 'unheard' && !result.unknownGoal) return null;
  const words = careerText.length > 60 ? `${careerText.slice(0, 57).trimEnd()}...` : careerText;
  const examples = `${EXAMPLE_GOALS.slice(0, -1).map((w) => `“${w}”`).join(', ')} or “${EXAMPLE_GOALS[EXAMPLE_GOALS.length - 1]}”`;
  const from = new Set((result.picks ?? []).map((p) => p.goal));
  if (result.empty === 'unheard' || (!from.has('words') && !from.has('major'))) {
    return `Nothing in “${words}” matched a goal the planner knows yet. Words like ${examples} work.`;
  }
  const below = from.has('words') && from.has('major') ? 'match your own words or your major' : from.has('words') ? 'match your own words' : 'are for your major';
  return `The planner does not know “${words}” as a goal yet, so the clubs below ${below}. Goal words like ${examples} bring clubs for a goal.`;
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
export function thinNote(data: Pick<IllinoisClubsFile, 'source'>, label: string, matched: number, inCommunities = 0): { text: string; link: string; href: string } {
  // Clubs for the goal that are centered on one community sit in the folded row; the count says so, so a
  // student who opens it is not told "only 2" and then finds 4 (spot check, round 2).
  // With none of its own, "No club ... yet, plus 2" would contradict itself: "except 2" (review, round 3).
  const plus = inCommunities > 0 ? `, ${matched === 0 ? 'except' : 'plus'} ${inCommunities} in “${COMMUNITIES_HEADING}” below` : '';
  const text = matched === 0
    ? `No club in ${data.source.name} matched ${label} yet${plus}.`
    : `Only ${matched} ${matched === 1 ? 'club' : 'clubs'} in ${data.source.name} matched ${label}${plus}.`;
  return { text, link: matched === 0 ? 'Browse every club' : 'Browse them all', href: data.source.url };
}

/** The folded row's heading, as the rail shows it (without its count). */
export const COMMUNITIES_HEADING = 'Communities in these fields';

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
  /** A near sibling (NEAR_SIBLINGS): ranks with the goal's own clubs. */
  near?: true;
}

/**
 * Where a goal pick stands in its goal's list, before its score:
 *   1  the goal's own clubs: named for it, on a list for it, covered by the
 *      track, or a near sibling (NEAR_SIBLINGS);
 *   2  weaker or wider evidence: the reading pass alone, the wider field (a
 *      finance club for investment banking) and farther siblings (a real
 *      estate club);
 *   3  clubs named for a whole family of goals (familyLine): general
 *      pre-health clubs, business fraternities, multi-goal national chapters.
 * Order: tier 3 last; then the clubs fitting more of the student's goals
 * (`fits`; "climate policy": an advocacy group read as climate before a
 * fisheries society named for it); then the tier; then the score. So a
 * business fraternity never takes a row from the M&A club, and the pre-PT
 * club and the nursing clubs lead their lists (spot check, round 2). Picks
 * that are not for a goal (major, words) rank as tier 1, fits 1.
 */
interface Rank {
  tier: 1 | 2 | 3;
  fits: number;
}
const RANKS = new WeakMap<ClubPick, Rank>();
const rankOf = (x: ClubPick): Rank => RANKS.get(x) ?? { tier: 1, fits: 1 };
/** The order of picks within a goal (Rank), with `rank` read from a map the caller may adjust. */
const rankOrder = (rank: (x: ClubPick) => Rank) => (a: ClubPick, b: ClubPick) => {
  const ra = rank(a);
  const rb = rank(b);
  return Number(ra.tier === 3) - Number(rb.tier === 3) || rb.fits - ra.fits || ra.tier - rb.tier || byScore(a, b);
};
const byRank = rankOrder(rankOf);

interface Context {
  data: IllinoisClubsFile;
  student: ClubStudent | null;
  goals: string[];
  tracks: Set<string>;
  covered: string[];
  coveredBy: Map<string, string>;
  label: (id: string) => string;
  /** The student's own words worth matching (studentWords): evidence when no goal is heard, a tiebreak when one is. */
  words: StudentWord[];
  facts: FactIndex;
  /** Clubs whose facts match the student's words, in their field, when no goal is heard: they come first. */
  wordHits: Set<string>;
  /** The field categories of the major's own clubs (majorFieldsOf); empty when it has none. */
  majorFields: Set<string>;
  /** Topic id -> the subjects it is about, from the vocabulary. */
  topicSubjects: Map<string, string[]>;
  calendarRead: boolean;
  /** Clubs whose audience is not confirmed ('check'): only for ALMA's search, never the rail. */
  includeCheck: boolean;
}

function contextFor(data: IllinoisClubsFile, student: ClubStudent | null, profile: InterestProfile | null, careerText: string): Context {
  const g = profile ? goalsOf(profile) : { goals: [], tracks: new Set<string>(), covered: [], coveredBy: new Map<string, string>() };
  const words = careerText ? studentWords(careerText, student?.hear) : [];
  const topicSubjects = new Map((student?.vocabulary?.topics ?? []).filter((t) => t.subjects?.length).map((t) => [t.id, t.subjects as string[]]));
  return {
    data,
    student,
    ...g,
    label: labeller(student),
    words,
    facts: factIndex(data),
    wordHits: new Set<string>(),
    majorFields: g.goals.length ? new Set<string>() : majorFieldsOf(data, student?.primary),
    topicSubjects,
    calendarRead: Boolean(data.calendar),
    includeCheck: false,
  };
}

/**
 * Goal evidence, with the why line a club named for a whole family of goals
 * needs: a general pre-health club is "A pre-health club ...", never "About
 * nursing"; a business fraternity is one, never "a finance club" (familyLine).
 * A university office's list says what it says.
 */
function goalEvidence(club: Club, named: Set<string>, read: Set<string>, ctx: Context): (Evidence & { general?: true }) | null {
  const ev = goalEvidenceOf(club, named, read, ctx);
  if (!ev || ev.basis === 'list') return ev;
  const family = familyLine(club, ctx.label);
  return family ? { ...ev, why: family, general: true } : ev;
}

/**
 * How many of the student's goals a club fits: tagged for it (any source), or,
 * for policy and politics, an activity category or the advocacy kind that
 * says it does that work (ACTIVITY_GOALS). 1 when the student named one goal.
 */
function goalsFitted(club: Club, goals: string[]): number {
  if (goals.length < 2) return 1;
  const tagged = new Set(club.goals.map((g) => g.id));
  const doing = new Set([...club.categories.flatMap((c) => ACTIVITY_GOALS[c] ?? []), ...(KIND_GOALS[club.kind] ?? [])]);
  return Math.max(1, goals.filter((g) => tagged.has(g) || doing.has(g)).length);
}

/** Goal evidence: the student's own goals first, in the order named. */
function goalEvidenceOf(club: Club, named: Set<string>, read: Set<string>, ctx: Context): Evidence | null {
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
  // The wider field says what the club is and that it is close, never that one field "is part of" the other:
  // a data science club is not part of software engineering (spot check, round 2).
  for (const g of goals) {
    const parent = FAMILY_PARENT.get(g);
    if (parent && named.has(parent)) {
      return { v: EVIDENCE.family, kind: 'goal', basis: 'family', goal: g, why: `${article(label(parent))} ${label(parent)} club, close to ${label(g)}` };
    }
    const child = GOAL_FAMILY[g]?.find((y) => named.has(y));
    if (child) return { v: EVIDENCE.family, kind: 'goal', basis: 'family', goal: g, why: `${article(label(child))} ${label(child)} club, close to ${label(g)}` };
  }
  // A sibling field only after every goal's own field: a finance club outranks a real-estate club for "investment banking".
  // A near sibling (NEAR_SIBLINGS) is marked: it ranks with the goal's own clubs.
  for (const g of goals) {
    const parent = FAMILY_PARENT.get(g);
    const fits = parent && SIBLINGS_FIT.has(parent) ? GOAL_FAMILY[parent].filter((y) => y !== g && named.has(y)) : [];
    const sibling = fits.find((y) => NEAR_SIBLINGS[g]?.includes(y)) ?? fits[0];
    if (sibling) return { v: EVIDENCE.sibling, kind: 'goal', basis: 'sibling', goal: g, ...(NEAR_SIBLINGS[g]?.includes(sibling) ? { near: true } : {}), why: `${article(label(sibling))} ${label(sibling)} club, close to ${label(g)}` };
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
  // A club set by hand for some of the majors its subject holds (KSA for Kinesiology, not Community Health,
  // both HK) is about the subject only for a student in one of them.
  const forMajor = !club.majors?.length || Boolean(s?.majorName && club.majors.some((m) => m.toLowerCase() === (s.majorName as string).toLowerCase()));
  if (s?.primary && forMajor) {
    const major = s.majorName ?? s.primary;
    const listed = onLists.find((l) => l.subject === s.primary);
    if (club.subjects?.includes(s.primary)) {
      // "Named for" only when the name says it. A team about the major whose name does not (Steel Bridge,
      // hand-checked as civil engineering) is "close to" it: one prefix can hold two majors (CEE: civil and environmental).
      // A club set by hand for this major (club.majors) is "for students in" it.
      const namesIt = new RegExp(`\\b${escapeRe(major)}\\b`, 'i').test(club.name);
      out.push(club.national
        ? { v: EVIDENCE.national, kind: 'major', basis: 'national', goal: 'major', why: chapterLine(club, (body) => `The ${body} student chapter, for ${major} students`) }
        : { v: EVIDENCE.subject, kind: 'major', basis: 'subject', goal: 'major', why: namesIt ? `Named for ${major}, your major` : club.majors?.length ? `${kindPhrase(club.kind)} for students in ${major}, your major` : `${kindPhrase(club.kind)} close to ${major}, your major` });
    } else if (listed) {
      out.push({ v: EVIDENCE.subject, kind: 'major', basis: 'subject', goal: 'major', why: `On ${listed.short}, for ${major} students` });
    } else {
      const other = [...(club.subjects ?? []), ...onLists.map((l) => l.subject).filter((x): x is string => Boolean(x))].find((x) => s.subjects.includes(x));
      if (other) out.push({ v: EVIDENCE['degree-subject'], kind: 'major', basis: 'degree-subject', goal: 'major', why: `About ${other}, a subject in your degree` });
    }
  }
  if (ctx.goals.length === 0) {
    // No goal heard: their own words in the club's name, our line about it or its categories (never one generic word),
    // and in their field: a match outside it (one word, in a club sharing no field with the major's clubs) still
    // counts, by its score, but does not come first.
    const m = wordsMatch(club, ctx.words, ctx.facts);
    if (m && m.weight >= 1) {
      const inField = ctx.majorFields.size === 0 || m.weight >= 2 || club.categories.some((c) => ctx.majorFields.has(c)) || out.some((e) => e.kind === 'major');
      if (inField) ctx.wordHits.add(club.id);
      // Their own word counts more than a word close to it: "nonprofit" for "nonprofit" before "child" for "kids".
      const own = m.found.some((f) => sameWord(f.fact.form, f.word));
      const v = (m.inName ? EVIDENCE.words : WORDS_FACTS) + (m.weight >= 2 ? WORDS_MORE : 0) - (own ? 0 : WORDS_CLOSE);
      out.push({ v, kind: 'words', basis: 'words', goal: 'words', why: wordsWhy(m, ctx.data.source.name) });
    }
    // and the clubs of the major's field: a club tagged for a topic about the major's subject (AMA for Advertising).
    const field = s?.primary ? club.goals.find((g) => g.from !== 'reading' && ctx.topicSubjects.get(g.id)?.includes(s.primary as string)) : undefined;
    if (field && s && !out.some((e) => e.kind === 'major') && !familyLine(club, ctx.label)) {
      const name = ctx.label(field.id);
      out.push({ v: MAJOR_FIELD, kind: 'major', basis: 'subject', goal: 'major', why: `${article(name)} ${name} club, close to ${s.majorName ?? s.primary}, your major` });
    }
  }
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
  const fits = goal ? goalsFitted(club, ctx.goals) : 1;
  let score =
    best.v +
    (new Set(ev.map((e) => e.kind)).size >= 2 ? AGREE_BONUS : 0) +
    (fits >= 2 ? GOALS_AGREE_BONUS : 0) +
    (best.kind === 'goal' && best.specific ? SPECIFIC_BONUS : 0) +
    (club.national ? NATIONAL_BONUS : 0) -
    (best.kind === 'goal' && named.size >= 5 ? UMBRELLA_PENALTY : 0);
  score *= factor;
  score *= conditionFactor(club, ctx);
  if (score < MIN_SCORE) return null;
  // A first-year cannot join most honor societies yet: half weight, so it ranks after the clubs they can join
  // now, but after the cutoff, so it is still shown. Beta Alpha Psi is what a future CPA works toward (spot check, round 2).
  if (club.kind === 'honor' && ctx.student?.firstYear) score *= 0.5;
  // A goal heard: their other words in the club's facts order ties, after the cutoff so they never
  // decide whether a club is in ("management" puts Illinois Consulting Group's management consulting first).
  if (ctx.goals.length > 0 && ctx.words.length > 0) {
    const m = wordsMatch(club, ctx.words, ctx.facts);
    if (m) score += WORDS_TIE * Math.min(2, m.weight);
  }
  const shown = goal ?? best;
  const pick: ClubPick = {
    club,
    score,
    goal: shown.goal,
    basis: shown.basis,
    why: clip(shown.why),
    cautions: cautionsOf(club, ctx.student, ctx.data.checked),
    ...eventField(club, today),
  };
  if (goal) RANKS.set(pick, { tier: goal.general ? 3 : goal.basis === 'reading' || goal.basis === 'family' || (goal.basis === 'sibling' && !goal.near) ? 2 : 1, fits });
  return pick;
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
 *      Within a goal: its own clubs, then the wider field (with the goal's
 *      best club named for a whole family of goals), then the rest of those
 *      family clubs; a club fitting more of the student's goals first within
 *      each, then score (Rank). A goal with fewer than 3 clubs of its own is
 *      thin, however many family clubs follow (spot check, round 2).
 *   2. When the goals fill the visible rows, the last visible row goes to the
 *      best major club ("For your major": ASME for "design robots").
 *   3. Then the rest by score, still at most `perGoal` a goal, leaving out
 *      the weak fill (another subject of the degree, the college); then the
 *      goals' clubs past the cap, so the fill never hides a strong match for
 *      the goal when rows are free; then the fill.
 *   4. No goal heard: first the clubs whose own facts (name, our `does` line,
 *      categories) hold the student's words, then the major's clubs, then
 *      the starter clubs when there are fewer than three. `unknownGoal` tells
 *      the card to say the planner does not know the goal yet, and the
 *      starters are labelled general for that student; `empty` when nothing
 *      but the starters came back.
 *   Identity-centered clubs matched by a heard goal go to `communities`, at
 *   most 3; a major match alone never puts one there. One is in `picks` only
 *   when the student says they belong to its community ("I'm a first-gen
 *   Latina student"), and then ranks with the goal's own clubs.
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

  // A community the student says they belong to ("I'm a first-gen Latina student"): its clubs for their goal
  // join the main list with the goal's own clubs, rather than wait folded in the communities row. Only from
  // their own words about themselves (communitiesNamed), never inferred.
  const named = careerText && !options.only ? communitiesNamed(careerText) : [];
  const theirs = (x: ClubPick) => x.club.identity && ctx.goals.includes(x.goal) && named.some((re) => communityNamed(x.club, re));
  // Within a goal its own clubs come first, then the wider field, then clubs named for a whole family of goals
  // (Rank). The goal's best family club ranks with the wider field: one business fraternity among the finance
  // clubs, not four after the real-estate club. Goals fitted, then score, order each tier. Dedupe ran on score,
  // so the stronger of two chapters is kept.
  const ranks = new Map<ClubPick, Rank>();
  const familyShown = new Set<string>();
  for (const x of [...scored].sort(byRank)) {
    const r = rankOf(x);
    if (theirs(x)) ranks.set(x, { ...r, tier: 1 });
    else if (r.tier === 3 && !x.club.identity && !familyShown.has(x.goal)) {
      familyShown.add(x.goal);
      ranks.set(x, { ...r, tier: 2 });
    } else ranks.set(x, r);
  }
  const general = scored.filter((x) => !x.club.identity || theirs(x)).sort(rankOrder((x) => ranks.get(x) ?? rankOf(x)));
  // How many clubs fit each goal, whichever goal a club ended up listed under, and not counting clubs named for a
  // whole family of goals: a goal with one pre-PT club is thin, however many general pre-health clubs follow it.
  const matched: Record<string, number> = {};
  for (const g of ctx.goals) {
    const one = { ...ctx, goals: [g] };
    matched[g] = dedupe(data.clubs.map((c) => scoreClub(c, one, today)).filter((x): x is ClubPick => x !== null && x.goal === g && !x.club.identity)).filter((x) => rankOf(x).tier < 3).length;
  }

  const picks: ClubPick[] = [];
  const count = (g: string) => picks.filter((x) => x.goal === g).length;
  const capped = (x: ClubPick) => ctx.goals.includes(x.goal) && count(x.goal) >= perGoal;
  const take = (x: ClubPick | undefined, cap = true) => {
    if (!x || picks.includes(x) || picks.length >= limit || (cap && capped(x))) return;
    picks.push(x);
  };
  // 1. The goals in rounds, at most perGoal each; with no goal heard, the clubs whose own facts match their words.
  for (let round = 0; round < perGoal; round += 1) for (const g of ctx.goals) take(general.find((y) => y.goal === g && !picks.includes(y)));
  if (ctx.goals.length === 0) for (const x of general) if (ctx.wordHits.has(x.club.id)) take(x);
  // 2. The last visible row for the best major club, when those filled the visible rows.
  if (options.majorSlot !== false && !goalsOnly && picks.length >= visible && !picks.slice(0, visible).some((x) => x.goal === 'major')) {
    const major = general.find((y) => y.goal === 'major' && !ctx.wordHits.has(y.club.id));
    if (major) {
      const at = picks.indexOf(major);
      if (at >= 0) picks.splice(at, 1);
      picks.splice(visible - 1, 0, major);
      picks.length = Math.min(picks.length, limit);
    }
  }
  // 3. The rest by score, still at most perGoal a goal, but not the weak fill (another subject of the degree, the college),
  //    and, when a goal was heard, one major club only: the major's best club keeps its row, its others wait;
  // 4. then the goals' clubs past the cap, so the fill never hides them (six robotics teams behind railway societies,
  //    and behind a second major club: ASHRAE had the fifth row for "design robots", spot check round 2);
  // 5. then the major's other clubs, then the fill.
  const weakFill = (x: ClubPick) => x.basis === 'degree-subject' || x.basis === 'college';
  const majorWaits = (x: ClubPick) => ctx.goals.length > 0 && x.goal === 'major' && picks.some((y) => y.goal === 'major');
  for (const x of general) if (!weakFill(x) && !majorWaits(x)) take(x);
  for (const x of general) if (ctx.goals.includes(x.goal)) take(x, false);
  for (const x of general) if (!weakFill(x)) take(x, false);
  for (const x of general) take(x, false);

  const goals = ctx.goals.map((id) => ({ id, label: ctx.label(id) }));
  const thin = ctx.goals.filter((g) => matched[g] < PER_GOAL);
  // Social, Greek and faith clubs never get here: their kind factor is 0.
  // Faith clubs are never offered unasked (decision 5), not even folded: a faith-centered pre-health club
  // reaches the main list only when the student says they belong to that faith (theirs).
  const faith = (club: Club) => club.kind === 'faith' || club.categories.includes('Faith, Religion & Spirituality');
  const communities = options.communities === false ? [] : scored.filter((x) => x.club.identity && ctx.goals.includes(x.goal) && !theirs(x) && !faith(x.club)).slice(0, COMMUNITIES);
  const communityMatched: Record<string, number> = {};
  for (const g of thin) {
    const n = communities.filter((x) => x.goal === g && rankOf(x).tier < 3).length;
    if (n > 0) communityMatched[g] = n;
  }

  const undecided = ctx.goals.length === 0 && !options.only && soundsUndecided(careerText);
  // Words, no goal the planner knows, and not "still deciding": the card says so plainly.
  const unknownGoal = Boolean(careerText) && ctx.goals.length === 0 && !options.only && !undecided;
  let empty: ClubResult['empty'];
  if (!careerText) empty = 'no-words';
  else if (picks.length === 0) empty = ctx.goals.length ? 'no-match' : 'unheard';
  // No goal heard and fewer than three clubs from their words and major: the starters after them. For a
  // student who named a goal the planner does not know they are general clubs, not "while you decide";
  // a starter for undeclared students is never shown to a declared major.
  if (ctx.goals.length === 0 && !options.only && picks.length < PER_GOAL) {
    for (const club of [...data.clubs].filter((c) => c.starter).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (picks.length >= limit || picks.some((x) => x.club.id === club.id)) continue;
      if (club.starter === 'undeclared' && student?.primary) continue;
      const pick: ClubPick = unknownGoal
        ? { club, score: 0, goal: 'general', basis: 'starter', why: GENERAL_WHY, cautions: cautionsOf(club, student, data.checked), ...eventField(club, today) }
        : { club, score: 0, goal: 'starter', basis: 'starter', why: STARTER_WHY, cautions: cautionsOf(club, student, data.checked), ...eventField(club, today) };
      picks.push(pick);
    }
  }
  return {
    goals,
    picks,
    communities,
    thin,
    matched,
    ...(Object.keys(communityMatched).length ? { communityMatched } : {}),
    ...(empty ? { empty } : {}),
    ...(undecided ? { undecided: true as const } : {}),
    ...(unknownGoal ? { unknownGoal: true as const } : {}),
  };
}

/** Where a student says who they are: "I'm a ...", "I am ...", "as a ..." (not "such as a ..."), "being a ...". */
const SAYS_WHO = /\b(i'?m|i am|(?<!such )as an?|being an?)\s+([^.,;!?]{1,60})/gi;
/**
 * Where what they say of themselves stops: a joining word, a preposition, a
 * verb, a "no". "I'm a first-gen Latina student and ..." is about the student
 * up to "and"; "I'm interested in women's health", "I'm not Latina" and "as a
 * doctor serving Black communities" say nothing about who they are (review,
 * round 3: each had put an identity club in the main list).
 */
const SAID_STOPS = /^(and|but|or|so|who|that|which|in|into|on|about|with|for|to|from|at|of|by|than|like|not|never|no|want|wants|would|will|can|could|hope|plan)$|^[a-z]+ing$/;
/**
 * The communities a student says they belong to ("I'm a first-gen Latina
 * student"), as ASKS's identity patterns: only words they wrote about
 * themselves, up to SAID_STOPS. "women's health" or "international business"
 * names a field, not the student, so neither counts, and "international" never does.
 */
function communitiesNamed(text: string): RegExp[] {
  const words: string[] = [];
  const said = text.toLowerCase().replace(/[‘’]/g, "'").replace(/first[\s-]+gen(eration)?/g, 'first-gen');
  for (const m of said.matchAll(SAYS_WHO)) {
    const after = m[2].split(/[^a-z0-9-]+/).filter(Boolean);
    if (after[0] === 'a' || after[0] === 'an') after.shift();
    for (const w of after.slice(0, 5)) {
      if (SAID_STOPS.test(w)) break;
      words.push(w);
    }
  }
  return ASKS.filter((a) => a.identity && !a.word.test('international') && words.some((w) => a.word.test(w))).map((a) => a.identity as RegExp);
}

/**
 * Picks grouped the way the rail shows them: one heading per goal in the order
 * named, then "From what you wrote", "For your major", and the starters
 * ("Good first clubs", or "General clubs" when the goal was not one the
 * planner knows).
 */
export function groupPicks(result: ClubResult): Array<{ goal: string; heading: string; picks: ClubPick[] }> {
  const order = [...result.goals.map((g) => g.id), 'words', 'major', 'starter', 'general', 'search'];
  const labelOf = new Map(result.goals.map((g) => [g.id, g.label]));
  const headings: Record<string, string> = { major: 'For your major', words: 'From what you wrote', starter: 'Good first clubs', general: 'General clubs', search: 'Matches' };
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
function queryWords(query: string): Array<{ word: string; stem: string; ask: Ask | null; shown: string }> {
  const raw = query.toLowerCase().replace(/a\s+cappella/g, 'cappella').replace(/first[\s-]+gen(eration)?/g, 'first-gen').split(/[^a-z0-9-]+/);
  const out: Array<{ word: string; stem: string; ask: Ask | null; shown: string }> = [];
  for (const w of raw) {
    const word = w.replace(/^-+|-+$/g, '');
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    if (out.some((x) => x.word === word)) continue;
    const stem = word.length > 4 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
    // "a cappella" is read as one word, and shown as the student wrote it.
    out.push({ word, stem, ask: ASKS.find((a) => a.word.test(word)) ?? null, shown: word === 'cappella' ? 'a cappella' : word });
  }
  return out;
}

/** v: how well; named: the strongest hit on the word itself (name, affiliation, category, our line), not on the kind of club. */
interface Hit { v: number; why: string; named: number }

/** The best way one query word fits one club, or null. */
function wordHit(club: Club, q: { word: string; stem: string; ask: Ask | null; shown: string }, sourceName: string): Hit | null {
  const re = new RegExp(`\\b${escapeRe(q.stem)}`, 'i');
  const hits: Array<{ v: number; why: string; byKind?: true }> = [];
  if (re.test(withoutOtherSense(club.name))) hits.push({ v: 1, why: `Its name matches "${q.shown}"` });
  if (q.ask?.identity) {
    if (q.ask.identity.test(club.name)) hits.push({ v: 0.95, why: `Its name matches "${q.shown}"` });
    const aff = (club.affiliations ?? []).find((a) => q.ask?.identity?.test(a));
    if (aff) hits.push({ v: 0.85, why: `Affiliated with ${aff}` });
    if (club.identity && club.does && q.ask.identity.test(club.does)) hits.push({ v: 0.8, why: `Its ${sourceName} page describes a ${q.shown} community` });
  }
  const aff = (club.affiliations ?? []).find((a) => re.test(a));
  if (aff) hits.push({ v: 0.8, why: `Affiliated with ${aff}` });
  if (q.ask?.kinds?.includes(club.kind)) hits.push({ v: 0.8, why: kindPhrase(club.kind), byKind: true });
  const cat = club.categories.find((c) => re.test(c));
  if (cat) hits.push({ v: 0.7, why: `Listed under ${cat} in ${sourceName}` });
  if (club.does && re.test(withoutOtherSense(club.does))) hits.push({ v: 0.6, why: `Its ${sourceName} page describes ${q.shown}` });
  if (hits.length === 0) return null;
  const best = hits.sort((a, b) => b.v - a.v)[0];
  const own = hits.find((h) => !h.byKind);
  // Found by its kind and by the word itself: say both ("An arts and performance group; its OneIllinois page describes a cappella").
  const why = best.byKind && own ? `${best.why}; ${own.why.charAt(0).toLowerCase()}${own.why.slice(1)}` : best.why;
  return { v: best.v, why, named: own?.v ?? 0 };
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
  const scored: Array<{ pick: ClubPick; n: number; named: number }> = [];
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
    scored.push({ n: found.length, named: Math.max(...found.map((h) => h.named)), pick: { club, score, goal: 'search', basis: 'search', why, cautions: cautionsOf(club, student, data.checked), ...eventField(club, today) } });
  }
  if (scored.length === 0) return empty;
  const most = Math.max(...scored.map((x) => x.n));
  // The clubs that hold the asked word itself come before those that are only the kind asked for: every
  // a cappella group, even one by audition or not taking sign-ups now, before an improv troupe.
  const picks = dedupe(
    scored
      .filter((x) => x.n === most)
      .sort((a, b) => b.named - a.named || byScore(a.pick, b.pick))
      .map((x) => x.pick),
  ).slice(0, limit);
  return { goals: [], picks, communities: [], thin: [], matched: {} };
}
