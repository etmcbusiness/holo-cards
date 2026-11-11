// "All cards": a grid of the whole collection with its total value. Tap a card to open it, or
// Select several and change them together: foil, details (game, set, year, edition), grade,
// look their values up again, or remove them.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = () => window.HoloApp, V = () => window.HoloValue, store = () => window.HoloStore;
  const sheet = $('collection'), grid = $('colGrid');
  let selecting = false;
  const picked = new Set();

  const money = (n) => `$${n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
  const kindKey = (c) => `holo-kind:${app().keyOf(c)}`;

  function open() {
    selecting = false; picked.clear();
    sheet.hidden = false;
    document.body.classList.add('editing');
    draw();
  }
  function close() {
    sheet.hidden = true;
    $('colEdit').hidden = true;
    document.body.classList.remove('editing');
  }

  function draw() {
    const cards = app().all();
    const total = cards.reduce((s, c) => s + (+V().get(c).price || 0), 0);
    $('colTitle').textContent = `My cards (${cards.length})`;
    $('colTotal').textContent = total ? `Worth about ${money(total)}` : '';
    $('colSelect').textContent = selecting ? 'Cancel' : 'Select';
    $('colAll').hidden = !selecting;
    $('colBar').hidden = !selecting;
    $('colCount').textContent = `${picked.size} selected`;
    for (const b of $('colBar').querySelectorAll('button')) b.disabled = !picked.size;
    grid.innerHTML = '';
    cards.forEach((c, i) => {
      const cell = document.createElement('button');
      cell.className = 'cell' + (picked.has(c) ? ' on' : '');
      const img = document.createElement('img'); img.alt = '';
      thumb(c).then((src) => { img.src = src; });
      const name = document.createElement('b'); name.textContent = c.name;
      const v = V().get(c);
      const val = document.createElement('span'); val.textContent = v.price ? money(+v.price) : '';
      cell.append(img, name, val);
      if (selecting) cell.append(Object.assign(document.createElement('i'), { className: 'tick' }));
      cell.onclick = () => {
        if (!selecting) { close(); app().go(i); return; }
        picked.has(c) ? picked.delete(c) : picked.add(c);
        draw();
      };
      grid.append(cell);
    });
  }

  // A small picture of the card with its character back on it (a saved card's art has the
  // character filled out of it; the character is a separate picture). Made once per card.
  const thumbs = new WeakMap();
  const loaded = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
  function thumb(c) {
    if (!thumbs.has(c)) thumbs.set(c, (async () => {
      const art = await loaded(c.art);
      if (!art || !c.pop) return c.art;
      const W = 240, H = Math.round((W * art.naturalHeight) / art.naturalWidth);
      const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = cv.getContext('2d');
      x.drawImage(art, 0, 0, W, H);
      const pop = await loaded(c.pop.src);
      if (pop) { const [l, t, w, h] = c.pop.box; x.drawImage(pop, (l / 100) * W, (t / 100) * H, (w / 100) * W, (h / 100) * H); }
      return cv.toDataURL('image/jpeg', 0.85);
    })());
    return thumbs.get(c);
  }

  $('gridBtn').onclick = open;
  $('colDone').onclick = close;
  $('colSelect').onclick = () => { selecting = !selecting; picked.clear(); draw(); };
  $('colAll').onclick = () => {
    const all = app().all();
    if (picked.size === all.length) picked.clear(); else all.forEach((c) => picked.add(c));
    draw();
  };

  // ---------- actions on the selected cards ----------
  const done = (msg) => { $('colMsg').textContent = msg; setTimeout(() => { $('colMsg').textContent = ''; }, 3500); };

  for (const b of $('colFoil').querySelectorAll('button')) {
    b.onclick = () => {
      for (const c of picked) try { localStorage.setItem(kindKey(c), b.dataset.kind); } catch {}
      app().refresh();
      done(`Foil set on ${picked.size} card${picked.size === 1 ? '' : 's'}`);
      draw();
    };
  }

  // edit details: only the fields filled in are changed
  const FIELDS = { game: 'ceGame', set: 'ceSet', year: 'ceYear', edition: 'ceEdition' };
  $('colEditBtn').onclick = () => {
    for (const id of Object.values(FIELDS)) $(id).value = '';
    $('ceGrader').value = ''; $('ceGrade').value = '';
    $('ceTitle').textContent = `Edit ${picked.size} card${picked.size === 1 ? '' : 's'}`;
    $('colEdit').hidden = false;
  };
  $('ceCancel').onclick = () => { $('colEdit').hidden = true; };
  $('ceApply').onclick = async () => {
    const info = {};
    for (const [k, id] of Object.entries(FIELDS)) { const v = $(id).value.trim(); if (v) info[k] = v; }
    const grader = $('ceGrader').value, grade = $('ceGrade').value.trim();
    const btn = $('ceApply');
    btn.disabled = true;
    try {
      for (const c of picked) {
        if (Object.keys(info).length) await store().updateCard(c, { info });
        if (grader || grade) V().setGrade(c, { ...(grader ? { grader } : {}), ...(grade ? { grade, estimated: false } : {}) });
      }
      app().refresh();
      $('colEdit').hidden = true;
      done(`Updated ${picked.size} card${picked.size === 1 ? '' : 's'}`);
      draw();
    } catch (e) {
      alert(`Could not save: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  };

  // look the values up again, one at a time (each is a web search)
  $('colValue').onclick = async () => {
    const list = [...picked], btn = $('colValue');
    btn.disabled = true;
    let n = 0, failed = 0;
    for (const c of list) {
      $('colMsg').textContent = `Looking up values… ${++n} of ${list.length}`;
      try { await V().lookup(c); } catch { failed++; }
    }
    btn.disabled = false;
    done(failed ? `Done; ${failed} had no recent sales` : 'Values updated');
    draw();
  };

  // remove: tap once to arm ("Tap again to remove 3"), again to remove
  let armed = 0;
  $('colRemove').onclick = async () => {
    const list = [...picked], btn = $('colRemove');
    if (!armed) {
      armed = setTimeout(() => { armed = 0; btn.textContent = 'Remove'; btn.classList.remove('armed'); }, 4000);
      btn.textContent = `Tap again to remove ${list.length}`;
      btn.classList.add('armed');
      return;
    }
    clearTimeout(armed); armed = 0;
    btn.textContent = 'Remove'; btn.classList.remove('armed');
    for (const c of list) await store().removeCard(c).catch((e) => console.warn('Could not remove', c.name, e));
    picked.clear();
    done(`Removed ${list.length}`);
    draw();
  };
})();
