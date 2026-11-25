/* Intro: swarm-style page rebuild. Original code written for this portfolio. */
(() => {
  'use strict';
  const SRC = 'assets/audio/alex-guesta-my-addiction.mp3';
  const COLORS = ['#149ddd', '#37b3ed', '#0a6ea8', '#22c1c3', '#6c8cff', '#ff7a59', '#f2b134', '#3ddc97'];
  const SPEEDS = [-2, -1, 0.5, 1, 1.5, 2, 3];
  const FIRST_MS = 7000;  // time spent arranging the first screen before scrolling starts (at 1x)
  const BASE_PX = 520;    // auto-scroll speed at 1x (px per second)
  const SWARM = 9;
  const doc = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = t => 1 - Math.pow(1 - t, 3);
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const label = s => (s < 0 ? '\u2212' : '') + Math.abs(s) + '\u00d7';
  const IC = {
    play: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
    chev: '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };
  const CUR = '<svg class="a" viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l15 7.5-6.2 1.9L9.4 18z" fill="currentColor" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
    '<svg class="x" viewBox="0 0 22 22" width="22" height="22"><path d="M11 2v18M2 11h18" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M11 2v18M2 11h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
    '<svg class="i" viewBox="0 0 22 22" width="22" height="22"><path d="M7 3h8M11 3v16M7 19h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M7 3h8M11 3v16M7 19h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  let run = false, speed = 1, T = 0, last = 0, raf = 0, pos = 0, maxY = 0, vw = 0, vh = 0, base = 0;
  let fin = 0, atEnd = 0, fsDone = false, t0 = 0, secShown = -1, fadeTok = 0;
  let tasks = [], cursors = [], layer = null;

  /* ---------- UI ---------- */
  const audio = new Audio(); audio.loop = true; audio.preload = 'none';
  const start = mk('button', 'ip-ui ip-start', IC.play + '<span>Intro</span>');
  const speeds = mk('div', 'ip-ui ip-speeds'); speeds.hidden = true;
  SPEEDS.forEach((s, i) => {
    if (i === 2) speeds.append(mk('span', 'ip-sep'));
    const b = mk('button', s < 0 ? 'neg' : '', label(s)); b.type = 'button'; b.dataset.s = s; speeds.append(b);
  });
  const time = mk('span', 'ip-time', '0:00');
  const sp = mk('button', 'ip-sp'), mus = mk('button', 'ip-mus'), end = mk('button', 'ip-end', IC.stop + '<span>End</span>');
  [start, sp, mus, end].forEach(b => { b.type = 'button'; });
  start.setAttribute('aria-label', 'Play the intro'); end.setAttribute('aria-label', 'End the intro');
  const bar = mk('div', 'ip-bar'); bar.append(mk('span', 'ip-eq', '<b></b><b></b><b></b>'), time, sp, mus, end);
  const dock = mk('div', 'ip-ui ip-dock'); dock.hidden = true; dock.append(speeds, bar);

  function setSpeed(s) {
    speed = s; sp.innerHTML = label(s) + IC.chev; sp.setAttribute('aria-label', 'Speed ' + label(s));
    speeds.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
  }
  function syncMusic() {
    const on = !audio.paused;
    mus.innerHTML = (on ? IC.pause : IC.play) + '<span>Music</span>';
    mus.setAttribute('aria-label', on ? 'Pause music' : 'Play music'); dock.classList.toggle('playing', on);
  }
  audio.addEventListener('play', syncMusic); audio.addEventListener('pause', syncMusic);
  audio.addEventListener('error', () => { mus.disabled = true; mus.title = 'Add the track at ' + SRC; console.warn('[Intro] music file not found:', SRC); });
  function fadeOut(ms) {
    const tok = ++fadeTok, a = audio, v = a.volume, s = performance.now();
    (function f() {
      const p = (performance.now() - s) / ms;
      if (tok !== fadeTok) return;
      if (p >= 1 || a.paused) { a.pause(); a.volume = 1; return; }
      a.volume = v * (1 - p); requestAnimationFrame(f);
    })();
  }

  /* ---------- Snapshot: turn the live page into a list of build tasks ---------- */
  const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(','); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const boxed = cs => alpha(cs.backgroundColor) > .03 || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
  function collect() {
    const out = [], SKIP = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|BR|HR|AUDIO|SOURCE|TEMPLATE)$/, MEDIA = /^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|I)$/i;
    const walk = (parent, dep, fixed) => {
      for (const c of parent.children) {
        if (c.classList.contains('ip-ui') || SKIP.test(c.tagName) || /^tidio/i.test(c.id)) continue;
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const r = c.getBoundingClientRect(), fx = fixed || cs.position === 'fixed';
        if (r.width < 2 || r.height < 2) { walk(c, dep, fx); continue; }
        if (r.right <= 0 || r.left >= vw) continue;
        const t = { el: c, x: r.left, y: r.top, w: r.width, h: r.height, dep, st: 0, k: 'c', n: 1, len: 0 };
        if (MEDIA.test(c.tagName)) t.k = 'm';
        else if ([...c.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) {
          t.k = 'l'; t.len = c.textContent.trim().length;
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || t.h;
          t.n = clamp(Math.round(t.h / lh), 1, 40);
        } else if (!boxed(cs)) { walk(c, dep, fx); continue; }
        t.q = t.w * t.h < 2600;  // tiny items just pop in
        out.push(t);
        if (t.k === 'c') walk(c, t, fx);
      }
    };
    walk(document.body, null, false);
    return out;
  }

  /* ---------- Swarm ---------- */
  function newCursor(i) {
    const d = mk('div', 'ip-cur', CUR), r = mk('div', 'ip-r'), b = mk('div', 'ip-b'), col = COLORS[i % COLORS.length];
    [d, r, b].forEach(e => e.style.setProperty('--c', col)); d.dataset.m = 'a';
    layer.append(r, b, d);
    return { d, r, b, i, x: vw / 2, y: vh / 2, tx: vw / 2, ty: vh / 2, k: 10, mode: 'a', m: 'a', t: null, wt: 0, ph: 0, t0: 0, seq: [] };
  }
  function claim() {
    for (let i = base; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.st) continue;
      if (t.at !== undefined ? T < t.at : t.y > pos + vh + 40) continue;
      if (t.dep && t.dep.st !== 3) continue;
      return t;
    }
    return null;
  }
  function assign(c, t) {
    t.st = 1; c.t = t; c.ph = 0; c.t0 = T;
    c.seq = t.q ? [['go', 150], ['pop', 200]]
      : t.k === 'l' ? [['go', 200], ['type', clamp(14 * t.len + 180, 260, 1500)]]
      : [['go', 230], ['draw', clamp(90 + (t.w + t.h) * .3, 200, 520)], [t.k === 'm' ? 'sweep' : 'fade', t.k === 'm' ? 380 : 260]];
    enter(c);
  }
  function enter(c) {
    const n = c.seq[c.ph][0], t = c.t, st = t.el.style;
    if (n === 'draw') {
      c.r.style.cssText = `left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;transform:scale(0);opacity:1`;
      c.b.textContent = Math.round(t.w) + ' \u00d7 ' + Math.round(t.h);
      c.b.style.cssText = `left:${t.x + t.w}px;top:${t.y + t.h}px;opacity:1`;
    } else if (n !== 'go') {
      t.el.classList.add(t.k === 'c' ? 'ip-c' : 'ip-l');
      if (n === 'sweep') st.clipPath = 'inset(0 0 100% 0)';
      else if (n === 'type') st.clipPath = 'inset(0 100% 0 0)';
      else st.opacity = 0;
    }
  }
  function wipe(t, p, c) {  // typewriter reveal: line by line, left to right
    const n = t.n, f = p * n, i = Math.min(n - 1, Math.floor(f)), q = n > 1 ? f - i : p, x = q * 100;
    t.el.style.clipPath = n < 2 ? `inset(-6px ${100 - x}% -6px -6px)`
      : `polygon(-6px -6px,100% -6px,100% ${i / n * 100}%,${x}% ${i / n * 100}%,${x}% ${(i + 1) / n * 100}%,-6px ${(i + 1) / n * 100}%)`;
    c.tx = t.x + t.w * q; c.ty = t.y + t.h * (i + .5) / n; c.mode = 'i'; c.k = 40;
  }
  function done(c) {
    const t = c.t; t.el.style.opacity = ''; t.el.style.clipPath = ''; t.st = 3;
    c.t = null; c.r.style.opacity = 0; c.b.style.opacity = 0; c.wt = 0;
  }
  function step(c, s, dt) {
    const t = c.t;
    if (t) {
      const [n, dur] = c.seq[c.ph], p = clamp((T - c.t0) / dur, 0, 1), e = ease(p);
      if (n === 'go') { c.tx = t.x; c.ty = t.y + (t.k === 'l' ? t.h / 2 : 0); c.mode = t.k === 'l' ? 'i' : 'x'; c.k = 16; }
      else if (n === 'draw') { c.r.style.transform = `scale(${e})`; c.tx = t.x + t.w * e; c.ty = t.y + t.h * e; c.mode = 'x'; c.k = 42; }
      else if (n === 'type') wipe(t, p, c);
      else {
        if (n === 'sweep') { t.el.style.clipPath = `inset(0 0 ${(1 - e) * 100}% 0)`; c.tx = t.x + t.w / 2; c.ty = t.y + t.h * e; }
        else t.el.style.opacity = p;
        c.r.style.opacity = c.b.style.opacity = 1 - p; c.mode = 'x'; c.k = 30;
      }
      if (p >= 1) { c.ph++; c.t0 = T; c.ph < c.seq.length ? enter(c) : done(c); }
    } else {
      const nt = fin ? null : claim();
      if (nt) assign(c, nt);
      else {
        c.mode = 'a'; c.k = 6;
        if (T < 450 || fin) {  // orbit: intro and finale
          const a = T / 360 + c.i * 6.283 / SWARM, R = fin ? 110 + (T - fin) * .04 : 90;
          c.tx = vw / 2 + Math.cos(a) * R; c.ty = pos + vh / 2 + Math.sin(a) * R * .7;
        } else if (T > c.wt) {
          c.wt = T + 600 + Math.random() * 900; c.tx = vw * (.14 + Math.random() * .72); c.ty = pos + vh * (.22 + Math.random() * .58);
        }
      }
    }
    const f = 1 - Math.exp(-c.k * Math.max(1, s) * dt / 1000);
    c.x += (c.tx - c.x) * f; c.y += (c.ty - c.y) * f;
    c.d.style.transform = `translate3d(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px,0)`;
    if (c.m !== c.mode) c.d.dataset.m = c.m = c.mode;
  }

  /* ---------- Main loop ---------- */
  function frame(now) {
    if (!run) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - last); last = now;
    const s = Math.abs(speed), FM = reduce ? 0 : FIRST_MS; T += dt * s;
    const sec = Math.floor((now - t0) / 1000);
    if (sec !== secShown) { secShown = sec; time.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
    while (base < tasks.length && tasks[base].st === 3) base++;
    if (!fin) {
      if (!fsDone) fsDone = tasks.every(t => t.at === undefined || t.st === 3);
      if (T >= FM && fsDone) {
        let vis = 0;
        for (let i = base; i < tasks.length; i++) if (tasks[i].st !== 3 && tasks[i].y < pos + vh - 24) vis++;
        const k = clamp(1 - vis / 16, .12, 1), ramp = clamp((T - FM) / 1500, .2, 1);  // wait for the swarm if it falls behind
        pos = clamp(pos + (speed < 0 ? -1 : 1) * BASE_PX * (dt * s / 1000) * k * ramp, 0, maxY);
        scrollTo(0, pos);
        if (speed < 0 && pos <= 0) setSpeed(1);
        if (speed > 0 && pos >= maxY - 1) {
          atEnd += dt;
          if (atEnd > 4000 || tasks.every(t => t.st === 3)) { fin = T; fadeOut(1800); }
        }
      }
    }
    cursors.forEach(c => step(c, s, dt));
    if (fin && T - fin > 1900) stop(true);
  }

  function begin() {
    if (run) return;
    run = true; fin = 0; T = 0; base = 0; atEnd = 0; fsDone = false; secShown = -1; fadeTok++;
    scrollTo(0, 0); pos = 0; vw = innerWidth; vh = innerHeight;
    const blank = !reduce;
    if (blank) doc.classList.add('ip-prep');
    tasks = blank ? collect() : [];
    const first = tasks.filter(t => t.y < vh * 1.02);
    first.forEach((t, i) => { t.at = 450 + i * (5200 / first.length); });  // spreads the first screen over ~7s
    maxY = Math.max(0, doc.scrollHeight - vh);
    layer = mk('div', 'ip-ui ip-layer'); layer.style.height = doc.scrollHeight + 'px'; document.body.append(layer);
    cursors = Array.from({ length: SWARM }, (_, i) => newCursor(i));
    if (blank) doc.classList.add('ip-run');
    start.hidden = true; dock.hidden = false; speeds.hidden = true; setSpeed(1); syncMusic();
    if (!audio.getAttribute('src')) audio.src = SRC;
    audio.currentTime = 0; audio.volume = 1; audio.play().catch(() => {});
    t0 = performance.now(); last = t0; raf = requestAnimationFrame(frame);
  }
  function stop(natural) {
    if (!run) return;
    run = false; cancelAnimationFrame(raf);
    if (!natural) fadeOut(450);
    tasks.forEach(t => { t.el.classList.remove('ip-c', 'ip-l'); t.el.style.opacity = ''; t.el.style.clipPath = ''; });
    doc.classList.remove('ip-run', 'ip-prep');
    if (layer) layer.remove();
    dock.hidden = true; speeds.hidden = true; start.hidden = false;
    if (natural) scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Wiring ---------- */
  function init() {
    document.body.append(start, dock); setSpeed(1); syncMusic();
    start.addEventListener('click', begin);
    end.addEventListener('click', () => stop(false));
    mus.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    sp.addEventListener('click', e => { e.stopPropagation(); speeds.hidden = !speeds.hidden; sp.setAttribute('aria-expanded', String(!speeds.hidden)); });
    speeds.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setSpeed(+b.dataset.s); speeds.hidden = true; } });
    document.addEventListener('click', e => { if (!speeds.hidden && !dock.contains(e.target)) speeds.hidden = true; });
    addEventListener('wheel', e => { if (run) e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', e => { if (run && !e.target.closest('.ip-speeds')) e.preventDefault(); }, { passive: false });
    addEventListener('keydown', e => {
      if (!run) return;
      if (e.key === 'Escape') return stop(false);
      if (!dock.contains(e.target) && [' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
