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

        return Inertia::render('Village/Index', [
            'initialRepo' => is_string($repoQuery) && $repoQuery !== '' ? $repoQuery : null,
            'initialLocal' => is_string($localQuery) && $localQuery !== '' ? $localQuery : null,
            'initialBranch' => is_string($branchQuery) && $branchQuery !== '' ? $branchQuery : null,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ]);
    }

    public function github(Request $request, string $owner, string $repo): Response
    {
        $branchQuery = $request->query('branch');

        return Inertia::render('Village/Index', [
            'initialRepo' => "{$owner}/{$repo}",
            'initialLocal' => null,
            'initialBranch' => is_string($branchQuery) && $branchQuery !== '' ? $branchQuery : null,
            'directorMode' => $request->has('director'),
            'localServerEnabled' => app()->isLocal(),
            'nativeFinderSupported' => app()->isLocal() && PHP_OS_FAMILY === 'Darwin',
            'showcaseRepos' => $this->showcaseRepos(),
        ]);
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
