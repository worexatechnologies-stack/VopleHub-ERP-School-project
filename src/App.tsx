import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  Grid,
  Users,
  GraduationCap,
  CheckSquare,
  BookOpen,
  CreditCard,
  FileText,
  MessageSquare,
  Library,
  Truck,
  Terminal,
  LogOut,
  Menu,
  ChevronDown,
  Clock,
  ShieldCheck,
  UserCheck,
  School,
  Calendar,
  Lock,
  Palette,
  Settings,
  Bell,
  Globe2,
  Wallet,
  Receipt,
  FolderCheck,
  Copy,
  Check,
  UserPlus,
  Key,
} from 'lucide-react';

// Custom Modules Components
import Dashboard from './components/Dashboard';
import PasswordManager from './components/PasswordManager';
import StudentModule from './components/StudentModule';
import AcademicModule from './components/AcademicModule';
import AttendanceModule from './components/AttendanceModule';
import ParentAttendance from './components/ParentAttendance';
import ParentNotifications from './components/ParentNotifications';
import LearningModule from './components/LearningModule';
import FeesModule from './components/FeesModule';
import FamilyFees from './components/FamilyFees';
import ExamModule from './components/ExamModule';
import CommunicationModule from './components/CommunicationModule';
import LibraryModule from './components/LibraryModule';
import TransportModule from './components/TransportModule';
import StaffFeeModule from './components/StaffFeeModule';
import TeacherSalaryDetails from './components/TeacherSalaryDetails';
import TeacherDocuments from './components/TeacherDocuments';
import StudentDocuments from './components/StudentDocuments';
import TeacherDirectory from './components/TeacherDirectory';
import NotificationComposerPage from './components/NotificationComposerPage';
import CommunityEventsModule from './components/CommunityEventsModule';
import AcademicSetupManager from './components/AcademicSetupManager';
import HomeworkModule from './components/HomeworkModule';

// Newly Added Components
import LoginScreen from './components/LoginScreen';
import ForcedPasswordChange from './components/ForcedPasswordChange';
import ChangePasswordModal from './components/ChangePasswordModal';
import SuperAdminModule from './components/SuperAdminModule';
import PromotionModule from './components/PromotionModule';
import { renderBrandIcon } from './components/SuperAdminSettings';
import PublicLearningModule from './components/PublicLearningModule';
import StudentEnrollmentPage from './components/StudentEnrollmentPage';
import AdmissionsModule from './components/AdmissionsModule';
import NotificationCenter from './components/NotificationCenter';
import PushNotificationManager from './components/PushNotificationManager';
import AppSidebar from './components/AppSidebar';
import WorexaLogo from './components/WorexaLogo';
import volpeLogo from './assets/volpe-logo.png';
import { emitNotification } from './services/notificationBus';
import { BRAND } from './config/branding';

// Custom Types and Auth
import { Student, StudentDocument, UserRole, BrandSettings } from './types';

import { ACCESS_TOKEN_STORAGE_KEY, AUTH_SESSION_EXPIRED_EVENT, AuthUser, clearAuthenticatedSession, clearAuthenticatedUser, getStoredAuthenticatedUser, storeAuthenticatedUser } from './utils/auth';
import { authApi } from './store/api/authApi';
import { normalizeStudent, studentApi, useGetStudentsQuery } from './store/api/studentApi';
import { deactivateFcmDeviceToken } from './services/firebaseMessaging';
import {
  AcademicClass,
  AcademicYear,
  announceAcademicStructureChanged,
  loadAcademicStructure,
} from './services/academicStructure';
import { useAppDispatch, useAppSelector } from './store';
import { logout as reduxLogout, setAccessToken as reduxSetAccessToken, setCredentials as reduxSetCredentials, setUser as reduxSetUser } from './store/slices/authSlice';
import { setActiveTab as reduxSetActiveTab, setCredentialSlip as reduxSetCredentialSlip } from './store/slices/uiSlice';
import { copyToClipboard } from './utils/clipboard';

function adjustColorBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace('#', '');
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) return hex;

  let r = (num >> 16) + Math.round(2.55 * percent);
  let g = ((num >> 8) & 0x00ff) + Math.round(2.55 * percent);
  let b = (num & 0x0000ff) + Math.round(2.55 * percent);

  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function AuthenticatedApp() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.accessToken);
  const user = useAppSelector((state) => state.auth.user);
  const activeTab = useAppSelector((state) => state.ui.activeTab);
  const credentialSlip = useAppSelector((state) => state.ui.credentialSlip);
  const [copiedSlip, setCopiedSlip] = useState(false);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // White-Label / Brand settings state
  const [brandSettings, setBrandSettings] = useState<BrandSettings>(() => {
    const saved = localStorage.getItem('erp_brand_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.primaryColor === '#4f46e5' || !parsed.primaryColor || parsed.primaryColor === '#1e3a8a') {
          parsed.primaryColor = '#6366f1';
          parsed.secondaryColor = '#10b981';
        }
        if (!parsed.theme || parsed.theme === 'playful-school' || parsed.theme === 'glass-academy') {
          parsed.theme = 'default';
        }
        if (parsed.logoType === 'icon') {
          parsed.logoType = 'image';
        }
        return parsed;
      } catch (e) {
        // ignore
      }
    }
    return {
      schoolName: BRAND.displayName,
      logoType: 'image',
      logoIcon: 'School',
      logoImageUrl: '',
      logoMonogram: 'S',
      primaryColor: '#6366f1',
      secondaryColor: '#10b981',
      theme: 'default'
    };
  });

  // Save brand settings whenever updated
  const handleUpdateBrandSettings = (newSettings: BrandSettings) => {
    setBrandSettings(newSettings);
    localStorage.setItem('erp_brand_settings', JSON.stringify(newSettings));
    setLogs(prev => [`[System branding] Base school white-label colors & assets compiled and saved.`, ...prev]);
  };

  // Authentication states come from Redux. Local state is only for UI-only
  // concerns that do not need to be shared across components.
  const [accountDirectory, setAccountDirectory] = useState<Array<{ id: number; email: string; role: string; studentId?: string; parentStudentIds?: string[] }>>([]);
  const [isPublicMode, setIsPublicMode] = useState(false);

  // Student rosters are security-sensitive and always come from the
  // role-scoped PostgreSQL API. Never restore another session's roster from
  // browser storage while the current user's permissions are being resolved.
  const [students, setStudents] = useState<Student[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const storedToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (storedToken && !token) {
      dispatch(reduxSetAccessToken(storedToken));
    }
  }, [token]);

  // Academic structure is tenant-scoped and comes only from PostgreSQL.
  const [currentAcademicYear, setCurrentAcademicYear] = useState('');
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);

  const getDefaultTabForRole = (role: UserRole) => {
    return role === 'Super Admin' ? 'super-admin-dashboard' : 'dashboard';
  };

  // Validate the backend-issued access token before restoring a session.
  useEffect(() => {
    if (!token) return;
    const storedUser = getStoredAuthenticatedUser();
    if (storedUser?.mustChangePassword) {
      dispatch(reduxSetUser(storedUser));
      return;
    }
    dispatch(authApi.endpoints.getCurrentUser.initiate()).unwrap()
      .then((authenticatedUser) => {
        storeAuthenticatedUser(authenticatedUser);
        dispatch(reduxSetUser(authenticatedUser));
        dispatch(reduxSetActiveTab(getDefaultTabForRole(authenticatedUser.role)));
      })
      .catch(() => {
        clearAuthenticatedSession();
        dispatch(reduxLogout());
      });
  }, [token]);

  // Each operational portal receives only the students allowed by the API:
  // all in-school students for an admin, linked wards for a parent, and the
  // logged-in student’s own record for a student account.
  const canFetchStudents = Boolean(token && user && ['School Admin', 'Parent', 'Student', 'Teacher'].includes(user.role));
  const { data: serverStudents, refetch: refetchStudents } = useGetStudentsQuery(undefined, {
    skip: !canFetchStudents,
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (!canFetchStudents) {
      if (!token && user && ['School Admin', 'Parent', 'Student', 'Teacher'].includes(user.role)) {
        try {
          const stored = localStorage.getItem('erp_students');
          if (stored) {
            setStudents(JSON.parse(stored));
            return;
          }
        } catch { }
      }
      setStudents([]);
      return;
    }
    if (serverStudents) {
      setStudents(serverStudents.map((student) => ({
        ...student,
        id: String(student.id),
        class: student.class,
        medicalConditions: student.medicalConditions || '',
        qrCodeData: student.qrCodeData || `SCH-ERP-${student.id}`,
        // Decimal fields from DRF are strings by default. Normalize them
        // once when the roster arrives so every dashboard/module receives
        // real numeric values.
        attendancePercentage: student.attendancePercentage == null ? undefined : Number(student.attendancePercentage),
        feeTotal: student.feeTotal == null ? undefined : Number(student.feeTotal),
        feePaid: student.feePaid == null ? undefined : Number(student.feePaid),
      })) as Student[]);
      const rosterYear = serverStudents.find((s) => Boolean(s.academicYear))?.academicYear;
      if (rosterYear) {
        setCurrentAcademicYear((prev) => prev || rosterYear);
      }
    }
  }, [canFetchStudents, serverStudents, token, user]);

  useEffect(() => {
    if (canFetchStudents && activeTab === 'student') {
      void refetchStudents();
    }
  }, [canFetchStudents, activeTab, refetchStudents]);

  const refreshAcademicContext = async () => {
    const structure = await loadAcademicStructure();
    setAcademicYears(structure.years);
    setAcademicClasses(structure.classes);
    const selectedYear = structure.years.find((year) => year.is_active) || structure.years[0];
    const fallbackYear = serverStudents?.find((s) => Boolean(s.academicYear))?.academicYear || '';
    setCurrentAcademicYear(selectedYear?.name || fallbackYear || '');
    return structure;
  };

  const handleAcademicSetupChanged = async () => {
    announceAcademicStructureChanged();
    await refreshAcademicContext();
  };

  useEffect(() => {
    if (!token || !user || user.role === 'Super Admin') {
      setAcademicYears([]);
      setAcademicClasses([]);
      setCurrentAcademicYear('');
      return;
    }
    let active = true;
    loadAcademicStructure()
      .then((structure) => {
        if (!active) return;
        setAcademicYears(structure.years);
        setAcademicClasses(structure.classes);
        const selectedYear = structure.years.find((year) => year.is_active) || structure.years[0];
        const fallbackYear = serverStudents?.find((s) => Boolean(s.academicYear))?.academicYear || '';
        setCurrentAcademicYear(selectedYear?.name || fallbackYear || '');
      })
      .catch(() => {
        if (!active) return;
        setAcademicYears([]);
        setAcademicClasses([]);
        setCurrentAcademicYear('');
      });
    return () => { active = false; };
  }, [token, user?.schoolId, user?.role]);

  useEffect(() => {
    if (!token || user?.role !== 'School Admin') {
      setAccountDirectory([]);
      return;
    }
    dispatch(authApi.endpoints.getUsers.initiate()).unwrap()
      .then(setAccountDirectory)
      .catch(() => setAccountDirectory([]));
  }, [token, user?.email, user?.schoolId, user?.role]);

  useEffect(() => {
    const expireSession = () => {
      clearAuthenticatedSession();
      dispatch(reduxLogout());
      setStudents([]);
      setAccountDirectory([]);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
  }, []);

  // Login handler
  const handleLogin = (newUser: AuthUser, newToken: string) => {
    setStudents([]);
    if (newToken) {
      dispatch(reduxSetAccessToken(newToken));
    }
    dispatch(reduxSetUser(newUser));
    storeAuthenticatedUser(newUser);
    emitNotification({
      title: 'Login successful',
      message: `${newUser.name} signed in as ${newUser.role}.`,
      tone: 'success',
      source: 'auth',
    });

    dispatch(reduxSetActiveTab(getDefaultTabForRole(newUser.role)));
  };

  // Logout handler
  const handleLogout = async () => {
    // Local cleanup must happen even when the network is unavailable.  When
    // reachable, the API blacklists the refresh token before it is discarded.
    try {
      await deactivateFcmDeviceToken();
    } catch {
      // The token is also replaced on the next login and invalid Firebase
      // tokens are removed by the backend after delivery feedback.
    }
    try {
      await dispatch(authApi.endpoints.logout.initiate()).unwrap();
    } catch {
      // The session is still removed from this device below.
    }
    clearAuthenticatedSession();
    dispatch(reduxLogout());
    setStudents([]);
    setAccountDirectory([]);
    dispatch(reduxSetActiveTab('dashboard'));
  };

  const handleTemporaryPasswordChanged = () => {
    if (!user) return;
    const updatedUser = { ...user, mustChangePassword: false };
    storeAuthenticatedUser(updatedUser);
    dispatch(reduxSetUser(updatedUser));
    dispatch(reduxSetActiveTab(getDefaultTabForRole(updatedUser.role)));
  };

  // Simulation handlers
  const readLocalUsers = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem('sa_users') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const saveLocalUsers = (usersList: any[]) => {
    localStorage.setItem('sa_users', JSON.stringify(usersList));
  };

  const createPermanentPassword = (prefix: string, seed: string) => {
    const clean = seed.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const suffix = (clean.slice(-4) || '2026').padStart(4, 'X');
    return `${prefix}@${suffix}9`;
  };

  const makeLoginId = (name: string, fallback: string, domain: string) => {
    const base = (name || fallback || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.+/g, '.')
      .slice(0, 42) || 'user';
    return `${base}@${domain}`;
  };

  const getParentLoginName = (student: Student) => (
    student.fatherName ||
    student.motherName ||
    student.parentName ||
    student.name
  );

  const createStudentAndParentLogins = (student: Student, showCredentials = true) => {
    const usersList = readLocalUsers();
    const studentEmail = makeLoginId(student.name, student.admissionNo, 'students.volpehub.education');
    const parentLoginName = getParentLoginName(student);
    const parentEmail = makeLoginId(parentLoginName, student.parentPhone || student.admissionNo, 'parents.volpehub.education');
    const parentExists = usersList.some((account: any) => (
      account.role === 'Parent' && String(account.email || '').toLowerCase() === parentEmail.toLowerCase()
    ));
    const studentExists = usersList.some((account: any) => (
      account.role === 'Student' && account.studentId === student.id
    ));
    const studentPassword = createPermanentPassword('Student', student.name || student.admissionNo);
    const parentPassword = createPermanentPassword('Parent', parentLoginName || student.parentPhone || student.admissionNo);
    const nextUsers = [...usersList];

    const legacyStudentEmail = `${student.admissionNo.toLowerCase().replace(/[^a-z0-9]/g, '')}@students.volpehub.education`;
    const legacyParentEmail = student.parentEmail || `${student.parentPhone.replace(/\D/g, '') || student.admissionNo.toLowerCase()}@parents.volpehub.education`;

    nextUsers.forEach((account: any) => {
      if (account.role === 'Student' && (account.studentId === student.id || String(account.email || '').toLowerCase() === legacyStudentEmail.toLowerCase())) {
        account.email = studentEmail;
        account.name = student.name;
        account.studentId = student.id;
      }
      if (account.role === 'Parent' && (
        account.studentId === student.id ||
        (account.linkedStudentIds || []).includes(student.id) ||
        String(account.email || '').toLowerCase() === legacyParentEmail.toLowerCase()
      )) {
        account.email = parentEmail;
        account.name = parentLoginName;
        account.linkedStudentIds = Array.from(new Set([...(account.linkedStudentIds || []), student.id]));
        account.studentId = account.studentId || student.id;
      }
    });

    if (!studentExists) {
      nextUsers.push({
        email: studentEmail,
        password: studentPassword,
        name: student.name,
        role: 'Student',
        schoolId: 'school-default',
        studentId: student.id,
        status: 'Active',
        locked: false,
        forceReset: false,
        permissions: ['view_schedules', 'access_lms', 'take_quizzes', 'view_my_grades'],
      });
    }

    if (!parentExists) {
      nextUsers.push({
        email: parentEmail,
        password: parentPassword,
        name: parentLoginName,
        role: 'Parent',
        schoolId: 'school-default',
        studentId: student.id,
        linkedStudentIds: [student.id],
        status: 'Active',
        locked: false,
        forceReset: false,
        permissions: ['view_child_records', 'pay_fees', 'view_report_cards', 'chat_teachers'],
      });
    } else {
      nextUsers.forEach((account: any) => {
        if (account.role === 'Parent' && String(account.email || '').toLowerCase() === parentEmail.toLowerCase()) {
          account.linkedStudentIds = Array.from(new Set([...(account.linkedStudentIds || []), student.id]));
          account.studentId = account.studentId || student.id;
          account.status = 'Active';
          account.locked = false;
        }
      });
    }

    saveLocalUsers(nextUsers);
    if (showCredentials) {
      dispatch(reduxSetCredentialSlip({
        title: 'Student and parent login created',
        lines: [
          `Student Email: ${studentEmail}`,
          `Student Password: ${studentExists ? 'Already exists' : studentPassword}`,
          `Parent Email: ${parentEmail}`,
          `Parent Password: ${parentExists ? 'Existing parent account reused' : parentPassword}`,
        ],
      }));
    }
  };

  useEffect(() => {
    // API-backed accounts own credentials on the server. Never replace them
    // with locally invented values for display.
    if (token) return;
    if (!user || students.length === 0) return;
    if (!['Super Admin', 'School Admin'].includes(user.role)) return;
    students.forEach(student => createStudentAndParentLogins(student, false));
  }, [token, user?.email, user?.role, students.length]);

  const handleAddStudent = async (newS: Student): Promise<Student> => {
    const enriched: Student = {
      ...newS,
      academicYear: newS.academicYear || currentAcademicYear
    };
    if (token) {
      const body = new FormData();
      const fields: Record<string, string | number | undefined> = {
        admissionNo: enriched.admissionNo, name: enriched.name, class_: enriched.class, sectionId: enriched.sectionId,
        section: enriched.section, rollNo: enriched.rollNo, parentName: enriched.parentName,
        parentPhone: enriched.parentPhone, parentEmail: enriched.parentEmail, dob: enriched.dob,
        gender: enriched.gender, address: enriched.address, medical_conditions: enriched.medicalConditions,
        status: enriched.status, academicYear: enriched.academicYear,
        attendancePercentage: enriched.attendancePercentage, feeTotal: enriched.feeTotal, feePaid: enriched.feePaid,
      };
      Object.entries(fields).forEach(([key, value]) => { if (value !== undefined) body.append(key, String(value)); });
      if (enriched.photoFile) body.append('photo', enriched.photoFile);
      const created = await dispatch(studentApi.endpoints.createStudent.initiate(body)).unwrap();
      const serverStudent: Student = {
        ...enriched,
        ...normalizeStudent(created),
      };
      setStudents(prev => [serverStudent, ...prev.filter(student => student.id !== serverStudent.id)]);
      const credentials = created.loginCredentials;
      if (credentials?.student?.temporaryPassword) {
        const studentCreds = credentials.student;
        const studentEmail = studentCreds.email;
        const parentEmail = credentials.parent?.created ? (credentials.parent.email || enriched.parentEmail) : 'Existing parent account';
        setAccountDirectory((current) => {
          const withoutNewStudent = current.filter((account) => !(
            (account.role === 'student' && account.studentId === serverStudent.id) ||
            (account.role === 'parent' && account.parentStudentIds?.includes(serverStudent.id))
          ));
          const next = [
            ...withoutNewStudent,
            { id: studentCreds.userId, email: studentCreds.email, role: 'student', studentId: serverStudent.id },
          ];
          if (credentials.parent?.userId) {
            next.push({ id: credentials.parent.userId, email: credentials.parent.email, role: 'parent', parentStudentIds: [serverStudent.id] });
          }
          return next;
        });
        dispatch(reduxSetCredentialSlip({
          title: 'Student and parent login created',
          lines: [
            `Student Email: ${studentEmail}`,
            `Student Password: ${studentCreds.temporaryPassword}`,
            `Parent Email: ${parentEmail}`,
            `Parent Password: ${credentials.parent?.temporaryPassword || credentials.parent?.message || 'Existing parent account reused'}`,
          ],
        }));
      }
      setLogs(prev => [`[Admissions] Enrolled ${serverStudent.name} on the server.`, ...prev]);
      emitNotification({
        title: 'Student Admitted',
        message: `${serverStudent.name} was successfully enrolled into ${serverStudent.class}.`,
        tone: 'success',
        source: 'admissions',
      });
      return serverStudent;
    }

    setStudents(prev => {
      const next = [enriched, ...prev.filter(item => item.id !== enriched.id)];
      try {
        localStorage.setItem('erp_students', JSON.stringify(next));
      } catch { }
      return next;
    });
    createStudentAndParentLogins(enriched);
    setLogs(prev => [`[Admissions] Enrolled student: ${enriched.name} (${enriched.class}) into ${currentAcademicYear} term`, ...prev]);
    emitNotification({
      title: 'Student admitted',
      message: `${enriched.name} was enrolled into ${currentAcademicYear}.`,
      tone: 'success',
      source: 'admissions',
    });
    return enriched;
  };

  const handleStudentApproved = (approvedStudent: Student) => {
    setStudents(prev => [approvedStudent, ...prev.filter(s => s.id !== approvedStudent.id)]);
    if (token) {
      dispatch(studentApi.endpoints.getStudents.initiate(undefined)).unwrap()
        .then((rows) => {
          setStudents(rows.map((s) => ({
            ...s,
            id: String(s.id),
            attendancePercentage: s.attendancePercentage == null ? undefined : Number(s.attendancePercentage),
            feeTotal: s.feeTotal == null ? undefined : Number(s.feeTotal),
            feePaid: s.feePaid == null ? undefined : Number(s.feePaid),
          })) as Student[]);
        })
        .catch(() => {});
    }
    setLogs(prev => [`[Admissions] Online applicant approved & enrolled: ${approvedStudent.name} (${approvedStudent.class})`, ...prev]);
    emitNotification({
      title: 'Online Admission Approved',
      message: `${approvedStudent.name} was approved and enrolled into ${approvedStudent.class}. Portal credentials activated and fees ledger created.`,
      tone: 'success',
      source: 'admissions',
    });
  };

  const resetChildCredentials = async (userId: number) => {
    const credentials = await dispatch(authApi.endpoints.resetCredentials.initiate(userId)).unwrap();
    setAccountDirectory((current) => current.map((account) => account.id === userId ? { ...account, email: credentials.loginId } : account));
    return credentials;
  };

  const handleUpdateStudent = async (updatedStudent: Student) => {
    if (token) {
      const body = new FormData();
      const fields: Record<string, string | number | undefined> = {
        name: updatedStudent.name, class_: updatedStudent.class, section: updatedStudent.section, sectionId: updatedStudent.sectionId,
        rollNo: updatedStudent.rollNo, parentName: updatedStudent.parentName,
        parentPhone: updatedStudent.parentPhone, parentEmail: updatedStudent.parentEmail,
        dob: updatedStudent.dob, gender: updatedStudent.gender, address: updatedStudent.address,
        medical_conditions: updatedStudent.medicalConditions, status: updatedStudent.status,
        academicYear: updatedStudent.academicYear, attendancePercentage: updatedStudent.attendancePercentage,
        feeTotal: updatedStudent.feeTotal, feePaid: updatedStudent.feePaid,
      };
      Object.entries(fields).forEach(([key, value]) => { if (value !== undefined) body.append(key, String(value)); });
      if (updatedStudent.photoFile) body.append('photo', updatedStudent.photoFile);
      const saved = await dispatch(studentApi.endpoints.updateStudent.initiate({ id: updatedStudent.id, body })).unwrap();
      updatedStudent = {
        ...updatedStudent,
        ...normalizeStudent(saved),
        photoUrl: saved.photoUrl || updatedStudent.photoUrl,
        photoFile: undefined,
      };
    }
    setStudents(prev => {
      const next = prev.map(student => student.id === updatedStudent.id ? updatedStudent : student);
      if (!token) {
        try { localStorage.setItem('erp_students', JSON.stringify(next)); } catch { }
      }
      return next;
    });
    const usersList = readLocalUsers();
    saveLocalUsers(usersList.map((account: any) => {
      if (account.role === 'Student' && account.studentId === updatedStudent.id) {
        return { ...account, name: updatedStudent.name, status: updatedStudent.status === 'TC_Issued' ? 'Inactive' : 'Active', locked: updatedStudent.status === 'TC_Issued' };
      }
      if (account.role === 'Parent' && (account.studentId === updatedStudent.id || (account.linkedStudentIds || []).includes(updatedStudent.id))) {
        return {
          ...account,
          name: updatedStudent.parentName,
          email: updatedStudent.parentEmail || account.email,
          status: updatedStudent.status === 'TC_Issued' ? account.status : 'Active',
        };
      }
      return account;
    }));
    setLogs(prev => [`[Admissions] Updated student profile: ${updatedStudent.name} (${updatedStudent.admissionNo})`, ...prev]);
    emitNotification({
      title: 'Student updated',
      message: `${updatedStudent.name}'s student details were updated.`,
      tone: 'success',
      source: 'admissions',
    });
  };

  const handleStudentDocumentsChanged = (studentId: string, documents: StudentDocument[]) => {
    setStudents((current) => current.map((student) => (
      student.id === studentId ? { ...student, documents } : student
    )));
  };

  const handleDeleteStudent = async (studentId: string): Promise<void> => {
    const student = students.find(s => s.id === studentId);
    if (token) {
      await dispatch(studentApi.endpoints.deleteStudent.initiate(studentId)).unwrap();
    }
    setStudents(prev => {
      const next = prev.filter(item => item.id !== studentId);
      if (!token) {
        try { localStorage.setItem('erp_students', JSON.stringify(next)); } catch { }
      }
      return next;
    });
    setAccountDirectory((current) => current.flatMap((account) => {
      if (account.role === 'student' && account.studentId === studentId) return [];
      if (account.role === 'parent' && account.parentStudentIds?.includes(studentId)) {
        const parentStudentIds = account.parentStudentIds.filter((id) => id !== studentId);
        return parentStudentIds.length ? [{ ...account, parentStudentIds }] : [];
      }
      return [account];
    }));
    if (student) {
      const remainingStudents = students.filter(item => item.id !== studentId);
      const usersList = readLocalUsers();
      saveLocalUsers(usersList.filter((account: any) => {
        if (account.role === 'Student' && account.studentId === studentId) return false;
        if (account.role !== 'Parent') return true;
        const linkedIds = (account.linkedStudentIds || [account.studentId]).filter((id: string) => id && id !== studentId);
        const hasRemainingChild = linkedIds.some((id: string) => remainingStudents.some(s => s.id === id));
        if (!hasRemainingChild && account.studentId === studentId) return false;
        account.linkedStudentIds = linkedIds;
        if (account.studentId === studentId) account.studentId = linkedIds[0];
        return true;
      }));
      setLogs(prev => [`[Admissions] Deleted student profile: ${student.name} (${student.admissionNo})`, ...prev]);
      emitNotification({
        title: 'Student deleted',
        message: `${student.name}'s student profile was removed.`,
        tone: 'warning',
        source: 'admissions',
      });
    }
  };

  const handleDeleteAllStudents = () => {
    setStudents([]);
    try {
      localStorage.removeItem('erp_students');
      localStorage.removeItem('erp_individual_fees');
    } catch {}
    setLogs(prev => [`[Admissions] All student data and credentials permanently cleared.`, ...prev]);
    emitNotification({
      title: 'Students Purged',
      message: 'All student records and credentials have been permanently deleted.',
      tone: 'warning',
      source: 'admissions',
    });
  };

  const handlePromoteStudent = async (
    studentId: string,
    nextClass: string,
    options?: {
      nextSection?: string;
      nextYear?: string;
      adminApproved?: boolean;
      allowFeeWaiver?: boolean;
      waiverReason?: string;
    }
  ) => {
    const currentStudent = students.find(s => s.id === studentId);
    if (!currentStudent) return false;

    // Check 50% fee clearance requirement
    const feeTotal = Number(currentStudent.feeTotal || 0);
    const feePaid = Number(currentStudent.feePaid || 0);
    const feePct = feeTotal > 0 ? (feePaid / feeTotal) * 100 : 100;
    if (feeTotal > 0 && feePct < 50 && !options?.allowFeeWaiver) {
      alert(`Cannot promote ${currentStudent.name}: Student has only paid ${feePct.toFixed(1)}% of fees (₹${feePaid.toLocaleString()} of ₹${feeTotal.toLocaleString()}). At least 50% fee payment is mandatory for promotion to the next class.`);
      return false;
    }

    if (!options?.adminApproved && !options?.allowFeeWaiver) {
      alert(`Admin approval required: An administrator must approve 50% fee clearance before promoting ${currentStudent.name}.`);
      return false;
    }

    let nextYear = options?.nextYear;
    if (!nextYear) {
      const currentYearIndex = academicYears.findIndex((year) => year.name === currentStudent.academicYear);
      if (currentYearIndex >= 0 && academicYears[currentYearIndex + 1]) {
        nextYear = academicYears[currentYearIndex + 1].name;
      } else {
        nextYear = currentStudent.academicYear;
      }
    }

    const nextSection = options?.nextSection || currentStudent.section || 'A';

    // Synchronize fee invoice in localStorage ('erp_individual_fees')
    const syncFeeInvoiceForPromotedStudent = (targetClass: string, targetSection: string, targetYear: string) => {
      try {
        const rawFees = localStorage.getItem('erp_individual_fees');
        if (rawFees) {
          const feeList = JSON.parse(rawFees);
          if (Array.isArray(feeList)) {
            let targetItems: any[] | undefined = undefined;
            let targetQuarters: any[] | undefined = undefined;
            try {
              const rawStructures = localStorage.getItem('erp_fee_structures');
              if (rawStructures) {
                const structures = JSON.parse(rawStructures);
                if (Array.isArray(structures)) {
                  const targetSt = structures.find((st: any) =>
                    st.targetClass && st.targetClass.toLowerCase() === targetClass.toLowerCase()
                  );
                  if (targetSt) {
                    targetItems = targetSt.items;
                    targetQuarters = targetSt.quarters;
                  }
                }
              }
            } catch (e) {}

            const updatedFees = feeList.map((fr: any) => {
              if (fr.studentId === studentId || fr.admissionNo === currentStudent.admissionNo) {
                return {
                  ...fr,
                  class: targetClass,
                  section: targetSection,
                  academicYear: targetYear,
                  ...(targetItems ? { customItems: targetItems, customQuarters: targetQuarters } : {}),
                };
              }
              return fr;
            });
            localStorage.setItem('erp_individual_fees', JSON.stringify(updatedFees));
            window.dispatchEvent(new CustomEvent('erp_fees_updated'));
          }
        }
      } catch (feeSyncErr) {
        console.warn('Error updating erp_individual_fees on promotion:', feeSyncErr);
      }
    };

    // Call backend API if running
    try {
      const promotedApiRes = await dispatch(studentApi.endpoints.promoteStudent.initiate({
        id: studentId,
        nextClass,
        nextSection,
        nextAcademicYear: nextYear,
        adminApproved: options?.adminApproved ?? true,
        allowFeeWaiver: Boolean(options?.allowFeeWaiver),
        waiverReason: options?.waiverReason || '',
      })).unwrap();

      if (promotedApiRes) {
        const normalized = normalizeStudent(promotedApiRes);
        setStudents(prev => {
          const updatedOld = prev.map(s => s.id === studentId ? { ...s, status: 'Promoted' as const } : s);
          return [normalized, ...updatedOld.filter(s => s.id !== normalized.id)];
        });

        syncFeeInvoiceForPromotedStudent(nextClass, nextSection, nextYear);

        setLogs(prev => [
          `[Administration] Promoted ${currentStudent.name} to ${nextClass}-${nextSection} for Academic Cycle ${nextYear} with Admin Approval. Fees invoice updated.` +
          (options?.allowFeeWaiver ? ' (Administrative Fee Waiver Granted)' : ` (Fee Cleared: ${feePct.toFixed(1)}%)`),
          ...prev,
        ]);
        emitNotification({
          title: 'Student Promoted',
          message: `${currentStudent.name} was promoted to ${nextClass}-${nextSection} for ${nextYear}.`,
          tone: 'success',
          source: 'promotion',
        });
        return true;
      }
    } catch (apiErr: any) {
      console.warn('Backend promote API call error, falling back to local state sync:', apiErr);
      if (apiErr?.data?.detail) {
        alert(apiErr.data.detail);
        return false;
      }
    }

    // Local / Offline promotion state update
    const oldStudentUpdated = {
      ...currentStudent,
      status: 'Promoted' as const
    };

    const newHistoryEntry = {
      academicYear: currentStudent.academicYear,
      class: currentStudent.class,
      section: currentStudent.section,
      gpa: currentStudent.gpa || 8.5,
      attendance: currentStudent.attendancePercentage || 92.0,
      status: `Promoted to ${nextClass}` + (options?.allowFeeWaiver ? ' (Fee Waiver)' : '')
    };

    const newStudentId = `${currentStudent.admissionNo}_${nextYear}`;
    const newStudentClone: Student = {
      ...currentStudent,
      id: newStudentId,
      class: nextClass,
      section: nextSection,
      academicYear: nextYear,
      status: 'Active' as const,
      attendancePercentage: 100,
      feePaid: 0,
      feeTotal: currentStudent.feeTotal || 0,
      gpa: undefined,
      history: [
        ...(currentStudent.history || []),
        newHistoryEntry
      ]
    };

    setStudents(prev => {
      const filtered = prev.filter(s => s.id !== newStudentId);
      return filtered.map(s => {
        if (s.id === studentId) {
          return oldStudentUpdated;
        }
        return s;
      }).concat(newStudentClone);
    });

    syncFeeInvoiceForPromotedStudent(nextClass, nextSection, nextYear);

    setLogs(prev => [
      `[Administration] Promoted ${currentStudent.name} to ${nextClass}-${nextSection} for Academic Cycle ${nextYear} with Admin Approval. Previous cycle record archived and fees invoice updated.` +
      (options?.allowFeeWaiver ? ' (Administrative Fee Waiver Granted)' : ` (Fee Cleared: ${feePct.toFixed(1)}%)`),
      ...prev
    ]);
    emitNotification({
      title: 'Student Promoted',
      message: `${currentStudent.name} was promoted to ${nextClass}-${nextSection} for ${nextYear}.`,
      tone: 'success',
      source: 'promotion',
    });
    return true;
  };

  const handleIssueTC = (studentId: string) => {
    setStudents(prev => prev.map(student => {
      if (student.id === studentId) {
        return { ...student, status: 'TC_Issued' as const };
      }
      return student;
    }));
    const sName = students.find(s => s.id === studentId)?.name || 'Student';
    setLogs(prev => [`[Administration] Issued Transfer Certificate for ${sName}. Profile locked.`, ...prev]);
    emitNotification({
      title: 'Transfer Certificate Issued',
      message: `Issued Transfer Certificate for ${sName}. Student profile locked.`,
      tone: 'warning',
      source: 'administration',
    });
  };

  // Bulk Academic Year Promotion Executor
  const handleExecutePromotion = (
    newYear: string,
    decisions: { [studentId: string]: { status: 'Promoted' | 'Retained'; nextClass: string } }
  ) => {
    const clonedStudents: Student[] = [];
    let promotedCount = 0;

    const updatedPrevStudents = students.map(s => {
      const decision = decisions[s.id];
      if (decision) {
        if (decision.status === 'Promoted') {
          promotedCount++;
          if (decision.nextClass === 'Graduated') {
            return {
              ...s,
              status: 'Promoted' as const // Archive as promoted
            };
          } else {
            // Archive old record and create clone for the new year
            const newHistoryEntry = {
              academicYear: s.academicYear,
              class: s.class,
              section: s.section,
              gpa: s.gpa || 8.5,
              attendance: s.attendancePercentage || 92.0,
              status: 'Promoted'
            };
            const newStudentId = `${s.admissionNo}_${newYear}`;
            clonedStudents.push({
              ...s,
              id: newStudentId,
              class: decision.nextClass,
              academicYear: newYear,
              status: 'Active' as const,
              attendancePercentage: 100,
              feePaid: 0,
              gpa: undefined,
              history: [
                ...(s.history || []),
                newHistoryEntry
              ]
            });

            return {
              ...s,
              status: 'Promoted' as const
            };
          }
        } else {
          // Retained: create clone for new year in the same class
          const newHistoryEntry = {
            academicYear: s.academicYear,
            class: s.class,
            section: s.section,
            gpa: s.gpa || 7.2,
            attendance: s.attendancePercentage || 85.0,
            status: 'Retained'
          };
          const newStudentId = `${s.admissionNo}_${newYear}`;
          clonedStudents.push({
            ...s,
            id: newStudentId,
            class: s.class,
            academicYear: newYear,
            status: 'Active' as const,
            attendancePercentage: 100,
            feePaid: 0,
            gpa: undefined,
            history: [
              ...(s.history || []),
              newHistoryEntry
            ]
          });

          return {
            ...s,
            status: 'Active' as const // keep active in old year representation
          };
        }
      }
      return s;
    });

    // Remove any previously created records of the new academic year to prevent duplicates
    const filteredPrev = updatedPrevStudents.filter(s => s.academicYear !== newYear && !s.id.endsWith(`_${newYear}`));
    setStudents([...filteredPrev, ...clonedStudents]);

    // Synchronize bulk fee invoices in localStorage ('erp_individual_fees')
    try {
      const rawFees = localStorage.getItem('erp_individual_fees');
      if (rawFees) {
        const feeList = JSON.parse(rawFees);
        if (Array.isArray(feeList)) {
          let rawStructuresList: any[] = [];
          try {
            const rawStructures = localStorage.getItem('erp_fee_structures');
            if (rawStructures) rawStructuresList = JSON.parse(rawStructures);
          } catch (e) {}

          const updatedFees = feeList.map((fr: any) => {
            const dec = decisions[fr.studentId];
            if (dec && dec.status === 'Promoted' && dec.nextClass !== 'Graduated') {
              const targetSt = Array.isArray(rawStructuresList)
                ? rawStructuresList.find((st: any) => st.targetClass && st.targetClass.toLowerCase() === dec.nextClass.toLowerCase())
                : null;
              return {
                ...fr,
                class: dec.nextClass,
                academicYear: newYear,
                ...(targetSt ? { customItems: targetSt.items, customQuarters: targetSt.quarters } : {}),
              };
            }
            return fr;
          });
          localStorage.setItem('erp_individual_fees', JSON.stringify(updatedFees));
          window.dispatchEvent(new CustomEvent('erp_fees_updated'));
        }
      }
    } catch (feeSyncErr) {
      console.warn('Error updating bulk erp_individual_fees on promotion:', feeSyncErr);
    }

    setCurrentAcademicYear(newYear);

    setLogs(prev => [
      `[Promotion] Academic Year Bulk Promotion Executed. Admin approved promotion for ${promotedCount} students. Tuition fees invoices cleanly updated in fee ledger for ${newYear}.`,
      ...prev
    ]);
    emitNotification({
      title: 'Bulk Promotion Completed',
      message: `Successfully processed promotions for ${promotedCount} students into ${newYear}.`,
      tone: 'success',
      source: 'promotion',
    });
  };

  // Admissions pending badge counter
  const { data: rawEnrollmentApps = [] } = studentApi.useGetEnrollmentApplicationsQuery(undefined, {
    skip: !user || user.role !== 'School Admin',
  });
  const pendingAdmissionsBadge = useMemo(() => {
    const count = (rawEnrollmentApps || []).filter((a) => a.status === 'Pending').length;
    return count > 0 ? count : undefined;
  }, [rawEnrollmentApps]);

  // Define RBAC-based menus
  const getMenuItems = () => {
    if (!user) return [];

    switch (user.role) {
      case 'Super Admin':
        return [
          { id: 'super-admin-dashboard', label: 'Overview Dashboard', icon: Grid },
          { id: 'super-admin-schools', label: 'School Branches', icon: School },
          { id: 'super-admin-admins', label: 'School Admins', icon: UserCheck },
          { id: 'passwords', label: 'Password Manager', icon: Key },
          { id: 'super-admin-sys-settings', label: 'System Settings', icon: Settings }
        ];

      case 'School Admin':
        return [
          { id: 'dashboard', label: 'Admin Dashboard', icon: Grid },
          { id: 'academic-setup', label: 'Academic Setup', icon: Settings },
          { id: 'admissions', label: 'Online Admissions', icon: UserPlus, badge: pendingAdmissionsBadge },
          { id: 'student', label: 'Student Directory', icon: Users },
          { id: 'teachers', label: 'Teacher Profiles', icon: UserCheck },
          { id: 'passwords', label: 'Password Manager', icon: Key },
          { id: 'academic', label: 'Timetables & Schedules', icon: GraduationCap },
          { id: 'homework', label: 'Class Homework', icon: BookOpen },
          { id: 'attendance', label: 'Roster Attendance', icon: CheckSquare },
          { id: 'fees', label: 'Fees Invoicing', icon: CreditCard },
          { id: 'staff-fee', label: 'Staff Fee', icon: Wallet },
          { id: 'exams', label: 'Exams & Grading', icon: FileText },
          { id: 'communication', label: 'Communications', icon: MessageSquare },
          { id: 'community-events', label: 'Community & Events', icon: Globe2 },
          { id: 'transport', label: 'Transport GPS', icon: Truck }
        ];

      case 'Teacher':
        return [
          { id: 'dashboard', label: 'Teacher Dashboard', icon: Grid },
          { id: 'student', label: 'Student Directory', icon: Users },
          { id: 'academic', label: 'Academic Schedules', icon: GraduationCap },
          { id: 'homework', label: 'Class Homework', icon: BookOpen },
          { id: 'attendance', label: 'Mark Attendance', icon: CheckSquare },
          { id: 'salary-details', label: 'Salary Details', icon: Receipt },
          { id: 'teacher-documents', label: 'My Documents', icon: FolderCheck },
          { id: 'exams', label: 'Exams & Grading', icon: FileText },
          { id: 'communication', label: 'Communications', icon: MessageSquare },
          { id: 'community-events', label: 'Community & Events', icon: Globe2 },
        ];

      case 'Parent':
        return [
          { id: 'dashboard', label: 'Parent Portal', icon: Grid },
          { id: 'academic', label: "Child's Timetable", icon: GraduationCap },
          { id: 'homework', label: 'Class Homework', icon: BookOpen },
          { id: 'attendance', label: 'Ward Attendance', icon: CheckSquare },
          { id: 'notifications', label: 'School Notices', icon: Bell },
          { id: 'fees', label: 'School Fee Desk', icon: CreditCard },
          { id: 'exams', label: 'Exam Reports', icon: FileText },
          { id: 'communication', label: 'Teacher Chat', icon: MessageSquare },
          { id: 'community-events', label: 'Community & Events', icon: Globe2 },
          { id: 'transport', label: 'Transport Tracker', icon: Truck }
        ];

      case 'Student':
        return [
          { id: 'dashboard', label: 'Student Portal', icon: Grid },
          { id: 'academic', label: 'My Timetable', icon: GraduationCap },
          { id: 'homework', label: 'Class Homework', icon: BookOpen },
          { id: 'student-documents', label: 'My Documents', icon: FolderCheck },
          { id: 'exams', label: 'Datesheets & Reports', icon: FileText },
          { id: 'communication', label: 'Class Notices', icon: Bell },
          { id: 'fees', label: 'My School Fees', icon: CreditCard },
          { id: 'community-events', label: 'School Community', icon: Globe2 },
          { id: 'transport', label: 'Transport GPS', icon: Truck }
        ];

      default:
        return [];
    }
  };

  const menuItems = getMenuItems();
  const allowedTabIds = menuItems.map(item => item.id);
  const canAccessActiveTab = !user || allowedTabIds.includes(activeTab);
  const getFirstAllowedTab = (candidates: string[]) => {
    return candidates.find(id => allowedTabIds.includes(id)) || allowedTabIds[0] || getDefaultTabForRole(user?.role || 'School Admin');
  };

  const mainScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!user) return;
    if (allowedTabIds.length > 0 && !allowedTabIds.includes(activeTab)) {
      dispatch(reduxSetActiveTab(getDefaultTabForRole(user.role)));
    }
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, [user, activeTab, allowedTabIds.join('|')]);

  // Compile dynamic theme styles on-the-fly (Universal executive theme across all roles)
  const pColor = brandSettings.primaryColor;
  const sColor = brandSettings.secondaryColor;

  const p50 = `${pColor}0d`; // 5% opacity
  const p100 = `${pColor}1a`; // 10% opacity
  const p500 = adjustColorBrightness(pColor, 10);
  const p600 = pColor;
  const p700 = adjustColorBrightness(pColor, -15);
  const p950 = adjustColorBrightness(pColor, -45);

  const s50 = `${sColor}0d`;
  const s100 = `${sColor}1a`;
  const s500 = adjustColorBrightness(sColor, 10);
  const s600 = sColor;
  const s700 = adjustColorBrightness(sColor, -15);
  const s950 = adjustColorBrightness(sColor, -45);

  // Nova Campus is the single visual language for the product. Brand colours
  // remain configurable, but legacy presentation modes are intentionally retired.
  const isGlass = false;
  const is3D = false;

  if (!isPublicMode && user?.mustChangePassword) {
    return (
      <ForcedPasswordChange
        email={user.email}
        onComplete={handleTemporaryPasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div
      className={`theme-nova relative transition-colors duration-300 ${isPublicMode || Boolean(user)
          ? 'h-dvh min-h-0 overflow-hidden flex'
          : 'min-h-dvh w-full flex flex-col overflow-x-hidden'
        }`}
      id="school-erp-app"
    >
      <PushNotificationManager enabled={Boolean(token && user)} />

      {/* Dynamic theme style overrides */}
      <style>{`
        :root {
          --color-indigo-50: ${p50} !important;
          --color-indigo-100: ${p100} !important;
          --color-indigo-500: ${p500} !important;
          --color-indigo-600: ${p600} !important;
          --color-indigo-700: ${p700} !important;
          --color-indigo-950: ${p950} !important;

          --color-emerald-50: ${s50} !important;
          --color-emerald-100: ${s100} !important;
          --color-emerald-500: ${s500} !important;
          --color-emerald-600: ${s600} !important;
          --color-emerald-700: ${s700} !important;
          --color-emerald-950: ${s950} !important;
        }
      `}</style>

      {/* Ambient background decoration blobs for Glassmorphic Academy theme */}
      {brandSettings.theme === 'glass-academy' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-40 -right-40 w-[450px] h-[450px] bg-emerald-600/10 rounded-full blur-[150px]" />
          <div className="absolute top-1/2 left-1/3 w-80 h-80 bg-violet-600/5 rounded-full blur-[100px]" />
        </div>
      )}

      {isPublicMode ? (
        <div className="w-full h-full relative z-20 bg-[#080c14] overflow-y-auto">
          <PublicLearningModule onExit={() => setIsPublicMode(false)} />
        </div>
      ) : (!user || !token) ? (
        <LoginScreen onLogin={handleLogin} brandSettings={brandSettings} onPublicAccess={() => setIsPublicMode(true)} />
      ) : (
        <>
          {credentialSlip && createPortal(
            <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black/55 backdrop-blur-sm flex min-h-full items-center justify-center p-3 sm:p-5 animate-fade-in" role="presentation">
              <div className="w-full max-w-lg max-h-[85vh] my-auto flex flex-col rounded-3xl border border-emerald-200 bg-white p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95" role="dialog" aria-modal="true" aria-labelledby="credentials-modal-title">
                <div className="flex-shrink-0">
                  <h2 id="credentials-modal-title" className="text-base font-extrabold text-emerald-800">{credentialSlip.title}</h2>
                  <p className="mt-1 text-xs text-slate-500">Copy these credentials now and share securely.</p>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 my-3">
                  <pre className="whitespace-pre-wrap break-all rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-mono leading-5 text-slate-800">
                    {credentialSlip.lines.join('\n')}
                  </pre>
                </div>
                <div className="flex-shrink-0 flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={async () => {
                      const success = await copyToClipboard(credentialSlip.lines.join('\n'));
                      if (success) {
                        setCopiedSlip(true);
                        setTimeout(() => setCopiedSlip(false), 2500);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-all cursor-pointer ${
                      copiedSlip
                        ? 'bg-emerald-600 ring-2 ring-emerald-300 shadow-sm'
                        : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 shadow-sm'
                    }`}
                  >
                    {copiedSlip ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-200" />
                        Copied to clipboard!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy credentials
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch(reduxSetCredentialSlip(null));
                      setCopiedSlip(false);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

          {/* Upgraded App Sidebar */}
          <AppSidebar
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            brandSettings={brandSettings}
            volpeLogo={volpeLogo}
            menuItems={menuItems}
            activeTab={activeTab}
            onSelectTab={(tabId) => dispatch(reduxSetActiveTab(tabId))}
            user={user}
          />

          {/* Main Content Area */}
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

            {/* Top Header navbar */}
            <header id="app-topbar" className={`h-16 flex items-center justify-between px-6 shrink-0 relative z-30 border-b ${isGlass
                ? 'bg-slate-900/40 border-slate-850 backdrop-blur-md text-slate-100'
                : is3D
                  ? 'bg-white border-slate-200 shadow-sm text-slate-800'
                  : 'bg-white border-slate-200 shadow-xs text-slate-800'
              }`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className={`p-1.5 rounded-xl md:block hidden cursor-pointer border transition-all ${isGlass
                      ? 'border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-800 hover:text-white'
                      : is3D
                        ? 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white shadow-[2px_2px_5px_rgba(163,177,198,0.15)]'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:shadow-xs'
                    }`}
                >
                  <Menu className="w-5 h-5" />
                </button>

                <div className="md:hidden flex items-center gap-2">
                  <img
                    src={brandSettings?.logoType === 'image' && brandSettings.logoImageUrl ? brandSettings.logoImageUrl : volpeLogo}
                    alt="Logo"
                    className="w-7 h-7 object-contain shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = volpeLogo;
                    }}
                    referrerPolicy="no-referrer"
                  />
                  <h2 className="text-xs font-sans font-bold tracking-wider text-slate-900 uppercase truncate max-w-[150px] sm:max-w-none">
                    {brandSettings.schoolName}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-4">


                {/* Logged in User Information */}
                <div className={`flex items-center gap-3 pl-4 border-l ${isGlass ? 'border-slate-850' : 'border-slate-200'}`} id="user-header-card">


                  {(user?.role === 'School Admin' || user?.role === 'Super Admin') && (
                    <button
                      onClick={() => setIsChangePasswordOpen(true)}
                      className={`w-8 h-8 rounded-full transition-all flex items-center justify-center border cursor-pointer ${isGlass
                          ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-indigo-950/40 hover:text-indigo-400'
                          : is3D
                            ? 'bg-white border-slate-200 text-slate-600 hover:text-indigo-600 shadow-[2px_2px_5px_rgba(163,177,198,0.15)] hover:translate-y-[-1px] active:translate-y-[1px]'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:shadow-xs'
                        }`}
                      title="Change Account Password"
                      id="btn-header-change-password"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={handleLogout}
                    className={`w-8 h-8 rounded-full transition-all flex items-center justify-center border cursor-pointer ${isGlass
                        ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-rose-950/40 hover:text-rose-400'
                        : is3D
                          ? 'bg-white border-slate-200 text-slate-600 hover:text-rose-600 shadow-[2px_2px_5px_rgba(163,177,198,0.15)] hover:translate-y-[-1px] active:translate-y-[1px]'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:shadow-xs'
                      }`}
                    title="Log Out (Destroy JWT session)"
                    id="btn-header-logout"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>

                <NotificationCenter logs={logs} isGlass={isGlass} is3D={is3D} />
              </div>
            </header>

            {/* Inner Tab Router Body */}
            <main ref={mainScrollRef} className="mb-14 min-h-0 flex-1 overscroll-contain overflow-y-auto p-6 md:mb-0 md:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="mx-auto min-h-full max-w-7xl"
                >
                  {!canAccessActiveTab && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">
                      This page is not available for {user.role}. Redirecting to your dashboard...
                    </div>
                  )}
                  {/* Super Admin Modules */}
                  {canAccessActiveTab && activeTab.startsWith('super-admin-') && (
                    <SuperAdminModule
                      activeTab={activeTab}
                      onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))}
                    />
                  )}

                  {/* School Admin / Standard Modules */}
                  {canAccessActiveTab && activeTab === 'academic-setup' && user?.role === 'School Admin' && (
                    <AcademicSetupManager
                      onChanged={handleAcademicSetupChanged}
                      onOpenTeachers={() => dispatch(reduxSetActiveTab('teachers'))}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'dashboard' && user && (
                    <Dashboard
                      onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))}
                      isGlass={isGlass}
                      role={user.role}
                      userName={user.name}
                      students={students}
                      schoolName={user.schoolName || brandSettings.schoolName}
                      currentAcademicYear={currentAcademicYear}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'admissions' && user?.role === 'School Admin' && (
                    <AdmissionsModule
                      students={students}
                      onStudentApproved={handleStudentApproved}
                      currentAcademicYear={currentAcademicYear}
                      academicClasses={academicClasses}
                      academicYears={academicYears}
                      schoolName={user.schoolName || brandSettings.schoolName}
                      onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'student' && (
                    <StudentModule
                      students={students}
                      onAddStudent={handleAddStudent}
                      onUpdateStudent={handleUpdateStudent}
                      onDeleteStudent={handleDeleteStudent}
                      onPromoteStudent={handlePromoteStudent}
                      onIssueTC={handleIssueTC}
                      onDocumentsChanged={handleStudentDocumentsChanged}
                      accountDirectory={accountDirectory}
                      onResetCredentials={resetChildCredentials}
                      currentAcademicYear={currentAcademicYear}
                      canManageStudents={user?.role === 'School Admin'}
                      viewerRole={user?.role}
                      onOpenAcademicSetup={user?.role === 'School Admin' ? () => dispatch(reduxSetActiveTab('academic-setup')) : undefined}
                      onStudentApproved={handleStudentApproved}
                      onNavigateToAdmissions={() => dispatch(reduxSetActiveTab('admissions'))}
                      onDeleteAllStudents={handleDeleteAllStudents}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'teachers' && user?.role === 'School Admin' && <TeacherDirectory />}
                  {canAccessActiveTab && activeTab === 'passwords' && (user?.role === 'School Admin' || user?.role === 'Super Admin') && (
                    <PasswordManager
                      schoolName={user.schoolName || brandSettings.schoolName}
                      viewerRole={user?.role}
                      onOpenChangePassword={() => setIsChangePasswordOpen(true)}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'academic' && (
                    <AcademicModule
                      user={user}
                      students={students}
                      currentAcademicYear={currentAcademicYear}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'homework' && (
                    <HomeworkModule
                      user={user}
                      students={students}
                      onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'attendance' && (
                    user?.role === 'Parent'
                      ? <ParentAttendance />
                      : <AttendanceModule students={students.filter(s => s.academicYear === currentAcademicYear)} />
                  )}
                  {canAccessActiveTab && activeTab === 'notifications' && user?.role === 'Parent' && (
                    <ParentNotifications onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))} />
                  )}
                  {canAccessActiveTab && activeTab === 'learning' && <LearningModule />}
                  {canAccessActiveTab && activeTab === 'fees' && (user?.role === 'Parent' || user?.role === 'Student'
                    ? <FamilyFees role={user.role} />
                    : <FeesModule user={user} students={students} currentAcademicYear={currentAcademicYear} schoolName={brandSettings.schoolName} onAddLog={(msg: string) => setLogs(prev => [msg, ...prev])} />
                  )}
                  {canAccessActiveTab && activeTab === 'staff-fee' && user?.role === 'School Admin' && (
                    <StaffFeeModule schoolName={user.schoolName || brandSettings.schoolName} onAddLog={(msg: string) => setLogs(prev => [msg, ...prev])} />
                  )}
                  {canAccessActiveTab && activeTab === 'salary-details' && user?.role === 'Teacher' && (
                    <TeacherSalaryDetails user={user} schoolName={user.schoolName || brandSettings.schoolName} />
                  )}
                  {canAccessActiveTab && activeTab === 'teacher-documents' && user?.role === 'Teacher' && (
                    <TeacherDocuments user={user} schoolName={user.schoolName || brandSettings.schoolName} />
                  )}
                  {canAccessActiveTab && activeTab === 'student-documents' && user?.role === 'Student' && (
                    <StudentDocuments user={user} schoolName={user.schoolName || brandSettings.schoolName} students={students} />
                  )}
                  {canAccessActiveTab && activeTab === 'exams' && (
                    <ExamModule
                      user={user}
                      students={students}
                      schoolName={user.schoolName || brandSettings.schoolName}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'promotion' && (
                    <PromotionModule
                      students={students}
                      onExecutePromotion={handleExecutePromotion}
                      logs={logs}
                      currentAcademicYear={currentAcademicYear}
                      academicYears={academicYears}
                      academicClasses={academicClasses}
                    />
                  )}
                  {canAccessActiveTab && activeTab === 'communication' && (
                    <CommunicationModule user={user} isGlass={isGlass} onNavigateToTab={(tab: string) => dispatch(reduxSetActiveTab(tab))} />
                  )}
                  {canAccessActiveTab && activeTab === 'community-events' && <CommunityEventsModule user={user} />}
                  {canAccessActiveTab && activeTab === 'notify-teachers' && user?.role === 'School Admin' && (
                    <NotificationComposerPage mode="school-to-teachers" user={user} students={students} />
                  )}
                  {canAccessActiveTab && activeTab === 'notify-parents' && user?.role === 'School Admin' && (
                    <NotificationComposerPage mode="teacher-to-parents" user={user} students={students} />
                  )}
                  {canAccessActiveTab && activeTab === 'notify-students' && user?.role === 'School Admin' && (
                    <NotificationComposerPage mode="teacher-to-students" user={user} students={students} />
                  )}
                  {canAccessActiveTab && activeTab === 'library' && <LibraryModule />}
                  {canAccessActiveTab && activeTab === 'transport' && <TransportModule />}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>

          {/* Mobile Bottom Navigation Bar (rendered on smaller screens) */}
          <div className="md:hidden !fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 text-slate-500 grid grid-cols-5 h-16 z-50 px-1 py-1 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
            <button
              onClick={() => dispatch(reduxSetActiveTab(getFirstAllowedTab(['dashboard', 'super-admin-dashboard'])))}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold transition-colors select-none ${
                activeTab === 'dashboard' || activeTab === 'super-admin-dashboard' ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              {(activeTab === 'dashboard' || activeTab === 'super-admin-dashboard') && (
                <motion.div
                  layoutId="mobileActiveTab"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute inset-0 rounded-xl bg-indigo-50/80 -z-10"
                />
              )}
              <Grid className="w-4 h-4" />
              <span>Home</span>
            </button>

            <button
              onClick={() => dispatch(reduxSetActiveTab(getFirstAllowedTab(['super-admin-schools', 'student', 'teachers', 'academic'])))}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold transition-colors select-none ${
                ['student', 'teachers', 'academic', 'super-admin-schools'].includes(activeTab) ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              {['student', 'teachers', 'academic', 'super-admin-schools'].includes(activeTab) && (
                <motion.div
                  layoutId="mobileActiveTab"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute inset-0 rounded-xl bg-indigo-50/80 -z-10"
                />
              )}
              <Users className="w-4 h-4" />
              <span>{user.role === 'Super Admin' ? 'Branches' : user.role === 'School Admin' ? 'Students' : 'Academic'}</span>
            </button>

            <button
              onClick={() => dispatch(reduxSetActiveTab(getFirstAllowedTab(['super-admin-admins', 'attendance', 'exams'])))}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold transition-colors select-none ${
                ['attendance', 'exams', 'super-admin-admins'].includes(activeTab) ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              {['attendance', 'exams', 'super-admin-admins'].includes(activeTab) && (
                <motion.div
                  layoutId="mobileActiveTab"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute inset-0 rounded-xl bg-indigo-50/80 -z-10"
                />
              )}
              <CheckSquare className="w-4 h-4" />
              <span>{user.role === 'Super Admin' ? 'Admins' : allowedTabIds.includes('attendance') ? 'Attendance' : 'Exams'}</span>
            </button>

            <button
              onClick={() => dispatch(reduxSetActiveTab(getFirstAllowedTab(['super-admin-sys-settings', 'learning', 'communication', 'transport'])))}
              disabled={!allowedTabIds.some(id => ['super-admin-sys-settings', 'learning', 'communication', 'transport'].includes(id))}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold transition-colors select-none disabled:opacity-30 ${
                ['learning', 'communication', 'transport', 'super-admin-sys-settings'].includes(activeTab) ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              {['learning', 'communication', 'transport', 'super-admin-sys-settings'].includes(activeTab) && (
                <motion.div
                  layoutId="mobileActiveTab"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  className="absolute inset-0 rounded-xl bg-indigo-50/80 -z-10"
                />
              )}
              <BookOpen className="w-4 h-4" />
              <span>{user.role === 'Super Admin' ? 'Settings' : allowedTabIds.includes('learning') ? 'LMS' : allowedTabIds.includes('communication') ? 'Chat' : 'More'}</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex flex-col items-center justify-center gap-0.5 text-[9px] text-rose-500 hover:text-rose-600 font-bold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>

          {(user?.role === 'School Admin' || user?.role === 'Super Admin') && (
            <ChangePasswordModal
              isOpen={isChangePasswordOpen}
              onClose={() => setIsChangePasswordOpen(false)}
              userEmail={user?.email}
              userRole={user?.role}
            />
          )}
        </>
      )}
    </div>
  );
}

const LandingPage = React.lazy(() => import('./components/marketing/LandingPage'));
const ContactPage = React.lazy(() => import('./components/marketing/ContactPage'));
const ProductPage = React.lazy(() => import('./components/marketing/ProductPage'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const timer = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/demo" element={<ContactPage />} />
        <Route path="/platform" element={<ProductPage kind="platform" />} />
        <Route path="/solutions" element={<ProductPage kind="solutions" />} />
        <Route path="/how-it-works" element={<ProductPage kind="how-it-works" />} />
        <Route path="/security" element={<ProductPage kind="security" />} />
        <Route path="/login" element={<AuthenticatedApp />} />
        <Route path="/app" element={<AuthenticatedApp />} />
        <Route path="/enroll" element={<StudentEnrollmentPage />} />
        <Route path="/enrollment" element={<StudentEnrollmentPage />} />
        <Route path="/admission" element={<StudentEnrollmentPage />} />
        <Route path="/admissions" element={<StudentEnrollmentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  );
}
