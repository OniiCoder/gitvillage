<?php

namespace App\Http\Controllers;

use App\Services\GitHubHeatmapService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HeatmapController extends Controller
{
    public function show(Request $request, string $username, GitHubHeatmapService $service): JsonResponse
    {
        $normalized = $service->normalizeUsername($username);
        if ($normalized === null) {
            return response()->json([
                'message' => 'Invalid GitHub username format.',
            ], 422);
        }

        $yearParam = $request->query('year');
        $year = is_numeric($yearParam) ? (int) $yearParam : null;

        $data = $service->fetchHeatmap($normalized, $year);
        if ($data === null) {
            return response()->json([
                'message' => "Could not find public GitHub contributions for @{$normalized}.",
            ], 404);
        }

        return response()->json($data, 200, [
            'Cache-Control' => 'public, max-age=600',
        ]);
    }
}
