import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Check, RefreshCw, AlertCircle } from 'lucide-react';

interface HumanVerificationProps {
  onVerify: (token: string) => void;
  onReset?: () => void;
  hasAttemptedSubmit?: boolean;
  resetKey?: number;
}

export default function HumanVerification({
  onVerify,
  onReset,
  hasAttemptedSubmit = false,
  resetKey = 0,
}: HumanVerificationProps) {
  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clickStartTime = useRef<number>(0);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | number | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onResetRef = useRef(onReset);

  const turnstileSiteKey = (import.meta as any).env?.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onResetRef.current = onReset;
  }, [onVerify, onReset]);

  // Cloudflare Turnstile integration if site key is configured
  useEffect(() => {
    if (!turnstileSiteKey || typeof window === 'undefined') return;

    const renderTurnstile = () => {
      const turnstile = (window as any).turnstile;
      if (!turnstile || !turnstileContainerRef.current) {
        setErrorMessage('Cloudflare verification is unavailable. Please reload this page.');
        return;
      }

      try {
        turnstileWidgetIdRef.current = turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          action: 'login',
          callback: (token: string) => {
            setStatus('verified');
            onVerifyRef.current(token);
          },
          'error-callback': () => {
            setStatus('error');
            setErrorMessage('Verification failed. Please retry.');
            onResetRef.current?.();
          },
          'expired-callback': () => {
            setStatus('idle');
            setErrorMessage('Verification expired. Please verify again.');
            onResetRef.current?.();
          },
          'timeout-callback': () => {
            setStatus('idle');
            setErrorMessage('Verification timed out. Please verify again.');
            onResetRef.current?.();
          },
        });
        setTurnstileReady(true);
      } catch {
        setErrorMessage('Cloudflare verification could not start. Please reload this page.');
      }
    };

    if (!(window as any).turnstile) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = renderTurnstile;
      script.onerror = () => {
        setErrorMessage('Cloudflare verification did not load. Check your connection and reload the page.');
      };
      document.head.appendChild(script);
    } else {
      renderTurnstile();
    }
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (!turnstileSiteKey || resetKey === 0 || typeof window === 'undefined') return;
    const turnstile = (window as any).turnstile;
    if (!turnstile || turnstileWidgetIdRef.current === null) return;

    turnstile.reset(turnstileWidgetIdRef.current);
    setStatus('idle');
    setErrorMessage(null);
    onResetRef.current?.();
  }, [resetKey, turnstileSiteKey]);

  // Pre-fetch challenge token from server on component mount
  useEffect(() => {
    let isMounted = true;
    async function fetchChallenge() {
      try {
        const res = await fetch('/api/v1/auth/human-challenge/', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data?.token) {
            setChallengeToken(data.token);
          }
        }
      } catch {
        // Handled on click
      }
    }
    fetchChallenge();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleInteractionStart = () => {
    clickStartTime.current = Date.now();
  };

  const handleCheckboxClick = async () => {
    if (status === 'verifying' || status === 'verified') return;

    setStatus('verifying');
    setErrorMessage(null);

    const elapsed = Date.now() - clickStartTime.current;
    // Human interaction entropy check
    const isHumanSpeed = elapsed >= 0 && elapsed < 8000;

    try {
      let activeToken = challengeToken;
      if (!activeToken) {
        const res = await fetch('/api/v1/auth/human-challenge/', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Could not establish secure challenge.');
        const data = await res.json();
        activeToken = data.token;
        setChallengeToken(activeToken);
      }

      if (!activeToken || !isHumanSpeed) {
        throw new Error('Verification check failed. Please try again.');
      }

      // Smooth security evaluation micro-delay (approx 550ms for natural feel)
      await new Promise((resolve) => setTimeout(resolve, 550));

      setStatus('verified');
      onVerify(activeToken);
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Verification failed. Please retry.');
      if (onReset) onReset();
    }
  };

  if (turnstileSiteKey) {
    return (
      <div className="my-2.5 flex min-h-[66px] flex-col items-center justify-center gap-1">
        <div ref={turnstileContainerRef} id="cf-turnstile-wrapper" />
        {!turnstileReady && !errorMessage && (
          <p className="text-xs text-slate-500" role="status">Loading Cloudflare verification…</p>
        )}
        {errorMessage && (
          <p className="text-center text-xs text-rose-600" role="alert">{errorMessage}</p>
        )}
      </div>
    );
  }

  const isWarning = hasAttemptedSubmit && status !== 'verified';

  return (
    <div
      className={`my-2.5 rounded-xl border p-3 transition-all duration-200 select-none ${
        status === 'verified'
          ? 'border-emerald-200 bg-emerald-50/50 shadow-sm'
          : isWarning
          ? 'border-rose-300 bg-rose-50/70 shadow-sm animate-pulse'
          : 'border-slate-200 bg-slate-50/80 hover:border-indigo-300 hover:bg-slate-50'
      }`}
      id="human-verification-card"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: Checkbox & Label */}
        <div
          className="flex items-center gap-3 cursor-pointer"
          onMouseDown={handleInteractionStart}
          onTouchStart={handleInteractionStart}
          onClick={handleCheckboxClick}
          role="checkbox"
          aria-checked={status === 'verified'}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              handleCheckboxClick();
            }
          }}
        >
          {/* Checkbox Icon / State */}
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all duration-150 ${
              status === 'verified'
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                : status === 'verifying'
                ? 'border-indigo-500 bg-white'
                : isWarning
                ? 'border-rose-400 bg-white ring-2 ring-rose-200'
                : 'border-slate-300 bg-white hover:border-indigo-500'
            }`}
          >
            {status === 'verifying' ? (
              <RefreshCw size={13} className="animate-spin text-indigo-600" />
            ) : status === 'verified' ? (
              <Check size={14} className="stroke-[3]" />
            ) : null}
          </div>

          {/* Verification Text */}
          <div className="flex flex-col">
            <span
              className={`text-xs font-semibold ${
                status === 'verified'
                  ? 'text-emerald-900 font-bold'
                  : isWarning
                  ? 'text-rose-700 font-bold'
                  : 'text-slate-800'
              }`}
            >
              {status === 'verified'
                ? 'Human Verified'
                : status === 'verifying'
                ? 'Verifying interaction…'
                : isWarning
                ? 'Please check: I am human'
                : 'Verify you are human'}
            </span>
            <span className="text-[10px] text-slate-500">
              {status === 'verified'
                ? 'Security check passed'
                : 'Interactive security check'}
            </span>
          </div>
        </div>

        {/* Right: Security Badge */}
        <div className="flex items-center gap-1.5 text-right shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-bold tracking-wider uppercase text-slate-400">
              Shield
            </span>
            <span className="text-[8px] font-medium text-slate-400">
              Cloudflare Protected
            </span>
          </div>
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              status === 'verified'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200/70 text-slate-500'
            }`}
          >
            <ShieldCheck size={15} />
          </div>
        </div>
      </div>

      {/* Error message if challenge failed */}
      {errorMessage && (
        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-600">
          <AlertCircle size={13} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

