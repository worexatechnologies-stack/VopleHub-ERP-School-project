import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ArrowRight, Menu, X, Phone } from 'lucide-react';
import volpeLogo from '../../assets/volpe-logo.png';
import './LandingPage.css';

function WhatsAppIcon({ size = 15, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.11 6.84C8.94 6.84 8.66 6.9 8.43 7.15C8.2 7.4 7.56 8 7.56 9.22C7.56 10.44 8.45 11.62 8.57 11.78C8.7 11.95 10.29 14.41 12.74 15.46C13.32 15.71 13.78 15.86 14.13 15.97C14.72 16.16 15.26 16.13 15.69 16.07C16.17 16 17.16 15.47 17.36 14.9C17.57 14.33 17.57 13.84 17.51 13.74C17.45 13.63 17.28 13.57 17.03 13.45C16.78 13.33 15.54 12.72 15.31 12.63C15.08 12.55 14.92 12.51 14.75 12.76C14.58 13 14.1 13.57 13.96 13.74C13.81 13.9 13.67 13.92 13.42 13.8C13.17 13.67 12.37 13.41 11.42 12.56C10.68 11.9 10.18 11.09 10.03 10.84C9.89 10.59 10.01 10.45 10.14 10.33C10.25 10.22 10.39 10.03 10.52 9.89C10.64 9.74 10.68 9.64 10.77 9.47C10.85 9.3 10.81 9.16 10.75 9.04C10.68 8.92 10.19 7.71 9.99 7.22C9.79 6.75 9.58 6.81 9.43 6.81C9.28 6.8 9.11 6.84 9.11 6.84Z" />
    </svg>
  );
}

export default function MarketingNavbar() {
  const [open, setOpen] = useState(false);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  return (
    <header className="lp-navbar">
      <div className="lp-nav-container">
        {/* Brand Section */}
        <Link to="/" onClick={scrollToTop} className="lp-brand-group" aria-label="Volpehub Education home">
          <img
            src={volpeLogo}
            alt="Volpehub Education logo"
            className="h-10 sm:h-11 w-auto object-contain shrink-0"
          />
          <div className="lp-brand-divider" />
          <div className="lp-brand-subtitles">
            <span className="lp-sub-top">Education</span>
            <span className="lp-sub-bottom">School Management Portal</span>
          </div>
        </Link>

        {/* Right Action CTAs: Call, WhatsApp, Divider, Sign in, Book a demo */}
        <div className="lp-nav-actions">
          <a
            href="tel:+919187233625"
            className="lp-nav-btn-call"
            title="Call Us: +91 91872 33625"
          >
            <Phone size={14} className="lp-nav-call-icon" />
            <span>Call Us</span>
          </a>

          <a
            href="https://wa.me/919187233625?text=Hello%20VolpeHub%20Education%2C%20I%20would%20like%20to%20learn%20more%20about%20your%20school%20management%20platform"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-nav-btn-whatsapp"
            title="Chat on WhatsApp"
          >
            <WhatsAppIcon size={15} className="lp-nav-wa-icon" />
            <span>WhatsApp</span>
          </a>

          <div className="lp-nav-action-divider" />

          <Link
            to="/login"
            className="lp-btn-signin"
          >
            Sign in
          </Link>

          <Link
            to="/contact"
            onClick={scrollToTop}
            className="lp-btn-talk"
          >
            <span>Book a demo</span>
            <ArrowRight size={15} className="lp-talk-arrow" />
          </Link>
        </div>

        {/* Mobile Header Controls */}
        <div className="lp-nav-mobile-wrap">
          <a
            href="https://wa.me/919187233625?text=Hello%20VolpeHub%20Education%2C%20I%20would%20like%20to%20learn%20more%20about%20your%20school%20management%20platform"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-nav-mobile-wa"
            aria-label="Chat on WhatsApp"
            title="WhatsApp"
          >
            <WhatsAppIcon size={16} />
          </a>

          <a
            href="tel:+919187233625"
            className="lp-nav-mobile-call"
            aria-label="Call VolpeHub"
            title="Call Us"
          >
            <Phone size={14} />
          </a>

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="lp-hamburger-btn"
            aria-label="Toggle navigation"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer via Portal */}
      {open && typeof document !== 'undefined' && createPortal(
        <div className="lp-mobile-drawer-overlay" onClick={() => setOpen(false)}>
          <div className="lp-mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="lp-drawer-header">
              <Link to="/" className="lp-brand-group" onClick={() => setOpen(false)}>
                <img
                  src={volpeLogo}
                  alt="Volpehub Education logo"
                  className="h-9 w-auto object-contain shrink-0"
                />
              </Link>
              <button className="lp-drawer-close" onClick={() => setOpen(false)}>
                <X size={22} />
              </button>
            </div>

            {/* Quick Direct Contact Group inside Drawer */}
            <div className="lp-drawer-contact-group">
              <a
                href="tel:+919187233625"
                className="lp-drawer-contact-btn lp-drawer-call-btn"
                onClick={() => setOpen(false)}
              >
                <Phone size={15} />
                <span>Call +91 91872 33625</span>
              </a>
              <a
                href="https://wa.me/919187233625?text=Hello%20VolpeHub%20Education%2C%20I%20would%20like%20to%20learn%20more%20about%20your%20school%20management%20platform"
                target="_blank"
                rel="noopener noreferrer"
                className="lp-drawer-contact-btn lp-drawer-wa-btn"
                onClick={() => setOpen(false)}
              >
                <WhatsAppIcon size={16} />
                <span>Chat on WhatsApp</span>
              </a>
            </div>

            <div className="lp-drawer-actions" style={{ marginTop: 'auto' }}>
              <Link to="/login" className="lp-drawer-signin" onClick={() => setOpen(false)}>
                Sign in
              </Link>
              <Link
                to="/contact"
                className="lp-drawer-cta"
                onClick={() => {
                  scrollToTop();
                  setOpen(false);
                }}
              >
                Book a demo →
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
