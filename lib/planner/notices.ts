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
 *   - /api/ask: a question about the university, with the previous question
 *     and answer for a follow-up, goes to the Claude API, whose web search is
 *     limited to that school's official domains (lib/planner/university-lookup.ts);
 *     nothing is logged; the answer to a first question is held in server
 *     memory for up to a day, keyed by the question text only, so a repeat is
 *     not a second call;
 *   - lib/planner/spend-guard.ts: request counts per IP address, in server
 *     memory only, forgotten within a day.
 */

/** "the University of Illinois", "the University of Georgia". */
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
        'Your setup answers, plan, conversation with ' + bot + ' and display settings are saved in this browser. An optional Google account lets you save your workspace across devices. Signing in alone does not upload or replace a plan.',
        'Start over clears your answers and your plan; clearing this site’s data in your browser removes everything.',
        '"Download as JSON" saves a file on your device. "Copy a link" puts your plan inside the link itself, so anyone you send it to can read the plan.',
      ],
    },
    {
      title: 'Optional Google sign-in and private plans',
      lines: [
        'Google handles authentication; ORION never receives your Google password. We keep your Google account identifier, verified email and secure sign-in sessions in a separate Cloudflare account database. We do not request access to Gmail or Google Drive.',
        'When you choose Save this device\'s plan, your plan tabs, setup answers, reviewed credit record and conversation are saved privately to your account. Subsequent edits save automatically. Uploaded PDF/image files are not included. Only your signed-in account can load or change that workspace; authorized project operators administer the database. Account data is separate from optional research sharing.',
        'You can delete your cloud copy or account from Account and cloud saves. Account deletion removes its plans and sessions. Sign out clears the local planning records on this device. Research records are separate and can be deleted in Privacy. Cloudflare may retain backups according to its recovery policies.',
      ],
    },
    {
      title: 'What is sent, and to whom',
      lines: [
        `When you use guided setup or message ${bot}, your conversation and relevant planning context go through our server to Anthropic’s Claude API, which writes the reply. Manual setup is available without this conversation. With separate research consent, limited copies of newly submitted answers, questions and assistant replies are sent to our research database.`,
        'When you upload a transcript or screenshot, the files go through our server to the Claude API once to list the courses. We do not keep the files; you review the extracted record before it counts. A private account save can include that reviewed record. A separate research choice can share only course codes and credits from it.',
        `Questions about the university itself that ${bot} looks up (deadlines, policies, offices) go through our server to Anthropic’s Claude API, which searches only the university’s own official website and answers with links to the pages it used. For a follow-up, your previous question and that answer go with it; nothing about your plan does. Our server does not log these questions. It remembers the answer to a question for up to a day, with nothing about who asked, so the same question asked again is answered without a second search.`,
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
      title: 'Optional analytics and research',
      lines: [
        'Analytics is off until you choose to enable it. If enabled and configured, ORION stores screen visits, named control clicks, feature visibility, active time, plan-edit counts, chat timing and coarse country/region in our Cloudflare database. A random browser identifier rotates after 30 days; it is pseudonymous, not a guarantee of anonymity. We do not store IP addresses, precise location, full URLs or keystrokes in analytics. We honor Do Not Track and Global Privacy Control.',
        'Separate, unchecked choices let us keep future submitted setup responses, chat questions and assistant replies (up to 2,000 characters each), and course codes/credit hours from reviewed transcripts (up to 150 courses). We do not copy files, grades, student IDs, names printed on records, institutions or transcript dates. Basic text redaction removes common contact details but cannot remove every name or sensitive detail you type. Course combinations can also be distinctive. This is pseudonymous research, not guaranteed anonymity. Research identifiers are never linked to Google accounts.',
        'Usage records are deleted after 90 days and research text after 30 days by a daily cleanup. Only authorized project operators can read them. Turn sharing off or delete this browser\'s analytics data above. Deletion does not remove local plans, feedback emails or records held by service providers. Clearing browser data removes the identifier needed for self-service deletion; contact orioncogsci@gmail.com for help. Data from older rotated identifiers expires on the same retention schedule.',
      ],
    },
    {
      title: 'Feedback and bug reports',
      lines: ['Reports go to orioncogsci@gmail.com with the message, optional reply address, usefulness rating and any diagnostic details you choose to include. Without an email sender configured, ORION opens a draft in your email app and does not send it automatically. When automatic delivery is enabled, Resend delivers it to our Google inbox. Feedback emails are separate from analytics and remain in our inbox until removed; email us to request deletion.'],
    },
    {
      title: 'What we never do',
      lines: ['We do not sell your information, use advertising trackers, record sessions, or track your activity on other websites. The planner works without optional analytics or research sharing.'],
    },
  ];
}
