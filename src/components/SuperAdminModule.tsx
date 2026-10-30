import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getStoredAuthenticatedUser, SUPER_ADMIN_NAME } from '../utils/auth';

// Modular Sub-components
import SuperAdminDashboard from './super-admin/SuperAdminDashboard';
import SuperAdminSchools from './super-admin/SuperAdminSchools';
import SuperAdminAdmins from './super-admin/SuperAdminAdmins';
import SuperAdminSystemSettings from './super-admin/SuperAdminSystemSettings';
import SuperAdminReports from './super-admin/SuperAdminReports';
import SuperAdminPublicLearners from './super-admin/SuperAdminPublicLearners';

interface SuperAdminModuleProps {
  activeTab?: string;
  onNavigateToTab?: (tab: string) => void;
}

export default function SuperAdminModule({ activeTab = 'super-admin-dashboard', onNavigateToTab }: SuperAdminModuleProps) {
  const [operatorName, setOperatorName] = useState(SUPER_ADMIN_NAME);

  useEffect(() => {
    const user = getStoredAuthenticatedUser();
    if (user?.name) {
      setOperatorName(user.name);
    }
  }, []);

  return (
    <div className="space-y-6 font-sans" id="super-admin-workspace">
      {/* Session Header Status */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 px-1 py-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 uppercase tracking-widest font-mono">
                Root Clearance
              </span>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs font-semibold text-slate-700">{operatorName}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600 bg-white border border-slate-200/90 px-3 py-1.5 rounded-xl shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Core Schema Connected</span>
        </div>
      </div>

      {/* Render matching child view based on activeTab */}
      <div className="transition-all duration-300">
        {activeTab === 'super-admin-dashboard' && <SuperAdminDashboard onNavigateToTab={onNavigateToTab} />}
        {activeTab === 'super-admin-schools' && <SuperAdminSchools />}
        {activeTab === 'super-admin-admins' && <SuperAdminAdmins />}
        {activeTab === 'super-admin-audit' && <SuperAdminReports />}
        {activeTab === 'super-admin-sys-settings' && <SuperAdminSystemSettings />}
        {activeTab === 'super-admin-public-learners' && <SuperAdminPublicLearners />}
      </div>
    </div>
  );
}
