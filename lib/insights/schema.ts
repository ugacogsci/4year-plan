export const CONSENT_VERSION = 1;
export const FEEDBACK_EMAIL = 'orioncogsci@gmail.com';
export const SCREENS = ['university', 'programs', 'goals', 'details', 'credit', 'generating', 'planner'] as const;
export const FEATURES = ['map', 'schedule', 'progress', 'assistant', 'plans'] as const;
export const CONTROLS = [
  'setup.next', 'setup.back', 'setup.resume', 'setup.theme', 'plan.rebuild',
  'plan.tab', 'plan.add', 'plan.close', 'plan.group', 'plan.export', 'plan.import', 'plan.share',
  'map.select', 'map.search', 'map.filter', 'map.resize', 'map.reset',
  'course.options', 'course.add', 'course.remove', 'course.replace', 'course.completed',
  'progress.toggle', 'assistant.toggle', 'assistant.send', 'assistant.stop', 'assistant.suggestion',
  'assistant.reset', 'warning.open', 'preferences.open', 'privacy.open', 'feedback.open',
] as const;
export const EVENTS = ['screen_view', 'active_time', 'feature_view', 'control_click', 'plan_change',
  'plan_generated', 'setup_submitted', 'chat_sent', 'chat_completed', 'client_error', 'content'] as const;
export type Screen = typeof SCREENS[number];
export type Feature = typeof FEATURES[number];
export type EventName = typeof EVENTS[number];
export type Consent = { version: 1; usage: boolean; content: boolean };
export type Properties = Record<string, string | number | boolean>;
export interface InsightEvent { id: string; name: EventName; screen: Screen; school: 'uga' | 'illinois' | ''; properties: Properties }
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function consentOf(raw: unknown): Consent | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.version !== CONSENT_VERSION || typeof c.usage !== 'boolean' || typeof c.content !== 'boolean') return null;
  return { version: CONSENT_VERSION, usage: c.usage, content: c.usage && c.content };
}
const includes = (list: readonly string[], value: unknown): value is string => typeof value === 'string' && list.includes(value);

/** Best-effort redaction, not a promise of anonymity. Never run this over transcripts. */
export function redactContent(text: string): string {
  return text.slice(0, 2000)
    .replace(/https?:\/\/\S+/gi, '[link removed]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\d[\s().-]*){7,}\b/g, '[number removed]')
    .replace(/\b(?:sk[-_]|re_)[A-Za-z0-9_-]{12,}\b/g, '[key removed]');
}

/** An explicit allowlist: never store DOM text, URLs, form values, grades or arbitrary properties. */
export function cleanEvent(raw: unknown, consent: Consent): InsightEvent | null {
  if (!consent.usage || !raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (!isId(e.id) || !includes(EVENTS, e.name) || !includes(SCREENS, e.screen)) return null;
  if (e.name === 'content' && !consent.content) return null;
  const p = e.properties && typeof e.properties === 'object' ? e.properties as Record<string, unknown> : {};
  const result: Properties = {};
  const enums: Record<string, readonly string[]> = {
    control: CONTROLS, feature: FEATURES, operation: ['add', 'remove', 'move', 'reorder', 'replace', 'completed', 'edit'],
    outcome: ['ok', 'error', 'stopped', 'refused'], kind: ['setup', 'chat'],
    level: ['undergraduate', 'graduate'], actor: ['student', 'assistant'],
    device: ['small', 'medium', 'large'], error: ['script', 'unhandled_promise'],
  };
  for (const [key, values] of Object.entries(enums)) if (includes(values, p[key])) result[key] = p[key] as string;
  for (const key of ['durationMs', 'count', 'majors', 'minors', 'certificates', 'terms', 'characters']) {
    if (typeof p[key] === 'number' && Number.isFinite(p[key])) result[key] = Math.round(Math.max(0, Math.min(key === 'durationMs' ? 300000 : 10000, p[key])));
  }
  if (e.name === 'content' && includes(['setup', 'chat'], p.kind) && typeof p.text === 'string') result.text = redactContent(p.text);
  if (e.name === 'content' && !result.text) return null;
  return { id: e.id, name: e.name as EventName, screen: e.screen as Screen, school: includes(['uga', 'illinois'], e.school) ? e.school as 'uga' | 'illinois' : '', properties: result };
}

export type Feedback = { id: string; kind: 'feedback' | 'bug'; message: string; replyTo: string; usefulness: string; screen: string; school: string; device: string };
export function cleanFeedback(raw: unknown): Feedback | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (!isId(f.id) || !includes(['feedback', 'bug'], f.kind) || typeof f.message !== 'string' || f.message.trim().length < 5 || f.message.length > 3000) return null;
  const replyTo = typeof f.replyTo === 'string' ? f.replyTo.trim() : '';
  if (replyTo && (replyTo.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo))) return null;
  return { id: f.id, kind: f.kind as Feedback['kind'], message: f.message.trim(), replyTo,
    usefulness: includes(['helpful', 'mixed', 'not_helpful'], f.usefulness) ? f.usefulness : '',
    screen: includes(SCREENS, f.screen) ? f.screen : '', school: includes(['uga', 'illinois'], f.school) ? f.school : '',
    device: includes(['small', 'medium', 'large'], f.device) ? f.device : '' };
}
export function feedbackText(f: Feedback): string {
  return [`ORION ${f.kind === 'bug' ? 'bug report' : 'feedback'}`, '', f.message, '',
    f.replyTo ? `Reply to: ${f.replyTo}` : '', f.usefulness ? `Usefulness: ${f.usefulness}` : '',
    f.screen ? `Screen: ${f.screen}` : '', f.school ? `University: ${f.school}` : '', f.device ? `Window size: ${f.device}` : '',
    '', `Report ID: ${f.id}`].filter((line) => line !== '').join('\n');
}
