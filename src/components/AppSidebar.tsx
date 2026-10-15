import React from 'react';
import { motion } from 'motion/react';
import {
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Lock,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import WorexaLogo from './WorexaLogo';
import { BrandSettings } from '../types';
import { AuthUser } from '../utils/auth';

export interface AppSidebarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  brandSettings: BrandSettings;
  volpeLogo: string;
  menuItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
  }>;
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  user: AuthUser;
}

export default function AppSidebar({
  isSidebarOpen,
  onToggleSidebar,
  brandSettings,
  volpeLogo,
  menuItems,
  activeTab,
  onSelectTab,
  user,
}: AppSidebarProps) {
  const logoSrc =
    brandSettings?.logoType === 'image' && brandSettings.logoImageUrl
      ? brandSettings.logoImageUrl
      : volpeLogo;

  const schoolName = brandSettings?.schoolName || 'Volpehub Education';

  return (
    <aside
      className={`app-sidebar ${
        isSidebarOpen ? 'w-72' : 'w-20'
      } h-full min-h-0 shrink-0 transition-all duration-300 hidden md:flex flex-col justify-between relative z-20 overflow-hidden select-none`}
      style={{
        background:
          'linear-gradient(180deg, #090d16 0%, #0d1322 45%, #080c14 100%)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '16px 0 40px -10px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Ambient Top Light Bloom */}
      <div
        className="absolute top-0 left-0 right-0 h-44 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% -20%, rgba(99, 102, 241, 0.18), transparent 75%)',
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative z-10">
        {/* Brand Header */}
        <div className="h-[4.75rem] px-4 flex items-center justify-between gap-3 shrink-0 border-b border-white/[0.08] relative bg-white/[0.015]">
          <div className="flex items-center gap-3 overflow-hidden min-w-0">
            {/* School Logo Container */}
            <div
              className={`relative flex items-center justify-center shrink-0 rounded-2xl transition-all duration-300 ${
                isSidebarOpen ? 'w-11 h-11' : 'w-11 h-11 mx-auto'
              } p-2 bg-gradient-to-b from-white/[0.12] to-white/[0.03] border border-white/[0.18] shadow-[0_4px_16px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.25)] group cursor-pointer`}
              onClick={!isSidebarOpen ? onToggleSidebar : undefined}
              title={!isSidebarOpen ? `Expand - ${schoolName}` : schoolName}
            >
              <img
                src={logoSrc}
                alt="Logo"
                className="w-full h-full object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)] transition-transform duration-300 group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = volpeLogo;
                }}
                referrerPolicy="no-referrer"
              />
              {/* Pulsing online beacon on logo */}
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border-2 border-[#090d16]" />
              </span>
            </div>

            {/* School Brand Text (when expanded) */}
            {isSidebarOpen && (
              <div className="min-w-0 flex-1">
                <h2
                  className="text-[12px] font-black font-sans leading-tight tracking-wide uppercase text-white truncate drop-shadow-sm"
                  title={schoolName}
                >
                  {schoolName}
                </h2>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)]" />
                  <p className="text-[10px] font-semibold text-slate-400 tracking-normal truncate">
                    School management portal
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Collapse/Expand Toggle Button (Header Action) */}
          {isSidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.15] transition-all duration-200 cursor-pointer shrink-0 shadow-xs"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Section Label (when expanded) */}
        {isSidebarOpen && (
          <div className="px-4 pt-3.5 pb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400/80">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-indigo-400/80" />
              Navigation
            </span>
            <span className="text-[9px] font-mono font-bold text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-400/25">
              {menuItems.length}
            </span>
          </div>
        )}

        {/* Navigation Links Area */}
        <nav
          className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-1.5 app-sidebar-nav"
          id="rbac-sidebar-navigation"
        >
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer group select-none ${
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06]'
                } ${!isSidebarOpen ? 'justify-center px-0' : ''}`}
                id={`nav-${item.id}`}
                title={!isSidebarOpen ? item.label : undefined}
              >
                {/* Active Indicator & Glow */}
                {isActive && (
                  <>
                    <motion.div
                      layoutId="sidebarActivePill"
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 38,
                      }}
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-600/30 via-indigo-500/20 to-purple-600/10 border border-indigo-400/40 shadow-[0_0_24px_rgba(99,102,241,0.22),inset_0_1px_1px_rgba(255,255,255,0.18)]"
                    />
                    {/* Left neon accent line */}
                    {isSidebarOpen && (
                      <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full bg-gradient-to-b from-indigo-400 via-violet-400 to-indigo-500 shadow-[0_0_10px_rgba(129,140,248,0.9)]" />
                    )}
                  </>
                )}

                {/* Icon Container */}
                <div
                  className={`relative z-10 p-2 rounded-xl transition-all duration-200 shrink-0 ${
                    isActive
                      ? 'bg-indigo-500/25 border border-indigo-400/40 text-indigo-200 shadow-[0_0_14px_rgba(99,102,241,0.4)]'
                      : 'text-slate-400 group-hover:text-slate-200 group-hover:bg-white/[0.06] group-hover:scale-105'
                  }`}
                >
                  <IconComponent className="w-4 h-4" />
                  {!isSidebarOpen && item.badge !== undefined && Number(item.badge) > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white shadow-xs">
                      {item.badge}
                    </span>
                  )}
                </div>

                {/* Item Label (when expanded) */}
                {isSidebarOpen && (
                  <span
                    className={`relative z-10 text-[13px] tracking-wide truncate ${
                      isActive
                        ? 'font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]'
                        : 'font-medium text-slate-300 group-hover:text-white'
                    }`}
                  >
                    {item.label}
                  </span>
                )}

                {/* Active Right Indicator / Hover Chevron (when expanded) */}
                {isSidebarOpen && (
                  <div className="relative z-10 ml-auto shrink-0 flex items-center gap-1.5">
                    {item.badge !== undefined && Number(item.badge) > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-xs animate-pulse">
                        {item.badge}
                      </span>
                    )}
                    {isActive ? (
                      <ChevronRight className="w-3.5 h-3.5 text-indigo-300 drop-shadow-[0_0_4px_rgba(165,180,252,0.8)]" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                )}

                {/* Floating Tooltip (when collapsed) */}
                {!isSidebarOpen && (
                  <div className="absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-slate-900/95 backdrop-blur-md border border-slate-700/80 text-white text-xs font-semibold shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 z-50 whitespace-nowrap flex items-center gap-2">
                    <span>{item.label}</span>
                    {item.badge !== undefined && Number(item.badge) > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-500 text-white">
                        {item.badge}
                      </span>
                    )}
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)]" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer (Developer Branding) */}
      <div className="p-3.5 shrink-0 relative z-10 border-t border-white/[0.08] bg-black/20 space-y-2.5">
        {/* Developer Attribution Card */}
        {isSidebarOpen ? (
          <div
            className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-indigo-500/30 transition-all duration-200 group cursor-default"
            title="Developed by Worexa Technologies"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1 rounded-lg bg-gradient-to-br from-indigo-600/30 to-purple-600/30 border border-indigo-400/20 shadow-[0_0_10px_rgba(99,102,241,0.2)] shrink-0 group-hover:scale-105 transition-transform duration-200">
                <WorexaLogo compact iconClassName="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-slate-300 leading-none">
                  POWERED BY
                </p>
                <p className="text-[11px] font-bold text-slate-200 group-hover:text-white transition-colors truncate mt-0.5">
                  Worexa Technologies
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Collapsed Developer Logo */
          <div
            className="flex justify-center group/dev relative cursor-default"
            title="Developed by Worexa Technologies"
          >
            <div className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/30 transition-all duration-200">
              <WorexaLogo compact iconClassName="h-5 w-5" />
            </div>
            {/* Collapsed Tooltip */}
            <div className="absolute left-[calc(100%+14px)] top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-slate-900/95 backdrop-blur-md border border-slate-700/80 text-white text-xs font-semibold shadow-2xl opacity-0 group-hover/dev:opacity-100 pointer-events-none transition-all duration-150 z-50 whitespace-nowrap flex items-center gap-1.5">
              <span>Developed by Worexa Technologies</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
