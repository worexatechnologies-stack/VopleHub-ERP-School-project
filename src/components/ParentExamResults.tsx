import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  GraduationCap,
  Info,
  Layers,
  LockKeyhole,
  Printer,
  Search,
  Send,
  ShieldCheck,
  Star,
  TrendingUp,
  User,
  Users,
  ArrowRight,
} from 'lucide-react';
import { OfficialReportCardRecord, Student } from '../types';
import type { AuthUser } from '../utils/auth';
import AuthenticatedImage from './AuthenticatedImage';
import {
  useGetExamSchedulesQuery,
  useGetReportCardsQuery,
  useGenerateReportCardsMutation,
  usePublishReportCardsMutation,
} from '../store/api/examApi';
import { emitNotification } from '../services/notificationBus';
import { printElement } from '../utils/printElement';

export default function ParentExamResults({
  user,
  students = [],
  schoolName,
}: {
  user?: AuthUser;
  students?: Student[];
  schoolName?: string;
}) {
  const isParent = user?.role === 'Parent';
  const isStudent = user?.role === 'Student';
  const isAdmin = user?.role === 'School Admin' || user?.role === 'Super Admin';

  const { data: schedules = [], isLoading: schedulesLoading, refetch: refetchSchedules } = useGetExamSchedulesQuery();

  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [selectedWardId, setSelectedWardId] = useState<string>(() => {
    return students.length > 0 ? String(students[0].id) : 'all';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Selected schedule object
  const activeSchedule = useMemo(() => {
    if (!schedules.length) return null;
    if (selectedScheduleId) {
      return schedules.find((s) => s.id === selectedScheduleId) || schedules[0];
    }
    return schedules[0];
  }, [schedules, selectedScheduleId]);

  // Set default selected schedule
  React.useEffect(() => {
    if (schedules.length && !selectedScheduleId) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  // Query Report Cards for the active schedule
  const {
    data: reportCardsData,
    isLoading: reportCardsLoading,
    refetch: refetchReportCards,
  } = useGetReportCardsQuery(activeSchedule?.id || 0, {
    skip: !activeSchedule?.id,
  });

  const [generateReportCardsMutation, { isLoading: isGenerating }] = useGenerateReportCardsMutation();
  const [publishReportCardsMutation, { isLoading: isPublishing }] = usePublishReportCardsMutation();

  const activeWard = useMemo(() => {
    if (!students.length) return null;
    if (selectedWardId === 'all') return students[0];
    return students.find((s) => String(s.id) === selectedWardId) || students[0];
  }, [students, selectedWardId]);

  // Status flags
  const isMarksPublished = Boolean(activeSchedule?.marks_published || reportCardsData?.marks_published);
  const isReportCardsGenerated = Boolean(activeSchedule?.report_cards_generated || reportCardsData?.is_generated);
  const isReportCardsPublished = Boolean(activeSchedule?.report_cards_published || reportCardsData?.is_published);

  // Admin Action: Generate Report Cards (ONLY permitted after marks are published)
  const handleGenerate = async () => {
    if (!activeSchedule) return;
    if (!isMarksPublished) {
      setErrorMessage('Cannot generate report cards yet. Administrator must first verify and publish marks in Marks Entry.');
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await generateReportCardsMutation(activeSchedule.id).unwrap();
      setSuccessMessage(res.detail || 'Report cards generated successfully.');
      emitNotification({
        title: 'Report Cards Generated',
        message: `${activeSchedule.name} (${activeSchedule.class_name}) report cards ready for review.`,
        tone: 'success',
        source: 'report-cards',
      });
      void refetchReportCards();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to generate report cards.');
    }
  };

  // Admin Action: Publish Report Cards (Releases to Students and Parents)
  const handlePublish = async () => {
    if (!activeSchedule) return;
    if (!isReportCardsGenerated) {
      setErrorMessage('Please generate report cards first before publishing.');
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to officially publish report cards for ${activeSchedule.name} (${activeSchedule.class_name})? They will be immediately released to students and parents.`
      )
    ) {
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const res = await publishReportCardsMutation(activeSchedule.id).unwrap();
      setSuccessMessage(res.detail || 'Report cards published to students and parents.');
      emitNotification({
        title: 'Report Cards Published',
        message: `Official report cards for ${activeSchedule.name} are now published.`,
        tone: 'success',
        source: 'report-cards',
      });
      void refetchReportCards();
      void refetchSchedules();
    } catch (err: any) {
      setErrorMessage(err?.data?.detail || err?.message || 'Failed to publish report cards.');
    }
  };

  const handlePrint = (elementId: string) => printElement(elementId, 'Official Terminal Report Card');

  const rawCards = useMemo(() => {
    return (reportCardsData?.report_cards || []) as OfficialReportCardRecord[];
  }, [reportCardsData]);

  // Filter report cards based on parent/child or search query
  const displayedCards = useMemo(() => {
    let list = rawCards;

    if (isParent && activeWard) {
      list = list.filter((c) => String(c.student_id) === String(activeWard.id));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.student_name.toLowerCase().includes(q) ||
          c.admission_no.toLowerCase().includes(q) ||
          String(c.roll_no).includes(q)
      );
    }
    return list;
  }, [rawCards, isParent, activeWard, searchQuery]);

  return (
    <div className="space-y-6 animate-fade-in" id="report-cards-workspace">
      {/* Top Banner / Switchers */}
      <div className="portal-header-card space-y-4">
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-100 shrink-0">
              <GraduationCap className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="portal-pill-badge indigo">
                  Official Report Cards
                </span>
                {activeSchedule && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
                    {activeSchedule.class_name} · Academic Year {activeSchedule.academic_year || '2026-2027'}
                  </span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                Terminal Examination Grade Cards & Progress Reports
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {isAdmin
                  ? 'Step-by-step report card workflow: Verify & Publish Marks → Generate Report Cards → Publish to Students & Parents.'
                  : isParent
                  ? 'View and download official published academic report cards for your enrolled children.'
                  : 'View and download your official terminal examination report card.'}
              </p>
            </div>
          </div>

          {/* Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Exam Schedule Dropdown */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Select Exam:
              </label>
              <select
                value={activeSchedule?.id || ''}
                onChange={(e) => setSelectedScheduleId(Number(e.target.value))}
                disabled={schedulesLoading || schedules.length === 0}
                className="min-w-[200px] sm:min-w-[250px] rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer transition"
              >
                {schedulesLoading ? (
                  <option value="">Loading Examination Schedules...</option>
                ) : schedules.length === 0 ? (
                  <option value="">No Examination Schedules Found</option>
                ) : (
                  schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.class_name})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Parent Child Switcher */}
            {isParent && students.length > 1 && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Select Child:
                </label>
                <select
                  value={selectedWardId}
                  onChange={(e) => setSelectedWardId(e.target.value)}
                  className="min-w-[180px] sm:min-w-[220px] rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer transition"
                >
                  {students.map((w) => (
                    <option key={w.id} value={String(w.id)}>
                      {w.name} ({w.class} {w.section ? `- ${w.section}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ADMIN 3-STEP SEQUENTIAL PROGRESSION BAR                                   */}
        {/* ========================================================================= */}
        {isAdmin && activeSchedule && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Step 1: Verify & Publish Marks */}
              <div
                className={`p-3.5 rounded-2xl border flex items-start gap-3 transition ${
                  isMarksPublished
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : 'bg-white border-amber-200 text-amber-900'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${
                    isMarksPublished ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
                  }`}
                >
                  {isMarksPublished ? '✓' : '1'}
                </div>
                <div className="space-y-0.5">
                  <p className="font-black text-xs">Step 1: Marks Verification</p>
                  <p className="text-[11px] font-medium text-slate-600">
                    {isMarksPublished
                      ? 'Marks verified and published by admin.'
                      : 'Pending verification in Marks Entry section.'}
                  </p>
                </div>
              </div>

              {/* Step 2: Generate Report Cards */}
              <div
                className={`p-3.5 rounded-2xl border flex items-start gap-3 transition ${
                  isReportCardsGenerated
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : isMarksPublished
                    ? 'bg-white border-indigo-200 text-indigo-900'
                    : 'bg-slate-100/70 border-slate-200 text-slate-400 opacity-60'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${
                    isReportCardsGenerated
                      ? 'bg-emerald-600 text-white'
                      : isMarksPublished
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-300 text-slate-600'
                  }`}
                >
                  {isReportCardsGenerated ? '✓' : '2'}
                </div>
                <div className="space-y-0.5">
                  <p className="font-black text-xs">Step 2: Generate Report Cards</p>
                  <p className="text-[11px] font-medium text-slate-600">
                    {isReportCardsGenerated
                      ? 'Report cards generated. Review below.'
                      : isMarksPublished
                      ? 'Ready to generate report cards.'
                      : 'Awaiting Step 1 (Publish Marks).'}
                  </p>
                </div>
              </div>

              {/* Step 3: Publish Report Cards */}
              <div
                className={`p-3.5 rounded-2xl border flex items-start gap-3 transition ${
                  isReportCardsPublished
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                    : isReportCardsGenerated
                    ? 'bg-white border-indigo-200 text-indigo-900'
                    : 'bg-slate-100/70 border-slate-200 text-slate-400 opacity-60'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${
                    isReportCardsPublished
                      ? 'bg-emerald-600 text-white'
                      : isReportCardsGenerated
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-300 text-slate-600'
                  }`}
                >
                  {isReportCardsPublished ? '✓' : '3'}
                </div>
                <div className="space-y-0.5">
                  <p className="font-black text-xs">Step 3: Release to Parents</p>
                  <p className="text-[11px] font-medium text-slate-600">
                    {isReportCardsPublished
                      ? 'Distributed to students and parents.'
                      : isReportCardsGenerated
                      ? 'Ready for admin final approval.'
                      : 'Awaiting Step 2 generation.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons based on state */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                {isReportCardsPublished ? (
                  <span className="text-emerald-700 font-black flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> All Report Cards Published & Distributed
                  </span>
                ) : !isMarksPublished ? (
                  <span className="text-amber-700 font-bold flex items-center gap-1">
                    <LockKeyhole className="h-4 w-4" /> Report cards can only be generated after marks are verified & published.
                  </span>
                ) : !isReportCardsGenerated ? (
                  <span className="text-indigo-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4 text-indigo-600" /> Marks published! Click "Generate Report Cards" to prepare grade sheets.
                  </span>
                ) : (
                  <span className="text-indigo-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Report cards generated. Verify candidate sheets and click Publish.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Generate Button: Enabled ONLY when Marks are published */}
                {!isReportCardsGenerated && (
                  <button
                    type="button"
                    disabled={!isMarksPublished || isGenerating}
                    onClick={handleGenerate}
                    className="rounded-2xl bg-indigo-600 px-5 py-2 text-xs font-black text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={!isMarksPublished ? 'Verify & publish marks in Marks Entry first' : ''}
                  >
                    {isGenerating ? 'Generating...' : 'Generate Report Cards'}
                  </button>
                )}

                {/* Publish Button: Enabled ONLY after Report Cards are generated */}
                {isReportCardsGenerated && !isReportCardsPublished && (
                  <button
                    type="button"
                    disabled={isPublishing}
                    onClick={handlePublish}
                    className="rounded-2xl bg-indigo-600 px-5 py-2 text-xs font-black text-white hover:bg-indigo-700 shadow-xs shadow-indigo-500/20 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {isPublishing ? 'Publishing...' : 'Publish Report Cards to Students & Parents'}
                  </button>
                )}

                {/* Print All Button */}
                {isReportCardsPublished && (
                  <button
                    type="button"
                    onClick={() => handlePrint('report-cards-print-area')}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-xs transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Printer className="h-4 w-4" /> Print All Report Cards
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 font-bold shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 font-bold shadow-xs">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REPORT CARDS VIEW                                                         */}
      {/* ========================================================================= */}
      <div id="report-cards-print-area" className="space-y-6">
        {/* Pending Publishing Notice for Students & Parents */}
        {(isStudent || isParent) && !isReportCardsPublished && (
          <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/50 p-12 text-center space-y-3">
            <Clock className="mx-auto h-10 w-10 text-amber-500 animate-pulse" />
            <h4 className="text-base font-black text-amber-900">
              Report Cards Awaiting Final Administrator Publishing
            </h4>
            <p className="text-xs text-amber-700 max-w-md mx-auto leading-relaxed">
              Official progress report cards for {activeSchedule?.name || 'this exam'} are being evaluated and finalized
              by the school administration. Once officially published, your grade card will appear here.
            </p>
          </div>
        )}

        {/* Not Generated State for Admin */}
        {isAdmin && !isReportCardsGenerated && (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400 space-y-2">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="text-base font-bold text-slate-700">No report cards generated yet for this exam</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {!isMarksPublished
                ? 'Please verify and publish student marks in the Marks Entry tab first.'
                : 'Marks are published! Click "Generate Report Cards" above to compile progress cards.'}
            </p>
          </div>
        )}

        {/* List of Report Cards - ONLY rendered when Generated (for Admin) or Published (for Student/Parent) */}
        {((isAdmin && isReportCardsGenerated) || ((isStudent || isParent) && isReportCardsPublished)) &&
          displayedCards.map((card) => {
            const cardStudent = students.find((s) => String(s.id) === String(card.student_id));
            const cardSchoolName =
              card.school_name ||
              activeSchedule?.school_name ||
              (cardStudent as any)?.school ||
              (cardStudent as any)?.schoolName ||
              user?.schoolName ||
              schoolName ||
              '';

            return (
          <article
            key={card.id}
            id={`report-card-${card.id}`}
            className="relative overflow-hidden rounded-3xl border-2 border-slate-300 bg-white p-6 sm:p-8 shadow-sm space-y-6 print:border print:shadow-none"
          >
            {/* Watermark Logo */}
            <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-5 pointer-events-none select-none">
              <Award className="h-96 w-96 text-slate-900" />
            </div>

            {/* Report Card Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b-2 border-slate-900 pb-5">
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full">
                  Official Academic Report Card
                </span>
                {cardSchoolName && (
                  <h1 className="text-xl sm:text-2xl font-black text-slate-950 uppercase tracking-tight mt-1.5">
                    {cardSchoolName}
                  </h1>
                )}
                <h2 className={`${cardSchoolName ? 'text-sm sm:text-base font-extrabold text-indigo-700 mt-0.5' : 'text-2xl font-black text-slate-950 mt-1'} uppercase tracking-tight`}>
                  Terminal Progress Report
                </h2>
                <p className="text-xs font-bold text-slate-600 mt-0.5">
                  {card.exam_name} · Academic Session {card.academic_year}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Report Card No.</p>
                  <p className="font-mono text-sm font-black text-indigo-700">{card.report_card_no}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handlePrint(`report-card-${card.id}`)}
                  title="Print this Report Card"
                  className="no-print rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                >
                  <Printer className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Candidate Details Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Candidate Name</p>
                <p className="text-sm font-black text-slate-900">{card.student_name}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Admission No</p>
                <p className="font-mono text-xs font-extrabold text-slate-800">{card.admission_no || 'N/A'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Class & Section</p>
                <p className="text-xs font-extrabold text-slate-800">
                  {card.class_name} {card.section ? `- Section ${card.section}` : ''}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Roll Number</p>
                <p className="font-mono text-xs font-black text-indigo-700">#{card.roll_no}</p>
              </div>
            </div>

            {/* Subject Breakdown Table */}
            <div className="space-y-2">
              <h5 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                Subject-wise Performance & Evaluation
              </h5>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3.5">Subject</th>
                      <th className="p-3.5 text-center">Maximum Marks</th>
                      <th className="p-3.5 text-center">Marks Obtained</th>
                      <th className="p-3.5 text-center">Percentage</th>
                      <th className="p-3.5 text-center">Grade</th>
                      <th className="p-3.5">Teacher Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {card.papers.map((paper, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-3.5 font-black text-slate-900">{paper.subject_name}</td>
                        <td className="p-3.5 text-center font-semibold text-slate-600">{paper.max_marks}</td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-900">
                          {paper.marks_obtained}
                        </td>
                        <td className="p-3.5 text-center font-mono font-bold text-indigo-700">{paper.percentage}%</td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`rounded-lg px-2.5 py-0.5 text-xs font-black ${
                              paper.grade === 'A+' || paper.grade === 'A'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : paper.grade === 'B+' || paper.grade === 'B'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {paper.grade}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-600 text-[11px]">{paper.remarks || 'Satisfactory work'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals Footer */}
                  <tfoot className="bg-slate-50/90 font-bold text-slate-900 border-t-2 border-slate-200">
                    <tr>
                      <td className="p-3.5 uppercase tracking-wider text-[11px]">Grand Total</td>
                      <td className="p-3.5 text-center">{card.total_max}</td>
                      <td className="p-3.5 text-center font-mono text-sm font-black text-indigo-700">
                        {card.total_obtained}
                      </td>
                      <td className="p-3.5 text-center font-mono text-sm font-black text-indigo-700">
                        {card.percentage}%
                      </td>
                      <td className="p-3.5 text-center">
                        <span className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-black text-white">
                          {card.grade}
                        </span>
                      </td>
                      <td className="p-3.5 text-[11px] font-semibold text-emerald-700">{card.result_status}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Performance Summary Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Total Marks</p>
                <p className="text-lg font-black text-slate-900">
                  {card.total_obtained} / {card.total_max}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Overall Percentage</p>
                <p className="text-lg font-black text-indigo-700">{card.percentage}%</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Cumulative GPA</p>
                <p className="text-lg font-black text-emerald-700">{card.gpa} / 10.0</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">Class Standing</p>
                <p className="text-lg font-black text-purple-700">
                  Rank #{card.rank} <span className="text-[10px] text-slate-400 font-normal">({card.total_candidates})</span>
                </p>
              </div>
            </div>

            {/* Remarks & Conduct */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-1 text-xs text-slate-600">
              <p className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Faculty & Principal Remarks:
              </p>
              <p className="text-[11px] leading-relaxed italic">{card.conduct_remarks}</p>
            </div>

            {/* Signatures */}
            <div className="pt-6 border-t border-slate-200 flex items-end justify-between text-center text-xs">
              <div>
                <div className="h-10 w-32 border-b border-dashed border-slate-400 mx-auto" />
                <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Class Teacher Signature
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-2 text-indigo-800 text-[10px] font-bold flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                Verified & Certified by Institution
              </div>
              <div>
                <div className="h-10 w-32 border-b border-dashed border-slate-400 mx-auto" />
                <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Principal / Headmaster
                </p>
              </div>
            </div>
          </article>
        );
        })}
      </div>
    </div>
  );
}
