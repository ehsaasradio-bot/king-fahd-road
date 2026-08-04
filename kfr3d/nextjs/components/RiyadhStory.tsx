'use client';

import { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import RiyadhMap, { type KfrMapElement } from './RiyadhMap';
import s from './RiyadhStory.module.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const CHAPTERS = [
  {
    eyebrow: 'Chapter 01 · South Gate',
    title: 'Al Faisaliyah',
    count: 267,
    unit: ' m',
    text: "The kingdom's first skyscraper — a pure pyramid holding a golden sphere above the Olaya skyline.",
  },
  {
    eyebrow: 'Chapter 02 · The Icon',
    title: 'Kingdom Centre',
    count: 302,
    unit: ' m',
    text: 'The inverted parabolic arch — a skybridge with the city threaded through its void.',
  },
  {
    eyebrow: 'Chapter 03 · The Spine',
    title: 'Olaya Corridor',
    count: 3439,
    unit: ' bldgs',
    text: 'Eleven kilometres of banks, ministries and malls stitched to one road — every footprint real.',
  },
  {
    eyebrow: 'Chapter 04 · North Terminus',
    title: 'KAFD',
    count: 385,
    unit: ' m',
    text: "A crystal district crowned by PIF Tower — the financial future at the road's northern end.",
  },
];

/* chapter [in, out] windows on the 10-unit scrubbed timeline */
const WINDOWS: [number, number][] = [[0.9, 2.3], [3.0, 4.4], [5.1, 6.5], [7.2, 9.3]];

function SplitLine({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <span className={accent ? `${s.ln} ${s.accent}` : s.ln} aria-label={text}>
      {text.split('').map((c, i) => (
        <span key={i} data-char="" aria-hidden="true" className={s.chr}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  );
}

export default function RiyadhStory() {
  const container = useRef<HTMLDivElement>(null);
  const mapEl = useRef<KfrMapElement | null>(null);
  const [ready, setReady] = useState(false);

  useGSAP(
    () => {
      const map = mapEl.current;
      const rootEl = container.current;
      if (!ready || !map || !rootEl) return;

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: reduce)', () => {
        rootEl.classList.add(s.reduced);
        map.setInteractive(true);
      });

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        /* intro: quick city rise inside the hero frame */
        map.jump('faisaliah');
        map.setBuild(0);
        const buildObj = { b: 0 };
        gsap.timeline()
          .to(buildObj, {
            b: 1.35, duration: 1.7, ease: 'power1.inOut',
            onUpdate: () => map.setBuild(buildObj.b),
          }, 0.2)
          .from('[data-char]', { yPercent: 115, duration: 0.9, ease: 'expo.out', stagger: 0.035 }, 0.4)
          .from(`.${s.eyebrow}`, { autoAlpha: 0, y: 14, duration: 0.5 }, 0.7)
          .from(`.${s.sub}`, { autoAlpha: 0, y: 18, duration: 0.6 }, 0.9);

        /* the story: one scrubbed timeline drives camera, chapters, dusk, rail */
        const cam = { p: 0 };
        const dots = gsap.utils.toArray<HTMLElement>('[data-dot]');
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: '[data-story]',
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1,
            onUpdate(self) {
              const zone = Math.min(3, Math.floor(self.progress * 4.35));
              dots.forEach((d, i) => d.classList.toggle(s.dotOn, i === zone));
              gsap.set('[data-track-fill]', { scaleY: self.progress });
            },
          },
          defaults: { ease: 'power2.out' },
        });

        tl.to(cam, {
          p: 1, duration: 10, ease: 'none',
          onUpdate: () => map.scrub(cam.p),
        }, 0);

        tl.to(`.${s.hero}`, { autoAlpha: 0, y: -60, duration: 0.7, ease: 'power2.in' }, 0.15);

        WINDOWS.forEach(([tIn, tOut], i) => {
          const sel = `[data-chapter="${i}"]`;
          tl.fromTo(sel, { autoAlpha: 0, y: 70 }, { autoAlpha: 1, y: 0, duration: 0.55 }, tIn)
            .to(sel, { autoAlpha: 0, y: -50, duration: 0.5, ease: 'power2.in' }, tOut);
          const counter = { v: 0 };
          const numEl = rootEl.querySelector<HTMLElement>(`${sel} [data-count]`);
          tl.to(counter, {
            v: CHAPTERS[i].count, duration: 0.9, ease: 'none',
            onUpdate: () => {
              if (numEl) numEl.textContent = Math.round(counter.v).toLocaleString('en-US');
            },
          }, tIn + 0.1);
        });

        /* dusk falls gradually through Olaya, complete as KAFD arrives */
        const dusk = { n: 0 };
        tl.to(dusk, {
          n: 1, duration: 1.4, ease: 'none',
          onUpdate: () => {
            map.setNight(dusk.n);
            rootEl.classList.toggle(s.night, dusk.n > 0.5);
          },
        }, 5.8);
      });
    },
    { scope: container, dependencies: [ready] }
  );

  return (
    <div ref={container} className={s.root}>
      <div className={s.story} data-story="">
        <div className={s.stage}>
          <RiyadhMap
            className={s.map}
            sidebar={false}
            interactive={false}
            view="faisaliah"
            onReady={(el) => { mapEl.current = el; setReady(true); }}
          />

          <div className={s.hero}>
            <div className={s.eyebrow}>Riyadh &middot; 24.71&deg; N, 46.67&deg; E</div>
            <h1 className={s.hl}>
              <SplitLine text="King Fahd" />
              <SplitLine text="Road" accent />
            </h1>
            <p className={s.sub}>One artery &middot; 3,439 real buildings &middot; drawn live in your browser from OpenStreetMap data</p>
          </div>

          {CHAPTERS.map((c, i) => (
            <div className={s.chapter} data-chapter={i} key={c.title}>
              <div className={s.chEyebrow}>{c.eyebrow}</div>
              <h2>{c.title}</h2>
              <div className={s.num}>
                <span data-count="">0</span>
                <em>{c.unit}</em>
              </div>
              <p>{c.text}</p>
            </div>
          ))}

          <div className={s.rail} aria-hidden="true">
            {CHAPTERS.map((c, i) => (
              <div className={s.dot} data-dot={i} key={i} />
            ))}
            <div className={s.track}><i className={s.trackFill} data-track-fill="" /></div>
          </div>
        </div>
      </div>

      <section className={s.explore}>
        <div className={s.exploreHead}>
          <h2>Now <span>you</span> drive</h2>
          <div className={s.exploreNote}>Drag &middot; scroll &middot; hover &middot; fly to any landmark</div>
        </div>
        <RiyadhMap className={s.exploreMap} view="kingdom" night />
      </section>

      <footer className={s.footer}>
        <span>King Fahd Road &middot; a 3D portrait</span>
        <span>
          data{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            &copy; OpenStreetMap contributors
          </a>{' '}
          &middot; heights estimated where untagged
        </span>
      </footer>
    </div>
  );
}
