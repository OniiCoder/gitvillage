<?php

use App\Http\Controllers\HeatmapController;
use App\Http\Controllers\LocalGitController;
use App\Http\Controllers\SocialCardController;
use App\Http\Controllers\VillageController;
use App\Http\Middleware\EnsureLocalEnvironment;
use Illuminate\Support\Facades\Route;

Route::get('/', [VillageController::class, 'index'])->name('village.index');
Route::get('/gh/{owner}/{repo}', [VillageController::class, 'github'])
    ->where(['owner' => '[A-Za-z0-9_.-]+', 'repo' => '[A-Za-z0-9_.-]+'])
    ->name('village.github');
Route::get('/u/{username}', [VillageController::class, 'heatmap'])
    ->where(['username' => '[A-Za-z0-9-]+'])
    ->name('village.heatmap');
Route::get('/learn', [VillageController::class, 'learn'])->name('village.learn');

Route::get('/api/github-heatmap/{username}', [HeatmapController::class, 'show'])
    ->where(['username' => '[A-Za-z0-9@-]+'])
    ->name('api.github-heatmap');

Route::get('/og/default.png', [SocialCardController::class, 'defaultOg'])->name('og.default');
Route::get('/og/learn.png', [SocialCardController::class, 'learnOg'])->name('og.learn');
Route::get('/og/u/{username}.png', [SocialCardController::class, 'userHeatmapOg'])
    ->where(['username' => '[A-Za-z0-9-]+'])
    ->name('og.heatmap');
Route::get('/og/{owner}/{repo}.png', [SocialCardController::class, 'repoOg'])
    ->where(['owner' => '[A-Za-z0-9_.-]+', 'repo' => '[A-Za-z0-9_.-]+'])
    ->name('og.repo');
Route::get('/badge/{owner}/{repo}.svg', [SocialCardController::class, 'repoBadge'])
    ->where(['owner' => '[A-Za-z0-9_.-]+', 'repo' => '[A-Za-z0-9_.-]+'])
    ->name('badge.repo');

Route::prefix('api')
    ->middleware(EnsureLocalEnvironment::class)
    ->group(function (): void {
        Route::get('/local-repos', [LocalGitController::class, 'discover'])->name('api.local-repos');
        Route::get('/browse-dirs', [LocalGitController::class, 'browse'])->name('api.browse-dirs');
        Route::post('/pick-native-folder', [LocalGitController::class, 'pickNativeFolder'])->name('api.pick-native-folder');
        Route::get('/local-repo', [LocalGitController::class, 'inspect'])->name('api.local-repo');
        Route::post('/local-checkout', [LocalGitController::class, 'checkout'])->name('api.local-checkout');
        Route::get('/local-commit-detail', [LocalGitController::class, 'commitDetail'])->name('api.local-commit-detail');
    });
