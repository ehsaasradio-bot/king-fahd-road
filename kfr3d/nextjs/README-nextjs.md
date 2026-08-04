# King Fahd Road 3D map — Next.js integration

Works with the **App Router** (Next 13–15). Pages Router works identically — the
components are client components either way.

## 1 · Install

```bash
npm i gsap @gsap/react
```

## 2 · Copy files into your project

```
your-app/
├─ public/
│  └─ kfr-map.js                      ← from the embed kit (required)
├─ components/
│  ├─ RiyadhMap.tsx                   ← the map as a React component
│  ├─ RiyadhStory.tsx                 ← optional: full GSAP scroll story
│  └─ RiyadhStory.module.css
└─ types/
   └─ kfr-map.d.ts                    ← TypeScript types for <kfr-map>
```

If your `tsconfig.json` doesn't already include `types/**`, add the folder to
`"include"`. Adjust the `../types/kfr-map` import in `RiyadhMap.tsx` if you place
files elsewhere (e.g. `@/types/kfr-map` with path aliases).

## 3 · Simple embed (any page or server component tree)

```tsx
import RiyadhMap from '@/components/RiyadhMap';

export default function Page() {
  return (
    <main>
      <h1>Our Riyadh office</h1>
      <div style={{ height: '80vh' }}>
        <RiyadhMap view="kingdom" />
      </div>
    </main>
  );
}
```

`RiyadhMap` is a client component — you can drop it straight into a server
component page, no wrapper needed.

### Props

| Prop | Type | Default | |
|---|---|---|---|
| `view` | string | — | `overview` `kingdom` `kafd` `faisaliah` or any landmark name |
| `sidebar` | boolean | `true` | navigation sidebar |
| `interactive` | boolean | `true` | drag / zoom / hover |
| `orbit` | boolean | `false` | auto-rotate |
| `night` | boolean | `false` | night mode (reactive — flip it from state) |
| `src` | string | `/kfr-map.js` | where the bundle is served from |
| `onReady` | `(el) => void` | — | fires when the map is live; `el` has the full API |

All boolean props are **reactive** — `<RiyadhMap night={isDark} />` wired to your
site's theme toggle just works.

### Imperative API

```tsx
<RiyadhMap onReady={(el) => {
  el.flyTo('PIF Tower');
  el.scrub(0.5);          // 0..1 camera ride along the corridor
  el.setNight(0.5);       // fractional = blended dusk
  console.log(el.landmarks());
}} />
```

## 4 · The full scroll story

```tsx
import RiyadhStory from '@/components/RiyadhStory';

export default function Page() {
  return <RiyadhStory />;
}
```

That renders the whole experience: hero with the city-rise intro and staggered
headline, the 640vh pinned scroll ride (Faisaliyah → Kingdom → Olaya → KAFD)
with glass chapter cards and count-ups, dusk falling into a night-lit KAFD, and
the navy "Now you drive" explorer with the day/night toggle.

It follows the GSAP-in-React rules: everything runs inside `useGSAP` scoped to
the component, so ScrollTriggers are cleaned up automatically on route changes,
StrictMode double-invoke is safe, and `prefers-reduced-motion` gets a static
fallback. Edit the `CHAPTERS` array and the CSS module to reskin.

## 5 · Notes

- **Attribution is required** (OSM/ODbL): the map renders
  "© OpenStreetMap contributors" itself — keep it visible.
- The bundle is ~1.15 MB (~330 KB gzipped). It loads once per page no matter how
  many maps you render (the loader in `RiyadhMap.tsx` is a singleton).
- Fonts: the component picks up `--font-f-aeonik-pro` from your design system
  automatically (CSS variables pierce the Shadow DOM). Retheme with
  `kfr-map { --ink: …; --green: …; }`.
- Two WebGL contexts (story + explorer) per page is fine; avoid 4+.
