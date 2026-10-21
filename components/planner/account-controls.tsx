'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { localSnapshot, snapshotFingerprint, WORKSPACE_KEYS, workspaceSchema, type WorkspaceSnapshot } from '@/lib/accounts/snapshot';
import { parseSavedBoard } from '@/lib/planner/saved-board';

const LINK_KEY = 'fourYear.account.link.v1';
type Session = { enabled: boolean; user: { id: string; email: string } | null };
type CloudPlan = { snapshot: WorkspaceSnapshot | null; revision: number; updatedAt?: number };
export function openAccount() { window.dispatchEvent(new Event('orion:account')); }
async function request<T = void>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || 'Please try again.');
  return body as T;
}
export function AccountControls({ inPlanner }: { inPlanner: boolean }) {
  const [session, setSession] = useState<{ enabled: boolean; user: { id: string; email: string } | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<{ snapshot: WorkspaceSnapshot | null; revision: number; updatedAt?: number } | null>(null);
  const [choice, setChoice] = useState<'load' | 'replace' | 'delete' | 'account' | null>(null);
  const link = useRef<{ user: string; revision: number; fingerprint: string } | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);
  const offered = useRef(false);
  const navigating = useRef(false);
  useEffect(() => {
    let active = true;
    void request<Session>('/api/auth/session').then((value) => {
      if (!active) return;
      setSession(value);
      try {
        const stored = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null');
        if (value.user && stored?.user === value.user.id) link.current = stored;
      } catch { /* Unlinked until explicitly saved or loaded. */ }
      const result = new URL(location.href).searchParams.get('account');
      if (result) {
        setOpen(true);
        setStatus(result === 'connected' ? 'Signed in. Choose which plan to use below.' : 'Sign-in did not finish. Please try again.');
        const url = new URL(location.href); url.searchParams.delete('account'); history.replaceState(null, '', url);
      }
    }).catch(() => { if (active) setSession({ enabled: false, user: null }); });
    const show = () => setOpen(true);
    window.addEventListener('orion:account', show);
    return () => { active = false; window.removeEventListener('orion:account', show); };
  }, []);
  useEffect(() => {
    if (!open || !session?.user) return;
    void request<CloudPlan>('/api/account/workspace').then(setRemote).catch((error) => setStatus(error.message));
  }, [open, session?.user]);
  useEffect(() => {
    if (inPlanner && session?.enabled && !session.user && !offered.current) {
      offered.current = true;
      const timer = window.setTimeout(() => setOpen(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [inPlanner, session]);
  const save = useCallback(async (revision: number, silent = false) => {
    if (!session?.user || saving.current) return;
    const snapshot = localSnapshot(localStorage);
    if (!snapshot) { if (!silent) setStatus('Wait for your plan to finish building before saving.'); return; }
    saving.current = true; setBusy(true);
    try {
      const result = await request<CloudPlan>('/api/account/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot, revision }) });
      link.current = { user: session.user.id, revision: result.revision, fingerprint: snapshotFingerprint(snapshot) };
      localStorage.setItem(LINK_KEY, JSON.stringify(link.current));
      dirty.current = false;
      setRemote({ snapshot, revision: result.revision, updatedAt: result.updatedAt });
      setStatus('Saved to your account. Further changes will save automatically.');
    } catch (error) {
      link.current = null; localStorage.removeItem(LINK_KEY);
      setStatus(error instanceof Error ? error.message : 'Could not save. Your plan is still on this device.');
      if (silent) setOpen(true);
    } finally { saving.current = false; setBusy(false); }
  }, [session]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!inPlanner) return;
      const snapshot = localSnapshot(localStorage);
      if (!snapshot) return;
      const current = link.current;
      dirty.current = !current || current.fingerprint !== snapshotFingerprint(snapshot);
      if (!open && dirty.current && current && session?.user?.id === current.user) void save(current.revision, true);
    }, 2500);
    const warn = (event: BeforeUnloadEvent) => {
      if (!inPlanner || navigating.current) return;
      const snapshot = localSnapshot(localStorage);
      if (snapshot && (!link.current || snapshotFingerprint(snapshot) !== link.current.fingerprint)) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', warn); };
  }, [inPlanner, save, session, open]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setStatus('');
    try { await fn(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  const forgetLocal = () => {
    link.current = null;
    for (const key of [...WORKSPACE_KEYS, LINK_KEY, 'four-year-planner-v3']) localStorage.removeItem(key);
    navigating.current = true;
    location.reload();
  };
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); setChoice(null); }}>
    <DialogContent className="orion-dialog account-dialog">
      <DialogTitle>{session?.user ? 'Your saved plans' : 'Save for future use?'}</DialogTitle>
      <DialogDescription>{session?.user ? `Signed in as ${session.user.email}` : 'Sign in with Google to keep your plans across devices. You can also keep using ORION without an account.'}</DialogDescription>
      {!session?.user ? <>
        <p>Account saves include your plan tabs, setup answers, reviewed credit record and chat history. They are private to your account, not shared with research analytics. No transcript files are stored.</p>
        <button className="onb-next" disabled={!session?.enabled || busy} onClick={() => void act(async () => {
          const result = await request<{ url: string }>('/api/auth/google', { method: 'POST' });
          navigating.current = true;
          window.location.assign(result.url);
        })}>Sign in with Google</button>
        {session && !session.enabled && <p>Google sign-in is not available on this server yet. Your local plan still works.</p>}
        <button className="onb-back" onClick={() => setOpen(false)}>Keep using this device</button>
      </> : <>
        <p>{remote?.snapshot ? `Account copy saved ${new Date(remote.updatedAt!).toLocaleString()}.` : remote ? 'No plan saved to this account yet.' : 'Checking your account...'}</p>
        <div className="account-actions">
          <button className="onb-next" disabled={busy || !remote} onClick={() => remote?.snapshot && !link.current ? setChoice('replace') : void save(link.current?.revision ?? remote?.revision ?? 0)}>Save this device&apos;s plan</button>
          <button disabled={busy || !remote?.snapshot} onClick={() => setChoice('load')}>Load account plan</button>
          <button disabled={busy || !remote?.snapshot} onClick={() => setChoice('delete')}>Delete account copy</button>
          <button disabled={busy} onClick={() => void act(async () => { await request('/api/auth/session', { method: 'DELETE' }); forgetLocal(); })}>Sign out and clear this device</button>
          <button disabled={busy} onClick={() => setChoice('account')}>Delete my account</button>
        </div>
        {choice && <section className="account-confirm" role="alert">
          <p>{choice === 'load' ? 'Replace the plan, answers and chat on this device with your account copy?' : choice === 'replace' ? 'Replace the existing account copy with the plan on this device? Download a backup first if you need both.' : choice === 'delete' ? 'Delete your cloud plan? Your local copy will stay, and automatic saving will stop.' : 'Delete your account and all its cloud plans and sessions? This cannot be undone.'}</p>
          <button disabled={busy} onClick={() => void act(async () => {
            if (choice === 'replace') { await save(remote!.revision); }
            if (choice === 'load') {
              const fresh = await request<CloudPlan>('/api/account/workspace');
              const parsed = workspaceSchema.parse(fresh.snapshot);
              if (!parseSavedBoard(JSON.stringify(parsed.board), String(parsed.answers.schoolId))) throw new Error('This saved plan cannot be loaded. Your local plan is unchanged.');
              const before = WORKSPACE_KEYS.map((key) => localStorage.getItem(key));
              try {
                [parsed.answers, parsed.board, parsed.chat].forEach((value, i) => value ? localStorage.setItem(WORKSPACE_KEYS[i], JSON.stringify(value)) : localStorage.removeItem(WORKSPACE_KEYS[i]));
                localStorage.setItem(LINK_KEY, JSON.stringify({ user: session.user!.id, revision: fresh.revision, fingerprint: snapshotFingerprint(parsed) }));
              } catch (error) { before.forEach((value, i) => value ? localStorage.setItem(WORKSPACE_KEYS[i], value) : localStorage.removeItem(WORKSPACE_KEYS[i])); throw error; }
              navigating.current = true;
              location.reload();
            }
            if (choice === 'delete' || choice === 'account') {
              await request(choice === 'delete' ? '/api/account/workspace' : '/api/auth/session', { method: choice === 'delete' ? 'DELETE' : 'POST' });
              link.current = null; localStorage.removeItem(LINK_KEY); setRemote({ snapshot: null, revision: 0 });
              if (choice === 'account') forgetLocal();
            }
            setChoice(null);
          })}>Confirm</button>
          <button disabled={busy} onClick={() => setChoice(null)}>Cancel</button>
        </section>}
      </>}
      <output aria-live="polite">{busy ? 'Working...' : status}</output>
    </DialogContent>
  </Dialog>;
}
