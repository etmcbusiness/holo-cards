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
    .then((recs) => recs.filter((r) => !/^(ai\d*|q):/.test(r.id)).forEach((r) => app.add(toCard(r), false))) // ai…: kept Gemini results, q: queued photos (bulk.js)
    .catch((e) => console.warn('Saved cards unavailable:', e));

  // remove: an in-app sheet asks first
  const sheet = $('confirmRemove');
  const closeSheet = () => { sheet.hidden = true; document.body.classList.remove('editing'); };
  $('remove').onclick = () => {
    const c = app.current();
    if (!c) return;
    $('rmTitle').textContent = `Remove ${c.name}?`;
    $('rmThumb').src = c.art;
    sheet.hidden = false;
    document.body.classList.add('editing');
  };
  $('rmNo').onclick = closeSheet;
  sheet.onclick = (e) => { if (e.target === sheet) closeSheet(); };
  $('rmYes').onclick = async () => {
    const c = app.current();
    closeSheet();
    if (c) await removeCard(c);
  };
  async function removeCard(c) {
    if (c.id) await req('readwrite', (s) => s.delete(c.id)); // a built-in card is just hidden (app.js)
    for (const k of ['holo-value', 'holo-kind', 'holo-edit']) try { localStorage.removeItem(`${k}:${app.keyOf(c)}`); } catch {}
    app.remove(c);
    if (c.id) { URL.revokeObjectURL(c.art); URL.revokeObjectURL(c.pop.src); }
  }
  // a card's details changed (collection.js bulk edit): saved cards in IndexedDB, built-in ones
  // as an override in localStorage (app.js applies it on start)
  async function updateCard(c, patch) {
    if (patch.name) c.name = patch.name;
    if (patch.info) c.info = { ...(c.info || {}), ...patch.info };
    if (c.id) {
      const rec = await req('readonly', (s) => s.get(c.id));
      if (rec) await req('readwrite', (s) => s.put({ ...rec, name: c.name, info: c.info }));
    } else {
      try { localStorage.setItem(`holo-edit:${app.keyOf(c)}`, JSON.stringify({ name: c.name, info: c.info })); } catch {}
    }
  }

  // ---------- step 1: "+ Add card" opens the photo picker; then it all happens ----------
  const editor = $('editor'), status = $('pickStatus');
  let made = null, busy = false, holoKind = 'holo'; // made: { card, char, pos {l,t,w}, win {l,t,r,b} } in % of the card

  const pickPhoto = () => { $('fileCard').value = ''; $('fileCard').click(); };
  function close() {
    editing = null;
    editor.hidden = true;
    document.body.classList.remove('editing');
  }
  function showWork(msg, failed = false) {
    editor.hidden = false;
    document.body.classList.add('editing');
    $('stepWork').hidden = false; $('stepPlace').hidden = true; $('stepKey').hidden = true; $('stepCrop').hidden = true;
    status.textContent = msg;
    $('spinner').hidden = failed;
    $('retryPick').hidden = !failed;
    $('ownCharBtn').hidden = true;
    $('geminiCutBtn').hidden = true;
  }
  // "+ Add card": photos for Gemini, or the user's own cut-out plus the card
  const choice = $('addChoice');
  const closeChoice = () => { choice.hidden = true; };
  $('add').onclick = () => { choice.hidden = false; };
  $('addCancel').onclick = closeChoice;
  choice.onclick = (e) => { if (e.target === choice) closeChoice(); };
  $('addAi').onclick = () => { closeChoice(); pickPhoto(); };
  $('addOwn').onclick = () => { closeChoice(); $('fileOwnCard').value = ''; $('fileOwnCard').click(); };
  $('retryPick').onclick = pickPhoto;
  $('cancelPick').onclick = close;
  $('backPlace').onclick = close;

  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let the status show
  const say = async (msg) => { showWork(msg); await paint(); };

  // holo kind: holo (sparkles in the art window), reverse (everywhere else) or none
  const KINDS = ['holo', 'reverse', 'none'];

  function setHolo(kind) {
    holoKind = kind;
    for (const b of $('holoSeg').children) b.setAttribute('aria-checked', b.dataset.kind === kind);
  }
  for (const b of $('holoSeg').children) b.onclick = () => setHolo(b.dataset.kind);

  // card details: filled in from Gemini's reading of the card, editable before saving
  const INFO_FIELDS = { game: 'cardGame', set: 'cardSet', year: 'cardYear', number: 'cardNumber', edition: 'cardEdition' };
  // grade: the slab's label if it's graded, else Gemini's estimate of its condition
  function gradeFrom(info) {
    const g = info.grading || {}, slab = g.company && g.grade;
    const est = Math.round(Math.min(10, Math.max(1, +info.condition?.grade || 0))) || '';
    return {
      grader: slab ? (['PSA', 'BGS', 'CGC', 'SGC', 'TAG'].includes(g.company.toUpperCase()) ? g.company.toUpperCase() : 'Other') : 'Raw',
      grade: slab ? g.grade : est,
      extra: slab ? { cert: g.cert || '' } : { estimated: !!est, note: info.condition?.note || '' },
      note: slab ? '' : est ? `Estimated condition: ${est}/10. ${info.condition?.note || ''}` : '',
    };
  }
  function fillInfo(info) {
    $('cardName').value = info.name || '';
    for (const [k, id] of Object.entries(INFO_FIELDS)) $(id).value = info[k] || '';
    const g = gradeFrom(info);
    $('cardGrader').value = g.grader;
    $('cardGrade').value = g.grade;
    gradeExtra = g.extra;
    $('condNote').textContent = g.note;
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
  // One photo: step by step with the user. Several: the user checks each crop, one after the
  // other ("3 of 20"); everything else then happens in the background (bulk.js).
  $('fileCard').onchange = async (e) => {
    const files = [...e.target.files];
    if (files.length === 1) return build(files[0]);
    if (!files.length || busy) return;
    busy = true;
    try {
      if (!AI.getKey()) await askForKey();
      const jobs = [];
      for (const [i, f] of files.entries()) {
        await say(`Opening photo ${i + 1} of ${files.length}…`);
        const img = await P.loadImage(f).catch(() => null);
        if (!img) continue;
        const corners = await askCrop(img, [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 63 / 88,
          { label: `Check the crop · ${i + 1} of ${files.length}`, skip: 'Skip this one' });
        URL.revokeObjectURL(img.src);
        if (corners === 'stop') break;
        if (corners) jobs.push({ file: f, corners: [...corners], rect: !!corners.rect });
      }
      close();
      if (jobs.length) window.HoloBulk.enqueue(jobs);
    } finally {
      busy = false;
    }
  };

  // Gemini reads the card (name, set, grade…) and finds the art window; both skipped without a key
  const identify = (c) => (AI.getKey() ? AI.identify(c).catch((e) => { if (e instanceof AI.StopError) throw e; console.warn('Could not identify the card:', e); return null; }) : null);
  const inspect = (c) => (AI.getKey() ? AI.inspect(c).catch((e) => { if (e instanceof AI.StopError) throw e; console.warn('Could not inspect the card:', e); return null; }) : null);
  const ratioFor = (info) => (/yu-?gi-?oh/i.test(info?.game || '') ? 59 / 86 : 63 / 88);
  // the checked crop -> the flat card: a rectangle crop is used exactly as drawn (no snapping,
  // its own shape); a corners crop is snapped onto the card's edges and made card-shaped
  const cropTo = (img, corners, ratio) => P.straighten(img, corners, corners.rect ? null : ratio, { snap: !corners.rect });
  const FOILS = ['holo', 'reverse', 'none'];

  // The straightened card -> made: Gemini marks which pixels are the character; it's cut from
  // the card's own pixels (nothing redrawn); without an outline the card stays as it is
  async function cutAndPlace(card) {
    const [layout, mask] = await Promise.all([
      inspect(card),
      AI.cutMask(card, P.keyColours(card))
        .then((m) => m && { body: m.mask, fx: null, clean: P.removeText(card, m.image, m.mask) })
        .catch((e) => { if (e instanceof AI.StopError) throw e; console.warn('Could not cut out the character:', e); return null; }),
    ]);
    return mask ? fromMask(card, mask, layout) : fromNothing(card, layout);
  }

  // A photo added with nobody watching (bulk.js): Gemini's corners for the crop (else the whole
  // photo), Gemini's reading for the details and grade, then saved like the Save button does.
  // corners: the crop the user checked (0-1000 of the photo), else Gemini's guess
  async function autoAdd(file, checked = null, rect = false) {
    if (checked) checked = Object.assign([...checked], { rect });
    const img = await P.loadImage(file);
    const split = P.splitLayered(img);
    let info, made;
    if (split) {
      const [i, layout] = await Promise.all([identify(split.card), inspect(split.card)]);
      info = i; made = fromSplit(split, null, layout);
    } else {
      info = await identify(P.fit(img, 1600));
      const four = Array.isArray(info?.corners) && info.corners.length === 4 && info.corners.every((p) => p?.length === 2);
      const corners = checked || (four ? info.corners : [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]);
      made = await cutAndPlace(cropTo(img, corners, ratioFor(info)));
      if (made.message) throw new Error("Couldn't cut out the character this time. Tap Retry.");
    }
    const g = gradeFrom(info || {});
    return saveRecord(made, {
      photo: await P.toBlob(P.fit(img, 1600), 'image/jpeg', 0.85),
      name: info?.name || file.name.replace(/\.[a-z0-9]+$/i, ''),
      info: Object.fromEntries(Object.keys(INFO_FIELDS).map((k) => [k, info?.[k] || ''])),
      kind: FOILS.includes(info?.foil) ? info.foil : made.kind,
      grade: { grader: g.grader, grade: String(g.grade || ''), ...g.extra },
      select: false,
    });
  }

  async function build(f) {
    if (busy) return;
    busy = true; made = null; pending = f; editing = null;
    try {
      fillInfo({});
      await say('Looking at the photo…');
      const img = await P.loadImage(f);
      photoBlob = await P.toBlob(P.fit(img, 1600), 'image/jpeg', 0.85);
      // Already split (card + cut-out side by side)? No image AI needed.
      const split = P.splitLayered(img);
      let info;
      if (split) {
        const id = identify(split.card), layout = inspect(split.card);
        made = fromSplit(split, null, await layout);
        setHolo(made.kind);
        showPlace();
        info = await id;
      } else {
        if (!AI.getKey()) await askForKey();
        await say('Reading the card…');
        info = await identify(P.fit(img, 1600));
        const ratio = ratioFor(info);
        // the crop starts as the whole picture; the user drags it in to the card (asked for 2026-11-10)
        const corners = await askCrop(img, [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], ratio);
        if (!corners) { close(); return; }
        const card = cropTo(img, corners, ratio);
        await say('Cutting out the character… (about 20 seconds)');
        made = await cutAndPlace(card);
        setHolo(made.kind);
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
    return {
      kind: ref ? glitter.kind : 'holo', fx: null, // a repainted card has lost its foil texture, so only guess from the photo
      card, char: P.stylize(split.char), pos, win, hues: glitter.hues,
      ambience: layout?.ambience || null, photoCard: ref, layout,
    };
  }

  // The character cut from the card itself by Gemini's mask, sitting exactly where it was (a
  // touch bigger so it covers its own outline); the hole behind it filled in.
  // masks: { body, fx } (fx: the character's own fire, kept separately when known; null otherwise); withFx: include the character's own fire/breath.
  // the card as it is, with nothing popping out (an empty cut-out)
  function fromNothing(card, layout) {
    const w = layout?.win ? { l: layout.win.l / 100, t: layout.win.t / 100, r: layout.win.r / 100, b: layout.win.b / 100 } : P.findWindow(card);
    const glitter = P.glitterFor(card, w);
    return {
      kind: glitter.kind, fx: null,
      card, char: Object.assign(document.createElement('canvas'), { width: 4, height: 4 }), win: pct(w), hues: glitter.hues,
      pos: { w: 1, l: 0, t: 0 }, ambience: layout?.ambience || null, photoCard: card, layout,
      message: "Couldn't outline the character this time, so it won't pop out. Save as it is, or try adding it again.",
    };
  }

  function fromMask(card, masks, layout, withFx = true) {
    let mask = masks.body;
    if (withFx && masks.fx) {
      mask = Object.assign(document.createElement('canvas'), { width: card.width, height: card.height });
      const x = mask.getContext('2d', { willReadFrequently: true });
      x.drawImage(masks.body, 0, 0); x.drawImage(masks.fx, 0, 0);
    }
    const char = P.maskCut(masks.clean || card, mask), o = char.offset; // clean: card text taken off the character
    const w = layout?.win ? { l: layout.win.l / 100, t: layout.win.t / 100, r: layout.win.r / 100, b: layout.win.b / 100 } : P.findWindow(card);
    const w0 = (char.width / card.width) * 100, h0 = (char.height / card.height) * 100, w1 = w0; // exactly over itself (app.js undoes the 3D enlargement)
    const cx = (o.x / card.width) * 100 + w0 / 2, cy = (o.y / card.height) * 100 + h0 / 2;
    const glitter = P.glitterFor(card, w);
    return {
      kind: glitter.kind, fx: masks.fx ? withFx : null,
      card: P.inpaint(card, mask), char: P.stylize(char), win: pct(w), hues: glitter.hues,
      pos: { w: w1, l: cx - w1 / 2, t: cy - h0 / 2 },
      ambience: layout?.ambience || null, photoCard: card, layout, masks, withFx,
    };
  }

  // the "fire & effects" switch: only shown when Gemini found effects coming from the character
  function showFx(on) {
    const b = $('fxToggle');
    b.hidden = on === null;
    b.setAttribute('aria-checked', !!on);
  }
  $('fxToggle').onclick = () => {
    if (!made?.masks) return;
    const { win, pos } = made, kind = holoKind, oldW = pos.w;
    made = fromMask(made.photoCard, made.masks, made.layout, !made.withFx);
    made.win = win; // keep the art window as it was adjusted
    setHolo(kind);
    if (Math.abs(oldW - made.pos.w) < 0.01) made.pos = pos;
    showPlace();
  };

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

  // ---------- check the crop: four draggable corners over the photo ----------
  // corners on a 0-1000 scale of the photo (top-left, top-right, bottom-right, bottom-left);
  // resolves with the checked corners, or null on Cancel.
  // opts: { label: the heading, skip: text for the left button (bulk: skip this photo) }; the
  // left button resolves null, and with `skip` there's also "Stop" ('stop')
  function askCrop(img, corners, ratio, opts = {}) {
    $('cropTitle').textContent = opts.label || 'Check the crop';
    $('cropCancel').textContent = opts.skip || 'Cancel';
    $('cropStop').hidden = !opts.skip;
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (!corners) { // no guess: a card-shaped box in the middle
      const h = Math.min(800, (800 * W) / (ratio * H)), w = (h * ratio * H) / W;
      corners = [[500 - w / 2, 500 - h / 2], [500 + w / 2, 500 - h / 2], [500 + w / 2, 500 + h / 2], [500 - w / 2, 500 + h / 2]];
    }
    const pts = corners.map(([x, y]) => [Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y))]);
    editor.hidden = false;
    document.body.classList.add('editing');
    $('stepWork').hidden = true; $('stepPlace').hidden = true; $('stepKey').hidden = true; $('stepCrop').hidden = false;
    const box = $('crop'), dots = [...box.querySelectorAll('.dot')];
    // two ways: four free corners, or a straight rectangle whose sides are dragged
    let mode = 'corners';
    try { mode = localStorage.getItem('holo-crop-mode') === 'rect' ? 'rect' : 'corners'; } catch {}
    const rect = () => {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    };
    const setRect = (q) => { pts[0] = [q.l, q.t]; pts[1] = [q.r, q.t]; pts[2] = [q.r, q.b]; pts[3] = [q.l, q.b]; };
    const setMode = (m) => {
      mode = m;
      try { localStorage.setItem('holo-crop-mode', m); } catch {}
      if (m === 'rect') setRect(rect());
      for (const b of $('cropMode').children) b.setAttribute('aria-checked', b.dataset.mode === m);
      $('cropHint').textContent = m === 'rect' ? 'Drag the 4 dots to move the top, bottom and sides.' : "Drag the 4 dots onto the card's corners.";
      box.classList.toggle('rect', m === 'rect');
      draw();
    };
    for (const b of $('cropMode').children) b.onclick = () => setMode(b.dataset.mode);
    $('cropImg').src = P.fit(img, 1400).toDataURL('image/jpeg', 0.85);
    // the whole photo fits on screen, however tall it is (a phone screenshot pushed the bottom dots off it)
    box.style.width = `min(100%, calc((100svh - 280px) * ${(W / H).toFixed(4)}))`;
    const draw = () => {
      if (mode === 'rect') { // dots on the middle of each side: top, right, bottom, left
        const q = rect(), mid = [[(q.l + q.r) / 2, q.t], [q.r, (q.t + q.b) / 2], [(q.l + q.r) / 2, q.b], [q.l, (q.t + q.b) / 2]];
        dots.forEach((d, i) => { d.style.left = `${mid[i][0] / 10}%`; d.style.top = `${mid[i][1] / 10}%`; });
      } else dots.forEach((d, i) => { d.style.left = `${pts[i][0] / 10}%`; d.style.top = `${pts[i][1] / 10}%`; });
      const r = box.getBoundingClientRect();
      $('cropSvg').setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      $('cropPoly').setAttribute('points', pts.map(([x, y]) => `${(x / 1000) * r.width},${(y / 1000) * r.height}`).join(' '));
    };
    $('cropImg').onload = () => setMode(mode);
    dots.forEach((d, i) => {
      d.onpointerdown = (e) => { e.preventDefault(); d.setPointerCapture(e.pointerId); d.classList.add('on'); };
      d.onpointermove = (e) => {
        if (!d.hasPointerCapture(e.pointerId)) return;
        const r = box.getBoundingClientRect();
        const x = Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000)), y = Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000));
        if (mode === 'rect') { // this dot moves one side only
          const q = rect();
          if (i === 0) q.t = Math.min(y, q.b - 50);
          if (i === 1) q.r = Math.max(x, q.l + 50);
          if (i === 2) q.b = Math.max(y, q.t + 50);
          if (i === 3) q.l = Math.min(x, q.r - 50);
          setRect(q);
        } else pts[i] = [x, y];
        draw();
      };
      d.onpointerup = d.onpointercancel = () => d.classList.remove('on');
    });
    return new Promise((ok) => {
      $('cropOk').onclick = () => { $('stepCrop').hidden = true; ok(Object.assign(pts, { rect: mode === 'rect' })); };
      $('cropCancel').onclick = () => { $('stepCrop').hidden = true; ok(null); };
      $('cropStop').onclick = () => { $('stepCrop').hidden = true; ok('stop'); };
    });
  }

  // "whole card is art" switch: the art window becomes the whole card (full-art cards), or
  // back to the box found on the card
  function showFull() {
    const w = made.win, full = w.l <= 0.5 && w.t <= 0.5 && w.r >= 99.5 && w.b >= 99.5;
    $('fullToggle').setAttribute('aria-checked', full);
  }
  $('fullToggle').onclick = () => {
    if (!made) return;
    const w = made.win, full = w.l <= 0.5 && w.t <= 0.5 && w.r >= 99.5 && w.b >= 99.5;
    if (full) made.win = made.boxWin || pct(P.findWindow(made.card));
    else { made.boxWin = { ...w }; made.win = { l: 0, t: 0, r: 100, b: 100 }; }
    showFull(); render();
  };

  // ---------- step 2: check and adjust ----------
  const place = $('place'), placeChar = $('placeChar'), winBox = $('win'), size = $('charSize');

  function showPlace() {
    $('placeArt').src = made.card.toDataURL('image/jpeg', 0.9);
    placeChar.src = made.char.toDataURL('image/png');
    $('redoBest').hidden = !made.photoCard || !!editing; // only for cards Gemini separated
    $('recrop').hidden = !editing?.photo; // only when the original photo was kept
    if (!editing) $('savePlace').textContent = 'Save card';
    showFx(made.fx ?? null);
    $('placeMsg').textContent = made.message || '';
    $('placeMsg').hidden = !made.message;
    showFull();
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

  // Save a made card: d = { name, info, kind, grade, select }. Returns the new card.
  let lastId = '';
  async function saveRecord(made, d) {
    const { pos, win } = made;
    const h = pos.w * (made.char.height / made.char.width) * (made.card.width / made.card.height); // its height in % of the card
    const pop = P.fadeBottom(made.char, (win.b - pos.t) / h);
    let id = d.id;
    if (!id) {
      id = Date.now().toString(36);
      if (id <= lastId) id = `${lastId}x`; // two saved in the same millisecond (background adds)
      lastId = id;
    }
    const rec = {
      id,
      photo: d.photo || null, // the original photo (fitted), so the card can be re-cropped later
      own: made.own || null, // the user's own cut-out (re-cropping then needs no AI)
      name: d.name || `Card ${new Date().toLocaleDateString()}`,
      info: d.info, // game, set, year, number, edition
      art: await P.toBlob(made.card, 'image/jpeg', 0.9),
      pop: await P.toBlob(pop, 'image/png'),
      box: [pos.l, pos.t, pos.w, h],
      holo: [win.l, win.t, win.r - win.l, win.b - win.t],
      glitter: made.hues,
      style: d.kind, // holo, reverse or none; the ✨ button on the main screen changes it
      ambience: made.ambience, // the background animation (app.js picks one from the colours when null)
    };
    await req('readwrite', (s) => s.put(rec));
    const c = toCard(rec);
    if (d.replace) { // an edited card: same place in the list, its value and foil kept
      const old = d.replace, before = window.HoloValue?.get(old) || {};
      if (app.keyOf(old) !== app.keyOf(c)) { // a built-in card becomes a saved one
        for (const k of ['holo-value', 'holo-kind']) try {
          const v = localStorage.getItem(`${k}:${app.keyOf(old)}`);
          if (v !== null) localStorage.setItem(`${k}:${app.keyOf(c)}`, v);
        } catch {}
      }
      try { localStorage.setItem(`holo-kind:${app.keyOf(c)}`, d.kind); } catch {}
      window.HoloValue?.setGrade(c, d.grade);
      if (d.grade.grader !== before.grader || String(d.grade.grade) !== String(before.grade || '')) window.HoloValue?.lookup(c).catch(() => {});
      app.replace(old, c);
      if (old.id) { URL.revokeObjectURL(old.art); URL.revokeObjectURL(old.pop.src); }
      return c;
    }
    // its grade, then look up what it sells for at that grade (value.js)
    window.HoloValue?.start(c, { ...d.grade, foil: d.kind });
    app.add(c, d.select);
    return c;
  }

  $('savePlace').onclick = async () => {
    const btn = $('savePlace');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveRecord(made, {
        name: $('cardName').value.trim(), info: readInfo(), kind: holoKind, select: true, photo: editing?.photo || photoBlob,
        grade: { grader: $('cardGrader').value, grade: $('cardGrade').value.trim(), ...gradeExtra },
        ...(editing ? { id: editing.c.id || undefined, replace: editing.c } : {}),
      });
      editing = null;
      close();
    } catch (err) {
      alert(`Could not save the card: ${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = editing ? 'Save changes' : 'Save card';
    }
  };

  // ---------- edit a saved card: the same adjust screen, loaded with the card ----------
  let editing = null, photoBlob = null; // editing: { c, photo }
  const canvasFrom = async (src) => {
    const im = new Image(); im.src = src; await im.decode();
    const cv = Object.assign(document.createElement('canvas'), { width: im.naturalWidth, height: im.naturalHeight });
    cv.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0);
    return cv;
  };
  async function openEdit(c) {
    if (busy || !c) return;
    busy = true;
    try {
      await say('Opening the card…');
      const rec = c.id ? await req('readonly', (s) => s.get(c.id)) : null;
      const card = await canvasFrom(c.art);
      const char = c.pop ? await canvasFrom(c.pop.src) : Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
      const [l, t, w] = c.pop ? c.pop.box : [0, 0, 1];
      const hw = c.holo || [8, 10, 84, 38];
      let kind = c.style || 'holo';
      try { kind = localStorage.getItem(`holo-kind:${app.keyOf(c)}`) || kind; } catch {}
      made = {
        card, char, pos: { l, t, w }, win: { l: hw[0], t: hw[1], r: hw[0] + hw[2], b: hw[1] + hw[3] },
        hues: c.glitter, ambience: c.ambience || null, kind, fx: null, photoCard: null, layout: null, message: '',
      };
      editing = { c, photo: rec?.photo || null, own: rec?.own || null };
      // its details and grade as they are now
      const v = window.HoloValue?.get(c) || {};
      $('cardName').value = c.name || '';
      for (const [k, id] of Object.entries(INFO_FIELDS)) $(id).value = c.info?.[k] || '';
      $('cardGrader').value = v.grader || 'Raw';
      $('cardGrade').value = v.grade || '';
      gradeExtra = v.grader && v.grader !== 'Raw' ? { cert: v.cert || '' } : { estimated: !!v.estimated, note: v.note || '' };
      $('condNote').textContent = '';
      setHolo(kind);
      showPlace();
      $('savePlace').textContent = 'Save changes';
    } catch (err) {
      console.error(err);
      showWork(err.message || 'Could not open the card.', true);
    } finally {
      busy = false;
    }
  }
  $('editCard').onclick = () => openEdit(app.current());

  // re-crop an edited card from its original photo, then cut the character out again
  $('recrop').onclick = async () => {
    if (busy || !editing?.photo) return;
    busy = true;
    const keep = { name: $('cardName').value, info: readInfo(), grader: $('cardGrader').value, grade: $('cardGrade').value, kind: holoKind };
    try {
      const img = await P.loadImage(new File([editing.photo], 'photo.jpg', { type: 'image/jpeg' }));
      const ratio = ratioFor({ game: keep.info.game });
      const corners = await askCrop(img, [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], ratio);
      if (!corners) { showPlace(); return; }
      const card = cropTo(img, corners, ratio);
      if (editing.own) { // the user's own cut-out: lined up again, no AI
        await say('Lining the character up with the card…');
        const own = editing.own;
        made = fromOwn(card, P.cutout(await P.loadImage(new File([own], 'cutout.png', { type: own.type || 'image/png' })), { minPiece: 0.002 }));
        made.own = own;
        showPlace();
        return;
      }
      // no cut-out kept: the user's own (free) or Gemini's
      ownCard = card; ownInfo = Promise.resolve(null);
      showWork('How should the character be cut out?');
      $('spinner').hidden = true;
      $('ownCharBtn').hidden = false;
      $('geminiCutBtn').hidden = false;
      $('geminiCutBtn').onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          await say('Cutting out the character… (about 20 seconds)');
          made = await cutAndPlace(card);
          showPlace();
        } catch (err) {
          console.error(err);
          showWork(err.message || 'Something went wrong.', true);
        } finally {
          busy = false;
        }
      };
    } catch (err) {
      console.error(err);
      showWork(err.message || 'Something went wrong.', true);
    } finally {
      $('cardName').value = keep.name;
      for (const [k, id] of Object.entries(INFO_FIELDS)) $(id).value = keep.info[k] || '';
      $('cardGrader').value = keep.grader; $('cardGrade').value = keep.grade;
      setHolo(keep.kind);
      $('savePlace').textContent = 'Save changes';
      busy = false;
    }
  };

  // ---------- own cut-out: the card photo, then the character already cut out ----------
  // No AI needed: the cut-out is found on the card (matched against the card's pixels), the card
  // is filled in behind it, and it's the same adjust screen as any other card.
  let ownCard = null, ownInfo = null;
  $('fileOwnCard').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || busy) return;
    busy = true; made = null; editing = null; ownCard = null;
    try {
      fillInfo({});
      await say('Looking at the card…');
      const img = await P.loadImage(f);
      photoBlob = await P.toBlob(P.fit(img, 1600), 'image/jpeg', 0.85);
      const corners = await askCrop(img, [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 63 / 88);
      if (!corners) { close(); return; }
      ownCard = cropTo(img, corners, 63 / 88);
      // details from Gemini if it's available (cheap); fine without
      ownInfo = AI.getKey() ? AI.identify(P.fit(img, 1600)).catch(() => null) : Promise.resolve(null);
      showWork('Now choose the character, already cut out: a PNG with a see-through background, or the character on a plain or checkered background.');
      $('spinner').hidden = true;
      $('ownCharBtn').hidden = false;
    } catch (err) {
      console.error(err);
      showWork(err.message || 'Something went wrong.', true);
    } finally {
      busy = false;
    }
  };
  $('ownCharBtn').onclick = () => { $('fileOwnChar').value = ''; $('fileOwnChar').click(); };
  $('fileOwnChar').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || busy || !ownCard) return;
    busy = true;
    try {
      await say('Lining the character up with the card…');
      const char = P.cutout(await P.loadImage(f), { minPiece: 0.002 }); // keeps real see-through, else removes a plain/checkered background
      const kind = holoKind;
      made = fromOwn(ownCard, char);
      made.own = f; // kept with the card, so it can be re-cropped later without AI
      setHolo(editing ? kind : made.kind);
      const info = await ownInfo;
      if (info) {
        fillInfo(info);
        if (FOILS.includes(info.foil)) setHolo(info.foil);
      }
      showPlace();
    } catch (err) {
      console.error(err);
      showWork(err.message || 'Something went wrong.', true);
      $('ownCharBtn').hidden = false;
    } finally {
      busy = false;
    }
  };

  // the user's cut-out placed where it is on the card (else centred on the art window), the card
  // filled in behind it
  function fromOwn(card, char) {
    const w = P.findWindow(card), win = pct(w);
    const hOf = (wPct) => (wPct / 100) * card.width * (char.height / char.width) / card.height * 100;
    const at = P.locate(card, char);
    let pos;
    if (at) pos = { w: at.w * 100, l: at.x * 100, t: at.y * 100 };
    else {
      const w1 = (win.r - win.l) * 0.9;
      pos = { w: w1, l: (win.l + win.r) / 2 - w1 / 2, t: (win.t + win.b) / 2 - hOf(w1) / 2 };
    }
    // its shape on the card, for filling in behind it
    const mask = Object.assign(document.createElement('canvas'), { width: card.width, height: card.height });
    mask.getContext('2d').drawImage(char, (pos.l / 100) * card.width, (pos.t / 100) * card.height,
      (pos.w / 100) * card.width, (hOf(pos.w) / 100) * card.height);
    const glitter = P.glitterFor(card, w);
    return {
      kind: glitter.kind, fx: null, card: P.inpaint(card, mask), char: P.stylize(char), win, hues: glitter.hues, pos,
      ambience: null, photoCard: null, layout: null,
      message: at ? '' : "Couldn't find this character on the card, so it's in the middle. Drag it into place.",
    };
  }

  // for bulk.js (background adds) and collection.js (bulk edits)
  window.HoloStore = { req, autoAdd, removeCard, updateCard, askForKey };
})();
