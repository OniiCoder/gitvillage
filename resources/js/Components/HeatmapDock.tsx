import { SfIcon } from '@/Components/SfIconSprite';
import { isVideoCaptureSupported } from '@/lib/captureStudio';
import type { GitHubHeatmapData, HeatmapTheme } from '@/types/village';

interface HeatmapDockProps {
  heatmap: GitHubHeatmapData;
  theme: HeatmapTheme;
  isRecording: boolean;
  onSelectTheme: (theme: HeatmapTheme) => void;
  onReplayWave: () => void;
  onSnapPostcard: () => void;
  onRecordWaveVideo: () => void;
  onOpenShareStudio: () => void;
  onExitHeatmap: () => void;
}

const THEMES: Array<{ id: HeatmapTheme; label: string }> = [
  { id: 'emerald', label: '🌲 Emerald' },
  { id: 'cyber', label: '🌆 Cyber' },
  { id: 'forge', label: '🔥 Forge' },
  { id: 'sakura', label: '🌸 Sakura' },
];

export function HeatmapDock({
  heatmap,
  theme,
  isRecording,
  onSelectTheme,
  onReplayWave,
  onSnapPostcard,
  onRecordWaveVideo,
  onOpenShareStudio,
  onExitHeatmap,
}: HeatmapDockProps) {
  const canRecord = typeof window !== 'undefined' && isVideoCaptureSupported();

  return (
    <nav
      id="heatmap-dock"
      className="apple-glass bottom-dock heatmap-dock"
      aria-label="3D GitHub Heatmap controls and social sharing"
    >
      <div className="dock-segments" role="group" aria-label="3D Heatmap color themes">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="filter-pill"
            aria-pressed={theme === t.id}
            onClick={() => onSelectTheme(t.id)}
          >
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <span className="toolbar-sep" role="separator" aria-orientation="vertical" />

      <div className="dock-quick-actions heatmap-dock-actions">
        <button
          type="button"
          id="heatmap-wave-btn"
          className="dock-action-btn"
          title="Replay 53-week 3D wave rise animation"
          onClick={onReplayWave}
        >
          <SfIcon name="sf-play" size={12} />
          <span>Wave</span>
        </button>
        <button
          type="button"
          id="heatmap-snap-btn"
          className="dock-action-btn"
          title="Download watermarked 3D Heatmap Postcard PNG"
          onClick={onSnapPostcard}
        >
          <SfIcon name="sf-camera" size={13} />
          <span>3D PNG</span>
        </button>
        {canRecord && (
          <button
            type="button"
            id="heatmap-video-btn"
            className="dock-action-btn"
            disabled={isRecording}
            title="Record 6-second 3D Wave + Orbit MP4/WebM video for social media"
            onClick={onRecordWaveVideo}
          >
            <SfIcon name="sf-video" size={13} />
            <span>{isRecording ? 'Recording…' : '6s Video'}</span>
          </button>
        )}
        <button
          type="button"
          id="heatmap-share-btn"
          className="dock-action-btn heatmap-share-cta"
          title="Share 3D Heatmap on X, LinkedIn, or copy preview link"
          onClick={onOpenShareStudio}
        >
          <SfIcon name="sf-share" size={13} />
          <span>Share</span>
        </button>
        <button
          type="button"
          id="heatmap-exit-btn"
          className="dock-action-btn"
          title="Return to Repository Branch Village"
          onClick={onExitHeatmap}
        >
          <SfIcon name="sf-village" size={13} />
          <span>Repo Mode</span>
        </button>
      </div>
    </nav>
  );
}
