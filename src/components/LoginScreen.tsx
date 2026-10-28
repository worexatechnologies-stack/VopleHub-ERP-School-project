import React, { useState, useEffect } from 'react';
import {
  ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff,
  GraduationCap, LayoutDashboard, LockKeyhole, Mail,
  MessageSquare, ShieldCheck, BarChart3, CalendarCheck,
  School, Users, Bell, TrendingUp,
  Clock, Activity, AlertCircle, RefreshCw, ArrowLeft, Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { AuthUser } from '../utils/auth';
import { BrandSettings, UserRole } from '../types';
import { useLoginMutation, useVerifyOtpMutation, useResendOtpMutation, useGetCsrfTokenQuery } from '../store/api/authApi';
import { persistAuthSession } from '../store/api/baseApi';
import HumanVerification from './auth/HumanVerification';
import WorexaLogo from './WorexaLogo';
import volpeLogo from '../assets/volpe-logo.png';
import './LoginScreen.css';

interface LoginScreenProps {
  onLogin: (user: AuthUser, token: string) => void;
  brandSettings?: BrandSettings;
  portalRole?: 'Super Admin' | 'School Admin';
  onPublicAccess?: () => void;
}

type PortalRole = 'Super Admin' | 'School Admin' | 'Teacher' | 'Parent' | 'Student';

const generalLoginRoles: PortalRole[] = ['Teacher', 'Parent', 'Student'];

const roleNames: Record<string, string> = {
  'Super Admin': 'Super Admin',
  'School Admin': 'School Admin',
  Teacher: 'Teacher',
  Parent: 'Parent',
  Student: 'Student',
};

const shortRoleNames: Record<string, string> = {
  'Super Admin': 'Super',
  'School Admin': 'Admin',
  Teacher: 'Teacher',
  Parent: 'Parent',
  Student: 'Student',
};

const roleIcons: Record<string, React.ReactNode> = {
  'Super Admin':  <LayoutDashboard size={13} />,
  'School Admin': <Users size={13} />,
  Teacher:        <GraduationCap size={13} />,
  Parent:         <Users size={13} />,
  Student:        <BookOpen size={13} />,
};

const roleToKey: Record<string, string> = {
  'Super Admin': 'super_admin', super_admin: 'super_admin',
  'School Admin': 'school_admin', school_admin: 'school_admin',
  Teacher: 'teacher', teacher: 'teacher',
  Parent: 'parent', parent: 'parent',
  Student: 'student', student: 'student',
  PUBLIC_LEARNER: 'public_learner', public_learner: 'public_learner',
};

const roleDisplay: Record<string, string> = {
  super_admin: 'Super Admin', school_admin: 'School Admin',
  teacher: 'Teacher', parent: 'Parent', student: 'Student', public_learner: 'Public Learner',
};


// Rich role-driven mockup configurations for the interactive right showcase
const ROLE_PREVIEWS: Record<PortalRole, {
  title: string;
  subtitle: string;
  adminName: string;
  adminRole: string;
  stats: Array<{
    label: string;
    value: string;
    trend?: string;
    trendType?: 'positive' | 'negative' | 'neutral';
    color: 'blue' | 'green' | 'red' | 'purple' | 'amber';
    icon: React.ReactNode;
  }>;
  donut: {
    title: string;
    centerVal: string;
    centerSub: string;
    percent: number;
    color: string;
    items: Array<{ label: string; val: string; dot: string }>;
  };
  schedule: {
    title: string;
    items: Array<{ time: string; title: string; subtitle: string; tag?: string }>;
  };
  chart: {
    title: string;
    amount: string;
    sub: string;
    trend: string;
    bars: Array<{ day: string; height: number; value: string }>;
  };
  floatingBadge: {
    text: string;
    time: string;
  };
}> = {
  'School Admin': {
    title: 'Dashboard',
    subtitle: "Here's what's happening at your school today.",
    adminName: 'Admin',
    adminRole: 'School Administrator',
    stats: [
      { label: 'Total Students', value: '1,248', trend: '+29%', trendType: 'positive', color: 'blue', icon: <Users size={12} /> },
      { label: 'Present Today', value: '1,176', trend: '94.2%', trendType: 'positive', color: 'green', icon: <CheckCircle2 size={12} /> },
      { label: 'Absent Today', value: '72', trend: '5.8%', trendType: 'negative', color: 'red', icon: <Bell size={12} /> },
      { label: 'Total Classes', value: '48', trend: '+3 new', trendType: 'neutral', color: 'purple', icon: <School size={12} /> },
    ],
    donut: {
      title: 'Attendance Overview',
      centerVal: '94.2%',
      centerSub: 'Present',
      percent: 94.2,
      color: '#6366f1',
      items: [
        { dot: '#6366f1', label: 'Present', val: '1,176' },
        { dot: '#10b981', label: 'Absent', val: '70' },
        { dot: '#f59e0b', label: 'Late', val: '24' },
        { dot: '#94a3b8', label: 'On Leave', val: '12' },
      ],
    },
    schedule: {
      title: "Today's Timetable",
      items: [
        { time: '09:00 - 09:45', title: 'Mathematics', subtitle: 'Class 8A', tag: 'Class 8A' },
        { time: '09:50 - 10:35', title: 'English', subtitle: 'Class 7B', tag: 'Class 7B' },
        { time: '10:40 - 11:25', title: 'Science', subtitle: 'Class 9A', tag: 'Class 9A' },
        { time: '11:30 - 12:15', title: 'Social Studies', subtitle: 'Class 8B', tag: 'Class 8B' },
        { time: '12:20 - 13:05', title: 'Computer Lab', subtitle: 'Lab 1', tag: 'Lab 1' },
      ],
    },
    chart: {
      title: 'Fee Collection',
      amount: '₹ 4,82,500',
      sub: 'Collected this month',
      trend: '+15%',
      bars: [
        { day: 'Mon', height: 55, value: '₹ 55k' },
        { day: 'Tue', height: 72, value: '₹ 72k' },
        { day: 'Wed', height: 48, value: '₹ 48k' },
        { day: 'Thu', height: 80, value: '₹ 80k' },
        { day: 'Fri', height: 65, value: '₹ 65k' },
        { day: 'Sat', height: 90, value: '₹ 90k' },
        { day: 'Sun', height: 75, value: '₹ 75k' },
      ],
    },
    floatingBadge: {
      text: 'Grade 10 Attendance Synced',
      time: 'Just now',
    },
  },
  'Teacher': {
    title: 'Faculty Workspace',
    subtitle: 'Welcome back, Mrs. Priya Sharma • Mathematics',
    adminName: 'Priya S.',
    adminRole: 'Senior Math Faculty',
    stats: [
      { label: 'Assigned Classes', value: '6 Classes', trend: 'Active', trendType: 'neutral', color: 'blue', icon: <School size={12} /> },
      { label: 'Total Students', value: '184', trend: '100% Rostered', trendType: 'positive', color: 'green', icon: <Users size={12} /> },
      { label: 'Pending Papers', value: '28', trend: 'Review due', trendType: 'negative', color: 'red', icon: <Clock size={12} /> },
      { label: 'Avg Attendance', value: '96.8%', trend: '+2.1%', trendType: 'positive', color: 'purple', icon: <TrendingUp size={12} /> },
    ],
    donut: {
      title: 'Class 8A Turnout',
      centerVal: '96.8%',
      centerSub: 'Turnout',
      percent: 96.8,
      color: '#10b981',
      items: [
        { dot: '#10b981', label: 'Present', val: '42' },
        { dot: '#ef4444', label: 'Absent', val: '2' },
        { dot: '#f59e0b', label: 'Late', val: '1' },
        { dot: '#94a3b8', label: 'Leave', val: '0' },
      ],
    },
    schedule: {
      title: "Today's Lectures",
      items: [
        { time: '09:00 - 09:45', title: 'Algebra Fundamentals', subtitle: 'Class 8A • Rm 204', tag: 'Class 8A' },
        { time: '10:40 - 11:25', title: 'Trigonometry & Theorems', subtitle: 'Class 9A • Rm 302', tag: 'Class 9A' },
        { time: '11:30 - 12:15', title: 'Remedial Problem Solving', subtitle: 'Class 8B • Rm 205', tag: 'Class 8B' },
        { time: '13:15 - 14:00', title: 'Geometry Proofs & Quiz', subtitle: 'Class 10A • Rm 401', tag: 'Class 10A' },
      ],
    },
    chart: {
      title: 'Homework Submissions',
      amount: '94.6%',
      sub: 'Submission rate this week',
      trend: '+8%',
      bars: [
        { day: 'Mon', height: 85, value: '85%' },
        { day: 'Tue', height: 92, value: '92%' },
        { day: 'Wed', height: 78, value: '78%' },
        { day: 'Thu', height: 96, value: '96%' },
        { day: 'Fri', height: 88, value: '88%' },
        { day: 'Sat', height: 70, value: '70%' },
        { day: 'Sun', height: 95, value: '95%' },
      ],
    },
    floatingBadge: {
      text: 'Aarav Patel submitted Math Assignment',
      time: '2m ago',
    },
  },
  'Student': {
    title: 'Student Portal',
    subtitle: 'Welcome back, Rohan Verma • Grade 10-A',
    adminName: 'Rohan V.',
    adminRole: 'Grade 10 • Roll #14',
    stats: [
      { label: 'Cumulative GPA', value: '3.92', trend: 'Grade A+', trendType: 'positive', color: 'blue', icon: <GraduationCap size={12} /> },
      { label: 'Attendance', value: '97.4%', trend: 'Top Tier', trendType: 'positive', color: 'green', icon: <CheckCircle2 size={12} /> },
      { label: 'Due Tomorrow', value: '2 Tasks', trend: 'Physics & Lit', trendType: 'negative', color: 'red', icon: <Clock size={12} /> },
      { label: 'Class Rank', value: '#3', trend: 'Top 5%', trendType: 'positive', color: 'purple', icon: <TrendingUp size={12} /> },
    ],
    donut: {
      title: 'Course Completion',
      centerVal: '88.5%',
      centerSub: 'Syllabus',
      percent: 88.5,
      color: '#3b82f6',
      items: [
        { dot: '#3b82f6', label: 'Completed', val: '18 Units' },
        { dot: '#8b5cf6', label: 'In Progress', val: '3 Units' },
        { dot: '#f59e0b', label: 'Upcoming', val: '2 Units' },
        { dot: '#10b981', label: 'Revision', val: 'Passed' },
      ],
    },
    schedule: {
      title: "Today's Schedule",
      items: [
        { time: '09:00 - 09:45', title: 'Advanced Physics Lab', subtitle: 'Lab B • Prof. Sen', tag: 'Lab B' },
        { time: '10:00 - 10:45', title: 'Organic Chemistry', subtitle: 'Rm 102 • Dr. Rao', tag: 'Rm 102' },
        { time: '11:15 - 12:00', title: 'English Literature', subtitle: 'Rm 201 • Mrs. Paul', tag: 'Rm 201' },
        { time: '12:30 - 13:15', title: 'Computer Science & AI', subtitle: 'Tech Lab 1', tag: 'Lab 1' },
      ],
    },
    chart: {
      title: 'Weekly Study Hours',
      amount: '34.5 hrs',
      sub: 'Focused study time logged',
      trend: '+4.2h',
      bars: [
        { day: 'Mon', height: 60, value: '4.5h' },
        { day: 'Tue', height: 80, value: '5.8h' },
        { day: 'Wed', height: 75, value: '5.2h' },
        { day: 'Thu', height: 95, value: '6.5h' },
        { day: 'Fri', height: 85, value: '6.0h' },
        { day: 'Sat', height: 100, value: '7.2h' },
        { day: 'Sun', height: 65, value: '4.8h' },
      ],
    },
    floatingBadge: {
      text: 'Physics Quiz Score: 24/25 (96%)',
      time: '5m ago',
    },
  },
  'Parent': {
    title: 'Parent Gateway',
    subtitle: "Tracking Aryan & Ananya • St. Xavier's Campus",
    adminName: 'S. Verma',
    adminRole: 'Guardian Account',
    stats: [
      { label: 'Enrolled Kids', value: '2 Students', trend: 'Class 8A & 5B', trendType: 'neutral', color: 'blue', icon: <Users size={12} /> },
      { label: 'Term Fee Status', value: '₹ 0 Due', trend: 'All Cleared', trendType: 'positive', color: 'green', icon: <CheckCircle2 size={12} /> },
      { label: 'Attendance Avg', value: '96.5%', trend: 'Both Wards', trendType: 'positive', color: 'purple', icon: <Activity size={12} /> },
      { label: 'Next PTM', value: 'Oct 14', trend: 'Confirmed', trendType: 'neutral', color: 'amber', icon: <CalendarCheck size={12} /> },
    ],
    donut: {
      title: 'Term Attendance',
      centerVal: '96.5%',
      centerSub: 'Present',
      percent: 96.5,
      color: '#f59e0b',
      items: [
        { dot: '#10b981', label: 'Present', val: '78 Days' },
        { dot: '#ef4444', label: 'Absent', val: '2 Days' },
        { dot: '#f59e0b', label: 'Late', val: '1 Day' },
        { dot: '#6366f1', label: 'Permitted', val: '1 Day' },
      ],
    },
    schedule: {
      title: 'Transit & Activity Diary',
      items: [
        { time: '08:15 AM', title: 'School Bus #12 Arrival', subtitle: 'Safely arrived at campus', tag: 'Verified' },
        { time: '11:30 AM', title: 'Aryan: Science Exhibition', subtitle: 'Presenting Solar Model', tag: 'Class 8A' },
        { time: '01:00 PM', title: 'Ananya: Healthy Meal Check', subtitle: 'Cafeteria verified meal', tag: 'Class 5B' },
        { time: '03:45 PM', title: 'Departure Bus Route #12', subtitle: 'Scheduled drop: 04:15 PM', tag: 'Live GPS' },
      ],
    },
    chart: {
      title: 'Tuition & Activities',
      amount: '₹ 84,000',
      sub: 'Annual dues fully settled',
      trend: 'Clear',
      bars: [
        { day: 'Term 1', height: 100, value: 'Paid' },
        { day: 'Term 2', height: 100, value: 'Paid' },
        { day: 'Sports', height: 100, value: 'Paid' },
        { day: 'Lab', height: 100, value: 'Paid' },
        { day: 'Library', height: 100, value: 'Paid' },
        { day: 'Bus', height: 100, value: 'Paid' },
        { day: 'Exam', height: 100, value: 'Paid' },
      ],
    },
    floatingBadge: {
      text: 'Bus #12 crossed West Gate (Live GPS)',
      time: '1m ago',
    },
  },
  'Super Admin': {
    title: 'Platform Control Center',
    subtitle: 'Multi-Campus Cloud Infrastructure & Global Ops',
    adminName: 'Platform Ops',
    adminRole: 'Super Admin Engineering',
    stats: [
      { label: 'Partner Schools', value: '42 Campuses', trend: '+4 this qtr', trendType: 'positive', color: 'blue', icon: <School size={12} /> },
      { label: 'Active Learners', value: '68,400+', trend: '+18% MoM', trendType: 'positive', color: 'green', icon: <Users size={12} /> },
      { label: 'Cluster Uptime', value: '99.99%', trend: 'Optimal', trendType: 'positive', color: 'purple', icon: <ShieldCheck size={12} /> },
      { label: 'Monthly Run Rate', value: '₹ 38.5L', trend: '+22.4%', trendType: 'positive', color: 'amber', icon: <TrendingUp size={12} /> },
    ],
    donut: {
      title: 'Cluster Health',
      centerVal: '99.98%',
      centerSub: 'Online',
      percent: 99.98,
      color: '#8b5cf6',
      items: [
        { dot: '#10b981', label: 'Operational', val: '42 Nodes' },
        { dot: '#6366f1', label: 'Replicas', val: '84 Sync' },
        { dot: '#f59e0b', label: 'Standby', val: '2 Warm' },
        { dot: '#06b6d4', label: 'Backup', val: 'Ready' },
      ],
    },
    schedule: {
      title: 'Automated Operations',
      items: [
        { time: '09:00:00 UTC', title: 'PostgreSQL Auto-Vacuum & Snapshot', subtitle: 'Completed in 14.2s', tag: 'Success' },
        { time: '10:30:00 UTC', title: 'DPS Campus Database Migration', subtitle: '1,420 student records synced', tag: 'Success' },
        { time: '12:00:00 UTC', title: 'Payment Gateway Settlement Cycle', subtitle: '₹ 12.8L routed to escrow', tag: 'Success' },
        { time: '14:00:00 UTC', title: 'Global SSL & DNS Health Checks', subtitle: 'Latency average: 14ms', tag: 'Healthy' },
      ],
    },
    chart: {
      title: 'API Throughput',
      amount: '9.4M reqs',
      sub: 'Processed in past 24 hours',
      trend: '+12%',
      bars: [
        { day: '00h', height: 45, value: '450k' },
        { day: '04h', height: 35, value: '350k' },
        { day: '08h', height: 95, value: '1.2M' },
        { day: '12h', height: 88, value: '1.1M' },
        { day: '16h', height: 92, value: '1.15M' },
        { day: '20h', height: 75, value: '920k' },
        { day: 'Now', height: 85, value: '1.05M' },
      ],
    },
    floatingBadge: {
      text: 'All 42 school clusters healthy (14ms)',
      time: 'Realtime',
    },
  },
};

const searchPlaceholders = [
  'Search students, teachers, classes…',
  'Find fee receipts & invoices…',
  'Check attendance registers…',
  'Explore Class 10 exam schedules…',
];

export default function LoginScreen({ onLogin, brandSettings, portalRole, onPublicAccess }: LoginScreenProps) {
  // Bootstrap CSRF before login and clear any auth cookies left by the older
  // browser-JWT flow. Browser authentication now uses only Django sessionid.
  useGetCsrfTokenQuery();
  const [activeRole, setActiveRole] = useState<PortalRole>(portalRole || 'Teacher');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [suggestedRole, setSuggestedRole] = useState<PortalRole | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // 3D Parallax tilt state for showcase card
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Rotating search query placeholder
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const [loginMutation, { isLoading }] = useLoginMutation();
  const [verifyOtpMutation, { isLoading: isVerifying }] = useVerifyOtpMutation();
  const [resendOtpMutation, { isLoading: isResending }] = useResendOtpMutation();

  // Multi-Factor Authentication (OTP) State
  interface MfaSessionState {
    mfaToken: string;
    email: string;
    maskedEmail?: string;
    maskedPhone?: string;
    devOtp?: string;
    role?: string;
  }

  const [mfaSession, setMfaSession] = useState<MfaSessionState | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const otpInputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  const schoolName = brandSettings?.schoolName || 'Volpehub Education';

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Focus first OTP input when MFA challenge begins
  useEffect(() => {
    if (mfaSession) {
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 100);
    }
  }, [mfaSession]);

  const handleOtpDigitChange = (index: number, val: string) => {
    const char = val.slice(-1);
    if (char && !/^\d$/.test(char)) return;

    const nextDigits = [...otpDigits];
    nextDigits[index] = char;
    setOtpDigits(nextDigits);
    setErrorMessage('');

    if (char && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      const fullCode = otpDigits.join('');
      if (fullCode.length === 6) {
        handleVerifyOtp();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    const digits = pasted.replace(/\D/g, '').slice(0, 6).split('');
    if (digits.length > 0) {
      const nextDigits = ['', '', '', '', '', ''];
      digits.forEach((d, i) => {
        nextDigits[i] = d;
      });
      setOtpDigits(nextDigits);
      const focusIndex = Math.min(digits.length, 5);
      otpInputRefs.current[focusIndex]?.focus();
    }
  };

  const handleFillDevOtp = () => {
    const code = mfaSession?.devOtp;
    if (!code) return;
    const chars = code.split('').slice(0, 6);
    const nextDigits = ['', '', '', '', '', ''];
    chars.forEach((c, i) => {
      nextDigits[i] = c;
    });
    setOtpDigits(nextDigits);
    setErrorMessage('');
    otpInputRefs.current[5]?.focus();
  };

  const handleCancelMfa = () => {
    setMfaSession(null);
    setOtpDigits(['', '', '', '', '', '']);
    setErrorMessage('');
  };

  const handleVerifyOtp = async () => {
    if (!mfaSession) return;
    const fullOtp = otpDigits.join('');
    if (fullOtp.length < 6) {
      setErrorMessage('Please enter all 6 digits of the verification code.');
      return;
    }
    setErrorMessage('');
    try {
      const session = await verifyOtpMutation({
        mfa_token: mfaSession.mfaToken,
        otp: fullOtp,
      }).unwrap();

      if (!session.user) {
        throw new Error('Verification failed. Invalid session returned.');
      }

      const returnedRole = session.user.role;
      const normalizedReturned = roleToKey[returnedRole] || returnedRole;
      const displayRole = roleDisplay[normalizedReturned] || returnedRole;

      const canonicalRequestedRole = roleToKey[activeRole] || activeRole;
      if (normalizedReturned !== canonicalRequestedRole) {
        setErrorMessage(portalRole
          ? `These credentials belong to a ${displayRole} account. Please use the ${displayRole} login.`
          : `These credentials belong to a ${displayRole} account. Please select the ${displayRole} portal tab to sign in.`);
        return;
      }

      persistAuthSession(session.access || '', session.user, session.refresh, session.sessionId || session.session_id);
      onLogin(session.user, session.access || '');
    } catch (error: any) {
      let msg = 'Invalid or expired verification code. Please try again.';
      if (error?.data?.detail) {
        msg = error.data.detail;
      } else if (error?.data?.message) {
        msg = error.data.message;
      } else if (typeof error?.error === 'string') {
        msg = error.error;
      }
      setErrorMessage(msg);
    }
  };

  const handleResendOtp = async () => {
    if (!mfaSession || resendCooldown > 0) return;
    setErrorMessage('');
    try {
      const res = await resendOtpMutation({ mfa_token: mfaSession.mfaToken }).unwrap();
      setResendCooldown(30);
      if (res.dev_otp) {
        setMfaSession((prev) => (prev ? { ...prev, devOtp: res.dev_otp } : null));
      }
    } catch (error: any) {
      let msg = 'Failed to resend verification code. Please wait before retrying.';
      if (error?.data?.detail) {
        msg = error.data.detail;
      }
      if (error?.data?.cooldown) {
        setResendCooldown(error.data.cooldown);
      }
      setErrorMessage(msg);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % searchPlaceholders.length);
    }, 3400);
    return () => clearInterval(timer);
  }, []);

  const changeRole = (role: PortalRole) => {
    setActiveRole(role);
    setErrorMessage('');
    setSuggestedRole(null);
    setEmail('');
    setPassword('');
    setHumanToken(null);
    setHasAttemptedSubmit(false);
    setMfaSession(null);
    setOtpDigits(['', '', '', '', '', '']);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    setCapsLockActive(e.getModifierState('CapsLock'));
  };

  const handleMouseMoveRight = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: Number((x * 7).toFixed(2)), y: Number((y * -7).toFixed(2)) });
  };

  const handleMouseLeaveRight = () => {
    setTilt({ x: 0, y: 0 });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }
    if (!humanToken) {
      setHasAttemptedSubmit(true);
      setErrorMessage('Please complete human verification to sign in.');
      return;
    }
    setErrorMessage('');
    try {
      const canonicalRequestedRole = roleToKey[activeRole] || activeRole;
      const session = await loginMutation({
        email: email.trim().toLowerCase(),
        password,
        role: canonicalRequestedRole,
        human_verification_token: humanToken,
      }).unwrap();

      // Multi-Factor Authentication Challenge: Non-Superadmin roles enter OTP verification
      if (session.mfa_required && session.mfa_token) {
        setMfaSession({
          mfaToken: session.mfa_token,
          email: session.email || email,
          maskedEmail: session.masked_email,
          maskedPhone: session.masked_phone,
          devOtp: session.dev_otp,
          role: session.role || canonicalRequestedRole,
        });
        setOtpDigits(['', '', '', '', '', '']);
        setResendCooldown(30);
        setPassword('');
        return;
      }

      if (!session.user) {
        throw new Error('Authentication failed. No valid user session returned.');
      }

      const returnedRole = session.user.role;
      const normalizedReturned = roleToKey[returnedRole] || returnedRole;
      const displayRole = roleDisplay[normalizedReturned] || returnedRole;

      // Strict Portal Tab Isolation: Students only in Student portal, Teachers in Teacher portal, Parents in Parent portal, Admins in Admin portal
      if (normalizedReturned !== canonicalRequestedRole) {
        setErrorMessage(portalRole
          ? `These credentials belong to a ${displayRole} account. Please use the ${displayRole} login.`
          : `These credentials belong to a ${displayRole} account. Please select the ${displayRole} portal tab to sign in.`);
        if (!portalRole && displayRole in roleNames) {
          setSuggestedRole(displayRole as PortalRole);
        }
        return;
      }

      persistAuthSession(session.access || '', session.user, session.refresh, session.sessionId || session.session_id);
      onLogin(session.user, session.access || '');
    } catch (error: any) {
      let msg = 'Unable to sign in. Please verify your credentials and selected role.';
      if (error?.status === 'FETCH_ERROR' || error?.error?.toLowerCase?.().includes('fetch')) {
        msg = 'We could not connect right now. Please try again in a moment.';
      } else if (error?.data?.detail) {
        msg = error.data.detail;
        if (!portalRole && error?.data?.user_role) {
          const uRole = error.data.user_role;
          const dRole = roleDisplay[uRole];
          if (dRole && dRole in roleNames) {
            setSuggestedRole(dRole as PortalRole);
          }
        }
      } else if (error?.data?.message) {
        msg = error.data.message;
      } else if (typeof error?.error === 'string') {
        msg = error.error;
      } else if (typeof error?.status === 'number' && error.status >= 500) {
        msg = 'Something went wrong on our side. Please try again or contact support.';
      } else if (error instanceof Error) {
        msg = error.message;
      }
      setErrorMessage(msg);
    }
  };

  const currentPreview = ROLE_PREVIEWS[activeRole] || ROLE_PREVIEWS['School Admin'];

  return (
    <main className="ls-root" id="login-container">
      {/* ─── AMBIENT AURORA ORBS ─── */}
      <div className="ls-ambient-orb orb-1" aria-hidden="true" />
      <div className="ls-ambient-orb orb-2" aria-hidden="true" />
      <div className="ls-ambient-orb orb-3" aria-hidden="true" />

      <div className="ls-canvas">
        <Link to="/" className="ls-back-home" aria-label="Back to home">
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back</span>
        </Link>

        {/* ═══════════ LEFT PANEL: AUTH PORTAL ═══════════ */}
        <div className="ls-left">

          {/* Header */}
          <header className="ls-header">
            <div className="ls-logo-wrap group">
              <img
                src={brandSettings?.logoType === 'image' && brandSettings.logoImageUrl
                  ? brandSettings.logoImageUrl : volpeLogo}
                alt="Volpehub logo"
                className="ls-logo-img"
              />
            </div>
            <div className="ls-header-text">
              <strong>{schoolName}</strong>
              <span>School Management Portal</span>
            </div>
            <div className="ls-secure-badge" title="End-to-end 256-bit TLS encryption active">
              <span className="ls-radar-indicator">
                <span className="ls-radar-ping" />
                <span className="ls-radar-core" />
              </span>
              <div className="ls-secure-badge-text">
                <div className="ls-secure-title">Secure Access</div>
                <div className="ls-secure-sub">256-bit Encrypted</div>
              </div>
              <span className="ls-secure-badge-compact">256-bit Secure</span>
            </div>
          </header>

          {/* Intro */}
          <div className="ls-intro">
            <h1 className="ls-headline">
              Welcome back<br />
              <span className="ls-headline-accent">to {schoolName}</span>
            </h1>
            <p className="ls-subline">Sign in to continue to your connected school workspace.</p>
          </div>

          {mfaSession ? (
            /* ═══════════ MULTI-FACTOR AUTHENTICATION (OTP) STEP ═══════════ */
            <motion.div
              key="mfa-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="ls-form"
            >
              <button
                type="button"
                onClick={handleCancelMfa}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-1 cursor-pointer self-start"
              >
                <ArrowLeft size={14} />
                <span>Return to password login</span>
              </button>

              <div className="flex items-center justify-between gap-2 mt-1 mb-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-700 border border-amber-500/20">
                  <ShieldCheck size={14} className="text-amber-600" />
                  Two-Factor Authentication
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {roleNames[activeRole]}
                </span>
              </div>

              <div className="text-left mb-2">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Enter 6-Digit OTP
                </h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Verification code sent to{' '}
                  <strong className="text-slate-800 font-semibold">{mfaSession.maskedEmail || mfaSession.email}</strong>
                  {mfaSession.maskedPhone && (
                    <> & phone <strong className="text-slate-800 font-semibold">{mfaSession.maskedPhone}</strong></>
                  )}.
                </p>
              </div>

              {/* Developer Mode OTP Helper Banner (only returned by DEBUG servers) */}
              {mfaSession.devOtp && <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 mb-2 flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                    <Key size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-indigo-950 truncate">
                      Developer OTP Mode
                    </div>
                    <div className="text-[10px] text-indigo-700 font-mono">
                      Current Code: <strong>{mfaSession.devOtp}</strong>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFillDevOtp}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer shrink-0"
                >
                  Fill {mfaSession.devOtp}
                </button>
              </div>}

              <AnimatePresence mode="wait">
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="ls-error flex items-center gap-1.5"
                    role="alert"
                  >
                    <AlertCircle size={15} className="shrink-0" />
                    <span>{errorMessage}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 6 Digit Input Boxes */}
              <div className="flex items-center justify-between gap-2 my-2">
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { otpInputRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={idx === 0 ? handleOtpPaste : undefined}
                    aria-label={`Digit ${idx + 1}`}
                    className="w-12 h-14 text-center text-xl font-bold font-mono rounded-xl border border-slate-300 bg-white text-slate-900 shadow-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                  />
                ))}
              </div>

              {/* Submit & Resend Controls */}
              <motion.button
                whileTap={{ scale: 0.985 }}
                className="ls-submit-btn group w-full"
                type="button"
                onClick={handleVerifyOtp}
                disabled={isVerifying || otpDigits.join('').length < 6}
              >
                {isVerifying ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Verifying Code…</span>
                  </>
                ) : (
                  <>
                    <span>Verify & Continue</span>
                    <ArrowRight size={16} className="ls-btn-arrow" />
                  </>
                )}
              </motion.button>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-500">Didn't receive the code?</span>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || isResending}
                  className="font-semibold text-indigo-600 hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer"
                >
                  {resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : isResending
                    ? 'Dispatching…'
                    : 'Resend Code'}
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Role selector tabs with sliding spring indicator */}
              {!portalRole ? <div className="ls-roles" role="tablist" aria-label="Choose your access portal">
                {generalLoginRoles.map((role) => {
                  const isActive = activeRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => changeRole(role)}
                      className={`ls-role-tab ${isActive ? 'is-active' : ''}`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeRoleIndicator"
                          className="ls-role-active-indicator"
                          transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                        />
                      )}
                      <span className="ls-role-tab-content">
                        {roleIcons[role]}
                        <span className="ls-role-label-full">{roleNames[role]}</span>
                        <span className="ls-role-label-short">{shortRoleNames[role]}</span>
                      </span>
                    </button>
                  );
                })}
              </div> : (
                <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-sm font-semibold text-indigo-800" aria-live="polite">
                  {portalRole === 'Super Admin' ? 'Platform Administration' : 'School Administration'}
                </div>
              )}

              {/* Form */}
              <form onSubmit={submit} onKeyDown={handleKeyDown} onKeyUp={handleKeyDown} className="ls-form" id="manual-login-form">
                <AnimatePresence mode="wait">
                  {errorMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="ls-error flex flex-col gap-1.5"
                      role="alert"
                    >
                      <div className="flex items-center gap-1.5">
                        <AlertCircle size={15} className="shrink-0" />
                        <span>{errorMessage}</span>
                      </div>
                      {suggestedRole && suggestedRole !== 'School Admin' && suggestedRole !== 'Super Admin' && (
                        <button
                          type="button"
                          onClick={() => changeRole(suggestedRole)}
                          className="text-left text-xs font-bold underline hover:opacity-80 text-rose-800 cursor-pointer pt-0.5"
                        >
                          Click here to switch to the {suggestedRole} Portal tab →
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <label className="ls-field-label">
                  <span>Email address</span>
                  <span className="ls-field-wrap">
                    <Mail size={16} className="ls-field-icon" />
                    <input
                      id="login-input-email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@school.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="ls-field-input"
                    />
                  </span>
                </label>

                <label className="ls-field-label">
                  <span className="ls-password-label-row">
                    <span>Password</span>
                    {capsLockActive && (
                      <span className="ls-caps-warning">⇪ Caps Lock is ON</span>
                    )}
                  </span>
                  <span className="ls-field-wrap">
                    <LockKeyhole size={16} className="ls-field-icon" />
                    <input
                      id="login-input-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="ls-field-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="ls-eye-btn"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>

                {/* Remember Me and Forgot Password */}
                <div className="ls-form-meta">
                  <label className="ls-remember-wrap">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="ls-checkbox"
                    />
                    <span>Remember this device</span>
                  </label>
                  <button
                    type="button"
                    className="ls-forgot-btn"
                    onClick={() => setErrorMessage('Please contact your School Administrator to reset your password.')}
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Human Verification Challenge */}
                <HumanVerification
                  onVerify={(token) => {
                    setHumanToken(token);
                    setErrorMessage('');
                  }}
                  onReset={() => setHumanToken(null)}
                  hasAttemptedSubmit={hasAttemptedSubmit}
                />

                {/* Submit button */}
                <motion.button
                  whileTap={{ scale: 0.985 }}
                  className="ls-submit-btn group"
                  type="submit"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Authenticating…</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in to {roleNames[activeRole]} Portal</span>
                      <ArrowRight size={16} className="ls-btn-arrow" />
                    </>
                  )}
                </motion.button>
              </form>
            </>
          )}

          {portalRole && (
            <nav className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500" aria-label="Other sign-in portals">
              <Link to="/login" className="hover:text-indigo-700 hover:underline">Choose another portal</Link>
              <Link to="/admin" className="hover:text-indigo-700 hover:underline">School admin</Link>
              <Link to="/super-admin" className="hover:text-indigo-700 hover:underline">Super admin</Link>
            </nav>
          )}


          {/* Footer */}
          <footer className="ls-footer">
            <WorexaLogo compact />
            <span>Built by Worexa Technologies</span>
          </footer>
        </div>

        {/* ═══════════ RIGHT PANEL: SHOWCASE & 3D MOCKUP ═══════════ */}
        <div
          className="ls-right"
          onMouseMove={handleMouseMoveRight}
          onMouseLeave={handleMouseLeaveRight}
        >
          {/* Subtle dot-grid */}
          <div className="ls-right-dots" aria-hidden="true" />

          {/* Top copy */}
          <div className="ls-right-copy">
            <div className="ls-right-eyebrow">
              <span>SMART SCHOOL MANAGEMENT</span>
            </div>
            <h2 className="ls-right-headline">
              Smarter Tools for<br />
              <span className="ls-right-accent">Better Learning</span>
            </h2>
            <p className="ls-right-sub">
              Manage students, teachers, attendance, exams and communication — all in one place.
            </p>
          </div>

          {/* 3D Dashboard Preview Card */}
          <motion.div
            className="ls-dash-card"
            animate={{
              rotateY: tilt.x,
              rotateX: tilt.y,
            }}
            transition={{ type: 'spring', stiffness: 220, damping: 28 }}
          >
            {/* Dynamic Glass Specular Glare */}
            <div
              className="ls-dash-glare"
              style={{
                background: `radial-gradient(circle at ${50 + tilt.x * 6}% ${50 - tilt.y * 6}%, rgba(255,255,255,0.45) 0%, transparent 65%)`,
              }}
            />

            {/* Floating Live Badge */}
            <motion.div
              key={currentPreview.floatingBadge.text}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="ls-floating-badge top"
            >
              <span className="ls-badge-ping" />
              <span className="ls-badge-text">{currentPreview.floatingBadge.text}</span>
              <span className="ls-badge-time">• {currentPreview.floatingBadge.time}</span>
            </motion.div>

            {/* Dashboard topbar */}
            <div className="ls-dash-topbar">
              <div className="ls-dash-logo">
                <img src={volpeLogo} alt="" className="ls-dash-logo-img" />
                <span>Volpehub</span>
              </div>

              {/* Animated cycling search bar */}
              <div className="ls-dash-search">
                <span className="ls-search-icon">🔍</span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={placeholderIndex}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.25 }}
                    className="ls-search-text"
                  >
                    {searchPlaceholders[placeholderIndex]}
                  </motion.span>
                </AnimatePresence>
              </div>

              <div className="ls-dash-admin-pill">
                <Bell size={13} className="ls-bell-icon" />
                <div className="ls-dash-admin-avatar">
                  {currentPreview.adminName.charAt(0)}
                </div>
                <div className="ls-dash-admin-info">
                  <span>{currentPreview.adminName}</span>
                  <span>{currentPreview.adminRole}</span>
                </div>
              </div>
            </div>

            {/* Dash body */}
            <div className="ls-dash-body">
              {/* Sidebar */}
              <nav className="ls-dash-sidebar">
                {[
                  { icon: <LayoutDashboard size={12} />, label: 'Dashboard', active: true },
                  { icon: <Users size={12} />, label: 'Students' },
                  { icon: <GraduationCap size={12} />, label: 'Teachers' },
                  { icon: <CalendarCheck size={12} />, label: 'Attendance' },
                  { icon: <BookOpen size={12} />, label: 'Exams' },
                  { icon: <MessageSquare size={12} />, label: 'Messages' },
                  { icon: <BarChart3 size={12} />, label: 'Reports' },
                  { icon: <School size={12} />, label: 'Settings' },
                ].map(({ icon, label, active }) => (
                  <div key={label} className={`ls-dash-nav-item ${active ? 'active' : ''}`}>
                    {icon}
                    <span>{label}</span>
                  </div>
                ))}
              </nav>

              {/* Main content dynamically animated based on role */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeRole}
                  initial={{ opacity: 0, scale: 0.98, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="ls-dash-content"
                >
                  <div className="ls-dash-greeting">
                    <div className="ls-greeting-header">
                      <h3>{currentPreview.title}</h3>
                      <span className="ls-role-pill-badge">{roleNames[activeRole]} View</span>
                    </div>
                    <p>{currentPreview.subtitle}</p>
                  </div>

                  {/* 4 Stat Cards */}
                  <div className="ls-dash-stats">
                    {currentPreview.stats.map((stat, idx) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04 }}
                        className={`ls-dash-stat-card ${stat.color}`}
                      >
                        <div className="ls-dash-stat-top">
                          <span className="ls-dash-stat-label">{stat.label}</span>
                          <span className="ls-dash-stat-icon">{stat.icon}</span>
                        </div>
                        <div className="ls-dash-stat-value">{stat.value}</div>
                        {stat.trend && (
                          <div className={`ls-dash-stat-trend ${stat.trendType || ''}`}>
                            {stat.trend}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>

                  {/* Mid Row: Donut + Timetable + Chart */}
                  <div className="ls-dash-mid">

                    {/* Donut Chart Panel */}
                    <div className="ls-dash-panel ls-att-panel">
                      <div className="ls-panel-title">{currentPreview.donut.title}</div>
                      <div className="ls-att-content">
                        <svg viewBox="0 0 80 80" className="ls-donut">
                          <circle cx="40" cy="40" r="30" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                          <motion.circle
                            cx="40"
                            cy="40"
                            r="30"
                            fill="none"
                            stroke={currentPreview.donut.color}
                            strokeWidth="8"
                            strokeDasharray="188.5"
                            initial={{ strokeDashoffset: 188.5 }}
                            animate={{ strokeDashoffset: 188.5 - (188.5 * currentPreview.donut.percent) / 100 }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            strokeLinecap="round"
                            transform="rotate(-90 40 40)"
                          />
                          <text x="40" y="38" textAnchor="middle" fontSize="10" fontWeight="900" fill="#0f172a">
                            {currentPreview.donut.centerVal}
                          </text>
                          <text x="40" y="48" textAnchor="middle" fontSize="5.5" fill="#64748b" fontWeight="700">
                            {currentPreview.donut.centerSub}
                          </text>
                        </svg>
                        <div className="ls-att-legend">
                          {currentPreview.donut.items.map(({ dot, label, val }) => (
                            <div key={label} className="ls-att-legend-row">
                              <span className="ls-att-dot" style={{ background: dot }} />
                              <span>{label}</span>
                              <b>{val}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Timetable Schedule Panel */}
                    <div className="ls-dash-panel ls-timetable-panel">
                      <div className="ls-panel-title">
                        <span>{currentPreview.schedule.title}</span>
                        <span className="ls-view-all">Live</span>
                      </div>
                      {currentPreview.schedule.items.map((item) => (
                        <div key={item.time + item.title} className="ls-tt-row">
                          <span className="ls-tt-time">{item.time}</span>
                          <span className="ls-tt-subj">{item.title}</span>
                          {item.tag && <span className="ls-tt-cls">{item.tag}</span>}
                        </div>
                      ))}
                    </div>

                    {/* Fee / Activity Chart Panel */}
                    <div className="ls-dash-panel ls-fee-panel">
                      <div className="ls-panel-title">{currentPreview.chart.title}</div>
                      <div className="ls-fee-amount">{currentPreview.chart.amount}</div>
                      <div className="ls-fee-sub">
                        {currentPreview.chart.sub}
                        <span className="ls-fee-trend">{currentPreview.chart.trend}</span>
                      </div>
                      <div className="ls-fee-bars">
                        {currentPreview.chart.bars.map((bar, i) => (
                          <div key={bar.day} className="ls-fee-bar-wrap group">
                            <div className="ls-bar-tooltip">
                              <span>{bar.day}</span>
                              <strong>{bar.value}</strong>
                            </div>
                            <motion.div
                              className="ls-fee-bar"
                              initial={{ height: 0 }}
                              animate={{ height: `${bar.height}%` }}
                              transition={{ delay: 0.08 + i * 0.04, duration: 0.5, ease: 'easeOut' }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="ls-fee-labels">
                        {currentPreview.chart.bars.map((b) => (
                          <span key={b.day}>{b.day}</span>
                        ))}
                      </div>
                    </div>

                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

        </div>

      </div>

    </main>
  );
}
