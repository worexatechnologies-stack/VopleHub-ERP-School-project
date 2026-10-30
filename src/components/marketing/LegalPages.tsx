import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Mail, ShieldCheck, Scale } from 'lucide-react';
import { Link } from 'react-router';
import MarketingNavbar from './MarketingNavbar';
import MarketingFooter from './MarketingFooter';
import './LegalPages.css';

type LegalSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const lastUpdated = '30 October 2026';

const privacySections: LegalSection[] = [
  {
    id: 'overview',
    title: '1. About this policy',
    paragraphs: [
      'This Privacy Policy explains how Worexa Technologies (“Worexa”, “we”, “us”) handles information when you use Volpehub Education, our school management platform, websites, and related support services (together, the “Services”).',
      'Schools use Volpehub to manage their communities. A school may decide what student, parent, and staff information to enter and how its authorised users use it. For those records, the school’s notices and instructions also apply. This policy describes Worexa’s handling of information for operating and supporting the Services.',
    ],
  },
  {
    id: 'information',
    title: '2. Information we handle',
    paragraphs: ['Depending on which Services a school enables and how you use them, information may include:'],
    bullets: [
      'Account details such as name, email address, phone number, role, school, and sign-in or security settings.',
      'School records entered by authorised users, such as student and family details, attendance, classes, marks, fees, payroll, documents, messages, and admissions information.',
      'Information you submit to us through enquiries, support requests, feedback, or forms.',
      'Service and device information such as browser type, log data, approximate connection details, and security events needed to operate, troubleshoot, and protect the Services.',
      'Payment or order details needed to record a school-store transaction. Payment credentials are handled by the payment provider where applicable.',
    ],
  },
  {
    id: 'use',
    title: '3. How information is used',
    paragraphs: ['We use information as needed to:'],
    bullets: [
      'Provide school management, learning, communication, admissions, and administrative features requested by a school.',
      'Create and manage accounts, authenticate users, apply role and school permissions, and support account recovery.',
      'Send service notices, school communications, and support responses.',
      'Maintain service reliability, investigate errors, prevent misuse, and protect users and school records.',
      'Meet legal obligations and enforce our agreements.',
    ],
  },
  {
    id: 'sharing',
    title: '4. When information is shared',
    paragraphs: [
      'Information is made available to the school and its authorised users according to the school’s configuration and user permissions. We may use service providers that help host, secure, maintain, or support the Services; they receive only the information needed for their work and are subject to appropriate confidentiality and data-protection terms.',
      'We may disclose information when required by law, to respond to valid legal process, to protect people or the Services, or as part of a business transfer subject to applicable safeguards. We do not publish private school records for advertising.',
    ],
  },
  {
    id: 'children',
    title: '5. Students and children',
    paragraphs: [
      'Volpehub is designed for school communities and may contain information about students, including children. Schools and parents or guardians should use the Services in accordance with applicable requirements and the school’s policies. Student accounts should be created and supervised by the school or an authorised parent or guardian, as appropriate.',
      'If you believe a child’s information was submitted to the Services improperly, contact the school that manages the account or write to us at info@worexatechnologies.com so we can help route the request.',
    ],
  },
  {
    id: 'security-retention',
    title: '6. Security and retention',
    paragraphs: [
      'We use administrative, technical, and organisational safeguards designed to protect information against unauthorised access, loss, or misuse. No online service can guarantee absolute security. Please protect passwords, use assigned accounts only, and report suspected unauthorised access promptly.',
      'We retain information while it is needed to provide the Services, meet our agreements, resolve disputes, and comply with legal obligations. Schools control many operational records and should direct retention or deletion requests for those records to their school administrator. Copies may remain in protected backups for a limited period before they are overwritten.',
    ],
  },
  {
    id: 'choices',
    title: '7. Your choices and requests',
    paragraphs: [
      'For student, parent, or staff records managed by a school, contact that school first; it can review the request and instruct us where appropriate. For an account or enquiry that Worexa manages directly, contact us using the details below. We may need to verify your identity and coordinate with the school before acting.',
      'You can also manage certain account details and communication preferences in the Services. Some information is required for the Services to function, so removing it may affect access or features.',
    ],
  },
  {
    id: 'cookies',
    title: '8. Cookies and browser storage',
    paragraphs: [
      'The Services may use cookies or browser storage for sign-in sessions, security, user preferences, and essential application functions. Blocking this storage may prevent some features from working. Your browser provides controls for reviewing and clearing stored site data.',
    ],
  },
  {
    id: 'transfers-changes',
    title: '9. Processing locations and policy updates',
    paragraphs: [
      'Worexa and its service providers may process information in locations where they or their infrastructure operate, subject to applicable safeguards and agreements.',
      'We may update this policy as the Services or legal requirements change. We will update the date above and, where appropriate, provide notice through the Services or to the school. The revised policy applies from its stated effective date.',
    ],
  },
  {
    id: 'contact',
    title: '10. Contact us',
    paragraphs: [
      'For questions about this policy or Worexa’s handling of information, contact info@worexatechnologies.com. For information collected and managed by your school, contact the school administrator as well.',
      'Worexa Technologies, Gopalan Workspace, Banashankari 3rd Stage, Bengaluru, Karnataka 560085, India.',
    ],
  },
];

const termsSections: LegalSection[] = [
  {
    id: 'agreement',
    title: '1. Agreement and scope',
    paragraphs: [
      'These Terms and Conditions (“Terms”) govern access to Volpehub Education and related websites and services provided by Worexa Technologies (“Worexa”, “we”, “us”). By accessing or using the Services, you agree to these Terms. If you use the Services for a school or organisation, you confirm that you are authorised to accept these Terms for it.',
      'A separate school subscription, order form, or written agreement may set additional terms. If it conflicts with these Terms, the signed agreement applies to that conflict.',
    ],
  },
  {
    id: 'service',
    title: '2. The Services',
    paragraphs: [
      'Volpehub provides tools for school administration, student information, academics, attendance, fees, communication, admissions, and related workflows. Available features may depend on the school’s subscription, configuration, user role, and technical requirements. We may change or improve features over time while taking reasonable steps to avoid disrupting school operations.',
    ],
  },
  {
    id: 'accounts',
    title: '3. Accounts and access',
    paragraphs: ['You agree to:'],
    bullets: [
      'Provide accurate information and keep account details current.',
      'Keep passwords and authentication factors confidential, use your own account, and notify your school or Worexa promptly if you suspect unauthorised access.',
      'Follow your school’s access rules and use only the records and functions permitted for your role.',
      'Ensure that people who receive accounts are authorised and that access is removed when it is no longer needed.',
    ],
  },
  {
    id: 'school-responsibilities',
    title: '4. School responsibilities and school data',
    paragraphs: [
      'The school is responsible for its use of the Services, its user permissions, the accuracy and lawful submission of school data, and the notices or permissions it must provide to students, parents, staff, and other individuals. The school must not upload information it is not authorised to share or use the Services to make decisions without appropriate human review.',
      'The school retains its rights in the data it submits. It grants Worexa permission to host, process, transmit, and display that data only as needed to provide, secure, and support the Services and as otherwise permitted by the school’s agreement or law.',
    ],
  },
  {
    id: 'acceptable-use',
    title: '5. Acceptable use',
    paragraphs: ['You must not:'],
    bullets: [
      'Use the Services unlawfully, to harm or exploit another person, or in a way that violates a student’s privacy or safety.',
      'Attempt to access another school’s data, bypass permissions, probe or disrupt security, or interfere with service availability.',
      'Upload malware, infringing material, or content that you have no right to provide.',
      'Reverse engineer, copy, resell, or misuse the Services except where applicable law permits or Worexa has authorised it in writing.',
    ],
  },
  {
    id: 'privacy-third-party',
    title: '6. Privacy and third-party services',
    paragraphs: [
      'Our Privacy Policy explains information handling and forms part of these Terms. Schools remain responsible for their own privacy notices and instructions for school data. Some features may connect to third-party services, such as payment providers or messaging tools; those services may have separate terms and privacy policies.',
    ],
  },
  {
    id: 'fees',
    title: '7. Fees, orders, and payments',
    paragraphs: [
      'Any subscription fees, billing schedule, renewal, cancellation, or refund terms are set out in the applicable school order or written agreement. Store orders and payment processing may be subject to additional checkout terms from the school or payment provider. You are responsible for reviewing the amount and order details before confirming a transaction.',
    ],
  },
  {
    id: 'ownership',
    title: '8. Intellectual property',
    paragraphs: [
      'Worexa and its licensors own the Services, software, design, and related materials, excluding school data and third-party materials. These Terms grant you a limited, non-exclusive, non-transferable right to use the Services for their intended purpose while your account or school subscription is active. No other rights are transferred.',
    ],
  },
  {
    id: 'availability',
    title: '9. Availability, suspension, and termination',
    paragraphs: [
      'We work to keep the Services available, but access may be interrupted for maintenance, updates, security events, network or provider failures, or circumstances beyond our control. We may restrict or suspend access where reasonably necessary to protect users, data, the Services, or to address a material breach. Schools should contact Worexa to coordinate account closure and data export or deletion under their agreement.',
    ],
  },
  {
    id: 'warranties-liability',
    title: '10. Disclaimers and liability',
    paragraphs: [
      'The Services are provided as a software platform and do not replace a school’s professional, educational, safeguarding, financial, or legal judgment. To the extent permitted by applicable law, the Services are provided without warranties beyond those expressly stated in a written agreement.',
      'Nothing in these Terms excludes liability that cannot legally be excluded. Subject to that limit and any signed agreement, Worexa is not responsible for indirect or consequential loss, or for decisions made from data entered by users or generated through school workflows. The school remains responsible for reviewing important records and decisions.',
    ],
  },
  {
    id: 'changes-law',
    title: '11. Changes and applicable law',
    paragraphs: [
      'We may update these Terms by posting a revised version with a new update date. If a change materially affects school use, we will provide reasonable notice through the Services or to the school where practicable. Continued use after the effective date means the revised Terms apply, subject to any signed agreement and rights that cannot be waived.',
      'These Terms are governed by the laws of India, subject to applicable mandatory consumer protections. Courts of competent jurisdiction in Bengaluru, Karnataka will hear disputes, unless applicable law or a written agreement requires another forum.',
    ],
  },
  {
    id: 'contact',
    title: '12. Contact',
    paragraphs: [
      'Questions about these Terms can be sent to info@worexatechnologies.com or addressed to Worexa Technologies, Gopalan Workspace, Banashankari 3rd Stage, Bengaluru, Karnataka 560085, India.',
    ],
  },
];

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms & Conditions';
  const description = isPrivacy
    ? 'A clear guide to the information Volpehub handles and how schools, families, and staff can ask questions about it.'
    : 'The simple rules for using Volpehub Education safely and responsibly.';
  const sections = isPrivacy ? privacySections : termsSections;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [kind]);

  return (
    <div className="lp-root legal-page">
      <MarketingNavbar />
      <main>
        <section className="legal-hero">
          <div className="legal-hero-glow legal-hero-glow-one" aria-hidden="true" />
          <div className="legal-hero-glow legal-hero-glow-two" aria-hidden="true" />
          <div className="legal-container legal-hero-content">
            <Link className="legal-back-link" to="/">
              <ArrowLeft size={15} /> Back to home
            </Link>
            <div className="legal-eyebrow">
              {isPrivacy ? <ShieldCheck size={15} /> : <Scale size={15} />}
              <span>VOLPEHUB EDUCATION · {isPrivacy ? 'PRIVACY' : 'SERVICE TERMS'}</span>
            </div>
            <h1>{title}</h1>
            <p>{description}</p>
            <div className="legal-updated"><CalendarDays size={15} /> Last updated {lastUpdated}</div>
          </div>
        </section>

        <section className="legal-body legal-container">
          <aside className="legal-toc" aria-label={`${title} sections`}>
            <span className="legal-toc-label">ON THIS PAGE</span>
            <nav>
              {sections.map((section) => (
                <a key={section.id} href={`#${section.id}`}>{section.title.replace(/^\d+\. /, '')}</a>
              ))}
            </nav>
            <div className="legal-toc-help">
              <Mail size={17} />
              <span>Need help understanding something?</span>
              <a href="mailto:info@worexatechnologies.com">Contact our team <ArrowRight size={13} /></a>
            </div>
          </aside>

          <article className="legal-document">
            <div className="legal-intro-card">
              <span className="legal-intro-icon">{isPrivacy ? <ShieldCheck size={20} /> : <Scale size={20} />}</span>
              <p>{isPrivacy
                ? 'We build tools for school communities. This page explains the practical basics of how information is handled when you use those tools.'
                : 'These terms are written to make responsibilities clear for schools, staff, families, and other people who use the platform.'}</p>
            </div>

            {sections.map((section) => (
              <section className="legal-section" id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets && (
                  <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
                )}
              </section>
            ))}

            <div className="legal-bottom-nav">
              <span>Related information</span>
              <div>
                <Link to={isPrivacy ? '/terms-and-conditions' : '/privacy-policy'}>
                  {isPrivacy ? 'Terms & Conditions' : 'Privacy Policy'} <ArrowRight size={14} />
                </Link>
                <Link to="/contact">Contact Worexa <ArrowRight size={14} /></Link>
              </div>
            </div>
          </article>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

export function PrivacyPolicyPage() {
  return <LegalPage kind="privacy" />;
}

export function TermsAndConditionsPage() {
  return <LegalPage kind="terms" />;
}
