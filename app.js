(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), card = $('card'), art = $('art'), pop = $('pop'), popImg = $('popImg');
  const canvas = $('sparkles'), ctx = canvas.getContext('2d');
  const cards = window.CARDS;
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
      document.title = c.name;
      [...$('dots').children].forEach((d, n) => d.classList.toggle('on', n === index));
    }, 200);
  }

  function placePop() {
    const c = cards[index];
    if (!c.pop) return;
    // art position inside the card (offsets ignore the 3D tilt)
    let x = 0, y = 0;
    for (let el = art; el && el !== card; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
    const [l, t, w, h] = c.pop.box;
    const W = art.offsetWidth, H = art.offsetHeight;
    const pw = (w / 100) * W, ph = (h / 100) * H, pad = ph * 0.1; // pad: room above for the bob
    const left = x + (l / 100) * W, top = y + (t / 100) * H;
    // the box ends at the cut line and hides what's below it (overflow, not clip-path: Safari flickers with clip-path in 3D)
    const bottom = c.pop.cut == null ? top + ph + pad : y + (c.pop.cut / 100) * H;
    Object.assign(pop.style, {
      left: `${left - pad}px`, top: `${top - pad}px`,
      width: `${pw + 2 * pad}px`, height: `${bottom - top + pad}px`,
    });
    Object.assign(pop.firstElementChild.style, {
      left: `${pad}px`, top: `${pad}px`, width: `${pw}px`, height: `${ph}px`,
    });
    if (popImg.getAttribute('src') !== c.pop.src) {
      popImg.src = c.pop.src;
      pop.style.setProperty('--pop-src', `url("${c.pop.src}")`);
    }
    pop.classList.toggle('bob', !!c.pop.float);
    pop.classList.add('on');
  }

  art.addEventListener('load', () => {
    sizeSparkles();
    placePop();
    card.classList.remove('swap');
  });
  addEventListener('resize', () => { sizeSparkles(); placePop(); });

  $('dots').innerHTML = cards.map(() => '<i></i>').join('');
  document.querySelector('.controls').style.visibility = cards.length > 1 ? '' : 'hidden';
  $('prev').onclick = () => show(index - 1);
  $('next').onclick = () => show(index + 1);
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  // ---------- tilt: pointer, phone motion, or idle wobble ----------
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let lastInput = -1e9;
  const MAX = 16; // degrees

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

  let base = null;
  function onOrient(e) {
    if (e.beta == null) return;
    if (!base) base = { b: e.beta, g: e.gamma };
    aim((e.gamma - base.g) / 25, (e.beta - base.b) / 25);
  }
  const DOE = window.DeviceOrientationEvent;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && DOE && typeof DOE.requestPermission === 'function') {
    // iOS asks before giving motion data
    const btn = $('motion');
    btn.hidden = false;
    btn.onclick = async () => {
      if ((await DOE.requestPermission().catch(() => 'denied')) === 'granted') {
        addEventListener('deviceorientation', onOrient);
        btn.hidden = true;
      } else btn.textContent = 'Motion blocked';
    };
  } else if (touch && DOE) {
    addEventListener('deviceorientation', onOrient);
  }

  // ---------- sparkles ----------
  let stars = [];
  function sizeSparkles() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((canvas.clientWidth * canvas.clientHeight) / 1500);
    stars = Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random(),
      r: 2 + Math.random() ** 3 * 9,
      speed: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.55 ? 50 : Math.random() * 360,
      depth: 0.3 + Math.random(),
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

  function drawSparkles(t) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const a = Math.max(0, Math.sin(s.phase + t * s.speed)) ** 4;
      if (a < 0.02) continue;
      const x = s.x * w + cur.x * 10 * s.depth, y = s.y * h + cur.y * 10 * s.depth;
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
