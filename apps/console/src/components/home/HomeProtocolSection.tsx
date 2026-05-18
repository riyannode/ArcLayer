'use client';

/**
 * Protocol primitives placeholder — keeps the same vertical height as the
 * previous 4-card grid so page layout doesn't shift. Content removed per request.
 */
export default function HomeProtocolSection() {
  return (
    <section
      id="protocol"
      className="relative z-20 px-6 py-14 md:px-12 md:pl-[80px] md:py-16 lg:px-24"
      aria-hidden="true"
    >
      <div
        className="pointer-events-none absolute left-[56px] top-0 h-px w-[48%] bg-transparent md:w-[50%] xl:w-[52%] 2xl:w-[56%]"
        aria-hidden="true"
      />
      {/* Empty spacer — preserves original section height (~160px) */}
      <div className="mx-auto max-w-[1600px]" style={{ minHeight: '120px' }} />
    </section>
  );
}
