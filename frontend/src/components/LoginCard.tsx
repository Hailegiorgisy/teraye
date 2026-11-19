import React, { useState } from 'react';
import terayeLogo from '../assets/teraye-logo-transparent.png';
import {
  PhoneFormatMode,
  sanitizePhoneInput,
  isValidEthiopianPhone,
} from '../utils/ethiopianPhone';

interface LoginCardProps {
  apiBaseUrl?: string;
  onLoginSuccess: (token: string, user: any) => void;
}

type AuthMode = 'login' | 'forgot' | 'reset';

export const LoginCard: React.FC<LoginCardProps> = ({
  apiBaseUrl = '',
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [phoneMode, setPhoneMode] = useState<PhoneFormatMode>('local');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const switchPhoneFormat = (nextMode: PhoneFormatMode) => {
    setPhoneMode(nextMode);
    if (!phone) {
      setPhone(nextMode === 'international' ? '+251' : '');
      return;
    }
    setPhone(sanitizePhoneInput(phone, nextMode));
  };

  const handlePhoneChange = (val: string) => {
    setPhone(sanitizePhoneInput(val, phoneMode));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isValidEthiopianPhone(phone)) {
      setError(
        phoneMode === 'local'
          ? 'Enter a valid 10-digit number starting with 09 or 07.'
          : 'Enter a valid +251 number (e.g. +251921319216).'
      );
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('Enter your 4–6 digit PIN.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed. Check your phone number and PIN.');
      } else {
        onLoginSuccess(data.token, data.user);
      }
    } catch {
      setError('Network error. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isValidEthiopianPhone(phone)) {
      setError('Enter your registered 09/07 or +251 phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/forgot-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send Telegram verification code.');
      } else {
        setSuccessMsg(data.message || '6-digit code sent to your Telegram!');
        setMode('reset');
      }
    } catch {
      setError('Network error while requesting verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code sent to your Telegram.');
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('New PIN must be 4–6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PIN and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: otp.trim(), newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to reset PIN.');
      } else {
        setSuccessMsg('PIN updated! Sign in with your new PIN.');
        setPin('');
        setOtp('');
        setNewPin('');
        setConfirmPin('');
        setMode('login');
      }
    } catch {
      setError('Network error while resetting PIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src={terayeLogo}
            alt="ተራየ (Teraye)"
            className="h-24 w-auto object-contain mb-2"
          />
          <p className="text-xs text-slate-500">
            {mode === 'login' && 'Sign in with your phone number & PIN'}
            {mode === 'forgot' && 'Reset PIN via your linked Telegram account'}
            {mode === 'reset' && 'Enter the 6-digit Telegram code & new PIN'}
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            {successMsg}
          </div>
        )}

        {/* Dual Phone Format Selector (09/07 vs +251) */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-700">
              Phone Number (ስልክ ቁጥር)
            </label>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => switchPhoneFormat('local')}
                className={`px-2 py-0.5 rounded-md font-medium transition ${
                  phoneMode === 'local'
                    ? 'bg-white text-blue-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                09 / 07 (10)
              </button>
              <button
                type="button"
                onClick={() => switchPhoneFormat('international')}
                className={`px-2 py-0.5 rounded-md font-medium transition ${
                  phoneMode === 'international'
                    ? 'bg-white text-blue-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                +251 (13)
              </button>
            </div>
          </div>

          <input
            type="tel"
            inputMode="tel"
            maxLength={phoneMode === 'local' ? 10 : 13}
            required
            placeholder={
              phoneMode === 'local' ? '0921319216' : '+251921319216'
            }
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {phoneMode === 'local'
              ? '10 digits starting with 09 or 07'
              : '13 characters starting with +2519 or +2517'}
          </p>
        </div>

        {/* MODE 1: SIGN IN */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700">
                  4–6 Digit PIN (የይለፍ ቁጥር)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setMode('forgot');
                  }}
                  className="text-xs font-medium text-blue-800 hover:underline"
                >
                  Forgot PIN? (ረሱ?)
                </button>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition cursor-pointer"
            >
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>
        )}

        {/* MODE 2: FORGOT PIN (REQUEST TELEGRAM OTP) */}
        {mode === 'forgot' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              We will send a 6-digit verification code to the Telegram account linked to your phone number.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition cursor-pointer"
            >
              {loading ? 'Sending code...' : 'Send Telegram Code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError('');
                setSuccessMsg('');
                setMode('login');
              }}
              className="w-full text-xs text-slate-500 hover:text-slate-800 py-1"
            >
              ← Back to Sign In
            </button>
          </form>
        )}

        {/* MODE 3: RESET PIN (ENTER OTP + NEW PIN) */}
        {mode === 'reset' && (
          <form onSubmit={handleResetPin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                6-Digit Telegram Code (የማረጋገጫ ኮድ)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-3.5 py-2.5 text-sm tracking-widest border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                New 4–6 Digit PIN (አዲስ የይለፍ ቁጥር)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Confirm New PIN (አዲሱን የይለፍ ቁጥር ያረጋግጡ)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••"
                value={confirmPin}
                onChange={(e) =>
                  setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition cursor-pointer"
            >
              {loading ? 'Saving PIN...' : 'Save New PIN'}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setMode('forgot')}
                className="text-blue-800 hover:underline"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setSuccessMsg('');
                  setMode('login');
                }}
                className="text-slate-500 hover:text-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
