'use client';

import { useState, type ReactNode } from 'react';

interface DevDetailsProps {
  children: ReactNode;
  label?: string;
}

/**
 * Collapsible "Developer details" section.
 * Technical content (EIP-3009, headers, scheme names, raw payloads)
 * lives here — hidden by default so users/reviewers see clean UI,
 * but devs can expand for full context.
 */
export function DevDetails({ children, label = 'Developer details' }: DevDetailsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border border-white/8 bg-black/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-white/80 transition hover:text-white/80"
        aria-expanded={open}
      >
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 py-4 font-mono text-[10.5px] leading-[1.8] text-white/80">
          {children}
        </div>
      )}
    </div>
  );
}
