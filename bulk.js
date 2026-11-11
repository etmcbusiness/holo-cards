// Adding many cards at once. The photos are queued in IndexedDB (so the queue survives the app
// being closed) and added two at a time in the background while the cards can be browsed; each
// card appears as soon as it's done. A pill shows progress; tap it for the list (retry/remove).
// Browsers pause pages that aren't on screen, so it only runs while the app is open; it picks up
// where it left off when it's opened again. The screen is kept awake while it works.
window.HoloBulk = (() => {
  const $ = (id) => document.getElementById(id);
  const store = () => window.HoloStore;
  const AT_ONCE = 2;
  const items = []; // { id, file, name, status: 'waiting'|'working'|'failed', error, thumb }
  let added = 0, running = 0, paused = '';

  const put = (it) => store().req('readwrite', (s) => s.put({ id: it.id, file: it.file, name: it.name, status: it.status === 'working' ? 'waiting' : it.status, error: it.error || '' }));
  const drop = (it) => store().req('readwrite', (s) => s.delete(it.id));
  const thumbOf = (it) => (it.thumb ??= URL.createObjectURL(it.file));

  async function enqueue(files) {
    paused = '';
    const base = Date.now();
    for (const [i, f] of files.entries()) {
      const it = { id: `q:${base}-${String(i).padStart(3, '0')}`, file: f, name: f.name || `Photo ${i + 1}`, status: 'waiting' };
      items.push(it);
      await put(it).catch((e) => console.warn('Could not keep the queued photo:', e));
    }
    render();
    pump();
  }

  // keep up to AT_ONCE cards going
  function pump() {
    while (!paused && running < AT_ONCE) {
      const it = items.find((x) => x.status === 'waiting');
      if (!it) break;
      run(it);
    }
    awake(running > 0);
    render();
  }

  async function run(it) {
    it.status = 'working'; running++;
    render();
    try {
      await store().autoAdd(new File([it.file], it.name, { type: it.file.type || 'image/jpeg' }));
      added++;
      items.splice(items.indexOf(it), 1);
      if (it.thumb) URL.revokeObjectURL(it.thumb);
      await drop(it).catch(() => {});
    } catch (e) {
      console.error('Background add failed:', e);
      if (e instanceof window.HoloAI.KeyError) { // no point going on: wait for a new key
        it.status = 'waiting';
        paused = e.message;
      } else {
        it.status = 'failed';
        it.error = e.message || 'Something went wrong.';
      }
      await put(it).catch(() => {});
    } finally {
      running--;
      pump();
    }
  }

  // keep the screen on while working (otherwise the phone locks and everything pauses)
  let lock = null;
  async function awake(on) {
    try {
      if (on && !lock && navigator.wakeLock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } else if (!on && lock) { await lock.release(); lock = null; }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awake(running > 0); });

  // ---------- the pill and the list ----------
  function render() {
    const left = items.filter((x) => x.status !== 'failed').length, failed = items.length - left;
    const pill = $('bulkPill');
    pill.hidden = !items.length && !added;
    pill.classList.toggle('warn', !!paused || (!left && failed > 0));
    pill.textContent = paused ? '⏸ Adding paused: tap'
      : left ? `⏳ Adding cards · ${added} done, ${left} to go`
        : failed ? `⚠️ ${failed} couldn't be added: tap`
          : `✓ ${added} card${added === 1 ? '' : 's'} added`;
    if (!items.length && added) setTimeout(() => { if (!items.length) { added = 0; render(); } }, 4000);
    if (!$('bulkSheet').hidden) list();
  }

  function list() {
    $('bulkNote').textContent = paused
      ? `Paused: ${paused}`
      : 'Keep Holo Cards open (you can look through your cards meanwhile). If you leave the app it waits, and carries on when you come back.';
    $('bulkResume').hidden = !paused;
    const ul = $('bulkList');
    ul.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      const img = document.createElement('img'); img.src = thumbOf(it); img.alt = '';
      const txt = document.createElement('div');
      const b = document.createElement('b'); b.textContent = it.name;
      const s = document.createElement('span');
      s.textContent = it.status === 'working' ? 'Working on it… (about 30 s)' : it.status === 'failed' ? it.error : 'Waiting';
      s.className = it.status;
      txt.append(b, s);
      li.append(img, txt);
      if (it.status === 'failed') {
        const retry = document.createElement('button'); retry.textContent = 'Retry';
        retry.onclick = () => { it.status = 'waiting'; it.error = ''; put(it); pump(); };
        li.append(retry);
      }
      if (it.status !== 'working') {
        const rm = document.createElement('button'); rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove from the list');
        rm.onclick = async () => { items.splice(items.indexOf(it), 1); if (it.thumb) URL.revokeObjectURL(it.thumb); await drop(it).catch(() => {}); render(); };
        li.append(rm);
      }
      ul.append(li);
    }
  }

  $('bulkPill').onclick = () => { $('bulkSheet').hidden = false; list(); };
  $('bulkClose').onclick = () => { $('bulkSheet').hidden = true; };
  $('bulkSheet').onclick = (e) => { if (e.target === $('bulkSheet')) $('bulkSheet').hidden = true; };
  $('bulkResume').onclick = async () => {
    $('bulkSheet').hidden = true;
    await store().askForKey(paused);
    document.getElementById('editor').hidden = true;
    document.body.classList.remove('editing');
    paused = '';
    pump();
  };

  // whatever was still queued when the app was last closed
  setTimeout(() => {
    store().req('readonly', (s) => s.getAll()).then((recs) => {
      for (const r of recs) if (r.id.startsWith('q:')) items.push({ id: r.id, file: r.file, name: r.name, status: r.status === 'failed' ? 'failed' : 'waiting', error: r.error });
      items.sort((a, b) => (a.id < b.id ? -1 : 1));
      render();
      pump();
    }).catch((e) => console.warn('Queued photos unavailable:', e));
  }, 0);

  return { enqueue };
})();
