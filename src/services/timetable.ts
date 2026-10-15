import { store } from '../store';
import { timetableApi } from '../store/api/timetableApi';
import type { TimetableSlot } from '../components/timetable/types';

interface TimetableApiRecord {
  id: number | string;
  schoolId: number | string;
  academicYear: string;
  class?: string;
  className?: string;
  section: string;
  sectionId: number;
  day: TimetableSlot['day'];
  period: number;
  time?: string;
  subject: string;
  subjectId: number;
  teacherId: number | string;
  teacherName: string;
  classroom?: string;
  published: boolean;
}

export interface TimetableSlotInput {
  academicYear: string;
  sectionId: number;
  day: TimetableSlot['day'];
  period: number;
  time: string;
  subjectId: number;
  teacherId: number;
  classroom: string;
}

function normalizeSlot(row: TimetableApiRecord): TimetableSlot {
  return {
    id: String(row.id),
    schoolId: String(row.schoolId),
    academicYear: row.academicYear,
    class: row.class || row.className || '',
    section: row.section,
    sectionId: Number(row.sectionId),
    day: row.day,
    period: Number(row.period),
    time: row.time || '',
    subject: row.subject,
    subjectId: Number(row.subjectId),
    teacherId: String(row.teacherId),
    teacherName: row.teacherName,
    classroom: row.classroom || 'Default',
    published: Boolean(row.published),
  };
}

export function timetableSlotInput(slot: TimetableSlot): TimetableSlotInput {
  if (!Number.isFinite(slot.sectionId) || !Number.isFinite(slot.subjectId) || !Number.isFinite(Number(slot.teacherId))) {
    throw new Error('This timetable period is missing a canonical section, subject, or teacher assignment. Recreate the period.');
  }
  return {
    academicYear: slot.academicYear,
    sectionId: slot.sectionId,
    day: slot.day,
    period: slot.period,
    time: slot.time,
    subjectId: slot.subjectId,
    teacherId: Number(slot.teacherId),
    classroom: slot.classroom,
  };
}

export async function loadTimetableSlots(academicYear?: string): Promise<TimetableSlot[]> {
  const payload = await store
    .dispatch(
      timetableApi.endpoints.getTimetableSlots.initiate(
        academicYear ? { academicYear } : undefined
      )
    )
    .unwrap();
  return (payload || []).map((row) => normalizeSlot(row as any));
}

export async function createTimetableSlot(slot: TimetableSlot): Promise<TimetableSlot> {
  const saved = await store
    .dispatch(timetableApi.endpoints.createTimetableSlot.initiate(timetableSlotInput(slot) as any))
    .unwrap();
  return normalizeSlot(saved as any);
}

export async function updateTimetableSlot(slot: TimetableSlot): Promise<TimetableSlot> {
  const saved = await store
    .dispatch(
      timetableApi.endpoints.updateTimetableSlot.initiate({
        id: slot.id,
        body: timetableSlotInput(slot) as any,
      })
    )
    .unwrap();
  return normalizeSlot(saved as any);
}

export async function deleteTimetableSlot(slotId: string): Promise<void> {
  await store.dispatch(timetableApi.endpoints.deleteTimetableSlot.initiate(slotId)).unwrap();
}

export async function publishTimetable(academicYear: string, sectionId: number): Promise<TimetableSlot[]> {
  const response = await store
    .dispatch(timetableApi.endpoints.publishTimetable.initiate({ academicYear, sectionId }))
    .unwrap();
  const rows = Array.isArray(response) ? response : (response.slots || []);
  return rows.map((row) => normalizeSlot(row as any));
}
