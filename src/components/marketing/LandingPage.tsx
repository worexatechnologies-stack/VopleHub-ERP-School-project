import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ShieldCheck, CheckCircle2, Users,
  ArrowRight, UserCheck, School,
  GraduationCap, CalendarDays, Landmark, MessageSquare,
  Menu, X, Play, Bell, ChevronDown, LayoutDashboard,
  CalendarCheck, BookOpen, UsersRound, BarChart3, Settings,
  UserPlus, Megaphone, FileText, Laptop, Check
} from 'lucide-react';
import MarketingNavbar from './MarketingNavbar';
import volpeLogo from '../../assets/volpe-logo.png';
import avatarTeacher from '../../assets/avatar-teacher.jpg';
import './LandingPage.css';

// ─── Constants & Data ──────────────────────────────────────────────────────────
const NAV_LINKS = [
  { label: 'Platform',     to: '/platform',     id: 'platform' },
  { label: 'Solutions',    to: '/platform#solutions', id: 'solutions' },
  { label: 'How it works', to: '/how-it-works',  id: 'how-it-works' },
  { label: 'Security',     to: '/security',      id: 'security' },
  { label: 'Contact',      to: '/contact',       id: 'contact' },
];

const ATTENDANCE_DAYS = [
  { day: 'Mon', rate: '88%', height: '54%' },
  { day: 'Tue', rate: '91%', height: '62%' },
  { day: 'Wed', rate: '89%', height: '58%' },
  { day: 'Thu', rate: '94%', height: '70%' },
  { day: 'Fri', rate: '92%', height: '66%' },
  { day: 'Sat', rate: '78%', height: '48%' },
  { day: 'Sun', rate: '96%', height: '88%', active: true },
];

const MODULES = [
  { Icon: GraduationCap, cls: 'indigo', title: 'Admissions & Enrollment',  sub: 'Streamlined multi-step admissions with complete records.' },
  { Icon: CalendarDays,  cls: 'blue',   title: 'Academic Timetabling',     sub: 'Automated schedules, class management & notifications.' },
  { Icon: Landmark,      cls: 'green',  title: 'Fee Collection',           sub: 'Secure, automated and flexible payment options.' },
  { Icon: MessageSquare, cls: 'amber',  title: 'Family Communication',     sub: 'Keep parents and students always connected.' },
  { Icon: ShieldCheck,   cls: 'indigo', title: 'Security & Compliance',    sub: 'Data safety, role-based access and audit trails.' },
];

export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>('Sun');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Lock body scroll when modal or mobile menu is open
  useEffect(() => {
    document.body.style.overflow = (mobileOpen || videoModalOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen, videoModalOpen]);

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

      {/* Navbar matching reference */}
      <MarketingNavbar />

      {/* ═══════════════════════════════════════════════════════════════════
         HERO SECTION — Replicating the exact layout & aesthetics
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="lp-hero-wrapper">

        {/* Ambient background glows */}
        <div className="lp-ambient-layer" aria-hidden="true">
          <div className="lp-ambient-glow lp-glow-top" />
          <div className="lp-ambient-glow lp-glow-center" />
        </div>

        {/* Bottom Left: Botanical Monstera Leaves */}
        <div className="lp-botanical-leaves" aria-hidden="true">
          <svg viewBox="0 0 280 260" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g opacity="0.95">
              {/* Back leaf */}
              <path d="M-30 240C10 180 50 140 100 130C150 120 180 140 160 170C140 200 90 230 40 250Z" fill="url(#leaf-dark-grad)" />
              {/* Main front leaf stem */}
              <path d="M-20 270C30 200 70 150 130 90" stroke="#166534" strokeWidth="4" strokeLinecap="round" />
              {/* Leaf blade 1 */}
              <path d="M-10 210C35 150 90 120 140 110C125 125 105 135 110 150C85 140 70 155 65 175C50 170 30 190 -10 210Z" fill="url(#leaf-vibrant-grad)" />
              {/* Leaf blade 2 */}
              <path d="M40 160C85 110 130 80 180 65C170 85 150 95 155 110C130 100 115 115 110 135C95 130 75 145 40 160Z" fill="url(#leaf-vibrant-grad)" />
              {/* Leaf blade 3 (top) */}
              <path d="M90 115C130 70 170 45 215 35C200 55 185 65 190 80C165 72 150 88 145 105C135 100 115 110 90 115Z" fill="url(#leaf-light-grad)" />
              {/* Monstera cutout ribs */}
              <path d="M60 145C80 135 100 140 115 150" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M100 105C120 95 140 102 155 112" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M140 68C160 60 175 66 188 74" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
            </g>
            <defs>
              <linearGradient id="leaf-dark-grad" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#14532d" />
                <stop offset="1" stopColor="#166534" />
              </linearGradient>
              <linearGradient id="leaf-vibrant-grad" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#16a34a" />
                <stop offset="1" stopColor="#22c55e" />
              </linearGradient>
              <linearGradient id="leaf-light-grad" x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#22c55e" />
                <stop offset="1" stopColor="#4ade80" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Right Background: Classical Campus Brick Building & Foliage */}
        <div className="lp-campus-bg-scene" aria-hidden="true">
          <svg viewBox="0 0 540 600" fill="none" xmlns="http://www.w3.org/2000/svg" className="lp-campus-svg">
            <g opacity="0.88">
              {/* Sky warm glow */}
              <rect x="180" y="0" width="360" height="600" fill="url(#campus-sky-glow)" />

              {/* Main classical brick academy building */}
              {/* Roof pediment */}
              <polygon points="400,160 480,210 320,210" fill="#a45248" />
              <polygon points="400,175 465,210 335,210" fill="#e8dfd8" />

              {/* Clock Tower / Round Clock */}
              <circle cx="400" cy="200" r="18" fill="#ffffff" stroke="#c0a080" strokeWidth="3" />
              <circle cx="400" cy="200" r="14" fill="#ffffff" />
              {/* Clock hands showing 10:10 */}
              <line x1="400" y1="200" x2="394" y2="194" stroke="#2c3e50" strokeWidth="2" strokeLinecap="round" />
              <line x1="400" y1="200" x2="408" y2="196" stroke="#2c3e50" strokeWidth="2" strokeLinecap="round" />

              {/* Brick Facade Main Body */}
              <rect x="300" y="210" width="240" height="390" fill="#c06a5b" />
              <rect x="310" y="215" width="220" height="385" fill="#d27b6c" />

              {/* Classical Stone Cornices & Beltcourses */}
              <rect x="290" y="210" width="250" height="12" fill="#ece5dc" />
              <rect x="295" y="320" width="245" height="8" fill="#e2dcd2" />
              <rect x="295" y="440" width="245" height="8" fill="#e2dcd2" />

              {/* Classical White Columns / Pilasters */}
              <rect x="325" y="222" width="14" height="378" fill="#f4ede5" />
              <rect x="390" y="222" width="14" height="378" fill="#f4ede5" />
              <rect x="455" y="222" width="14" height="378" fill="#f4ede5" />
              <rect x="520" y="222" width="14" height="378" fill="#f4ede5" />

              {/* Upper Arched Multi-pane Windows */}
              <rect x="348" y="235" width="32" height="65" rx="16" fill="#3a5169" stroke="#ffffff" strokeWidth="4" />
              <line x1="364" y1="235" x2="364" y2="300" stroke="#ffffff" strokeWidth="2" />
              <line x1="348" y1="265" x2="380" y2="265" stroke="#ffffff" strokeWidth="2" />

              <rect x="413" y="235" width="32" height="65" rx="16" fill="#3a5169" stroke="#ffffff" strokeWidth="4" />
              <line x1="429" y1="235" x2="429" y2="300" stroke="#ffffff" strokeWidth="2" />
              <line x1="413" y1="265" x2="445" y2="265" stroke="#ffffff" strokeWidth="2" />

              <rect x="478" y="235" width="32" height="65" rx="16" fill="#3a5169" stroke="#ffffff" strokeWidth="4" />
              <line x1="494" y1="235" x2="494" y2="300" stroke="#ffffff" strokeWidth="2" />
              <line x1="478" y1="265" x2="510" y2="265" stroke="#ffffff" strokeWidth="2" />

              {/* Middle Floor Windows */}
              <rect x="348" y="340" width="32" height="60" rx="4" fill="#2c3e50" stroke="#ffffff" strokeWidth="4" />
              <line x1="364" y1="340" x2="364" y2="400" stroke="#ffffff" strokeWidth="2" />
              <line x1="348" y1="370" x2="380" y2="370" stroke="#ffffff" strokeWidth="2" />

              <rect x="413" y="340" width="32" height="60" rx="4" fill="#2c3e50" stroke="#ffffff" strokeWidth="4" />
              <line x1="429" y1="340" x2="429" y2="400" stroke="#ffffff" strokeWidth="2" />
              <line x1="413" y1="370" x2="445" y2="370" stroke="#ffffff" strokeWidth="2" />

              <rect x="478" y="340" width="32" height="60" rx="4" fill="#2c3e50" stroke="#ffffff" strokeWidth="4" />
              <line x1="494" y1="340" x2="494" y2="400" stroke="#ffffff" strokeWidth="2" />
              <line x1="478" y1="370" x2="510" y2="370" stroke="#ffffff" strokeWidth="2" />

              {/* Trees framing the building */}
              <circle cx="280" cy="460" r="75" fill="#4d7c0f" opacity="0.9" />
              <circle cx="260" cy="430" r="60" fill="#65a30d" opacity="0.85" />
              <circle cx="300" cy="410" r="50" fill="#84cc16" opacity="0.8" />
              <circle cx="250" cy="510" r="70" fill="#3f6212" opacity="0.95" />
            </g>
            <defs>
              <radialGradient id="campus-sky-glow" cx="0.8" cy="0.3" r="0.8">
                <stop stopColor="#e0e7ff" stopOpacity="0.4" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>
          </svg>
        </div>



        {/* ─── MAIN HERO GRID ────────────────────────────────────────── */}
        <div className="lp-hero-grid">

          {/* LEFT COLUMN: Value Proposition & CTAs */}
          <div className="lp-hero-left">

            {/* Main Headline */}
            <h1 className="lp-hero-headline">
              Smarter School<br />
              Management for a<br />
              <span className="lp-highlight-purple-wrapper">
                <span className="lp-highlight-purple">Brighter Future</span>
                {/* Hand-drawn dynamic brush stroke underline */}
               
              </span>
            </h1>

            {/* Subtitle */}
            <p className="lp-hero-description">
              Manage students, teachers, attendance, academics, communication and family access into one secure operating system for your school.
            </p>

            {/* Action Buttons */}
            <div className="lp-hero-cta-group">
              <Link to="/login" className="lp-cta-primary">
                <span>Explore the Platform</span>
                <ArrowRight size={17} />
              </Link>
              <button
                type="button"
                className="lp-cta-secondary"
                onClick={() => setVideoModalOpen(true)}
              >
                <span className="lp-play-icon-circle">
                  <Play size={13} className="lp-play-triangle" />
                </span>
                <span>See How It Works</span>
              </button>
            </div>

            {/* Feature Trust Badges (Horizontal Row of 3) */}
            <div className="lp-hero-trust-row">
              {/* 1. Secure & Reliable */}
              <div className="lp-trust-item">
                <div className="lp-trust-icon-box blue">
                  <ShieldCheck size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">Secure &amp; Reliable</span>
                  <span className="lp-trust-sub">Your data, our priority</span>
                </div>
              </div>

              {/* 2. Students & Parents */}
              <div className="lp-trust-item">
                <div className="lp-trust-icon-box green">
                  <Users size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">Students &amp; Parents</span>
                  <span className="lp-trust-sub">Stay informed &amp; involved</span>
                </div>
              </div>

              {/* 3. Teachers & Admin */}
              <div className="lp-trust-item">
                <div className="lp-trust-icon-box amber">
                  <Laptop size={18} />
                </div>
                <div className="lp-trust-text">
                  <span className="lp-trust-title">Teachers &amp; Admin</span>
                  <span className="lp-trust-sub">Work smarter, not harder</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: 3D Glassmorphism Dashboard Visual */}
          <div className="lp-hero-right">
            <div className="lp-showcase-stage">

              {/* ── Aurora ambient glow behind the card ── */}
              <div className="lp-aurora-glow-wrap" aria-hidden="true">
                <div className="lp-aurora-blob lp-aurora-purple" />
                <div className="lp-aurora-blob lp-aurora-teal" />
                <div className="lp-aurora-blob lp-aurora-indigo" />
              </div>

              {/* ── Main 3D Tilted Dashboard Card ── */}
              <div className="lp-glass-card">

                {/* Card header */}
                <div className="lp-glass-header">
                  <div className="lp-glass-dots">
                    <span className="lp-gdot red" />
                    <span className="lp-gdot yellow" />
                    <span className="lp-gdot green" />
                  </div>
                  <div className="lp-glass-header-title">
                    <LayoutDashboard size={13} />
                    <span>School Dashboard</span>
                  </div>
                  <div className="lp-glass-header-right">
                    <div className="lp-glass-live-dot" />
                    <span>Live</span>
                  </div>
                </div>

                {/* Top metric row */}
                <div className="lp-glass-metrics">
                  <div className="lp-glass-metric">
                    <div className="lp-glass-metric-icon purple"><Users size={14} /></div>
                    <div>
                      <div className="lp-glass-metric-value">2,648</div>
                      <div className="lp-glass-metric-label">Students</div>
                    </div>
                    <span className="lp-glass-metric-trend">↑ 12%</span>
                  </div>
                  <div className="lp-glass-metric">
                    <div className="lp-glass-metric-icon green"><CalendarCheck size={14} /></div>
                    <div>
                      <div className="lp-glass-metric-value">96%</div>
                      <div className="lp-glass-metric-label">Attendance</div>
                    </div>
                    <span className="lp-glass-metric-trend">↑ 3%</span>
                  </div>
                  <div className="lp-glass-metric">
                    <div className="lp-glass-metric-icon blue"><UserCheck size={14} /></div>
                    <div>
                      <div className="lp-glass-metric-value">42</div>
                      <div className="lp-glass-metric-label">Teachers</div>
                    </div>
                    <span className="lp-glass-metric-trend">↑ 2%</span>
                  </div>
                </div>

                {/* Mid section: SVG ring chart + activity feed */}
                <div className="lp-glass-mid">

                  {/* Donut / Ring chart */}
                  <div className="lp-glass-ring-wrap">
                    <svg viewBox="0 0 100 100" className="lp-ring-svg">
                      {/* Background track */}
                      <circle cx="50" cy="50" r="38" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                      {/* Green segment — attendance 96% */}
                      <circle
                        cx="50" cy="50" r="38" fill="none"
                        stroke="#10b981" strokeWidth="10"
                        strokeDasharray="229.3 238.8"
                        strokeDashoffset="0"
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                      {/* Indigo segment — fees 78% */}
                      <circle
                        cx="50" cy="50" r="28" fill="none"
                        stroke="#6366f1" strokeWidth="8"
                        strokeDasharray="137.4 175.9"
                        strokeDashoffset="0"
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                      <text x="50" y="47" textAnchor="middle" className="lp-ring-label-big">96%</text>
                      <text x="50" y="58" textAnchor="middle" className="lp-ring-label-small">Attendance</text>
                    </svg>
                    <div className="lp-ring-legend">
                      <div className="lp-ring-legend-item">
                        <span className="lp-legend-dot green" />
                        <span>Attendance</span>
                        <b>96%</b>
                      </div>
                      <div className="lp-ring-legend-item">
                        <span className="lp-legend-dot indigo" />
                        <span>Fees Collected</span>
                        <b>78%</b>
                      </div>
                      <div className="lp-ring-legend-item">
                        <span className="lp-legend-dot amber" />
                        <span>Exam Pass Rate</span>
                        <b>91%</b>
                      </div>
                    </div>
                  </div>

                  {/* Activity feed */}
                  <div className="lp-glass-feed">
                    <div className="lp-glass-feed-title">Today&apos;s Activity</div>
                    <div className="lp-glass-feed-list">
                      <div className="lp-glass-feed-row">
                        <div className="lp-feed-icon green"><School size={11} /></div>
                        <div className="lp-feed-text">
                          <span className="lp-feed-main">Class 9A — Mathematics</span>
                          <span className="lp-feed-time">09:30 AM</span>
                        </div>
                        <span className="lp-feed-tag green">Class</span>
                      </div>
                      <div className="lp-glass-feed-row">
                        <div className="lp-feed-icon blue"><MessageSquare size={11} /></div>
                        <div className="lp-feed-text">
                          <span className="lp-feed-main">Parent message received</span>
                          <span className="lp-feed-time">09:15 AM</span>
                        </div>
                        <span className="lp-feed-tag blue">Msg</span>
                      </div>
                      <div className="lp-glass-feed-row">
                        <div className="lp-feed-icon purple"><Landmark size={11} /></div>
                        <div className="lp-feed-text">
                          <span className="lp-feed-main">Fee collected — Rs 24,500</span>
                          <span className="lp-feed-time">08:50 AM</span>
                        </div>
                        <span className="lp-feed-tag purple">Fee</span>
                      </div>
                      <div className="lp-glass-feed-row">
                        <div className="lp-feed-icon amber"><Bell size={11} /></div>
                        <div className="lp-feed-text">
                          <span className="lp-feed-main">Notice sent to all parents</span>
                          <span className="lp-feed-time">08:30 AM</span>
                        </div>
                        <span className="lp-feed-tag amber">Alert</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom fee progress bar */}
                <div className="lp-glass-fee-row">
                  <div className="lp-glass-fee-info">
                    <span className="lp-glass-fee-label">Fee Collection — Term 2</span>
                    <span className="lp-glass-fee-amount"><b>Rs 2.4L</b> / Rs 3.1L</span>
                  </div>
                  <div className="lp-glass-fee-track">
                    <div className="lp-glass-fee-fill" style={{ width: '78%' }} />
                  </div>
                  <span className="lp-glass-fee-pct">78%</span>
                </div>

              </div>{/* end lp-glass-card */}

              {/* ── Floating micro-stat badges ── */}
              <div className="lp-micro-badge lp-micro-top-right">
                <div className="lp-micro-icon indigo"><GraduationCap size={14} /></div>
                <div className="lp-micro-content">
                  <span className="lp-micro-val">12</span>
                  <span className="lp-micro-lbl">New Admissions</span>
                </div>
              </div>

              <div className="lp-micro-badge lp-micro-bottom-left">
                <div className="lp-micro-icon green"><CheckCircle2 size={14} /></div>
                <div className="lp-micro-content">
                  <span className="lp-micro-val">96%</span>
                  <span className="lp-micro-lbl">Attendance Today</span>
                </div>
              </div>

              <div className="lp-micro-badge lp-micro-bottom-right">
                <div className="lp-micro-icon amber"><Landmark size={14} /></div>
                <div className="lp-micro-content">
                  <span className="lp-micro-val">Rs 2.4L</span>
                  <span className="lp-micro-lbl">Fees Collected</span>
                </div>
              </div>

            </div>
          </div>

        </div>{/* end lp-hero-grid */}

        {/* ─── BOTTOM MODULES STRIP ──────────────────────────────────── */}
        <div className="lp-strip-container">
          <div className="lp-strip-inner-box">
            {MODULES.map(({ Icon, cls, title, sub }) => (
              <div key={title} className="lp-strip-card">
                <div className={`lp-strip-icon-circle ${cls}`}>
                  <Icon size={18} />
                </div>
                <div className="lp-strip-card-content">
                  <div className="lp-strip-card-title">{title}</div>
                  <div className="lp-strip-card-sub">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── VIDEO / INTERACTIVE WALKTHROUGH MODAL ───────────────────── */}
      {videoModalOpen && (
        <div className="lp-modal-backdrop" onClick={() => setVideoModalOpen(false)}>
          <div className="lp-modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="lp-modal-header">
              <div className="lp-modal-title-group">
                <Play size={18} className="lp-modal-play-icon" />
                <h3>Volpehub Interactive Tour</h3>
              </div>
              <button className="lp-modal-close" onClick={() => setVideoModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="lp-modal-body">
              <div className="lp-modal-preview-video">
                <div className="lp-preview-pulse">
                  <Play size={36} fill="#ffffff" color="#ffffff" />
                </div>
                <h4>Explore the Institutional Campus OS</h4>
                <p>Real-time attendance, fee collections, gradebooks, and family communication designed for modern schools.</p>
                <div className="lp-modal-bullets">
                  <div className="lp-bullet-item">
                    <Check size={14} className="green" /> Single unified database for multi-campus management
                  </div>
                  <div className="lp-bullet-item">
                    <Check size={14} className="green" /> Dedicated portals for Admin, Faculty, Students &amp; Parents
                  </div>
                  <div className="lp-bullet-item">
                    <Check size={14} className="green" /> Automated SMS &amp; Push alerts for attendance and circulars
                  </div>
                </div>
                <div className="lp-modal-actions">
                  <Link to="/login" className="lp-modal-launch-btn">
                    Launch Interactive Demo
                  </Link>
                  <Link to="/demo" className="lp-modal-contact-btn">
                    Book Personalized Session
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── COMPACT FOOTER ────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={volpeLogo} alt="Volpehub Education logo" className="lp-footer-logo" />
            <span className="lp-footer-brand-text">VOLPEHUB EDUCATION</span>
            <span className="lp-footer-copy">© {new Date().getFullYear()} Worexa Technologies. All rights reserved.</span>
          </div>
          <div className="lp-footer-links">
            <Link to="/platform">Platform</Link>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/security">Security</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
