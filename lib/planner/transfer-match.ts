/**
 * Which Illinois course another school's course probably is.
 *
 * Illinois publishes no equivalency table this planner can read: its own page
 * sends students to Transferology, which needs an account, and says the
 * Transfer Evaluation Report after admission is the decision. So this file
 * never decides. It proposes, best first, with a confidence and a reason the
 * student can read, and the student confirms or leaves the line as hours.
 *
 * Two sources of a proposal. A curated table of the courses transfer students
 * hold most often (composition, calculus, general chemistry, introductory
 * psychology, public speaking, the economics principles pair), written from
 * what those courses are, because "Composition I" and "Writing and Research"
 * share no word and are the same course. Then the catalog's own titles, scored
 * by the words they share with the line's title, weighted so that a rare word
 * ("macroeconomic") counts for more than a common one ("introduction"), with a
 * nudge for the subject the other school's prefix suggests and for the level
 * its number suggests.
 */

export interface CatalogLite {
  code: string;
  title: string;
  credits: number;
  level: number;
  cluster: string;
  tags?: string[];
}

export interface EquivalentProposal {
  code: string;
  title: string;
  credits: number;
  /** 'high' is a curated equivalent or a title that matches almost word for word; 'medium' shares the distinctive words; 'low' is a guess worth showing. */
  confidence: 'high' | 'medium' | 'low';
  why: string;
  /** Set on a lab proposed alongside its lecture: the code it rides with. */
  pairedWith?: string;
}

/**
 * The subjects an Illinois course could be in, by the prefix another school
 * prints. Community colleges abbreviate differently from Illinois (ENG for
 * composition where Illinois has RHET, SPE or SPCH for speech where Illinois
 * has CMN), so the prefix is a hint about the subject and never a match.
 */
const SUBJECT_MAP: Record<string, string[]> = {
  ENG: ['RHET', 'ENGL'], ENGL: ['RHET', 'ENGL'], ENGLI: ['RHET', 'ENGL'], RHET: ['RHET'], WRT: ['RHET'], WRIT: ['RHET'],
  MAT: ['MATH'], MATH: ['MATH'], MTH: ['MATH'], MATHS: ['MATH'],
  STA: ['STAT'], STAT: ['STAT'],
  CHE: ['CHEM'], CHEM: ['CHEM'], CHM: ['CHEM'],
  PHY: ['PHYS'], PHYS: ['PHYS'], PHYSI: ['PHYS'],
  BIO: ['IB', 'MCB'], BIOL: ['IB', 'MCB'], BIOLO: ['IB', 'MCB'], BIOS: ['IB', 'MCB'],
  PSY: ['PSYC'], PSYC: ['PSYC'], PSYCH: ['PSYC'],
  SOC: ['SOC'], SOCI: ['SOC'], SOCIO: ['SOC'],
  ECO: ['ECON'], ECON: ['ECON'], ECN: ['ECON'],
  HIS: ['HIST'], HIST: ['HIST'], HST: ['HIST'], HISTO: ['HIST'],
  POL: ['PS'], POLS: ['PS'], PLS: ['PS'], POS: ['PS'], PSC: ['PS'], GOVT: ['PS'], POLI: ['PS'],
  SPE: ['CMN'], SPCH: ['CMN'], SPEEC: ['CMN'], SPC: ['CMN'], COM: ['CMN'], COMM: ['CMN'], CMN: ['CMN'],
  CSC: ['CS'], CIS: ['CS'], CS: ['CS'], CSCI: ['CS'], COSC: ['CS'], CMPSC: ['CS'], IT: ['CS'],
  PHI: ['PHIL'], PHIL: ['PHIL'],
  ART: ['ART', 'ARTH', 'ARTS'], ARTH: ['ARTH'], ARTS: ['ARTS'],
  MUS: ['MUS'], MUSI: ['MUS'],
  THE: ['THEA'], THEA: ['THEA'], THTR: ['THEA'],
  SPA: ['SPAN'], SPAN: ['SPAN'], SPN: ['SPAN'],
  FRE: ['FR'], FREN: ['FR'], FR: ['FR'],
  GER: ['GER'], GRMN: ['GER'],
  ACC: ['ACCY'], ACCT: ['ACCY'], ACCY: ['ACCY'], ACG: ['ACCY'],
  BUS: ['BUS', 'BADM'], BUSN: ['BUS', 'BADM'], MGT: ['BADM'], MKT: ['BADM'], MGMT: ['BADM'],
  GEO: ['GEOG', 'GEOL'], GEOG: ['GEOG'], GEOL: ['GEOL'], GGIS: ['GGIS'],
  AST: ['ASTR'], ASTR: ['ASTR'],
  ANT: ['ANTH'], ANTH: ['ANTH'],
  HUM: ['HUM'], REL: ['RLST'], RLST: ['RLST'],
  HLT: ['CHLH', 'KIN'], HED: ['CHLH'], PE: ['KIN'], KIN: ['KIN'], PED: ['KIN'],
  NUT: ['FSHN'], FSHN: ['FSHN'],
  ENV: ['ESE', 'NRES'], ENVS: ['ESE'],
  JOU: ['JOUR'], JOUR: ['JOUR'], JRN: ['JOUR'],
  EDU: ['EDUC', 'EPSY', 'CI'], EDUC: ['EDUC'],
  AGR: ['ACES', 'ACE'], AGRI: ['ACES'],
  LIN: ['LING'], LING: ['LING'],
};

/**
 * Courses that transfer students hold most often, and the Illinois course
 * each is. Every target is a real catalog code (checked against the index by
 * a repo check). A rule that names no course means Illinois grants elective
 * hours for it, and says why.
 */
interface CuratedRule {
  test: RegExp;
  /** Prefix families the rule applies to, or empty for any. */
  prefixes?: string[];
  code: string | null;
  confidence: 'high' | 'medium';
  why: string;
  /** A second course the line usually also earns (a lab folded into a 5-hour chemistry course). */
  also?: string;
}

const CURATED: CuratedRule[] = [
  // Illinois's Composition I is a two-course sequence for transfer students
  // (Parkland's ENG 101 "paired with" ENG 102; IAI C1 900 with C1 901R), so the
  // first course alone is never Composition I. matchTranscript pairs the two.
  { test: /\b(composition|rhetoric|writing)\b.*\b1\b|\b(english|college) composition\b(?!.*\b2\b)|\bcomposition\b(?!.*\b2\b)|\bcollege writing\b|\bfirst[- ]year writing\b/, prefixes: ['RHET', 'ENGL'], code: 'RHET 105', confidence: 'medium', why: 'Illinois meets Composition I with the two-course composition sequence; this course together with the second one counts as Composition I (RHET 105). On its own it is elective hours.' },
  { test: /\b(composition|writing)\b.*\b2\b|\bcomposition 2\b|\bargument/, prefixes: ['RHET', 'ENGL'], code: null, confidence: 'high', why: 'The second composition course completes Composition I together with the first; on its own it is elective hours.' },
  { test: /\bcollege algebra\b/, prefixes: ['MATH'], code: 'MATH 112', confidence: 'high', why: 'College algebra is MATH 112 at Illinois.' },
  { test: /\b(pre-?calculus|preparation for calculus|precalc)\b/, prefixes: ['MATH'], code: 'MATH 115', confidence: 'high', why: 'Precalculus is MATH 115 at Illinois.' },
  { test: /\btrigonometry\b/, prefixes: ['MATH'], code: null, confidence: 'medium', why: 'Illinois has no separate trigonometry course; it transfers as elective hours, and MATH 115 covers the material.' },
  { test: /\bcalculus\b(?!.*\b(business|life|social|applied|brief|survey)\b).*\b1\b|\bcalculus 1\b|\bcalculus\b.*\banalytic\b.*\b1\b/, prefixes: ['MATH'], code: 'MATH 221', confidence: 'high', why: 'The first calculus course is MATH 221 at Illinois.' },
  { test: /\bcalculus\b.*\b2\b/, prefixes: ['MATH'], code: 'MATH 231', confidence: 'high', why: 'The second calculus course is MATH 231 at Illinois.' },
  { test: /\bcalculus\b.*\b3\b|\bmultivariable\b|\bmultivariate calculus\b/, prefixes: ['MATH'], code: 'MATH 241', confidence: 'high', why: 'The third calculus course is MATH 241 at Illinois.' },
  { test: /\b(business|applied|brief|survey of|life science) calculus\b|\bcalculus for business\b/, prefixes: ['MATH'], code: 'MATH 234', confidence: 'medium', why: 'A business or applied calculus course is closest to MATH 234, which the business core accepts.' },
  { test: /\blinear algebra\b/, prefixes: ['MATH'], code: 'MATH 257', confidence: 'medium', why: 'Introductory linear algebra is MATH 257 (or MATH 415) at Illinois.' },
  { test: /\bdifferential equations?\b/, prefixes: ['MATH'], code: 'MATH 285', confidence: 'medium', why: 'A first differential equations course is MATH 285 at Illinois.' },
  { test: /\b(introductory|elementary|introduction to|intro|general|basic|principles of)?\s*statistics\b|\bstatistical\b/, prefixes: ['MATH', 'STAT', 'PSYC', 'BADM', 'ECON'], code: 'STAT 100', confidence: 'medium', why: 'An introductory statistics course usually transfers as STAT 100.' },
  { test: /\bgeneral chemistry\b.*\b1\b|\bchemistry 1\b|\bcollege chemistry\b.*\b1\b/, prefixes: ['CHEM'], code: 'CHEM 102', confidence: 'high', why: 'The first general chemistry course is CHEM 102 at Illinois; a course with a lab in it also earns CHEM 103.', also: 'CHEM 103' },
  { test: /\bgeneral chemistry\b.*\b2\b|\bchemistry 2\b/, prefixes: ['CHEM'], code: 'CHEM 104', confidence: 'high', why: 'The second general chemistry course is CHEM 104 at Illinois; with a lab it also earns CHEM 105.', also: 'CHEM 105' },
  { test: /\borganic chemistry\b.*\b1\b/, prefixes: ['CHEM'], code: 'CHEM 232', confidence: 'medium', why: 'The first organic chemistry course is CHEM 232 at Illinois.' },
  { test: /\bphysics\b.*\b(mechanics|calculus|engineers?|scientists?)\b|\b(mechanics|calculus)\b.*\bphysics\b|\buniversity physics\b.*\b1\b/, prefixes: ['PHYS'], code: 'PHYS 211', confidence: 'high', why: 'Calculus-based mechanics is PHYS 211 at Illinois.' },
  { test: /\bphysics\b.*\b(electricity|magnetism|e ?& ?m|elec)\b|\buniversity physics\b.*\b2\b/, prefixes: ['PHYS'], code: 'PHYS 212', confidence: 'high', why: 'Calculus-based electricity and magnetism is PHYS 212 at Illinois.' },
  { test: /\b(general|college|introductory|conceptual) physics\b.*\b1\b|\bphysics 1\b/, prefixes: ['PHYS'], code: 'PHYS 101', confidence: 'medium', why: 'Algebra-based first-semester physics is PHYS 101 at Illinois; if the course used calculus it is PHYS 211.' },
  { test: /\b(general|college|introductory) physics\b.*\b2\b|\bphysics 2\b/, prefixes: ['PHYS'], code: 'PHYS 102', confidence: 'medium', why: 'Algebra-based second-semester physics is PHYS 102 at Illinois; if the course used calculus it is PHYS 212.' },
  { test: /\b(general|principles of|introductory|introduction to|college) biology\b|\bbiology 1\b/, prefixes: ['IB', 'MCB'], code: 'IB 150', confidence: 'medium', why: 'Illinois splits introductory biology into IB 150 (organismal) and MCB 150 (molecular and cellular); a general biology course is usually one of them.' },
  { test: /\b(anatomy|physiology)\b/, prefixes: ['IB', 'MCB', 'KIN'], code: 'MCB 244', confidence: 'medium', why: 'Human anatomy and physiology starts at MCB 244 at Illinois.' },
  { test: /\b(introduction to|intro|general|principles of|introductory) psychology\b|\bpsychology 1\b/, prefixes: ['PSYC'], code: 'PSYC 100', confidence: 'high', why: 'Introductory psychology is PSYC 100 at Illinois.' },
  { test: /\b(introduction to|intro|principles of|introductory) sociology\b|\bsociology 1\b/, prefixes: ['SOC'], code: 'SOC 100', confidence: 'high', why: 'Introductory sociology is SOC 100 at Illinois.' },
  { test: /\bmacro-?economic/, prefixes: ['ECON', 'BUS', 'BADM'], code: 'ECON 103', confidence: 'high', why: 'Principles of macroeconomics is ECON 103 at Illinois.' },
  { test: /\bmicro-?economic/, prefixes: ['ECON', 'BUS', 'BADM'], code: 'ECON 102', confidence: 'high', why: 'Principles of microeconomics is ECON 102 at Illinois.' },
  { test: /\bpublic speaking\b|\b(fundamentals of|introduction to|intro|principles of|basic) (speech|oral communication)\b|\bspeech communication\b|\bspeech\b/, prefixes: ['CMN'], code: 'CMN 101', confidence: 'high', why: 'A public speaking or fundamentals of speech course is CMN 101 at Illinois.' },
  { test: /\binterpersonal communication\b/, prefixes: ['CMN'], code: 'CMN 102', confidence: 'medium', why: 'Interpersonal communication is CMN 102 at Illinois.' },
  { test: /\b(u\.?s\.?|united states|american) history\b.*\b(to|before|through|until) 18(65|77)\b|\b(u\.?s\.?|united states|american) history\b.*\b1\b/, prefixes: ['HIST'], code: 'HIST 171', confidence: 'high', why: 'Early United States history is HIST 171 at Illinois.' },
  { test: /\b(u\.?s\.?|united states|american) history\b.*\b(since|after|from) 18(65|77)\b|\b(u\.?s\.?|united states|american) history\b.*\b2\b/, prefixes: ['HIST'], code: 'HIST 172', confidence: 'high', why: 'United States history since 1877 is HIST 172 at Illinois.' },
  { test: /\bwestern civilization\b.*\b1\b|\bwestern civ\b.*\b1\b/, prefixes: ['HIST'], code: 'HIST 141', confidence: 'medium', why: 'Early Western civilization is HIST 141 at Illinois.' },
  { test: /\bwestern civilization\b.*\b2\b|\bwestern civ\b.*\b2\b/, prefixes: ['HIST'], code: 'HIST 142', confidence: 'medium', why: 'Modern Western civilization is HIST 142 at Illinois.' },
  { test: /\b(american|u\.?s\.?|united states) (national )?(government|politics)\b|\bintroduction to american government\b/, prefixes: ['PS'], code: 'PS 101', confidence: 'high', why: 'Introductory American government is PS 101 at Illinois.' },
  { test: /\b(introduction to|intro|problems of) philosophy\b/, prefixes: ['PHIL'], code: 'PHIL 101', confidence: 'high', why: 'Introductory philosophy is PHIL 101 at Illinois.' },
  { test: /\b(introduction to |intro )?logic\b/, prefixes: ['PHIL'], code: 'PHIL 102', confidence: 'medium', why: 'Introductory logic is PHIL 102 at Illinois.' },
  { test: /\bethics\b/, prefixes: ['PHIL'], code: 'PHIL 104', confidence: 'medium', why: 'An introductory ethics course is PHIL 104 at Illinois.' },
  { test: /\b(introduction to|intro) (computer science|programming)\b.*\b1\b|\bcomputer science 1\b|\bprogramming 1\b|\b(introduction to|intro) (programming|computer science)\b|\bjava\b|\bc\+\+\b|\bpython\b/, prefixes: ['CS'], code: 'CS 124', confidence: 'medium', why: 'A first programming course is closest to CS 124 at Illinois; Grainger decides case by case, and CS 101 is the version for engineers outside CS.' },
  { test: /\b(introduction to|intro) (computer science|programming)\b.*\b2\b|\bcomputer science 2\b|\bprogramming 2\b|\bdata structures\b/, prefixes: ['CS'], code: 'CS 128', confidence: 'medium', why: 'A second programming course is closest to CS 128 at Illinois.' },
  { test: /\b(introduction to|intro to|intro) (computing|computers|information technology)\b|\bcomputer literacy\b|\bcomputer applications\b/, prefixes: ['CS'], code: 'CS 105', confidence: 'medium', why: 'A computing survey course is closest to CS 105 at Illinois.' },
  { test: /\b(financial|principles of|introduction to|introductory) accounting\b(?!.*\b2\b)|\baccounting 1\b/, prefixes: ['ACCY'], code: 'ACCY 201', confidence: 'high', why: 'First-semester financial accounting is ACCY 201 at Illinois.' },
  { test: /\bmanagerial accounting\b|\baccounting 2\b/, prefixes: ['ACCY'], code: 'ACCY 202', confidence: 'high', why: 'Managerial accounting is ACCY 202 at Illinois.' },
  { test: /\b(introduction to|intro to|intro) business\b/, prefixes: ['BUS', 'BADM'], code: 'BUS 101', confidence: 'medium', why: 'An introduction to business course is closest to BUS 101 at Illinois.' },
  { test: /\bnutrition\b/, prefixes: ['FSHN', 'CHLH', 'KIN'], code: 'FSHN 120', confidence: 'medium', why: 'Introductory nutrition is FSHN 120 at Illinois.' },
  { test: /\bintermediate spanish\b.*\b1\b|\bspanish 3\b/, prefixes: ['SPAN'], code: 'SPAN 201', confidence: 'high', why: 'Third-semester Spanish is SPAN 201 at Illinois.' },
  { test: /\bintermediate spanish\b.*\b2\b|\bspanish 4\b/, prefixes: ['SPAN'], code: 'SPAN 203', confidence: 'medium', why: 'Fourth-semester Spanish is SPAN 203 (or SPAN 228) at Illinois, per the registrar\'s language table.' },
  { test: /^(?!.*intermediate).*(\b(elementary|beginning) spanish\b.*\b1\b|\bspanish 1\b)/, prefixes: ['SPAN'], code: 'SPAN 101', confidence: 'high', why: 'First-semester Spanish is SPAN 101 at Illinois.' },
  { test: /^(?!.*intermediate).*(\b(elementary|beginning) spanish\b.*\b2\b|\bspanish 2\b)/, prefixes: ['SPAN'], code: 'SPAN 102', confidence: 'high', why: 'Second-semester Spanish is SPAN 102 at Illinois.' },
  { test: /\bintermediate french\b.*\b1\b|\bfrench 3\b/, prefixes: ['FR'], code: 'FR 203', confidence: 'medium', why: 'Third-semester French is FR 203 at Illinois, per the registrar\'s language table.' },
  { test: /\bintermediate french\b.*\b2\b|\bfrench 4\b/, prefixes: ['FR'], code: 'FR 204', confidence: 'medium', why: 'Fourth-semester French is FR 204 at Illinois, per the registrar\'s language table.' },
  { test: /^(?!.*intermediate).*(\b(elementary|beginning) french\b.*\b1\b|\bfrench 1\b)/, prefixes: ['FR'], code: 'FR 101', confidence: 'high', why: 'First-semester French is FR 101 at Illinois.' },
  { test: /^(?!.*intermediate).*(\b(elementary|beginning) french\b.*\b2\b|\bfrench 2\b)/, prefixes: ['FR'], code: 'FR 102', confidence: 'high', why: 'Second-semester French is FR 102 at Illinois.' },
  { test: /\bastronomy\b/, prefixes: ['ASTR', 'PHYS'], code: 'ASTR 100', confidence: 'medium', why: 'Introductory astronomy is ASTR 100 at Illinois.' },
  { test: /\b(physical|introductory|introduction to) geology\b|\bgeology\b/, prefixes: ['GEOL'], code: 'GEOL 100', confidence: 'medium', why: 'Introductory geology is GEOL 100 at Illinois.' },
  { test: /\b(cultural|introduction to|intro) anthropology\b|\banthropology\b/, prefixes: ['ANTH'], code: 'ANTH 103', confidence: 'medium', why: 'Introductory cultural anthropology is ANTH 103 at Illinois.' },
  { test: /\b(art|music|theat(re|er)) appreciation\b|\bintroduction to (art|music|theat(re|er))\b/, prefixes: ['ART', 'ARTH', 'MUS', 'THEA'], code: null, confidence: 'medium', why: 'Appreciation courses transfer as hours in the subject; Illinois names the gen-ed credit after review.' },
];

const ABBREVIATIONS: Record<string, string> = {
  intro: 'introduction', introductory: 'introduction', prin: 'principles', princ: 'principles', gen: 'general', genl: 'general',
  calc: 'calculus', comp: 'composition', amer: 'american', hist: 'history', psych: 'psychology', psy: 'psychology',
  soc: 'sociology', econ: 'economics', chem: 'chemistry', bio: 'biology', biol: 'biology', phys: 'physics', stat: 'statistics',
  stats: 'statistics', elem: 'elementary', interm: 'intermediate', mgmt: 'management', mgt: 'management', acct: 'accounting',
  accy: 'accounting', anat: 'anatomy', physiol: 'physiology', engl: 'english', lit: 'literature', univ: 'university',
  geom: 'geometry', analyt: 'analytic', fund: 'fundamentals', fundamentals: 'fundamentals', appl: 'applied', evol: 'evolutionary',
  org: 'organic', prob: 'probability', diff: 'differential', eq: 'equations', eqs: 'equations', lab: 'laboratory', labs: 'laboratory',
  amp: 'and', '&': 'and', us: 'us', 'u.s.': 'us', usa: 'us', govt: 'government', gov: 'government', pol: 'political', sci: 'science',
  tech: 'technology', bus: 'business', mkt: 'marketing', fin: 'finance', nutr: 'nutrition', anth: 'anthropology', phil: 'philosophy',
  rel: 'religion', span: 'spanish', fren: 'french', ger: 'german', mech: 'mechanics', elec: 'electricity', mag: 'magnetism',
};

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'for', 'and', 'with', 'on', 'at', 'by', 'or', 'from', 'its', 'as', 'course', 'courses', 'college', 'i', 'ii', 'iii', 'iv']);
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

/** The words of a title, expanded, stemmed lightly and free of noise. */
export function titleTokens(title: string): string[] {
  const out: string[] = [];
  const cleaned = title.toLowerCase().replace(/[()[\]:;,/\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const raw of cleaned.split(' ')) {
    let word = raw.replace(/[.']/g, '');
    if (!word) continue;
    if (ROMAN[word]) word = ROMAN[word];
    if (ABBREVIATIONS[word]) word = ABBREVIATIONS[word];
    if (STOPWORDS.has(word)) continue;
    // "macroeconomics" and "macroeconomic", "principles" and "principle" are one word.
    if (word.length > 4) word = word.replace(/ies$/, 'y').replace(/(ics|ic)$/, 'ic').replace(/s$/, '');
    out.push(word);
  }
  return out;
}

let indexCache: { catalog: CatalogLite[]; df: Map<string, number>; tokens: Map<string, string[]> } | null = null;

function indexOf(catalog: CatalogLite[]) {
  if (indexCache && indexCache.catalog === catalog) return indexCache;
  const df = new Map<string, number>();
  const tokens = new Map<string, string[]>();
  for (const course of catalog) {
    const t = [...new Set(titleTokens(course.title))];
    tokens.set(course.code, t);
    for (const word of t) df.set(word, (df.get(word) ?? 0) + 1);
  }
  indexCache = { catalog, df, tokens };
  return indexCache;
}

/** The level a school's number suggests: "128" and "1101" are both first-year. */
function levelOf(code: string): number | null {
  const number = code.match(/\b(\d{3,4})[A-Z]{0,2}$/)?.[1];
  if (!number) return null;
  return Number(number[0]) * 100;
}

function prefixOf(code: string): string {
  return code.split(' ')[0] ?? '';
}

/** A title written the way the curated rules read it: expanded and with numerals as digits. */
function curatedKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[()[\]:;,/]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(i{1,3}|iv|v)\b/g, (m) => ROMAN[m] ?? m)
    .replace(/\b(intro|introductory)\b/g, 'introduction to')
    .replace(/\bintroduction to to\b/g, 'introduction to')
    .replace(/\bprin\b/g, 'principles of')
    .replace(/\bprinciples of of\b/g, 'principles of')
    .replace(/\bgen\b/g, 'general')
    .replace(/\bcalc\b/g, 'calculus')
    .replace(/\bcomp\b/g, 'composition')
    .replace(/\bchem\b/g, 'chemistry')
    .replace(/\bpsych\b/g, 'psychology')
    .replace(/\bamer\b/g, 'american')
    .replace(/\bhist\b/g, 'history')
    .replace(/\bfund\b/g, 'fundamentals of')
    .replace(/\bfundamentals of of\b/g, 'fundamentals of')
    .replace(/\banalytic\w*\b/g, 'analytic')
    .replace(/\bgeom\w*\b/g, 'geometry')
    .trim();
}

/**
 * Illinois courses another school's line could be, best first.
 *
 * A curated rule that matches wins the top spot. The title scorer fills the
 * rest, so a student whose course the table never heard of still sees the
 * catalog's closest titles, and a student whose course it did hear of sees
 * the alternatives under it.
 */
export function proposeEquivalents(
  line: { code: string; title: string | null; credits: number | null },
  catalog: CatalogLite[],
  limit = 3,
): EquivalentProposal[] {
  if (catalog.length === 0) return [];
  const known = new Map(catalog.map((c) => [c.code, c]));
  const prefix = prefixOf(line.code);
  const subjects = new Set(SUBJECT_MAP[prefix] ?? []);
  const out: EquivalentProposal[] = [];
  const taken = new Set<string>();
  const title = line.title ?? '';

  if (title) {
    const key = curatedKey(title);
    for (const rule of CURATED) {
      if (rule.prefixes && rule.prefixes.length > 0 && subjects.size > 0 && !rule.prefixes.some((p) => subjects.has(p))) continue;
      if (!rule.test.test(key)) continue;
      // The table's own word that Illinois grants hours for this course, not
      // a class: nothing else is proposed, or a title that half-matches would
      // sit in the list looking like an alternative.
      if (rule.code === null) return [];
      const course = known.get(rule.code);
      if (!course) break;
      const also = rule.also && line.credits !== null && line.credits >= course.credits + 1 ? known.get(rule.also) : undefined;
      out.push({
        code: course.code,
        title: course.title,
        credits: course.credits,
        confidence: rule.confidence,
        why: also ? `${rule.why}` : rule.why.replace(/;[^.]*(also earns|with a lab)[^.]*\./, '.'),
      });
      taken.add(course.code);
      if (also && !taken.has(also.code)) {
        out.push({ code: also.code, title: also.title, credits: also.credits, confidence: rule.confidence, why: `Usually earned with ${course.code} when the course had a lab.`, pairedWith: course.code });
        taken.add(also.code);
      }
      break;
    }
  }

  const { df, tokens } = indexOf(catalog);
  const lineTokens = [...new Set(titleTokens(title))];
  if (lineTokens.length > 0) {
    const n = catalog.length;
    const idf = (word: string) => Math.log((n + 1) / ((df.get(word) ?? 0) + 1)) + 0.1;
    const lineWeight = lineTokens.reduce((sum, w) => sum + idf(w), 0);
    const level = levelOf(line.code);
    const scored: Array<{ course: CatalogLite; score: number; shared: string[] }> = [];
    for (const course of catalog) {
      if (taken.has(course.code)) continue;
      const t = tokens.get(course.code) ?? [];
      if (t.length === 0) continue;
      const shared = lineTokens.filter((w) => t.includes(w));
      if (shared.length === 0) continue;
      const sharedWeight = shared.reduce((sum, w) => sum + idf(w), 0);
      const courseWeight = t.reduce((sum, w) => sum + idf(w), 0);
      let score = 0.7 * (sharedWeight / lineWeight) + 0.3 * (sharedWeight / courseWeight);
      if (subjects.size > 0) score += subjects.has(course.cluster) ? 0.12 : -0.08;
      if (level !== null) {
        if (course.level === level) score += 0.05;
        else if (course.level >= 300 && level <= 200) score -= 0.15;
        else if (Math.abs(course.level - level) > 100) score -= 0.05;
      }
      if (line.credits !== null && Math.abs(line.credits - course.credits) >= 2) score -= 0.05;
      scored.push({ course, score, shared });
    }
    scored.sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code));
    for (const { course, score, shared } of scored) {
      if (out.length >= limit) break;
      if (score < 0.4) break;
      // High only for a title that is the same title: every word shared both
      // ways, a level the line's number allows, real hours. "Intro Psych" for
      // "Introduction to Psychology" is that; a 400-level course whose title
      // happens to contain the same three words is not.
      const t = tokens.get(course.code) ?? [];
      const identical = shared.length === lineTokens.length && shared.length === t.length;
      const levelOk = level === null || course.level <= level + 100;
      const confidence: EquivalentProposal['confidence'] =
        identical && levelOk && course.credits > 0 ? 'high' : score >= 0.62 && (levelOk || course.level < 300) ? 'medium' : 'low';
      out.push({
        code: course.code,
        title: course.title,
        credits: course.credits,
        confidence,
        why: `Its title shares ${shared.length === lineTokens.length ? 'every word' : `"${shared.join('", "')}"`} with "${title}"${subjects.has(course.cluster) ? ` and it is in the subject ${prefix} suggests` : ''}.`,
      });
      taken.add(course.code);
    }
  }
  return out.slice(0, limit);
}

/** Every code the curated table names, so a repo check can prove each exists. */
export function curatedTargets(): string[] {
  const out = new Set<string>();
  for (const rule of CURATED) {
    if (rule.code) out.add(rule.code);
    if (rule.also) out.add(rule.also);
  }
  return [...out];
}


/** A published guide's statement of which Illinois gen-ed categories a school's courses meet. */
export interface TransferGenEdGuide {
  source: string;
  title: string;
  effective: string | null;
  schools: Array<{
    name: string;
    /** Lower-case words that identify the school on a transcript. */
    match: string[];
    courses: Record<string, { title: string; tags: string[] }>;
    paired: Array<{ courses: string[]; tags: string[]; why: string; lab?: string }>;
    language: Record<string, { title: string; semester: number | null; language: string | null }>;
  }>;
}

let guideCache: Promise<TransferGenEdGuide | null> | null = null;

/** The published transfer gen-ed guides, loaded once. Null when the file is missing. */
export function loadTransferGenEd(): Promise<TransferGenEdGuide | null> {
  if (!guideCache) {
    guideCache = fetch('/illinois-transfer-gened.json')
      .then((r) => (r.ok ? (r.json() as Promise<TransferGenEdGuide>) : null))
      .catch(() => {
        guideCache = null;
        return null;
      });
  }
  return guideCache;
}

/** The guide entry for a school named on a transcript, or null. */
export function guideSchool(guide: TransferGenEdGuide | null | undefined, school: string | null | undefined) {
  if (!guide || !school) return null;
  const name = school.toLowerCase();
  return guide.schools.find((s) => s.match.some((word) => name.includes(word))) ?? null;
}

/**
 * The catalog's gen-ed strings for the categories a document prints beside a
 * line: "Gen Ed: SBS", "Humanities", "NST - Life Science", "QR I". A category
 * the words do not name clearly is left out rather than guessed.
 */
export function genEdTagsFromText(text: string | null | undefined): string[] {
  const s = ` ${String(text ?? '').toLowerCase()} `;
  const out = new Set<string>();
  if (/\bcomposition i\b|\bcomp(osition)? 1\b/.test(s) && !/advanced/.test(s)) out.add('Composition I');
  if (/advanced composition|\bacp\b/.test(s)) out.add('Advanced Composition');
  if (/hist(orical)?\s*(&|and)?\s*phil/.test(s)) out.add('Humanities - Hist & Phil');
  if (/lit(erature)?\s*(&|and)?\s*(the\s*)?arts/.test(s)) out.add('Humanities - Lit & Arts');
  if (/\bhumanities\b|\bhum\b/.test(s) && !/hist(orical)?\s*(&|and)?\s*phil|lit(erature)?\s*(&|and)?\s*(the\s*)?arts/.test(s)) out.add('Humanities - Lit & Arts');
  if (/behavioral sci|beh(avioral)?\s*sci|\bbsc\b/.test(s)) out.add('Social & Beh Sci - Beh Sci');
  if (/social sci|soc(ial)?\s*sci|\bsbs\b|social\s*(&|and)\s*beh/.test(s) && !out.has('Social & Beh Sci - Beh Sci')) out.add('Social & Beh Sci - Soc Sci');
  if (/life sci/.test(s)) out.add('Nat Sci & Tech - Life Sciences');
  if (/phys(ical)?\s*sci/.test(s)) out.add('Nat Sci & Tech - Phys Sciences');
  if (/natural sci|\bnst\b/.test(s) && !/life sci|phys(ical)?\s*sci/.test(s)) out.add('Nat Sci & Tech - Phys Sciences');
  if (/non-?\s?west/.test(s)) out.add('Cultural Studies - Non-West');
  if (/us minority|u\.s\. minority|\busm\b/.test(s)) out.add('Cultural Studies - US Minority');
  if (/\bwestern\b|comparative cultures/.test(s) && !/non-?\s?west/.test(s)) out.add('Cultural Studies - Western');
  if (/quantitative reasoning ii\b|\bqr\s*(ii|2)\b/.test(s)) out.add('Quantitative Reasoning II');
  else if (/quantitative reasoning i\b|\bqr\s*(i|1)\b|quantitative reasoning/.test(s)) out.add('Quantitative Reasoning I');
  return [...out];
}
