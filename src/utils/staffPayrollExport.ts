import XLSX, { styleWorksheet, downloadStyledWorkbook } from './excelStyler';
import type { StaffSalaryPayment } from '../store/api/staffSalaryApi';

export interface StaffPayrollExportRow {
  teacher: {
    id: number | string;
    name: string;
    email: string;
    phone: string;
    subjects?: string[];
    qualification?: string;
    joiningDate?: string;
    salary?: string | number | null;
  };
  fixedSalary: number;
  payment?: StaffSalaryPayment;
  isPaid: boolean;
}

export interface StaffPayrollExportOptions {
  schoolName?: string;
  month: number;
  year: number;
  monthName: string;
  rows: StaffPayrollExportRow[];
  stats: {
    totalPayroll: number;
    totalPaid: number;
    totalPending: number;
    paidCount: number;
    totalCount: number;
  };
}

/**
 * Generates and triggers download of a comprehensive, audit-grade
 * Excel (.xlsx) workbook for Staff Salary & Payroll Reconciliation.
 *
 * Formatted with exact numeric values, tally reconciliation checks,
 * payment logs, and executive summary rows.
 */
export function exportStaffPayrollToExcel(options: StaffPayrollExportOptions): void {
  const {
    schoolName = 'School Management Portal',
    month,
    year,
    monthName,
    rows,
    stats,
  } = options;

  const wb = XLSX.utils.book_new();

  // ---------------------------------------------------------------------------
  // SHEET 1: STAFF PAYROLL REGISTER (MASTER SALARY & RECONCILIATION SHEET)
  // ---------------------------------------------------------------------------
  const sheet1Headers = [
    'S.No',
    'Teacher ID',
    'Teacher Name',
    'Email Address',
    'Phone Number',
    'Subjects / Specialization',
    'Qualification',
    'Joining Date',
    'Payroll Month',
    'Payroll Year',
    'Fixed Monthly Salary (₹)',
    'Disbursement Status',
    'Amount Disbursed (₹)',
    'Pending Balance (₹)',
    'Tally Reconciliation Check',
    'Payment Date',
    'Payment Mode',
    'Transaction / UTR Reference',
    'Receipt Number',
    'Disbursed By',
    'Payment Notes',
  ];

  const sheet1Rows: Array<Array<string | number>> = [];

  let sumFixedSalary = 0;
  let sumDisbursed = 0;
  let sumPending = 0;

  rows.forEach((row, index) => {
    const fixedSal = Number(row.fixedSalary) || 0;
    const disbursed = row.isPaid && row.payment ? Number(row.payment.amount) || 0 : 0;
    const pending = Math.max(0, fixedSal - disbursed);

    sumFixedSalary += fixedSal;
    sumDisbursed += disbursed;
    sumPending += pending;

    const subjectsStr = Array.isArray(row.teacher.subjects) && row.teacher.subjects.length > 0
      ? row.teacher.subjects.join(', ')
      : 'General Teaching';

    const isRowTallied = Math.abs(fixedSal - (disbursed + pending)) < 0.01;
    const tallyCheck = isRowTallied
      ? row.isPaid
        ? 'TALLIED - Disbursed & Cleared'
        : `TALLIED - Pending ₹${pending.toLocaleString('en-IN')}`
      : 'DISCREPANCY - Recheck Record';

    sheet1Rows.push([
      index + 1,
      row.teacher.id ? String(row.teacher.id) : `TCH-${index + 1}`,
      row.teacher.name || 'Teacher',
      row.teacher.email || '—',
      row.teacher.phone || '—',
      subjectsStr,
      row.teacher.qualification || '—',
      row.teacher.joiningDate || '—',
      monthName,
      year,
      fixedSal,
      row.isPaid ? 'Paid' : 'Pending',
      disbursed,
      pending,
      tallyCheck,
      row.payment?.paymentDate || '—',
      row.payment?.paymentMethod || (row.isPaid ? 'Bank Transfer' : '—'),
      row.payment?.referenceNumber || '—',
      row.payment?.receiptNumber || '—',
      row.payment?.paidByName || (row.isPaid ? 'School Admin' : '—'),
      row.payment?.notes || '—',
    ]);
  });

  // GRAND TOTAL / TALLY RECONCILIATION ROW
  const isGlobalTallied = Math.abs(sumFixedSalary - (sumDisbursed + sumPending)) < 0.01;
  const grandTotalRow: Array<string | number> = [
    'TOTALS',
    `${rows.length} Active Staff`,
    'Grand Total Payroll Disbursement',
    '—',
    '—',
    '—',
    '—',
    '—',
    monthName,
    year,
    sumFixedSalary,
    `${stats.paidCount} of ${stats.totalCount} Disbursed`,
    sumDisbursed,
    sumPending,
    isGlobalTallied
      ? `PERFECT TALLY (Payroll ₹${sumFixedSalary.toLocaleString('en-IN')} = Disbursed ₹${sumDisbursed.toLocaleString('en-IN')} + Pending ₹${sumPending.toLocaleString('en-IN')})`
      : 'DISCREPANCY DETECTED',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
  ];

  const ws1 = XLSX.utils.aoa_to_sheet([sheet1Headers, ...sheet1Rows, grandTotalRow]);
  ws1['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 12 }, // Teacher ID
    { wch: 22 }, // Teacher Name
    { wch: 24 }, // Email
    { wch: 16 }, // Phone
    { wch: 26 }, // Subjects
    { wch: 16 }, // Qualification
    { wch: 14 }, // Joining Date
    { wch: 14 }, // Month
    { wch: 12 }, // Year
    { wch: 22 }, // Fixed Salary
    { wch: 18 }, // Status
    { wch: 20 }, // Disbursed
    { wch: 20 }, // Pending
    { wch: 34 }, // Tally Check
    { wch: 14 }, // Payment Date
    { wch: 18 }, // Payment Mode
    { wch: 26 }, // Reference Number
    { wch: 24 }, // Receipt Number
    { wch: 18 }, // Disbursed By
    { wch: 24 }, // Notes
  ];

  styleWorksheet(ws1, { theme: 'navy', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws1, 'Staff_Payroll_Register');

  // ---------------------------------------------------------------------------
  // SHEET 2: DISBURSEMENT RECEIPTS LOG (JOURNAL OF COMPLETED PAYMENTS)
  // ---------------------------------------------------------------------------
  const sheet2Headers = [
    'S.No',
    'Receipt Number',
    'Payment Date',
    'Teacher ID',
    'Teacher Name',
    'Email Address',
    'Phone Number',
    'Payment Mode',
    'Transaction / UTR Reference',
    'Amount Disbursed (₹)',
    'Disbursed By',
    'Notes / Remarks',
  ];

  const sheet2Rows: Array<Array<string | number>> = [];
  let receiptSNo = 1;
  let totalReceiptsAmount = 0;

  rows.forEach((row) => {
    if (row.isPaid && row.payment) {
      const amt = Number(row.payment.amount) || 0;
      totalReceiptsAmount += amt;

      sheet2Rows.push([
        receiptSNo++,
        row.payment.receiptNumber || `RCPT-SAL-${row.payment.id}`,
        row.payment.paymentDate || '—',
        String(row.teacher.id),
        row.teacher.name,
        row.teacher.email || '—',
        row.teacher.phone || '—',
        row.payment.paymentMethod || 'Bank Transfer',
        row.payment.referenceNumber || '—',
        amt,
        row.payment.paidByName || 'School Admin',
        row.payment.notes || '—',
      ]);
    }
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
    'Total Disbursed',
    totalReceiptsAmount,
    '—',
    '—',
  ];

  const ws2 = XLSX.utils.aoa_to_sheet([
    sheet2Headers,
    ...sheet2Rows,
    sheet2Rows.length > 0 ? sheet2TotalRow : ['No disbursed salary receipts found for this period'],
  ]);

  ws2['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 24 }, // Receipt No
    { wch: 14 }, // Date
    { wch: 12 }, // Teacher ID
    { wch: 22 }, // Teacher Name
    { wch: 24 }, // Email
    { wch: 16 }, // Phone
    { wch: 18 }, // Mode
    { wch: 26 }, // Reference
    { wch: 20 }, // Amount Paid
    { wch: 18 }, // Paid By
    { wch: 24 }, // Notes
  ];

  styleWorksheet(ws2, { theme: 'emerald', hasTotalRow: true });
  XLSX.utils.book_append_sheet(wb, ws2, 'Disbursement_Receipts_Log');

  // ---------------------------------------------------------------------------
  // SHEET 3: MONTHLY PAYROLL EXECUTIVE SUMMARY (AUDIT SHEET)
  // ---------------------------------------------------------------------------
  const completionRate = stats.totalPayroll > 0
    ? ((stats.totalPaid / stats.totalPayroll) * 100).toFixed(1)
    : '0.0';

  const sheet3Headers = ['Payroll Metric', 'Value', 'Audit Status & Notes'];
  const sheet3Rows: Array<Array<string | number>> = [
    ['School / Institution', schoolName, 'Registered Institution'],
    ['Payroll Period', `${monthName} ${year}`, 'Current Billing Cycle'],
    ['Total Eligible Staff Members', stats.totalCount, 'Active Teachers on Payroll'],
    ['Salaries Disbursed (Paid)', stats.paidCount, `${stats.paidCount} staff members paid`],
    ['Salaries Pending (Awaiting Payment)', stats.totalPending > 0 ? stats.totalCount - stats.paidCount : 0, 'Pending disbursement'],
    ['Total Monthly Payroll Budget (₹)', stats.totalPayroll, 'Expected monthly commitment'],
    ['Total Amount Disbursed (₹)', stats.totalPaid, 'Actual funds transferred'],
    ['Total Pending Liability (₹)', stats.totalPending, 'Outstanding balance to be paid'],
    ['Disbursement Completion Rate', `${completionRate}%`, 'Collection / Disbursal progress'],
    ['Audit Reconciliation Check', isGlobalTallied ? 'PERFECT TALLY' : 'AUDIT MISMATCH', 'Total Budget = Disbursed + Pending'],
  ];

  const ws3 = XLSX.utils.aoa_to_sheet([sheet3Headers, ...sheet3Rows]);
  ws3['!cols'] = [
    { wch: 32 }, // Metric
    { wch: 26 }, // Value
    { wch: 36 }, // Notes
  ];

  styleWorksheet(ws3, { theme: 'indigo', hasTotalRow: false });
  XLSX.utils.book_append_sheet(wb, ws3, 'Payroll_Executive_Summary');

  // ---------------------------------------------------------------------------
  // GENERATE AND TRIGGER FILE DOWNLOAD (GENUINE EXCEL OPENXML .XLSX)
  // ---------------------------------------------------------------------------
  const cleanSchool = (schoolName || 'School').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanMonth = monthName.replace(/[^a-zA-Z0-9]/g, '');
  const dateStamp = new Date().toISOString().split('T')[0];
  const filename = `${cleanSchool}_Staff_Payroll_${cleanMonth}_${year}_${dateStamp}.xlsx`;

  downloadStyledWorkbook(wb, filename);
}

