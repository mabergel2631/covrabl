'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../../lib/auth';
import { gapsApi, policiesApi, BusinessEntityDetail, CoverageGap } from '../../../../../lib/api';
import { formatPhone, cleanPhone } from '../../../../../lib/format';
import { useToast } from '../../../components/Toast';
import BackButton from '../../../components/BackButton';
import { getPolicyTypeDisplay } from '../../../constants';

type DeduplicatedContact = BusinessEntityDetail['contacts'][0] & { policy_ids: number[] };

function deduplicateContacts(contacts: BusinessEntityDetail['contacts']): DeduplicatedContact[] {
  const seen = new Map<string, DeduplicatedContact>();
  for (const c of contacts) {
    const key = `${(c.name || '').toLowerCase()}_${(c.email || '').toLowerCase()}_${c.role}`;
    if (seen.has(key)) {
      seen.get(key)!.policy_ids.push(c.policy_id);
    } else {
      seen.set(key, { ...c, policy_ids: [c.policy_id] });
    }
  }
  return Array.from(seen.values());
}

export default function BusinessEntityPage() {
  const params = useParams();
  const businessName = decodeURIComponent(params.name as string);
  const { token, logout } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = useState<BusinessEntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    loadData();
  }, [token, businessName]);

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await gapsApi.forBusiness(businessName);
      setData(result);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) { logout(); router.replace('/login'); return; }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === businessName) { setIsRenaming(false); return; }
    try {
      await policiesApi.renameBusinessGroup(businessName, trimmed);
      toast(`Group renamed to "${trimmed}"`, 'success');
      setIsRenaming(false);
      router.replace(`/policies/business/${encodeURIComponent(trimmed)}`);
    } catch (err: any) {
      toast(err.message || 'Failed to rename group', 'error');
    }
  };

  // Computed values
  const policiesByType: Record<string, BusinessEntityDetail['policies']> = {};
  if (data) {
    data.policies.forEach(p => {
      const key = p.policy_type || 'other';
      if (!policiesByType[key]) policiesByType[key] = [];
      policiesByType[key].push(p);
    });
  }

  const totalCoverage = data?.policies.reduce((sum, p) => sum + (p.coverage_amount || 0), 0) || 0;
  const totalPremium = data?.policies.reduce((sum, p) => sum + (p.premium_amount || 0), 0) || 0;
  const policyCount = data?.policies.length || 0;

  const highGaps = data?.gaps.filter(g => g.severity === 'high').length || 0;
  const mediumGaps = data?.gaps.filter(g => g.severity === 'medium').length || 0;
  const entityStatus = highGaps > 0 ? 'alert' : mediumGaps > 0 ? 'warning' : 'ok';

  const uniqueContacts = deduplicateContacts(data?.contacts || []);

  const getPolicyStatus = (policyId: number) => {
    if (!data) return { status: 'ok' as const, label: 'Good', color: 'var(--color-success-dark)', bgColor: 'var(--color-success-light)' };
    const policyGaps = data.gaps.filter(g =>
      g.policy_id === policyId || (g.id && g.id.includes(`_${policyId}`))
    );
    const hasHigh = policyGaps.some(g => g.severity === 'high');
    const hasMedium = policyGaps.some(g => g.severity === 'medium');
    if (hasHigh) return { status: 'alert' as const, label: 'Needs Attention', color: 'var(--color-danger-dark)', bgColor: 'var(--color-danger-light)' };
    if (hasMedium) return { status: 'warning' as const, label: 'Review Suggested', color: 'var(--color-warning-dark)', bgColor: 'var(--color-warning-light)' };
    return { status: 'ok' as const, label: 'Good', color: 'var(--color-success-dark)', bgColor: 'var(--color-success-light)' };
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ height: 20, width: 60, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 24 }} />
          <div style={{ height: 32, width: 250, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 16 }} />
          <div style={{ height: 80, backgroundColor: '#e5e7eb', borderRadius: 8, marginBottom: 24 }} />
          <div style={{ height: 200, backgroundColor: '#e5e7eb', borderRadius: 8 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <BackButton href="/policies" label="Policies" />
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '40px 24px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <BackButton href="/policies" label="Policies" />

        {/* Entity Header */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 32 }}>🏢</span>
            <div style={{ flex: 1 }}>
              {isRenaming ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsRenaming(false); }}
                    style={{
                      fontSize: 22, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.02em',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px', outline: 'none', width: '100%', maxWidth: 400,
                    }}
                  />
                  <button onClick={handleRename} style={{
                    padding: '6px 14px', fontSize: 13, fontWeight: 600, backgroundColor: 'var(--color-accent)',
                    color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>Save</button>
                  <button onClick={() => setIsRenaming(false)} style={{
                    padding: '6px 14px', fontSize: 13, fontWeight: 600, backgroundColor: '#f3f4f6',
                    color: '#6b7280', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
                    {businessName}
                  </h1>
                  <button
                    onClick={() => { setRenameValue(businessName); setIsRenaming(true); }}
                    title="Rename group"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                      fontSize: 14, color: 'var(--color-text-muted)', opacity: 0.6,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; }}
                  >&#9998;</button>
                </div>
              )}
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {policyCount} polic{policyCount === 1 ? 'y' : 'ies'}
                {totalCoverage > 0 && <> &middot; ${(totalCoverage / 100).toLocaleString()} total coverage</>}
                {totalPremium > 0 && <> &middot; ${(totalPremium / 100).toLocaleString()}/yr premium</>}
              </div>
            </div>
          </div>
        </section>

        {/* Entity Health Status */}
        <section style={{ marginBottom: 28 }}>
          <div style={{
            padding: '20px 24px',
            backgroundColor: '#fff',
            border: `1px solid ${entityStatus === 'alert' ? 'var(--color-danger-border)' : entityStatus === 'warning' ? 'var(--color-warning-border)' : '#e5e7eb'}`,
            borderRadius: 'var(--radius-lg)',
            borderLeft: `4px solid ${entityStatus === 'alert' ? 'var(--color-danger)' : entityStatus === 'warning' ? 'var(--color-warning)' : 'var(--color-success)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: entityStatus === 'alert' ? 'var(--color-danger)' : entityStatus === 'warning' ? 'var(--color-warning)' : 'var(--color-success)' }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                {entityStatus === 'alert' ? `${highGaps} coverage gap${highGaps > 1 ? 's' : ''} detected`
                  : entityStatus === 'warning' ? `${mediumGaps} item${mediumGaps > 1 ? 's' : ''} to review`
                  : 'No coverage gaps detected'}
              </span>
            </div>
          </div>
        </section>

        {/* Add Policy */}
        <section style={{ marginBottom: 32 }}>
          <button
            onClick={() => router.push(`/policies?addPolicy=true&scope=business&businessName=${encodeURIComponent(businessName)}`)}
            className="btn btn-accent"
            style={{ padding: '12px 24px', fontSize: 14, fontWeight: 600 }}
          >
            + Add Policy to {businessName}
          </button>
        </section>

        {/* Policies */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
            Policies ({policyCount})
          </h2>
          {Object.entries(policiesByType).map(([typeKey, typePolicies]) => (
            <div key={typeKey} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{getPolicyTypeDisplay(typeKey).icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {getPolicyTypeDisplay(typeKey).label}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {typePolicies.map(p => {
                  const status = getPolicyStatus(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => router.push(`/policies/${p.id}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px',
                        backgroundColor: '#fff',
                        border: `1px solid ${status.status === 'alert' ? '#fecaca' : status.status === 'warning' ? '#fde68a' : 'var(--color-border)'}`,
                        borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = status.status === 'alert' ? 'var(--color-danger-border)' : status.status === 'warning' ? 'var(--color-warning-border)' : 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: status.status === 'alert' ? 'var(--color-danger)' : status.status === 'warning' ? 'var(--color-warning)' : 'var(--color-success)', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{p.nickname || p.carrier}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', backgroundColor: status.bgColor, color: status.color, borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                            {status.status === 'alert' ? '⚠️' : status.status === 'warning' ? '💡' : '✓'} {status.label}
                          </span>
                          {p.status && p.status !== 'active' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                              backgroundColor: p.status === 'expired' ? 'var(--color-danger-light)' : '#f3f4f6',
                              color: p.status === 'expired' ? 'var(--color-danger-dark)' : '#6b7280',
                            }}>
                              {p.status === 'expired' ? 'Expired' : 'Archived'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{p.policy_number}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {p.renewal_date && (() => {
                          const daysUntil = Math.ceil((new Date(p.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                          const isPast = daysUntil < 0;
                          const isUrgent = daysUntil <= 7;
                          const isRenewingSoon = daysUntil <= 30 && daysUntil > 7;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              {isPast ? (
                                <span style={{ padding: '2px 8px', backgroundColor: 'var(--color-danger-light)', color: 'var(--color-danger-dark)', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Overdue</span>
                              ) : isUrgent ? (
                                <span style={{ padding: '2px 8px', backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning-dark)', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Urgent</span>
                              ) : isRenewingSoon ? (
                                <span style={{ padding: '2px 8px', backgroundColor: 'var(--color-info-light)', color: 'var(--color-info-dark)', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>Renewing soon</span>
                              ) : (
                                <span style={{ padding: '2px 8px', backgroundColor: 'var(--color-success-light)', color: 'var(--color-success-dark)', borderRadius: 12, fontSize: 11, fontWeight: 500 }}>OK</span>
                              )}
                              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(p.renewal_date).toLocaleDateString()}</div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* Coverage Gaps */}
        {data.gaps.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Coverage Gaps ({data.gaps.filter(g => g.severity !== 'info').length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.gaps.filter(g => g.severity !== 'info').map((gap) => (
                <div
                  key={gap.id}
                  style={{
                    padding: 16,
                    backgroundColor: gap.severity === 'high' ? '#fef2f2' : gap.severity === 'medium' ? '#fffbeb' : '#f0fdf4',
                    border: `1px solid ${gap.severity === 'high' ? '#fecaca' : gap.severity === 'medium' ? '#fde68a' : '#bbf7d0'}`,
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      backgroundColor: gap.severity === 'high' ? '#fee2e2' : gap.severity === 'medium' ? '#fef3c7' : '#dcfce7',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {gap.severity === 'high' ? '⚠️' : gap.severity === 'medium' ? '💡' : '✓'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{gap.name}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          backgroundColor: gap.severity === 'high' ? 'var(--color-danger-light)' : gap.severity === 'medium' ? 'var(--color-warning-light)' : 'var(--color-success-light)',
                          color: gap.severity === 'high' ? 'var(--color-danger-dark)' : gap.severity === 'medium' ? 'var(--color-warning-dark)' : 'var(--color-success-dark)',
                        }}>
                          {gap.severity}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>{gap.description}</p>
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>{gap.recommendation}</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Info-level suggestions collapsed */}
              {data.gaps.filter(g => g.severity === 'info').length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer', padding: '8px 0' }}>
                    {data.gaps.filter(g => g.severity === 'info').length} additional suggestions
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {data.gaps.filter(g => g.severity === 'info').map((gap) => (
                      <div key={gap.id} style={{ padding: 12, backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 4 }}>{gap.name}</div>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{gap.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>
        )}

        {/* Contacts */}
        {uniqueContacts.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Contacts ({uniqueContacts.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uniqueContacts.map(c => (
                <div key={c.id} style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '2px 8px', backgroundColor: '#f3f4f6', borderRadius: 4 }}>{c.role}</span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{c.name || c.company || 'Unknown'}</span>
                  </div>
                  {c.company && c.name && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{c.company}</div>}
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {c.phone && <a href={`tel:${cleanPhone(c.phone)}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>{formatPhone(c.phone)}</a>}
                    {c.email && <span>{c.email}</span>}
                  </div>
                  {c.policy_ids.length > 1 && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Across {c.policy_ids.length} policies
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Certificates */}
        {data.certificates.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Certificates ({data.certificates.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.certificates.map(cert => (
                <div
                  key={cert.id}
                  onClick={() => router.push('/certificates')}
                  style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{cert.counterparty_name}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      backgroundColor: cert.status === 'active' ? 'var(--color-success-light)' : cert.status === 'expiring' ? 'var(--color-warning-light)' : 'var(--color-danger-light)',
                      color: cert.status === 'active' ? 'var(--color-success-dark)' : cert.status === 'expiring' ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)',
                    }}>
                      {cert.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {cert.coverage_types && <span>{cert.coverage_types}</span>}
                    {cert.direction && <span style={{ textTransform: 'capitalize' }}>{cert.direction}</span>}
                  </div>
                  {cert.expiration_date && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Expires: {new Date(cert.expiration_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
