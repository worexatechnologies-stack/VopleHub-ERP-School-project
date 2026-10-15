import React, { useState, useEffect, useRef } from 'react';
import { Clock, School } from 'lucide-react';
import { TimetableSlot, SchoolTimingConfig, TimetableNotification } from './timetable/types';
import { getDefaultTimingConfig } from './timetable/utils';
import TimetableEditor from './timetable/TimetableEditor';
import TimetableView from './timetable/TimetableView';
import { Student } from '../types';
import { emitNotification } from '../services/notificationBus';
import { getErrorMessage } from '../utils/apiError';
import {
  createTimetableSlot,
  deleteTimetableSlot,
  loadTimetableSlots,
  publishTimetable,
  updateTimetableSlot,
} from '../services/timetable';

interface AcademicModuleProps {
  user?: any; // AuthUser
  students?: Student[];
  currentAcademicYear?: string;
}

export default function AcademicModule({
  user = { role: 'School Admin', schoolId: 'school-default', name: 'School Admin' },
  students = [],
  currentAcademicYear = ''
}: AcademicModuleProps) {
  // Super Admin campus select context (defaults to sch-1 Delhi Campus)
  const [superAdminSchoolId, setSuperAdminSchoolId] = useState('school-default');

  // Timetable periods are authoritative PostgreSQL records. Browser storage
  // is intentionally not used so published schedules survive logout and are
  // visible on every device to the correct role.
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [timetableLoading, setTimetableLoading] = useState(true);
  const [timetableError, setTimetableError] = useState('');
  const timetableRequestId = useRef(0);

  // Timing Config map per schoolId — always starts from defaults, never localStorage.
  const [timingConfigs, setTimingConfigs] = useState<{ [schoolId: string]: SchoolTimingConfig }>(() => ({
    [user?.schoolId || 'school-default']: getDefaultTimingConfig(user?.schoolId || 'school-default', currentAcademicYear)
  }));

  // Timetable broadcast notifications — always starts empty, never localStorage.
  const [notifications, setNotifications] = useState<TimetableNotification[]>([]);

  // ----------------------------------------------------
  // STATE SYNCERS
  // ----------------------------------------------------
  const refreshTimetable = async () => {
    const requestId = ++timetableRequestId.current;
    setTimetableLoading(true);
    try {
      const rows = await loadTimetableSlots(currentAcademicYear || undefined);
      if (requestId !== timetableRequestId.current) return;
      setSlots(rows);
      setTimetableError('');
    } catch (error) {
      if (requestId !== timetableRequestId.current) return;
      setSlots([]);
      setTimetableError(error instanceof Error ? error.message : 'Timetable could not be loaded.');
    } finally {
      if (requestId === timetableRequestId.current) setTimetableLoading(false);
    }
  };

  useEffect(() => {
    void refreshTimetable();
  }, [user?.email, user?.role, currentAcademicYear]);

  const handleUpdateSlots = async (updated: TimetableSlot[]) => {
    const currentById = new Map(slots.map((slot) => [slot.id, slot]));
    const updatedById = new Map(updated.map((slot) => [slot.id, slot]));
    const persistedId = (id: string) => /^\d+$/.test(id);
    const removed = slots.filter((slot) => persistedId(slot.id) && !updatedById.has(slot.id));
    const created = updated.filter((slot) => !persistedId(slot.id));
    const changed = updated.filter((slot) => {
      if (!persistedId(slot.id)) return false;
      const previous = currentById.get(slot.id);
      return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(slot);
    });

    setTimetableError('');
    try {
      // Deleting target periods first makes timetable copy operations obey the
      // database uniqueness constraints without a transient collision.
      for (const slot of removed) await deleteTimetableSlot(slot.id);
      for (const slot of changed) await updateTimetableSlot(slot);
      for (const slot of created) await createTimetableSlot(slot);
      await refreshTimetable();
    } catch (error) {
      await refreshTimetable();
      const message = getErrorMessage(error, 'Timetable changes could not be saved.');
      setTimetableError(message);
      throw error;
    }
  };

  const handlePublishSlots = async (sectionId: number) => {
    setTimetableError('');
    try {
      await publishTimetable(currentAcademicYear, sectionId);
      await refreshTimetable();
    } catch (error) {
      const message = getErrorMessage(error, 'Timetable could not be published.');
      setTimetableError(message);
      throw error;
    }
  };

  const handleUpdateTimingConfig = (updated: SchoolTimingConfig) => {
    const newConfigs = {
      ...timingConfigs,
      [activeSchoolId]: updated
    };
    setTimingConfigs(newConfigs);
  };

  const handleAddNotification = (title: string, message: string, targetClass?: string, targetRole?: string) => {
    const newNotif: TimetableNotification = {
      id: `notif-${Date.now()}`,
      schoolId: activeSchoolId,
      title,
      message,
      timestamp: new Date().toISOString(),
      targetClass,
      targetRole
    };
    setNotifications([newNotif, ...notifications]);
    emitNotification({
      title,
      message,
      tone: 'info',
      source: 'timetable',
    });
  };

  // Determine active school context
  const activeSchoolId = user.role === 'Super Admin' ? superAdminSchoolId : (user.schoolId || 'school-default');
  const activeTimingConfig = timingConfigs[activeSchoolId] || getDefaultTimingConfig(activeSchoolId, currentAcademicYear);

  // Check if current user role has edit rights
  const isSuperAdmin = user.role === 'Super Admin';
  const isSchoolAdmin = user.role === 'School Admin';
  const hasEditRights = isSchoolAdmin;

  return (
    <div className="space-y-6 animate-fade-in" id="academic-module-main">
      {/* Portal Header */}
      <div className="portal-header-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="portal-pill-badge indigo mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span>
              Academic Schedules
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
              Timetable Management
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Coordinate school schedules, track class timetables, and monitor period allocations.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6" id="timetable-sub-view">
        {timetableError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 flex items-center gap-2" role="alert">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
            {timetableError}
          </div>
        )}
        {timetableLoading && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm font-semibold text-indigo-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0"></span>
            Loading the live timetable from the database…
          </div>
        )}

        {/* Branch Switcher ONLY for Super Admin */}
        {isSuperAdmin && (
          <div className="portal-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
                <School className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Super Admin Global Control</p>
                <p className="text-xs text-slate-500">Select branch campus context</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-500 font-semibold whitespace-nowrap">Managing Campus:</label>
              <select
                value={superAdminSchoolId}
                onChange={(e) => setSuperAdminSchoolId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                id="super-admin-branch-select"
              >
                <option value="school-default">Default School</option>
              </select>
            </div>
          </div>
        )}

        {/* Core sub-panels */}
        {hasEditRights ? (
          <TimetableEditor
            schoolId={activeSchoolId}
            currentAcademicYear={currentAcademicYear}
            slots={slots}
            timingConfig={activeTimingConfig}
            onUpdateSlots={handleUpdateSlots}
            onPublishSlots={handlePublishSlots}
            onUpdateTimingConfig={handleUpdateTimingConfig}
            onAddNotification={handleAddNotification}
          />
        ) : (
          <TimetableView
            user={user}
            students={students}
            slots={slots}
            timingConfig={activeTimingConfig}
            notifications={notifications}
          />
        )}
      </div>
    </div>
  );
}
