import React from 'react';
import terayeLogo from '../assets/teraye-logo-transparent.png';

// Drop this header block into your Login card in App.tsx or Login.tsx
export function TerayeLoginHeader() {
  return (
    <div className="flex flex-col items-center text-center mb-6">
      <img
        src={terayeLogo}
        alt="ተራየ (Teraye)"
        className="h-24 w-auto object-contain mb-2"
      />
      <p className="text-xs text-slate-500">
        Sign in with your phone number &amp; PIN
      </p>
    </div>
  );
}

// Compact navbar logo for MarshalDashboard.tsx and DriverDashboard.tsx
export function TerayeNavbarLogo() {
  return (
    <div className="flex items-center gap-2">
      <img
        src={terayeLogo}
        alt="ተራየ Teraye"
        className="h-9 w-auto object-contain"
      />
    </div>
  );
}
