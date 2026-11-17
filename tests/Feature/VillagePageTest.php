<?php

namespace Tests\Feature;

use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class VillagePageTest extends TestCase
{
    public function test_home_page_renders_inertia_village_index(): void
    {
        $response = $this->get('/');

        $response->assertOk()->assertInertia(
            fn (Assert $page) => $page
                ->component('Village/Index')
                ->where('initialRepo', null)
                ->has('showcaseRepos', 6),
        );
    }

    public function test_github_deep_link_route_passes_initial_repo_prop(): void
    {
        $response = $this->get('/gh/laravel/laravel');

        $response->assertOk()->assertInertia(
            fn (Assert $page) => $page
                ->component('Village/Index')
                ->where('initialRepo', 'laravel/laravel'),
        );
    }

    public function test_local_git_endpoints_are_forbidden_outside_local_environment(): void
    {
        $this->app['env'] = 'production';

        $this->getJson('/api/local-repos')->assertForbidden();
        $this->getJson('/api/local-repo?path=.')->assertForbidden();
    }

    public function test_local_git_endpoints_inspect_repository_in_local_environment(): void
    {
        $this->app['env'] = 'local';

        $this->getJson('/api/local-repos')
            ->assertOk()
            ->assertJsonStructure(['repos']);

        $repoRes = $this->getJson('/api/local-repo?path=.')
            ->assertOk()
            ->assertJsonStructure([
                'owner',
                'repo',
                'localPath',
                'currentBranch',
                'branches',
                'gateVisitors',
            ]);

        $headSha = $repoRes->json('branches.0.commits.0.sha');
        $this->assertNotEmpty($headSha);

        $detailRes = $this->getJson('/api/local-commit-detail?path=.&sha='.$headSha)
            ->assertOk()
            ->assertJsonStructure([
                'stats' => ['additions', 'deletions', 'total'],
                'files' => [
                    '*' => ['filename', 'status', 'additions', 'deletions', 'patch'],
                ],
            ]);

        $firstPatch = (string) $detailRes->json('files.0.patch');
        $this->assertStringContainsString('@@', $firstPatch);
    }
}
