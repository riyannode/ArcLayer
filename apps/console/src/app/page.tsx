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

      {/*
        Grid tuned for 80–90% browser zoom primary target (desktop 1440/1536/1920).
        12-col split: hero takes 7, right visual/terminal column takes 5.
        Vertical padding reduced so first viewport fits: nav → hero → CTAs → proof → stats → right column
        without the lower cards being pushed below the fold at 80–90% zoom.
      */}
      <main className="relative z-20 min-h-[calc(100svh-64px)] md:pl-[48px]">
        <div className="relative mx-auto grid max-w-[1480px] grid-cols-1 gap-5 px-3 py-6 md:grid-cols-12 md:gap-6 md:px-4 md:py-8 lg:px-5">
          <div className="md:col-span-7">
            <HomeHero />
          </div>

          <div className="relative flex flex-col gap-4 md:col-span-5 md:min-h-[480px]">
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
