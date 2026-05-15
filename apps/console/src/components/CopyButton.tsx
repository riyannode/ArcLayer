'use client';

import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label = 'Copy', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copyText}
      className={`border border-[#C5A67C]/30 bg-[#C5A67C]/10 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#C5A67C] transition hover:border-[#C5A67C]/60 hover:bg-[#C5A67C]/15 ${className}`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
