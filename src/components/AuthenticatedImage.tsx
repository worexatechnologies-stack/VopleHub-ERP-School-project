import { useEffect, useState } from 'react';

import { API_BASE_URL } from '../services/api';
import { ACCESS_TOKEN_STORAGE_KEY } from '../utils/auth';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
}

/** Load private API image URLs with the JWT, without placing tokens in URLs. */
export default function AuthenticatedImage({ src, alt, className }: AuthenticatedImageProps) {
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
        const token = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
        const response = await fetch(src.startsWith('/api/') ? src : `${API_BASE_URL}${src}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Image request failed');
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setResolvedSrc(objectUrl);
      } catch {
        if (!cancelled) setResolvedSrc('');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return resolvedSrc ? <img src={resolvedSrc} alt={alt} className={className} /> : null;
}
