import { useEffect, useRef } from 'react';

import type { DataAuditEntry, DataHealthIssue, ParseHealth } from './domain';

interface DataHealthDialogProps {
  open: boolean;
  health: ParseHealth | null;
  audit: DataAuditEntry[];
  excludeOutliers: boolean;
  onClose: () => void;
  onCorrect: (issue: DataHealthIssue) => void;
  onIgnore: (issue: DataHealthIssue) => void;
}

function correctionLabel(issue: DataHealthIssue, excludeOutliers: boolean): string | null {
  if (issue.correction === 'treat-as-date') return `Treat ${issue.columns[0]} as a date`;
  if (issue.correction === 'include-outliers' && excludeOutliers) return 'Include outliers in KPIs';
  return null;
}

export default function DataHealthDialog({
  open,
  health,
  audit,
  excludeOutliers,
  onClose,
  onCorrect,
  onIgnore,
}: DataHealthDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  if (!health) return null;
  return (
    <dialog id="data-health-dialog" className="mise-dialog" ref={dialogRef} aria-labelledby="data-health-title" onClose={onClose}>
      <div className="dialog-head">
        <div><div className="eyebrow eyebrow-accent">Data health</div><h2 id="data-health-title">What Mise kept, flagged, and ignored</h2></div>
        <button className="dialog-close" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <div className="dialog-body">
        <p className="dialog-copy">Warnings are deterministic and local. Mise only offers a correction when the data alone cannot establish your intent.</p>
        <div id="health-issues" className="health-issues">
          {health.issues.length === 0 && <div className="health-clean"><strong>No health warnings</strong><span>All rows have a consistent shape and the inferred schema is stable.</span></div>}
          {health.issues.map(issue => {
            const correction = correctionLabel(issue, excludeOutliers);
            return (
              <article className={`health-issue ${issue.severity}`} key={issue.id}>
                <div className="health-issue-main">
                  <span className="health-count">{issue.count}</span>
                  <div><h3>{issue.title}</h3><p>{issue.detail}</p></div>
                </div>
                <div className="health-actions">
                  {correction && <button type="button" className="btn btn-primary" onClick={() => onCorrect(issue)}>{correction}</button>}
                  <button type="button" className="btn btn-ghost" onClick={() => onIgnore(issue)}>Acknowledge</button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="health-audit">
          <div className="eyebrow">Local audit trail</div>
          {audit.length === 0
            ? <p>No parser decisions or user overrides recorded.</p>
            : <ol>{audit.map((entry, index) => <li key={`${entry.at || 0}-${index}`}><strong>{entry.action.replaceAll('-', ' ')}</strong><span>{entry.detail}</span>{entry.at && <time>{new Date(entry.at).toLocaleString()}</time>}</li>)}</ol>}
        </div>
      </div>
    </dialog>
  );
}
