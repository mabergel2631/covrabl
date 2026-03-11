'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE = 60 * 1000; // Show warning 1 minute before logout

type AuthState = {
  token: string | null;
  role: string | null;
  plan: string | null;
  trialActive: boolean;
  trialDaysLeft: number;
  login: (token: string) => void;
  logout: () => void;
  refreshPlan: () => void;
  sessionWarning: boolean;
  dismissWarning: () => void;
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
  sessionWarning: false,
  dismissWarning: () => {},
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
  const [sessionWarning, setSessionWarning] = useState(false);

  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);

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
        sessionStorage.setItem('pv_role', data.role || 'individual');
        sessionStorage.setItem('pv_plan', data.plan || 'free');
      }
    } catch {
      // Silently fail — role stays null
    }
  };

  const clearSession = useCallback(() => {
    sessionStorage.removeItem('pv_token');
    sessionStorage.removeItem('pv_role');
    sessionStorage.removeItem('pv_plan');
    sessionStorage.removeItem('pv_last_active');
    setToken(null);
    tokenRef.current = null;
    setRole(null);
    setPlan(null);
    setTrialActive(false);
    setTrialDaysLeft(0);
    setSessionWarning(false);
  }, []);

  const logout = useCallback(() => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    clearSession();
  }, [clearSession]);

  const resetInactivityTimers = useCallback(() => {
    // Only run timers if user is logged in
    if (!tokenRef.current) return;

    setSessionWarning(false);

    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);

    // Warning fires 1 minute before logout
    warningTimerRef.current = setTimeout(() => {
      if (tokenRef.current) setSessionWarning(true);
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE);

    // Actual logout
    logoutTimerRef.current = setTimeout(() => {
      if (tokenRef.current) {
        clearSession();
        if (typeof window !== 'undefined') {
          window.location.href = '/login?expired=1';
        }
      }
    }, INACTIVITY_TIMEOUT);

    // Update last-active timestamp
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('pv_last_active', Date.now().toString());
    }
  }, [clearSession]);

  const dismissWarning = useCallback(() => {
    // User clicked "Stay logged in" — reset the timers
    setSessionWarning(false);
    resetInactivityTimers();
  }, [resetInactivityTimers]);

  // Set up activity listeners
  useEffect(() => {
    if (!token) return;

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    let throttled = false;

    const onActivity = () => {
      if (throttled) return;
      throttled = true;
      resetInactivityTimers();
      setTimeout(() => { throttled = false; }, 5000); // Throttle to once per 5s
    };

    activityEvents.forEach(evt => window.addEventListener(evt, onActivity, { passive: true }));
    resetInactivityTimers();

    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, onActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [token, resetInactivityTimers]);

  // Migrate any existing localStorage tokens to sessionStorage (one-time)
  useEffect(() => {
    const oldToken = localStorage.getItem('pv_token');
    if (oldToken) {
      sessionStorage.setItem('pv_token', oldToken);
      sessionStorage.setItem('pv_role', localStorage.getItem('pv_role') || '');
      sessionStorage.setItem('pv_plan', localStorage.getItem('pv_plan') || '');
      localStorage.removeItem('pv_token');
      localStorage.removeItem('pv_role');
      localStorage.removeItem('pv_plan');
      localStorage.removeItem('pv_last_active');
    }

    const stored = sessionStorage.getItem('pv_token');
    if (stored) {
      setToken(stored);
      tokenRef.current = stored;
      const cachedRole = sessionStorage.getItem('pv_role');
      const cachedPlan = sessionStorage.getItem('pv_plan');
      if (cachedRole) setRole(cachedRole);
      if (cachedPlan) setPlan(cachedPlan);
      fetchRole(stored);
    }
  }, []);

  const login = (t: string) => {
    sessionStorage.setItem('pv_token', t);
    setToken(t);
    tokenRef.current = t;
    fetchRole(t);
  };

  const refreshPlan = () => {
    if (token) fetchRole(token);
  };

  return (
    <AuthContext.Provider value={{ token, role, plan, trialActive, trialDaysLeft, login, logout, refreshPlan, sessionWarning, dismissWarning }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
