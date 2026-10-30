import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, CreditCard, FileSpreadsheet, ImagePlus, MapPin, Minus, Package, Phone, Plus, Settings, ShoppingBag, ShoppingCart, Trash2, UserRound, Wallet, X } from 'lucide-react';
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
  useUpdateStorePaymentSettingsMutation,
  useUpdateStoreProductMutation,
  useVerifyStorePaymentMutation,
  type StoreProduct,
} from '../store/api/storeApi';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

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
  if (label.includes('uniform')) return { border: 'border-violet-300', panel: 'border-violet-200 bg-violet-50', badge: 'bg-violet-100 text-violet-800', label: 'text-violet-800' };
  if (label.includes('book')) return { border: 'border-amber-300', panel: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-800', label: 'text-amber-800' };
  if (label.includes('stationery') || label.includes('pencil') || label.includes('pen')) return { border: 'border-sky-300', panel: 'border-sky-200 bg-sky-50', badge: 'bg-sky-100 text-sky-800', label: 'text-sky-800' };
  if (label.includes('sport')) return { border: 'border-rose-300', panel: 'border-rose-200 bg-rose-50', badge: 'bg-rose-100 text-rose-800', label: 'text-rose-800' };
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
  const canPurchase = user.role === 'Parent' || user.role === 'Student';
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
  const [updatePaymentSettings, { isLoading: savingSettings }] = useUpdateStorePaymentSettingsMutation();
  const [cart, setCart] = useState<Record<number, number>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [productForm, setProductForm] = useState<{ name: string; description: string; category: string; targetClasses: string[]; uniformType: string; sizeLabel: string; sizeVariants: { sizeLabel: string; stockQuantity: string }[]; price: string; stockQuantity: string; isActive: boolean; imageFile?: File }>({ name: '', description: '', category: 'Uniforms', targetClasses: [], uniformType: '', sizeLabel: '', sizeVariants: [{ sizeLabel: '', stockQuantity: '' }], price: '', stockQuantity: '', isActive: true });
  const [imagePreview, setImagePreview] = useState('');
  const [customerForm, setCustomerForm] = useState({ name: user.name || '', phone: '', address: '' });
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
    if (!checkoutOpen && !settingsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [checkoutOpen, settingsOpen]);

  useEffect(() => {
    if (!productForm.imageFile) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(productForm.imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [productForm.imageFile]);

  const cartItems = useMemo(() => products.filter((p) => cart[p.id]).map((product) => ({ product, quantity: cart[product.id] })), [products, cart]);
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const checkoutDetailsComplete = Boolean(customerForm.name.trim() && customerForm.phone.replace(/\D/g, '').length >= 9);
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

  const resetProductForm = () => {
    setEditingProduct(null);
    setProductForm({ name: '', description: '', category: 'Uniforms', targetClasses: [], uniformType: '', sizeLabel: '', sizeVariants: [{ sizeLabel: '', stockQuantity: '' }], price: '', stockQuantity: '', isActive: true });
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
      emitNotification({ title: editingProduct ? 'Product updated' : 'Stock added', message: `${productForm.name} is now available in the school store.`, tone: 'success', source: 'store' });
      resetProductForm();
    } catch (error: any) {
      emitNotification({ title: 'Could not save product', message: productSaveErrorMessage(error), tone: 'danger', source: 'store' });
    }
  };

  const startEdit = (product: StoreProduct) => {
    setEditingProduct(product);
    setProductForm({ name: product.name, description: product.description, category: product.category || 'Other', targetClasses: product.targetClasses || [], uniformType: product.uniformType || '', sizeLabel: product.sizeLabel || '', sizeVariants: [{ sizeLabel: product.sizeLabel || '', stockQuantity: String(product.stockQuantity) }], price: product.price, stockQuantity: String(product.stockQuantity), isActive: product.isActive });
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

  const completeCheckout = async () => {
    if (!cartItems.length) return;
    try {
      const order = await createOrder({
        items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        buyerName: customerForm.name,
        buyerPhone: customerForm.phone,
        deliveryAddress: customerForm.address,
      }).unwrap();
      if (order.checkout.demoMode) {
        await completeDemoPayment(order.id).unwrap();
        emitNotification({ title: 'Demo payment completed', message: `Order #${order.id} was paid using the local Razorpay test flow.`, tone: 'success', source: 'store' });
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
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg"><ShoppingBag className="h-6 w-6" /></div>
          <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">{schoolName || 'School'} marketplace</p><h1 className="text-2xl font-black text-slate-900">School Store</h1><p className="text-sm font-medium text-slate-500">Uniforms, books, transport items, and school supplies in one place.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setActiveView('inventory'); resetProductForm(); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700"
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
          {canPurchase && <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            disabled={!cartItems.length}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <ShoppingCart className="h-4 w-4 shrink-0" />
            <span>Cart ({cartItems.reduce((n, item) => n + item.quantity, 0)}) · ₹{cartTotal.toLocaleString('en-IN')}</span>
          </button>}
        </div>
      </header>

      <nav aria-label="Store sections" className="portal-card flex gap-2 p-2">
        <button type="button" aria-pressed={activeView === 'store'} onClick={() => setActiveView('store')} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${activeView === 'store' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><ShoppingBag className="h-4 w-4" /> Store items</button>
        {isAdmin && <button type="button" aria-pressed={activeView === 'inventory'} onClick={() => { setActiveView('inventory'); resetProductForm(); }} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${activeView === 'inventory' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><Package className="h-4 w-4" /> Stock inventory <span className={`rounded-full px-2 py-0.5 text-[10px] ${activeView === 'inventory' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{products.length}</span></button>}
        <button type="button" aria-pressed={activeView === 'orders'} onClick={() => setActiveView('orders')} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${activeView === 'orders' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><ClipboardList className="h-4 w-4" /> Orders <span className={`rounded-full px-2 py-0.5 text-[10px] ${activeView === 'orders' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>{orderSummary?.totalCount || 0}</span></button>
      </nav>

      {activeView === 'inventory' && isAdmin && (
        <form onSubmit={saveProduct} className="portal-card space-y-5 p-5 md:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Inventory setup</p><h2 className="mt-1 text-lg font-black text-slate-900">{editingProduct ? 'Edit stock item' : 'Add stock item'}</h2><p className="mt-1 text-xs text-slate-500">Set the item, who it is for, price and quantity. Only this school’s admin can manage stock.</p></div>{editingProduct && <button type="button" onClick={resetProductForm} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Cancel edit</button>}</div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5 text-xs font-bold text-slate-600 sm:col-span-2"><span>Item name *</span><input required placeholder="e.g. Daily school uniform" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium" /></label>
            <label className="space-y-1.5 text-xs font-bold text-slate-600"><span>Category *</span><select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value, uniformType: e.target.value === 'Uniforms' ? productForm.uniformType : '', sizeLabel: e.target.value === 'Uniforms' ? productForm.sizeLabel : '' })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold"><option>Uniforms</option><option>Books</option><option>Stationery</option><option>Sports</option><option>Other</option></select></label>
            {!editingProduct && <p className="self-center rounded-xl bg-indigo-50 px-3 py-3 text-xs font-semibold text-indigo-700">Item codes are generated automatically for each size.</p>}
            {productForm.category === 'Uniforms' && <>
              <label className="space-y-1.5 text-xs font-bold text-slate-600 sm:col-span-2"><span>Uniform type *</span><select required value={productForm.uniformType} onChange={(e) => setProductForm({ ...productForm, uniformType: e.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold"><option value="">Choose uniform type</option><option>Daily uniform</option><option>Sports uniform</option><option>Winter uniform</option><option>House T-shirt</option><option>Socks</option><option>Belt</option><option>Tie</option><option>Shoes</option><option>Other uniform item</option></select></label>
              {editingProduct && <label className="space-y-1.5 text-xs font-bold text-slate-600"><span>Size</span><input readOnly value={productForm.sizeLabel} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium" /></label>}
            </>}
            <label className="space-y-1.5 text-xs font-bold text-slate-600"><span>Price (₹) *</span><input required type="number" min="0.01" step="0.01" placeholder="Enter price" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium" /></label>
            {productForm.category !== 'Uniforms' && <label className="space-y-1.5 text-xs font-bold text-slate-600"><span>Stock quantity *</span><input required type="number" min="0" step="1" placeholder="Enter available units" value={productForm.stockQuantity} onChange={(e) => setProductForm({ ...productForm, stockQuantity: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium" /><span className="block text-[10px] font-medium text-slate-400">How many pieces are physically in stock?</span></label>}
          </div>

          {productForm.category === 'Uniforms' && !editingProduct && <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><div><legend className="text-xs font-black text-slate-700">Sizes and stock *</legend><p className="mt-1 text-[11px] text-slate-500">Add each size once and enter how many pieces are available in that size.</p></div>{productForm.sizeVariants.map((variant, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-bold text-slate-600">Size<input required maxLength={30} placeholder="e.g. 28, 32, S, M" value={variant.sizeLabel} onChange={(event) => setProductForm({ ...productForm, sizeVariants: productForm.sizeVariants.map((row, rowIndex) => rowIndex === index ? { ...row, sizeLabel: event.target.value } : row) })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium" /></label><label className="text-xs font-bold text-slate-600">Stock quantity<input required type="number" min="0" step="1" placeholder="0" value={variant.stockQuantity} onChange={(event) => setProductForm({ ...productForm, sizeVariants: productForm.sizeVariants.map((row, rowIndex) => rowIndex === index ? { ...row, stockQuantity: event.target.value } : row) })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium" /></label><button type="button" disabled={productForm.sizeVariants.length <= 1} onClick={() => setProductForm({ ...productForm, sizeVariants: productForm.sizeVariants.filter((_, rowIndex) => rowIndex !== index) })} className="self-end rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 disabled:opacity-40">Remove</button></div>)}<button type="button" disabled={productForm.sizeVariants.length >= 20} onClick={() => setProductForm({ ...productForm, sizeVariants: [...productForm.sizeVariants, { sizeLabel: '', stockQuantity: '' }] })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black text-indigo-700 disabled:opacity-50"><Plus className="h-4 w-4" /> Add another size</button></fieldset>}

          <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3"><legend className="text-xs font-black text-slate-700">Who can use this item?</legend><p className="mt-1 text-[11px] text-slate-500">Choose the grades it fits. This is especially useful for class-specific uniforms and books.</p></div>
            <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-indigo-700 shadow-sm"><input type="checkbox" checked={productForm.targetClasses.length === 0} onChange={() => setProductForm({ ...productForm, targetClasses: [] })} /> All grades</label>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">{Array.from({ length: 10 }, (_, index) => String(index + 1)).map((grade) => <label key={grade} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-bold ${productForm.targetClasses.includes(grade) ? 'border-indigo-300 bg-indigo-100 text-indigo-800' : 'border-slate-200 bg-white text-slate-600'}`}><input type="checkbox" checked={productForm.targetClasses.includes(grade)} onChange={(e) => setProductForm({ ...productForm, targetClasses: e.target.checked ? [...productForm.targetClasses, grade] : productForm.targetClasses.filter((value) => value !== grade) })} />{grade}</label>)}</div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-2"><label className="block text-xs font-bold text-slate-600">Product photo (optional)<span className="ml-1 font-medium text-slate-400">JPEG, PNG or WebP, up to 10 MB</span></label><label className="flex min-h-11 max-w-md cursor-pointer items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700"><ImagePlus className="h-4 w-4 shrink-0" /><span className="truncate">{productForm.imageFile ? productForm.imageFile.name : 'Choose a photo from this device'}</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => {
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
            }} /></label>{(imagePreview || (editingProduct?.imageUrl && !productForm.imageFile)) && <StoreProductImage src={imagePreview || editingProduct?.imageUrl} alt="Product preview" className="h-20 w-20 rounded-xl border border-slate-200" iconClassName="h-6 w-6" />}</div>
            <div className="flex gap-2"><label className="flex-1 space-y-1.5 text-xs font-bold text-slate-600 sm:w-64"><span>Description (optional)</span><input placeholder="Fabric, included items, notes..." value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium" /></label><button disabled={creatingProduct} className="mt-auto inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"><Plus className="h-4 w-4" /> {editingProduct ? 'Save item' : 'Add to stock'}</button></div>
          </div>
        </form>
      )}

      {activeView === 'inventory' && isAdmin && <section className="portal-card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">School stock</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Stock overview</h2>
            <p className="mt-1 text-xs text-slate-500">Available quantity subtracts pending reservations. Physical stock updates after payment is confirmed.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportToExcel}
              title="Export inventory stock, unit prices, and valuation ledger to Excel"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-100 hover:border-emerald-300 transition cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export Stock</span>
            </button>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">{products.length} stock {products.length === 1 ? 'record' : 'records'}</span>
          </div>
        </div>
        {isLoading ? <p className="p-8 text-center text-sm font-semibold text-slate-400">Loading inventory...</p> : products.length === 0 ? <p className="p-8 text-center text-sm font-semibold text-slate-400">No stock has been added yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Item</th><th className="px-4 py-3">Category / type</th><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Available</th><th className="px-4 py-3">In stock</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Price</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{products.map((product) => <tr key={product.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><p className={`font-black ${getStoreItemTone(product.name, product.category).label}`}>{product.name}</p><p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400">{product.description || '—'}</p></td><td className="px-4 py-4 text-slate-600">{product.category || 'Other'}{product.uniformType ? ` · ${product.uniformType}` : ''}</td><td className="px-4 py-4 text-slate-600">{product.targetClasses?.length ? product.targetClasses.join(', ') : 'All grades'}</td><td className="px-4 py-4"><span className={`rounded-full px-3 py-1.5 font-black ${product.availableStock ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{product.availableStock ? product.availableStock : 'Sold out'}</span></td><td className="px-4 py-4 font-bold text-slate-700">{product.stockQuantity}</td><td className="px-4 py-4 font-bold text-slate-700">{product.sizeLabel || '—'}</td><td className="px-4 py-4 font-mono text-[11px] text-slate-500">{product.sku}</td><td className="px-4 py-4 text-slate-400">₹{Number(product.price).toLocaleString('en-IN')}</td><td className="px-5 py-4 text-right"><button type="button" onClick={() => startEdit(product)} className="rounded-lg border border-indigo-100 px-3 py-2 font-black text-indigo-700 hover:bg-indigo-50">Edit stock</button></td></tr>)}</tbody></table></div>}
      </section>}

      {activeView === 'store' && <div>
          {isLoading ? <div className="portal-card p-10 text-center text-sm font-semibold text-slate-400">Loading store items...</div> : productGroups.length === 0 ? <div className="portal-card flex flex-col items-center gap-3 p-10 text-center"><Package className="h-10 w-10 text-indigo-300" /><p className="text-sm font-semibold text-slate-500">No store items are available yet.</p>{isAdmin && <button type="button" onClick={() => { setActiveView('inventory'); resetProductForm(); }} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700"><Plus className="h-4 w-4" />Add the first item</button>}</div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{productGroups.map(({ key, product, variants }) => {
            const tone = getStoreItemTone(product.name, product.category);
            const selected = variants.find((variant) => variant.id === selectedVariants[key]) || variants.find((variant) => variant.availableStock > 0) || variants[0];
            const inCart = cart[selected.id] || 0;
            const remaining = Math.max(0, selected.availableStock - inCart);
            const quantity = quantities[key] || 1;
            const soldOut = selected.availableStock < 1 || remaining < 1;
            return <article key={key} className={`portal-card overflow-hidden border-l-4 ${tone.border} ${!product.isActive ? 'opacity-60' : ''}`}>
              <StoreProductImage src={product.imageUrl} alt={`${product.name} photo`} className="aspect-[4/3] w-full" iconClassName="h-10 w-10" />
              <div className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><div><h3 className={`text-lg font-black ${tone.label}`}>{product.name}</h3><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{product.sku}{variants.length > 1 ? ` · ${variants.length} sizes` : ''}</p></div><span className="shrink-0 pt-1 text-xs font-semibold text-slate-400">₹{Number(product.price).toLocaleString('en-IN')}</span></div>
                <div className="flex flex-wrap gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone.badge}`}>{product.category || 'Other'}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{product.targetClasses?.length ? `Class ${product.targetClasses.join(', ')}` : 'All grades'}</span>{product.uniformType && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{product.uniformType} · Size {selected.sizeLabel || 'Standard'}</span>}</div>
                <p className="min-h-9 text-xs text-slate-500">{product.description || 'School-approved store item.'}</p>
                {variants.length > 1 && <label className="block space-y-1 text-xs font-bold text-slate-600">Select size<select value={selected.id} onChange={(event) => setSelectedVariants({ ...selectedVariants, [key]: Number(event.target.value) })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold">{variants.map((variant) => <option key={variant.id} value={variant.id} disabled={!isAdmin && variant.availableStock < 1}>Size {variant.sizeLabel || 'Standard'} — {variant.availableStock > 0 ? `${variant.availableStock} available` : 'Out of stock'}</option>)}</select></label>}
                <div className="flex items-center justify-between gap-2 text-xs font-bold"><span className={soldOut ? 'text-rose-600' : 'text-emerald-600'}>{soldOut ? `Size ${selected.sizeLabel || 'item'} out of stock` : `${remaining} available`}</span>{isAdmin ? <button type="button" onClick={() => setActiveView('inventory')} className="text-indigo-600 hover:text-indigo-800">Manage stock inventory</button> : canPurchase ? <div className="flex items-center gap-2"><label className="sr-only" htmlFor={`qty-${key}`}>Quantity</label><input id={`qty-${key}`} type="number" min="1" max={remaining || 1} value={quantity} disabled={soldOut || !product.isActive} onChange={(event) => setQuantities({ ...quantities, [key]: Math.min(remaining || 1, Math.max(1, Number(event.target.value) || 1)) })} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center" /><button type="button" disabled={!product.isActive || soldOut || quantity > remaining} onClick={() => setCart({ ...cart, [selected.id]: inCart + quantity })} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">{selected.availableStock < 1 ? 'Unavailable' : 'Add to cart'}</button></div> : null}</div>
              </div>
            </article>;
          })}</div>}
      </div>}

      {activeView === 'orders' && (
        <StoreOrdersView
          summary={orderSummary}
          isAdmin={isAdmin}
          schoolName={schoolName}
          user={user}
          onExportExcel={handleExportToExcel}
        />
      )}

      {canPurchase && cartItems.length > 0 && !checkoutOpen && createPortal(<button type="button" onClick={() => setCheckoutOpen(true)} aria-label={`Open cart with ${cartItems.reduce((n, item) => n + item.quantity, 0)} items, total ₹${cartTotal.toLocaleString('en-IN')}`} className="fixed bottom-5 right-5 z-[90] inline-flex items-center gap-3 rounded-2xl bg-indigo-600 px-4 py-3 text-left text-white shadow-xl ring-1 ring-white/30 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200">
        <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-white/15"><ShoppingCart className="h-5 w-5" /><span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[10px] font-black text-indigo-700">{cartItems.reduce((n, item) => n + item.quantity, 0)}</span></span>
        <span><span className="block text-xs font-bold text-indigo-100">View cart</span><span className="block text-sm font-black">₹{cartTotal.toLocaleString('en-IN')}</span></span>
      </button>, document.body)}

      {checkoutOpen && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-3 sm:p-4">
        <form role="dialog" aria-modal="true" aria-labelledby="store-checkout-title" onSubmit={(e) => { e.preventDefault(); void completeCheckout(); }} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-4 overflow-y-auto overscroll-contain rounded-3xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
          <div className="flex items-center justify-between"><h2 id="store-checkout-title" className="text-lg font-black text-slate-900">Complete store order</h2><button type="button" aria-label="Close cart" onClick={() => setCheckoutOpen(false)}><X className="h-5 w-5 text-slate-400" /></button></div>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-800">Your cart</h3><span className="text-xs font-semibold text-slate-500">{cartItems.reduce((n, item) => n + item.quantity, 0)} {cartItems.reduce((n, item) => n + item.quantity, 0) === 1 ? 'item' : 'items'}</span></div>
            {cartItems.map(({ product, quantity }) => <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
              <StoreProductImage src={product.imageUrl} alt={`${product.name} photo`} className="h-14 w-14 rounded-xl text-indigo-400" iconClassName="h-6 w-6" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-800">{product.name}</p><p className="text-xs text-slate-500">{product.sizeLabel ? `Size ${product.sizeLabel} · ` : ''}₹{Number(product.price).toLocaleString('en-IN')} each</p><p className="mt-0.5 text-xs font-bold text-indigo-700">₹{(Number(product.price) * quantity).toLocaleString('en-IN')}</p></div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => setCartQuantity(product, quantity - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><Minus className="h-3.5 w-3.5" /></button>
                <span aria-label={`Quantity ${quantity}`} className="w-6 text-center text-sm font-black text-slate-800">{quantity}</span>
                <button type="button" aria-label={`Increase ${product.name} quantity`} disabled={quantity >= product.availableStock} onClick={() => setCartQuantity(product, quantity + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={`Remove ${product.name} from cart`} onClick={() => setCartQuantity(product, 0)} className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>)}
          </div>
          <div className="rounded-2xl bg-indigo-50 p-4 text-sm"><p className="font-black text-indigo-900">Total: ₹{cartTotal.toLocaleString('en-IN')}</p><p className="mt-1 text-xs text-indigo-700">Stock is reserved for 15 minutes while payment is completed.</p></div>
          <div className="space-y-1"><label htmlFor="store-buyer-name" className="text-xs font-bold text-slate-600">Full name <span className="text-rose-600">*</span></label><input id="store-buyer-name" required maxLength={160} autoComplete="name" placeholder="Full name" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
          <div className="space-y-1"><label htmlFor="store-buyer-phone" className="text-xs font-bold text-slate-600">Phone number <span className="text-rose-600">*</span></label><input id="store-buyer-phone" required type="tel" inputMode="tel" autoComplete="tel" minLength={9} maxLength={30} pattern="\+?[0-9][0-9\s() -]{7,18}" title="Enter a valid phone number with at least 9 digits." placeholder="e.g. +91 98765 43210" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
          <p className="-mt-2 text-[11px] text-slate-500">Order updates will be associated with {user.email || 'your signed-in account'}.</p>
          <p aria-live="polite" className={`text-xs font-bold ${checkoutDetailsComplete ? 'text-emerald-700' : 'text-amber-700'}`}>{checkoutDetailsComplete ? 'Required order details are complete.' : 'Enter your full name and a valid phone number to continue.'}</p>
          <div className="space-y-1"><label htmlFor="store-pickup-note" className="text-xs font-bold text-slate-600">Pickup / collection note <span className="font-medium text-slate-400">(optional)</span></label><textarea id="store-pickup-note" placeholder="Add a collection note if needed" value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" rows={3} /></div>
          <button disabled={creatingOrder || !cartItems.length || !checkoutDetailsComplete} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-black text-white disabled:opacity-50"><CreditCard className="h-4 w-4" /> {creatingOrder ? 'Starting checkout...' : 'Pay with Razorpay'}</button>
        </form>
      </div>, document.body)}

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
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close Razorpay settings" className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input required name="razorpay-key-id" autoComplete="off" aria-label="Razorpay Key ID" placeholder="Razorpay Key ID" value={paymentKeyId} onChange={(e) => setPaymentKeyId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input type="password" name="razorpay-key-secret" autoComplete="new-password" aria-label="Razorpay Key Secret" placeholder={paymentSettings?.keySecretConfigured && !paymentModeChanged ? 'Secret saved — enter a new one to rotate' : 'Razorpay Key Secret for selected mode'} value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              <input type="password" name="razorpay-webhook-secret" autoComplete="new-password" aria-label="Razorpay Webhook Secret" placeholder={paymentModeChanged ? 'Webhook secret for selected mode' : paymentSettings?.webhookSecretConfigured ? 'Webhook secret saved — enter a new one to rotate' : 'Razorpay Webhook Secret'} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={paymentTestMode} onChange={(e) => setPaymentTestMode(e.target.checked)} /> Test mode</label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)} /> Enable payments</label>
            </div>

            <p className="rounded-xl bg-indigo-50 p-3 text-[11px] leading-snug text-indigo-800">
              Test keys start with <strong>rzp_test_</strong>; live keys with <strong>rzp_live_</strong>. Test mode uses Razorpay's test gateway and does not charge real money. For real payments, switch off Test mode and save live credentials. Add this webhook URL in Razorpay and enter its secret above: <span className="break-all font-mono">https://your-domain/api/v1/store/razorpay/webhook/</span>
            </p>

            <button disabled={savingSettings || !paymentKeyId || (needsPaymentKeySecret && !secret) || (needsWebhookSecret && !webhookSecret)} className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
              {savingSettings ? 'Saving...' : 'Save credentials'}
            </button>
          </form>
        </div>,
        document.body,
      )}
    </section>
  );
}
