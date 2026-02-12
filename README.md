# PurpleSky

A Bluesky (AT Protocol) PWA built with **Astro** and **Preact**: simple routing, no prefetch surprises, and reliable deployment to GitHub Pages.

## Features

- **Feed** – Timeline (logged in) or What's Hot (logged out)
- **Post detail** – Click any post to open it; plain links, no client-side router quirks
- **OAuth** – Log in with Bluesky (handle or app password)
- **PWA** – Installable, service worker for offline shell
- **GitHub Pages** – Static build with base path; 404 → app shell for direct links

## Tech Stack

| Layer   | Technology |
|--------|------------|
| Shell  | [Astro](https://astro.build/) (static HTML, base path) |
| UI     | [Preact](https://preactjs.com/) (feed, post card, post detail) |
| Protocol| [AT Protocol](https://atproto.com/) (Bluesky) |
| Deploy | GitHub Pages (static) |

## Project Structure

```
purplesky-fix/
├── astro.config.mjs    # Base path, Preact integration
├── src/
│   ├── pages/          # Astro pages (index, 404)
│   ├── layouts/        # Layout.astro (HTML shell, global CSS)
│   ├── app/            # Preact app (Feed, PostDetail, PostCard, Nav)
│   ├── lib/            # bsky.ts, oauth.ts, types.ts, path.ts, image-utils.ts
│   └── global.css      # Theme variables, glass, utilities
├── public/             # manifest.json, icon.svg, sw.js, client-metadata.json
└── .github/workflows/  # Deploy to GitHub Pages
```

## Getting Started

### Prerequisites

- Node.js 20+

### Install

```bash
npm install
```

### Development

```bash
npm run dev
# Open http://localhost:4321 (or the URL with /purplesky-fix/ if base is set)
```

### Build

```bash
npm run build
# Output in dist/
```

### Deploy to GitHub Pages

1. **Enable GitHub Pages** in the repo: **Settings → Pages → Source**: **GitHub Actions**.
2. Push to `main` (or run the workflow from the Actions tab).
3. The workflow builds with `ASTRO_BASE_PATH=/${{ repo.name }}/`, copies `index.html` to `404.html` for SPA-style direct links, adds `.nojekyll`, and generates `client-metadata.json` for OAuth.
4. The app will be at **`https://<your-username>.github.io/<repo-name>/`**.

No server or database. Session and preferences use **localStorage**; the service worker caches the app shell.

## Why Astro

This version was rewritten from Qwik to Astro so that:

- **Links are normal `<a href>`** – No framework prefetch or viewport-based loading; clicking a post goes to the post URL.
- **Routing is simple** – One HTML shell; the Preact app reads `window.location.pathname` and shows Feed or Post Detail. Direct links (e.g. `/post/at://...`) hit 404 on GitHub Pages, which serves `404.html` (same shell), so the app loads and shows the correct view.
- **Build is predictable** – Static output, no SSR or WASM in the critical path.

## License

AGPL-3.0-or-later
