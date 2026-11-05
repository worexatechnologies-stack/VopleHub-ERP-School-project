import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
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

/* ─── Tooltip component for collapsed-mode hover labels ─── */
function NavTooltip({ label, badge }: { label: string; badge?: number | string }) {
  const hasBadge =
    badge !== undefined &&
    (typeof badge === 'string' ? badge.length > 0 : Number(badge) > 0);
  return (
    <div
      className="
        pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50
        -translate-y-1/2 whitespace-nowrap rounded-lg border border-slate-200
        bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-lg
        opacity-0 scale-95 origin-left
        group-hover:opacity-100 group-hover:scale-100
        transition-all duration-150
        flex items-center gap-2
      "
    >
      <span>{label}</span>
      {hasBadge && (
        <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-black text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

/* ─── Single navigation item ─── */
function NavItem({
  item,
  isActive,
  isOpen,
  onSelect,
}: {
  item: AppSidebarProps['menuItems'][0];
  isActive: boolean;
  isOpen: boolean;
  onSelect: () => void;
}) {
  const IconComponent = item.icon;
  const hasBadge =
    item.badge !== undefined &&
    (typeof item.badge === 'string'
      ? item.badge.length > 0
      : Number(item.badge) > 0);

  return (
    <button
      onClick={onSelect}
      title={!isOpen ? item.label : undefined}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
      className={`
        relative group w-full flex items-center gap-3
        rounded-xl transition-all duration-200 select-none cursor-pointer
        ${isOpen ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'}
        ${
          isActive
            ? 'bg-orange-50 text-orange-600'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        }
      `}
    >
      {/* Left active bar */}
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-orange-500" />
      )}

      {/* Icon */}
      <div
        className={`
          relative shrink-0 p-2 rounded-lg transition-all duration-200
          ${
            isActive
              ? 'bg-orange-100 text-orange-600'
              : 'text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-700'
          }
        `}
      >
        <IconComponent className="w-4 h-4" />

        {/* Badge on icon (collapsed mode) */}
        {!isOpen && hasBadge && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-0.5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-black text-white">
            {item.badge}
          </span>
        )}
      </div>

      {/* Label + badge (expanded mode) */}
      {isOpen && (
        <>
          <span
            className={`flex-1 text-left text-[13px] leading-none truncate font-medium transition-colors duration-200 ${
              isActive
                ? 'text-orange-600 font-semibold'
                : 'text-slate-600 group-hover:text-slate-800'
            }`}
          >
            {item.label}
          </span>

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {hasBadge && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-orange-500 text-white">
                {item.badge}
              </span>
            )}
            <ChevronRight
              className={`w-3.5 h-3.5 transition-all duration-200 ${
                isActive
                  ? 'text-orange-400 opacity-100'
                  : 'text-slate-300 opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
        </>
      )}

      {/* Tooltip (collapsed mode) */}
      {!isOpen && <NavTooltip label={item.label} badge={item.badge} />}
    </button>
  );
}

/* ─── Mobile overlay ─── */
function MobileOverlay({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden"
        />
      )}
    </AnimatePresence>
  );
}

/* ─── Main Sidebar ─── */
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

  const isPlatformAdmin = user?.role === 'Super Admin';
  const workspaceName = isPlatformAdmin
    ? brandSettings?.schoolName || 'Volpehub Education'
    : user?.schoolName || brandSettings?.schoolName || 'Your School';
  const workspaceSubtitle = isPlatformAdmin
    ? 'Platform administration'
    : 'School management portal';

  /* Detect mobile so we can show overlay + slide-in drawer */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /* Prevent body scroll when mobile drawer is open */
  useEffect(() => {
    if (isMobile && isSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, isSidebarOpen]);

  /* ── Sidebar inner content (shared between desktop and mobile) ── */
  const sidebarContent = (
    <aside
      className={`
        app-sidebar flex flex-col h-full bg-white border-r border-slate-200/80
        shadow-[4px_0_24px_-4px_rgba(0,0,0,0.08)] select-none overflow-hidden
        transition-all duration-300 ease-in-out
        ${isMobile
          ? 'w-72 fixed inset-y-0 left-0 z-40'
          : isSidebarOpen
            ? 'w-64 relative z-20'
            : 'w-[68px] relative z-20'
        }
      `}
    >
      {/* ── Brand Header ── */}
      <div
        className={`
          h-16 px-4 flex items-center border-b border-slate-100 shrink-0
          ${isSidebarOpen || isMobile ? 'justify-between gap-3' : 'justify-center'}
        `}
      >
        <div
          className={`flex items-center gap-3 overflow-hidden min-w-0 ${!isSidebarOpen && !isMobile ? 'flex-col' : ''}`}
        >
          {/* Logo */}
          <button
            onClick={!isSidebarOpen && !isMobile ? onToggleSidebar : undefined}
            title={!isSidebarOpen && !isMobile ? `Expand – ${workspaceName}` : workspaceName}
            className={`
              shrink-0 relative flex items-center justify-center rounded-xl overflow-hidden
              border border-slate-200 shadow-sm bg-white
              transition-all duration-200
              ${isSidebarOpen || isMobile ? 'w-9 h-9' : 'w-9 h-9 cursor-pointer hover:scale-105 hover:shadow-md'}
            `}
          >
            <img
              src={logoSrc}
              alt="School Logo"
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                (e.target as HTMLImageElement).src = volpeLogo;
              }}
              referrerPolicy="no-referrer"
            />
            {/* Online indicator */}
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border-2 border-white" />
            </span>
          </button>

          {/* School name */}
          {(isSidebarOpen || isMobile) && (
            <div className="min-w-0 flex-1">
              <p
                className="text-[12px] font-black text-slate-800 uppercase tracking-wide truncate leading-tight"
                title={workspaceName}
              >
                {workspaceName}
              </p>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5 truncate leading-tight">
                {workspaceSubtitle}
              </p>
            </div>
          )}
        </div>

        {/* Collapse/close button */}
        {(isSidebarOpen || isMobile) && (
          <button
            onClick={onToggleSidebar}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-150 cursor-pointer"
            title={isMobile ? 'Close menu' : 'Collapse sidebar'}
            aria-label={isMobile ? 'Close menu' : 'Collapse sidebar'}
          >
            {isMobile ? <X className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}

        {/* Expand button (desktop collapsed) */}
        {!isSidebarOpen && !isMobile && (
          <button
            onClick={onToggleSidebar}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-150 cursor-pointer mt-0.5"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Navigation section label (expanded only) ── */}
      {(isSidebarOpen || isMobile) && (
        <div className="px-4 pt-4 pb-1 flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            Navigation
          </span>
          <span className="text-[9px] font-bold text-orange-500 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">
            {menuItems.length}
          </span>
        </div>
      )}

      {/* ── Navigation links ── */}
      <nav
        id="rbac-sidebar-navigation"
        className={`
          flex-1 min-h-0 overflow-y-auto py-2 space-y-0.5 app-sidebar-nav
          ${isSidebarOpen || isMobile ? 'px-3' : 'px-2'}
        `}
      >
        {menuItems.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={activeTab === item.id}
            isOpen={isSidebarOpen || isMobile}
            onSelect={() => onSelectTab(item.id)}
          />
        ))}
      </nav>

      {/* ── Footer – Worexa branding ── */}
      <div
        className={`
          shrink-0 border-t border-slate-100
          ${isSidebarOpen || isMobile ? 'p-3' : 'p-2'}
        `}
      >
        {isSidebarOpen || isMobile ? (
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 hover:bg-orange-50 hover:border-orange-100 transition-all duration-200 group cursor-default"
            title="Developed by Worexa Technologies"
          >
            <div className="shrink-0 p-1 rounded-lg bg-white border border-slate-200 shadow-xs group-hover:shadow-sm transition-shadow">
              <WorexaLogo compact iconClassName="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-orange-400 leading-none transition-colors">
                POWERED BY
              </p>
              <p className="text-[11px] font-bold text-slate-600 group-hover:text-slate-800 transition-colors truncate mt-0.5">
                Worexa Technologies
              </p>
            </div>
          </div>
        ) : (
          <div
            className="relative flex justify-center group/dev cursor-default"
            title="Developed by Worexa Technologies"
          >
            <div className="p-1.5 rounded-xl bg-slate-50 border border-slate-100 hover:bg-orange-50 hover:border-orange-100 transition-all duration-200">
              <WorexaLogo compact iconClassName="h-5 w-5" />
            </div>
            {/* Collapsed tooltip */}
            <div className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold shadow-lg opacity-0 group-hover/dev:opacity-100 transition-all duration-150 z-50 whitespace-nowrap">
              Developed by Worexa Technologies
            </div>
          </div>
        )}
      </div>
    </aside>
  );

  /* ── Desktop: static sidebar ── */
  if (!isMobile) {
    return sidebarContent;
  }

  /* ── Mobile: overlay + slide-in drawer ── */
  return (
    <>
      <MobileOverlay isOpen={isSidebarOpen} onClose={onToggleSidebar} />
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            key="mobile-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="fixed inset-y-0 left-0 z-40 h-full"
            style={{ width: 288 }}
          >
            {sidebarContent}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
