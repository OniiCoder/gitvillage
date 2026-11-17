import { SfIcon } from '@/Components/SfIconSprite';
import { sound } from '@/lib/sound';

interface BottomFilterDockProps {
  activeFilter: string;
  isLocal: boolean;
  gateVisitorsCount: number;
  onSelectFilter: (filter: string) => void;
  onFlyToGate: () => void;
  onRandomVillager: () => void;
  onResetOverview: () => void;
}

const FILTERS: Array<{ id: string; label: string; dotClass?: string }> = [
  { id: 'all', label: 'All' },
  { id: 'feat', label: 'Builders', dotClass: 'dot-amber' },
  { id: 'fix', label: 'Fixes', dotClass: 'dot-red' },
  { id: 'merge', label: 'Merges', dotClass: 'dot-purple' },
  { id: 'docs', label: 'Docs', dotClass: 'dot-cyan' },
  { id: 'refactor', label: 'Refactors', dotClass: 'dot-green' },
];

export function BottomFilterDock({
  activeFilter,
  isLocal,
  gateVisitorsCount,
  onSelectFilter,
  onFlyToGate,
  onRandomVillager,
  onResetOverview,
}: BottomFilterDockProps) {
  return (
    <nav className="bottom-dock" aria-label="Filter commits and camera">
      <div className="dock-segments" role="group" aria-label="Role filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`filter-pill${activeFilter === f.id ? ' is-active' : ''}`}
            data-filter={f.id}
            onClick={() => {
              sound.playPop(520);
              onSelectFilter(f.id);
            }}
          >
            {f.dotClass && <span className={`status-dot ${f.dotClass}`} aria-hidden="true" />}
            {f.label}
          </button>
        ))}
      </div>

      <span className="ornament-divider" aria-hidden="true" />

      <div className="dock-quick-actions">
        {isLocal && (
          <button
            type="button"
            id="gate-dock-btn"
            className="dock-action-btn gate-pill"
            title="Focus Village Gate and uncommitted file visitors"
            onClick={() => {
              sound.playPop(587.33);
              onFlyToGate();
            }}
          >
            <span
              id="gate-status-dot"
              className={`status-dot ${gateVisitorsCount > 0 ? 'dot-amber' : 'dot-green'}`}
              aria-hidden="true"
            />
            <span id="gate-dock-label">Gate · {gateVisitorsCount}</span>
          </button>
        )}

        <button
          type="button"
          id="random-btn"
          className="dock-action-btn"
          title="Focus a random commit citizen"
          onClick={onRandomVillager}
        >
          <SfIcon name="sf-shuffle" size={14} />
          <span>Random</span>
        </button>

        <button
          type="button"
          id="reset-cam-btn"
          className="dock-action-btn"
          title="Reset camera to full island overview"
          onClick={() => {
            sound.playPop(440);
            onResetOverview();
          }}
        >
          <SfIcon name="sf-viewfinder" size={14} />
          <span>Overview</span>
        </button>
      </div>
    </nav>
  );
}
