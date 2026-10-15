import { baseApi } from './baseApi';

export interface HomeworkSubmission {
  student_id: string;
  student_name: string;
  admission_no?: string;
  status: 'Submitted' | 'Graded' | 'Pending';
  submitted_at: string;
  submission_text: string;
  marks_obtained?: number | null;
  teacher_feedback?: string;
}

export interface HomeworkRecord {
  id: number;
  schoolId?: number;
  title: string;
  description: string;
  status: 'Active' | 'Completed' | 'Archived';
  className: string;
  sectionName?: string;
  subjectName: string;
  classId?: number;
  sectionId?: number;
  subjectId?: number;
  dueDate: string;
  assignedDate?: string;
  maxMarks: number;
  teacherName?: string;
  attachmentName?: string;
  attachmentUrl?: string;
  submissions?: HomeworkSubmission[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateHomeworkPayload {
  title: string;
  description: string;
  className: string;
  sectionName?: string;
  subjectName: string;
  classId?: number;
  sectionId?: number;
  subjectId?: number;
  dueDate: string;
  maxMarks?: number;
  attachmentName?: string;
  attachmentUrl?: string;
  status?: 'Active' | 'Completed' | 'Archived';
}

export interface SubmitHomeworkPayload {
  homeworkId: number;
  studentId?: string;
  studentName?: string;
  admissionNo?: string;
  submissionText: string;
}

export interface GradeSubmissionPayload {
  homeworkId: number;
  studentId: string;
  marksObtained: number;
  teacherFeedback?: string;
}

export const homeworkApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHomework: build.query<
      HomeworkRecord[],
      { className?: string; sectionName?: string; subjectName?: string; status?: string } | void
    >({
      query: (params) => {
        const search = new URLSearchParams();
        if (params?.className && params.className !== 'All') search.append('class_name', params.className);
        if (params?.sectionName && params.sectionName !== 'All') search.append('section_name', params.sectionName);
        if (params?.subjectName && params.subjectName !== 'All') search.append('subject_name', params.subjectName);
        if (params?.status && params.status !== 'All') search.append('status', params.status);
        const q = search.toString();
        return `/homework/${q ? `?${q}` : ''}`;
      },
      transformResponse: (response: any) =>
        Array.isArray(response) ? response : response?.results || [],
      providesTags: (result) =>
        Array.isArray(result)
          ? [
              ...result.map(({ id }) => ({ type: 'Homework' as const, id })),
              { type: 'Homework', id: 'LIST' },
            ]
          : [{ type: 'Homework', id: 'LIST' }],
    }),

    createHomework: build.mutation<HomeworkRecord, CreateHomeworkPayload>({
      query: (body) => ({
        url: '/homework/',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Homework', id: 'LIST' }, 'Notification'],
    }),

    updateHomework: build.mutation<HomeworkRecord, { id: number; data: Partial<CreateHomeworkPayload> }>({
      query: ({ id, data }) => ({
        url: `/homework/${id}/`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [{ type: 'Homework', id }, { type: 'Homework', id: 'LIST' }],
    }),

    deleteHomework: build.mutation<void, number>({
      query: (id) => ({
        url: `/homework/${id}/`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'Homework', id: 'LIST' }],
    }),

    submitHomework: build.mutation<
      { message: string; homework: HomeworkRecord },
      SubmitHomeworkPayload
    >({
      query: ({ homeworkId, ...body }) => ({
        url: `/homework/${homeworkId}/submit/`,
        method: 'POST',
        body: {
          student_id: body.studentId,
          student_name: body.studentName,
          admission_no: body.admissionNo,
          submission_text: body.submissionText,
        },
      }),
      invalidatesTags: (_res, _err, { homeworkId }) => [{ type: 'Homework', id: homeworkId }],
    }),

    gradeSubmission: build.mutation<
      { message: string; homework: HomeworkRecord },
      GradeSubmissionPayload
    >({
      query: ({ homeworkId, studentId, marksObtained, teacherFeedback }) => ({
        url: `/homework/${homeworkId}/grade/`,
        method: 'POST',
        body: {
          student_id: studentId,
          marks_obtained: marksObtained,
          teacher_feedback: teacherFeedback,
        },
      }),
      invalidatesTags: (_res, _err, { homeworkId }) => [{ type: 'Homework', id: homeworkId }],
    }),
  }),
});

export const {
  useGetHomeworkQuery,
  useCreateHomeworkMutation,
  useUpdateHomeworkMutation,
  useDeleteHomeworkMutation,
  useSubmitHomeworkMutation,
  useGradeSubmissionMutation,
} = homeworkApi;
