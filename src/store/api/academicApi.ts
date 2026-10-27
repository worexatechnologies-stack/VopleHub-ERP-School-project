import { baseApi } from './baseApi';

export interface AcademicYearRecord {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  is_active: boolean;
  schoolId?: number;
}

export interface ClassRecord {
  id: number;
  name: string;
  code: string;
  sortOrder: number;
  subjectIds?: number[];
  subjects?: Array<number | { id?: number }>;
  classTeacherId?: number | null;
  classTeacherName?: string | null;
  classTeacherEmail?: string | null;
  schoolId?: number;
}

export interface SectionRecord {
  id: number;
  classId: number;
  name: string;
  classTeacherId?: number | null;
  classTeacherName?: string | null;
  classTeacherEmail?: string | null;
  schoolId?: number;
}

export interface SubjectRecord {
  id: number;
  name: string;
  schoolId?: number;
}

export interface VisibleSubjectScope {
  classId: number;
  className: string;
  sectionId: number;
  sectionName: string;
}

export interface VisibleSubject {
  id: number;
  name: string;
  scopes: VisibleSubjectScope[];
}

export interface SubjectVisibility {
  role: string;
  scopeKind: 'school_catalog' | 'teacher_assignment' | 'student_class' | 'linked_students_classes' | 'none';
  teacherId: number | null;
  subjects: VisibleSubject[];
  semantics: {
    assigned: string;
    scheduled: string;
  };
}

type Page<T> = { next?: string | null; results?: T[] } | T[];

async function fetchAllPages<T>(
  url: string,
  baseQuery: any
): Promise<{ data: T[] } | { error: any }> {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const sep = url.includes('?') ? '&' : '?';
    const result = await baseQuery(`${url}${sep}page=${page}`);
    if (result.error) return { error: result.error };
    const payload = result.data as Page<T>;
    if (Array.isArray(payload)) return { data: payload };
    rows.push(...(payload.results || []));
    if (!payload.next) return { data: rows };
  }
  return { data: rows };
}

export const academicApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getAcademicYears: build.query<AcademicYearRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<AcademicYearRecord>('/academic-years/', baseQuery),
      providesTags: ['AcademicYear'],
    }),
    createAcademicYear: build.mutation<AcademicYearRecord, { name: string; startsOn: string; endsOn: string; is_active: boolean }>({
      query: (body) => ({ url: '/academic-years/', method: 'POST', body }),
      invalidatesTags: ['AcademicYear'],
    }),
    updateAcademicYear: build.mutation<AcademicYearRecord, { id: number; name: string; startsOn: string; endsOn: string; is_active: boolean }>({
      query: ({ id, ...body }) => ({ url: `/academic-years/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['AcademicYear'],
    }),
    deleteAcademicYear: build.mutation<void, number>({
      query: (id) => ({ url: `/academic-years/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['AcademicYear'],
    }),
    getClasses: build.query<ClassRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<ClassRecord>('/classes/', baseQuery),
      providesTags: ['Class'],
    }),
    createClass: build.mutation<ClassRecord, { name: string; code: string; sortOrder: number; subjectIds: number[]; classTeacherId?: number | null }>({
      query: (body) => ({ url: '/classes/', method: 'POST', body }),
      invalidatesTags: ['Class'],
    }),
    updateClass: build.mutation<ClassRecord, { id: number; name?: string; code?: string; sortOrder?: number; subjectIds?: number[]; classTeacherId?: number | null }>({
      query: ({ id, ...body }) => ({ url: `/classes/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Class'],
    }),
    deleteClass: build.mutation<void, { id: number; cascade?: 'sections' }>({
      query: ({ id, cascade }) => ({
        url: `/classes/${id}/${cascade ? `?cascade=${cascade}` : ''}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Class', 'Section'],
    }),
    getSections: build.query<SectionRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<SectionRecord>('/sections/', baseQuery),
      providesTags: ['Section'],
    }),
    createSection: build.mutation<SectionRecord, { classId: number; name: string }>({
      query: (body) => ({ url: '/sections/', method: 'POST', body: { classId: body.classId, name: body.name } }),
      invalidatesTags: ['Section'],
    }),
    updateSection: build.mutation<SectionRecord, { id: number; classId: number; name: string }>({
      query: ({ id, ...body }) => ({ url: `/sections/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['Section'],
    }),
    deleteSection: build.mutation<void, number>({
      query: (id) => ({ url: `/sections/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Section'],
    }),
    getSubjects: build.query<SubjectRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<SubjectRecord>('/subjects/', baseQuery),
      providesTags: ['Subject'],
    }),
    createSubject: build.mutation<SubjectRecord, { name: string }>({
      query: (body) => ({ url: '/subjects/', method: 'POST', body }),
      invalidatesTags: ['Subject'],
    }),
    updateSubject: build.mutation<SubjectRecord, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/subjects/${id}/`, method: 'PATCH', body: { name } }),
      invalidatesTags: ['Subject'],
    }),
    deleteSubject: build.mutation<void, number>({
      query: (id) => ({ url: `/subjects/${id}/`, method: 'DELETE' }),
      invalidatesTags: ['Subject'],
    }),
    getVisibleSubjects: build.query<SubjectVisibility, void>({
      query: () => ({ url: '/subjects/visible/' }),
      providesTags: ['Subject'],
    }),
  }),
});

export const {
  useGetAcademicYearsQuery,
  useCreateAcademicYearMutation,
  useUpdateAcademicYearMutation,
  useDeleteAcademicYearMutation,
  useGetClassesQuery,
  useCreateClassMutation,
  useUpdateClassMutation,
  useDeleteClassMutation,
  useGetSectionsQuery,
  useCreateSectionMutation,
  useUpdateSectionMutation,
  useDeleteSectionMutation,
  useGetSubjectsQuery,
  useCreateSubjectMutation,
  useUpdateSubjectMutation,
  useDeleteSubjectMutation,
  useGetVisibleSubjectsQuery,
} = academicApi;