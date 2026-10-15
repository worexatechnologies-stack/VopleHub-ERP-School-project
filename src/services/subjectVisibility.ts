import { store } from '../store';
import { academicApi, type SubjectVisibility } from '../store/api/academicApi';

export type { VisibleSubjectScope, VisibleSubject, SubjectVisibility } from '../store/api/academicApi';

export function loadVisibleSubjects(): Promise<SubjectVisibility> {
  return store.dispatch(academicApi.endpoints.getVisibleSubjects.initiate(undefined)).unwrap();
}
