'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type AuthState = {
  token: string | null;
  role: string | null;
  plan: string | null;
  trialActive: boolean;
  trialDaysLeft: number;
  login: (token: string) => void;
  logout: () => void;
  refreshPlan: () => void;
};

const AuthContext = createContext<AuthState>({
  token: null,
  role: null,
  plan: null,
  trialActive: false,
  trialDaysLeft: 0,
  login: () => {},
  logout: () => {},
  refreshPlan: () => {},
});

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  "https://covrabl-api.up.railway.app";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [trialActive, setTrialActive] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState(0);

  const fetchRole = async (t: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRole(data.role || 'individual');
        setPlan(data.plan || 'free');
        setTrialActive(data.trial_active || false);
        setTrialDaysLeft(data.trial_days_left || 0);
        localStorage.setItem('pv_role', data.role || 'individual');
        localStorage.setItem('pv_plan', data.plan || 'free');
      }
    } catch {
      // Silently fail — role stays null
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem('pv_token');
    if (stored) {
      setToken(stored);
      const cachedRole = localStorage.getItem('pv_role');
      const cachedPlan = localStorage.getItem('pv_plan');
      if (cachedRole) setRole(cachedRole);
      if (cachedPlan) setPlan(cachedPlan);
      fetchRole(stored);
    }
  }, []);

  const login = (t: string) => {
    localStorage.setItem('pv_token', t);
    setToken(t);
    fetchRole(t);
  };

  const logout = () => {
    localStorage.removeItem('pv_token');
    localStorage.removeItem('pv_role');
    localStorage.removeItem('pv_plan');
    localStorage.removeItem('pv_last_active');
    setToken(null);
    setRole(null);
    setPlan(null);
    setTrialActive(false);
    setTrialDaysLeft(0);
  };

  const refreshPlan = () => {
    if (token) fetchRole(token);
  };

  return (
    <AuthContext.Provider value={{ token, role, plan, trialActive, trialDaysLeft, login, logout, refreshPlan }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
