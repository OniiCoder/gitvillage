import { useRef, useState, type DragEvent, type FormEvent, type RefObject } from 'react';
import { SfIcon } from '@/Components/SfIconSprite';
import {
  type BrowserRepoSource,
  createSourceFromDirectoryEntry,
  createSourceFromDirectoryHandle,
  createSourceFromFileList,
} from '@/lib/browserGitReader';
import {
  type BrowseDirsResponse,
  type DiscoveredLocalRepo,
  browseLocalDirectory,
  discoverLocalRepos,
  isLocalPathInput,
  pickNativeMacFolder,
} from '@/lib/localLoader';
import { closeTopLayerDialog, useLightDismissDialog } from '@/lib/topLayer';

interface LocalRepoDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  localServerEnabled: boolean;
  nativeFinderSupported: boolean;
  onSelectLocalServerPath: (path: string) => void;
  onSelectBrowserSource: (source: BrowserRepoSource) => void;
  onToast: (message: string, isError?: boolean) => void;
}

export async function extractDroppedRepoSource(
  dt: DataTransfer | null,
): Promise<BrowserRepoSource | null> {
  if (!dt?.items || dt.items.length === 0) return null;
  const firstItem = dt.items[0] as DataTransferItem & {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  };

  if (typeof firstItem.getAsFileSystemHandle === 'function') {
    try {
      const handle = await firstItem.getAsFileSystemHandle();
      if (handle && handle.kind === 'directory') {
        return createSourceFromDirectoryHandle(handle as FileSystemDirectoryHandle);
      }
    } catch {
      // fall through to webkitGetAsEntry
    }
  }

  const entry = firstItem.webkitGetAsEntry?.();
  if (entry?.isDirectory) {
    return createSourceFromDirectoryEntry(entry as FileSystemDirectoryEntry);
  }

  if (dt.files && dt.files.length > 0) {
    return createSourceFromFileList(dt.files);
  }

  return null;
}

export function LocalRepoDialog({
  dialogRef,
  localServerEnabled,
  nativeFinderSupported,
  onSelectLocalServerPath,
  onSelectBrowserSource,
  onToast,
}: LocalRepoDialogProps) {
  useLightDismissDialog(dialogRef);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pathFilter, setPathFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [finderBusy, setFinderBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredLocalRepo[]>([]);
  const [dirState, setDirState] = useState<BrowseDirsResponse | null>(null);

  const loadServerDirectory = async (targetPath?: string, nextHidden = showHidden) => {
    if (!localServerEnabled) return;
    try {
      const data = await browseLocalDirectory(targetPath, nextHidden);
      setDirState(data);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to read folder.', true);
    }
  };

  const refreshServerData = (initialPath?: string) => {
    if (!localServerEnabled) return;
    void discoverLocalRepos().then(setDiscovered);
    void loadServerDirectory(initialPath);
  };

  // Attach an imperative helper on the dialog element so opening triggers a fresh scan
  if (dialogRef.current) {
    (dialogRef.current as HTMLDialogElement & { __refreshPicker?: (p?: string) => void }).__refreshPicker =
      refreshServerData;
  }

  const triggerBrowserFolderPicker = async () => {
    const winWithPicker = window as Window & {
      showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof winWithPicker.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await winWithPicker.showDirectoryPicker({ mode: 'read' });
        await closeTopLayerDialog(dialogRef.current);
        onSelectBrowserSource(createSourceFromDirectoryHandle(dirHandle));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Could not open folder.', true);
      }
      return;
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = '';
      folderInputRef.current.click();
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const source = await extractDroppedRepoSource(e.dataTransfer);
    if (source) {
      await closeTopLayerDialog(dialogRef.current);
      onSelectBrowserSource(source);
    }
  };

  const handlePathSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const raw = pathFilter.trim();
    if (!raw || !localServerEnabled) return;

    try {
      const info = await browseLocalDirectory(raw, showHidden);
      if (info.currentGitRepo) {
        await closeTopLayerDialog(dialogRef.current);
        onSelectLocalServerPath(info.currentGitRepo.path);
      } else {
        setDirState(info);
        onToast('Showing subfolders — select a Git repository below.');
      }
    } catch {
      await closeTopLayerDialog(dialogRef.current);
      onSelectLocalServerPath(raw);
    }
  };

  const handleNativeFinder = async () => {
    setFinderBusy(true);
    try {
      const res = await pickNativeMacFolder();
      if (res.path && !res.cancelled) {
        await closeTopLayerDialog(dialogRef.current);
        onSelectLocalServerPath(res.path);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Finder picker unavailable', true);
    } finally {
      setFinderBusy(false);
    }
  };

  const q = pathFilter.trim().toLowerCase();
  const filteredRepos =
    !q || isLocalPathInput(q)
      ? discovered
      : discovered.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.displayPath ?? r.path).toLowerCase().includes(q) ||
            r.branch.toLowerCase().includes(q),
        );

  return (
    <dialog
      ref={dialogRef}
      id="local-picker-dialog"
      className="apple-sheet local-picker-dialog"
      aria-labelledby="local-picker-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="sheet-header-bar">
        <div>
          <h2 id="local-picker-title" className="dialog-title">
            Open Local Repository
          </h2>
          <span className="section-caption">
            Choose any Git folder on your device to inspect commits and Gate Visitors
          </span>
        </div>
        <div className="picker-top-actions">
          {nativeFinderSupported && (
            <button
              type="button"
              id="native-finder-btn"
              className="sheet-btn sheet-btn-tinted"
              title="Choose folder in macOS Finder"
              disabled={finderBusy}
              onClick={handleNativeFinder}
            >
              <SfIcon name="sf-folder" size={14} />
              <span>Finder…</span>
            </button>
          )}
          <button
            type="button"
            id="local-picker-close-btn"
            className="circle-close-btn"
            aria-label="Close local repository chooser"
            onClick={() => void closeTopLayerDialog(dialogRef.current)}
          >
            <SfIcon name="sf-close" size={12} />
          </button>
        </div>
      </div>

      <div
        id="browser-dropzone"
        className={`browser-dropzone${isDragOver ? ' is-dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="browser-dropzone-copy">
          <span className="dropzone-glyph" aria-hidden="true">
            <SfIcon name="sf-folder" size={18} />
          </span>
          <div>
            <strong>Select or Drop a Git Repository Folder</strong>
            <span>
              Reads commits, branches, and uncommitted Gate Visitors privately in your browser —
              zero upload.
            </span>
          </div>
        </div>
        <button
          type="button"
          id="browser-pick-folder-btn"
          className="apple-primary-btn"
          autoFocus
          onClick={triggerBrowserFolderPicker}
        >
          Choose Folder…
        </button>
        <input
          ref={folderInputRef}
          id="browser-folder-input"
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            const source = createSourceFromFileList(files);
            await closeTopLayerDialog(dialogRef.current);
            onSelectBrowserSource(source);
          }}
        />
      </div>

      {localServerEnabled && (
        <div id="server-picker-sections">
          <form
            id="picker-path-form"
            className="picker-path-form"
            autoComplete="off"
            onSubmit={handlePathSubmit}
          >
            <label htmlFor="picker-path-input" className="sr-only">
              Local folder path or search
            </label>
            <div className="spotlight-input-wrap">
              <SfIcon name="sf-search" size={15} className="search-lead-icon" />
              <input
                id="picker-path-input"
                type="text"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder="Filter repositories or enter path (~/Projects/app)…"
                spellCheck={false}
              />
            </div>
            <button type="submit" className="apple-primary-btn">
              Open
            </button>
          </form>

          <div className="picker-section-label">
            <span>Discovered on This Machine</span>
            <span id="discovered-count-label" className="section-caption">
              {filteredRepos.length} found
            </span>
          </div>
          <div id="picker-discovered-grid" className="preset-grid">
            {filteredRepos.map((r) => (
              <button
                key={r.path}
                type="button"
                className="preset-card"
                onClick={async () => {
                  await closeTopLayerDialog(dialogRef.current);
                  onSelectLocalServerPath(r.path);
                }}
              >
                <div className="preset-card-head">
                  <strong>{r.name}</strong>
                  <span
                    className={`status-dot ${r.changedFilesCount > 0 ? 'dot-amber' : 'dot-green'}`}
                    aria-hidden="true"
                  />
                </div>
                <span>
                  {r.changedFilesCount > 0
                    ? `${r.branch} · ${r.changedFilesCount} at Gate`
                    : `${r.branch} · Clean tree`}
                </span>
              </button>
            ))}
          </div>

          <div className="picker-section-label">
            <span>Folders</span>
            <label className="hidden-toggle-label">
              <input
                type="checkbox"
                id="picker-hidden-checkbox"
                checked={showHidden}
                onChange={(e) => {
                  const next = e.target.checked;
                  setShowHidden(next);
                  void loadServerDirectory(dirState?.currentPath, next);
                }}
              />
              <span>Show hidden</span>
            </label>
          </div>

          {dirState && (
            <>
              <div id="picker-roots" className="picker-roots">
                {dirState.roots.map((rt) => (
                  <button
                    key={rt.path}
                    type="button"
                    className="root-chip"
                    onClick={() => void loadServerDirectory(rt.path)}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>

              <nav className="folder-breadcrumb" aria-label="Folder path breadcrumbs">
                <ol id="picker-breadcrumbs">
                  {dirState.breadcrumbs.map((bc, idx) => (
                    <li key={bc.path}>
                      <a
                        href="#"
                        aria-current={idx === dirState.breadcrumbs.length - 1 ? 'page' : undefined}
                        onClick={(ev) => {
                          ev.preventDefault();
                          void loadServerDirectory(bc.path);
                        }}
                      >
                        {bc.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>

              {dirState.currentGitRepo && (
                <div id="picker-current-git-banner" className="current-git-banner">
                  <div className="banner-copy">
                    <strong id="picker-current-git-title">{dirState.currentGitRepo.name}</strong>
                    <span id="picker-current-git-sub">
                      {dirState.currentGitRepo.changedFilesCount > 0
                        ? `Branch: ${dirState.currentGitRepo.branch} · ${dirState.currentGitRepo.changedFilesCount} changed file${dirState.currentGitRepo.changedFilesCount === 1 ? '' : 's'} at Gate`
                        : `Branch: ${dirState.currentGitRepo.branch} · Clean working tree`}
                    </span>
                  </div>
                  <button
                    type="button"
                    id="picker-load-current-btn"
                    className="apple-primary-btn"
                    onClick={async () => {
                      await closeTopLayerDialog(dialogRef.current);
                      onSelectLocalServerPath(dirState.currentGitRepo!.path);
                    }}
                  >
                    Open Village
                  </button>
                </div>
              )}

              <div id="picker-folder-list" className="inset-list folder-browser-list">
                {dirState.parentPath && (
                  <div className="folder-row">
                    <button
                      type="button"
                      className="folder-nav-btn"
                      onClick={() => void loadServerDirectory(dirState.parentPath!)}
                    >
                      <SfIcon name="sf-arrow-left" size={13} className="folder-icon-glyph" />
                      <span className="folder-name-txt">Enclosing Folder</span>
                    </button>
                  </div>
                )}

                {dirState.folders.map((f) => (
                  <div key={f.path} className={f.isGitRepo ? 'folder-row is-git' : 'folder-row'}>
                    <button
                      type="button"
                      className="folder-nav-btn"
                      onClick={() => void loadServerDirectory(f.path)}
                    >
                      <SfIcon
                        name={f.isGitRepo ? 'sf-branch' : 'sf-folder'}
                        size={14}
                        className="folder-icon-glyph"
                      />
                      <span className="folder-name-txt">{f.name}</span>
                      {f.isGitRepo && <span className="git-folder-tag">Git</span>}
                    </button>

                    {f.isGitRepo && (
                      <button
                        type="button"
                        className="sheet-btn sheet-btn-tinted"
                        onClick={async () => {
                          await closeTopLayerDialog(dialogRef.current);
                          onSelectLocalServerPath(f.path);
                        }}
                      >
                        Open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
