'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy /jobs chooser page — redirects to /dashboard.
 * Users now start from Dashboard, choose an agent, then direct hire via /agent/[id]/escrow.
 */
export default function JobsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] text-[#EAE4D8]">
      <p className="font-mono text-sm text-[#EAE4D8]/55">
        Redirecting to dashboard…
      </p>
    </div>
  );
}
