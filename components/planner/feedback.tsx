'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail, MessageSquare, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { contextNow } from '@/lib/insights/client';
import { cleanFeedback, feedbackText, FEEDBACK_EMAIL, type Feedback } from '@/lib/insights/schema';

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'feedback' | 'bug'>('feedback');
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [usefulness, setUsefulness] = useState('');
  const [diagnostics, setDiagnostics] = useState(false);
  const [delivery, setDelivery] = useState<'server' | 'email'>('email');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const id = useRef('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    void fetch('/api/feedback').then((r) => r.ok ? r.json() as Promise<{ delivery: string }> : null).then((v) => { if (current) setDelivery(v?.delivery === 'server' ? 'server' : 'email'); }).catch(() => {});
    return () => { current = false; };
  }, [open]);
  const makeReport = (): Feedback | null => {
    id.current ||= crypto.randomUUID();
    return cleanFeedback({ id: id.current, kind, message, replyTo, usefulness, ...(diagnostics ? contextNow() : {}) });
  };
  const emailDraft = () => {
    const report = makeReport();
    if (!report) { setStatus('Enter at least five characters and check the reply email.'); return; }
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`ORION: ${kind === 'bug' ? 'bug report' : 'feedback'}`)}&body=${encodeURIComponent(feedbackText(report))}`;
    setStatus('Your email app was requested. Review the draft and press Send there. Nothing has been sent by ORION.');
  };
  const changed = () => { id.current = ''; setStatus(''); };
  return <>
    <button type="button" className="unofficial-link feedback-link" data-insight="feedback.open" aria-label="Feedback or report a bug" title="Feedback or report a bug" onClick={() => setOpen(true)}><MessageSquare aria-hidden="true" /><span>Feedback / report a bug</span></button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="privacy-dialog feedback-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Help shape ORION</DialogTitle>
          <DialogDescription>Your message goes to {FEEDBACK_EMAIL}. Don’t include transcripts, student IDs, grades or other sensitive details.</DialogDescription>
        </DialogHeader>
        <form className="feedback-form" onSubmit={async (e) => {
          e.preventDefault();
          if (delivery === 'email') { emailDraft(); return; }
          const report = makeReport();
          if (!report) { setStatus('Check the message and reply email.'); return; }
          setBusy(true); setStatus('');
          try {
            const response = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(15000) });
            const result = await response.json() as { sent?: boolean; error?: string };
            if (!response.ok || !result.sent) throw new Error(result.error || 'Could not confirm delivery.');
            setStatus('Your report was accepted for email delivery. Thank you.'); setMessage(''); id.current = '';
          } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not confirm delivery. Open an email draft instead.'); }
          finally { setBusy(false); }
        }}>
          <fieldset className="feedback-kind" disabled={busy}><legend className="sr-only">Report type</legend>
            {(['feedback', 'bug'] as const).map((type) => <label key={type}><input type="radio" name="feedback-kind" value={type} checked={kind === type} onChange={() => { setKind(type); changed(); }} />{type === 'bug' ? 'Report a bug' : 'Share feedback'}</label>)}
          </fieldset>
          <label>{kind === 'bug' ? 'What happened, and what did you expect?' : 'What worked well? What should change?'}
            <textarea rows={5} required minLength={5} maxLength={3000} value={message} disabled={busy} onChange={(e) => { setMessage(e.target.value); changed(); }} />
          </label>
          <label>How useful was ORION?<select value={usefulness} disabled={busy} onChange={(e) => { setUsefulness(e.target.value); changed(); }}>
            <option value="">Prefer not to say</option><option value="helpful">Helpful</option><option value="mixed">Somewhat helpful</option><option value="not_helpful">Not helpful yet</option>
          </select></label>
          <label>Reply email (optional)<input type="email" autoComplete="email" maxLength={254} value={replyTo} disabled={busy} onChange={(e) => { setReplyTo(e.target.value); changed(); }} /></label>
          <label className="feedback-check"><input type="checkbox" checked={diagnostics} disabled={busy} onChange={(e) => { setDiagnostics(e.target.checked); changed(); }} /><span>Include current screen, university and window-size category. No plan or chat contents.</span></label>
          {delivery === 'email' && <p>Automatic delivery isn’t connected yet. The button below prepares a draft in your email app; you send it from there.</p>}
          <div className="insights-actions"><button type="submit" disabled={busy}>{delivery === 'server' ? <Send aria-hidden="true" /> : <Mail aria-hidden="true" />}{busy ? 'Sending...' : delivery === 'server' ? 'Send report' : 'Open email draft'}</button>
            {delivery === 'server' && <button type="button" disabled={busy} onClick={emailDraft}>Open email draft instead</button>}
          </div>
          <output>{status}</output>
          <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
