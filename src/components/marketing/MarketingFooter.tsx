import { Link } from 'react-router';
import { Mail, Phone, MapPin, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import volpeLogo from '../../assets/volpe-logo.png';
import './LandingPage.css';

export default function MarketingFooter() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  return (
    <footer className="lp-footer">
      <div className="lp-footer-container">
        {/* Top 4-Column Grid */}
        <div className="lp-footer-top-grid">

          {/* Col 1: Brand & Purpose */}
          <div className="lp-footer-col-brand">
            <div className="lp-footer-logo-row">
              <img src={volpeLogo} alt="VolpeHub Education Logo" className="lp-footer-logo-img" />
              <span className="lp-footer-logo-title">VOLPEHUB EDUCATION</span>
            </div>

            <p className="lp-footer-brand-mission">
              Next-generation institutional management platform simplifying daily campus operations, digital attendance, automated fee collection, and real-time family transparency.
            </p>

            <div className="lp-footer-parent-tag">
              <ShieldCheck size={14} />
              <span>A Product of Worexa Technologies</span>
            </div>
          </div>

          {/* Col 2: Core Platform Modules */}
          <div>
            <h4 className="lp-footer-col-heading">Institution Modules</h4>
            <ul className="lp-footer-link-list">
              <li className="lp-footer-link-item">
                <a href="/#modules">Admin Dashboard</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Academic Setup &amp; Classes</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Student &amp; Staff Directory</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Roster &amp; Live Attendance</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Examinations &amp; Gradebooks</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Fee Invoicing &amp; Payroll</a>
              </li>
              <li className="lp-footer-link-item">
                <a href="/#modules">Transport GPS Fleet Tracking</a>
              </li>
            </ul>
          </div>

          {/* Col 3: Dedicated Portals */}
          <div>
            <h4 className="lp-footer-col-heading">User Portals</h4>
            <ul className="lp-footer-link-list">
              <li className="lp-footer-link-item">
                <Link to="/login">School Admin Portal</Link>
              </li>
              <li className="lp-footer-link-item">
                <Link to="/login">Teacher Classroom Suite</Link>
              </li>
              <li className="lp-footer-link-item">
                <Link to="/login">Parent &amp; Family App</Link>
              </li>
              <li className="lp-footer-link-item">
                <Link to="/login">Student Learning Desk</Link>
              </li>
              <li className="lp-footer-link-item">
                <Link to="/super-admin">Super Admin Network</Link>
              </li>
              <li className="lp-footer-link-item">
                <Link to="/contact" onClick={scrollToTop}>Request Custom Demo</Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Contact & Support */}
          <div>
            <h4 className="lp-footer-col-heading">Contact &amp; Support</h4>
            <div className="lp-footer-contact-item">
              <Phone size={16} className="lp-footer-contact-icon" />
              <div>
                <a href="tel:+919187233625">+91 91872 33625</a>
                <br />
                <a href="tel:+919187233616">+91 91872 33616</a>
              </div>
            </div>

            <div className="lp-footer-contact-item">
              <Mail size={16} className="lp-footer-contact-icon" />
              <div>
                <a href="mailto:info.volpehub@gmail.com">info.volpehub@gmail.com</a>
                <br />
                <a href="mailto:info@worexatechnologies.com">info@worexatechnologies.com</a>
              </div>
            </div>

            <div className="lp-footer-contact-item">
              <MapPin size={16} className="lp-footer-contact-icon" />
              <span>Gopalan Workspace, Banashankari 3rd Stage, Bengaluru, Karnataka 560085</span>
            </div>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="lp-footer-bottom">
          <p className="lp-footer-bottom-copy">
            © {new Date().getFullYear()} Worexa Technologies. All rights reserved. Built with precision for modern schools.
          </p>
          <div className="lp-footer-bottom-links">
            <Link to="/" onClick={scrollToTop}>Home</Link>
            <Link to="/contact" onClick={scrollToTop}>Contact Us</Link>
            <Link to="/login">Sign In</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

