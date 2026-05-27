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
import LiveLogStream from '@/components/home/LiveLogStream';
import {
  HexGrid3D,
  HomeFooterStrip,
  HomeHero,
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

      <main className="relative z-20 flex-1 overflow-x-clip pl-3 pr-3 pt-8 pb-20 md:pl-[68px] md:pr-5 md:pt-9 md:pb-24 lg:pl-[78px] xl:pl-[88px] 2xl:pl-[96px]">
        <div className="relative grid min-h-[calc(100svh-80px)] grid-cols-1 gap-y-6 md:grid-cols-12 md:items-start md:gap-x-12 xl:gap-x-14 2xl:gap-x-16">
          {/* Left column — hero + x402 demo + onboarding cards */}
          <div className="md:col-span-5 md:max-w-[540px] md:justify-self-start md:pl-6 xl:pl-8">
            <HomeHero />
          </div>

          {/* Right column — honeycomb + live indexer stream */}
          <div className="relative flex flex-col gap-6 md:col-span-7 md:min-h-[470px] md:justify-self-end md:w-full md:max-w-[880px] min-w-0">
            <div className="relative flex flex-1 items-center justify-center">
              <HexGrid3D />
            </div>

            {/* Live indexer — below honeycomb, aligned */}
            <div className="section-reveal" style={{ animationDelay: '0.5s' }}>
              <LiveLogStream />
            </div>
          </div>
        </div>
      </main>
      <HomeFooterStrip />
    </div>
  );
}
