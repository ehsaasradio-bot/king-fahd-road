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

Copy these two lines into any website — no build step, no install, no hosting needed.
The component is served from jsDelivr's global CDN straight off this repo's `v1.0.0` tag:

```html
<script src="https://cdn.jsdelivr.net/gh/ehsaasradio-bot/king-fahd-road@v1.0.0/site/kfr-map.js" defer></script>
<kfr-map style="display:block;height:80vh"></kfr-map>
```

Pin to a tag (`@v1.0.0`) so a future change here can never alter a live site.
Use `@main` only if you *want* every site to track the latest build.

Self-hosting instead? Drop `site/kfr-map.js` into your own project and point the
`src` at it. See [`kfr3d/README.md`](kfr3d/README.md) for attributes, the JS API,
theming and the GSAP scroll-story pattern, or
[`kfr3d/nextjs/README-nextjs.md`](kfr3d/nextjs/README-nextjs.md) for React/Next.js.

## More than one city

Each city ships as its own element, built by the same pipeline from its own
OpenStreetMap extract — load only the ones a page needs:

| Element | City | Spine |
|---|---|---|
| `<kfr-map>` | Riyadh | King Fahd Road |
| `<jeddah-map>` | Jeddah | Corniche Road, on the Red Sea |

Scenes carry their own camera presets and scrub path, so the same component code
drives any of them. [`examples/cities-of-ksa.html`](examples/cities-of-ksa.html)
is a multi-city scroll page wiring both together.

See `kfr3d/README.md` for attributes (`view`, `sidebar`, `interactive`, `orbit`) and the
JS API (`flyTo`, `scrub`, `setNight`, `setBuild`, `landmarks`).

## Local dev

```bash
python3 -m http.server 8742 -d site
```

## Licence

The code in this repository is [MIT licensed](LICENSE).

Building footprints and roads: **© OpenStreetMap contributors**, licensed
[ODbL](https://www.openstreetmap.org/copyright). Heights come from OSM tags where present
and are estimated elsewhere (marked `≈` in the UI). The credit is rendered by the component
itself — keep it visible in any deployment. Also bundles three.js (MIT) and, on the story
pages only, GSAP (standard GreenSock licence). See [NOTICE](NOTICE) for the full breakdown.
