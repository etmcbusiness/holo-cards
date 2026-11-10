(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), card = $('card'), art = $('art'), pop = $('pop');
  const canvas = $('sparkles'), ctx = canvas.getContext('2d');
  const amb = $('ambience'), actx = amb.getContext('2d'), bg = $('bg');
  const cards = [...window.CARDS]; // built-in cards; ones added on this device are appended by editor.js
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;

  // ---------- card content ----------
  // Switching cards: fade the old one out while the new card's pictures load, swap
  // everything at once (character included), fade back in. Only the flat layers fade;
  // fading the 3D card itself would flatten the character for the length of the fade.
  const ready = new Map(); // picture url -> promise that it's decoded
  const preload = (src) => {
    if (!src) return Promise.resolve();
    if (!ready.has(src)) {
      const im = new Image();
      im.src = src;
      ready.set(src, im.decode().catch(() => {}));
    }
    return ready.get(src);
  };
  let showing = 0;
  async function show(i) {
    index = (i + cards.length) % cards.length;
    const c = cards[index], me = ++showing;
    card.classList.add('swap');
    await Promise.all([preload(c.art), preload(c.pop?.src), new Promise((r) => setTimeout(r, 180))]);
    if (me !== showing) return; // tapped on again meanwhile
    {
      art.alt = c.name;
      art.src = c.art;
      bg.firstElementChild.style.backgroundImage = `url("${c.art}")`;
      applyStyle();
      buildAmbience();
      window.HoloValue?.render(c);
      document.title = c.name;
      const i = c.info || {};
      $('caption').querySelector('b').textContent = c.name;
      $('caption').querySelector('span').textContent = [i.set, i.year, i.number, i.edition].filter(Boolean).join(' · ');
      renderControls();
      if (art.complete && art.naturalWidth) art.dispatchEvent(new Event('load')); // same picture: no load event
    }
    // the next and previous cards' pictures, ready before they're needed
    for (const d of [1, -1]) { const n = cards[(index + d + cards.length) % cards.length]; preload(n.art); preload(n.pop?.src); }
  }

  function renderControls() {
    $('dots').textContent = `${index + 1} / ${cards.length}`;
    $('prev').hidden = $('next').hidden = cards.length < 2;
    $('remove').hidden = !cards[index]?.id; // only cards added on this device can be removed
  }

  // used by editor.js
  window.HoloApp = {
    add(c, select) { cards.push(c); if (select) show(cards.length - 1); else renderControls(); },
    current: () => cards[index],
    all: () => cards,
    keyOf: (c) => c.id || `${c.name}|${c.info?.number || ''}`, // one card's key in this browser's storage
    rerender: () => window.HoloValue?.render(cards[index]),
    removeCurrent() {
      const [c] = cards.splice(index, 1);
      show(Math.min(index, cards.length - 1));
      return c;
    },
  };

  function placePop() {
    const c = cards[index];
    pop.classList.toggle('on', !!c.pop);
    if (!c.pop) return;
    // art position inside the card (offsets ignore the 3D tilt)
    let x = 0, y = 0;
    for (let el = art; el && el !== card; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
    const [l, t, w, h] = c.pop.box;
    const W = art.offsetWidth, H = art.offsetHeight;
    const pw = (w / 100) * W, ph = (h / 100) * H;
    Object.assign(pop.style, {
      left: `${x + (l / 100) * W}px`, top: `${y + (t / 100) * H}px`, width: `${pw}px`, height: `${ph}px`,
    });
    // Bend the cut-out onto a shallow cylinder bulging toward the viewer: thin vertical
    // strips, each turned to follow the curve. Face-on it looks flat; as the card tilts
    // the strips foreshorten unevenly, so it reads as a rounded surface.
    const N = 24, BEND = (32 * Math.PI) / 180;          // half-angle of the curve
    const R = pw / 2 / Math.sin(BEND), slice = pw / N;
    let html = '';
    for (let i = 0; i < N; i++) {
      const cx = (i + 0.5) * slice - pw / 2;          // strip centre, from the middle
      const a = Math.asin(cx / R);
      const z = R * (Math.cos(a) - Math.cos(BEND));
      const k = 1 / Math.cos(a);                        // widen so its projection is one slice
      const sw = slice * k;
      html += `<i style="left:${cx + pw / 2 - sw / 2 - 1}px;width:${sw + 2}px;` +
        `background-size:${pw * k}px ${ph}px;background-position:${1 - i * slice * k}px 0;` +
        `transform:translateZ(${z.toFixed(2)}px) rotateY(${a.toFixed(4)}rad)"></i>`;
    }
    pop.innerHTML = html;
    pop.style.setProperty('--pop-src', `url("${c.pop.src}")`);
    pop.classList.add('on');
  }

  art.addEventListener('load', () => {
    sizeSparkles();
    sizeAmbience();
    placePop();
    getComputedStyle(pop.firstElementChild || pop).opacity; // new strips start hidden, so they fade in with the card
    card.classList.remove('swap');
  });
  addEventListener('resize', () => { sizeSparkles(); sizeAmbience(); placePop(); });

  $('prev').onclick = () => show(index - 1);
  $('next').onclick = () => show(index + 1);
  addEventListener('keydown', (e) => {
    if (document.body.classList.contains('editing')) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  // ---------- tilt: finger/mouse, or idle wobble ----------
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let lastInput = -1e9;
  const MAX = 6; // degrees: the card itself barely turns

  function aim(nx, ny) {
    target.x = Math.max(-1, Math.min(1, nx));
    target.y = Math.max(-1, Math.min(1, ny));
    lastInput = performance.now();
  }

  // mouse: the card leans toward the pointer. finger: drag to tilt it, let go and it settles back.
  let down = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    stage.setPointerCapture(e.pointerId);
    down = { x: e.clientX - target.x * 120, y: e.clientY - target.y * 120 };
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      const r = stage.getBoundingClientRect();
      aim(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    } else if (down) {
      aim((e.clientX - down.x) / 120, (e.clientY - down.y) / 120);
    }
  });
  const release = () => { down = null; lastInput = performance.now() - 1500; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);


  // ---------- holo ----------
  // Three kinds, like real cards: holo (sparkles in the art window), reverse holo (sparkles
  // on everything except the art window) and non-holo. One sparkle style for all: dense
  // specks in the card's own colours plus a few bright star glints, at different depths,
  // sliding with the tilt far more than the card turns; that's what makes it feel 3D.
  const STYLES = ['holo', 'reverse', 'none'];
  const STYLE_NAMES = { holo: 'Holo', reverse: 'Reverse holo', none: 'Non-holo' };
  const GLITTER_COLORS = [190, 300, 50, 160, 330, 210]; // when a card doesn't name its own
  const styleKey = (c) => `holo-kind:${window.HoloApp.keyOf(c)}`;
  function styleOf(c) {
    let saved = null;
    try { saved = localStorage.getItem(styleKey(c)); } catch {}
    if (STYLES.includes(saved)) return saved;
    if (STYLES.includes(c.style)) return c.style;
    return c.glitter === false ? 'none' : 'holo';
  }
  // the art window, [left, top, width, height] in % of the card
  const windowOf = (c) => c.holo || [8, 10, 84, 38];
  function applyStyle() {
    const c = cards[index], st = styleOf(c);
    card.dataset.holo = st; // CSS: no foil on non-holo cards
    // Foil and shine where real cards have them: holo only in the art window, reverse holo
    // everywhere except the art window.
    const [l, t, w, h] = windowOf(c), r = l + w, b = t + h;
    card.style.setProperty('--foil', st === 'reverse'
      ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}% ${t}%, ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%, ${l}% ${t}%)`
      : `inset(${t}% ${100 - r}% ${100 - b}% ${l}%)`);
    // the background inside the art window drifts a little behind the frame (not on full-art
    // cards, where the text sits on the picture)
    bg.hidden = h > 80;
    bg.style.clipPath = `inset(${t}% ${100 - r}% ${100 - b}% ${l}%)`;
    bg.firstElementChild.style.transformOrigin = `${l + w / 2}% ${t + h / 2}%`;
    $('styleBtn').textContent = `✨ ${STYLE_NAMES[st]}`;
    buildParticles();
  }
  $('styleBtn').onclick = () => {
    const c = cards[index], next = STYLES[(STYLES.indexOf(styleOf(c)) + 1) % STYLES.length];
    try { localStorage.setItem(styleKey(c), next); } catch {}
    applyStyle();
  };

  let specks = [], glints = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function sizeSparkles() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
  }
  function buildParticles() {
    const c = cards[index];
    specks = []; glints = [];
    if (styleOf(c) === 'none') return;
    const area = canvas.clientWidth * canvas.clientHeight;
    const hues = Array.isArray(c.glitter) && c.glitter.length ? c.glitter : GLITTER_COLORS;
    const hue = () => hues[(Math.random() * hues.length) | 0];
    // specks cover the whole card; drawing clips them to the window (holo) or the rest (reverse)
    specks = Array.from({ length: Math.round(area / 110) }, () => ({
      x: Math.random(), y: Math.random(), r: 0.8 + Math.random() ** 2.5 * 2.6,
      depth: Math.random() ** 1.5, hue: Math.random() < 0.3 ? -1 : hue(), // -1 = white
      speed: rnd(1, 4), phase: rnd(0, 6.3),
    }));
    glints = Array.from({ length: Math.round(area / 2600) }, () => ({
      x: Math.random(), y: Math.random(), r: rnd(2.5, 7), depth: Math.random(),
      hue: Math.random() < 0.5 ? -1 : hue(), speed: rnd(0.7, 2), phase: rnd(0, 6.3),
    }));
  }

  function star(x, y, r) {
    const k = r * 0.18;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + k, y - k, x + r, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + r);
    ctx.quadraticCurveTo(x - k, y + k, x - r, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - r);
    ctx.fill();
  }

  // 0..1, flashing as the viewing angle sweeps past a particle, like real foil
  const flash = (phase, t, speed, k = 6) => Math.max(0, Math.sin(phase + t * speed * 0.4 + (cur.x - cur.y) * k * speed)) ** 3;
  const colour = (h, a, light) => (h < 0 ? `rgba(255,255,255,${a})` : `hsla(${h}, 100%, ${light}%, ${a})`);

  function drawSparkles(t) {
    const w = canvas.clientWidth, h = canvas.clientHeight, c = cards[index];
    ctx.clearRect(0, 0, w, h);
    if (!specks.length) return;
    ctx.globalCompositeOperation = 'lighter';
    const box = c.holo || [8, 10, 84, 38];
    const bx = (box[0] / 100) * w, by = (box[1] / 100) * h, bw = (box[2] / 100) * w, bh = (box[3] / 100) * h;
    ctx.save();
    ctx.beginPath();
    if (styleOf(c) === 'reverse') { ctx.rect(0, 0, w, h); ctx.rect(bx, by, bw, bh); ctx.clip('evenodd'); }
    else { ctx.rect(bx, by, bw, bh); ctx.clip(); }
    const SHIFT = 70; // px of slide at full tilt for the deepest specks
    const wrap = (v, m) => ((v % m) + m) % m;
    for (const g of specks) {
      const x = wrap(g.x * w - cur.x * SHIFT * (0.25 + g.depth), w), y = wrap(g.y * h - cur.y * SHIFT * 0.7 * (0.25 + g.depth), h);
      const a = 0.2 + 0.8 * flash(g.phase, t, g.speed);
      const s = g.r * (1.2 - g.depth * 0.5);
      ctx.fillStyle = colour(g.hue, 0.45 + a * 0.55, 72 + 24 * a);
      ctx.fillRect(x, y, s, s);
    }
    for (const g of glints) {
      const a = flash(g.phase, t, g.speed, 4);
      if (a < 0.05) continue;
      const x = wrap(g.x * w - cur.x * SHIFT * (0.25 + g.depth), w), y = wrap(g.y * h - cur.y * SHIFT * 0.7 * (0.25 + g.depth), h);
      ctx.fillStyle = colour(g.hue, a, 85);
      star(x, y, g.r * (0.5 + 0.6 * a));
    }
    ctx.restore();
  }

  // ---------- ambience: a gentle animation in the art window, behind the character ----------
  // Each card gets the one that suits its picture (Gemini picks it when the card is added;
  // otherwise it's guessed from the card's colours). All are drawn from time alone, so there's
  // no state to keep, and they shift a little with the tilt for depth.
  const AMBIENCE = {
    embers: { per: 1500, hues: [28, 18, 40] },
    bubbles: { per: 3800, hues: [195, 205] },
    leaves: { per: 6500, hues: [95, 75, 125] },
    petals: { per: 6500, hues: [335, 350, 315] },
    sparks: { per: 9000, hues: [55, 195] },
    snow: { per: 2600, hues: [-1] },
    mist: { per: 30000, hues: null },
    stars: { per: 2600, hues: null },
    dust: { per: 2600, hues: null },
  };
  function ambienceOf(c) {
    if (AMBIENCE[c.ambience]) return c.ambience;
    const h = Array.isArray(c.glitter) && c.glitter.length ? c.glitter[0] : null;
    if (h === null) return 'dust';
    return h < 50 || h >= 345 ? 'embers' : h < 70 ? 'sparks' : h < 170 ? 'leaves' : h < 250 ? 'bubbles' : h < 300 ? 'stars' : 'petals';
  }
  let motes = [], ambType = 'dust';
  const sprites = new Map(); // soft round glow per colour, drawn once
  function sprite(hue, light = 70) {
    const k = `${hue}/${light}`;
    if (!sprites.has(k)) {
      const sc = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }), g = sc.getContext('2d');
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16), col = hue < 0 ? '255,255,255' : null;
      const c0 = col ? `rgba(${col},1)` : `hsla(${hue},100%,${light + 15}%,1)`;
      const c1 = col ? `rgba(${col},.35)` : `hsla(${hue},100%,${light}%,.35)`;
      grd.addColorStop(0, c0); grd.addColorStop(0.35, c1); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
      sprites.set(k, sc);
    }
    return sprites.get(k);
  }
  function sizeAmbience() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    amb.width = amb.clientWidth * dpr;
    amb.height = amb.clientHeight * dpr;
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildAmbience();
  }
  function buildAmbience() {
    const c = cards[index];
    ambType = ambienceOf(c);
    const cfg = AMBIENCE[ambType], [, , w, h] = windowOf(c);
    const area = (amb.clientWidth * w / 100) * (amb.clientHeight * h / 100);
    const hues = cfg.hues || (Array.isArray(c.glitter) && c.glitter.length ? c.glitter : [45, 200]);
    motes = Array.from({ length: Math.max(3, Math.round(area / cfg.per)) }, () => ({
      x: Math.random(), y: Math.random(), depth: Math.random(), phase: Math.random(),
      speed: rnd(0.6, 1.4), size: rnd(0.6, 1.4), hue: hues[(Math.random() * hues.length) | 0], spin: rnd(-1, 1),
    }));
  }
  function drawAmbience(t) {
    const W = amb.clientWidth, H = amb.clientHeight;
    actx.clearRect(0, 0, W, H);
    if (!motes.length || reduceMotion) return;
    const [l, tp, w, h] = windowOf(cards[index]);
    const bx = (l / 100) * W, by = (tp / 100) * H, bw = (w / 100) * W, bh = (h / 100) * H;
    const u = W / 200; // size unit: half a percent of the card, the same on every card
    actx.save();
    actx.beginPath(); actx.rect(bx, by, bw, bh); actx.clip();
    const frac = (v) => v - Math.floor(v);
    for (const m of motes) {
      const px = -cur.x * 12 * (0.3 + m.depth), py = -cur.y * 9 * (0.3 + m.depth); // parallax
      const life = frac(t * 0.06 * m.speed + m.phase); // 0..1, loops
      const fade = Math.sin(Math.PI * life);
      let x = bx + m.x * bw + px, y, a = 1, r = u * m.size * 1.8;
      switch (ambType) {
        case 'embers': // rise and flicker, swaying
          y = by + bh * (1.05 - life * 1.15); x += Math.sin(t * 1.3 * m.speed + m.phase * 9) * u * 3;
          a = fade * (0.6 + 0.4 * Math.sin(t * 9 * m.speed + m.phase * 20)); r *= 2.4;
          actx.globalCompositeOperation = 'lighter';
          actx.globalAlpha = Math.max(0, a); actx.drawImage(sprite(m.hue, 62), x - r * 2.5, y - r * 2.5, r * 5, r * 5);
          actx.drawImage(sprite(-1), x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); // white-hot core
          break;
        case 'bubbles': // rise, wobble, little rings
          y = by + bh * (1.05 - life * 1.15) + py; x += Math.sin(t * 2 * m.speed + m.phase * 9) * u * 1.5;
          r *= 1.3 + m.depth * 1.5;
          actx.globalCompositeOperation = 'source-over';
          actx.globalAlpha = fade * 0.55;
          actx.strokeStyle = `hsla(${m.hue},90%,85%,1)`; actx.lineWidth = Math.max(0.6, r * 0.18);
          actx.beginPath(); actx.arc(x, y, r, 0, 7); actx.stroke();
          actx.fillStyle = 'rgba(255,255,255,.8)'; actx.beginPath(); actx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, 7); actx.fill();
          break;
        case 'leaves': case 'petals': { // drift down and across, turning
          y = by + bh * (-0.05 + life * 1.1) + py; x += Math.sin(t * 0.9 * m.speed + m.phase * 9) * u * 6 + life * u * 10;
          const len = r * (ambType === 'leaves' ? 3.2 : 2.4), wid = len * (0.35 + 0.25 * Math.abs(Math.sin(t * 1.5 * m.spin + m.phase * 9)));
          actx.globalCompositeOperation = 'source-over';
          actx.globalAlpha = fade * 0.75;
          actx.fillStyle = `hsla(${m.hue},${ambType === 'leaves' ? 55 : 80}%,${ambType === 'leaves' ? 45 : 78}%,1)`;
          actx.beginPath(); actx.ellipse(x, y, len, wid, t * m.spin + m.phase * 6, 0, 7); actx.fill();
          break;
        }
        case 'sparks': { // a brief zig-zag flash now and then
          const k = frac(t * 0.35 * m.speed + m.phase);
          if (k > 0.08) break;
          const seed = Math.floor(t * 0.35 * m.speed + m.phase) * 13.37 + m.x * 99;
          actx.globalCompositeOperation = 'lighter';
          actx.globalAlpha = Math.sin((k / 0.08) * Math.PI);
          actx.strokeStyle = `hsla(${m.hue},100%,80%,1)`; actx.lineWidth = Math.max(1, u * 0.5);
          actx.shadowColor = `hsla(${m.hue},100%,60%,1)`; actx.shadowBlur = u * 3;
          let sx = bx + frac(Math.sin(seed) * 999) * bw, sy = by + frac(Math.sin(seed * 2) * 999) * bh;
          actx.beginPath(); actx.moveTo(sx, sy);
          for (let i = 1; i <= 5; i++) { sx += (frac(Math.sin(seed * i * 3) * 999) - 0.5) * u * 9; sy += u * 3 + frac(Math.sin(seed * i * 5) * 999) * u * 4; actx.lineTo(sx, sy); }
          actx.stroke(); actx.shadowBlur = 0;
          break;
        }
        case 'snow': // fall slowly, swaying
          y = by + bh * (-0.05 + life * 1.1) + py; x += Math.sin(t * 0.8 * m.speed + m.phase * 9) * u * 3;
          actx.globalCompositeOperation = 'source-over';
          actx.globalAlpha = fade * (0.5 + m.depth * 0.5);
          actx.drawImage(sprite(-1), x - r * 1.5, y - r * 1.5, r * 3, r * 3);
          break;
        case 'mist': { // big soft clouds sliding across
          const big = Math.max(bw, bh) * (0.35 + m.size * 0.25);
          x = bx - big + frac(m.x + t * 0.012 * m.speed) * (bw + big * 2) + px;
          y = by + m.y * bh + Math.sin(t * 0.2 + m.phase * 9) * u * 4;
          actx.globalCompositeOperation = 'screen';
          actx.globalAlpha = 0.16;
          actx.drawImage(sprite(m.hue, 80), x - big, y - big * 0.6, big * 2, big * 1.2);
          break;
        }
        case 'stars': // twinkle in place
          y = by + m.y * bh + py;
          a = 0.15 + 0.85 * Math.max(0, Math.sin(t * 1.8 * m.speed + m.phase * 20)) ** 4;
          actx.globalCompositeOperation = 'lighter';
          actx.globalAlpha = a; actx.drawImage(sprite(m.hue, 80), x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
          break;
        default: // dust: motes of light floating every which way
          x += Math.sin(t * 0.25 * m.speed + m.phase * 9) * u * 8;
          y = by + m.y * bh + py + Math.cos(t * 0.2 * m.speed + m.phase * 7) * u * 6;
          actx.globalCompositeOperation = 'lighter';
          actx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * m.speed + m.phase * 20));
          actx.drawImage(sprite(m.hue, 75), x - r * 1.5, y - r * 1.5, r * 3, r * 3);
      }
    }
    actx.restore();
  }

  // ---------- frame loop ----------
  function frame(now) {
    const t = now / 1000;
    if (!down && now - lastInput > 2500 && !reduceMotion) {
      target.x = Math.sin(t * 0.55) * 0.5;
      target.y = Math.cos(t * 0.4) * 0.35;
    }
    cur.x += (target.x - cur.x) * 0.08;
    cur.y += (target.y - cur.y) * 0.08;
    const s = card.style;
    s.setProperty('--tx', `${cur.x * MAX}deg`);
    s.setProperty('--ty', `${-cur.y * MAX}deg`);
    s.setProperty('--px', cur.x.toFixed(3));
    s.setProperty('--py', cur.y.toFixed(3));
    drawSparkles(reduceMotion ? 1 : t);
    drawAmbience(t);
    // background inside the art window: drifts slowly and slides against the tilt
    const dx = -cur.x * 1.4 + (reduceMotion ? 0 : Math.sin(t * 0.13) * 0.5), dy = -cur.y * 1.1 + (reduceMotion ? 0 : Math.cos(t * 0.11) * 0.4);
    bg.firstElementChild.style.transform = `translate(${dx.toFixed(3)}%, ${dy.toFixed(3)}%) scale(1.07)`;
    requestAnimationFrame(frame);
  }

  show(0);
  requestAnimationFrame(frame);
})();
