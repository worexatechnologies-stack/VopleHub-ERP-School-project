import React from 'react';
import { Calendar, Clock, MapPin, User, AlertCircle, FileText, Printer, ArrowRight } from 'lucide-react';
import { DayOfWeek, TimetableSlot, SchoolTimingConfig } from './types';
import { generatePeriodsList, DAYS_OF_WEEK } from './utils';

interface TimetableGridProps {
  slots: TimetableSlot[];
  timingConfig: SchoolTimingConfig;
  viewMode: 'class' | 'teacher' | 'subject' | 'daily';
  selectedClass: string;
  selectedSection: string;
  selectedTeacherId: string;
  selectedSubject: string;
  selectedDay: DayOfWeek;
  canEdit: boolean;
  onCellClick?: (day: DayOfWeek, period: number, existingSlot?: TimetableSlot) => void;
}

export default function TimetableGrid({
  slots,
  timingConfig,
  viewMode,
  selectedClass,
  selectedSection,
  selectedTeacherId,
  selectedSubject,
  selectedDay,
  canEdit,
  onCellClick
}: TimetableGridProps) {
  // Generate the full sequence of blocks (periods, breaks, lunch)
  const allBlocks = generatePeriodsList(timingConfig);
  const activeDays = timingConfig.workingDays;

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // 1. CLASS-WISE OR SECTION-WISE WEEKLY GRID
  if (viewMode === 'class') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="timetable-weekly-grid">
        {/* Header Tools */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 print:hidden">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-indigo-500" />
              Weekly Class Grid: {selectedClass} - {selectedSection}
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Click any class block to assign or edit subject allocations.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg shadow-2xs transition-all"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Timetable
            </button>
          </div>
        </div>

        {/* Printable Area Wrapper */}
        <div className="overflow-x-auto p-4 print:p-0">
          <table className="w-full min-w-[800px] border-collapse text-left text-xs font-sans print:text-[10px]">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 font-bold text-slate-700">
                <th className="py-3 px-4 border border-slate-200 w-28">Day / Period</th>
                {allBlocks.map((block, idx) => {
                  if (block.type === 'break') {
                    return (
                      <th key={`h-${idx}`} className="py-3 px-2 border border-slate-200 text-center w-12 bg-amber-50/50 text-amber-800 font-semibold uppercase text-[9px] tracking-wider">
                        Break
                      </th>
                    );
                  }
                  if (block.type === 'lunch') {
                    return (
                      <th key={`h-${idx}`} className="py-3 px-2 border border-slate-200 text-center w-16 bg-emerald-50/50 text-emerald-800 font-semibold uppercase text-[9px] tracking-wider">
                        Lunch
                      </th>
                    );
                  }
                  return (
                    <th key={`h-${idx}`} className="py-3 px-3 border border-slate-200 w-36 text-center">
                      <div className="font-bold text-slate-800">Period {block.periodNumber}</div>
                      <div className="text-[10px] font-mono font-medium text-slate-500 mt-0.5">{block.timeLabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeDays.map(day => (
                <tr key={day} className="hover:bg-slate-50/30 transition-colors">
                  {/* Day Label Row */}
                  <td className="py-4 px-4 border border-slate-200 font-bold text-slate-800 bg-slate-50/50 flex-col justify-center">
                    <div>{day}</div>
                    <div className="text-[9px] text-slate-400 font-normal font-mono mt-0.5 uppercase tracking-wider">
                      {slots.filter(s => s.day === day && s.class === selectedClass && s.section === selectedSection).length} periods
                    </div>
                  </td>

                  {/* Render periods / breaks cells */}
                  {allBlocks.map((block, idx) => {
                    if (block.type === 'break') {
                      return (
                        <td key={`b-${day}-${idx}`} className="border border-slate-200 bg-amber-50/20 text-center text-amber-600/70 font-bold font-mono uppercase text-[9px] select-none writing-mode-vertical">
                          Recess
                        </td>
                      );
                    }
                    if (block.type === 'lunch') {
                      return (
                        <td key={`l-${day}-${idx}`} className="border border-slate-200 bg-emerald-50/20 text-center text-emerald-600/70 font-bold font-mono uppercase text-[9px] select-none">
                          Lunch Break
                        </td>
                      );
                    }

                    // Find if there is a slot scheduled for this class + section + day + period
                    const slot = slots.find(s => 
                      s.class === selectedClass && 
                      s.section === selectedSection && 
                      s.day === day && 
                      s.period === block.periodNumber
                    );

                    const isDraft = slot && !slot.published;

                    return (
                      <td
                        key={`cell-${day}-${block.periodNumber}`}
                        onClick={() => canEdit && onCellClick && onCellClick(day, block.periodNumber, slot)}
                        className={`border border-slate-200 p-2.5 text-center transition-all relative group ${
                          canEdit ? 'cursor-pointer hover:bg-indigo-50/35 hover:border-indigo-200' : ''
                        } ${slot ? 'bg-indigo-50/15' : 'bg-slate-50/10'}`}
                      >
                        {slot ? (
                          <div className="space-y-1">
                            <div className="font-bold text-indigo-950 text-[11px] truncate" title={slot.subject}>
                              {slot.subject}
                            </div>
                            <div className="text-[10px] text-slate-600 font-medium truncate flex items-center justify-center gap-1">
                              <User className="w-3 h-3 text-slate-400" />
                              {slot.teacherName}
                            </div>
                            <div className="text-[9px] text-slate-500 font-semibold truncate flex items-center justify-center gap-1 bg-slate-100/80 px-1.5 py-0.5 rounded-sm w-fit mx-auto border border-slate-200/40">
                              <MapPin className="w-2.5 h-2.5 text-slate-400" />
                              {slot.classroom}
                            </div>
                            {isDraft && (
                              <span className="absolute top-1 right-1 px-1 py-0.2 text-[7px] font-bold uppercase tracking-wider bg-amber-500 text-white rounded">
                                Draft
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-slate-300 group-hover:text-indigo-400 py-3 text-[10px] font-medium transition-colors">
                            {canEdit ? '+ Assign' : '- Empty -'}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 2. TEACHER-WISE WEEKLY GRID
  if (viewMode === 'teacher') {
    // Resolve the teacher name from the actual timetable slots (server data),
    // falling back to the selected teacher ID only when no slot exists yet.
    const teacherSlot = slots.find(s => s.teacherId === selectedTeacherId);
    const selectedTeacherName = teacherSlot?.teacherName || 'Teacher';

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="timetable-teacher-grid">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 print:hidden">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <User className="w-4 h-4 text-emerald-500" />
              Teacher-wise Schedule: {selectedTeacherName}
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Consolidated lecture sessions across all rostered campus branches.</p>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg shadow-2xs transition-all"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Timetable
          </button>
        </div>

        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[800px] border-collapse text-left text-xs font-sans">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 font-bold text-slate-700">
                <th className="py-3 px-4 border border-slate-200 w-28">Day / Period</th>
                {allBlocks.map((block, idx) => {
                  if (block.type === 'break' || block.type === 'lunch') {
                    return (
                      <th key={`th-break-${idx}`} className="py-3 px-2 border border-slate-200 text-center w-12 bg-slate-50 text-slate-400 font-semibold uppercase text-[9px] tracking-wider select-none">
                        {block.type}
                      </th>
                    );
                  }
                  return (
                    <th key={`th-block-${idx}`} className="py-3 px-3 border border-slate-200 w-36 text-center">
                      <div className="font-bold text-slate-800">Period {block.periodNumber}</div>
                      <div className="text-[10px] font-mono font-medium text-slate-500 mt-0.5">{block.timeLabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeDays.map(day => (
                <tr key={day} className="hover:bg-slate-50/30 transition-colors">
                  <td className="py-4 px-4 border border-slate-200 font-bold text-slate-800 bg-slate-50/50">
                    {day}
                  </td>

                  {allBlocks.map((block, idx) => {
                    if (block.type === 'break') {
                      return (
                        <td key={`brk-${day}-${idx}`} className="border border-slate-200 bg-slate-50/50 text-center text-slate-400 font-mono text-[9px] select-none">
                          -
                        </td>
                      );
                    }
                    if (block.type === 'lunch') {
                      return (
                        <td key={`lun-${day}-${idx}`} className="border border-slate-200 bg-slate-50/50 text-center text-slate-400 font-mono text-[9px] select-none">
                          -
                        </td>
                      );
                    }

                    // Find slots for this specific teacher on this day + period
                    const teacherSlots = slots.filter(s => 
                      s.teacherId === selectedTeacherId && 
                      s.day === day && 
                      s.period === block.periodNumber
                    );

                    const slot = teacherSlots[0]; // Take first to represent

                    return (
                      <td
                        key={`cell-${day}-${block.periodNumber}`}
                        className={`border border-slate-200 p-2.5 text-center ${
                          slot ? 'bg-emerald-50/20' : 'bg-slate-50/10'
                        }`}
                      >
                        {slot ? (
                          <div className="space-y-1">
                            <div className="font-bold text-emerald-950 text-[11px] truncate">
                              {slot.subject}
                            </div>
                            <div className="text-[10px] text-slate-600 font-bold flex items-center justify-center gap-0.5 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md py-0.5 px-1 w-fit mx-auto">
                              {slot.class} - {slot.section}
                            </div>
                            <div className="text-[9px] text-slate-500 font-semibold truncate flex items-center justify-center gap-1 mt-0.5">
                              <MapPin className="w-2.5 h-2.5 text-slate-400" />
                              {slot.classroom}
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-300 py-3 text-[10px] font-normal">
                            No lecture
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 3. SUBJECT-WISE GRID WITH ALLOCATION HIGHLIGHTS
  if (viewMode === 'subject') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="timetable-subject-grid">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 print:hidden">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-purple-500" />
              Subject Audit Allocation: {selectedSubject || 'All Subjects'}
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Highlights periods where {selectedSubject} is active across the system.</p>
          </div>
        </div>

        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[800px] border-collapse text-left text-xs font-sans">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 font-bold text-slate-700">
                <th className="py-3 px-4 border border-slate-200 w-28">Day / Period</th>
                {allBlocks.map((block, idx) => {
                  if (block.type === 'break' || block.type === 'lunch') {
                    return (
                      <th key={`sb-break-${idx}`} className="py-3 px-2 border border-slate-200 text-center w-12 bg-slate-50 text-slate-300 text-[9px] select-none uppercase">
                        {block.type}
                      </th>
                    );
                  }
                  return (
                    <th key={`sb-block-${idx}`} className="py-3 px-3 border border-slate-200 w-36 text-center">
                      <div className="font-bold text-slate-800">Period {block.periodNumber}</div>
                      <div className="text-[10px] font-mono font-medium text-slate-500 mt-0.5">{block.timeLabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeDays.map(day => (
                <tr key={day} className="hover:bg-slate-50/30 transition-colors">
                  <td className="py-4 px-4 border border-slate-200 font-bold text-slate-800 bg-slate-50/50">
                    {day}
                  </td>

                  {allBlocks.map((block, idx) => {
                    if (block.type === 'break' || block.type === 'lunch') {
                      return (
                        <td key={`sbb-${day}-${idx}`} className="border border-slate-200 bg-slate-50/20 text-center text-slate-300">
                          -
                        </td>
                      );
                    }

                    // Find all slots teaching this subject on this day and period
                    const matchedSlots = slots.filter(s => 
                      s.subject.toLowerCase() === selectedSubject.toLowerCase() && 
                      s.day === day && 
                      s.period === block.periodNumber
                    );

                    return (
                      <td
                        key={`cell-${day}-${block.periodNumber}`}
                        className={`border border-slate-200 p-2.5 text-center ${
                          matchedSlots.length > 0 ? 'bg-purple-500/10 border-purple-200 shadow-inner' : 'bg-slate-50/10'
                        }`}
                      >
                        {matchedSlots.length > 0 ? (
                          <div className="space-y-1">
                            <div className="font-bold text-purple-950 text-[11px] truncate">
                              {selectedSubject}
                            </div>
                            <div className="space-y-0.5">
                              {matchedSlots.map((s, sIdx) => (
                                <div key={sIdx} className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-100/50 px-1 py-0.5 rounded-sm">
                                  {s.class}-{s.section} ({s.classroom})
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-300 font-normal text-[10px]">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 4. DAILY TIMELINE / LIST VIEW
  if (viewMode === 'daily') {
    const classSlots = slots.filter(s => 
      s.class === selectedClass && 
      s.section === selectedSection && 
      s.day === selectedDay
    );

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="timetable-daily-timeline">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center print:hidden">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-500" />
              Daily Schedule Roster: {selectedDay} ({selectedClass} - {selectedSection})
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Continuous schedule flow including recess slots.</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {allBlocks.map((block, idx) => {
            if (block.type === 'break') {
              return (
                <div key={idx} className="flex items-center gap-4 p-3 bg-amber-50/50 border border-amber-100/50 border-dashed rounded-xl justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                      REC
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Recess / Short Break</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{block.timeLabel}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-md font-mono">
                    {timingConfig.breakDuration} Mins
                  </span>
                </div>
              );
            }

            if (block.type === 'lunch') {
              return (
                <div key={idx} className="flex items-center gap-4 p-3 bg-emerald-50/50 border border-emerald-100/50 border-dashed rounded-xl justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
                      LUN
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Lunch Break Recess</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{block.timeLabel}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-md font-mono">
                    {timingConfig.lunchDuration} Mins
                  </span>
                </div>
              );
            }

            // Regular Period
            const slot = classSlots.find(s => s.period === block.periodNumber);
            const isDraft = slot && !slot.published;

            return (
              <div
                key={idx}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border transition-all ${
                  slot 
                    ? 'bg-indigo-50/5 border-slate-200 hover:border-slate-300' 
                    : 'bg-slate-50/20 border-slate-100/70 border-dashed'
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Period number tag */}
                  <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-bold border ${
                    slot 
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-100/60' 
                      : 'bg-slate-100 text-slate-400 border-slate-200/40'
                  }`}>
                    <span className="text-[8px] tracking-widest leading-none text-slate-400">PD</span>
                    <span className="text-base leading-none mt-1">{block.periodNumber}</span>
                  </div>

                  <div>
                    {slot ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-900">{slot.subject}</h4>
                          <span className="text-[9px] font-mono text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.2 rounded-md">
                            {block.timeLabel}
                          </span>
                          {isDraft && (
                            <span className="text-[8px] font-bold bg-amber-500 text-white px-1.5 py-0.2 rounded uppercase tracking-wider">
                              Draft
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            Instructor: {slot.teacherName}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            Location: {slot.classroom}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-xs font-bold text-slate-400">Unassigned Free Period</h4>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{block.timeLabel}</p>
                      </div>
                    )}
                  </div>
                </div>

                {slot && canEdit && onCellClick && (
                  <button
                    onClick={() => onCellClick(selectedDay, block.periodNumber, slot)}
                    className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100/50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg shrink-0 transition-all flex items-center gap-1 self-end sm:self-auto"
                  >
                    Edit Allocation
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
