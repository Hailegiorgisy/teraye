import React, { useEffect, useState, useCallback } from 'react';
import {
  QrCode,
  RefreshCw,
  Clock,
  MapPin,
  CheckCircle2,
  X,
  History,
  KeyRound,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { apiFetch } from '../lib/api';

interface DriverDashboardProps {
  user: {
    id: string;
    full_name: string;
    phone_number: string;
  };
}

export const DriverDashboard: React.FC<DriverDashboardProps> = ({ user }) => {
  const [data, setData] = useState<{
    taxi: any;
    activeQueue: any;
    recentTrips: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  const loadTurnStatus = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await apiFetch('/queue/my-turn');
      setData(res);
    } catch (err) {
      console.error('Failed to load turn status:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load + lightweight 12-second background refresh while screen is open
  useEffect(() => {
    loadTurnStatus();
    const timer = setInterval(() => loadTurnStatus(false), 12000);
    return () => clearInterval(timer);
  }, [loadTurnStatus]);

  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);
    try {
      await apiFetch('/auth/mobile/set-pin', {
        method: 'POST',
        body: JSON.stringify({ pin: newPin }),
      });
      setPinMsg('Mobile PIN saved! You can now log in via the Android App.');
      setNewPin('');
      setTimeout(() => {
        setShowPinModal(false);
        setPinMsg(null);
      }, 1500);
    } catch (err: any) {
      setPinMsg(err.message || 'Failed to save PIN.');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Loading your queue status...
      </div>
    );
  }

  const taxi = data?.taxi;
  const active = data?.activeQueue;
  const recentTrips = data?.recentTrips || [];

  // Visual styling based on turn urgency
  const isTurnNow = active?.position === 1;
  const isNextUp = active?.position === 2;

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      {/* Top Bar */}
      <header className="bg-slate-900 text-white px-4 py-4 flex items-center justify-between shadow-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-teal-400 font-semibold">
            ተራየ • Driver View
          </p>
          <h1 className="text-base font-bold">{user.full_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPinModal(true)}
            title="Set Mobile App PIN"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          <button
            onClick={() => loadTurnStatus(true)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white flex items-center gap-1 text-xs"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {/* Vehicle & QR Card */}
        {taxi ? (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                Registered Taxi (ታርጋ)
              </span>
              <div className="text-xl font-extrabold tracking-wide text-slate-900">
                {taxi.plate_number}
              </div>
              {taxi.default_dest_en && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Default: {taxi.default_dest_en} ({taxi.default_dest_am})
                </p>
              )}
            </div>
            <button
              onClick={() => setShowQrModal(true)}
              className="flex flex-col items-center justify-center px-3.5 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 transition"
            >
              <QrCode className="w-6 h-6 mb-0.5" />
              <span className="text-[10px] font-bold">My QR</span>
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800">
            No vehicle linked to your profile yet. Ask a Station Marshal (ተራ አስከባሪ) to register your plate number.
          </div>
        )}

        {/* Active Queue Status Card */}
        {active ? (
          <div
            className={`rounded-2xl p-5 shadow-sm border-2 transition ${
              isTurnNow
                ? 'bg-emerald-600 border-emerald-700 text-white'
                : isNextUp
                ? 'bg-amber-500 border-amber-600 text-slate-950'
                : 'bg-white border-teal-500 text-slate-900'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase mb-2 ${
                    isTurnNow
                      ? 'bg-white/20 text-white'
                      : isNextUp
                      ? 'bg-black/15 text-slate-950'
                      : 'bg-teal-50 text-teal-700'
                  }`}
                >
                  {isTurnNow
                    ? '🟢 ተራህ ደርሷል • YOUR TURN NOW'
                    : isNextUp
                    ? '🟡 ተዘጋጅ • GET READY (NEXT)'
                    : '⏳ IN STATION QUEUE'}
                </span>

                <div className="flex items-center gap-1.5 text-sm font-semibold opacity-90">
                  <MapPin className="w-4 h-4 shrink-0" />
                  <span>
                    {active.station_en} → {active.destination_en}
                  </span>
                </div>
                <p className="text-xs opacity-80 ml-5">
                  {active.station_am} → {active.destination_am}
                </p>
              </div>

              {/* Huge High-Contrast Rank Number */}
              <div className="text-right">
                <div className="text-5xl font-black leading-none">
                  #{active.position}
                </div>
                <div className="text-[11px] font-medium opacity-80 mt-1">
                  of {active.totalInLine} taxis
                </div>
              </div>
            </div>

            {/* Wait Estimate & Plates Ahead */}
            <div
              className={`mt-4 pt-3 border-t text-xs space-y-2 ${
                isTurnNow
                  ? 'border-white/20'
                  : isNextUp
                  ? 'border-black/15'
                  : 'border-slate-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 opacity-85">
                  <Clock className="w-3.5 h-3.5" /> Est. Wait:
                </span>
                <span className="font-bold">
                  {active.position === 1
                    ? 'Load passengers now'
                    : `~${active.estimatedWaitMinutes} mins`}
                </span>
              </div>

              {active.platesAhead?.length > 0 && (
                <div>
                  <span className="opacity-75 block mb-1">Taxis ahead of you:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {active.platesAhead.map((p: string, idx: number) => (
                      <span
                        key={p}
                        className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold ${
                          isNextUp
                            ? 'bg-black/15 text-slate-950'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        #{idx + 1} {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Not Currently Queued */
          <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-slate-200">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="text-sm font-bold text-slate-800">
              Not Currently in a Queue
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Show your QR code to the Station Marshal (ተራ አስከባሪ) when you enter the terminal.
            </p>
          </div>
        )}

        {/* Recent Completed Trips */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-teal-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Recent Dispatches ({recentTrips.length})
            </h3>
          </div>

          {recentTrips.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No completed trips yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentTrips.map((trip: any) => (
                <div
                  key={trip.id}
                  className="py-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-800">
                      {trip.station_en} → {trip.destination_en}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {new Date(trip.dispatched_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium text-[10px]">
                    Dispatched
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal 1: Scannable Vehicle QR Code */}
      {showQrModal && taxi && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xs w-full p-6 text-center relative">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
            <p className="text-xs font-bold uppercase text-teal-600 mb-1">
              Teraye Check-In Pass
            </p>
            <h3 className="text-xl font-black text-slate-900 mb-4">
              {taxi.plate_number}
            </h3>
            <div className="bg-white p-3 rounded-xl border border-slate-200 inline-block">
              <QRCodeSVG value={taxi.qr_token} size={190} />
            </div>
            <p className="text-[11px] text-slate-500 mt-3">
              Show this code to the Station Marshal (ተራ አስከባሪ) at the gate for 1-tap arrival check-in.
            </p>
          </div>
        </div>
      )}

      {/* Modal 2: Set PIN for Standalone Android Mobile App */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 relative">
            <button
              onClick={() => setShowPinModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Set Mobile App PIN
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Create a 4–6 digit PIN to log in from the standalone Android app using {user.phone_number}.
            </p>
            {pinMsg && (
              <div className="mb-3 p-2 rounded-lg bg-teal-50 text-teal-800 text-xs font-medium">
                {pinMsg}
              </div>
            )}
            <form onSubmit={handleSavePin} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="Enter 4–6 digit PIN"
                className="w-full px-3 py-2.5 text-center text-base tracking-widest border border-slate-300 rounded-xl"
              />
              <button
                type="submit"
                className="w-full py-2.5 bg-teal-600 text-white text-xs font-bold rounded-xl"
              >
                Save PIN
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};