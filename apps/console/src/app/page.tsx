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

      <main className="relative z-20 min-h-screen md:pl-[56px]">
        <div className="relative mx-auto grid max-w-[1480px] grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[1.18fr_0.82fr] md:gap-12 md:px-10 md:py-16 lg:px-14">
          <HomeHero />

          <div className="relative flex min-h-[480px] flex-col gap-8 md:min-h-[680px]">
            <div className="relative flex flex-1 items-center justify-center">
              <HexGrid3D />
              <HomeFeaturedCard />
            </div>
            <LiveLogStream />
          </div>
        </div>

        <HomeProtocolSection />
        <HomeFooterStrip />
      </main>
    </div>
  );
}
