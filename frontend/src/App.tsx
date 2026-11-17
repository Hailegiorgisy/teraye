import React, { useEffect, useState, useCallback } from 'react';
import WebApp from '@twa-dev/sdk';
import { apiFetch, isTelegramMiniApp, getMobileToken } from './lib/api';
import { AuthScreen } from './components/AuthScreen';
import { DriverDashboard } from './components/DriverDashboard';
import { MarshalDashboard } from './components/MarshalDashboard';

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
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center">
        <div className="text-2xl font-black tracking-wide text-teal-400">ተራየ</div>
        <p className="text-xs text-slate-400 mt-1">Loading Teraye...</p>
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