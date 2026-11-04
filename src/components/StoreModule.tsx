import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Banknote,
  Building,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  Filter,
  GraduationCap,
  ImagePlus,
  Info,
  Layers,
  MapPin,
  Minus,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Ruler,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import type { AuthUser } from '../utils/auth';
import { emitNotification } from '../services/notificationBus';
import { exportStoreDataToExcel } from '../utils/storeExport';
import AuthenticatedImage from './AuthenticatedImage';
import StoreOrdersView from './StoreOrdersView';
import {
  useCompleteDemoStorePaymentMutation,
  useCreateStoreOrderMutation,
  useCreateStoreProductMutation,
  useGetStoreOrdersSummaryQuery,
  useLazyGetStoreOrdersForExportQuery,
  useGetStorePaymentSettingsQuery,
  useGetStoreProductsQuery,
  useRecordCashStorePaymentMutation,
  useUpdateStorePaymentSettingsMutation,
  useUpdateStoreProductMutation,
  useVerifyStorePaymentMutation,
  type StoreProduct,
} from '../store/api/storeApi';
import { useGetStudentsQuery } from '../store/api/studentApi';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const STORE_CATEGORIES = [
  { id: 'All', label: 'All Items' },
  { id: 'Uniforms', label: 'Uniforms' },
  { id: 'Books', label: 'Books' },
  { id: 'Academic Kits & Bundles', label: 'Academic Kits & Bundles' },
  { id: 'Stationery', label: 'Stationery' },
  { id: 'Sports', label: 'Sports' },
  { id: 'Merchandise', label: 'Merchandise & Supplies' },
  { id: 'Other', label: 'Other' },
];

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function productSaveErrorMessage(error: any): string {
  const data = error?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data === 'string' && data.trim()) return data.slice(0, 240);
  if (data && typeof data === 'object') {
    const messages = Object.entries(data)
      .flatMap(([field, value]) => {
        const detail = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
        return detail ? [`${field === 'imageFile' ? 'Photo' : field}: ${detail}`] : [];
      });
    if (messages.length) return messages.join(' ');
  }
  if (error?.status === 413) return 'The photo is too large for the server. Choose an image under 10 MB.';
  if (error?.status) return `The server rejected the product (HTTP ${error.status}). Check the photo format and product fields.`;
  return error?.message || 'Could not reach the server. Check your connection and try again.';
}

function getStoreItemTone(name: string, category = '') {
  const label = `${name} ${category}`.toLowerCase();
  if (label.includes('sock')) return { border: 'border-emerald-300', panel: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800', label: 'text-emerald-800' };
  if (label.includes('kit') || label.includes('bundle') || label.includes('set')) return { border: 'border-teal-300', panel: 'border-teal-200 bg-teal-50', badge: 'bg-teal-100 text-teal-800', label: 'text-teal-800' };
  if (label.includes('uniform')) return { border: 'border-violet-300', panel: 'border-violet-200 bg-violet-50', badge: 'bg-violet-100 text-violet-800', label: 'text-violet-800' };
  if (label.includes('book')) return { border: 'border-amber-300', panel: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-800', label: 'text-amber-800' };
  if (label.includes('stationery') || label.includes('pencil') || label.includes('pen')) return { border: 'border-sky-300', panel: 'border-sky-200 bg-sky-50', badge: 'bg-sky-100 text-sky-800', label: 'text-sky-800' };
  if (label.includes('sport')) return { border: 'border-rose-300', panel: 'border-rose-200 bg-rose-50', badge: 'bg-rose-100 text-rose-800', label: 'text-rose-800' };
  if (label.includes('merchandise') || label.includes('bag') || label.includes('bottle')) return { border: 'border-fuchsia-300', panel: 'border-fuchsia-200 bg-fuchsia-50', badge: 'bg-fuchsia-100 text-fuchsia-800', label: 'text-fuchsia-800' };
  if (label.includes('canteen') || label.includes('meal')) return { border: 'border-orange-300', panel: 'border-orange-200 bg-orange-50', badge: 'bg-orange-100 text-orange-800', label: 'text-orange-800' };
  if (label.includes('transport')) return { border: 'border-orange-300', panel: 'border-orange-200 bg-orange-50', badge: 'bg-orange-100 text-orange-800', label: 'text-orange-800' };
  return { border: 'border-indigo-300', panel: 'border-indigo-200 bg-indigo-50', badge: 'bg-indigo-100 text-indigo-800', label: 'text-indigo-800' };
}

function StoreProductImage({ src, alt, className, iconClassName = 'h-8 w-8' }: { src?: string; alt: string; className: string; iconClassName?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const markFailed = useCallback(() => setFailed(true), []);

  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden bg-slate-50 text-indigo-300 ${className}`}>
      {src && !failed ? (
        <AuthenticatedImage src={src} alt={alt} className="max-h-full max-w-full object-contain" onError={markFailed} />
      ) : (
        <Package className={iconClassName} />
      )}
    </div>
  );
}

export default function StoreModule({ user, schoolName }: { user: AuthUser; schoolName?: string }) {
  const isAdmin = user.role === 'School Admin';
  const canPurchase = user.role === 'Parent' || user.role === 'Student' || user.role === 'School Admin';
  const [activeView, setActiveView] = useState<'store' | 'inventory' | 'orders'>('store');
  const { data: products = [], isLoading } = useGetStoreProductsQuery(
    isAdmin ? undefined : { activeOnly: true },
    { pollingInterval: 10000, skipPollingIfUnfocused: true },
  );
  const { data: orderSummary } = useGetStoreOrdersSummaryQuery(undefined, { pollingInterval: 10000, skipPollingIfUnfocused: true });
  const [fetchOrdersForExport] = useLazyGetStoreOrdersForExportQuery();
  const { data: paymentSettings } = useGetStorePaymentSettingsQuery(undefined, { skip: !isAdmin });
  const [createProduct, { isLoading: creatingProduct }] = useCreateStoreProductMutation();
  const [updateProduct] = useUpdateStoreProductMutation();
  const [createOrder, { isLoading: creatingOrder }] = useCreateStoreOrderMutation();
  const [verifyPayment] = useVerifyStorePaymentMutation();
  const [completeDemoPayment] = useCompleteDemoStorePaymentMutation();
  const [recordCashPayment] = useRecordCashStorePaymentMutation();
  const [updatePaymentSettings, { isLoading: savingSettings }] = useUpdateStorePaymentSettingsMutation();

  // Student linked class detection for parents/students
  const { data: studentList = [] } = useGetStudentsQuery(undefined, { skip: isAdmin });
  const detectedChildGrade = useMemo(() => {
    if (isAdmin || !studentList.length) return null;
    const student = studentList[0];
    const rawClass = student.class || (student as any).class_ || (student as any).className || '';
    const match = rawClass.match(/\d+/);
    return match ? match[0] : null;
  }, [isAdmin, studentList]);

  // Storefront Filtering & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [gradeFilter, setGradeFilter] = useState('All');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);

  // Quick Restock State
  const [restockProduct, setRestockTarget] = useState<StoreProduct | null>(null);
  const [restockUnits, setRestockUnits] = useState('10');
  const [restocking, setRestocking] = useState(false);

  // Inventory Table Search & Filters
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryLowStockOnly, setInventoryLowStockOnly] = useState(false);

  const [cart, setCart] = useState<Record<number, number>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [productForm, setProductForm] = useState<{
    name: string;
    description: string;
    category: string;
    targetClasses: string[];
    uniformType: string;
    sizeLabel: string;
    sizeVariants: { sizeLabel: string; stockQuantity: string }[];
    price: string;
    stockQuantity: string;
    isActive: boolean;
    imageFile?: File;
  }>({
    name: '',
    description: '',
    category: 'Uniforms',
    targetClasses: [],
    uniformType: '',
    sizeLabel: '',
    sizeVariants: [{ sizeLabel: '', stockQuantity: '' }],
    price: '',
    stockQuantity: '',
    isActive: true,
  });
  const [imagePreview, setImagePreview] = useState('');

  // Checkout Form Details & Delivery Modes
  const [customerForm, setCustomerForm] = useState({
    name: user.name || '',
    phone: '',
    address: '',
  });
  const [pickupMode, setPickupMode] = useState<'counter' | 'classroom' | 'delivery'>('counter');
  const [classroomGrade, setClassroomGrade] = useState('');
  const [classroomRollNo, setClassroomRollNo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash'>('online');

  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [paymentKeyId, setPaymentKeyId] = useState('');
  const [paymentTestMode, setPaymentTestMode] = useState(true);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const paymentModeChanged = Boolean(paymentSettings && paymentTestMode !== paymentSettings.testMode);
  const needsPaymentKeySecret = !paymentSettings?.keySecretConfigured || paymentModeChanged;
  const needsWebhookSecret = paymentModeChanged || (paymentEnabled && !paymentSettings?.webhookSecretConfigured);

  useEffect(() => {
    if (paymentSettings) {
      setPaymentKeyId(paymentSettings.keyId || '');
      setPaymentTestMode(paymentSettings.testMode);
      setPaymentEnabled(paymentSettings.enabled);
    }
  }, [paymentSettings]);

  useEffect(() => {
    if (!checkoutOpen && !settingsOpen && !sizeGuideOpen && !restockProduct) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [checkoutOpen, settingsOpen, sizeGuideOpen, restockProduct]);

  useEffect(() => {
    if (!productForm.imageFile) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(productForm.imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [productForm.imageFile]);

  const cartItems = useMemo(
    () => products.filter((p) => cart[p.id]).map((product) => ({ product, quantity: cart[product.id] })),
    [products, cart],
  );
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const checkoutDetailsComplete = Boolean(
    customerForm.name.trim() &&
    customerForm.phone.replace(/\D/g, '').length >= 9 &&
    (pickupMode !== 'delivery' || customerForm.address.trim().length >= 5),
  );

  const setCartQuantity = (product: StoreProduct, quantity: number) => {
    setCart((current) => {
      const next = { ...current };
      const safeQuantity = Math.min(product.availableStock, Math.max(0, Math.floor(quantity)));
      if (safeQuantity === 0) delete next[product.id];
      else next[product.id] = safeQuantity;
      return next;
    });
  };

  const productGroups = useMemo(() => {
    const groups = new Map<string, StoreProduct[]>();
    products.forEach((product) => {
      const key = product.variantGroup || `product-${product.id}`;
      groups.set(key, [...(groups.get(key) || []), product]);
    });
    return [...groups.entries()].map(([key, groupVariants]) => {
      const imageUrl = groupVariants.find((variant) => variant.imageUrl)?.imageUrl;
      const variants = groupVariants
        .map((variant) => ({ ...variant, imageUrl: variant.imageUrl || imageUrl }))
        .sort((a, b) => a.sizeLabel.localeCompare(b.sizeLabel, undefined, { numeric: true }));
      return { key, variants, product: variants[0] };
    });
  }, [products]);

  // Filtered Product Groups for Storefront
  const filteredProductGroups = useMemo(() => {
    return productGroups.filter(({ product, variants }) => {
      if (inStockOnly && !variants.some((v) => v.availableStock > 0)) {
        return false;
      }
      if (categoryFilter !== 'All') {
        const cat = (product.category || 'Other').toLowerCase();
        const target = categoryFilter.toLowerCase();
        if (target === 'academic kits & bundles') {
          if (!cat.includes('kit') && !cat.includes('bundle') && !cat.includes('academic') && !product.name.toLowerCase().includes('kit')) {
            return false;
          }
        } else if (!cat.includes(target) && !product.name.toLowerCase().includes(target)) {
          return false;
        }
      }
      if (gradeFilter !== 'All') {
        if (product.targetClasses && product.targetClasses.length > 0) {
          if (!product.targetClasses.includes(gradeFilter)) {
            return false;
          }
        }
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = product.name.toLowerCase().includes(query);
        const matchesDesc = (product.description || '').toLowerCase().includes(query);
        const matchesSku = product.sku.toLowerCase().includes(query);
        const matchesCat = (product.category || '').toLowerCase().includes(query);
        const matchesUniform = (product.uniformType || '').toLowerCase().includes(query);
        if (!matchesName && !matchesDesc && !matchesSku && !matchesCat && !matchesUniform) {
          return false;
        }
      }
      return true;
    });
  }, [productGroups, inStockOnly, categoryFilter, gradeFilter, searchQuery]);

  // Inventory KPI statistics
  const inventoryStats = useMemo(() => {
    const totalItems = products.length;
    const totalUnits = products.reduce((sum, p) => sum + (p.stockQuantity || 0), 0);
    const totalValuation = products.reduce((sum, p) => sum + (Number(p.price) || 0) * (p.stockQuantity || 0), 0);
    const lowStockItems = products.filter((p) => p.availableStock <= 5 && p.availableStock > 0);
    const outOfStockItems = products.filter((p) => p.availableStock === 0);
    return {
      totalItems,
      totalUnits,
      totalValuation,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
    };
  }, [products]);

  // Filtered inventory rows
  const filteredInventoryProducts = useMemo(() => {
    return products.filter((p) => {
      if (inventoryLowStockOnly && p.availableStock > 5) return false;
      if (inventorySearch.trim()) {
        const query = inventorySearch.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesSku = p.sku.toLowerCase().includes(query);
        const matchesCat = (p.category || '').toLowerCase().includes(query);
        const matchesUniform = (p.uniformType || '').toLowerCase().includes(query);
        if (!matchesName && !matchesSku && !matchesCat && !matchesUniform) return false;
      }
      return true;
    });
  }, [products, inventoryLowStockOnly, inventorySearch]);

  const resetProductForm = () => {
    setEditingProduct(null);
    setProductForm({
      name: '',
      description: '',
      category: 'Uniforms',
      targetClasses: [],
      uniformType: '',
      sizeLabel: '',
      sizeVariants: [{ sizeLabel: '', stockQuantity: '' }],
      price: '',
      stockQuantity: '',
      isActive: true,
    });
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    const { imageFile, sizeVariants, sizeLabel, stockQuantity, ...formValues } = productForm;
    const body = {
      ...formValues,
      price: Number(productForm.price),
      ...(productForm.category === 'Uniforms' && !editingProduct
        ? { sizeVariants: sizeVariants.map((variant) => ({ sizeLabel: variant.sizeLabel.trim(), stockQuantity: Number(variant.stockQuantity) })) }
        : { ...(productForm.category === 'Uniforms' ? { sizeLabel } : {}), stockQuantity: Number(stockQuantity) }),
      ...(imageFile ? { imageFile } : {}),
    };
    try {
      if (editingProduct) await updateProduct({ id: editingProduct.id, body }).unwrap();
      else await createProduct(body).unwrap();
      emitNotification({
        title: editingProduct ? 'Product updated' : 'Stock added',
        message: `${productForm.name} is now available in the school store.`,
        tone: 'success',
        source: 'store',
      });
      resetProductForm();
    } catch (error: any) {
      emitNotification({
        title: 'Could not save product',
        message: productSaveErrorMessage(error),
        tone: 'danger',
        source: 'store',
      });
    }
  };

  const startEdit = (product: StoreProduct) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      description: product.description,
      category: product.category || 'Other',
      targetClasses: product.targetClasses || [],
      uniformType: product.uniformType || '',
      sizeLabel: product.sizeLabel || '',
      sizeVariants: [{ sizeLabel: product.sizeLabel || '', stockQuantity: String(product.stockQuantity) }],
      price: product.price,
      stockQuantity: String(product.stockQuantity),
      isActive: product.isActive,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExportToExcel = async () => {
    try {
      const orders = await fetchOrdersForExport({}).unwrap();
      exportStoreDataToExcel({
        schoolName,
        orders,
        products,
      });
      emitNotification({
        title: 'Store Data Exported',
        message: 'Complete store ledger, line items, and stock inventory exported to Excel (.xlsx).',
        tone: 'success',
        source: 'store',
      });
    } catch (error) {
      console.error('Failed to export store data:', error);
      emitNotification({
        title: 'Export Failed',
        message: 'Could not generate the Excel workbook. Please try again.',
        tone: 'danger',
        source: 'store',
      });
    }
  };

  const handleQuickRestockConfirm = async () => {
    if (!restockProduct) return;
    const added = parseInt(restockUnits, 10);
    if (isNaN(added) || added <= 0) return;
    setRestocking(true);
    try {
      const newStock = restockProduct.stockQuantity + added;
      await updateProduct({
        id: restockProduct.id,
        body: { stockQuantity: newStock },
      }).unwrap();
      emitNotification({
        title: 'Stock Updated',
        message: `Added +${added} units to "${restockProduct.name}". New total stock: ${newStock}.`,
        tone: 'success',
        source: 'store',
      });
      setRestockTarget(null);
      setRestockUnits('10');
    } catch (error: any) {
      emitNotification({
        title: 'Could not restock',
        message: productSaveErrorMessage(error),
        tone: 'danger',
        source: 'store',
      });
    } finally {
      setRestocking(false);
    }
  };

  const completeCheckout = async () => {
    if (!cartItems.length) return;
    try {
      // Build formatted delivery string based on pickupMode
      let formattedAddress = customerForm.address;
      if (pickupMode === 'counter') {
        formattedAddress = `[Campus Counter Pickup] Store Counter (Mon–Sat, 9 AM - 2 PM). Note: ${customerForm.address || 'Standard collection'}`;
      } else if (pickupMode === 'classroom') {
        formattedAddress = `[Classroom Handover] Student: ${customerForm.name} | Class: ${classroomGrade || 'Assigned Class'}${classroomRollNo ? ` | Roll: ${classroomRollNo}` : ''}. Note: ${customerForm.address || 'Handover in class'}`;
      } else {
        formattedAddress = `[Home Courier Delivery] Address: ${customerForm.address}`;
      }

      const order = await createOrder({
        items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        buyerName: customerForm.name,
        buyerPhone: customerForm.phone,
        deliveryAddress: formattedAddress,
      }).unwrap();

      // If School Admin chose cash payment at counter
      if (isAdmin && paymentMethod === 'cash') {
        await recordCashPayment(order.id).unwrap();
        emitNotification({
          title: 'Cash Order Recorded',
          message: `Order #${order.id} was marked Paid in Cash at the school counter.`,
          tone: 'success',
          source: 'store',
        });
        setCart({});
        setCheckoutOpen(false);
        return;
      }

      if (order.checkout.demoMode) {
        await completeDemoPayment(order.id).unwrap();
        emitNotification({
          title: 'Demo payment completed',
          message: `Order #${order.id} was paid using the local Razorpay test flow.`,
          tone: 'success',
          source: 'store',
        });
        setCart({});
        setCheckoutOpen(false);
        return;
      }

      const loaded = await loadRazorpay();
      if (!loaded || !window.Razorpay) throw new Error('Razorpay checkout could not be loaded.');
      const checkout = new window.Razorpay({
        key: order.checkout.keyId,
        amount: order.checkout.amount,
        currency: order.checkout.currency,
        name: schoolName || 'School Store',
        description: `School store order #${order.id}`,
        order_id: order.checkout.orderId,
        prefill: { name: customerForm.name, email: user.email, contact: customerForm.phone },
        handler: async (response: { razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await verifyPayment({ id: order.id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }).unwrap();
            emitNotification({ title: 'Payment successful', message: `Order #${order.id} has been confirmed.`, tone: 'success', source: 'store' });
            setCart({});
            setCheckoutOpen(false);
          } catch (error: any) {
            emitNotification({
              title: 'Payment confirmation pending',
              message: error?.data?.detail || `Payment was received, but order #${order.id} could not be confirmed yet. Refresh Orders before trying again.`,
              tone: 'danger',
              source: 'store',
            });
          }
        },
        modal: { ondismiss: () => emitNotification({ title: 'Payment cancelled', message: 'Your stock remains reserved for 15 minutes.', tone: 'info', source: 'store' }) },
      });
      checkout.open();
    } catch (error: any) {
      emitNotification({ title: 'Checkout failed', message: error?.data?.detail || error?.message || 'Unable to create the order.', tone: 'danger', source: 'store' });
    }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updatePaymentSettings({ keyId: paymentKeyId, ...(secret ? { keySecret: secret } : {}), ...(webhookSecret ? { webhookSecret } : {}), testMode: paymentTestMode, enabled: paymentEnabled }).unwrap();
      setSecret('');
      setWebhookSecret('');
      setSettingsOpen(false);
      emitNotification({ title: 'Payment settings saved', message: 'The Razorpay secret remains encrypted on the server.', tone: 'success', source: 'store' });
    } catch (error: any) {
      emitNotification({ title: 'Could not save settings', message: error?.data?.detail || 'Please check your Razorpay credentials.', tone: 'danger', source: 'store' });
    }
  };

  return (
    <section className="space-y-5 animate-fade-in" id="school-store-page">
      <header className="portal-header-card flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">{schoolName || 'School'} marketplace</p>
            <h1 className="text-2xl font-black text-slate-900">School Store</h1>
            <p className="text-sm font-medium text-slate-500">Uniforms, books, academic kits, and school supplies in one place.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setActiveView('inventory'); resetProductForm(); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add store item</span>
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={handleExportToExcel}
              title="Export complete store orders ledger, sales tally, and stock inventory to Excel (.xlsx)"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 shadow-xs transition hover:border-emerald-300 hover:bg-emerald-100 active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Export to Excel</span>
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
            >
              <Settings className="h-4 w-4 text-slate-500 shrink-0" />
              <span>Razorpay settings</span>
            </button>
          )}
          {canPurchase && (
            <button
              type="button"
              onClick={() => setCheckoutOpen(true)}
              disabled={!cartItems.length}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span>Cart ({cartItems.reduce((n, item) => n + item.quantity, 0)}) · ₹{cartTotal.toLocaleString('en-IN')}</span>
            </button>
          )}
        </div>
      </header>

      {/* Store Navigation Tabs */}
      <nav aria-label="Store sections" className="portal-card flex gap-2 p-2">
        <button
          type="button"
          aria-pressed={activeView === 'store'}
          onClick={() => setActiveView('store')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition cursor-pointer ${
            activeView === 'store' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShoppingBag className="h-4 w-4" />
          <span>Store items</span>
        </button>
        {isAdmin && (
          <button
            type="button"
            aria-pressed={activeView === 'inventory'}
            onClick={() => { setActiveView('inventory'); resetProductForm(); }}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition cursor-pointer ${
              activeView === 'inventory' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Package className="h-4 w-4" />
            <span>Stock inventory</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${activeView === 'inventory' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {products.length}
            </span>
            {inventoryStats.lowStockCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[9px] font-black text-white" title={`${inventoryStats.lowStockCount} items low on stock`}>
                !
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          aria-pressed={activeView === 'orders'}
          onClick={() => setActiveView('orders')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition cursor-pointer ${
            activeView === 'orders' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          <span>Orders</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${activeView === 'orders' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {orderSummary?.totalCount || 0}
          </span>
        </button>
      </nav>

      {/* ─────────────────────────────────────────────────────────────
          INVENTORY VIEW (Admin setup and stock control)
          ───────────────────────────────────────────────────────────── */}
      {activeView === 'inventory' && isAdmin && (
        <div className="space-y-5">
          {/* Inventory KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="portal-card p-4">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Catalog Items</span>
              <p className="mt-1 text-2xl font-black text-slate-900">{inventoryStats.totalItems}</p>
              <p className="mt-0.5 text-xs text-slate-500 font-medium">Distinct product records</p>
            </div>
            <div className="portal-card p-4">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Warehouse Units</span>
              <p className="mt-1 text-2xl font-black text-indigo-600">{inventoryStats.totalUnits}</p>
              <p className="mt-0.5 text-xs text-slate-500 font-medium">Total physical stock</p>
            </div>
            <div className="portal-card p-4">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Inventory Valuation</span>
              <p className="mt-1 text-2xl font-black text-emerald-600">₹{inventoryStats.totalValuation.toLocaleString('en-IN')}</p>
              <p className="mt-0.5 text-xs text-slate-500 font-medium">Total retail MRP worth</p>
            </div>
            <button
              type="button"
              onClick={() => setInventoryLowStockOnly(!inventoryLowStockOnly)}
              className={`portal-card p-4 text-left transition cursor-pointer border ${
                inventoryLowStockOnly
                  ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-300'
                  : 'hover:border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Low Stock Alert</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-1 text-2xl font-black text-amber-700">{inventoryStats.lowStockCount}</p>
              <p className="mt-0.5 text-xs font-bold text-amber-800">
                {inventoryLowStockOnly ? '✓ Filtering Low Stock' : '≤ 5 units (click to filter)'}
              </p>
            </button>
          </div>

          {/* Add / Edit Product Form */}
          <form onSubmit={saveProduct} className="portal-card space-y-5 p-5 md:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Inventory setup</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">{editingProduct ? 'Edit stock item' : 'Add stock item'}</h2>
                <p className="mt-1 text-xs text-slate-500">Set the item, category, target grades, price and physical units. Only school admins can manage inventory.</p>
              </div>
              {editingProduct && (
                <button type="button" onClick={resetProductForm} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 cursor-pointer">
                  Cancel edit
                </button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5 text-xs font-bold text-slate-600 sm:col-span-2">
                <span>Item name *</span>
                <input
                  required
                  placeholder="e.g. Daily School Uniform, NCERT Class 8 Kit, Sports Jersey"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                />
              </label>

              <label className="space-y-1.5 text-xs font-bold text-slate-600">
                <span>Category *</span>
                <select
                  value={productForm.category}
                  onChange={(e) => setProductForm({
                    ...productForm,
                    category: e.target.value,
                    uniformType: e.target.value === 'Uniforms' ? productForm.uniformType : '',
                    sizeLabel: e.target.value === 'Uniforms' ? productForm.sizeLabel : '',
                  })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold cursor-pointer"
                >
                  <option value="Uniforms">Uniforms</option>
                  <option value="Books">Books</option>
                  <option value="Academic Kits & Bundles">Academic Kits & Bundles</option>
                  <option value="Stationery">Stationery</option>
                  <option value="Sports">Sports</option>
                  <option value="Merchandise">Merchandise & Supplies</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              {!editingProduct && (
                <p className="self-center rounded-xl bg-indigo-50 px-3 py-3 text-xs font-semibold text-indigo-700">
                  Item codes (SKU) are generated automatically for each size and product.
                </p>
              )}

              {productForm.category === 'Uniforms' && (
                <>
                  <label className="space-y-1.5 text-xs font-bold text-slate-600 sm:col-span-2">
                    <span>Uniform type *</span>
                    <select
                      required
                      value={productForm.uniformType}
                      onChange={(e) => setProductForm({ ...productForm, uniformType: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold cursor-pointer"
                    >
                      <option value="">Choose uniform type</option>
                      <option value="Daily uniform">Daily uniform</option>
                      <option value="Sports uniform">Sports uniform</option>
                      <option value="Winter blazer / sweater">Winter blazer / sweater</option>
                      <option value="House T-shirt">House T-shirt</option>
                      <option value="Shoes">Shoes</option>
                      <option value="Socks">Socks</option>
                      <option value="Belt & Tie">Belt & Tie</option>
                      <option value="Lab coat / Apron">Lab coat / Apron</option>
                      <option value="Other uniform item">Other uniform item</option>
                    </select>
                  </label>
                  {editingProduct && (
                    <label className="space-y-1.5 text-xs font-bold text-slate-600">
                      <span>Size</span>
                      <input readOnly value={productForm.sizeLabel} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium" />
                    </label>
                  )}
                </>
              )}

              <label className="space-y-1.5 text-xs font-bold text-slate-600">
                <span>Price (₹) *</span>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Enter price in ₹"
                  value={productForm.price}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                />
              </label>

              {productForm.category !== 'Uniforms' && (
                <label className="space-y-1.5 text-xs font-bold text-slate-600">
                  <span>Stock quantity *</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Enter available units"
                    value={productForm.stockQuantity}
                    onChange={(e) => setProductForm({ ...productForm, stockQuantity: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                  />
                  <span className="block text-[10px] font-medium text-slate-400">Total physical pieces currently in stock</span>
                </label>
              )}
            </div>

            {/* Size Variants Table for Uniforms */}
            {productForm.category === 'Uniforms' && !editingProduct && (
              <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div>
                  <legend className="text-xs font-black text-slate-700">Sizes and stock *</legend>
                  <p className="mt-1 text-[11px] text-slate-500">Add each size once and enter how many pieces are physically available in that size.</p>
                </div>
                {productForm.sizeVariants.map((variant, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="text-xs font-bold text-slate-600">
                      Size
                      <input
                        required
                        maxLength={30}
                        placeholder="e.g. 26, 28, 30, 32, S, M, L"
                        value={variant.sizeLabel}
                        onChange={(event) => setProductForm({
                          ...productForm,
                          sizeVariants: productForm.sizeVariants.map((row, rowIndex) => rowIndex === index ? { ...row, sizeLabel: event.target.value } : row),
                        })}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium"
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-600">
                      Stock quantity
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={variant.stockQuantity}
                        onChange={(event) => setProductForm({
                          ...productForm,
                          sizeVariants: productForm.sizeVariants.map((row, rowIndex) => rowIndex === index ? { ...row, stockQuantity: event.target.value } : row),
                        })}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={productForm.sizeVariants.length <= 1}
                      onClick={() => setProductForm({ ...productForm, sizeVariants: productForm.sizeVariants.filter((_, rowIndex) => rowIndex !== index) })}
                      className="self-end rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={productForm.sizeVariants.length >= 20}
                  onClick={() => setProductForm({ ...productForm, sizeVariants: [...productForm.sizeVariants, { sizeLabel: '', stockQuantity: '' }] })}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black text-indigo-700 disabled:opacity-50 hover:bg-indigo-50 cursor-pointer"
                >
                  <Plus className="h-4 w-4" /> Add another size
                </button>
              </fieldset>
            )}

            {/* Target Grades (1 to 12) */}
            <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3">
                <legend className="text-xs font-black text-slate-700">Who can use this item? (Target Grades)</legend>
                <p className="mt-1 text-[11px] text-slate-500">Choose the grades it fits. Parents and students will see it prioritized when filtering by class.</p>
              </div>
              <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-indigo-700 shadow-2xs border border-indigo-100">
                <input
                  type="checkbox"
                  checked={productForm.targetClasses.length === 0}
                  onChange={() => setProductForm({ ...productForm, targetClasses: [] })}
                />
                All grades
              </label>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
                {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((grade) => (
                  <label
                    key={grade}
                    className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold transition select-none ${
                      productForm.targetClasses.includes(grade)
                        ? 'border-indigo-400 bg-indigo-100 text-indigo-900 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={productForm.targetClasses.includes(grade)}
                      onChange={(e) => setProductForm({
                        ...productForm,
                        targetClasses: e.target.checked
                          ? [...productForm.targetClasses, grade]
                          : productForm.targetClasses.filter((value) => value !== grade),
                      })}
                    />
                    Class {grade}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-600">
                  Product photo (optional)
                  <span className="ml-1 font-medium text-slate-400">JPEG, PNG or WebP, up to 10 MB</span>
                </label>
                <label className="flex min-h-11 max-w-md cursor-pointer items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                  <ImagePlus className="h-4 w-4 shrink-0" />
                  <span className="truncate">{productForm.imageFile ? productForm.imageFile.name : 'Choose a photo from this device'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                        emitNotification({ title: 'Unsupported photo format', message: 'Choose a JPEG, PNG, or WebP image.', tone: 'danger', source: 'store' });
                        e.target.value = '';
                        return;
                      }
                      if (file.size > 10 * 1024 * 1024) {
                        emitNotification({ title: 'Photo is too large', message: 'Choose an image smaller than 10 MB.', tone: 'danger', source: 'store' });
                        e.target.value = '';
                        return;
                      }
                      setProductForm({ ...productForm, imageFile: file });
                    }}
                  />
                </label>
                {(imagePreview || (editingProduct?.imageUrl && !productForm.imageFile)) && (
                  <StoreProductImage src={imagePreview || editingProduct?.imageUrl} alt="Product preview" className="h-20 w-20 rounded-xl border border-slate-200" iconClassName="h-6 w-6" />
                )}
              </div>

              <div className="flex gap-2">
                <label className="flex-1 space-y-1.5 text-xs font-bold text-slate-600 sm:w-64">
                  <span>Description (optional)</span>
                  <input
                    placeholder="Fabric, contents, package inclusions..."
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium"
                  />
                </label>
                <button
                  disabled={creatingProduct}
                  className="mt-auto inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  {editingProduct ? 'Save item' : 'Add to stock'}
                </button>
              </div>
            </div>
          </form>

          {/* Stock Overview Table */}
          <section className="portal-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">School stock</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Stock overview</h2>
                <p className="mt-1 text-xs text-slate-500">Available quantity subtracts active cart reservations. Click Quick Restock to increment stock instantly.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search Box */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search stock..."
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    className="h-9 w-44 rounded-xl border border-slate-200 bg-slate-50/70 pl-8 pr-3 text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleExportToExcel}
                  title="Export inventory stock, unit prices, and valuation ledger to Excel"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 shadow-2xs hover:bg-emerald-100 hover:border-emerald-300 transition cursor-pointer"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Export Stock</span>
                </button>

                <span className="h-9 inline-flex items-center rounded-full bg-slate-100 px-3 text-xs font-black text-slate-600">
                  {filteredInventoryProducts.length} {filteredInventoryProducts.length === 1 ? 'item' : 'items'}
                </span>
              </div>
            </div>

            {isLoading ? (
              <p className="p-8 text-center text-sm font-semibold text-slate-400">Loading inventory...</p>
            ) : filteredInventoryProducts.length === 0 ? (
              <p className="p-8 text-center text-sm font-semibold text-slate-400">
                {inventoryLowStockOnly ? 'No products currently low on stock (≤ 5 units).' : 'No stock matches your search.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-4 py-3">Category / type</th>
                      <th className="px-4 py-3">Target Grades</th>
                      <th className="px-4 py-3">Available</th>
                      <th className="px-4 py-3">In stock</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInventoryProducts.map((product) => {
                      const isLowStock = product.availableStock > 0 && product.availableStock <= 5;
                      const isSoldOut = product.availableStock === 0;

                      return (
                        <tr key={product.id} className="hover:bg-slate-50/70 transition">
                          <td className="px-5 py-4">
                            <p className={`font-black ${getStoreItemTone(product.name, product.category).label}`}>{product.name}</p>
                            <p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400">{product.description || '—'}</p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {product.category || 'Other'}
                            {product.uniformType ? ` · ${product.uniformType}` : ''}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {product.targetClasses?.length ? `Class ${product.targetClasses.join(', ')}` : 'All grades'}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${
                                isSoldOut
                                  ? 'bg-rose-100 text-rose-800'
                                  : isLowStock
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {isLowStock && <AlertTriangle className="h-3 w-3 text-amber-700" />}
                              {isSoldOut ? 'Sold out' : `${product.availableStock} available`}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-bold text-slate-700">{product.stockQuantity}</td>
                          <td className="px-4 py-4 font-bold text-slate-700">{product.sizeLabel || '—'}</td>
                          <td className="px-4 py-4 font-mono text-[11px] text-slate-500">{product.sku}</td>
                          <td className="px-4 py-4 font-bold text-slate-900">₹{Number(product.price).toLocaleString('en-IN')}</td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setRestockTarget(product);
                                  setRestockUnits('10');
                                }}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-bold text-[11px] text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                                title="Quickly add units to this item"
                              >
                                + Restock
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(product)}
                                className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 font-black text-[11px] text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                              >
                                Edit stock
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STORE VIEW (Browse items, filter, add to cart)
          ───────────────────────────────────────────────────────────── */}
      {activeView === 'store' && (
        <div className="space-y-4">
          {/* Search, Category, Grade & Size Guide Controls */}
          <div className="portal-card p-4 space-y-3.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Search Box */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search uniforms, book sets, academic kits, SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-9 py-2 text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Grade Selector + Size Guide + In Stock Toggle */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Grade / Class Filter */}
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-2xs">
                  <GraduationCap className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-slate-400 text-[11px]">Class:</span>
                  <select
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                    className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
                  >
                    <option value="All">All Grades</option>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((g) => (
                      <option key={g} value={g}>Class {g}</option>
                    ))}
                  </select>
                </div>

                {/* Size Guide Button */}
                <button
                  type="button"
                  onClick={() => setSizeGuideOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100 transition cursor-pointer"
                  title="View standard uniform measurement chart"
                >
                  <Ruler className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Size Guide</span>
                </button>

                {/* In-Stock Only Toggle */}
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs cursor-pointer select-none hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>In-Stock Only</span>
                </label>
              </div>
            </div>

            {/* Category Pills & Child Class Quick-Filter */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Category:
              </span>
              {STORE_CATEGORIES.map((cat) => {
                const isActive = categoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                      isActive ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}

              {/* Student Auto-Detect Quick Button for Parents */}
              {detectedChildGrade && (
                <button
                  type="button"
                  onClick={() => setGradeFilter(gradeFilter === detectedChildGrade ? 'All' : detectedChildGrade)}
                  className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer border ${
                    gradeFilter === detectedChildGrade
                      ? 'border-indigo-500 bg-indigo-100 text-indigo-900 shadow-2xs'
                      : 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'
                  }`}
                  title="Filter products specifically approved for your child's grade"
                >
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  <span>{gradeFilter === detectedChildGrade ? `Showing Class ${detectedChildGrade}` : `My Child (Class ${detectedChildGrade})`}</span>
                </button>
              )}

              {/* Reset Button */}
              {(searchQuery || categoryFilter !== 'All' || gradeFilter !== 'All' || inStockOnly) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('All');
                    setGradeFilter('All');
                    setInStockOnly(false);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 ml-auto cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>
          </div>

          {/* Product Cards Grid */}
          {isLoading ? (
            <div className="portal-card p-10 text-center text-sm font-semibold text-slate-400">Loading store items...</div>
          ) : filteredProductGroups.length === 0 ? (
            <div className="portal-card flex flex-col items-center gap-3 p-10 text-center">
              <Package className="h-10 w-10 text-indigo-300" />
              <p className="text-sm font-semibold text-slate-500">
                {productGroups.length === 0 ? 'No store items are available yet.' : 'No items match your active filters.'}
              </p>
              {productGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('All');
                    setGradeFilter('All');
                    setInStockOnly(false);
                  }}
                  className="rounded-xl bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                >
                  Clear all filters
                </button>
              )}
              {isAdmin && productGroups.length === 0 && (
                <button
                  type="button"
                  onClick={() => { setActiveView('inventory'); resetProductForm(); }}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 cursor-pointer"
                >
                  <Plus className="h-4 w-4" /> Add the first item
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProductGroups.map(({ key, product, variants }) => {
                const tone = getStoreItemTone(product.name, product.category);
                const selected = variants.find((variant) => variant.id === selectedVariants[key]) || variants.find((variant) => variant.availableStock > 0) || variants[0];
                const inCart = cart[selected.id] || 0;
                const remaining = Math.max(0, selected.availableStock - inCart);
                const quantity = quantities[key] || 1;
                const soldOut = selected.availableStock < 1 || remaining < 1;
                const isUniform = (product.category || '').toLowerCase().includes('uniform');

                return (
                  <article key={key} className={`portal-card overflow-hidden border-l-4 ${tone.border} ${!product.isActive ? 'opacity-60' : ''}`}>
                    <StoreProductImage src={product.imageUrl} alt={`${product.name} photo`} className="aspect-[4/3] w-full" iconClassName="h-10 w-10" />
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className={`text-lg font-black ${tone.label}`}>{product.name}</h3>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {product.sku}
                            {variants.length > 1 ? ` · ${variants.length} sizes` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 pt-1 text-sm font-black text-slate-900">
                          ₹{Number(product.price).toLocaleString('en-IN')}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone.badge}`}>{product.category || 'Other'}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                          {product.targetClasses?.length ? `Class ${product.targetClasses.join(', ')}` : 'All grades'}
                        </span>
                        {product.uniformType && (
                          <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">
                            {product.uniformType}
                            {selected.sizeLabel ? ` · Size ${selected.sizeLabel}` : ''}
                          </span>
                        )}
                      </div>

                      <p className="min-h-9 text-xs text-slate-500">{product.description || 'School-approved store item.'}</p>

                      {variants.length > 1 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-600">Select size</label>
                            {isUniform && (
                              <button
                                type="button"
                                onClick={() => setSizeGuideOpen(true)}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                              >
                                <Ruler className="h-3 w-3" /> Size Guide
                              </button>
                            )}
                          </div>
                          <select
                            value={selected.id}
                            onChange={(event) => setSelectedVariants({ ...selectedVariants, [key]: Number(event.target.value) })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold cursor-pointer"
                          >
                            {variants.map((variant) => (
                              <option key={variant.id} value={variant.id} disabled={!isAdmin && variant.availableStock < 1}>
                                Size {variant.sizeLabel || 'Standard'} — {variant.availableStock > 0 ? `${variant.availableStock} available` : 'Out of stock'}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-xs font-bold">
                        <span className={soldOut ? 'text-rose-600' : 'text-emerald-600'}>
                          {soldOut ? `Size ${selected.sizeLabel || 'item'} out of stock` : `${remaining} available`}
                        </span>
                        {canPurchase ? (
                          <div className="flex items-center gap-2">
                            <label className="sr-only" htmlFor={`qty-${key}`}>Quantity</label>
                            <input
                              id={`qty-${key}`}
                              type="number"
                              min="1"
                              max={remaining || 1}
                              value={quantity}
                              disabled={soldOut || !product.isActive}
                              onChange={(event) => setQuantities({ ...quantities, [key]: Math.min(remaining || 1, Math.max(1, Number(event.target.value) || 1)) })}
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-xs font-bold"
                            />
                            <button
                              type="button"
                              disabled={!product.isActive || soldOut || quantity > remaining}
                              onClick={() => setCart({ ...cart, [selected.id]: inCart + quantity })}
                              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 cursor-pointer transition"
                            >
                              {selected.availableStock < 1 ? 'Unavailable' : 'Add to cart'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          ORDERS VIEW (Summary, fulfillment, receipts)
          ───────────────────────────────────────────────────────────── */}
      {activeView === 'orders' && (
        <StoreOrdersView
          summary={orderSummary}
          isAdmin={isAdmin}
          schoolName={schoolName}
          user={user}
          onExportExcel={handleExportToExcel}
        />
      )}

      {/* Floating Cart Launcher Button */}
      {canPurchase && cartItems.length > 0 && !checkoutOpen && createPortal(
        <button
          type="button"
          onClick={() => setCheckoutOpen(true)}
          aria-label={`Open cart with ${cartItems.reduce((n, item) => n + item.quantity, 0)} items, total ₹${cartTotal.toLocaleString('en-IN')}`}
          className="fixed bottom-5 right-5 z-[90] inline-flex items-center gap-3 rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white shadow-xl ring-1 ring-white/30 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 cursor-pointer animate-bounce-subtle"
        >
          <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-white/15">
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[10px] font-black text-indigo-700">
              {cartItems.reduce((n, item) => n + item.quantity, 0)}
            </span>
          </span>
          <span>
            <span className="block text-xs font-bold text-indigo-100">View cart</span>
            <span className="block text-sm font-black">₹{cartTotal.toLocaleString('en-IN')}</span>
          </span>
        </button>,
        document.body,
      )}

      {/* ─────────────────────────────────────────────────────────────
          CHECKOUT MODAL (Pickup options & payment)
          ───────────────────────────────────────────────────────────── */}
      {checkoutOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-checkout-title"
            onSubmit={(e) => { e.preventDefault(); void completeCheckout(); }}
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-3xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 id="store-checkout-title" className="text-lg font-black text-slate-900">Complete store order</h2>
                <p className="text-xs text-slate-400">Select pickup mode and provide contact details</p>
              </div>
              <button type="button" aria-label="Close cart" onClick={() => setCheckoutOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Cart Items Summary */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800">Your items</h3>
                <span className="text-xs font-semibold text-slate-500">
                  {cartItems.reduce((n, item) => n + item.quantity, 0)} {cartItems.reduce((n, item) => n + item.quantity, 0) === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {cartItems.map(({ product, quantity }) => (
                  <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-2.5">
                    <StoreProductImage src={product.imageUrl} alt={`${product.name} photo`} className="h-12 w-12 rounded-xl text-indigo-400" iconClassName="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-slate-800">{product.name}</p>
                      <p className="text-xs text-slate-500">{product.sizeLabel ? `Size ${product.sizeLabel} · ` : ''}₹{Number(product.price).toLocaleString('en-IN')} each</p>
                      <p className="text-xs font-bold text-indigo-700">₹{(Number(product.price) * quantity).toLocaleString('en-IN')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => setCartQuantity(product, quantity - 1)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span aria-label={`Quantity ${quantity}`} className="w-5 text-center text-xs font-black text-slate-800">{quantity}</span>
                      <button type="button" aria-label={`Increase ${product.name} quantity`} disabled={quantity >= product.availableStock} onClick={() => setCartQuantity(product, quantity + 1)} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer">
                        <Plus className="h-3 w-3" />
                      </button>
                      <button type="button" aria-label={`Remove ${product.name} from cart`} onClick={() => setCartQuantity(product, 0)} className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total Banner */}
            <div className="rounded-2xl bg-indigo-50 p-3.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-indigo-900">Total payable:</span>
                <span className="text-lg font-black text-indigo-900">₹{cartTotal.toLocaleString('en-IN')}</span>
              </div>
              <p className="mt-1 text-[11px] text-indigo-700">Stock is reserved for 15 minutes while payment is completed.</p>
            </div>

            {/* Delivery / Pickup Method Selector */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-slate-600">
                Collection & Delivery Method *
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPickupMode('counter')}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition cursor-pointer ${
                    pickupMode === 'counter'
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-2xs ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Building className="h-5 w-5 text-indigo-600" />
                  <span className="text-xs font-black leading-tight">Campus Counter</span>
                  <span className="text-[10px] text-slate-400">School Office</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPickupMode('classroom')}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition cursor-pointer ${
                    pickupMode === 'classroom'
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-2xs ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <GraduationCap className="h-5 w-5 text-indigo-600" />
                  <span className="text-xs font-black leading-tight">Classroom</span>
                  <span className="text-[10px] text-slate-400">Hand to Student</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPickupMode('delivery')}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition cursor-pointer ${
                    pickupMode === 'delivery'
                      ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 shadow-2xs ring-2 ring-indigo-500/20'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Truck className="h-5 w-5 text-indigo-600" />
                  <span className="text-xs font-black leading-tight">Home Courier</span>
                  <span className="text-[10px] text-slate-400">Direct Delivery</span>
                </button>
              </div>

              {/* Mode-Specific Guidelines */}
              {pickupMode === 'counter' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 text-[11px] text-emerald-900 flex items-center gap-2">
                  <Building className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span><strong>Campus Pickup:</strong> Ready for collection next working day (Mon–Sat, 9 AM – 2 PM) at the admin desk.</span>
                </div>
              )}
              {pickupMode === 'classroom' && (
                <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-900">
                    <GraduationCap className="h-4 w-4 text-sky-600" />
                    <span>Classroom Handover Details:</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Student Grade (e.g. Class 8 - Sec A)"
                      value={classroomGrade}
                      onChange={(e) => setClassroomGrade(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none"
                    />
                    <input
                      placeholder="Roll Number (optional)"
                      value={classroomRollNo}
                      onChange={(e) => setClassroomRollNo(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Buyer Contact Information */}
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label htmlFor="store-buyer-name" className="text-xs font-bold text-slate-600">
                  Full name / Student name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="store-buyer-name"
                  required
                  maxLength={160}
                  autoComplete="name"
                  placeholder="Full name"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="store-buyer-phone" className="text-xs font-bold text-slate-600">
                  Phone number <span className="text-rose-600">*</span>
                </label>
                <input
                  id="store-buyer-phone"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  minLength={9}
                  maxLength={30}
                  pattern="\+?[0-9][0-9\s() -]{7,18}"
                  title="Enter a valid phone number with at least 9 digits."
                  placeholder="e.g. +91 98765 43210"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="store-pickup-note" className="text-xs font-bold text-slate-600">
                  {pickupMode === 'delivery' ? 'Home Delivery Address *' : 'Pickup / Collection note (optional)'}
                </label>
                <textarea
                  id="store-pickup-note"
                  required={pickupMode === 'delivery'}
                  placeholder={pickupMode === 'delivery' ? 'Street, house/flat #, landmark, city and pincode' : 'Any special request or person collecting on behalf'}
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  rows={2}
                />
              </div>
            </div>

            {/* School Admin Payment Method Toggle */}
            {isAdmin && (
              <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-600">Payment Collection Method (Admin)</label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition ${paymentMethod === 'online' ? 'border-indigo-500 bg-white text-indigo-950 shadow-2xs' : 'border-slate-200 bg-transparent text-slate-600'}`}>
                    <input type="radio" name="pay-method" checked={paymentMethod === 'online'} onChange={() => setPaymentMethod('online')} />
                    <span>Razorpay Online</span>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition ${paymentMethod === 'cash' ? 'border-emerald-500 bg-emerald-50 text-emerald-950 shadow-2xs' : 'border-slate-200 bg-transparent text-slate-600'}`}>
                    <input type="radio" name="pay-method" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} />
                    <span className="flex items-center gap-1"><Banknote className="h-3.5 w-3.5 text-emerald-600" /> Cash at Counter</span>
                  </label>
                </div>
              </div>
            )}

            <button
              disabled={creatingOrder || !cartItems.length || !checkoutDetailsComplete}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer transition shadow-sm"
            >
              {isAdmin && paymentMethod === 'cash' ? (
                <>
                  <Banknote className="h-4 w-4" />
                  <span>{creatingOrder ? 'Recording cash order...' : `Record Cash Payment (₹${cartTotal.toLocaleString('en-IN')})`}</span>
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" />
                  <span>{creatingOrder ? 'Starting checkout...' : `Pay ₹${cartTotal.toLocaleString('en-IN')} with Razorpay`}</span>
                </>
              )}
            </button>
          </form>
        </div>,
        document.body,
      )}

      {/* ─────────────────────────────────────────────────────────────
          QUICK RESTOCK MODAL FOR ADMINS
          ───────────────────────────────────────────────────────────── */}
      {restockProduct && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">Quick Stock Restock</h3>
                <p className="text-xs text-slate-500 truncate max-w-[240px]">{restockProduct.name}</p>
              </div>
              <button type="button" onClick={() => setRestockTarget(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-slate-50 p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 font-medium">Current in stock:</span>
                <span className="font-bold text-slate-900">{restockProduct.stockQuantity} units</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 font-medium">Currently available:</span>
                <span className="font-bold text-emerald-600">{restockProduct.availableStock} units</span>
              </div>
              <div className="flex justify-between text-xs border-t border-slate-200/80 pt-1">
                <span className="text-indigo-900 font-bold">New total will be:</span>
                <span className="font-black text-indigo-900">
                  {restockProduct.stockQuantity + (parseInt(restockUnits, 10) || 0)} units
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Units to Add *</label>
              <input
                type="number"
                min="1"
                step="1"
                value={restockUnits}
                onChange={(e) => setRestockUnits(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <div className="flex gap-1.5 pt-1">
                {['+5', '+10', '+25', '+50', '+100'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRestockUnits(preset.replace('+', ''))}
                    className="flex-1 rounded-lg border border-slate-200 bg-white py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestockTarget(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={restocking || !parseInt(restockUnits, 10) || parseInt(restockUnits, 10) <= 0}
                onClick={handleQuickRestockConfirm}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer transition shadow-2xs"
              >
                {restocking ? 'Updating...' : 'Confirm Restock'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ─────────────────────────────────────────────────────────────
          SIZE GUIDE MODAL
          ───────────────────────────────────────────────────────────── */}
      {sizeGuideOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl space-y-4 rounded-3xl bg-white p-5 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Ruler className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">School Uniform Size Chart</h3>
                  <p className="text-xs text-slate-500">Standard fit guide and body measurements for school apparel</p>
                </div>
              </div>
              <button type="button" onClick={() => setSizeGuideOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tops & Shirts Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700">Shirts, T-Shirts & Sweaters</h4>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Approx. Age</th>
                      <th className="px-3 py-2">Chest (Inches)</th>
                      <th className="px-3 py-2">Length (Inches)</th>
                      <th className="px-3 py-2">Height (cm)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 24</td><td className="px-3 py-2">3–4 Yrs</td><td className="px-3 py-2">24"</td><td className="px-3 py-2">17"</td><td className="px-3 py-2">95–105 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 26</td><td className="px-3 py-2">5–6 Yrs</td><td className="px-3 py-2">26"</td><td className="px-3 py-2">19"</td><td className="px-3 py-2">105–115 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 28</td><td className="px-3 py-2">7–8 Yrs</td><td className="px-3 py-2">28"</td><td className="px-3 py-2">21"</td><td className="px-3 py-2">115–125 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 30</td><td className="px-3 py-2">9–10 Yrs</td><td className="px-3 py-2">30"</td><td className="px-3 py-2">23"</td><td className="px-3 py-2">125–135 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 32</td><td className="px-3 py-2">11–12 Yrs</td><td className="px-3 py-2">32"</td><td className="px-3 py-2">25"</td><td className="px-3 py-2">135–145 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 34 (S)</td><td className="px-3 py-2">13–14 Yrs</td><td className="px-3 py-2">34"</td><td className="px-3 py-2">27"</td><td className="px-3 py-2">145–155 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 36 (M)</td><td className="px-3 py-2">15–16 Yrs</td><td className="px-3 py-2">36"</td><td className="px-3 py-2">28"</td><td className="px-3 py-2">155–165 cm</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 38 (L)</td><td className="px-3 py-2">17+ Yrs</td><td className="px-3 py-2">38"</td><td className="px-3 py-2">29"</td><td className="px-3 py-2">165–175 cm</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottoms & Pants Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700">Trousers, Shorts & Skirts</h4>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Waist (Inches)</th>
                      <th className="px-3 py-2">Shorts Length</th>
                      <th className="px-3 py-2">Trouser Length</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 24</td><td className="px-3 py-2">20–22"</td><td className="px-3 py-2">11"</td><td className="px-3 py-2">24"</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 26</td><td className="px-3 py-2">22–24"</td><td className="px-3 py-2">13"</td><td className="px-3 py-2">27"</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 28</td><td className="px-3 py-2">24–26"</td><td className="px-3 py-2">15"</td><td className="px-3 py-2">30"</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 30</td><td className="px-3 py-2">26–28"</td><td className="px-3 py-2">16"</td><td className="px-3 py-2">33"</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 32</td><td className="px-3 py-2">28–30"</td><td className="px-3 py-2">17"</td><td className="px-3 py-2">36"</td></tr>
                    <tr><td className="px-3 py-2 font-black text-indigo-950">Size 34</td><td className="px-3 py-2">30–32"</td><td className="px-3 py-2">18"</td><td className="px-3 py-2">38"</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Helpful measurement tips */}
            <div className="rounded-2xl bg-amber-50/80 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
              <p className="font-black text-amber-950 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-amber-700" />
                Measurement Tips for Parents:
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-900">
                <li><strong>Chest:</strong> Measure around the fullest part of the child's chest with arms relaxed at their side.</li>
                <li><strong>Waist:</strong> Measure around the natural waistline where school trousers or skirts sit.</li>
                <li><strong>Growth buffer:</strong> If your child is between sizes, select one size up to accommodate growing height over the school year.</li>
              </ul>
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setSizeGuideOpen(false)}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer"
              >
                Close Size Guide
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ─────────────────────────────────────────────────────────────
          RAZORPAY CREDENTIALS MODAL
          ───────────────────────────────────────────────────────────── */}
      {settingsOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-slate-950/55 p-4 backdrop-blur-sm">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="razorpay-settings-title"
            autoComplete="off"
            onSubmit={saveSettings}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-3 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="razorpay-settings-title" className="text-lg font-black text-slate-900">Razorpay settings</h2>
                <p className="mt-0.5 text-xs text-slate-500">Payment credentials are encrypted on the server.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close Razorpay settings" className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input required name="razorpay-key-id" autoComplete="off" aria-label="Razorpay Key ID" placeholder="Razorpay Key ID" value={paymentKeyId} onChange={(e) => setPaymentKeyId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input type="password" name="razorpay-key-secret" autoComplete="new-password" aria-label="Razorpay Key Secret" placeholder={paymentSettings?.keySecretConfigured && !paymentModeChanged ? 'Secret saved — enter a new one to rotate' : 'Razorpay Key Secret for selected mode'} value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input type="password" name="razorpay-webhook-secret" autoComplete="new-password" aria-label="Razorpay Webhook Secret" placeholder={paymentModeChanged ? 'Webhook secret for selected mode' : paymentSettings?.webhookSecretConfigured ? 'Webhook secret saved — enter a new one to rotate' : 'Razorpay Webhook Secret'} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer"><input type="checkbox" checked={paymentTestMode} onChange={(e) => setPaymentTestMode(e.target.checked)} /> Test mode</label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer"><input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)} /> Enable payments</label>
            </div>

            <p className="rounded-xl bg-indigo-50 p-3 text-[11px] leading-snug text-indigo-800">
              Test keys start with <strong>rzp_test_</strong>; live keys with <strong>rzp_live_</strong>. Test mode uses Razorpay's test gateway and does not charge real money. For real payments, switch off Test mode and save live credentials. Add this webhook URL in Razorpay and enter its secret above: <span className="break-all font-mono">https://your-domain/api/v1/store/razorpay/webhook/</span>
            </p>

            <button disabled={savingSettings || !paymentKeyId || (needsPaymentKeySecret && !secret) || (needsWebhookSecret && !webhookSecret)} className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
              {savingSettings ? 'Saving...' : 'Save credentials'}
            </button>
          </form>
        </div>,
        document.body,
      )}
    </section>
  );
}
