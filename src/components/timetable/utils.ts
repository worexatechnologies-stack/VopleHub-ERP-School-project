import { DayOfWeek, TimetableSlot, SchoolTimingConfig, TimetableConflict, TimetableNotification, TeacherRecord } from './types';

// User-created teachers are loaded into the timetable editor by the app.
export const DEFAULT_TEACHERS: TeacherRecord[] = [];

export const CLASS_ROOMS = [
  'Room 101', 'Room 102', 'Room 103', 'Room 201', 'Room 202', 'Room 203', 
  'Physics Lab', 'Chemistry Lab', 'Computer Lab', 'Seminar Hall', 'Playground'
];

export const DAYS_OF_WEEK: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Convert HH:MM input time to minutes from midnight
export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Convert minutes from midnight back to 12-hour AM/PM string
export function minutesToTimeStr(totalMinutes: number): string {
  const adjustedMins = totalMinutes % 1440;
  let hours = Math.floor(adjustedMins / 60);
  const minutes = Math.floor(adjustedMins % 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
}

// Automatically generate periods and breaks times list
export function generatePeriodsList(config: SchoolTimingConfig): { periodNumber: number; type: 'class' | 'break' | 'lunch'; timeLabel: string; startMin: number; endMin: number }[] {
  const list: { periodNumber: number; type: 'class' | 'break' | 'lunch'; timeLabel: string; startMin: number; endMin: number }[] = [];
  let currentMin = timeToMinutes(config.startTime);

  for (let p = 1; p <= config.totalPeriods; p++) {
    // 1. Add Class Period
    const startMin = currentMin;
    const endMin = currentMin + config.periodDuration;
    const timeLabel = `${minutesToTimeStr(startMin)} - ${minutesToTimeStr(endMin)}`;
    list.push({
      periodNumber: p,
      type: 'class',
      timeLabel,
      startMin,
      endMin
    });
    currentMin = endMin;

    // 2. Insert Break if configured after this period
    if (p === config.breakPeriod && config.breakDuration > 0) {
      const bStart = currentMin;
      const bEnd = currentMin + config.breakDuration;
      list.push({
        periodNumber: 0, // 0 denotes break
        type: 'break',
        timeLabel: `${minutesToTimeStr(bStart)} - ${minutesToTimeStr(bEnd)}`,
        startMin: bStart,
        endMin: bEnd
      });
      currentMin = bEnd;
    }

    // 3. Insert Lunch if configured after this period
    if (p === config.lunchPeriod && config.lunchDuration > 0) {
      const lStart = currentMin;
      const lEnd = currentMin + config.lunchDuration;
      list.push({
        periodNumber: -1, // -1 denotes lunch
        type: 'lunch',
        timeLabel: `${minutesToTimeStr(lStart)} - ${minutesToTimeStr(lEnd)}`,
        startMin: lStart,
        endMin: lEnd
      });
      currentMin = lEnd;
    }
  }

  return list;
}

// Get standard default timings config for a school
export function getDefaultTimingConfig(schoolId: string, academicYear: string): SchoolTimingConfig {
  return {
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '08:30',
    periodDuration: 45,
    breakPeriod: 2,
    breakDuration: 15,
    lunchPeriod: 4,
    lunchDuration: 45,
    totalPeriods: 6,
    academicYear
  };
}

export function getInitialDemoSlots(): TimetableSlot[] {
  return [];
}

// Check for conflicting teacher schedules
export function checkTeacherConflicts(
  slots: TimetableSlot[],
  teacherId: string,
  day: DayOfWeek,
  period: number,
  excludeId?: string
): TimetableSlot[] {
  if (!teacherId || teacherId === '') return [];
  return slots.filter(s => 
    s.teacherId === teacherId && 
    s.day === day && 
    s.period === period && 
    s.id !== excludeId
  );
}

// Check for conflicting classroom assignments
export function checkClassroomConflicts(
  slots: TimetableSlot[],
  classroom: string,
  day: DayOfWeek,
  period: number,
  excludeId?: string
): TimetableSlot[] {
  if (!classroom || classroom.trim() === '') return [];
  const normalizedRoom = classroom.trim().toLowerCase();
  return slots.filter(s => 
    s.classroom.trim().toLowerCase() === normalizedRoom && 
    s.day === day && 
    s.period === period && 
    s.id !== excludeId
  );
}

// Export timetable to CSV
export function exportToCSV(slots: TimetableSlot[], className: string, sectionName: string, timingConfig: SchoolTimingConfig) {
  const periods = generatePeriodsList(timingConfig).filter(p => p.type === 'class');
  const days: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  let csvContent = `Volpehub Education - Timetable for ${className} - ${sectionName}\r\n`;
  csvContent += `Academic Year: ${timingConfig.academicYear}\r\n`;
  csvContent += `Generated At: ${new Date().toLocaleDateString()}\r\n\r\n`;
  
  // Headers: Period details
  csvContent += 'Day/Period,';
  periods.forEach(p => {
    csvContent += `Period ${p.periodNumber} (${p.timeLabel}),`;
  });
  csvContent += '\r\n';

  // Fill in cells
  days.forEach(day => {
    csvContent += `${day},`;
    periods.forEach(p => {
      const slot = slots.find(s => s.class === className && s.section === sectionName && s.day === day && s.period === p.periodNumber);
      if (slot) {
        // Sanitize for commas
        const content = `${slot.subject} [${slot.teacherName}] (${slot.classroom})`;
        csvContent += `"${content.replace(/"/g, '""')}",`;
      } else {
        csvContent += '-,';
      }
    });
    csvContent += '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Timetable_${className.replace(/\s+/g, '')}_${sectionName}_${timingConfig.academicYear}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
