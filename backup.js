// "Save a backup" / "Restore a backup" (All cards panel). One .json file holds every saved card
// with its pictures, plus each card's value, foil and edits, so the collection can move to
// another phone, browser or website. The Gemini key and Gemini's cached results stay behind.
(() => {
  const $ = (id) => document.getElementById(id);
  const store = () => window.HoloStore;
  const TRAVELS = /^holo-(?!gemini-key$)/; // localStorage keys that go in the backup
  const SKIP = /^(ai\d*|q):/; // IndexedDB records that don't: Gemini caches, photos waiting in the queue

  const toData = (b) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
  function fromData({ type, name, data }) {
    const bin = atob(data.slice(data.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return name ? new File([bytes], name, { type }) : new Blob([bytes], { type });
  }
  const isPacked = (v) => v && typeof v === 'object' && typeof v.blob === 'string' && typeof v.data === 'string' && v.data.startsWith('data:');

  async function save() {
    const recs = await store().req('readonly', (s) => s.getAll());
    const cards = [];
    for (const r of recs) {
      if (SKIP.test(r.id)) continue;
      const out = {};
      for (const [k, v] of Object.entries(r)) out[k] = v instanceof Blob ? { blob: 'v1', type: v.type, name: v.name || '', data: await toData(v) } : v;
      cards.push(out);
    }
    const local = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (TRAVELS.test(k)) local[k] = localStorage.getItem(k);
    }
    const day = new Date().toISOString().slice(0, 10);
    const file = new File([JSON.stringify({ holoBackup: 1, saved: new Date().toISOString(), cards, local })], `holo-cards-backup-${day}.json`, { type: 'application/json' });
    // iPhone: the share sheet's "Save to Files". Elsewhere, or if sharing isn't allowed: a download.
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return cards.length; } catch (e) { if (e.name === 'AbortError') return 0; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return cards.length;
  }

  async function restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { data = null; }
    if (data?.holoBackup !== 1 || !Array.isArray(data.cards)) throw new Error("That file isn't a Holo Cards backup.");
    for (const c of data.cards) {
      if (typeof c?.id !== 'string' || SKIP.test(c.id)) continue;
      const rec = {};
      for (const [k, v] of Object.entries(c)) rec[k] = isPacked(v) ? fromData(v) : v;
      await store().req('readwrite', (s) => s.put(rec)); // same id: the backup's copy replaces it
    }
    for (const [k, v] of Object.entries(data.local || {})) if (TRAVELS.test(k) && typeof v === 'string') localStorage.setItem(k, v);
  }

  const msg = (text) => { $('colMsg').textContent = text; };
  $('backupSave').onclick = async () => {
    const btn = $('backupSave');
    btn.disabled = true;
    msg('Packing your cards…');
    try {
      const n = await save();
      msg(n ? `Backup of ${n} card${n === 1 ? '' : 's'} ready. Keep the file somewhere safe.` : '');
    } catch (e) {
      msg(`Could not make the backup: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  };
  $('backupRestore').onclick = () => { $('fileBackup').value = ''; $('fileBackup').click(); };
  $('fileBackup').onchange = async () => {
    const f = $('fileBackup').files[0];
    if (!f) return;
    msg('Restoring…');
    try {
      await restore(f);
      location.reload(); // the cards are read in on start
    } catch (e) {
      msg(e.message);
    }
  };
})();
