'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Compatibility redirect for invite emails that linked to /register?invite=...
 * The actual auth UI lives at /login (with mode=register).
 */
function RegisterRedirectInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const qs = params.toString();
    router.replace(`/login${qs ? `?${qs}` : '?mode=register'}`);
  }, [params, router]);

  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
      Redirecting…
    </div>
  );
}

export default function RegisterRedirect() {
  return (
    <Suspense fallback={<div style={{ padding: 32, textAlign: 'center' }}>Loading…</div>}>
      <RegisterRedirectInner />
    </Suspense>
  );
}
