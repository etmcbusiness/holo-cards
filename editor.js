// "Add card": a plain photo of a card (Gemini paints the character out and isolates it), or
// one image with the card (character removed) and the cut-out side by side (no AI needed).
// The character gets the puffed 3D style and is placed so it breaks out of the frame.
// Adjust if needed, then save in this browser (IndexedDB).
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.HoloProcess, AI = window.HoloAI, app = window.HoloApp;

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
    id: rec.id, name: rec.name, info: rec.info, holo: rec.holo, glitter: rec.glitter, style: rec.style, ambience: rec.ambience,
    art: URL.createObjectURL(rec.art),
    pop: { src: URL.createObjectURL(rec.pop), box: rec.box },
  });

  req('readonly', (s) => s.getAll())
    .then((recs) => recs.filter((r) => !/^ai\d*:/.test(r.id)).forEach((r) => app.add(toCard(r), false))) // ai…: = kept Gemini results
    .catch((e) => console.warn('Saved cards unavailable:', e));

  $('remove').onclick = async () => {
    const c = app.current();
    if (!c?.id || !confirm(`Remove ${c.name} from this device?`)) return;
    await req('readwrite', (s) => s.delete(c.id));
    app.removeCurrent();
    URL.revokeObjectURL(c.art); URL.revokeObjectURL(c.pop.src);
  };

  // ---------- step 1: "+ Add card" opens the photo picker; then it all happens ----------
  const editor = $('editor'), status = $('pickStatus');
  let made = null, busy = false, holoKind = 'holo'; // made: { card, char, pos {l,t,w}, win {l,t,r,b} } in % of the card

  const pickPhoto = () => { $('fileCard').value = ''; $('fileCard').click(); };
  function close() {
    editor.hidden = true;
    document.body.classList.remove('editing');
  }
  function showWork(msg, failed = false) {
    editor.hidden = false;
    document.body.classList.add('editing');
    $('stepWork').hidden = false; $('stepPlace').hidden = true; $('stepKey').hidden = true;
    status.textContent = msg;
    $('spinner').hidden = failed;
    $('retryPick').hidden = !failed;
  }
  $('add').onclick = pickPhoto;
  $('retryPick').onclick = pickPhoto;
  $('cancelPick').onclick = close;
  $('backPlace').onclick = close;

  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let the status show
  const say = async (msg) => { showWork(msg); await paint(); };

  // holo kind: holo (sparkles in the art window), reverse (everywhere else) or none
  const KINDS = ['holo', 'reverse', 'none'];
  const KIND_NAMES = { holo: '✨ Holo', reverse: '✨ Reverse holo', none: 'Non-holo' };
  function setHolo(kind) {
    holoKind = kind;
    $('holoToggle').setAttribute('aria-pressed', kind !== 'none');
    $('holoToggle').textContent = `${KIND_NAMES[kind]} (tap to change)`;
  }
  $('holoToggle').onclick = () => setHolo(KINDS[(KINDS.indexOf(holoKind) + 1) % KINDS.length]);

  // card details: filled in from Gemini's reading of the card, editable before saving
  const INFO_FIELDS = { game: 'cardGame', set: 'cardSet', year: 'cardYear', number: 'cardNumber', edition: 'cardEdition' };
  function fillInfo(info) {
    $('cardName').value = info.name || '';
    for (const [k, id] of Object.entries(INFO_FIELDS)) $(id).value = info[k] || '';
    // grade: the slab's label if it's graded, else Gemini's estimate of its condition
    const g = info.grading || {}, slab = g.company && g.grade;
    const est = Math.round(Math.min(10, Math.max(1, +info.condition?.grade || 0))) || '';
    $('cardGrader').value = slab ? (['PSA', 'BGS', 'CGC', 'SGC', 'TAG'].includes(g.company.toUpperCase()) ? g.company.toUpperCase() : 'Other') : 'Raw';
    $('cardGrade').value = slab ? g.grade : est;
    gradeExtra = slab ? { cert: g.cert || '' } : { estimated: !!est, note: info.condition?.note || '' };
    $('condNote').textContent = slab ? '' : est ? `Estimated condition: ${est}/10. ${info.condition?.note || ''}` : '';
  }
  let gradeExtra = {};
  const readInfo = () => Object.fromEntries(Object.entries(INFO_FIELDS).map(([k, id]) => [k, $(id).value.trim()]));

  // one-time Gemini key screen; resolves once a key is saved
  let keyWaiter = null;
  function askForKey(msg) {
    editor.hidden = false;
    document.body.classList.add('editing');
    $('stepWork').hidden = true; $('stepPlace').hidden = true; $('stepKey').hidden = false;
    $('keyMsg').textContent = msg || '';
    $('keyInput').value = '';
    return new Promise((ok) => { keyWaiter = ok; });
  }
  $('keySave').onclick = () => {
    const k = $('keyInput').value.trim();
    if (!k) return;
    AI.setKey(k);
    $('stepKey').hidden = true;
    keyWaiter?.(); keyWaiter = null;
  };
  $('keyCancel').onclick = () => { $('stepKey').hidden = true; close(); };

  let pending = null; // the photo being processed, kept so a new key can retry it
  $('fileCard').onchange = (e) => { const f = e.target.files[0]; if (f) build(f); };

  async function build(f) {
    if (busy) return;
    busy = true; made = null; pending = f;
    try {
      fillInfo({});
      await say('Looking at the photo…');
      const img = await P.loadImage(f);
      // A cheap text call reads the card's name, set, grade etc. (skipped without a key)
      const identify = (c) => (AI.getKey() ? AI.identify(c).catch((e) => { console.warn('Could not identify the card:', e); return null; }) : null);
      // and another finds the art window and the character on the flat card
      const inspect = (c) => (AI.getKey() ? AI.inspect(c).catch((e) => { console.warn('Could not inspect the card:', e); return null; }) : null);
      // Already split (card + cut-out side by side)? No image AI needed.
      const split = P.splitLayered(img);
      let info;
      if (split) {
        const id = identify(split.card), layout = inspect(split.card);
        made = fromSplit(split, null, await layout);
        showPlace();
        info = await id;
      } else {
        if (!AI.getKey()) await askForKey();
        await say('Reading the card…');
        info = await identify(P.fit(img, 1600));
        // straighten and crop it exactly using the corners Gemini found, else trim plain borders
        const ok = Array.isArray(info?.corners) && info.corners.length === 4 && info.corners.every((p) => p?.length === 2);
        const ratio = /yu-?gi-?oh/i.test(info?.game || '') ? 59 / 86 : 63 / 88;
        const card = ok ? P.straighten(img, info.corners, ratio) : P.cropCard(img);
        const layout = inspect(card); // runs while Gemini separates the character
        const sep = await fromPhoto(card);
        await say('Adding the 3D shading…');
        made = fromSplit(sep, card, await layout);
        showPlace();
      }
      if (info && made) {
        fillInfo(info);
        if (['holo', 'reverse', 'none'].includes(info.foil)) setHolo(info.foil);
      }
    } catch (err) {
      console.error(err);
      if (err instanceof AI.KeyError) {
        AI.setKey('');
        busy = false;
        await askForKey(err.message);
        return build(pending);
      }
      showWork(err.message || 'Something went wrong.', true);
    } finally {
      busy = false;
    }
  }

  const hOfFor = (card, char) => (wPct) => (wPct / 100) * card.width * (char.height / char.width) / card.height * 100;
  const pct = (w) => ({ l: w.l * 100, t: w.t * 100, r: w.r * 100, b: w.b * 100 });

  // `ref`: the original card photo (character still in it), when the split card is a
  // repainted copy whose framing may differ a little.
  // `layout`: { win, char, ambience } from Gemini (AI.inspect), in % of the card, or null.
  // Gemini's art window is used when there is one: on full-art cards the line-finding guess
  // picks some text box instead, and the character got faded off at its bottom edge.
  function fromSplit(split, ref = null, layout = null) {
    const card = split.card, hOf = hOfFor(card, split.char);
    const w = layout?.win ? { l: layout.win.l / 100, t: layout.win.t / 100, r: layout.win.r / 100, b: layout.win.b / 100 } : P.findWindow(card);
    const win = pct(w);
    let pos;
    const found = P.locate(ref || card, split.char);
    // Is the match the character? Near the size Gemini saw, else (no layout) not much
    // narrower than the art window.
    const cb = layout?.char;
    const plausible = (f) => (cb
      ? f.w * 100 > (cb.r - cb.l) * 0.6 && f.w * 100 < (cb.r - cb.l) * 1.6
      : f.w * 100 > (win.r - win.l) * 0.35);
    const at = found && plausible(found) ? found : null;
    if (at) {
      // sit where the character is on the card, a little bigger so it covers the original
      // and breaks out of the frame (12% over itself; 6% when the card was repainted)
      let x0 = at.x, y0 = at.y, x1 = at.x + at.w;
      if (ref && !layout?.win) { // map through the art window both share
        const wr = P.findWindow(ref);
        const map = (v, a, b, A, B) => A + ((v - a) / (b - a)) * (B - A);
        x0 = map(at.x, wr.l, wr.r, w.l, w.r); x1 = map(at.x + at.w, wr.l, wr.r, w.l, w.r);
        y0 = map(at.y, wr.t, wr.b, w.t, w.b);
      }
      const w0 = (x1 - x0) * 100, cx = x0 * 100 + w0 / 2, cy = y0 * 100 + hOf(w0) / 2, w1 = w0 * (ref ? 1.06 : 1.12);
      pos = { w: w1, l: cx - w1 / 2, t: cy - hOf(w1) / 2 };
    } else if (cb) {
      // Gemini's box around the character: fit the cut-out inside it, centred
      const fitW = Math.min(cb.r - cb.l, ((cb.b - cb.t) / hOf(100)) * 100) * 1.06;
      pos = { w: fitW, l: (cb.l + cb.r) / 2 - fitW / 2, t: (cb.t + cb.b) / 2 - hOf(fitW) / 2 };
    } else {
      // no match: centre it on the art window, 8% wider than the window
      const w1 = (win.r - win.l) * 1.08;
      pos = { w: w1, l: (win.l + win.r) / 2 - w1 / 2, t: (win.t + win.b) / 2 - hOf(w1) / 2 };
    }
    const glitter = P.glitterFor(ref || card, ref && !layout?.win ? P.findWindow(ref) : w);
    setHolo(ref ? glitter.kind : 'holo'); // a repainted card has lost its foil texture, so only guess from the photo
    return {
      card, char: P.stylize(split.char), pos, win, hues: glitter.hues,
      ambience: layout?.ambience || null, photoCard: ref, layout,
    };
  }

  // A plain photo of a card: one Gemini call returns the card with the character painted
  // out and the character cut out beside it; that's split like a hand-made layered image.
  // quality 'fast' (cheapest model) first; if that result is clearly wrong it retries once
  // with 'best'. `fresh` skips the kept result (the "Redo with better AI" button).
  // Returns the split { card, char }.
  async function fromPhoto(card, quality = 'fast', fresh = false) {
    // Gemini's answer for this photo is kept, so trying the same photo again costs nothing
    const cacheId = `ai2:${pending.name}:${pending.size}:${pending.lastModified}`;
    const hit = fresh ? null : await req('readonly', (s) => s.get(cacheId)).catch(() => null);
    let layered;
    if (hit) {
      layered = await P.loadImage(new File([hit.layered], 'l.png'));
    } else {
      await say(quality === 'best'
        ? 'Trying again with Gemini’s better model… (about 30 seconds)'
        : 'Gemini is separating the character from the card… (about 20 seconds)');
      layered = await AI.layered(card, quality);
    }
    await say('Checking the result…');
    const split = P.splitLayered(layered);
    // wrong if it can't be split, or the character is still there on the "erased" card
    const bad = !split || P.locate(split.card, split.char);
    if (bad) {
      await req('readwrite', (s) => s.delete(cacheId)).catch(() => {});
      if (quality === 'fast') return fromPhoto(card, 'best', true);
      if (!split) throw new Error("Gemini couldn't separate this card. Try a sharper, straighter photo.");
      // best effort: keep it; the user can adjust or redo
    } else if (!hit) {
      const keep = { id: cacheId, layered: await P.toBlob(layered, 'image/png') };
      await req('readwrite', (s) => s.put(keep)).catch((e) => console.warn('Could not keep the Gemini result:', e));
    }
    return split;
  }

  // editor button: redo the separation with the better (pricier) model
  $('redoBest').onclick = async () => {
    if (busy || !made?.photoCard) return;
    busy = true;
    const kind = holoKind, { photoCard, layout } = made; // the details typed in stay as they are
    try {
      const sep = await fromPhoto(photoCard, 'best', true);
      made = fromSplit(sep, photoCard, layout);
      showPlace();
    } catch (err) {
      console.error(err);
      showWork(err.message || 'Something went wrong.', true);
    } finally {
      setHolo(kind);
      busy = false;
    }
  };

  // ---------- step 2: check and adjust ----------
  const place = $('place'), placeChar = $('placeChar'), winBox = $('win'), size = $('charSize');

  function showPlace() {
    $('placeArt').src = made.card.toDataURL('image/jpeg', 0.9);
    placeChar.src = made.char.toDataURL('image/png');
    $('redoBest').hidden = !made.photoCard; // only for cards Gemini separated
    size.value = Math.round(made.pos.w);
    $('stepWork').hidden = true; $('stepPlace').hidden = false;
    requestAnimationFrame(render);
  }

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
        name: $('cardName').value.trim() || `Card ${new Date().toLocaleDateString()}`,
        info: readInfo(), // set, year, number, edition
        art: await P.toBlob(made.card, 'image/jpeg', 0.9),
        pop: await P.toBlob(pop, 'image/png'),
        box: [pos.l, pos.t, pos.w, h],
        holo: [win.l, win.t, win.r - win.l, win.b - win.t],
        glitter: made.hues,
        style: holoKind, // holo, reverse or none; the ✨ button on the main screen changes it
        ambience: made.ambience, // the background animation (app.js picks one from the colours when null)
      };
      await req('readwrite', (s) => s.put(rec));
      const c = toCard(rec);
      // its grade, then look up what it sells for at that grade (value.js)
      window.HoloValue?.start(c, {
        grader: $('cardGrader').value, grade: $('cardGrade').value.trim(), foil: holoKind, ...gradeExtra,
      });
      app.add(c, true);
      close();
    } catch (err) {
      alert(`Could not save the card: ${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = 'Save card';
    }
  };
})();
