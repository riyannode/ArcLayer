'use client';

export default function WebGLBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          'radial-gradient(circle at 78% 12%, rgba(85,223,231,0.045), transparent 32%), linear-gradient(180deg, #101313 0%, #0d0f0f 48%, #101313 100%)',
      }}
    >
      <div className="absolute inset-0 dot-pattern opacity-45" />
    </div>
  );
}
