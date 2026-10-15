import { store } from '../store';
import { academicApi } from '../store/api/academicApi';

export interface AcademicClass {
  id: number;
  name: string;
  code: string;
  sortOrder: number;
  subjectIds?: number[];
}

export interface AcademicSection {
  id: number;
  classId: number;
  name: string;
}

export interface AcademicSubject {
  id: number;
  name: string;
}

export interface AcademicYear {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  is_active: boolean;
}

export const ACADEMIC_STRUCTURE_CHANGED_EVENT = 'school-erp:academic-structure-changed';

export function announceAcademicStructureChanged(): void {
  store.dispatch(academicApi.util.invalidateTags(['AcademicYear', 'Class', 'Section', 'Subject']));
  window.dispatchEvent(new Event(ACADEMIC_STRUCTURE_CHANGED_EVENT));
}

export async function loadAcademicStructure(): Promise<{
  years: AcademicYear[];
  classes: AcademicClass[];
  sections: AcademicSection[];
  subjects: AcademicSubject[];
}> {
  const [years, classes, sections, subjects] = await Promise.all([
    store.dispatch(academicApi.endpoints.getAcademicYears.initiate(undefined)).unwrap(),
    store.dispatch(academicApi.endpoints.getClasses.initiate(undefined)).unwrap(),
    store.dispatch(academicApi.endpoints.getSections.initiate(undefined)).unwrap(),
    store.dispatch(academicApi.endpoints.getSubjects.initiate(undefined)).unwrap(),
  ]);

  const sortedYears: AcademicYear[] = [...years].sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  const sortedClasses: AcademicClass[] = [...classes].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name, undefined, { numeric: true }));
  const sortedSections: AcademicSection[] = [...sections].sort((left, right) => left.classId - right.classId || left.name.localeCompare(right.name));
  const sortedSubjects: AcademicSubject[] = [...subjects].sort((left, right) => left.name.localeCompare(right.name));

  return { years: sortedYears, classes: sortedClasses, sections: sortedSections, subjects: sortedSubjects };
}
