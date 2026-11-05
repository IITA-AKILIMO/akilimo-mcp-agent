import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { renewReportLink } from '../account/api';

interface Report { id?: unknown; url?: unknown; expires_at?: unknown }

// A link to the Akilimo API's report download: /v1/recommendations/reports/<id>/<file>.pdf?expires=…&signature=…
const REPORT_URL = /\/v1\/recommendations\/reports\/([0-9a-f-]{36})\/([A-Za-z0-9_.-]+\.pdf)/i;

export const isReportUrl = (href: string | undefined): href is string => !!href && REPORT_URL.test(href);

// Still good for at least another minute? (`expires` in the signed link is a Unix time in seconds)
const linkIsFresh = (href: string) => {
  try {
    const expires = Number(new URL(href).searchParams.get('expires'));
    return !expires || expires * 1000 > Date.now() + 60_000;
  } catch {
    return false;
  }
};

/**
 * Opens a report link. The PDF is kept with the recommendation history, but a link lasts a week, so an expired one
 * (in a saved session or chat) is renewed first through the server, which checks the report is in the user's own
 * history. The tab is opened at once so the browser does not block it as a pop-up, then pointed at the PDF.
 * Throws a message for the user when no new link can be had (signed out, or the report is not theirs).
 */
export async function openReport(href: string): Promise<void> {
  if (linkIsFresh(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  const [, id, file] = REPORT_URL.exec(href) ?? [];
  const tab = window.open('', '_blank');
  try {
    const { report } = await renewReportLink(id);
    const next = report.files.find(f => f.name === file)?.url ?? report.url;
    if (tab) tab.location.href = next; else window.location.href = next;
  } catch (err) {
    tab?.close();
    throw new Error(err instanceof Error && /401|sign in/i.test(err.message)
      ? 'This report link has expired. Sign in to get a new one, or ask for the recommendation again.'
      : 'This report link has expired and a new one could not be made. Ask for the recommendation again.');
  }
}

// The PDF report of a recommendation (`report` in the compute answer), with the date its current link expires
export const ReportLink: React.FC<{ result: unknown }> = ({ result }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = (result as { report?: Report | null } | undefined)?.report;
  if (!report || typeof report.url !== 'string' || !isReportUrl(report.url)) return null;
  const href = report.url;
  const fresh = linkIsFresh(href);
  const expires = typeof report.expires_at === 'string' ? new Date(report.expires_at) : null;

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    openReport(href).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
  };

  return (
    <div className="mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <a className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1" href={href} onClick={open} aria-disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />} Download the report (PDF)
        </a>
        {fresh && expires && !Number.isNaN(expires.getTime()) && (
          <span className="small text-body-secondary">Link works until {expires.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        )}
        {!fresh && <span className="small text-body-secondary">A new link is made when you open it</span>}
      </div>
      {error && <div className="small text-danger mt-1">{error}</div>}
    </div>
  );
};
