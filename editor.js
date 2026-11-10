// "Add card": one image with the card (character removed) and the cut-out character side by
// side. It's split apart, the character gets the puffed 3D style and is placed over the art
// window a little larger so it breaks out of the frame. Adjust if needed, then save in this
// browser (IndexedDB).
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

  // ---------- step 1: one image ----------
  const editor = $('editor'), status = $('pickStatus');
  let made = null, busy = false; // { card, char, pos {l,t,w}, win {l,t,r,b} } in % of the card

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
      await say('Splitting the card and the character…');
      const split = P.splitLayered(await P.loadImage(f));
      if (!split) throw new Error('Use one image with the card (character removed) on one side and the cut-out character on the other.');
      await say('Adding the 3D shading…');
      const char = P.stylize(split.char);
      const w = P.findWindow(split.card);
      const win = { l: w.l * 100, t: w.t * 100, r: w.r * 100, b: w.b * 100 };
      // centre it on the art window, 8% wider than the window, so it breaks out of the frame
      const wPct = (win.r - win.l) * 1.08;
      const hPct = (wPct / 100) * split.card.width * (char.height / char.width) / split.card.height * 100;
      const pos = { w: wPct, l: (win.l + win.r) / 2 - wPct / 2, t: (win.t + win.b) / 2 - hPct / 2 };
      made = { card: split.card, char, pos, win };
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

  // ---------- step 2: check and adjust ----------
  const place = $('place'), placeChar = $('placeChar'), winBox = $('win'), size = $('charSize');

  function showPlace() {
    $('placeArt').src = made.card.toDataURL('image/jpeg', 0.9);
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
  }

  function dragger(el, onMove) {
    let last = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (!last) return;
      onMove((e.clientX - last.x) / place.clientWidth * 100, (e.clientY - last.y) / place.clientHeight * 100);
      last = { x: e.clientX, y: e.clientY };
      render();
    });
    const end = () => { last = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  dragger(placeChar, (dx, dy) => { made.pos.l += dx; made.pos.t += dy; });
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
    const p = made.pos, cx = p.l + p.w / 2, cy = p.t + charHeightPct() / 2;
    p.w = +size.value;
    p.l = cx - p.w / 2;
    p.t = cy - charHeightPct() / 2;
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
        art: await P.toBlob(made.card, 'image/jpeg', 0.9),
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
