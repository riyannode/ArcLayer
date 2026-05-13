'use client';

/**
 * ArcLayer — Landing page.
 *
 * This file is intentionally a thin composition. Every visual piece lives in
 * `@/components/home/*` so the landing stays isolated from the in-app
 * protocol chrome (Navbar, Footer, WebGLBackground). Touching the hero,
 * sidebar, proof strip, stats, or protocol section? Edit the file in
 * `components/home/` — do not fatten this page back up.
 *
 * Shell-only responsibilities here:
 *   - Page background color + overflow frame
 *   - DotMatrixField ambient canvas (landing-only)
 *   - Top-level grid layout that pairs the hero with ArchVisual
 *   - Scroll anchor targets (#top, #protocol)
 */

import DotMatrixField from '@/components/DotMatrixField';
import {
  HexGrid3D,
  HomeFeaturedCard,
  HomeFooterStrip,
  HomeHeader,
  HomeHero,
  HomeProtocolSection,
  HomeSidebar,
  LiveLogStream,
} from '@/components/home';

export default function Home() {
  return (
    <div
      id="top"
      className="relative min-h-screen w-full overflow-hidden bg-[#050505] text-[#EAE4D8]"
    >
      <DotMatrixField />

      <HomeHeader />
      <HomeSidebar />

      <main className="relative z-20 min-h-screen md:pl-[48px]">
        <div className="relative ml-0 mr-auto grid max-w-[1280px] grid-cols-1 gap-6 px-3 py-10 md:grid-cols-[1fr_0.85fr] md:gap-7 md:px-4 md:py-12 lg:px-5">
          <HomeHero />

          <div className="relative flex min-h-[420px] flex-col gap-6 md:min-h-[560px]">
            {/* Hex grid — logo floats solo */}
            <div className="relative flex flex-1 items-center justify-center">
              <HexGrid3D />
            </div>
            {/* Row: terminal (wide) + active escrow card (compact) side-by-side */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.35fr_0.65fr]">
              <LiveLogStream />
              <HomeFeaturedCard />
            </div>
          </div>
        </div>

        <HomeProtocolSection />
        <HomeFooterStrip />
      </main>
    </div>
  );
}
