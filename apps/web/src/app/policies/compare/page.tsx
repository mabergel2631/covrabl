'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { policiesApi, compareApi, chatApi, Policy, PolicyBundle, CompareAnalysis } from '../../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../../lib/track';
import BackButton from '../../components/BackButton';

const SEVERITY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: '#fef2f2', color: '#991b1b', label: 'Critical' },
  important: { bg: '#fefce8', color: '#92400e', label: 'Important' },
  informational: { bg: '#f8fafc', color: '#475569', label: 'Info' },
};

const CATEGORY_LABELS: Record<string, string> = {
  coverage_gap: 'Item to Review',
  sublimit_difference: 'Sublimit Difference',
  exclusion_difference: 'Exclusion Difference',
  deductible: 'Deductible',
  premium: 'Premium',
  condition: 'Condition',
  endorsement: 'Endorsement',
  general: 'General',
};

function CompareContent() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') || '';
  const initialIds = idsParam.split(',').map(Number).filter(Boolean);

  const [allPolicies, setAllPolicies] = useState<Policy[]>([]);
  const [selectedIds, setSelectedIds] = useState<(number | null)[]>(
    initialIds.length >= 2 ? initialIds.map(id => id as number | null) : [null, null]
  );
  const [bundles, setBundles] = useState<PolicyBundle[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // AI Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CompareAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');

  // Ask AI drawer state
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiConversationId, setAiConversationId] = useState<number | null>(null);
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    policiesApi.list().then(setAllPolicies).catch(() => {});
  }, [token]);

  // Auto-compare when IDs come from URL
  useEffect(() => {
    const validIds = selectedIds.filter((id): id is number => id !== null && id > 0);
    if (validIds.length >= 2) {
      runCompare(validIds);
    }
  }, []);

  const getCompareIds = (): number[] => {
    return selectedIds.filter((id): id is number => id !== null && id > 0);
  };

  const runCompare = async (ids: number[]) => {
    setLoading(true);
    setError('');
    setAnalysis(null);
    setAnalysisError('');
    try {
      setBundles(await compareApi.compare(ids));
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = () => {
    const validIds = getCompareIds();
    if (validIds.length < 2) {
      setError('Select at least 2 policies to compare.');
      return;
    }
    if (validIds.length > 4) {
      setError('Select up to 4 policies.');
      return;
    }
    trackFeatureUse('compare_policies', { count: validIds.length });
    router.replace(`/policies/compare?ids=${validIds.join(',')}`, { scroll: false });
    runCompare(validIds);
  };

  const handleAnalyze = async () => {
    const validIds = getCompareIds();
    if (validIds.length < 2) return;
    trackFeatureUse('analyze_policies', { count: validIds.length });
    setAnalyzing(true);
    setAnalysisError('');
    setAnalysis(null);
    try {
      const result = await compareApi.analyze(validIds);
      setAnalysis(result);
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      setAnalysisError(err.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAiSend = useCallback((message?: string) => {
    const text = (message || aiInput).trim();
    if (!text || aiStreaming) return;
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    setAiStreaming(true);
    let assistantText = '';
    setAiMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const comparePolicyIds = getCompareIds();
    const controller = chatApi.sendMessageStream(
      text,
      aiConversationId,
      (chunk) => {
        assistantText += chunk;
        setAiMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantText };
          return updated;
        });
      },
      (id) => setAiConversationId(id),
      () => setAiStreaming(false),
      (err) => {
        setAiMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err}` };
          return updated;
        });
        setAiStreaming(false);
      },
      undefined,
      comparePolicyIds,
    );
    aiAbortRef.current = controller;
  }, [aiInput, aiStreaming, aiConversationId, selectedIds]);

  useEffect(() => {
    if (aiMessagesEndRef.current) {
      aiMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages]);

  const updateSelection = (index: number, value: number | null) => {
    setSelectedIds(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const addSlot = () => {
    if (selectedIds.length < 4) {
      setSelectedIds(prev => [...prev, null]);
    }
  };

  const removeSlot = (index: number) => {
    if (selectedIds.length > 2) {
      setSelectedIds(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Auto-filter: once any slot has a selection, other slots show same policy_type
  // with an opt-out "Show all types" toggle
  const [showAllTypes, setShowAllTypes] = useState(false);

  const getFilteredPolicies = (slotIndex: number): Policy[] => {
    if (showAllTypes) return allPolicies;
    // Find the first selected policy's type (from any slot)
    const firstSelectedId = selectedIds.find((id, i) => id !== null && i !== slotIndex);
    if (firstSelectedId == null) return allPolicies;
    const firstSelected = allPolicies.find(p => p.id === firstSelectedId);
    if (!firstSelected) return allPolicies;
    return allPolicies.filter(p => p.policy_type === firstSelected.policy_type);
  };

  const formatPolicyOption = (p: Policy): string => {
    const parts = [p.carrier, '-', p.policy_type];
    if (p.renewal_date) {
      parts.push(`(renews ${p.renewal_date})`);
    } else {
      parts.push(`(${p.policy_number})`);
    }
    if (p.status === 'archived') parts.push('[Archived]');
    return parts.join(' ');
  };

  const getPolicyLabel = (policyId: number): string => {
    const bundle = bundles.find(b => b.policy.id === policyId);
    if (bundle) return bundle.policy.nickname || `${bundle.policy.carrier} - ${bundle.policy.policy_type}`;
    return `Policy #${policyId}`;
  };

  if (!token) return null;

  const fields: { label: string; key: string; fmt?: (v: any) => string }[] = [
    { label: 'Carrier', key: 'carrier' },
    { label: 'Type', key: 'policy_type' },
    { label: 'Scope', key: 'scope' },
    { label: 'Policy #', key: 'policy_number' },
    { label: 'Nickname', key: 'nickname' },
    { label: 'Coverage', key: 'coverage_amount', fmt: v => v != null ? `$${v.toLocaleString()}` : '-' },
    { label: 'Deductible', key: 'deductible', fmt: v => v != null ? `$${v.toLocaleString()}` : '-' },
    { label: 'Renewal Date', key: 'renewal_date', fmt: v => v || '-' },
  ];

  const allValues = (key: string) => bundles.map(b => JSON.stringify((b.policy as any)[key]));
  const isDiff = (key: string) => { const vals = allValues(key); return vals.length > 1 && new Set(vals).size > 1; };

  const colWidth = bundles.length > 0 ? `${100 / (bundles.length + 1)}%` : '50%';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <BackButton href="/policies" label="Compare" parentLabel="Policies" />

      <h1 style={{ margin: '0 0 24px', fontSize: 22 }}>Compare Policies</h1>

      {/* Policy Selectors */}
      <div style={{ backgroundColor: '#fff', padding: 20, borderRadius: 8, border: '1px solid #ddd', marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${selectedIds.length}, 1fr)`, gap: 12, marginBottom: 12 }}>
          {selectedIds.map((id, index) => {
            const filtered = getFilteredPolicies(index);
            return (
              <div key={index}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>
                  Policy {index + 1}
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    value={id ?? ''}
                    onChange={e => updateSelection(index, e.target.value ? Number(e.target.value) : null)}
                    style={{
                      width: '100%', minWidth: 0, padding: '8px 12px', fontSize: 14, border: '1px solid #ddd',
                      borderRadius: 4, backgroundColor: '#fff', cursor: 'pointer',
                    }}
                  >
                    <option value="">Select a policy...</option>
                    {filtered.map(p => (
                      <option key={p.id} value={p.id}>
                        {formatPolicyOption(p)}
                      </option>
                    ))}
                  </select>
                  {selectedIds.length > 2 && (
                    <button
                      onClick={() => removeSlot(index)}
                      style={{ padding: '4px 8px', fontSize: 16, background: 'none', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', color: '#999', flexShrink: 0 }}
                      title="Remove"
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedIds.length < 4 && (
            <button
              onClick={addSlot}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                background: 'none', border: '1px dashed #ccc', borderRadius: 4,
                cursor: 'pointer', color: '#666', height: 38,
              }}
            >
              + Add policy
            </button>
          )}
          <button
            onClick={handleCompare}
            disabled={loading || selectedIds.filter(id => id !== null).length < 2}
            style={{
              padding: '8px 24px', fontSize: 14, fontWeight: 600,
              backgroundColor: '#2563eb', color: '#fff', border: 'none',
              borderRadius: 4, cursor: 'pointer', height: 38,
              opacity: loading || selectedIds.filter(id => id !== null).length < 2 ? 0.5 : 1,
            }}
          >
            {loading ? 'Comparing...' : 'Compare'}
          </button>
          {selectedIds.some(id => id !== null) && (
            <label style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={showAllTypes}
                onChange={e => setShowAllTypes(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Show all policy types
            </label>
          )}
        </div>
      </div>

      {error && <div style={{ padding: 12, marginBottom: 16, backgroundColor: '#fee', color: '#c00', borderRadius: 4 }}>{error}</div>}

      {bundles.length > 0 && (
        <>
          {/* Main fields comparison */}
          <div style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #ddd', overflow: 'hidden', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th style={{ padding: 10, textAlign: 'left', width: colWidth }}>Field</th>
                  {bundles.map(b => (
                    <th key={b.policy.id} style={{ padding: 10, textAlign: 'left', width: colWidth }}>
                      {b.policy.nickname || `${b.policy.carrier} - ${b.policy.policy_type}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fields.map(f => {
                  const diff = isDiff(f.key);
                  return (
                    <tr key={f.key} style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: diff ? '#fefce8' : 'transparent' }}>
                      <td style={{ padding: 10, fontWeight: 500, color: '#555' }}>{f.label}</td>
                      {bundles.map(b => {
                        const val = (b.policy as any)[f.key];
                        return (
                          <td key={b.policy.id} style={{ padding: 10 }}>
                            {f.fmt ? f.fmt(val) : (val ?? '-')}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Coverage items */}
          <div style={{ backgroundColor: '#fff', padding: 24, borderRadius: 8, border: '1px solid #ddd', marginBottom: 24 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Coverage Items</h2>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bundles.length}, minmax(200px, 1fr))`, gap: 16, overflowX: 'auto' }}>
              {bundles.map(b => (
                <div key={b.policy.id}>
                  <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#555' }}>{b.policy.nickname || b.policy.carrier}</h3>
                  {b.coverage_items.length === 0 ? <p style={{ color: '#999', fontSize: 13 }}>None</p> : (
                    b.coverage_items.map(ci => (
                      <div key={ci.id} style={{ padding: 6, marginBottom: 4, fontSize: 13, backgroundColor: ci.item_type === 'inclusion' ? '#f0fdf4' : '#fef2f2', borderRadius: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: ci.item_type === 'inclusion' ? '#166534' : '#991b1b', marginRight: 4 }}>{ci.item_type}</span>
                        {ci.description}
                        {ci.limit && <span style={{ color: '#666' }}> ({ci.limit})</span>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Premiums */}
          <div style={{ backgroundColor: '#fff', padding: 24, borderRadius: 8, border: '1px solid #ddd', marginBottom: 24 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Premiums</h2>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bundles.length}, minmax(200px, 1fr))`, gap: 16, overflowX: 'auto' }}>
              {bundles.map(b => (
                <div key={b.policy.id}>
                  <h3 style={{ fontSize: 14, margin: '0 0 8px', color: '#555' }}>{b.policy.nickname || b.policy.carrier}</h3>
                  {b.premiums.length === 0 ? <p style={{ color: '#999', fontSize: 13 }}>None</p> : (
                    b.premiums.map(pr => (
                      <div key={pr.id} style={{ padding: 6, marginBottom: 4, fontSize: 13, backgroundColor: '#fafafa', borderRadius: 4 }}>
                        ${(pr.amount / 100).toFixed(2)} / {pr.frequency.replace('_', '-')} - Due: {pr.due_date}
                        {pr.paid_date && <span style={{ color: '#059669', marginLeft: 4 }}>(paid)</span>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI Analysis Actions */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              style={{
                padding: '10px 24px', fontSize: 14, fontWeight: 600,
                backgroundColor: analyzing ? '#6b7280' : '#7c3aed', color: '#fff', border: 'none',
                borderRadius: 6, cursor: analyzing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {analyzing ? (
                <>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Analyzing...
                </>
              ) : (
                <>
                  <span style={{ fontSize: 16 }}>&#9733;</span>
                  Analyze Differences
                </>
              )}
            </button>
            <button
              onClick={() => setAiDrawerOpen(true)}
              style={{
                padding: '10px 24px', fontSize: 14, fontWeight: 600,
                backgroundColor: '#fff', color: '#7c3aed', border: '1px solid #7c3aed',
                borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 14 }}>&#10024;</span>
              Ask AI
            </button>
          </div>

          {/* Spinner animation */}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {/* Analysis Error */}
          {analysisError && (
            <div style={{ padding: 12, marginBottom: 16, backgroundColor: '#fee', color: '#c00', borderRadius: 6, fontSize: 14 }}>
              {analysisError}
            </div>
          )}

          {/* AI Analysis Results */}
          {analysis && (
            <div style={{ marginBottom: 24 }}>
              {/* Data Sufficiency Warnings */}
              {analysis.data_sufficiency.filter(ds => ds.sufficiency !== 'full').map(ds => (
                <div key={ds.policy_id} style={{
                  padding: '12px 16px', marginBottom: 12, borderRadius: 6,
                  backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e',
                  fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>&#9888;</span>
                  <div>
                    <strong>{ds.carrier}</strong>
                    <span style={{
                      marginLeft: 8, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 3,
                      backgroundColor: ds.sufficiency === 'minimal' ? '#fecaca' : '#fde68a',
                      color: ds.sufficiency === 'minimal' ? '#991b1b' : '#92400e',
                    }}>
                      {ds.sufficiency} data
                    </span>
                    {ds.warning && <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{ds.warning}</p>}
                  </div>
                </div>
              ))}

              {/* Executive Summary */}
              <div style={{
                padding: '16px 20px', marginBottom: 20, borderRadius: 8,
                backgroundColor: '#f0f4ff', border: '1px solid #c7d2fe', color: '#1e3a5f',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>Summary</h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{analysis.summary}</p>
              </div>

              {/* Findings */}
              {analysis.findings.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#1e293b' }}>
                    Findings ({analysis.findings.length})
                  </h3>
                  {analysis.findings.map((finding, i) => {
                    const sev = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.informational;
                    const catLabel = CATEGORY_LABELS[finding.category] || finding.category;
                    return (
                      <div key={i} style={{
                        padding: '14px 18px', marginBottom: 10, borderRadius: 8,
                        backgroundColor: '#fff', border: `1px solid #e2e8f0`,
                        borderLeft: `4px solid ${sev.color}`,
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            padding: '2px 8px', borderRadius: 4,
                            backgroundColor: sev.bg, color: sev.color,
                          }}>
                            {sev.label}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 600,
                            padding: '2px 8px', borderRadius: 4,
                            backgroundColor: '#f1f5f9', color: '#475569',
                          }}>
                            {catLabel}
                          </span>
                          {finding.policies_affected.length > 0 && (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {finding.policies_affected.map(pid => getPolicyLabel(pid)).join(', ')}
                            </span>
                          )}
                        </div>
                        <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                          {finding.title}
                        </h4>
                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#475569' }}>
                          {finding.description}
                        </p>
                        {finding.recommendation && (
                          <p style={{ margin: '8px 0 0', fontSize: 13, fontStyle: 'italic', color: '#6366f1', lineHeight: 1.5 }}>
                            {finding.recommendation}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Limitations */}
              {analysis.limitations.length > 0 && (
                <div style={{
                  padding: '12px 16px', borderRadius: 6,
                  backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
                }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: '#64748b' }}>Limitations</h4>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                    {analysis.limitations.map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Ask AI Drawer */}
      {aiDrawerOpen && (
        <>
          <div
            onClick={() => { setAiDrawerOpen(false); aiAbortRef.current?.abort(); }}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 899 }}
          />
          <div className="ai-drawer" style={{
            position: 'fixed', right: 0, top: 0, height: '100vh', width: 400,
            backgroundColor: '#fff', zIndex: 900, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid #ddd',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
          }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Ask about these policies</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>AI-powered comparison insights</p>
              </div>
              <button
                onClick={() => { setAiDrawerOpen(false); aiAbortRef.current?.abort(); }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', padding: '4px 8px', lineHeight: 1 }}
                aria-label="Close AI drawer"
              >&times;</button>
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {aiMessages.length === 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Suggested questions:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      'Which policy provides better overall coverage?',
                      'What are the most important exclusion differences?',
                      'What should I review between these two policies?',
                      'Which deductible structure is more cost-effective?',
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => handleAiSend(q)}
                        style={{
                          padding: '10px 14px', textAlign: 'left', fontSize: 13,
                          border: '1px solid #e5e7eb', borderRadius: 8,
                          backgroundColor: '#f8fafc', cursor: 'pointer', color: '#1e293b',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#7c3aed')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiMessages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    ...(msg.role === 'user'
                      ? { backgroundColor: '#7c3aed', color: '#fff', borderBottomRightRadius: 4 }
                      : { backgroundColor: '#f8fafc', color: '#1e293b', border: '1px solid #e5e7eb', borderBottomLeftRadius: 4 }),
                  }}>
                    {msg.content || (aiStreaming && i === aiMessages.length - 1 ? (
                      <span style={{ color: '#94a3b8' }}>Thinking...</span>
                    ) : null)}
                  </div>
                </div>
              ))}
              <div ref={aiMessagesEndRef} />
            </div>

            {/* Input area */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
              <textarea
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
                placeholder="Ask about these policies..."
                rows={1}
                style={{
                  flex: 1, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
                  fontSize: 13, resize: 'none', fontFamily: 'inherit', color: '#1e293b',
                  minHeight: 40, maxHeight: 100,
                }}
              />
              <button
                onClick={() => handleAiSend()}
                disabled={!aiInput.trim() || aiStreaming}
                style={{
                  padding: '10px 16px', backgroundColor: '#7c3aed', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: aiInput.trim() && !aiStreaming ? 'pointer' : 'not-allowed',
                  opacity: aiInput.trim() && !aiStreaming ? 1 : 0.5,
                  whiteSpace: 'nowrap',
                }}
              >
                Send
              </button>
            </div>
          </div>

          {/* Responsive: full-width on mobile */}
          <style>{`
            @media (max-width: 600px) {
              .ai-drawer { width: 100% !important; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <CompareContent />
    </Suspense>
  );
}
