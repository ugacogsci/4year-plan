/**
 * The two notices every page of the planner carries: that it is unofficial,
 * and what it does with what a student types.
 *
 * One place for the words, so the header, the onboarding footer, the printed
 * packet and the downloaded file all say the same thing.
 *
 * The privacy text describes the code as it is (read 2026-10-11). Change it
 * in the same commit as anything that changes what is stored or sent:
 *   - this browser's localStorage: the onboarding answers (lib/planner/onboarding.ts),
 *     the board (lib/planner/saved-board.ts), ALMA's conversation per degree
 *     (components/planner/advisor.tsx, CHAT_KEY), and small display settings;
 *   - /api/advisor: each ALMA step sends the conversation and a text
 *     description of the board to Anthropic's Claude API; nothing is stored or logged;
 *   - /api/transcript: the files a student picks go to the Claude API once to
 *     be read; nothing is stored, no course is logged;
 *   - /api/ask: a question for the university's pages, with the previous
 *     question and answer and the visitor's IP address, goes to the TRU answer
 *     service, which logs the last 2,000 questions PII-scrubbed (zou src/lib/ratelimit.ts logQuestion);
 *   - lib/planner/spend-guard.ts: request counts per IP address, in server
 *     memory only, forgotten within a day.
 */

/** "the University of Illinois", "Texas A&M University", "Virginia Tech". */
export function schoolPhrase(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return 'any university';
  return /^University\b/.test(n) ? `the ${n}` : n;
}

/** The short label, always on screen. */
export const UNOFFICIAL_LABEL = 'Unofficial';

/** The sentence beside or behind the label. */
export function unofficialNotice(schoolName: string | null | undefined): string {
  return `An unofficial planner, not affiliated with or endorsed by ${schoolPhrase(schoolName)}. Check every plan with your academic advisor before you register.`;
}

export interface PrivacySection {
  title: string;
  lines: string[];
}

/**
 * The privacy notice, in the order a student wonders about it. `bot` is the
 * school's bot name (ALMA at Illinois).
 */
export function privacySections(bot: string): PrivacySection[] {
  return [
    {
      title: 'What stays on your device',
      lines: [
        'Your answers to the setup questions, your plan, your conversation with ' + bot + ' and a few display settings are saved in this browser (its local storage), on this device only. There are no accounts, and we keep no copy.',
        'Start over clears your answers and your plan; clearing this site’s data in your browser removes everything.',
        '"Download as JSON" saves a file on your device. "Copy a link" puts your plan inside the link itself, so anyone you send it to can read the plan.',
      ],
    },
    {
      title: 'What is sent, and to whom',
      lines: [
        `When you message ${bot}, your conversation so far and a text description of your plan go through our server to Anthropic’s Claude API, which writes the reply. Our server does not store or log them.`,
        'When you upload a transcript or a screenshot, the files go through our server to the Claude API once so it can list the courses on them. Our server does not keep the files or log the courses; you review every line before anything counts.',
        `Questions about the university itself (from ${bot} or the ask bar) go to TRU, our answer service for the university’s published pages, with your previous question and answer, and your IP address so it can limit how often one visitor asks. TRU keeps its most recent 2,000 questions and the start of each answer, with emails, phone numbers and ID numbers removed and no address attached, to find what it answers badly.`,
        'Anthropic handles what it receives under its commercial terms and privacy policy (anthropic.com/legal). Do not type passwords, your UIN, or other ID numbers into the chat.',
      ],
    },
    {
      title: 'What the server keeps',
      lines: [
        'To keep the planner affordable and fair, the server counts requests per IP address in its memory, never on disk, and forgets them within a day. Like any website, the hosting service may keep standard access logs (address, time, page).',
      ],
    },
    {
      title: 'What we never do',
      lines: ['We do not sell or share your information, show ads, or use trackers or analytics.'],
    },
  ];
}
