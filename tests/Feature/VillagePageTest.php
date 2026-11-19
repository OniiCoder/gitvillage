<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
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
        $response = $this->get('/gh/laravel/laravel?branch=11.x');

        $response->assertOk()->assertInertia(
            fn (Assert $page) => $page
                ->component('Village/Index')
                ->where('initialRepo', 'laravel/laravel')
                ->where('initialBranch', '11.x'),
        );
    }

    public function test_local_git_endpoints_are_forbidden_outside_local_environment(): void
    {
        $this->app['env'] = 'production';

        $this->getJson('/api/local-repos')->assertForbidden();
        $this->getJson('/api/local-repo?path=.')->assertForbidden();
        $this->withSession(['_token' => 'csrf-test-token'])
            ->withHeader('X-CSRF-TOKEN', 'csrf-test-token')
            ->postJson('/api/local-checkout', ['path' => '.', 'branch' => 'main'])
            ->assertForbidden();
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
                'headBranch',
                'allBranches',
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

        $currentBranch = (string) $repoRes->json('currentBranch');
        $this->assertContains($currentBranch, $repoRes->json('allBranches'));

        $this->withSession(['_token' => 'csrf-test-token'])
            ->withHeader('X-CSRF-TOKEN', 'csrf-test-token')
            ->postJson('/api/local-checkout', ['path' => '.', 'branch' => 'non-existent-branch-xyz'])
            ->assertNotFound();
    }

    public function test_posthog_meta_tags_render_only_when_configured(): void
    {
        config(['services.posthog.key' => null]);

        $this->get('/')
            ->assertOk()
            ->assertDontSee('name="posthog-key"', false);

        config([
            'services.posthog.key' => 'phc_test_village_key',
            'services.posthog.host' => 'https://eu.i.posthog.com',
        ]);

        $this->get('/')
            ->assertOk()
            ->assertSee('<meta name="posthog-key" content="phc_test_village_key" />', false)
            ->assertSee('<meta name="posthog-host" content="https://eu.i.posthog.com" />', false);
    }

    public function test_dynamic_opengraph_cards_and_readme_svg_badge_render(): void
    {
        Http::fake([
            'https://api.github.com/repos/laravel/framework' => Http::response([
                'name' => 'framework',
                'owner' => ['login' => 'laravel'],
                'description' => 'The Laravel Framework.',
                'default_branch' => '13.x',
                'stargazers_count' => 34200,
                'language' => 'PHP',
            ], 200),
        ]);

        $this->get('/gh/laravel/framework')
            ->assertOk()
            ->assertSee('/og/laravel/framework.png', false)
            ->assertSee('name="twitter:card" content="summary_large_image"', false);

        $defaultOg = $this->get('/og/default.png')->assertOk();
        $this->assertSame('image/png', $defaultOg->headers->get('Content-Type'));
        $defaultSize = getimagesizefromstring((string) $defaultOg->getContent());
        $this->assertIsArray($defaultSize);
        $this->assertSame(1200, $defaultSize[0]);
        $this->assertSame(630, $defaultSize[1]);

        $repoOg = $this->get('/og/laravel/framework.png')->assertOk();
        $this->assertSame('image/png', $repoOg->headers->get('Content-Type'));
        $repoSize = getimagesizefromstring((string) $repoOg->getContent());
        $this->assertIsArray($repoSize);
        $this->assertSame(1200, $repoSize[0]);
        $this->assertSame(630, $repoSize[1]);

        $badge = $this->get('/badge/laravel/framework.svg')->assertOk();
        $this->assertStringContainsString('image/svg+xml', (string) $badge->headers->get('Content-Type'));
        $this->assertStringContainsString('Explore laravel/framework in 3D', (string) $badge->getContent());
    }
}
