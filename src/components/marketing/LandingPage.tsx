import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ShieldCheck, CheckCircle2, Users,
  ArrowRight, UserCheck, School,
  GraduationCap, CalendarDays, Landmark, MessageSquare,
  Play, Bell, LayoutDashboard, CalendarCheck, BookOpen,
  BarChart3, UserPlus, Megaphone, Bus, Laptop, Check,
  ArrowUpRight, Navigation, Clock, Shield,
  Layers, CheckCircle, FileText, Search, CreditCard,
  Send, ChevronDown, Settings, Activity, Radio, Wifi
} from 'lucide-react';
import MarketingNavbar from './MarketingNavbar';
import MarketingFooter from './MarketingFooter';
import volpeLogo from '../../assets/volpe-logo.png';
import avatarTeacher from '../../assets/avatar-teacher.jpg';
import './LandingPage.css';

// ─── Constants & 14 Complete System Modules ─────────────────────────────────
const MODULES_14 = [
  {
    icon: LayoutDashboard,
    cls: 'indigo',
    badge: 'Operations',
    title: 'Admin Dashboard',
    desc: 'Get a clear overview of your institution’s activities, important updates, and daily operations from one central dashboard.'
  },
  {
    icon: GraduationCap,
    cls: 'emerald',
    badge: 'Academics',
    title: 'Academic Setup',
    desc: 'Organize academic years, classes, subjects, and other essential academic information in one place.'
  },
  {
    icon: UserPlus,
    cls: 'blue',
    badge: 'Enrollment',
    title: 'Online Admissions',
    desc: 'Simplify the admission process by managing applications and student enrollment digitally.'
  },
  {
    icon: Users,
    cls: 'purple',
    badge: 'Records',
    title: 'Student Directory',
    desc: 'Keep student profiles and records organized for easy access whenever needed.'
  },
  {
    icon: UserCheck,
    cls: 'amber',
    badge: 'Faculty',
    title: 'Teacher Profiles',
    desc: 'Manage teacher information, profiles, and relevant academic details in one place.'
  },
  {
    icon: ShieldCheck,
    cls: 'indigo',
    badge: 'Security',
    title: 'Password Management',
    desc: 'Manage account credentials and support secure access for authorized users.'
  },
  {
    icon: CalendarDays,
    cls: 'rose',
    badge: 'Schedules',
    title: 'Timetables and Schedules',
    desc: 'Create and manage class timetables to help teachers and students stay on track.'
  },
  {
    icon: BookOpen,
    cls: 'cyan',
    badge: 'Learning',
    title: 'Class Homework',
    desc: 'Share homework, organize assignments, and help students keep track of their learning tasks.'
  },
  {
    icon: CalendarCheck,
    cls: 'teal',
    badge: 'Daily Log',
    title: 'Roster and Attendance',
    desc: 'Maintain attendance records and manage student and staff attendance more efficiently.'
  },
  {
    icon: BarChart3,
    cls: 'purple',
    badge: 'Evaluation',
    title: 'Exam and Grading',
    desc: 'Organize examinations, record grades, and monitor student academic progress.'
  },
  {
    icon: Landmark,
    cls: 'emerald',
    badge: 'Finance',
    title: 'Staff Fees',
    desc: 'Manage staff-related fee or payment records according to your institution’s requirements.'
  },
  {
    icon: MessageSquare,
    cls: 'blue',
    badge: 'Messaging',
    title: 'Communication',
    desc: 'Keep administrators, teachers, students, and parents connected through organized communication.'
  },
  {
    icon: Megaphone,
    cls: 'amber',
    badge: 'Updates',
    title: 'Community and Events',
    desc: 'Coordinate institutional events, activities, and announcements to keep everyone informed.'
  },
  {
    icon: Bus,
    cls: 'rose',
    badge: 'Fleet GPS',
    title: 'Transport GPS Tracking',
    desc: 'Keep track of institutional transport with GPS-enabled vehicle tracking. Help administrators monitor vehicle locations, improve transport coordination, and provide parents with better visibility into student transportation.'
  }
];

// ─── 6 Core Pillars ──────────────────────────────────────────────────────────
const CORE_PILLARS = [
  {
    icon: GraduationCap,
    cls: 'indigo',
    tag: 'Curriculum & Setup',
    title: 'Academic Planning',
    desc: 'Establish class structures, subject allocations, and conflict-free timetables for seamless school term scheduling.',
    highlights: ['Multi-term academic year control', 'Subject and teacher mapping', 'Automated period timetable generator']
  },
  {
    icon: CalendarCheck,
    cls: 'emerald',
    tag: 'Daily Attendance',
    title: 'Attendance Management',
    desc: 'Fast, reliable morning roll-calls with instant absentee alerts dispatched directly to parents.',
    highlights: ['Single-tap roster submission', 'Real-time parent push notifications', 'Monthly compliance & audit registers']
  },
  {
    icon: BarChart3,
    cls: 'purple',
    tag: 'Evaluation & Records',
    title: 'Student Performance',
    desc: 'Monitor scholastic progress from continuous assessment marks to term examination gradebooks.',
    highlights: ['Fast subject marks entry', 'Automated grading & GPA calculation', 'Official printable progress cards']
  },
  {
    icon: MessageSquare,
    cls: 'blue',
    tag: 'Live Engagement',
    title: 'Communication',
    desc: 'Unify internal messaging between principals, teachers, parents, and administrative staff.',
    highlights: ['1-to-1 secure parent teacher chat', 'School-wide circulars & announcements', 'Instant broadcast message alerts']
  },
  {
    icon: Landmark,
    cls: 'amber',
    tag: 'Campus Finance & Ops',
    title: 'Institutional Operations',
    desc: 'Track fee invoices, record payroll disbursements, and monitor school transport fleets in real-time.',
    highlights: ['Quarterly fee collection tracking', 'Staff salary disbursement records', 'Live GPS school bus fleet tracking']
  },
  {
    icon: ShieldCheck,
    cls: 'cyan',
    tag: 'Care & Community',
    title: 'Student Support',
    desc: 'Centralized student dossiers, identity slips, and prompt support channels for every guardian.',
    highlights: ['Secure credential management', 'Institutional calendar & event planner', 'Prompt parent grievance resolution']
  }
];

// ─── 4 Dedicated Role Portals ───────────────────────────────────────────────
const PORTAL_SUITES = [
  {
    role: 'Leadership',
    title: 'School Admin Portal',
    cls: 'indigo',
    icon: LayoutDashboard,
    desc: 'Total command over student enrollments, fee cashflow, academic structures, and staff operations.',
    highlights: ['Complete school operations overview', 'Real-time attendance & fee analytics', 'Full staff & timetable governance'],
    linkText: 'Explore Admin Console'
  },
  {
    role: 'Educators',
    title: 'Teacher Portal',
    cls: 'emerald',
    icon: UserCheck,
    desc: 'Empower teachers with 1-click morning attendance, homework distribution, and direct parent messaging.',
    highlights: ['Fast period roll-call submission', 'Homework & assignments manager', 'Exam marksheets & progress logs'],
    linkText: 'Explore Teacher Suite'
  },
  {
    role: 'Guardians',
    title: 'Parent Portal',
    cls: 'amber',
    icon: Users,
    desc: 'Give parents peace of mind with live attendance notices, fee invoice records, and teacher chat.',
    highlights: ['Instant absence notifications', 'Fee status & downloadable receipts', 'Direct teacher communication'],
    linkText: 'Explore Parent App'
  },
  {
    role: 'Learners',
    title: 'Student Portal',
    cls: 'blue',
    icon: GraduationCap,
    desc: 'A personalized digital study companion with daily timetables, homework tasks, and exam cards.',
    highlights: ['Interactive timetable & classroom guide', 'Homework deadlines & reminders', 'Published exam results & cards'],
    linkText: 'Explore Student Portal'
  }
];

export default function LandingPage() {
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    document.body.style.overflow = videoModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [videoModalOpen]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  return (
    <div className="lp-root">

      {/* ─── TOAST NOTIFICATION ────────────────────────────────────────── */}
      {toastMessage && (
        <div className="lp-toast" role="status">
          <Check size={16} className="lp-toast-icon" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Primary Marketing Navbar (Preserved Exactly As Configured) */}
      <MarketingNavbar />

      {/* ═══════════════════════════════════════════════════════════════════
         HERO SECTION: MATCHING EXACT REFERENCE IMAGE
         "One platform to run your school with confidence."
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-hero-wrapper">

        {/* Ambient flowing pastel purple background curves matching exact reference image */}
        <div className="lp-ambient-layer" aria-hidden="true">
          <svg
            className="lp-hero-svg-canvas"
            viewBox="0 0 1440 820"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <linearGradient id="hero-wave-right" x1="680" y1="0" x2="1440" y2="820" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ede9fe" stopOpacity="0.88" />
                <stop offset="50%" stopColor="#f5f3ff" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#eef2ff" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="hero-wave-left" x1="0" y1="520" x2="480" y2="820" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ede9fe" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#f5f3ff" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* Right Organic Lavender Wave wrapping behind the dashboard mockup */}
            <path
              d="M640 0C610 80 575 160 595 240C625 360 760 380 770 500C780 620 690 710 610 820H1440V0H640Z"
              fill="url(#hero-wave-right)"
            />

            {/* Bottom-left pastel swell */}
            <path
              d="M0 820V590C85 570 170 615 250 675C320 725 380 765 450 765C490 765 520 785 550 820H0Z"
              fill="url(#hero-wave-left)"
            />
          </svg>

          {/* Tactile Blueprint Dot Matrix overlay for rich architectural depth */}
          <div className="lp-hero-dot-matrix" />
        </div>

        <div className="lp-hero-grid">

          {/* LEFT COLUMN: Main Value Proposition */}
          <div className="lp-hero-left">
            {/* Eyebrow Tag with live pulse */}
            <div className="lp-hero-tag">
              <span className="lp-hero-tag-pulse" />
              <span>SCHOOL MANAGEMENT, SIMPLIFIED</span>
              <span className="lp-hero-tag-badge">ERP 2.0</span>
            </div>

            {/* Headline */}
            <h1 className="lp-hero-headline">
              One platform to run<br />
              your school with<br />
              <span className="lp-highlight-purple">confidence.</span>
            </h1>

            {/* Description */}
            <p className="lp-hero-description">
              Manage academics, attendance, fees, communication, and reporting in one secure platform — so your institution runs smoothly and everyone stays connected.
            </p>

            {/* Action Buttons: "Book a live demo →" & "Explore the platform →" */}
            <div className="lp-hero-cta-group">
              <Link to="/contact" className="lp-btn-hero-primary">
                <span>Book a live demo</span>
                <ArrowRight size={17} />
              </Link>
              <Link to="/login" className="lp-btn-hero-secondary">
                <span>Explore the platform</span>
                <ArrowRight size={17} />
              </Link>
            </div>

            {/* 3 Feature Trust Badges */}
            <div className="lp-hero-trust-row">
              <div className="lp-trust-item">
                <div className="lp-trust-icon-box purple">
                  <Users size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">All stakeholders<br />in one place</span>
                  <span className="lp-trust-sub">Students, teachers,<br />parents and admin.</span>
                </div>
              </div>

              <div className="lp-trust-item">
                <div className="lp-trust-icon-box green">
                  <ShieldCheck size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">Secure &amp; reliable</span>
                  <span className="lp-trust-sub">Your data, our priority<br />with role-based access.</span>
                </div>
              </div>

              <div className="lp-trust-item">
                <div className="lp-trust-icon-box amber">
                  <Megaphone size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">Easy to use</span>
                  <span className="lp-trust-sub">Designed for modern<br />schools.</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Realistic Interactive Dashboard Mockup */}
          <div className="lp-hero-right-stage">

            {/* Floating Badge 1: Top Right */}
            <div className="lp-floating-badge lp-badge-top-right">
              <div className="lp-floating-icon purple">
                <GraduationCap size={20} />
              </div>
              <div className="lp-floating-text">
                <span className="lp-floating-sub">Built for</span>
                <span className="lp-floating-title">Smarter Schools</span>
              </div>
            </div>

            {/* The Dashboard Mockup Window */}
            <div className="lp-mockup-window">

              {/* Window Topbar */}
              <div className="lp-mockup-topbar">
                <div className="lp-mockup-dots">
                  <span className="lp-mockup-dot red" />
                  <span className="lp-mockup-dot yellow" />
                  <span className="lp-mockup-dot green" />
                </div>

                <div className="lp-mockup-search">
                  <Search size={12} />
                  <span>Search students, parents, classes...</span>
                </div>

                <div className="lp-mockup-controls">
                  <div className="lp-mockup-bell">
                    <Bell size={14} />
                    <span className="lp-mockup-bell-dot" />
                  </div>
                  <div className="lp-mockup-profile">
                    <img src={avatarTeacher} alt="Admin avatar" className="lp-mockup-avatar" />
                    <span>Admin</span>
                    <ChevronDown size={11} />
                  </div>
                </div>
              </div>

              {/* Window Body: Sidebar + Main Console */}
              <div className="lp-mockup-body">

                {/* Left Sidebar */}
                <div className="lp-mockup-sidebar">
                  <div className="lp-mockup-brand">
                    <img src={volpeLogo} alt="VolpeHub" className="lp-mockup-brand-img" />
                    <span className="lp-mockup-brand-text">VolpeHub</span>
                  </div>

                  <nav className="lp-mockup-nav">
                    <div className="lp-mockup-nav-item active">
                      <LayoutDashboard size={12} />
                      <span>Dashboard</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <Users size={12} />
                      <span>Students</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <UserCheck size={12} />
                      <span>Teachers</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <CalendarCheck size={12} />
                      <span>Attendance</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <GraduationCap size={12} />
                      <span>Academics</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <CreditCard size={12} />
                      <span>Fees</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <MessageSquare size={12} />
                      <span>Communication</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <FileText size={12} />
                      <span>Reports</span>
                    </div>
                    <div className="lp-mockup-nav-item">
                      <Settings size={12} />
                      <span>Settings</span>
                    </div>
                  </nav>
                </div>

                {/* Main Console Content */}
                <div className="lp-mockup-content">

                  {/* Greeting Header */}
                  <div className="lp-mockup-greeting-row">
                    <div>
                      <h3 className="lp-mockup-greeting-title">Good Morning, Admin!</h3>
                      <p className="lp-mockup-greeting-sub">Here&apos;s what&apos;s happening at your school today.</p>
                    </div>
                    <div className="lp-mockup-date-picker">
                      <CalendarDays size={12} />
                      <span>Mon, 12 Aug 2024</span>
                      <ChevronDown size={10} />
                    </div>
                  </div>

                  {/* 4 Metric Cards */}
                  <div className="lp-mockup-stats-grid">
                    <div className="lp-mockup-stat-card">
                      <div className="lp-mockup-stat-icon purple">
                        <Users size={14} />
                      </div>
                      <div className="lp-mockup-stat-value">2,648</div>
                      <div className="lp-mockup-stat-label">Students</div>
                      <div className="lp-mockup-stat-trend">↑ 12% <span>vs last month</span></div>
                    </div>

                    <div className="lp-mockup-stat-card">
                      <div className="lp-mockup-stat-icon green">
                        <CalendarCheck size={14} />
                      </div>
                      <div className="lp-mockup-stat-value">96%</div>
                      <div className="lp-mockup-stat-label">Attendance</div>
                      <div className="lp-mockup-stat-trend">↑ 3% <span>vs last month</span></div>
                    </div>

                    <div className="lp-mockup-stat-card">
                      <div className="lp-mockup-stat-icon amber">
                        <Landmark size={14} />
                      </div>
                      <div className="lp-mockup-stat-value">₹24.5L</div>
                      <div className="lp-mockup-stat-label">Fees Collected</div>
                      <div className="lp-mockup-stat-trend">↑ 8% <span>vs last month</span></div>
                    </div>

                    <div className="lp-mockup-stat-card">
                      <div className="lp-mockup-stat-icon blue">
                        <UserCheck size={14} />
                      </div>
                      <div className="lp-mockup-stat-value">42</div>
                      <div className="lp-mockup-stat-label">Teachers</div>
                      <div className="lp-mockup-stat-trend">↑ 2% <span>vs last month</span></div>
                    </div>
                  </div>

                  {/* Bottom Split Row: Today's Activity & Quick Actions */}
                  <div className="lp-mockup-split-row">

                    {/* Left: Today's Activity */}
                    <div className="lp-mockup-panel">
                      <div className="lp-mockup-panel-header">
                        <span className="lp-mockup-panel-title">Today&apos;s Activity</span>
                        <a href="#activity" className="lp-mockup-view-all">
                          <span>View all</span>
                          <ArrowRight size={10} />
                        </a>
                      </div>

                      <div className="lp-mockup-activity-list">
                        <div className="lp-mockup-activity-item">
                          <div className="lp-mockup-act-icon green">
                            <CalendarCheck size={12} />
                          </div>
                          <div className="lp-mockup-act-info">
                            <span className="lp-mockup-act-title">Class 9A — Mathematics</span>
                            <span className="lp-mockup-act-sub">Attendance marked by Priya Sharma</span>
                          </div>
                          <span className="lp-mockup-act-time">09:30 AM</span>
                        </div>

                        <div className="lp-mockup-activity-item">
                          <div className="lp-mockup-act-icon purple">
                            <MessageSquare size={12} />
                          </div>
                          <div className="lp-mockup-act-info">
                            <span className="lp-mockup-act-title">New parent message</span>
                            <span className="lp-mockup-act-sub">From Riya Sharma (Class 6B)</span>
                          </div>
                          <span className="lp-mockup-act-time">08:50 AM</span>
                        </div>

                        <div className="lp-mockup-activity-item">
                          <div className="lp-mockup-act-icon blue">
                            <CreditCard size={12} />
                          </div>
                          <div className="lp-mockup-act-info">
                            <span className="lp-mockup-act-title">Fee payment received</span>
                            <span className="lp-mockup-act-sub">Rs 12,500 from Aarav Mehta</span>
                          </div>
                          <span className="lp-mockup-act-time">08:20 AM</span>
                        </div>

                        <div className="lp-mockup-activity-item">
                          <div className="lp-mockup-act-icon amber">
                            <Megaphone size={12} />
                          </div>
                          <div className="lp-mockup-act-info">
                            <span className="lp-mockup-act-title">Notice published</span>
                            <span className="lp-mockup-act-sub">Annual Sports Day 2024</span>
                          </div>
                          <span className="lp-mockup-act-time">07:45 AM</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Quick Actions */}
                    <div className="lp-mockup-panel">
                      <div className="lp-mockup-panel-header">
                        <span className="lp-mockup-panel-title">Quick Actions</span>
                      </div>

                      <div className="lp-mockup-actions-grid">
                        <div className="lp-mockup-action-btn purple">
                          <Users size={16} />
                          <span>Add Student</span>
                        </div>
                        <div className="lp-mockup-action-btn green">
                          <CalendarCheck size={16} />
                          <span>Mark Attendance</span>
                        </div>
                        <div className="lp-mockup-action-btn amber">
                          <Landmark size={16} />
                          <span>Collect Fees</span>
                        </div>
                        <div className="lp-mockup-action-btn blue">
                          <Send size={16} />
                          <span>Send Message</span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>

            {/* Floating Badge 2: Bottom Left */}
            <div className="lp-floating-badge lp-badge-bottom-left">
              <div className="lp-floating-icon blue">
                <ShieldCheck size={20} />
              </div>
              <div className="lp-floating-text">
                <span className="lp-floating-sub">Trusted by</span>
                <span className="lp-floating-title">Schools Nationwide</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         SECTION 2: 14 Complete System Modules Grid + "Book a Free Demo" CTA
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-modules-section" id="modules">
        <div className="lp-modules-container">

          <div className="lp-section-header">
            <div className="lp-section-pill">
              <span className="lp-section-pill-dot" />
              <span>One Connected Institution Management System</span>
            </div>
            <h2 className="lp-section-title">
              A Complete Institution Management System <br />
              <span className="highlight">Covers Everything You Need</span>
            </h2>
            <p className="lp-section-desc">
              Manage your institution&apos;s daily operations in one connected platform. Eliminate scattered records, reduce repetitive data entry, and keep school information organized and accessible.
            </p>
          </div>

          {/* 14 Modules Grid */}
          <div className="lp-modules-grid">
            {MODULES_14.map((mod) => {
              const IconComp = mod.icon;
              return (
                <div key={mod.title} className="lp-module-card">
                  <div className="lp-module-card-top">
                    <div className={`lp-module-icon-box ${mod.cls}`}>
                      <IconComp size={22} />
                    </div>
                    <span className="lp-module-badge">{mod.badge}</span>
                  </div>
                  <h3 className="lp-module-title">{mod.title}</h3>
                  <p className="lp-module-desc">{mod.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Modules CTA Banner */}
          <div className="lp-modules-cta-banner">
            <div className="lp-modules-cta-text">
              <h3>Ready to modernise your institution with VolpeHub?</h3>
              <p>Experience how our 14 connected modules seamlessly eliminate paperwork and streamline administration.</p>
            </div>
            <Link to="/contact" className="lp-btn-cta-emerald">
              <span>Book a Free Demo</span>
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         SECTION 3: Spotlight / Connected Platform Showcase
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-spotlight-section">
        <div className="lp-spotlight-container">
          <div className="lp-spotlight-card">
            {/* Ambient Aurora Glows & Blueprint Matrix */}
            <div className="lp-spotlight-aurora-top" />
            <div className="lp-spotlight-aurora-bottom" />
            <div className="lp-spotlight-grid-pattern" />

            <div className="lp-spotlight-grid">
              <div className="lp-spotlight-left">
                <div className="lp-spotlight-badge">
                  <span className="lp-spotlight-badge-pulse" />
                  <span>One Connected Institution Management System</span>
                </div>

                <h2 className="lp-spotlight-headline">
                  Your Institution. One Platform.<br />
                  <span className="lp-spotlight-glow-text">Everything Connected.</span>
                </h2>

                <p className="lp-spotlight-desc">
                  VolpeHub brings academic planning, attendance, student performance, communication, institutional operations, and student support together in one integrated management platform.
                </p>

                <p className="lp-spotlight-subdesc">
                  Simplify administration, improve coordination, and empower your institution to operate more efficiently with connected information in real time.
                </p>

                {/* 3 Real-time Value Metrics */}
                <div className="lp-spotlight-metrics-row">
                  <div className="lp-spotlight-metric-item">
                    <span className="lp-spotlight-metric-num">99.9%</span>
                    <span className="lp-spotlight-metric-label">Data Accuracy</span>
                  </div>
                  <div className="lp-spotlight-metric-divider" />
                  <div className="lp-spotlight-metric-item">
                    <span className="lp-spotlight-metric-num">&lt; 0.5s</span>
                    <span className="lp-spotlight-metric-label">Cross-Portal Sync</span>
                  </div>
                  <div className="lp-spotlight-metric-divider" />
                  <div className="lp-spotlight-metric-item">
                    <span className="lp-spotlight-metric-num">Zero</span>
                    <span className="lp-spotlight-metric-label">Duplicate Entry</span>
                  </div>
                </div>

                <div className="lp-spotlight-actions">
                  <Link to="/contact" className="lp-spotlight-btn-primary">
                    <span>Book a Free Demo</span>
                    <ArrowRight size={16} />
                  </Link>
                  <a href="#pillars" className="lp-spotlight-btn-secondary">
                    <span>Explore Features</span>
                  </a>
                </div>
              </div>

              {/* Aesthetic Live Sync Matrix */}
              <div className="lp-spotlight-matrix-stage">
                <div className="lp-matrix-status-bar">
                  <div className="lp-matrix-status-left">
                    <Activity size={15} className="lp-matrix-pulse-icon" />
                    <span>Connected Institution Operations Hub</span>
                  </div>
                  <div className="lp-matrix-status-right">
                    <span className="lp-matrix-live-dot" />
                    <span>Live 100% Operational</span>
                  </div>
                </div>

                <div className="lp-matrix-cards-grid">
                  {/* Node 1: Academic & Attendance */}
                  <div className="lp-matrix-card card-indigo">
                    <div className="lp-matrix-card-top">
                      <div className="lp-matrix-icon-box indigo">
                        <GraduationCap size={18} />
                      </div>
                      <span className="lp-matrix-badge-live blue">
                        <span className="lp-badge-dot" /> SYNCED
                      </span>
                    </div>
                    <div className="lp-matrix-card-info">
                      <h4 className="lp-matrix-card-title">Academic &amp; Attendance</h4>
                      <p className="lp-matrix-card-desc">Live roll calls, syllabus &amp; smart timetables</p>
                    </div>
                    <div className="lp-matrix-telemetry-pill">
                      <div className="lp-telemetry-progress-track">
                        <div className="lp-telemetry-progress-fill" style={{ width: '96%' }} />
                      </div>
                      <div className="lp-telemetry-meta">
                        <span>Today's Attendance</span>
                        <b>96.4% Recorded</b>
                      </div>
                    </div>
                  </div>

                  {/* Node 2: Institutional Operations & Fees */}
                  <div className="lp-matrix-card card-emerald">
                    <div className="lp-matrix-card-top">
                      <div className="lp-matrix-icon-box emerald">
                        <Landmark size={18} />
                      </div>
                      <span className="lp-matrix-badge-live green">
                        <span className="lp-badge-dot" /> CONNECTED
                      </span>
                    </div>
                    <div className="lp-matrix-card-info">
                      <h4 className="lp-matrix-card-title">Operations &amp; Fees</h4>
                      <p className="lp-matrix-card-desc">Auto invoices, receipts &amp; payroll audit</p>
                    </div>
                    <div className="lp-matrix-telemetry-pill">
                      <div className="lp-telemetry-stat-row">
                        <span className="lp-telemetry-highlight">₹24.5L Reconciled</span>
                        <span className="lp-telemetry-tag">Instant Razorpay</span>
                      </div>
                    </div>
                  </div>

                  {/* Node 3: Family & Teacher Communication */}
                  <div className="lp-matrix-card card-amber">
                    <div className="lp-matrix-card-top">
                      <div className="lp-matrix-icon-box amber">
                        <MessageSquare size={18} />
                      </div>
                      <span className="lp-matrix-badge-live green">
                        <span className="lp-badge-dot" /> REAL-TIME
                      </span>
                    </div>
                    <div className="lp-matrix-card-info">
                      <h4 className="lp-matrix-card-title">Family Communication</h4>
                      <p className="lp-matrix-card-desc">Direct chat, circulars &amp; instant alerts</p>
                    </div>
                    <div className="lp-matrix-telemetry-pill">
                      <div className="lp-telemetry-chat-preview">
                        <span className="lp-chat-dot" />
                        <span>New parent message • 1m ago</span>
                      </div>
                    </div>
                  </div>

                  {/* Node 4: Transport & Student Safety */}
                  <div className="lp-matrix-card card-cyan">
                    <div className="lp-matrix-card-top">
                      <div className="lp-matrix-icon-box cyan">
                        <Bus size={18} />
                      </div>
                      <span className="lp-matrix-badge-live cyan">
                        <span className="lp-badge-dot" /> ACTIVE
                      </span>
                    </div>
                    <div className="lp-matrix-card-info">
                      <h4 className="lp-matrix-card-title">Transport &amp; GPS</h4>
                      <p className="lp-matrix-card-desc">Fleet tracking &amp; parent stop alerts</p>
                    </div>
                    <div className="lp-matrix-telemetry-pill">
                      <div className="lp-telemetry-gps-row">
                        <Radio size={12} className="lp-gps-ping" />
                        <span>Route #4 on schedule • 45 km/h</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lp-matrix-bottom-bar">
                  <span className="lp-matrix-footer-tag">
                    <Wifi size={13} />
                    <span>End-to-end encrypted telemetry across all 14 campus modules</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         SECTION 4: 6 Core Pillars
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-pillars-section" id="pillars">
        <div className="lp-pillars-container">

          <div className="lp-section-header">
            <div className="lp-section-pill">
              <span className="lp-section-pill-dot" />
              <span>Unified Architecture</span>
            </div>
            <h2 className="lp-section-title">
              Everything Your Institution Needs, <br />
              <span className="highlight">Connected in One Place</span>
            </h2>
            <p className="lp-section-desc">
              Manage essential educational activities through a unified platform designed to improve coordination, visibility, and operational efficiency.
            </p>
          </div>

          <div className="lp-pillars-grid">
            {CORE_PILLARS.map((pillar) => {
              const PillarIcon = pillar.icon;
              return (
                <div key={pillar.title} className="lp-pillar-card">
                  <div className="lp-pillar-header">
                    <div className={`lp-pillar-icon-box ${pillar.cls}`}>
                      <PillarIcon size={24} />
                    </div>
                    <span className="lp-pillar-tag">{pillar.tag}</span>
                  </div>

                  <h3 className="lp-pillar-title">{pillar.title}</h3>
                  <p className="lp-pillar-desc">{pillar.desc}</p>

                  <ul className="lp-pillar-features">
                    {pillar.highlights.map((item) => (
                      <li key={item} className="lp-pillar-feature-item">
                        <Check size={15} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         SECTION 5: Dedicated Portals Breakdown + Final Action Bar
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-suite-section">
        <div className="lp-suite-container">

          <div className="lp-section-header">
            <div className="lp-section-pill">
              <span className="lp-section-pill-dot" />
              <span>Dedicated Portals</span>
            </div>
            <h2 className="lp-section-title">
              Explore the VolpeHub <span className="highlight">Institution app</span>
            </h2>
            <p className="lp-section-desc">
              A complete suite built specifically to eliminate manual school paperwork, empower teaching staff, and connect parents.
            </p>
          </div>

          {/* 4 Role Portal Cards */}
          <div className="lp-portals-grid">
            {PORTAL_SUITES.map((suite) => {
              const SuiteIcon = suite.icon;
              return (
                <div key={suite.title} className="lp-portal-card">
                  <div className={`lp-portal-icon-wrap ${suite.cls}`}>
                    <SuiteIcon size={26} />
                  </div>

                  <span className="lp-portal-role-tag">{suite.role}</span>
                  <h3 className="lp-portal-title">{suite.title}</h3>
                  <p className="lp-portal-desc">{suite.desc}</p>

                  <ul className="lp-portal-highlights">
                    {suite.highlights.map((h) => (
                      <li key={h} className="lp-portal-highlight-item">
                        <Check size={14} />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>

                  <Link to="/login" className="lp-portal-action">
                    <span>{suite.linkText}</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Final Action Bar */}
          <div className="lp-final-cta-bar">
            <div className="lp-final-cta-info">
              <h3>Empower Your Institution with Connected Intelligence</h3>
              <p>Experience how VolpeHub brings peace of mind to administrators, teachers, and parents alike.</p>
            </div>
            <div className="lp-final-cta-btns">
              <Link to="/contact" className="lp-btn-primary-white">
                <span>Book a Free Demo</span>
                <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="lp-btn-outline-white">
                <span>Sign In to Portal</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── RICH MODERN FOOTER ────────────────────────────────────── */}
      <MarketingFooter />
    </div>
  );
}
