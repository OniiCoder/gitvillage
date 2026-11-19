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
        <title inertia>{{ config('app.name', 'GitVillage') }}</title>
        @viteReactRefresh
        @vite(['resources/css/app.css', 'resources/js/app.tsx'])
        @inertiaHead
    </head>
    <body>
        @inertia
    </body>
</html>
