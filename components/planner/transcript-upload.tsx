'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { loadIllinoisIndex } from '@/lib/planner/illinois-load';
import type { School } from '@/lib/planner/onboarding';
import {
  IMAGE_MEDIA_TYPES,
  TRANSCRIPT_MAX_BYTES,
  TRANSCRIPT_MAX_FILES,
  describeTranscript,
  isHomeTranscript,
  matchTranscript,
  normalizeCourseCode,
  setLineCounts,
  uploadKindFor,
  type TranscriptCourseRecord,
  type TranscriptReading,
  type TranscriptRecord,
  type TranscriptUploadFile,
} from '@/lib/planner/transcript';
import type { CatalogLite } from '@/lib/planner/transfer-match';

/**
 * "Upload what you have."
 *
 * The step that replaces typing forty course codes into a box. The files go
 * once to /api/transcript, which has the model list every course line on
 * them, and come back here to be matched against the catalog and shown to the
 * student as a list with a choice on each line: which Illinois course it
 * counts as, hours toward the total, or nothing. The student confirms what
 * counts; the model only reads.
 *
 * Matching happens here rather than on the server because the catalog is
 * already in the browser and the server keeps nothing. A line from another
 * school is never dropped: it arrives with the Illinois course the document
 * printed for it, or the catalog's likely equivalent to confirm, or as hours,
 * so a transfer student can see exactly what the planner made of each line
 * and change it.
 *
 * A course with no document behind it can be typed: a student who knows their
 * ECON 102 transferred adds it by code and it counts the same way.
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
  const [catalog, setCatalog] = useState<CatalogLite[] | null>(null);
  const [query, setQuery] = useState('');

  /** Only Illinois has a catalog in this build. Elsewhere every line is shown as unmatched, which is the truth. */
  async function catalogLite(): Promise<CatalogLite[]> {
    if (catalog) return catalog;
    if (school?.id !== 'illinois') return [];
    const index = (await loadIllinoisIndex()) ?? [];
    const lite = index.map((c) => ({ code: normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags }));
    setCatalog(lite);
    return lite;
  }

  async function readFiles(picked: File[], addTo: TranscriptRecord | null) {
    setError(null);
    if (picked.length > TRANSCRIPT_MAX_FILES) {
      setError(`Up to ${TRANSCRIPT_MAX_FILES} files at a time.`);
      return;
    }
    const files: TranscriptUploadFile[] = [];
    for (const file of picked) {
      const kind = uploadKindFor(file);
      if (!kind) {
        setError(`${file.name}: that file type is not supported. Use a PDF, a screenshot (PNG or JPG), or a text file.`);
        return;
      }
      if (file.size > TRANSCRIPT_MAX_BYTES) {
        setError(`${file.name} is over 10 MB. Export a smaller PDF, or screenshot the course list.`);
        return;
      }
      if (kind === 'text') files.push({ fileName: file.name, kind, mediaType: 'text/plain', text: await file.text() });
      else if (kind === 'pdf') files.push({ fileName: file.name, kind, mediaType: 'application/pdf', data: await base64Of(file) });
      else {
        const shrunk = await shrinkImage(file);
        files.push({ fileName: file.name, kind, mediaType: shrunk.mediaType, data: shrunk.data });
      }
    }
    setBusy(files.length === 1 ? `Reading ${files[0].fileName}` : `Reading ${files.length} files`);
    try {
      const res = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const json = (await res.json().catch(() => ({}))) as { reading?: TranscriptReading; error?: string };
      if (!res.ok || !json.reading) {
        setError(json.error ?? `The transcript reader answered ${res.status}.`);
        return;
      }
      const lite = await catalogLite();
      const names = files.map((f) => f.fileName);
      if (addTo) {
        // More pages of the same record: the lines already settled keep the
        // student's choices, and only the new lines are matched.
        const fresh = matchTranscript(json.reading, names[0], lite, names);
        const seen = new Set(addTo.courses.map((c) => `${c.code}|${c.term ?? ''}`));
        const added = fresh.courses.filter((c) => !seen.has(`${c.code}|${c.term ?? ''}`));
        onChange({
          ...addTo,
          institution: addTo.institution ?? fresh.institution,
          files: [...(addTo.files ?? [addTo.fileName]), ...names],
          courses: [...addTo.courses, ...added],
          exams: [...addTo.exams, ...fresh.exams].filter((e, i, all) => all.findIndex((o) => o.kind === e.kind && o.exam === e.exam) === i),
          notes: [...addTo.notes, ...fresh.notes.filter((n) => !addTo.notes.includes(n))],
        });
      } else {
        onChange(matchTranscript(json.reading, names[0], lite, names));
      }
    } catch {
      setError('The transcript could not be sent. Check your connection and try again.');
    } finally {
      setBusy(null);
      // So the same file can be picked again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  /** A course the student types, counted as taken with no document behind it. */
  function addTyped(course: CatalogLite) {
    const line: TranscriptCourseRecord = {
      code: course.code,
      title: course.title,
      credits: course.credits,
      grade: null,
      term: null,
      status: 'completed',
      from: null,
      equivalent: null,
      matched: course.code,
      matchedBy: 'student',
      use: true,
      counts: 'course',
    };
    const base: TranscriptRecord = record ?? {
      fileName: 'Added by you',
      readAt: new Date().toISOString(),
      institution: null,
      kind: 'course_list',
      home: true,
      files: [],
      courses: [],
      exams: [],
      notes: [],
    };
    if (base.courses.some((c) => c.use && c.matched === course.code)) {
      setQuery('');
      return;
    }
    onChange({ ...base, courses: [...base.courses, line] });
    setQuery('');
  }

  const typedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !catalog) return [];
    const code = q.toUpperCase().replace(/\s+/g, ' ');
    const byCode = catalog.filter((c) => c.code.startsWith(code));
    const byTitle = byCode.length < 8 ? catalog.filter((c) => !c.code.startsWith(code) && c.title.toLowerCase().includes(q)) : [];
    return [...byCode, ...byTitle].slice(0, 8);
  }, [query, catalog]);

  const known = useMemo(() => new Map((catalog ?? []).map((c) => [c.code, c])), [catalog]);
  const hoursOf = (c: TranscriptCourseRecord) => c.equivalentCredits ?? c.credits;

  return (
    <div className={compact ? 'transcript transcript-compact' : 'transcript'}>
      <label className="transcript-pick" htmlFor={inputId}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv"
          disabled={busy !== null}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void readFiles(files, null);
          }}
        />
        {busy ? 'Reading…' : record && record.courses.length > 0 ? 'Upload a different document' : 'Upload a transcript or screenshot'}
      </label>
      {!compact && (
        <span className="transcript-hint">
          Your transcript, your Illinois academic history, a Transfer Evaluation Report, a degree audit, or a
          screenshot of a course list from {school?.portal ?? 'your student portal'} or Canvas. Several files at
          once is fine. It is read once to list your courses and is not kept.
        </span>
      )}
      {busy && <output className="transcript-busy">{busy}. This takes about half a minute.</output>}
      {error && (
        <p className="transcript-error" role="alert">
          {error}
        </p>
      )}

      {record && record.courses.length > 0 && (
        <>
          <p className="transcript-summary">{describeTranscript(record, school?.short ?? 'this')}</p>
          {record.institution && (
            <p className="transcript-meta">
              Issued by {record.institution}
              {record.home === false ? '. Its codes are that school\'s; each line below says what it counts as at Illinois.' : '.'}
            </p>
          )}
          <details className="transcript-review" open={!compact}>
            <summary>
              Review the {record.courses.length} {record.courses.length === 1 ? 'line' : 'lines'}
            </summary>
            <ul className="transcript-list">
              {record.courses.map((c, i) => {
                const foreign = c.from ? !isHomeTranscript(c.from) : record.home === false;
                const options = countsOptions(c, foreign, known);
                const value = c.counts === 'course' && c.matched ? `course:${c.matched}` : c.counts;
                return (
                  <li key={`${c.code}-${c.term ?? ''}-${i}`} className={c.use ? undefined : 'off'}>
                    <span className="transcript-line">
                      <span className="transcript-code">{c.code}</span>{' '}
                      <span className="transcript-meta">
                        {[c.title, c.credits !== null ? `${c.credits} cr` : null, c.grade, c.term, c.from && !isHomeTranscript(c.from) ? c.from : null, c.iai ? `IAI ${c.iai}` : null, c.also?.length ? `also ${c.also.join(', ')}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {c.status === 'no_credit' || c.status === 'withdrawn' || c.status === 'failed' ? (
                      <span className="transcript-chip warn">{chipFor(c)}</span>
                    ) : (
                      <select
                        className={`transcript-counts${c.matchedBy === 'proposal' ? ' is-likely' : ''}`}
                        aria-label={`What ${c.code} counts as`}
                        title={c.matchedBy === 'proposal' ? c.proposals?.[0]?.why : c.matchedBy === 'printed' ? 'The document prints this equivalent.' : undefined}
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'hours') onChange(setLineCounts(record, i, { counts: 'hours' }));
                          else if (v === 'none') onChange(setLineCounts(record, i, { counts: 'none' }));
                          else onChange(setLineCounts(record, i, { counts: 'course', code: v.slice('course:'.length) }));
                        }}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                        <option value="hours">{`Hours toward the total${hoursOf(c) !== null ? ` (${hoursOf(c)} hr)` : ''}`}</option>
                        <option value="none">Does not count</option>
                      </select>
                    )}
                  </li>
                );
              })}
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
          <div className="transcript-actions">
            <label className="transcript-more">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv"
                disabled={busy !== null}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void readFiles(files, record);
                  e.target.value = '';
                }}
              />
              Add another page or file
            </label>
            <button type="button" className="transcript-remove" onClick={() => onChange(null)}>
              Remove all of this
            </button>
          </div>
        </>
      )}

      {school?.id === 'illinois' && (
        <div className="transcript-add">
          <input
            className="prior-search"
            value={query}
            placeholder="Add a course you have credit for, by code or title (ECON 102, Calculus I)"
            aria-label="Add a course you already have credit for"
            onFocus={() => void catalogLite()}
            onChange={(e) => {
              setQuery(e.target.value);
              void catalogLite();
            }}
          />
          {typedMatches.length > 0 && (
            <ul className="prior-matches">
              {typedMatches.map((c) => (
                <li key={c.code}>
                  <button type="button" onClick={() => addTyped(c)}>
                    <span className="prior-kind">{c.code}</span> {c.title} · {c.credits} cr
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The ways one line can count as a course, best first, for its select. */
function countsOptions(
  c: TranscriptCourseRecord,
  foreign: boolean,
  known: Map<string, CatalogLite>,
): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (code: string, note: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    const course = known.get(code);
    out.push({ value: `course:${code}`, label: `${code}${course ? ` ${course.title}` : ''}${note ? ` (${note})` : ''}` });
  };
  if (c.matched && (c.matchedBy === 'code' || c.matchedBy === 'student')) push(c.matched, foreign ? 'your choice' : '');
  if (c.equivalent && known.has(c.equivalent)) push(c.equivalent, 'printed on the document');
  for (const p of c.proposals ?? []) push(p.code, p.confidence === 'high' ? 'likely' : p.confidence === 'medium' ? 'possible' : 'a guess');
  if (c.matched && !seen.has(c.matched)) push(c.matched, '');
  return out;
}

/** The chip on a line that cannot count. */
function chipFor(c: TranscriptCourseRecord): string {
  switch (c.status) {
    case 'withdrawn':
      return 'withdrawn';
    case 'failed':
      return 'failed';
    case 'no_credit':
      return 'no credit';
    default:
      return c.counts === 'hours' ? 'hours' : c.matched ?? 'not counted';
  }
}

function base64Of(file: Blob): Promise<string> {
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

/**
 * A screenshot no larger than the reader needs.
 *
 * A phone screenshot is 1170 by 2532 and a full-page capture can be 8000
 * tall; the model reads text at 2000 pixels on the long side as well as at
 * 8000 and refuses an image over 5 MB. Anything past those is scaled down
 * here, as a JPEG, before it leaves the browser. A small image is sent as is.
 */
async function shrinkImage(file: File): Promise<{ mediaType: string; data: string }> {
  const LONG = 2200;
  const BYTES = 3_500_000;
  const type = (IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type) ? file.type : 'image/png';
  try {
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    if (long <= LONG && file.size <= BYTES) {
      bitmap.close();
      return { mediaType: type, data: await base64Of(file) };
    }
    const scale = Math.min(1, LONG / long);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('no blob');
    return { mediaType: 'image/jpeg', data: await base64Of(blob) };
  } catch {
    return { mediaType: type, data: await base64Of(file) };
  }
}
