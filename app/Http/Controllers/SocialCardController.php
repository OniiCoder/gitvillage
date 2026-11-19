<?php

namespace App\Http\Controllers;

use GdImage;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class SocialCardController extends Controller
{
    public function defaultOg(): Response
    {
        $png = Cache::remember('gitvillage_og_default_v1', now()->addHours(6), function (): string {
            return $this->renderOgPng(
                title: 'GitVillage',
                subtitle: 'Turn any Git repository into a living 3D floating-island world.',
                defaultBranch: 'main',
                stars: null,
                language: 'Laravel · React · Three.js',
                footerUrl: parse_url(config('app.url', 'https://gitvillage.on-forge.com'), PHP_URL_HOST) ?: 'gitvillage.on-forge.com',
                isRepoCard: false,
            );
        });

        return response($png, 200, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=3600, s-maxage=3600',
        ]);
    }

    public function repoOg(string $owner, string $repo): Response
    {
        $safeOwner = preg_replace('/[^A-Za-z0-9_.-]/', '', $owner) ?: 'github';
        $safeRepo = preg_replace('/[^A-Za-z0-9_.-]/', '', $repo) ?: 'repo';
        $cacheKey = "gitvillage_og_repo_v1_{$safeOwner}_{$safeRepo}";

        $png = Cache::remember($cacheKey, now()->addMinutes(30), function () use ($safeOwner, $safeRepo): string {
            $meta = $this->fetchGitHubRepoMeta($safeOwner, $safeRepo);
            $host = parse_url(config('app.url', 'https://gitvillage.on-forge.com'), PHP_URL_HOST) ?: 'gitvillage.on-forge.com';

            return $this->renderOgPng(
                title: "{$meta['owner']}/{$meta['repo']}",
                subtitle: $meta['description'] ?: "Explore {$meta['owner']}/{$meta['repo']} as floating 3D branch islands, bridges & commit villagers.",
                defaultBranch: $meta['default_branch'],
                stars: $meta['stars'],
                language: $meta['language'],
                footerUrl: "{$host}/gh/{$meta['owner']}/{$meta['repo']}",
                isRepoCard: true,
            );
        });

        return response($png, 200, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=1800, s-maxage=1800',
        ]);
    }

    public function repoBadge(string $owner, string $repo): Response
    {
        $safeOwner = preg_replace('/[^A-Za-z0-9_.-]/', '', $owner) ?: 'github';
        $safeRepo = preg_replace('/[^A-Za-z0-9_.-]/', '', $repo) ?: 'repo';
        $slug = "{$safeOwner}/{$safeRepo}";

        $meta = Cache::remember("gitvillage_badge_meta_v1_{$safeOwner}_{$safeRepo}", now()->addMinutes(30), function () use ($safeOwner, $safeRepo): array {
            return $this->fetchGitHubRepoMeta($safeOwner, $safeRepo);
        });

        $svg = $this->renderBadgeSvg($slug, $meta['default_branch']);

        return response($svg, 200, [
            'Content-Type' => 'image/svg+xml; charset=utf-8',
            'Cache-Control' => 'public, max-age=1800, s-maxage=1800',
        ]);
    }

    /**
     * @return array{owner: string, repo: string, description: string, default_branch: string, stars: int|null, language: string|null}
     */
    private function fetchGitHubRepoMeta(string $owner, string $repo): array
    {
        $fallback = [
            'owner' => $owner,
            'repo' => $repo,
            'description' => '',
            'default_branch' => 'main',
            'stars' => null,
            'language' => null,
        ];

        try {
            $req = Http::timeout(3)
                ->withHeaders([
                    'Accept' => 'application/vnd.github+json',
                    'User-Agent' => 'GitVillage-SocialCard/1.0',
                ]);

            $ghToken = env('GITHUB_TOKEN');
            if (is_string($ghToken) && trim($ghToken) !== '') {
                $req = $req->withToken(trim($ghToken));
            }

            $res = $req->get("https://api.github.com/repos/{$owner}/{$repo}");
            if (! $res->successful()) {
                return $fallback;
            }

            $json = $res->json();

            return [
                'owner' => (string) data_get($json, 'owner.login', $owner),
                'repo' => (string) data_get($json, 'name', $repo),
                'description' => trim((string) data_get($json, 'description', '')),
                'default_branch' => (string) data_get($json, 'default_branch', 'main'),
                'stars' => is_numeric(data_get($json, 'stargazers_count')) ? (int) data_get($json, 'stargazers_count') : null,
                'language' => data_get($json, 'language') ? (string) data_get($json, 'language') : null,
            ];
        } catch (\Throwable) {
            return $fallback;
        }
    }

    private function renderOgPng(
        string $title,
        string $subtitle,
        string $defaultBranch,
        ?int $stars,
        ?string $language,
        string $footerUrl,
        bool $isRepoCard,
    ): string {
        $w = 1200;
        $h = 630;
        /** @var GdImage $im */
        $im = imagecreatetruecolor($w, $h);
        imageSaveAlpha($im, true);
        imageAlphaBlending($im, true);
        if (function_exists('imageantialias')) {
            imageantialias($im, true);
        }

        // Deep spatial sky gradient background (#091022 -> #14284b -> #1e3a6d)
        for ($y = 0; $y < $h; $y++) {
            $t = $y / ($h - 1);
            $r = (int) round(9 + $t * 21);
            $g = (int) round(16 + $t * 42);
            $b = (int) round(34 + $t * 75);
            $col = imagecolorallocate($im, $r, $g, $b);
            imageline($im, 0, $y, $w, $y, $col);
        }

        // Subtle atmospheric glow behind the 3D island illustration on the right
        $glowBlue = imagecolorallocatealpha($im, 56, 189, 248, 112);
        $glowEmerald = imagecolorallocatealpha($im, 52, 211, 153, 115);
        imagefilledellipse($im, 935, 315, 520, 420, $glowBlue);
        imagefilledellipse($im, 900, 355, 390, 290, $glowEmerald);

        // Draw stylized 3D Floating Archipelago on right side (x: 720..1150)
        $this->drawFloatingArchipelagoArtwork($im);

        // Frosted spatial card frame
        $cardBg = imagecolorallocatealpha($im, 15, 23, 42, 42);
        $cardBorder = imagecolorallocatealpha($im, 255, 255, 255, 102);
        $this->drawRoundedRect($im, 54, 52, 700, 578, 28, $cardBg, $cardBorder);

        $fontBold = $this->resolveFont(bold: true);
        $fontRegular = $this->resolveFont(bold: false);
        $fontMono = $this->resolveFont(bold: false, mono: true);

        // Brand Crest Pill
        $crestBg = imagecolorallocate($im, 10, 132, 255);
        $white = imagecolorallocate($im, 248, 250, 252);
        $muted = imagecolorallocate($im, 168, 182, 206);
        $emerald = imagecolorallocate($im, 74, 222, 128);
        $amber = imagecolorallocate($im, 251, 191, 36);
        $cyan = imagecolorallocate($im, 103, 232, 249);
        $pillBg = imagecolorallocatealpha($im, 255, 255, 255, 112);

        imagefilledellipse($im, 110, 114, 44, 44, $crestBg);
        // Tiny island triangle inside crest
        imagefilledpolygon($im, [110, 99, 98, 116, 122, 116], $white);
        imageline($im, 97, 122, 123, 122, $white);

        $this->drawText($im, 20, 144, 122, $white, $fontBold, 'GitVillage');
        $this->drawText($im, 13, 285, 120, $cyan, $fontMono, $isRepoCard ? '· 3D Git Repository World' : '· Open Source 3D Git World');

        // Main Title (auto-sized for long owner/repo slugs)
        $displayTitle = mb_strlen($title) > 28 ? mb_substr($title, 0, 27).'…' : $title;
        $titleSize = mb_strlen($displayTitle) > 20 ? 31 : (mb_strlen($displayTitle) > 15 ? 36 : 42);
        $this->drawText($im, $titleSize, 92, 218, $white, $fontBold, $displayTitle);

        // Wrapped Description (up to 3 clean lines)
        $cleanSub = preg_replace('/\s+/', ' ', $subtitle) ?: '';
        $lines = $this->wrapText($cleanSub, 46, 3);
        $lineY = 278;
        foreach ($lines as $line) {
            $this->drawText($im, 17, 92, $lineY, $muted, $fontRegular, $line);
            $lineY += 34;
        }

        // Metadata Pills Row
        $pillX = 92;
        $pillY = 415;

        // Branch pill
        $branchLabel = 'branch: '.(mb_strlen($defaultBranch) > 14 ? mb_substr($defaultBranch, 0, 13).'…' : $defaultBranch);
        $bw = max(136, strlen($branchLabel) * 10 + 34);
        $this->drawRoundedRect($im, $pillX, $pillY, $pillX + $bw, $pillY + 40, 20, $pillBg, null);
        imagefilledellipse($im, $pillX + 18, $pillY + 20, 9, 9, $emerald);
        $this->drawText($im, 13, $pillX + 32, $pillY + 26, $emerald, $fontMono, $branchLabel);
        $pillX += $bw + 14;

        if ($stars !== null) {
            $starLabel = '★ '.$this->formatCompactNumber($stars);
            $sw = max(96, strlen($starLabel) * 11 + 28);
            $this->drawRoundedRect($im, $pillX, $pillY, $pillX + $sw, $pillY + 40, 20, $pillBg, null);
            $this->drawText($im, 13, $pillX + 16, $pillY + 26, $amber, $fontBold, $starLabel);
            $pillX += $sw + 14;
        }

        if ($language) {
            $langLabel = mb_strlen($language) > 22 ? mb_substr($language, 0, 21).'…' : $language;
            $lw = min(668 - $pillX, max(108, strlen($langLabel) * 9 + 30));
            if ($lw >= 95) {
                $this->drawRoundedRect($im, $pillX, $pillY, $pillX + $lw, $pillY + 40, 20, $pillBg, null);
                $this->drawText($im, 13, $pillX + 16, $pillY + 26, $white, $fontRegular, $langLabel);
            }
        }

        // Footer URL bar
        $shortFooter = mb_strlen($footerUrl) > 48 ? mb_substr($footerUrl, 0, 47).'…' : $footerUrl;
        $this->drawText($im, 14, 92, 532, $cyan, $fontMono, $shortFooter);

        ob_start();
        imagepng($im, null, 7);
        $bytes = (string) ob_get_clean();
        imagedestroy($im);

        return $bytes;
    }

    private function drawFloatingArchipelagoArtwork(GdImage $im): void
    {
        $rockDark = imagecolorallocate($im, 30, 41, 59);
        $rockDeep = imagecolorallocate($im, 15, 23, 42);
        $grassMain = imagecolorallocate($im, 74, 222, 128);
        $grassSide = imagecolorallocate($im, 52, 211, 153);
        $stoneCol = imagecolorallocate($im, 226, 232, 240);
        $woodCol = imagecolorallocate($im, 180, 83, 9);
        $roofAmber = imagecolorallocate($im, 251, 191, 36);
        $roofViolet = imagecolorallocate($im, 192, 132, 252);
        $wallCream = imagecolorallocate($im, 248, 250, 252);
        $beaconCyan = imagecolorallocate($im, 56, 189, 248);
        $cloudWhite = imagecolorallocatealpha($im, 255, 255, 255, 92);

        // Drifting clouds
        imagefilledellipse($im, 815, 130, 120, 38, $cloudWhite);
        imagefilledellipse($im, 855, 122, 90, 42, $cloudWhite);
        imagefilledellipse($im, 1085, 505, 135, 38, $cloudWhite);

        // Upper feature branch island (top-right)
        imagefilledpolygon($im, [880, 195, 1110, 195, 1045, 285, 945, 285], $rockDark);
        imagefilledpolygon($im, [995, 195, 1110, 195, 1045, 285], $rockDeep);
        imagefilledpolygon($im, [865, 182, 1125, 182, 1105, 204, 885, 204], $grassSide);
        // Cottage on feature island
        imagefilledrectangle($im, 980, 146, 1022, 182, $wallCream);
        imagefilledpolygon($im, [972, 146, 1001, 122, 1030, 146], $roofViolet);

        // Main branch island (center-right)
        imagefilledpolygon($im, [760, 365, 1148, 365, 1040, 505, 875, 505], $rockDark);
        imagefilledpolygon($im, [955, 365, 1148, 365, 1040, 505], $rockDeep);
        imagefilledpolygon($im, [742, 342, 1164, 342, 1138, 375, 768, 375], $grassMain);

        // Stepping-stone promenade
        for ($sx = 795; $sx <= 1095; $sx += 36) {
            imagefilledellipse($im, $sx, 358, 22, 9, $stoneCol);
        }

        // Wooden fork & merge bridges connecting Main <-> Feature Island
        imagesetthickness($im, 5);
        imageline($im, 865, 345, 920, 200, $woodCol);
        imageline($im, 882, 345, 937, 200, $woodCol);
        imageline($im, 1055, 200, 1085, 345, $woodCol);
        imageline($im, 1072, 200, 1102, 345, $woodCol);
        imagesetthickness($im, 1);

        // Main island cottage + windmill + glowing HEAD crystal
        imagefilledrectangle($im, 812, 300, 862, 344, $wallCream);
        imagefilledpolygon($im, [802, 300, 837, 270, 872, 300], $roofAmber);

        // HEAD Crystal Beacon
        imagefilledpolygon($im, [1112, 292, 1128, 318, 1112, 344, 1096, 318], $beaconCyan);

        // Cute low-poly villagers strolling on main street
        $villagerColors = [
            [925, 336, imagecolorallocate($im, 10, 132, 255)],
            [975, 338, imagecolorallocate($im, 255, 69, 58)],
            [1028, 335, imagecolorallocate($im, 48, 209, 88)],
        ];
        $skin = imagecolorallocate($im, 255, 219, 172);
        foreach ($villagerColors as [$vx, $vy, $vCol]) {
            imagefilledrectangle($im, $vx - 8, $vy - 18, $vx + 8, $vy, $vCol);
            imagefilledellipse($im, $vx, $vy - 26, 16, 16, $skin);
        }
    }

    private function drawRoundedRect(
        GdImage $im,
        int $x1,
        int $y1,
        int $x2,
        int $y2,
        int $r,
        int $fillColor,
        ?int $borderColor,
    ): void {
        imagefilledrectangle($im, $x1 + $r, $y1, $x2 - $r, $y2, $fillColor);
        imagefilledrectangle($im, $x1, $y1 + $r, $x1 + $r - 1, $y2 - $r, $fillColor);
        imagefilledrectangle($im, $x2 - $r + 1, $y1 + $r, $x2, $y2 - $r, $fillColor);
        imagefilledellipse($im, $x1 + $r, $y1 + $r, $r * 2, $r * 2, $fillColor);
        imagefilledellipse($im, $x2 - $r, $y1 + $r, $r * 2, $r * 2, $fillColor);
        imagefilledellipse($im, $x1 + $r, $y2 - $r, $r * 2, $r * 2, $fillColor);
        imagefilledellipse($im, $x2 - $r, $y2 - $r, $r * 2, $r * 2, $fillColor);

        if ($borderColor !== null) {
            imageline($im, $x1 + $r, $y1, $x2 - $r, $y1, $borderColor);
            imageline($im, $x1 + $r, $y2, $x2 - $r, $y2, $borderColor);
            imageline($im, $x1, $y1 + $r, $x1, $y2 - $r, $borderColor);
            imageline($im, $x2, $y1 + $r, $x2, $y2 - $r, $borderColor);
        }
    }

    private function resolveFont(bool $bold = false, bool $mono = false): ?string
    {
        $candidates = $mono
            ? [
                '/System/Library/Fonts/SFNSMono.ttf',
                '/System/Library/Fonts/Monaco.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
                '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
            ]
            : ($bold
                ? [
                    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                    '/System/Library/Fonts/SFNS.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
                    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
                ]
                : [
                    '/System/Library/Fonts/Supplemental/Arial.ttf',
                    '/System/Library/Fonts/SFNS.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
                    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
                ]);

        foreach ($candidates as $path) {
            if (is_file($path) && is_readable($path)) {
                return $path;
            }
        }

        return null;
    }

    private function drawText(
        GdImage $im,
        int $ptSize,
        int $x,
        int $y,
        int $color,
        ?string $fontPath,
        string $text,
    ): void {
        if ($fontPath && function_exists('imagettftext')) {
            imagettftext($im, $ptSize, 0, $x, $y, $color, $fontPath, $text);

            return;
        }

        $gdFont = $ptSize >= 24 ? 5 : ($ptSize >= 15 ? 4 : 3);
        imagestring($im, $gdFont, $x, max(0, $y - 14), $text, $color);
    }

    /**
     * @return array<int, string>
     */
    private function wrapText(string $text, int $maxChars, int $maxLines): array
    {
        $words = preg_split('/\s+/', trim($text)) ?: [];
        $lines = [];
        $current = '';

        foreach ($words as $word) {
            $candidate = $current === '' ? $word : "{$current} {$word}";
            if (mb_strlen($candidate) <= $maxChars) {
                $current = $candidate;
            } else {
                if ($current !== '') {
                    $lines[] = $current;
                    if (count($lines) >= $maxLines) {
                        $lastIdx = $maxLines - 1;
                        $lines[$lastIdx] = rtrim(mb_substr($lines[$lastIdx], 0, $maxChars - 1)).'…';

                        return $lines;
                    }
                }
                $current = $word;
            }
        }

        if ($current !== '' && count($lines) < $maxLines) {
            $lines[] = $current;
        }

        return $lines;
    }

    private function formatCompactNumber(int $num): string
    {
        if ($num >= 1_000_000) {
            return round($num / 1_000_000, 1).'M';
        }
        if ($num >= 1_000) {
            return round($num / 1_000, 1).'k';
        }

        return (string) $num;
    }

    private function renderBadgeSvg(string $slug, string $defaultBranch): string
    {
        $cleanSlug = htmlspecialchars($slug, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $cleanBranch = htmlspecialchars($defaultBranch, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $rightLabel = "Explore {$cleanSlug} in 3D";
        $leftW = 104;
        $rightW = max(172, (int) round(mb_strlen("Explore {$slug} in 3D") * 6.6) + 34);
        $totalW = $leftW + $rightW;
        $borderW = $totalW - 1;
        $rightCenter = $leftW + (int) round($rightW / 2) + 2;

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$totalW}" height="28" viewBox="0 0 {$totalW} 28" role="img" aria-label="GitVillage: Explore {$cleanSlug} in 3D ({$cleanBranch})">
  <title>Explore {$cleanSlug} in 3D on GitVillage</title>
  <defs>
    <linearGradient id="gvLeft" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="gvRight" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a84ff"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
    <clipPath id="gvClip">
      <rect width="{$totalW}" height="28" rx="6"/>
    </clipPath>
  </defs>
  <g clip-path="url(#gvClip)">
    <rect width="{$leftW}" height="28" fill="url(#gvLeft)"/>
    <rect x="{$leftW}" width="{$rightW}" height="28" fill="url(#gvRight)"/>
  </g>
  <rect x="0.5" y="0.5" width="{$borderW}" height="27" rx="5.5" fill="none" stroke="rgba(255,255,255,0.18)"/>
  <!-- Mini floating island skyline icon -->
  <g transform="translate(9, 6)">
    <polygon points="3,9 15,9 12,15 6,15" fill="#38bdf8" opacity="0.85"/>
    <rect x="2" y="7" width="14" height="2.6" rx="1.2" fill="#4ade80"/>
    <polygon points="6,7 9,2.5 12,7" fill="#fbbf24"/>
  </g>
  <text x="31" y="18" fill="#f8fafc" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="11.5" font-weight="700">GitVillage</text>
  <circle cx="{$leftW}" cy="14" r="0" fill="none"/>
  <text x="{$rightCenter}" y="18" text-anchor="middle" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="11.5" font-weight="600">{$rightLabel}</text>
</svg>
SVG;
    }
}
