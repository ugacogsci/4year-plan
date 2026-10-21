'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { deleteInsights, insightState, setConsent, startInsights, subscribeInsights } from '@/lib/insights/client';

export function InsightsRuntime() {
  useEffect(() => startInsights(), []);
  return null;
}
function useInsights() {
  const [state, setState] = useState<ReturnType<typeof insightState>>({ consent: null, available: false, blocked: false, hasIdentity: false });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const refresh = () => { setState(insightState()); setReady(true); };
    refresh();
    return subscribeInsights(refresh);
  }, []);
  return { ...state, ready };
}
type Choices = { usage: boolean; content: boolean; transcript: boolean };
const NONE: Choices = { usage: false, content: false, transcript: false };
function ResearchChoices({ value, onChange, disabled }: { value: Choices; onChange: (next: Choices) => void; disabled: boolean }) {
  return <div className="insights-settings">
    <label><input type="checkbox" checked={value.usage} disabled={disabled} onChange={(e) => onChange(e.target.checked ? { ...value, usage: true } : NONE)} />
      <span>Usage and approximate location<small>Which controls you use, active time, plan-edit counts and country/region. No precise location or keystrokes.</small></span></label>
    <label><input type="checkbox" checked={value.content} disabled={disabled || !value.usage} onChange={(e) => onChange({ ...value, content: e.target.checked })} />
      <span>Setup answers and conversations<small>Future submitted answers, questions and assistant replies, up to 2,000 characters each. Common contact details are removed, but names or sensitive details may remain. Do not include identifying information.</small></span></label>
    <label><input type="checkbox" checked={value.transcript} disabled={disabled || !value.usage} onChange={(e) => onChange({ ...value, transcript: e.target.checked })} />
      <span>Course information from reviewed transcripts<small>Only course codes and credit hours, up to 150 courses. No files, names, student IDs, grades, institutions or term dates. Course combinations can still be distinctive.</small></span></label>
  </div>;
}
export function InsightsGate() {
  const state = useInsights();
  const [choices, setChoices] = useState<Choices>(NONE);
  return <Dialog open={state.ready && !state.consent} onOpenChange={() => {}}>
    <DialogContent showCloseButton={false} className="orion-dialog insights-dialog">
      <DialogTitle>Your privacy, your choice</DialogTitle>
      <DialogDescription>ORION works without research sharing. Choose what, if anything, you want to contribute before getting started.</DialogDescription>
      <ResearchChoices value={choices} onChange={setChoices} disabled={state.blocked} />
      <p>Research uses a random browser identifier, never your Google account. This is pseudonymous, not guaranteed anonymous. Usage is kept for 90 days; shared text and course lists for 30 days. Change your choices or delete research data in Privacy.</p>
      {state.blocked && <p>Your browser requests no tracking. Sharing will remain off.</p>}
      {!state.available && <p>Research storage is not connected on this server. No research data will be sent while it is unavailable.</p>}
      <div className="insights-actions">
        <button onClick={() => setConsent({ version: 2, ...NONE })}>Continue without sharing</button>
        <button onClick={() => setConsent({ version: 2, ...choices })}>Continue with my choices</button>
      </div>
    </DialogContent>
  </Dialog>;
}
export function InsightsControls() {
  const state = useInsights();
  const [draft, setDraft] = useState<Choices | null>(null);
  const value = draft ?? { usage: state.consent?.usage ?? false, content: state.consent?.content ?? false, transcript: state.consent?.transcript ?? false };
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  return <section className="insights-settings" aria-label="Analytics choices">
    <h3>Your research choices</h3>
    {state.blocked && <p>Your browser requests no tracking. ORION honors that preference.</p>}
    {!state.available && <p>Research storage is not connected on this server. Nothing is being collected.</p>}
    <ResearchChoices value={value} onChange={setDraft} disabled={state.blocked} />
    <div className="insights-actions">
      <button disabled={state.blocked} onClick={() => { setConsent({ version: 2, ...value }); setDraft(null); setStatus('Choices saved.'); }}>Save choices</button>
      {state.hasIdentity && <button disabled={busy} onClick={async () => {
        setBusy(true); setStatus(''); setDraft(null);
        try { await deleteInsights(); setStatus('Research data deleted; sharing is off. Your saved plans are unchanged.'); }
        catch (error) { setStatus(error instanceof Error ? error.message : 'Please try again.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Deleting...' : 'Delete my analytics data'}</button>}
    </div><output>{status}</output>
  </section>;
}
