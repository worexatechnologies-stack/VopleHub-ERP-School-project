import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Menu, X } from 'lucide-react';
import volpeLogo from '../../assets/volpe-logo.png';
import './LandingPage.css';

const links = [
  { label: 'Platform', to: '/platform', id: 'platform' },
  { label: 'Solutions', to: '/solutions', id: 'solutions' },
  { label: 'How it works', to: '/how-it-works', id: 'how-it-works' },
  { label: 'Security', to: '/security', id: 'security' },
  { label: 'Contact', to: '/contact', id: 'contact' },
];

export default function MarketingNavbar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

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

        {/* Center Nav Links */}
        <nav className="lp-nav-links" aria-label="Primary navigation">
          {links.map(({ label, to, id }) => {
            const isActive = (id === 'platform' && (pathname === '/' || pathname === '/platform')) ||
              (id === 'contact' && (pathname === '/contact' || pathname === '/demo')) ||
              pathname === to;
            return (
              <Link
                key={id}
                to={to}
                onClick={scrollToTop}
                className={`lp-nav-link ${isActive ? 'active' : ''}`}
              >
                {label}
                {isActive && <span className="lp-nav-active-bar" />}
              </Link>
            );
          })}
        </nav>

        {/* Right CTA */}
        <div className="lp-nav-actions">
          <Link
            to="/login"
            className="lp-btn-signin"
          >
            Sign in
          </Link>
          <Link
            to="/demo"
            onClick={scrollToTop}
            className="lp-btn-talk"
          >
            <span>Talk to us</span>
            <ArrowRight size={15} className="lp-talk-arrow" />
          </Link>
        </div>

        {/* Mobile Hamburger */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="lp-hamburger-btn"
          aria-label="Toggle navigation"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
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
            <nav className="lp-drawer-links">
              {links.map(({ label, to, id }) => (
                <Link
                  key={id}
                  to={to}
                  className="lp-drawer-link"
                  onClick={() => {
                    scrollToTop();
                    setOpen(false);
                  }}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="lp-drawer-actions">
              <Link to="/login" className="lp-drawer-signin" onClick={() => setOpen(false)}>
                Sign in
              </Link>
              <Link
                to="/demo"
                className="lp-drawer-cta"
                onClick={() => {
                  scrollToTop();
                  setOpen(false);
                }}
              >
                Talk to us →
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
