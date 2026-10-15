import { useEffect } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, ShieldCheck, Users, GraduationCap, CalendarDays,
  Landmark, MessageSquare, CheckCircle2, Settings, BarChart3,
  UserCheck, BookOpen, Bell, Zap, Globe, Lock, Eye,
  Layers, Database, Clock, Award, TrendingUp, HeartHandshake,
  School, Star, FileText, CalendarCheck
} from 'lucide-react';
import operationsImage from '../../assets/school-operations.png';
import learningImage from '../../assets/learning-collaboration.png';
import securityImage from '../../assets/secure-family-access.png';
import volpeLogo from '../../assets/volpe-logo.png';
import MarketingNavbar from './MarketingNavbar';
import './LandingPage.css';

// ---- Shared Module Strip Data -----------------------------------------------
const MODULES = [
  { Icon: GraduationCap, cls: 'indigo', title: 'Admissions & Enrollment',  sub: 'Streamlined multi-step admissions with complete records.' },
  { Icon: CalendarDays,  cls: 'blue',   title: 'Academic Timetabling',     sub: 'Automated schedules, class management & notifications.' },
  { Icon: Landmark,      cls: 'green',  title: 'Fee Collection',           sub: 'Secure, automated and flexible payment options.' },
  { Icon: MessageSquare, cls: 'amber',  title: 'Family Communication',     sub: 'Keep parents and students always connected.' },
  { Icon: ShieldCheck,   cls: 'indigo', title: 'Security & Compliance',    sub: 'Data safety, role-based access and audit trails.' },
];

// ---- Page Content Definitions ------------------------------------------------
type PageKind = 'platform' | 'solutions' | 'how-it-works' | 'security';

interface FeatureCard {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  cls: string;
  title: string;
  description: string;
  stat?: string;
  statLabel?: string;
}

interface PageContent {
  eyebrow: string;
  title: string;
  titleHighlight: string;
  subtitle: string;
  image: string;
  imageAlt: string;
  ctaLabel: string;
  ctaTo: string;
  features: FeatureCard[];
  benefitTitle: string;
  benefits: string[];
}

const pageData: Record<PageKind, PageContent> = {
  platform: {
    eyebrow: 'BUILT FOR MODERN SCHOOLS',
    title: 'One connected platform for',
    titleHighlight: 'every school need',
    subtitle: 'Volpehub brings student information, academic operations, fees and communication into a single school workspace. Every team member sees the tools designed for their role.',
    image: operationsImage,
    imageAlt: 'School administrator using digital operations workspace',
    ctaLabel: 'Explore the Platform',
    ctaTo: '/login',
    features: [
      { Icon: Users,         cls: 'indigo', title: 'Student Information System',  description: 'Maintain complete student and guardian records, academic history, and all key documents in one place.', stat: '1,200+', statLabel: 'Student profiles managed' },
      { Icon: CalendarCheck, cls: 'blue',   title: 'Academic Operations',         description: 'Classes, attendance, timetables, exams and results all in their daily operational context.',               stat: '98%',    statLabel: 'Attendance accuracy' },
      { Icon: Landmark,      cls: 'green',  title: 'Finance & Fee Management',    description: 'Full-cycle fee visibility, collection and reporting with automated reminders and flexible payment modes.',   stat: 'Rs2Cr+', statLabel: 'Fees processed monthly' },
      { Icon: MessageSquare, cls: 'amber',  title: 'Family Communication',        description: 'Targeted notices, circulars and parent-teacher messaging for a better-connected school community.',          stat: '10k+',   statLabel: 'Messages sent daily' },
      { Icon: BarChart3,     cls: 'purple', title: 'Reports & Analytics',         description: 'Comprehensive institutional reports, attendance analytics, and academic performance dashboards.',            stat: '50+',    statLabel: 'Report templates' },
      { Icon: Settings,      cls: 'slate',  title: 'Role-Based Access Control',   description: 'Each person sees exactly the tools and data relevant to their responsibilities -- nothing more.',           stat: '6',      statLabel: 'Role types supported' },
    ],
    benefitTitle: 'Why schools choose Volpehub',
    benefits: [
      'Replace scattered spreadsheets and paper registers with one live system',
      'Give admins, teachers, parents and students focused, relevant workspaces',
      'Get real-time visibility into attendance, fees and academic performance',
      'Reduce administrative overhead with automated workflows',
    ],
  },

  solutions: {
    eyebrow: 'TAILORED FOR YOUR TEAM',
    title: 'Purpose-built solutions for',
    titleHighlight: 'every school role',
    subtitle: 'From classroom teachers to finance administrators and parents -- each team member gets a workspace designed around their daily responsibilities and goals.',
    image: learningImage,
    imageAlt: 'Teachers and students collaborating in a connected classroom',
    ctaLabel: 'See All Solutions',
    ctaTo: '/platform',
    features: [
      { Icon: School,         cls: 'indigo', title: 'For School Administrators', description: 'Complete oversight of admissions, staff, fees and academic performance from a single command centre.',              stat: '30%',  statLabel: 'Time saved on admin tasks' },
      { Icon: BookOpen,       cls: 'blue',   title: 'For Teachers & Faculty',    description: 'Manage attendance, gradebooks, assignments and parent communication without leaving your workflow.',                   stat: '40%',  statLabel: 'Less time on paperwork' },
      { Icon: UserCheck,      cls: 'green',  title: 'For Students',              description: 'Access timetables, grades, assignments, notices and library resources from a personal student portal.',               stat: '95%',  statLabel: 'Student satisfaction rate' },
      { Icon: HeartHandshake, cls: 'amber',  title: 'For Parents & Families',   description: 'Stay informed about your child attendance, grades, fees and school notices in real time.',                            stat: '85%',  statLabel: 'Parent engagement increase' },
      { Icon: Layers,         cls: 'purple', title: 'For Multi-Campus Groups',   description: 'Centralised control across multiple schools with campus-level isolation and group reporting.',                        stat: '20+',  statLabel: 'Campus groups onboarded' },
      { Icon: Award,          cls: 'slate',  title: 'For Exam Coordinators',     description: 'Build exam schedules, upload marks, generate report cards and publish results in one smooth flow.',                   stat: '500+', statLabel: 'Exams managed per term' },
    ],
    benefitTitle: 'A workspace that fits every role',
    benefits: [
      'Admins get a full view of the entire school at all times',
      'Teachers focus on their classes, not on administrative overhead',
      'Parents stay connected to their child progress without calling the school',
      'Students get a clear, structured view of their academic journey',
    ],
  },

  'how-it-works': {
    eyebrow: 'SIMPLE, PRACTICAL ROLLOUT',
    title: 'From setup to confident',
    titleHighlight: 'daily operation',
    subtitle: 'A connected school does not need to change everything at once. Volpehub gives your team a clear path from initial setup to confident daily use, with every step building on a solid school record.',
    image: learningImage,
    imageAlt: 'School team collaborating on digital setup',
    ctaLabel: 'Start Your Setup',
    ctaTo: '/contact',
    features: [
      { Icon: Database,   cls: 'indigo', title: 'Step 1 - Configure Foundation',    description: 'Map your school structures, academic years, classes, and sections. Set up roles and access for each staff member.',       stat: '1 day',     statLabel: 'Typical setup time' },
      { Icon: Users,      cls: 'blue',   title: 'Step 2 - Import Student Records',  description: 'Bring in your existing student data, parent contacts, and historical records. Bulk import tools make it seamless.',         stat: '5 min',     statLabel: 'Per 100 students imported' },
      { Icon: Zap,        cls: 'green',  title: 'Step 3 - Train Your Teams',        description: 'Role-specific onboarding guides get each team member comfortable with their focused workspace quickly.',                    stat: '2 hrs',     statLabel: 'Average team onboarding' },
      { Icon: TrendingUp, cls: 'amber',  title: 'Step 4 - Go Live',                 description: 'Start with the workflows that matter most: attendance, fees or communication, and expand as your school is ready.',         stat: 'Week 1',    statLabel: 'First module goes live' },
      { Icon: Clock,      cls: 'purple', title: 'Step 5 - Daily Use',               description: 'Your team uses Volpehub as the living school record. Updates are instant, visibility is school-wide.',                     stat: 'Daily',     statLabel: 'Active engagement rate' },
      { Icon: Globe,      cls: 'slate',  title: 'Step 6 - Grow with Confidence',    description: 'Add more modules, integrate new academic years, and scale across campuses as your institution grows.',                      stat: 'Unlimited', statLabel: 'Scalability with no lock-in' },
    ],
    benefitTitle: 'Designed for a smooth rollout',
    benefits: [
      'Start with the workflows your school needs most and expand gradually',
      'Guided onboarding means your team is productive from day one',
      'Existing student data migrates in without disruption',
      'Each new academic year rolls over with a single click',
    ],
  },

  security: {
    eyebrow: 'SECURITY BY DESIGN',
    title: 'School data handled',
    titleHighlight: 'with care',
    subtitle: 'Sensitive school information deserves a thoughtful foundation. Volpehub scopes all data to the relevant school and role, keeping records focused on the people permitted to access them.',
    image: securityImage,
    imageAlt: 'Parent safely accessing school information on a secure platform',
    ctaLabel: 'Learn About Security',
    ctaTo: '/contact',
    features: [
      { Icon: Lock,       cls: 'indigo', title: 'Role-Based Access Control',    description: 'Each user sees only the information and actions relevant to their role. Students cannot see teacher records.',              stat: '6',       statLabel: 'Distinct access roles' },
      { Icon: ShieldCheck,cls: 'blue',   title: 'School-Scoped Data Isolation', description: 'Every piece of data belongs to exactly one school. Cross-school data access is architecturally impossible.',              stat: '100%',    statLabel: 'Data isolation guarantee' },
      { Icon: Eye,        cls: 'green',  title: 'Audit Trail Logging',          description: 'Every significant action is logged: who did what, when, and from where. Full accountability without effort.',              stat: '90 days', statLabel: 'Audit log retention' },
      { Icon: Bell,       cls: 'amber',  title: 'Secure Notification Delivery', description: 'Notices and alerts reach only the intended recipients. No accidental data leaks through mass communication.',             stat: '0',       statLabel: 'Unintended data exposures' },
      { Icon: FileText,   cls: 'purple', title: 'Document Security',            description: 'Student documents, certificates, and sensitive records are stored with access controls.',                                 stat: 'AES-256', statLabel: 'Encryption standard' },
      { Icon: Database,   cls: 'slate',  title: 'Data Backup & Recovery',       description: 'Automated daily backups ensure your school critical data is always safe and recoverable.',                                stat: 'Daily',   statLabel: 'Automatic backup frequency' },
    ],
    benefitTitle: 'Built for school-grade data responsibility',
    benefits: [
      'Student and family data is never shared across schools or organisations',
      'Granular permissions prevent accidental data exposure by any team member',
      'All sensitive records are encrypted at rest and in transit',
      'Compliance-friendly audit logs support your institution governance needs',
    ],
  },
};

// ---- Brush Stroke SVG -------------------------------------------------------
function BrushStroke() {
  return (
    <svg className="lp-brush-stroke" viewBox="0 0 310 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M6 14C65 5 190 4 304 12C240 17 140 18 45 19"
        stroke="#818cf8"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- Page Component ---------------------------------------------------------
export default function ProductPage({ kind }: { kind: PageKind }) {
  const page = pageData[kind];

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [kind]);

  return (
    <div className="lp-root">
      <MarketingNavbar />

      {/* ===================================================================
         HERO SECTION
         =================================================================== */}
      <section className="pp-hero-section">
        {/* Ambient glows */}
        <div className="lp-ambient-layer" aria-hidden="true">
          <div className="lp-ambient-glow lp-glow-top" />
          <div className="lp-ambient-glow lp-glow-center" />
        </div>

        <div className="pp-hero-grid">
          {/* Left: Copy */}
          <div className="pp-hero-left">
            {/* Eyebrow pill */}
            <div className="lp-hero-tag">
              <span className="lp-hero-tag-dot" />
              {page.eyebrow}
            </div>

            {/* Headline with brush-stroke underline */}
            <h1 className="lp-hero-headline">
              {page.title}<br />
              <span className="lp-highlight-purple-wrapper">
                <span className="lp-highlight-purple">{page.titleHighlight}</span>
                <BrushStroke />
              </span>
            </h1>

            {/* Subtitle */}
            <p className="pp-hero-subtitle">{page.subtitle}</p>

            {/* CTAs */}
            <div className="lp-hero-cta-group">
              <Link to={page.ctaTo} className="lp-cta-primary">
                <span>{page.ctaLabel}</span>
                <ArrowRight size={17} />
              </Link>
              <Link to="/contact" className="lp-cta-secondary">
                <span>Talk to us</span>
              </Link>
            </div>

            {/* Benefit bullets */}
            <ul className="pp-hero-bullets">
              {page.benefits.slice(0, 2).map((benefit) => (
                <li key={benefit} className="pp-hero-bullet-item">
                  <CheckCircle2 size={16} className="pp-bullet-check" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: Hero image */}
          <div className="pp-hero-right">
            <div className="pp-image-wrapper">
              <div className="pp-image-glow" aria-hidden="true" />
              <img
                src={page.image}
                alt={page.imageAlt}
                className="pp-hero-image"
              />
              {/* Floating stat badge */}
              <div className="pp-floating-badge">
                <div className="pp-badge-icon">
                  <TrendingUp size={16} />
                </div>
                <div className="pp-badge-content">
                  <span className="pp-badge-value">{page.features[0].stat}</span>
                  <span className="pp-badge-label">{page.features[0].statLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================
         FEATURE CARDS GRID
         =================================================================== */}
      <section className="pp-features-section">
        <div className="pp-features-inner">
          <div className="pp-section-label">FEATURES</div>
          <h2 className="pp-section-title">
            Everything your school needs,<br />
            <span className="pp-section-title-accent">built in from day one</span>
          </h2>

          <div className="pp-features-grid">
            {page.features.map(({ Icon, cls, title, description, stat, statLabel }) => (
              <article key={title} className={`pp-feature-card pp-card-${cls}`}>
                <div className={`pp-feature-icon-box ${cls}`}>
                  <Icon size={20} />
                </div>
                {stat && (
                  <div className="pp-card-stat-row">
                    <span className="pp-card-stat-value">{stat}</span>
                    <span className="pp-card-stat-label">{statLabel}</span>
                  </div>
                )}
                <h3 className="pp-feature-title">{title}</h3>
                <p className="pp-feature-desc">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===================================================================
         BENEFITS SECTION
         =================================================================== */}
      <section className="pp-benefits-section">
        <div className="pp-benefits-inner">
          <div className="pp-benefits-left">
            <div className="pp-section-label">WHY VOLPEHUB</div>
            <h2 className="pp-benefits-title">{page.benefitTitle}</h2>
            <ul className="pp-benefits-list">
              {page.benefits.map((benefit) => (
                <li key={benefit} className="pp-benefit-item">
                  <div className="pp-benefit-check">
                    <CheckCircle2 size={18} />
                  </div>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <div className="pp-benefits-cta-row">
              <Link to="/contact" className="lp-cta-primary">
                <span>Book a walkthrough</span>
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>
          <div className="pp-benefits-right">
            <div className="pp-stat-card-grid">
              <div className="pp-stat-hero-card indigo">
                <Star size={28} className="pp-stat-hero-icon" />
                <div className="pp-stat-hero-number">4.9/5</div>
                <div className="pp-stat-hero-label">Average school satisfaction</div>
              </div>
              <div className="pp-stat-hero-card green">
                <School size={28} className="pp-stat-hero-icon" />
                <div className="pp-stat-hero-number">150+</div>
                <div className="pp-stat-hero-label">Schools onboarded</div>
              </div>
              <div className="pp-stat-hero-card blue">
                <Users size={28} className="pp-stat-hero-icon" />
                <div className="pp-stat-hero-number">80,000+</div>
                <div className="pp-stat-hero-label">Active students</div>
              </div>
              <div className="pp-stat-hero-card amber">
                <TrendingUp size={28} className="pp-stat-hero-icon" />
                <div className="pp-stat-hero-number">35%</div>
                <div className="pp-stat-hero-label">Average admin time saved</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================
         BOTTOM MODULES STRIP (same as landing page)
         =================================================================== */}
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

      {/* ===================================================================
         FOOTER
         =================================================================== */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={volpeLogo} alt="Volpehub Education logo" className="lp-footer-logo" />
            <span className="lp-footer-brand-text">VOLPEHUB EDUCATION</span>
            <span className="lp-footer-copy">
              &copy; {new Date().getFullYear()} Worexa Technologies. All rights reserved.
            </span>
          </div>
          <div className="lp-footer-links">
            <Link to="/platform">Platform</Link>
            <Link to="/solutions">Solutions</Link>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/security">Security</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
