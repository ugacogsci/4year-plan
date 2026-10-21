'use client';

import { cleanEvent, consentOf, type Consent, type EventName, type Properties, type Screen, type Feature, type InsightEvent } from './schema';
import type { TranscriptRecord } from '@/lib/planner/transcript';

export const CONSENT_KEY = 'fourYear.insights.consent.v1';
const ID_KEY = 'fourYear.insights.identity.v1';
let consent: Consent | null = null;
let available = false;
let identity: { token: string; created: number } | null = null;
let queue: InsightEvent[] = [];
let sending: AbortController | null = null;
let epoch = 0;
let screen: Screen = 'university';
let school: '' | 'uga' | 'illinois' = '';
let feature: Feature | undefined;
let lastActivity = 0;
let pendingMs = 0;
let tickAt = 0;
let session = '';
const listeners = new Set<() => void>();
export const subscribeInsights = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const announce = () => { for (const fn of listeners) fn(); };
export function privacySignal(): boolean {
  return typeof navigator !== 'undefined' && ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === '1');
}
export function insightState() { return { consent, available, blocked: privacySignal(), hasIdentity: Boolean(identity) }; }
export function contextNow() { return { screen, school, device: window.innerWidth < 640 ? 'small' : window.innerWidth < 1100 ? 'medium' : 'large' }; }
function readLocal() {
  try {
    consent = consentOf(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? 'null'));
    const value = JSON.parse(localStorage.getItem(ID_KEY) ?? 'null');
    identity = value && /^[a-f0-9]{64}$/.test(value.token) && typeof value.created === 'number' ? value : null;
  } catch { consent = null; identity = null; }
}
function stopPending() { epoch += 1; queue = []; pendingMs = 0; sending?.abort(); sending = null; }
export function setConsent(next: Consent) {
  stopPending();
  consent = privacySignal() ? { version: 2, usage: false, content: false } : consentOf(next);
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch { /* Session-only choice. */ }
  announce();
  if (consent?.usage) track('screen_view', { device: contextNow().device });
}
export function track(name: EventName, properties: Properties = {}) {
  if (!available || !consent?.usage || privacySignal()) return;
  const event = cleanEvent({ id: crypto.randomUUID(), name, screen, school, properties }, consent);
  if (event && queue.length < 50) queue.push(event);
  if (queue.length >= 20) void flush();
}
export function trackContent(kind: 'setup' | 'chat' | 'assistant', text: string) {
  if (consent?.content && text.trim()) track('content', { kind, text });
}
export function trackTranscript(record: TranscriptRecord) {
  if (!consent?.transcript) return;
  const text = record.courses.filter((course) => /^[A-Z]{2,6} \d{3,5}[A-Z]?$/.test(course.code)).slice(0, 150)
    .map((course) => `${course.code} | ${typeof course.credits === 'number' && course.credits >= 0 && course.credits < 100 ? Math.round(course.credits * 100) / 100 : 'unknown'} cr`).join('\n');
  if (text) track('content', { kind: 'transcript', text });
}
export function setInsightScreen(next: Screen, university?: string | null) {
  if (screen !== next) { recordTime(); feature = undefined; }
  const changed = screen !== next;
  screen = next;
  school = university === 'uga' || university === 'illinois' ? university : '';
  lastActivity = Date.now();
  if (changed) track('screen_view', { device: contextNow().device });
}
function recordTime() {
  if (pendingMs > 0) track('active_time', { durationMs: pendingMs, ...(feature ? { feature } : {}) });
  pendingMs = 0;
}
function token() {
  if (!identity || Date.now() - identity.created > 30 * 86400000) {
    identity = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, '0')).join(''), created: Date.now() };
    try { localStorage.setItem(ID_KEY, JSON.stringify(identity)); } catch { /* Session-only ID. */ }
    announce();
  }
  return identity.token;
}
async function flush(keepalive = false) {
  if (sending || !available || !consent?.usage || privacySignal() || !queue.length) return;
  const batch: InsightEvent[] = [];
  let bytes = 0;
  while (queue.length && batch.length < 20) {
    const size = new TextEncoder().encode(JSON.stringify(queue[0])).length;
    if (bytes + size > 44000) break;
    bytes += size; batch.push(queue.shift()!);
  }
  const controller = new AbortController();
  sending = controller;
  const version = epoch;
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token(), session, consent, events: batch }), signal: controller.signal, keepalive });
    if (version === epoch && response.status === 410) { stopPending(); identity = null; try { localStorage.removeItem(ID_KEY); } catch {} }
    if (response.status === 503) { available = false; queue = []; announce(); }
  } catch { /* Analytics must never interrupt planning. Dropped events are not replayed. */ }
  finally { clearTimeout(timeout); if (sending === controller) sending = null; }
}
export async function deleteInsights() {
  setConsent({ version: 2, usage: false, content: false });
  if (!identity) return;
  const response = await fetch('/api/insights', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: identity.token }) });
  if (!response.ok) throw new Error('Could not delete the saved research data. Try again later; collection is now off.');
  identity = null;
  try { localStorage.removeItem(ID_KEY); } catch {}
  announce();
}

/** Static selectors only. No button text, input values, URLs or student-supplied labels. */
const controls: Array<[string, string]> = [
  ['.onb-theme', 'setup.theme'], ['.onb-resume button', 'setup.resume'],
  ['[data-insight]', ''], ['.onb-next', 'setup.next'], ['.onb-back', 'setup.back'], ['.plan-tab-button', 'plan.tab'],
  ['.plan-tab-add', 'plan.add'], ['.plan-tab-close', 'plan.close'], ['.plan-group-add', 'plan.group'],
  ['.rebuild-button', 'plan.rebuild'], ['.bot-stop', 'assistant.stop'], ['.bot-send', 'assistant.send'], ['.bot-suggestion', 'assistant.suggestion'],
  ['.bot-faqs button', 'assistant.suggestion'], ['.issue-badge', 'warning.open'], ['.unofficial-link', 'privacy.open'],
  ['.rail-toggle', 'progress.toggle'], ['.bot-launch', 'assistant.toggle'], ['.profile-menu-trigger', 'preferences.open'],
  ['.course-complete-button', 'course.completed'], ['.finder-result-add', 'course.add'], ['.finder-search', 'map.search'],
  ['.finder-filters', 'map.filter'], ['.map-size-toggle', 'map.resize'],
];
export function startInsights() {
  readLocal();
  session = crypto.randomUUID();
  let mounted = true;
  void fetch('/api/insights').then((r) => r.ok ? r.json() as Promise<{ enabled: boolean }> : null).then((status) => {
    if (!mounted) return;
    available = status?.enabled === true;
    announce();
    track('screen_view', { device: contextNow().device });
  }).catch(() => { available = false; announce(); });
  const storage = (event: StorageEvent) => { if (!event.key || [CONSENT_KEY, ID_KEY].includes(event.key)) { stopPending(); readLocal(); announce(); } };
  const activity = (event: Event) => {
    lastActivity = Date.now();
    const target = event.target instanceof Element ? event.target : null;
    const next = target?.closest('[data-insight-feature]')?.getAttribute('data-insight-feature') as Feature | undefined;
    if (feature !== next) { recordTime(); feature = next; }
  };
  const click = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    for (const [selector, control] of controls) {
      const el = target.closest(selector);
      if (el) { track('control_click', { control: control || el.getAttribute('data-insight') || '' }); break; }
    }
  };
  const hide = () => { recordTime(); void flush(true); };
  const visibility = () => { hide(); tickAt = Date.now(); lastActivity = document.hidden ? 0 : Date.now(); };
  const error = () => track('client_error', { error: 'script' });
  const rejection = () => track('client_error', { error: 'unhandled_promise' });
  const seen = new WeakSet<Element>();
  const observe = new IntersectionObserver((entries) => {
    if (!consent?.usage || !available || privacySignal()) return;
    for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= .25 && !seen.has(entry.target)) {
      seen.add(entry.target); track('feature_view', { feature: entry.target.getAttribute('data-insight-feature') ?? '' });
    }
  }, { threshold: .25 });
  const measure = () => {
    const now = Date.now();
    if (tickAt && consent?.usage && !document.hidden && document.hasFocus() && now - lastActivity < 30000) pendingMs += Math.min(2000, now - tickAt);
    tickAt = now;
  };
  const sample = setInterval(measure, 1000);
  const timer = setInterval(() => {
    document.querySelectorAll('[data-insight-feature]').forEach((el) => { if (!seen.has(el)) { observe.unobserve(el); observe.observe(el); } });
    recordTime(); void flush();
  }, 10000);
  window.addEventListener('storage', storage);
  document.addEventListener('pointerdown', activity, { passive: true });
  document.addEventListener('pointermove', activity, { passive: true });
  document.addEventListener('keydown', activity);
  document.addEventListener('scroll', activity, { passive: true, capture: true });
  document.addEventListener('click', click);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    mounted = false; clearInterval(timer); clearInterval(sample); observe.disconnect();
    window.removeEventListener('storage', storage); document.removeEventListener('pointerdown', activity);
    document.removeEventListener('pointermove', activity); document.removeEventListener('keydown', activity);
    document.removeEventListener('scroll', activity, true); document.removeEventListener('click', click);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide);
    window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection);
    stopPending();
  };
}
