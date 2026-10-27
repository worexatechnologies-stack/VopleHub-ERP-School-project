import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Filter,
  GraduationCap,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Megaphone,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Building2,
  School,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { chatSocket, type ChatSocketStatus } from '../services/chatSocket';
import { playNotificationSound } from '../services/notificationSound';
import { type AuthUser } from '../utils/auth';
import type { Student } from '../types';
import { store } from '../store';
import { chatApi } from '../store/api/chatApi';
import { notificationApi } from '../store/api/notificationApi';
import { authApi } from '../store/api/authApi';
import { NOTIFICATION_EVENT, emitNotification } from '../services/notificationBus';
import { useGetTeachersQuery, type TeacherRecord, type TeacherApiAssignment } from '../store/api/teacherApi';
import { useGetStudentsQuery } from '../store/api/studentApi';
import { loadAcademicStructure, type AcademicClass, type AcademicSection } from '../services/academicStructure';

interface CommunicationModuleProps {
  user?: AuthUser | null;
  isGlass?: boolean;
  onNavigateToTab?: (tabId: string) => void;
}

/** Shape returned by GET /api/v1/notifications/ */
interface ApiNotification {
  id: number;
  senderId?: number;
  senderName: string;
  recipientId?: number;
  recipientName?: string;
  category: string;
  title: string;
  body: string;
  channel: string;
  status?: string;
  readAt: string | null;
  createdAt: string;
  requestStatus?: 'Pending' | 'Approved' | 'Declined' | 'Acknowledged';
}

interface ApiParticipant {
  id: number;
  name: string;
  role: string;
  email: string;
  isOnline: boolean;
  lastSeenAt?: string | null;
  assignedSections?: string[];
  subjects?: string[];
  childMappings?: TeacherChildInfo[];
  students?: ChatStudentInfo[];
  studentSummary?: string;
}

interface ApiConversation {
  id: number;
  otherParticipant: ApiParticipant;
  lastMessage?: {
    id: number;
    body: string;
    createdAt: string;
    senderId?: number;
    isMe?: boolean;
    readAt?: string | null;
    attachments?: Array<{ id: string; originalName: string; contentType?: string; fileSize?: number; downloadUrl?: string }>;
  } | null;
  unreadCount: number;
  updatedAt: string;
}

interface ApiDirectMessage {
  id: number;
  uuid?: string;
  conversationId: number;
  senderId: number;
  senderName: string;
  recipientId: number;
  recipientName: string;
  isMe: boolean;
  body: string;
  messageType?: string;
  clientKey?: string;
  replyToId?: number;
  editedAt?: string | null;
  isDeleted?: boolean;
  attachments?: Array<{
    id: string;
    originalName: string;
    contentType: string;
    fileSize: number;
    downloadUrl: string;
  }>;
  createdAt: string;
  readAt: string | null;
}

interface ChatStudentInfo {
  id: number | string;
  name: string;
  className: string;
  section: string;
  rollNo: number;
  admissionNo: string;
}

interface TeacherChildInfo {
  studentName: string;
  studentId: string | number;
  className: string;
  sectionName: string;
  subjects: string[];
}

interface ChatContact {
  id: string | number;
  userId?: number;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  isOfficeDesk?: boolean;
  assignedSections?: string[];
  subjects?: string[];
  teachingAssignments?: TeacherApiAssignment[];
  childMappings?: TeacherChildInfo[];
  students?: ChatStudentInfo[];
  studentSummary?: string;
  studentNames?: string[];
}

function formatPresenceStatus(isOnline: boolean, lastSeenAt?: string | null, isTyping?: boolean): string {
  if (isTyping) return 'typing...';
  if (isOnline) return 'online';
  if (!lastSeenAt) return 'offline';
  try {
    const d = new Date(lastSeenAt);
    if (isNaN(d.getTime())) return 'offline';
    const now = new Date();
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
    if (isToday) return 'last seen today at ' + timeStr;
    if (isYesterday) return 'last seen yesterday at ' + timeStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    if (d.getFullYear() === now.getFullYear()) {
      return 'last seen ' + d.getDate() + ' ' + month + ' at ' + timeStr;
    }
    return 'last seen ' + d.getDate() + ' ' + month + ' ' + d.getFullYear() + ' at ' + timeStr;
  } catch {
    return 'offline';
  }
}

// 3-second rapid live sync loop for real-time conversation feel
const POLL_MS = 3_000;
const HEARTBEAT_MS = 15_000;

const roleCopy: Record<string, { title: string; subtitle: string; channel: string; audience: string }> = {
  'Super Admin': {
    title: 'Global Communication Control',
    subtitle: 'Monitor tenant-wide broadcasts, escalation trails and branch delivery health.',
    channel: 'All schools',
    audience: 'Branches, admins and system operators',
  },
  'School Admin': {
    title: 'School Communication Desk',
    subtitle: 'Coordinate staff leave requests, announcements, direct teacher chats and urgent updates.',
    channel: 'Current school',
    audience: 'School teachers and faculty',
  },
  Teacher: {
    title: 'Teacher Communication Hub',
    subtitle: 'Submit leave requests, chat 1-on-1 with office desk & parents, and broadcast class updates.',
    channel: 'Assigned classes',
    audience: 'School office, parents and assigned students',
  },
  Parent: {
    title: 'Teacher 1-on-1 Chat Desk',
    subtitle: 'Direct private messaging with your children’s assigned class and subject teachers.',
    channel: 'Linked children',
    audience: 'Assigned subject & class teachers',
  },
  Student: {
    title: 'Student Notice Center',
    subtitle: 'Read class notices, assignment reminders and school announcements in one place.',
    channel: 'My class',
    audience: 'Teachers and coordinators',
  },
};

type BroadcastTarget = {
  endpoint: string;
  label: string;
  categories: string[];
};

const broadcastTargetsByRole: Record<string, BroadcastTarget[]> = {
  'School Admin': [
    { endpoint: '/notifications/teacher-to-students/', label: 'Notify Students', categories: ['Meeting', 'Announcements', 'Urgent', 'Exam Notice', 'Homework'] },
    { endpoint: '/notifications/teacher-to-parents/', label: 'Notify Parents', categories: ['Meeting', 'Announcements', 'Urgent', 'Exam Notice', 'Fee Notice'] },
    { endpoint: '/notifications/school-to-teachers/', label: 'Notify Teachers', categories: ['Meeting', 'Announcements', 'Urgent', 'Staff Notice'] },
  ],
  'Super Admin': [
    { endpoint: '/notifications/teacher-to-students/', label: 'Notify Students', categories: ['Meeting', 'Announcements', 'Urgent', 'Exam Notice'] },
    { endpoint: '/notifications/teacher-to-parents/', label: 'Notify Parents', categories: ['Meeting', 'Announcements', 'Urgent', 'Exam Notice'] },
    { endpoint: '/notifications/school-to-teachers/', label: 'Notify Teachers', categories: ['Meeting', 'Announcements', 'Urgent'] },
  ],
  Teacher: [
    { endpoint: '/notifications/teacher-to-students/', label: 'Assigned Students', categories: ['Assignment posted', 'Exam reminder', 'Class announcement', 'General', 'Urgent'] },
    { endpoint: '/notifications/teacher-to-parents/', label: 'Assigned Parents', categories: ['Homework reminder', 'Exam reminder', 'Absence follow-up', 'General', 'Urgent'] },
    { endpoint: '/notifications/teacher-to-admin/', label: 'Notify Admin / Office', categories: ['Leave Request', 'Holiday Request', 'General', 'Urgent', 'Resource Request', 'Student Query'] },
  ],
  Parent: [],
  Student: [],
};

// Helper: Correlates a teacher's assignments with the parent's children
function getTeacherChildMappings(teacher: TeacherRecord, students: Student[]): TeacherChildInfo[] {
  const mappings: TeacherChildInfo[] = [];

  students.forEach((s) => {
    const sClassName = (s.class || '').trim().toLowerCase();
    const sSectionName = (s.section || '').trim().toLowerCase();
    const sSectionId = s.sectionId;

    const matchedSubjects = new Set<string>();
    let isMatch = false;

    if (teacher.teachingAssignments && teacher.teachingAssignments.length > 0) {
      teacher.teachingAssignments.forEach((ta) => {
        const taClass = (ta.className || '').trim().toLowerCase();
        const taSection = (ta.sectionName || '').trim().toLowerCase();
        const taSectionId = ta.sectionId;

        const classMatches =
          !taClass ||
          taClass === sClassName ||
          sClassName.includes(taClass) ||
          taClass.includes(sClassName);

        const sectionMatches =
          (sSectionId && taSectionId && sSectionId === taSectionId) ||
          (taSection && (taSection === sSectionName || taSection.includes(sSectionName)));

        if (classMatches && sectionMatches) {
          isMatch = true;
          if (ta.subjectName) matchedSubjects.add(ta.subjectName);
        }
      });
    }

    if (!isMatch && teacher.assignedSections && teacher.assignedSections.length > 0) {
      teacher.assignedSections.forEach((sec) => {
        const secLower = sec.trim().toLowerCase();
        if (
          secLower === `${sClassName}-${sSectionName}` ||
          secLower === sSectionName ||
          secLower.includes(sSectionName)
        ) {
          isMatch = true;
        }
      });
    }

    if (isMatch) {
      const subjectsList = matchedSubjects.size > 0 ? Array.from(matchedSubjects) : teacher.subjects || [];
      mappings.push({
        studentName: s.name,
        studentId: s.id,
        className: s.class || '',
        sectionName: s.section || '',
        subjects: subjectsList,
      });
    }
  });

  // Fallback: If teacher is returned in parent's scoped list but assignment string didn't directly match
  if (mappings.length === 0 && students.length > 0) {
    if (students.length === 1) {
      mappings.push({
        studentName: students[0].name,
        studentId: students[0].id,
        className: students[0].class || '',
        sectionName: students[0].section || '',
        subjects: teacher.subjects || [],
      });
    } else {
      const foundStudent =
        students.find((s) => {
          const sClassName = (s.class || '').trim().toLowerCase();
          return (teacher.assignedSections || []).some((sec) => sec.toLowerCase().includes(sClassName));
        }) || students[0];

      mappings.push({
        studentName: foundStudent.name,
        studentId: foundStudent.id,
        className: foundStudent.class || '',
        sectionName: foundStudent.section || '',
        subjects: teacher.subjects || [],
      });
    }
  }

  return mappings;
}

/** Normalize attachment url to prevent cross-origin localhost:8000 / IP mismatches */
export function normalizeAttachmentUrl(url: string): string {
  if (!url) return '';
  return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i, '');
}

/** Securely download a file using Bearer token without exposing JWT in URL */
export async function downloadSecureAttachment(url: string, filename: string) {
  try {
    if (url.startsWith('blob:')) {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    const cleanUrl = normalizeAttachmentUrl(url);
    const res = await fetch(cleanUrl, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.error('Error downloading attachment:', err);
    const cleanUrl = normalizeAttachmentUrl(url);
    window.open(cleanUrl, '_blank');
  }
}

/** Formats a date string into chat date separator text: TODAY, YESTERDAY, or date */
function formatChatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'TODAY';
    if (diffDays === 1) return 'YESTERDAY';
    if (diffDays < 7) {
      return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
    }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  } catch {
    return '';
  }
}

/** Formats a timestamp for chat list items: "10:45 AM", "Yesterday", or "Oct 15" */
function formatConversationTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) {
      return 'Yesterday';
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface ChatImagePreviewProps {
  url: string;
  originalName: string;
  fileSize: number;
  timeStr: string;
  isMe: boolean;
  readAt: string | null;
  onOpenLightbox: (imageUrl: string, title: string) => void;
}

function ChatImagePreview({
  url,
  originalName,
  fileSize,
  timeStr,
  isMe,
  readAt,
  onOpenLightbox,
}: ChatImagePreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  const cleanUrl = useMemo(() => normalizeAttachmentUrl(url), [url]);

  const fetchImage = useCallback(async () => {
    if (!cleanUrl) return;
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await fetch(cleanUrl, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(`Failed to load image: ${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setBlobUrl(objectUrl);
      setIsLoading(false);
    } catch (err) {
      console.warn('Authenticated image fetch error:', err);
      setBlobUrl(cleanUrl);
      setIsLoading(false);
    }
  }, [cleanUrl]);

  useEffect(() => {
    let active = true;
    void fetchImage();
    return () => {
      active = false;
      if (blobUrl && blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [fetchImage]);

  return (
    <div className="relative group overflow-hidden rounded-xl bg-black/5 w-[240px] sm:w-[280px] max-w-full my-0.5 select-none">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-44 w-full bg-slate-200/60 animate-pulse rounded-xl">
          <ImageIcon className="w-8 h-8 text-slate-400 animate-bounce" />
          <span className="text-[10px] text-slate-500 font-bold mt-2">Loading photo…</span>
        </div>
      ) : hasError ? (
        <div className="flex flex-col items-center justify-center p-4 h-36 w-full bg-rose-50/70 rounded-xl text-center">
          <AlertTriangle className="w-6 h-6 text-rose-500 mb-1" />
          <p className="text-[11px] font-bold text-rose-700">Image failed to open</p>
          <button
            type="button"
            onClick={fetchImage}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-extrabold bg-white border border-rose-200 text-rose-700 rounded-lg shadow-2xs hover:bg-rose-50 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      ) : (
        <div
          className="relative cursor-pointer overflow-hidden rounded-xl"
          onClick={() => onOpenLightbox(blobUrl, originalName)}
        >
          <img
            src={blobUrl}
            alt={originalName}
            onError={() => setHasError(true)}
            className="w-full h-[190px] sm:h-[230px] object-cover rounded-xl transition duration-300 group-hover:scale-[1.02]"
          />

          {/* WhatsApp Hover Zoom Overlay */}
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <span className="bg-black/60 text-white rounded-full p-2.5 backdrop-blur-xs shadow-lg">
              <Maximize2 className="w-5 h-5" />
            </span>
          </div>

          {/* WhatsApp Overlaid Translucent Bottom-Right Time & Status Pill */}
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-black/60 backdrop-blur-xs text-white text-[10px] font-medium px-2 py-0.5 rounded-full shadow-xs">
            <span>{timeStr}</span>
            {isMe && (
              readAt ? (
                <CheckCheck aria-label="Read" className="w-3.5 h-3.5 text-sky-300" />
              ) : (
                <Check aria-label="Sent" className="w-3.5 h-3.5 text-white/80" />
              )
            )}
          </div>

          {/* Quick Download Button Top-Right on Hover */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void downloadSecureAttachment(blobUrl || url, originalName);
            }}
            title="Download image"
            className="absolute top-1.5 right-1.5 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function CommunicationModule({ user, isGlass = false, onNavigateToTab }: CommunicationModuleProps) {
  const resolvedRole = user?.role || 'School Admin';
  const copy = roleCopy[resolvedRole] || roleCopy['School Admin'];

  // ── Role-Specific Allowed Sub-Tabs ──────────────────────────────────────────
  const allowedSubTabs = useMemo<Array<'chats' | 'requests' | 'broadcasts'>>(() => {
    if (resolvedRole === 'Student') {
      return ['chats', 'requests'];
    }
    if (resolvedRole === 'Parent') {
      return ['chats'];
    }
    return ['chats', 'requests', 'broadcasts'];
  }, [resolvedRole]);

  // ── Main Sub-Tab State (Default to 'chats' for WhatsApp Chat Desk) ───────────
  const [activeSubTab, setActiveSubTab] = useState<'chats' | 'requests' | 'broadcasts'>('chats');

  useEffect(() => {
    if (resolvedRole === 'Parent') {
      setActiveSubTab('chats');
      return;
    }
    if (!allowedSubTabs.includes(activeSubTab)) {
      setActiveSubTab(allowedSubTabs[0]);
    }
  }, [resolvedRole, activeSubTab, allowedSubTabs]);

  // ── Academic Classes & Sections State (For Admin & Teacher Broadcasts) ──────
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [academicSections, setAcademicSections] = useState<AcademicSection[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | number>('All');
  const [selectedClassName, setSelectedClassName] = useState<string>('All');
  const [selectedSectionId, setSelectedSectionId] = useState<string | number>('All');
  const [selectedSectionName, setSelectedSectionName] = useState<string>('All');

  useEffect(() => {
    loadAcademicStructure()
      .then(({ classes, sections }) => {
        setAcademicClasses(classes);
        setAcademicSections(sections);
      })
      .catch(() => { });
  }, []);

  // ── Inbox & Notifications State ─────────────────────────────────────────────
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState('');
  const [requestFilter, setRequestFilter] = useState<'all' | 'requests' | 'urgent' | 'general'>('all');

  // ── Teacher Leave Request Modal / Form State ──────────────────────────────
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveTitle, setLeaveTitle] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveCategory, setLeaveCategory] = useState<'Leave Request' | 'Holiday Request'>('Leave Request');

  // ── Broadcast State ────────────────────────────────────────────────────────
  const targets = broadcastTargetsByRole[resolvedRole] ?? [];
  const [selectedTargetIdx, setSelectedTargetIdx] = useState(0);
  const selectedTarget = targets[selectedTargetIdx] ?? null;
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastCategory, setBroadcastCategory] = useState(selectedTarget?.categories[0] ?? 'Meeting');

  useEffect(() => {
    if (selectedTarget && !selectedTarget.categories.includes(broadcastCategory)) {
      setBroadcastCategory(selectedTarget.categories[0] ?? 'Meeting');
    }
  }, [selectedTargetIdx, selectedTarget]);

  const { data: teacherList = [], refetch: refetchTeachers } = useGetTeachersQuery();
  const { data: parentStudents = [] } = useGetStudentsQuery(undefined, { skip: resolvedRole !== 'Parent' });

  const [recipientMode, setRecipientMode] = useState<'all' | 'class_section' | 'individual'>('all');
  const [recipients, setRecipients] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // ── Teacher Assigned Classes & Sections Options ─────────────────────────────
  const currentTeacher = useMemo(() => {
    return teacherList.find((t) => (user?.id && t.userId === user.id) || (user?.email && t.email?.toLowerCase() === user.email.toLowerCase()));
  }, [teacherList, user]);

  const teacherAssignedOptions = useMemo(() => {
    if (!currentTeacher) return [];
    const options: Array<{ label: string; classId?: number; className?: string; sectionId?: number; sectionName?: string }> = [];

    if (currentTeacher.teachingAssignments && currentTeacher.teachingAssignments.length > 0) {
      const seen = new Set<string>();
      currentTeacher.teachingAssignments.forEach((ta) => {
        const cName = ta.className || (academicClasses.find((c) => c.id === ta.classId)?.name) || '';
        const sName = ta.sectionName || (academicSections.find((s) => s.id === ta.sectionId)?.name) || '';
        const key = `${ta.classId || cName}-${ta.sectionId || sName}`;
        if (!seen.has(key) && (cName || sName)) {
          seen.add(key);
          options.push({
            label: `${cName ? (cName.startsWith('Class') ? cName : `Class ${cName}`) : 'Class'} - Section ${sName || 'A'}`,
            classId: ta.classId,
            className: cName,
            sectionId: ta.sectionId,
            sectionName: sName,
          });
        }
      });
    }

    if (options.length === 0 && currentTeacher.assignedSections && currentTeacher.assignedSections.length > 0) {
      currentTeacher.assignedSections.forEach((sec) => {
        options.push({
          label: `Section ${sec}`,
          sectionName: sec,
        });
      });
    }

    return options;
  }, [currentTeacher, academicClasses, academicSections]);

  // ── Private Chat State (Isolated Conversations) ───────────────────────────
  const [contactSearch, setContactSearch] = useState('');
  const [adminClassFilter, setAdminClassFilter] = useState<string>('All');
  const [adminSectionFilter, setAdminSectionFilter] = useState<string>('All');
  const [teacherAudienceFilter, setTeacherAudienceFilter] = useState<'All' | 'Admin' | 'Parents'>('All');
  const [teacherClassFilter, setTeacherClassFilter] = useState<string>('All');
  const [parentChildFilter, setParentChildFilter] = useState<string>('All');

  const [backendContacts, setBackendContacts] = useState<ChatContact[]>([]);
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
  const [chatMessages, setChatMessages] = useState<ApiDirectMessage[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [socketStatus, setSocketStatus] = useState<ChatSocketStatus>('disconnected');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [highlightedMessageText, setHighlightedMessageText] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title?: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const highlightedMessageRef = useRef<HTMLDivElement | null>(null);
  const pendingChatRef = useRef<{
    conversationId?: number;
    senderId?: number;
    senderName?: string;
    highlightMessageText?: string;
  } | null>(null);
  const initialAutoSelectDone = useRef(false);

  const getSecureDownloadUrl = useCallback((url: string) => {
    if (!url) return '';
    return normalizeAttachmentUrl(url);
  }, []);

  const isImageAttachment = (att: { originalName: string; contentType?: string }) => {
    return (
      (att.contentType && att.contentType.startsWith('image/')) ||
      /\.(png|jpe?g|gif|webp|svg)$/i.test(att.originalName)
    );
  };

  // ── Real-Time Typing State & Ref Timers ────────────────────────────────────
  interface ActiveTypingEntry {
    conversationId?: number;
    userId: number;
    userName?: string;
    isTyping: boolean;
    text?: string;
  }

  const [typingMap, setTypingMap] = useState<Record<string, ActiveTypingEntry>>({});
  const typingTimeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSentRef = useRef<number>(0);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChatInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setChatMessage(val);

    const targetUid = selectedContact
      ? Number(selectedContact.userId || selectedContact.id)
      : undefined;

    const resolvedConvId =
      selectedConversationId ||
      (targetUid
        ? conversations.find((c) => Number(c.otherParticipant?.id) === targetUid)?.id
        : null);

    const isTyping = val.trim().length > 0;
    const now = Date.now();
    if (isTyping) {
      if (now - lastTypingSentRef.current > 250 || val.trim().length === 1) {
        if (resolvedConvId) {
          chatSocket.sendTyping(resolvedConvId, true, '', targetUid);
        } else if (targetUid) {
          chatSocket.sendAction('typing', {
            targetUserId: targetUid,
            isTyping: true,
            text: '',
          });
        }
        lastTypingSentRef.current = now;
      }

      if (stopTypingTimeoutRef.current) {
        clearTimeout(stopTypingTimeoutRef.current);
      }
      stopTypingTimeoutRef.current = setTimeout(() => {
        if (resolvedConvId) {
          chatSocket.sendTyping(resolvedConvId, false, '', targetUid);
        } else if (targetUid) {
          chatSocket.sendAction('typing', {
            targetUserId: targetUid,
            isTyping: false,
            text: '',
          });
        }
      }, 2500);
    } else {
      if (stopTypingTimeoutRef.current) {
        clearTimeout(stopTypingTimeoutRef.current);
      }
      if (resolvedConvId) {
        chatSocket.sendTyping(resolvedConvId, false, '', targetUid);
      } else if (targetUid) {
        chatSocket.sendAction('typing', {
          targetUserId: targetUid,
          isTyping: false,
          text: '',
        });
      }
    }
  };

  // Helper to resolve currently active typing status (ONLY OPPOSITE PERSON)
  const getActiveTyping = () => {
    const currentContactUid = selectedContact
      ? Number(selectedContact.userId || selectedContact.id)
      : null;

    // Only show typing if the opposite person (remote party) is typing
    const remoteTyping =
      (selectedConversationId &&
        typingMap[String(selectedConversationId)]?.isTyping &&
        typingMap[String(selectedConversationId)]) ||
      (currentContactUid &&
        typingMap['u_' + currentContactUid]?.isTyping &&
        typingMap['u_' + currentContactUid]) ||
      Object.values(typingMap).find(
        (t) =>
          t &&
          t.isTyping &&
          (!user || Number(t.userId) !== Number(user.id)) &&
          ((currentContactUid && Number(t.userId) === currentContactUid) ||
            (selectedConversationId && Number(t.conversationId) === Number(selectedConversationId)))
      ) ||
      null;

    // Ensure it is strictly from the opposite person, never the current user
    if (
      remoteTyping &&
      remoteTyping.isTyping &&
      (!user || Number(remoteTyping.userId) !== Number(user.id))
    ) {
      return {
        isTyping: true,
        isMe: false,
        userName: remoteTyping.userName || selectedContact?.name || 'Member',
        text: remoteTyping.text || '',
      };
    }

    return null;
  };

  // Load Conversations list (force fresh network fetch)
  const loadConversations = useCallback(async () => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getConversations.initiate(undefined, { forceRefetch: true }))
        .unwrap();
      setConversations(data as any);
    } catch {
      // silent
    }
  }, []);

  // Load Messages for active conversation (force fresh network fetch)
  const loadMessagesForConversation = useCallback(async (convId: number) => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getMessages.initiate(convId, { forceRefetch: true }))
        .unwrap();
      setChatMessages(data as any);
    } catch {
      // silent
    }
  }, []);

  // ── Real-Time WebSocket Connection & Event Synchronization ───────────────
  useEffect(() => {
    chatSocket.connect();

    const unsubStatus = chatSocket.subscribeStatus((status) => {
      setSocketStatus(status);
      if (status === 'connected') {
        void loadConversations();
        if (selectedConversationId) {
          chatSocket.joinConversation(selectedConversationId);
          chatSocket.markConversationRead(selectedConversationId);
          void loadMessagesForConversation(selectedConversationId);
        }
      }
    });

    const unsubMsg = chatSocket.on('message.created', (newMsg: ApiDirectMessage) => {
      const isFromMe = user ? Number(newMsg.senderId) === Number(user.id) : Boolean(newMsg.isMe);
      const isCurrentActive = selectedConversationId === newMsg.conversationId;

      if (!isFromMe) {
        void playNotificationSound({ type: 'message' });
      }

      if (isCurrentActive) {
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id || (m.clientKey && m.clientKey === newMsg.clientKey))) {
            return prev.map((m) => (m.clientKey && m.clientKey === newMsg.clientKey ? { ...newMsg, isMe: isFromMe } : m));
          }
          return [...prev, { ...newMsg, isMe: isFromMe }];
        });
        chatSocket.markConversationRead(newMsg.conversationId);
      }

      setTypingMap((prev) => ({
        ...prev,
        [newMsg.conversationId]: { isTyping: false },
      }));

      setConversations((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === newMsg.conversationId);
        if (existingIdx !== -1) {
          const existing = prev[existingIdx];
          const newUnread = isCurrentActive || isFromMe ? 0 : (existing.unreadCount || 0) + 1;
          const updatedConv = {
            ...existing,
            lastMessage: {
              id: newMsg.id,
              body: newMsg.body,
              createdAt: newMsg.createdAt,
              isMe: isFromMe,
              readAt: isCurrentActive && !isFromMe ? new Date().toISOString() : null,
              attachments: newMsg.attachments,
            },
            updatedAt: newMsg.createdAt,
            unreadCount: newUnread,
          };
          const rest = prev.filter((_, idx) => idx !== existingIdx);
          return [updatedConv, ...rest];
        } else {
          void loadConversations();
          return prev;
        }
      });
    });

    const unsubRead = chatSocket.on('conversation.read', (data: { conversationId: number; userId: number; readAt: string }) => {
      if (selectedConversationId && data.conversationId === selectedConversationId) {
        setChatMessages((prev) =>
          prev.map((m) => {
            const isMe = user ? Number(m.senderId) === Number(user.id) : Boolean(m.isMe);
            const wasReadByRecipient = Number(m.recipientId) === Number(data.userId);
            return isMe && wasReadByRecipient ? { ...m, readAt: data.readAt } : m;
          })
        );
      }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === data.conversationId && c.lastMessage) {
            const lastMsgIsMe = user ? Number(c.lastMessage.senderId) === Number(user.id) : Boolean(c.lastMessage.isMe);
            const readByOtherParticipant = Number(c.otherParticipant.id) === Number(data.userId);
            if (lastMsgIsMe && readByOtherParticipant) {
              return {
                ...c,
                lastMessage: {
                  ...c.lastMessage,
                  readAt: data.readAt,
                },
              };
            }
          }
          return c;
        })
      );
    });

    const unsubTyping = chatSocket.on(
      'typing.updated',
      (data: {
        conversationId?: number;
        userId: number;
        userName?: string;
        isTyping: boolean;
        text?: string;
      }) => {
        const convId = Number(data.conversationId);
        const uid = Number(data.userId);
        if (!convId && !uid) return;

        // Strictly ignore any typing event from the current logged-in user (only opposite person typing is shown)
        if (user && Number(data.userId) === Number(user.id)) {
          return;
        }

        const entry: ActiveTypingEntry = {
          conversationId: convId || undefined,
          userId: uid,
          userName: data.userName,
          isTyping: Boolean(data.isTyping),
          text: data.text || '',
        };

        setTypingMap((prev) => {
          const next = { ...prev };
          if (convId) next[String(convId)] = entry;
          if (uid) next['u_' + uid] = entry;
          return next;
        });

        const timerKey = String(convId || ('u_' + uid));
        if (typingTimeoutRefs.current[timerKey]) {
          clearTimeout(typingTimeoutRefs.current[timerKey]);
        }
        if (data.isTyping) {
          typingTimeoutRefs.current[timerKey] = setTimeout(() => {
            setTypingMap((prev) => {
              const next = { ...prev };
              if (convId) delete next[String(convId)];
              if (uid) delete next['u_' + uid];
              return next;
            });
          }, 3500);
        }
      }
    );

    const handlePresenceEvent = (data: { userId: number; isOnline: boolean; lastSeenAt?: string }) => {
      const uid = Number(data.userId);
      if (!uid) return;

      setConversations((prev) =>
        prev.map((c) => {
          if (c.otherParticipant && Number(c.otherParticipant.id) === uid) {
            return {
              ...c,
              otherParticipant: {
                ...c.otherParticipant,
                isOnline: data.isOnline,
                lastSeenAt: data.lastSeenAt || c.otherParticipant.lastSeenAt,
              },
            };
          }
          return c;
        })
      );
      setSelectedContact((prev) => {
        if (prev && (Number(prev.userId) === uid || Number(prev.id) === uid)) {
          return {
            ...prev,
            isOnline: data.isOnline,
            lastSeenAt: data.lastSeenAt || prev.lastSeenAt,
          };
        }
        return prev;
      });
      setBackendContacts((prev) =>
        prev.map((contact) => {
          const cUid = contact.userId != null ? Number(contact.userId) : Number(contact.id);
          if (cUid === uid) {
            return {
              ...contact,
              isOnline: data.isOnline,
              lastSeenAt: data.lastSeenAt || contact.lastSeenAt,
            };
          }
          return contact;
        })
      );
    };

    const unsubPresence = chatSocket.on('user.presence', handlePresenceEvent);

    const handleOnlineIds = (ids: number[]) => {
      if (!Array.isArray(ids)) return;
      const onlineSet = new Set(ids.map(Number));
      setConversations((prev) =>
        prev.map((c) => {
          if (c.otherParticipant && onlineSet.has(Number(c.otherParticipant.id))) {
            return {
              ...c,
              otherParticipant: { ...c.otherParticipant, isOnline: true },
            };
          }
          return c;
        })
      );
      setSelectedContact((prev) => {
        if (prev) {
          const pId = Number(prev.userId || prev.id);
          if (onlineSet.has(pId)) {
            return { ...prev, isOnline: true };
          }
        }
        return prev;
      });
      setBackendContacts((prev) =>
        prev.map((contact) => {
          const cUid = Number(contact.userId != null ? contact.userId : contact.id);
          if (onlineSet.has(cUid)) {
            return { ...contact, isOnline: true };
          }
          return contact;
        })
      );
    };

    const unsubReady = chatSocket.on('connection.ready', (data: any) => {
      if (data?.onlineUserIds) handleOnlineIds(data.onlineUserIds);
    });

    const unsubSnapshot = chatSocket.on('presence.snapshot', (data: any) => {
      if (data?.onlineUserIds) handleOnlineIds(data.onlineUserIds);
    });

    chatSocket.queryPresence();

    const unsubUnread = chatSocket.on('unread_count.updated', (data: { totalUnread: number; conversationId?: number; conversationUnread?: number }) => {
      if (data.conversationId !== undefined) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === data.conversationId) {
              const count = selectedConversationId === data.conversationId ? 0 : (data.conversationUnread ?? c.unreadCount);
              return { ...c, unreadCount: count };
            }
            return c;
          })
        );
      }
    });

    const unsubUpdate = chatSocket.on('message.updated', (updatedMsg: ApiDirectMessage) => {
      if (selectedConversationId && updatedMsg.conversationId === selectedConversationId) {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === updatedMsg.id ? { ...m, body: updatedMsg.body, editedAt: updatedMsg.editedAt } : m))
        );
      }
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === updatedMsg.conversationId && c.lastMessage && c.lastMessage.id === updatedMsg.id) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                body: updatedMsg.body,
              },
            };
          }
          return c;
        })
      );
    });

    const unsubDelete = chatSocket.on('message.deleted', (data: { id: number; conversationId?: number }) => {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === data.id ? { ...m, isDeleted: true, body: 'This message was deleted.' } : m))
      );
      if (data.conversationId) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === data.conversationId && c.lastMessage && c.lastMessage.id === data.id) {
              return {
                ...c,
                lastMessage: {
                  ...c.lastMessage,
                  body: 'This message was deleted.',
                },
              };
            }
            return c;
          })
        );
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      unsubRead();
      unsubTyping();
      unsubPresence();
      unsubReady();
      unsubSnapshot();
      unsubUnread();
      unsubUpdate();
      unsubDelete();
    };
  }, [selectedConversationId, user, loadConversations, loadMessagesForConversation]);

  useEffect(() => {
    chatSocket.activeConversationId = selectedConversationId;
    return () => {
      chatSocket.activeConversationId = null;
    };
  }, [selectedConversationId]);

  // ── Reset Modals State (Admin Only) ───────────────────────────────────────
  const [showResetNotifModal, setShowResetNotifModal] = useState(false);
  const [showResetChatModal, setShowResetChatModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const inboxContainerRef = useRef<HTMLDivElement>(null);
  const chatStreamContainerRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Scroll window to top on sub-tab change
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (inboxContainerRef.current) {
      inboxContainerRef.current.scrollTop = 0;
    }
  }, [activeSubTab]);

  // Presence Heartbeat Loop (keeps active status online)
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await store.dispatch(authApi.endpoints.presenceHeartbeat.initiate()).unwrap();
      } catch {
        // silent
      }
    };
    void sendHeartbeat();
    const interval = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Load Inbox Notifications (strictly broadcasts & requests)
  const loadNotifications = useCallback(async (showSpinner = false) => {
    if (showSpinner) setInboxLoading(true);
    try {
      const data = await store
        .dispatch(notificationApi.endpoints.getNotifications.initiate(undefined))
        .unwrap();
      setNotifications(data as any);
      setInboxError('');
    } catch (err) {
      setInboxError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setInboxLoading(false);
    }
  }, []);

  // Load Contacts list from role-scoped endpoint
  const loadContacts = useCallback(async (searchQuery?: string) => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getChatContacts.initiate(searchQuery ? { search: searchQuery } : undefined))
        .unwrap();
      if (Array.isArray(data)) {
        setBackendContacts(data as any);
      }
    } catch {
      // silent fallback
    }
  }, []);



  // Poll notifications & conversations periodically (do not poll contacts every 3s to prevent lag)
  useEffect(() => {
    void loadNotifications(true);
    void loadContacts();
    void loadConversations();
    void refetchTeachers();

    const interval = window.setInterval(() => {
      void loadNotifications();
      void loadConversations();
      if (selectedConversationId) {
        void loadMessagesForConversation(selectedConversationId);
      }
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadNotifications();
        void loadContacts();
        void loadConversations();
      }
    };
    const onCustomEvent = () => {
      void loadNotifications();
      void loadContacts();
      void loadConversations();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTIFICATION_EVENT, onCustomEvent);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(NOTIFICATION_EVENT, onCustomEvent);
    };
  }, [loadNotifications, loadContacts, loadConversations, loadMessagesForConversation, selectedConversationId, refetchTeachers]);

  // Build unified contacts list with real isOnline status (Strictly Scoped & Deduplicated)
  const contactsList: ChatContact[] = useMemo(() => {
    const contactMap = new Map<string, ChatContact>();

    // 1. FOR ADMIN (School Admin / Super Admin): STRICTLY ONLY TEACHERS
    if (resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') {
      teacherList.forEach((t) => {
        const key = t.userId ? `user-${t.userId}` : `teacher-${t.id}`;
        contactMap.set(key, {
          id: t.id,
          userId: t.userId,
          name: t.name,
          role: 'Teacher',
          email: t.email,
          phone: t.phone,
          isOnline: t.isOnline ?? false,
          assignedSections: t.assignedSections || [],
          subjects: t.subjects || [],
          teachingAssignments: t.teachingAssignments || [],
        });
      });
    }

    // 2. FOR PARENT: STRICTLY ONLY THE TEACHERS OF THEIR LINKED STUDENTS
    else if (resolvedRole === 'Parent') {
      teacherList.forEach((t) => {
        const childMappings = getTeacherChildMappings(t, parentStudents);
        const key = t.userId ? `user-${t.userId}` : `teacher-${t.id}`;
        contactMap.set(key, {
          id: t.id,
          userId: t.userId,
          name: t.name,
          role: 'Teacher',
          email: t.email,
          phone: t.phone,
          isOnline: t.isOnline ?? false,
          assignedSections: t.assignedSections || [],
          subjects: t.subjects || [],
          teachingAssignments: t.teachingAssignments || [],
          childMappings,
        });
      });
    }

    // 3. FOR TEACHER: School Admin / Office Desk + Parents of assigned students
    else if (resolvedRole === 'Teacher') {
      contactMap.set('role-admin-office', {
        id: 'admin-office',
        name: 'School Admin / Office Desk',
        role: 'School Admin',
        email: 'admin@school.edu',
        isOnline: true,
        isOfficeDesk: true,
      });

      teacherList.forEach((t) => {
        if (t.userId === user?.id || t.email === user?.email) return;
        const key = t.userId ? `user-${t.userId}` : `teacher-${t.id}`;
        contactMap.set(key, {
          id: t.id,
          userId: t.userId,
          name: t.name,
          role: 'Teacher',
          email: t.email,
          phone: t.phone,
          isOnline: t.isOnline ?? false,
          assignedSections: t.assignedSections || [],
          subjects: t.subjects || [],
          teachingAssignments: t.teachingAssignments || [],
        });
      });
    }

    // Include other participants from existing conversations (preserving online/email metadata)
    conversations.forEach((conv) => {
      if (conv.otherParticipant && conv.otherParticipant.id) {
        const p = conv.otherParticipant;
        const key = `user-${p.id}`;

        if (contactMap.has(key)) {
          const existing = contactMap.get(key)!;
          existing.isOnline = p.isOnline ?? existing.isOnline;
          if (p.email) existing.email = p.email;
        }
      }
    });

    const uniqueByNameMap = new Map<string, ChatContact>();
    Array.from(contactMap.values()).forEach((c) => {
      const normName = c.name.trim().toLowerCase();
      if (!uniqueByNameMap.has(normName)) {
        uniqueByNameMap.set(normName, c);
      } else {
        const existing = uniqueByNameMap.get(normName)!;
        if (!existing.userId && c.userId) existing.userId = c.userId;
        if (c.isOnline) existing.isOnline = true;
      }
    });

    return Array.from(uniqueByNameMap.values());
  }, [resolvedRole, teacherList, parentStudents, conversations, user]);

  // Prefer backend-scoped contacts when available, fallback to locally derived contactsList
  const effectiveContacts: ChatContact[] = useMemo(() => {
    const list = backendContacts.length > 0 ? backendContacts : contactsList;
    return list.filter((contact) => {
      const contactUid = contact.userId != null ? Number(contact.userId) : Number(contact.id);
      if (user?.id && contactUid && contactUid === Number(user.id)) return false;
      return true;
    });
  }, [backendContacts, contactsList, user?.id]);

  // Handle Contact Selection
  const handleSelectContact = async (contact: ChatContact, highlightText?: string) => {
    const currentUserId = user?.id ? Number(user.id) : null;
    const contactUid = contact.userId != null ? Number(contact.userId) : Number(contact.id);
    if (currentUserId && contactUid && contactUid === currentUserId) {
      emitNotification({
        title: 'Own Account',
        message: 'You cannot open a private chat with your own account. Please choose another member.',
        tone: 'warning',
        source: 'communication',
      });
      return;
    }

    setSelectedContact(contact);
    setChatLoading(true);
    setChatMessages([]);
    if (highlightText) {
      setHighlightedMessageText(highlightText);
      setTimeout(() => setHighlightedMessageText(null), 6000);
    }

    try {
      const body: Record<string, any> = {};
      const uid = contact.userId != null ? Number(contact.userId) : Number(contact.id);
      if (!isNaN(uid) && uid > 0) {
        if (contact.role === 'Teacher' && !contact.userId && contact.id) {
          body.teacherId = Number(contact.id);
        } else {
          body.targetUserId = uid;
        }
      } else if (contact.id === 'admin-office' || contact.isOfficeDesk) {
        body.targetUserId = 'admin-office';
      }

      if (contact.childMappings && contact.childMappings.length > 0 && contact.childMappings[0].studentId) {
        const sId = Number(contact.childMappings[0].studentId);
        if (!isNaN(sId) && sId > 0) {
          body.studentId = sId;
        }
      }

      const conv = await store.dispatch(chatApi.endpoints.startConversation.initiate(body)).unwrap();

      setSelectedConversationId(conv.id);
      chatSocket.joinConversation(conv.id);
      chatSocket.markConversationRead(conv.id);
      const msgs = await store
        .dispatch(chatApi.endpoints.getMessages.initiate(conv.id))
        .unwrap();
      setChatMessages(msgs as any);
      void loadConversations();
    } catch (err: any) {
      const detail =
        err?.data?.detail ||
        err?.data?.message ||
        err?.error ||
        err?.message ||
        'Could not open private chat channel.';
      emitNotification({ title: 'Chat Error', message: detail, tone: 'danger', source: 'communication' });
    } finally {
      setChatLoading(false);
    }
  };

  // Handle Conversation Selection (Immediate Unread Badge Reset)
  const handleSelectConversation = useCallback(
    async (conv: ApiConversation) => {
      // 1. Optimistically clear unread count badge immediately so it disappears upon click
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
      );

      setSelectedConversationId(conv.id);
      setSelectedContact({
        id: conv.otherParticipant.id,
        userId: conv.otherParticipant.id,
        name: conv.otherParticipant.name,
        role: conv.otherParticipant.role,
        email: conv.otherParticipant.email,
        isOnline: conv.otherParticipant.isOnline,
        assignedSections: conv.otherParticipant.assignedSections,
        subjects: conv.otherParticipant.subjects,
        childMappings: conv.otherParticipant.childMappings,
        students: conv.otherParticipant.students,
        studentSummary: conv.otherParticipant.studentSummary,
      });
      setChatLoading(true);
      setChatMessages([]);

      try {
        chatSocket.joinConversation(conv.id);
        chatSocket.markConversationRead(conv.id);
        const msgs = await store.dispatch(chatApi.endpoints.getMessages.initiate(conv.id)).unwrap();
        setChatMessages(msgs as any);
      } catch {
        // silent
      } finally {
        setChatLoading(false);
      }
    },
    []
  );

  // Debounced Contact Search with Backend
  useEffect(() => {
    const q = contactSearch.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      void loadContacts(q);
    }, 250);
    return () => clearTimeout(timer);
  }, [contactSearch, loadContacts]);

  const openChatWith = useCallback(
    async (params: {
      conversationId?: number;
      senderId?: number;
      senderName?: string;
      highlightMessageText?: string;
    }) => {
      setActiveSubTab('chats');

      if (params.highlightMessageText) {
        setHighlightedMessageText(params.highlightMessageText);
        setTimeout(() => setHighlightedMessageText(null), 6000);
      }

      // 1. Try to match contact in effectiveContacts by senderId or name
      let contact = effectiveContacts.find(
        (c) =>
          (params.senderId && (c.userId === params.senderId || c.id === params.senderId)) ||
          (params.senderName &&
            (c.name.toLowerCase() === params.senderName.toLowerCase() ||
              c.name.toLowerCase().includes(params.senderName.toLowerCase()) ||
              params.senderName.toLowerCase().includes(c.name.toLowerCase())))
      );

      // 2. If not found in effectiveContacts, check existing conversations
      if (!contact && conversations.length > 0) {
        const conv = conversations.find(
          (c) =>
            (params.conversationId && c.id === params.conversationId) ||
            (params.senderId && c.otherParticipant?.id === params.senderId) ||
            (params.senderName &&
              c.otherParticipant?.name &&
              (c.otherParticipant.name.toLowerCase() === params.senderName.toLowerCase() ||
                c.otherParticipant.name.toLowerCase().includes(params.senderName.toLowerCase()) ||
                params.senderName.toLowerCase().includes(c.otherParticipant.name.toLowerCase())))
        );
        if (conv?.otherParticipant) {
          contact = {
            id: conv.otherParticipant.id,
            userId: conv.otherParticipant.id,
            name: conv.otherParticipant.name,
            role: conv.otherParticipant.role,
            email: conv.otherParticipant.email,
            isOnline: conv.otherParticipant.isOnline,
          };
        }
      }

      // 3. If contact found, select it
      if (contact) {
        pendingChatRef.current = null;
        await handleSelectContact(contact, params.highlightMessageText);
        return;
      }

      // 4. If conversationId is known directly
      if (params.conversationId) {
        pendingChatRef.current = null;
        setSelectedConversationId(params.conversationId);
        chatSocket.joinConversation(params.conversationId);
        chatSocket.markConversationRead(params.conversationId);
        setChatLoading(true);
        try {
          const msgs = await store
            .dispatch(chatApi.endpoints.getMessages.initiate(params.conversationId))
            .unwrap();
          setChatMessages(msgs as any);
        } catch {
          // ignore
        } finally {
          setChatLoading(false);
        }
        return;
      }

      // If contacts haven't loaded yet, store as pending
      pendingChatRef.current = params;
    },
    [effectiveContacts, conversations]
  );

  const openChatFromNotification = (n: ApiNotification) => {
    void markRead(n.id);
    const rel = (n as any).relatedObject || (n as any).related_object;
    let sName = n.senderName;
    if ((!sName || sName === 'School office') && n.title && n.title.toLowerCase().startsWith('new message from ')) {
      sName = n.title.slice(17).trim();
    }
    void openChatWith({
      conversationId: rel?.conversationId,
      senderId: n.senderId || rel?.senderId,
      senderName: sName,
      highlightMessageText: n.body,
    });
  };

  // Listen for open-chat event and process pending_open_chat from sessionStorage
  useEffect(() => {
    const handleOpenChatEvent = (e: any) => {
      const detail = e.detail;
      if (detail) {
        void openChatWith(detail);
      }
    };

    window.addEventListener('open-chat', handleOpenChatEvent);

    try {
      const pending = sessionStorage.getItem('pending_open_chat');
      if (pending) {
        sessionStorage.removeItem('pending_open_chat');
        const parsed = JSON.parse(pending);
        if (parsed) {
          void openChatWith(parsed);
        }
      }
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener('open-chat', handleOpenChatEvent);
    };
  }, [openChatWith]);

  useEffect(() => {
    if (pendingChatRef.current && (effectiveContacts.length > 0 || conversations.length > 0)) {
      const p = pendingChatRef.current;
      pendingChatRef.current = null;
      void openChatWith(p);
    } else if (
      !initialAutoSelectDone.current &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 1024 &&
      !selectedConversationId &&
      conversations.length > 0 &&
      activeSubTab === 'chats' &&
      !pendingChatRef.current
    ) {
      initialAutoSelectDone.current = true;
      void handleSelectConversation(conversations[0]);
    } else if (
      !initialAutoSelectDone.current &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 1024 &&
      !selectedContact &&
      !selectedConversationId &&
      effectiveContacts.length > 0 &&
      activeSubTab === 'chats' &&
      !pendingChatRef.current &&
      conversations.length === 0
    ) {
      initialAutoSelectDone.current = true;
      void handleSelectContact(effectiveContacts[0]);
    }
  }, [effectiveContacts.length, conversations, activeSubTab, openChatWith, selectedConversationId, selectedContact, handleSelectConversation]);

  // Scroll to highlighted message when loaded
  useEffect(() => {
    if (highlightedMessageText && highlightedMessageRef.current) {
      highlightedMessageRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedMessageText, chatMessages]);

  // Mark Notification Read
  const markRead = async (id: number) => {
    try {
      const updated = await store.dispatch(notificationApi.endpoints.markNotificationRead.initiate(id)).unwrap();
      setNotifications((prev) => prev.map((n) => (n.id === id ? (updated as any) : n)));
    } catch {
      // silent
    }
  };

  // Admin Decision (Approve / Decline Leave Request)
  const handleRequestDecision = async (notification: ApiNotification, status: 'Approved' | 'Declined') => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, status, requestStatus: status } : n))
    );

    emitNotification({
      title: `Request ${status}`,
      message: `"${notification.title}" from ${notification.senderName} has been ${status.toLowerCase()}.`,
      tone: status === 'Approved' ? 'success' : 'danger',
      source: 'communication',
    });

    try {
      await store
        .dispatch(
          notificationApi.endpoints.respondNotificationDecision.initiate({
            id: notification.id,
            action: status === 'Approved' ? 'Approve' : 'Reject',
          })
        )
        .unwrap();
      void loadNotifications();
    } catch {
      void loadNotifications();
    }
  };

  // Admin Clear All Notifications Reset
  const handleClearAllNotifications = async () => {
    setIsResetting(true);
    try {
      await store.dispatch(notificationApi.endpoints.clearAllNotifications.initiate()).unwrap();
      setNotifications([]);
      emitNotification({ title: 'Notifications Reset', message: 'All notification records have been cleared.', tone: 'info', source: 'communication' });
      setShowResetNotifModal(false);
    } catch {
      emitNotification({ title: 'Reset Failed', message: 'Could not clear notifications.', tone: 'danger', source: 'communication' });
    } finally {
      setIsResetting(false);
    }
  };

  // Admin Clear All Chats Reset
  const handleClearAllChats = async () => {
    setIsResetting(true);
    try {
      await store.dispatch(chatApi.endpoints.clearAllChats.initiate()).unwrap();
      setConversations([]);
      setChatMessages([]);
      setSelectedConversationId(null);
      emitNotification({ title: 'Chats Reset', message: 'All chat messages and conversations have been cleared.', tone: 'info', source: 'communication' });
      setShowResetChatModal(false);
    } catch {
      emitNotification({ title: 'Reset Failed', message: 'Could not clear chat data.', tone: 'danger', source: 'communication' });
    } finally {
      setIsResetting(false);
    }
  };

  // Teacher Submitting Leave / Holiday Request
  const handleSubmitLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveTitle.trim() || !leaveReason.trim()) return;
    setIsSending(true);
    try {
      await store
        .dispatch(
          notificationApi.endpoints.notifyAdmin.initiate({
            recipientMode: 'all',
            recipients: [],
            category: leaveCategory,
            title: leaveTitle.trim(),
            body: leaveReason.trim(),
          })
        )
        .unwrap();

      emitNotification({
        title: `${leaveCategory} Submitted`,
        message: `Your request "${leaveTitle.trim()}" was sent to the School Office for approval.`,
        tone: 'success',
        source: 'communication',
      });

      setLeaveTitle('');
      setLeaveReason('');
      setShowLeaveForm(false);
      void loadNotifications();
    } catch {
      emitNotification({ title: 'Submission Failed', message: 'Could not submit leave request.', tone: 'danger', source: 'communication' });
    } finally {
      setIsSending(false);
    }
  };

  // Send Broadcast Announcement
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget || !broadcastTitle.trim() || !broadcastBody.trim()) return;
    setSendError('');
    setIsSending(true);
    try {
      const payload: Record<string, any> = {
        category: broadcastCategory,
        title: broadcastTitle.trim(),
        body: broadcastBody.trim(),
      };

      if (selectedTarget.endpoint === '/notifications/school-to-teachers/') {
        payload.recipientMode = recipientMode === 'individual' ? 'individual' : 'all';
        if (recipientMode === 'individual') {
          payload.recipients = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
        }
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-admin/') {
        payload.recipientMode = 'all';
      } else {
        // teacher-to-students or teacher-to-parents
        if (recipientMode === 'all') {
          payload.recipientMode = 'all';
        } else if (recipientMode === 'class_section') {
          payload.recipientMode = 'class';
          if (selectedClassId !== 'All') {
            payload.targetClassId = Number(selectedClassId);
            payload.targetClass = selectedClassName !== 'All' ? selectedClassName : '';
          }
          if (selectedSectionId !== 'All') {
            payload.targetSectionId = Number(selectedSectionId);
            payload.targetSection = selectedSectionName !== 'All' ? selectedSectionName : '';
          }
        } else if (recipientMode === 'individual') {
          payload.recipientMode = 'individual';
          payload.recipients = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
        }
      }

      let result: { created: number };
      if (selectedTarget.endpoint === '/notifications/school-to-teachers/') {
        result = await store.dispatch(notificationApi.endpoints.notifyTeachers.initiate(payload as any)).unwrap();
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-parents/') {
        result = await store.dispatch(notificationApi.endpoints.notifyParents.initiate(payload as any)).unwrap();
      } else if (selectedTarget.endpoint === '/notifications/teacher-to-students/') {
        result = await store.dispatch(notificationApi.endpoints.notifyStudents.initiate(payload as any)).unwrap();
      } else {
        result = await store.dispatch(notificationApi.endpoints.notifyAdmin.initiate(payload as any)).unwrap();
      }

      emitNotification({
        title: `${selectedTarget.label} sent`,
        message: `"${broadcastTitle.trim()}" delivered to ${result.created} recipient${result.created === 1 ? '' : 's'}.`,
        tone: broadcastCategory === 'Urgent' ? 'danger' : 'success',
        source: 'communication',
      });
      setBroadcastTitle('');
      setBroadcastBody('');
      setRecipients('');
      void loadNotifications();
    } catch (err: any) {
      const detail = err?.data?.recipients?.[0] || err?.data?.detail || (err instanceof Error ? err.message : 'Send failed. Please try again.');
      setSendError(detail);
    } finally {
      setIsSending(false);
    }
  };

  // Send Direct Private 1-on-1 Chat with Instant Optimistic UI
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!chatMessage.trim() && selectedFiles.length === 0) || !selectedConversationId) return;

    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }
    chatSocket.sendTyping(selectedConversationId, false);

    setIsSendingChat(true);
    const msgText = chatMessage.trim();
    const filesToSend = [...selectedFiles];
    setChatMessage('');
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';

    const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`;
    const tempId = -Date.now();

    // 1. Instantly append optimistic message to chat stream
    const optimisticMsg: ApiDirectMessage = {
      id: tempId,
      conversationId: selectedConversationId,
      senderId: Number(user?.id) || 0,
      senderName: user?.name || 'Me',
      recipientId: Number(selectedContact?.userId) || 0,
      recipientName: selectedContact?.name || '',
      isMe: true,
      body: msgText,
      messageType: filesToSend.length > 0 ? 'attachment' : 'text',
      clientKey: idempotencyKey,
      createdAt: new Date().toISOString(),
      readAt: null,
      isDeleted: false,
    };
    setChatMessages((prev) => [...prev, optimisticMsg]);

    // 2. Instantly update sidebar preview to top
    setConversations((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === selectedConversationId);
      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        const updatedConv = {
          ...existing,
          lastMessage: {
            id: tempId,
            body: msgText || (filesToSend.length > 0 ? '[Attachment]' : ''),
            createdAt: optimisticMsg.createdAt,
            isMe: true,
            readAt: null,
          },
          updatedAt: optimisticMsg.createdAt,
        };
        const rest = prev.filter((_, idx) => idx !== existingIdx);
        return [updatedConv, ...rest];
      }
      return prev;
    });

    try {
      const newMsg = await store
        .dispatch(
          chatApi.endpoints.sendMessage.initiate({
            conversationId: selectedConversationId,
            message: msgText,
            client_idempotency_key: idempotencyKey,
            files: filesToSend.length > 0 ? filesToSend : undefined,
          })
        )
        .unwrap();

      const serverMsg = { ...newMsg, isMe: true };
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === tempId || (m.clientKey && m.clientKey === idempotencyKey) ? (serverMsg as any) : m
        )
      );

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === selectedConversationId && c.lastMessage && c.lastMessage.id === tempId) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                id: newMsg.id,
              },
            };
          }
          return c;
        })
      );
    } catch (err: any) {
      setChatMessages((prev) => prev.filter((m) => m.id !== tempId));
      const detail = err?.data?.detail || err?.data?.message || (err instanceof Error ? err.message : 'Could not deliver chat message.');
      emitNotification({ title: 'Message failed', message: detail, tone: 'danger', source: 'communication' });
    } finally {
      setIsSendingChat(false);
    }
  };

  const isLeaveRequest = (n: ApiNotification) => {
    const cat = n.category?.toLowerCase() || '';
    const title = n.title?.toLowerCase() || '';
    return cat.includes('leave') || cat.includes('holiday') || cat.includes('request') || title.includes('leave') || title.includes('holiday');
  };

  const filteredNotifications = notifications.filter((n) => {
    // Exclude 1-on-1 chat direct messages from notices circular view
    if (n.channel === 'chat') return false;
    // Strict recipient isolation: if an item is explicitly targeted to another user, never show it
    if (user?.id && n.recipientId && String(n.recipientId) !== String(user.id)) return false;

    if (requestFilter === 'requests') return isLeaveRequest(n);
    if (requestFilter === 'urgent') return n.category?.toLowerCase().includes('urgent');
    if (requestFilter === 'general') return !isLeaveRequest(n) && !n.category?.toLowerCase().includes('urgent');
    return true;
  });

  const unreadCount = filteredNotifications.filter((n) => !n.readAt).length;
  const pendingRequestsCount = notifications.filter((n) => isLeaveRequest(n) && (n.requestStatus || n.status || 'Pending') === 'Pending').length;
  const totalChatUnreadCount = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }, [conversations]);

  // Admin available section tags
  const adminAvailableSections = useMemo(() => {
    const secSet = new Set<string>();
    effectiveContacts.forEach((c) => {
      (c.assignedSections || []).forEach((sec) => {
        if (sec.includes('- Sec ')) {
          const part = sec.split('- Sec ')[1]?.trim();
          if (part) secSet.add(part);
        } else if (sec.includes('- Section ')) {
          const part = sec.split('- Section ')[1]?.trim();
          if (part) secSet.add(part);
        } else if (sec.startsWith('Sec ') || sec.startsWith('Section ')) {
          const part = sec.replace('Section', '').replace('Sec', '').trim();
          if (part) secSet.add(part);
        }
      });
    });
    return Array.from(secSet).sort();
  }, [effectiveContacts]);

  // Teacher available student class tags
  const teacherAvailableClasses = useMemo(() => {
    const clsSet = new Set<string>();
    effectiveContacts.forEach((c) => {
      if (c.role === 'Parent' && c.students) {
        c.students.forEach((s) => {
          if (s.className) clsSet.add(s.className.startsWith('Class') ? s.className : `Class ${s.className}`);
        });
      }
    });
    return Array.from(clsSet).sort();
  }, [effectiveContacts]);

  // Parent child selector list (handles multiple sons / children)
  const parentChildrenList = useMemo(() => {
    if (parentStudents.length > 0) {
      return parentStudents.map((s) => ({
        id: String(s.id),
        name: s.name,
        classLabel: `${s.class ? (s.class.startsWith('Class') ? s.class : `Class ${s.class}`) : 'Class'} - Sec ${s.section || 'A'}`,
      }));
    }
    const childMap = new Map<string, { id: string; name: string; classLabel: string }>();
    effectiveContacts.forEach((c) => {
      (c.childMappings || []).forEach((cm) => {
        const key = String(cm.studentId || cm.studentName);
        if (!childMap.has(key)) {
          childMap.set(key, {
            id: String(cm.studentId || cm.studentName),
            name: cm.studentName,
            classLabel: `${cm.className.startsWith('Class') ? cm.className : `Class ${cm.className}`} - Sec ${cm.sectionName}`,
          });
        }
      });
    });
    return Array.from(childMap.values());
  }, [parentStudents, effectiveContacts]);

  // Filter contacts by search, class/section filter (Admin), audience & student class (Teacher), and child filter (Parent)
  const filteredContacts = useMemo(() => {
    return effectiveContacts.filter((c) => {
      const q = contactSearch.toLowerCase().trim();

      // Search match
      const nameMatches = c.name.toLowerCase().includes(q);
      const roleMatches = c.role.toLowerCase().includes(q);
      const emailMatches = (c.email || '').toLowerCase().includes(q);
      const subjectsMatch = (c.subjects || []).some((s) => s.toLowerCase().includes(q));
      const sectionsMatch = (c.assignedSections || []).some((sec) => sec.toLowerCase().includes(q));
      const summaryMatch = (c.studentSummary || '').toLowerCase().includes(q);
      const studentNamesMatch = (c.studentNames || []).some((sn) => sn.toLowerCase().includes(q));
      const childMatch = (c.childMappings || []).some(
        (cm) =>
          cm.studentName.toLowerCase().includes(q) ||
          cm.className.toLowerCase().includes(q) ||
          cm.sectionName.toLowerCase().includes(q) ||
          cm.subjects.some((s) => s.toLowerCase().includes(q))
      );
      const studentsListMatch = (c.students || []).some(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.className.toLowerCase().includes(q) ||
          s.section.toLowerCase().includes(q) ||
          String(s.rollNo).includes(q) ||
          s.admissionNo.toLowerCase().includes(q)
      );

      const matchesSearch =
        !q ||
        nameMatches ||
        roleMatches ||
        emailMatches ||
        subjectsMatch ||
        sectionsMatch ||
        summaryMatch ||
        studentNamesMatch ||
        childMatch ||
        studentsListMatch;

      if (!matchesSearch) return false;

      // 1. ADMIN FILTERS
      if (resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') {
        if (adminClassFilter !== 'All') {
          const clsClean = adminClassFilter.replace('Class', '').trim().toLowerCase();
          const hasClass = (c.assignedSections || []).some((sec) => {
            const secClean = sec.replace('Class', '').trim().toLowerCase();
            return secClean.includes(clsClean);
          });
          if (!hasClass) return false;
        }
        if (adminSectionFilter !== 'All') {
          const secClean = adminSectionFilter.replace('Section', '').replace('Sec', '').trim().toLowerCase();
          const hasSec = (c.assignedSections || []).some((sec) => {
            const secCleanText = sec.replace('Section', '').replace('Sec', '').trim().toLowerCase();
            return secCleanText.includes(secClean);
          });
          if (!hasSec) return false;
        }
      }

      // 2. TEACHER FILTERS
      if (resolvedRole === 'Teacher') {
        if (teacherAudienceFilter === 'Admin' && c.role !== 'School Admin') return false;
        if (teacherAudienceFilter === 'Parents' && c.role !== 'Parent') return false;

        if (teacherClassFilter !== 'All' && c.role === 'Parent') {
          const clsClean = teacherClassFilter.replace('Class', '').trim().toLowerCase();
          const hasClass =
            (c.students || []).some((s) => (s.className || '').replace('Class', '').trim().toLowerCase().includes(clsClean)) ||
            (c.assignedSections || []).some((sec) => sec.replace('Class', '').trim().toLowerCase().includes(clsClean));
          if (!hasClass) return false;
        }
      }

      // 3. PARENT FILTERS (handles multiple sons / children)
      if (resolvedRole === 'Parent' && parentChildFilter !== 'All') {
        const hasChild = (c.childMappings || []).some(
          (cm) => String(cm.studentId) === parentChildFilter || cm.studentName.toLowerCase() === parentChildFilter.toLowerCase()
        );
        if (!hasChild) return false;
      }

      return true;
    });
  }, [
    effectiveContacts,
    contactSearch,
    adminClassFilter,
    adminSectionFilter,
    teacherAudienceFilter,
    teacherClassFilter,
    parentChildFilter,
    resolvedRole,
  ]);

  const matchingConversations = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const nameMatch = c.otherParticipant?.name?.toLowerCase().includes(q);
      const bodyMatch = c.lastMessage?.body?.toLowerCase().includes(q);
      const roleMatch = c.otherParticipant?.role?.toLowerCase().includes(q);
      const studentMatch = (c.otherParticipant?.students || []).some(
        (s: ChatStudentInfo) => s.name.toLowerCase().includes(q) || String(s.rollNo).includes(q)
      );
      return nameMatch || bodyMatch || roleMatch || studentMatch;
    });
  }, [conversations, contactSearch]);

  // Card Visual Differentiation Helper
  const getNotificationCardStyle = (n: ApiNotification) => {
    const cat = (n.category || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    const reqStatus = (n.requestStatus || n.status || 'Pending').toLowerCase();

    if (cat.includes('leave') || cat.includes('holiday') || cat.includes('request') || title.includes('leave') || title.includes('holiday')) {
      if (reqStatus === 'approved' || title.includes('approved')) {
        return {
          border: 'border-l-4 border-l-emerald-500 bg-emerald-50/40 border-emerald-200/70',
          badge: 'bg-emerald-500/10 text-emerald-700 border border-emerald-300 font-extrabold',
          iconBg: 'bg-emerald-500/10 text-emerald-600',
          Icon: CheckCircle2,
          tagText: `${n.category || 'Leave Request'} (Approved)`,
        };
      }
      if (reqStatus === 'declined' || title.includes('declined')) {
        return {
          border: 'border-l-4 border-l-rose-500 bg-rose-50/40 border-rose-200/70',
          badge: 'bg-rose-500/10 text-rose-700 border border-rose-300 font-extrabold',
          iconBg: 'bg-rose-500/10 text-rose-600',
          Icon: UserX,
          tagText: `${n.category || 'Leave Request'} (Declined)`,
        };
      }
      return {
        border: 'border-l-4 border-l-amber-500 bg-amber-50/40 border-amber-200/70',
        badge: 'bg-amber-500/10 text-amber-800 border border-amber-300 font-extrabold',
        iconBg: 'bg-amber-500/10 text-amber-600',
        Icon: Calendar,
        tagText: `${n.category || 'Leave Request'} (Pending)`,
      };
    }

    if (cat.includes('urgent') || title.includes('urgent') || cat.includes('alert')) {
      return {
        border: 'border-l-4 border-l-rose-600 bg-rose-50/60 border-rose-200 shadow-xs',
        badge: 'bg-rose-600 text-white font-black uppercase tracking-wider text-[9px]',
        iconBg: 'bg-rose-600 text-white',
        Icon: ShieldCheck,
        tagText: 'URGENT ALERT',
      };
    }

    if (cat.includes('homework') || title.includes('homework') || cat.includes('assignment')) {
      return {
        border: 'border-l-4 border-l-blue-600 bg-blue-50/40 border-blue-200/70',
        badge: 'bg-blue-500/10 text-blue-700 border border-blue-300 font-extrabold',
        iconBg: 'bg-blue-500/10 text-blue-600',
        Icon: BookOpen,
        tagText: 'CLASS HOMEWORK',
      };
    }

    if (cat.includes('notice') || cat.includes('announcement') || cat.includes('policy')) {
      return {
        border: 'border-l-4 border-l-indigo-500 bg-indigo-50/30 border-indigo-100',
        badge: 'bg-indigo-500/10 text-indigo-700 border border-indigo-200 font-extrabold',
        iconBg: 'bg-indigo-500/10 text-indigo-600',
        Icon: Megaphone,
        tagText: 'OFFICIAL NOTICE',
      };
    }

    return {
      border: 'border-l-4 border-l-purple-500 bg-purple-50/20 border-purple-100',
      badge: 'bg-purple-500/10 text-purple-700 border border-purple-200 font-bold',
      iconBg: 'bg-purple-500/10 text-purple-600',
      Icon: Clock,
      tagText: 'MEETING / GENERAL',
    };
  };

  // Auto-scroll chat stream
  useEffect(() => {
    if (activeSubTab === 'chats' && chatStreamContainerRef.current) {
      chatStreamContainerRef.current.scrollTo({
        top: chatStreamContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [chatMessages.length, activeSubTab, selectedContact?.name]);

  const surface = isGlass ? 'bg-slate-900/60 border-slate-800 text-slate-100 backdrop-blur-md' : 'bg-white border-slate-200 text-slate-900 shadow-sm';
  const panelSoft = isGlass ? 'bg-slate-950/40 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800';
  const inputClass = isGlass ? 'bg-slate-950 border-slate-800 text-white placeholder:text-slate-500 focus:border-indigo-500' : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500';
  const divider = isGlass ? 'border-slate-800' : 'border-slate-100';
  const title = isGlass ? 'text-slate-100' : 'text-slate-900';
  const muted = isGlass ? 'text-slate-400' : 'text-slate-500';

  return (
    <section className="h-full flex flex-col min-h-0 animate-fade-in" id="communication-direct-chat">
        <div className={`flex rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden h-[calc(100vh-120px)] min-h-[540px] max-h-[860px] ${surface}`}>
          {/* Direct Chats Contact List Sidebar (Full-width on mobile/tablet when no chat is open, fixed width on desktop) */}
          <div className={`${(selectedConversationId || selectedContact) ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 xl:w-96 flex-col h-full min-h-0 border-r border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 overflow-hidden`}>
            {/* Sidebar Top Search & Header */}
            <div className="p-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md shrink-0 space-y-2.5 select-none">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/20">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black tracking-tight text-slate-800 leading-none">
                      Direct Chats
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      {contactSearch.trim() ? 'Searching contacts…' : 'Recent active conversations'}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 px-2.5 py-0.5 rounded-full shadow-2xs">
                  {contactSearch.trim() ? `${filteredContacts.length} Found` : `${conversations.length} Active`}
                </span>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={
                    resolvedRole === 'Parent'
                      ? 'Search teacher, subject, child…'
                      : resolvedRole === 'Teacher'
                        ? 'Search parent, student name, roll #, class…'
                        : 'Search teachers, parents, class, roll #…'
                  }
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className={`w-full rounded-xl border pl-9 pr-8 py-2 text-xs bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20`}
                />
                {contactSearch && (
                  <button
                    type="button"
                    onClick={() => setContactSearch('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Search Refinement Filters (Only shown when searching) */}
              {contactSearch.trim() !== '' && (
                <div className="space-y-1.5 pt-1">
                  {/* Parent Multi-Child filter */}
                  {resolvedRole === 'Parent' && parentChildrenList.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setParentChildFilter('All')}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                          parentChildFilter === 'All'
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        All Children
                      </button>
                      {parentChildrenList.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setParentChildFilter(c.id)}
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                            parentChildFilter === c.id
                              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-600'
                          }`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Admin Class & Section filter */}
                  {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && (
                    <div className="grid grid-cols-2 gap-1">
                      <select
                        value={adminClassFilter}
                        onChange={(e) => setAdminClassFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold"
                      >
                        <option value="All">All Classes</option>
                        {academicClasses.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={adminSectionFilter}
                        onChange={(e) => setAdminSectionFilter(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold"
                      >
                        <option value="All">All Sections</option>
                        {adminAvailableSections.map((sec) => (
                          <option key={sec} value={sec}>
                            Sec {sec}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Teacher Audience Filter */}
                  {resolvedRole === 'Teacher' && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setTeacherAudienceFilter('All')}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                          teacherAudienceFilter === 'All'
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeacherAudienceFilter('Admin')}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                          teacherAudienceFilter === 'Admin'
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        Admin Desk
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeacherAudienceFilter('Parents')}
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                          teacherAudienceFilter === 'Parents'
                            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        Parents
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Conversation / Contact List Body */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
              {contactSearch.trim() === '' ? (
                // ── DEFAULT VIEW: ACTIVE CONVERSATIONS ONLY (Zero Lag, WhatsApp Style) ──
                conversations.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 bg-white space-y-2 mt-6">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 mx-auto">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <p className="font-bold text-slate-700 text-sm">No Active Chats</p>
                    <p className="text-[11px] text-slate-400 max-w-[200px] mx-auto">
                      Search above for any teacher, parent, or office desk to start messaging.
                    </p>
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const isSelected = selectedConversationId === conv.id;
                    const other = conv.otherParticipant;
                    const isOnline = other?.isOnline ?? false;
                    const unread = conv.unreadCount || 0;
                    const lastMsg = conv.lastMessage;
                    const timeLabel = formatConversationTime(lastMsg?.createdAt || conv.updatedAt);
                    const isParent = other?.role === 'Parent';
                    const isAdminOffice = other?.role === 'School Admin' || other?.role === 'Super Admin';

                    // Context subtitle
                    let contextSubtitle = other?.role || 'Chat';
                    if (isParent) {
                      if (other.students && other.students.length > 0) {
                        contextSubtitle = `Parent of ${other.students[0].name} (${other.students[0].className} - Sec ${other.students[0].section})`;
                      } else if (other.studentSummary) {
                        contextSubtitle = other.studentSummary;
                      } else {
                        contextSubtitle = 'Parent';
                      }
                    } else if (other?.role === 'Teacher') {
                      if (other.childMappings && other.childMappings.length > 0) {
                        contextSubtitle = `Teacher for ${other.childMappings[0].studentName} (${other.childMappings[0].className})`;
                      } else if (other.assignedSections && other.assignedSections.length > 0) {
                        contextSubtitle = `Teacher · ${other.assignedSections[0]}`;
                      } else {
                        contextSubtitle = 'Faculty Teacher';
                      }
                    } else if (isAdminOffice) {
                      contextSubtitle = 'School Admin / Office Desk';
                    }

                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => void handleSelectConversation(conv)}
                        className={`w-full flex items-center gap-3 px-3 py-3 text-left transition cursor-pointer select-none border-l-4 ${
                          isSelected
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-l-indigo-600 shadow-2xs text-slate-900 dark:text-white'
                            : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 border-l-transparent text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {/* Avatar */}
                        <div className="relative shrink-0">
                          <div
                            className={`grid h-12 w-12 place-items-center rounded-full font-black text-sm text-white shadow-2xs ${
                              isAdminOffice
                                ? 'bg-gradient-to-br from-purple-600 to-indigo-600'
                                : isParent
                                  ? 'bg-gradient-to-br from-emerald-600 to-teal-600'
                                  : 'bg-gradient-to-br from-indigo-600 to-violet-600'
                            }`}
                          >
                            {(other?.name || 'User').slice(0, 2).toUpperCase()}
                          </div>
                          <span
                            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${
                              isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          />
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {other?.name || 'Contact'}
                            </p>
                            <span
                              className={`text-[10px] shrink-0 ml-1 ${
                                unread > 0 ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' : 'text-slate-400 font-medium'
                              }`}
                            >
                              {timeLabel}
                            </span>
                          </div>

                          <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                            {contextSubtitle}
                          </p>

                          <div className="flex items-center justify-between gap-1 mt-1">
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                              {(() => {
                                const otherUid = conv.otherParticipant ? Number(conv.otherParticipant.id) : null;
                                const isItemTyping =
                                  typingMap[String(conv.id)]?.isTyping ||
                                  (otherUid ? typingMap['u_' + otherUid]?.isTyping : false);
                                const itemText =
                                  typingMap[String(conv.id)]?.text ||
                                  (otherUid ? typingMap['u_' + otherUid]?.text : '');

                                if (isItemTyping) {
                                  return (
                                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold italic flex items-center gap-1 animate-pulse">
                                      <span>typing...</span>
                                      <span className="inline-flex gap-0.5">
                                        <span className="w-1 h-1 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                        <span className="w-1 h-1 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                        <span className="w-1 h-1 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce"></span>
                                      </span>
                                    </span>
                                  );
                                }
                                return null;
                              })() || (
                                <>
                                  {(user && lastMsg ? Number(lastMsg.senderId) === Number(user.id) : Boolean(lastMsg?.isMe)) && (
                                    lastMsg?.readAt ? (
                                      <CheckCheck aria-label="Read" className="w-3.5 h-3.5 inline shrink-0 text-sky-500" />
                                    ) : (
                                      <Check aria-label="Sent" className="w-3.5 h-3.5 inline shrink-0 text-slate-400" />
                                    )
                                  )}
                                  <span className="truncate">
                                    {lastMsg
                                      ? lastMsg.body || (lastMsg.attachments?.length ? '📷 Photo' : '...')
                                      : 'Start a conversation'}
                                  </span>
                                </>
                              )}
                            </p>

                            {/* WhatsApp Unread Badge: 1, 2, 3... - Disappears on click */}
                            {unread > 0 && (
                              <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[10px] font-black shrink-0 shadow-sm shadow-indigo-500/25 animate-in zoom-in-75 duration-150">
                                {unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )
              ) : (
                // ── SEARCH VIEW: MATCHING CONVERSATIONS + DIRECTORY CONTACTS (Capped to 25) ──
                <div className="p-2 space-y-3">
                  {/* Matching Conversations */}
                  {matchingConversations.length > 0 && (
                    <div className="space-y-1">
                      <div className="px-2 pt-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Active Chats ({matchingConversations.length})
                      </div>
                      {matchingConversations.map((conv) => {
                        const isSelected = selectedConversationId === conv.id;
                        const other = conv.otherParticipant;
                        const isOnline = other?.isOnline ?? false;
                        const unread = conv.unreadCount || 0;
                        const lastMsg = conv.lastMessage;

                        return (
                          <button
                            key={`search-conv-${conv.id}`}
                            type="button"
                            onClick={() => {
                              void handleSelectConversation(conv);
                              setContactSearch('');
                            }}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition cursor-pointer select-none border-l-4 ${
                              isSelected
                                ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-l-indigo-600 shadow-2xs text-slate-900 dark:text-white'
                                : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 border border-slate-100 dark:border-slate-800 border-l-transparent text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="relative shrink-0">
                              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 font-black text-xs text-white">
                                {(other?.name || 'User').slice(0, 2).toUpperCase()}
                              </div>
                              <span
                                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                  isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                                }`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{other?.name}</p>
                                {unread > 0 && (
                                  <span className="min-w-[18px] h-4 px-1 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[9px] font-black shadow-xs">
                                    {unread}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                {lastMsg?.body || 'Recent chat'}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* School Directory Matching Contacts */}
                  <div className="space-y-1">
                    <div className="px-2 pt-1 flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        School Contacts ({filteredContacts.length})
                      </span>
                    </div>

                    {filteredContacts.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-100 space-y-1">
                        <Search className="w-6 h-6 text-slate-300 mx-auto" />
                        <p className="font-bold text-slate-600">No person found for "{contactSearch}"</p>
                        <p className="text-[10px] text-slate-400">Try searching by student name, parent name, or class.</p>
                      </div>
                    ) : (
                      filteredContacts.slice(0, 25).map((c) => {
                        const isSelected =
                          selectedContact?.name === c.name ||
                          (selectedContact?.userId && selectedContact.userId === c.userId);
                        const isOnline = c.isOnline ?? false;
                        const isParent = c.role === 'Parent';
                        const isAdminOffice = c.isOfficeDesk || c.role === 'School Admin' || c.role === 'Super Admin';

                        return (
                          <button
                            key={`contact-${c.id}`}
                            type="button"
                            onClick={() => {
                              void handleSelectContact(c);
                              setContactSearch('');
                            }}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition cursor-pointer select-none border-l-4 ${
                              isSelected
                                ? 'bg-indigo-50 border-l-indigo-600'
                                : 'bg-white hover:bg-slate-50 border border-slate-100 border-l-transparent'
                            }`}
                          >
                            <div className="relative shrink-0">
                              <div
                                className={`grid h-10 w-10 place-items-center rounded-full font-black text-xs text-white ${
                                  isAdminOffice
                                    ? 'bg-purple-600'
                                    : isParent
                                      ? 'bg-indigo-600 dark:bg-indigo-400'
                                      : 'bg-indigo-600'
                                }`}
                              >
                                {c.name.slice(0, 2).toUpperCase()}
                              </div>
                              <span
                                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                  isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                                }`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-black text-slate-800 truncate">{c.name}</p>
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
                                  {c.role}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                {c.studentSummary ||
                                  (c.assignedSections && c.assignedSections.length > 0
                                    ? c.assignedSections.join(', ')
                                    : c.role)}
                              </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 1-on-1 Chat Stream Window (Full-width on mobile/tablet when active, flex-1 on desktop) */}
          <div className={`${(!selectedConversationId && !selectedContact) ? 'hidden lg:flex' : 'flex'} flex-1 flex-col h-full min-h-0 overflow-hidden bg-slate-50/70 dark:bg-slate-950`}>
            {/* Chat Contact Header */}
            <div className="shrink-0 border-b px-3.5 sm:px-5 py-3 border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md select-none flex items-center justify-between shadow-xs z-10">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                {/* Responsive Back Button for Tablet / Split Screen (< lg) */}
                <button
                  type="button"
                  id="btn-back-to-chats"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedConversationId(null);
                    setSelectedContact(null);
                    setChatMessages([]);
                  }}
                  className="lg:hidden p-2 -ml-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                  title="Back to all chats"
                  aria-label="Back to all chats"
                >
                  <ArrowLeft className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </button>

                <div className="relative shrink-0">
                  <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white font-black text-xs sm:text-sm shadow-xs">
                    {selectedContact?.name.slice(0, 2).toUpperCase() || 'CH'}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${selectedContact && selectedContact.isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
                    {selectedContact?.name || 'Select a Contact to Chat'}
                  </h3>

                  {/* Typing Indicator with live text preview or Online/Offline presence */}
                  {(() => {
                    const activeTyping = getActiveTyping();

                    if (activeTyping && activeTyping.isTyping) {
                      return (
                        <div className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-1.5 animate-pulse">
                          <span>{activeTyping.userName} is typing</span>
                          <span className="inline-flex gap-0.5 ml-0.5">
                            <span className="w-1.5 h-1.5 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                            <span className="w-1.5 h-1.5 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                            <span className="w-1.5 h-1.5 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce"></span>
                          </span>
                        </div>
                      );
                    }

                    if (!selectedContact) return null;
                    const isOnline = Boolean(selectedContact.isOnline);
                    return (
                      <div className="flex items-center gap-2 truncate">
                        <div className={`flex items-center gap-1.5 text-xs font-semibold ${isOnline ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          <span className={`inline-flex rounded-full h-2 w-2 ${isOnline ? 'bg-emerald-500 shadow-xs shadow-emerald-400' : 'bg-slate-400'}`}></span>
                          <span>{isOnline ? 'Online' : 'Offline'}</span>
                          {!isOnline && selectedContact.lastSeenAt && (
                            <span className="text-[10px] font-normal text-slate-400">
                              · {formatPresenceStatus(false, selectedContact.lastSeenAt)}
                            </span>
                          )}
                        </div>
                      <span className="text-slate-300">·</span>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex flex-wrap items-center gap-1.5 truncate">
                      {/* PARENT VIEWING TEACHER: MENTION SECTION, CLASS & SUBJECTS */}
                      {resolvedRole === 'Parent' && selectedContact.childMappings && selectedContact.childMappings.length > 0 ? (
                        selectedContact.childMappings.map((cm, idx) => (
                          <span key={idx} className="text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-lg border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-700 dark:text-indigo-300">
                            Teacher for {cm.studentName} ({cm.className.startsWith('Class') ? cm.className : `Class ${cm.className}`} - Sec {cm.sectionName}) · Subjects: {cm.subjects.join(', ')}
                          </span>
                        ))
                      ) : resolvedRole === 'Teacher' && selectedContact.role === 'Parent' ? (
                        /* TEACHER VIEWING PARENT: DIFFERENTIATE BASED ON STUDENT */
                        selectedContact.students && selectedContact.students.length > 0 ? (
                          selectedContact.students.map((st, idx) => (
                            <span key={idx} className="text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-lg border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-700 dark:text-indigo-300">
                              Parent of {st.name} ({st.className.startsWith('Class') ? st.className : `Class ${st.className}`} - Sec {st.section}, Roll #{st.rollNo})
                            </span>
                          ))
                        ) : (
                          <span className="text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-lg border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-700 dark:text-indigo-300">
                            {selectedContact.studentSummary || 'Parent of Student'}
                          </span>
                        )
                      ) : selectedContact.isOfficeDesk || selectedContact.role === 'School Admin' ? (
                        <span className="text-purple-800 font-semibold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                          School Administration / Office Desk · Official Coordination
                        </span>
                      ) : (
                        /* ADMIN VIEWING TEACHER: MENTION CLASS, SECTION & SUBJECTS */
                        <>
                          <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                            {selectedContact.assignedSections && selectedContact.assignedSections.length > 0
                              ? selectedContact.assignedSections.map(s => s.startsWith('Class') ? s : `Class ${s}`).join(', ')
                              : 'Faculty Member'}
                          </span>
                          {selectedContact.subjects && selectedContact.subjects.length > 0 && (
                            <span className="text-slate-500 dark:text-slate-400">
                              · {selectedContact.subjects.join(', ')}
                            </span>
                          )}
                        </>
                      )}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* WhatsApp Chat Messages Stream with Wallpaper Background */}
            <div
              ref={chatStreamContainerRef}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const droppedFiles = Array.from(e.dataTransfer.files);
                  setSelectedFiles((prev) => [...prev, ...droppedFiles]);
                }
              }}
              className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 bg-slate-50/70 dark:bg-slate-950 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] relative ${
                isDragOver ? 'ring-2 ring-indigo-500 bg-indigo-50/30' : ''
              }`}
            >
              {isDragOver && (
                <div className="absolute inset-4 z-30 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl pointer-events-none">
                  <ImageIcon className="h-10 w-10 text-indigo-600 dark:text-indigo-400 animate-bounce" />
                  <p className="mt-2 text-sm font-black text-slate-900 dark:text-white">Drop photos or files here to attach</p>
                </div>
              )}

              {chatLoading ? (
                <div className="grid h-full place-items-center text-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400 mx-auto" />
                  <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">Loading messages…</p>
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="grid h-full place-items-center text-center p-8">
                  <div className="bg-white/80 backdrop-blur-xs p-5 rounded-2xl border border-black/5 shadow-xs max-w-sm">
                    <MessageSquare className="mx-auto h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                    <p className="mt-2 text-xs font-extrabold text-slate-900 dark:text-white">
                      Conversation with {selectedContact?.name || 'Contact'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {resolvedRole === 'Parent'
                        ? 'Reach out directly to discuss your child’s academic progress, assignments, or inquiries.'
                        : resolvedRole === 'Teacher'
                          ? 'Coordinate with the school administration or discuss student performance directly with parents.'
                          : 'Send direct messages, coordination notes, and faculty updates.'}
                    </p>
                  </div>
                </div>
              ) : (
                chatMessages.map((msg, idx) => {
                  const isMe = user ? Number(msg.senderId) === Number(user.id) : Boolean(msg.isMe);
                  const prevMsg = chatMessages[idx - 1];
                  const currDateLabel = formatChatDate(msg.createdAt);
                  const prevDateLabel = prevMsg ? formatChatDate(prevMsg.createdAt) : '';
                  const showDateDivider = currDateLabel && currDateLabel !== prevDateLabel;

                  const isHighlighted = Boolean(
                    highlightedMessageText &&
                    msg.body &&
                    (msg.body.trim() === highlightedMessageText.trim() ||
                      msg.body.toLowerCase().includes(highlightedMessageText.toLowerCase()) ||
                      highlightedMessageText.toLowerCase().includes(msg.body.toLowerCase()))
                  );

                  const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  const isImageOnly = Boolean(
                    msg.attachments &&
                    msg.attachments.length === 1 &&
                    isImageAttachment(msg.attachments[0]) &&
                    !msg.body
                  );

                  return (
                    <React.Fragment key={msg.id}>
                      {/* Date Separator Badge */}
                      {showDateDivider && (
                        <div className="flex justify-center my-3 sticky top-1 z-10 select-none">
                          <span className="bg-white/90 backdrop-blur-xs text-slate-500 dark:text-slate-400 text-[11px] font-semibold px-3 py-1 rounded-lg shadow-xs uppercase tracking-wide border border-black/5">
                            {currDateLabel}
                          </span>
                        </div>
                      )}

                      {/* Chat Message Row */}
                      <div
                        ref={isHighlighted ? highlightedMessageRef : undefined}
                        className={`flex ${isMe ? 'justify-end' : 'justify-start'} my-1 group`}
                      >
                        <div
                          className={`relative shadow-xs transition-all ${
                            isImageOnly
                              ? 'p-1 rounded-2xl w-fit max-w-[260px] sm:max-w-[300px]'
                              : 'max-w-[85%] sm:max-w-[72%] p-2.5 rounded-2xl'
                          } ${
                            isHighlighted ? 'ring-3 ring-indigo-400 shadow-lg shadow-indigo-500/20 scale-[1.01]' : ''
                          } ${
                            isMe
                              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-2xl rounded-tr-xs shadow-md shadow-indigo-500/15'
                              : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-2xl rounded-tl-xs border border-slate-200/80 dark:border-slate-700/80 shadow-xs'
                          }`}
                        >
                          {isHighlighted && (
                            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 px-2 py-0.5 rounded-md w-fit">
                              <span>★</span>
                              <span>Selected Notification Message</span>
                            </div>
                          )}

                          {/* Image & Document Attachments */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="space-y-1.5 mb-1">
                              {msg.attachments.map((att) => {
                                const isImg = isImageAttachment(att);

                                const attUrl = att.downloadUrl || ("/api/v1/attachments/" + att.id + "/download/");
                                if (isImg) {
                                  return (
                                    <ChatImagePreview
                                      key={att.id}
                                      url={attUrl}
                                      originalName={att.originalName}
                                      fileSize={att.fileSize}
                                      timeStr={timeStr}
                                      isMe={isMe}
                                      readAt={msg.readAt}
                                      onOpenLightbox={(imageUrl, title) => setLightboxImage({ url: imageUrl, title })}
                                    />
                                  );
                                }

                                return (
                                  <div
                                    key={att.id}
                                    onClick={() => void downloadSecureAttachment(attUrl, att.originalName)}
                                    className={`flex items-center gap-3 p-2.5 rounded-xl transition cursor-pointer select-none ${
                                      isMe
                                        ? 'bg-white/15 hover:bg-white/25 text-white border border-white/20'
                                        : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200/80 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700'
                                    }`}
                                  >
                                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-600 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-400 shadow-2xs font-bold text-xs uppercase">
                                      {att.originalName.split('.').pop() || 'DOC'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-bold truncate text-slate-900 dark:text-white">{att.originalName}</p>
                                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{Math.round(att.fileSize / 1024)} KB · Document</p>
                                    </div>
                                    <button
                                      type="button"
                                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 hover:bg-white text-slate-500 dark:text-slate-400 shadow-2xs transition"
                                      title="Download file"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Message Body Text */}
                          {msg.body && (
                            <p className={`text-[13px] leading-relaxed font-normal whitespace-pre-wrap break-words px-1 select-text ${isMe ? 'text-white' : 'text-slate-800 dark:text-slate-100'}`}>
                              {msg.body}
                            </p>
                          )}

                          {/* Message Timestamp & Checkmarks */}
                          {!isImageOnly && (
                            <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] font-medium select-none px-1 ${isMe ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>
                              {msg.editedAt && <span className="italic text-[9px] opacity-75">(edited)</span>}
                              <span>{timeStr}</span>
                              {isMe && (
                                msg.readAt ? (
                                  <span title="Read"><CheckCheck className="w-3.5 h-3.5 text-sky-300" /></span>
                                ) : (
                                  <span title="Sent"><Check className="w-3.5 h-3.5 text-indigo-200" /></span>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
              {/* WhatsApp / Telegram Floating Typing Bubble with Live Text Preview */}
              {(() => {
                const activeTyping = getActiveTyping();
                if (!activeTyping || !activeTyping.isTyping || activeTyping.isMe) return null;

                return (
                  <div className="flex justify-start my-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <div className="bg-white/95 dark:bg-slate-800 backdrop-blur-md rounded-2xl rounded-tl-none px-4 py-2.5 shadow-sm border border-slate-200/80 flex items-center gap-2.5">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-2 h-2 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                        <span className="w-2 h-2 bg-indigo-600 dark:bg-indigo-400 rounded-full animate-bounce"></span>
                      </div>
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                        {activeTyping.userName} is typing...
                      </span>
                    </div>
                  </div>
                );
              })()}
              <div ref={chatBottomRef} />
            </div>

            {/* WhatsApp Chat Input Toolbar */}
            <div className="border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 sm:p-3.5 shrink-0 relative z-10">


              {/* Selected Files Preview Chips */}
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2 p-2 rounded-2xl bg-white border border-slate-200 dark:border-slate-700 shadow-2xs">
                  {selectedFiles.map((file, idx) => {
                    const isImg = file.type.startsWith('image/');
                    const objUrl = isImg ? URL.createObjectURL(file) : null;

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 px-3 py-1.5 rounded-xl text-[11px] font-semibold"
                      >
                        {isImg && objUrl ? (
                          <img
                            src={objUrl}
                            alt={file.name}
                            className="h-8 w-8 rounded-lg object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] uppercase">
                            {file.name.split('.').pop() || 'FILE'}
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="truncate max-w-[130px] text-xs font-bold text-slate-900 dark:text-white">{file.name}</span>
                          <span className="text-[9px] text-slate-500 dark:text-slate-400 font-normal">{Math.round(file.size / 1024)} KB</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-slate-400 hover:text-rose-600 transition ml-1 cursor-pointer p-0.5 rounded-md hover:bg-rose-50"
                          title="Remove attachment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handleSendChat} className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newFiles = Array.from(e.target.files);
                      setSelectedFiles((prev) => [...prev, ...newFiles]);
                    }
                    e.target.value = '';
                  }}
                />
                <input
                  type="file"
                  ref={imageInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newFiles = Array.from(e.target.files);
                      setSelectedFiles((prev) => [...prev, ...newFiles]);
                    }
                    e.target.value = '';
                  }}
                />

                {/* WhatsApp Action Icons (Photo, Attachment) */}
                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    title="Attach Photos"
                    className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 transition cursor-pointer text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-400"
                  >
                    <ImageIcon className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach Documents"
                    className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 transition cursor-pointer text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:text-indigo-400"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                </div>

                {/* Modern Executive Input Field */}
                <div className="flex-1 relative flex items-center">
                  <input
                    type="text"
                    placeholder={`Type a message…`}
                    value={chatMessage}
                    onChange={handleChatInputChange}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (items) {
                        const pastedFiles: File[] = [];
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].kind === 'file') {
                            const file = items[i].getAsFile();
                            if (file) pastedFiles.push(file);
                          }
                        }
                        if (pastedFiles.length > 0) {
                          e.preventDefault();
                          setSelectedFiles((prev) => [...prev, ...pastedFiles]);
                        }
                      }
                    }}
                    className="w-full rounded-2xl bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none shadow-2xs transition"
                  />
                </div>

                {/* Modern Executive Send Button */}
                <button
                  type="submit"
                  disabled={isSendingChat || (!chatMessage.trim() && selectedFiles.length === 0) || !selectedConversationId}
                  title="Send message"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white transition active:scale-95 disabled:opacity-40 cursor-pointer shadow-md shadow-indigo-500/25"
                >
                  {isSendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -mr-0.5" />}
                </button>
              </form>
            </div>
          </div>
        </div>

      {/* ── Admin Reset Confirmation Modal: Chats ── */}
      {showResetChatModal && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="reset-chat-modal-title">
            <div className="flex-shrink-0 flex items-center gap-3 text-rose-600 border-b border-slate-100 pb-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-100">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <h3 id="reset-chat-modal-title" className="text-base font-black text-slate-900">Clear All Chat Data?</h3>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 py-3">
              <p className="text-xs leading-relaxed text-slate-600">
                This action will permanently delete all direct messages and 1-on-1 private conversations across all users in your school. This action cannot be undone.
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetChatModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClearAllChats()}
                disabled={isResetting}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-black text-white shadow-md hover:bg-rose-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Confirm Reset All
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── WhatsApp Image Lightbox Modal ── */}
      {lightboxImage && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-[#0b141a]/95 backdrop-blur-md flex flex-col justify-between animate-fade-in select-none"
          onClick={() => setLightboxImage(null)}
        >
          {/* WhatsApp Lightbox Top Navigation Bar */}
          <div
            className="flex items-center justify-between px-6 py-3.5 bg-[#111b21]/90 backdrop-blur-md border-b border-white/10 text-white z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 font-black text-xs text-white">
                {selectedContact?.name?.slice(0, 2).toUpperCase() || 'WA'}
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{selectedContact?.name || 'Photo Viewer'}</h4>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium truncate max-w-md">{lightboxImage.title || 'Image Preview'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadSecureAttachment(lightboxImage.url, lightboxImage.title || 'chat-image.jpg')}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer"
                title="Download full image"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Full Image */}
          <div
            className="flex-1 flex items-center justify-center p-4 overflow-hidden"
            onClick={() => setLightboxImage(null)}
          >
            <img
              src={lightboxImage.url}
              alt={lightboxImage.title || 'Full View'}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain shadow-2xl transition duration-200 border border-white/5"
            />
          </div>

          {/* Bottom Title Pill */}
          {lightboxImage.title && (
            <div className="pb-4 flex justify-center pointer-events-none" onClick={(e) => e.stopPropagation()}>
              <span className="bg-[#111b21]/80 backdrop-blur-md text-[#d1d7db] text-xs px-4 py-1.5 rounded-full border border-white/10 shadow-lg">
                {lightboxImage.title}
              </span>
            </div>
          )}
        </div>,
        document.body
      )}
    </section>
  );
}
