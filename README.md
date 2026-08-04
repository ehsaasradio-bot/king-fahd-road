# King Fahd Road · Riyadh — 3D line-art map

An interactive 3D map of the King Fahd Road corridor in Riyadh, built from **3,439 real
OpenStreetMap building footprints** — with sculpted landmark towers (Kingdom Centre's arch,
Al Faisaliyah's spire, Al Majdoul's twist, Tadawul's braced crown, PIF Tower), facade grids,
and a day/night mode. Rendered live in the browser with three.js in an isometric,
navy-on-white line-art style.

**Live:** the scroll story at `/`, the standalone explorer at `/map/`.

## Repo layout

| Path | What it is |
|---|---|
| `site/` | what gets deployed to Cloudflare Pages |
| `site/index.html` | GSAP scroll story (hero → chapters → dusk → explorer) |
| `site/map/` | standalone interactive map |
| `site/kfr-map.js` | the `<kfr-map>` web component — the embeddable build |
| `kfr3d/` | source: dev pages, build scripts, component, docs |
| `kfr3d/nextjs/` | React/Next.js components (`RiyadhMap`, `RiyadhStory`) + types |
| `kfr3d/README.md` | embedding guide (plain HTML / any site) |
| `kfr3d/nextjs/README-nextjs.md` | Next.js integration guide |

## Embed it anywhere

```html
<script src="https://<your-pages-domain>/kfr-map.js" defer></script>
<kfr-map style="display:block;height:80vh"></kfr-map>
```

See `kfr3d/README.md` for attributes (`view`, `sidebar`, `interactive`, `orbit`) and the
JS API (`flyTo`, `scrub`, `setNight`, `setBuild`, `landmarks`).

## Local dev

```bash
python3 -m http.server 8742 -d site
```

## Data & licensing

Building footprints and roads: **© OpenStreetMap contributors**, licensed
[ODbL](https://www.openstreetmap.org/copyright). Heights come from OSM tags where present
and are estimated elsewhere (marked `≈` in the UI). The credit is rendered by the component
itself — keep it visible in any deployment. Bundles three.js (MIT) and GSAP (standard license).
