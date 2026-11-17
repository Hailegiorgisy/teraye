import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  UserPlus,
  Send,
  RotateCcw,
  SkipForward,
  XCircle,
  RefreshCw,
  CheckCircle,
  X,
  ArrowRightLeft,
} from 'lucide-react';
import { apiFetch, fetchStationsWithCache } from '../lib/api';

interface MarshalDashboardProps {
  user: {
    id: string;
    full_name: string;
    role: string;
    assigned_station_id: number | null;
  };
}

export const MarshalDashboard: React.FC<MarshalDashboardProps> = ({ user }) => {
  const [stations, setStations] = useState<any[]>([]);
  const [stationId, setStationId] = useState<number | ''>(
    user.assigned_station_id || ''
  );
  const [selectedRouteId, setSelectedRouteId] = useState<number | 'ALL'>('ALL');

  // Live queue state
  const [queue, setQueue] = useState<any[]>([]);
  const [recentDispatches, setRecentDispatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Quick Plate Search & Check-In State
  const [plateQuery, setPlateQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [overrideRoutes, setOverrideRoutes] = useState<Record<string, number>>({});

  // Register New Taxi Modal State
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDefaultRouteId, setNewDefaultRouteId] = useState<number | ''>('');

  function flash(type: 'ok' | 'err', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // 1. Load stations & routes
  useEffect(() => {
    fetchStationsWithCache()
      .then((list) => {
        setStations(list);
        if (!stationId && list.length > 0) {
          setStationId(list[0].id);
        }
      })
      .catch(() => flash('err', 'Could not load terminals.'));
  }, []);

  const currentStation = stations.find((s) => s.id === Number(stationId));
  const stationRoutes: any[] = currentStation?.routes || [];

  // 2. Load live FIFO queue for active station
  const loadQueue = useCallback(async () => {
    if (!stationId) return;
    try {
      const qs =
        selectedRouteId !== 'ALL' ? `?routeId=${selectedRouteId}` : '';
      const res = await apiFetch(`/queue/station/${stationId}${qs}`);
      setQueue(res.queue || []);
      setRecentDispatches(res.recentDispatches || []);
    } catch (err: any) {
      flash('err', err.message || 'Failed to refresh queue.');
    } finally {
      setLoading(false);
    }
  }, [stationId, selectedRouteId]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 8000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  // 3. Debounced partial plate search (e.g., typing "452")
  useEffect(() => {
    const q = plateQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/stations/taxis/search?q=${encodeURIComponent(q)}`);
        setSearchResults(res.taxis || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [plateQuery]);

  // 4. Tick Arrival ("Check In") with optional forced route switch
  async function handleCheckIn(taxi: any) {
    if (!stationId) return;
    setBusyId(taxi.id);
    try {
      const chosenRouteId =
        overrideRoutes[taxi.id] ||
        (selectedRouteId !== 'ALL' ? Number(selectedRouteId) : taxi.default_route_id);

      const res = await apiFetch('/queue/check-in', {
        method: 'POST',
        body: JSON.stringify({
          taxiId: taxi.id,
          stationId: Number(stationId),
          routeId: chosenRouteId,
        }),
      });
      flash('ok', `✅ ${taxi.plate_number} checked in at #${res.position}`);
      setPlateQuery('');
      setSearchResults([]);
      loadQueue();
    } catch (err: any) {
      flash('err', err.message || 'Check-in failed.');
    } finally {
      setBusyId(null);
    }
  }

  // 5. Tick Departure ("Dispatch #1")
  async function handleDispatch(entry: any) {
    setBusyId(entry.id);
    try {
      await apiFetch(`/queue/${entry.id}/dispatch`, { method: 'POST' });
      flash('ok', `🚀 Dispatched ${entry.plate_number}! Next drivers notified.`);
      loadQueue();
    } catch (err: any) {
      flash('err', err.message || 'Dispatch failed.');
    } finally {
      setBusyId(null);
    }
  }

  // 6. Exception Handler (SKIP, CANCEL, or 5-min Breakdown REQUEUE)
  async function handleException(
    entryId: string,
    plateNumber: string,
    action: 'SKIP' | 'CANCEL' | 'REQUEUE'
  ) {
    setBusyId(entryId);
    try {
      await apiFetch(`/queue/${entryId}/exception`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const label =
        action === 'REQUEUE'
          ? `↩️ ${plateNumber} restored to front of queue`
          : `${plateNumber} marked ${action}`;
      flash('ok', label);
      loadQueue();
    } catch (err: any) {
      flash('err', err.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  // 7. Register Brand-New Taxi On-Site & Check In Immediately
  async function handleRegisterTaxi(e: React.FormEvent) {
    e.preventDefault();
    setBusyId('register');
    try {
      const created = await apiFetch('/stations/taxis', {
        method: 'POST',
        body: JSON.stringify({
          plateNumber: newPlate,
          driverName: newDriverName,
          driverPhone: newDriverPhone,
          defaultRouteId: newDefaultRouteId ? Number(newDefaultRouteId) : undefined,
        }),
      });
      flash('ok', `Registered ${created.taxi.plate_number}`);
      setShowRegisterModal(false);
      setNewPlate('');
      setNewDriverName('');
      setNewDriverPhone('');
      // Auto-check in if a route was selected
      if (newDefaultRouteId) {
        await handleCheckIn(created.taxi);
      }
    } catch (err: any) {
      flash('err', err.message || 'Failed to register taxi.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-14">
      {/* Top Marshal Header */}
      <header className="bg-slate-900 text-white px-4 py-3.5 shadow-sm">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-teal-400 font-bold">
              ተራየ • Marshal Board (ተራ አስከባሪ)
            </p>
            {user.role === 'ADMIN' && stations.length > 1 ? (
              <select
                value={stationId}
                onChange={(e) => {
                  setStationId(Number(e.target.value));
                  setSelectedRouteId('ALL');
                }}
                className="bg-slate-800 text-white text-sm font-bold rounded-lg px-2 py-1 mt-0.5 border border-slate-700"
              >
                {stations.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name_en} ({st.name_am})
                  </option>
                ))}
              </select>
            ) : (
              <h1 className="text-base font-bold">
                {currentStation
                  ? `${currentStation.name_en} (${currentStation.name_am})`
                  : user.full_name}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRegisterModal(true)}
              className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>New Taxi</span>
            </button>
            <button
              onClick={loadQueue}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="max-w-lg mx-auto px-4 pt-3">
          <div
            className={`p-3 rounded-xl text-xs font-semibold border ${
              toast.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {toast.msg}
          </div>
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 pt-3 space-y-4">
        {/* 1. Fast Plate Search & 1-Tap Arrival Check-In */}
        <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-200">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={plateQuery}
              onChange={(e) => setPlateQuery(e.target.value)}
              placeholder="Type plate digits to Tick Arrival (e.g., 45219)..."
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            {plateQuery && (
              <button
                onClick={() => {
                  setPlateQuery('');
                  setSearchResults([]);
                }}
                className="absolute right-2.5 top-2.5 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searching && (
            <p className="text-xs text-slate-400 mt-2 px-1">Searching plates...</p>
          )}

          {searchResults.length > 0 && (
            <div className="mt-2.5 divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {searchResults.map((taxi) => {
                const chosenRoute =
                  overrideRoutes[taxi.id] ||
                  (selectedRouteId !== 'ALL'
                    ? Number(selectedRouteId)
                    : taxi.default_route_id || '');

                return (
                  <div
                    key={taxi.id}
                    className="p-3 bg-slate-50 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-black text-sm text-slate-900">
                          {taxi.plate_number}
                        </span>
                        <span className="text-xs text-slate-500 ml-2">
                          {taxi.driver_name || 'Driver'}
                        </span>
                      </div>
                      <button
                        disabled={busyId === taxi.id}
                        onClick={() => handleCheckIn(taxi)}
                        className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm disabled:opacity-50"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Tick Arrival</span>
                      </button>
                    </div>

                    {/* Forced Route Change Selector */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500 text-[11px]">Route:</span>
                      <select
                        value={chosenRoute}
                        onChange={(e) =>
                          setOverrideRoutes((prev) => ({
                            ...prev,
                            [taxi.id]: Number(e.target.value),
                          }))
                        }
                        className="flex-1 text-xs py-1 px-2 rounded-lg border border-slate-300 bg-white font-medium"
                      >
                        <option value="">Select destination...</option>
                        {stationRoutes.map((rt) => (
                          <option key={rt.id} value={rt.id}>
                            {rt.destination_en} ({rt.destination_am})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Route Filter Pills */}
        {stationRoutes.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setSelectedRouteId('ALL')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                selectedRouteId === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              All Routes ({queue.length})
            </button>
            {stationRoutes.map((rt) => (
              <button
                key={rt.id}
                onClick={() => setSelectedRouteId(rt.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                  selectedRouteId === rt.id
                    ? 'bg-teal-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                → {rt.destination_en}
              </button>
            ))}
          </div>
        )}

        {/* 3. Live FIFO Queue Board */}
        <div className="space-y-2.5">
          {loading ? (
            <div className="text-center py-8 text-xs text-slate-400">
              Loading terminal queue...
            </div>
          ) : queue.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-xs text-slate-500">
              No taxis waiting in this queue right now. Search a plate above or tap{' '}
              <strong>New Taxi</strong> to check one in.
            </div>
          ) : (
            queue.map((entry) => {
              const isFirst = entry.position === 1;
              return (
                <div
                  key={entry.id}
                  className={`rounded-2xl p-4 border shadow-sm transition ${
                    isFirst
                      ? 'bg-emerald-50/80 border-emerald-400'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-base ${
                          isFirst
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        #{entry.position}
                      </div>
                      <div>
                        <div className="font-black text-base text-slate-900">
                          {entry.plate_number}
                        </div>
                        <div className="text-xs text-slate-600">
                          → <strong>{entry.destination_en}</strong> ({entry.destination_am})
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {entry.driver_name || 'Driver'} • Waiting {entry.wait_minutes}m
                        </div>
                      </div>
                    </div>

                    {/* Primary Dispatch Button for #1 */}
                    {isFirst ? (
                      <button
                        disabled={busyId === entry.id}
                        onClick={() => handleDispatch(entry)}
                        className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                      >
                        <Send className="w-4 h-4" />
                        <span>DISPATCH</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          title="Skip (Driver away)"
                          disabled={busyId === entry.id}
                          onClick={() =>
                            handleException(entry.id, entry.plate_number, 'SKIP')
                          }
                          className="p-2 rounded-lg text-amber-600 hover:bg-amber-50"
                        >
                          <SkipForward className="w-4 h-4" />
                        </button>
                        <button
                          title="Remove from queue"
                          disabled={busyId === entry.id}
                          onClick={() =>
                            handleException(entry.id, entry.plate_number, 'CANCEL')
                          }
                          className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 4. Recent Dispatches (5-Minute Breakdown Re-Queue Bar) */}
        {recentDispatches.length > 0 && (
          <div className="bg-white rounded-2xl p-4 border border-slate-200">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Recently Dispatched (Breakdown Re-Entry Window)
            </h3>
            <div className="divide-y divide-slate-100">
              {recentDispatches.map((rd) => (
                <div
                  key={rd.id}
                  className="py-2 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-800">{rd.plate_number}</span>
                    <span className="text-slate-400 ml-2">→ {rd.destination_en}</span>
                  </div>
                  <button
                    disabled={busyId === rd.id}
                    onClick={() =>
                      handleException(rd.id, rd.plate_number, 'REQUEUE')
                    }
                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold flex items-center gap-1 border border-amber-200"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Re-Queue #1</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal: Register New Taxi On-Site */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 relative">
            <button
              onClick={() => setShowRegisterModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Register New Taxi (አዲስ ታክሲ መዝግብ)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Adds the vehicle to Teraye and links the driver’s +251 number automatically.
            </p>

            <form onSubmit={handleRegisterTaxi} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Plate Number (ታርጋ) *
                </label>
                <input
                  type="text"
                  required
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  placeholder="AA 3 A45219"
                  className="w-full px-3 py-2 text-sm uppercase border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Driver Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder="Dawit Tadesse"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Driver Phone (+251...) *
                </label>
                <input
                  type="tel"
                  required
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value)}
                  placeholder="0911223344"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Route (Checks in immediately if selected)
                </label>
                <select
                  value={newDefaultRouteId}
                  onChange={(e) =>
                    setNewDefaultRouteId(Number(e.target.value) || '')
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                >
                  <option value="">Register only (do not queue yet)</option>
                  {stationRoutes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.destination_en} ({rt.destination_am})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={busyId === 'register'}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl"
              >
                {busyId === 'register' ? 'Saving...' : 'Register Taxi'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};