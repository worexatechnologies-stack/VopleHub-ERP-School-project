import { getStoredAuthenticatedUser } from '../utils/auth';
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Wallet,
  Search,
  CheckCircle2,
  Clock,
  Printer,
  Download,
  Receipt,
  ArrowRight,
  UserCheck,
  Building,
  Calendar,
  CreditCard,
  FileSpreadsheet,
  FileText,
  DollarSign,
  AlertCircle,
  X,
} from 'lucide-react';
import AuthenticatedImage from './AuthenticatedImage';
import {
  useGetStaffPayrollSummaryQuery,
  useLazyGetStaffPayrollSummaryQuery,
  usePayStaffSalaryMutation,
  type StaffSalaryPayment,
  type StaffPayrollRow,
} from '../store/api/staffSalaryApi';
import { emitNotification } from '../services/notificationBus';
import { exportStaffPayrollToExcel } from '../utils/staffPayrollExport';
import { ListPagination } from './common/QueryStates';

interface StaffFeeModuleProps {
  schoolName?: string;
  onAddLog?: (msg: string) => void;
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

function saveLocalSalaries(salaries: StaffSalaryPayment[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(salaries));
}

export default function StaffFeeModule({ schoolName = 'School Management Portal', onAddLog }: StaffFeeModuleProps) {
  const isServerBacked = Boolean(getStoredAuthenticatedUser());
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Paid' | 'Pending'>('All');
  const [salaryPage, setSalaryPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const SALARY_PAGE_SIZE = 25;

  // Server queries
  const { data: serverPayrollPage, refetch: refetchSalaries } = useGetStaffPayrollSummaryQuery(
    { month: selectedMonth, year: selectedYear, page: salaryPage, page_size: SALARY_PAGE_SIZE, search: debouncedSearch || undefined, status: statusFilter === 'All' ? undefined : statusFilter },
    { skip: !isServerBacked }
  );
  const [loadPayrollPage] = useLazyGetStaffPayrollSummaryQuery();
  const [payStaffSalaryMutation, { isLoading: isPaying }] = usePayStaffSalaryMutation();

  // Local storage state for fallback
  const [localSalaries, setLocalSalaries] = useState<StaffSalaryPayment[]>(loadLocalSalaries);

  const salaries = localSalaries;

  // Modals state
  const [payingTeacher, setPayingTeacher] = useState<{
    id: number;
    name: string;
    email: string;
    phone: string;
    fixedSalary: number;
    existingPayment?: StaffSalaryPayment;
  } | null>(null);

  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: 'Bank Transfer',
    referenceNumber: '',
    notes: '',
  });

  const [viewingReceipt, setViewingReceipt] = useState<StaffSalaryPayment | null>(null);

  // Match teachers with salary payments for the selected month & year
  const teacherPayrollRows = useMemo<StaffPayrollRow[]>(() => {
    if (isServerBacked) return serverPayrollPage?.results || [];
    // If local mode and no server teachers, fallback to local teachers
    let teacherList: any[] = [];
    try {
      const raw = localStorage.getItem('erp_teachers');
      if (raw) {
        const parsed = JSON.parse(raw);
        teacherList = parsed.map((t: any) => ({
          id: Number(t.id) || Date.now(),
          name: t.name || 'Teacher',
          email: t.email || '',
          phone: t.phone || '',
          salary: t.salary || 0,
          status: t.status || 'Active',
        }));
      }
    } catch {
      teacherList = [];
    }

    return teacherList
      .filter((teacher) => teacher.status === 'Active')
      .map((teacher) => {
        const payment = salaries.find(
          (s) => Number(s.teacherId) === Number(teacher.id) &&
                 Number(s.month) === selectedMonth &&
                 Number(s.year) === selectedYear
        );

        const fixedSalaryNum = teacher.salary ? Number(teacher.salary) : 0;
        const isPaid = payment?.status === 'Paid';

        return {
          teacher,
          fixedSalary: fixedSalaryNum,
          payment: payment || null,
          isPaid,
        };
      });
  }, [serverPayrollPage, salaries, selectedMonth, selectedYear, isServerBacked]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (isServerBacked) return teacherPayrollRows;
    return teacherPayrollRows.filter((row) => {
      const matchesSearch =
        row.teacher.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.teacher.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.teacher.phone.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === 'All'
          ? true
          : statusFilter === 'Paid'
          ? row.isPaid
          : !row.isPaid;

      return matchesSearch && matchesStatus;
    });
  }, [teacherPayrollRows, searchTerm, statusFilter, isServerBacked]);
  const visibleRows = useMemo(
    () => isServerBacked ? filteredRows : filteredRows.slice((salaryPage - 1) * SALARY_PAGE_SIZE, salaryPage * SALARY_PAGE_SIZE),
    [filteredRows, salaryPage, isServerBacked],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(searchTerm.trim()); setSalaryPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);
  useEffect(() => setSalaryPage(1), [selectedMonth, selectedYear, statusFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (isServerBacked && serverPayrollPage?.summary) {
      return {
        totalPayroll: Number(serverPayrollPage.summary.totalPayroll),
        totalPaid: Number(serverPayrollPage.summary.totalPaid),
        totalPending: Number(serverPayrollPage.summary.totalPending),
        paidCount: serverPayrollPage.summary.paidCount,
        totalCount: serverPayrollPage.summary.totalCount,
      };
    }
    const totalPayroll = teacherPayrollRows.reduce((acc, row) => acc + Number(row.fixedSalary), 0);
    const totalPaid = teacherPayrollRows.reduce((acc, row) => acc + (row.isPaid && row.payment ? Number(row.payment.amount) : 0), 0);
    const totalPending = Math.max(0, totalPayroll - totalPaid);
    const paidCount = teacherPayrollRows.filter((row) => row.isPaid).length;
    const totalCount = teacherPayrollRows.length;

    return { totalPayroll, totalPaid, totalPending, paidCount, totalCount };
  }, [teacherPayrollRows, serverPayrollPage, isServerBacked]);

  // Export staff payroll to Excel (.xlsx)
  const handleExportToExcel = async () => {
    try {
      let exportRows = teacherPayrollRows;
      if (isServerBacked) {
        exportRows = [];
        const pageSize = 200;
        let page = 1;
        let total = 0;
        do {
          const response = await loadPayrollPage({ month: selectedMonth, year: selectedYear, page, page_size: pageSize }).unwrap();
          exportRows.push(...response.results);
          total = response.count;
          page += 1;
        } while (exportRows.length < total);
      }
      exportStaffPayrollToExcel({
        schoolName,
        month: selectedMonth,
        year: selectedYear,
        monthName: MONTHS[selectedMonth - 1],
        rows: exportRows.map((row) => ({ ...row, fixedSalary: Number(row.fixedSalary), payment: row.payment || undefined })),
        stats,
      });
      emitNotification({
        title: 'Payroll Exported',
        message: `${MONTHS[selectedMonth - 1]} ${selectedYear} staff payroll register exported to Excel (.xlsx).`,
        tone: 'success',
        source: 'finance',
      });
      onAddLog?.(`[Staff Fee] Exported ${MONTHS[selectedMonth - 1]} ${selectedYear} staff payroll register to Excel (.xlsx).`);
    } catch (error: any) {
      console.error('Failed to export staff payroll:', error);
      emitNotification({
        title: 'Export Failed',
        message: 'Could not generate the payroll Excel sheet.',
        tone: 'danger',
        source: 'finance',
      });
    }
  };

  // Open Pay Modal
  const handleOpenPayModal = (row: (typeof teacherPayrollRows)[0]) => {
    setPayingTeacher({
      id: Number(row.teacher.id),
      name: row.teacher.name,
      email: row.teacher.email,
      phone: row.teacher.phone,
      fixedSalary: Number(row.fixedSalary),
      existingPayment: row.payment || undefined,
    });

    setPaymentForm({
      amount: row.payment ? String(row.payment.amount) : String(row.fixedSalary || ''),
      paymentDate: row.payment?.paymentDate || new Date().toISOString().slice(0, 10),
      paymentMethod: row.payment?.paymentMethod || 'Bank Transfer',
      referenceNumber: row.payment?.referenceNumber || '',
      notes: row.payment?.notes || '',
    });
  };

  // Submit Payment
  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingTeacher) return;

    const amountNum = parseFloat(paymentForm.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Please enter a valid positive salary payment amount.');
      return;
    }

    if (isServerBacked) {
      try {
        const saved = await payStaffSalaryMutation({
          teacherId: payingTeacher.id,
          month: selectedMonth,
          year: selectedYear,
          amount: amountNum,
          paymentDate: paymentForm.paymentDate,
          paymentMethod: paymentForm.paymentMethod,
          referenceNumber: paymentForm.referenceNumber,
          notes: paymentForm.notes,
          status: 'Paid',
        }).unwrap();

        emitNotification({
          title: 'Salary Payment Recorded',
          message: `Salary of ₹${amountNum.toLocaleString('en-IN')} paid to ${payingTeacher.name} for ${MONTHS[selectedMonth - 1]} ${selectedYear}.`,
          tone: 'success',
          source: 'finance',
        });
        onAddLog?.(`[Staff Fee] Paid monthly salary ₹${amountNum.toLocaleString('en-IN')} to ${payingTeacher.name} (${MONTHS[selectedMonth - 1]} ${selectedYear}). Receipt: ${saved.receiptNumber}`);

        setPayingTeacher(null);
        setViewingReceipt(saved);
        refetchSalaries();
      } catch (error: any) {
        alert(error?.data?.detail || error?.message || 'Could not record staff salary payment.');
      }
    } else {
      // Local storage fallback
      const receiptNo = `RCPT-SAL-${selectedYear}${String(selectedMonth).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const newPayment: StaffSalaryPayment = {
        id: Date.now(),
        teacherId: payingTeacher.id,
        teacherName: payingTeacher.name,
        teacherEmail: payingTeacher.email,
        teacherPhone: payingTeacher.phone,
        teacherFixedSalary: String(payingTeacher.fixedSalary),
        month: selectedMonth,
        year: selectedYear,
        amount: String(amountNum),
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        referenceNumber: paymentForm.referenceNumber,
        status: 'Paid',
        receiptNumber: receiptNo,
        notes: paymentForm.notes,
        paidByName: 'School Admin',
        createdAt: new Date().toISOString(),
      };

      const updated = [
        newPayment,
        ...localSalaries.filter(
          (s) => !(s.teacherId === payingTeacher.id && s.month === selectedMonth && s.year === selectedYear)
        ),
      ];
      saveLocalSalaries(updated);
      setLocalSalaries(updated);

      emitNotification({
        title: 'Salary Payment Recorded',
        message: `Salary of ₹${amountNum.toLocaleString('en-IN')} recorded for ${payingTeacher.name}.`,
        tone: 'success',
        source: 'finance',
      });

      setPayingTeacher(null);
      setViewingReceipt(newPayment);
    }
  };

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
            <div class="row"><span class="label">Teacher Name:</span><span class="val">${receipt.teacherName}</span></div>
            <div class="row"><span class="label">Teacher Email:</span><span class="val">${receipt.teacherEmail}</span></div>
            <div class="row"><span class="label">Phone:</span><span class="val">${receipt.teacherPhone}</span></div>
            <div class="row"><span class="label">Salary Month:</span><span class="val">${MONTHS[receipt.month - 1]} ${receipt.year}</span></div>
            <div class="row"><span class="label">Payment Date:</span><span class="val">${receipt.paymentDate}</span></div>
            <div class="row"><span class="label">Payment Mode:</span><span class="val">${receipt.paymentMethod}</span></div>
            ${receipt.referenceNumber ? `<div class="row"><span class="label">Transaction Reference:</span><span class="val">${receipt.referenceNumber}</span></div>` : ''}
          </div>
          <div class="amount-box">
            <div class="amount-label">Net Salary Disbursed</div>
            <div class="amount-val">₹${Number(receipt.amount).toLocaleString('en-IN')}</div>
            <div class="status">STATUS: CLEARED & VERIFIED</div>
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
    link.download = `Salary_Receipt_${receipt.receiptNumber}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="staff-fee-page">
      {/* Header Banner */}
      <header className="portal-header-card flex flex-col lg:flex-row justify-between lg:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="portal-pill-badge indigo">School Admin</span>
              <span className="text-[11px] font-bold text-slate-400">Payroll & Staff Operations</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Staff Fee & Salary Disbursement</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Manage fixed monthly salary disbursements, record payments, and issue official salary payment receipts for teachers.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start lg:self-center">
          <div className="h-10 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2 shadow-2xs">
            <Calendar className="h-4 w-4 text-slate-500" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-xs font-extrabold text-slate-800 outline-none cursor-pointer"
            >
              {MONTHS.map((name, idx) => (
                <option key={name} value={idx + 1}>{name}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-xs font-extrabold text-slate-800 outline-none cursor-pointer"
            >
              {[currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1].map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleExportToExcel}
            className="h-10 px-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs shadow-sm hover:shadow transition-all cursor-pointer whitespace-nowrap"
            title="Export monthly staff payroll register & disbursement tally to Excel (.xlsx)"
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-white" />
            <span>Export to Excel (.xlsx)</span>
          </button>
        </div>
      </header>

      {/* Metrics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="portal-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Monthly Payroll</span>
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">₹{stats.totalPayroll.toLocaleString('en-IN')}</p>
          <p className="mt-1 text-xs text-slate-500">{MONTHS[selectedMonth - 1]} {selectedYear}</p>
        </div>

        <div className="portal-card p-5 !bg-emerald-50/40 !border-emerald-200/80">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Total Paid</span>
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-700">₹{stats.totalPaid.toLocaleString('en-IN')}</p>
          <p className="mt-1 text-xs text-emerald-600 font-semibold">{stats.paidCount} of {stats.totalCount} teachers disbursed</p>
        </div>

        <div className="portal-card p-5 !bg-amber-50/40 !border-amber-200/80">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Payroll</span>
            <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-amber-700">₹{stats.totalPending.toLocaleString('en-IN')}</p>
          <p className="mt-1 text-xs text-amber-600 font-semibold">{stats.totalCount - stats.paidCount} teachers awaiting payment</p>
        </div>

        <div className="portal-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Active Teachers</span>
            <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
              <UserCheck className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">{stats.totalCount}</p>
          <p className="mt-1 text-xs text-slate-500">Eligible staff members</p>
        </div>
      </div>

      {/* Roster Table Card */}
      <div className="portal-card overflow-hidden">
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search teacher by name, email, or phone..."
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-[38px] rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="All">All Statuses</option>
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
            </select>
            <button
              type="button"
              onClick={handleExportToExcel}
              className="h-[38px] px-3.5 inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold shadow-2xs active:scale-98 transition-all cursor-pointer whitespace-nowrap"
              title="Export staff payroll to Excel (.xlsx)"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Export Payroll</span>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Fixed Salary</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Disbursement Details</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
      {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    No teacher profiles found for this criteria.
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ teacher, fixedSalary, payment, isPaid }) => (
                  <tr key={teacher.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {teacher.photoUrl ? (
                          <AuthenticatedImage
                            src={teacher.photoUrl}
                            alt={teacher.name}
                            className="h-10 w-10 rounded-full border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700 border border-indigo-100">
                            {teacher.name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <p className="font-extrabold text-slate-900">{teacher.name}</p>
                          <p className="text-xs text-slate-500">{teacher.email}</p>
                          <p className="text-xs text-slate-400">{teacher.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-black text-slate-800 text-sm">
                        ₹{fixedSalary.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[10px] text-slate-400 block">/ month</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                      {MONTHS[selectedMonth - 1]} {selectedYear}
                    </td>
                    <td className="px-4 py-3">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700 border border-amber-200">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {isPaid && payment ? (
                        <div>
                          <p className="font-bold text-slate-800">Paid: ₹{Number(payment.amount).toLocaleString('en-IN')}</p>
                          <p className="text-[11px] text-slate-500">
                            {payment.paymentMethod} · {payment.paymentDate}
                          </p>
                          {payment.referenceNumber && (
                            <p className="text-[10px] font-mono text-slate-400">Ref: {payment.referenceNumber}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Not disbursed yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isPaid && payment ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setViewingReceipt(payment)}
                            className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                            title="View Receipt"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Receipt
                          </button>
                          <button
                            onClick={() => handleOpenPayModal({ teacher, fixedSalary, payment, isPaid })}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            title="Edit payment"
                          >
                            Edit
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleOpenPayModal({ teacher, fixedSalary, payment, isPaid })}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-indigo-700"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          Pay Salary
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <ListPagination page={salaryPage} pageSize={SALARY_PAGE_SIZE} total={isServerBacked ? (serverPayrollPage?.count || 0) : filteredRows.length} onPageChange={setSalaryPage} />
      </div>

      {/* Pay Teacher Salary Modal */}
      {payingTeacher && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-white p-6 shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95">
            <div className="flex-shrink-0 flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700">
                  Salary Disbursement
                </span>
                <h2 className="mt-1 text-lg font-extrabold text-slate-900">{payingTeacher.name}</h2>
                <p className="text-xs text-slate-500">
                  Paying salary for {MONTHS[selectedMonth - 1]} {selectedYear}
                </p>
              </div>
              <button
                onClick={() => setPayingTeacher(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handlePaymentSubmit} className="flex-1 flex flex-col min-h-0 mt-3">
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Amount (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="Enter payment amount"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                    {payingTeacher.fixedSalary > 0 && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Fixed Monthly Salary: ₹{payingTeacher.fixedSalary.toLocaleString('en-IN')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Payment Date *</label>
                    <input
                      type="date"
                      required
                      value={paymentForm.paymentDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Payment Method *</label>
                    <select
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option>Bank Transfer</option>
                      <option>Cash</option>
                      <option>Cheque</option>
                      <option>UPI</option>
                      <option>Direct Deposit</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Transaction / Cheque Reference</label>
                    <input
                      type="text"
                      value={paymentForm.referenceNumber}
                      onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                      placeholder="e.g. UTR-98765432 or Cheque #123456"
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700">Remarks / Notes</label>
                  <input
                    type="text"
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    placeholder="Optional remarks (e.g. Full month salary with allowance)"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-shrink-0 flex justify-end gap-2 pt-3 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setPayingTeacher(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPaying}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5 shadow-sm transition-all"
                >
                  {isPaying ? 'Recording...' : 'Confirm & Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Salary Receipt Modal */}
      {viewingReceipt && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl bg-white p-6 shadow-2xl overflow-hidden my-auto print:p-0 print:shadow-none animate-in fade-in zoom-in-95">
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
                  <span className="font-extrabold text-slate-900">{viewingReceipt.teacherName}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Disbursement Date</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentDate}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Email</span>
                  <span className="font-medium text-slate-700 truncate block">{viewingReceipt.teacherEmail}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Period</span>
                  <span className="font-bold text-slate-900">{MONTHS[viewingReceipt.month - 1]} {viewingReceipt.year}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400 uppercase">Payment Mode</span>
                  <span className="font-bold text-slate-800">{viewingReceipt.paymentMethod}</span>
                </div>
                {viewingReceipt.referenceNumber && (
                  <div>
                    <span className="block text-[10px] font-semibold text-slate-400 uppercase">Reference</span>
                    <span className="font-mono text-slate-700">{viewingReceipt.referenceNumber}</span>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Net Salary Paid</p>
                <p className="mt-0.5 text-2xl font-black text-emerald-800">
                  ₹{Number(viewingReceipt.amount).toLocaleString('en-IN')}
                </p>
                <p className="mt-0.5 text-[10px] font-bold text-emerald-600">STATUS: CLEARED & DISBURSED</p>
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
