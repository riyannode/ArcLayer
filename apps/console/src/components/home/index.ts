/**
 * ArcLayer landing — home composition.
 *
 * The landing page is intentionally isolated from the shared protocol chrome
 * (Footer, WebGLBackground) while sharing Navbar. All landing-only pieces live in this
 * folder so future dev work on marketing doesn't leak into /dashboard, /jobs,
 * /agents, or the SDK surface.
 *
 * Structure:
 *   HomeSidebar        — slim vertical AUREO-style rail (md+)
 *   HomeHero           — editorial headline + quickstart + CTAs
 *     └─ HomeProofStrip  — 4 deployed contracts on Arc Testnet
 *     └─ HomeStats       — live indexer stats (fallbacks silently)
 *   ArchVisual         — monumental ring SVG (right column)
 *   HomeFeaturedCard   — glass card overlapping the visual
 *   HomeProtocolSection — "Four modules. One settlement fabric."
 *   HomeFooterStrip    — small network metadata strip
 */
export { default as HomeSidebar } from './HomeSidebar';
export { default as HomeHero } from './HomeHero';
export { default as HomeStats } from './HomeStats';
export { default as HomeProofStrip } from './HomeProofStrip';
export { default as HomeFeaturedCard } from './HomeFeaturedCard';
export { default as ArchVisual } from './ArchVisual';
export { default as HexGrid3D } from './HexGrid3D';
export { default as LiveLogStream } from './LiveLogStream';
export { default as HomeProtocolSection } from './HomeProtocolSection';
export { default as HomeFooterStrip } from './HomeFooterStrip';
