import { useState, useEffect, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, CheckCircle2, Clock3, Headphones, Mail,
  MapPin, MessageSquareText, Phone, Send, Check
} from 'lucide-react';
import volpeLogo from '../../assets/volpe-logo.png';
import MarketingNavbar from './MarketingNavbar';
import './LandingPage.css';

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', schoolName: '', role: '', city: '', message: ''
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setToastMessage('Enquiry received! We\'ll be in touch soon.');
    setTimeout(() => setToastMessage(null), 3200);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <div className="lp-root">

      {/* Toast */}
      {toastMessage && (
        <div className="lp-toast" role="status">
          <Check size={16} className="lp-toast-icon" />
          <span>{toastMessage}</span>
        </div>
      )}

      <MarketingNavbar />

      {/* ═══════════════════════════════════════════════════════════════════
         HERO SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="pp-hero-section pp-hero-contact">
        <div className="lp-ambient-layer" aria-hidden="true">
          <div className="lp-ambient-glow lp-glow-top" />
          <div className="lp-ambient-glow lp-glow-center" />
        </div>

        <div className="pp-contact-hero-inner">
          {/* Eyebrow pill */}
          <div className="lp-hero-tag">
            <span className="lp-hero-tag-dot" />
            LET&apos;S CONNECT
          </div>

          {/* Headline */}
          <h1 className="lp-hero-headline pp-contact-headline">
            See what a calmer school day
            <br />
            <span className="lp-highlight-purple-wrapper">
              <span className="lp-highlight-purple">can look like</span>
              <svg className="lp-brush-stroke" viewBox="0 0 310 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6 14C65 5 190 4 304 12C240 17 140 18 45 19"
                  stroke="#818cf8"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </h1>

          <p className="pp-contact-subtitle">
            Tell us about your school and the workflows you want to improve. Our team will help you
            find the right starting point for Volpehub Education.
          </p>

          {/* Trust badges row */}
          <div className="pp-contact-trust-row">
            <div className="pp-contact-trust-item">
              <MessageSquareText size={16} className="pp-trust-icon" />
              <span>Personalised walkthrough</span>
            </div>
            <div className="pp-contact-trust-item">
              <Headphones size={16} className="pp-trust-icon" />
              <span>Helpful guidance</span>
            </div>
            <div className="pp-contact-trust-item">
              <Clock3 size={16} className="pp-trust-icon" />
              <span>Thoughtful follow-up</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         FORM + SIDEBAR SECTION
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="pp-contact-body">
        <div className="pp-contact-grid">

          {/* Left Sidebar */}
          <aside className="pp-contact-aside">
            <div className="pp-section-label">TALK WITH OUR TEAM</div>
            <h2 className="pp-aside-title">A simple conversation to start.</h2>
            <p className="pp-aside-text">
              Whether you are exploring a new school system or improving an existing process, we will listen first and help you plan the next step.
            </p>

            <div className="pp-contact-details-list">
              <ContactDetail
                icon={MessageSquareText}
                title="Personalised walkthrough"
                text="Discuss the modules and school roles that matter to you."
              />
              <ContactDetail
                icon={Headphones}
                title="Helpful guidance"
                text="Get clear answers on setup, rollout and everyday use."
              />
              <ContactDetail
                icon={Clock3}
                title="Thoughtful follow-up"
                text="We will respond to your enquiry as soon as possible."
              />
            </div>

            {/* Already using card */}
            <div className="pp-already-using-card">
              <p className="pp-already-title">Already using Volpehub?</p>
              <p className="pp-already-text">
                Sign in to your workspace to continue managing your school day.
              </p>
              <Link to="/login" className="pp-already-link">
                Open workspace <ArrowRight size={14} />
              </Link>
            </div>
          </aside>

          {/* Right: Form */}
          <div className="pp-contact-form-card">
            {submitted ? (
              <div className="pp-form-success">
                <div className="pp-success-icon-wrap">
                  <CheckCircle2 size={36} />
                </div>
                <h2 className="pp-success-title">Thanks — we&apos;ve received your enquiry.</h2>
                <p className="pp-success-text">Our team will review the details and be in touch soon.</p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="lp-cta-primary pp-reset-btn"
                >
                  Send another enquiry
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="pp-form-inner">
                <div className="pp-section-label">REQUEST A CONVERSATION</div>
                <h2 className="pp-form-title">Tell us about your school.</h2>

                <div className="pp-form-grid">
                  <FormInput label="Your name" name="name" value={form.name} onChange={handleChange} required placeholder="Full name" />
                  <FormInput label="Work email" name="email" type="email" value={form.email} onChange={handleChange} required placeholder="you@school.edu" />
                  <FormInput label="Phone number" name="phone" value={form.phone} onChange={handleChange} placeholder="+91 00000 00000" />
                  <FormInput label="School name" name="schoolName" value={form.schoolName} onChange={handleChange} required placeholder="Your institution's name" />
                  <FormSelect
                    label="Your role"
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                    options={['School owner / leadership', 'School administrator', 'Teacher', 'IT / operations', 'Other']}
                  />
                  <FormInput label="City / location" name="city" value={form.city} onChange={handleChange} placeholder="e.g. Bengaluru" />
                </div>

                <div className="pp-form-textarea-wrap">
                  <label className="pp-form-label">
                    What would you like to improve?
                    <textarea
                      name="message"
                      value={form.message}
                      onChange={handleChange}
                      rows={4}
                      placeholder="For example: admissions, attendance, fees, parent communication or academic reporting."
                      className="pp-form-textarea"
                    />
                  </label>
                </div>

                <button type="submit" className="lp-cta-primary pp-submit-btn">
                  <Send size={16} />
                  <span>Send enquiry</span>
                </button>

                <p className="pp-form-note">
                  By submitting this form, you are asking our team to contact you about Volpehub Education.
                </p>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
         QUICK CONTACT INFO STRIP
         ═══════════════════════════════════════════════════════════════════ */}
      <section className="pp-contact-info-strip">
        <div className="pp-contact-info-inner">
          <QuickContact
            icon={Phone}
            title="Call Us"
            detail="+91 9187233616"
            text="Mon–Sat from 8 am to 6 pm."
            href="tel:+919187233616"
          />
          <QuickContact
            icon={Mail}
            title="Email Us"
            detail="info@worexatechnologies.com"
            text="We'll get back to you within 24 hours."
            href="mailto:info@worexatechnologies.com"
          />
          <QuickContact
            icon={MapPin}
            title="Visit Us"
            detail="Worexa Technologies"
            text="Gopalan Workspace, 4th Floor, 3rd Phase, Banashankari 3rd Stage, Bengaluru, Karnataka 560085"
          />
        </div>
      </section>

      {/* ─── FOOTER ────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={volpeLogo} alt="Volpehub Education logo" className="lp-footer-logo" />
            <span className="lp-footer-brand-text">VOLPEHUB EDUCATION</span>
            <span className="lp-footer-copy">© {new Date().getFullYear()} Worexa Technologies. All rights reserved.</span>
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

// ─── Sub-components ──────────────────────────────────────────────────────────
function FormInput({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="pp-form-label">
      {label}
      <input {...props} className="pp-form-input" />
    </label>
  );
}

function FormSelect({ label, options, ...props }: { label: string; options: string[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="pp-form-label">
      {label}
      <select {...props} className="pp-form-select">
        <option value="">Select your role</option>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ContactDetail({ icon: Icon, title, text }: { icon: typeof Mail; title: string; text: string }) {
  return (
    <div className="pp-contact-detail-row">
      <span className="pp-contact-detail-icon">
        <Icon size={18} />
      </span>
      <div>
        <h3 className="pp-contact-detail-title">{title}</h3>
        <p className="pp-contact-detail-text">{text}</p>
      </div>
    </div>
  );
}

function QuickContact({ icon: Icon, title, detail, text, href }: {
  icon: typeof Mail; title: string; detail: string; text: string; href?: string
}) {
  const inner = (
    <>
      <span className="pp-quick-contact-icon">
        <Icon size={20} />
      </span>
      <div>
        <p className="pp-quick-contact-title">{title}</p>
        <p className="pp-quick-contact-detail">{detail}</p>
        <p className="pp-quick-contact-text">{text}</p>
      </div>
    </>
  );
  return href
    ? <a href={href} className="pp-quick-contact-card pp-quick-contact-link">{inner}</a>
    : <div className="pp-quick-contact-card">{inner}</div>;
}
