import XLSX, { styleWorksheet, downloadStyledWorkbook } from './excelStyler';
import type {
  FeeStructure,
  FeeStructureItem,
  IndividualStudentFeeRecord,
  QuarterFeeDetail,
} from '../components/FeesModule';

export interface FeeInvoiceExportOptions {
  schoolName?: string;
  academicYear?: string;
  selectedClass?: string;
  studentRecords: IndividualStudentFeeRecord[];
  structures: FeeStructure[];
  getStudentFeeSummary: (record: IndividualStudentFeeRecord) => {
    items: FeeStructureItem[];
    quarters: QuarterFeeDetail[];
    baseComponentsTotal: number;
    transport: number;
    hostel: number;
    fine: number;
    scholarship: number;
    discount: number;
    totalFee: number;
    amountPaid: number;
    pendingBalance: number;
    status: 'Paid' | 'Partially Paid' | 'Unpaid';
  };
  quarterlyStats: Array<{
    quarter: string;
    name: string;
    dueDate: string;
    perStudentAmount: number;
    expected: number;
    collected: number;
    pending: number;
  }>;
  componentDistributionStats: Array<{
    category: string;
    totalAmount: number;
    studentCount: number;
  }>;
  classReportData: Array<{
    className: string;
    expected: number;
    collected: number;
    pending: number;
  }>;
}

/**
 * Generates and triggers download of a comprehensive, audit-grade
 * Excel (.xlsx) workbook for School Fee Invoicing & Reconciliation.
 *
 * Formatted with exact numbers, tally reconciliation checks,
 * itemized component breakdowns, receipt registers, and summary rows.
 */
export function exportFeeInvoicesToExcel(options: FeeInvoiceExportOptions): void {
  const {
    schoolName = 'School',
    academicYear = '2026-2027',
    selectedClass = 'All',
    studentRecords,
    getStudentFeeSummary,
    quarterlyStats,
    componentDistributionStats,
    classReportData,
  } = options;

  // Filter students if a specific class is selected, otherwise export all
  const isFiltered = selectedClass && selectedClass !== 'All';
  const targetStudents = isFiltered
    ? studentRecords.filter((r) => {
        const cleanRec = (r.class || '').replace(/^class\s*[-_]?/i, '').trim().toLowerCase();
        const cleanSel = selectedClass.replace(/^class\s*[-_]?/i, '').trim().toLowerCase();
        return cleanRec === cleanSel || (r.class || '').toLowerCase() === selectedClass.toLowerCase();
      })
    : studentRecords;

  const wb = XLSX.utils.book_new();

  // ---------------------------------------------------------------------------
  // 1. COLLECT ALL UNIQUE COMPONENT CATEGORIES ACROSS STUDENTS
  // ---------------------------------------------------------------------------
  const allComponentCategories = new Set<string>([
    'Tuition Fee',
    'Examination Fee',
    'Library Fee',
    'Activity Fee',
    'Lab Fee',
    'Sports Fee',
  ]);

  targetStudents.forEach((r) => {
    const summary = getStudentFeeSummary(r);
    summary.items.forEach((it) => {
      if (it.category) allComponentCategories.add(it.category.trim());
    });
  });

  const categoriesList = Array.from(allComponentCategories);

  // ---------------------------------------------------------------------------
  // SHEET 1: STUDENT FEE INVOICES & RECONCILIATION LEDGER
  // ---------------------------------------------------------------------------
  const sheet1Headers = [
    'S.No',
    'Admission No',
    'Student Name',
    'Class',
    'Section',
    'Academic Year',
    'Payment Status',
    ...categoriesList.map((cat) => `${cat} (₹)`),
    'Base Fees Total (₹)',
    'Transport Charges (₹)',
    'Hostel Charges (₹)',
    'Late Fine (₹)',
    'Scholarship (-) (₹)',
    'Discount (-) (₹)',
    'Net Invoiced Fee (₹)',
    'Amount Collected (₹)',
    'Pending Balance (₹)',
    'Tally Reconciliation Check',
    'Q1 Expected (₹)',
    'Q1 Collected (₹)',
    'Q2 Expected (₹)',
    'Q2 Collected (₹)',
    'Q3 Expected (₹)',
    'Q3 Collected (₹)',
    'Q4 Expected (₹)',
    'Q4 Collected (₹)',
    'Installments Paid Count',
    'Last Payment Date',
    'Last Receipt No',
    'Last Payment Mode',
  ];

  const sheet1Rows: Array<Array<string | number>> = [];

  // Running sum accumulators for Grand Total row
  const categorySums = new Map<string, number>();
  categoriesList.forEach((c) => categorySums.set(c, 0));
  let sumBase = 0;
  let sumTransport = 0;
  let sumHostel = 0;
  let sumFine = 0;
  let sumScholarship = 0;
  let sumDiscount = 0;
  let sumNetInvoiced = 0;
  let sumCollected = 0;
  let sumPending = 0;
  let sumQ1Exp = 0;
  let sumQ1Col = 0;
  let sumQ2Exp = 0;
  let sumQ2Col = 0;
  let sumQ3Exp = 0;
  let sumQ3Col = 0;
  let sumQ4Exp = 0;
  let sumQ4Col = 0;

  targetStudents.forEach((record, index) => {
    const summary = getStudentFeeSummary(record);

    // Component map for this student
    const itemMap = new Map<string, number>();
    summary.items.forEach((it) => {
      itemMap.set(it.category.trim(), Number(it.amount) || 0);
    });

    const categoryValues = categoriesList.map((cat) => {
      const val = itemMap.get(cat) || 0;
      categorySums.set(cat, (categorySums.get(cat) || 0) + val);
      return val;
    });

    sumBase += summary.baseComponentsTotal;
    sumTransport += summary.transport;
    sumHostel += summary.hostel;
    sumFine += summary.fine;
    sumScholarship += summary.scholarship;
    sumDiscount += summary.discount;
    sumNetInvoiced += summary.totalFee;
    sumCollected += summary.amountPaid;
    sumPending += summary.pendingBalance;

    // Quarters breakdown
    const q1 = summary.quarters[0] || { amount: 0 };
    const q2 = summary.quarters[1] || { amount: 0 };
    const q3 = summary.quarters[2] || { amount: 0 };
    const q4 = summary.quarters[3] || { amount: 0 };

    // Calculate proportional payment per quarter
    let remPaid = summary.amountPaid;
    const q1Col = Math.min(Number(q1.amount) || 0, remPaid);
    remPaid = Math.max(0, remPaid - q1Col);
    const q2Col = Math.min(Number(q2.amount) || 0, remPaid);
    remPaid = Math.max(0, remPaid - q2Col);
    const q3Col = Math.min(Number(q3.amount) || 0, remPaid);
    remPaid = Math.max(0, remPaid - q3Col);
    const q4Col = Math.min(Number(q4.amount) || 0, remPaid);

    sumQ1Exp += Number(q1.amount) || 0;
    sumQ1Col += q1Col;
    sumQ2Exp += Number(q2.amount) || 0;
    sumQ2Col += q2Col;
    sumQ3Exp += Number(q3.amount) || 0;
    sumQ3Col += q3Col;
    sumQ4Exp += Number(q4.amount) || 0;
    sumQ4Col += q4Col;

    // Tally verification: Invoiced must equal Collected + Pending
    const isTallied = Math.abs(summary.totalFee - (summary.amountPaid + summary.pendingBalance)) < 0.01;
    const tallyStatus = isTallied
      ? summary.pendingBalance === 0
        ? 'TALLIED - Fully Settled'
        : `TALLIED - Balance ₹${summary.pendingBalance.toLocaleString('en-IN')}`
      : 'MISMATCH - Recheck Record';

    // Last payment info
    const lastPayment = record.paymentHistory.length > 0
      ? record.paymentHistory[record.paymentHistory.length - 1]
      : null;

    sheet1Rows.push([
      index + 1,
      record.admissionNo || '',
      record.studentName || '',
      record.class ? `Class ${record.class.replace(/^class\s*[-_]?/i, '')}` : '',
      record.section || 'A',
      record.academicYear || academicYear,
      summary.status,
      ...categoryValues,
      summary.baseComponentsTotal,
      summary.transport,
      summary.hostel,
      summary.fine,
      summary.scholarship,
      summary.discount,
      summary.totalFee,
      summary.amountPaid,
      summary.pendingBalance,
      tallyStatus,
      Number(q1.amount) || 0,
      q1Col,
      Number(q2.amount) || 0,
      q2Col,
      Number(q3.amount) || 0,
      q3Col,
      Number(q4.amount) || 0,
      q4Col,
      record.paymentHistory.length,
      lastPayment?.paymentDate || '—',
      lastPayment?.receiptNo || '—',
      lastPayment?.paymentMethod || '—',
    ]);
  });

  // GRAND TOTAL / TALLY ROW
  const isGlobalTallied = Math.abs(sumNetInvoiced - (sumCollected + sumPending)) < 0.01;
  const grandTotalRow: Array<string | number> = [
    'TOTALS',
    `${targetStudents.length} Students`,
    'Grand Total / Audit Reconciliation',
    isFiltered ? `Class ${selectedClass}` : 'All Classes',
    '—',
    academicYear,
    `Paid: ₹${sumCollected.toLocaleString('en-IN')}`,
    ...categoriesList.map((cat) => categorySums.get(cat) || 0),
    sumBase,
    sumTransport,
    sumHostel,
    sumFine,
    sumScholarship,
    sumDiscount,
    sumNetInvoiced,
    sumCollected,
    sumPending,
    isGlobalTallied
      ? `PERFECT TALLY (Invoiced ₹${sumNetInvoiced.toLocaleString('en-IN')} = Collected ₹${sumCollected.toLocaleString('en-IN')} + Dues ₹${sumPending.toLocaleString('en-IN')})`
      : 'DISCREPANCY DETECTED',
    sumQ1Exp,
    sumQ1Col,
    sumQ2Exp,
    sumQ2Col,
    sumQ3Exp,
    sumQ3Col,
    sumQ4Exp,
    sumQ4Col,
    '—',
    '—',
    '—',
    '—',
  ];

  const ws1 = XLSX.utils.aoa_to_sheet([sheet1Headers, ...sheet1Rows, grandTotalRow]);
  ws1['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 14 }, // Admission No
    { wch: 22 }, // Student Name
    { wch: 12 }, // Class
    { wch: 8 },  // Section
    { wch: 14 }, // Academic Year
    { wch: 14 }, // Status
    ...categoriesList.map(() => ({ wch: 16 })), // Categories
    { wch: 18 }, // Base Total
    { wch: 18 }, // Transport
    { wch: 16 }, // Hostel
    { wch: 14 }, // Fine
    { wch: 16 }, // Scholarship
    { wch: 16 }, // Discount
    { wch: 18 }, // Net Invoiced
    { wch: 18 }, // Collected
    { wch: 18 }, // Pending Balance
    { wch: 32 }, // Tally Check
    { wch: 14 }, // Q1 Exp
    { wch: 14 }, // Q1 Col
    { wch: 14 }, // Q2 Exp
    { wch: 14 }, // Q2 Col
    { wch: 14 }, // Q3 Exp
    { wch: 14 }, // Q3 Col
    { wch: 14 }, // Q4 Exp
    { wch: 14 }, // Q4 Col
    { wch: 18 }, // Installments
    { wch: 16 }, // Last Date
    { wch: 16 }, // Last Receipt
    { wch: 16 }, // Last Mode
  ];

  styleWorksheet(ws1, { theme: 'navy', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws1, 'Fee_Invoices_Ledger');

  // ---------------------------------------------------------------------------
  // SHEET 2: PAYMENT RECEIPTS & CASH/BANK TRANSACTION LOG
  // ---------------------------------------------------------------------------
  const sheet2Headers = [
    'S.No',
    'Receipt No',
    'Payment Date',
    'Admission No',
    'Student Name',
    'Class',
    'Section',
    'Payment Mode',
    'Category / Installment',
    'Transaction / Gateway ID',
    'Amount Paid (₹)',
  ];

  const sheet2Rows: Array<Array<string | number>> = [];
  let receiptSNo = 1;
  let totalReceiptsAmount = 0;

  targetStudents.forEach((record) => {
    record.paymentHistory.forEach((payment) => {
      const amt = Number(payment.amountPaid) || 0;
      totalReceiptsAmount += amt;

      sheet2Rows.push([
        receiptSNo++,
        payment.receiptNo || `REC-${payment.id.slice(-6).toUpperCase()}`,
        payment.paymentDate || '—',
        record.admissionNo || '—',
        record.studentName || '—',
        record.class ? `Class ${record.class.replace(/^class\s*[-_]?/i, '')}` : '—',
        record.section || 'A',
        payment.paymentMethod || 'Cash',
        payment.category || payment.installmentType || 'Tuition / Installment',
        payment.transactionId || '—',
        amt,
      ]);
    });
  });

  const sheet2TotalRow: Array<string | number> = [
    'TOTAL',
    `${sheet2Rows.length} Receipts Issued`,
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    'Grand Total Collected',
    totalReceiptsAmount,
  ];

  const ws2 = XLSX.utils.aoa_to_sheet([
    sheet2Headers,
    ...sheet2Rows,
    sheet2Rows.length > 0 ? sheet2TotalRow : ['No payments recorded yet'],
  ]);
  ws2['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 18 }, // Receipt No
    { wch: 14 }, // Date
    { wch: 16 }, // Admission No
    { wch: 22 }, // Student Name
    { wch: 12 }, // Class
    { wch: 8 },  // Section
    { wch: 16 }, // Payment Mode
    { wch: 22 }, // Category
    { wch: 24 }, // Transaction ID
    { wch: 18 }, // Amount Paid
  ];

  styleWorksheet(ws2, { theme: 'emerald', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws2, 'Payment_Receipts_Log');

  // ---------------------------------------------------------------------------
  // SHEET 3: QUARTERLY FEE SET & COLLECTION TALLY (Matches UI Section)
  // ---------------------------------------------------------------------------
  const sheet3Headers = [
    'Quarter Ref',
    'Quarter Name / Schedule',
    'Due Date',
    'Target Students Count',
    'Per Student Amount (₹)',
    'Expected Revenue (₹)',
    'Collected Revenue (₹)',
    'Pending Dues (₹)',
    'Collection %',
    'Tally Status',
  ];

  const sheet3Rows: Array<Array<string | number>> = [];
  let qTotalExp = 0;
  let qTotalCol = 0;
  let qTotalPen = 0;

  quarterlyStats.forEach((q) => {
    qTotalExp += q.expected;
    qTotalCol += q.collected;
    qTotalPen += q.pending;

    const rate = q.expected > 0 ? Math.round((q.collected / q.expected) * 100) : 0;
    const isQTallied = Math.abs(q.expected - (q.collected + q.pending)) < 0.01;

    sheet3Rows.push([
      q.quarter,
      q.name,
      q.dueDate,
      targetStudents.length,
      q.perStudentAmount,
      q.expected,
      q.collected,
      q.pending,
      `${rate}%`,
      isQTallied ? 'TALLIED (Expected = Collected + Pending)' : 'CHECK VARIANCE',
    ]);
  });

  const qOverallRate = qTotalExp > 0 ? Math.round((qTotalCol / qTotalExp) * 100) : 0;
  const sheet3TotalRow: Array<string | number> = [
    'TOTAL',
    'Full Academic Year (Q1 to Q4)',
    '—',
    targetStudents.length,
    targetStudents.length > 0 ? Math.round(qTotalExp / targetStudents.length) : 0,
    qTotalExp,
    qTotalCol,
    qTotalPen,
    `${qOverallRate}%`,
    Math.abs(qTotalExp - (qTotalCol + qTotalPen)) < 0.01 ? 'TALLIED' : 'VARIANCE',
  ];

  const ws3 = XLSX.utils.aoa_to_sheet([sheet3Headers, ...sheet3Rows, sheet3TotalRow]);
  ws3['!cols'] = [
    { wch: 12 }, // Quarter Ref
    { wch: 28 }, // Quarter Name
    { wch: 14 }, // Due Date
    { wch: 20 }, // Students Count
    { wch: 20 }, // Per Student Amount
    { wch: 20 }, // Expected
    { wch: 20 }, // Collected
    { wch: 20 }, // Pending
    { wch: 14 }, // Collection %
    { wch: 32 }, // Tally Status
  ];

  styleWorksheet(ws3, { theme: 'indigo', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws3, 'Quarterly_Collection_Tally');

  // ---------------------------------------------------------------------------
  // SHEET 4: FEE COMPONENT ALLOCATION DISTRIBUTION
  // ---------------------------------------------------------------------------
  const sheet4Headers = [
    'S.No',
    'Fee Component Category',
    'Assigned Students Count',
    'Total Allocated Amount (₹)',
    'Avg Per Student (₹)',
    'Share of Budget (%)',
  ];

  const sheet4Rows: Array<Array<string | number>> = [];
  const compTotal = componentDistributionStats.reduce((s, c) => s + c.totalAmount, 0);

  componentDistributionStats.forEach((comp, idx) => {
    const avg = comp.studentCount > 0 ? Math.round(comp.totalAmount / comp.studentCount) : 0;
    const share = compTotal > 0 ? ((comp.totalAmount / compTotal) * 100).toFixed(1) : '0';

    sheet4Rows.push([
      idx + 1,
      comp.category,
      comp.studentCount,
      comp.totalAmount,
      avg,
      `${share}%`,
    ]);
  });

  const sheet4TotalRow: Array<string | number> = [
    'TOTAL',
    'All Fee Components Combined',
    targetStudents.length,
    compTotal,
    targetStudents.length > 0 ? Math.round(compTotal / targetStudents.length) : 0,
    '100.0%',
  ];

  const ws4 = XLSX.utils.aoa_to_sheet([sheet4Headers, ...sheet4Rows, sheet4TotalRow]);
  ws4['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 26 }, // Component Category
    { wch: 24 }, // Assigned Students Count
    { wch: 24 }, // Total Allocated Amount
    { wch: 20 }, // Avg Per Student
    { wch: 18 }, // Share of Budget
  ];

  styleWorksheet(ws4, { theme: 'teal', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws4, 'Component_Distribution');

  // ---------------------------------------------------------------------------
  // SHEET 5: CLASS-LEVEL FINANCIAL SUMMARY
  // ---------------------------------------------------------------------------
  const sheet5Headers = [
    'Class Name',
    'Total Students',
    'Fully Paid Students',
    'Partially Paid Students',
    'Unpaid Students',
    'Expected Revenue (₹)',
    'Collected Revenue (₹)',
    'Pending Dues (₹)',
    'Collection Recovery Rate (%)',
    'Reconciliation Status',
  ];

  const sheet5Rows: Array<Array<string | number>> = [];
  let classTotalExp = 0;
  let classTotalCol = 0;
  let classTotalPen = 0;
  let classTotalStudents = 0;
  let classTotalPaidCount = 0;
  let classTotalPartialCount = 0;
  let classTotalUnpaidCount = 0;

  classReportData.forEach((row) => {
    const classStudents = studentRecords.filter((r) => {
      const formatted = r.class ? `Class ${r.class.replace(/^class\s*[-_]?/i, '')}` : '';
      return formatted === row.className || r.class === row.className;
    });

    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;

    classStudents.forEach((st) => {
      const summary = getStudentFeeSummary(st);
      if (summary.status === 'Paid') paidCount++;
      else if (summary.status === 'Partially Paid') partialCount++;
      else unpaidCount++;
    });

    classTotalStudents += classStudents.length;
    classTotalPaidCount += paidCount;
    classTotalPartialCount += partialCount;
    classTotalUnpaidCount += unpaidCount;
    classTotalExp += row.expected;
    classTotalCol += row.collected;
    classTotalPen += row.pending;

    const rate = row.expected > 0 ? Math.round((row.collected / row.expected) * 100) : 0;
    const isClassTallied = Math.abs(row.expected - (row.collected + row.pending)) < 0.01;

    sheet5Rows.push([
      row.className,
      classStudents.length,
      paidCount,
      partialCount,
      unpaidCount,
      row.expected,
      row.collected,
      row.pending,
      `${rate}%`,
      isClassTallied ? 'TALLIED' : 'CHECK VARIANCE',
    ]);
  });

  const classOverallRate = classTotalExp > 0 ? Math.round((classTotalCol / classTotalExp) * 100) : 0;
  const sheet5TotalRow: Array<string | number> = [
    'School-Wide Totals',
    classTotalStudents,
    classTotalPaidCount,
    classTotalPartialCount,
    classTotalUnpaidCount,
    classTotalExp,
    classTotalCol,
    classTotalPen,
    `${classOverallRate}%`,
    Math.abs(classTotalExp - (classTotalCol + classTotalPen)) < 0.01 ? 'TALLIED' : 'VARIANCE',
  ];

  const ws5 = XLSX.utils.aoa_to_sheet([sheet5Headers, ...sheet5Rows, sheet5TotalRow]);
  ws5['!cols'] = [
    { wch: 18 }, // Class Name
    { wch: 16 }, // Total Students
    { wch: 18 }, // Paid Students
    { wch: 20 }, // Partial Students
    { wch: 16 }, // Unpaid Students
    { wch: 20 }, // Expected Revenue
    { wch: 20 }, // Collected Revenue
    { wch: 20 }, // Pending Dues
    { wch: 24 }, // Collection %
    { wch: 20 }, // Reconciliation Status
  ];

  styleWorksheet(ws5, { theme: 'slate', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws5, 'Class_Financial_Summary');

  // ---------------------------------------------------------------------------
  // GENERATE AND TRIGGER FILE DOWNLOAD (PROPER EXCEL OPENXML .XLSX FORMAT)
  // ---------------------------------------------------------------------------
  // Clean file name avoiding any slashes, colons, or special characters
  const cleanSchool = (schoolName || 'School').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanYear = (academicYear || '2026-2027').replace(/[^a-zA-Z0-9]/g, '-');
  const classTag = isFiltered ? `_Class_${selectedClass.replace(/[^a-zA-Z0-9]/g, '')}` : '_All_Classes';
  const dateStamp = new Date().toISOString().split('T')[0];
  const filename = `${cleanSchool}_Fees_Invoices_${cleanYear}${classTag}_${dateStamp}.xlsx`;

  downloadStyledWorkbook(wb, filename);
}

