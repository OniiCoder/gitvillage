<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="text-scale" content="scale" />
        <meta name="csrf-token" content="{{ csrf_token() }}" />
        @if (filled(config('services.posthog.key')))
            <meta name="posthog-key" content="{{ config('services.posthog.key') }}" />
            <meta name="posthog-host" content="{{ config('services.posthog.host', 'https://us.i.posthog.com') }}" />
            @if (config('services.posthog.capture_local'))
                <meta name="posthog-capture-local" content="true" />
            @endif
        @endif
        @php
            $og = $ogMeta ?? [
                'title' => 'GitVillage — Turn any Git repository into a living 3D world',
                'description' => 'Explore any GitHub or local Git repository as floating 3D branch islands, bridges, unified file diffs, and autonomous commit citizens.',
                'url' => url()->current(),
                'image' => url('/og/default.png'),
            ];
        @endphp
        <meta name="description" content="{{ $og['description'] }}" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="GitVillage" />
        <meta property="og:title" content="{{ $og['title'] }}" />
        <meta property="og:description" content="{{ $og['description'] }}" />
        <meta property="og:url" content="{{ $og['url'] }}" />
        <meta property="og:image" content="{{ $og['image'] }}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:creator" content="@oniicode" />
        <meta name="twitter:title" content="{{ $og['title'] }}" />
        <meta name="twitter:description" content="{{ $og['description'] }}" />
        <meta name="twitter:image" content="{{ $og['image'] }}" />
        <title inertia>{{ config('app.name', 'GitVillage') }}</title>
        @viteReactRefresh
        @vite(['resources/css/app.css', 'resources/js/app.tsx'])
        @inertiaHead
    </head>
    <body>
        @inertia
    </body>
</html>
