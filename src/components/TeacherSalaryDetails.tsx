import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Wallet,
  Receipt,
  Download,
  Printer,
  CheckCircle2,
  Clock,
  Calendar,
  DollarSign,
  Building,
  User,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { useGetTeachersQuery } from '../store/api/teacherApi';
import {
  useGetStaffSalariesQuery,
  type StaffSalaryPayment,
} from '../store/api/staffSalaryApi';

interface TeacherSalaryDetailsProps {
  user?: any;
  schoolName?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const LOCAL_STORAGE_KEY = 'erp_staff_salaries';

function loadLocalSalaries(): StaffSalaryPayment[] {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export default function TeacherSalaryDetails({ user, schoolName = 'School Management Portal' }: TeacherSalaryDetailsProps) {
  const isServerBacked = Boolean(localStorage.getItem('school_erp_api_token'));
  const currentYear = new Date().getFullYear();
  const currentMonthIdx = new Date().getMonth(); // 0-indexed
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [viewingReceipt, setViewingReceipt] = useState<StaffSalaryPayment | null>(null);

  // Fetch teacher profile to get fixed salary
  const { data: teachers = [] } = useGetTeachersQuery(undefined, { skip: !isServerBacked });
  const currentTeacher = useMemo(() => {
    if (isServerBacked && teachers.length) {
      return (
        teachers.find((t) => t.email?.toLowerCase() === user?.email?.toLowerCase()) ||
        null
      );
    }
    try {
      const raw = localStorage.getItem('erp_teachers');
      if (raw) {
        const parsed = JSON.parse(raw);
        return (
          parsed.find((t: any) => t.email?.toLowerCase() === user?.email?.toLowerCase()) ||
          null
        );
      }
    } catch {
      return null;
    }
    return null;
  }, [teachers, user, isServerBacked]);

  // Fetch salary payments for this teacher and selected year
  const { data: serverSalaries = [] } = useGetStaffSalariesQuery(
    { year: selectedYear },
    { skip: !isServerBacked }
  );

  const localSalaries = loadLocalSalaries();
  const rawSalaries = isServerBacked ? serverSalaries : localSalaries;

  // Filter salaries for current teacher
  const teacherSalaries = useMemo(() => {
    if (!currentTeacher) return [];
    return rawSalaries.filter(
      (s) => Number(s.teacherId) === Number(currentTeacher.id) && Number(s.year) === selectedYear
    );
  }, [rawSalaries, currentTeacher, selectedYear]);

  const fixedSalary = currentTeacher?.salary ? Number(currentTeacher.salary) : 0;

  // Generate 12 months status
  const monthlyBreakdown = useMemo(() => {
    return MONTHS.map((monthName, idx) => {
      const monthNumber = idx + 1;
      const payment = teacherSalaries.find((s) => Number(s.month) === monthNumber && s.status === 'Paid');
      const isPaid = Boolean(payment);

      return {
        monthNumber,
        monthName,
        isCurrentMonth: idx === currentMonthIdx && selectedYear === currentYear,
        isPastOrCurrent: selectedYear < currentYear || (selectedYear === currentYear && idx <= currentMonthIdx),
        isPaid,
        payment,
        amount: isPaid && payment ? Number(payment.amount) : fixedSalary,
      };
    });
  }, [teacherSalaries, fixedSalary, selectedYear, currentYear, currentMonthIdx]);

  // Summary Metrics
  const summary = useMemo(() => {
    const totalDisbursed = monthlyBreakdown.reduce(
      (acc, m) => acc + (m.isPaid && m.payment ? Number(m.payment.amount) : 0),
      0
    );
    const paidMonthsCount = monthlyBreakdown.filter((m) => m.isPaid).length;
    const currentMonthStatus = monthlyBreakdown[currentMonthIdx]?.isPaid ? 'Paid' : 'Pending';

    return { totalDisbursed, paidMonthsCount, currentMonthStatus };
  }, [monthlyBreakdown, currentMonthIdx]);

  const handleDownloadReceipt = (receipt: StaffSalaryPayment) => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Salary Receipt - ${receipt.receiptNumber}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; }
          .receipt-box { max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .header { text-align: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; }
          .title { font-size: 11px; font-weight: 800; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.1em; }
          .school-name { font-size: 22px; font-weight: 900; margin: 8px 0 4px; color: #0f172a; }
          .receipt-no { font-size: 13px; color: #64748b; font-family: monospace; }
          .details { margin: 24px 0; font-size: 14px; }
          .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f8fafc; }
          .label { color: #64748b; font-weight: 500; }
          .val { font-weight: 700; color: #0f172a; }
          .amount-box { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
          .amount-label { font-size: 11px; font-weight: 800; color: #047857; text-transform: uppercase; }
          .amount-val { font-size: 28px; font-weight: 900; color: #065f46; margin: 4px 0; }
          .status { font-size: 11px; font-weight: 800; color: #059669; }
          .footer { margin-top: 30px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; color: #94a3b8; }
          .signature-line { border-top: 1px solid #cbd5e1; width: 160px; text-align: center; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="receipt-box">
          <div class="header">
            <div class="title">Official Staff Salary Receipt / Payslip</div>
            <div class="school-name">${schoolName}</div>
            <div class="receipt-no">${receipt.receiptNumber}</div>
          </div>
          <div class="details">
            <div class="row"><span class="label">Teacher Name:</span><span class="val">${receipt.teacherName || user?.name || 'Teacher'}</span></div>
            <div class="row"><span class="label">Teacher Email:</span><span class="val">${receipt.teacherEmail || user?.email || '-'}</span></div>
            <div class="row"><span class="label">Phone:</span><span class="val">${receipt.teacherPhone || '-'}</span></div>
            <div class="row"><span class="label">Salary Month:</span><span class="val">${MONTHS[receipt.month - 1]} ${receipt.year}</span></div>
            <div class="row"><span class="label">Payment Date:</span><span class="val">${receipt.paymentDate}</span></div>
            <div class="row"><span class="label">Payment Mode:</span><span class="val">${receipt.paymentMethod}</span></div>
            ${receipt.referenceNumber ? `<div class="row"><span class="label">Transaction Reference:</span><span class="val">${receipt.referenceNumber}</span></div>` : ''}
          </div>
          <div class="amount-box">
            <div class="amount-label">Net Salary Disbursed</div>
            <div class="amount-val">₹${Number(receipt.amount).toLocaleString('en-IN')}</div>
            <div class="status">STATUS: CLEARED & DISBURSED</div>
          </div>
          <div class="footer">
            <div>Generated on: ${new Date().toLocaleDateString()}</div>
            <div class="signature-line">Authorized Signatory</div>
          </div>
        </div>
      </body>
      </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Salary_Receipt_${MONTHS[receipt.month - 1]}_${receipt.year}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans pb-12" id="salary-details-page">
      {/* Header Banner */}
      <header className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 shadow-2xs">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  Teacher Payroll &amp; Disbursements
                </span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-semibold text-slate-500 font-mono">{schoolName}</span>
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                My Salary Details &amp; Payment Receipts
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-xl font-medium">
                Review your monthly salary disbursement history, status, and download official payment receipts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2 shrink-0 self-start lg:self-center shadow-2xs">
            <Calendar className="h-4 w-4 text-indigo-600" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Academic Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-black text-slate-900 outline-none cursor-pointer"
            >
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs transition-all hover:shadow-md hover:border-indigo-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fixed Monthly Salary</span>
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900 tracking-tight">
            ₹{fixedSalary.toLocaleString('en-IN')}
          </p>
          <p className="mt-1.5 text-xs text-indigo-600 font-bold">Configured official salary</p>
        </div>

        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs transition-all hover:shadow-md hover:border-emerald-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Received ({selectedYear})</span>
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-2xs">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900 tracking-tight">
            ₹{summary.totalDisbursed.toLocaleString('en-IN')}
          </p>
          <p className="mt-1.5 text-xs text-emerald-600 font-bold">
            {summary.paidMonthsCount} of 12 months cleared
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs transition-all hover:shadow-md hover:border-indigo-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Month ({MONTHS[currentMonthIdx]})</span>
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {summary.currentMonthStatus === 'Paid' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-black text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                PAID
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1 text-xs font-black text-amber-700 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                PENDING DISBURSEMENT
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-400 font-medium">Synchronized from campus accounts</p>
        </div>
      </div>

      {/* Monthly Salary Breakdown Table */}
      <div className="rounded-3xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-100 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-indigo-600" />
              Monthly Breakdown ({selectedYear})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">Detailed disbursement history and digital salary receipts for each month.</p>
          </div>
          <span className="rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold px-3 py-1 text-xs font-mono self-start sm:self-center">
            {summary.paidMonthsCount}/12 Disbursed
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-6 py-3.5">Month</th>
                <th className="px-6 py-3.5">Salary Amount</th>
                <th className="px-6 py-3.5">Payment Status</th>
                <th className="px-6 py-3.5">Disbursement Date</th>
                <th className="px-6 py-3.5">Payment Mode &amp; Reference</th>
                <th className="px-6 py-3.5 text-right">Payment Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthlyBreakdown.map((row) => (
                <tr key={row.monthNumber} className={`hover:bg-slate-50/70 transition-colors ${row.isCurrentMonth ? 'bg-indigo-50/30' : ''}`}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 text-sm">{row.monthName}</span>
                      {row.isCurrentMonth && (
                        <span className="rounded-md bg-indigo-100/80 px-2 py-0.5 text-[9px] font-extrabold text-indigo-700 uppercase tracking-wider">
                          Current
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-black text-slate-900 text-sm">
                      ₹{row.amount.toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {row.isPaid ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-extrabold text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-extrabold text-amber-700 border border-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600 font-medium">
                    {row.isPaid && row.payment ? (
                      <span className="font-semibold text-slate-800 font-mono">{row.payment.paymentDate}</span>
                    ) : (
                      <span className="text-slate-400 italic">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600">
                    {row.isPaid && row.payment ? (
                      <div>
                        <p className="font-bold text-slate-800">{row.payment.paymentMethod}</p>
                        {row.payment.referenceNumber && (
                          <p className="text-[10px] font-mono text-slate-400 mt-0.5">Ref: {row.payment.referenceNumber}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {row.isPaid && row.payment ? (
                      <button
                        onClick={() => setViewingReceipt(row.payment || null)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3.5 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition-all shadow-2xs cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Receipt
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 font-semibold italic">Not available</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Digital Salary Receipt Viewer Modal */}
      {viewingReceipt && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden print:p-0 print:shadow-none animate-in fade-in zoom-in-95">
            <div className="flex-shrink-0 text-center border-b border-slate-100 pb-3">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-extrabold uppercase text-emerald-700">
                Official Salary Payment Receipt
              </span>
              <h3 className="mt-1.5 text-lg font-black text-slate-900">{schoolName}</h3>
              <p className="mt-0.5 font-mono text-xs text-slate-400">{viewingReceipt.receiptNumber}</p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-2 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50/60 p-3 rounded-2xl border border-slate-100">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Teacher Name</span>
                  <span className="font-extrabold text-slate-900">{viewingReceipt.teacherName || user?.name}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Date</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentDate}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Email</span>
                  <span className="font-medium text-slate-700 truncate block">{viewingReceipt.teacherEmail || user?.email}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Salary Month</span>
                  <span className="font-bold text-slate-900">{MONTHS[viewingReceipt.month - 1]} {viewingReceipt.year}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Mode</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentMethod}</span>
                </div>
                {viewingReceipt.referenceNumber && (
                  <div>
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase">Transaction Ref</span>
                    <span className="font-mono text-slate-700">{viewingReceipt.referenceNumber}</span>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Salary Cleared</p>
                <p className="mt-0.5 text-2xl font-black text-emerald-800">
                  ₹{Number(viewingReceipt.amount).toLocaleString('en-IN')}
                </p>
                <p className="mt-0.5 text-[10px] font-bold text-emerald-600">STATUS: CLEARED & VERIFIED</p>
              </div>
            </div>

            <div className="flex-shrink-0 flex justify-end gap-2 pt-3 border-t border-slate-100 mt-2 print:hidden">
              <button
                onClick={() => handleDownloadReceipt(viewingReceipt)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-xs transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button
                onClick={() => setViewingReceipt(null)}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
