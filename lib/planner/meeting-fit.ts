/**
 * Whether a student can register for a course inside the hours and days they
 * asked for, read from the section meeting signatures the build writes into
 * sections.json (illinois-data.ts summariseSections, SectionSummary.meet).
 *
 * One rule for every surface. The planner's schedule measure (quality.ts),
 * ALMA's course details and the build's lateOption all call registrationFits
 * here. They used to be three: the scorer counted any online type as a whole
 * registration, ALMA's "can avoid classes before 9" demanded every type and
 * read only a row's first start time, and for 11 courses the card and ALMA
 * gave opposite answers. CHEM 102 read as fitting "afternoons only".
 *
 * No imports, so the build step and the check harnesses can load it under
 * plain node, and the engine can use it without the Illinois adapter.
 */

/** The day letters the crawl uses. R is Thursday, S Saturday, U Sunday. */
const MEETING_DAY = /[MTWRFSU]/g;

/** A student's time wishes, in the units meet uses. Every part is optional. */
export interface MeetingWindow {
  /** Minutes since midnight no meeting may start before. 540 is 9:00 a.m. */
  notBefore?: number | null;
  /** Minutes since midnight every meeting must end by. 720 is noon. */
  notAfter?: number | null;
  /**
   * Days with no meeting, in the crawl's letters: ["F"] for Fridays off,
   * ["M", "W", "F", "S", "U"] for Tuesday/Thursday only. Leave out S and U and
   * a lab that meets Tuesday and Saturday passes as Tuesday/Thursday only.
   * "MWFSU" as one string also works.
   */
  freeDays?: string[];
}

const SIGNATURE_MEETING = /^([MTWRFSU]*)@(\d+)-(\d+)$/;

function signatureFits(
  signature: string,
  notBefore: number | null,
  notAfter: number | null,
  free: Set<string>,
): boolean {
  for (const token of signature.split(';')) {
    if (token === 'ARR') continue;
    const m = SIGNATURE_MEETING.exec(token);
    // A token the build did not write is not evidence that a section fits.
    if (!m) return false;
    if (notBefore !== null && Number(m[2]) < notBefore) return false;
    if (notAfter !== null && Number(m[3]) > notAfter) return false;
    for (const day of m[1]) if (free.has(day)) return false;
  }
  return true;
}

/**
 * The kinds of meeting a section type stands for, so an online type can be
 * paired with the in-person type it replaces.
 *
 * Read from the type's name: a lecture ("Lecture", "Online Lecture"), a lab
 * ("Laboratory", "Online Lab"), a discussion ("Discussion/Recitation",
 * "Online Discussion"), both halves of a joined name ("Lecture-Discussion" is
 * a lecture and a discussion, as IS 407's in-person sections are beside its
 * online ones), or the name itself for anything else ("quiz", "practice",
 * "conference").
 *
 * A bare "Online" is the course's class meetings taught online, its lecture
 * and discussion: ANTH 102 runs one in-person row that is both, or an online
 * section. It does not stand in for a lab, a quiz or a practicum, which an
 * online student may still attend in person: EDPR 250's online section does
 * not excuse its Friday 8 a.m. practicum conference. Inside a combined name
 * the word only says that part runs online: "Discussion/Recitation, Online"
 * is a discussion.
 */
function meetingKinds(type: string): string[] {
  const kinds: string[] = [];
  for (const raw of type.split(',')) {
    const part = raw.replace(/\bonline\b/i, '').trim().toLowerCase();
    if (!part) continue;
    const named = [
      /lecture/.test(part) ? 'lecture' : null,
      /\blab/.test(part) ? 'lab' : null,
      /discussion|recitation/.test(part) ? 'discussion' : null,
    ].filter((k): k is string => k !== null);
    for (const kind of named.length > 0 ? named : [part]) if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length > 0 ? kinds : ['lecture', 'discussion'];
}

/**
 * Can a student register for this course inside a time window?
 *
 * true when one way of taking the course fits: every section type on that
 * path has at least one section whose every meeting starts at or after
 * notBefore, ends by notAfter, and falls on no free day. Arranged meetings
 * always fit. false when no path does. null when meet is missing or empty,
 * which is "we do not know", and must not be read as either answer.
 *
 * Per type because Illinois registers one section of each type. CHEM 101 with
 * notBefore 540 is true because lecture AL1 (TR 2 p.m.) and lab row ADB
 * (Friday 11, Monday 2) both clear 9 a.m., even though 10 of its 42 lab rows
 * have an 8 a.m. meeting. Ask it for Fridays off and it is false: every lab
 * row meets on a Friday.
 *
 * Two paths, because an online type is another way to take a part of the
 * course, not one more thing every student registers for. The in-person path
 * is every in-person type, plus any online type whose kind of meeting has no
 * in-person form. The online path is every online-labelled type together,
 * each of which must fit, plus any in-person type whose kind has no online
 * form. ECON 490 runs Lecture-Discussion sections and one Online section, and
 * a student takes one or the other. CHEM 102's online path is "Online"
 * (arranged), "Online Discussion" (TR 10:00-10:50) and a Quiz, so it fits "no
 * classes before 9" and not "afternoons only"; counting "Online" alone as a
 * whole registration said it fit afternoons. ACCY 201's online discussions
 * at 9 and 10 still leave its in-person lectures on the online path, and do
 * not veto an in-person path with a noon discussion.
 *
 * What it still cannot see. CHEM 102 has no in-person 9 a.m. option only
 * because one 8 a.m. row among 77 quizzes is typed Discussion/Recitation. It
 * does not know which lecture a discussion is linked to, since the crawl does
 * not say, nor which sections are restricted: CEE 421's online sections are
 * for graduate students, and its online path still counts. Treat false as
 * "not shown to fit" and let a student override it.
 *
 * What ARR hides. A meeting that names days but no hour is signed ARR, so it
 * blocks no free day. Leaving the MTWRF placeholders aside, among the courses
 * sections.json ships that changes an answer only for hybrid rows whose
 * online half names days and no hour (10 courses): CMN 315 meets MW at
 * 2 p.m. in Lincoln Hall plus an online "F", and comes out true for Fridays
 * off on the reading that the online half keeps no set hour. If those halves
 * turn out to be live, this is where Fridays-off goes wrong.
 *
 * Pure and cheap: meet is a few short strings per type, so a planner can call
 * this for every course on every rebuild.
 */
export function registrationFits(
  meet: Record<string, string[]> | null | undefined,
  window: MeetingWindow,
): boolean | null {
  if (!meet) return null;
  const types = Object.keys(meet);
  if (types.length === 0) return null;
  const notBefore = typeof window.notBefore === 'number' ? window.notBefore : null;
  const notAfter = typeof window.notAfter === 'number' ? window.notAfter : null;
  const free = new Set<string>();
  for (const d of window.freeDays ?? []) for (const day of d.toUpperCase().match(MEETING_DAY) ?? []) free.add(day);
  const typeFits = (type: string) => (meet[type] ?? []).some((sig) => signatureFits(sig, notBefore, notAfter, free));
  const online = types.filter((type) => /online/i.test(type));
  const inPerson = types.filter((type) => !/online/i.test(type));
  const kindsIn = (list: string[]) => new Set(list.flatMap(meetingKinds));
  const inPersonKinds = kindsIn(inPerson);
  const onlineKinds = kindsIn(online);
  const inPersonPath = [...inPerson, ...online.filter((type) => !meetingKinds(type).every((k) => inPersonKinds.has(k)))];
  const onlinePath = [...online, ...inPerson.filter((type) => !meetingKinds(type).every((k) => onlineKinds.has(k)))];
  return inPersonPath.every(typeFits) || onlinePath.every(typeFits);
}

/** 540 -> "9 a.m.", 810 -> "1:30 p.m.". */
function clockOf(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h >= 12 ? 'p.m.' : 'a.m.'}`;
}

/**
 * A time window in the words the card's reason uses, "nothing before 9 a.m.,
 * F free", so ALMA repeats the card rather than paraphrasing it. Empty when
 * the window asks for nothing.
 */
export function describeMeetingWindow(window: MeetingWindow): string {
  const free = (window.freeDays ?? []).join('');
  return [
    window.notBefore != null ? `nothing before ${clockOf(window.notBefore)}` : null,
    window.notAfter != null ? `nothing after ${clockOf(window.notAfter)}` : null,
    free ? `${free} free` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** "9:00AM" -> 540. Null for anything else. */
function clockMinutes(clock: string | null | undefined): number | null {
  const m = (clock ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
}

/** One section row as the per-subject shard carries it. */
export interface SectionTimeRow {
  type: string | null;
  days: string | null;
  start: string | null;
  end: string | null;
  /** Every meeting of the row, when the crawl listed them; the top-level cells hold only the first. */
  meetings?: Array<{ days: string | null; start: string | null; end: string | null }>;
}

/**
 * When a course meets, for ALMA.
 *
 * The card's "earliest section 8:00AM" made RHET 105, with 94 sections from
 * morning to evening, read as an 8 a.m. course to a student who said no
 * early classes. This names the sections by type, every meeting of a row
 * included: CEE 458's lab-and-lecture rows meet at 1 p.m. first and 8 a.m.
 * second, and a line showing only the first said the course could be taken
 * after 9 while the scorer said it could not.
 *
 * Whether the hours fit comes from registrationFits on the same meet data
 * the planner scores, so ALMA and the card cannot disagree about a course:
 * can_avoid_before_9 for "no classes before 9", and fits_your_hours for the
 * window the student set, when they set one. Null means the build could not
 * read the course's meetings, not that it does or does not fit.
 */
export function sectionTimes(
  rows: SectionTimeRow[],
  meet: Record<string, string[]> | null | undefined,
  termLabel: string | null,
  wanted?: MeetingWindow | null,
) {
  const said = wanted ? describeMeetingWindow(wanted) : '';
  let byTypeLines: string[] | null = null;
  if (rows.length > 0) {
    const byType = new Map<string, string[]>();
    for (const r of rows) {
      const type = r.type ?? 'Section';
      const meetings = r.meetings && r.meetings.length > 0 ? r.meetings : [r];
      const timed = meetings.filter((m) => clockMinutes(m.start) !== null);
      const when = timed.length === 0 ? 'arranged/online' : timed.map((m) => `${m.days ?? 'arranged'} ${m.start}-${m.end}`).join(' + ');
      byType.set(type, [...(byType.get(type) ?? []), when]);
    }
    byTypeLines = [...byType].map(([type, list]) => {
      const distinct = [...new Set(list)];
      return `${type}: ${list.length} ${list.length === 1 ? 'section' : 'sections'} (${distinct.slice(0, 6).join('; ')}${distinct.length > 6 ? `; and ${distinct.length - 6} more times` : ''})`;
    });
  }
  return {
    sections: byTypeLines ? { term: termLabel, by_type: byTypeLines } : null,
    can_avoid_before_9: registrationFits(meet, { notBefore: 540 }),
    ...(wanted && said ? { fits_your_hours: { asked: said, fits: registrationFits(meet, wanted) } } : {}),
  };
}
