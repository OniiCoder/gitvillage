<?php

use App\Http\Controllers\LocalGitController;
use App\Http\Controllers\VillageController;
use App\Http\Middleware\EnsureLocalEnvironment;
use Illuminate\Support\Facades\Route;

Route::get('/', [VillageController::class, 'index'])->name('village.index');
Route::get('/gh/{owner}/{repo}', [VillageController::class, 'github'])
    ->where(['owner' => '[A-Za-z0-9_.-]+', 'repo' => '[A-Za-z0-9_.-]+'])
    ->name('village.github');

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
