'use client';

import { useRouter } from 'next/navigation';

type BackButtonProps = {
  href: string;
  label: string;
  /** Optional parent label for breadcrumb style: "← Parent / Current" */
  parentLabel?: string;
};

export default function BackButton({ href, label, parentLabel }: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    // If the user navigated here from another page in this app, pop history
    // so the browser's forward button works as expected. Otherwise (deep link
    // or external referrer), fall back to pushing the parent href.
    if (typeof window !== 'undefined') {
      const ref = document.referrer;
      if (ref && ref.startsWith(window.location.origin)) {
        router.back();
        return;
      }
    }
    router.push(href);
  };

  return (
    <nav style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={handleClick}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '4px 0',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: 'var(--color-primary)',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span>
        {parentLabel || label}
      </button>
      {parentLabel && (
        <>
          <span style={{ color: 'var(--color-text-muted)' }}>/</span>
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{label}</span>
        </>
      )}
    </nav>
  );
}
