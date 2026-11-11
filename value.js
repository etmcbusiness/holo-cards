// What each card is worth. A card has a grade: a slab's company and grade (PSA 9…), or Raw
// with an estimated condition 1-10 (Gemini's guess from the photo when it was added). Its
// value is what that card last sold for at that grade, found by Gemini searching the web
// (AI.value), or typed in by hand. Kept in this browser's localStorage per card.
window.HoloValue = (() => {
  const $ = (id) => document.getElementById(id);
  const AI = window.HoloAI;
  const app = () => window.HoloApp;
  const KEY = (c) => `holo-value:${app().keyOf(c)}`;

  // { grader, grade, cert, estimated, note, price, manual, last, recent, sources, basis, checked }
  function get(c) {
    try { return JSON.parse(localStorage.getItem(KEY(c))) || {}; } catch { return {}; }
  }
  function set(c, v) {
    try { localStorage.setItem(KEY(c), JSON.stringify(v)); } catch {}
  }

  const money = (n) => `$${n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
  const gradeLabel = (v) => (v.grader && v.grader !== 'Raw'
    ? `${v.grader} ${v.grade || '?'}`
    : v.grade ? `Raw · ${v.estimated ? 'est. ' : ''}${v.grade}/10` : 'Raw');

  const looking = new Set(); // card keys being looked up right now

  // the button under the caption
  function render(c) {
    const btn = $('valueBtn');
    if (!c) { btn.hidden = true; return; }
    const v = get(c);
    btn.hidden = false;
    btn.classList.toggle('empty', !v.price);
    btn.textContent = looking.has(KEY(c)) ? 'Finding last sold…'
      : v.price ? `${money(v.price)} · ${gradeLabel(v)}` : '＋ Add value';
  }

  const details = (c, v) => ({
    ...(c.info || {}), name: c.name, foil: c.style || '', grader: v.grader || 'Raw', grade: v.grade || '',
  });

  // look up last sold at this card's grade; keeps a hand-typed value only if nothing is found
  async function lookup(c) {
    const k = KEY(c);
    if (looking.has(k)) return;
    if (!AI.getKey()) throw new Error('Needs your Gemini key: add a card once with + Add card to connect it.');
    looking.add(k);
    refresh(c);
    try {
      const v = get(c), r = await AI.value(details(c, v));
      const now = get(c); // may have changed while searching
      set(c, {
        ...now,
        price: r.price ?? now.price ?? null, manual: r.price ? false : now.manual,
        last: r.last, recent: r.recent, sources: r.sources, basis: r.note,
        checked: new Date().toISOString(), lookedUpFor: gradeLabel(now), error: '',
      });
      if (!r.price) throw new Error('No recent sales found for this grade. You can type a value in.');
    } finally {
      looking.delete(k);
      refresh(c);
    }
  }

  // a new card was saved: keep its grade, then look its value up in the background
  function start(c, grade) {
    set(c, { ...get(c), ...grade });
    if (AI.getKey()) lookup(c).catch((e) => console.warn('Value lookup:', e.message));
  }

  // ---------- the value panel ----------
  const panel = $('valuePanel');
  let open = null; // the card shown in the panel

  function refresh(c) {
    if (c === app().current()) render(c);
    if (open === c) fill();
  }

  function fill() {
    const c = open, v = get(c), raw = (v.grader || 'Raw') === 'Raw';
    $('vTitle').textContent = c.name;
    $('vSub').textContent = [c.info?.game, c.info?.set, c.info?.year, c.info?.number].filter(Boolean).join(' · ');
    $('vGrader').value = v.grader || 'Raw';
    $('vGrade').value = v.grade || '';
    $('vCert').value = v.cert || '';
    $('vCertField').hidden = raw;
    $('vPrice').value = v.price ? (+v.price).toFixed(2) : '';
    $('vCond').textContent = raw && v.estimated && v.note ? `Estimated from the photo: ${v.note}` : '';
    const busy = looking.has(KEY(c));
    $('vLookup').disabled = busy;
    $('vLookup').textContent = busy ? 'Searching recent sales… (about 10 seconds)' : 'Look up last sold';
    const out = $('vResult');
    out.innerHTML = '';
    const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; out.append(e); return e; };
    if (v.price) add('div', `${money(+v.price)}${v.manual ? ' (typed in)' : ''}`, 'big-price');
    if (v.last) add('div', `Last sold: ${money(v.last.price)}${v.last.date ? ` on ${v.last.date}` : ''}${v.last.where ? ` · ${v.last.where}` : ''}`);
    if (v.recent?.length) {
      const ul = add('ul', '');
      for (const s of v.recent) {
        const li = document.createElement('li');
        li.textContent = `${money(s.price)}${s.date ? ` · ${s.date}` : ''}${s.where ? ` · ${s.where}` : ''}`;
        ul.append(li);
      }
    }
    if (v.basis) add('div', v.basis).className = 'hint';
    if (v.checked) add('div', `Checked ${new Date(v.checked).toLocaleDateString()} for ${v.lookedUpFor || gradeLabel(v)}`).className = 'hint';
    for (const s of v.sources || []) {
      const a = add('a', s.title);
      a.href = s.uri; a.target = '_blank'; a.rel = 'noopener';
    }
    if (v.error) add('div', v.error, 'err');
    // whole collection
    const all = app().all().map((x) => +get(x).price || 0), total = all.reduce((a, b) => a + b, 0);
    $('vTotal').textContent = total ? `Collection: ${money(total)} across ${all.filter(Boolean).length} of ${all.length} cards` : '';
  }

  // edits save straight away
  function save(patch) {
    set(open, { ...get(open), ...patch, error: '' });
    refresh(open);
  }
  $('vGrader').onchange = () => save({ grader: $('vGrader').value, estimated: false });
  $('vGrade').onchange = () => save({ grade: $('vGrade').value.trim(), estimated: false });
  $('vCert').onchange = () => save({ cert: $('vCert').value.trim() });
  $('vPrice').onchange = () => {
    const n = parseFloat($('vPrice').value.replace(/[^0-9.]/g, ''));
    save({ price: Number.isFinite(n) && n > 0 ? n : null, manual: true });
  };
  $('vLookup').onclick = () => {
    const c = open;
    save({});
    lookup(c).catch((e) => { set(c, { ...get(c), error: e.message }); refresh(c); });
  };
  $('vClose').onclick = () => {
    open = null;
    panel.hidden = true;
    document.body.classList.remove('editing');
  };
  $('valueBtn').onclick = () => {
    open = app().current();
    if (!open) return;
    panel.hidden = false;
    document.body.classList.add('editing');
    fill();
  };

  // collection.js: set the grade on several cards, look a value up again
  const setGrade = (c, g) => { set(c, { ...get(c), ...g }); refresh(c); };
  return { render, start, get, setGrade, lookup };
})();
