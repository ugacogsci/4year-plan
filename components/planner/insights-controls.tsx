'use client';

import { useEffect, useState } from 'react';
import { deleteInsights, insightState, setConsent, startInsights, subscribeInsights } from '@/lib/insights/client';

export function InsightsRuntime() {
  useEffect(() => startInsights(), []);
  return null;
}
function useInsights() {
  const [state, setState] = useState<ReturnType<typeof insightState>>({ consent: null, available: false, blocked: false, hasIdentity: false });
  useEffect(() => {
    const refresh = () => setState(insightState());
    refresh();
    return subscribeInsights(refresh);
  }, []);
  return state;
}
export function InsightsPrompt() {
  const state = useInsights();
  if (!state.available || state.consent || state.blocked) return null;
  return <section className="insights-prompt" aria-label="Optional analytics">
    <p>Help improve ORION? Share usage, active time and approximate region. Setup answers, chats and transcripts are excluded.</p>
    <div className="insights-actions">
      <button type="button" onClick={() => setConsent({ version: 1, usage: false, content: false })}>No thanks</button>
      <button type="button" onClick={() => setConsent({ version: 1, usage: true, content: false })}>Allow usage analytics</button>
      <button type="button" className="unofficial-link" onClick={() => { window.location.hash = 'privacy'; }}>Customize</button>
    </div>
  </section>;
}
export function InsightsControls() {
  const state = useInsights();
  const [draft, setDraft] = useState<{ usage: boolean; content: boolean } | null>(null);
  const usage = draft?.usage ?? state.consent?.usage ?? false;
  const content = draft?.content ?? state.consent?.content ?? false;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  return <section className="insights-settings" aria-label="Analytics choices">
    <h3>Your analytics choices</h3>
    {state.blocked && <p>Your browser requests no tracking. ORION honors that preference.</p>}
    {!state.available && <p>Analytics storage is not connected on this server. Nothing is being collected.</p>}
    <label><input type="checkbox" checked={usage} disabled={!state.available || state.blocked} onChange={(e) => { setDraft({ usage: e.target.checked, content: e.target.checked && content }); setStatus(''); }} />
      <span>Share usage analytics<small>Screen visits, named controls, active time, plan-edit counts, chat timing and country/region. No precise location, IP addresses, transcript data or text you type.</small></span>
    </label>
    <label><input type="checkbox" checked={content} disabled={!state.available || state.blocked || !usage} onChange={(e) => { setDraft({ usage, content: e.target.checked }); setStatus(''); }} />
      <span>Also share submitted setup answers and chat questions<small>Optional research copies of future submissions, up to 2,000 characters each. These can reveal personal information. Common contact details are removed, but redaction is imperfect. No transcripts, grades, assistant replies or older conversations are copied. Keep identifying or sensitive details out.</small></span>
    </label>
    <div className="insights-actions">
      <button type="button" disabled={!state.available || state.blocked} onClick={() => { setConsent({ version: 1, usage, content: usage && content }); setDraft(null); setStatus('Choices saved.'); }}>Save choices</button>
      {state.hasIdentity && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setStatus(''); setDraft(null);
        try { await deleteInsights(); setStatus('Analytics data deleted; collection is off. Your saved plans are unchanged.'); }
        catch (error) { setStatus(error instanceof Error ? error.message : 'Could not delete data. Please try again.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Deleting...' : 'Delete my analytics data'}</button>}
    </div>
    <output>{status}</output>
  </section>;
}
