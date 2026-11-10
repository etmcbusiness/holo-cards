// Gemini, called straight from this browser with the user's own API key (kept in this
// browser's localStorage only, never in the code).
//   layered(card, quality) -> one image: the card with the character painted out, and the character
//                     cut out beside it, on white (one image call per card)
//   identify(photo) -> { game, name, set, year, number, edition, foil, corners, grading, condition }
//                     read from the photo (one cheap text call)
//   inspect(flatCard) -> { win, char, ambience }: where the art window and the character are
//                     (one cheap text call on the straightened card)
//   value(details)  -> recent sold prices for that card at that grade (text call with Google Search)
window.HoloAI = (() => {
  const KEY = 'holo-gemini-key';
  // cheapest first; a model this key can't use (404, or no quota) falls through to the next
  const IMAGE_MODELS = {
    fast: ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'],
    best: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'], // for retries: costs more
  };
  const TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

  class KeyError extends Error {}

  // POST to the first model that works; returns the first candidate as { parts, grounding }
  async function call(models, body) {
    let lastErr = null;
    for (const model of models) {
      const r = await fetch(URL(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': getKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 404) { lastErr = new Error(`${model} not available`); continue; }
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = json.error?.message || `Gemini error ${r.status}`;
        if (r.status === 400 && /api key/i.test(msg)) throw new KeyError('That Gemini API key was not accepted.');
        if (r.status === 403) throw new KeyError('That Gemini API key is not allowed to use this.');
        if (r.status === 429) {
          lastErr = /limit: 0|free_tier|billing/i.test(msg)
            ? new Error('Your Gemini key has no allowance for this. Turn on billing for it at aistudio.google.com (Settings → Billing), then try again.')
            : new Error(`Gemini says: ${msg.split('\n')[0]}`);
          continue;
        }
        throw new Error(msg);
      }
      const c = json.candidates?.[0];
      return { parts: c?.content?.parts || [], grounding: c?.groundingMetadata };
    }
    throw lastErr;
  }

  const jpeg = (canvas) => ({ inline_data: { mime_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] } });

  async function toCanvas(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
    return c;
  }

  // One call, one image, in the same layout as hand-made layered images, which the app
  // already knows how to split (process.js splitLayered).
  const LAYERED = 'This is a photo of a trading card. Make ONE wide image on a plain solid white #FFFFFF background with two things side by side. ' +
    'LEFT: the whole card, flat and straight, with the main character (the creature or person in the artwork, including its fire, breath or effects) ' +
    'completely removed and the artwork background repainted seamlessly where it was; keep the frame, border, text and symbols exactly the same. ' +
    'RIGHT: only that character, cut out cleanly with all its detail and original colours, on the white background, not touching the card. ' +
    'Do not redraw or restyle anything.';

  async function layered(card, quality = 'fast') {
    const { parts } = await call(IMAGE_MODELS[quality], {
      contents: [{ parts: [{ text: LAYERED }, jpeg(card)] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3' } },
    });
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) throw new Error("Gemini didn't return an image. Try a clearer photo.");
    const { data, mimeType, mime_type } = img.inlineData || img.inline_data;
    return toCanvas(`data:${mimeType || mime_type || 'image/png'};base64,${data}`);
  }

  const IDENTIFY = 'Identify this trading card (any game or sport: Pokemon, Magic, Yu-Gi-Oh, One Piece, Lorcana, baseball, basketball, football, soccer, etc.). ' +
    'Give the game or sport, its exact printed name (as on the card; for a sports card the player), the set it is from, the year that set was released, ' +
    'the card number (like 4/102), the edition or print (for example "1st Edition", "Shadowless", "Unlimited", "Japanese", or "" if none), ' +
    'and its foil: "holo" if the artwork is holographic, "reverse" if the card is foil everywhere except the artwork, or "none". ' +
    'Use "" for anything you cannot tell. Also give corners: the four corners of the card itself (inside any sleeve, top-loader or graded slab) in this image as [x, y] on a 0-1000 scale ' +
    '(x across, y down), in the order top-left, top-right, bottom-right, bottom-left of the card. ' +
    'grading: if the card is in a graded slab, the grading company (PSA, BGS, CGC, SGC, TAG...), the grade on its label (like "9" or "9.5") and the cert number; otherwise all "". ' +
    'condition: your honest estimate of the grade PSA would give this card (1-10), judging centering, corners, edges and surface as well as the photo allows, ' +
    'and a short note of the flaws you see.';

  async function identify(card) {
    const { parts } = await call(TEXT_MODELS, {
      contents: [{ parts: [{ text: IDENTIFY }, jpeg(card)] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            game: { type: 'STRING' }, name: { type: 'STRING' }, set: { type: 'STRING' }, year: { type: 'STRING' },
            number: { type: 'STRING' }, edition: { type: 'STRING' },
            foil: { type: 'STRING', enum: ['holo', 'reverse', 'none'] },
            corners: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
            grading: { type: 'OBJECT', properties: { company: { type: 'STRING' }, grade: { type: 'STRING' }, cert: { type: 'STRING' } } },
            condition: { type: 'OBJECT', properties: { grade: { type: 'NUMBER' }, note: { type: 'STRING' } } },
          },
          required: ['name', 'set', 'year', 'number', 'edition', 'foil'],
        },
      },
    });
    return json(parts);
  }

  const json = (parts) => {
    const text = parts.map((p) => p.text || '').join('');
    try { return JSON.parse(text); } catch {}
    const m = text.match(/\{[\s\S]*\}/); // a JSON object inside other text
    try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
  };

  // Layout of a flat, straight card. Boxes come back as Gemini's usual [ymin, xmin, ymax, xmax] on 0-1000.
  const AMBIENCE = ['embers', 'bubbles', 'leaves', 'petals', 'sparks', 'snow', 'mist', 'stars', 'dust'];
  const INSPECT = 'This is a flat, straight trading card. ' +
    'art: the box of the picture area (the art window inside the frame). On a full-art, full-bleed or borderless card the picture fills the whole card, so give the whole card. ' +
    'full_art: true if the picture covers the whole card behind the text. ' +
    'character: the box around the main character, creature or person in the picture, including its wings, tail, fire or effects. ' +
    'ambience: the one gentle background animation that suits the picture best: embers (fire, lava, sunset heat), bubbles (water, underwater), ' +
    'leaves (forest, grass, wind), petals (flowers, fairy, pink), sparks (electric, lightning, tech), snow (ice, winter), mist (fog, ghost, dark, poison), ' +
    'stars (space, night, psychic, magic), dust (anything else: floating motes of light).';
  async function inspect(card) {
    const box = { type: 'ARRAY', items: { type: 'NUMBER' } };
    const { parts } = await call(TEXT_MODELS, {
      contents: [{ parts: [{ text: INSPECT }, jpeg(card)] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { art: box, full_art: { type: 'BOOLEAN' }, character: box, ambience: { type: 'STRING', enum: AMBIENCE } },
          required: ['art', 'full_art', 'character', 'ambience'],
        },
      },
    });
    const r = json(parts);
    if (!r) return null;
    // -> { l, t, r, b } in % of the card
    const pct = (b) => (Array.isArray(b) && b.length === 4 && b[2] > b[0] && b[3] > b[1]
      ? { t: b[0] / 10, l: b[1] / 10, b: b[2] / 10, r: b[3] / 10 } : null);
    let win = pct(r.art);
    if (r.full_art || (win && win.b - win.t > 80)) win = { l: 0, t: 0, r: 100, b: 100 };
    return { win, char: pct(r.character), ambience: AMBIENCE.includes(r.ambience) ? r.ambience : null };
  }

  // What has this card sold for lately, at this grade? Gemini searches the web (sold listings,
  // price guides). d: { game, name, set, year, number, edition, foil, grader, grade };
  // grader 'Raw' = ungraded, and then grade is the (estimated) condition.
  const CONDITION = (g) => (g >= 9 ? 'Near Mint or better' : g >= 7 ? 'Near Mint to Excellent' : g >= 5 ? 'Lightly Played'
    : g >= 3 ? 'Moderately Played' : 'Heavily Played or Damaged');
  async function value(d) {
    const foil = d.foil === 'reverse' ? 'Reverse Holo' : d.foil === 'holo' ? 'Holo' : '';
    const card = [d.game, d.year, d.set, d.name, d.number && `#${d.number}`, d.edition, foil].filter(Boolean).join(' ');
    const graded = d.grader && d.grader !== 'Raw';
    const which = graded
      ? `graded ${d.grader} ${d.grade}. Use only sales of ${d.grader} ${d.grade} copies.`
      : `raw (ungraded), in about ${d.grade || 7}/10 condition (${CONDITION(+d.grade || 7)}). Use only sales of ungraded copies in that condition, not graded slabs.`;
    const prompt = 'Search the web for what this exact trading card has actually SOLD for recently (completed or sold listings such as eBay sold, ' +
      `PriceCharting, 130point, PSA auction prices, TCGplayer sales). Card: ${card}. Condition: ${which} ` +
      'Reply with only a JSON object, no other text: {"price": its market value in US dollars as a number (the last sale, or the middle of the last few if they vary a lot), ' +
      '"last": {"price": number, "date": "YYYY-MM-DD", "where": "site"}, "recent": [up to 5 of {"price": number, "date": "YYYY-MM-DD", "where": "site"}], ' +
      '"note": "one short sentence on what the value is based on"}. If you find no sales at all, use null for price.';
    const { parts, grounding } = await call(TEXT_MODELS, {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    });
    const r = json(parts);
    if (!r) throw new Error("Couldn't read the price search. Try again.");
    const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
    const sale = (x) => ({ price: num(x.price), date: x.date || '', where: x.where || '' });
    return {
      price: num(r.price),
      last: r.last && num(r.last.price) ? sale(r.last) : null,
      recent: (Array.isArray(r.recent) ? r.recent : []).filter((x) => num(x?.price)).slice(0, 5).map(sale),
      note: r.note || '',
      sources: (grounding?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri).slice(0, 6)
        .map((w) => ({ title: w.title || w.uri, uri: w.uri })),
    };
  }

  return { getKey, setKey, layered, identify, inspect, value, KeyError };
})();
