# Cities of KSA 3D maps — Next.js integration

Four cities, one component. Works with the **App Router** (Next 13–15); Pages
Router works identically — the components are client components either way.

| City | `city` prop | Spine | Bundle |
|---|---|---|---|
| Riyadh | `riyadh` | King Fahd Road | `kfr-map.js` (1.16 MB) |
| Jeddah | `jeddah` | Corniche Road | `jeddah-map.js` (1.46 MB) |
| Dammam | `dammam` | King Saud Street | `dammam-map.js` (1.65 MB) |
| Makkah | `makkah` | Ibrahim Al Khalil Road | `makkah-map.js` (1.11 MB) |

## 1 · Install

```bash
npm i gsap @gsap/react
```

(GSAP is only needed for `RiyadhStory`. A plain map needs no dependencies.)

## 2 · Copy files into your project

```
your-app/
├─ public/
│  ├─ kfr-map.js            ← copy only the cities you use
│  ├─ jeddah-map.js
│  ├─ dammam-map.js
│  └─ makkah-map.js
├─ components/
│  ├─ CityMap.tsx           ← the map, for any city
│  ├─ RiyadhMap.tsx         ← thin back-compat wrapper for <CityMap city="riyadh">
│  ├─ RiyadhStory.tsx       ← optional: full GSAP scroll story
│  └─ RiyadhStory.module.css
└─ types/
   └─ kfr-map.d.ts          ← TypeScript types for all four elements
```

If your `tsconfig.json` doesn't already include `types/**`, add the folder to
`"include"`. Adjust the `../types/kfr-map` import in `CityMap.tsx` if you place
files elsewhere (e.g. `@/types/kfr-map` with path aliases).

## 3 · Embed a city

```tsx
import CityMap from '@/components/CityMap';

export default function Page() {
  return (
    <main>
      <h1>Our offices</h1>
      <div style={{ height: '80vh' }}>
        <CityMap city="jeddah" view="aqua" night />
      </div>
    </main>
  );
}
```

This renders fine straight from a **server component** — `CityMap` is marked
`'use client'` itself.

### Props

| Prop | Type | Default | |
|---|---|---|---|
| `city` | `'riyadh' \| 'jeddah' \| 'dammam' \| 'makkah'` | — | required |
| `view` | string | — | preset key (`overview`, `kingdom`, `aqua`, …) or any landmark name |
| `sidebar` | boolean | `true` | navigation sidebar |
| `interactive` | boolean | `true` | drag / zoom / hover |
| `orbit` | boolean | `false` | auto-rotate |
| `night` | boolean | `false` | night mode — reactive, wire it to your theme toggle |
| `lazy` | boolean | `false` | fetch the bundle only as the map nears the viewport |
| `src` | string | `/<city>-map.js` | where the bundle is served from |
| `onReady` | `(el) => void` | — | fires when the map is live; `el` exposes the full API |

### Several cities on one page

Each bundle is 1.1–1.7 MB, so pass `lazy` when a page holds more than one.
Nothing is fetched until the map is about a viewport and a half away:

```tsx
<CityMap city="riyadh" />              {/* above the fold — load now */}
<CityMap city="jeddah" lazy />
<CityMap city="dammam" lazy />
<CityMap city="makkah" lazy />
```

### Imperative API

```tsx
'use client';                          // ← required: onReady is a callback
import CityMap from '@/components/CityMap';

export default function Explorer() {
  return (
    <CityMap city="makkah" onReady={(el) => {
      el.flyTo('The Clock Towers');
      el.scrub(0.5);       // 0..1 camera ride along the spine
      el.setNight(0.5);    // fractional = blended dusk
      console.log(el.landmarks());
    }} />
  );
}
```

**Gotcha:** `onReady` is a function, so the component that passes it must be a
client component. Passing it from a server component fails the build with
*"Event handlers cannot be passed to Client Component props."*

## 4 · The full scroll story

```tsx
import RiyadhStory from '@/components/RiyadhStory';

export default function Page() {
  return <RiyadhStory />;
}
```

The hero with its city-rise intro, the pinned scroll ride with glass chapter
cards and count-ups, dusk falling, and the interactive explorer. It follows the
GSAP-in-React rules — everything runs inside `useGSAP` scoped to the component,
so ScrollTriggers are cleaned up on route changes, StrictMode double-invoke is
safe, and `prefers-reduced-motion` gets a static fallback. Edit the `CHAPTERS`
array and the CSS module to reskin, or copy it as a template for another city.

## 5 · Notes

- **Attribution is required** (OSM/ODbL): each map renders
  "© OpenStreetMap contributors" itself — keep it visible.
- A bundle loads once per page no matter how many maps request it.
- Fonts: the maps pick up `--font-f-aeonik-pro` from your design system
  automatically (CSS variables pierce the Shadow DOM). Retheme with
  `kfr-map { --ink: …; --green: …; }` (and the same for the other tags).
- Two or three WebGL contexts per page is fine; avoid many more.
