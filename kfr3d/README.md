# `<kfr-map>` — King Fahd Road, Riyadh · 3D line-art map component

One JS file, zero dependencies, works in any website (plain HTML, React, Vue, Next.js, WordPress, Webflow custom code). Real OpenStreetMap footprints, sculpted landmark towers, isometric line-art style, day/night mode.

## Quick embed

```html
<script src="/kfr-map.js" defer></script>

<kfr-map style="display:block; height:80vh"></kfr-map>
```

That's it. The component renders in Shadow DOM, so your site's CSS can't break it — and it can't break your site. It fills whatever box you give it and resizes live (just make sure the box has a real height).

## Attributes

| Attribute | Values | What it does |
|---|---|---|
| `sidebar` | `off` | hide the navigation sidebar |
| `interactive` | `off` | disable drag/zoom/hover — pointer events pass through (use for scroll-driven heroes) |
| `view` | `overview` `kingdom` `kafd` `faisaliah` or any landmark name | initial camera position |
| `orbit` | (presence) | start with auto-orbit on |

```html
<kfr-map sidebar="off" interactive="off" view="kingdom"></kfr-map>
```

## JS API (on the element)

```js
const map = document.querySelector('kfr-map');
map.addEventListener('kfr-ready', () => {
  map.flyTo('PIF Tower');        // animated flight (preset key or landmark name)
  map.jump('kafd');              // instant, no animation
  map.scrub(0.5);                // 0..1 → camera along the corridor (Faisaliyah → KAFD)
  map.setNight(1);               // 0 = day, 1 = night; fractions blend (scrub-friendly)
  map.setBuild(0);               // 0 = flat plan … 1.35 = fully built (city-rise intros)
  map.setInteractive(false);     // toggle user input
  map.showSidebar(true);         // toggle sidebar
  map.setOrbit(true);            // auto-orbit
  map.landmarks();               // [{name, height}, ...]
});
// NOTE: if the script tag loads before your code runs, `map.api` may already be
// set — check `if (map.api) {...} else map.addEventListener('kfr-ready', ...)`.
```

The built-in **Night** button (next to Orbit) gives visitors the day/night toggle with no code.

## React / Next.js

```jsx
'use client';
import { useEffect, useRef } from 'react';

export default function RiyadhMap(props) {
  const ref = useRef(null);
  useEffect(() => { import('./kfr-map.js'); }, []);  // client-only; or one site-wide <Script>
  return <kfr-map ref={ref} style={{ display: 'block', height: '80vh' }} {...props} />;
}
```

## Theming

CSS custom properties pierce the Shadow DOM — override on the element:

```css
kfr-map { --green: #00c2a8; --ink: #14206e; --font: var(--font-f-aeonik-pro, sans-serif); }
```

## GSAP scroll-story pattern (as in kfr-landing.html)

```js
gsap.registerPlugin(ScrollTrigger);
const map = document.querySelector('kfr-map');
const cam = { p: 0 }, dusk = { n: 0 };
gsap.timeline({
  scrollTrigger: { trigger: '#story', start: 'top top', end: 'bottom bottom', scrub: 1 }
})
  .to(cam,  { p: 1, duration: 10, ease: 'none', onUpdate: () => map.scrub(cam.p) }, 0)
  .to(dusk, { n: 1, duration: 1.4, ease: 'none', onUpdate: () => map.setNight(dusk.n) }, 5.8);
```

Put the map in a `position: sticky; top: 0; height: 100vh` stage inside a tall
section, set `sidebar="off" interactive="off"`, and hand interaction back to the
user when the story ends. `kfr-landing.html` is the complete working example —
copy it wholesale and reskin.

## Files

- `kfr-map.js` — the whole component (three.js r160 + OSM scene data + UI, ~1.15 MB, gzips to ~330 KB)
- `kfr-landing.html` — GSAP scroll-story demo (needs `gsap.min.js`, `ScrollTrigger.min.js` next to it)
- `index.html` + `app.js` + `scene.js` + `three.min.js` — standalone dev version
- `artifact.html` / `landing-artifact.html` — single-file builds (everything inlined)
- `.claude/launch.json` — dev server (`python3 -m http.server 8742`)

## Attribution (required)

Building data **© OpenStreetMap contributors** (ODbL) — the component renders
this credit itself; keep it visible. Heights come from OSM tags where present,
estimated elsewhere.
