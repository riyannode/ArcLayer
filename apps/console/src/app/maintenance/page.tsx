export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#05070a] px-6 py-16 text-center text-[#EAE4D8]">
      <section className="w-full max-w-2xl rounded-[2rem] border border-cyan-300/15 bg-white/[0.03] px-6 py-12 shadow-2xl shadow-cyan-500/10 md:px-12">
        <p className="font-mono text-xs uppercase tracking-[0.42em] text-cyan-300/80">
          ArcLayer
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-6xl">
          ArcLayer is in under maintenance
        </h1>
        <p className="mt-5 text-base leading-7 text-[#EAE4D8]/65 md:text-lg">
          The frontend is temporarily paused. Protocol API routes remain available.
        </p>
      </section>
    </main>
  );
}
