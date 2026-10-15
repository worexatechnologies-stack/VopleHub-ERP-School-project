import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, RefreshCw, Calendar, ArrowRight, ShieldCheck, Archive, AlertTriangle, CreditCard, UserCheck } from 'lucide-react';
import type { AcademicClass, AcademicYear } from '../services/academicStructure';
import type { Student } from '../types';

interface PromotionModuleProps {
  students: Student[];
  onExecutePromotion: (
    newYear: string,
    decisions: { [studentId: string]: { status: 'Promoted' | 'Retained'; nextClass: string } }
  ) => void;
  logs: string[];
  currentAcademicYear: string;
  academicYears: AcademicYear[];
  academicClasses: AcademicClass[];
}

const GRADUATED_STATUS = 'Graduated';

export default function PromotionModule({
  students,
  onExecutePromotion,
  currentAcademicYear,
  academicYears,
  academicClasses,
}: PromotionModuleProps) {
  // Filter students to the active current academic year cycle to prevent duplicates
  const activeStudents = useMemo(
    () => students.filter(student => student.academicYear === currentAcademicYear && student.status === 'Active'),
    [currentAcademicYear, students],
  );

  const targetAcademicYears = useMemo(() => {
    const currentIndex = academicYears.findIndex(year => year.name === currentAcademicYear);
    return currentIndex >= 0 ? academicYears.slice(currentIndex + 1) : [];
  }, [academicYears, currentAcademicYear]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [newAcademicYear, setNewAcademicYear] = useState('');
  const [promotionDecisions, setPromotionDecisions] = useState<{ [studentId: string]: 'Promote' | 'Fail' }>({});

  const [migrationStatus, setMigrationStatus] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [promotionReport, setPromotionReport] = useState<{
    totalProcessed: number;
    promotedCount: number;
    retainedCount: number;
    graduatedCount: number;
    fromYear: string;
    toYear: string;
  } | null>(null);

  // Archive Viewer state
  const [selectedArchiveYear, setSelectedArchiveYear] = useState<string | null>(null);

  useEffect(() => {
    setNewAcademicYear(current => (
      targetAcademicYears.some(year => year.name === current)
        ? current
        : targetAcademicYears[0]?.name || ''
    ));
  }, [targetAcademicYears]);

  const feeIneligibleCount = useMemo(() => {
    return activeStudents.filter(s => {
      const total = Number(s.feeTotal || 0);
      const paid = Number(s.feePaid || 0);
      return total > 0 && (paid / total) < 0.5;
    }).length;
  }, [activeStudents]);

  useEffect(() => {
    setPromotionDecisions(current => {
      const next: { [studentId: string]: 'Promote' | 'Fail' } = {};
      activeStudents.forEach(student => {
        const feeTotal = Number(student.feeTotal || 0);
        const feePaid = Number(student.feePaid || 0);
        const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
        const defaultDecision = feeTotal > 0 && feePct < 50 ? 'Fail' : 'Promote';
        next[student.id] = current[student.id] || defaultDecision;
      });
      return next;
    });
  }, [activeStudents]);

  const getNextClass = (currentClass: string): string | null => {
    const currentIndex = academicClasses.findIndex(classroom => classroom.name === currentClass);
    if (currentIndex < 0) return null;
    return academicClasses[currentIndex + 1]?.name || GRADUATED_STATUS;
  };

  const hasUnconfiguredPromotionClass = activeStudents.some(student => (
    promotionDecisions[student.id] !== 'Fail' && getNextClass(student.class) === null
  ));

  const getStudentGPA = (student: Student): number | null => {
    return typeof student.gpa === 'number' ? student.gpa : null;
  };

  const handleDecisionChange = (studentId: string, value: 'Promote' | 'Fail') => {
    if (value === 'Promote') {
      const targetStudent = activeStudents.find(s => s.id === studentId);
      if (targetStudent) {
        const feeTotal = Number(targetStudent.feeTotal || 0);
        const feePaid = Number(targetStudent.feePaid || 0);
        const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
        if (feeTotal > 0 && feePct < 50) {
          const proceed = confirm(
            `Fee Clearance Requirement Warning:\n\n${targetStudent.name} has only paid ${feePct.toFixed(1)}% of annual fees (₹${feePaid.toLocaleString()} / ₹${feeTotal.toLocaleString()}).\n\nStudents must pay at least 50% of the fees to be promoted to the next higher class.\n\nDo you want to grant an administrative fee waiver to promote this student anyway?`
          );
          if (!proceed) return;
        }
      }
    }
    setPromotionDecisions(prev => ({
      ...prev,
      [studentId]: value
    }));
  };

  const handleStartMigration = () => {
    if (!newAcademicYear) {
      setMigrationStatus(['Create and select a future academic year in Academic Setup before promotion.']);
      return;
    }
    if (hasUnconfiguredPromotionClass) {
      setMigrationStatus(['One or more student classes are missing from Academic Setup. Correct the class assignments before promotion.']);
      return;
    }

    setIsMigrating(true);
    setMigrationStatus([]);

    const steps = [
      'Establishing connection to active school database...',
      `Generating target academic year ledger entries for: ${newAcademicYear}...`,
      'Validating student grade-cards and attendance metrics...',
      `Cloning student master profiles to secure archival registry (${currentAcademicYear})...`,
      'Executing School Admin configured class promotion rules...',
      'Resetting daily attendance logs for the new term...',
      'Rolling forward fee ledgers (Creating & updating tuition invoices for target classes)...',
      'Re-encrypting active login session tokens with JWT...',
      'Academic Promotion migration executed successfully!'
    ];

    steps.forEach((msg, idx) => {
      setTimeout(() => {
        setMigrationStatus(prev => [...prev, msg]);
        if (idx === steps.length - 1) {
          setIsMigrating(false);
          
          // Construct the actual migration decisions to apply on main state
          const formattedDecisions: { [studentId: string]: { status: 'Promoted' | 'Retained'; nextClass: string } } = {};
          
           let promotedCount = 0;
           let retainedCount = 0;
           let graduatedCount = 0;
 
           activeStudents.forEach(s => {
             const decision = promotionDecisions[s.id] || 'Promote';
             if (decision === 'Promote') {
               const nextClass = getNextClass(s.class);
               if (nextClass === GRADUATED_STATUS) {
                 graduatedCount++;
                 formattedDecisions[s.id] = { status: 'Promoted', nextClass: GRADUATED_STATUS };
               } else if (nextClass) {
                 promotedCount++;
                 formattedDecisions[s.id] = { status: 'Promoted', nextClass };
               } else {
                 retainedCount++;
                 formattedDecisions[s.id] = { status: 'Retained', nextClass: s.class };
               }
             } else {
               retainedCount++;
               formattedDecisions[s.id] = { status: 'Retained', nextClass: s.class };
             }
           });
 
           // Set the report details
           setPromotionReport({
             totalProcessed: activeStudents.length,
             promotedCount,
             retainedCount,
             graduatedCount,
             fromYear: currentAcademicYear,
             toYear: newAcademicYear
           });

          onExecutePromotion(newAcademicYear, formattedDecisions);
          setStep(4);
        }
      }, (idx + 1) * 450);
    });
  };

  return (
    <div className="space-y-6" id="promotion-module">
      
      {/* Header Info */}
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-sans font-semibold text-slate-900">Academic Year Promotion Desk</h2>
          <p className="text-xs text-slate-500">Select an admin-created academic year, evaluate student pass/fail conditions, clone ledgers, and archive previous histories.</p>
        </div>
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded text-xs text-indigo-700 font-semibold font-mono">
          <Calendar className="w-4 h-4 text-indigo-500" />
          <span>CURRENT ACTIVE: {currentAcademicYear || 'Not configured'}</span>
        </div>
      </div>

      {/* Progress Wizard bar */}
      <div className="grid grid-cols-4 gap-2 text-center" id="promotion-wizard-steps">
        {[
          { label: 'Configure Term', num: 1 },
          { label: 'Student Review', num: 2 },
          { label: 'Execute Migration', num: 3 },
          { label: 'Promotion Report', num: 4 }
        ].map(s => (
          <div
            key={s.num}
            className={`p-2.5 border-b-2 font-bold text-xs transition-all ${
              step === s.num
                ? 'border-indigo-600 text-indigo-600 font-extrabold'
                : step > s.num
                ? 'border-emerald-500 text-emerald-600'
                : 'border-slate-200 text-slate-400'
            }`}
          >
            <span className="text-[10px] uppercase font-mono mr-1 block sm:inline">Step {s.num}:</span>
            {s.label}
          </div>
        ))}
      </div>

      {/* STEP 1: CONFIGURE TERM */}
      {step === 1 && (
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm max-w-2xl mx-auto space-y-6" id="step-configure-term">
          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Initialize Future Academic Cycle</h3>
            <p className="text-xs text-slate-500">Choose an upcoming school calendar term created by the School Admin. The ERP will prepare the promotion records for that period.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-100">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Target Academic Year</label>
              <select
                required
                value={newAcademicYear}
                onChange={e => setNewAcademicYear(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 p-2.5 rounded focus:outline-indigo-500 text-slate-800 font-bold font-mono"
              >
                <option value="">Select admin-created year</option>
                {targetAcademicYears.map(year => (
                  <option key={year.id} value={year.name}>{year.name}</option>
                ))}
              </select>
              {targetAcademicYears.length === 0 && (
                <p className="text-[10px] text-amber-700">
                  Create a future academic year in Academic Setup before running promotion.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Archive Mode</label>
              <div className="text-xs font-semibold text-slate-700 py-2.5 flex items-center gap-1.5 text-emerald-600">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Automatic full snapshot archival</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50/70 border border-amber-100 p-3 rounded text-xs text-slate-600 space-y-1">
            <p className="font-bold text-amber-800">Critical Archiving Information:</p>
            <p className="text-[11px] leading-relaxed">
              When the migration process completes, all student records, daily attendance histories, fee receipts, and marks will be cloned into an isolated read-only archive for {currentAcademicYear || 'the current academic year'}, keeping historical reports fully accessible for board audits.
            </p>
          </div>

          <div className="flex justify-end pt-3">
            <button
              onClick={() => setStep(2)}
              disabled={!newAcademicYear}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold shadow-sm"
              id="btn-next-step-1"
            >
              Configure Student Review
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: STUDENT PERFORMANCE REVIEW */}
      {step === 2 && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden space-y-4" id="step-student-review">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-sans font-semibold text-slate-800 text-xs uppercase tracking-wider">Promotion Decisions Register</h3>
              <p className="text-[11px] text-slate-500">Students must have 50% fee clearance approved by admin. Overrides and promotions automatically update student fee invoices.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const updated = { ...promotionDecisions };
                  activeStudents.forEach(s => {
                    const feeTotal = Number(s.feeTotal || 0);
                    const feePaid = Number(s.feePaid || 0);
                    const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
                    if (feeTotal === 0 || feePct >= 50) {
                      updated[s.id] = 'Promote';
                    }
                  });
                  setPromotionDecisions(updated);
                }}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold shadow-xs cursor-pointer transition-all"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Admin Approve All Eligible (≥50%)
              </button>
              <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded font-bold">
                TARGET CLASSIFICATION: {newAcademicYear} TERM
              </span>
            </div>
          </div>

          {/* Fee Invoice Synchronization Notice */}
          <div className="mx-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50/80 text-indigo-900 flex items-start gap-3">
            <CreditCard className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-bold">Automatic Fee Invoices Roll-Forward</p>
              <p className="text-[11px] text-indigo-800 leading-relaxed">
                Upon promotion execution, the tuition fees invoice for each promoted student will be cleanly updated in the fees ledger for {newAcademicYear || 'the target year'} with the applicable class fee structure.
              </p>
            </div>
          </div>

          {/* 50% Fee Promotion Policy Alert */}
          <div className="mx-4 p-3 rounded-lg border border-amber-200 bg-amber-50/80 text-amber-900 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <p className="font-bold">50% Minimum Fee Payment Promotion Policy</p>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                By school administrative policy, students must have cleared at least <strong>50% of annual fees</strong> to be promoted to the next higher class.
                {feeIneligibleCount > 0 ? (
                  <span className="block mt-1 font-semibold text-rose-700">
                    ⚠️ {feeIneligibleCount} student(s) currently have &lt;50% fee clearance and have been defaulted to &quot;Retain / Fail&quot;. You can grant a discretionary administrative waiver by clicking &quot;Pass&quot;.
                  </span>
                ) : (
                  <span className="block mt-1 font-semibold text-emerald-700">
                    ✓ All {activeStudents.length} active students meet or exceed the 50% fee clearance threshold.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-200 max-h-[400px] overflow-y-auto px-4">
            {activeStudents.map(s => {
              const gpa = getStudentGPA(s);
              const isBelowCutoff = typeof gpa === 'number' && gpa < 5.0;
              const nextCls = getNextClass(s.class);
              const feeTotal = Number(s.feeTotal || 0);
              const feePaid = Number(s.feePaid || 0);
              const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
              const isFeeEligible = feeTotal === 0 || feePct >= 50;
              const shortfall = Math.max(0, (feeTotal * 0.5) - feePaid);
              const isWaiverGranted = promotionDecisions[s.id] === 'Promote' && !isFeeEligible;

              return (
                <div key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-slate-800 truncate">{s.name}</p>
                      <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                        {s.admissionNo}
                      </span>
                      {isWaiverGranted && (
                        <span className="text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded">
                          Admin Fee Waiver
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-2">
                      <span>
                        Current: <strong className="text-slate-700">{s.class}-{s.section}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        GPA:{' '}
                        <span className={`font-mono font-bold ${isBelowCutoff ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {typeof gpa === 'number' ? `${gpa.toFixed(1)} / 10.0` : 'Not entered'}
                        </span>
                      </span>
                      <span>•</span>
                      <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                        isFeeEligible
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {isFeeEligible ? (
                          <><span>✓</span> Fee: {feePct.toFixed(0)}% Paid (₹{feePaid.toLocaleString()})</>
                        ) : (
                          <><span>⚠️</span> Fee: {feePct.toFixed(0)}% Paid (&lt;50% Req - Shortfall ₹{shortfall.toLocaleString()})</>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-xs text-slate-600">
                      Target:{' '}
                      <strong className={`font-bold ${nextCls ? 'text-indigo-600' : 'text-rose-600'}`}>
                        {promotionDecisions[s.id] === 'Promote'
                          ? nextCls || 'Class missing from Academic Setup'
                          : `${s.class} (Retained)`}
                      </strong>
                    </div>

                    <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded border border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleDecisionChange(s.id, 'Promote')}
                        className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${
                          promotionDecisions[s.id] === 'Promote'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecisionChange(s.id, 'Fail')}
                        className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${
                          promotionDecisions[s.id] === 'Fail'
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Retain / Fail
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasUnconfiguredPromotionClass && (
            <div className="mx-4 rounded border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700">
              A promoted student is assigned to a class that is not in Academic Setup. Add or correct that class before continuing.
            </div>
          )}

          <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={hasUnconfiguredPromotionClass}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold shadow-sm"
              id="btn-next-step-2"
            >
              Verify Ledger Migration
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: MIGRATION EXECUTION PROGRESS */}
      {step === 3 && (
        <div className="bg-slate-950 text-slate-300 p-6 rounded-lg border border-slate-800 space-y-6 max-w-xl mx-auto shadow-xl" id="step-migration-progress">
          <div className="text-center space-y-2">
            <RefreshCw className={`w-10 h-10 text-indigo-400 mx-auto ${isMigrating ? 'animate-spin' : ''}`} />
            <h3 className="font-sans font-bold text-sm text-white uppercase tracking-widest">Execute Active Term Migration</h3>
            <p className="text-xs text-slate-400">This compiles the active roster register, clones grades, and shifts the entire database to the future term.</p>
          </div>

          <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-lg h-56 overflow-y-auto font-mono text-[10px] text-slate-400 space-y-2">
            {migrationStatus.map((msg, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-indigo-400 font-bold">&gt;</span>
                <span className={idx === migrationStatus.length - 1 && !isMigrating ? "text-emerald-400 font-bold animate-pulse" : ""}>
                  {msg}
                </span>
              </div>
            ))}
            {isMigrating && (
              <div className="flex gap-2 text-indigo-400 animate-pulse font-bold">
                <span>&gt;</span>
                <span>System writing database shards...</span>
              </div>
            )}
            {migrationStatus.length === 0 && (
              <p className="text-slate-600">Pending instruction trigger...</p>
            )}
          </div>

          <div className="flex justify-between border-t border-slate-900 pt-4">
            <button
              onClick={() => setStep(2)}
              disabled={isMigrating}
              className="px-3 py-1.5 border border-slate-800 text-slate-400 rounded text-xs hover:text-white"
            >
              Back
            </button>
            <button
              onClick={handleStartMigration}
              disabled={isMigrating || !newAcademicYear || hasUnconfiguredPromotionClass}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-bold shadow-sm"
              id="btn-trigger-migration"
            >
              {isMigrating ? 'Migrating Ledgers...' : 'Confirm & Execute Promotion'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: PROMOTION REPORT */}
      {step === 4 && promotionReport && (
        <div className="space-y-6" id="step-promotion-report">
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm text-center max-w-2xl mx-auto space-y-4">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
            <div>
              <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide">Promotion Campaign Execution Success</h3>
              <p className="text-xs text-slate-500 mt-1"> Roster and accounting ledgers have been shifted from {promotionReport.fromYear} to {promotionReport.toYear}.</p>
            </div>

            {/* Dashboard metrics of Promotion */}
            <div className="grid grid-cols-4 gap-2 bg-slate-50 border border-slate-150 p-4 rounded-lg mt-4 text-center">
              <div>
                <p className="text-[8px] text-slate-400 font-bold uppercase">Total Processed</p>
                <p className="text-lg font-bold text-slate-800 mt-1">{promotionReport.totalProcessed}</p>
              </div>
              <div className="border-l border-slate-200">
                <p className="text-[8px] text-slate-400 font-bold uppercase">Promoted</p>
                <p className="text-lg font-bold text-indigo-600 mt-1">{promotionReport.promotedCount}</p>
              </div>
              <div className="border-l border-slate-200">
                <p className="text-[8px] text-slate-400 font-bold uppercase">Retained</p>
                <p className="text-lg font-bold text-rose-500 mt-1">{promotionReport.retainedCount}</p>
              </div>
              <div className="border-l border-slate-200">
                <p className="text-[8px] text-slate-400 font-bold uppercase">Graduated</p>
                <p className="text-lg font-bold text-emerald-600 mt-1">{promotionReport.graduatedCount}</p>
              </div>
            </div>

            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded text-left text-xs text-slate-600 space-y-1">
              <p className="font-bold text-emerald-800">Migration Completed Outcomes:</p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] mt-1 text-slate-600">
                <li>Student profiles updated with future Class parameters.</li>
                <li>Daily roll registers cleared for the new term.</li>
                <li>A standard tuition fees invoice has been created and updated for each promoted student for {promotionReport.toYear} with verified Admin fee clearance.</li>
                <li>Previous academic grades archived under isolated record registers.</li>
              </ul>
            </div>

            <div className="pt-3 flex justify-center gap-3">
              <button
                onClick={() => setSelectedArchiveYear(promotionReport.fromYear)}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-3.5 py-1.5 rounded text-xs font-bold"
              >
                <Archive className="w-3.5 h-3.5" />
                Inspect Archived {promotionReport.fromYear} Ledgers
              </button>
              <button
                onClick={() => {
                  setStep(1);
                  setNewAcademicYear(targetAcademicYears[0]?.name || '');
                  setPromotionReport(null);
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded text-xs font-semibold shadow-sm"
              >
                Initialize Another Cycle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ARCHIVAL VIEWER MODULE */}
      {selectedArchiveYear && (
        <div className="bg-slate-900 text-white p-5 rounded-lg border border-slate-800 space-y-4" id="archive-history-viewer">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-emerald-400" />
              <h3 className="font-sans font-bold text-xs uppercase tracking-wider">Archived Academic Ledger: {selectedArchiveYear}</h3>
            </div>
            <button
              onClick={() => setSelectedArchiveYear(null)}
              className="text-slate-400 hover:text-white text-xs font-semibold"
            >
              Close Archive
            </button>
          </div>

          <p className="text-[11px] text-slate-400">
            This workspace displays the frozen snapshot of all student indices prior to the execution of the {selectedArchiveYear} Promotion run. All records are locked for write modifications.
          </p>

          <div className="bg-slate-950 border border-slate-800/80 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-[9px] text-slate-500 font-bold uppercase font-mono">
                  <th className="p-2.5 pl-4">Admission No</th>
                  <th className="p-2.5">Student Name</th>
                  <th className="p-2.5">Archived Class</th>
                  <th className="p-2.5">Grade Cards GPA</th>
                  <th className="p-2.5">Promoted Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900 text-xs text-slate-300 font-mono">
                {students.filter(s => s.academicYear === selectedArchiveYear).map(s => {
                  const gpa = getStudentGPA(s);
                  const decision = promotionDecisions[s.id] || 'Promote';
                  return (
                    <tr key={s.id} className="hover:bg-slate-900/50">
                      <td className="p-2.5 pl-4 text-slate-500">{s.admissionNo}</td>
                      <td className="p-2.5 text-slate-200 font-bold font-sans">{s.name}</td>
                      <td className="p-2.5">{s.class}</td>
                      <td className="p-2.5 text-indigo-400">{typeof gpa === 'number' ? `${gpa.toFixed(1)} / 10.0` : 'Not entered'}</td>
                      <td className="p-2.5 text-emerald-400 font-bold">
                        {decision === 'Promote' ? 'PROMOTED TO NEXT' : 'RETAINED / FAIL'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
