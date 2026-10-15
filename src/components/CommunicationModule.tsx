import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle2,
  CheckCheck,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Filter,
  GraduationCap,
  Layers,
  Loader2,
  Megaphone,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
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
import type { AuthUser } from '../utils/auth';
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
}

interface ApiConversation {
  id: number;
  otherParticipant: ApiParticipant;
  lastMessage?: {
    id: number;
    body: string;
    createdAt: string;
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
  isOfficeDesk?: boolean;
  assignedSections?: string[];
  subjects?: string[];
  teachingAssignments?: TeacherApiAssignment[];
  childMappings?: TeacherChildInfo[];
  students?: ChatStudentInfo[];
  studentSummary?: string;
  studentNames?: string[];
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

export default function CommunicationModule({ user, isGlass = false, onNavigateToTab }: CommunicationModuleProps) {
  const resolvedRole = user?.role || 'School Admin';
  const copy = roleCopy[resolvedRole] || roleCopy['School Admin'];

  // ── Role-Specific Allowed Sub-Tabs ──────────────────────────────────────────
  const allowedSubTabs = useMemo<Array<'requests' | 'broadcasts' | 'chats'>>(() => {
    if (resolvedRole === 'Student') {
      return ['requests'];
    }
    if (resolvedRole === 'Parent') {
      return ['chats'];
    }
    return ['requests', 'broadcasts', 'chats'];
  }, [resolvedRole]);

  // ── Main Sub-Tab State (Parent is locked to 'chats' only) ───────────────────
  const [activeSubTab, setActiveSubTab] = useState<'requests' | 'broadcasts' | 'chats'>(
    resolvedRole === 'Parent' ? 'chats' : 'requests'
  );

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

  // ── Real-Time WebSocket Connection & Event Synchronization ───────────────
  useEffect(() => {
    chatSocket.connect();
    const unsubStatus = chatSocket.subscribeStatus(setSocketStatus);

    const unsubMsg = chatSocket.on('message.created', (newMsg: ApiDirectMessage) => {
      if (selectedConversationId && newMsg.conversationId === selectedConversationId) {
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id || (m.clientKey && m.clientKey === newMsg.clientKey))) {
            return prev.map((m) => (m.clientKey && m.clientKey === newMsg.clientKey ? newMsg : m));
          }
          return [...prev, newMsg];
        });
        chatSocket.markConversationRead(selectedConversationId);
      }
      void loadConversations();
    });

    const unsubRead = chatSocket.on('conversation.read', (data: { conversationId: number; readAt: string }) => {
      if (selectedConversationId && data.conversationId === selectedConversationId) {
        setChatMessages((prev) =>
          prev.map((m) => (m.isMe ? { ...m, readAt: data.readAt } : m))
        );
      }
    });

    const unsubUpdate = chatSocket.on('message.updated', (updatedMsg: ApiDirectMessage) => {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === updatedMsg.id ? { ...m, body: updatedMsg.body, editedAt: updatedMsg.editedAt } : m))
      );
    });

    const unsubDelete = chatSocket.on('message.deleted', (data: { id: number }) => {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === data.id ? { ...m, isDeleted: true, body: 'This message was deleted.' } : m))
      );
    });

    return () => {
      unsubStatus();
      unsubMsg();
      unsubRead();
      unsubUpdate();
      unsubDelete();
    };
  }, [selectedConversationId]);

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
  const loadContacts = useCallback(async () => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getChatContacts.initiate(undefined))
        .unwrap();
      if (Array.isArray(data)) {
        setBackendContacts(data as any);
      }
    } catch {
      // silent fallback
    }
  }, []);

  // Load Conversations list
  const loadConversations = useCallback(async () => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getConversations.initiate(undefined))
        .unwrap();
      setConversations(data as any);
    } catch {
      // silent
    }
  }, []);

  // Load Messages for active conversation
  const loadMessagesForConversation = useCallback(async (convId: number) => {
    try {
      const data = await store
        .dispatch(chatApi.endpoints.getMessages.initiate(convId))
        .unwrap();
      setChatMessages(data as any);
    } catch {
      // silent
    }
  }, []);

  // Poll notifications, contacts & conversations periodically
  useEffect(() => {
    void loadNotifications(true);
    void loadContacts();
    void loadConversations();
    void refetchTeachers();

    const interval = window.setInterval(() => {
      void loadNotifications();
      void loadContacts();
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
    if (backendContacts.length > 0) {
      return backendContacts;
    }
    return contactsList;
  }, [backendContacts, contactsList]);

  // Handle Contact Selection
  const handleSelectContact = async (contact: ChatContact) => {
    setSelectedContact(contact);
    setChatLoading(true);
    setChatMessages([]);

    try {
      const body: Record<string, any> = {};
      if (typeof contact.userId === 'number') {
        body.targetUserId = contact.userId;
      } else if (typeof contact.id === 'number') {
        body.teacherId = contact.id;
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
    } catch {
      emitNotification({ title: 'Chat Error', message: 'Could not open private chat channel.', tone: 'danger', source: 'communication' });
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedContact && effectiveContacts.length > 0 && activeSubTab === 'chats') {
      void handleSelectContact(effectiveContacts[0]);
    }
  }, [effectiveContacts.length, activeSubTab]);

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

  // Send Direct Private 1-on-1 Chat
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!chatMessage.trim() && selectedFiles.length === 0) || !selectedConversationId) return;
    setIsSendingChat(true);
    const msgText = chatMessage.trim();
    const filesToSend = [...selectedFiles];
    setChatMessage('');
    setSelectedFiles([]);

    const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`;

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

      setChatMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id || (m.clientKey && m.clientKey === newMsg.clientKey))) {
          return prev;
        }
        return [...prev, newMsg as any];
      });
      void loadConversations();
    } catch {
      emitNotification({ title: 'Message failed', message: 'Could not deliver chat message.', tone: 'danger', source: 'communication' });
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
    if (requestFilter === 'requests') return isLeaveRequest(n);
    if (requestFilter === 'urgent') return n.category?.toLowerCase().includes('urgent');
    if (requestFilter === 'general') return !isLeaveRequest(n) && !n.category?.toLowerCase().includes('urgent');
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const pendingRequestsCount = notifications.filter((n) => isLeaveRequest(n) && (n.requestStatus || n.status || 'Pending') === 'Pending').length;

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
    <section className="space-y-6">
      {/* ── Header Banner ── */}
      <header className={`flex flex-col gap-4 rounded-3xl border p-6 md:flex-row md:items-center md:justify-between ${surface}`}>
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-bold text-indigo-500">
              <MessageSquare className="h-3.5 w-3.5" />
              {copy.channel}
            </span>
            <span className="text-xs font-semibold text-slate-400">· {copy.audience}</span>
          </div>
          <h1 className={`mt-2 text-2xl font-black tracking-tight ${title}`}>{copy.title}</h1>
          <p className={`mt-1 text-sm ${muted}`}>{copy.subtitle}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {resolvedRole === 'Teacher' && (
            <button
              onClick={() => {
                setActiveSubTab('requests');
                setShowLeaveForm(true);
              }}
              className="flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-xs font-extrabold text-white shadow-lg shadow-amber-500/20 transition hover:bg-amber-600 active:scale-95"
            >
              <Calendar className="h-4 w-4" />
              Submit Leave / Holiday Request
            </button>
          )}

          {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && (
            <button
              onClick={() => setActiveSubTab('broadcasts')}
              className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-xs font-extrabold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 active:scale-95"
            >
              <Megaphone className="h-4 w-4" />
              New Broadcast Announcement
            </button>
          )}

          {resolvedRole === 'Student' && onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('homework')}
              className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-2.5 text-xs font-extrabold text-indigo-700 shadow-sm transition hover:bg-indigo-50 active:scale-95 cursor-pointer"
            >
              <BookOpen className="h-4 w-4 text-indigo-600" />
              View Class Homework →
            </button>
          )}

          {resolvedRole === 'Parent' && onNavigateToTab && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateToTab('homework')}
                className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-4 py-2.5 text-xs font-extrabold text-blue-700 shadow-sm transition hover:bg-blue-50 active:scale-95 cursor-pointer"
              >
                <BookOpen className="h-4 w-4 text-blue-600" />
                Class Homework →
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('notifications')}
                className="flex items-center gap-2 rounded-2xl bg-white/15 border border-white/20 px-4 py-3 text-xs font-extrabold text-white shadow-xs transition hover:bg-white/25 active:scale-95 cursor-pointer"
              >
                <Bell className="h-4 w-4 text-rose-200" />
                School Notices Desk →
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Main Navigation Sub-Tabs & Reset Control Bar (Hidden when single tab) ── */}
      {allowedSubTabs.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {allowedSubTabs.includes('requests') && (
              <button
                onClick={() => setActiveSubTab('requests')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${activeSubTab === 'requests'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : isGlass ? 'bg-slate-900 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
              >
                <Bell className="h-4 w-4" />
                {resolvedRole === 'Student'
                  ? 'Class Notices & Announcements'
                  : resolvedRole === 'Teacher'
                    ? 'Notifications & Staff Requests'
                    : 'Notifications & Requests'}
                {pendingRequestsCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                    {pendingRequestsCount} Pending
                  </span>
                )}
                {unreadCount > 0 && pendingRequestsCount === 0 && (
                  <span className="ml-1 rounded-full bg-indigo-400 px-2 py-0.5 text-[10px] font-black text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
            )}

            {allowedSubTabs.includes('broadcasts') && (
              <button
                onClick={() => setActiveSubTab('broadcasts')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${activeSubTab === 'broadcasts'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : isGlass ? 'bg-slate-900 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
              >
                <Megaphone className="h-4 w-4" />
                Broadcast Desk
              </button>
            )}

            {allowedSubTabs.includes('chats') && (
              <button
                onClick={() => setActiveSubTab('chats')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${activeSubTab === 'chats'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : isGlass ? 'bg-slate-900 text-slate-300 hover:bg-slate-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
              >
                <MessageSquare className="h-4 w-4" />
                {resolvedRole === 'Parent' ? 'Teacher 1-on-1 Chat' : resolvedRole === 'School Admin' || resolvedRole === 'Super Admin' ? 'Teacher Direct Chat' : 'Private 1-on-1 Chat'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Admin Reset Buttons */}
            {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && activeSubTab === 'requests' && (
              <button
                onClick={() => setShowResetNotifModal(true)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-extrabold text-rose-600 hover:bg-rose-100 transition"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                Reset All Notifications
              </button>
            )}

            {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && activeSubTab === 'chats' && (
              <button
                onClick={() => setShowResetChatModal(true)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-extrabold text-rose-600 hover:bg-rose-100 transition"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                Reset All Chats
              </button>
            )}

            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected to Live Gateway
            </span>

            <button
              onClick={() => void loadNotifications(true)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${isGlass ? 'border-slate-800 text-slate-300 hover:bg-white/5' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${inboxLoading ? 'animate-spin text-indigo-500' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 1: NOTIFICATIONS & LEAVE REQUESTS (NOT for Parent role)            */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'requests' && allowedSubTabs.includes('requests') && resolvedRole !== 'Parent' && (
        <div className={`rounded-3xl border ${surface}`}>
          {/* Header & Filter Bar */}
          <div className={`flex flex-wrap items-center justify-between gap-3 border-b p-5 ${divider}`}>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-600">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h2 className={`text-base font-extrabold ${title}`}>
                  {resolvedRole === 'Student'
                    ? 'Class Notices & School Announcements'
                    : 'Notifications & Staff Requests'}
                </h2>
                <p className={`text-xs ${muted}`}>
                  {resolvedRole === 'Student'
                    ? 'Official class alerts, timetable changes and school announcements'
                    : 'Manage staff leave requests, approvals and incoming announcements'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {resolvedRole === 'Teacher' && (
                <button
                  onClick={() => setShowLeaveForm(!showLeaveForm)}
                  className="rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-amber-600 cursor-pointer"
                >
                  {showLeaveForm ? 'Close Form' : '+ New Leave Request'}
                </button>
              )}

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <Filter className="h-3 w-3" /> Filter:
                </span>
                {[
                  { id: 'all', label: 'All' },
                  ...(resolvedRole !== 'Student' ? [{ id: 'requests', label: 'Leave Requests' }] : []),
                  { id: 'urgent', label: 'Urgent' },
                  { id: 'general', label: 'Notices' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setRequestFilter(f.id as any)}
                    className={`rounded-xl px-3 py-1 text-xs font-extrabold transition cursor-pointer ${requestFilter === f.id
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : isGlass ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Teacher Submission Form Modal / Drawer */}
          {showLeaveForm && resolvedRole === 'Teacher' && (
            <form onSubmit={handleSubmitLeaveRequest} className={`space-y-4 border-b p-5 ${panelSoft} ${divider}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-amber-600 flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Submit Official Staff Request
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLeaveCategory('Leave Request')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer ${leaveCategory === 'Leave Request' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                  >
                    Leave Request
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeaveCategory('Holiday Request')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer ${leaveCategory === 'Holiday Request' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'
                      }`}
                  >
                    Holiday Request
                  </button>
                </div>
              </div>

              <input
                type="text"
                placeholder="Reason summary (e.g. Medical leave for 2 days, Family emergency)…"
                value={leaveTitle}
                onChange={(e) => setLeaveTitle(e.target.value)}
                required
                className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold ${inputClass}`}
              />

              <textarea
                rows={2}
                placeholder="Provide details of dates requested, reason and substitute arrangements…"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                required
                className={`w-full rounded-xl border px-3 py-2 text-xs ${inputClass}`}
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLeaveForm(false)}
                  className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSending}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-1.5 text-xs font-extrabold text-white shadow-md hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
                >
                  {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Submit to Admin
                </button>
              </div>
            </form>
          )}

          {/* Notifications Stream Cards */}
          <div ref={inboxContainerRef} className="p-5 space-y-3 max-h-[620px] overflow-y-auto">
            {inboxLoading ? (
              <div className="grid place-items-center py-16 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto" />
                <p className="mt-3 text-xs font-bold text-slate-400">Loading notices…</p>
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
                <Bell className="mx-auto h-8 w-8 text-slate-300" />
                <h3 className="mt-2 text-sm font-extrabold text-slate-700">No notices in this view</h3>
                <p className="mt-1 text-xs text-slate-400">Incoming broadcasts and official announcements will appear here automatically.</p>
              </div>
            ) : (
              filteredNotifications.map((n) => {
                const style = getNotificationCardStyle(n);
                const isReq = isLeaveRequest(n);

                return (
                  <div
                    key={n.id}
                    className={`rounded-2xl border p-4 transition-all duration-200 space-y-3 ${style.border} ${!n.readAt ? 'ring-1 ring-indigo-500/20' : ''
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${style.iconBg}`}>
                          <style.Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs font-black ${title}`}>{n.senderName}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] ${style.badge}`}>
                              {style.tagText || n.category}
                            </span>
                          </div>
                          <h3 className={`mt-1.5 text-sm font-black tracking-tight ${title}`}>{n.title}</h3>
                          <p className={`mt-1 text-xs leading-relaxed font-medium ${muted}`}>{n.body}</p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                        {!n.readAt && (
                          <button
                            onClick={() => void markRead(n.id)}
                            className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100 cursor-pointer"
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Direct Homework Shortcut Action */}
                    {(n.category === 'Homework' || (n.category || '').toLowerCase().includes('homework') || (n.title || '').toLowerCase().includes('homework')) && onNavigateToTab && (
                      <div className="flex items-center justify-between border-t pt-2.5 mt-1 border-blue-100">
                        <span className="text-[11px] font-bold text-blue-700 flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-blue-600" />
                          Class Homework Assignment
                        </span>
                        <button
                          type="button"
                          onClick={() => onNavigateToTab('homework')}
                          className="flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-xl transition cursor-pointer"
                        >
                          Open Class Homework →
                        </button>
                      </div>
                    )}

                    {/* Leave Request Status & Actions for Admin */}
                    {isReq && (resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && (
                      <div className="flex items-center justify-between border-t pt-3 mt-1 border-slate-200">
                        {(n.requestStatus || n.status || 'Pending') === 'Pending' ? (
                          <>
                            <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                              Pending Admin Action
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => void handleRequestDecision(n, 'Declined')}
                                className="flex items-center gap-1 rounded-xl bg-rose-50 px-3.5 py-2 text-xs font-extrabold text-rose-600 hover:bg-rose-100 transition active:scale-95 cursor-pointer"
                              >
                                <UserX className="h-3.5 w-3.5" /> Decline
                              </button>
                              <button
                                onClick={() => void handleRequestDecision(n, 'Approved')}
                                className="flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition active:scale-95 cursor-pointer"
                              >
                                <UserCheck className="h-3.5 w-3.5" /> Approve Leave
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className={`text-xs font-bold flex items-center gap-1.5 ${(n.requestStatus || n.status) === 'Approved' ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {(n.requestStatus || n.status) === 'Approved' ? (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                Leave Approved
                              </>
                            ) : (
                              <>
                                <UserX className="h-4 w-4 text-rose-600" />
                                Leave Declined
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Leave Request Status Indicator for Teacher */}
                    {isReq && resolvedRole === 'Teacher' && (
                      <div className="flex items-center justify-between border-t pt-3 mt-1 border-slate-200">
                        {(n.requestStatus || n.status || 'Pending') === 'Pending' ? (
                          <span className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-amber-600 animate-pulse" />
                            Pending Admin Approval
                          </span>
                        ) : (
                          <span className={`text-xs font-bold flex items-center gap-1.5 ${(n.requestStatus || n.status) === 'Approved' ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {(n.requestStatus || n.status) === 'Approved' ? (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                Approved by Admin
                              </>
                            ) : (
                              <>
                                <UserX className="h-4 w-4 text-rose-600" />
                                Declined by Admin
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 2: BROADCAST DESK (ADMIN & TEACHER ONLY)                             */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'broadcasts' && allowedSubTabs.includes('broadcasts') && (
        <div className={`space-y-6 rounded-3xl border p-6 ${surface}`}>
          <div className="flex items-center gap-3 border-b pb-4 border-slate-100">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-600">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-base font-extrabold ${title}`}>Broadcast Announcement Desk</h2>
              <p className={`text-xs ${muted}`}>
                {resolvedRole === 'Teacher'
                  ? 'Send official announcements to your assigned class students and their parents'
                  : 'Broadcast notices and announcements filtered by class, section, teachers or students'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSendBroadcast} className="space-y-4 rounded-2xl border p-5 bg-slate-50/50">
            {/* Target Audience Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Send To:</span>
              {targets.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    setSelectedTargetIdx(i);
                    setRecipientMode('all');
                    setRecipients('');
                    setSelectedClassId('All');
                    setSelectedClassName('All');
                    setSelectedSectionId('All');
                    setSelectedSectionName('All');
                  }}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition cursor-pointer ${selectedTargetIdx === i
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                >
                  {t.label}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400">Category:</span>
                <select
                  value={broadcastCategory}
                  onChange={(e) => setBroadcastCategory(e.target.value)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${inputClass}`}
                >
                  {(selectedTarget?.categories ?? []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ADMIN AUDIENCE CONTROLS: FOR TEACHERS */}
            {selectedTarget?.endpoint === '/notifications/school-to-teachers/' && (
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Audience Selection:</span>
                <button
                  type="button"
                  onClick={() => { setRecipientMode('all'); setRecipients(''); }}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer ${recipientMode === 'all'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                >
                  All Teachers
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientMode('individual')}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer ${recipientMode === 'individual'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                >
                  Particular Teacher(s)
                </button>
              </div>
            )}

            {/* Particular Teacher Chips */}
            {selectedTarget?.endpoint === '/notifications/school-to-teachers/' && recipientMode === 'individual' && (
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  placeholder="Selected teacher names..."
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2 text-xs ${inputClass}`}
                />
                {teacherList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-slate-400">Click teacher to add:</span>
                    {teacherList.map((t) => {
                      const isSelected = recipients.split(/[\n,]/).map((v) => v.trim()).includes(t.name);
                      return (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => {
                            const list = recipients.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
                            const updated = isSelected ? list.filter((item) => item !== t.name) : [...list, t.name];
                            setRecipients(updated.join(', '));
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold transition cursor-pointer ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                            }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ADMIN AUDIENCE CONTROLS: FOR STUDENTS AND PARENTS (CLASS & SECTION FILTERING) */}
            {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') &&
              (selectedTarget?.endpoint === '/notifications/teacher-to-students/' || selectedTarget?.endpoint === '/notifications/teacher-to-parents/') && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Audience Scope:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecipientMode('all');
                        setRecipients('');
                        setSelectedClassId('All');
                        setSelectedClassName('All');
                        setSelectedSectionId('All');
                        setSelectedSectionName('All');
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer ${recipientMode === 'all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                    >
                      All {selectedTarget.label.replace('Notify ', '')} (School-Wide)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRecipientMode('class_section'); }}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer ${recipientMode === 'class_section'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                    >
                      Filter by Class & Section
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRecipientMode('individual'); }}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition cursor-pointer ${recipientMode === 'individual'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                    >
                      Particular Individual(s)
                    </button>
                  </div>

                  {recipientMode === 'class_section' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" /> Target Class
                        </label>
                        <select
                          value={selectedClassId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedClassId(val === 'All' ? 'All' : Number(val));
                            const cls = academicClasses.find((c) => String(c.id) === val);
                            setSelectedClassName(cls ? cls.name : 'All');
                            setSelectedSectionId('All');
                            setSelectedSectionName('All');
                          }}
                          className={`w-full rounded-xl border p-2 text-xs font-bold ${inputClass}`}
                        >
                          <option value="All">All Classes (Entire School)</option>
                          {academicClasses.map((c) => (
                            <option key={c.id} value={c.id}>{c.name.startsWith('Class') ? c.name : `Class ${c.name}`}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-indigo-600" /> Target Section
                        </label>
                        <select
                          value={selectedSectionId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedSectionId(val === 'All' ? 'All' : Number(val));
                            const sec = academicSections.find((s) => String(s.id) === val);
                            setSelectedSectionName(sec ? sec.name : 'All');
                          }}
                          className={`w-full rounded-xl border p-2 text-xs font-bold ${inputClass}`}
                        >
                          <option value="All">All Sections of Selected Class</option>
                          {academicSections
                            .filter((s) => selectedClassId === 'All' || s.classId === Number(selectedClassId))
                            .map((s) => (
                              <option key={s.id} value={s.id}>Section {s.name}</option>
                            ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2 text-[11px] font-bold text-indigo-800 bg-white p-2.5 rounded-xl border border-indigo-100 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>
                          Targeting: <strong>{selectedClassName === 'All' ? 'All Classes' : selectedClassName}</strong> — <strong>{selectedSectionName === 'All' ? 'All Sections' : `Section ${selectedSectionName}`}</strong> ({selectedTarget.label.includes('Parents') ? 'Parents classified by their child’s enrolled class & section' : 'Enrolled students'}).
                        </span>
                      </div>
                    </div>
                  )}

                  {recipientMode === 'individual' && (
                    <div className="space-y-1.5 pt-1">
                      <input
                        type="text"
                        placeholder="Enter Student Name, Admission No, or ID (comma separated)…"
                        value={recipients}
                        onChange={(e) => setRecipients(e.target.value)}
                        className={`w-full rounded-xl border px-3 py-2 text-xs ${inputClass}`}
                      />
                      <p className="text-[10px] text-slate-400">
                        {selectedTarget.label.includes('Parents')
                          ? 'Enter the student name or admission number to target their linked parent(s).'
                          : 'Enter the student name or admission number to target.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

            {/* TEACHER AUDIENCE CONTROLS: STRICTLY ASSIGNED CLASS & SECTION STUDENTS AND PARENTS */}
            {resolvedRole === 'Teacher' &&
              (selectedTarget?.endpoint === '/notifications/teacher-to-students/' || selectedTarget?.endpoint === '/notifications/teacher-to-parents/') && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 space-y-2">
                    <label className="block text-xs font-black text-amber-900 uppercase flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-amber-600" /> Select Your Assigned Class & Section
                    </label>
                    <select
                      value={selectedSectionId}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'All') {
                          setSelectedClassId('All');
                          setSelectedClassName('All');
                          setSelectedSectionId('All');
                          setSelectedSectionName('All');
                          setRecipientMode('all');
                        } else {
                          setRecipientMode('class_section');
                          const opt = teacherAssignedOptions.find((o) => String(o.sectionId || o.label) === val);
                          if (opt) {
                            setSelectedClassId(opt.classId || 'All');
                            setSelectedClassName(opt.className || 'All');
                            setSelectedSectionId(opt.sectionId || 'All');
                            setSelectedSectionName(opt.sectionName || 'All');
                          }
                        }
                      }}
                      className={`w-full rounded-xl border p-2.5 text-xs font-bold ${inputClass}`}
                    >
                      <option value="All">All My Assigned Classes & Sections</option>
                      {teacherAssignedOptions.map((opt) => (
                        <option key={opt.sectionId || opt.label} value={opt.sectionId || opt.label}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] font-semibold text-amber-800">
                      Messages broadcast strictly to your assigned students and their parents.
                    </p>
                  </div>
                </div>
              )}

            <input
              type="text"
              placeholder="Announcement Title…"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              required
              className={`w-full rounded-xl border px-4 py-2.5 text-sm font-semibold ${inputClass}`}
            />

            <textarea
              rows={3}
              placeholder="Announcement body content…"
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              required
              className={`w-full rounded-xl border px-4 py-2.5 text-sm ${inputClass}`}
            />

            <div className="flex items-center justify-between">
              {sendError && <p className="text-xs font-bold text-rose-600">{sendError}</p>}
              <button
                type="submit"
                disabled={isSending}
                className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-extrabold text-white shadow-md transition hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish Broadcast
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {/* SUB-TAB 3: ISOLATED PRIVATE 1-ON-1 CHAT (TEACHER, PARENT, ADMIN ONLY)        */}
      {/* ─────────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'chats' && allowedSubTabs.includes('chats') && (
        <div className={`grid grid-cols-1 md:grid-cols-3 rounded-3xl border overflow-hidden ${surface}`}>
          {/* Contacts Sidebar */}
          <div className="border-r border-slate-200 p-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-600" />
                  {resolvedRole === 'Parent'
                    ? "Children's Teachers"
                    : resolvedRole === 'School Admin' || resolvedRole === 'Super Admin'
                      ? 'Faculty Teachers'
                      : 'Communications Desk'}
                </h3>
                <p className="text-[10px] text-slate-400 font-semibold">
                  {resolvedRole === 'Parent'
                    ? "Teachers assigned to your children's classes"
                    : resolvedRole === 'School Admin' || resolvedRole === 'Super Admin'
                      ? 'Differentiated by Class, Section & Subjects'
                      : 'Office Desk & Parents of your students'}
                </p>
              </div>
              <span className="text-[10px] font-bold text-indigo-700 font-mono bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                {filteredContacts.length} Available
              </span>
            </div>

            {/* 1. PARENT MULTI-CHILD FILTER TABS (When Parent has multiple sons / children) */}
            {resolvedRole === 'Parent' && parentChildrenList.length > 1 && (
              <div className="space-y-1.5 pt-1 bg-white/80 p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <GraduationCap className="w-3 h-3 text-indigo-500" /> Filter Teachers by Child (Son / Daughter):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setParentChildFilter('All')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${parentChildFilter === 'All'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                  >
                    <Users className="w-3.5 h-3.5" /> All Children ({parentChildrenList.length})
                  </button>
                  {parentChildrenList.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => setParentChildFilter(child.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${parentChildFilter === child.id
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                      <GraduationCap className="w-3.5 h-3.5" /> {child.name} ({child.classLabel})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. ADMIN CLASS & SECTION DIFFERENTIATION FILTER */}
            {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && (
              <div className="space-y-2 pt-1 bg-white/80 p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-indigo-500" /> Filter Faculty by Class & Section:
                  </label>
                  {(adminClassFilter !== 'All' || adminSectionFilter !== 'All') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdminClassFilter('All');
                        setAdminSectionFilter('All');
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={adminClassFilter}
                    onChange={(e) => setAdminClassFilter(e.target.value)}
                    className={`w-full rounded-xl border px-2 py-1.5 text-xs font-bold ${inputClass}`}
                  >
                    <option value="All">All Classes</option>
                    {academicClasses.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name.startsWith('Class') ? c.name : `Class ${c.name}`}
                      </option>
                    ))}
                  </select>

                  <select
                    value={adminSectionFilter}
                    onChange={(e) => setAdminSectionFilter(e.target.value)}
                    className={`w-full rounded-xl border px-2 py-1.5 text-xs font-bold ${inputClass}`}
                  >
                    <option value="All">All Sections</option>
                    {adminAvailableSections.map((sec) => (
                      <option key={sec} value={sec}>
                        Section {sec}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 3. TEACHER AUDIENCE & PARENT STUDENT DIFFERENTIATION FILTER */}
            {resolvedRole === 'Teacher' && (
              <div className="space-y-2 pt-1 bg-white/80 p-2.5 rounded-2xl border border-slate-200/80 shadow-2xs">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <Filter className="w-3 h-3 text-indigo-500" /> Audience Filter:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTeacherAudienceFilter('All')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${teacherAudienceFilter === 'All'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                  >
                    <Users className="w-3.5 h-3.5" /> All Contacts
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeacherAudienceFilter('Admin')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${teacherAudienceFilter === 'Admin'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                  >
                    <Building2 className="w-3.5 h-3.5" /> School Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => setTeacherAudienceFilter('Parents')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${teacherAudienceFilter === 'Parents'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Parents of Students
                  </button>
                </div>

                {teacherAudienceFilter !== 'Admin' && teacherAvailableClasses.length > 0 && (
                  <div className="pt-1">
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">
                      Filter Parents by Student Class:
                    </label>
                    <select
                      value={teacherClassFilter}
                      onChange={(e) => setTeacherClassFilter(e.target.value)}
                      className={`w-full rounded-xl border px-2 py-1.5 text-xs font-bold ${inputClass}`}
                    >
                      <option value="All">All Student Classes</option>
                      {teacherAvailableClasses.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder={
                  resolvedRole === 'Parent'
                    ? 'Search teacher, child, class, section, subject…'
                    : resolvedRole === 'Teacher'
                      ? 'Search parent, student name, roll #, class, section…'
                      : 'Search teacher name, class, section, or subject…'
                }
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className={`w-full rounded-xl border pl-9 pr-3 py-1.5 text-xs ${inputClass}`}
              />
            </div>

            {/* Contacts List */}
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-100 space-y-1">
                  <Users className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="font-bold text-slate-600">
                    {resolvedRole === 'Parent'
                      ? 'No teachers assigned yet to your children.'
                      : resolvedRole === 'Teacher'
                        ? 'No contacts match your filter.'
                        : 'No faculty teachers match your filter.'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {resolvedRole === 'Parent'
                      ? 'Once teachers are assigned to your child’s class in Academic Setup, they will appear here.'
                      : 'Try adjusting your class/section filter or search query.'}
                  </p>
                </div>
              ) : (
                filteredContacts.map((c) => {
                  const isSelected = selectedContact?.name === c.name || (selectedContact?.userId && selectedContact.userId === c.userId);
                  const isOnline = c.isOnline ?? false;
                  const isParent = c.role === 'Parent';
                  const isAdminOffice = c.isOfficeDesk || c.role === 'School Admin' || c.role === 'Super Admin';

                  return (
                    <button
                      key={c.id}
                      onClick={() => void handleSelectContact(c)}
                      className={`w-full flex flex-col gap-2 rounded-2xl p-3 text-left transition cursor-pointer ${isSelected
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 ring-2 ring-indigo-400'
                          : 'bg-white border border-slate-100 hover:bg-slate-100 text-slate-800'
                        }`}
                    >
                      {/* Name, Role & Online Status */}
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2.5">
                          <div className="relative shrink-0">
                            <div
                              className={`grid h-9 w-9 place-items-center rounded-xl font-black text-xs ${isSelected
                                  ? 'bg-indigo-500 text-white'
                                  : isAdminOffice
                                    ? 'bg-purple-100 text-purple-700'
                                    : isParent
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-indigo-50 text-indigo-700'
                                }`}
                            >
                              {c.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                                }`}
                            />
                          </div>
                          <div>
                            <p className="text-xs font-black leading-tight flex items-center gap-1.5">
                              {c.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-md ${isSelected
                                    ? 'bg-indigo-700 text-indigo-100'
                                    : isAdminOffice
                                      ? 'bg-purple-100 text-purple-800'
                                      : isParent
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-slate-100 text-slate-600'
                                  }`}
                              >
                                {c.role}
                              </span>
                              <span className={`text-[10px] font-semibold ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                                · {isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 shrink-0 ${isSelected ? 'text-white' : 'text-slate-300'}`} />
                      </div>

                      {/* 1. TEACHER VIEW: DIFFERENTIATE PARENT BASED ON STUDENT */}
                      {resolvedRole === 'Teacher' && isParent && (
                        <div className="space-y-1 w-full pt-1 border-t border-slate-100/60">
                          {c.students && c.students.length > 0 ? (
                            <div className="space-y-1">
                              {c.students.map((st) => (
                                <div
                                  key={st.id}
                                  className={`rounded-xl p-2 text-[11px] border ${isSelected
                                      ? 'bg-indigo-700/80 border-indigo-400 text-white'
                                      : 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                                    }`}
                                >
                                  <div className="font-black flex items-center gap-1">
                                    <GraduationCap className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-200' : 'text-emerald-700'}`} />
                                    <span>
                                      Parent of: <span className="underline decoration-emerald-400 font-extrabold">{st.name}</span>
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold mt-1">
                                    <span className={`px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-emerald-100 text-emerald-800'}`}>
                                      {st.className.startsWith('Class') ? st.className : `Class ${st.className}`} - Sec {st.section}
                                    </span>
                                    {st.rollNo && (
                                      <span className={`px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-200 text-slate-700'}`}>
                                        Roll #{st.rollNo}
                                      </span>
                                    )}
                                    {st.admissionNo && (
                                      <span className={`px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-200 text-slate-700'}`}>
                                        Adm #{st.admissionNo}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className={`text-[10px] font-semibold ${isSelected ? 'text-indigo-100' : 'text-slate-500'}`}>
                              {c.studentSummary || 'Student Guardian'}
                            </p>
                          )}
                        </div>
                      )}

                      {/* 2. PARENT VIEW: MENTION TEACHER'S SECTION, CLASS & SUBJECTS FOR EACH SON / CHILD */}
                      {resolvedRole === 'Parent' && c.childMappings && c.childMappings.length > 0 && (
                        <div className="space-y-1.5 w-full pt-1 border-t border-slate-100/60">
                          {c.childMappings.map((cm, idx) => (
                            <div
                              key={idx}
                              className={`rounded-xl p-2 text-[11px] space-y-1 border ${isSelected
                                  ? 'bg-indigo-700/80 border-indigo-400 text-white'
                                  : 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                                }`}
                            >
                              <div className="font-extrabold flex items-center gap-1.5">
                                <GraduationCap className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-200' : 'text-emerald-700'}`} />
                                <span>
                                  Teacher for <span className="underline decoration-emerald-400 font-black">{cm.studentName}</span>
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                                  <span className={`px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-emerald-100 text-emerald-800'}`}>
                                    {cm.className.startsWith('Class') ? cm.className : `Class ${cm.className}`} - Sec {cm.sectionName}
                                  </span>
                                  {cm.subjects && cm.subjects.length > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-indigo-800 text-indigo-100' : 'bg-indigo-100 text-indigo-800'}`}>
                                      {cm.subjects.join(', ')}
                                    </span>
                                  )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 3. ADMIN VIEW: DIFFERENTIATE TEACHERS BY CLASS, SECTION & SUBJECTS */}
                      {(resolvedRole === 'School Admin' || resolvedRole === 'Super Admin') && (
                        <div className="space-y-1 w-full pt-1 border-t border-slate-100/60">
                          {c.assignedSections && c.assignedSections.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className={`text-[10px] font-bold ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                                Classes:
                              </span>
                              {c.assignedSections.map((sec, idx) => (
                                <span
                                  key={idx}
                                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${isSelected
                                      ? 'bg-indigo-700 text-white border border-indigo-500'
                                      : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                    }`}
                                >
                                  {sec.startsWith('Class') ? sec : `Class ${sec}`}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className={`text-[10px] ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                              No class section assigned
                            </p>
                          )}

                          {c.subjects && c.subjects.length > 0 && (
                            <p className={`text-[10px] font-semibold truncate ${isSelected ? 'text-indigo-100' : 'text-slate-500'}`}>
                              Subjects: {c.subjects.join(', ')}
                            </p>
                          )}
                        </div>
                      )}

                      {/* School Admin Office Desk specific description */}
                      {isAdminOffice && resolvedRole === 'Teacher' && (
                        <div className="text-[10px] font-semibold text-purple-700 pt-0.5">
                          Staff Coordination & Principal Office Desk
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 1-on-1 Chat Stream Window */}
          <div className="md:col-span-2 flex flex-col h-[580px] min-h-0 shrink-0">
            {/* Contact Header */}
            <div className="flex items-center justify-between border-b p-4 border-slate-100 bg-white">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-md shadow-indigo-600/20">
                    {selectedContact?.name.slice(0, 2).toUpperCase() || 'TC'}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${selectedContact && selectedContact.isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    {selectedContact?.name || 'Select a Contact to Chat'}
                  </h3>

                  {/* Role Specific Subtitle Differentiation */}
                  {selectedContact && (
                    <div className="text-[11px] text-slate-500 font-semibold flex flex-wrap items-center gap-1.5 mt-0.5">
                      {/* PARENT VIEWING TEACHER: MENTION SECTION, CLASS & SUBJECTS */}
                      {resolvedRole === 'Parent' && selectedContact.childMappings && selectedContact.childMappings.length > 0 ? (
                        selectedContact.childMappings.map((cm, idx) => (
                          <span key={idx} className="text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            Teacher for {cm.studentName} ({cm.className.startsWith('Class') ? cm.className : `Class ${cm.className}`} - Sec {cm.sectionName}) · Subjects: {cm.subjects.join(', ')}
                          </span>
                        ))
                      ) : resolvedRole === 'Teacher' && selectedContact.role === 'Parent' ? (
                        /* TEACHER VIEWING PARENT: DIFFERENTIATE BASED ON STUDENT */
                        selectedContact.students && selectedContact.students.length > 0 ? (
                          selectedContact.students.map((st, idx) => (
                            <span key={idx} className="text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              Parent of {st.name} ({st.className.startsWith('Class') ? st.className : `Class ${st.className}`} - Sec {st.section}, Roll #{st.rollNo})
                            </span>
                          ))
                        ) : (
                          <span className="text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            {selectedContact.studentSummary || 'Parent of Student'}
                          </span>
                        )
                      ) : selectedContact.isOfficeDesk || selectedContact.role === 'School Admin' ? (
                        <span className="text-purple-800 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200">
                          School Administration / Office Desk · Official Coordination
                        </span>
                      ) : (
                        /* ADMIN VIEWING TEACHER: MENTION CLASS, SECTION & SUBJECTS */
                        <>
                          <span className="text-indigo-600 font-bold">
                            {selectedContact.assignedSections && selectedContact.assignedSections.length > 0
                              ? selectedContact.assignedSections.map(s => s.startsWith('Class') ? s : `Class ${s}`).join(', ')
                              : 'Faculty Member'}
                          </span>
                          {selectedContact.subjects && selectedContact.subjects.length > 0 && (
                            <span className="text-slate-600">
                              · {selectedContact.subjects.join(', ')}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Real-Time WebSocket Connection Status Badge */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors bg-white shadow-2xs">
                  {socketStatus === 'connected' ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-emerald-700 font-extrabold flex items-center gap-1">
                        <Wifi className="w-3 h-3 text-emerald-600" /> Live WebSockets
                      </span>
                    </>
                  ) : socketStatus === 'connecting' ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-amber-700 font-bold flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 text-amber-600 animate-spin" /> Connecting
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <WifiOff className="w-3 h-3 text-slate-400" /> Offline
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Chat Messages Stream */}
            <div ref={chatStreamContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 pb-8 space-y-4 bg-slate-50/50">
              {chatLoading ? (
                <div className="grid h-full place-items-center text-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500 mx-auto" />
                  <p className="mt-2 text-xs font-bold text-slate-400">Loading conversation messages…</p>
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="grid h-full place-items-center text-center p-8">
                  <div>
                    <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-2 text-xs font-extrabold text-slate-700">
                      Direct 1-on-1 Conversation with {selectedContact?.name || 'Contact'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {resolvedRole === 'Parent'
                        ? 'Reach out directly to discuss your child’s academic progress, assignments, or inquiries.'
                        : resolvedRole === 'Teacher'
                          ? 'Coordinate with the school administration or discuss student performance directly with parents.'
                          : 'Send direct messages, coordination notes, and faculty updates.'}
                    </p>
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMe = msg.isMe;

                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-md rounded-2xl p-3.5 shadow-xs transition ${isMe
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'
                          }`}
                      >
                        {msg.body && <p className="text-xs leading-relaxed font-normal">{msg.body}</p>}

                        {/* Attachments Display */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 space-y-1.5 pt-1 border-t border-white/20">
                            {msg.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={att.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`flex items-center gap-2 p-2 rounded-xl text-[11px] font-semibold transition ${
                                  isMe ? 'bg-indigo-700 hover:bg-indigo-800 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                                }`}
                              >
                                <FileText className="w-4 h-4 shrink-0" />
                                <span className="truncate flex-1">{att.originalName}</span>
                                <span className="text-[9px] opacity-75 shrink-0">
                                  {Math.round(att.fileSize / 1024)} KB
                                </span>
                                <Download className="w-3.5 h-3.5 shrink-0" />
                              </a>
                            ))}
                          </div>
                        )}

                        <div
                          className={`mt-1.5 flex items-center justify-end gap-1 text-[9px] font-mono ${isMe ? 'text-indigo-200' : 'text-slate-400'
                            }`}
                        >
                          {msg.editedAt && <span className="italic opacity-80">(edited)</span>}
                          <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isMe && (
                            msg.readAt ? (
                              <span title="Read"><CheckCheck className="h-3.5 w-3.5 text-indigo-200" /></span>
                            ) : (
                              <span title="Delivered"><CheckCircle2 className="h-3 w-3 text-indigo-200/80" /></span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input Form */}
            <div className="border-t border-slate-200 bg-white p-3 shrink-0 relative z-10">
              {/* Selected Files Preview Chips */}
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-900 px-2.5 py-1 rounded-xl text-[11px] font-semibold"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="truncate max-w-[150px]">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-600 transition ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendChat} className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      setSelectedFiles(Array.from(e.target.files));
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition cursor-pointer"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <input
                  type="text"
                  placeholder={`Type a direct message to ${selectedContact?.name || 'contact'}…`}
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-xs ${inputClass}`}
                />
                <button
                  type="submit"
                  disabled={isSendingChat || (!chatMessage.trim() && selectedFiles.length === 0) || !selectedConversationId}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  {isSendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin Reset Confirmation Modal: Notifications ── */}
      {showResetNotifModal && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
          <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="reset-notif-modal-title">
            <div className="flex-shrink-0 flex items-center gap-3 text-rose-600 border-b border-slate-100 pb-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-100">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <h3 id="reset-notif-modal-title" className="text-base font-black text-slate-900">Clear All School Notifications?</h3>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 py-3">
              <p className="text-xs leading-relaxed text-slate-600">
                This action will permanently delete all notification records, leave requests, and announcements for your school. This action cannot be undone.
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetNotifModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClearAllNotifications()}
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
    </section>
  );
}
