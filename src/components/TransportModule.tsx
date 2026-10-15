import React, { useState, useEffect } from 'react';
import { Truck, Phone, Navigation, ShieldCheck, MapPin, Play, Square, Activity } from 'lucide-react';
import { TRANSPORT_ROUTES } from '../data/mockData';
import type { TransportRoute } from '../types';
import { emitNotification } from '../services/notificationBus';

export default function TransportModule() {
  const [routes] = useState<TransportRoute[]>(TRANSPORT_ROUTES);
  const [selectedRoute, setSelectedRoute] = useState<TransportRoute | null>(() => routes[0] ?? null);

  // Live GPS tracking animation states
  const [isTracking, setIsTracking] = useState(true);
  const [busProgress, setBusProgress] = useState(40); // Percent progress along route

  const toggleTracking = () => {
    const next = !isTracking;
    setIsTracking(next);
    emitNotification({
      title: next ? 'GPS Tracking Resumed' : 'GPS Tracking Paused',
      message: `${selectedRoute?.routeName || 'Bus'} (${selectedRoute?.busNumber || ''}) tracking is now ${next ? 'active' : 'paused'}.`,
      tone: next ? 'success' : 'warning',
      source: 'transport',
    });
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isTracking) {
      interval = setInterval(() => {
        setBusProgress((prev: number) => {
          if (prev >= 100) return 0;
          return prev + 5;
        });
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isTracking]);

  if (!selectedRoute) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="transport-module">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><MapPin className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Transport Routes &amp; GPS Tracking</h2>
            <p className="mt-1 text-sm text-slate-500">No transport routes have been created yet. Add a bus route before starting GPS tracking.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6" id="transport-module">
      <div>
        <h2 className="text-base font-sans font-semibold text-slate-900">Transport Routes & GPS Tracking</h2>
        <p className="text-xs text-slate-500">Monitor school bus routes, check driver details, and watch real-time simulated GPS tracking updates.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Route details list */}
        <div className="space-y-4">
          <h3 className="font-sans font-semibold text-slate-800 text-xs uppercase tracking-wider">Available Bus Routes</h3>
          <div className="space-y-2">
            {routes.map((route: TransportRoute) => (
              <div
                key={route.id}
                onClick={() => setSelectedRoute(route)}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${
                  selectedRoute.id === route.id ? 'bg-indigo-50/50 border-indigo-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{route.routeName}</h4>
                    <p className="text-[10px] font-mono text-slate-400 mt-1">Bus Number: {route.busNumber}</p>
                  </div>
                  <Truck className="w-4 h-4 text-slate-400" />
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100/50 flex justify-between items-center text-[10px] text-slate-500 font-medium">
                  <span>Driver: {route.driverName}</span>
                  <a href={`tel:${route.driverPhone}`} className="flex items-center gap-1 text-indigo-600 font-bold hover:underline">
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call Driver</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Map simulator panel */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm p-4 flex flex-col justify-between min-h-[460px]">
          <div>
            <div className="flex justify-between items-center border-b border-slate-50 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-indigo-600 animate-bounce" />
                <div>
                  <h3 className="font-sans font-semibold text-slate-800">Live GPS Tracker Simulator</h3>
                  <p className="text-[10px] text-slate-400">Transmitting active ping coordinates</p>
                </div>
              </div>

              {/* Simulation switch controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleTracking}
                  className={`text-[10px] font-semibold flex items-center gap-1 py-1 px-2.5 rounded border transition-colors cursor-pointer ${
                    isTracking ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>{isTracking ? 'GPS Stream: ON' : 'GPS Stream: PAUSED'}</span>
                </button>
              </div>
            </div>

            {/* Simulated interactive Route Line map */}
            <div className="bg-slate-950 p-4 rounded-lg relative h-64 overflow-hidden flex flex-col justify-end border border-slate-900">
              {/* Star grid mock */}
              <div className="absolute inset-0 opacity-10">
                <div className="w-full h-full bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]"></div>
              </div>

              {/* Simulated Roadmap path */}
              <div className="absolute inset-0 p-8 flex flex-col justify-center">
                <div className="relative w-full h-1 bg-slate-800 rounded-full flex items-center">
                  {/* Active route progress line */}
                  <div
                    className="absolute left-0 top-0 h-1 bg-linear-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-1000"
                    style={{ width: `${busProgress}%` }}
                  ></div>

                  {/* Stops circles */}
                  {selectedRoute.stops.map((stop: { name: string; time: string; lat: number; lng: number }, idx: number) => {
                    const stopPosPercent = (idx / (selectedRoute.stops.length - 1)) * 100;
                    return (
                      <div
                        key={idx}
                        className="absolute w-3 h-3 bg-slate-900 border-2 border-slate-600 rounded-full group cursor-pointer"
                        style={{ left: `${stopPosPercent}%`, transform: 'translateX(-50%)' }}
                      >
                        {/* Hover Tooltip */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 text-white text-[8px] font-sans py-1 px-2 rounded whitespace-nowrap opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="font-bold">{stop.name}</p>
                          <p className="text-slate-400">{stop.time}</p>
                        </div>
                      </div>
                    );
                  })}

                  {/* Moving Bus vehicle */}
                  <div
                    className="absolute w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-md shadow-emerald-500/50 transition-all duration-1000 transform -translate-x-1/2"
                    style={{ left: `${busProgress}%` }}
                  >
                    <Truck className="w-3.5 h-3.5 animate-pulse" />
                  </div>
                </div>
              </div>

              {/* Status footer overlays */}
              <div className="relative z-10 flex justify-between items-center text-[10px] text-slate-400 font-mono">
                <p>LAT: 28.5726 · LNG: 77.1033</p>
                <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                  <span>ACTIVE FEED</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 mt-4">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Detailed Stop Schedule</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-600">
              {selectedRoute.stops.map((stop: { name: string; time: string; lat: number; lng: number }, idx: number) => (
                <div key={idx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="font-bold text-slate-800 truncate">{stop.name}</p>
                  <p className="text-[10px] text-indigo-600 mt-1">{stop.time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
