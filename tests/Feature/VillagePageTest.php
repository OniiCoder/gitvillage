<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;
use Symfony\Component\Process\Process;
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

    public function test_local_git_inspect_detects_active_merge_conflicts_and_extracts_ours_vs_theirs(): void
    {
        $this->app['env'] = 'local';

        $tmpDir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'gitvillage-conflict-'.uniqid();
        mkdir($tmpDir, 0777, true);

        $run = static function (array $cmd) use ($tmpDir): void {
            $proc = new Process($cmd, $tmpDir);
            $proc->run();
        };

        try {
            $run(['git', 'init', '-b', 'main']);
            $run(['git', 'config', 'user.email', 'dev@gitvillage.test']);
            $run(['git', 'config', 'user.name', 'Village Builder']);

            file_put_contents($tmpDir.'/Checkout.php', "<?php\nreturn [\n    'tax_rate' => 0.05,\n];\n");
            $run(['git', 'add', 'Checkout.php']);
            $run(['git', 'commit', '-m', 'feat: initial checkout config']);

            $run(['git', 'checkout', '-b', 'feat/eu-vat']);
            file_put_contents($tmpDir.'/Checkout.php', "<?php\nreturn [\n    'tax_rate' => 0.21,\n    'region' => 'EU',\n];\n");
            $run(['git', 'commit', '-am', 'feat: apply EU VAT rate']);

            $run(['git', 'checkout', 'main']);
            file_put_contents($tmpDir.'/Checkout.php', "<?php\nreturn [\n    'tax_rate' => 0.0825,\n    'region' => 'US-TX',\n];\n");
            $run(['git', 'commit', '-am', 'fix: update US sales tax rate']);

            // Trigger an actual unmerged Git conflict (`UU`)
            $run(['git', 'merge', 'feat/eu-vat']);

            $res = $this->getJson('/api/local-repo?path='.urlencode($tmpDir))->assertOk();

            $res->assertJsonPath('mergeConflict.active', true)
                ->assertJsonPath('mergeConflict.oursBranch', 'main')
                ->assertJsonPath('mergeConflict.theirsBranch', 'feat/eu-vat')
                ->assertJsonPath('mergeConflict.conflictedCount', 1)
                ->assertJsonPath('gateVisitors.0.filename', 'Checkout.php')
                ->assertJsonPath('gateVisitors.0.status', 'conflicted')
                ->assertJsonPath('gateVisitors.0.staged', false);

            $oursContent = (string) $res->json('gateVisitors.0.conflict.oursContent');
            $theirsContent = (string) $res->json('gateVisitors.0.conflict.theirsContent');
            $diffPreview = (string) $res->json('gateVisitors.0.diffPreview');

            $this->assertStringContainsString('0.0825', $oursContent);
            $this->assertStringContainsString('0.21', $theirsContent);
            $this->assertStringContainsString('<<<<<<<', $diffPreview);
            $this->assertStringContainsString('>>>>>>>', $diffPreview);
        } finally {
            File::deleteDirectory($tmpDir);
        }
    }

    public function test_local_git_inspect_extracts_tags_stashes_and_reflog_ghost_commits(): void
    {
        $this->app['env'] = 'local';

        $tmpDir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'gitvillage-xray-'.uniqid();
        mkdir($tmpDir, 0777, true);

        $run = static function (array $cmd) use ($tmpDir): void {
            $proc = new Process($cmd, $tmpDir);
            $proc->run();
        };

        try {
            $run(['git', 'init', '-b', 'main']);
            $run(['git', 'config', 'user.email', 'dev@gitvillage.test']);
            $run(['git', 'config', 'user.name', 'Village Historian']);

            file_put_contents($tmpDir.'/Village.php', "<?php\nreturn ['era' => 1];\n");
            $run(['git', 'add', 'Village.php']);
            $run(['git', 'commit', '-m', "feat: found the village\n\nCo-authored-by: Maya Lin <maya@gitvillage.test>"]);
            $run(['git', 'tag', 'v1.0.0']);

            // Create a commit and orphan it via `git reset --hard HEAD~1` so it lives only in reflog
            file_put_contents($tmpDir.'/GhostExperiment.php', "<?php\n// orphaned experiment\n");
            $run(['git', 'add', 'GhostExperiment.php']);
            $run(['git', 'commit', '-m', 'wip: experimental portal calibration']);
            $run(['git', 'reset', '--hard', 'HEAD~1']);

            // Create a git stash entry
            file_put_contents($tmpDir.'/Village.php', "<?php\nreturn ['era' => 2, 'wip' => true];\n");
            $run(['git', 'stash', 'push', '-m', 'wip: stashed lantern blueprint']);

            $res = $this->getJson('/api/local-repo?path='.urlencode($tmpDir))->assertOk();

            $res->assertJsonPath('tags.0.name', 'v1.0.0')
                ->assertJsonPath('stashes.0.selector', 'stash@{0}')
                ->assertJsonPath('ghostCommits.0.subject', 'wip: experimental portal calibration');

            $stashMessage = (string) $res->json('stashes.0.message');
            $this->assertStringContainsString('stashed lantern blueprint', $stashMessage);

            $commitBody = (string) $res->json('branches.0.commits.0.body');
            $this->assertStringContainsString('Co-authored-by: Maya Lin', $commitBody);
        } finally {
            File::deleteDirectory($tmpDir);
        }
    }
}
