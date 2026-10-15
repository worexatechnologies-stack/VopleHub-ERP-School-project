export const TEACHER_ASSIGNMENTS_CHANGED_EVENT = 'school-erp:teacher-assignments-changed';

export function announceTeacherAssignmentsChanged(): void {
  window.dispatchEvent(new Event(TEACHER_ASSIGNMENTS_CHANGED_EVENT));
}
