import { useState } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { sound } from '@/lib/sound';
import {
  type ContributorClanProfile,
  describeCarriedLoad,
  getAuthorColorHex,
  getCommitCargoMetrics,
  getRoleMeta,
  getVisitorStatusMeta,
  normalizeAuthorKey,
} from '@/lib/villagerMesh';
import type { InspectorSelection, RepoVillageGraph } from '@/types/village';

interface InspectorSheetProps {
  selection: InspectorSelection;
  graph: RepoVillageGraph;
  clanMap: Map<string, ContributorClanProfile>;
  followingSelected: boolean;
  onClose: () => void;
  onStepCommit: (dir: 'parent' | 'child') => void;
  onStepVisitor: (delta: -1 | 1) => void;
  onToggleFollow: () => void;
  onCelebrate: () => void;
  onLetVisitorsIn: () => void;
  onSyncLocal: () => void;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  if (!Number.isFinite(diffSec)) return '';
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
  return rtf.format(Math.round(diffSec / 31536000), 'year');
}

export function InspectorSheet({
  selection,
  graph,
  clanMap,
  followingSelected,
  onClose,
  onStepCommit,
  onStepVisitor,
  onToggleFollow,
  onCelebrate,
  onLetVisitorsIn,
  onSyncLocal,
}: InspectorSheetProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!selection) {
    return <aside id="inspector-card" className="apple-sheet inspector-card" hidden />;
  }

  const copyText = (value: string, key: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    sound.playPop(660);
    setCopiedId(key);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === key ? null : cur));
    }, 1100);
  };

  if (selection.kind === 'visitor') {
    const f = selection.visitor;
    const meta = getVisitorStatusMeta(f.status);
    const add = f.additions;
    const del = f.deletions;
    const total = Math.max(1, add + del);
    const copyKey = `v:${f.filename}`;

    return (
      <aside
        id="inspector-card"
        className="apple-sheet inspector-card"
        aria-label="Selected File Visitor Metadata"
      >
        <div className="inspector-top">
          <div className="role-chip-row">
            <span id="ins-role-badge" className="meta-pill">
              {meta.label}
            </span>
            <span
              id="ins-branch-badge"
              className="meta-pill meta-pill-branch"
              style={
                f.staged
                  ? {
                      color: '#30d158',
                      background: 'rgba(48, 209, 88, 0.16)',
                    }
                  : undefined
              }
            >
              {f.staged ? 'Staged · git add' : 'Unstaged change'}
            </span>
          </div>
          <button
            type="button"
            id="ins-close-btn"
            className="circle-close-btn"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <SfIcon name="sf-close" size={12} />
          </button>
        </div>

        <h2 id="ins-subject" className="ins-subject">
          {f.filename.split('/').pop() || f.filename}
        </h2>
        <p id="ins-quirk" className="ins-quirk">
          {f.filename} · Visitor {selection.index + 1} of {selection.totalVisitors} outside{' '}
          {graph.defaultBranch}
        </p>

        <div id="ins-author-row" className="inset-group ins-author-row">
          <div
            id="ins-avatar"
            className="ins-avatar"
            aria-hidden="true"
            style={{ background: `#${meta.color.toString(16).padStart(6, '0')}` }}
          >
            <SfIcon name="sf-gate" size={16} />
          </div>
          <div className="ins-author-meta">
            <strong id="ins-author-name">
              {f.staged ? 'Ready at front of Gate' : 'Queued on Sky-Dock Pier'}
            </strong>
            <span id="ins-timestamp">
              {f.staged
                ? 'Enters village on next git commit'
                : 'Stage with git add and commit to admit'}
            </span>
          </div>
          <div className="ins-sha-group">
            <button
              type="button"
              id="ins-sha-copy"
              className="sha-pill"
              title="Copy file path"
              onClick={() => copyText(f.filename, copyKey)}
            >
              <span id="ins-sha-text">{copiedId === copyKey ? 'Copied' : 'Copy path'}</span>
              <SfIcon name="sf-copy" size={12} />
            </button>
          </div>
        </div>

        <div className="ins-actions-bar">
          <button
            type="button"
            id="ins-prev-btn"
            className="sheet-btn"
            disabled={selection.index <= 0}
            onClick={() => onStepVisitor(-1)}
          >
            <SfIcon name="sf-arrow-left" size={13} />
            <span>Prev</span>
          </button>
          <button
            type="button"
            id="ins-follow-btn"
            className="sheet-btn sheet-btn-tinted"
            onClick={onLetVisitorsIn}
          >
            <SfIcon name="sf-gate" size={13} />
            <span>Let In</span>
          </button>
          <button type="button" id="ins-cheer-btn" className="sheet-btn" onClick={onSyncLocal}>
            <SfIcon name="sf-refresh" size={13} />
            <span>Sync</span>
          </button>
          <button
            type="button"
            id="ins-next-btn"
            className="sheet-btn"
            disabled={selection.index >= selection.totalVisitors - 1}
            onClick={() => onStepVisitor(1)}
          >
            <span>Next</span>
            <SfIcon name="sf-arrow-right" size={13} />
          </button>
        </div>

        <div className="inset-group ins-diff-card">
          <div className="diff-header-row">
            <span className="diff-label">Line Impact</span>
            <span id="ins-diff-text" className="diff-counts">
              +{add} / −{del}
            </span>
          </div>
          <div className="diff-meter" aria-hidden="true">
            <div
              id="ins-diff-add-bar"
              className="diff-add-bar"
              style={{ width: `${Math.round((add / total) * 100)}%` }}
            />
            <div
              id="ins-diff-del-bar"
              className="diff-del-bar"
              style={{ width: `${Math.round((del / total) * 100)}%` }}
            />
          </div>

          <details id="ins-files-details" className="apple-disclosure files-details" open={Boolean(f.diffPreview)}>
            <summary>
              <SfIcon name="sf-chevron-right" size={13} className="disclosure-chevron" />
              <span id="ins-files-summary">
                {f.diffPreview ? 'Working-tree diff preview' : 'Working-tree file change'}
              </span>
            </summary>
            {f.diffPreview && (
              <pre id="ins-diff-preview" className="diff-preview-pre">
                {f.diffPreview}
              </pre>
            )}
          </details>
        </div>
      </aside>
    );
  }

  const commit = selection.commit;
  const role = getRoleMeta(commit.kind);
  const cargoMeta = getCommitCargoMetrics(commit);
  const clan = clanMap.get(normalizeAuthorKey(commit));
  const bgHex =
    clan?.colorCss ?? `#${getAuthorColorHex(commit.authorLogin).toString(16).padStart(6, '0')}`;
  const avatarSrc =
    commit.authorAvatar &&
    commit.authorAvatar.includes('githubusercontent.com') &&
    !commit.authorAvatar.includes('s=')
      ? `${commit.authorAvatar}${commit.authorAvatar.includes('?') ? '&' : '?'}s=72`
      : commit.authorAvatar;

  const add = commit.stats?.additions ?? cargoMeta.additions;
  const del = commit.stats?.deletions ?? cargoMeta.deletions;
  const total = Math.max(1, add + del);
  const files = commit.files ?? [];
  const copyKey = `c:${commit.sha}`;

  return (
    <aside
      id="inspector-card"
      className="apple-sheet inspector-card"
      aria-label="Selected Commit Metadata"
    >
      <div className="inspector-top">
        <div className="role-chip-row">
          <span id="ins-role-badge" className="meta-pill">
            {role.badge}
          </span>
          <span id="ins-branch-badge" className="meta-pill meta-pill-branch">
            {commit.branch}
          </span>
        </div>
        <button
          type="button"
          id="ins-close-btn"
          className="circle-close-btn"
          aria-label="Close inspector"
          onClick={onClose}
        >
          <SfIcon name="sf-close" size={12} />
        </button>
      </div>

      <h2 id="ins-subject" className="ins-subject">
        {commit.subject}
      </h2>
      <p id="ins-quirk" className="ins-quirk">
        {role.title} · {describeCarriedLoad(cargoMeta.filesCount, cargoMeta.totalLines)}
      </p>

      <div id="ins-author-row" className="inset-group ins-author-row">
        <div
          id="ins-avatar"
          className="ins-avatar"
          aria-hidden="true"
          style={{ background: bgHex }}
        >
          {avatarSrc ? (
            <img src={avatarSrc} width={34} height={34} decoding="async" alt={commit.authorName} />
          ) : (
            clan?.initials ?? commit.authorName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="ins-author-meta">
          <strong id="ins-author-name">
            {clan ? `${commit.authorName} · ${clan.emblem} ${clan.initials}` : commit.authorName}
          </strong>
          <span id="ins-timestamp">
            {clan
              ? `${clan.earLabel} (${clan.commitCount} in village) · ${formatRelativeTime(commit.timestamp)}`
              : `${formatRelativeTime(commit.timestamp)} · ${new Date(commit.timestamp).toLocaleDateString()}`}
          </span>
        </div>
        <div className="ins-sha-group">
          <button
            type="button"
            id="ins-sha-copy"
            className="sha-pill"
            title="Copy commit SHA"
            onClick={() => copyText(commit.sha, copyKey)}
          >
            <span id="ins-sha-text">{copiedId === copyKey ? 'Copied' : commit.shortSha}</span>
            <SfIcon name="sf-copy" size={12} />
          </button>
          {commit.htmlUrl && (
            <a
              id="ins-gh-link"
              className="gh-ext-link"
              href={commit.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>GitHub</span>
              <SfIcon name="sf-arrow-up-right" size={11} />
            </a>
          )}
        </div>
      </div>

      {commit.body && (
        <p id="ins-body" className="ins-body">
          {commit.body}
        </p>
      )}

      <div className="ins-actions-bar">
        <button
          type="button"
          id="ins-prev-btn"
          className="sheet-btn"
          disabled={!selection.hasParent}
          onClick={() => onStepCommit('parent')}
        >
          <SfIcon name="sf-arrow-left" size={13} />
          <span>Parent</span>
        </button>
        <button
          type="button"
          id="ins-follow-btn"
          className={`sheet-btn sheet-btn-tinted${followingSelected ? ' is-active' : ''}`}
          onClick={onToggleFollow}
        >
          <SfIcon name="sf-viewfinder" size={13} />
          <span>Follow</span>
        </button>
        <button type="button" id="ins-cheer-btn" className="sheet-btn" onClick={onCelebrate}>
          <SfIcon name="sf-sparkles" size={13} />
          <span>Celebrate</span>
        </button>
        <button
          type="button"
          id="ins-next-btn"
          className="sheet-btn"
          disabled={!selection.hasChild}
          onClick={() => onStepCommit('child')}
        >
          <span>Child</span>
          <SfIcon name="sf-arrow-right" size={13} />
        </button>
      </div>

      <div className="inset-group ins-diff-card">
        <div className="diff-header-row">
          <span className="diff-label">Line Impact</span>
          <span id="ins-diff-text" className="diff-counts">
            {selection.isHydratingDiff ? 'Loading diff…' : `+${add} / −${del}`}
          </span>
        </div>
        <div className="diff-meter" aria-hidden="true">
          <div
            id="ins-diff-add-bar"
            className="diff-add-bar"
            style={{ width: `${Math.round((add / total) * 100)}%` }}
          />
          <div
            id="ins-diff-del-bar"
            className="diff-del-bar"
            style={{ width: `${Math.round((del / total) * 100)}%` }}
          />
        </div>

        <details id="ins-files-details" className="apple-disclosure files-details">
          <summary>
            <SfIcon name="sf-chevron-right" size={13} className="disclosure-chevron" />
            <span id="ins-files-summary">Changed files ({files.length})</span>
          </summary>
          <ul id="ins-files-list" className="files-list">
            {files.map((file) => (
              <li key={file.filename}>
                <span className="file-path" title={file.filename}>
                  {file.filename}
                </span>
                <span className="file-delta">
                  <span className="delta-add">+{file.additions} </span>
                  <span className="delta-del">−{file.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}
