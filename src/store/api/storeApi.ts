import { baseApi } from './baseApi';

export interface StoreProduct {
  id: number;
  name: string;
  sku: string;
  variantGroup?: string | null;
  description: string;
  category: string;
  targetClasses: string[];
  uniformType: string;
  sizeLabel: string;
  imageUrl?: string;
  price: string;
  stockQuantity: number;
  availableStock: number;
  isActive: boolean;
}

export type StoreProductInput = Partial<Omit<StoreProduct, 'price' | 'stockQuantity'>> & {
  price?: string | number;
  stockQuantity?: number;
  imageFile?: File;
  targetClasses?: string[];
  sizeVariants?: { sizeLabel: string; stockQuantity: number }[];
};

function productRequestBody(body: StoreProductInput): StoreProductInput | FormData {
  if (!body.imageFile) return body;
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'imageFile') {
      form.append(key, key === 'targetClasses' || key === 'sizeVariants' ? JSON.stringify(value) : String(value));
    }
  });
  form.append('imageFile', body.imageFile);
  return form;
}

export interface StoreOrderItem {
  productId: number;
  productName: string;
  category?: string;
  uniformType?: string;
  unitPrice: string;
  quantity: number;
}

export interface StoreOrder {
  id: number;
  status: string;
  subtotal: string;
  currency: string;
  buyerName: string;
  buyerRole?: string;
  buyerEmail: string;
  buyerPhone: string;
  deliveryAddress: string;
  gatewayOrderId?: string;
  paymentId?: string;
  items: StoreOrderItem[];
  createdAt: string;
  paidAt?: string | null;
}

export interface StoreCheckoutOrder extends StoreOrder {
  checkout: {
    keyId: string;
    orderId: string;
    amount: number;
    currency: string;
    demoMode: boolean;
  };
}

export interface StorePaymentSettings {
  keyId: string;
  keySecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  testMode: boolean;
  enabled: boolean;
}

type Page<T> = { results?: T[] } | T[];
const unwrap = <T,>(payload: Page<T>): T[] => Array.isArray(payload) ? payload : payload.results || [];

export const storeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getStoreProducts: build.query<StoreProduct[], { activeOnly?: boolean } | void>({
      query: (params) => ({ url: '/store/products/', params: params?.activeOnly ? { active_only: 'true' } : undefined }),
      transformResponse: (response: Page<StoreProduct>) => unwrap(response),
      providesTags: ['StoreProduct'],
    }),
    createStoreProduct: build.mutation<StoreProduct, StoreProductInput>({
      query: (body) => ({ url: '/store/products/', method: 'POST', body: productRequestBody(body) }),
      invalidatesTags: ['StoreProduct'],
    }),
    updateStoreProduct: build.mutation<StoreProduct, { id: number; body: StoreProductInput }>({
      query: ({ id, body }) => ({ url: `/store/products/${id}/`, method: 'PATCH', body: productRequestBody(body) }),
      invalidatesTags: ['StoreProduct'],
    }),
    getStoreOrders: build.query<StoreOrder[], void>({
      query: () => '/store/orders/',
      transformResponse: (response: Page<StoreOrder>) => unwrap(response),
      providesTags: ['StoreOrder'],
    }),
    createStoreOrder: build.mutation<StoreCheckoutOrder, { items: { productId: number; quantity: number }[]; buyerName: string; buyerPhone: string; deliveryAddress?: string }>({
      query: (body) => ({ url: '/store/orders/', method: 'POST', body }),
      invalidatesTags: ['StoreProduct', 'StoreOrder'],
    }),
    verifyStorePayment: build.mutation<StoreOrder, { id: number; paymentId: string; signature: string }>({
      query: ({ id, paymentId, signature }) => ({ url: `/store/orders/${id}/verify-payment/`, method: 'POST', body: { paymentId, signature } }),
      invalidatesTags: ['StoreProduct', 'StoreOrder'],
    }),
    completeDemoStorePayment: build.mutation<StoreOrder, number>({
      query: (id) => ({ url: `/store/orders/${id}/demo-complete/`, method: 'POST' }),
      invalidatesTags: ['StoreProduct', 'StoreOrder'],
    }),
    fulfillStoreOrder: build.mutation<StoreOrder, number>({
      query: (id) => ({ url: `/store/orders/${id}/fulfill/`, method: 'POST' }),
      invalidatesTags: ['StoreOrder'],
    }),
    unfulfillStoreOrder: build.mutation<StoreOrder, number>({
      query: (id) => ({ url: `/store/orders/${id}/unfulfill/`, method: 'POST' }),
      invalidatesTags: ['StoreOrder'],
    }),
    getStorePaymentSettings: build.query<StorePaymentSettings, void>({
      query: () => '/store/payment-settings/',
      providesTags: ['StorePaymentSettings'],
    }),
    updateStorePaymentSettings: build.mutation<StorePaymentSettings, Partial<StorePaymentSettings> & { keySecret?: string; webhookSecret?: string }>({
      query: (body) => ({ url: '/store/payment-settings/', method: 'PUT', body }),
      invalidatesTags: ['StorePaymentSettings'],
    }),
  }),
});

export const {
  useGetStoreProductsQuery,
  useCreateStoreProductMutation,
  useUpdateStoreProductMutation,
  useGetStoreOrdersQuery,
  useCreateStoreOrderMutation,
  useVerifyStorePaymentMutation,
  useCompleteDemoStorePaymentMutation,
  useFulfillStoreOrderMutation,
  useUnfulfillStoreOrderMutation,
  useGetStorePaymentSettingsQuery,
  useUpdateStorePaymentSettingsMutation,
} = storeApi;
