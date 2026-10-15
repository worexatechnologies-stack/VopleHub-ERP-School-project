export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface TimetableSlot {
  id: string;
  schoolId: string;
  academicYear: string;
  class: string;
  section: string;
  sectionId: number;
  day: DayOfWeek;
  period: number;
  time: string;
  subject: string;
  subjectId: number;
  teacherId: string;
  teacherName: string;
  classroom: string;
  published: boolean;
}

export interface SchoolTimingConfig {
  workingDays: DayOfWeek[];
  startTime: string; // e.g. "08:30"
  periodDuration: number; // e.g. 45
  breakPeriod: number; // e.g. 2 (occurs after period 2)
  breakDuration: number; // e.g. 15
  lunchPeriod: number; // e.g. 4 (occurs after period 4)
  lunchDuration: number; // e.g. 45
  totalPeriods: number; // e.g. 6 or 7 or 8
  academicYear: string;
}

export interface TimetableConflict {
  type: 'teacher' | 'classroom';
  message: string;
  severity: 'error' | 'warning';
  slotDetails: {
    day: DayOfWeek;
    period: number;
    conflictingClass: string;
    conflictingSection: string;
    conflictingSubject: string;
  };
}

export interface TimetableNotification {
  id: string;
  schoolId: string;
  title: string;
  message: string;
  timestamp: string;
  targetRole?: string;
  targetClass?: string;
}

export interface TeacherRecord {
  id: string;
  name: string;
  subjects: string[];
}
