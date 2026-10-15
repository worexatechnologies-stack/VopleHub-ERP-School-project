import { BRAND } from '../config/branding';

interface WorexaLogoProps {
  compact?: boolean;
  className?: string;
  iconClassName?: string;
}

export default function WorexaLogo({
  compact = false,
  className = '',
  iconClassName = 'h-6 w-6',
}: WorexaLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label={BRAND.displayName}>
      <svg viewBox="0 0 40 40" className={`${iconClassName} shrink-0`} role="img" aria-hidden="true">
        <defs><linearGradient id="worexa-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#4f46e5" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
        <rect width="40" height="40" rx="10" fill="url(#worexa-gradient)" />
        <path d="M8 11h5l3.1 14L20 14h4l3.9 11L31 11h5l-5.8 19h-4.4L22 19.4 18.2 30h-4.4L8 11Z" fill="white" />
      </svg>
      {!compact && <span className="text-[9px] font-bold tracking-wide">{BRAND.displayName}</span>}
    </span>
  );
}
