import type { GitHubHeatmapData, RepoVillageGraph } from '@/types/village';

function drawWatermarkOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  graph: RepoVillageGraph,
  heatmap?: GitHubHeatmapData | null,
): void {
  const scale = Math.max(0.7, Math.min(1.35, width / 1440));
  const pad = Math.round(24 * scale);
  const pillH = Math.round(44 * scale);

  const host =
    typeof window !== 'undefined' && window.location.hostname && !window.location.hostname.endsWith('.test')
      ? window.location.hostname
      : 'gitvillage.on-forge.com';

  let leftText: string;
  let rightText: string;
  if (heatmap) {
    leftText = `GitVillage · @${heatmap.username}`;
    rightText = `${heatmap.totalContributions.toLocaleString()} contribs · ${heatmap.longestStreak}d streak · ${host}/u/${heatmap.username}`;
  } else {
    const repoTitle = graph.isDemo
      ? 'gitvillage/sky-village'
      : graph.isLocal
        ? `${graph.repo} (local)`
        : `${graph.owner}/${graph.repo}`;

    const commitTotal = [...graph.commitsBySha.values()].length;
    const islandTotal = graph.branches.length;
    leftText = `GitVillage · ${repoTitle}`;
    rightText = `${commitTotal} commits · ${islandTotal} island${islandTotal === 1 ? '' : 's'} · ${host}`;
  }

  ctx.save();
  ctx.font = `600 ${Math.round(14 * scale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
  const leftW = ctx.measureText(leftText).width;
  ctx.font = `500 ${Math.round(12.5 * scale)}px "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
  const rightW = ctx.measureText(rightText).width;

  const dotR = Math.round(5 * scale);
  const innerGap = Math.round(14 * scale);
  const pillW = Math.min(
    width - pad * 2,
    Math.round(leftW + rightW + innerGap * 3 + dotR * 2 + 26 * scale),
  );
  const x = width - pad - pillW;
  const y = height - pad - pillH;

  // Frosted dark graphite capsule
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, pillH, pillH / 2);
  ctx.fill();

  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.stroke();

  // Luminous emerald status dot
  const dotX = x + Math.round(18 * scale);
  const centerY = y + pillH / 2;
  ctx.fillStyle = '#34d399';
  ctx.beginPath();
  ctx.arc(dotX, centerY, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Repo title
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(14 * scale)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
  const textX = dotX + dotR + Math.round(9 * scale);
  ctx.fillText(leftText, textX, centerY + 0.5);

  // Subtle divider + URL metadata if width permits
  if (textX + leftW + innerGap + rightW < x + pillW - 10) {
    const sepX = textX + leftW + Math.round(innerGap * 0.55);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(sepX, y + pillH * 0.28);
    ctx.lineTo(sepX, y + pillH * 0.72);
    ctx.stroke();

    ctx.fillStyle = '#93c5fd';
    ctx.font = `500 ${Math.round(12.5 * scale)}px "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(rightText, sepX + Math.round(innerGap * 0.55), centerY + 0.5);
  }

  ctx.restore();
}

function sanitizeFileSlug(graph: RepoVillageGraph, heatmap?: GitHubHeatmapData | null): string {
  const raw = heatmap
    ? `heatmap-${heatmap.username}`
    : graph.isDemo
      ? 'sky-village'
      : `${graph.owner}-${graph.repo}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'gitvillage';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function capturePostcardPng(
  sourceCanvas: HTMLCanvasElement,
  graph: RepoVillageGraph,
  heatmap?: GitHubHeatmapData | null,
): Promise<string> {
  const w = Math.max(960, sourceCanvas.width);
  const h = Math.max(540, sourceCanvas.height);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  drawWatermarkOverlay(ctx, w, h, graph, heatmap);

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to encode postcard PNG.');

  const filename = `gitvillage-${sanitizeFileSlug(graph, heatmap)}-postcard.png`;
  triggerBlobDownload(blob, filename);
  return filename;
}

function pickSupportedVideoMime(): { mimeType: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return null;
}

export function isVideoCaptureSupported(): boolean {
  return pickSupportedVideoMime() !== null;
}

export async function recordVillageVideoClip(
  sourceCanvas: HTMLCanvasElement,
  graph: RepoVillageGraph,
  options: {
    durationMs: number;
    labelSuffix: string;
    heatmap?: GitHubHeatmapData | null;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ filename: string; ext: 'mp4' | 'webm' }> {
  const chosen = pickSupportedVideoMime();
  if (!chosen) {
    throw new Error('Video recording is not supported in this browser.');
  }

  // Cap recording surface cleanly to 1920x1080 preserving exact aspect ratio (even dimensions for H.264)
  const aspect = sourceCanvas.width / Math.max(1, sourceCanvas.height);
  const maxW = Math.min(1920, Math.max(960, sourceCanvas.width));
  const compW = Math.floor(maxW / 2) * 2;
  const compH = Math.max(540, Math.floor(compW / aspect / 2) * 2);

  const compCanvas = document.createElement('canvas');
  compCanvas.width = compW;
  compCanvas.height = compH;
  const ctx = compCanvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Could not initialize video compositor canvas.');
  }

  const stream = compCanvas.captureStream(60);
  const recorder = new MediaRecorder(stream, {
    mimeType: chosen.mimeType,
    videoBitsPerSecond: 8_500_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  let rafId = 0;
  let stopped = false;
  const startAt = performance.now();
  const durationMs = Math.max(1500, options.durationMs);

  const pumpFrame = () => {
    if (stopped) return;
    ctx.drawImage(sourceCanvas, 0, 0, compW, compH);
    drawWatermarkOverlay(ctx, compW, compH, graph, options.heatmap);
    const elapsed = performance.now() - startAt;
    const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
    options.onProgress?.(pct);

    if (elapsed >= durationMs) {
      stopped = true;
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      return;
    }
    rafId = window.requestAnimationFrame(pumpFrame);
  };

  const onAbort = () => {
    stopped = true;
    window.cancelAnimationFrame(rafId);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const donePromise = new Promise<{ filename: string; ext: 'mp4' | 'webm' }>((resolve, reject) => {
    recorder.onerror = () => {
      reject(new Error('Video recorder encountered an encoding error.'));
    };
    recorder.onstop = () => {
      window.cancelAnimationFrame(rafId);
      for (const track of stream.getTracks()) track.stop();

      if (options.signal?.aborted) {
        reject(new DOMException('Recording cancelled', 'AbortError'));
        return;
      }

      const blob = new Blob(chunks, { type: chosen.mimeType });
      const filename = `gitvillage-${sanitizeFileSlug(graph, options.heatmap)}-${options.labelSuffix}.${chosen.ext}`;
      triggerBlobDownload(blob, filename);
      resolve({ filename, ext: chosen.ext });
    };
  });

  recorder.start(200);
  pumpFrame();

  return donePromise;
}
