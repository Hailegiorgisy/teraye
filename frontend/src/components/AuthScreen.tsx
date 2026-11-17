import React, { useEffect, useState } from 'react';
import { Car, Phone, Lock, UserCheck, ArrowRight } from 'lucide-react';
import {
  apiFetch,
  fetchStationsWithCache,
  isTelegramMiniApp,
  setMobileToken,
} from '../lib/api';

interface AuthScreenProps {
  telegramPrefill?: {
    firstName?: string;
    lastName?: string;
  };
  onAuthenticated: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  telegramPrefill,
  onAuthenticated,
}) => {
  const inTelegram = isTelegramMiniApp();

  // Shared form fields
  const [phoneNumber, setPhoneNumber] = useState('');
  const [fullName, setFullName] = useState(
    [telegramPrefill?.firstName, telegramPrefill?.lastName]
      .filter(Boolean)
      .join(' ')
  );
  const [plateNumber, setPlateNumber] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<number | ''>('');
  const [defaultRouteId, setDefaultRouteId] = useState<number | ''>('');
  const [pin, setPin] = useState('');

  // Reference data & UI state
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inTelegram) {
      fetchStationsWithCache()
        .then((list) => setStations(list))
        .catch(() => {});
    }
  }, [inTelegram]);

  const activeStation = stations.find((s) => s.id === Number(selectedStationId));

  // Handler A: Telegram Mini App One-Time Onboarding
  async function handleTelegramRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/telegram/register', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber,
          fullName,
          plateNumber: plateNumber.trim() || undefined,
          defaultRouteId: defaultRouteId ? Number(defaultRouteId) : undefined,
        }),
      });
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  // Handler B: Standalone Mobile App Phone + PIN Login
  async function handleMobileLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/auth/mobile/login', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, pin }),
      });
      setMobileToken(data.token);
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-sm">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">ተራየ (Teraye)</h1>
            <p className="text-xs text-slate-500">
              {inTelegram
                ? 'Complete quick setup to join station queues'
                : 'Sign in with your phone number & PIN'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {inTelegram ? (
          /* --- Telegram Mini App Registration Form --- */
          <form onSubmit={handleTelegramRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name (ሙሉ ስም) *
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Abebe Kebede"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ethiopian Phone Number (ስልክ ቁጥር) *
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0911223344"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <p className="text-[11px] font-medium text-slate-500 mb-2">
                Driver Vehicle Details (Skip if you are a Station Marshal / ተራ አስከባሪ)
              </p>

              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Taxi Plate Number (ታርጋ ቁጥር)
              </label>
              <input
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="AA 3 A45219"
                className="w-full px-3 py-2.5 text-sm uppercase border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none mb-3"
              />

              {stations.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Home Terminal
                    </label>
                    <select
                      value={selectedStationId}
                      onChange={(e) => {
                        setSelectedStationId(Number(e.target.value) || '');
                        setDefaultRouteId('');
                      }}
                      className="w-full px-2.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white"
                    >
                      <option value="">Select terminal...</option>
                      {stations.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name_en} ({st.name_am})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Default Route
                    </label>
                    <select
                      value={defaultRouteId}
                      disabled={!activeStation}
                      onChange={(e) => setDefaultRouteId(Number(e.target.value) || '')}
                      className="w-full px-2.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white disabled:bg-slate-100"
                    >
                      <option value="">Select route...</option>
                      {(activeStation?.routes || []).map((rt: any) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.destination_en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-60"
            >
              {loading ? 'Saving...' : 'Continue to Teraye'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          /* --- Standalone Mobile App Login Form --- */
          <form onSubmit={handleMobileLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phone Number (ስልክ ቁጥር)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0911223344"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                4–6 Digit PIN (የይለፍ ቁጥር)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="w-full pl-9 pr-3 py-2.5 text-sm tracking-widest border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};