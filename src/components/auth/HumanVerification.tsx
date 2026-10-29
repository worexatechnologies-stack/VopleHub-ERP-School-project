import React, { useEffect, useRef, useState } from 'react';

interface HumanVerificationProps {
  onVerify: (token: string) => void;
  onReset?: () => void;
  resetKey?: number;
}

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | number;
  reset: (widgetId?: string | number) => void;
  remove?: (widgetId: string | number) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function HumanVerification({ onVerify, onReset, resetKey = 0 }: HumanVerificationProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'verified' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | number | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onResetRef = useRef(onReset);
  const siteKey = String(import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '').trim();

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onResetRef.current = onReset;
  }, [onVerify, onReset]);

  useEffect(() => {
    if (!siteKey) {
      setStatus('error');
      setErrorMessage('Cloudflare Turnstile is not configured. Please contact support.');
      onResetRef.current?.();
      return;
    }

    let cancelled = false;
    let script = document.querySelector<HTMLScriptElement>('script[data-volpehub-turnstile]');

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current !== null) {
        window.turnstile.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          size: 'normal',
          appearance: 'always',
          action: 'login',
          callback: (token: string) => {
            setStatus('verified');
            setErrorMessage(null);
            onVerifyRef.current(token);
          },
          'error-callback': (errorCode?: number | string) => {
            const code = errorCode == null ? '' : String(errorCode);
            const message = code === '110200'
              ? 'This website hostname is not authorized for the Turnstile widget.'
              : code === '400020' || code === '110100' || code === '110110'
              ? 'Cloudflare rejected the configured Turnstile Site Key.'
              : code === '400070'
              ? 'This Turnstile widget is disabled in Cloudflare.'
              : code === '400021'
              ? 'This Turnstile Site Key is configured for a different Cloudflare region.'
              : code === '200500'
              ? 'The Cloudflare challenge could not load. Check your network and retry.'
              : 'Cloudflare verification failed. Please retry.';
            setStatus('error');
            setErrorMessage(code ? `${message} (code ${code})` : message);
            onResetRef.current?.();
            return true;
          },
          'expired-callback': () => {
            setStatus('ready');
            setErrorMessage('Cloudflare verification expired. Please verify again.');
            onResetRef.current?.();
          },
          'timeout-callback': () => {
            setStatus('ready');
            setErrorMessage('Cloudflare verification timed out. Please verify again.');
            onResetRef.current?.();
          },
        });
        setStatus('ready');
        setErrorMessage(null);
      } catch {
        setStatus('error');
        setErrorMessage('Cloudflare verification could not start. Reload the page and retry.');
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.volpehubTurnstile = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', renderWidget);
      script.addEventListener('error', () => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage('Cloudflare could not load. Check your network and reload the page.');
      }, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey || resetKey === 0 || !window.turnstile || widgetIdRef.current === null) return;
    window.turnstile.reset(widgetIdRef.current);
    setStatus('ready');
    setErrorMessage(null);
    onResetRef.current?.();
  }, [resetKey, siteKey]);

  const retry = () => {
    if (!window.turnstile || widgetIdRef.current === null) {
      window.location.reload();
      return;
    }
    setErrorMessage(null);
    setStatus('ready');
    onResetRef.current?.();
    window.turnstile.reset(widgetIdRef.current);
  };

  return (
    <div className="my-2.5 flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2">
      <div ref={containerRef} className="grid min-h-[65px] min-w-[300px] place-items-center" />
      {status === 'loading' && (
        <p className="text-xs text-slate-500" role="status">Loading Cloudflare Turnstile…</p>
      )}
      {status === 'ready' && !errorMessage && (
        <p className="text-xs text-slate-500" role="status">Complete the Cloudflare security check.</p>
      )}
      {status === 'verified' && (
        <p className="text-xs font-semibold text-emerald-700" role="status">Cloudflare security check complete.</p>
      )}
      {errorMessage && (
        <div className="flex flex-col items-center gap-1" role="alert">
          <p className="text-center text-xs text-rose-600">{errorMessage}</p>
          <button
            type="button"
            onClick={retry}
            className="text-xs font-semibold text-indigo-700 underline underline-offset-2"
          >
            Retry Cloudflare verification
          </button>
        </div>
      )}
    </div>
  );
}
