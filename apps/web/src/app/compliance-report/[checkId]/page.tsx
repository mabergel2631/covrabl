'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { leaseComplianceApi, ComplianceResultItem } from '../../../../lib/api';
import { trackClick, trackPageView } from '../../../../lib/track';
import BackButton from '../../components/BackButton';

export default function ComplianceReportPage() {
  const { token } = useAuth();
  const router = useRouter();
  const params = useParams();
  const checkId = Number(params.checkId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportText, setReportText] = useState('');
  const [results, setResults] = useState<ComplianceResultItem[]>([]);
  const [passCount, setPassCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [unclearCount, setUnclearCount] = useState(0);

  useEffect(() => {
    trackPageView('compliance_report');

    const load = async () => {
      try {
        // Try authenticated endpoint first, fall back to public
        let status: any;
        try {
          status = await leaseComplianceApi.pollCheckStatus(checkId);
        } catch {
          // Not authenticated or no access — try public endpoint
          const { API_BASE } = await import('../../../../lib/api');
          const res = await fetch(`${API_BASE}/lease-compliance/public/checks/${checkId}/status`);
          if (!res.ok) throw new Error('Report not found');
          status = await res.json();
        }
        if (status.results) setResults(status.results);
        if (status.report_text) setReportText(status.report_text);
        setPassCount(status.pass_count || 0);
        setFailCount(status.fail_count || 0);
        setUnclearCount(status.unclear_count || 0);

        // If report not ready yet, poll a few times
        if (!status.report_text && status.status === 'complete') {
          let attempts = 0;
          const poll = async () => {
            try {
              const s = await leaseComplianceApi.pollCheckStatus(checkId);
              if (s.report_text) { setReportText(s.report_text); return; }
            } catch { /* ignore */ }
            attempts++;
            if (attempts < 10) { await new Promise(r => setTimeout(r, 3000)); return poll(); }
          };
          await poll();
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load report');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, checkId]);

  const handlePrint = () => {
    trackClick('compliance_report_print', { check_id: checkId });
    window.print();
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading report...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: '#dc2626' }}>{error}</p>
        <button onClick={() => router.back()} style={{ marginTop: 16, padding: '8px 20px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>Go Back</button>
      </div>
    );
  }

  const verdict = failCount === 0 && unclearCount === 0 && passCount > 0
    ? 'Compliant' : failCount > 0 && passCount > 0
    ? 'Partially Compliant' : failCount > 0
    ? 'Non-Compliant' : 'Needs Verification';
  const verdictColor = verdict === 'Compliant' ? '#166534' : verdict === 'Non-Compliant' ? '#991b1b' : '#92400e';
  const verdictBg = verdict === 'Compliant' ? '#dcfce7' : verdict === 'Non-Compliant' ? '#fee2e2' : '#fef3c7';

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Navigation - hidden when printing */}
        <div className="no-print">
          <BackButton href="/certificates" label="Compliance Report" parentLabel="Compliance" />
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button
              onClick={handlePrint}
              style={{ padding: '8px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Print / Save as PDF
            </button>
            <button
              onClick={() => { trackClick('compliance_report_copy'); navigator.clipboard.writeText(reportText || ''); }}
              style={{ padding: '8px 20px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontSize: 14, cursor: 'pointer' }}
            >
              Copy Report Text
            </button>
          </div>
        </div>

        {/* Report Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', color: '#1a1a2e' }}>
            Insurance Compliance Report
          </h1>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Generated {new Date().toLocaleDateString()} &middot; Check #{checkId}
          </div>
        </div>

        {/* Verdict Banner */}
        <div style={{ padding: '16px 24px', borderRadius: 12, marginBottom: 32, backgroundColor: verdictBg, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: verdictColor }}>{verdict}</div>
          <div style={{ fontSize: 14, color: verdictColor, marginTop: 4 }}>
            {passCount} passed &middot; {failCount} failed &middot; {unclearCount} unclear
          </div>
        </div>

        {/* Pass/Fail Summary */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: '#1a1a2e' }}>Compliance Summary</h2>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            {results.map((r, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: i < results.length - 1 ? '1px solid #e5e7eb' : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                  {r.status === 'pass' ? '\u2705' : r.status === 'fail' ? '\u274C' : '\u2753'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>{r.requirement_label}</div>
                  {r.note && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{r.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Full Narrative Report */}
        {reportText ? (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: '#1a1a2e' }}>Detailed Analysis</h2>
            <div style={{ fontSize: 14, lineHeight: 1.8, color: '#1a1a2e', whiteSpace: 'pre-wrap' }}>
              {reportText}
            </div>
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 14, border: '1px dashed #e5e7eb', borderRadius: 8 }}>
            Detailed analysis is being generated. Refresh the page in a moment.
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 32, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Report generated by Covrabl &middot; covrabl.com &middot; Bank-level encryption &middot; Data is private and never sold
        </div>
      </div>
    </>
  );
}
