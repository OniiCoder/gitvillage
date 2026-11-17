import { useRef } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { closeTopLayerDialog, useLightDismissDialog } from '@/lib/topLayer';

export function FieldGuideDialog() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useLightDismissDialog(dialogRef);

  return (
    <dialog
      ref={dialogRef}
      id="help-dialog"
      className="apple-sheet guide-dialog"
      aria-labelledby="help-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h2 id="help-title" className="dialog-title">
            Git Archipelago Field Guide
          </h2>
          <span className="section-caption">
            Every commit lives as an autonomous citizen on its branch island
          </span>
        </div>
        <button
          type="button"
          id="help-close-btn"
          className="circle-close-btn"
          aria-label="Close guide"
          onClick={() => void closeTopLayerDialog(dialogRef.current)}
        >
          <SfIcon name="sf-close" size={12} />
        </button>
      </div>

      <div className="guide-grid">
        <div className="inset-group guide-item">
          <div className="guide-item-head">
            <span className="status-dot dot-amber" aria-hidden="true" />
            <strong>Master Builders (feat)</strong>
          </div>
          <span>
            Wear hard-hats, carry crystal hammers, and haul stacked cargo proportional to changed
            files and lines.
          </span>
        </div>
        <div className="inset-group guide-item">
          <div className="guide-item-head">
            <span className="status-dot dot-red" aria-hidden="true" />
            <strong>Bug Catchers (fix)</strong>
          </div>
          <span>Wear pith helmets and swing nets to keep their branch island pest-free.</span>
        </div>
        <div className="inset-group guide-item">
          <div className="guide-item-head">
            <span className="status-dot dot-purple" aria-hidden="true" />
            <strong>Contributor Clans</strong>
          </div>
          <span>
            Commits by the same author share clan colors, ear silhouettes, scarves, and crest
            standards so collaborators are recognizable at a glance.
          </span>
        </div>
        <div className="inset-group guide-item">
          <div className="guide-item-head">
            <span className="status-dot dot-green" aria-hidden="true" />
            <strong>Gate Visitors (local changes)</strong>
          </div>
          <span>
            In local repos, each uncommitted file waits outside the Village Gate—staged files hold
            a Golden Ticket.
          </span>
        </div>
      </div>

      <div className="inset-group guide-controls">
        <p>
          <strong>Navigation:</strong> Drag to orbit · Right-drag to pan · Scroll to zoom · Click
          any citizen or waiting file to inspect metadata · Toggle <strong>Walk</strong> to explore
          on foot with <kbd>WASD</kbd> and <kbd>Space</kbd>.
        </p>
      </div>

      <div className="dialog-footer">
        <button
          type="button"
          id="help-gotit-btn"
          className="apple-primary-btn"
          autoFocus
          onClick={() => void closeTopLayerDialog(dialogRef.current)}
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
