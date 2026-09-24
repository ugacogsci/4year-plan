/**
 * The advisor: a model that can read the board and change it.
 *
 * The board, the catalog and every rule about them live in the browser, and
 * the model lives behind /api/advisor. So the loop is split down the middle:
 * the server runs one model step and streams it back; the browser executes
 * every tool the model asked for against the real board, appends the results,
 * and asks for the next step. The server keeps nothing between requests, which
 * is what keeps the API key on the server and a student's plan off it.
 *
 * Every tool that changes the board goes through the same checks the board
 * itself runs (prerequisites, standing, credit rules, twins, the term maximum),
 * so the model cannot put a course where the finder would refuse it. The one
 * thing the checks cannot decide is whether a student wants a required course
 * gone, and that is why removal and replacement of anything the degree names
 * ask for a confirmation the model has to obtain in the conversation first.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type AdvisorMessage = Anthropic.Beta.BetaMessageParam;
export type AdvisorBlock = Anthropic.Beta.BetaContentBlock;

/** The model the advisor runs on. One place, because the route and the UI both name it. */
export const ADVISOR_MODEL = 'claude-opus-5';

// ---------------------------------------------------------------------------
// The tools, as the model sees them
// ---------------------------------------------------------------------------

export const ADVISOR_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_courses',
    description:
      'Find courses in the Illinois catalog by code, title or department, e.g. "history", "HIST 2", "data science". When term is given, only courses the student could actually take in that term are returned: prerequisites met by what is earlier on the board, class standing met, nothing the catalog says does not count beside a course already held, nothing already on the board. Each result carries fit: how well it matches the student\'s priorities (0 to 1) and the reasons in words. Use this before adding or replacing anything, and prefer the better fit when the student has not named a course.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A code, part of a title, or a department name or topic.' },
        term: { type: 'string', description: 'A term on the board, like "Fall 2027". Restricts results to courses eligible in that term.' },
        limit: { type: 'integer', minimum: 1, maximum: 40, description: 'How many to return. Default 12.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'course_details',
    description:
      "Everything the planner holds about one course: the catalog description, its prerequisite sentence, general education categories, grade history, its record on the university's Teachers Ranked as Excellent lists, how it fits the student's priorities and why, how many sections ran in the crawled term, and whether it is on the board or already taken.",
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'A course code like "HIST 200".' } },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'term_summary',
    description:
      'One term of the board: its courses with why each is there (required, from a list, elective slot, or added by the student), its credit hours, how heavy it reads against Illinois grade history, and any review issues on it.',
    input_schema: {
      type: 'object',
      properties: { term: { type: 'string', description: 'A term label like "Spring 2028".' } },
      required: ['term'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_course',
    description:
      'Put a course on the board. With a term, it goes there if the checks allow it; without one, the earliest term where it is eligible and under the credit maximum is chosen. Fails, with the reason, when a prerequisite is not met, standing is too low, the term would pass 18 credits, or the catalog says the course does not count beside something the student has.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        term: { type: 'string', description: 'A term label like "Fall 2028". Optional.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_course',
    description:
      'Take a course off the board. A course the degree requires, one filling a "from a list" requirement, or one booked for the student\'s career track, is only removed when confirmed is true, which you may set only after the student has said yes in this conversation to removing that specific course. Elective slots and courses the student added can be removed freely.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        confirmed: { type: 'boolean', description: 'True only after the student explicitly agreed to remove this required course.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'replace_course',
    description:
      'Swap one course on the board for another in the same term, keeping the term the same size. The usual way to act on an interest: replace an elective slot with a course the student would rather take. Replacing a required, from-a-list or career-track course needs confirmed true, obtained the same way as for remove_course. The replacement must pass the same checks as add_course.',
    input_schema: {
      type: 'object',
      properties: {
        remove: { type: 'string', description: 'The code coming off the board.' },
        add: { type: 'string', description: 'The code going on in its place.' },
        confirmed: { type: 'boolean' },
      },
      required: ['remove', 'add'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_course',
    description: 'Move a course on the board to another term, if the checks allow it there.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' }, term: { type: 'string' } },
      required: ['code', 'term'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_courses',
    description:
      "Two to six courses side by side: credits, prerequisites, grade history, Teachers Ranked as Excellent record, which recent terms each has actually run in, general education categories, fit against the student's priorities with the reasons, and, when a term is given, whether each could go in that term and why not. Use it whenever the student is choosing between courses or asks which is better; then weigh the facts for them instead of listing them.",
    input_schema: {
      type: 'object',
      properties: {
        codes: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
        term: { type: 'string', description: 'A term on the board, to check eligibility there. Optional.' },
      },
      required: ['codes'],
      additionalProperties: false,
    },
  },
  {
    name: 'explain_choice',
    description:
      'Why a course is where it is. For a required course: the requirement that names it and what later courses on the board depend on it. For an elective slot or a from-a-list pick: the reasons the planner chose it, and the runners-up it beat with their scores and reasons. Use it when the student asks why, or before you propose replacing something, so you argue from the actual comparison.',
    input_schema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'what_if',
    description:
      'Try one or more changes on a copy of the board without making them: add, remove, replace or move. Returns what the checks would say (prerequisites, standing, courses that do not count together, terms over 18), each term\'s credits afterwards, any later course that would lose a prerequisite, and how the new courses fit the student\'s priorities. Use it to reason before acting, and to answer "what happens if" questions. Nothing on the board changes.',
    input_schema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['add', 'remove', 'replace', 'move'] },
              code: { type: 'string', description: 'The course acted on; for replace, the one coming off.' },
              term: { type: 'string', description: 'For add and move, the destination term.' },
              add: { type: 'string', description: 'For replace, the course going on.' },
            },
            required: ['op', 'code'],
            additionalProperties: false,
          },
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'review_board',
    description:
      "The planner's own read of the whole board: each term's credits and how heavy it reads against Illinois grade history, terms that stack several hardest-band courses, courses that have not run in any recent term, courses placed in a season they have not run in, requirements still open, and the review flags. Call it first when the student asks whether their plan is good, balanced, realistic, or what to change; then give your own judgement, not a list.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'program_admission',
    description:
      "What a college publishes about getting in from another college on campus: Gies College of Business (intercollegiate transfer for first-year students: 24 graded hours, Composition I, ECON 102 and 103, a math course, all by the end of the first spring, plus a competitive application) and The Grainger College of Engineering (the transfer coursework and GPA it publishes). Returns the requirements with their source page, and checks each required course against the student's board and prior credit. Use it whenever the student asks how to get into, transfer into, switch to, or apply to a college or business school, or says they are not yet in the college their goal major belongs to.",
    input_schema: {
      type: 'object',
      properties: { college: { type: 'string', description: 'A college name or code: "business", "gies", "bus", "engineering", "grainger".' } },
      required: ['college'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_priorities',
    description:
      "Change what the planner optimises for when it picks electives and orders choices: lighter workload (Illinois grade history), highly rated teaching (the university's own Teachers Ranked as Excellent lists), relevance to what the student is studying and wants to do after, covering more requirements at once, and fitting the schedule (a time window such as nothing before 9 or afternoons only, days off, online or in person; judged on whether a whole registration fits the crawled term's sections, since the planner picks courses, not sections). Each knob is 0 (ignore), 1 (counts) or 2 (matters most); a preset sets all five. Use it when the student says what they care about: \"I want easy classes\", \"I want the best professors\", \"no 8 a.m.s\". With repick true (the default) the planner swaps its own picks, the elective slots and the from-a-list courses, for the best under the new priorities and leaves required, career-track and student-added courses alone, never breaking a prerequisite, overloading a term or using a term a course does not run in; the result lists the net changes, so tell the student. The same priorities and interests the board was built or last re-picked for move nothing, and the result says so.",
    input_schema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['balanced', 'lightest', 'relevant', 'teaching'] },
        workload: { type: 'integer', enum: [0, 1, 2] },
        teaching: { type: 'integer', enum: [0, 1, 2] },
        relevance: { type: 'integer', enum: [0, 1, 2] },
        coverage: { type: 'integer', enum: [0, 1, 2] },
        schedule: { type: 'integer', enum: [0, 1, 2] },
        noEarly: { type: 'boolean', description: 'True when the student wants nothing before 9 a.m.' },
        notBefore: { type: 'integer', minimum: 0, maximum: 1440, description: 'No class starting before this many minutes after midnight: "afternoons only" is 720, "nothing before 10" is 600.' },
        notAfter: { type: 'integer', minimum: 0, maximum: 1440, description: 'No class ending after this many minutes after midnight: "done by 3 p.m." is 900.' },
        freeDays: { type: 'array', items: { type: 'string', enum: ['M', 'T', 'W', 'R', 'F'] }, description: 'Days the student wants free: "Fridays off" is ["F"], "Tuesday/Thursday only" is ["M", "W", "F"].' },
        format: { type: 'string', enum: ['any', 'in-person', 'online'] },
        interests: { type: 'string', description: 'What the student said they want to do, in their own words ("machine learning", "pre-PT, physical therapy school", "investment banking"). These are the career words the planner reads career tracks and topics from, and ranks electives and list picks against; the result says what it recognised and which tracks and topics are now active.' },
        interests_mode: {
          type: 'string',
          enum: ['add', 'replace', 'clear'],
          description: 'How interests changes the stored career words. add (the default): added to them, for another interest ("also some data science"). replace: the student changed their goal ("actually not pre-med, I want UX research"); the new words alone are kept, so the old goal and its career track stop counting. clear: the student dropped their goal and named no other ("forget pre-med"); interests may be left out.',
        },
        repick: { type: 'boolean', description: "Re-choose the planner's picks under the new priorities. Default true." },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_plan_shape',
    description:
      "Change the shape of the plan and rebuild the board: credits per term (a minimum, and a target or null for an even share), the finish term, terms away from campus (study abroad, a co-op, an internship, a gap semester: nothing is booked in them; a semester abroad still counts its approved hours toward the degree), summers the student will take classes in (at most 9 credits each, one hardest-band course at most, only courses Illinois has run in a summer; summers make the falls and springs lighter and never move the finish by themselves), and whether hard courses should be spread one to a term where the degree allows. Use it for \"I work 20 hours, only 12 credits\", \"I want to graduate a semester early\", \"I'm studying abroad spring 2029\", \"I'll take summer classes\", \"don't put hard classes together\". A lighter load needs a later finish: say so and set both. Rebuilding replaces the student's own edits to the board, so when they have made some the tool asks for their yes first. Afterwards call review_board and tell the student what changed.",
    input_schema: {
      type: 'object',
      properties: {
        min_credits: { type: 'integer', minimum: 6, maximum: 18, description: 'The fewest credits a fall or spring term may hold (12 is full time).' },
        target_credits: { type: ['integer', 'null'], minimum: 6, maximum: 18, description: 'The credits a term should aim for, or null for an even share of what is left.' },
        finish: { type: ['string', 'null'], description: 'The last term, like "Spring 2029" or "Summer 2029"; null or "default" returns to what the student said in About you.' },
        away: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  term: { type: 'string', description: 'A fall or spring term, like "Spring 2029".' },
                  kind: { type: 'string', enum: ['study_abroad', 'co_op', 'internship', 'gap'] },
                  credits: { type: 'integer', minimum: 0, maximum: 18, description: 'Hours the term earns toward the degree. Leave out for the default: 15 for study abroad, 0 for anything else.' },
                },
                required: ['term'],
                additionalProperties: false,
              },
            ],
          },
          description: 'Fall or spring terms the student is away, each "Spring 2029" or {"term": "Spring 2029", "kind": "study_abroad", "credits": 15}. A semester abroad counts 15 hours unless credits says otherwise (LAS allows at most 18); a co-op, internship or gap term counts none. Each must fall inside the plan. With no finish set, the default finish moves later so the student keeps eight falls and springs on campus, less what a semester abroad earns. Replaces the list.',
        },
        summers: { type: 'array', items: { type: ['integer', 'string'] }, description: 'Summers with classes, like [2027] or ["Summer 2027"], between the first term and the finish. Replaces the list.' },
        spread_hard: { type: 'boolean', description: 'One hardest-band course a term where the degree allows; kept only if it costs no term and leaves nothing out.' },
        confirmed: { type: 'boolean', description: 'True only after the student said yes to replacing their own edits.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'exam_credit',
    description:
      "The registrar's AP and IB credit table for students entering Illinois in Summer 2026, Fall 2026 or Spring 2027: for one exam, every score and the courses and hours it earns, with the registrar's placement note. Calculus is priced from the Grainger table for Grainger degrees and the other table otherwise. Use it for every question about what an AP or IB score earns (\"what do I need on AP Bio?\", \"does a 3 on Calc BC count?\") and before telling a student what their exam is worth; never answer from memory. To give the student the credit, they pick the exam and score under Credit, or record the granted courses with record_prior_credit.",
    input_schema: {
      type: 'object',
      properties: {
        exam: { type: 'string', description: 'The exam as the student names it: "AP Biology", "Calc BC", "IB Economics HL".' },
        kind: { type: 'string', enum: ['AP', 'IB'], description: 'AP or IB, when known.' },
      },
      required: ['exam'],
      additionalProperties: false,
    },
  },
  {
    name: 'prior_credit',
    description:
      "What the student walked in with, as the planner counts it: every course already earned (their transcript, another school's courses matched to Illinois equivalents, AP and other exam credit, courses they typed), the hours counted toward the total with no course code, lines from another school not yet matched to an Illinois course with the likely equivalents to offer, the exams named, where the record came from, and the residency rule (45 hours at Illinois, 21 at the 300 level or above) against the plan. Call it first whenever the student mentions transfer credit, AP or IB, dual enrollment, a previous college, a transcript, or asks what already counts.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_equivalent',
    description:
      "Which Illinois course another school's course is likely to be. Give the course as the student or their transcript names it (code, title, hours, school) and get the catalog's likely equivalents best first, each with a confidence and the reason. Illinois decides equivalency (Transferology is the estimate, the Transfer Evaluation Report the decision), so present the top one as likely rather than certain, and record it only when the student agrees or their evaluation report prints it.",
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The other school\'s code as printed, e.g. "MAT 128". Optional.' },
        title: { type: 'string', description: 'The course title as printed or as the student said it.' },
        credits: { type: 'number', description: 'Hours, when known.' },
        school: { type: 'string', description: 'The school that taught it, when known.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_prior_credit',
    description:
      'Record credit the student already has so the plan is built around it. Give an Illinois course code when the student holds that course or its accepted equivalent ("MATH 221 transferred", "I have AP credit for PSYC 100"), or hours with no code when a course transferred as elective credit ("my sociology class came in as 3 elective hours"). For another school\'s course whose Illinois equivalent is not settled, call find_equivalent first and confirm the pick with the student before recording. The plan is rebuilt around the new credit and the result says what changed; tell the student.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The Illinois course code the credit counts as, e.g. "MATH 221". Omit for hours only.' },
        hours: { type: 'number', description: 'Hours toward the total when no Illinois course holds them.' },
        title: { type: 'string', description: 'The course as the student named it, for the record.' },
        from: { type: 'string', description: 'Where it was taken: a school name, "AP", "dual enrollment".' },
        in_progress: { type: 'boolean', description: 'True when the course is being taken now and will be done before the first planned term.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'drop_prior_credit',
    description:
      'Stop counting a course or hours the student recorded by mistake. Name the Illinois code, or the line as the student named it. The plan is rebuilt and the result says what changed.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The Illinois code the line counts as.' },
        title: { type: 'string', description: 'The line as printed or as the student named it, when it has no Illinois code.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'planner_answer',
    description:
      'Ask the planner itself a question about the board or the catalog: where and when a course meets, what a course needs first, how heavy a term is, which term is hardest, degree progress, whether the plan is in the right order. Returns an exact, sourced answer written from the data in the browser, or handled false when the question is not about the board.',
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'university_answer',
    description:
      "Ask about the University of Illinois itself: registration, deadlines, drop rules, parking, housing, offices, policies, anything on its published pages. Returns an answer with the pages it came from. Use it for anything the board cannot answer, and pass on its sources.",
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
];

export type AdvisorToolName =
  | 'search_courses'
  | 'course_details'
  | 'term_summary'
  | 'add_course'
  | 'remove_course'
  | 'replace_course'
  | 'move_course'
  | 'compare_courses'
  | 'explain_choice'
  | 'what_if'
  | 'review_board'
  | 'program_admission'
  | 'set_priorities'
  | 'set_plan_shape'
  | 'exam_credit'
  | 'prior_credit'
  | 'find_equivalent'
  | 'record_prior_credit'
  | 'drop_prior_credit'
  | 'planner_answer'
  | 'university_answer';

/** Runs one tool against the real board. Implemented by the workspace. */
export type AdvisorExecutor = (name: AdvisorToolName, input: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// What the model is told, once
// ---------------------------------------------------------------------------

export function advisorSystem(bot: string): string {
  return `You are ${bot}, the University of Illinois Urbana-Champaign assistant. Students ask you anything about Illinois: registration, deadlines, dropping and adding, tuition, housing, dining, parking, offices and who to contact, majors and what they need, campus life, policies. You answer those from the university's own published pages through the university_answer tool. You also sit inside a four-year course planner: the student is looking at their board, one column per term, a card per course, and you can read it and change it with tools.

How to reason
- Think before you act or advise. Gather the facts with tools (compare_courses, explain_choice, what_if, review_board, course_details), weigh them against the student's priorities and their situation on the board (which term, what is already there, what depends on what), state the trade-off in a sentence or two, then act or recommend. A student can tell a considered answer from a list of facts; give them the considered one.
- When there is a real trade-off (a better-taught course that is harder; a lighter term now that loads a later one; a course that has not run in two years), say it plainly and say which way you lean and why. Do not hide behind "it depends".
- Before changing a required or from-a-list course, or moving anything with prerequisites downstream, run what_if and read what it breaks. Before recommending a replacement, run explain_choice on the current course so you know what it was chosen for and what the runners-up were.
- The board description you get with each message is the board as it is now. Your earlier messages may describe a board that has since changed: the student may have reloaded without saving, rebuilt, or edited cards by hand. When the two disagree, trust the description, say briefly that the board no longer has what you did earlier, and redo the change if they still want it. Never tell the student a course is on the board unless the description shows it.
- Judge terms as a whole: two hardest-band courses plus a lab is a different term from three light electives, whatever the credit count says. review_board and term_summary carry the load reading.
- A course that has not run in any recent term is not a plan. Say so, and offer one that has.
- Getting into a college is a separate application from earning the degree: when the student is not yet in the college their goal major belongs to (they say transfer, switch, ICT, undeclared, or "get into business"), call program_admission, check its courses against the board, and lay out the timeline plainly: what must be done by when, the hours needed, and that it is competitive. A registration restriction on a card ("restricted to Gies College of Business") is the same story from the other side.

Students with credit coming in
- Most students arrive with credit: another college, dual enrollment, AP or IB, an Illinois record with a transfer block on it. Before advising such a student, call prior_credit and read it. The board only knows what has been recorded; when they mention a course that is not in it, record it with record_prior_credit so the plan stops booking it, after settling the Illinois code with find_equivalent when they name another school's course. Then tell them what the rebuilt plan changed.
- Illinois's own rule, from its transfer-credit page: Transferology gives the estimate, the Transfer Evaluation Report after admission gives the decision, and every transferable course counts at least as elective hours toward the total. Say "likely" about an equivalent the planner proposed and "confirmed" only about one the student's Illinois record or evaluation report prints. Offer the upload: a screenshot of their Student Self-Service academic history, their evaluation report, or their old school's transcript settles most of it in one step, and the rail has the upload button.
- Residency: 45 hours must be taken at Illinois, 21 of them at the 300 level or above. prior_credit reports the plan against it; when a transfer student is short, say so and what it means: they need more Illinois hours than the degree total alone suggests.
- AP and IB: call exam_credit for any question about what a score earns; the registrar's table decides, and some grants depend on a subscore or on another exam (AP Calculus BC's AB subscore, AP English Literature with English Language). A 5 on AP Biology earns both IB 150 and MCB 150; the Biology department still advises taking them on campus for its majors, and many professional schools do not accept test credit for prerequisites, so say so to pre-health students.
- Transfer from Parkland: the Parkland-to-UIUC gen-ed guide (Illinois admissions and Parkland, 2024-2025) says which Illinois gen-ed categories each Parkland course meets, and the planner counts them. Composition I takes the two-course sequence (ENG 101 with ENG 102, IAI C1 900 with C1 901R); one course alone is elective hours. An associate degree or a completed IAI core does not by itself meet Illinois's gen-ed requirements; each course is evaluated.
- Grainger engineering degrees give no hours for any math course below MATH 220 (MATH 112, 115, STAT 100 and the like), CHEM 101, CHEM 108, any 100-level PHYS course or ASTR 100, and count only 4 of MATH 220's 5 hours (advising.grainger.illinois.edu/degree-requirements/coursesnotcount). Such credit, from AP Statistics or AP Physics 1 say, still clears prerequisites; the plan says so in a note. Tell an engineering student this before they count on those hours.
- Composition I is taken in the first year at Illinois (the campus Composition I page says so); the plan books it by the second term. A student who holds it from AP English Language or a two-course sequence elsewhere does not take it.
- Where a degree page offers sets of courses as alternatives ("Select one group": CHEM 102, 103, 104 and 105, or the accelerated CHEM 202 set; PHYS 101 and 102, or PHYS 211 through 214), the plan takes the set the student already holds part of, else the first the page lists, and books the whole set. A pre-health student asking about physics can switch sets; say both are listed.
- A degree whose page says "Required Concentration" (Kinesiology, for one) is several programs here, one per concentration; the plan note names them. Suggest the student pick theirs, since the parent program plans only the shared core.
- In-progress courses count as done for planning; a W or an F does not; a developmental course (numbered 0xx) never transfers. A transcript line counted as hours is real credit toward the total that fills no requirement; a line matched to an Illinois course fills whatever that course fills.

What you are for
- Answer any question about Illinois, from its pages, with the page named. That is most of what students ask; treat it as the main job, not a sideline.
- Answer questions about the student's own plan, and change the plan when the student wants it changed.
- When the student expresses an interest or a career goal ("I really like history", "I want more data science", "stuff for a data job", "I'm pre-PT"), record it with set_priorities interests (their words) and relevance 2, keeping workload where it was unless they say difficulty does not matter; read interests_heard, active_tracks and active_topics in the result. When they change their goal ("actually I'm not pre-med anymore, I want UX research"), call it with interests_mode replace and the new words; when they drop it and name no other ("forget pre-med"), use interests_mode clear. The board description lists the stored career words and the active career tracks: when those no longer match what the student says they want, replace or clear them before anything else. When the result has track_courses, tell the student which courses their track requires are on the board and which are not, and that pressing Rebuild books the missing ones before any other elective and places them earliest (the plan's notes name any it still cannot fit). Then, if the re-pick did not already bring courses in that area, search for them, replace elective slots with the best fits, and tell them what you did. Do not stop to ask which term unless it genuinely matters; act, then offer alternatives and ask if they want more.
- When a request is ambiguous in a way that changes what you would do (which of two required courses to drop, whether to keep a course they said they liked), ask one short question and wait.
- Keep the conversation: remember what they told you earlier in this chat and build on it.
- The student's priorities decide which electives the planner picks and how choices are ordered: lighter workload, highly rated teaching, relevance to their interests and career, covering more requirements at once, fitting their schedule. The board description says what they are now. When the student says what they care about ("easy classes", "the best professors", "nothing before 9", "afternoons only", "Fridays off", "in person only"), call set_priorities, let it re-pick the planner's choices (electives, list picks and gen-ed picks; never required courses or the language), and tell them what changed and why. Priorities choose courses; they do not move required courses or change how many credits a term holds. For balance between terms, the credit load, the finish date, summers, terms away or spreading hard courses, use set_plan_shape.
- The plan picks courses for each term, not sections. Days off, exact times and a particular instructor are chosen at registration: say so, and use course_details or planner_answer to show when a course met and who taught it. Section times come from one crawled term (the board says which), so a spring course is judged on its fall sections.
- The planner plans one program at a time. For a minor, a double major or a switch, say so plainly: the student can choose another program under Program to see its plan, and courses added by hand for a minor are not checked against the minor's requirements.
- A course already taken can be retaken only by the registrar's rules (grade replacement is theirs to decide); the board shows it as taken. When a student wants a course or subject kept out of their electives, replace it and tell them a rebuild may bring it back until they say so again.

Rules about the board
- Every card on the board is marked required, from a list, elective slot, career track, language, gen ed pick, prerequisite, or added. Prefer changing elective slots and gen ed picks (a gen ed pick is swapped for another course carrying the same categories). A career-track card is a course the student's named goal requires (PHYS 101 for physical therapy school); keep it unless they drop the goal. Never remove or replace a required, from-a-list or career-track course unless the student has clearly said yes to removing that specific course in this conversation; then, and only then, call the tool with confirmed true. If they ask you to drop one, say what it is required for and ask for a yes.
- Use the tools for every fact. Do not state a course's prerequisites, credits, difficulty or description from memory; call course_details or planner_answer. Do not claim a course is eligible in a term without search_courses or a successful add.
- A tool that fails says why. Relay the reason plainly and try the next best option (another term, another course).
- Teaching ratings come only from the university's own Teachers Ranked as Excellent lists, which course_details and search results carry. Never cite RateMyProfessors or any outside site, and never call an instructor good or bad on your own; say whether they are on the list, and for which terms. A name missing from the list is not a rating against it.
- When you suggest a course, say why in the student's terms, from the fit reasons the tools return: the grade history, the list, their interests, the requirement it also covers. Do not invent reasons the tools did not give.
- Keep terms between the student's minimum and 18 credits. Replacing keeps the size; adding raises it, so prefer replacing an elective slot when a term is already full. The planner never goes past 18; more than 18 needs the college's approval, so point the student to their college's advising office (university_answer can find the rule) rather than planning it.

How to talk
- Plain, short, specific. Name courses by code and title, and name the term. Say exactly what changed: "Replaced FIN 435 with HIST 200, Introduction to Historical Interpretation, in Spring 2029."
- No headers, no bullet lists longer than four items, no markdown tables. A short paragraph or a few lines.
- When university_answer returns sources, mention where the answer came from in a few words. Never invent a page, office, deadline or policy.
- You are not a licensed academic advisor and you do not register anyone. Where a decision has consequences (dropping a required course, a lighter load that adds a semester), say so once and let the student decide.`;
}

// ---------------------------------------------------------------------------
// The loop, run in the browser
// ---------------------------------------------------------------------------

export interface AdvisorStep {
  content: AdvisorBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

export interface AdvisorTurnEvents {
  /** Text the model is writing, as it writes it. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onTool?: (name: AdvisorToolName, input: Record<string, unknown>) => void;
  /** A tool finished, with what it returned. */
  onToolResult?: (name: AdvisorToolName, input: Record<string, unknown>, result: unknown) => void;
  /** One model step finished; the transcript so far. */
  onStep?: (messages: AdvisorMessage[]) => void;
}

const MAX_STEPS = 12;

/**
 * One model step: the whole transcript up, one assistant message back, its
 * text streamed as it is written.
 */
async function advisorStep(
  messages: AdvisorMessage[],
  board: string,
  bot: string,
  onText: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<AdvisorStep> {
  const res = await fetch('/api/advisor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, board, bot }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `The advisor answered ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: AdvisorStep | null = null;
  let failure: string | null = null;
  const handle = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const event = JSON.parse(line.slice(6)) as
      | { type: 'text'; delta: string }
      | { type: 'final'; message: AdvisorStep }
      | { type: 'error'; error: string };
    if (event.type === 'text') onText?.(event.delta);
    else if (event.type === 'final') final = event.message;
    else failure = event.error;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf('\n\n');
    while (at >= 0) {
      handle(buffer.slice(0, at).trim());
      buffer = buffer.slice(at + 2);
      at = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handle(buffer.trim());
  if (failure) throw new Error(failure);
  if (!final) throw new Error('The advisor stopped without answering.');
  return final;
}

/**
 * One turn of the conversation: the student's message in, the model's tool
 * calls executed against the board as they come, the final reply out.
 *
 * `board` is rebuilt for every step, because each step may have changed it.
 * The returned transcript includes every assistant message and every tool
 * result, which is what the next turn needs to keep the context.
 */
export async function runAdvisorTurn(input: {
  messages: AdvisorMessage[];
  userText: string;
  board: () => string;
  /** The name the bot answers to: ALMA at Illinois. */
  bot: string;
  execute: AdvisorExecutor;
  events?: AdvisorTurnEvents;
  signal?: AbortSignal;
}): Promise<{ messages: AdvisorMessage[]; refused: string | null }> {
  const messages: AdvisorMessage[] = [...input.messages, { role: 'user', content: input.userText }];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const reply = await advisorStep(messages, input.board(), input.bot, input.events?.onText, input.signal);
    messages.push({ role: 'assistant', content: reply.content as Anthropic.Beta.BetaContentBlockParam[] });
    input.events?.onStep?.(messages);
    if (reply.stop_reason === 'refusal') {
      return { messages, refused: reply.stop_details?.explanation ?? 'The advisor declined to answer that.' };
    }
    if (reply.stop_reason !== 'tool_use') break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of reply.content) {
      if (block.type !== 'tool_use') continue;
      const name = block.name as AdvisorToolName;
      const args = (block.input ?? {}) as Record<string, unknown>;
      input.events?.onTool?.(name, args);
      let result: unknown;
      try {
        result = await input.execute(name, args);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : 'The tool failed.' };
      }
      input.events?.onToolResult?.(name, args, result);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    // All results in one user message, in order. Splitting them trains the
    // model to stop asking for tools in parallel.
    messages.push({ role: 'user', content: results });
    input.events?.onStep?.(messages);
  }
  return { messages, refused: null };
}

/** The text of the last assistant message, for the transcript and for storage. */
export function lastAssistantText(messages: AdvisorMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const text = m.content
      .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text.trim()) return text;
  }
  return '';
}
