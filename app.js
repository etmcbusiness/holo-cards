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
      card.classList.toggle('matte', c.glitter === false); // no foil on non-holo cards
      document.title = c.name;
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


  // ---------- sparkles ----------
  // A few big twinkling stars over the whole card, plus dense hologram glitter in the
  // card's art window. The glitter sits at different depths and slides with the tilt
  // far more than the card turns; that's what makes it feel 3D.
  let stars = [], glitter = [];
  const GLITTER_COLORS = [190, 300, 50, 160, 330, 210]; // when a card doesn't name its own
  function sizeSparkles() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const area = canvas.clientWidth * canvas.clientHeight;
    const c = cards[index];
    if (c.glitter === false) { stars = []; glitter = []; return; } // not a holo card
    const hues = c.glitter || GLITTER_COLORS;
    stars = Array.from({ length: Math.round(area / 9000) }, () => ({
      x: Math.random(), y: Math.random(),
      r: 3 + Math.random() ** 2 * 7,
      speed: 0.6 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.6 ? 50 : hues[(Math.random() * hues.length) | 0],
      depth: 0.3 + Math.random(),
    }));
    glitter = Array.from({ length: Math.round(area / 160) }, () => ({
      x: Math.random(), y: Math.random(),
      r: 1 + Math.random() ** 2 * 2.6,
      depth: Math.random() ** 1.5,          // 0 = near the card, 1 = deep behind it
      hue: hues[(Math.random() * hues.length) | 0],
      speed: 1 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function drawGlitter(t, w, h) {
    const box = cards[index].holo;
    if (!box) return;
    const bx = (box[0] / 100) * w, by = (box[1] / 100) * h, bw = (box[2] / 100) * w, bh = (box[3] / 100) * h;
    ctx.save();
    ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    const SHIFT = 70; // px of slide at full tilt for the deepest glitter
    for (const g of glitter) {
      // deeper specks slide further, and wrap around inside the window
      let x = (g.x * bw - cur.x * SHIFT * (0.25 + g.depth)) % bw; if (x < 0) x += bw;
      let y = (g.y * bh - cur.y * SHIFT * 0.7 * (0.25 + g.depth)) % bh; if (y < 0) y += bh;
      // each speck flashes as the angle sweeps past it, like real holo foil
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(g.phase + t * g.speed * 0.4 + (cur.x - cur.y) * 6 * g.speed)) ** 3;
      ctx.fillStyle = `hsla(${g.hue}, 100%, ${62 + 30 * a}%, ${0.35 + a * 0.65})`;
      ctx.fillRect(bx + x, by + y, g.r * (1.2 - g.depth * 0.5), g.r * (1.2 - g.depth * 0.5));
    }
    ctx.restore();
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

  function drawSparkles(t) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    drawGlitter(t, w, h);
    for (const s of stars) {
      const a = Math.max(0, Math.sin(s.phase + t * s.speed)) ** 4;
      if (a < 0.02) continue;
      const x = s.x * w - cur.x * 30 * s.depth, y = s.y * h - cur.y * 30 * s.depth;
      ctx.fillStyle = `hsla(${s.hue}, 100%, 82%, ${a})`;
      star(x, y, s.r * (0.6 + 0.4 * a));
      if (s.r > 5) { ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`; star(x, y, s.r * 0.35); }
    }
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
