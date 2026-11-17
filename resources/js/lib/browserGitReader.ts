import { classifyCommitKind } from './demoRepo';
import type {
  BranchIslandData,
  CommitData,
  CommitFileChange,
  GateVisitorFile,
  RepoVillageGraph,
} from '@/types/village';

const BRANCH_PALETTE = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c'];

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'coverage',
  '.idea',
  '.vscode',
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export interface BrowserRepoSource {
  rootName: string;
  readFile(relPath: string): Promise<Uint8Array | null>;
  listDir(relPath: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
  dirHandle?: FileSystemDirectoryHandle;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readUint16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 8) | buf[offset + 1]) >>> 0;
}

async function inflateZlib(compressed: Uint8Array, expectedSize?: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(compressed as unknown as BufferSource).catch(() => {});
  writer.close().catch(() => {});

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (expectedSize !== undefined && total >= expectedSize) {
          reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } catch (err) {
    // Pack slices occasionally have trailing bytes after Z_STREAM_END; if we already got expectedSize, succeed.
    if (expectedSize === undefined || total < expectedSize) {
      throw err;
    }
  }

  const outLength = expectedSize !== undefined ? Math.min(total, expectedSize) : total;
  const out = new Uint8Array(outLength);
  let pos = 0;
  for (const ch of chunks) {
    const take = Math.min(ch.byteLength, outLength - pos);
    if (take <= 0) break;
    out.set(ch.subarray(0, take), pos);
    pos += take;
  }
  return out;
}

async function computeGitBlobSha(content: Uint8Array): Promise<string> {
  const header = textEncoder.encode(`blob ${content.byteLength}\0`);
  const full = new Uint8Array(header.byteLength + content.byteLength);
  full.set(header, 0);
  full.set(content, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', full);
  return bytesToHex(new Uint8Array(digest));
}

function applyGitDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let pos = 0;
  // Skip source length varint
  let shift = 0;
  while (pos < delta.length) {
    const b = delta[pos++];
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  // Read target length varint
  let targetSize = 0;
  shift = 0;
  while (pos < delta.length) {
    const b = delta[pos++];
    targetSize += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }

  const out = new Uint8Array(targetSize);
  let outPos = 0;

  while (pos < delta.length) {
    const cmd = delta[pos++];
    if (cmd & 0x80) {
      let cpOff = 0;
      let cpSize = 0;
      if (cmd & 0x01) cpOff |= delta[pos++];
      if (cmd & 0x02) cpOff |= delta[pos++] << 8;
      if (cmd & 0x04) cpOff |= delta[pos++] << 16;
      if (cmd & 0x08) cpOff = (cpOff | (delta[pos++] << 24)) >>> 0;
      if (cmd & 0x10) cpSize |= delta[pos++];
      if (cmd & 0x20) cpSize |= delta[pos++] << 8;
      if (cmd & 0x40) cpSize |= delta[pos++] << 16;
      if (cpSize === 0) cpSize = 0x10000;
      out.set(base.subarray(cpOff, cpOff + cpSize), outPos);
      outPos += cpSize;
    } else if (cmd > 0) {
      out.set(delta.subarray(pos, pos + cmd), outPos);
      pos += cmd;
      outPos += cmd;
    }
  }
  return out;
}

type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';

interface ParsedGitObject {
  type: GitObjectType;
  body: Uint8Array;
}

interface PackIndexEntry {
  sha: string;
  offset: number;
  nextOffset: number;
}

class PackFileReader {
  private shaMap = new Map<string, PackIndexEntry>();
  private offsetMap = new Map<number, PackIndexEntry>();
  private packBytes: Uint8Array;

  constructor(idxBytes: Uint8Array, packBytes: Uint8Array) {
    this.packBytes = packBytes;
    // Verify v2 pack index magic \xfftOc
    if (
      idxBytes.byteLength < 1032 ||
      idxBytes[0] !== 0xff ||
      idxBytes[1] !== 0x74 ||
      idxBytes[2] !== 0x4f ||
      idxBytes[3] !== 0x63
    ) {
      return;
    }
    const version = readUint32BE(idxBytes, 4);
    if (version !== 2) return;

    const fanoutStart = 8;
    const totalObjects = readUint32BE(idxBytes, fanoutStart + 255 * 4);
    const shaTableStart = fanoutStart + 256 * 4;
    const crcTableStart = shaTableStart + totalObjects * 20;
    const offsetTableStart = crcTableStart + totalObjects * 4;
    const largeOffsetTableStart = offsetTableStart + totalObjects * 4;

    const entries: PackIndexEntry[] = [];
    for (let i = 0; i < totalObjects; i++) {
      const shaPos = shaTableStart + i * 20;
      const sha = bytesToHex(idxBytes.subarray(shaPos, shaPos + 20));
      const rawOff = readUint32BE(idxBytes, offsetTableStart + i * 4);
      let offset: number;
      if (rawOff & 0x80000000) {
        const largeIdx = rawOff & 0x7fffffff;
        const hi = readUint32BE(idxBytes, largeOffsetTableStart + largeIdx * 8);
        const lo = readUint32BE(idxBytes, largeOffsetTableStart + largeIdx * 8 + 4);
        offset = hi * 2 ** 32 + lo;
      } else {
        offset = rawOff;
      }
      entries.push({ sha, offset, nextOffset: 0 });
    }

    const sortedByOffset = entries.toSorted((a, b) => a.offset - b.offset);
    const packDataEnd = Math.max(0, packBytes.byteLength - 20);
    for (let i = 0; i < sortedByOffset.length; i++) {
      sortedByOffset[i].nextOffset =
        i + 1 < sortedByOffset.length ? sortedByOffset[i + 1].offset : packDataEnd;
      this.shaMap.set(sortedByOffset[i].sha, sortedByOffset[i]);
      this.offsetMap.set(sortedByOffset[i].offset, sortedByOffset[i]);
    }
  }

  has(sha: string): boolean {
    return this.shaMap.has(sha);
  }

  async readBySha(
    sha: string,
    resolveExternal: (refSha: string) => Promise<ParsedGitObject | null>,
  ): Promise<ParsedGitObject | null> {
    const entry = this.shaMap.get(sha);
    if (!entry) return null;
    return this.readAtEntry(entry, resolveExternal);
  }

  private async readAtEntry(
    entry: PackIndexEntry,
    resolveExternal: (refSha: string) => Promise<ParsedGitObject | null>,
  ): Promise<ParsedGitObject | null> {
    let pos = entry.offset;
    let b = this.packBytes[pos++];
    const typeNum = (b >> 4) & 0x07;
    let expectedSize = b & 0x0f;
    let shift = 4;
    while (b & 0x80) {
      b = this.packBytes[pos++];
      expectedSize += (b & 0x7f) * 2 ** shift;
      shift += 7;
    }

    if (typeNum >= 1 && typeNum <= 4) {
      const slice = this.packBytes.subarray(pos, entry.nextOffset);
      const body = await inflateZlib(slice, expectedSize);
      const typeMap: Record<number, GitObjectType> = {
        1: 'commit',
        2: 'tree',
        3: 'blob',
        4: 'tag',
      };
      return { type: typeMap[typeNum], body };
    }

    if (typeNum === 6) {
      // OBJ_OFS_DELTA
      let ob = this.packBytes[pos++];
      let negOffset = ob & 0x7f;
      while (ob & 0x80) {
        ob = this.packBytes[pos++];
        negOffset = (negOffset + 1) * 128 + (ob & 0x7f);
      }
      const baseEntry = this.offsetMap.get(entry.offset - negOffset);
      if (!baseEntry) return null;
      const slice = this.packBytes.subarray(pos, entry.nextOffset);
      const deltaBytes = await inflateZlib(slice, expectedSize);
      const baseObj = await this.readAtEntry(baseEntry, resolveExternal);
      if (!baseObj) return null;
      return { type: baseObj.type, body: applyGitDelta(baseObj.body, deltaBytes) };
    }

    if (typeNum === 7) {
      // OBJ_REF_DELTA
      const refSha = bytesToHex(this.packBytes.subarray(pos, pos + 20));
      pos += 20;
      const slice = this.packBytes.subarray(pos, entry.nextOffset);
      const deltaBytes = await inflateZlib(slice, expectedSize);
      const baseObj =
        (await this.readBySha(refSha, resolveExternal)) ?? (await resolveExternal(refSha));
      if (!baseObj) return null;
      return { type: baseObj.type, body: applyGitDelta(baseObj.body, deltaBytes) };
    }

    return null;
  }
}

class BrowserGitObjectStore {
  private cache = new Map<string, ParsedGitObject>();
  private packsLoaded = false;
  private packs: PackFileReader[] = [];
  private source: BrowserRepoSource;

  constructor(source: BrowserRepoSource) {
    this.source = source;
  }

  private async ensurePacks(): Promise<void> {
    if (this.packsLoaded) return;
    this.packsLoaded = true;
    const entries = await this.source.listDir('.git/objects/pack');
    const idxFiles = entries.filter((e) => e.kind === 'file' && e.name.endsWith('.idx'));
    for (const idxFile of idxFiles) {
      const base = idxFile.name.slice(0, -4);
      const [idxBytes, packBytes] = await Promise.all([
        this.source.readFile(`.git/objects/pack/${base}.idx`),
        this.source.readFile(`.git/objects/pack/${base}.pack`),
      ]);
      if (idxBytes && packBytes) {
        this.packs.push(new PackFileReader(idxBytes, packBytes));
      }
    }
  }

  async readObject(sha: string): Promise<ParsedGitObject | null> {
    if (!sha || sha.length !== 40) return null;
    const cached = this.cache.get(sha);
    if (cached) return cached;

    // 1. Try loose object `.git/objects/xx/yyyy...`
    const loosePath = `.git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`;
    const looseCompressed = await this.source.readFile(loosePath);
    if (looseCompressed) {
      const raw = await inflateZlib(looseCompressed);
      const nulIdx = raw.indexOf(0);
      if (nulIdx > 0) {
        const header = textDecoder.decode(raw.subarray(0, nulIdx));
        const spaceIdx = header.indexOf(' ');
        const type = (spaceIdx > 0 ? header.slice(0, spaceIdx) : header) as GitObjectType;
        const obj: ParsedGitObject = { type, body: raw.subarray(nulIdx + 1) };
        this.cache.set(sha, obj);
        return obj;
      }
    }

    // 2. Fall back to packfiles
    await this.ensurePacks();
    for (const pack of this.packs) {
      if (pack.has(sha)) {
        const obj = await pack.readBySha(sha, (refSha) => this.readObject(refSha));
        if (obj) {
          this.cache.set(sha, obj);
          return obj;
        }
      }
    }

    return null;
  }
}

interface RawParsedCommit {
  sha: string;
  treeSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  timestampIso: string;
  subject: string;
  body: string;
}

function parseCommitObject(sha: string, bytes: Uint8Array): RawParsedCommit {
  const text = textDecoder.decode(bytes);
  const splitIdx = text.indexOf('\n\n');
  const headerBlock = splitIdx >= 0 ? text.slice(0, splitIdx) : text;
  const messageBlock = splitIdx >= 0 ? text.slice(splitIdx + 2).trim() : '';

  let treeSha = '';
  const parents: string[] = [];
  let authorName = 'Contributor';
  let authorEmail = 'dev@local';
  let timestampIso = new Date().toISOString();

  for (const line of headerBlock.split('\n')) {
    if (line.startsWith('tree ')) {
      treeSha = line.slice(5).trim();
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7).trim());
    } else if (line.startsWith('author ')) {
      const rest = line.slice(7).trim();
      const lt = rest.indexOf('<');
      const gt = rest.indexOf('>', lt + 1);
      if (lt >= 0 && gt > lt) {
        authorName = rest.slice(0, lt).trim() || 'Contributor';
        authorEmail = rest.slice(lt + 1, gt).trim() || 'dev@local';
        const timePart = rest.slice(gt + 1).trim().split(/\s+/);
        const epochSec = Number.parseInt(timePart[0] ?? '', 10);
        if (Number.isFinite(epochSec)) {
          timestampIso = new Date(epochSec * 1000).toISOString();
        }
      }
    }
  }

  const msgLines = messageBlock.split('\n');
  const subject = (msgLines[0] ?? 'Commit').trim();
  const body = msgLines.slice(1).join('\n').trim();

  return {
    sha,
    treeSha,
    parents,
    authorName,
    authorEmail,
    timestampIso,
    subject,
    body,
  };
}

interface TreeEntry {
  mode: string;
  name: string;
  sha: string;
  isDir: boolean;
}

function parseTreeObject(bytes: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const spaceIdx = bytes.indexOf(0x20, pos);
    if (spaceIdx < 0) break;
    const nulIdx = bytes.indexOf(0x00, spaceIdx + 1);
    if (nulIdx < 0 || nulIdx + 21 > bytes.length) break;

    const mode = textDecoder.decode(bytes.subarray(pos, spaceIdx));
    const name = textDecoder.decode(bytes.subarray(spaceIdx + 1, nulIdx));
    const sha = bytesToHex(bytes.subarray(nulIdx + 1, nulIdx + 21));
    pos = nulIdx + 21;

    entries.push({
      mode,
      name,
      sha,
      isDir: mode === '40000' || mode === '040000',
    });
  }
  return entries;
}

async function flattenTreeToMap(
  store: BrowserGitObjectStore,
  treeSha: string,
  prefix = '',
  out = new Map<string, string>(),
): Promise<Map<string, string>> {
  if (!treeSha) return out;
  const obj = await store.readObject(treeSha);
  if (!obj || obj.type !== 'tree') return out;

  for (const entry of parseTreeObject(obj.body)) {
    if (entry.mode === '160000') continue; // skip gitlink submodule
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDir) {
      await flattenTreeToMap(store, entry.sha, relPath, out);
    } else {
      out.set(relPath, entry.sha);
    }
  }
  return out;
}

async function diffTreesFast(
  store: BrowserGitObjectStore,
  oldTreeSha: string | null,
  newTreeSha: string,
  prefix = '',
  out: Array<{
    filename: string;
    status: CommitFileChange['status'];
    oldSha?: string;
    newSha?: string;
  }> = [],
): Promise<
  Array<{
    filename: string;
    status: CommitFileChange['status'];
    oldSha?: string;
    newSha?: string;
  }>
> {
  if (oldTreeSha === newTreeSha) return out;

  const [oldObj, newObj] = await Promise.all([
    oldTreeSha ? store.readObject(oldTreeSha) : Promise.resolve(null),
    newTreeSha ? store.readObject(newTreeSha) : Promise.resolve(null),
  ]);

  const oldEntries = oldObj && oldObj.type === 'tree' ? parseTreeObject(oldObj.body) : [];
  const newEntries = newObj && newObj.type === 'tree' ? parseTreeObject(newObj.body) : [];

  const oldMap = new Map(oldEntries.map((e) => [e.name, e]));
  const newMap = new Map(newEntries.map((e) => [e.name, e]));

  for (const [name, newE] of newMap) {
    const oldE = oldMap.get(name);
    const full = prefix ? `${prefix}/${name}` : name;
    if (!oldE) {
      if (newE.isDir) {
        await diffTreesFast(store, null, newE.sha, full, out);
      } else {
        out.push({ filename: full, status: 'added', newSha: newE.sha });
      }
    } else if (oldE.sha !== newE.sha) {
      if (oldE.isDir && newE.isDir) {
        await diffTreesFast(store, oldE.sha, newE.sha, full, out);
      } else if (!oldE.isDir && !newE.isDir) {
        out.push({ filename: full, status: 'modified', oldSha: oldE.sha, newSha: newE.sha });
      } else {
        if (oldE.isDir) await diffTreesFast(store, oldE.sha, '', full, out);
        if (newE.isDir) await diffTreesFast(store, null, newE.sha, full, out);
      }
    }
  }

  for (const [name, oldE] of oldMap) {
    if (!newMap.has(name)) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (oldE.isDir) {
        await diffTreesFast(store, oldE.sha, '', full, out);
      } else {
        out.push({ filename: full, status: 'removed', oldSha: oldE.sha });
      }
    }
  }

  return out;
}

function countTextLines(bytes: Uint8Array): number {
  if (bytes.byteLength === 0) return 0;
  // Binary heuristic: NUL byte in first 512 bytes
  const checkLen = Math.min(bytes.byteLength, 512);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) return 0;
  }
  let lines = 1;
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] === 0x0a) lines++;
  }
  if (bytes[bytes.byteLength - 1] === 0x0a) lines--;
  return Math.max(1, lines);
}

function isBinaryBlob(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.byteLength === 0) return false;
  const checkLen = Math.min(bytes.byteLength, 512);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function estimateBlobDiff(oldBytes: Uint8Array | null, newBytes: Uint8Array | null): {
  additions: number;
  deletions: number;
  preview?: string;
} {
  if (isBinaryBlob(oldBytes) || isBinaryBlob(newBytes)) {
    return { additions: 0, deletions: 0, preview: 'Binary file changed' };
  }

  if (!oldBytes && newBytes) {
    const text = textDecoder.decode(newBytes.subarray(0, 12_288)).replace(/\n$/, '');
    const lines = text.length > 0 ? text.split('\n') : [];
    const sample = lines.slice(0, 48);
    const preview =
      sample.length > 0
        ? `@@ -0,0 +1,${sample.length} @@\n${sample.map((l) => `+${l}`).join('\n')}`
        : undefined;
    return { additions: countTextLines(newBytes), deletions: 0, preview };
  }

  if (oldBytes && !newBytes) {
    const text = textDecoder.decode(oldBytes.subarray(0, 12_288)).replace(/\n$/, '');
    const lines = text.length > 0 ? text.split('\n') : [];
    const sample = lines.slice(0, 48);
    const preview =
      sample.length > 0
        ? `@@ -1,${sample.length} +0,0 @@\n${sample.map((l) => `-${l}`).join('\n')}`
        : undefined;
    return { additions: 0, deletions: countTextLines(oldBytes), preview };
  }

  if (!oldBytes || !newBytes) return { additions: 0, deletions: 0 };

  if (oldBytes.byteLength > 96_000 || newBytes.byteLength > 96_000) {
    const oldL = countTextLines(oldBytes);
    const newL = countTextLines(newBytes);
    return {
      additions: Math.max(1, newL - Math.min(oldL, newL) + 2),
      deletions: Math.max(1, oldL - Math.min(oldL, newL) + 1),
      preview: 'Large file modified (diff omitted for performance)',
    };
  }

  const oldLines = textDecoder.decode(oldBytes).replace(/\n$/, '').split('\n');
  const newLines = textDecoder.decode(newBytes).replace(/\n$/, '').split('\n');

  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);

  if (oldMid.length === 0 && newMid.length === 0) {
    return { additions: 0, deletions: 0 };
  }

  const ctxBefore = oldLines.slice(Math.max(0, prefix - 2), prefix);
  const ctxAfter = oldLines.slice(oldLines.length - suffix, Math.min(oldLines.length, oldLines.length - suffix + 2));
  const hunkOldStart = Math.max(1, prefix - ctxBefore.length + 1);
  const hunkNewStart = Math.max(1, prefix - ctxBefore.length + 1);

  if (oldMid.length * newMid.length <= 64_000) {
    const m = oldMid.length;
    const n = newMid.length;
    const dp = new Uint16Array((m + 1) * (n + 1));
    const stride = n + 1;
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i * stride + j] =
          oldMid[i] === newMid[j]
            ? dp[(i + 1) * stride + (j + 1)] + 1
            : Math.max(dp[(i + 1) * stride + j], dp[i * stride + (j + 1)]);
      }
    }

    const bodyLines: string[] = [];
    let additions = 0;
    let deletions = 0;
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldMid[i] === newMid[j]) {
        bodyLines.push(` ${oldMid[i]}`);
        i++;
        j++;
      } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
        bodyLines.push(`-${oldMid[i]}`);
        deletions++;
        i++;
      } else {
        bodyLines.push(`+${newMid[j]}`);
        additions++;
        j++;
      }
    }
    while (i < m) {
      bodyLines.push(`-${oldMid[i++]}`);
      deletions++;
    }
    while (j < n) {
      bodyLines.push(`+${newMid[j++]}`);
      additions++;
    }

    const fullHunk = [
      ...ctxBefore.map((l) => ` ${l}`),
      ...bodyLines.slice(0, 72),
      ...(bodyLines.length <= 72 ? ctxAfter.map((l) => ` ${l}`) : [' … diff truncated …']),
    ];
    const oldSpan = ctxBefore.length + oldMid.length + (bodyLines.length <= 72 ? ctxAfter.length : 0);
    const newSpan = ctxBefore.length + newMid.length + (bodyLines.length <= 72 ? ctxAfter.length : 0);
    const preview = `@@ -${hunkOldStart},${oldSpan} +${hunkNewStart},${newSpan} @@\n${fullHunk.join('\n')}`;
    return { additions, deletions, preview };
  }

  const oldFreq = new Map<string, number>();
  for (const l of oldMid) {
    oldFreq.set(l, (oldFreq.get(l) ?? 0) + 1);
  }
  let shared = 0;
  for (const l of newMid) {
    const c = oldFreq.get(l) ?? 0;
    if (c > 0) {
      shared++;
      oldFreq.set(l, c - 1);
    }
  }

  const additions = Math.max(0, newMid.length - shared);
  const deletions = Math.max(0, oldMid.length - shared);
  const delSample = oldMid.slice(0, 20).map((l) => `-${l}`);
  const addSample = newMid.slice(0, 24).map((l) => `+${l}`);
  const oldSpan = ctxBefore.length + delSample.length;
  const newSpan = ctxBefore.length + addSample.length;
  const preview = [
    `@@ -${hunkOldStart},${oldSpan} +${hunkNewStart},${newSpan} @@`,
    ...ctxBefore.map((l) => ` ${l}`),
    ...delSample,
    ...addSample,
  ].join('\n');

  return { additions, deletions, preview };
}

interface GitIndexEntry {
  path: string;
  sha: string;
  fileSize: number;
  mode: number;
}

function parseGitIndex(bytes: Uint8Array): Map<string, GitIndexEntry> {
  const map = new Map<string, GitIndexEntry>();
  if (
    bytes.byteLength < 12 ||
    bytes[0] !== 0x44 || // D
    bytes[1] !== 0x49 || // I
    bytes[2] !== 0x52 || // R
    bytes[3] !== 0x43 // C
  ) {
    return map;
  }

  const version = readUint32BE(bytes, 4);
  if (version < 2 || version > 4) return map;
  const count = readUint32BE(bytes, 8);

  let pos = 12;
  let prevPath = '';

  for (let i = 0; i < count && pos + 62 <= bytes.byteLength; i++) {
    const entryStart = pos;
    const mode = readUint32BE(bytes, pos + 24);
    const fileSize = readUint32BE(bytes, pos + 36);
    const sha = bytesToHex(bytes.subarray(pos + 40, pos + 60));
    const flags = readUint16BE(bytes, pos + 60);
    const stage = (flags >> 12) & 0x03;
    const extended = version >= 3 && (flags & 0x4000) !== 0;
    pos += extended ? 64 : 62;

    let filePath = '';
    if (version === 4) {
      // Prefix-compressed path varint
      let stripLen = 0;
      let b = bytes[pos++];
      stripLen = b & 0x7f;
      while (b & 0x80) {
        b = bytes[pos++];
        stripLen = (stripLen + 1) * 128 + (b & 0x7f);
      }
      const nul = bytes.indexOf(0, pos);
      if (nul < 0) break;
      const suffix = textDecoder.decode(bytes.subarray(pos, nul));
      pos = nul + 1;
      filePath = prevPath.slice(0, prevPath.length - stripLen) + suffix;
      prevPath = filePath;
    } else {
      const nul = bytes.indexOf(0, pos);
      if (nul < 0) break;
      filePath = textDecoder.decode(bytes.subarray(pos, nul));
      const consumed = nul + 1 - entryStart;
      const pad = (8 - (consumed % 8)) % 8;
      pos = nul + 1 + pad;
    }

    if (stage === 0 && filePath) {
      map.set(filePath, { path: filePath, sha, fileSize, mode });
    }
  }

  return map;
}

function compileGitignoreMatcher(rawIgnore: string | null): (relPath: string, isDir: boolean) => boolean {
  if (!rawIgnore) return () => false;
  const rules: RegExp[] = [];

  for (const rawLine of rawIgnore.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dirOnly = line.endsWith('/');
    const clean = line.replace(/^\/+|\/+$/g, '');
    if (!clean) continue;

    const escaped = clean
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___GLOBSTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/___GLOBSTAR___/g, '.*');

    const anchored = line.startsWith('/');
    const pattern = anchored
      ? `^${escaped}${dirOnly ? '(?:/|$)' : '(?:$|/.*)'}`
      : `(?:^|/)${escaped}${dirOnly ? '(?:/|$)' : '(?:$|/.*)'}`;
    try {
      rules.push(new RegExp(pattern));
    } catch {
      // skip exotic pattern
    }
  }

  return (relPath: string, isDir: boolean) => {
    const target = isDir ? `${relPath}/` : relPath;
    return rules.some((re) => re.test(target));
  };
}

async function collectRefs(source: BrowserRepoSource): Promise<{
  currentBranch: string;
  headSha: string | null;
  branchTips: Map<string, string>;
}> {
  const branchTips = new Map<string, string>();

  // 1. Read `.git/packed-refs` first
  const packedBytes = await source.readFile('.git/packed-refs');
  if (packedBytes) {
    const text = textDecoder.decode(packedBytes);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
      const [sha, ref] = trimmed.split(/\s+/);
      if (sha && ref?.startsWith('refs/heads/')) {
        branchTips.set(ref.slice('refs/heads/'.length), sha);
      }
    }
  }

  // 2. Recursively scan `.git/refs/heads` (overrides packed-refs)
  async function walkHeads(relDir: string, prefix: string): Promise<void> {
    const items = await source.listDir(relDir);
    for (const item of items) {
      const nextRel = `${relDir}/${item.name}`;
      const nextBranch = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.kind === 'directory') {
        await walkHeads(nextRel, nextBranch);
      } else {
        const bytes = await source.readFile(nextRel);
        if (bytes) {
          const sha = textDecoder.decode(bytes).trim();
          if (/^[0-9a-f]{40}$/i.test(sha)) {
            branchTips.set(nextBranch, sha.toLowerCase());
          }
        }
      }
    }
  }
  await walkHeads('.git/refs/heads', '');

  // 3. Read `.git/HEAD`
  let currentBranch = 'main';
  let headSha: string | null = null;
  const headBytes = await source.readFile('.git/HEAD');
  if (headBytes) {
    const headStr = textDecoder.decode(headBytes).trim();
    if (headStr.startsWith('ref:')) {
      const refTarget = headStr.slice(4).trim();
      if (refTarget.startsWith('refs/heads/')) {
        currentBranch = refTarget.slice('refs/heads/'.length);
        headSha = branchTips.get(currentBranch) ?? null;
        if (!headSha) {
          const direct = await source.readFile(`.git/${refTarget}`);
          if (direct) {
            const s = textDecoder.decode(direct).trim();
            if (/^[0-9a-f]{40}$/i.test(s)) {
              headSha = s.toLowerCase();
              branchTips.set(currentBranch, headSha);
            }
          }
        }
      }
    } else if (/^[0-9a-f]{40}$/i.test(headStr)) {
      currentBranch = 'detached';
      headSha = headStr.toLowerCase();
      branchTips.set('detached', headSha);
    }
  }

  return { currentBranch, headSha, branchTips };
}

async function scanWorkingTreeFiles(
  source: BrowserRepoSource,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
  trackedPaths: Set<string>,
): Promise<string[]> {
  const results: string[] = [];
  const MAX_FILES = 1500;

  async function walk(relDir: string): Promise<void> {
    if (results.length >= MAX_FILES) return;
    const entries = await source.listDir(relDir);
    for (const entry of entries) {
      if (results.length >= MAX_FILES) break;
      if (entry.kind === 'directory' && IGNORED_DIRS.has(entry.name)) continue;
      if (entry.kind === 'file' && IGNORED_FILES.has(entry.name)) continue;

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (isIgnored(relPath, true)) continue;
        await walk(relPath);
      } else {
        if (!trackedPaths.has(relPath) && isIgnored(relPath, false)) continue;
        results.push(relPath);
      }
    }
  }

  await walk('');
  return results;
}

export function createSourceFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
): BrowserRepoSource {
  async function getSubDir(parts: string[]): Promise<FileSystemDirectoryHandle | null> {
    let cur = dirHandle;
    for (const p of parts) {
      if (!p) continue;
      try {
        cur = await cur.getDirectoryHandle(p);
      } catch {
        return null;
      }
    }
    return cur;
  }

  return {
    rootName: dirHandle.name || 'local-repo',
    dirHandle,
    async readFile(relPath: string): Promise<Uint8Array | null> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const parts = clean.split('/');
      const fileName = parts.pop();
      if (!fileName) return null;
      const parent = await getSubDir(parts);
      if (!parent) return null;
      try {
        const fh = await parent.getFileHandle(fileName);
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    async listDir(relPath: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const target = clean ? await getSubDir(clean.split('/')) : dirHandle;
      if (!target) return [];
      const out: Array<{ name: string; kind: 'file' | 'directory' }> = [];
      try {
        const iterable = target as unknown as AsyncIterable<[string, FileSystemHandle]>;
        for await (const [name, handle] of iterable) {
          out.push({ name, kind: handle.kind });
        }
      } catch {
        return [];
      }
      return out;
    },
  };
}

export function createSourceFromDirectoryEntry(
  rootEntry: FileSystemDirectoryEntry,
): BrowserRepoSource {
  function readEntriesAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const pump = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve(all);
            } else {
              all.push(...batch);
              pump();
            }
          },
          (err) => reject(err),
        );
      };
      pump();
    });
  }

  function getSubDirEntry(parts: string[]): Promise<FileSystemDirectoryEntry | null> {
    return parts.reduce<Promise<FileSystemDirectoryEntry | null>>(async (accP, part) => {
      const cur = await accP;
      if (!cur || !part) return cur;
      return new Promise((resolve) => {
        cur.getDirectory(
          part,
          { create: false },
          (sub) => resolve(sub as FileSystemDirectoryEntry),
          () => resolve(null),
        );
      });
    }, Promise.resolve(rootEntry));
  }

  return {
    rootName: rootEntry.name || 'local-repo',
    async readFile(relPath: string): Promise<Uint8Array | null> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const parts = clean.split('/');
      const fileName = parts.pop();
      if (!fileName) return null;
      const dir = await getSubDirEntry(parts);
      if (!dir) return null;
      return new Promise((resolve) => {
        dir.getFile(
          fileName,
          { create: false },
          (fileEntry) => {
            (fileEntry as FileSystemFileEntry).file(
              async (file: File) => resolve(new Uint8Array(await file.arrayBuffer())),
              () => resolve(null),
            );
          },
          () => resolve(null),
        );
      });
    },
    async listDir(relPath: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const dir = clean ? await getSubDirEntry(clean.split('/')) : rootEntry;
      if (!dir) return [];
      try {
        const entries = await readEntriesAll(dir.createReader());
        return entries.map((e) => ({
          name: e.name,
          kind: e.isDirectory ? 'directory' : 'file',
        }));
      } catch {
        return [];
      }
    },
  };
}

export function createSourceFromFileList(files: FileList | File[]): BrowserRepoSource {
  const fileMap = new Map<string, File>();
  const dirMap = new Map<string, Map<string, 'file' | 'directory'>>();
  let rootName = 'local-repo';

  const list = Array.from(files);
  for (const file of list) {
    const rawRel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const slashIdx = rawRel.indexOf('/');
    let relPath = rawRel;
    if (slashIdx > 0) {
      rootName = rawRel.slice(0, slashIdx);
      relPath = rawRel.slice(slashIdx + 1);
    }
    if (!relPath) continue;
    fileMap.set(relPath, file);

    const segs = relPath.split('/');
    for (let i = 0; i < segs.length; i++) {
      const parentDir = segs.slice(0, i).join('/');
      const name = segs[i];
      const kind: 'file' | 'directory' = i === segs.length - 1 ? 'file' : 'directory';
      let children = dirMap.get(parentDir);
      if (!children) {
        children = new Map();
        dirMap.set(parentDir, children);
      }
      if (!children.has(name) || kind === 'directory') {
        children.set(name, kind);
      }
    }
  }

  return {
    rootName,
    async readFile(relPath: string): Promise<Uint8Array | null> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const f = fileMap.get(clean);
      if (!f) return null;
      return new Uint8Array(await f.arrayBuffer());
    },
    async listDir(relPath: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
      const clean = relPath.replace(/^\/+|\/+$/g, '');
      const children = dirMap.get(clean);
      if (!children) return [];
      return Array.from(children, ([name, kind]) => ({ name, kind }));
    },
  };
}

export async function loadBrowserGitRepoVillage(
  source: BrowserRepoSource,
): Promise<RepoVillageGraph> {
  const headCheck = await source.readFile('.git/HEAD');
  if (!headCheck) {
    throw new Error(
      `No .git folder found inside "${source.rootName}". Select a folder initialized with Git.`,
    );
  }

  const store = new BrowserGitObjectStore(source);
  const { currentBranch, headSha, branchTips } = await collectRefs(source);

  // Order branches so currentBranch comes first, up to 6 branches
  const branchEntries = Array.from(branchTips.entries())
    .toSorted(([a], [b]) => (a === currentBranch ? -1 : b === currentBranch ? 1 : a.localeCompare(b)))
    .slice(0, 6);

  const commitsBySha = new Map<string, CommitData>();
  const rawCommitsBySha = new Map<string, RawParsedCommit>();
  const branches: BranchIslandData[] = [];
  const defaultBranch = currentBranch || branchEntries[0]?.[0] || 'main';

  let colorIdx = 0;
  for (const [branchName, tipSha] of branchEntries) {
    const isCurrent = branchName === defaultBranch;
    const maxDepth = isCurrent ? 22 : 9;
    const uniqueCommits: CommitData[] = [];
    let forkFromSha: string | undefined;

    let cursorSha: string | undefined = tipSha;
    let steps = 0;

    while (cursorSha && steps < maxDepth) {
      steps++;
      if (commitsBySha.has(cursorSha)) {
        if (!forkFromSha) forkFromSha = cursorSha;
        break;
      }

      const obj = await store.readObject(cursorSha);
      if (!obj || obj.type !== 'commit') break;

      const parsed = parseCommitObject(cursorSha, obj.body);
      rawCommitsBySha.set(cursorSha, parsed);

      // Compute changed files against first parent tree
      let parentTreeSha: string | null = null;
      if (parsed.parents[0]) {
        const pCached = rawCommitsBySha.get(parsed.parents[0]);
        if (pCached) {
          parentTreeSha = pCached.treeSha;
        } else {
          const pObj = await store.readObject(parsed.parents[0]);
          if (pObj && pObj.type === 'commit') {
            const pParsed = parseCommitObject(parsed.parents[0], pObj.body);
            rawCommitsBySha.set(parsed.parents[0], pParsed);
            parentTreeSha = pParsed.treeSha;
          }
        }
      }

      const treeChanges = await diffTreesFast(store, parentTreeSha, parsed.treeSha);
      let totalAdd = 0;
      let totalDel = 0;
      const detailedFiles: CommitFileChange[] = [];

      for (const ch of treeChanges.slice(0, 18)) {
        const [oldObj, newObj] = await Promise.all([
          ch.oldSha ? store.readObject(ch.oldSha) : Promise.resolve(null),
          ch.newSha ? store.readObject(ch.newSha) : Promise.resolve(null),
        ]);
        const est = estimateBlobDiff(oldObj?.body ?? null, newObj?.body ?? null);
        totalAdd += est.additions;
        totalDel += est.deletions;
        detailedFiles.push({
          filename: ch.filename,
          status: ch.status,
          additions: est.additions,
          deletions: est.deletions,
          patch: est.preview,
        });
      }

      const login =
        parsed.authorEmail.split('@')[0] ||
        parsed.authorName.toLowerCase().replace(/\s+/g, '-');

      const commitData: CommitData = {
        sha: parsed.sha,
        shortSha: parsed.sha.slice(0, 7),
        subject: parsed.subject,
        body: parsed.body,
        authorName: parsed.authorName,
        authorLogin: login,
        timestamp: parsed.timestampIso,
        branch: branchName,
        parents: parsed.parents,
        children: [],
        kind: classifyCommitKind(parsed.subject, parsed.parents.length),
        filesCount: treeChanges.length,
        stats: {
          additions: totalAdd,
          deletions: totalDel,
          total: totalAdd + totalDel,
        },
        files: detailedFiles,
        patchesHydrated: true,
      };

      commitsBySha.set(commitData.sha, commitData);
      uniqueCommits.push(commitData);
      cursorSha = parsed.parents[0];
    }

    if (isCurrent || uniqueCommits.length > 0) {
      const chronological = uniqueCommits.toReversed();
      if (!isCurrent && !forkFromSha && chronological.length > 0) {
        forkFromSha = chronological[0].parents.find((p) => commitsBySha.has(p));
      }
      branches.push({
        name: branchName,
        isDefault: isCurrent || branches.length === 0,
        color: BRANCH_PALETTE[colorIdx % BRANCH_PALETTE.length],
        commits: chronological,
        forkFromSha,
      });
      colorIdx++;
    }
  }

  // Handle brand-new `git init` repository with 0 commits yet
  if (branches.length === 0 || (branches.length === 1 && branches[0].commits.length === 0)) {
    const placeholderSha = '0000000initialvillagefoundation0000000000';
    const placeholder: CommitData = {
      sha: placeholderSha,
      shortSha: 'root',
      subject: 'Empty repository — waiting for first commit at the village gate!',
      body: 'Stage and commit your waiting gate visitors to welcome the very first citizens onto the island.',
      authorName: 'Village Founder',
      authorLogin: 'founder',
      timestamp: new Date().toISOString(),
      branch: defaultBranch,
      parents: [],
      children: [],
      kind: 'feat',
      patchesHydrated: true,
    };
    commitsBySha.set(placeholderSha, placeholder);
    branches.splice(0, branches.length, {
      name: defaultBranch,
      isDefault: true,
      color: BRANCH_PALETTE[0],
      commits: [placeholder],
    });
  }

  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parents) {
      const parent = commitsBySha.get(parentSha);
      if (parent && !parent.children.includes(commit.sha)) {
        parent.children.push(commit.sha);
      }
    }
  }

  for (const b of branches) {
    if (!b.isDefault && b.commits.length > 0) {
      const last = b.commits.at(-1)!;
      b.mergeIntoSha = last.children.find(
        (ch) => commitsBySha.get(ch)?.branch === defaultBranch,
      );
    }
  }

  // Compute Gate Visitors (staged vs unstaged working-tree changes)
  const headCommit = headSha ? rawCommitsBySha.get(headSha) : undefined;
  const headTreeMap = headCommit
    ? await flattenTreeToMap(store, headCommit.treeSha)
    : new Map<string, string>();

  const [indexBytes, gitignoreBytes] = await Promise.all([
    source.readFile('.git/index'),
    source.readFile('.gitignore'),
  ]);

  const indexMap = indexBytes ? parseGitIndex(indexBytes) : new Map<string, GitIndexEntry>();
  const isIgnored = compileGitignoreMatcher(
    gitignoreBytes ? textDecoder.decode(gitignoreBytes) : null,
  );

  const gateVisitors: GateVisitorFile[] = [];
  const recordedPaths = new Set<string>();

  // 1. Staged changes: compare HEAD tree against .git/index
  if (indexBytes) {
    for (const [filePath, idxEntry] of indexMap) {
      const headBlobSha = headTreeMap.get(filePath);
      if (!headBlobSha) {
        const newObj = await store.readObject(idxEntry.sha);
        const est = estimateBlobDiff(null, newObj?.body ?? null);
        gateVisitors.push({
          filename: filePath,
          status: 'added',
          staged: true,
          additions: est.additions,
          deletions: 0,
          diffPreview: est.preview,
        });
        recordedPaths.add(filePath);
      } else if (headBlobSha !== idxEntry.sha) {
        const [oldObj, newObj] = await Promise.all([
          store.readObject(headBlobSha),
          store.readObject(idxEntry.sha),
        ]);
        const est = estimateBlobDiff(oldObj?.body ?? null, newObj?.body ?? null);
        gateVisitors.push({
          filename: filePath,
          status: 'modified',
          staged: true,
          additions: est.additions,
          deletions: est.deletions,
          diffPreview: est.preview,
        });
        recordedPaths.add(filePath);
      }
    }

    for (const [filePath, headBlobSha] of headTreeMap) {
      if (!indexMap.has(filePath)) {
        const oldObj = await store.readObject(headBlobSha);
        const est = estimateBlobDiff(oldObj?.body ?? null, null);
        gateVisitors.push({
          filename: filePath,
          status: 'deleted',
          staged: true,
          additions: 0,
          deletions: est.deletions,
          diffPreview: est.preview,
        });
        recordedPaths.add(filePath);
      }
    }
  }

  // 2. Working tree changes: compare working files against .git/index (or HEAD tree if no index)
  const baselineMap = indexBytes
    ? new Map(Array.from(indexMap, ([k, v]) => [k, v.sha]))
    : headTreeMap;
  const trackedSet = new Set(baselineMap.keys());
  const workFiles = await scanWorkingTreeFiles(source, isIgnored, trackedSet);
  const workSet = new Set(workFiles);

  for (const relPath of workFiles) {
    if (gateVisitors.length >= 48) break;
    const expectedSha = baselineMap.get(relPath);
    const bytes = await source.readFile(relPath);
    if (!bytes) continue;

    if (!expectedSha) {
      if (!recordedPaths.has(relPath)) {
        const est = estimateBlobDiff(null, bytes);
        gateVisitors.push({
          filename: relPath,
          status: 'untracked',
          staged: false,
          additions: est.additions,
          deletions: 0,
          diffPreview: est.preview,
        });
        recordedPaths.add(relPath);
      }
    } else {
      const actualSha = await computeGitBlobSha(bytes);
      if (actualSha !== expectedSha && !recordedPaths.has(relPath)) {
        const baseObj = await store.readObject(expectedSha);
        const est = estimateBlobDiff(baseObj?.body ?? null, bytes);
        gateVisitors.push({
          filename: relPath,
          status: 'modified',
          staged: false,
          additions: est.additions,
          deletions: est.deletions,
          diffPreview: est.preview,
        });
        recordedPaths.add(relPath);
      }
    }
  }

  for (const [trackedPath, expectedSha] of baselineMap) {
    if (gateVisitors.length >= 48) break;
    if (!workSet.has(trackedPath) && !recordedPaths.has(trackedPath)) {
      const baseObj = await store.readObject(expectedSha);
      const est = estimateBlobDiff(baseObj?.body ?? null, null);
      gateVisitors.push({
        filename: trackedPath,
        status: 'deleted',
        staged: false,
        additions: 0,
        deletions: est.deletions,
        diffPreview: est.preview,
      });
      recordedPaths.add(trackedPath);
    }
  }

  const sortedVisitors = gateVisitors.toSorted((a, b) => {
    if (a.staged !== b.staged) return a.staged ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });

  return {
    owner: 'local',
    repo: source.rootName,
    description: `Local repository (${source.rootName}) — read privately in your browser`,
    defaultBranch,
    currentBranch: defaultBranch,
    stars: 0,
    isDemo: false,
    isLocal: true,
    localPath: source.rootName,
    gateVisitors: sortedVisitors,
    branches,
    commitsBySha,
  };
}
