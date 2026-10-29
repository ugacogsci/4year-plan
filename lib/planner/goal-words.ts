import { interestProfile, type InterestProfile } from './career-tracks';
import { courseMatchesWord, interestWordsFrom } from './quality';
import type { PlanMark } from './repick';
import type { OnboardingAnswers } from './onboarding';
import type { CareerFit } from './career-embedding';

/**
 * The goal words in the one setup box, and the line that says a card was
 * picked for them.
 *
 * Since 344bb4c, About you is one box ("What else should your plan make room
 * for?"), and the whole paragraph went into the goal slot (answers.after):
 * the planner's career words, the rail's "What you want to be doing after"
 * box, ALMA's and ARCH's board summary and the advisor printout all read a
 * goal from it. A paragraph that also says where the student is and when they
 * want to finish then read as goals. On the review's test boards:
 *
 *   - "second year" made "second" a word the student wants, and courses
 *     titled "... in the Secondary School" electives for it;
 *   - "I'm a sophomore in computer science" named computer science, and the
 *     plan got a software engineering goal (the name of a major is not a
 *     goal: career-tracks.ts interestProfile);
 *   - "I was pre-med until last spring, now I want UX research" switched the
 *     pre-med track on;
 *   - the same student's words, moved from the three old boxes into the one,
 *     changed the electives on 177 of 308 boards.
 *
 * So the paragraph is read clause by clause here, and only what the student
 * wants to do or study goes on as goal words. Left out: their year, credits
 * and GPA, the major they are in, transfer and exam credit, graduation and
 * start dates, how long they want to take, summers and terms away, a job or
 * a team as a time constraint, a class they failed, and a plan they say they
 * dropped. A program they are weighing ("a computer science minor") ranks
 * electives but names no goal, as the old studying box did. Every reader of
 * the timeline (the start and finish, summers, the year, admission routes,
 * credit counts) still reads the whole paragraph, from answers.timeline.
 *
 * Deterministic and dictionary-based, like interestProfile: the same words
 * always give the same goals. A goal the student types in the rail's box
 * replaces these and is the strongest word the plan has (careerWordsFor).
 */

/** Words for the planner from a setup: what they rank electives with, and what they read goals from. */
export interface SetupWords {
  /**
   * Programs the student is weighing ("I am considering a computer science
   * minor"): words that rank electives and name no goal, the role the old
   * studying answer had.
   */
  studying: string;
  /**
   * What the student wants to do and study: the career words, the goal
   * slot and the rail's goal box. Empty when the setup says only where the
   * student is.
   */
  goals: string;
}

/**
 * Whether answers come from the one setup box: since 344bb4c,
 * withSetupResponse stores the paragraph as both the timeline and the goal
 * answer and leaves studying empty. Setups saved with the three old boxes
 * keep each box's words where the student put them. setupResponse
 * (onboarding.ts) reads the same rule.
 */
export function isOneBoxSetup(answers: Pick<OnboardingAnswers, 'studying' | 'timeline' | 'after'>): boolean {
  return !answers.studying && answers.timeline === answers.after;
}

/** The planner's words from a setup: the three old boxes as written, or the one box read for its goals. */
export function setupWords(answers: Pick<OnboardingAnswers, 'studying' | 'timeline' | 'after'> | null | undefined): SetupWords {
  if (!answers) return { studying: '', goals: '' };
  if (!isOneBoxSetup(answers)) return { studying: answers.studying ?? '', goals: answers.after ?? '' };
  const read = goalWordsOf(answers.after ?? '');
  return { studying: read.studying, goals: read.goals };
}

/**
 * The career words the planner reads: what the student typed in the rail's
 * goal box, or the setup's goals while they have typed nothing there. The
 * box wins outright, so a goal typed there is the student's strongest word;
 * `cleared` is the student or ALMA emptying it on purpose, which leaves no
 * goal rather than falling back to the setup.
 */
export function careerWordsFor(setup: SetupWords, typed: string, cleared: boolean): string {
  return typed || (cleared ? '' : setup.goals);
}

/**
 * The rail's goal words restored from a saved board. A board saved while the
 * one setup box filled the goal slot holds the whole paragraph there,
 * untouched by the student: that is read as the setup's goals. Anything else
 * the student or ALMA wrote stays as written.
 */
export function restoredCareerWords(saved: string, answers: Pick<OnboardingAnswers, 'studying' | 'timeline' | 'after'> | null | undefined): string {
  if (answers && isOneBoxSetup(answers) && saved.trim() !== '' && saved.trim() === (answers.after ?? '').trim()) return setupWords(answers).goals;
  return saved;
}

// ---------------------------------------------------------------------------
// Reading the paragraph
// ---------------------------------------------------------------------------

const re = (source: string) => new RegExp(source, 'i');

/*
 * What the student wants: the cue that makes a clause a goal, and where a
 * goal starts inside a clause that begins with where they are ("I'm a
 * sophomore in computer science who wants to do machine learning").
 */
const ASPIRE = re(String.raw`(?:\bi(?:'d|'m|'ll|'ve|\s+(?:would|really|also|still|eventually|do|might|have\s+always|always))?\s+)?\b(?:want|wants|wanted|wanna|would\s+(?:like|love)|'d\s+(?:like|love)|hope|hopes|hoping|plan\s+to|plans\s+to|planning\s+(?:to|on)|aim|aims|aiming|dream|dreams|goal|goals|interested|interests?\s+(?:in|are|include)|passionate|passion|curious|love|loves|enjoy|enjoys|like\s+(?:to|working|doing|the\s+idea)|considering|consider|thinking\s+(?:about|of)|might|maybe|perhaps|possibly|eventually|someday|one\s+day|ideally|pursue|pursuing|become|becoming|explore|exploring|focus\s+on|get\s+into|go\s+into|end\s+up)\b`);
/* Goal nouns and verbs: a clause with one of these is about what the student wants to do, never a leftover of the clause before it. */
const GOALISH = re(String.raw`\b(?:work(?:ing)?\s+(?:in|on|with|as|at|for)|careers?|jobs?\s+(?:in|as|at|doing|with)|internships?|research|(?:med|medical|law|grad|graduate|pt|vet|veterinary|pharmacy|dental|nursing|business|film|art)\s+school|master'?s|masters|ph\.?d|mba|industry|company|companies|field\s+of)\b`);
/*
 * Phrases about finishing that are goals: "after I graduate I want to work in
 * finance", "graduate school". Blanked before the timeline cues are read; the
 * words themselves stay in the goal.
 */
const GOAL_CONTEXT = new RegExp(String.raw`\b(?:after|when|once|before)\s+(?:i\s+)?(?:graduat\w*|finish(?:ing)?(?:\s+(?:my\s+)?(?:degree|undergrad|school|college))?|(?:i'?m|i\s+am)\s+done|college|undergrad|school)\b|\bafter\s+graduation\b|\bpost[-\s]?grad(?:uation|uate)?\b|\bgrad(?:uate)?\s+(?:school|program|programs|degree|degrees|studies|study|work|research|level)\b`, 'gi');

/* A plan the student has left behind. Read before anything else: "I was pre-med until last spring" is not pre-med. */
const PAST = [
  String.raw`\b(?:originally|initially|previously|formerly)\b`,
  String.raw`\bat\s+first\b`,
  String.raw`\bused\s+to\b`,
  String.raw`\bi\s+was\s+(?:going\s+to|gonna)\b`,
  String.raw`\b(?:i\s+was|i'?ve\s+been|i\s+had\s+been)\b[^,;]{0,60}?\buntil\b`,
  String.raw`\bstarted\s+(?:out\s+)?as\b`,
  String.raw`\bcame\s+in\s+(?:as|wanting|planning)\b`,
  String.raw`\bswitch(?:ed|ing)?\s+(?:out\s+of|from|away\s+from)\b`,
].map(re);
/* "I was planning on law school" is a past plan only beside a turn: "but now", "until", "instead". */
const PAST_SOFT = re(String.raw`\bi\s+was\s+(?:planning|set\s+on|on\s+(?:the\s+)?[\w-]+\s+track|pre[-\s]?[a-z]+)\b`);
const TURN = re(String.raw`\b(?:but|now|instead|until|anymore|no\s+longer|switched|changed)\b`);
/* "switched from pre-med to UX research": the new goal is the part after "to". */
const SWITCH_TO = re(String.raw`\b(?:switch(?:ed|ing)?|chang(?:ed|ing)|mov(?:ed|ing)|went)\s+(?:my\s+(?:goal|plan|focus|mind)\s+)?(?:from|out\s+of|away\s+from)\s+.+?\s+(?:to|into|toward|towards)\s+(.+)$`);

type StatusKind = 'standing' | 'major' | 'timeline' | 'constraint' | 'setback';
/* Where the student is, when they finish, and what limits their time. */
const STATUS: Array<[StatusKind, RegExp]> = ([
  // Year and standing. "Senior data analyst" and "junior developer" are jobs.
  ['standing', String.raw`\b(?:first|second|third|fourth|fifth|sixth|final|1st|2nd|3rd|4th|5th)[-\s](?:year|yr|semester)\b`],
  ['standing', String.raw`\b(?:rising\s+)?(?:freshman|freshmen|sophomore|sophomores|junior|senior)\b(?!\s+(?:data|software|analyst|analysts|engineer|engineers|developer|developers|scientist|scientists|consultant|consultants|manager|managers|designer|designers|associate|associates|researcher|researchers|level|role|roles|position|positions|accountant|accountants|auditor|auditors|vice|partner|product|fellow|living|citizens?|care|executive|director|officer|counsel)\b)`],
  ['standing', String.raw`\b\d+(?:\.\d+)?\s*(?:credit|credits|credit\s+hours|hours|hrs|cr|units)\b`],
  ['standing', String.raw`\bcredits?\b|\bgpa\b`],
  ['standing', String.raw`\b(?:ap|ib|clep|dual[-\s]enrollment|dual[-\s]credit)\s+(?:credit|credits|classes|courses|exams?|scores?)\b`],
  ['standing', String.raw`\btransfer(?:red|ring)?\s+(?:from|in\s+from|credit|credits|student|students)\b|\bi'?m\s+a\s+transfer\b|\bcommunity\s+college\b`],
  // The major as where they are, not what they want.
  ['major', String.raw`\b(?:i'?m|i\s+am|currently)\s+(?:in|at|enrolled|admitted|declared|undeclared|studying|majoring|an?\s+(?:[\w&'-]+\s+){0,4}?(?:major|student|minor))\b`],
  ['major', String.raw`\bmy\s+(?:major|minor|degree|program)\s+is\b|\bmajoring\s+in\b|\bundeclared\b`],
  // When they finish, how long they take, and the terms they want.
  ['timeline', String.raw`\bgraduat(?:e|es|ed|ing|ion)\b|\bfinish(?:ed|es|ing)?\b`],
  ['timeline', String.raw`\b(?:done|complete|completing|completed)\s+(?:with\s+)?(?:my|the|school|college|in|by)\b`],
  ['timeline', String.raw`\bon\s+(?:time|track|schedule)\b|\bbehind\b|\b(?:semesters?|years?|terms?)\s+(?:left|to\s+go|remaining|early|late|off)\b`],
  ['timeline', String.raw`\bin\s+(?:one|two|three|four|five|six|seven|eight|\d+|a\s+couple(?:\s+of)?|a\s+few)\s+(?:more\s+)?(?:years?|semesters?|terms?)\b`],
  ['timeline', String.raw`\bgap\s+year\b|\b(?:semester|year|time)\s+off\b|\bleave\s+of\s+absence\b`],
  ['timeline', String.raw`\bsummer\s+(?:classes|courses|session|sessions|term|terms|school)\b|\btake\s+(?:a\s+|the\s+)?summers?\b|\bsummers?\s+off\b`],
  ['timeline', String.raw`\bstudy(?:ing)?\s+abroad\b|\babroad\b|\bexchange\s+(?:semester|program)\b`],
  ['timeline', String.raw`\b(?:start|started|starting|begin|began|beginning|enter|entered|entering)\s+(?:school\s+|college\s+|classes\s+|here\s+|at\s+[\w&'-]+\s+)?(?:in|this|next|last)\s+(?:the\s+)?(?:fall|spring|summer|winter|semester|year)\b`],
  ['timeline', String.raw`\b(?:overload|underload|light\s+(?:load|semester|schedule)|heavy\s+(?:load|semester))\b|\b(?:full|part)[-\s]time\s+(?:student|enrollment|load)\b`],
  // A job, a team or a family as a limit on time.
  ['constraint', String.raw`\b(?:part|full)[-\s]time\b|\b\d+\s*(?:hours|hrs)\s*(?:a|per|each|\/)\s*week\b|\bwork(?:ing|s)?\s+(?:about\s+|around\s+)?\d+`],
  ['constraint', String.raw`\b(?:need|needs|have|has|keep|hold|holding)\s+(?:a\s+|my\s+)?jobs?\b|\bneeds?\s+time\s+for\s+(?:a\s+|my\s+)?(?:job|work|family|kids|children|team|practice|commute)`],
  ['constraint', String.raw`\bcommut(?:e|es|ing)\b|\b(?:my|two|three|young|small)\s+(?:kids|children|son|daughter)\b|\bcaregiv\w*|\bcaring\s+for\b`],
  ['constraint', String.raw`\bstudent[-\s]athletes?\b|\bon\s+the\s+[\w-]+\s+team\b|\bvarsity\b|\bfinancial\s+aid\b|\btuition\b|\bafford\b|\bwork[-\s]study\b|\bshifts?\b`],
  // A class that went wrong.
  ['setback', String.raw`\b(?:failed|fail|failing|flunked)\b|\bretak(?:e|es|ing)\b|\bwithdr[ae]w\b|\bprobation\b|\bdropped\s+(?:a|the|my|out)\b|\brepeat(?:ing)?\s+(?:a|the|my)\s+(?:class|course)\b`],
] as Array<[StatusKind, string]>).map(([kind, source]) => [kind, re(source)]);

/* A date, taken out of a goal that keeps the rest: "begin a master's in fall 2029". */
const DATE = new RegExp(String.raw`\s*\b(?:(?:in|by|starting|from|during|for|until|around|before|after|this|next|last)\s+)?(?:the\s+)?(?:spring|summer|fall|autumn|winter)(?:\s+(?:semester|term))?(?:\s+(?:of\s+)?(?:20\d\d|'\d\d))?\b|\s*\b(?:(?:in|by|until|around|before|after)\s+)?20\d\d\b|\s*\b(?:this|next|last)\s+(?:year|semester|term)\b`, 'gi');
/* What is left of a clause once its date is out, when that is nothing to plan for. */
const FILLER = new Set(['i', "i'd", "i'm", "i'll", 'like', 'to', 'the', 'a', 'an', 'and', 'then', 'also', 'start', 'starting', 'begin', 'plan', 'want', 'hope', 'would', 'in', 'of', 'for', 'my', 'be', 'will', 'going', 'so', 'it', 'that', 'is', 'am']);

/* A program the student is weighing: these rank electives and name no goal. */
const PROGRAM = re(String.raw`\b(?:minor|minors|minoring|double[-\s]major|second\s+major|major|majors|majoring|certificate|certification|concentration|specialization|emphasis|degree\s+in)\b`);
const PROGRAM_ALONE = re(String.raw`\b(?:minor|minors|minoring|certificate|certification|concentration|specialization)\b`);

/* Where one thing the student says ends and the next begins. The connector stays with the clause after it. */
const SEPARATOR = new RegExp(String.raw`\s*[,;:]\s*|\s*\s-\s\s*|\s+(?=(?:but|however|though|although|whereas|because|so|now|then|while|plus)\b)|\s+(?=and\s+(?:i|i'm|i'd|i've|i'll|my|want|wants|would|hope|plan|go|work|become|be|get|do|pursue|study|take|explore|maybe|then|eventually|also|need|have|finish|graduate|start|apply|intern|minor|major|double|focus|learn|try|end|someday|later|after|possibly|perhaps|ideally|hopefully|still|now)\b)`, 'gi');
const LEADING_CONNECTOR = /^(?:(?:and|but|so|or|then|now|however|though|although|plus|while|whereas|because)\b[\s,]*)+/i;
/* Sentence ends that are not: "U.S. history", "Dr. Lee". */
const ABBREVIATION = /(?:\b(?:[a-z]\.){1,3}|\b(?:dr|mr|mrs|ms|st|vs|etc|prof|jr|sr|e\.g|i\.e))$/i;

type ClauseKind = 'goal' | 'studying' | 'status';
interface Read { kind: ClauseKind | null; text?: string }

/** Apostrophes and dashes straightened, so the cues read "I’m" and "pre–med" as typed plainly. */
function plain(text: string): string {
  return text.replace(/[‘’ʼ`]/g, "'").replace(/[‐-―]/g, '-');
}

const namesTrack = (text: string): boolean => interestProfile(text).tracks.length > 0;

/** A third-person goal cut from "a sophomore who wants to ...", in the student's own voice. */
function ownVoice(text: string): string {
  const t = text.trim();
  const m = /^(wants|hopes|plans|loves|likes|enjoys|aims|dreams)\b/i.exec(t);
  return m ? `I ${m[1].slice(0, -1).toLowerCase()}${t.slice(m[1].length)}` : t;
}

/**
 * What one clause is: a goal, a program to weigh, where the student is, or
 * nothing on its own (null, it goes with the clause before it). `text` is
 * the part to keep when it is not the whole clause.
 */
function readClause(raw: string, sentence: string): Read {
  const text = plain(raw).replace(LEADING_CONNECTOR, '').trim();
  if (!text) return { kind: null };
  const lower = text.toLowerCase();

  // A plan left behind. The new one is its own clause ("..., now I want UX research"), or the
  // part after "to" in "switched from pre-med to UX research"; "want" inside "used to want to
  // be a doctor" is the old plan, so nothing else in the clause is kept.
  if (PAST.some((p) => p.test(lower)) || (PAST_SOFT.test(lower) && TURN.test(plain(sentence)))) {
    const to = SWITCH_TO.exec(text);
    return to ? within(to[1], sentence) : { kind: 'status' };
  }

  // Where they are and when they finish, read with the goal phrases about finishing blanked.
  const masked = lower.replace(GOAL_CONTEXT, (m) => ' '.repeat(m.length));
  // A year or a program after what the student wants is part of the goal ("I want to work with
  // first-year students", "teach freshman composition"); a finish date after it is not.
  const wants = ASPIRE.exec(masked)?.index ?? Infinity;
  const hits = STATUS.map(([kind, p]) => ({ kind, m: p.exec(masked) }))
    .filter((h): h is { kind: StatusKind; m: RegExpExecArray } => h.m !== null)
    .filter((h) => !((h.kind === 'standing' || h.kind === 'major') && h.m.index > wants));
  if (hits.length > 0) {
    const first = hits.reduce((a, b) => (b.m.index < a.m.index ? b : a));
    const tail = tailFrom(text, first.m.index + first.m[0].length);
    if (tail) return within(tail, sentence);
    // "I'm a pre-med junior", "finish my pre-med courses by junior year": a career track named is a goal.
    if (namesTrack(text)) return { kind: 'goal' };
    // "Thinking about majoring in economics" weighs a program.
    if (hits.every((h) => h.kind === 'major') && ASPIRE.test(lower.slice(0, first.m.index))) return { kind: 'studying' };
    return { kind: 'status' };
  }

  // A date beside a goal: the goal stays, the date goes ("begin a master's program in fall 2029").
  const undated = text.replace(DATE, '').replace(/\s+/g, ' ').trim();
  if (undated !== text) {
    const left = undated.toLowerCase().split(/[^a-z']+/).filter((w) => w && !FILLER.has(w));
    if (left.length === 0) return { kind: 'status' };
    return within(undated, sentence);
  }

  if (PROGRAM.test(lower) && (PROGRAM_ALONE.test(lower) || ASPIRE.test(lower))) return { kind: 'studying' };
  if (ASPIRE.test(lower) || GOALISH.test(lower) || namesTrack(text)) return { kind: 'goal' };
  return { kind: null };
}

/** Part of a clause read as a clause of its own, kept as that part: a goal unless it says otherwise. */
function within(part: string, sentence: string): Read {
  const read = readClause(part, sentence);
  return { kind: read.kind ?? 'goal', text: read.text ?? part.trim() };
}

/** The goal that starts after `from` in a clause ("... who wants to do machine learning"), or ''. */
function tailFrom(text: string, from: number): string {
  const after = plain(text).slice(from);
  const m = ASPIRE.exec(after.toLowerCase());
  if (!m) return '';
  return ownVoice(after.slice(m.index));
}

/** Sentences, with where each begins, cut where a sentence really ends. */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    let start = 0;
    for (const m of block.matchAll(/[.!?]+(?=\s|$)/g)) {
      const end = (m.index ?? 0) + m[0].length;
      if (m[0] === '.' && ABBREVIATION.test(block.slice(start, m.index))) continue;
      out.push(block.slice(start, end));
      start = end;
    }
    out.push(block.slice(start));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** One sentence's clauses as written, a connector on its own joined to the clause after it. */
function clausesOf(sentence: string): Array<{ text: string; start: number; end: number }> {
  const body = sentence.replace(/[.!?]+$/, '');
  const cuts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const m of body.matchAll(SEPARATOR)) {
    const at = m.index ?? 0;
    if (at > start) cuts.push({ text: body.slice(start, at), start, end: at });
    start = at + m[0].length;
  }
  if (start < body.length) cuts.push({ text: body.slice(start), start, end: body.length });
  const merged: typeof cuts = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const c = cuts[i];
    if (c.text.replace(LEADING_CONNECTOR, '').trim() === '' && i + 1 < cuts.length) {
      cuts[i + 1] = { text: body.slice(c.start, cuts[i + 1].end), start: c.start, end: cuts[i + 1].end };
      continue;
    }
    merged.push(c);
  }
  return merged;
}

/** A kept run of a sentence as a sentence of its own: no leading "and", a capital, an end stop. */
function asSentence(text: string, stop: string): string {
  const t = text.replace(LEADING_CONNECTOR, '').trim().replace(/[,;:]+$/, '');
  if (!t) return '';
  return `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : stop}`;
}

/**
 * A setup paragraph split into the student's goals, the programs they are
 * weighing, and what was left out (where they are, when they finish, what
 * limits their time), each in the student's own words.
 */
export function goalWordsOf(paragraph: string): SetupWords & { left: string[] } {
  const goals: string[] = [];
  const studying: string[] = [];
  const left: string[] = [];
  for (const sentence of sentencesOf(paragraph ?? '')) {
    const stop = /[!?]$/.test(sentence) ? sentence.slice(-1) : '.';
    const body = sentence.replace(/[.!?]+$/, '');
    const clauses = clausesOf(sentence);
    let previous: ClauseKind = 'goal';
    const runs: Array<{ kind: ClauseKind; start: number; end: number; text: string | null }> = [];
    for (const clause of clauses) {
      const read = readClause(clause.text, sentence);
      const kind: ClauseKind = read.kind ?? previous;
      previous = kind;
      // A clause kept whole joins the run of its kind before it with the words between them, as written.
      const last = runs[runs.length - 1];
      if (last && last.kind === kind && last.text === null && read.text === undefined) {
        last.end = clause.end;
        continue;
      }
      runs.push({ kind, start: clause.start, end: clause.end, text: read.text ?? null });
    }
    const kept: Record<ClauseKind, string[]> = { goal: [], studying: [], status: [] };
    for (const run of runs) kept[run.kind].push(run.text ?? body.slice(run.start, run.end));
    const join = (parts: string[]) => asSentence(parts.map((p) => p.replace(LEADING_CONNECTOR, '').trim()).filter(Boolean).join(', '), stop);
    if (kept.goal.length) goals.push(join(kept.goal));
    if (kept.studying.length) studying.push(join(kept.studying));
    if (kept.status.length) left.push(join(kept.status));
  }
  return { goals: goals.filter(Boolean).join(' '), studying: studying.filter(Boolean).join(' '), left: left.filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Why a card is on the plan
// ---------------------------------------------------------------------------

const profiles = new Map<string, InterestProfile>();
function profileOf(text: string): InterestProfile {
  const key = text.trim();
  const hit = profiles.get(key);
  if (hit) return hit;
  const made = interestProfile(key);
  if (profiles.size > 50) profiles.clear();
  profiles.set(key, made);
  return made;
}

const codeOf = (code: string) => code.replace(/\s+/g, ' ').trim().toUpperCase();
const titleHas = (title: string, word: string) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${word.length < 5 ? '\\b' : ''}`, 'i').test(title);

/**
 * The goal a course answers, in the student's terms: the career track whose
 * list names it ("Pre-medicine (MD/DO)"), or the interest topic that names
 * it, its subject or a word of its title ("data science/analytics"), in the
 * order the student named them. Null when no goal the planner heard covers
 * it.
 */
export function goalNamed(course: { code: string; title: string; cluster: string }, career: string): string | null {
  const profile = profileOf(career);
  const code = codeOf(course.code);
  const track = profile.tracks.find((t) => t.courses.some((row) => row.codes.map(codeOf).includes(code)));
  if (track) return track.name;
  const topic =
    profile.topics.find((t) => t.courses.map(codeOf).includes(code)) ??
    profile.topics.find((t) => t.subjects.includes(course.cluster)) ??
    profile.topics.find((t) => t.words.some((w) => titleHas(course.title, w)));
  if (topic) return topic.label;
  const byWords = profile.tracks.find((t) => t.words.some((w) => titleHas(course.title, w)));
  return byWords?.name ?? null;
}

/**
 * The short line a card, its popup, the printout and ALMA give for a course
 * the planner picked for the student's goal, or null for any other card.
 *
 * Read from what the planner recorded when it picked the course
 * (PlanMark.goal, set by planMarks): a course booked for a career track, an
 * elective whose recorded reasons say it matches what the student said they
 * want, a general education pick the goal ordered first. Required courses,
 * lists, the language, prerequisites and the student's own additions keep
 * their own labels and get none. The goal is named from the career words the
 * planner reads now (goalNamed), or the student's own word that matched
 * (`interests`), or said plainly when neither names it any more.
 */
export function goalReasonOf(
  course: { code: string; title: string; cluster: string },
  mark: PlanMark | undefined,
  words: { career: string; interests: string },
  /** The career matcher, when on: a goal pick it ranked says how close it is (career-embedding.ts reasonFor). */
  fit?: CareerFit,
): string | null {
  if (!mark?.goal) return null;
  if (mark.kind === 'track') return `Picked for your goal: ${mark.track ?? mark.label}`;
  const close = fit?.reasonFor(codeOf(course.code));
  if (close) return close.charAt(0).toUpperCase() + close.slice(1);
  const named = goalNamed(course, words.career);
  if (named) return `Picked for your goal: ${named}`;
  if (mark.kind === 'gened') return null;
  const said = [...new Set(interestWordsFrom(words.interests))].filter((w) => courseMatchesWord(course, w)).slice(0, 2);
  if (said.length > 0) return `Picked for your interest in ${said.join(' and ')}`;
  // Its catalog description is what matched (quality.ts RELEVANCE_REASONS.topics): say so, and which words.
  const topics = mark.detail?.match(/catalog topics match: ([^.;]+)/)?.[1]?.split(/,\s*/).filter(Boolean).slice(0, 2);
  if (topics?.length) return `Picked because its description mentions ${topics.join(' and ')}`;
  return 'Picked for what you said you want';
}
