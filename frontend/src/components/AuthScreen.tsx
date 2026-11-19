import React, { useEffect, useState } from 'react';
import { Phone, Lock, UserCheck, ArrowRight } from 'lucide-react';
import terayeLogo from '../assets/teraye-logo-transparent.png';
import {
  apiFetch,
  fetchStationsWithCache,
  isTelegramMiniApp,
  setMobileToken,
} from '../lib/api';
import {
  PhoneFormatMode,
  sanitizePhoneInput,
  isValidEthiopianPhone,
} from '../utils/ethiopianPhone';

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

  const [authMode, setAuthMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [phoneMode, setPhoneMode] = useState<PhoneFormatMode>('local');

  const [phoneNumber, setPhoneNumber] = useState('');
  const [fullName, setFullName] = useState(
    [telegramPrefill?.firstName, telegramPrefill?.lastName].filter(Boolean).join(' ')
  );
  const [plateNumber, setPlateNumber] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<number | ''>('');
  const [defaultRouteId, setDefaultRouteId] = useState<number | ''>('');
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [newPin, setNewPin] = useState('');

  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (inTelegram) {
      fetchStationsWithCache()
        .then((list) => setStations(list))
        .catch(() => {});
    }
  }, [inTelegram]);

  const activeStation = stations.find((s) => s.id === Number(selectedStationId));

  const switchPhoneFormat = (nextMode: PhoneFormatMode) => {
    setPhoneMode(nextMode);
    if (!phoneNumber) {
      setPhoneNumber(nextMode === 'international' ? '+251' : '');
      return;
    }
    setPhoneNumber(sanitizePhoneInput(phoneNumber, nextMode));
  };

  async function handleTelegramRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEthiopianPhone(phoneNumber)) {
      setError('ትክክለኛ 09/07 (10 አሃዝ) ወይም +251 (13 ፊደላት) ስልክ ቁጥር ያስገቡ።');
      return;
    }
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
      setError(err.message || 'ምዝገባው አልተሳካም።');
    } finally {
      setLoading(false);
    }
  }

  async function handleMobileLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    if (!isValidEthiopianPhone(phoneNumber)) {
      setError(
        phoneMode === 'local'
          ? 'በ09 ወይም በ07 የሚጀምር ባለ 10 አሃዝ ስልክ ቁጥር ያስገቡ።'
          : 'በ+2519 ወይም +2517 የሚጀምር 13 አሃዝ ያስገቡ።'
      );
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, pin }),
      });
      setMobileToken(data.token);
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'መግባት አልተቻለም።');
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    if (!isValidEthiopianPhone(phoneNumber)) {
      setError('የተመዘገበውን የኢትዮጵያ ስልክ ቁጥር ያስገቡ።');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ message: string }>('/auth/forgot-pin', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      });
      setInfoMsg(data.message);
      setAuthMode('reset');
    } catch (err: any) {
      setError(err.message || 'የቴሌግራም ኮድ መላክ አልተቻለም።');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ message: string }>('/auth/reset-pin', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, otp, newPin }),
      });
      setInfoMsg(data.message);
      setPin('');
      setOtp('');
      setNewPin('');
      setAuthMode('login');
    } catch (err: any) {
      setError(err.message || 'ፒን ማደስ አልተቻለም።');
    } finally {
      setLoading(false);
    }
  }

  const renderPhoneInput = () => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-slate-700">
          ስልክ ቁጥር *
        </label>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => switchPhoneFormat('local')}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              phoneMode === 'local' ? 'bg-white text-blue-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            09 / 07 (10)
          </button>
          <button
            type="button"
            onClick={() => switchPhoneFormat('international')}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              phoneMode === 'international' ? 'bg-white text-blue-800 shadow-xs' : 'text-slate-600'
            }`}
          >
            +251 (13)
          </button>
        </div>
      </div>
      <div className="relative">
        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        <input
          type="tel"
          required
          maxLength={phoneMode === 'local' ? 10 : 13}
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(sanitizePhoneInput(e.target.value, phoneMode))}
          placeholder={phoneMode === 'local' ? '0921319216' : '+251921319216'}
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-700 focus:outline-none"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col items-center text-center mb-5">
          <img
            src={terayeLogo}
            alt="ተራየ (Teraye)"
            className="h-24 w-auto object-contain mb-2"
          />
          <p className="text-xs text-slate-500">
            {inTelegram
              ? 'ተራ ለመያዝ አጭር መረጃዎን ያጠናቅቁ'
              : authMode === 'login'
              ? 'በስልክ ቁጥርዎ እና በፒን (PIN) ይግቡ'
              : authMode === 'forgot'
              ? 'ባለ 6 አሃዝ ኮድ በቴሌግራም ይቀበሉ'
              : 'የቴሌግራም ኮድ እና አዲስ ፒን ያስገቡ'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}
        {infoMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium">
            {infoMsg}
          </div>
        )}

        {inTelegram ? (
          <form onSubmit={handleTelegramRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ሙሉ ስም *
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="አበበ ከበደ"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-700 focus:outline-none"
                />
              </div>
            </div>

            {renderPhoneInput()}

            <div className="pt-2 border-t border-slate-100">
              <p className="text-[11px] font-medium text-slate-500 mb-2">
                የሹፌር መኪና መረጃ (ተራ አስከባሪ ከሆኑ ይዝለሉት)
              </p>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                የታክሲ ታርጋ ቁጥር
              </label>
              <input
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="AA 3 A45219"
                className="w-full px-3 py-2.5 text-sm uppercase border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-700 focus:outline-none mb-3"
              />
              {stations.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">መነሻ መናኸሪያ</label>
                    <select
                      value={selectedStationId}
                      onChange={(e) => {
                        setSelectedStationId(Number(e.target.value) || '');
                        setDefaultRouteId('');
                      }}
                      className="w-full px-2.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white"
                    >
                      <option value="">መናኸሪያ ይምረጡ...</option>
                      {stations.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name_am || st.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">ነባሪ መስመር</label>
                    <select
                      value={defaultRouteId}
                      disabled={!activeStation}
                      onChange={(e) => setDefaultRouteId(Number(e.target.value) || '')}
                      className="w-full px-2.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white disabled:bg-slate-100"
                    >
                      <option value="">መስመር ይምረጡ...</option>
                      {(activeStation?.routes || []).map((rt: any) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.destination_am || rt.destination_en}
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
              className="w-full py-3 px-4 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-60"
            >
              {loading ? 'በማስቀመጥ ላይ...' : 'ወደ ተራየ ቀጥል'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : authMode === 'login' ? (
          <form onSubmit={handleMobileLogin} className="space-y-4">
            {renderPhoneInput()}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  ባለ 4-6 አሃዝ ፒን (PIN)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoMsg(null);
                    setAuthMode('forgot');
                  }}
                  className="text-xs font-medium text-blue-800 hover:underline"
                >
                  ፒን ረስተዋል?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••"
                  className="w-full pl-9 pr-3 py-2.5 text-sm tracking-widest border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-60"
            >
              {loading ? 'በመግባት ላይ...' : 'ግባ'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : authMode === 'forgot' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            {renderPhoneInput()}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60"
            >
              {loading ? 'ኮድ በመላክ ላይ...' : 'ኮድ በቴሌግራም ላክ'}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className="w-full text-xs text-slate-500 hover:underline"
            >
              ← ወደ መግቢያ ተመለስ
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPin} className="space-y-4">
            {renderPhoneInput()}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ባለ 6 አሃዝ የቴሌግራም ኮድ
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full px-3 py-2.5 text-sm tracking-widest border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                አዲስ ባለ 4-6 አሃዝ ፒን
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                className="w-full px-3 py-2.5 text-sm tracking-widest border border-slate-300 rounded-xl"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60"
            >
              {loading ? 'በማስቀመጥ ላይ...' : 'አዲስ ፒን አስቀምጥ'}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className="w-full text-xs text-slate-500 hover:underline"
            >
              ← ሰርዝ
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
