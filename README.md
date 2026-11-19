# GitVillage

[![Explore in GitVillage](https://gitvillage.on-forge.com/badge/OniiCoder/gitvillage.svg)](https://gitvillage.on-forge.com/gh/OniiCoder/gitvillage)

Turn any Git repository into a living 3D floating-island village — built with **Laravel**, **Inertia.js**, **React**, **TypeScript**, and **Three.js**.

**Live Demo:** [https://gitvillage.on-forge.com](https://gitvillage.on-forge.com) · [Explore `laravel/framework` in 3D →](https://gitvillage.on-forge.com/gh/laravel/framework)

- **Every Commit is Architecture & Citizenry**: Commits rise as cottages, workshops, and towers along floating branch islands linked by non-overlapping, one-way fork and merge bridges.
- **Git Archetypes, CI Weather & Time-Lapse Replay**: Commits earn playful titles & 3D gear (*Friday Deployer*, *The Demolitionist*, *3 AM Night Owl*, *One-Line Sniper*), failing GitHub Actions roll thunderclouds & rain over `HEAD`, and **Replay** grows the entire village chronologically commit-by-commit.
- **Share & Capture Studio**: Export watermarked 3D postcards (`PNG`), 6-second sweeping turntable clips (`MP4`/`WebM`), dynamic `1200×630` OpenGraph cards, and embeddable `README.md` mini-skyline badges.
- **Interactive File Diffs & Branch Switching**: Click any commit building to inspect changed files inline or inside a two-pane unified diff viewer, and switch active branches directly from the topbar.
- **Carried Cargo Rigs**: Every citizen hauls a 3D backpack stack scaled by the number of files and lines changed in that commit.
- **Contributor Clans**: Commits from the same author share collision-free clan colors, ear silhouettes, scarves, and crest standards (`● KV`, `◆ ML`) so collaborators are recognizable at a glance.
- **Local Repos & the Village Gate**: Open any local Git folder — uncommitted working-tree changes queue outside the double-hinged **Village Gate** (with Golden Tickets for `git add` staged files) until committed.
- **Works Locally & in Production**:
  - Locally (`APP_ENV=local`), Laravel's `LocalGitController` discovers repositories on your machine and supports native folder picking and branch switching.
  - On deployed servers (`APP_ENV=production`), server filesystem endpoints are locked (`403`) while the **100% client-side Browser `.git` Folder Reader** (`DecompressionStream` + `SubtleCrypto`) lets any visitor inspect folders privately in their own browser with zero uploads, alongside streaming any public GitHub repository (`/gh/{owner}/{repo}`).

## Quick Start

```bash
composer install
cp .env.example .env
php artisan key:generate
npm install
composer run dev
```

For a production asset build and test verification:

```bash
npm run build
composer test
```

## Key Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Main 3D Village (`?repo=owner/name` supported) |
| `GET /gh/{owner}/{repo}` | Direct Inertia deep-link to any public GitHub repository |
| `GET /api/local-*` | Local Git discovery & working-tree gate inspection (`APP_ENV=local` only) |
