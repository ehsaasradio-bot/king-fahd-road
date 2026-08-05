import type * as React from 'react';

/** Imperative API exposed by <kfr-map> (also mirrored as methods on the element). */
export interface KfrMapApi {
  flyTo(name: string, ms?: number): boolean;
  jump(name: string): boolean;
  scrub(t: number): void;
  setNight(t: number): void;
  setBuild(v: number): void;
  setRoute(t: number): void;
  setInteractive(on: boolean): void;
  showSidebar(on: boolean): void;
  setOrbit(on: boolean): void;
  landmarks(): { name: string; height: number }[];
  targetOf(name: string): { tx: number; tz: number; azim: number; elev: number; size: number } | null;
  renderOnce(): void;
  view: { tx: number; tz: number; azim: number; elev: number; size: number };
}

export interface KfrMapElement extends HTMLElement {
  api?: KfrMapApi;
  flyTo(name: string, ms?: number): boolean;
  jump(name: string): boolean;
  scrub(t: number): void;
  setNight(t: number): void;
  setBuild(v: number): void;
  setRoute(t: number): void;
  setInteractive(on: boolean): void;
  showSidebar(on: boolean): void;
  setOrbit(on: boolean): void;
  landmarks(): { name: string; height: number }[];
}

type KfrMapJSX = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
  view?: string;
  sidebar?: 'off';
  interactive?: 'off';
  orbit?: '' | boolean;
};

/* one element per city, all sharing the same API surface */
interface CityElements {
  'kfr-map': KfrMapJSX;
  'jeddah-map': KfrMapJSX;
  'dammam-map': KfrMapJSX;
  'makkah-map': KfrMapJSX;
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends CityElements {}
  }
}

/* React 19 moved JSX types under the react module namespace. */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends CityElements {}
  }
}
