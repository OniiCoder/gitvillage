<?php

namespace App\Services;

use DateTimeImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class GitHubHeatmapService
{
    /**
     * Validate and normalize a GitHub username (strips leading @ or github.com/ prefix).
     */
    public function normalizeUsername(string $raw): ?string
    {
        $clean = trim($raw);
        $clean = preg_replace('#^https?://(?:www\.)?github\.com/#i', '', $clean) ?? $clean;
        $clean = trim($clean, "/ \t\n\r\0\x0B");
        if (str_starts_with($clean, '@')) {
            $clean = substr($clean, 1);
        }

        if (! preg_match('/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/', $clean)) {
            return null;
        }

        return $clean;
    }

    /**
     * Fetch and parse a GitHub user's 53x7 contribution calendar, caching for 30 minutes.
     *
     * @return array{
     *   username: string,
     *   displayName: string,
     *   avatarUrl: string,
     *   year: int|null,
     *   periodLabel: string,
     *   totalContributions: int,
     *   longestStreak: int,
     *   currentStreak: int,
     *   activeDays: int,
     *   totalDays: int,
     *   maxDailyCount: int,
     *   peakDay: array{date: string, count: int}|null,
     *   weeks: array<int, array{weekIndex: int, monthLabel: string|null, days: array<int, array{date: string, count: int, level: int, weekday: int, weekIndex: int}>}>
     * }|null
     */
    public function fetchHeatmap(string $username, ?int $year = null): ?array
    {
        $safeUser = $this->normalizeUsername($username);
        if ($safeUser === null) {
            return null;
        }

        $currentYear = (int) gmdate('Y');
        $validYear = ($year !== null && $year >= 2008 && $year <= $currentYear) ? $year : null;
        $cacheKey = 'gitvillage_gh_heatmap_v1_'.strtolower($safeUser).'_'.($validYear ?? 'rolling');

        return Cache::remember($cacheKey, now()->addMinutes(30), function () use ($safeUser, $validYear): ?array {
            $url = "https://github.com/users/{$safeUser}/contributions";
            $query = [];
            if ($validYear !== null) {
                $query['from'] = "{$validYear}-01-01";
                $query['to'] = "{$validYear}-12-31";
            }

            try {
                $res = Http::timeout(8)
                    ->withHeaders([
                        'Accept' => 'text/html',
                        'X-Requested-With' => 'XMLHttpRequest',
                        'User-Agent' => 'GitVillage-Heatmap/1.0',
                    ])
                    ->get($url, $query);

                if ($res->status() === 404 || ! $res->successful()) {
                    return null;
                }

                $html = (string) $res->body();
                if (! str_contains($html, 'ContributionCalendar-day') && ! str_contains($html, 'data-date=')) {
                    return null;
                }

                $parsed = $this->parseContributionsHtml($html, $safeUser, $validYear);
                if ($parsed === null) {
                    return null;
                }

                $profile = $this->fetchOptionalProfileMeta($safeUser);
                $parsed['username'] = $profile['login'] ?: $safeUser;
                $parsed['displayName'] = $profile['name'] ?: $parsed['username'];
                $parsed['avatarUrl'] = $profile['avatarUrl'];

                return $parsed;
            } catch (\Throwable) {
                return null;
            }
        });
    }

    /**
     * Parse GitHub's public ContributionCalendar HTML fragment into structured weeks & stats.
     *
     * @return array<string, mixed>|null
     */
    public function parseContributionsHtml(string $html, string $username, ?int $year): ?array
    {
        // 1. Map tooltip IDs (`for="contribution-day-component-0-1"`) -> exact count
        $countsByCellId = [];
        if (preg_match_all('/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>(.*?)<\/tool-tip>/si', $html, $tipMatches, PREG_SET_ORDER)) {
            foreach ($tipMatches as $m) {
                $cellId = trim($m[1]);
                $text = trim(strip_tags($m[2]));
                if (preg_match('/^([\d,]+)\s+contributions?\b/i', $text, $cm)) {
                    $countsByCellId[$cellId] = (int) str_replace(',', '', $cm[1]);
                } elseif (stripos($text, 'No contributions') !== false) {
                    $countsByCellId[$cellId] = 0;
                }
            }
        }

        // 2. Extract every `<td ... data-date="YYYY-MM-DD" ...>` cell
        $daysByDate = [];
        if (preg_match_all('/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/si', $html, $tdMatches)) {
            foreach ($tdMatches[0] as $idx => $tag) {
                $date = $tdMatches[1][$idx];
                $level = 0;
                if (preg_match('/\bdata-level="(\d+)"/i', $tag, $lm)) {
                    $level = max(0, min(4, (int) $lm[1]));
                }

                $cellId = null;
                if (preg_match('/\bid="([^"]+)"/i', $tag, $im)) {
                    $cellId = $im[1];
                }

                // Fallback count inside td text or aria-label if present, otherwise tooltip map, otherwise level estimate
                $count = null;
                if ($cellId !== null && array_key_exists($cellId, $countsByCellId)) {
                    $count = $countsByCellId[$cellId];
                } elseif (preg_match('/\bdata-count="(\d+)"/i', $tag, $dm)) {
                    $count = (int) $dm[1];
                } else {
                    $levelFallback = [0 => 0, 1 => 2, 2 => 5, 3 => 10, 4 => 18];
                    $count = $levelFallback[$level] ?? 0;
                }

                $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
                if (! $dt) {
                    continue;
                }
                $weekday = (int) $dt->format('w'); // 0 (Sun) .. 6 (Sat)

                $daysByDate[$date] = [
                    'date' => $date,
                    'count' => $count,
                    'level' => $level,
                    'weekday' => $weekday,
                ];
            }
        }

        if ($daysByDate === []) {
            return null;
        }

        ksort($daysByDate);
        $sortedDays = array_values($daysByDate);

        // 3. Parse heading total if present (`1,899 contributions in the last year`)
        $headingTotal = null;
        if (preg_match('/id="js-contribution-activity-description"[^>]*>\s*([\d,]+)\s+contributions?/si', $html, $hm)) {
            $headingTotal = (int) str_replace(',', '', $hm[1]);
        }

        // 4. Group sorted days into Sunday-anchored week columns (0..52)
        $firstDt = DateTimeImmutable::createFromFormat('!Y-m-d', $sortedDays[0]['date']);
        $firstSunday = $firstDt ? $firstDt->modify('-'.((int) $firstDt->format('w')).' days') : new DateTimeImmutable('today');

        $weeksMap = [];
        $sumCounts = 0;
        $activeDays = 0;
        $maxDailyCount = 0;
        $peakDay = null;
        $longestStreak = 0;
        $runningStreak = 0;
        $todayStr = gmdate('Y-m-d');

        foreach ($sortedDays as $day) {
            $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $day['date']);
            $diffDays = $dt ? (int) $firstSunday->diff($dt)->format('%r%a') : 0;
            $weekIdx = max(0, intdiv($diffDays, 7));

            $c = $day['count'];
            $sumCounts += $c;
            if ($c > 0) {
                $activeDays++;
                $runningStreak++;
                if ($runningStreak > $longestStreak) {
                    $longestStreak = $runningStreak;
                }
                if ($c > $maxDailyCount) {
                    $maxDailyCount = $c;
                    $peakDay = ['date' => $day['date'], 'count' => $c];
                }
            } elseif ($day['date'] < $todayStr) {
                $runningStreak = 0;
            }

            $day['weekIndex'] = $weekIdx;
            $weeksMap[$weekIdx][] = $day;
        }

        // Compute current streak walking backwards from today (or yesterday if 0 today)
        $currentStreak = 0;
        for ($i = count($sortedDays) - 1; $i >= 0; $i--) {
            $d = $sortedDays[$i];
            if ($d['date'] > $todayStr) {
                continue;
            }
            if ($d['count'] > 0) {
                $currentStreak++;
            } else {
                if ($d['date'] === $todayStr) {
                    continue;
                }
                break;
            }
        }

        ksort($weeksMap);
        $weeks = [];
        $lastMonth = null;
        $normalizedIdx = 0;
        foreach ($weeksMap as $daysInWeek) {
            usort($daysInWeek, static fn (array $a, array $b): int => $a['weekday'] <=> $b['weekday']);
            $monthLabel = null;
            foreach ($daysInWeek as &$cell) {
                $cell['weekIndex'] = $normalizedIdx;
                $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $cell['date']);
                if ($dt) {
                    $m = $dt->format('M');
                    if ($m !== $lastMonth && ((int) $dt->format('j') <= 7 || $normalizedIdx === 0)) {
                        $monthLabel = $m;
                        $lastMonth = $m;
                    }
                }
            }
            unset($cell);

            $weeks[] = [
                'weekIndex' => $normalizedIdx,
                'monthLabel' => $monthLabel,
                'days' => $daysInWeek,
            ];
            $normalizedIdx++;
        }

        return [
            'username' => $username,
            'displayName' => $username,
            'avatarUrl' => "https://github.com/{$username}.png?size=120",
            'year' => $year,
            'periodLabel' => $year !== null ? (string) $year : 'Last 12 Months',
            'totalContributions' => $headingTotal !== null && $headingTotal > 0 ? $headingTotal : $sumCounts,
            'longestStreak' => $longestStreak,
            'currentStreak' => $currentStreak,
            'activeDays' => $activeDays,
            'totalDays' => count($sortedDays),
            'maxDailyCount' => $maxDailyCount,
            'peakDay' => $peakDay,
            'weeks' => $weeks,
        ];
    }

    /**
     * @return array{login: string, name: string, avatarUrl: string}
     */
    private function fetchOptionalProfileMeta(string $username): array
    {
        $fallback = [
            'login' => $username,
            'name' => $username,
            'avatarUrl' => "https://github.com/{$username}.png?size=120",
        ];

        try {
            $req = Http::timeout(2.5)->withHeaders([
                'Accept' => 'application/vnd.github+json',
                'User-Agent' => 'GitVillage-Heatmap/1.0',
            ]);

            $ghToken = env('GITHUB_TOKEN');
            if (is_string($ghToken) && trim($ghToken) !== '') {
                $req = $req->withToken(trim($ghToken));
            }

            $res = $req->get("https://api.github.com/users/{$username}");
            if (! $res->successful()) {
                return $fallback;
            }

            $json = $res->json();

            return [
                'login' => (string) data_get($json, 'login', $username),
                'name' => trim((string) data_get($json, 'name', '')) ?: (string) data_get($json, 'login', $username),
                'avatarUrl' => (string) data_get($json, 'avatar_url', $fallback['avatarUrl']),
            ];
        } catch (\Throwable) {
            return $fallback;
        }
    }
}
