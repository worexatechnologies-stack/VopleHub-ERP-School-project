import { baseApi } from './baseApi';

export interface PublicLearnerItem {
  id: number;
  userId: number;
  name: string;
  email: string;
  plan: 'Monthly' | 'Quarterly' | 'Annual';
  status: 'Pending' | 'Active' | 'Expired' | 'Suspended';
  phone: string;
  paymentDate: string | null;
  expiryDate: string | null;
  notes: string;
  createdAt: string;
}

export interface PublicLearnerMe {
  id: number;
  name: string;
  email: string;
  phone: string;
  plan: PublicLearnerItem['plan'];
  status: 'Active';
  paymentDate: string | null;
  expiryDate: string | null;
}

export interface PublicLearnerPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: PublicLearnerItem[];
}

export const publicLearnerApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getPublicLearners: build.query<PublicLearnerPage, { page: number; page_size?: number; search?: string; plan?: string; status?: string }>({
      query: (params) => ({ url: '/public-learning/learners/', params }),
      providesTags: ['PublicLearners'],
    }),
    registerPublicLearner: build.mutation<{ detail: string; status: string }, { name: string; email: string; password: string; phone?: string; plan: string }>({
      query: (body) => ({ url: '/public-learning/register/', method: 'POST', body }),
    }),
    updatePublicLearnerStatus: build.mutation<{ id: number; status: string; expiryDate: string | null }, { id: number; action: 'activate' | 'suspend' }>({
      query: ({ id, action }) => ({ url: `/public-learning/learners/${id}/${action}/`, method: 'POST' }),
      invalidatesTags: ['PublicLearners'],
    }),
    migrateLegacyPublicLearners: build.mutation<{ created: number; already_imported: number }, { learners: unknown[] }>({
      query: (body) => ({ url: '/public-learning/learners/migrate-legacy/', method: 'POST', body }),
      invalidatesTags: ['PublicLearners'],
    }),
    getPublicLearnerMe: build.query<PublicLearnerMe, void>({
      query: () => '/public-learning/me/',
    }),
  }),
});

export const {
  useGetPublicLearnersQuery,
  useRegisterPublicLearnerMutation,
  useUpdatePublicLearnerStatusMutation,
  useMigrateLegacyPublicLearnersMutation,
  useGetPublicLearnerMeQuery,
} = publicLearnerApi;
