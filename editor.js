// "Add card": pick a card (character removed) + the character, process the character
// into the puffed style, place it on the card, and save it in this browser (IndexedDB).
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

  // ---------- step 1: pick images ----------
  const editor = $('editor'), status = $('pickStatus');
  let artCanvas = null, charCanvas = null;

  function open() {
    artCanvas = charCanvas = null;
    $('fileArt').value = $('fileChar').value = $('cardName').value = '';
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

  const ready = () => { $('nextPick').disabled = !(artCanvas && charCanvas); };
  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let the status show

  $('fileArt').onchange = async (e) => {
    const f = e.target.files[0];
    artCanvas = null; ready();
    if (!f) return;
    try {
      artCanvas = P.cropCard(await P.loadImage(f));
      if (!$('cardName').value) $('cardName').value = f.name.replace(/\.[^.]+$/, '');
    } catch (err) { status.textContent = err.message; }
    ready();
  };

  $('fileChar').onchange = async (e) => {
    const f = e.target.files[0];
    charCanvas = null; ready();
    if (!f) return;
    try {
      status.textContent = 'Removing the background…';
      await paint();
      const cut = P.cutout(await P.loadImage(f));
      status.textContent = 'Adding the 3D shading…';
      await paint();
      charCanvas = P.stylize(cut);
      status.textContent = 'Character ready.';
    } catch (err) { status.textContent = err.message; }
    ready();
  };

  // ---------- step 2: place the character ----------
  const place = $('place'), placeChar = $('placeChar'), fadeLine = $('fadeLine'), size = $('charSize');
  let pos = null; // { l, t, w, fade } in % of the card

  $('nextPick').onclick = () => {
    $('placeArt').src = artCanvas.toDataURL('image/jpeg', 0.9);
    placeChar.src = charCanvas.toDataURL('image/png');
    pos = { l: 3, t: 4, w: 94, fade: 50 };
    size.value = pos.w;
    $('stepPick').hidden = true; $('stepPlace').hidden = false;
    requestAnimationFrame(render);
  };
  $('backPlace').onclick = () => { $('stepPick').hidden = false; $('stepPlace').hidden = true; };

  const charHeightPct = () => {
    const W = place.clientWidth, H = place.clientHeight;
    return ((pos.w / 100) * W * (charCanvas.height / charCanvas.width) / H) * 100;
  };

  function render() {
    const H = place.clientHeight;
    Object.assign(placeChar.style, { left: `${pos.l}%`, top: `${pos.t}%`, width: `${pos.w}%` });
    fadeLine.style.top = `${pos.fade}%`;
    // preview the fade on the character
    const ch = (charHeightPct() / 100) * H, end = ((pos.fade - pos.t) / 100) * H;
    const mask = `linear-gradient(to bottom, #000 ${end - 0.07 * ch}px, transparent ${end}px)`;
    placeChar.style.webkitMaskImage = placeChar.style.maskImage = mask;
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
  dragger(placeChar, (dx, dy) => { pos.l += dx; pos.t += dy; });
  dragger(fadeLine, (dx, dy) => { pos.fade = Math.min(100, Math.max(5, pos.fade + dy)); });
  size.oninput = () => {
    const centre = pos.l + pos.w / 2;
    pos.w = +size.value;
    pos.l = centre - pos.w / 2;
    render();
  };

  $('savePlace').onclick = async () => {
    const btn = $('savePlace');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const h = charHeightPct();
      const pop = P.fadeBottom(charCanvas, (pos.fade - pos.t) / h);
      const rec = {
        id: Date.now().toString(36),
        name: $('cardName').value.trim() || 'My card',
        art: await P.toBlob(artCanvas, 'image/jpeg', 0.9),
        pop: await P.toBlob(pop, 'image/png'),
        box: [pos.l, pos.t, pos.w, h],
        holo: [8, 10, 84, Math.max(5, Math.min(pos.fade, 95) - 10)], // glitter: the art window above the fade line
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
