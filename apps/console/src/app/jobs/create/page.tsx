'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function CreateRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const agent = searchParams.get('agent') || searchParams.get('agentId') || '';

  useEffect(() => {
    router.replace('/dashboard');
  }, [agent, router]);

  return null;
}

export default function CreateJobPage() {
  return (
    <Suspense fallback={null}>
      <CreateRedirect />
    </Suspense>
  );
}
