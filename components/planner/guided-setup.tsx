'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { type OnboardingAnswers, defaultProgramYears, suggestGraduationTarget, isGraduationTermPast, schoolById, setupResponse, withSetupResponse } from '@/lib/planner/onboarding';
import { setupReplySchema, validatedSetupPatch, type SetupCatalog, type SetupMessage } from '@/lib/planner/setup-agent';
import { loadUgaPlanningGuidance, type DoubleDawgsPathway } from '@/lib/planner/uga-planning-guidance';
import { normalizeUgaCollegeId, UGA_COLLEGES } from '@/lib/planner/uga-colleges';
import { trackContent } from '@/lib/insights/client';
import { firstFallOf } from './illinois-source';
import { type UgaProgram } from './uga-source';
import { PriorCredit } from './prior-credit';
import { doubleDawgsTimingValid } from './double-dawgs-timing';

/** What a student reads when the setup assistant cannot answer: the form still works, with their answers. */
const SETUP_UNAVAILABLE = 'The setup assistant is unavailable right now. Your answers are kept: choose "Enter my details manually" to go on, or try again in a bit.';

/** A failure already worded for the student by app/api/setup/route.ts, or the plain sentence. */
class SetupUnavailable extends Error {
  constructor(message: unknown) {
    super(typeof message === 'string' && message.trim() ? message : SETUP_UNAVAILABLE);
  }
}

export function GuidedSetup({ answers, catalog, onChange, onManual, onBack, onFinish }: {
  answers: OnboardingAnswers;
  catalog: (SetupCatalog & { ugaPrograms: UgaProgram[] }) | null;
  onChange: (answers: OnboardingAnswers) => void;
  /** With what the conversation has learned so far, the words the student typed included, for the form to start from. */
  onManual: (answers: OnboardingAnswers) => void;
  onBack: () => void;
  onFinish: (answers: OnboardingAnswers) => void;
}) {
  const [messages, setMessages] = useState<SetupMessage[]>(answers.setupConversation ?? []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { programConfirmed = false, creditReviewed = false, graduationConfirmed = false } = answers.setupConfirmations ?? {};
  const [creditOpen, setCreditOpen] = useState(false);
  const [pathways, setPathways] = useState<DoubleDawgsPathway[]>([]);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const school = schoolById(answers.schoolId);
  useEffect(() => {
    if (answers.schoolId === 'uga') void loadUgaPlanningGuidance().then((value) => setPathways(value?.pathways ?? []));
    return () => abort.current?.abort();
  }, [answers.schoolId]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy]);
  const degrees = answers.programLevel === 'graduate' ? catalog?.graduateDegrees : catalog?.undergraduateDegrees;
  const required = catalog?.requirements.filter((row) => answers.programIds.includes(row.programId)) ?? [];
  const missing = [
    !programConfirmed && 'degree choice',
    !answers.academicYear && 'year of your program',
    (!graduationConfirmed || !answers.graduationSeason || !answers.graduationYear || isGraduationTermPast(answers.graduationSeason, answers.graduationYear)) && 'graduation term',
    required.some((row) => (answers.emphasisSelections[row.id]?.length ?? 0) < row.minimum) && 'required emphases',
    answers.schoolId === 'uga' && !answers.programIds.includes('__undecided__') && !answers.collegeId && 'primary college',
    !doubleDawgsTimingValid(answers) && 'Double Dawgs graduation dates',
    !creditReviewed && 'prior credit',
  ].filter(Boolean);
  // A first-year student may have no prior credit at all; a later year's record is their transcript.
  const newStudent = !answers.academicYear || answers.academicYear === 'first';
  const creditStep = newStudent
    ? 'add any AP, IB, dual-enrollment or transfer credit under "Add prior credit or upload a transcript" below, or choose "I have no prior credit"'
    : 'upload your transcript or add the classes you have taken under "Add prior credit or upload a transcript" below, tell the assistant what you have taken, or choose "I\'ll add my classes later"';
  /**
   * Into the form with everything said so far (2026-10-30): the assistant's
   * facts are already in the answers, but a reply it never read (the
   * assistant was unavailable) and the unsent draft were left behind, so the
   * form started blank. They join the open response, where the form reads
   * the year, the graduation term and the goals from the words.
   */
  const manual = () => {
    const current = setupResponse(answers);
    const said = [...messages.filter((m) => m.role === 'user').map((m) => m.content), draft.trim()]
      .map((text) => text.trim())
      .filter((text, i, all) => text && all.indexOf(text) === i && !current.includes(text));
    onManual(said.length > 0 ? withSetupResponse(answers, [current, ...said].filter(Boolean).join('\n')) : answers);
  };
  const send = async () => {
    if (!draft.trim() || !catalog || !answers.schoolId || busy) return;
    setBusy(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    const nextMessages: SetupMessage[] = [...messages, { role: 'user', content: draft.trim() }];
    try {
      const { transcript: _transcript, setupConversation: _history, ...facts } = answers;
      // The assistant gets a count, never the uploaded document or identifying transcript metadata.
      const context = JSON.stringify({ date: new Date().toISOString().slice(0, 10), answers: facts,
        confirmations: { programConfirmed, creditReviewed, graduationConfirmed }, missing,
        transcriptCourseCount: answers.transcript?.courses.length ?? 0,
        catalog: { ...catalog, ugaPrograms: undefined },
        colleges: answers.schoolId === 'uga' ? UGA_COLLEGES.map(({ id, name }) => ({ id, name })) : [],
        pathways: pathways.map(({ id, name, undergraduateProgramIds, graduateProgramIds }) => ({ id, name, undergraduateProgramIds, graduateProgramIds })),
      });
      const response = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ school: answers.schoolId, messages: nextMessages, context }) });
      const body = await response.json().catch(() => null) as unknown;
      // The route words its failures for the student; anything else (no answer, a proxy's page) gets the plain sentence below.
      if (!response.ok) throw new SetupUnavailable((body as { error?: unknown } | null)?.error);
      const parsed = setupReplySchema.safeParse(body);
      if (!parsed.success) throw new SetupUnavailable(null);
      const result = parsed.data;
      const candidatePrograms = result.patch.programIds ?? answers.programIds;
      const allowedPathways = pathways.filter((row) => row.undergraduateProgramIds.some((id) => candidatePrograms.includes(id)) && row.graduateProgramIds.length === 1);
      const patch = validatedSetupPatch(answers, result.patch, catalog, allowedPathways.map((p) => p.id), UGA_COLLEGES.map((c) => c.id));
      let next = { ...answers, ...patch, emphasisSelections: { ...answers.emphasisSelections, ...patch.emphasisSelections } };
      if (patch.programLevel && patch.programLevel !== answers.programLevel) {
        next.minorIds = patch.minorIds ?? [];
        next.certificateIds = patch.certificateIds ?? [];
        next.doubleDawgsPathwayId = patch.doubleDawgsPathwayId ?? null;
        next.doubleDawgsSharedCodes = [];
      }
      if (patch.programIds && JSON.stringify(patch.programIds) !== JSON.stringify(answers.programIds)) {
        next.emphasisSelections = Object.fromEntries(Object.entries(next.emphasisSelections).filter(([key]) => catalog.requirements.some((r) => r.id === key && next.programIds.includes(r.programId))));
        if (!patch.doubleDawgsPathwayId && !allowedPathways.some((p) => p.id === next.doubleDawgsPathwayId)) next.doubleDawgsPathwayId = null;
        if (!patch.collegeId) next.collegeId = '';
      }
      const selectedDegrees = (next.programLevel === 'graduate' ? catalog.graduateDegrees : catalog.undergraduateDegrees).filter((row) => next.programIds.includes(row.id));
      if (next.academicYear && !next.graduationYear) {
        const said = nextMessages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
        const target = suggestGraduationTarget(next.academicYear, defaultProgramYears(next.programLevel, selectedDegrees.flatMap((p) => p.degree ?? [])), new Date(), firstFallOf(said, new Date()));
        next = { ...next, graduationSeason: target.season, graduationYear: target.year };
      }
      const colleges = [...new Set(catalog.ugaPrograms.filter((p) => next.programIds.includes(p.id)).map((p) => normalizeUgaCollegeId(p.college)).filter(Boolean))];
      if (!next.collegeId && colleges.length === 1) next.collegeId = colleges[0];
      const history: SetupMessage[] = [...nextMessages, { role: 'assistant', content: result.reply }];
      next = { ...withSetupResponse(next, nextMessages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')), setupConversation: history,
        setupConfirmations: { programConfirmed: result.programConfirmed, creditReviewed: creditReviewed || result.creditReviewed, graduationConfirmed: graduationConfirmed || Boolean(patch.graduationSeason || patch.graduationYear) } };
      onChange(next); setMessages(history); setDraft('');
      trackContent('setup', draft.trim()); trackContent('assistant', result.reply);
    } catch (error) {
      // Never a parser's or the network's own words: a failed fetch read "Failed to fetch" (2026-10-30).
      if (!controller.signal.aborted) setError(error instanceof SetupUnavailable ? error.message : SETUP_UNAVAILABLE);
    } finally { setBusy(false); abort.current = null; }
  };
  return <section className="onb-step guided-setup">
    <h1>Describe yourself</h1>
    <p className="onb-sub">Your studies, where you are now, and what you want to make room for.</p>
    {messages.length > 0 && <>
      <div className="guided-history" ref={log} role="log" aria-label="Setup conversation" aria-live="polite">
        {messages.map((message, i) => <p className={`guided-message ${message.role}`} key={i}>{message.content}</p>)}
        {busy && <output>Reading your answer...</output>}
      </div>
      <div className="guided-summary" aria-label="Your details so far">
        <span>{degrees?.filter((p) => answers.programIds.includes(p.id)).map((p) => p.name).join(' + ')}</span>
        {answers.academicYear && <span>{answers.academicYear} year</span>}
        {answers.graduationYear && <span>{answers.graduationSeason} {answers.graduationYear}{!graduationConfirmed ? ' (suggested)' : ''}</span>}
        {!graduationConfirmed && answers.graduationYear && <button onClick={() => { const content = `My intended graduation is ${answers.graduationSeason} ${answers.graduationYear}.`; const history: SetupMessage[] = [...messages, { role: 'user', content }]; setMessages(history); onChange({ ...answers, setupConversation: history, setupConfirmations: { programConfirmed, creditReviewed, graduationConfirmed: true } }); }}>Use this graduation term</button>}
        {!creditReviewed && newStudent && <button onClick={() => { const content = 'I have no AP, IB, dual-enrollment or transfer credit.'; const history: SetupMessage[] = [...messages, { role: 'user', content }]; setMessages(history); onChange({ ...answers, setupConversation: history, setupConfirmations: { programConfirmed, graduationConfirmed, creditReviewed: true } }); }}>I have no prior credit</button>}
        {/* A later year has a record; without it now, the board assumes a usual load for the earlier terms and asks for the record (warnings-triage.ts recordPrompt). */}
        {!creditReviewed && !newStudent && <button onClick={() => { const content = 'I will add the classes I have taken later.'; const history: SetupMessage[] = [...messages, { role: 'user', content }]; setMessages(history); onChange({ ...answers, setupConversation: history, setupConfirmations: { programConfirmed, graduationConfirmed, creditReviewed: true } }); }}>I&apos;ll add my classes later</button>}
      </div>
      {/*
        * The buttons answer without the assistant, which would have asked for what is left:
        * after "Use this graduation term" nothing asked for prior credit, and no Build button came (2026-10-28).
        */}
      {!busy && missing.length > 0 && <p className="onb-q-hint">{missing.length === 1 && !creditReviewed
        ? `Last step: ${creditStep}.`
        : `Still needed before your plan: ${missing.join(', ')}. Tell the assistant here or choose "Edit details manually"${!creditReviewed ? `, and ${creditStep}` : ''}.`}</p>}
    </>}
    <form className="guided-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea aria-label={messages.length ? 'Reply to the setup assistant' : 'Describe yourself'} maxLength={6000} rows={messages.length ? 3 : 5} value={draft} disabled={busy}
        placeholder={messages.length ? 'Your reply...' : "I'm a second-year cognitive science student interested in AI..."}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {busy ? <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()}><Square size={18} fill="currentColor" /></button> : <button aria-label="Send description" disabled={!catalog || !draft.trim()}><ArrowUp size={20} /></button>}
    </form>
    <p className="onb-q-hint">Replies are sent to AI to help plan your degree. No student ID or other identifying details are needed.</p>
    {error && <p role="alert" className="onb-feasibility">{error}{' '}<button type="button" className="setup-mode-link" disabled={busy} onClick={manual}>Enter my details manually</button></p>}
    <details open={creditOpen} onToggle={(event) => setCreditOpen(event.currentTarget.open)} className="guided-credit">
      <summary>Add prior credit or upload a transcript</summary>
      {creditOpen && <>
        <PriorCredit school={school} exams={answers.exams} transferText={answers.transferText} languageYears={answers.languageYears ?? null} language={answers.language ?? ''}
          onChange={(value) => onChange({ ...answers, ...value, setupConfirmations: { programConfirmed, graduationConfirmed, creditReviewed: true } })} transcript={answers.transcript ?? null}
          onTranscriptChange={(transcript) => { onChange({ ...answers, transcript, setupConfirmations: { programConfirmed, graduationConfirmed, creditReviewed: true } }); }}
          grainger={answers.programIds.some((id) => id.startsWith('engineering/'))} graduate={answers.programLevel === 'graduate'}
          alreadyTakenCourseCodes={answers.alreadyTakenCourseCodes} onAlreadyTakenChange={(codes) => onChange({ ...answers, alreadyTakenCourseCodes: codes, setupConfirmations: { programConfirmed, graduationConfirmed, creditReviewed: true } })} />
      </>}
    </details>
    <div className="onb-actions guided-navigation">
      <button className="onb-back" disabled={busy} onClick={onBack}>Back</button>
      <button className="setup-mode-link" disabled={busy} onClick={manual}>{messages.length ? 'Edit details manually' : 'Skip the assistant and enter details manually'}</button>
      {missing.length === 0 && <button className="onb-next" disabled={busy} onClick={() => onFinish(answers)}>Build my plan</button>}
    </div>
  </section>;
}
