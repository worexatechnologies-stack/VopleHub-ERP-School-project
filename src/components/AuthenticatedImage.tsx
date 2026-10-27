import { useEffect, useState } from 'react';

import { API_BASE_URL } from '../services/api';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
}

/** Load private API image URLs with backend session credentials. */
export default function AuthenticatedImage({ src, alt, className, onLoad, onError }: AuthenticatedImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState('');

  useEffect(() => {
    if (!src) {
      setResolvedSrc('');
      return;
    }
    if (/^(data:|blob:|https?:)/.test(src)) {
      setResolvedSrc(src);
      return;
    }

    let cancelled = false;
    let objectUrl = '';
    const load = async () => {
      try {
        const response = await fetch(src.startsWith('/api/') ? src : `${API_BASE_URL}${src}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Image request failed');
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setResolvedSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setResolvedSrc('');
          onError?.();
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, onError]);

  return resolvedSrc ? <img src={resolvedSrc} alt={alt} className={className} onLoad={onLoad} onError={onError} /> : null;
}
