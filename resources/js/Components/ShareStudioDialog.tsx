import { useState, type RefObject } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import { describeRepoForAnalytics, trackEvent } from '@/lib/analytics';
import { isVideoCaptureSupported } from '@/lib/captureStudio';
import { sound } from '@/lib/sound';
import { closeTopLayerDialog, useLightDismissDialog } from '@/lib/topLayer';
import type { GitHubHeatmapData, HeatmapTheme, RepoVillageGraph } from '@/types/village';

interface ShareStudioDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  graph: RepoVillageGraph;
  heatmap?: GitHubHeatmapData | null;
  heatmapTheme?: HeatmapTheme;
  isRecording: boolean;
  recordingProgress: number;
  recordingLabel: string;
  onSnapPostcard: () => void;
  onRecordTurntable: () => void;
  onRecordTimeLapse: () => void;
  onCancelRecording: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export function ShareStudioDialog({
  dialogRef,
  graph,
  heatmap,
  heatmapTheme = 'emerald',
  isRecording,
  recordingProgress,
  recordingLabel,
  onSnapPostcard,
  onRecordTurntable,
  onRecordTimeLapse,
  onCancelRecording,
  onToast,
}: ShareStudioDialogProps) {
  useLightDismissDialog(dialogRef);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://gitvillage.on-forge.com';
  const publicBase =
    typeof window !== 'undefined' && !window.location.hostname.endsWith('.test')
      ? window.location.origin
      : 'https://gitvillage.on-forge.com';

  const badgeSlug =
    !graph.isDemo && !graph.isLocal && graph.owner && graph.repo
      ? `${graph.owner}/${graph.repo}`
      : 'OniiCoder/gitvillage';

  const shareUrlObj = new URL(origin);
  if (heatmap) {
    shareUrlObj.pathname = `/u/${heatmap.username}`;
    if (heatmap.year) {
      shareUrlObj.searchParams.set('year', String(heatmap.year));
    }
    if (heatmapTheme && heatmapTheme !== 'emerald') {
      shareUrlObj.searchParams.set('theme', heatmapTheme);
    }
  } else {
    if (!graph.isDemo && !graph.isLocal && graph.owner && graph.repo) {
      shareUrlObj.pathname = `/gh/${graph.owner}/${graph.repo}`;
    }
    if (!graph.isLocal && graph.currentBranch && graph.currentBranch !== graph.defaultBranch) {
      shareUrlObj.searchParams.set('branch', graph.currentBranch);
    }
  }
  const shareUrl = shareUrlObj.toString();

  const publicVillageUrl = `${publicBase}/gh/${badgeSlug}`;
  const localBadgePreviewUrl = `/badge/${badgeSlug}.svg`;
  const publicBadgeUrl = `${publicBase}/badge/${badgeSlug}.svg`;

  const markdownBadge = `[![Explore in GitVillage](${publicBadgeUrl})](${publicVillageUrl})`;
  const htmlBadge = `<a href="${publicVillageUrl}"><img src="${publicBadgeUrl}" alt="Explore ${badgeSlug} in 3D on GitVillage" height="28"></a>`;

  const tweetText = encodeURIComponent(
    heatmap
      ? `My GitHub contribution heatmap as a living 3D floating-island skyline in GitVillage 🏝️🟩 — ${heatmap.totalContributions.toLocaleString()} contributions & a ${heatmap.longestStreak}-day streak!`
      : !graph.isDemo && !graph.isLocal
        ? `Exploring ${graph.owner}/${graph.repo} as a living 3D floating-island world in GitVillage 🏝️`
        : 'Turn any Git repository into a living 3D floating-island world with GitVillage 🏝️',
  );
  const xIntentUrl = `https://x.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(shareUrl)}`;
  const linkedInIntentUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const copyWithFeedback = async (value: string, key: string, toastMsg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      sound.playPop(660);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      onToast(toastMsg);
    } catch {
      onToast('Clipboard access unavailable', true);
    }
  };

  const canRecordVideo = typeof window !== 'undefined' && isVideoCaptureSupported();

  return (
    <dialog
      ref={dialogRef}
      id="share-studio-dialog"
      className="apple-sheet share-studio-dialog"
      aria-labelledby="share-studio-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h2 id="share-studio-title" className="dialog-title">
            Share &amp; Capture Studio
          </h2>
          <span className="section-caption">
            Export postcards, 6s turntable clips, or embed a 3D badge in your README
          </span>
        </div>
        <button
          type="button"
          id="share-studio-close-btn"
          className="circle-close-btn"
          aria-label="Close Share Studio"
          onClick={() => void closeTopLayerDialog(dialogRef.current)}
        >
          <SfIcon name="sf-close" size={12} />
        </button>
      </div>

      {/* 1. Direct Share Link + Social Intents */}
      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>{heatmap ? `Share @${heatmap.username}'s 3D Skyline` : 'Shareable Village Link'}</h3>
          <span className="section-caption">
            {heatmap
              ? 'Includes live 1200×630 isometric 3D skyline OpenGraph card'
              : 'Includes rich 1200×630 OpenGraph preview card'}
          </span>
        </div>
        <div className="share-url-row">
          <input
            type="text"
            readOnly
            value={shareUrl}
            aria-label="Shareable village URL"
            className="share-url-input"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            id="share-copy-url-btn"
            className="apple-primary-btn"
            onClick={() => {
              if (heatmap) {
                trackEvent('heatmap_shared', { channel: 'copy_link', theme: heatmapTheme });
              } else {
                trackEvent('village_shared', {
                  ...describeRepoForAnalytics(graph),
                  branch: graph.currentBranch ?? graph.defaultBranch,
                });
              }
              void copyWithFeedback(shareUrl, 'url', 'Shareable link copied to clipboard');
            }}
          >
            {copiedKey === 'url' ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
        <div className="share-social-pills">
          <a
            href={xIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sheet-btn"
          >
            <span>Post on X</span>
            <SfIcon name="sf-arrow-up-right" size={11} />
          </a>
          <a
            href={linkedInIntentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sheet-btn"
          >
            <span>Share on LinkedIn</span>
            <SfIcon name="sf-arrow-up-right" size={11} />
          </a>
        </div>
      </div>

      {/* 2. Postcard & 6-Second Turntable / Time-Lapse Recorder */}
      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>Capture Postcard &amp; Video</h3>
          <span className="section-caption">Auto-watermarked with repository &amp; island stats</span>
        </div>

        {isRecording ? (
          <div className="inset-group capture-progress-box">
            <div className="capture-progress-head">
              <strong id="capture-progress-label">{recordingLabel}</strong>
              <span className="capture-progress-pct">{recordingProgress}%</span>
            </div>
            <progress
              className="gv-progress"
              aria-labelledby="capture-progress-label"
              value={recordingProgress}
              max={100}
            />
            <div className="capture-progress-foot">
              <span>Keep this tab visible while frames stream from WebGL…</span>
              <button type="button" className="sheet-btn" onClick={onCancelRecording}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="capture-cards-grid">
            <button
              type="button"
              id="snap-postcard-btn"
              className="preset-card capture-action-card"
              onClick={onSnapPostcard}
            >
              <div className="capture-card-top">
                <span className="capture-icon-badge badge-blue">
                  <SfIcon name="sf-camera" size={15} />
                </span>
                <strong>Snap 3D Postcard (PNG)</strong>
              </div>
              <span>Instant retina screenshot with corner village badge</span>
            </button>

            <button
              type="button"
              id="record-turntable-btn"
              className="preset-card capture-action-card"
              disabled={!canRecordVideo}
              onClick={onRecordTurntable}
            >
              <div className="capture-card-top">
                <span className="capture-icon-badge badge-emerald">
                  <SfIcon name="sf-video" size={15} />
                </span>
                <strong>Record 6s Turntable Clip</strong>
              </div>
              <span>Sweeping 60fps orbit video ready for X, LinkedIn &amp; Slack</span>
            </button>

            <button
              type="button"
              id="record-timelapse-btn"
              className="preset-card capture-action-card"
              disabled={!canRecordVideo}
              onClick={onRecordTimeLapse}
            >
              <div className="capture-card-top">
                <span className="capture-icon-badge badge-amber">
                  <SfIcon name="sf-play" size={14} />
                </span>
                <strong>
                  {heatmap ? 'Record 6s Wave + Orbit' : 'Record Time-Lapse Growth'}
                </strong>
              </div>
              <span>
                {heatmap
                  ? 'Watch all 53 weeks erupt upward in 3D while orbiting the island'
                  : 'Watch every island & commit pop into existence on video'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Embeddable GitHub README.md Mini-Skyline Badge */}
      <div className="sheet-section">
        <div className="section-heading-row">
          <h3>GitHub README.md Badge</h3>
          <span className="section-caption">
            {graph.isDemo || graph.isLocal
              ? 'Previewing OniiCoder/gitvillage — load any GitHub repo to customize'
              : `Live badge for ${badgeSlug}`}
          </span>
        </div>

        <div className="inset-group badge-studio-box">
          <div className="badge-preview-stage">
            <img
              src={localBadgePreviewUrl}
              alt={`Explore ${badgeSlug} in 3D on GitVillage`}
              width={310}
              height={28}
              loading="lazy"
            />
          </div>
          <pre
            className="badge-code-snippet"
            role="region"
            aria-label="Markdown README badge snippet"
            tabIndex={0}
          >
            <code>{markdownBadge}</code>
          </pre>
          <div className="badge-copy-actions">
            <button
              type="button"
              id="copy-badge-md-btn"
              className="sheet-btn sheet-btn-tinted"
              onClick={() => {
                trackEvent('readme_badge_copied', { format: 'markdown', repo_slug: badgeSlug });
                void copyWithFeedback(
                  markdownBadge,
                  'md',
                  'README Markdown badge copied to clipboard',
                );
              }}
            >
              <SfIcon name="sf-copy" size={12} />
              <span>{copiedKey === 'md' ? 'Copied Markdown!' : 'Copy Markdown'}</span>
            </button>
            <button
              type="button"
              id="copy-badge-html-btn"
              className="sheet-btn"
              onClick={() => {
                trackEvent('readme_badge_copied', { format: 'html', repo_slug: badgeSlug });
                void copyWithFeedback(htmlBadge, 'html', 'HTML badge snippet copied to clipboard');
              }}
            >
              <SfIcon name="sf-code" size={12} />
              <span>{copiedKey === 'html' ? 'Copied HTML!' : 'Copy HTML'}</span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
