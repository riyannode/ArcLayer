'use client';

/**
 * ArcLayer — Landing page.
 *
 * This file is intentionally a thin composition. Every visual piece lives in
 * `@/components/home/*` so the landing stays isolated from the in-app
 * protocol chrome (Footer, WebGLBackground) while sharing Navbar. Touching the hero,
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
  HomeFooterStrip,
  HomeHero,
  HomeProtocolSection,
  HomeSidebar,
} from '@/components/home';

export default function Home() {
  return (
    <div
      id="top"
      className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#050505] text-[#EAE4D8]"
    >
      <DotMatrixField />

      <HomeSidebar />

      {/*
        Grid tuned for 80–90% browser zoom primary target (desktop 1440/1536/1920).
        12-col split: hero takes 7, right visual/terminal column takes 5.
        Vertical padding reduced so first viewport fits: nav → hero → CTAs → proof → stats → right column
        without the lower cards being pushed below the fold at 80–90% zoom.
      */}
      <main className="relative z-20 flex-1 overflow-x-clip pl-3 pr-3 pt-8 pb-4 md:pl-[68px] md:pr-5 md:pt-9 md:pb-4 lg:pl-[78px] xl:pl-[88px] 2xl:pl-[96px]">
        <div className="relative grid min-h-[calc(100svh-80px)] grid-cols-1 gap-y-6 md:grid-cols-12 md:items-center md:gap-x-12 xl:gap-x-14 2xl:gap-x-16">
          <div className="md:col-span-5 md:max-w-[540px] md:justify-self-start md:pl-6 xl:pl-8">
            <HomeHero />
          </div>

          <div className="relative flex flex-col gap-3.5 md:col-span-7 md:min-h-[470px] md:justify-self-end md:w-full md:max-w-[880px] min-w-0">
            {/* Hex grid — logo floats solo (terminal moved into hero, AEON ESCROW removed) */}
            <div className="relative flex flex-1 items-center justify-center">
              <HexGrid3D />
            </div>
          </div>
        </div>

        <HomeProtocolSection />
      </main>
      <HomeFooterStrip />
    </div>
  );
}
