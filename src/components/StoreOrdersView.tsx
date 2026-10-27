import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowUpDown,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  LayoutList,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  PackageCheck,
  Phone,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Shirt,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import type { AuthUser } from '../utils/auth';
import { copyToClipboard } from '../utils/clipboard';
import { printElement } from '../utils/printElement';
import { emitNotification } from '../services/notificationBus';
import {
  type StoreOrder,
  useFulfillStoreOrderMutation,
  useUnfulfillStoreOrderMutation,
} from '../store/api/storeApi';

interface StoreOrdersViewProps {
  orders: StoreOrder[];
  isAdmin: boolean;
  schoolName?: string;
  user: AuthUser;
  onExportExcel?: () => void;
}

type StatusFilter = 'all' | 'Paid' | 'Fulfilled' | 'Pending' | 'Problem';
type SortOption = 'newest' | 'oldest' | 'amount_high' | 'amount_low';
type ViewMode = 'grid' | 'table';

function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) || 0 : amount;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function getCategoryIcon(name: string, category = '') {
  const label = `${name} ${category}`.toLowerCase();
  if (label.includes('uniform') || label.includes('shirt') || label.includes('sock') || label.includes('pant')) {
    return Shirt;
  }
  if (label.includes('book') || label.includes('notebook') || label.includes('diary')) {
    return BookOpen;
  }
  return Package;
}

function getRoleBadge(role?: string) {
  const normalized = (role || '').toLowerCase();
  if (normalized.includes('parent')) {
    return {
      label: 'Parent',
      className: 'bg-purple-50 text-purple-700 border-purple-200/80',
    };
  }
  if (normalized.includes('student')) {
    return {
      label: 'Student',
      className: 'bg-sky-50 text-sky-700 border-sky-200/80',
    };
  }
  if (normalized.includes('teacher') || normalized.includes('staff')) {
    return {
      label: 'Staff',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    };
  }
  if (normalized.includes('admin')) {
    return {
      label: 'Admin',
      className: 'bg-amber-50 text-amber-700 border-amber-200/80',
    };
  }
  return {
    label: role || 'Buyer',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

export default function StoreOrdersView({
  orders,
  isAdmin,
  schoolName = 'School Store',
  user,
  onExportExcel,
}: StoreOrdersViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [receiptOrder, setReceiptOrder] = useState<StoreOrder | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [fulfillOrder, { isLoading: isFulfilling }] = useFulfillStoreOrderMutation();
  const [unfulfillOrder, { isLoading: isUnfulfilling }] = useUnfulfillStoreOrderMutation();

  const handleCopy = async (text: string, identifier: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(identifier);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleFulfill = async (orderId: number) => {
    try {
      await fulfillOrder(orderId).unwrap();
      emitNotification({
        title: 'Order Fulfilled',
        message: `Order #${orderId} marked as collected and completed.`,
        tone: 'success',
        source: 'store',
      });
    } catch (err: any) {
      emitNotification({
        title: 'Action Failed',
        message: err?.data?.detail || 'Could not update order status.',
        tone: 'danger',
        source: 'store',
      });
    }
  };

  const handleUnfulfill = async (orderId: number) => {
    try {
      await unfulfillOrder(orderId).unwrap();
      emitNotification({
        title: 'Order Reopened',
        message: `Order #${orderId} status returned to Paid (Pending Collection).`,
        tone: 'info',
        source: 'store',
      });
    } catch (err: any) {
      emitNotification({
        title: 'Action Failed',
        message: err?.data?.detail || 'Could not revert order status.',
        tone: 'danger',
        source: 'store',
      });
    }
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const totalCount = orders.length;
    const paidOrders = orders.filter((o) => o.status === 'Paid');
    const fulfilledOrders = orders.filter((o) => o.status === 'Fulfilled');
    const pendingOrders = orders.filter((o) => o.status === 'Pending');
    const problemOrders = orders.filter((o) => ['Failed', 'Cancelled', 'Expired'].includes(o.status));

    const totalRevenue = orders
      .filter((o) => o.status === 'Paid' || o.status === 'Fulfilled')
      .reduce((sum, o) => sum + (parseFloat(o.subtotal) || 0), 0);

    return {
      totalCount,
      paidCount: paidOrders.length,
      fulfilledCount: fulfilledOrders.length,
      pendingCount: pendingOrders.length,
      problemCount: problemOrders.length,
      totalRevenue,
    };
  }, [orders]);

  // Filtering & Sorting
  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => {
        // Status filter
        if (statusFilter === 'Paid' && order.status !== 'Paid') return false;
        if (statusFilter === 'Fulfilled' && order.status !== 'Fulfilled') return false;
        if (statusFilter === 'Pending' && order.status !== 'Pending') return false;
        if (statusFilter === 'Problem' && !['Failed', 'Cancelled', 'Expired'].includes(order.status)) {
          return false;
        }

        // Search query
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const matchesId = String(order.id).includes(q) || `order #${order.id}`.toLowerCase().includes(q);
        const matchesName = (order.buyerName || '').toLowerCase().includes(q);
        const matchesEmail = (order.buyerEmail || '').toLowerCase().includes(q);
        const matchesPhone = (order.buyerPhone || '').toLowerCase().includes(q);
        const matchesNote = (order.deliveryAddress || '').toLowerCase().includes(q);
        const matchesItem = order.items.some((item) =>
          item.productName.toLowerCase().includes(q) || (item.category || '').toLowerCase().includes(q)
        );

        return matchesId || matchesName || matchesEmail || matchesPhone || matchesNote || matchesItem;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortBy === 'oldest') {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        if (sortBy === 'amount_high') {
          return (parseFloat(b.subtotal) || 0) - (parseFloat(a.subtotal) || 0);
        }
        if (sortBy === 'amount_low') {
          return (parseFloat(a.subtotal) || 0) - (parseFloat(b.subtotal) || 0);
        }
        return 0;
      });
  }, [orders, statusFilter, searchQuery, sortBy]);

  return (
    <div className="space-y-6">
      {/* ─── Hero / Header Card ──────────────────────────────────────────────── */}
      <section className="portal-card relative overflow-hidden p-6 sm:p-7">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-gradient-to-br from-indigo-100/40 via-violet-100/30 to-sky-100/40 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-indigo-700 border border-indigo-100">
                <Sparkles className="h-3 w-3" />
                {isAdmin ? 'Store Operations & Fulfillment' : 'Store Purchases'}
              </span>
              <span className="text-xs font-semibold text-slate-400">·</span>
              <span className="text-xs font-bold text-slate-500">
                {orders.length} Total {orders.length === 1 ? 'Order' : 'Orders'}
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
              {isAdmin ? 'Orders & Distribution' : 'My Orders & Receipts'}
            </h2>
            <p className="text-xs font-medium text-slate-500 max-w-2xl sm:text-sm">
              {isAdmin
                ? 'Review buyer requests, confirm pickup notes, track payment status, and verify store collection handed over to parents and students.'
                : 'Track the status of your uniform and school supply orders and access your official store collection receipts.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && onExportExcel && (
              <button
                type="button"
                onClick={onExportExcel}
                title="Export complete store orders, customer receipts, and line items to Excel (.xlsx)"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-800 shadow-xs hover:border-emerald-300 hover:bg-emerald-100 transition cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Export to Excel</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:border-indigo-300 hover:text-indigo-700 hover:bg-slate-50 transition"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
              Reset filters
            </button>
            {isAdmin && orders.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  printElement('store-order-print-sheet', 'School Store Orders');
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition"
              >
                <Printer className="h-3.5 w-3.5" />
                Print order sheet
              </button>
            )}
          </div>
        </div>

        {/* ─── Metric KPI Ribbon ────────────────────────────────────────── */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {/* Card 1: Total Orders */}
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`group text-left p-4 rounded-2xl border transition-all duration-200 ${
              statusFilter === 'all'
                ? 'bg-gradient-to-br from-indigo-50/90 to-violet-50/50 border-indigo-200 shadow-sm ring-1 ring-indigo-500/20'
                : 'bg-slate-50/70 border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 group-hover:text-indigo-600 transition">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Volume</span>
              <Receipt className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{metrics.totalCount}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">All registered orders</p>
          </button>

          {/* Card 2: Total Revenue */}
          <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/70">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Collected Revenue</span>
              <span className="font-mono text-xs font-black text-emerald-600">₹</span>
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900 tracking-tight">
              {formatCurrency(metrics.totalRevenue)}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-emerald-600">
              {metrics.paidCount + metrics.fulfilledCount} paid transactions
            </p>
          </div>

          {/* Card 3: Ready for Handover (Paid) */}
          <button
            type="button"
            onClick={() => setStatusFilter('Paid')}
            className={`group text-left p-4 rounded-2xl border transition-all duration-200 ${
              statusFilter === 'Paid'
                ? 'bg-gradient-to-br from-emerald-50/90 to-teal-50/50 border-emerald-300 shadow-sm ring-1 ring-emerald-500/20'
                : 'bg-slate-50/70 border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between text-emerald-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Ready for Pickup</span>
              <Package className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{metrics.paidCount}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">Paid · Awaiting handover</p>
          </button>

          {/* Card 4: Fulfilled / Completed */}
          <button
            type="button"
            onClick={() => setStatusFilter('Fulfilled')}
            className={`group text-left p-4 rounded-2xl border transition-all duration-200 ${
              statusFilter === 'Fulfilled'
                ? 'bg-gradient-to-br from-indigo-50/90 to-sky-50/50 border-indigo-300 shadow-sm ring-1 ring-indigo-500/20'
                : 'bg-slate-50/70 border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between text-indigo-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Fulfilled</span>
              <PackageCheck className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{metrics.fulfilledCount}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-indigo-600">Handed over to buyer</p>
          </button>
        </div>
      </section>

      {/* ─── Control Bar: Search, Status Tabs, Sorting & View Toggle ─────── */}
      <div className="portal-card p-4 space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by order #, buyer, phone, item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-9 py-2.5 text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-3 focus:ring-indigo-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Right utilities: Sort + View Mode Switcher */}
          <div className="flex items-center gap-2">
            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-400 text-[11px]">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="amount_high">Highest amount</option>
                <option value="amount_low">Lowest amount</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-1">
              <button
                type="button"
                title="Grid / Cards View"
                onClick={() => setViewMode('grid')}
                className={`rounded-lg p-1.5 transition ${
                  viewMode === 'grid'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Dense Table View"
                onClick={() => setViewMode('table')}
                className={`rounded-lg p-1.5 transition ${
                  viewMode === 'table'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LayoutList className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Filter:
          </span>
          {[
            { id: 'all', label: 'All Orders', count: metrics.totalCount },
            { id: 'Paid', label: 'Ready for Pickup', count: metrics.paidCount, color: 'emerald' },
            { id: 'Fulfilled', label: 'Fulfilled / Collected', count: metrics.fulfilledCount, color: 'indigo' },
            { id: 'Pending', label: 'Pending Payment', count: metrics.pendingCount, color: 'amber' },
            ...(metrics.problemCount > 0
              ? [{ id: 'Problem', label: 'Failed / Cancelled', count: metrics.problemCount, color: 'rose' }]
              : []),
          ].map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as StatusFilter)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-600 shadow-2xs'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Orders List (Empty State or Items) ─────────────────────────── */}
      {filteredOrders.length === 0 ? (
        <div className="portal-card p-12 text-center space-y-3">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-500">
            <Receipt className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-800">
              {orders.length === 0
                ? 'No store orders found'
                : 'No orders match your filter criteria'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {orders.length === 0
                ? 'When parents or students place orders in the school store, they will appear here automatically.'
                : `Try adjusting your search query or reset the filter status to view all orders.`}
            </p>
          </div>
          {(searchQuery || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset filters
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* ══════════════════════════════════════════════════════════════════
           GRID / CARDS VIEW (Modern visual cards)
           ══════════════════════════════════════════════════════════════════ */
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-2">
          {filteredOrders.map((order) => {
            const isPaid = order.status === 'Paid';
            const isFulfilled = order.status === 'Fulfilled';
            const isPending = order.status === 'Pending';
            const isProblem = ['Failed', 'Cancelled', 'Expired'].includes(order.status);
            const hasCompleteContact = Boolean(order.buyerName?.trim() && order.buyerEmail?.trim() && order.buyerPhone?.trim());
            const roleBadge = getRoleBadge(order.buyerRole);
            const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);

            return (
              <article
                key={order.id}
                className="portal-card relative flex flex-col justify-between overflow-hidden border border-slate-200/90 hover:border-indigo-300 transition-all duration-200 shadow-xs hover:shadow-md"
              >
                {/* Status indicator bar on the left edge */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                    isPaid
                      ? 'bg-emerald-500'
                      : isFulfilled
                      ? 'bg-indigo-600'
                      : isPending
                      ? 'bg-amber-400'
                      : 'bg-rose-500'
                  }`}
                />

                <div className="p-5 sm:p-6 space-y-4">
                  {/* Top Header Row: Order ID, Timestamp & Status Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-black text-white font-mono shadow-2xs">
                        #ORD-{String(order.id).padStart(4, '0')}
                      </span>
                      <button
                        type="button"
                        title="Copy Order ID"
                        onClick={() => handleCopy(`#ORD-${order.id}`, `ord-${order.id}`)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                      >
                        {copiedId === `ord-${order.id}` ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Date & Time */}
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                        <Calendar className="h-3 w-3" />
                        {formatDate(order.createdAt)} · {formatTime(order.createdAt)}
                      </span>

                      {/* Status Badge */}
                      {isPaid && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 border border-emerald-200 shadow-2xs">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          Paid & Ready
                        </span>
                      )}
                      {isFulfilled && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 border border-indigo-200 shadow-2xs">
                          <PackageCheck className="h-3.5 w-3.5 text-indigo-600" />
                          Handed Over
                        </span>
                      )}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 border border-amber-200 shadow-2xs">
                          <Clock className="h-3.5 w-3.5 text-amber-600" />
                          Awaiting Payment
                        </span>
                      )}
                      {isProblem && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700 border border-rose-200 shadow-2xs">
                          <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                          {order.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Customer Identity Bar */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white font-black text-base shadow-sm ring-2 ring-indigo-100">
                        {order.buyerName ? order.buyerName.charAt(0).toUpperCase() : <UserRound className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-base font-black text-slate-900">
                            {order.buyerName || 'Store Customer'}
                          </h4>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${roleBadge.className}`}
                          >
                            {roleBadge.label}
                          </span>
                        </div>
                        {order.buyerEmail && (
                          <p className="truncate text-xs font-medium text-slate-500 flex items-center gap-1">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {order.buyerEmail}
                          </p>
                        )}
                        <p className={`mt-1 text-[10px] font-bold ${hasCompleteContact ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {hasCompleteContact ? 'Contact details complete' : 'Missing contact details'}
                        </p>
                      </div>
                    </div>

                    {/* Quick Phone or WhatsApp Action */}
                    {order.buyerPhone && (
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`tel:${order.buyerPhone}`}
                          title="Call customer"
                          className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={`https://wa.me/${order.buyerPhone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Message on WhatsApp"
                          className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 transition"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Collection / Pickup Details Banner */}
                  {order.deliveryAddress ? (
                    <div className="rounded-xl border border-amber-200/90 bg-gradient-to-r from-amber-50/80 via-orange-50/50 to-amber-50/80 p-3 text-xs text-amber-900 shadow-2xs">
                      <div className="flex items-center gap-1.5 font-black text-[11px] uppercase tracking-wider text-amber-800">
                        <MapPin className="h-3.5 w-3.5 text-amber-600" />
                        Pickup / Collection Note
                      </div>
                      <p className="mt-1 font-semibold italic text-amber-950 pl-5">
                        "{order.deliveryAddress}"
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      Standard school store counter collection
                    </div>
                  )}

                  {/* Ordered Items Breakdown */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <span>Items Breakdown ({totalItems} {totalItems === 1 ? 'unit' : 'units'})</span>
                      <span>Subtotal</span>
                    </div>

                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-slate-50/40 p-1">
                      {order.items.map((item, idx) => {
                        const Icon = getCategoryIcon(item.productName, item.category);
                        const unitPriceNum = parseFloat(item.unitPrice) || 0;
                        const lineTotal = unitPriceNum * item.quantity;

                        return (
                          <div
                            key={`${order.id}-${item.productId}-${idx}`}
                            className="flex items-center justify-between gap-3 p-2.5 text-xs hover:bg-white rounded-lg transition"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-black text-slate-800">
                                  {item.productName}
                                </p>
                                <p className="text-[10px] font-semibold text-slate-400">
                                  {item.uniformType || item.category || 'General supply'} · Qty: {item.quantity}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono font-black text-slate-800">
                                {formatCurrency(lineTotal)}
                              </p>
                              <p className="text-[10px] font-semibold text-slate-400 font-mono">
                                ₹{unitPriceNum} each
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Payment Verification & Grand Total */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-100">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isPaid || isFulfilled ? 'bg-emerald-500' : isPending ? 'bg-amber-400' : 'bg-rose-500'
                          }`}
                        />
                        <span className="text-xs font-bold text-slate-700">
                          {order.paymentId?.startsWith('dummy_payment_')
                            ? 'Demo payment · no charge'
                            : isPaid || isFulfilled
                              ? 'Razorpay Verified'
                              : isPending
                                ? 'Payment Pending'
                                : `Payment ${order.status}`}
                        </span>
                      </div>
                      {order.paymentId ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] font-mono text-slate-400">
                          <span>Ref: {order.paymentId.slice(0, 16)}...</span>
                          <button
                            type="button"
                            title="Copy Payment ID"
                            onClick={() => handleCopy(order.paymentId || '', `pay-${order.id}`)}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            {copiedId === `pay-${order.id}` ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] font-medium text-slate-400">Stock reserved for 15 minutes</p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Order Total</p>
                      <p className="text-xl font-black text-slate-900 font-mono tracking-tight">
                        {formatCurrency(order.subtotal)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ─── Bottom Actions Bar ───────────────────────────────── */}
                <div className="border-t border-slate-100 bg-slate-50/70 p-3.5 sm:px-6 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReceiptOrder(order)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:border-indigo-300 hover:text-indigo-700 transition"
                    >
                      <Receipt className="h-3.5 w-3.5 text-slate-500" />
                      View receipt
                    </button>
                  </div>

                  {/* Role Specific Actions */}
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                      isPaid ? (
                        <button
                          type="button"
                          disabled={isFulfilling}
                          onClick={() => handleFulfill(order.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition disabled:opacity-50"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          {isFulfilling ? 'Updating...' : 'Mark as Handed Over'}
                        </button>
                      ) : isFulfilled ? (
                        <button
                          type="button"
                          disabled={isUnfulfilling}
                          onClick={() => handleUnfulfill(order.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-2xs hover:border-slate-300 hover:text-slate-900 transition disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                          Reopen order
                        </button>
                      ) : null
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReceiptOrder(order)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Print collection slip
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* ══════════════════════════════════════════════════════════════════
           TABLE / COMPACT VIEW (High-efficiency administrative view)
           ══════════════════════════════════════════════════════════════════ */
        <div className="portal-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3.5">Order Ref</th>
                  <th className="px-4 py-3.5">Buyer</th>
                  <th className="px-4 py-3.5">Contact</th>
                  <th className="px-4 py-3.5">Items Summary</th>
                  <th className="px-4 py-3.5">Pickup Note</th>
                  <th className="px-4 py-3.5">Date</th>
                  <th className="px-4 py-3.5">Amount</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredOrders.map((order) => {
                  const isPaid = order.status === 'Paid';
                  const isFulfilled = order.status === 'Fulfilled';
                  const isPending = order.status === 'Pending';
                  const hasCompleteContact = Boolean(order.buyerName?.trim() && order.buyerEmail?.trim() && order.buyerPhone?.trim());
                  const roleBadge = getRoleBadge(order.buyerRole);
                  const totalUnits = order.items.reduce((sum, item) => sum + item.quantity, 0);

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Order Ref */}
                      <td className="px-5 py-4 font-mono font-black text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>#ORD-{String(order.id).padStart(4, '0')}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(`#ORD-${order.id}`, `tbl-ord-${order.id}`)}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            {copiedId === `tbl-ord-${order.id}` ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Buyer */}
                      <td className="px-4 py-4">
                        <p className="font-black text-slate-900">{order.buyerName || 'Customer'}</p>
                        <span
                          className={`mt-0.5 inline-block rounded-full border px-1.5 py-0.2 text-[9px] font-extrabold uppercase ${roleBadge.className}`}
                        >
                          {roleBadge.label}
                        </span>
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-4 text-slate-500">
                        {order.buyerPhone ? (
                          <a
                            href={`tel:${order.buyerPhone}`}
                            className="font-mono text-[11px] font-semibold text-indigo-600 hover:underline flex items-center gap-1"
                          >
                            <Phone className="h-3 w-3" /> {order.buyerPhone}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {order.buyerEmail && (
                          <p className="text-[10px] text-slate-400 truncate max-w-[140px]">
                            {order.buyerEmail}
                          </p>
                        )}
                        <p className={`mt-1 text-[10px] font-bold ${hasCompleteContact ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {hasCompleteContact ? 'Details complete' : 'Missing details'}
                        </p>
                      </td>

                      {/* Items */}
                      <td className="px-4 py-4">
                        <div className="space-y-0.5">
                          {order.items.slice(0, 2).map((item, idx) => (
                            <p key={idx} className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">
                              {item.productName} <span className="text-slate-400">×{item.quantity}</span>
                            </p>
                          ))}
                          {order.items.length > 2 && (
                            <p className="text-[10px] font-bold text-indigo-600">
                              +{order.items.length - 2} more item(s)
                            </p>
                          )}
                          <span className="text-[10px] text-slate-400 font-semibold">
                            Total {totalUnits} pcs
                          </span>
                        </div>
                      </td>

                      {/* Pickup Note */}
                      <td className="px-4 py-4">
                        {order.deliveryAddress ? (
                          <p
                            className="max-w-[160px] truncate text-xs font-medium italic text-amber-800 bg-amber-50 rounded-lg px-2 py-1 border border-amber-200"
                            title={order.deliveryAddress}
                          >
                            {order.deliveryAddress}
                          </p>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Standard counter</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-4 text-[11px] text-slate-500 font-medium">
                        <p>{formatDate(order.createdAt)}</p>
                        <p className="text-[10px] text-slate-400">{formatTime(order.createdAt)}</p>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-4 font-mono font-black text-slate-900 text-sm">
                        {formatCurrency(order.subtotal)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        {isPaid && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            Paid
                          </span>
                        )}
                        {isFulfilled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700 border border-indigo-200">
                            <PackageCheck className="h-3 w-3 text-indigo-600" />
                            Fulfilled
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 border border-amber-200">
                            <Clock className="h-3 w-3 text-amber-600" />
                            Pending
                          </span>
                        )}
                        {!isPaid && !isFulfilled && !isPending && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700 border border-rose-200">
                            {order.status}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="View Receipt"
                            onClick={() => setReceiptOrder(order)}
                            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                          </button>

                          {isAdmin && isPaid && (
                            <button
                              type="button"
                              title="Mark as Handed Over"
                              disabled={isFulfilling}
                              onClick={() => handleFulfill(order.id)}
                              className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 transition disabled:opacity-50"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isAdmin && isFulfilled && (
                            <button
                              type="button"
                              title="Revert to Paid"
                              disabled={isUnfulfilling}
                              onClick={() => handleUnfulfill(order.id)}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 transition disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dedicated compact print layout: keeps the order report readable and together. */}
      <section id="store-order-print-sheet" className="store-order-print-sheet hidden" aria-hidden="true">
        <div className="store-print-report-heading">
          <div>
            <p className="store-print-eyebrow">School Store · Orders &amp; Distribution</p>
            <h1>{schoolName || user.schoolName || 'School'} — Order Sheet</h1>
            <p>{filteredOrders.length} orders · Printed {new Date().toLocaleString('en-IN')}</p>
          </div>
          <strong>Collected: {formatCurrency(metrics.totalRevenue)}</strong>
        </div>
        <table className="store-print-orders-table">
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '31%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Order / Date</th>
              <th>Buyer / Contact</th>
              <th>Items</th>
              <th>Collection Note</th>
              <th>Payment Reference</th>
              <th>Total / Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id}>
                <td>
                  <strong>#ORD-{String(order.id).padStart(4, '0')}</strong>
                  <span>{formatDate(order.createdAt)} · {formatTime(order.createdAt)}</span>
                </td>
                <td>
                  <strong>{order.buyerName || 'Store Customer'}</strong>
                  <span>{getRoleBadge(order.buyerRole).label}</span>
                  {order.buyerPhone && <span>{order.buyerPhone}</span>}
                  {order.buyerEmail && <span>{order.buyerEmail}</span>}
                </td>
                <td>
                  {order.items.map((item, index) => (
                    <span key={`${order.id}-print-${index}`}>
                      {item.productName} · Qty {item.quantity} · {formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}
                    </span>
                  ))}
                </td>
                <td>{order.deliveryAddress || 'Standard school store counter collection'}</td>
                <td>
                  <strong>{order.paymentId?.startsWith('dummy_payment_') ? 'Demo payment' : order.paymentId ? 'Razorpay verified' : 'Payment pending'}</strong>
                  {order.paymentId && <span>{order.paymentId}</span>}
                </td>
                <td>
                  <strong>{formatCurrency(order.subtotal)}</strong>
                  <span>{order.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Printable Order Receipt Modal ───────────────────────────────── */}
      {receiptOrder &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-xs">
            <div className="relative w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-scaleUp my-8">
              {/* Modal Top Bar */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-600 text-white shadow-2xs">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Official Store Receipt</h3>
                    <p className="text-[11px] font-medium text-slate-400">Order verification & pickup invoice</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReceiptOrder(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Printable Receipt Area */}
              <div id="store-order-receipt-content" className="p-6 sm:p-8 space-y-6 bg-white">
                {/* School Header */}
                <div className="flex items-start justify-between border-b border-slate-200 pb-5">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                      Campus Marketplace
                    </p>
                    <h1 className="text-xl font-black text-slate-900">{schoolName}</h1>
                    <p className="text-xs font-medium text-slate-500">Uniforms & School Supplies Division</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm font-black text-slate-900">
                      #ORD-{String(receiptOrder.id).padStart(4, '0')}
                    </span>
                    <p className="text-[11px] font-medium text-slate-500">
                      {formatDate(receiptOrder.createdAt)}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                        receiptOrder.status === 'Paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : receiptOrder.status === 'Fulfilled'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {receiptOrder.status}
                    </span>
                  </div>
                </div>

                {/* Customer Details Box */}
                <div className="grid grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4 text-xs">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Customer Details</p>
                    <p className="mt-1 font-black text-slate-800 text-sm">{receiptOrder.buyerName || 'Customer'}</p>
                    <p className="text-slate-500 font-medium">{receiptOrder.buyerRole || 'Parent/Student'}</p>
                    {receiptOrder.buyerPhone && <p className="font-mono text-slate-600 mt-0.5">{receiptOrder.buyerPhone}</p>}
                    {receiptOrder.buyerEmail && <p className="text-slate-400">{receiptOrder.buyerEmail}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Collection Note</p>
                    <p className="mt-1 font-semibold text-slate-700 italic">
                      {receiptOrder.deliveryAddress || 'Standard school store counter collection.'}
                    </p>
                    {receiptOrder.paymentId && (
                      <p className="mt-2 text-[10px] font-mono text-slate-400">
                        Gateway Ref: {receiptOrder.paymentId}
                      </p>
                    )}
                  </div>
                </div>

                {/* Items Table */}
                <div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="pb-2">Item Description</th>
                        <th className="pb-2 text-center">Qty</th>
                        <th className="pb-2 text-right">Unit Price</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receiptOrder.items.map((item, idx) => {
                        const unitPrice = parseFloat(item.unitPrice) || 0;
                        const lineTotal = unitPrice * item.quantity;
                        return (
                          <tr key={idx}>
                            <td className="py-2.5">
                              <p className="font-bold text-slate-800">{item.productName}</p>
                              <p className="text-[10px] text-slate-400">
                                {item.uniformType || item.category || 'General supply'}
                              </p>
                            </td>
                            <td className="py-2.5 text-center font-bold text-slate-700">{item.quantity}</td>
                            <td className="py-2.5 text-right font-mono text-slate-600">₹{unitPrice}</td>
                            <td className="py-2.5 text-right font-mono font-black text-slate-900">
                              {formatCurrency(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Grand Total Summary */}
                <div className="border-t border-slate-200 pt-3 space-y-1.5 text-right text-xs">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatCurrency(receiptOrder.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Applicable Taxes & Charges</span>
                    <span className="font-mono">₹0.00</span>
                  </div>
                  <div className="flex justify-between text-base font-black text-slate-900 border-t border-slate-200 pt-2">
                    <span>Grand Total Paid</span>
                    <span className="font-mono text-indigo-600">{formatCurrency(receiptOrder.subtotal)}</span>
                  </div>
                </div>

                {/* Counter Verification Stamp Block */}
                <div className="mt-8 pt-4 border-t border-dashed border-slate-200 grid grid-cols-3 gap-4 text-center text-[10px] text-slate-400">
                  <div className="border-t border-slate-300 pt-1">
                    <p className="font-bold text-slate-600">Issued By (Staff Signature)</p>
                  </div>
                  <div className="border-t border-slate-300 pt-1">
                    <p className="font-bold text-slate-600">Received By (Buyer Signature)</p>
                  </div>
                  <div className="border-t border-slate-300 pt-1">
                    <p className="font-bold text-slate-600">Date of Collection</p>
                  </div>
                </div>
              </div>

              {/* Modal Footer Controls */}
              <div className="border-t border-slate-100 bg-slate-50 p-4 px-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setReceiptOrder(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => printElement('store-order-receipt-content', `Store-Receipt-Order-${receiptOrder.id}`)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white shadow-xs hover:bg-indigo-700 transition"
                >
                  <Printer className="h-4 w-4" />
                  Print Receipt
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

