'use client';

import { useId, useRef, useState } from 'react';
import { loadIllinoisIndex } from '@/lib/planner/illinois-load';
import type { School } from '@/lib/planner/onboarding';
import {
  TRANSCRIPT_MAX_BYTES,
  describeTranscript,
  matchTranscript,
  uploadKindFor,
  type TranscriptCourseRecord,
  type TranscriptReading,
  type TranscriptRecord,
  type TranscriptUploadBody,
} from '@/lib/planner/transcript';

/**
 * "Upload your transcript."
 *
 * The step that replaces typing forty course codes into a box. The file goes
 * once to /api/transcript, which has the model list every course line on it,
 * and comes back here to be matched against the catalog and shown to the
 * student as a list with a checkbox on each line. The student confirms what
 * counts; the model only reads.
 *
 * Matching happens here rather than on the server because the catalog is
 * already in the browser and the server keeps nothing. A line the catalog
 * does not know, which is every line of a transcript from another school, is
 * shown and marked rather than dropped, so a transfer student can see exactly
 * what the planner could and could not use.
 */
export function TranscriptUpload({
  school,
  record,
  onChange,
  compact = false,
}: {
  school: School | undefined;
  record: TranscriptRecord | null;
  onChange: (next: TranscriptRecord | null) => void;
  /** The rail's version: the same control, the list folded shut. */
  compact?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readFile(file: File) {
    setError(null);
    const kind = uploadKindFor(file);
    if (!kind) {
      setError('That file type is not supported. Use a PDF, a screenshot (PNG or JPG), or a text file.');
      return;
    }
    if (file.size > TRANSCRIPT_MAX_BYTES) {
      setError('That file is over 10 MB. Export a smaller PDF, or screenshot the course list.');
      return;
    }
    setBusy(`Reading ${file.name}`);
    try {
      const body: TranscriptUploadBody =
        kind === 'text'
          ? { fileName: file.name, kind, mediaType: 'text/plain', text: await file.text() }
          : {
              fileName: file.name,
              kind,
              mediaType: kind === 'pdf' ? 'application/pdf' : file.type,
              data: await base64Of(file),
            };
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { reading?: TranscriptReading; error?: string };
      if (!res.ok || !json.reading) {
        setError(json.error ?? `The transcript reader answered ${res.status}.`);
        return;
      }
      // Only Illinois has a catalog in this build. Elsewhere every line is
      // shown as unmatched, which is the truth, rather than matched to nothing.
      const catalog = school?.id === 'illinois' ? await loadIllinoisIndex() : null;
      const known = new Set((catalog ?? []).map((c) => c.code.toUpperCase().replace(/\s+/g, ' ').trim()));
      onChange(matchTranscript(json.reading, file.name, (code) => known.has(code)));
    } catch {
      setError('The transcript could not be sent. Check your connection and try again.');
    } finally {
      setBusy(null);
      // So the same file can be picked again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function toggle(index: number) {
    if (!record) return;
    onChange({
      ...record,
      courses: record.courses.map((c, i) => (i === index ? { ...c, use: !c.use } : c)),
    });
  }

  return (
    <div className={compact ? 'transcript transcript-compact' : 'transcript'}>
      <label className="transcript-pick" htmlFor={inputId}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv"
          disabled={busy !== null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
        {busy ? 'Reading…' : record ? 'Upload a different transcript' : 'Upload a transcript'}
      </label>
      {!compact && (
        <span className="transcript-hint">
          A PDF or a screenshot from {school?.portal ?? 'your student portal'}, or a text file. It is read
          once to list your courses and is not kept.
        </span>
      )}
      {busy && <output className="transcript-busy">{busy}. This takes about half a minute.</output>}
      {error && (
        <p className="transcript-error" role="alert">
          {error}
        </p>
      )}
      {record && (
        <>
          <p className="transcript-summary">{describeTranscript(record, school?.short ?? 'this')}</p>
          <details className="transcript-review" open={!compact}>
            <summary>
              Review the {record.courses.length} {record.courses.length === 1 ? 'line' : 'lines'}
            </summary>
            <ul className="transcript-list">
              {record.courses.map((c, i) => (
                <li key={`${c.code}-${c.term ?? ''}-${i}`} className={c.use ? undefined : 'off'}>
                  <input
                    type="checkbox"
                    checked={c.use}
                    disabled={!c.matched}
                    aria-label={`Count ${c.code} as already taken`}
                    onChange={() => toggle(i)}
                  />
                  <span className="transcript-line">
                    <span className="transcript-code">{c.code}</span>{' '}
                    <span className="transcript-meta">
                      {[c.title, c.credits !== null ? `${c.credits} cr` : null, c.grade, c.term]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className={`transcript-chip${c.matched ? '' : ' warn'}`}>{chipFor(c)}</span>
                </li>
              ))}
            </ul>
          </details>
          {record.exams.length > 0 && (
            <p className="transcript-meta">
              Exams on it:{' '}
              {record.exams.map((e) => `${e.kind} ${e.exam}${e.score ? ` (${e.score})` : ''}`).join(', ')}.
              Where the registrar posted the credit, it is already a course line above.
            </p>
          )}
          {record.notes.length > 0 && <p className="transcript-meta">{record.notes.join(' ')}</p>}
          <button type="button" className="transcript-remove" onClick={() => onChange(null)}>
            Remove this transcript
          </button>
        </>
      )}
    </div>
  );
}

/** The chip on a line: why it counts, or why it does not. */
function chipFor(c: TranscriptCourseRecord): string {
  if (!c.matched) return 'not in catalog';
  switch (c.status) {
    case 'in_progress':
      return 'in progress';
    case 'withdrawn':
      return 'withdrawn';
    case 'failed':
      return 'failed';
    case 'transfer':
      return 'transfer';
    case 'exam':
      return 'test credit';
    default:
      return 'done';
  }
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      // readAsDataURL always yields a string; the guard is for the type, and
      // an empty string is refused by the route rather than sent as a file.
      const s = typeof reader.result === 'string' ? reader.result : '';
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
