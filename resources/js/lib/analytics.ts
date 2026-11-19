import type { PostHog } from 'posthog-js';
import type { RepoVillageGraph } from '@/types/village';

export type AnalyticsEventMap = {
  repo_loaded: {
    source: 'github' | 'showcase' | 'local_browser' | 'local_server';
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    branch: string;
    commit_count: number;
    branch_count: number;
    gate_visitors_count: number;
  };
  repo_load_failed: {
    source: 'github' | 'local_browser' | 'local_server';
    repo_slug?: string;
    error_type: string;
  };
  branch_switched: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    branch: string;
    checkout_git_head: boolean;
  };
  commit_inspected: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    commit_kind: string;
    branch: string;
    files_count: number;
  };
  gate_visitor_inspected: {
    status: string;
    staged: boolean;
  };
  file_diff_expanded: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    file_ext: string;
    status: string;
  };
  full_diff_modal_opened: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    mode: 'all_files' | 'single_file' | 'gate_visitor';
    files_count: number;
  };
  camera_mode_changed: {
    mode: 'orbit' | 'walk';
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
  };
  atmosphere_changed: {
    time_of_day: 'day' | 'sunset' | 'night' | 'storm';
  };
  filter_changed: {
    filter: string;
  };
  author_spotlight_toggled: {
    active: boolean;
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
  };
  audio_mute_toggled: {
    muted: boolean;
  };
  village_shared: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    branch: string;
  };
  local_modal_opened: {
    local_server_enabled: boolean;
  };
  creator_link_clicked: {
    location: 'hud_footer' | 'guide_dialog';
  };
  postcard_captured: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
  };
  video_clip_recorded: {
    mode: 'turntable' | 'timelapse';
    format: 'mp4' | 'webm';
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
  };
  readme_badge_copied: {
    format: 'markdown' | 'html';
    repo_slug: string;
  };
  timelapse_started: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
    commit_count: number;
  };
  merge_conflict_demo_loaded: {
    conflicted_files: number;
  };
  merge_conflict_resolved_preview: {
    repo_type: 'demo' | 'github' | 'local';
    repo_slug: string;
  };
  xray_lens_toggled: {
    lens: string;
    repo_slug: string;
  };
  bisect_started: {
    commit_count: number;
    repo_slug: string;
  };
  bisect_resolved: {
    steps_taken: number;
    repo_slug: string;
  };
  rebase_vs_merge_toggled: {
    mode: 'rebase' | 'merge';
    branch: string;
  };
};

/**
 * Official hosted demo PostHog write-only project key (shared PostHog project with StepStake,
 * isolated into its own GitVillage stream/dashboard via `app = "gitvillage"` + `gitvillage_*` events).
 */
const OFFICIAL_DEMO_HOSTS = new Set(['gitvillage.on-forge.com']);
const OFFICIAL_DEMO_POSTHOG_KEY = 'phc_834eMtG9Xnu6ghem6HaHX4a5su2g2iCnbWsrV8Myi8t';
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const GITVILLAGE_SUPER_PROPERTIES = {
  app: 'gitvillage',
  app_name: 'GitVillage',
  dashboard_stream: 'gitvillage',
} as const;

let client: PostHog | null = null;
let initialized = false;
let enabled = false;
const pendingEvents: Array<{ event: string; properties: Record<string, unknown> }> = [];

function readMetaContent(name: string): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? '';
}

function isLocalDevHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.test') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost')
  );
}

function resolvePostHogConfig(): { key: string; host: string } | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  if (params.has('director')) {
    return null;
  }

  const hostname = window.location.hostname;
  const captureLocal = readMetaContent('posthog-capture-local') === 'true';
  if (isLocalDevHostname(hostname) && !captureLocal) {
    return null;
  }

  const metaKey = readMetaContent('posthog-key');
  const envKey = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim() ?? '';
  const officialFallbackKey = OFFICIAL_DEMO_HOSTS.has(hostname) ? OFFICIAL_DEMO_POSTHOG_KEY : '';

  const key = metaKey || envKey || officialFallbackKey;
  if (!key) return null;

  const host =
    readMetaContent('posthog-host') ||
    (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() ||
    DEFAULT_POSTHOG_HOST;

  return { key, host };
}

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;

  const cfg = resolvePostHogConfig();
  if (!cfg) return;

  enabled = true;

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(cfg.key, {
        api_host: cfg.host,
        person_profiles: 'identified_only',
        capture_pageview: 'history_change',
        capture_pageleave: true,
        autocapture: true,
        session_recording: {
          maskAllInputs: true,
        },
        before_send: (event) => {
          if (!event) return null;
          event.properties = {
            ...event.properties,
            ...GITVILLAGE_SUPER_PROPERTIES,
          };
          return event;
        },
        loaded: (ph) => {
          ph.register(GITVILLAGE_SUPER_PROPERTIES);
        },
      });
      posthog.register(GITVILLAGE_SUPER_PROPERTIES);
      client = posthog;

      while (pendingEvents.length > 0) {
        const next = pendingEvents.shift();
        if (next) {
          client.capture(next.event, next.properties);
        }
      }
    })
    .catch(() => {
      enabled = false;
      pendingEvents.length = 0;
    });
}

export function trackEvent<K extends keyof AnalyticsEventMap>(
  event: K,
  properties: AnalyticsEventMap[K],
): void {
  if (!initialized) {
    initAnalytics();
  }
  if (!enabled) return;

  const namespacedEvent = `gitvillage_${event}`;
  const payload = {
    ...GITVILLAGE_SUPER_PROPERTIES,
    ...(properties as Record<string, unknown>),
  };

  if (client) {
    client.capture(namespacedEvent, payload);
  } else if (pendingEvents.length < 40) {
    pendingEvents.push({ event: namespacedEvent, properties: payload });
  }
}

export function describeRepoForAnalytics(graph: RepoVillageGraph): {
  repo_type: 'demo' | 'github' | 'local';
  repo_slug: string;
} {
  if (graph.isDemo) {
    return { repo_type: 'demo', repo_slug: 'gitvillage/sky-village' };
  }
  if (graph.isLocal) {
    return { repo_type: 'local', repo_slug: 'local_repo' };
  }
  return {
    repo_type: 'github',
    repo_slug: `${graph.owner}/${graph.repo}`,
  };
}

export function extractFileExtension(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'none';
  return base.slice(dot + 1).toLowerCase().slice(0, 16);
}
