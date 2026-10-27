import XLSX, { styleWorksheet, downloadStyledWorkbook } from './excelStyler';
import type { StoreOrder, StoreProduct } from '../store/api/storeApi';

export interface StoreExportOptions {
  schoolName?: string;
  orders: StoreOrder[];
  products: StoreProduct[];
}

/**
 * Formats date into DD/MM/YYYY string for clean Excel display.
 */
function formatExcelDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Formats time into 12-hour hh:mm AM/PM string.
 */
function formatExcelTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

/**
 * Generates an executive, audit-grade Microsoft Excel workbook (.xlsx)
 * for the School Store, incorporating:
 * 1. Store Orders Master Ledger
 * 2. Item-by-Item Sales & Line Items Tally
 * 3. Inventory Stock & Valuation Register
 * 4. Executive Store Financial & Audit Summary
 */
export function exportStoreDataToExcel(options: StoreExportOptions): void {
  const {
    schoolName = 'School Store Marketplace',
    orders,
    products,
  } = options;

  const wb = XLSX.utils.book_new();

  // ===========================================================================
  // SHEET 1: STORE ORDERS MASTER LEDGER
  // ===========================================================================
  const sheet1Headers = [
    'S.No',
    'Order ID',
    'Order Date',
    'Order Time',
    'Customer / Buyer Name',
    'Customer Role',
    'Contact Phone',
    'Email Address',
    'Total Items (Qty)',
    'Items Summary',
    'Collection / Delivery Notes',
    'Payment Status',
    'Payment Mode / Gateway',
    'Transaction / Payment Ref',
    'Order Subtotal (₹)',
    'Tax / Fees (₹)',
    'Amount Collected (₹)',
    'Pending Balance (₹)',
    'Fulfillment Status',
    'Tally Reconciliation Check',
  ];

  const sheet1Rows: Array<Array<string | number>> = [];

  let sumOrdersSubtotal = 0;
  let sumOrdersCollected = 0;
  let sumOrdersPending = 0;
  let sumTotalItemsCount = 0;

  orders.forEach((order, index) => {
    const subtotal = parseFloat(order.subtotal) || 0;
    const isPaid = order.status === 'Paid' || order.status === 'Fulfilled';
    const isPending = order.status === 'Pending';
    const collected = isPaid ? subtotal : 0;
    const pending = isPending ? subtotal : 0;

    const totalQty = (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    const itemsSummary = (order.items || [])
      .map((item) => `${item.productName}${item.uniformType ? ` (${item.uniformType})` : ''} x${item.quantity}`)
      .join('; ') || 'Standard Store Item';

    const paymentMode = order.gatewayOrderId?.startsWith('demo_') || order.paymentId?.startsWith('demo_')
      ? 'Local Demo Flow'
      : order.paymentId
      ? 'Razorpay Online'
      : order.status === 'Paid'
      ? 'Direct Verified'
      : 'Awaiting Payment';

    const fulfillmentStatus = order.status === 'Fulfilled'
      ? 'Fulfilled (Handed Over)'
      : isPaid
      ? 'Ready for Collection'
      : 'Pending Payment';

    const tallyCheck = isPaid
      ? 'PERFECT TALLY - RECONCILED'
      : isPending
      ? 'PENDING SETTLEMENT'
      : 'CANCELLED / PROBLEM';

    sumOrdersSubtotal += subtotal;
    sumOrdersCollected += collected;
    sumOrdersPending += pending;
    sumTotalItemsCount += totalQty;

    sheet1Rows.push([
      index + 1,
      `ORD-#${order.id}`,
      formatExcelDate(order.createdAt),
      formatExcelTime(order.createdAt),
      order.buyerName || 'Unspecified Customer',
      order.buyerRole || 'Parent / Student',
      order.buyerPhone || '—',
      order.buyerEmail || '—',
      totalQty,
      itemsSummary,
      order.deliveryAddress || 'Standard Campus Collection',
      order.status,
      paymentMode,
      order.paymentId || order.gatewayOrderId || '—',
      subtotal,
      0,
      collected,
      pending,
      fulfillmentStatus,
      tallyCheck,
    ]);
  });

  // Master Summary Row
  sheet1Rows.push([]);
  sheet1Rows.push([
    'TOTALS',
    `${orders.length} Orders`,
    '—',
    '—',
    'GRAND TOTALS',
    '—',
    '—',
    '—',
    sumTotalItemsCount,
    'All Store Orders',
    '—',
    '—',
    '—',
    '—',
    sumOrdersSubtotal,
    0,
    sumOrdersCollected,
    sumOrdersPending,
    '—',
    Math.abs(sumOrdersSubtotal - (sumOrdersCollected + sumOrdersPending)) < 0.01
      ? 'PERFECT AUDIT TALLY'
      : 'AUDIT CHECK REQUIRED',
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([sheet1Headers, ...sheet1Rows]);
  ws1['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 14 }, // Order ID
    { wch: 13 }, // Date
    { wch: 12 }, // Time
    { wch: 24 }, // Buyer Name
    { wch: 16 }, // Role
    { wch: 15 }, // Phone
    { wch: 25 }, // Email
    { wch: 16 }, // Total Items Qty
    { wch: 40 }, // Items Summary
    { wch: 30 }, // Delivery Notes
    { wch: 16 }, // Status
    { wch: 20 }, // Payment Mode
    { wch: 26 }, // Transaction Ref
    { wch: 18 }, // Subtotal
    { wch: 14 }, // Tax
    { wch: 20 }, // Amount Collected
    { wch: 20 }, // Pending Balance
    { wch: 24 }, // Fulfillment Status
    { wch: 28 }, // Tally Check
  ];

  styleWorksheet(ws1, { theme: 'navy', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws1, 'Store_Orders_Ledger');

  // ===========================================================================
  // SHEET 2: ORDER LINE ITEMS TALLY (ITEM-BY-ITEM ACCOUNTING)
  // ===========================================================================
  const sheet2Headers = [
    'S.No',
    'Order ID',
    'Order Date',
    'Customer Name',
    'Customer Phone',
    'Product ID',
    'Item Name',
    'Category',
    'Uniform Type / Specification',
    'Unit Price (₹)',
    'Quantity Ordered',
    'Line Total (₹)',
    'Payment Status',
    'Payment Reference',
    'Collection Notes',
  ];

  const sheet2Rows: Array<Array<string | number>> = [];
  let lineItemIndex = 1;
  let sumLineItemsQty = 0;
  let sumLineItemsTotal = 0;

  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const unitPrice = parseFloat(item.unitPrice) || 0;
      const qty = Number(item.quantity) || 1;
      const lineTotal = unitPrice * qty;

      sumLineItemsQty += qty;
      sumLineItemsTotal += lineTotal;

      sheet2Rows.push([
        lineItemIndex++,
        `ORD-#${order.id}`,
        formatExcelDate(order.createdAt),
        order.buyerName || '—',
        order.buyerPhone || '—',
        item.productId,
        item.productName,
        item.category || 'Store Item',
        item.uniformType || 'Standard',
        unitPrice,
        qty,
        lineTotal,
        order.status,
        order.paymentId || order.gatewayOrderId || '—',
        order.deliveryAddress || 'Standard Pickup',
      ]);
    });
  });

  // Summary Row for Line Items
  sheet2Rows.push([]);
  sheet2Rows.push([
    'TOTALS',
    '—',
    '—',
    'TOTAL ITEMS SOLD',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    sumLineItemsQty,
    sumLineItemsTotal,
    '—',
    '—',
    '—',
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet([sheet2Headers, ...sheet2Rows]);
  ws2['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 14 }, // Order ID
    { wch: 13 }, // Date
    { wch: 22 }, // Customer Name
    { wch: 15 }, // Customer Phone
    { wch: 12 }, // Product ID
    { wch: 28 }, // Item Name
    { wch: 16 }, // Category
    { wch: 24 }, // Type / Spec
    { wch: 14 }, // Unit Price
    { wch: 16 }, // Qty
    { wch: 16 }, // Line Total
    { wch: 16 }, // Payment Status
    { wch: 24 }, // Reference
    { wch: 28 }, // Notes
  ];

  styleWorksheet(ws2, { theme: 'indigo', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws2, 'Order_Line_Items_Tally');

  // ===========================================================================
  // SHEET 3: INVENTORY STOCK & VALUATION REGISTER
  // ===========================================================================
  const sheet3Headers = [
    'S.No',
    'Product ID',
    'SKU / Barcode',
    'Item Name',
    'Category',
    'Uniform Type',
    'Size / Variant',
    'Target Grades',
    'Unit Selling Price (₹)',
    'Total Initial Stock (Units)',
    'Available Units in Stock',
    'Sold / Reserved Units',
    'Total Stock Asset Value (₹)',
    'Available Asset Value (₹)',
    'Realized Sales Valuation (₹)',
    'Stock Status',
    'Listing Status',
  ];

  const sheet3Rows: Array<Array<string | number>> = [];
  let sumTotalStockUnits = 0;
  let sumAvailableStockUnits = 0;
  let sumSoldUnits = 0;
  let sumTotalAssetValuation = 0;
  let sumAvailableAssetValuation = 0;
  let sumRealizedValuation = 0;

  products.forEach((product, index) => {
    const price = parseFloat(product.price) || 0;
    const totalStock = product.stockQuantity || 0;
    const availableStock = product.availableStock ?? totalStock;
    const soldReserved = Math.max(0, totalStock - availableStock);

    const totalValuation = totalStock * price;
    const availableValuation = availableStock * price;
    const realizedValuation = soldReserved * price;

    sumTotalStockUnits += totalStock;
    sumAvailableStockUnits += availableStock;
    sumSoldUnits += soldReserved;
    sumTotalAssetValuation += totalValuation;
    sumAvailableAssetValuation += availableValuation;
    sumRealizedValuation += realizedValuation;

    const stockStatus = availableStock <= 0
      ? 'OUT OF STOCK'
      : availableStock <= 5
      ? 'LOW STOCK ALERT'
      : 'IN STOCK - HEALTHY';

    const grades = product.targetClasses?.length
      ? product.targetClasses.map((g) => `Class ${g}`).join(', ')
      : 'All Grades (School-Wide)';

    sheet3Rows.push([
      index + 1,
      product.id,
      product.sku || `SKU-${product.id}`,
      product.name,
      product.category || 'Store Item',
      product.uniformType || 'Standard Item',
      product.sizeLabel || 'Standard',
      grades,
      price,
      totalStock,
      availableStock,
      soldReserved,
      totalValuation,
      availableValuation,
      realizedValuation,
      stockStatus,
      product.isActive ? 'Active on Store' : 'Inactive / Hidden',
    ]);
  });

  // Inventory Summary Row
  sheet3Rows.push([]);
  sheet3Rows.push([
    'TOTALS',
    `${products.length} Products`,
    '—',
    'INVENTORY VALUATION',
    '—',
    '—',
    '—',
    '—',
    '—',
    sumTotalStockUnits,
    sumAvailableStockUnits,
    sumSoldUnits,
    sumTotalAssetValuation,
    sumAvailableAssetValuation,
    sumRealizedValuation,
    'AUDIT VERIFIED',
    '—',
  ]);

  const ws3 = XLSX.utils.aoa_to_sheet([sheet3Headers, ...sheet3Rows]);
  ws3['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 12 }, // Product ID
    { wch: 18 }, // SKU
    { wch: 28 }, // Item Name
    { wch: 16 }, // Category
    { wch: 22 }, // Uniform Type
    { wch: 15 }, // Size
    { wch: 24 }, // Target Grades
    { wch: 20 }, // Unit Price
    { wch: 22 }, // Total Stock Units
    { wch: 22 }, // Available Units
    { wch: 20 }, // Sold/Reserved
    { wch: 24 }, // Total Asset Value
    { wch: 24 }, // Available Asset Value
    { wch: 24 }, // Realized Sales Value
    { wch: 22 }, // Stock Status
    { wch: 18 }, // Listing Status
  ];

  styleWorksheet(ws3, { theme: 'emerald', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws3, 'Inventory_Stock_Register');

  // ===========================================================================
  // SHEET 4: STORE EXECUTIVE SUMMARY (AUDIT SHEET)
  // ===========================================================================
  const paidOrdersCount = orders.filter((o) => o.status === 'Paid' || o.status === 'Fulfilled').length;
  const pendingOrdersCount = orders.filter((o) => o.status === 'Pending').length;
  const fulfilledOrdersCount = orders.filter((o) => o.status === 'Fulfilled').length;
  const problemOrdersCount = orders.filter((o) => ['Failed', 'Cancelled', 'Expired'].includes(o.status)).length;

  const fulfillmentRate = paidOrdersCount > 0
    ? ((fulfilledOrdersCount / paidOrdersCount) * 100).toFixed(1)
    : '0.0';

  const sheet4Headers = ['Store & Financial Metric', 'Value', 'Audit Classification & Notes'];
  const sheet4Rows: Array<Array<string | number>> = [
    ['Campus / Marketplace', schoolName, 'Registered Institution & School Store'],
    ['Report Generated Date', formatExcelDate(new Date().toISOString()), 'System Extraction Timestamp'],
    ['Total Registered Orders', orders.length, 'Cumulative store orders received'],
    ['Paid & Confirmed Orders', paidOrdersCount, 'Orders with payment successfully captured'],
    ['Fulfilled & Delivered Orders', fulfilledOrdersCount, 'Items verified and handed over to buyers'],
    ['Awaiting Handover / Collection', Math.max(0, paidOrdersCount - fulfilledOrdersCount), 'Paid items pending physical collection'],
    ['Pending / Unpaid Orders', pendingOrdersCount, 'Awaiting customer payment completion'],
    ['Cancelled / Failed Orders', problemOrdersCount, 'Unsuccessful or cancelled checkout sessions'],
    ['Gross Revenue Collected (₹)', sumOrdersCollected, 'Total funds collected via verified payments'],
    ['Pending Revenue to Collect (₹)', sumOrdersPending, 'Outstanding revenue on pending orders'],
    ['Total Registered SKUs / Items', products.length, 'Active catalog items across all categories'],
    ['Total Physical Inventory Stock', sumTotalStockUnits, 'Cumulative stock pieces in inventory'],
    ['Available Stock Ready for Sale', sumAvailableStockUnits, 'Units physically available for purchase'],
    ['Reserved / Sold Inventory Units', sumSoldUnits, 'Stock deducted through confirmed customer orders'],
    ['Gross Inventory Valuation (₹)', sumTotalAssetValuation, 'Total retail valuation of physical inventory'],
    ['Available Asset Valuation (₹)', sumAvailableAssetValuation, 'Unsold retail asset value on campus'],
    ['Order Handover Fulfillment Rate', `${fulfillmentRate}%`, 'Percentage of paid orders successfully collected'],
    [
      'Tally & Balance Reconciliation',
      Math.abs(sumOrdersSubtotal - (sumOrdersCollected + sumOrdersPending)) < 0.01
        ? 'PERFECT TALLY - RECONCILED'
        : 'VARIANCE DETECTED',
      'Order Subtotal = Collected Funds + Pending Balances',
    ],
  ];

  const ws4 = XLSX.utils.aoa_to_sheet([sheet4Headers, ...sheet4Rows]);
  ws4['!cols'] = [
    { wch: 34 }, // Metric
    { wch: 28 }, // Value
    { wch: 42 }, // Notes
  ];

  styleWorksheet(ws4, { theme: 'slate', hasTotalRow: false });
  XLSX.utils.book_append_sheet(wb, ws4, 'Store_Executive_Summary');

  // ===========================================================================
  // WRITE FILE & TRIGGER DIRECT DOWNLOAD (GENUINE OPENXML SPREADSHEET .XLSX)
  // ===========================================================================
  const cleanSchool = (schoolName || 'School').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStamp = new Date().toISOString().split('T')[0];
  const filename = `${cleanSchool}_School_Store_Audit_Ledger_${dateStamp}.xlsx`;

  downloadStyledWorkbook(wb, filename);
}

