(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), card = $('card'), art = $('art'), pop = $('pop');
  const canvas = $('sparkles'), ctx = canvas.getContext('2d');
  const cards = [...window.CARDS]; // built-in cards; ones added on this device are appended by editor.js
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;

  // ---------- card content ----------
  function show(i) {
    index = (i + cards.length) % cards.length;
    const c = cards[index];
    card.classList.add('swap');
    setTimeout(() => {
      pop.classList.remove('on');
      art.alt = c.name;
      art.src = c.art;
      applyStyle();
      document.title = c.name;
      const i = c.info || {};
      $('caption').querySelector('b').textContent = c.name;
      $('caption').querySelector('span').textContent = [i.set, i.year, i.number, i.edition].filter(Boolean).join(' · ');
      renderControls();
    }, 200);
  }

  function renderControls() {
    $('dots').innerHTML = cards.map((_, n) => `<i class="${n === index ? 'on' : ''}"></i>`).join('');
    $('prev').hidden = $('next').hidden = cards.length < 2;
    $('remove').hidden = !cards[index]?.id; // only cards added on this device can be removed
  }

  // used by editor.js
  window.HoloApp = {
    add(c, select) { cards.push(c); if (select) show(cards.length - 1); else renderControls(); },
    current: () => cards[index],
    removeCurrent() {
      const [c] = cards.splice(index, 1);
      show(Math.min(index, cards.length - 1));
      return c;
    },
  };

  function placePop() {
    const c = cards[index];
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
    placePop();
    card.classList.remove('swap');
  });
  addEventListener('resize', () => { sizeSparkles(); placePop(); });

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
  const styleKey = (c) => `holo-kind:${c.id || `${c.name}|${c.info?.number || ""}`}`;
  function styleOf(c) {
    let saved = null;
    try { saved = localStorage.getItem(styleKey(c)); } catch {}
    if (STYLES.includes(saved)) return saved;
    if (STYLES.includes(c.style)) return c.style;
    return c.glitter === false ? 'none' : 'holo';
  }
  function applyStyle() {
    const st = styleOf(cards[index]);
    card.dataset.holo = st; // CSS: no foil on non-holo cards
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
    requestAnimationFrame(frame);
  }

  show(0);
  requestAnimationFrame(frame);
})();
