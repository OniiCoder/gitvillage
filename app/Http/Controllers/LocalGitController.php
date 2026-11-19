<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\Process\Process;

class LocalGitController extends Controller
{
    public function discover(): JsonResponse
    {
        $home = $this->homeDirectory();
        $cwd = base_path();
        $parent = dirname($cwd);

        $rootsToScan = array_unique(array_filter([
            $cwd,
            $parent,
            $home ? "{$home}/Documents/webprojects" : null,
            $home ? "{$home}/Desktop" : null,
            $home ? "{$home}/Projects" : null,
            $home ? "{$home}/Developer" : null,
            $home ? "{$home}/Code" : null,
            $home ? "{$home}/Documents" : null,
            $home ? "{$home}/Sites" : null,
            $home ? "{$home}/Herd" : null,
        ]));

        $seen = [];
        $repos = [];

        $current = $this->inspectQuickRepo($cwd);
        if ($current !== null) {
            $seen[$current['path']] = true;
            $repos[] = $current;
        }

        foreach ($rootsToScan as $root) {
            if (count($repos) >= 18 || ! is_dir($root)) {
                continue;
            }

            $entries = @scandir($root);
            if ($entries === false) {
                continue;
            }

            $count = 0;
            foreach ($entries as $entry) {
                if ($count >= 40 || count($repos) >= 18) {
                    break;
                }
                if ($entry === '.' || $entry === '..' || str_starts_with($entry, '.')) {
                    continue;
                }
                $sub = $root.DIRECTORY_SEPARATOR.$entry;
                if (! is_dir($sub) || isset($seen[$sub])) {
                    continue;
                }
                $count++;
                $info = $this->inspectQuickRepo($sub);
                if ($info !== null && ! isset($seen[$info['path']])) {
                    $seen[$info['path']] = true;
                    $repos[] = $info;
                }
            }
        }

        return response()->json(['repos' => $repos]);
    }

    public function browse(Request $request): JsonResponse
    {
        $rawPath = (string) $request->query('path', dirname(base_path()));
        $showHidden = $request->query('hidden') === '1';
        $dirPath = $this->resolveUserPath($rawPath);

        if (! is_dir($dirPath)) {
            return response()->json(['error' => "Not a directory: {$dirPath}"], 400);
        }

        $entries = @scandir($dirPath);
        if ($entries === false) {
            return response()->json(['error' => "Cannot read directory: {$dirPath}"], 400);
        }

        $folders = [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            if (! $showHidden && str_starts_with($entry, '.')) {
                continue;
            }
            if ($entry === 'node_modules' || $entry === 'vendor') {
                continue;
            }
            $full = rtrim($dirPath, DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$entry;
            if (! is_dir($full)) {
                continue;
            }
            $folders[] = [
                'name' => $entry,
                'path' => $full,
                'isGitRepo' => $this->hasGitEntry($full),
            ];
            if (count($folders) >= 160) {
                break;
            }
        }

        usort($folders, function (array $a, array $b): int {
            if ($a['isGitRepo'] !== $b['isGitRepo']) {
                return $a['isGitRepo'] ? -1 : 1;
            }

            return strcasecmp($a['name'], $b['name']);
        });

        $currentGitRepo = $this->inspectQuickRepo($dirPath);
        if ($currentGitRepo === null) {
            $topResult = $this->runGit($dirPath, ['rev-parse', '--show-toplevel']);
            if ($topResult['ok'] && $topResult['stdout'] !== '') {
                $currentGitRepo = $this->inspectQuickRepo(trim($topResult['stdout']));
            }
        }

        $home = $this->homeDirectory();
        $candidateRoots = [
            ['label' => 'webprojects', 'path' => $home ? "{$home}/Documents/webprojects" : ''],
            ['label' => 'Workspace', 'path' => dirname(base_path())],
            ['label' => 'Home', 'path' => $home],
            ['label' => 'Herd', 'path' => $home ? "{$home}/Herd" : ''],
            ['label' => 'Projects', 'path' => $home ? "{$home}/Projects" : ''],
            ['label' => 'Developer', 'path' => $home ? "{$home}/Developer" : ''],
            ['label' => 'Desktop', 'path' => $home ? "{$home}/Desktop" : ''],
            ['label' => 'Documents', 'path' => $home ? "{$home}/Documents" : ''],
        ];

        $roots = [];
        $seenRoots = [];
        foreach ($candidateRoots as $cand) {
            if ($cand['path'] !== '' && is_dir($cand['path']) && ! isset($seenRoots[$cand['path']])) {
                $seenRoots[$cand['path']] = true;
                $roots[] = $cand;
            }
        }

        $breadcrumbs = [];
        if ($home !== '' && ($dirPath === $home || str_starts_with($dirPath, $home.DIRECTORY_SEPARATOR))) {
            $breadcrumbs[] = ['label' => '~', 'path' => $home];
            $rel = trim(substr($dirPath, strlen($home)), DIRECTORY_SEPARATOR);
            $parts = $rel === '' ? [] : explode(DIRECTORY_SEPARATOR, $rel);
            $acc = $home;
            foreach ($parts as $part) {
                $acc .= DIRECTORY_SEPARATOR.$part;
                $breadcrumbs[] = ['label' => $part, 'path' => $acc];
            }
        } else {
            $breadcrumbs[] = ['label' => '/', 'path' => DIRECTORY_SEPARATOR];
            $parts = array_values(array_filter(explode(DIRECTORY_SEPARATOR, $dirPath)));
            $acc = '';
            foreach ($parts as $part) {
                $acc .= DIRECTORY_SEPARATOR.$part;
                $breadcrumbs[] = ['label' => $part, 'path' => $acc];
            }
        }

        $parentDir = dirname($dirPath);

        return response()->json([
            'currentPath' => $dirPath,
            'displayPath' => $this->formatDisplayPath($dirPath),
            'parentPath' => $parentDir !== $dirPath ? $parentDir : null,
            'currentGitRepo' => $currentGitRepo,
            'breadcrumbs' => $breadcrumbs,
            'roots' => $roots,
            'folders' => $folders,
        ]);
    }

    public function pickNativeFolder(): JsonResponse
    {
        if (PHP_OS_FAMILY !== 'Darwin') {
            return response()->json(['error' => 'Native macOS Finder dialog is only supported on macOS.'], 400);
        }

        $script = 'POSIX path of (choose folder with prompt "Select a local Git repository folder:")';
        $process = new Process(['osascript', '-e', $script]);
        $process->setTimeout(120);
        $process->run();

        if (! $process->isSuccessful()) {
            $stderr = $process->getErrorOutput();
            if (str_contains($stderr, '-128') || stripos($stderr, 'User canceled') !== false) {
                return response()->json(['cancelled' => true]);
            }

            return response()->json(['error' => 'Could not open macOS Finder folder chooser.'], 400);
        }

        $chosen = rtrim(trim($process->getOutput()), '/');

        return response()->json(['path' => $chosen !== '' ? $chosen : '/']);
    }

    public function inspect(Request $request): JsonResponse
    {
        $rawPath = (string) $request->query('path', '.');
        $requestedBranch = trim((string) $request->query('branch', ''));
        $resolved = $this->resolveUserPath($rawPath);

        $topRes = $this->runGit($resolved, ['rev-parse', '--show-toplevel']);
        if (! $topRes['ok'] || trim($topRes['stdout']) === '') {
            return response()->json(['error' => "Not a git repository: {$resolved}"], 400);
        }

        $topLevel = trim($topRes['stdout']);
        $repoName = basename($topLevel);
        $ownerName = basename(dirname($topLevel)) ?: 'local';

        $headRes = $this->runGit($topLevel, ['symbolic-ref', '--short', 'HEAD']);
        $headBranch = $headRes['ok'] && trim($headRes['stdout']) !== ''
            ? trim($headRes['stdout'])
            : 'detached-HEAD';

        $refsRes = $this->runGit($topLevel, [
            'for-each-ref',
            '--sort=-committerdate',
            '--format=%(refname:short)',
            'refs/heads/',
        ]);
        $branchNames = $refsRes['ok']
            ? array_values(array_filter(array_map('trim', explode("\n", $refsRes['stdout']))))
            : [];

        if ($headBranch !== 'detached-HEAD' && ! in_array($headBranch, $branchNames, true)) {
            array_unshift($branchNames, $headBranch);
        } elseif (in_array($headBranch, $branchNames, true)) {
            $branchNames = array_values(array_unique(array_merge([$headBranch], $branchNames)));
        }

        $activeBranch = ($requestedBranch !== '' && in_array($requestedBranch, $branchNames, true))
            ? $requestedBranch
            : $headBranch;

        $mergeState = $this->detectMergeState($topLevel, $branchNames);
        $theirsBranch = $mergeState['theirsBranch'] ?? null;

        $priorityBranches = [];
        if ($activeBranch !== 'detached-HEAD') {
            $priorityBranches[] = $activeBranch;
        }
        if ($theirsBranch !== null && in_array($theirsBranch, $branchNames, true)) {
            $priorityBranches[] = $theirsBranch;
        }

        $orderedBranches = $priorityBranches !== []
            ? array_values(array_unique(array_merge($priorityBranches, $branchNames)))
            : $branchNames;
        $selectedBranches = array_slice($orderedBranches, 0, 6);

        $branchesPayload = [];
        foreach ($selectedBranches as $bName) {
            $isCurrent = $bName === $activeBranch;
            $limit = $isCurrent ? 22 : 8;
            $commits = $this->parseBranchLog($topLevel, $bName, $limit);
            $branchesPayload[] = [
                'name' => $bName,
                'isCurrent' => $isCurrent,
                'commits' => $commits,
            ];
        }

        if ($branchesPayload === [] && $activeBranch === 'detached-HEAD') {
            $commits = $this->parseBranchLog($topLevel, 'HEAD', 22);
            if ($commits !== []) {
                $branchesPayload[] = [
                    'name' => 'HEAD',
                    'isCurrent' => true,
                    'commits' => $commits,
                ];
            }
        }

        $gateVisitors = $this->collectGateVisitors(
            $topLevel,
            $headBranch !== 'detached-HEAD' ? $headBranch : 'HEAD',
            $theirsBranch ?? 'incoming-branch'
        );

        $conflictedCount = count(array_filter(
            $gateVisitors,
            static fn (array $v): bool => ($v['status'] ?? '') === 'conflicted'
        ));

        $mergeConflict = ($mergeState !== null || $conflictedCount > 0) && $activeBranch === $headBranch
            ? [
                'active' => true,
                'oursBranch' => $headBranch !== 'detached-HEAD' ? $headBranch : 'HEAD',
                'theirsBranch' => $theirsBranch ?? 'incoming-branch',
                'conflictedCount' => max(1, $conflictedCount),
                'mergeHeadSha' => $mergeState['mergeHeadSha'] ?? null,
            ]
            : null;

        return response()->json([
            'owner' => $ownerName,
            'repo' => $repoName,
            'localPath' => $topLevel,
            'currentBranch' => $activeBranch,
            'headBranch' => $headBranch,
            'allBranches' => array_slice($branchNames, 0, 60),
            'branches' => $branchesPayload,
            'gateVisitors' => array_slice($gateVisitors, 0, 48),
            'totalChangedFiles' => count($gateVisitors),
            'mergeConflict' => $mergeConflict,
        ]);
    }

    public function checkout(Request $request): JsonResponse
    {
        $rawPath = (string) $request->input('path', '.');
        $branch = trim((string) $request->input('branch', ''));

        if ($branch === '' || str_starts_with($branch, '-') || str_contains($branch, '..')) {
            return response()->json(['error' => 'Invalid branch name.'], 422);
        }

        $resolved = $this->resolveUserPath($rawPath);
        $topRes = $this->runGit($resolved, ['rev-parse', '--show-toplevel']);
        if (! $topRes['ok'] || trim($topRes['stdout']) === '') {
            return response()->json(['error' => "Not a git repository: {$resolved}"], 400);
        }
        $topLevel = trim($topRes['stdout']);

        $verifyRes = $this->runGit($topLevel, ['show-ref', '--verify', '--quiet', "refs/heads/{$branch}"]);
        if (! $verifyRes['ok']) {
            return response()->json(['error' => "Branch '{$branch}' does not exist locally."], 404);
        }

        $process = new Process(['git', 'checkout', $branch], $topLevel);
        $process->setTimeout(8);
        $process->run();

        if (! $process->isSuccessful()) {
            $err = trim($process->getErrorOutput()) ?: "Could not switch HEAD to {$branch}.";

            return response()->json(['error' => $err], 422);
        }

        return response()->json([
            'ok' => true,
            'branch' => $branch,
        ]);
    }

    public function commitDetail(Request $request): JsonResponse
    {
        $rawPath = (string) $request->query('path', '.');
        $sha = (string) $request->query('sha', '');
        if (! preg_match('/^[0-9a-f]{6,40}$/i', $sha)) {
            return response()->json(['error' => 'Invalid commit SHA.'], 400);
        }

        $resolved = $this->resolveUserPath($rawPath);
        $topRes = $this->runGit($resolved, ['rev-parse', '--show-toplevel']);
        if (! $topRes['ok']) {
            return response()->json(['error' => 'Not a git repository.'], 400);
        }
        $topLevel = trim($topRes['stdout']);

        $statRes = $this->runGit($topLevel, [
            'show',
            '-m',
            '--first-parent',
            '--numstat',
            '-z',
            '--find-renames',
            '--no-ext-diff',
            '--format=',
            $sha,
        ]);
        $nameRes = $this->runGit($topLevel, [
            'show',
            '-m',
            '--first-parent',
            '--name-status',
            '-z',
            '--find-renames',
            '--no-ext-diff',
            '--format=',
            $sha,
        ]);
        $patchRes = $this->runGit($topLevel, [
            'show',
            '-m',
            '--first-parent',
            '--patch',
            '--unified=3',
            '--no-color',
            '--no-ext-diff',
            '--find-renames',
            '--format=',
            $sha,
        ]);

        $statusMap = [];
        if ($nameRes['ok'] && $nameRes['stdout'] !== '') {
            $nTokens = explode("\0", $nameRes['stdout']);
            $nCount = count($nTokens);
            for ($i = 0; $i < $nCount; $i++) {
                $codeToken = ltrim($nTokens[$i], "\r\n");
                if ($codeToken === '') {
                    continue;
                }
                $code = $codeToken[0];
                if ($code === 'R' || $code === 'C') {
                    $oldFile = $nTokens[++$i] ?? '';
                    $newFile = $nTokens[++$i] ?? '';
                    if ($newFile !== '') {
                        $statusMap[$newFile] = [
                            'status' => 'renamed',
                            'previousFilename' => $oldFile !== '' ? $oldFile : null,
                        ];
                    }
                } else {
                    $file = $nTokens[++$i] ?? '';
                    if ($file !== '') {
                        $statusMap[$file] = [
                            'status' => match ($code) {
                                'A' => 'added',
                                'D' => 'removed',
                                default => 'modified',
                            },
                            'previousFilename' => null,
                        ];
                    }
                }
            }
        }

        $patchMap = $patchRes['ok'] ? $this->parseUnifiedPatchMap($patchRes['stdout']) : [];

        $files = [];
        $totalAdd = 0;
        $totalDel = 0;
        if ($statRes['ok'] && $statRes['stdout'] !== '') {
            $sTokens = explode("\0", $statRes['stdout']);
            $sCount = count($sTokens);
            for ($i = 0; $i < $sCount; $i++) {
                $token = ltrim($sTokens[$i], "\r\n");
                if ($token === '') {
                    continue;
                }
                $parts = explode("\t", $token, 3);
                if (count($parts) < 3) {
                    continue;
                }
                $add = is_numeric($parts[0]) ? (int) $parts[0] : 0;
                $del = is_numeric($parts[1]) ? (int) $parts[1] : 0;
                $prevName = null;
                if ($parts[2] === '') {
                    $prevName = $sTokens[++$i] ?? null;
                    $fname = $sTokens[++$i] ?? ($prevName ?? '');
                } else {
                    $fname = $parts[2];
                }
                if ($fname === '') {
                    continue;
                }

                $totalAdd += $add;
                $totalDel += $del;
                $meta = $statusMap[$fname] ?? null;
                $entry = [
                    'filename' => $fname,
                    'status' => $meta['status'] ?? ($prevName !== null ? 'renamed' : 'modified'),
                    'additions' => $add,
                    'deletions' => $del,
                    'patch' => $patchMap[$fname] ?? ($prevName !== null ? ($patchMap[$prevName] ?? null) : null),
                ];
                $resolvedPrev = $meta['previousFilename'] ?? $prevName;
                if ($resolvedPrev !== null && $resolvedPrev !== '') {
                    $entry['previousFilename'] = $resolvedPrev;
                }
                $files[] = $entry;
            }
        }

        return response()->json([
            'stats' => [
                'additions' => $totalAdd,
                'deletions' => $totalDel,
                'total' => $totalAdd + $totalDel,
            ],
            'files' => array_slice($files, 0, 45),
        ]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function parseBranchLog(string $cwd, string $ref, int $limit): array
    {
        $res = $this->runGit($cwd, [
            'log',
            $ref,
            '-n',
            (string) $limit,
            '--numstat',
            '--format=___COMMIT___%x1f%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b___ENDMSG___',
        ]);

        if (! $res['ok'] || trim($res['stdout']) === '') {
            return [];
        }

        $commits = [];
        $chunks = array_filter(explode('___COMMIT___', $res['stdout']));
        foreach ($chunks as $chunk) {
            $msgParts = explode('___ENDMSG___', $chunk, 2);
            $metaPart = ltrim($msgParts[0] ?? '', "\x1f");
            $statPart = trim($msgParts[1] ?? '');

            $fields = explode("\x1f", $metaPart);
            $sha = trim($fields[0] ?? '');
            if ($sha === '') {
                continue;
            }

            $parentsRaw = trim($fields[1] ?? '');
            $parents = $parentsRaw !== '' ? preg_split('/\s+/', $parentsRaw) ?: [] : [];

            $files = [];
            $totalAdd = 0;
            $totalDel = 0;
            if ($statPart !== '') {
                foreach (explode("\n", $statPart) as $sLine) {
                    $sLine = trim($sLine);
                    if ($sLine === '') {
                        continue;
                    }
                    $cols = explode("\t", $sLine);
                    if (count($cols) < 3) {
                        continue;
                    }
                    $add = is_numeric($cols[0]) ? (int) $cols[0] : 0;
                    $del = is_numeric($cols[1]) ? (int) $cols[1] : 0;
                    $fname = implode("\t", array_slice($cols, 2));
                    $totalAdd += $add;
                    $totalDel += $del;
                    $files[] = [
                        'filename' => $fname,
                        'status' => 'modified',
                        'additions' => $add,
                        'deletions' => $del,
                    ];
                }
            }

            $commits[] = [
                'sha' => $sha,
                'parents' => $parents,
                'authorName' => trim($fields[2] ?? 'Contributor'),
                'authorEmail' => trim($fields[3] ?? 'dev@local'),
                'timestamp' => trim($fields[4] ?? gmdate('c')),
                'subject' => trim($fields[5] ?? 'Commit'),
                'body' => trim($fields[6] ?? ''),
                'filesCount' => count($files),
                'stats' => [
                    'additions' => $totalAdd,
                    'deletions' => $totalDel,
                    'total' => $totalAdd + $totalDel,
                ],
                'files' => array_slice($files, 0, 25),
            ];
        }

        return $commits;
    }

    /**
     * @param  array<int, string>  $branchNames
     * @return array{mergeHeadSha: string, theirsBranch: string|null}|null
     */
    private function detectMergeState(string $topLevel, array $branchNames): ?array
    {
        $headPathRes = $this->runGit($topLevel, ['rev-parse', '--git-path', 'MERGE_HEAD']);
        if (! $headPathRes['ok'] || trim($headPathRes['stdout']) === '') {
            return null;
        }
        $rawHeadPath = trim($headPathRes['stdout']);
        $mergeHeadFile = str_starts_with($rawHeadPath, DIRECTORY_SEPARATOR)
            ? $rawHeadPath
            : $topLevel.DIRECTORY_SEPARATOR.$rawHeadPath;

        if (! is_file($mergeHeadFile)) {
            return null;
        }

        $headLines = explode("\n", trim((string) @file_get_contents($mergeHeadFile)));
        $mergeHeadSha = strtolower(trim($headLines[0] ?? ''));
        if (! preg_match('/^[0-9a-f]{40}$/', $mergeHeadSha)) {
            return null;
        }

        $theirsBranch = null;
        $msgPathRes = $this->runGit($topLevel, ['rev-parse', '--git-path', 'MERGE_MSG']);
        if ($msgPathRes['ok'] && trim($msgPathRes['stdout']) !== '') {
            $rawMsgPath = trim($msgPathRes['stdout']);
            $mergeMsgFile = str_starts_with($rawMsgPath, DIRECTORY_SEPARATOR)
                ? $rawMsgPath
                : $topLevel.DIRECTORY_SEPARATOR.$rawMsgPath;
            if (is_file($mergeMsgFile)) {
                $firstLine = strtok((string) @file_get_contents($mergeMsgFile), "\r\n") ?: '';
                if (preg_match("/Merge (?:remote-tracking )?branch '([^']+)'/", $firstLine, $m)) {
                    $candidate = $m[1];
                    if (str_starts_with($candidate, 'origin/') && in_array(substr($candidate, 7), $branchNames, true)) {
                        $candidate = substr($candidate, 7);
                    }
                    $theirsBranch = $candidate;
                }
            }
        }

        if ($theirsBranch === null) {
            foreach ($branchNames as $bName) {
                $tipRes = $this->runGit($topLevel, ['rev-parse', "refs/heads/{$bName}"]);
                if ($tipRes['ok'] && strtolower(trim($tipRes['stdout'])) === $mergeHeadSha) {
                    $theirsBranch = $bName;
                    break;
                }
            }
        }

        if ($theirsBranch === null) {
            $nameRev = $this->runGit($topLevel, ['name-rev', '--name-only', '--no-undefined', $mergeHeadSha]);
            if ($nameRev['ok'] && trim($nameRev['stdout']) !== '') {
                $clean = preg_replace('/^remotes\/origin\//', '', trim($nameRev['stdout']));
                $clean = preg_replace('/[~^].*$/', '', (string) $clean);
                if ($clean !== '') {
                    $theirsBranch = $clean;
                }
            }
        }

        return [
            'mergeHeadSha' => $mergeHeadSha,
            'theirsBranch' => $theirsBranch ?: substr($mergeHeadSha, 0, 7),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function collectGateVisitors(
        string $topLevel,
        string $oursLabel = 'HEAD',
        string $theirsLabel = 'incoming',
    ): array {
        $statusRes = $this->runGit($topLevel, ['status', '--porcelain=v1', '-z', '-uall']);
        if (! $statusRes['ok'] || $statusRes['stdout'] === '') {
            return [];
        }

        $unstagedStats = $this->parseNumstatMap($topLevel, ['diff', '--numstat']);
        $stagedStats = $this->parseNumstatMap($topLevel, ['diff', '--cached', '--numstat']);

        $tokens = explode("\0", $statusRes['stdout']);
        $visitors = [];
        $count = count($tokens);

        for ($i = 0; $i < $count; $i++) {
            $entry = $tokens[$i];
            if (strlen($entry) < 4) {
                continue;
            }
            $xy = substr($entry, 0, 2);
            $x = $xy[0];
            $y = $xy[1];
            $filepath = substr($entry, 3);

            if ($x === 'R' || $x === 'C' || $y === 'R' || $y === 'C') {
                $i++;
            }

            $isUnmerged = $x === 'U' || $y === 'U' || $xy === 'AA' || $xy === 'DD';
            $staged = ! $isUnmerged && $x !== ' ' && $x !== '?' && $x !== '!';
            $code = $xy === '??' ? '?' : ($staged ? $x : $y);
            $status = $isUnmerged ? 'conflicted' : match ($code) {
                '?' => 'untracked',
                'A' => 'added',
                'D' => 'deleted',
                'R' => 'renamed',
                default => 'modified',
            };

            $add = ($stagedStats[$filepath]['add'] ?? 0) + ($unstagedStats[$filepath]['add'] ?? 0);
            $del = ($stagedStats[$filepath]['del'] ?? 0) + ($unstagedStats[$filepath]['del'] ?? 0);
            $preview = null;
            $conflict = null;

            if ($status === 'conflicted') {
                $extracted = $this->extractConflictedFileDetails(
                    $topLevel,
                    $filepath,
                    $oursLabel,
                    $theirsLabel
                );
                $conflict = $extracted['conflict'];
                $preview = $extracted['diffPreview'];
                $add = max($add, $extracted['additions']);
                $del = max($del, $extracted['deletions']);
            } elseif ($status === 'untracked') {
                $abs = $topLevel.DIRECTORY_SEPARATOR.$filepath;
                if (is_file($abs) && filesize($abs) <= 96_000) {
                    $raw = (string) @file_get_contents($abs);
                    if (! str_contains(substr($raw, 0, 512), "\0")) {
                        $lines = explode("\n", rtrim($raw, "\n"));
                        $add = count($lines);
                        $sample = array_slice($lines, 0, 60);
                        $shown = count($sample);
                        $preview = "@@ -0,0 +1,{$shown} @@\n".implode("\n", array_map(fn ($l) => '+'.$l, $sample));
                    }
                }
            } else {
                $diffArgs = $staged
                    ? ['diff', '--cached', '--unified=3', '--no-color', '--no-ext-diff', '--', $filepath]
                    : ['diff', '--unified=3', '--no-color', '--no-ext-diff', '--', $filepath];
                $diffRes = $this->runGit($topLevel, $diffArgs);
                if ($diffRes['ok'] && trim($diffRes['stdout']) !== '') {
                    $dLines = explode("\n", rtrim($diffRes['stdout'], "\r\n"));
                    $hunkIdx = 0;
                    foreach ($dLines as $idx => $dl) {
                        if (str_starts_with($dl, '@@')) {
                            $hunkIdx = $idx;
                            break;
                        }
                    }
                    $preview = implode("\n", array_slice($dLines, $hunkIdx, 80));
                }
            }

            $visitorItem = [
                'filename' => $filepath,
                'status' => $status,
                'staged' => $staged,
                'additions' => $add,
                'deletions' => $del,
                'diffPreview' => $preview,
            ];
            if ($conflict !== null) {
                $visitorItem['conflict'] = $conflict;
            }
            $visitors[] = $visitorItem;
        }

        return $visitors;
    }

    /**
     * @return array{conflict: array<string, mixed>, diffPreview: string, additions: int, deletions: int}
     */
    private function extractConflictedFileDetails(
        string $topLevel,
        string $filepath,
        string $oursLabel,
        string $theirsLabel,
    ): array {
        $abs = $topLevel.DIRECTORY_SEPARATOR.$filepath;
        if (is_file($abs) && filesize($abs) <= 128_000) {
            $raw = (string) @file_get_contents($abs);
            if (! str_contains(substr($raw, 0, 512), "\0")) {
                $lines = explode("\n", str_replace("\r\n", "\n", $raw));
                $lineCount = count($lines);
                $hunks = [];
                $idx = 0;

                while ($idx < $lineCount) {
                    if (! str_starts_with($lines[$idx], '<<<<<<<')) {
                        $idx++;

                        continue;
                    }
                    $startLine = $idx + 1;
                    $hOursLabel = trim(substr($lines[$idx], 7)) ?: $oursLabel;
                    $ctxBefore = array_slice($lines, max(0, $idx - 2), min(2, $idx));
                    $oursLines = [];
                    $theirsLines = [];
                    $state = 'ours';
                    $hTheirsLabel = $theirsLabel;
                    $foundEnd = false;
                    $idx++;

                    while ($idx < $lineCount) {
                        $cur = $lines[$idx];
                        if ($state === 'ours' && str_starts_with($cur, '|||||||')) {
                            $state = 'base';
                        } elseif (($state === 'ours' || $state === 'base') && str_starts_with($cur, '=======')) {
                            $state = 'theirs';
                        } elseif ($state === 'theirs' && str_starts_with($cur, '>>>>>>>')) {
                            $hTheirsLabel = trim(substr($cur, 7)) ?: $theirsLabel;
                            $foundEnd = true;
                            $idx++;
                            break;
                        } elseif ($state === 'ours') {
                            $oursLines[] = $cur;
                        } elseif ($state === 'theirs') {
                            $theirsLines[] = $cur;
                        }
                        $idx++;
                    }

                    if ($foundEnd) {
                        $ctxAfter = array_slice($lines, $idx, 2);
                        $hunks[] = [
                            'startLine' => $startLine,
                            'oursLabel' => $hOursLabel,
                            'theirsLabel' => $hTheirsLabel,
                            'ctxBefore' => $ctxBefore,
                            'oursLines' => $oursLines,
                            'theirsLines' => $theirsLines,
                            'ctxAfter' => $ctxAfter,
                        ];
                    }
                }

                if ($hunks !== []) {
                    $oursBlocks = [];
                    $theirsBlocks = [];
                    $previewLines = [];
                    $totalOurs = 0;
                    $totalTheirs = 0;
                    $hunkTotal = count($hunks);

                    foreach (array_slice($hunks, 0, 6) as $hIdx => $h) {
                        $totalOurs += count($h['oursLines']);
                        $totalTheirs += count($h['theirsLines']);
                        $num = $hIdx + 1;
                        $hdr = $hunkTotal > 1
                            ? "// Conflict #{$num} (line {$h['startLine']})"
                            : "// Line {$h['startLine']}";
                        $oursBlocks[] = implode("\n", array_merge([$hdr], $h['ctxBefore'], $h['oursLines'], $h['ctxAfter']));
                        $theirsBlocks[] = implode("\n", array_merge([$hdr], $h['ctxBefore'], $h['theirsLines'], $h['ctxAfter']));

                        $oldSpan = count($h['ctxBefore']) + count($h['oursLines']) + count($h['ctxAfter']);
                        $newSpan = count($h['ctxBefore']) + count($h['theirsLines']) + count($h['ctxAfter']);
                        $previewLines[] = "@@ -{$h['startLine']},{$oldSpan} +{$h['startLine']},{$newSpan} @@ Conflict #{$num}";
                        foreach ($h['ctxBefore'] as $c) {
                            $previewLines[] = ' '.$c;
                        }
                        $previewLines[] = '<<<<<<< '.$h['oursLabel'];
                        foreach ($h['oursLines'] as $ol) {
                            $previewLines[] = '-'.$ol;
                        }
                        $previewLines[] = '=======';
                        foreach ($h['theirsLines'] as $tl) {
                            $previewLines[] = '+'.$tl;
                        }
                        $previewLines[] = '>>>>>>> '.$h['theirsLabel'];
                        foreach ($h['ctxAfter'] as $c) {
                            $previewLines[] = ' '.$c;
                        }
                    }

                    return [
                        'conflict' => [
                            'oursLabel' => $hunks[0]['oursLabel'],
                            'theirsLabel' => $hunks[0]['theirsLabel'],
                            'oursContent' => substr(implode("\n\n", $oursBlocks), 0, 8000),
                            'theirsContent' => substr(implode("\n\n", $theirsBlocks), 0, 8000),
                            'conflictMarkersCount' => $hunkTotal,
                        ],
                        'diffPreview' => substr(implode("\n", $previewLines), 0, 10000),
                        'additions' => max(1, $totalTheirs),
                        'deletions' => max(1, $totalOurs),
                    ];
                }
            }
        }

        // Stage :2: (ours) vs :3: (theirs) fallback for modify/delete or binary conflicts
        $stage2 = $this->runGit($topLevel, ['show', ":2:{$filepath}"]);
        $stage3 = $this->runGit($topLevel, ['show', ":3:{$filepath}"]);
        $oursRaw = $stage2['ok'] ? rtrim(str_replace("\r\n", "\n", $stage2['stdout']), "\n") : '(deleted on HEAD)';
        $theirsRaw = $stage3['ok'] ? rtrim(str_replace("\r\n", "\n", $stage3['stdout']), "\n") : '(deleted on incoming branch)';
        $oursSample = array_slice(explode("\n", $oursRaw), 0, 40);
        $theirsSample = array_slice(explode("\n", $theirsRaw), 0, 40);

        $preview = implode("\n", array_merge(
            ['@@ -1,'.count($oursSample).' +1,'.count($theirsSample).' @@ Unmerged index stages'],
            ['<<<<<<< '.$oursLabel],
            array_map(static fn (string $l): string => '-'.$l, $oursSample),
            ['======='],
            array_map(static fn (string $l): string => '+'.$l, $theirsSample),
            ['>>>>>>> '.$theirsLabel]
        ));

        return [
            'conflict' => [
                'oursLabel' => $oursLabel,
                'theirsLabel' => $theirsLabel,
                'oursContent' => implode("\n", $oursSample),
                'theirsContent' => implode("\n", $theirsSample),
                'conflictMarkersCount' => 1,
            ],
            'diffPreview' => substr($preview, 0, 10000),
            'additions' => max(1, count($theirsSample)),
            'deletions' => max(1, count($oursSample)),
        ];
    }

    /**
     * @return array<string, string>
     */
    private function parseUnifiedPatchMap(string $rawPatch): array
    {
        if (trim($rawPatch) === '') {
            return [];
        }

        $chunks = explode("\ndiff --git ", "\n".$rawPatch);
        array_shift($chunks);
        $map = [];

        foreach ($chunks as $chunk) {
            $lines = explode("\n", $chunk);
            $headerLine = $lines[0] ?? '';
            $renameFrom = '';
            $renameTo = '';
            $minusPath = '';
            $plusPath = '';
            $isBinary = false;
            $hunkStart = null;

            $lineCount = count($lines);
            for ($i = 1; $i < $lineCount; $i++) {
                $line = $lines[$i];
                if (str_starts_with($line, '@@ ')) {
                    $hunkStart = $i;
                    break;
                }
                if (str_starts_with($line, 'rename from ')) {
                    $renameFrom = $this->unquoteGitPath(substr($line, 12));
                } elseif (str_starts_with($line, 'rename to ')) {
                    $renameTo = $this->unquoteGitPath(substr($line, 10));
                } elseif (str_starts_with($line, '--- ')) {
                    $rawMinus = $this->unquoteGitPath(substr($line, 4));
                    $minusPath = str_starts_with($rawMinus, 'a/') ? substr($rawMinus, 2) : $rawMinus;
                } elseif (str_starts_with($line, '+++ ')) {
                    $rawPlus = $this->unquoteGitPath(substr($line, 4));
                    $plusPath = str_starts_with($rawPlus, 'b/') ? substr($rawPlus, 2) : $rawPlus;
                } elseif (str_starts_with($line, 'Binary files ')) {
                    $isBinary = true;
                }
            }

            $fileKey = $renameTo !== ''
                ? $renameTo
                : ($plusPath !== '' && $plusPath !== '/dev/null' ? $plusPath : $minusPath);

            if (($fileKey === '' || $fileKey === '/dev/null') && preg_match('/ b\/(.+)$/', $headerLine, $m)) {
                $fileKey = $this->unquoteGitPath($m[1]);
            }

            if ($fileKey === '' || $fileKey === '/dev/null') {
                continue;
            }

            $patchText = '';
            if ($hunkStart !== null) {
                $patchText = rtrim(implode("\n", array_slice($lines, $hunkStart)), "\r\n");
                $patchText = $this->truncatePatch($patchText, 12_000);
            } elseif ($isBinary) {
                $patchText = 'Binary file changed';
            } elseif ($renameFrom !== '' && $renameTo !== '') {
                $patchText = "Renamed from {$renameFrom} to {$renameTo} (0 line changes)";
            }

            if ($patchText !== '') {
                $map[$fileKey] = $patchText;
            }
        }

        return $map;
    }

    private function unquoteGitPath(string $raw): string
    {
        $trimmed = trim($raw);
        if (strlen($trimmed) >= 2 && $trimmed[0] === '"' && str_ends_with($trimmed, '"')) {
            return stripcslashes(substr($trimmed, 1, -1));
        }

        return $trimmed;
    }

    private function truncatePatch(string $patch, int $maxChars): string
    {
        if (strlen($patch) <= $maxChars) {
            return $patch;
        }
        $slice = substr($patch, 0, $maxChars);
        $lastNewline = strrpos($slice, "\n");
        if ($lastNewline !== false && $lastNewline > 0) {
            $slice = substr($slice, 0, $lastNewline);
        }

        return $slice."\n… diff truncated for large file …";
    }

    /**
     * @param  array<int, string>  $args
     * @return array<string, array{add: int, del: int}>
     */
    private function parseNumstatMap(string $cwd, array $args): array
    {
        $res = $this->runGit($cwd, $args);
        if (! $res['ok'] || trim($res['stdout']) === '') {
            return [];
        }
        $map = [];
        foreach (explode("\n", trim($res['stdout'])) as $line) {
            $cols = explode("\t", $line);
            if (count($cols) < 3) {
                continue;
            }
            $fname = implode("\t", array_slice($cols, 2));
            $map[$fname] = [
                'add' => is_numeric($cols[0]) ? (int) $cols[0] : 0,
                'del' => is_numeric($cols[1]) ? (int) $cols[1] : 0,
            ];
        }

        return $map;
    }

    /**
     * @return array{name: string, path: string, displayPath: string, branch: string, changedFilesCount: int}|null
     */
    private function inspectQuickRepo(string $dirPath): ?array
    {
        if (! $this->hasGitEntry($dirPath)) {
            return null;
        }
        $branchRes = $this->runGit($dirPath, ['symbolic-ref', '--short', 'HEAD']);
        $branch = $branchRes['ok'] && trim($branchRes['stdout']) !== '' ? trim($branchRes['stdout']) : 'HEAD';

        $statusRes = $this->runGit($dirPath, ['status', '--porcelain=v1', '-uall']);
        $changedCount = 0;
        if ($statusRes['ok'] && trim($statusRes['stdout']) !== '') {
            $changedCount = count(array_filter(explode("\n", rtrim($statusRes['stdout'], "\n"))));
        }

        return [
            'name' => basename($dirPath),
            'path' => $dirPath,
            'displayPath' => $this->formatDisplayPath($dirPath),
            'branch' => $branch,
            'changedFilesCount' => $changedCount,
        ];
    }

    private function hasGitEntry(string $dirPath): bool
    {
        return file_exists($dirPath.DIRECTORY_SEPARATOR.'.git');
    }

    private function resolveUserPath(string $rawPath): string
    {
        $trimmed = trim($rawPath);
        if ($trimmed === '' || $trimmed === '.') {
            return base_path();
        }
        $home = $this->homeDirectory();
        if ($trimmed === '~' && $home !== '') {
            return $home;
        }
        if (str_starts_with($trimmed, '~/') && $home !== '') {
            return $home.DIRECTORY_SEPARATOR.substr($trimmed, 2);
        }
        if (str_starts_with($trimmed, '/')) {
            return realpath($trimmed) ?: $trimmed;
        }
        $candidate = base_path($trimmed);

        return realpath($candidate) ?: $candidate;
    }

    private function formatDisplayPath(string $fullPath): string
    {
        $home = $this->homeDirectory();
        if ($home !== '' && $fullPath === $home) {
            return '~';
        }
        if ($home !== '' && str_starts_with($fullPath, $home.DIRECTORY_SEPARATOR)) {
            return '~/'.substr($fullPath, strlen($home) + 1);
        }

        return $fullPath;
    }

    private function homeDirectory(): string
    {
        $home = getenv('HOME') ?: ($_SERVER['HOME'] ?? '');

        return is_string($home) ? rtrim($home, DIRECTORY_SEPARATOR) : '';
    }

    /**
     * @param  array<int, string>  $args
     * @return array{ok: bool, stdout: string}
     */
    private function runGit(string $cwd, array $args): array
    {
        if (! is_dir($cwd)) {
            return ['ok' => false, 'stdout' => ''];
        }
        $process = new Process(array_merge(['git'], $args), $cwd);
        $process->setTimeout(8);
        $process->run();

        return [
            'ok' => $process->isSuccessful(),
            'stdout' => $process->getOutput(),
        ];
    }
}
