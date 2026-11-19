import React, { useEffect, useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import { apiFetch, isTelegramMiniApp, getMobileToken } from './lib/api';
import { AuthScreen } from './components/AuthScreen';
import { DriverDashboard } from './components/DriverDashboard';
import { MarshalDashboard } from './components/MarshalDashboard';
import terayeLogo from './assets/teraye-logo-transparent.png';

export function App() {
  const [status, setStatus] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'ready'>('loading');
  const [user, setUser] = useState<any>(null);
  const [telegramPrefill, setTelegramPrefill] = useState<any>(null);

  const bootstrap = useCallback(async () => {
    setStatus('loading');
    try {
      if (isTelegramMiniApp()) {
        WebApp.ready();
        WebApp.expand();
      } else if (!getMobileToken()) {
        // Check if backend DEV_BYPASS_AUTH=true is active during development
        try {
          const devRes = await fetch('/api/auth/dev-session');
          if (devRes.ok) {
            const devData = await devRes.json();
            if (devData?.token && devData?.user) {
              // Store token under common keys used by getMobileToken()
              localStorage.setItem('teraye_token', devData.token);
              localStorage.setItem('token', devData.token);
              setUser(devData.user);
              setStatus('ready');
              return;
            }
          }
        } catch {
          // Ignore when dev bypass is disabled or unreachable
        }

        setStatus('unauthenticated');
        return;
      }

      const me = await apiFetch('/auth/me');
      if (!me.registered) {
        setTelegramPrefill(me.telegramUser || null);
        setStatus('onboarding');
      } else {
        setUser(me.user);
        setStatus('ready');
      }
    } catch {
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-4">
        <img
          src={terayeLogo}
          alt="ተራየ (Teraye)"
          className="h-24 w-auto object-contain mb-3 animate-pulse"
        />
        <p className="text-xs font-medium text-slate-500">Loading Teraye...</p>
      </div>
    );
  }

  if (status === 'unauthenticated' || status === 'onboarding') {
    return (
      <AuthScreen
        telegramPrefill={telegramPrefill}
        onAuthenticated={bootstrap}
      />
    );
  }

  if (user?.role === 'WORKER' || user?.role === 'ADMIN') {
    return <MarshalDashboard user={user} />;
  }

  return <DriverDashboard user={user} />;
}

export default App;