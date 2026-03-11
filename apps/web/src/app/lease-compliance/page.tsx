'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LeaseCompliancePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/certificates');
  }, [router]);

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
      <p style={{ fontSize: 14 }}>Redirecting to Compliance Verification...</p>
    </div>
  );
}
