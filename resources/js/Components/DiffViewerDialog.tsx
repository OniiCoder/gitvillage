import { useState, type RefObject } from 'react';
import { DiffCodeBlock } from '@/Components/DiffCodeBlock';
import { SfIcon } from '@/Components/SfIconSprite';
import { sound } from '@/lib/sound';
import { closeTopLayerDialog, useLightDismissDialog } from '@/lib/topLayer';
import type { CommitFileChange } from '@/types/village';

export interface DiffModalPayload {
  title: string;
  subtitle: string;
  badge?: string;
  files: CommitFileChange[];
  initialFilename?: string;
  isHydrating?: boolean;
  canResolveConflict?: boolean;
}

interface DiffViewerDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  payload: DiffModalPayload | null;
  selectedFilename: string | null;
  onSelectFilename: (filename: string | null) => void;
  onResolveConflict?: () => void;
}

export function getFileStatusBadge(status: CommitFileChange['status']): {
  short: string;
  label: string;
  className: string;
} {
  switch (status) {
    case 'conflicted':
      return { short: '!', label: 'Merge Conflict', className: 'file-status-conflicted' };
    case 'added':
      return { short: 'A', label: 'Added', className: 'file-status-added' };
    case 'removed':
      return { short: 'D', label: 'Deleted', className: 'file-status-removed' };
    case 'renamed':
      return { short: 'R', label: 'Renamed', className: 'file-status-renamed' };
    default:
      return { short: 'M', label: 'Modified', className: 'file-status-modified' };
  }
}

function ConflictSidePane({
  side,
  branchLabel,
  content,
  copiedKey,
  onCopy,
}: {
  side: 'ours' | 'theirs';
  branchLabel: string;
  content: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const copyId = `conflict-${side}:${branchLabel}`;

  return (
    <section
      className={`conflict-side-pane is-${side}`}
      aria-label={`${side === 'ours' ? 'Ours' : 'Theirs'} (${branchLabel}) version`}
    >
      <div className="conflict-side-header">
        <div className="conflict-side-heading">
          <span className={`conflict-side-tag is-${side}`}>
            {side === 'ours' ? 'Ours · Current' : 'Theirs · Incoming'}
          </span>
          <code className="conflict-side-branch">{branchLabel}</code>
        </div>
        <button
          type="button"
          className="sha-pill"
          onClick={() => onCopy(content, copyId)}
        >
          <span>{copiedKey === copyId ? 'Copied' : 'Copy'}</span>
          <SfIcon name="sf-copy" size={11} />
        </button>
      </div>
      <div className="diff-code-scroll conflict-pane-scroll">
        <div className="diff-code-lines">
          {lines.map((line, idx) => {
            const isSectionHeader = line.startsWith('// Conflict #') || line.startsWith('// Line ');
            return (
              <div
                key={idx}
                className={`diff-row conflict-code-row ${isSectionHeader ? 'diff-row-hunk' : `is-${side}`}`}
              >
                <span className="diff-gutter" aria-hidden="true">
                  {isSectionHeader ? '@@' : idx + 1}
                </span>
                <code className="diff-code-text">{line || '\u00a0'}</code>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function DiffViewerDialog({
  dialogRef,
  payload,
  selectedFilename,
  onSelectFilename,
  onResolveConflict,
}: DiffViewerDialogProps) {
  useLightDismissDialog(dialogRef);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [conflictViewMode, setConflictViewMode] = useState<'split' | 'inline'>('split');

  const files = payload?.files ?? [];
  const totalAdd = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = files.reduce((sum, f) => sum + f.deletions, 0);

  const activeFile =
    selectedFilename === '__all__'
      ? null
      : (files.find((f) => f.filename === selectedFilename) ?? files[0] ?? null);

  const copyPatch = (text: string | undefined, key: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    sound.playPop(660);
    setCopiedFile(key);
    window.setTimeout(() => {
      setCopiedFile((cur) => (cur === key ? null : cur));
    }, 1200);
  };

  return (
    <dialog
      ref={dialogRef}
      id="diff-viewer-dialog"
      className="apple-sheet diff-viewer-dialog"
      aria-labelledby="diff-viewer-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="diff-dialog-header">
        <div className="diff-dialog-heading">
          <div className="diff-dialog-title-row">
            <span className="diff-dialog-glyph" aria-hidden="true">
              <SfIcon name="sf-code" size={15} />
            </span>
            <h2 id="diff-viewer-title" className="dialog-title">
              {payload?.title ?? 'Commit Diff'}
            </h2>
            {payload?.badge && <span className="meta-pill meta-pill-branch">{payload.badge}</span>}
          </div>
          <span className="section-caption">
            {payload?.subtitle} · {files.length} {files.length === 1 ? 'file' : 'files'} changed (
            <span className="delta-add">+{totalAdd}</span> /{' '}
            <span className="delta-del">−{totalDel}</span>)
          </span>
        </div>

        <div className="diff-dialog-header-actions">
          {payload?.canResolveConflict && onResolveConflict && (
            <button
              type="button"
              id="diff-resolve-conflict-btn"
              className="conflict-resolve-cta"
              onClick={() => {
                onResolveConflict();
                void closeTopLayerDialog(dialogRef.current);
              }}
            >
              <span aria-hidden="true">🤝</span>
              <span>Resolve &amp; Repair Bridge</span>
            </button>
          )}
          <button
            type="button"
            id="diff-viewer-close-btn"
            className="circle-close-btn"
            aria-label="Close diff viewer"
            autoFocus
            onClick={() => void closeTopLayerDialog(dialogRef.current)}
          >
            <SfIcon name="sf-close" size={12} />
          </button>
        </div>
      </div>

      <div className="diff-dialog-body">
        {files.length > 1 && (
          <div className="diff-sidebar" aria-label="Changed files navigation">
            <button
              type="button"
              className={`diff-sidebar-item diff-sidebar-all${selectedFilename === '__all__' ? ' is-selected' : ''}`}
              aria-current={selectedFilename === '__all__' ? 'true' : undefined}
              onClick={() => {
                sound.playPop(540);
                onSelectFilename('__all__');
              }}
            >
              <span className="diff-sidebar-name">All changed files ({files.length})</span>
              <span className="file-delta">
                <span className="delta-add">+{totalAdd}</span>{' '}
                <span className="delta-del">−{totalDel}</span>
              </span>
            </button>

            <div className="diff-sidebar-list">
              {files.map((file) => {
                const badge = getFileStatusBadge(file.status);
                const isSelected = selectedFilename !== '__all__' && activeFile?.filename === file.filename;
                const slashIdx = file.filename.lastIndexOf('/');
                const base = slashIdx >= 0 ? file.filename.slice(slashIdx + 1) : file.filename;
                const dir = slashIdx >= 0 ? file.filename.slice(0, slashIdx) : '';

                return (
                  <button
                    key={file.filename}
                    type="button"
                    className={`diff-sidebar-item${isSelected ? ' is-selected' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => {
                      sound.playPop(580);
                      onSelectFilename(file.filename);
                    }}
                  >
                    <span className={`file-status-pill ${badge.className}`} title={badge.label}>
                      {badge.short}
                    </span>
                    <span className="diff-sidebar-path-col">
                      <span className="diff-sidebar-name" title={file.filename}>
                        {base}
                      </span>
                      {dir && <span className="diff-sidebar-dir">{dir}</span>}
                    </span>
                    <span className="file-delta">
                      <span className="delta-add">+{file.additions}</span>{' '}
                      <span className="delta-del">−{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="diff-main-pane">
          {selectedFilename === '__all__' ? (
            <div className="diff-stacked-files">
              {files.map((file) => {
                const badge = getFileStatusBadge(file.status);
                return (
                  <div key={file.filename} className="diff-file-card">
                    <div className="diff-file-card-header">
                      <div className="diff-file-card-title">
                        <span className={`file-status-pill ${badge.className}`} title={badge.label}>
                          {badge.short}
                        </span>
                        <span className="diff-file-fullpath">
                          {file.previousFilename
                            ? `${file.previousFilename} → ${file.filename}`
                            : file.filename}
                        </span>
                      </div>
                      <div className="diff-file-card-actions">
                        <span className="file-delta">
                          <span className="delta-add">+{file.additions}</span>{' '}
                          <span className="delta-del">−{file.deletions}</span>
                        </span>
                        {file.patch && (
                          <button
                            type="button"
                            className="sha-pill"
                            onClick={() => copyPatch(file.patch, file.filename)}
                          >
                            <span>{copiedFile === file.filename ? 'Copied' : 'Copy diff'}</span>
                            <SfIcon name="sf-copy" size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <DiffCodeBlock
                      patch={file.patch}
                      isLoading={Boolean(payload?.isHydrating && file.patch === undefined)}
                      emptyMessage={
                        file.additions === 0 && file.deletions === 0
                          ? 'No line changes in this file'
                          : 'Binary file or diff omitted'
                      }
                    />
                  </div>
                );
              })}
            </div>
          ) : activeFile ? (
            <div className="diff-file-card diff-file-card-single">
              <div className="diff-file-card-header">
                <div className="diff-file-card-title">
                  <span
                    className={`file-status-pill ${getFileStatusBadge(activeFile.status).className}`}
                    title={getFileStatusBadge(activeFile.status).label}
                  >
                    {getFileStatusBadge(activeFile.status).short}
                  </span>
                  <span className="diff-file-fullpath">
                    {activeFile.previousFilename
                      ? `${activeFile.previousFilename} → ${activeFile.filename}`
                      : activeFile.filename}
                  </span>
                </div>
                <div className="diff-file-card-actions">
                  {activeFile.conflict && (
                    <div
                      className="segmented-control conflict-mode-switch"
                      role="group"
                      aria-label="Conflict view layout"
                    >
                      <button
                        type="button"
                        id="conflict-split-mode-btn"
                        className="seg-btn"
                        aria-pressed={conflictViewMode === 'split'}
                        onClick={() => {
                          sound.playPop(560);
                          setConflictViewMode('split');
                        }}
                      >
                        Ours vs Theirs
                      </button>
                      <button
                        type="button"
                        id="conflict-inline-mode-btn"
                        className="seg-btn"
                        aria-pressed={conflictViewMode === 'inline'}
                        onClick={() => {
                          sound.playPop(520);
                          setConflictViewMode('inline');
                        }}
                      >
                        Inline Markers
                      </button>
                    </div>
                  )}
                  <span className="file-delta">
                    <span className="delta-add">+{activeFile.additions}</span>{' '}
                    <span className="delta-del">−{activeFile.deletions}</span>
                  </span>
                  {activeFile.patch && (
                    <button
                      type="button"
                      className="sha-pill"
                      onClick={() => copyPatch(activeFile.patch, activeFile.filename)}
                    >
                      <span>{copiedFile === activeFile.filename ? 'Copied' : 'Copy diff'}</span>
                      <SfIcon name="sf-copy" size={11} />
                    </button>
                  )}
                </div>
              </div>
              {activeFile.conflict && conflictViewMode === 'split' ? (
                <div id="conflict-split-grid" className="conflict-split-grid">
                  <ConflictSidePane
                    side="ours"
                    branchLabel={activeFile.conflict.oursLabel}
                    content={activeFile.conflict.oursContent}
                    copiedKey={copiedFile}
                    onCopy={copyPatch}
                  />
                  <ConflictSidePane
                    side="theirs"
                    branchLabel={activeFile.conflict.theirsLabel}
                    content={activeFile.conflict.theirsContent}
                    copiedKey={copiedFile}
                    onCopy={copyPatch}
                  />
                </div>
              ) : (
                <DiffCodeBlock
                  patch={activeFile.patch}
                  isLoading={Boolean(payload?.isHydrating && activeFile.patch === undefined)}
                  emptyMessage={
                    activeFile.additions === 0 && activeFile.deletions === 0
                      ? 'No line changes in this file'
                      : 'Binary file or diff omitted'
                  }
                />
              )}
            </div>
          ) : (
            <div className="diff-empty-notice">No changed files recorded for this commit.</div>
          )}
        </div>
      </div>
    </dialog>
  );
}
