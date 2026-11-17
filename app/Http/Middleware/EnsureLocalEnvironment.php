<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureLocalEnvironment
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! app()->isLocal()) {
            return response()->json([
                'error' => 'Server-side local repository inspection is only available when APP_ENV=local. Use the client-side Browser Folder Picker instead.',
            ], 403);
        }

        return $next($request);
    }
}
