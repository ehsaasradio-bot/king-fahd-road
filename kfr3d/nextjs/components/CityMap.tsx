'use client';

import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
} from 'react';
import type { KfrMapElement } from '../types/kfr-map';

/** Every city ships as its own custom element + bundle. */
export const CITIES = {
  riyadh: { tag: 'kfr-map',    src: '/kfr-map.js',    label: 'Riyadh', spine: 'King Fahd Road' },
  jeddah: { tag: 'jeddah-map', src: '/jeddah-map.js', label: 'Jeddah', spine: 'Corniche Road' },
  dammam: { tag: 'dammam-map', src: '/dammam-map.js', label: 'Dammam', spine: 'King Saud Street' },
  makkah: { tag: 'makkah-map', src: '/makkah-map.js', label: 'Makkah', spine: 'Ibrahim Al Khalil Road' },
} as const;

export type CityKey = keyof typeof CITIES;

const loading = new Map<string, Promise<void>>();

/** Loads a city bundle once per page, however many maps ask for it. */
export function loadCityMap(src: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const inFlight = loading.get(src);
  if (inFlight) return inFlight;

  const p = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading.delete(src); reject(new Error(`failed to load ${src}`)); };
    document.head.appendChild(s);
  });
  loading.set(src, p);
  return p;
}

export interface CityMapProps {
  /** which city to render */
  city: CityKey;
  /** initial camera: a preset key ('overview', 'kingdom', …) or a landmark name */
  view?: string;
  sidebar?: boolean;
  interactive?: boolean;
  orbit?: boolean;
  night?: boolean;
  /**
   * Wait until the map is near the viewport before fetching its bundle.
   * Each city is 1.1–1.7 MB, so turn this on when a page holds several.
   */
  lazy?: boolean;
  /** override where the bundle is served from (defaults to /<city>-map.js) */
  src?: string;
  className?: string;
  style?: CSSProperties;
  onReady?: (el: KfrMapElement) => void;
}

export type { KfrMapElement };

export default function CityMap({
  city,
  view,
  sidebar = true,
  interactive = true,
  orbit = false,
  night = false,
  lazy = false,
  src,
  className,
  style,
  onReady,
}: CityMapProps) {
  const ref = useRef<KfrMapElement | null>(null);
  const meta = CITIES[city];
  const url = src ?? meta.src;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let io: IntersectionObserver | null = null;

    const handleReady = () => {
      if (cancelled || !ref.current) return;
      if (night) ref.current.setNight(1);
      onReady?.(ref.current);
    };

    const attach = () => {
      if (cancelled) return;
      if (el.api) handleReady();
      else el.addEventListener('kfr-ready', handleReady, { once: true });
    };

    const fetchNow = () => { loadCityMap(url).then(attach).catch(console.error); };

    if (lazy && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        io?.disconnect();
        fetchNow();
      }, { rootMargin: '150% 0px' });
      io.observe(el);
    } else {
      fetchNow();
    }

    return () => {
      cancelled = true;
      io?.disconnect();
      el.removeEventListener('kfr-ready', handleReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, lazy]);

  /* keep a mounted map in sync when props change */
  useEffect(() => { if (ref.current?.api) ref.current.setInteractive(interactive); }, [interactive]);
  useEffect(() => { if (ref.current?.api) ref.current.showSidebar(sidebar); }, [sidebar]);
  useEffect(() => { if (ref.current?.api) ref.current.setOrbit(orbit); }, [orbit]);
  useEffect(() => { if (ref.current?.api) ref.current.setNight(night ? 1 : 0); }, [night]);

  /* the tag varies per city, so build the element imperatively */
  return createElement(meta.tag, {
    ref,
    class: className,
    style: { display: 'block', height: '100%', ...style },
    view,
    sidebar: sidebar ? undefined : 'off',
    interactive: interactive ? undefined : 'off',
    ...(orbit ? { orbit: '' } : {}),
  });
}
