import { baseApi } from './baseApi';

export interface SchoolRecord {
  id: number;
  schoolName: string;
  code: string;
  subdomain?: string;
  logoIcon?: string;
  logoImageUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  is_active?: boolean;
  isDemo?: boolean;
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

export const schoolApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getSchools: build.query<SchoolRecord[], void>({
      queryFn: (_arg, _api, _extra, baseQuery) => fetchAllPages<SchoolRecord>('/schools/', baseQuery),
      providesTags: ['School'],
    }),
    createSchool: build.mutation<SchoolRecord, FormData>({
      query: (body) => ({ url: '/schools/', method: 'POST', body }),
      invalidatesTags: ['School'],
    }),
    updateSchool: build.mutation<SchoolRecord, { id: number; body: FormData | Partial<SchoolRecord> | Record<string, unknown> }>({
      query: ({ id, body }) => ({ url: `/schools/${id}/`, method: 'PATCH', body }),
      invalidatesTags: ['School'],
    }),
    deleteSchool: build.mutation<{ detail: string }, { id: number; confirmation: string }>({
      query: ({ id, confirmation }) => ({
        url: `/schools/${id}/`,
        method: 'DELETE',
        body: { confirmation },
      }),
      invalidatesTags: ['School'],
    }),
  }),
});

export const {
  useGetSchoolsQuery,
  useCreateSchoolMutation,
  useUpdateSchoolMutation,
  useDeleteSchoolMutation,
} = schoolApi;
