# Home (landing page)

The `/` route is **isolated** from the in-app protocol chrome (Navbar,
Footer, WebGLBackground). Everything that renders on the landing lives
here so devs can find and edit it without grep'ing the rest of the app.

## Where to edit

| You want to change… | File |
|---|---|
| Top bar logo, wordmark, nav, LIVE status, OPEN CONSOLE button | `HomeHeader.tsx` |
| Left vertical AUREO-style rail (md+) | `HomeSidebar.tsx` |
| Serif headline, slogan, quickstart code, CTAs | `HomeHero.tsx` |
| The 4 deployed contract links strip | `HomeProofStrip.tsx` |
| Modules / Agents / Proofs numerals | `HomeStats.tsx` |
| Monumental ring / city SVG on the right | `ArchVisual.tsx` |
| Glass card overlapping the ring (progress %) | `HomeFeaturedCard.tsx` |
| "Four modules. One settlement fabric." section | `HomeProtocolSection.tsx` |
| Bottom network metadata strip | `HomeFooterStrip.tsx` |
| Page shell / grid composition | `../../app/page.tsx` |

## Rules

1. **Never** import landing components from `/dashboard`, `/jobs`,
   `/agents`, `/docs`, or `/job/[id]` routes. They belong to `/` only.
2. **Never** add landing-only visuals to the shared `Navbar` or `Footer`.
   Those are hidden on `/` by design in `app/layout.tsx`.
3. Copy changes (slogan, section titles, descriptions) happen **only**
   inside these files — no parallel design system, no forked tokens.
4. Typography: display copy uses `aureo-display` (Cormorant Garamond,
   300), body uses `aureo-body` (Inter, 300), labels use
   `aureo-mono-label`. All defined in `app/globals.css`.
5. Palette: `#EAE4D8` ivory, `#C5A67C` gold, `#B8CD7E` accent,
   `#7A7A7A` muted, `#050505` background.

## Data

- `HomeStats` hydrates from `/api/indexer/overview` (own-origin Next.js
  proxy) with a silent fallback to zeroed counts. No external fetches.
- `HomeProofStrip` links to `https://explorer.testnet.arc.network` with
  the real deployed addresses on chain `5042002`.

## Slogan

> **protocol layer for the agentic economy**

Keep this wording exactly in the hero headline. Anywhere else it
appears (meta tags, og:title) lives in `app/layout.tsx`.
