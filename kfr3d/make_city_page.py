#!/usr/bin/env python3
"""Generate a standalone city story page from its scene file.

    python3 make_city_page.py dammam
"""
import json, sys

CITY = sys.argv[1]
scene = json.load(open('%s-scene.json' % CITY))
meta = scene['meta']
LABEL = meta['city']
SPINE = meta['spine']
TAG = '%s-map' % CITY

ALL_CITIES = [('riyadh', 'index.html'), ('jeddah', 'jeddah.html'),
              ('makkah', 'makkah.html'), ('madinah', 'madinah.html'),
              ('dammam', 'dammam.html')]

PAGE = {
    'dammam': {
        'eyebrow': 'Arabian Gulf &middot; 26.43&deg; N',
        'sub': 'A city drawn from the Gulf &mdash; %d real buildings along King Saud Street and the corniche.',
    },
    'makkah': {
        'eyebrow': 'Hejaz &middot; 21.42&deg; N',
        'sub': 'The city around the Grand Mosque &mdash; %d real buildings, and the roads that lead to it.',
    },
    'madinah': {
        'eyebrow': 'Hejaz &middot; 24.47&deg; N',
        'sub': "The city around the Prophet's Mosque &mdash; %d real buildings, and the roads that lead to it.",
    },
}[CITY]
PAGE['nav'] = [(n, h) for n, h in ALL_CITIES if n != CITY]

cards = scene.get('cards') or []
nb = len(scene['buildings'])

named = [b for b in scene['buildings'] if b.get('lb')]
named.sort(key=lambda b: -b['h'])
FOCUS = meta.get('focus')
chapters = []

if FOCUS:
    # a focus city is about the mosque, so it leads — and every figure below is
    # counted from the scene itself rather than asserted
    mosques = sum(1 for b in scene['buildings'] if b['c'] == 'mq')
    chapters.append((SPINE, str(nb), 'bldgs',
                     'The city packed in around it, every footprint real.'))
    for b in named[:2]:
        chapters.append((b['n'], str(int(round(b['h']))), 'm',
                         'Standing over the approach.'))
    chapters.append(('The Approach', str(len(scene['roads'])), 'ways',
                     'Every road here runs toward the same place.'))
else:
    for b in named[:3]:
        chapters.append((b['n'], str(int(round(b['h']))), 'm',
                         'Rising over %s.' % SPINE))
    chapters.append(('The Corridor', str(nb), 'bldgs',
                     'Every footprint here is real, drawn from OpenStreetMap.'))

WINDOWS = [(4.2, 5.4), (5.8, 7.0), (7.4, 8.6), (9.0, 10.4)]

card_html = []
for i, (title, num, unit, body) in enumerate(chapters):
    tin, tout = WINDOWS[i]
    side = ' right' if i % 2 else ''
    card_html.append(
        '    <div class="card%s" data-card data-in="%s" data-out="%s">\n'
        '      <div class="tag">%s &middot; %02d</div>\n'
        '      <h2>%s</h2>\n'
        '      <div class="fig"><span data-count="%s">0</span><em>&nbsp;%s</em></div>\n'
        '      <p>%s</p>\n'
        '    </div>' % (side, tin, tout, SPINE, i + 1, title, num, unit, body))

nav_html = ' &middot; '.join('<a href="%s">%s &rarr;</a>' % (href, name)
                            for name, href in PAGE['nav'])

html = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{LABEL} — Drawn from Real Data</title>

<script src="{TAG}.js" defer></script>
<script src="gsap.min.js" defer></script>
<script src="ScrollTrigger.min.js" defer></script>

<style>
  :root {{
    --ink: #2E3192; --ink-deep: #1B1E63; --ink-soft: #7A80CF;
    --green: #8CC63F; --green-dk: #5c8f28;
    --paper: #ffffff; --night: #0B0D2E;
    --font: var(--font-f-aeonik-pro, "Aeonik Pro", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif);
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
    /* how much scroll the ride gets — one value to retune */
    --city-scroll: 900vh;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: var(--font); color: var(--ink-deep); background: var(--paper);
         text-transform: uppercase; overflow-x: hidden; }}
  ::selection {{ background: var(--green); color: #fff; }}

  #act {{ height: var(--city-scroll); position: relative; }}
  #stage {{ position: sticky; top: 0; height: 100vh; overflow: hidden; }}
  #map {{ position: absolute; inset: 0; }}

  .copy {{ position: absolute; inset: 0; z-index: 4; pointer-events: none; }}
  /* dense cities put towers and map labels right under the headline, so the
     copy sits on its own wash that lifts away with the type */
  .scrim {{
    position: absolute; inset: 0 0 auto 0; height: 56vh; z-index: -1;
    background: linear-gradient(180deg, rgba(255,255,255,.93) 0%,
                rgba(255,255,255,.88) 42%, rgba(255,255,255,0) 100%);
  }}
  .eyebrow {{ position: absolute; top: 9vh; left: 6vw; font-family: var(--mono); font-size: 10px; letter-spacing: .45em; color: var(--green-dk); }}
  h1 {{ position: absolute; top: 14vh; left: 0; right: 0; text-align: center;
        font-weight: 400; font-size: clamp(3rem, 12vw, 10rem); line-height: .88;
        letter-spacing: .06em; color: var(--ink-deep); }}
  h1 .ch {{ display: inline-block; will-change: transform; }}
  h1 .dot {{ color: var(--green); }}
  .sub {{ position: absolute; top: 30vh; left: 50%; transform: translateX(-50%); width: min(520px, 84vw);
          text-align: center; font-size: clamp(10px, 1.3vw, 12px); letter-spacing: .26em; line-height: 2.2; color: var(--ink-soft); }}
  .cue {{ position: absolute; bottom: 4vh; left: 6vw; z-index: 5; font-family: var(--mono); font-size: 10px; letter-spacing: .4em; color: var(--ink); display: flex; align-items: center; gap: 10px; }}
  .cue i {{ display: block; width: 1.5px; height: 30px; background: var(--ink); }}
  .night .cue {{ color: #DFE2FF; }} .night .cue i {{ background: #DFE2FF; }}

  .card {{ position: absolute; z-index: 4; pointer-events: none;
           left: 6vw; bottom: 14vh; width: min(380px, 84vw); padding: 20px 22px;
           background: rgba(255,255,255,.32); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
           border: 1.5px solid rgba(46,49,146,.6); border-radius: 4px;
           box-shadow: 6px 6px 0 rgba(46,49,146,.08); opacity: 0; visibility: hidden; }}
  .card.right {{ left: auto; right: 6vw; }}
  .card .tag {{ font-family: var(--mono); font-size: 9px; letter-spacing: .35em; color: var(--green-dk); margin-bottom: 8px; }}
  .card h2 {{ font-weight: 400; font-size: clamp(18px, 2.6vw, 27px); letter-spacing: .06em; color: var(--ink); }}
  .card .fig {{ font-family: var(--mono); font-size: clamp(26px, 4vw, 40px); color: var(--ink); margin: 10px 0 2px; font-variant-numeric: tabular-nums; }}
  .card .fig em {{ font-style: normal; font-size: .45em; color: var(--ink-soft); }}
  .card p {{ font-size: 10px; letter-spacing: .13em; line-height: 1.9; color: var(--ink-soft); margin-top: 6px; }}
  .night .card {{ background: rgba(19,22,74,.25); border-color: rgba(122,128,216,.55); backdrop-filter: none; -webkit-backdrop-filter: none; }}
  .night .card h2 {{ color: #DFE2FF; }}
  .night .card .fig {{ color: var(--green); }}
  .night .card p {{ color: #8A8FD8; }}
  .night h1 {{ color: #DFE2FF; }}

  #rail {{ position: absolute; right: 26px; top: 50%; transform: translateY(-50%); z-index: 5; display: flex; flex-direction: column; gap: 12px; }}
  #rail .dot2 {{ width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid var(--ink); background: #fff; transition: background .3s, transform .3s; }}
  #rail .dot2.on {{ background: var(--green); border-color: var(--green-dk); transform: scale(1.4); }}
  .night #rail .dot2 {{ border-color: #7A80D8; background: #13164A; }}

  #explore {{ position: relative; padding: 14vh 6vw 8vh; background: var(--night); }}
  #explore h2 {{ font-weight: 400; font-size: clamp(2rem, 6vw, 4.4rem); color: #DFE2FF; letter-spacing: .03em; }}
  #explore h2 span {{ color: var(--green); }}
  #explore .note {{ font-family: var(--mono); font-size: 10px; letter-spacing: .3em; color: #7A80CF; margin: 2vh 0 5vh; }}
  #exploreMap {{ display: block; height: 82vh; border: 1.5px solid #7A80D8; border-radius: 5px; box-shadow: 8px 8px 0 rgba(4,6,30,.55); }}
  footer {{ padding: 5vh 6vw 6vh; background: var(--night); border-top: 1.5px solid #23265C; font-family: var(--mono); font-size: 9px; letter-spacing: .22em; color: #7A80CF; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }}
  footer a {{ color: #C9CDFF; }}

  @media (prefers-reduced-motion: reduce) {{
    #act {{ height: auto; }} #stage {{ position: relative; }}
    #rail, .cue {{ display: none; }}
    .card {{ position: static; opacity: 1; visibility: visible; margin: 14px 0; }}
  }}
</style>
</head>
<body>

<section id="act">
  <div id="stage">
    <{TAG} id="map" sidebar="off" interactive="off"></{TAG}>

    <div class="copy">
      <div class="scrim"></div>
      <div class="eyebrow">{EYEBROW}</div>
      <h1 id="title"></h1>
      <p class="sub">{SUB}</p>
    </div>
    <div class="cue"><i></i>Scroll</div>

{CARDS}

    <div id="rail" aria-hidden="true">
      <div class="dot2"></div><div class="dot2"></div><div class="dot2"></div><div class="dot2"></div>
    </div>
  </div>
</section>

<section id="explore">
  <h2>Now <span>you</span> explore</h2>
  <div class="note">Drag &middot; scroll &middot; hover &middot; fly to any landmark</div>
  <{TAG} id="exploreMap"></{TAG}>
</section>

<footer>
  <span>{LABEL} &middot; {NAV}</span>
  <span>data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a> &middot; heights estimated where untagged</span>
</footer>

<script>
window.addEventListener('load', function () {{
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var map = document.getElementById('map');
  var expl = document.getElementById('exploreMap');
  var stage = document.getElementById('stage');

  var title = document.getElementById('title');
  '{LABEL}'.toUpperCase().split('').forEach(function (c) {{
    var s = document.createElement('span'); s.className = 'ch'; s.textContent = c; title.appendChild(s);
  }});
  var d = document.createElement('span'); d.className = 'ch dot'; d.textContent = '.'; title.appendChild(d);

  function explNight() {{ expl.setNight(1); }}
  if (expl.api) explNight();
  else expl.addEventListener('kfr-ready', explNight, {{ once: true }});

  function start() {{
    if (reduced) {{ map.setInteractive(true); return; }}
    gsap.registerPlugin(ScrollTrigger);

    var api = map.api;
    api.setBuild(0);
    /* open a little higher and pulled back, so the whole corridor reads */
    api.view.elev = 0.70;
    api.view.size *= 1.25;

    var cam = {{ p: 0 }}, build = {{ b: 0 }}, dusk = {{ n: 0 }};
    var dots = gsap.utils.toArray('#rail .dot2');

    var tl = gsap.timeline({{
      scrollTrigger: {{
        trigger: '#act', start: 'top top', end: 'bottom bottom', scrub: 1,
        onUpdate: function (self) {{
          var z = Math.min(3, Math.max(0, Math.floor((self.progress - 0.32) * 5.2)));
          dots.forEach(function (dd, i) {{ dd.classList.toggle('on', i === z && self.progress > 0.32); }});
        }}
      }},
      defaults: {{ ease: 'none' }}
    }});

    /* the city rises, then the type */
    tl.to(build, {{ b: 1.35, duration: 1.6, ease: 'power1.inOut',
                   onUpdate: function () {{ api.setBuild(build.b); }} }}, 0.1)
      .from('#title .ch', {{ yPercent: 130, duration: 0.7, ease: 'expo.out', stagger: 0.05 }}, 0.5)
      .from('.eyebrow', {{ autoAlpha: 0, x: -20, duration: 0.4 }}, 0.9)
      .from('.sub', {{ autoAlpha: 0, y: 20, duration: 0.5 }}, 1.1);

    /* The map draws its own landmark chips, which would sit right under the
       headline on a dense city. Keep them down until the type has left.
       Enforced after each render — setBuild writes this same property, so a
       competing tween would win or lose depending on render order. */
    var chips = map.shadowRoot && map.shadowRoot.getElementById('labels');
    if (chips) {{
      chips.style.transition = 'opacity .45s';
      tl.eventCallback('onUpdate', function () {{
        chips.style.opacity = tl.time() < 3.2 ? '0' : '';
      }});
    }}

    /* type clears, the ride begins */
    tl.to('#title .ch', {{ yPercent: -200, autoAlpha: 0, duration: 0.6, ease: 'power2.in', stagger: 0.03 }}, 3.0)
      .to(['.sub', '.eyebrow', '.cue', '.scrim'], {{ autoAlpha: 0, duration: 0.5 }}, 2.9);

    tl.to(cam, {{ p: 1, duration: 7.4, onUpdate: function () {{ api.scrub(cam.p); }} }}, 3.6);

    gsap.utils.toArray('[data-card]').forEach(function (card) {{
      var tIn = +card.dataset.in, tOut = +card.dataset.out;
      tl.fromTo(card, {{ autoAlpha: 0, y: 60 }}, {{ autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }}, tIn)
        .to(card, {{ autoAlpha: 0, y: -40, duration: 0.4, ease: 'power2.in' }}, tOut);
      var el = card.querySelector('[data-count]');
      var obj = {{ v: 0 }}, target = +el.dataset.count;
      tl.to(obj, {{ v: target, duration: 0.7,
                   onUpdate: function () {{ el.textContent = Math.round(obj.v).toLocaleString('en-US'); }} }}, tIn + 0.1);
    }});

    /* dusk — scoped to this page's stage, never a global class */
    tl.to(dusk, {{ n: 1, duration: 1.3,
                  onUpdate: function () {{
                    api.setNight(dusk.n);
                    document.body.classList.toggle('night', dusk.n > 0.5);
                  }} }}, 8.4);

    gsap.to('.cue i', {{ scaleY: 0.3, transformOrigin: 'top', repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut' }});
    gsap.from('#explore h2', {{ autoAlpha: 0, y: 40, duration: 0.7, scrollTrigger: {{ trigger: '#explore', start: 'top 78%' }} }});
    gsap.from('#exploreMap', {{ autoAlpha: 0, y: 60, duration: 0.8, scrollTrigger: {{ trigger: '#exploreMap', start: 'top 88%' }} }});
  }}

  if (map.api) start();
  else map.addEventListener('kfr-ready', start, {{ once: true }});
}});
</script>
</body>
</html>
'''.format(LABEL=LABEL, TAG=TAG, EYEBROW=PAGE['eyebrow'],
           SUB=PAGE['sub'] % nb, CARDS='\n'.join(card_html), NAV=nav_html)

open('%s.html' % CITY, 'w').write(html)
print('wrote %s.html  (%d buildings, %d chapters)' % (CITY, nb, len(chapters)))
