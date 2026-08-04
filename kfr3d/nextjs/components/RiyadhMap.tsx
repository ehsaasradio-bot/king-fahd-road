'use client';

import { useEffect, useRef, type CSSProperties, type Ref } from 'react';
import type { KfrMapElement } from '../types/kfr-map';

let loader: Promise<void> | null = null;

/** Loads /kfr-map.js exactly once, no matter how many maps are on the page. */
export function loadKfrMap(src = '/kfr-map.js'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (customElements.get('kfr-map')) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loader = null;
        reject(new Error(`failed to load ${src}`));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

export interface RiyadhMapProps {
  /** 'overview' | 'kingdom' | 'kafd' | 'faisaliah' or any landmark name */
  view?: string;
  sidebar?: boolean;
  interactive?: boolean;
  orbit?: boolean;
  night?: boolean;
  /** where kfr-map.js is served from (defaults to /kfr-map.js in /public) */
  src?: string;
  className?: string;
  style?: CSSProperties;
  onReady?: (el: KfrMapElement) => void;
}

export type { KfrMapElement };

export default function RiyadhMap({
  view,
  sidebar = true,
  interactive = true,
  orbit = false,
  night = false,
  src = '/kfr-map.js',
  className,
  style,
  onReady,
}: RiyadhMapProps) {
  const ref = useRef<KfrMapElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadKfrMap(src);
    const el = ref.current;
    if (!el) return;
    const handleReady = () => {
      if (cancelled || !ref.current) return;
      if (night) ref.current.setNight(1);
      onReady?.(ref.current);
    };
    if (el.api) handleReady();
    else el.addEventListener('kfr-ready', handleReady, { once: true });
    return () => {
      cancelled = true;
      el.removeEventListener('kfr-ready', handleReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* keep the live map in sync when props change after mount */
  useEffect(() => { if (ref.current?.api) ref.current.setInteractive(interactive); }, [interactive]);
  useEffect(() => { if (ref.current?.api) ref.current.showSidebar(sidebar); }, [sidebar]);
  useEffect(() => { if (ref.current?.api) ref.current.setOrbit(orbit); }, [orbit]);
  useEffect(() => { if (ref.current?.api) ref.current.setNight(night ? 1 : 0); }, [night]);

  return (
    <kfr-map
      ref={ref as Ref<HTMLElement>}
      className={className}
      style={{ display: 'block', height: '100%', ...style }}
      view={view}
      sidebar={sidebar ? undefined : 'off'}
      interactive={interactive ? undefined : 'off'}
      {...(orbit ? { orbit: '' as const } : {})}
    />
  );
}
