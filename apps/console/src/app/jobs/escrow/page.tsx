'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy /jobs/escrow page — redirects to /a2a agent discovery.
 * The direct hire flow now lives at /agent/[id]/escrow.
 */
export default function EscrowRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/a2a');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] text-[#EAE4D8]">
      <p className="font-mono text-sm text-[#EAE4D8]/55">
        Redirecting to agent discovery…
      </p>
    </div>
  );
}
