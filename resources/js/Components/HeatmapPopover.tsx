import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import type { GitHubHeatmapData, HeatmapTheme } from '@/types/village';

interface HeatmapPopoverProps {
  activeHeatmap: GitHubHeatmapData | null;
  heatmapTheme: HeatmapTheme;
  isLoading: boolean;
  onGenerateHeatmap: (opts: { username: string; year: number | null; theme: HeatmapTheme }) => void;
  onChangeTheme: (theme: HeatmapTheme) => void;
  onSnapPostcard: () => void;
  onRecordWaveVideo: () => void;
  onOpenShareStudio: () => void;
}

const FEATURED_DEVS = [
  { handle: 'OniiCoder', note: 'GitVillage creator' },
  { handle: 'taylorotwell', note: 'Laravel creator' },
  { handle: 'yyx990803', note: 'Vue & Vite' },
  { handle: 'torvalds', note: 'Linux & Git' },
];

const THEME_OPTIONS: Array<{ id: HeatmapTheme; label: string }> = [
  { id: 'emerald', label: '🌲 Emerald' },
  { id: 'cyber', label: '🌆 Cyber' },
  { id: 'forge', label: '🔥 Forge' },
  { id: 'sakura', label: '🌸 Sakura' },
];

const currentYear = new Date().getUTCFullYear();
const YEAR_OPTIONS: Array<{ value: string; label: string; year: number | null }> = [
  { value: 'rolling', label: 'Last 12m', year: null },
  { value: String(currentYear), label: String(currentYear), year: currentYear },
  { value: String(currentYear - 1), label: String(currentYear - 1), year: currentYear - 1 },
  { value: String(currentYear - 2), label: String(currentYear - 2), year: currentYear - 2 },
];

export function HeatmapPopover({
  activeHeatmap,
  heatmapTheme,
  isLoading,
  onGenerateHeatmap,
  onChangeTheme,
  onSnapPostcard,
  onRecordWaveVideo,
  onOpenShareStudio,
}: HeatmapPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [username, setUsername] = useState(activeHeatmap?.username ?? '');
  const [yearVal, setYearVal] = useState<string>(
    activeHeatmap?.year ? String(activeHeatmap.year) : 'rolling',
  );
  const [selectedTheme, setSelectedTheme] = useState<HeatmapTheme>(heatmapTheme);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTheme(heatmapTheme);
  }, [heatmapTheme]);

  useEffect(() => {
    if (activeHeatmap?.username) {
      setUsername(activeHeatmap.username);
      setYearVal(activeHeatmap.year ? String(activeHeatmap.year) : 'rolling');
    }
  }, [activeHeatmap?.username, activeHeatmap?.year]);

  const hidePopover = () => {
    popoverRef.current?.hidePopover?.();
  };

  const validateHandle = (raw: string): string | null => {
    const trimmed = raw
      .trim()
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '');
    if (!trimmed) {
      return 'Enter a GitHub username (e.g. OniiCoder).';
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(trimmed)) {
      return 'Use letters, numbers, or single hyphens (1–39 characters).';
    }
    return null;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validationErr = validateHandle(username);
    if (validationErr) {
      setErrorText(validationErr);
      inputRef.current?.focus();
      return;
    }
    const clean = username
      .trim()
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '');
    const pickedYear = YEAR_OPTIONS.find((y) => y.value === yearVal)?.year ?? null;
    setErrorText(null);
    hidePopover();
    onGenerateHeatmap({ username: clean, year: pickedYear, theme: selectedTheme });
  };

  return (
    <div
      ref={popoverRef}
      id="heatmap-popover"
      className="apple-sheet hud-popover heatmap-popover"
      aria-label="3D GitHub Contribution Heatmap Generator"
      {...({ popover: '' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h3 id="heatmap-form-heading">🟩 3D GitHub Contribution Skyline</h3>
          <span className="section-caption">
            Turn any public GitHub contribution graph into a living 3D floating island &amp; share it
          </span>
        </div>
      </div>

      <form
        className="heatmap-generator-form"
        aria-labelledby="heatmap-form-heading"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="heatmap-field">
          <label htmlFor="heatmap-user-input" className="heatmap-field-label">
            GitHub Username <span aria-hidden="true">*</span>
          </label>
          <div className="heatmap-input-row">
            <span className="heatmap-at-prefix" aria-hidden="true">
              @
            </span>
            <input
              ref={inputRef}
              id="heatmap-user-input"
              name="username"
              type="text"
              required
              maxLength={80}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errorText) setErrorText(null);
              }}
              onBlur={() => {
                if (username.trim() !== '') {
                  setErrorText(validateHandle(username));
                }
              }}
              aria-invalid={errorText ? 'true' : undefined}
              aria-describedby={errorText ? 'heatmap-user-error' : 'heatmap-user-hint'}
              placeholder="OniiCoder"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              className="heatmap-text-input"
            />
            <button
              type="submit"
              id="heatmap-generate-btn"
              className="apple-primary-btn"
              disabled={isLoading}
            >
              {isLoading ? 'Building…' : 'Build 3D Skyline'}
            </button>
          </div>
          {errorText ? (
            <span id="heatmap-user-error" className="heatmap-field-error" role="alert">
              {errorText}
            </span>
          ) : (
            <span id="heatmap-user-hint" className="heatmap-field-hint">
              Paste any GitHub handle or profile URL — public contributions load with zero sign-in.
            </span>
          )}
        </div>

        <div className="heatmap-fieldsets-row">
          <fieldset className="heatmap-fieldset">
            <legend>Time Window</legend>
            <div className="heatmap-radio-pills">
              {YEAR_OPTIONS.map((opt) => {
                const radioId = `hm-year-${opt.value}`;
                return (
                  <div key={opt.value} className="heatmap-radio-chip">
                    <input
                      type="radio"
                      id={radioId}
                      name="heatmap_year"
                      value={opt.value}
                      checked={yearVal === opt.value}
                      onChange={() => setYearVal(opt.value)}
                      className="sr-only"
                    />
                    <label htmlFor={radioId}>{opt.label}</label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="heatmap-fieldset">
            <legend>3D Island Palette</legend>
            <div className="heatmap-radio-pills">
              {THEME_OPTIONS.map((opt) => {
                const radioId = `hm-theme-${opt.id}`;
                return (
                  <div key={opt.id} className="heatmap-radio-chip">
                    <input
                      type="radio"
                      id={radioId}
                      name="heatmap_theme"
                      value={opt.id}
                      checked={selectedTheme === opt.id}
                      onChange={() => {
                        setSelectedTheme(opt.id);
                        if (activeHeatmap) {
                          onChangeTheme(opt.id);
                        }
                      }}
                      className="sr-only"
                    />
                    <label htmlFor={radioId}>{opt.label}</label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
      </form>

      <div className="sheet-section heatmap-quick-section">
        <div className="section-heading-row">
          <h3>Try a Developer Skyline</h3>
          <span className="section-caption">One-click live GitHub profiles</span>
        </div>
        <div className="preset-grid heatmap-devs-grid">
          {FEATURED_DEVS.map((dev) => (
            <button
              key={dev.handle}
              type="button"
              className="preset-card heatmap-dev-card"
              onClick={() => {
                setUsername(dev.handle);
                setErrorText(null);
                hidePopover();
                const pickedYear = YEAR_OPTIONS.find((y) => y.value === yearVal)?.year ?? null;
                onGenerateHeatmap({
                  username: dev.handle,
                  year: pickedYear,
                  theme: selectedTheme,
                });
              }}
            >
              <strong>@{dev.handle}</strong>
              <span>{dev.note}</span>
            </button>
          ))}
        </div>
      </div>

      {activeHeatmap && (
        <div className="inset-group heatmap-share-strip">
          <div className="heatmap-share-strip-copy">
            <strong>
              @{activeHeatmap.username} · {activeHeatmap.totalContributions.toLocaleString()}{' '}
              contributions
            </strong>
            <span>
              🔥 {activeHeatmap.longestStreak}d longest streak · 🏆 {activeHeatmap.maxDailyCount}/day
              peak
            </span>
          </div>
          <div className="heatmap-share-strip-btns">
            <button
              type="button"
              className="sheet-btn sheet-btn-tinted"
              onClick={() => {
                hidePopover();
                onSnapPostcard();
              }}
            >
              <SfIcon name="sf-camera" size={12} />
              <span>3D PNG</span>
            </button>
            <button
              type="button"
              className="sheet-btn"
              onClick={() => {
                hidePopover();
                onRecordWaveVideo();
              }}
            >
              <SfIcon name="sf-video" size={12} />
              <span>6s Video</span>
            </button>
            <button
              type="button"
              className="sheet-btn"
              onClick={() => {
                hidePopover();
                onOpenShareStudio();
              }}
            >
              <SfIcon name="sf-share" size={12} />
              <span>Share Link</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
