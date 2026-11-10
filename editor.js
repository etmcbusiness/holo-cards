// "Add card": one photo of a card in, a holo card out. The card is cropped from its
// background, the art window found, the character cut out with Segment Anything and
// painted out of the card, given the puffed 3D style, and placed so it breaks out of the
// frame. Tapping the preview adds or removes parts of the character.
// Saved in this browser (IndexedDB).
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.HoloProcess, app = window.HoloApp;

  // ---------- storage ----------
  const STORE = 'cards';
  let dbp = null;
  const db = () => (dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open('holo-cards', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
  async function req(mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
      t.oncomplete = () => ok(r.result);
      t.onerror = () => fail(t.error);
    });
  }

  const toCard = (rec) => ({
    id: rec.id, name: rec.name, holo: rec.holo,
    art: URL.createObjectURL(rec.art),
    pop: { src: URL.createObjectURL(rec.pop), box: rec.box },
  });

  req('readonly', (s) => s.getAll())
    .then((recs) => recs.forEach((r) => app.add(toCard(r), false)))
    .catch((e) => console.warn('Saved cards unavailable:', e));

  $('remove').onclick = async () => {
    const c = app.current();
    if (!c?.id || !confirm(`Remove ${c.name} from this device?`)) return;
    await req('readwrite', (s) => s.delete(c.id));
    app.removeCurrent();
    URL.revokeObjectURL(c.art); URL.revokeObjectURL(c.pop.src);
  };

  // ---------- step 1: one photo ----------
  const editor = $('editor'), status = $('pickStatus');
  // made: { card, crop, x0, y0, seg, points, win {l,t,r,b} %, erased, char, pos {l,t,w} % }
  let made = null, busy = false;

  function open() {
    made = null;
    $('fileCard').value = $('cardName').value = '';
    status.textContent = '';
    $('nextPick').disabled = true;
    $('stepPick').hidden = false; $('stepPlace').hidden = true;
    editor.hidden = false;
    document.body.classList.add('editing');
  }
  function close() {
    editor.hidden = true;
    document.body.classList.remove('editing');
  }
  $('add').onclick = open;
  $('cancelPick').onclick = close;

  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let the status show
  const say = async (msg) => { status.textContent = msg; await paint(); };

  $('fileCard').onchange = async (e) => {
    const f = e.target.files[0];
    made = null; $('nextPick').disabled = true;
    if (!f || busy) return;
    busy = true;
    try {
      if (!$('cardName').value) $('cardName').value = f.name.replace(/\.[^.]+$/, '');
      await say('Finding the card…');
      const card = P.cropCard(await P.loadImage(f));
      const w = P.findWindow(card);
      const { crop, x, y } = P.windowCrop(card, w);
      await say('Looking at the art…');
      const seg = await P.segmenter(crop, (frac) => {
        status.textContent = `Downloading the cut-out tool (first time only)… ${Math.round(frac * 100)}%`;
      });
      made = {
        card, crop, x0: x, y0: y, seg,
        win: { l: w.l * 100, t: w.t * 100, r: w.r * 100, b: w.b * 100 },
        points: [{ x: crop.width * 0.55, y: crop.height * 0.62, on: true }], // the character is usually here
      };
      await say('Cutting out the character…');
      await rebuild();
      status.textContent = 'Ready.';
      $('nextPick').disabled = false;
      showPlace();
    } catch (err) {
      console.error(err);
      status.textContent = err.message || 'Something went wrong.';
    } finally {
      busy = false;
    }
  };

  // tap points -> mask -> character cut out, card painted over, 3D style, placement
  async function rebuild() {
    const mask = await made.seg(made.points);
    const full = P.applyMask(made.crop, mask);
    const cut = P.trimAt(full);
    if (!cut) throw new Error('Could not find a character in the art. Try a straighter, closer photo.');
    made.erased = P.eraseFromCard(made.card, full, made.x0, made.y0);
    made.char = P.stylize(cut.canvas);
    // where it was, in % of the card; then 10% bigger with its feet fixed, so it breaks out of the frame
    const W = made.card.width, H = made.card.height;
    const w0 = (made.char.width / W) * 100, l0 = ((made.x0 + cut.x) / W) * 100, t0 = ((made.y0 + cut.y) / H) * 100;
    const h0 = (made.char.height / H) * 100, grow = 1.1;
    made.pos = { w: w0 * grow, l: l0 + w0 / 2 - (w0 * grow) / 2, t: t0 + h0 - h0 * grow };
  }

  // ---------- step 2: check and adjust ----------
  const place = $('place'), placeChar = $('placeChar'), winBox = $('win'), size = $('charSize');
  let tapAdds = true;

  function showPlace() {
    $('placeArt').src = made.erased.toDataURL('image/jpeg', 0.9);
    placeChar.src = made.char.toDataURL('image/png');
    size.value = Math.round(made.pos.w);
    $('stepPick').hidden = true; $('stepPlace').hidden = false;
    requestAnimationFrame(render);
  }
  $('nextPick').onclick = showPlace;
  $('backPlace').onclick = () => { $('stepPick').hidden = false; $('stepPlace').hidden = true; };

  const charHeightPct = () => {
    const W = place.clientWidth, H = place.clientHeight;
    return ((made.pos.w / 100) * W * (made.char.height / made.char.width) / H) * 100;
  };

  function render() {
    const { pos, win } = made, H = place.clientHeight;
    Object.assign(placeChar.style, { left: `${pos.l}%`, top: `${pos.t}%`, width: `${pos.w}%` });
    Object.assign(winBox.style, { left: `${win.l}%`, top: `${win.t}%`, width: `${win.r - win.l}%`, height: `${win.b - win.t}%` });
    // preview the fade at the bottom of the art window
    const ch = (charHeightPct() / 100) * H, end = ((win.b - pos.t) / 100) * H;
    placeChar.style.webkitMaskImage = placeChar.style.maskImage =
      `linear-gradient(to bottom, #000 ${end - 0.07 * ch}px, transparent ${end}px)`;
    $('tapMode').textContent = tapAdds ? 'Tapping adds' : 'Tapping removes';
    $('tapMode').classList.toggle('removing', !tapAdds);
  }

  async function redo(change) {
    if (busy) return;
    busy = true; place.classList.add('working');
    const before = made.points;
    try {
      change();
      await paint();
      await rebuild();
      showPlace();
    } catch (err) {
      made.points = before;
      alert(err.message);
    } finally {
      busy = false; place.classList.remove('working');
    }
  }

  // tap on the card = add/remove that spot from the character
  function tapAt(e) {
    const r = place.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * made.card.width - made.x0;
    const y = ((e.clientY - r.top) / r.height) * made.card.height - made.y0;
    if (x < 0 || y < 0 || x >= made.crop.width || y >= made.crop.height) return; // outside the art window
    redo(() => { made.points = [...made.points, { x, y, on: tapAdds }]; });
  }
  $('tapMode').onclick = () => { tapAdds = !tapAdds; render(); };
  $('tapReset').onclick = () => redo(() => { made.points = made.points.slice(0, 1); });

  // drags move things; a press without movement counts as a tap
  function dragger(el, onMove) {
    let last = null, moved = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY }; moved = 0;
    });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 6) return;
      onMove((dx / place.clientWidth) * 100, (dy / place.clientHeight) * 100);
      last = { x: e.clientX, y: e.clientY };
      render();
    });
    el.addEventListener('pointerup', (e) => {
      if (last && moved < 6) tapAt(e);
      last = null;
    });
    el.addEventListener('pointercancel', () => { last = null; });
  }
  dragger(placeChar, (dx, dy) => { made.pos.l += dx; made.pos.t += dy; });
  dragger($('placeArt'), () => {});
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  for (const edge of winBox.querySelectorAll('[data-edge]')) {
    const k = edge.dataset.edge;
    dragger(edge, (dx, dy) => {
      const w = made.win;
      if (k === 't') w.t = clamp(w.t + dy, 0, w.b - 5);
      if (k === 'b') w.b = clamp(w.b + dy, w.t + 5, 100);
      if (k === 'l') w.l = clamp(w.l + dx, 0, w.r - 5);
      if (k === 'r') w.r = clamp(w.r + dx, w.l + 5, 100);
    });
  }
  size.oninput = () => {
    const p = made.pos, centre = p.l + p.w / 2, feet = p.t + charHeightPct();
    p.w = +size.value;
    p.l = centre - p.w / 2;
    p.t = feet - charHeightPct();
    render();
  };

  $('savePlace').onclick = async () => {
    const btn = $('savePlace');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { pos, win } = made, h = charHeightPct();
      const pop = P.fadeBottom(made.char, (win.b - pos.t) / h);
      const rec = {
        id: Date.now().toString(36),
        name: $('cardName').value.trim() || 'My card',
        art: await P.toBlob(made.erased, 'image/jpeg', 0.9),
        pop: await P.toBlob(pop, 'image/png'),
        box: [pos.l, pos.t, pos.w, h],
        holo: [win.l, win.t, win.r - win.l, win.b - win.t],
      };
      await req('readwrite', (s) => s.put(rec));
      app.add(toCard(rec), true);
      close();
    } catch (err) {
      alert(`Could not save the card: ${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = 'Save card';
    }
  };
})();
