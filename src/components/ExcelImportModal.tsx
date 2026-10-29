import React, { useState, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  ArrowRight,
  ArrowLeft,
  Clipboard,
  RefreshCw,
  Eye,
  Key,
  ShieldCheck,
  FileText,
  UserCheck,
} from 'lucide-react';
import {
  STUDENT_COLUMNS,
  TEACHER_COLUMNS,
  ColumnMapping,
  ParsedRowResult,
  parseFileOrText,
  detectHeaderRow,
  autoMapColumns,
  organizeAndValidateRows,
  downloadSampleExcelTemplate,
} from '../services/smartSpreadsheetParser';
import { useDispatch } from 'react-redux';
import { baseApi } from '../store/api/baseApi';
import { useBulkImportStudentsMutation } from '../store/api/studentApi';
import { useBulkImportTeachersMutation } from '../store/api/teacherApi';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType?: 'students' | 'teachers';
  currentAcademicYear?: string;
  availableClasses?: string[];
  availableSections?: string[];
  onImportSuccess?: () => void;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'success';

export default function ExcelImportModal({
  isOpen,
  onClose,
  entityType: initialEntityType = 'students',
  currentAcademicYear = '2026-2027',
  availableClasses = [],
  availableSections = ['A', 'B', 'C', 'D'],
  onImportSuccess,
}: ExcelImportModalProps) {
  const [entityType, setEntityType] = useState<'students' | 'teachers'>(initialEntityType);
  const [step, setStep] = useState<ImportStep>('upload');
  const dispatch = useDispatch();

  React.useEffect(() => {
    if (isOpen) {
      setEntityType(initialEntityType);
      setStep('upload');
      setErrorMessage('');
    }
  }, [isOpen, initialEntityType]);

  // Input states
  const [pastedText, setPastedText] = useState('');
  const [isPasteMode, setIsPasteMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<any[][]>([]);

  // Mapping & Organization states
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [defaultClass, setDefaultClass] = useState(availableClasses[0] || 'Class 1');
  const [defaultSection, setDefaultSection] = useState(availableSections[0] || 'A');
  const [defaultYear, setDefaultYear] = useState(currentAcademicYear);

  // Preview & Validation states
  const [validatedRows, setValidatedRows] = useState<ParsedRowResult[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'ready' | 'issues'>('all');

  // Server submission states
  const [bulkImportStudents, { isLoading: isImportingStudents }] = useBulkImportStudentsMutation();
  const [bulkImportTeachers, { isLoading: isImportingTeachers }] = useBulkImportTeachersMutation();
  const [importProgress, setImportProgress] = useState<{
    inProgress: boolean;
    currentBatch: number;
    totalBatches: number;
    processedRows: number;
    totalRows: number;
    createdCount: number;
    skippedCount: number;
  }>({
    inProgress: false,
    currentBatch: 0,
    totalBatches: 0,
    processedRows: 0,
    totalRows: 0,
    createdCount: 0,
    skippedCount: 0,
  });
  const [jobId, setJobId] = useState<string>('');
  const [failedBatch, setFailedBatch] = useState<{
    batchIndex: number;
    batchNumber: number;
    errorCategory: string;
    message: string;
    attemptedRows: number;
    status?: number;
  } | null>(null);
  const accumulatedResultsRef = useRef<{
    created: number;
    skipped: number;
    credentials: any[];
    errors: any[];
  }>({ created: 0, skipped: 0, credentials: [], errors: [] });
  const isImporting = isImportingStudents || isImportingTeachers || importProgress.inProgress;

  const [importResult, setImportResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [serverErrorPopup, setServerErrorPopup] = useState<{ message: string; status: number | null } | null>(null);

  const activeColumnsDef = entityType === 'students' ? STUDENT_COLUMNS : TEACHER_COLUMNS;
  const fileInputId = useId();

  if (!isOpen) return null;

  // -------------------------------------------------------------
  // Step 1: Handle File or Paste Parsing
  // -------------------------------------------------------------
  const handleProcessRawData = (rows: any[][], name: string) => {
    if (!rows.length) {
      setErrorMessage('The spreadsheet contains no readable rows.');
      return;
    }
    setErrorMessage('');
    setFileName(name);
    setRawRows(rows);

    const { headerRowIndex, headers: detectedHeaders, dataRows: detectedData } = detectHeaderRow(rows, activeColumnsDef);
    setHeaderIndex(headerRowIndex);
    setHeaders(detectedHeaders);
    setDataRows(detectedData);

    // Auto-map columns
    const initialMappings = autoMapColumns(detectedHeaders, activeColumnsDef);
    setMappings(initialMappings);

    // Initial validation
    const organized = organizeAndValidateRows(detectedData, initialMappings, entityType, {
      defaultClass,
      defaultSection,
      defaultAcademicYear: defaultYear,
    });
    setValidatedRows(organized);

    setStep('mapping');
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      try {
        const { rawRows: parsed, fileName: fName } = await parseFileOrText(file);
        handleProcessRawData(parsed, fName);
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to parse file.');
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const { rawRows: parsed, fileName: fName } = await parseFileOrText(file);
        handleProcessRawData(parsed, fName);
      } catch (err: any) {
        setErrorMessage(err.message || 'Failed to parse file.');
      }
    }
  };

  const handlePastedDataSubmit = async () => {
    if (!pastedText.trim()) {
      setErrorMessage('Please paste tabular data from your Google Sheet or Excel.');
      return;
    }
    try {
      const { rawRows: parsed, fileName: fName } = await parseFileOrText(pastedText);
      handleProcessRawData(parsed, fName);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse pasted data.');
    }
  };

  // -------------------------------------------------------------
  // Step 2: Column Re-mapping & Default Tuning
  // -------------------------------------------------------------
  const handleMappingChange = (fieldKey: string, newColIndex: number) => {
    const nextMappings = mappings.map((m) => {
      if (m.fieldKey === fieldKey) {
        return {
          ...m,
          columnIndex: newColIndex,
          headerName: newColIndex >= 0 ? headers[newColIndex] : '(Unmapped)',
          confidence: newColIndex >= 0 ? 100 : 0,
        };
      }
      return m;
    });
    setMappings(nextMappings);

    // Re-organize rows with new mapping
    const reOrganized = organizeAndValidateRows(dataRows, nextMappings, entityType, {
      defaultClass,
      defaultSection,
      defaultAcademicYear: defaultYear,
    });
    setValidatedRows(reOrganized);
  };

  const handleProceedToPreview = () => {
    // Re-validate before preview
    const organized = organizeAndValidateRows(dataRows, mappings, entityType, {
      defaultClass,
      defaultSection,
      defaultAcademicYear: defaultYear,
    });
    setValidatedRows(organized);
    setStep('preview');
  };

  // -------------------------------------------------------------
  // Step 3: Row Toggling & Final Submission
  // -------------------------------------------------------------
  const handleToggleRow = (rowNumber: number) => {
    setValidatedRows((prev) =>
      prev.map((r) => (r.rowNumber === rowNumber ? { ...r, included: !r.included } : r))
    );
  };

  const handleToggleAllIncluded = (included: boolean) => {
    setValidatedRows((prev) =>
      prev.map((r) => (r.isValid ? { ...r, included } : r))
    );
  };

  // Queued import API enforces a 500-record maximum per request.
  const CHUNK_SIZE = 500;

  const handleExecuteImport = async (startBatchIndex = 0) => {
    const rowsToImport = validatedRows.filter((r) => r.included && r.isValid).map((r) => r.data);
    if (!rowsToImport.length) {
      setErrorMessage('No valid rows are selected for import.');
      return;
    }

    const totalRows = rowsToImport.length;
    const totalBatches = Math.ceil(totalRows / CHUNK_SIZE);

    if (startBatchIndex === 0) {
      accumulatedResultsRef.current = { created: 0, skipped: 0, credentials: [], errors: [] };
    }

    const currentJobId = jobId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `job-${Date.now()}`);
    setJobId(currentJobId);
    setFailedBatch(null);
    setErrorMessage('');

    setImportProgress({
      inProgress: true,
      currentBatch: startBatchIndex + 1,
      totalBatches,
      processedRows: startBatchIndex * CHUNK_SIZE,
      totalRows,
      createdCount: accumulatedResultsRef.current.created,
      skippedCount: accumulatedResultsRef.current.skipped,
    });

    let currentBatchNumber = startBatchIndex + 1;

    try {
      for (let b = startBatchIndex; b < totalBatches; b++) {
        currentBatchNumber = b + 1;
        const batchRows = rowsToImport.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);
        setImportProgress((prev) => ({
          ...prev,
          inProgress: true,
          currentBatch: b + 1,
          processedRows: b * CHUNK_SIZE,
        }));

        let result: any;
        if (entityType === 'students') {
          result = await bulkImportStudents({
            students: batchRows,
            academicYear: defaultYear,
            jobId: currentJobId,
            batchNumber: b + 1,
            totalBatches,
            batchSize: CHUNK_SIZE,
          }).unwrap();
        } else {
          result = await bulkImportTeachers({
            teachers: batchRows,
            jobId: currentJobId,
            batchNumber: b + 1,
            totalBatches,
            batchSize: CHUNK_SIZE,
          }).unwrap();
        }

        accumulatedResultsRef.current.created += result.createdCount || 0;
        accumulatedResultsRef.current.skipped += result.skippedCount || 0;
        if (Array.isArray(result.credentials)) {
          accumulatedResultsRef.current.credentials.push(...result.credentials);
        }
        if (Array.isArray(result.errors)) {
          accumulatedResultsRef.current.errors.push(...result.errors);
        }

        setImportProgress((prev) => ({
          ...prev,
          processedRows: Math.min((b + 1) * CHUNK_SIZE, totalRows),
          createdCount: accumulatedResultsRef.current.created,
          skippedCount: accumulatedResultsRef.current.skipped,
        }));
      }

      setImportResult({
        createdCount: accumulatedResultsRef.current.created,
        skippedCount: accumulatedResultsRef.current.skipped,
        credentials: accumulatedResultsRef.current.credentials,
        errors: accumulatedResultsRef.current.errors,
      });

      setStep('success');
      dispatch(baseApi.util.invalidateTags(['Student', 'Teacher', 'CredentialVault']));
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: any) {
      const category = err.data?.errorCategory || (err.status === 400 ? 'VALIDATION_ERROR' : 'SERVER_ERROR');
      const msg = err.data?.detail || err.data?.message || err.message || 'Failed to execute bulk import on server.';
      const batchIdx = currentBatchNumber - 1;
      setFailedBatch({
        batchIndex: batchIdx,
        batchNumber: currentBatchNumber,
        errorCategory: category,
        message: msg,
        attemptedRows: Math.min(CHUNK_SIZE, totalRows - batchIdx * CHUNK_SIZE),
        status: err.status,
      });
      setErrorMessage(msg);
      setServerErrorPopup({ message: msg, status: typeof err.status === 'number' ? err.status : null });
      setImportProgress((prev) => ({ ...prev, inProgress: false }));
    } finally {
      setImportProgress((prev) => ({ ...prev, inProgress: false }));
    }
  };

  const handleRetryFailedBatch = () => {
    if (failedBatch) {
      handleExecuteImport(failedBatch.batchIndex);
    }
  };

  const handleSkipFailedBatch = () => {
    if (failedBatch) {
      accumulatedResultsRef.current.skipped += failedBatch.attemptedRows;
      accumulatedResultsRef.current.errors.push({
        row: `Batch ${failedBatch.batchNumber}`,
        reason: `Skipped by user: ${failedBatch.message}`,
      });
      handleExecuteImport(failedBatch.batchIndex + 1);
    }
  };

  const handleFinalizeImportEarly = () => {
    if (accumulatedResultsRef.current.created > 0) {
      setImportResult({
        createdCount: accumulatedResultsRef.current.created,
        skippedCount: accumulatedResultsRef.current.skipped,
        credentials: accumulatedResultsRef.current.credentials,
        errors: accumulatedResultsRef.current.errors,
      });
      setStep('success');
      dispatch(baseApi.util.invalidateTags(['Student', 'Teacher', 'CredentialVault']));
      if (onImportSuccess) {
        onImportSuccess();
      }
    } else {
      resetAll();
    }
  };

  // -------------------------------------------------------------
  // Step 4: Download Logins CSV
  // -------------------------------------------------------------
  const handleDownloadCredentialsCsv = () => {
    if (!importResult?.credentials?.length) return;
    const creds = importResult.credentials;
    let csvHeader = '';
    let csvRows = '';

    if (entityType === 'students') {
      csvHeader = 'Admission No,Student Name,Class,Student Email,Student Password,Parent Email,Parent Password\n';
      csvRows = creds
        .map(
          (c: any) =>
            `"${c.admissionNo}","${c.name}","${c.className}","${c.studentEmail || ''}","${c.studentPassword || ''}","${c.parentEmail || ''}","${c.parentPassword || ''}"`
        )
        .join('\n');
    } else {
      csvHeader = 'Teacher Name,Official Email,Temporary Password\n';
      csvRows = creds
        .map((c: any) => `"${c.name}","${c.email}","${c.password || ''}"`)
        .join('\n');
    }

    const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${entityType}_credentials_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setStep('upload');
    setRawRows([]);
    setHeaders([]);
    setDataRows([]);
    setMappings([]);
    setValidatedRows([]);
    setImportResult(null);
    setErrorMessage('');
    setPastedText('');
    setFileName('');
    setFailedBatch(null);
    setImportProgress({
      inProgress: false,
      currentBatch: 0,
      totalBatches: 0,
      processedRows: 0,
      totalRows: 0,
      createdCount: 0,
      skippedCount: 0,
    });
  };

  // Summary counts
  const readyCount = validatedRows.filter((r) => r.isValid && r.warnings.length === 0).length;
  const warningCount = validatedRows.filter((r) => r.isValid && r.warnings.length > 0).length;
  const errorCount = validatedRows.filter((r) => !r.isValid).length;
  const totalCount = validatedRows.length;
  const selectedCount = validatedRows.filter((r) => r.included).length;

  const filteredPreviewRows = validatedRows.filter((r) => {
    if (previewFilter === 'ready') return r.isValid && r.warnings.length === 0;
    if (previewFilter === 'issues') return !r.isValid || r.warnings.length > 0;
    return true;
  });

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl sm:max-w-4xl bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="px-5 py-3 sm:px-6 sm:py-3.5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-white to-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shadow-sm shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  {entityType === 'teachers' ? 'Import Teachers via Excel / Sheets' : 'Import Students via Excel / Sheets'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                  Smart Auto-Organize
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {entityType === 'teachers'
                  ? 'Upload or paste faculty spreadsheet to auto-generate teacher profiles and credentials.'
                  : 'Upload or paste tabular sheets. Columns & rows are automatically detected and structured.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step === 'upload' && initialEntityType === 'students' && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setEntityType('students')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    entityType === 'students' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Students
                </button>
                <button
                  type="button"
                  onClick={() => setEntityType('teachers')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    entityType === 'teachers' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Teachers / Staff
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Step Progress Tracker */}
        <div className="px-5 py-2 sm:px-6 sm:py-2 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-1 sm:gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                step === 'upload'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              1
            </span>
            <span className={`font-semibold text-[11px] ${step === 'upload' ? 'text-slate-900' : 'text-slate-500'}`}>
              Upload Sheet
            </span>
            <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                step === 'mapping'
                  ? 'bg-emerald-600 text-white'
                  : step === 'preview' || step === 'success'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              2
            </span>
            <span className={`font-semibold text-[11px] ${step === 'mapping' ? 'text-slate-900' : 'text-slate-500'}`}>
              Organize Columns
            </span>
            <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                step === 'preview'
                  ? 'bg-emerald-600 text-white'
                  : step === 'success'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              3
            </span>
            <span className={`font-semibold text-[11px] ${step === 'preview' ? 'text-slate-900' : 'text-slate-500'}`}>
              Validate Rows
            </span>
            <ArrowRight className="w-3 h-3 text-slate-300 mx-0.5" />
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                step === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}
            >
              4
            </span>
            <span className={`font-semibold text-[11px] ${step === 'success' ? 'text-slate-900' : 'text-slate-500'}`}>
              Credentials Slip
            </span>
          </div>

          <button
            type="button"
            onClick={() => downloadSampleExcelTemplate(entityType)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-[11px] shadow-xs cursor-pointer transition-all"
            title={`Download an official sample ${entityType} spreadsheet template`}
          >
            <Download className="w-3 h-3 text-emerald-600" />
            <span className="hidden sm:inline">Download Sample Template (.xlsx)</span>
            <span className="sm:hidden">Template</span>
          </button>
        </div>

        {/* Modal Body Area */}
        <div className={`p-4 sm:p-5 bg-slate-50/30 ${step === 'upload' ? 'overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'}`}>
          {errorMessage && (
            <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* STEP 1: UPLOAD / PASTE SHEET */}
          {/* ------------------------------------------------------------- */}
          {step === 'upload' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-700">Choose Upload Method:</span>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsPasteMode(false)}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      !isPasteMode ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Upload File (.xlsx, .csv)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPasteMode(true)}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      isPasteMode ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Paste from Google Sheets
                  </button>
                </div>
              </div>

              {!isPasteMode ? (
                <div>
                  <input
                    type="file"
                    id={fileInputId}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                  <label
                    htmlFor={fileInputId}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    className={`block w-full border-2 border-dashed rounded-2xl py-4 px-4 text-center transition-all cursor-pointer ${
                      isDragging
                        ? 'border-emerald-500 bg-emerald-50/50 scale-[0.99]'
                        : 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-slate-50/50 shadow-xs'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center mb-1.5 border border-emerald-100 shadow-xs">
                      <Upload className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-800 mb-0.5">
                      Drag & Drop your Excel or Google Sheet export here
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-2">
                      Supports <strong className="text-slate-700">.xlsx</strong>, <strong className="text-slate-700">.xls</strong>, and <strong className="text-slate-700">.csv</strong>
                    </p>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm shadow-emerald-600/20 transition-all">
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Browse Files
                    </span>
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-2 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                    <Clipboard className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <strong>Google Sheets Tip:</strong> Select rows & columns, press <strong>Ctrl+C (Copy)</strong>, and paste below.
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste rows and columns directly here (tab-separated or comma-separated)..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handlePastedDataSubmit}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Auto-Detect & Organize
                    </button>
                  </div>
                </div>
              )}

              {/* Supported Columns Guide */}
              <div className="p-2.5 rounded-xl bg-white border border-slate-100 shadow-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <h5 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Smart Header Recognition
                  </h5>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    Auto-detects and matches headers even if named differently
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {activeColumnsDef.map((col) => (
                    <div
                      key={col.key}
                      className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[11px] flex items-center justify-between gap-1"
                    >
                      <span className="font-semibold text-slate-700 truncate">{col.label}</span>
                      {col.required ? (
                        <span className="text-[8px] px-1 py-0.2 rounded bg-rose-100 text-rose-700 font-bold shrink-0">
                          Required
                        </span>
                      ) : (
                        <span className="text-[8px] px-1 py-0.2 rounded bg-slate-200 text-slate-600 font-medium shrink-0">
                          Optional
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* STEP 2: ORGANIZE & MAP COLUMNS */}
          {/* ------------------------------------------------------------- */}
          {step === 'mapping' && (
            <div className="space-y-4">
              {/* Header detection info banner */}
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-emerald-950">
                      Auto-Organized Spreadsheet Structure
                    </h5>
                    <p className="text-[11px] text-emerald-800">
                      Identified header at Row {headerIndex + 1}. Detected {headers.length} columns and {dataRows.length} data rows in &ldquo;{fileName}&rdquo;.
                    </p>
                  </div>
                </div>

                <button
                  onClick={resetAll}
                  className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Upload Different File
                </button>
              </div>

              {/* Global Defaults Tuning */}
              {entityType === 'students' && (
                <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Default Academic Year:
                    </label>
                    <input
                      type="text"
                      value={defaultYear}
                      onChange={(e) => setDefaultYear(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold"
                      placeholder="2026-2027"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fallback Class (if missing in row):
                    </label>
                    <input
                      type="text"
                      value={defaultClass}
                      onChange={(e) => setDefaultClass(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold"
                      placeholder="Class 1"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fallback Section:
                    </label>
                    <input
                      type="text"
                      value={defaultSection}
                      onChange={(e) => setDefaultSection(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold"
                      placeholder="A"
                    />
                  </div>
                </div>
              )}

              {/* Column Mapping Grid */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-3.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>System Field</span>
                  <span>Detected Sheet Column</span>
                </div>

                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {mappings.map((mapping) => {
                    const sampleVal =
                      mapping.columnIndex >= 0 && dataRows[0]
                        ? String(dataRows[0][mapping.columnIndex] ?? '')
                        : '';

                    return (
                      <div
                        key={mapping.fieldKey}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/50 transition-colors"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800">
                              {mapping.fieldLabel}
                            </span>
                            {mapping.isRequired && (
                              <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 text-[9px] font-bold">
                                Required
                              </span>
                            )}
                            {mapping.confidence > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                {mapping.confidence}% Matched
                              </span>
                            )}
                          </div>
                          {sampleVal && (
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              Sample: &ldquo;{sampleVal}&rdquo;
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <select
                            value={mapping.columnIndex}
                            onChange={(e) =>
                              handleMappingChange(mapping.fieldKey, Number(e.target.value))
                            }
                            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                              mapping.columnIndex >= 0
                                ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
                                : 'border-slate-200 bg-white text-slate-500'
                            }`}
                          >
                            <option value={-1}>-- Unmapped / Skip --</option>
                            {headers.map((h, idx) => (
                              <option key={idx} value={idx}>
                                Col {idx + 1}: {h || `(Column ${idx + 1})`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* STEP 3: PREVIEW & ROW HEALTH CHECK */}
          {/* ------------------------------------------------------------- */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Batch Processing Real-time Progress Bar */}
              {importProgress.inProgress && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-sm space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                      <span>
                        Importing Batch {importProgress.currentBatch} of {importProgress.totalBatches}...
                      </span>
                    </div>
                    <span>
                      {Math.round((importProgress.currentBatch / importProgress.totalBatches) * 100)}% (
                      {Math.min(importProgress.currentBatch * CHUNK_SIZE, importProgress.totalRows).toLocaleString()} /{' '}
                      {importProgress.totalRows.toLocaleString()} rows)
                    </span>
                  </div>
                  <div className="w-full bg-emerald-200/60 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.round((importProgress.currentBatch / importProgress.totalBatches) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-emerald-700 font-medium">
                    Writing records with high-speed batched indexing and zero database locks. Please keep this modal open.
                  </p>
                </div>
              )}

              {/* Failed Batch Interactive Diagnostics Panel */}
              {failedBatch && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-rose-100 text-rose-700">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs font-bold text-rose-950">
                            Batch {failedBatch.batchNumber} of {importProgress.totalBatches} Failed
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-200 text-rose-800">
                            {failedBatch.errorCategory}
                          </span>
                        </div>
                        <p className="text-xs text-rose-800 mt-1 font-medium">
                          {failedBatch.message}
                        </p>
                        <p className="text-[11px] text-rose-600 mt-0.5">
                          {importProgress.createdCount.toLocaleString()} rows were successfully imported before this batch. {failedBatch.attemptedRows.toLocaleString()} rows in this batch were rolled back cleanly by PostgreSQL.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-rose-200/60 flex-wrap">
                    <button
                      onClick={handleRetryFailedBatch}
                      disabled={isImporting}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry Batch {failedBatch.batchNumber}</span>
                    </button>
                    <button
                      onClick={handleSkipFailedBatch}
                      disabled={isImporting}
                      className="px-4 py-2 rounded-xl bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Skip Batch & Continue</span>
                    </button>
                    {importProgress.createdCount > 0 && (
                      <button
                        onClick={handleFinalizeImportEarly}
                        disabled={isImporting}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 ml-auto transition-all cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Keep {importProgress.createdCount.toLocaleString()} Imported Records</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Health stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  onClick={() => setPreviewFilter('all')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    previewFilter === 'all'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-100 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Total Rows</span>
                  <span className="text-lg font-black">{totalCount}</span>
                </button>

                <button
                  onClick={() => setPreviewFilter('ready')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    previewFilter === 'ready'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-emerald-100 bg-emerald-50/50 text-emerald-900 hover:bg-emerald-50'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Ready to Import</span>
                  <span className="text-lg font-black">{readyCount}</span>
                </button>

                <button
                  onClick={() => setPreviewFilter('issues')}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    previewFilter === 'issues'
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-amber-100 bg-amber-50/50 text-amber-900 hover:bg-amber-50'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Notices / Warnings</span>
                  <span className="text-lg font-black">{warningCount}</span>
                </button>

                <div className="p-3 rounded-2xl border border-rose-100 bg-rose-50/50 text-rose-900">
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Errors (Skipped)</span>
                  <span className="text-lg font-black">{errorCount}</span>
                </div>
              </div>

              {/* Table Toolbar */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">
                    Showing {filteredPreviewRows.length} of {totalCount} rows
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="font-bold text-emerald-700">
                    {selectedCount} Selected for Import
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleAllIncluded(true)}
                    className="text-emerald-700 hover:underline font-bold text-[11px] cursor-pointer"
                  >
                    Select All Valid
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    onClick={() => handleToggleAllIncluded(false)}
                    className="text-slate-500 hover:underline font-bold text-[11px] cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Data Rows Preview Grid */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold text-[11px]">
                        <th className="p-3 w-10 text-center">Inc.</th>
                        <th className="p-3 w-14">Row</th>
                        <th className="p-3">Status</th>
                        {entityType === 'students' ? (
                          <>
                            <th className="p-3">Student Name</th>
                            <th className="p-3">Class & Sec</th>
                            <th className="p-3">Roll No</th>
                            <th className="p-3">Admission No</th>
                            <th className="p-3">Parent & Contact</th>
                            <th className="p-3">DOB / Gender</th>
                          </>
                        ) : (
                          <>
                            <th className="p-3">Teacher Name</th>
                            <th className="p-3">Email</th>
                            <th className="p-3">Mobile</th>
                            <th className="p-3">Qualification</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewRows.map((r) => {
                        const isReady = r.isValid;
                        const d = r.data;

                        return (
                          <tr
                            key={r.rowNumber}
                            className={`hover:bg-slate-50/70 transition-colors ${
                              !r.included ? 'opacity-40 bg-slate-50/40' : ''
                            }`}
                          >
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={r.included}
                                disabled={!r.isValid}
                                onChange={() => handleToggleRow(r.rowNumber)}
                                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              />
                            </td>
                            <td className="p-3 text-slate-400 font-mono text-[11px]">
                              #{r.rowNumber}
                            </td>
                            <td className="p-3">
                              {r.errors.length > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-bold" title={r.errors.join('; ')}>
                                  <XCircle className="w-3 h-3" />
                                  Error
                                </span>
                              ) : r.warnings.length > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold" title={r.warnings.join('; ')}>
                                  <AlertTriangle className="w-3 h-3" />
                                  Notice
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Ready
                                </span>
                              )}
                            </td>

                            {entityType === 'students' ? (
                              <>
                                <td className="p-3 font-bold text-slate-800">
                                  {d.name || <span className="text-rose-500 font-normal">Missing Name</span>}
                                </td>
                                <td className="p-3 font-semibold text-slate-600">
                                  {d.class} - {d.section}
                                </td>
                                <td className="p-3 text-slate-600">
                                  {d.rollNo > 0 ? d.rollNo : <span className="text-slate-400 italic">Auto</span>}
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-600">
                                  {d.admissionNo || <span className="text-slate-400 italic">Auto</span>}
                                </td>
                                <td className="p-3 text-slate-600">
                                  <div>{d.parentName || '-'}</div>
                                  <div className="text-[11px] text-slate-400">{d.parentPhone || d.parentEmail}</div>
                                </td>
                                <td className="p-3 text-slate-600">
                                  <div>{d.dob || '-'}</div>
                                  <div className="text-[11px] text-slate-400">{d.gender}</div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="p-3 font-bold text-slate-800">{d.name}</td>
                                <td className="p-3 text-slate-600 font-mono text-[11px]">{d.email}</td>
                                <td className="p-3 text-slate-600">{d.phone || '-'}</td>
                                <td className="p-3 text-slate-600">{d.qualification || '-'}</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* STEP 4: IMPORT SUCCESS & CREDENTIAL SLIPS */}
          {/* ------------------------------------------------------------- */}
          {step === 'success' && importResult && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <ShieldCheck className="w-9 h-9" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-900">
                  Bulk Import Completed Successfully!
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Enrolled <strong className="text-emerald-700">{importResult.createdCount}</strong> {entityType} into the school directory. Credentials have been generated and <strong>automatically saved to the Password Manager</strong> section.
                </p>
              </div>

              {/* Quick stats box */}
              <div className="flex items-center justify-center gap-4 text-xs font-bold">
                <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                  Created: {importResult.createdCount}
                </div>
                {importResult.skippedCount > 0 && (
                  <div className="px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
                    Skipped: {importResult.skippedCount}
                  </div>
                )}
              </div>

              {/* Generated credentials preview table */}
              {importResult.credentials && importResult.credentials.length > 0 && (
                <div className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mt-4">
                  <div className="p-3.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-500" />
                      Generated Login Credentials ({importResult.credentials.length})
                    </span>
                    <button
                      onClick={handleDownloadCredentialsCsv}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Credential Slip (CSV)
                    </button>
                  </div>

                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500 font-semibold text-[11px]">
                          <th className="p-2.5">Name</th>
                          {entityType === 'students' ? (
                            <>
                              <th className="p-2.5">Student Login</th>
                              <th className="p-2.5">Student Password</th>
                              <th className="p-2.5">Parent Login</th>
                              <th className="p-2.5">Parent Password</th>
                            </>
                          ) : (
                            <>
                              <th className="p-2.5">Email</th>
                              <th className="p-2.5">Temporary Password</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {importResult.credentials.slice(0, 50).map((c: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 font-sans font-bold text-slate-800">{c.name}</td>
                            {entityType === 'students' ? (
                              <>
                                <td className="p-2.5 text-slate-600">{c.studentEmail}</td>
                                <td className="p-2.5 text-emerald-700 font-bold">{c.studentPassword}</td>
                                <td className="p-2.5 text-slate-600">{c.parentEmail}</td>
                                <td className="p-2.5 text-amber-700">{c.parentPassword}</td>
                              </>
                            ) : (
                              <>
                                <td className="p-2.5 text-slate-600">{c.email}</td>
                                <td className="p-2.5 text-emerald-700 font-bold">{c.password}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {serverErrorPopup && (
          <div className="fixed inset-0 z-[10001] grid place-items-center p-4 bg-slate-950/55 backdrop-blur-sm" onClick={() => setServerErrorPopup(null)}>
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="import-error-title"
              aria-describedby="import-error-message"
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-rose-100"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-rose-50 p-2 text-rose-600"><AlertTriangle className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <h3 id="import-error-title" className="text-base font-bold text-slate-900">Import failed</h3>
                  {serverErrorPopup.status !== null && (
                    <p className="mt-1 text-xs font-semibold text-rose-700">Server returned HTTP {serverErrorPopup.status}</p>
                  )}
                  <p id="import-error-message" className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{serverErrorPopup.message}</p>
                </div>
                <button type="button" aria-label="Close error message" onClick={() => setServerErrorPopup(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setServerErrorPopup(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
                {failedBatch && (
                  <button type="button" onClick={() => { setServerErrorPopup(null); handleRetryFailedBatch(); }} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">Retry Batch</button>
                )}
              </div>
            </section>
          </div>
        )}

        {/* Modal Bottom Footer Actions */}
        <div className="px-5 py-2.5 sm:px-6 sm:py-3 border-t border-slate-100 bg-white flex items-center justify-between shrink-0">
          <div>
            {step === 'upload' && (
              <span className="text-[11px] text-slate-400">
                Supported formats: <strong className="text-slate-600">.xlsx, .xls, .csv, Sheets</strong>
              </span>
            )}
            {step === 'mapping' && (
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Upload
              </button>
            )}
            {step === 'preview' && (
              <button
                type="button"
                onClick={() => setStep('mapping')}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Column Mapping
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step !== 'success' && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 font-bold text-xs cursor-pointer transition-colors"
              >
                Cancel
              </button>
            )}

            {step === 'mapping' && (
              <button
                type="button"
                onClick={handleProceedToPreview}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer transition-all"
              >
                <span>Preview & Health Check</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 'preview' && (
              <button
                type="button"
                onClick={() => handleExecuteImport(0)}
                disabled={isImporting || selectedCount === 0 || !!failedBatch}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 flex items-center gap-2 cursor-pointer transition-all"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>
                      {importProgress.totalBatches > 1
                        ? `Importing Batch ${importProgress.currentBatch}/${importProgress.totalBatches}...`
                        : 'Importing to Server...'}
                    </span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>Import {selectedCount} {entityType === 'students' ? 'Students' : 'Teachers'}</span>
                  </>
                )}
              </button>
            )}

            {step === 'success' && (
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md cursor-pointer transition-all"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
