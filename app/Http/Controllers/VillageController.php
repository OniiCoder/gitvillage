<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class VillageController extends Controller
{
    public function index(Request $request): Response
    {
        $repoQuery = $request->query('repo');
        $localQuery = app()->isLocal() ? $request->query('local') : null;
        $branchQuery = $request->query('branch');
        $userQuery = $request->query('user');
        $yearQuery = $request->query('year');
        $themeQuery = $request->query('theme');
        $learnQuery = $request->has('learn');
        $chapterQuery = $request->query('chapter');
        $initialRepo = is_string($repoQuery) && $repoQuery !== '' ? $repoQuery : null;
        $initialHeatmapUser = is_string($userQuery) && preg_match('/^[A-Za-z0-9-]+$/', trim($userQuery, '@ '))
            ? trim($userQuery, '@ ')
            : null;

        $ogMeta = $learnQuery
            ? $this->buildLearnOgMeta()
            : ($initialHeatmapUser !== null
                ? $this->buildHeatmapOgMeta($initialHeatmapUser)
                : $this->buildOgMeta($request, $initialRepo));

        return Inertia::render('Village/Index', [
            'initialRepo' => $initialRepo,
            'initialLocal' => is_string($localQuery) && $localQuery !== '' ? $localQuery : null,
            'initialBranch' => is_string($branchQuery) && $branchQuery !== '' ? $branchQuery : null,
            'initialHeatmapUser' => $initialHeatmapUser,
            'initialHeatmapYear' => is_numeric($yearQuery) ? (int) $yearQuery : null,
            'initialHeatmapTheme' => is_string($themeQuery) ? $themeQuery : null,
            'initialLearnMode' => $learnQuery,
            'initialLearnChapter' => is_numeric($chapterQuery) ? (int) $chapterQuery : null,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ])->withViewData(['ogMeta' => $ogMeta]);
    }

    public function github(Request $request, string $owner, string $repo): Response
    {
        $branchQuery = $request->query('branch');
        $slug = "{$owner}/{$repo}";
        $ogMeta = $this->buildOgMeta($request, $slug);

        return Inertia::render('Village/Index', [
            'initialRepo' => $slug,
            'initialLocal' => null,
            'initialBranch' => is_string($branchQuery) && $branchQuery !== '' ? $branchQuery : null,
            'initialHeatmapUser' => null,
            'initialHeatmapYear' => null,
            'initialHeatmapTheme' => null,
            'initialLearnMode' => false,
            'initialLearnChapter' => null,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ])->withViewData(['ogMeta' => $ogMeta]);
    }

    public function heatmap(Request $request, string $username): Response
    {
        $safeUser = preg_replace('/[^A-Za-z0-9-]/', '', $username) ?: 'OniiCoder';
        $yearQuery = $request->query('year');
        $themeQuery = $request->query('theme');
        $ogMeta = $this->buildHeatmapOgMeta($safeUser);

        return Inertia::render('Village/Index', [
            'initialRepo' => null,
            'initialLocal' => null,
            'initialBranch' => null,
            'initialHeatmapUser' => $safeUser,
            'initialHeatmapYear' => is_numeric($yearQuery) ? (int) $yearQuery : null,
            'initialHeatmapTheme' => is_string($themeQuery) ? $themeQuery : null,
            'initialLearnMode' => false,
            'initialLearnChapter' => null,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ])->withViewData(['ogMeta' => $ogMeta]);
    }

    public function learn(Request $request): Response
    {
        $chapterQuery = $request->query('chapter');
        $ogMeta = $this->buildLearnOgMeta();

        return Inertia::render('Village/Index', [
            'initialRepo' => null,
            'initialLocal' => null,
            'initialBranch' => null,
            'initialHeatmapUser' => null,
            'initialHeatmapYear' => null,
            'initialHeatmapTheme' => null,
            'initialLearnMode' => true,
            'initialLearnChapter' => is_numeric($chapterQuery) ? (int) $chapterQuery : 1,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ])->withViewData(['ogMeta' => $ogMeta]);
    }

    /**
     * @return array{title: string, description: string, url: string, image: string}
     */
    private function buildLearnOgMeta(): array
    {
        return [
            'title' => 'GitVillage Academy — Learn Git Visually in an Interactive 3D World',
            'description' => 'Master every Git concept hands-on in 3D: git init, staging, commits, branches, merges, conflicts, stash, rebase, cherry-pick, and reflog rescue.',
            'url' => url('/learn'),
            'image' => route('og.learn'),
        ];
    }

    /**
     * @return array{title: string, description: string, url: string, image: string}
     */
    private function buildHeatmapOgMeta(string $username): array
    {
        return [
            'title' => "@{$username} · 3D GitHub Contribution Skyline | GitVillage",
            'description' => "Explore @{$username}'s GitHub contribution heatmap as a living 3D floating-island skyline — streaks, peak days, and interactive towers.",
            'url' => url("/u/{$username}"),
            'image' => route('og.heatmap', ['username' => $username]),
        ];
    }

    /**
     * @return array{title: string, description: string, url: string, image: string}
     */
    private function buildOgMeta(Request $request, ?string $repoSpec): array
    {
        if (is_string($repoSpec) && preg_match('#^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$#', trim($repoSpec), $m)) {
            $owner = $m[1];
            $repo = $m[2];

            return [
                'title' => "{$owner}/{$repo} · GitVillage 3D World",
                'description' => "Explore {$owner}/{$repo} as a living 3D floating-island village — branches, bridges, unified file diffs, and commit citizens.",
                'url' => url("/gh/{$owner}/{$repo}"),
                'image' => route('og.repo', ['owner' => $owner, 'repo' => $repo]),
            ];
        }

        return [
            'title' => 'GitVillage — Turn any Git repository into a living 3D world',
            'description' => 'Explore any GitHub or local Git repository as floating 3D branch islands, bridges, unified file diffs, and autonomous commit citizens.',
            'url' => $request->url(),
            'image' => route('og.default'),
        ];
    }

    /**
     * @return array<int, array{slug: string, title: string, subtitle: string}>
     */
    private function showcaseRepos(): array
    {
        return [
            [
                'slug' => 'demo',
                'title' => 'gitvillage/sky-village',
                'subtitle' => 'Built-in showcase · 5 branch islands & bridges',
            ],
            [
                'slug' => 'laravel/framework',
                'title' => 'laravel/framework',
                'subtitle' => 'The Laravel PHP framework · core team & active branches',
            ],
            [
                'slug' => 'inertiajs/inertia',
                'title' => 'inertiajs/inertia',
                'subtitle' => 'Modern monolith SPA adapter · multi-branch commits',
            ],
            [
                'slug' => 'mrdoob/three.js',
                'title' => 'mrdoob/three.js',
                'subtitle' => 'JavaScript 3D library · multi-author commits',
            ],
            [
                'slug' => 'vitejs/vite',
                'title' => 'vitejs/vite',
                'subtitle' => 'Next-gen frontend tooling · features & fixes',
            ],
            [
                'slug' => 'sveltejs/svelte',
                'title' => 'sveltejs/svelte',
                'subtitle' => 'Web apps, streamlined · rich commit graph',
            ],
        ];
    }
}
