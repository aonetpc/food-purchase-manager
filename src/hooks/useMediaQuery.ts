import { useState, useEffect } from 'react';

/**
 * React hook for matching CSS media queries.
 * Returns true if the media query matches.
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = (q: string): boolean => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(q).matches;
  };

  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', handler);
    setMatches(media.matches);
    return () => media.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
