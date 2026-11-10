// Gemini, called straight from this browser with the user's own API key (kept in this
// browser's localStorage only, never in the code).
//   layered(card, quality) -> one image: the card with the character painted out, and the character
//                     cut out beside it, on white (one image call per card)
//   identify(photo) -> { game, name, set, year, number, edition, foil, corners, grading, condition }
//                     read from the photo (one cheap text call)
//   inspect(flatCard) -> { win, char, ambience }: where the art window and the character are
//                     (one cheap text call on the straightened card)
//   segment(flatCard) -> { body, fx }: masks of exactly which pixels are the character, and its
//                     own fire/breath/effects (no image is redrawn, so the cut-out is the card's own pixels)
//   value(details)  -> recent sold prices for that card at that grade (text call with Google Search)
window.HoloAI = (() => {
  const KEY = 'holo-gemini-key';
  // cheapest first; a model this key can't use (404, or no quota) falls through to the next
  const IMAGE_MODELS = {
    fast: ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'],
    best: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'], // for retries: costs more
  };
  const TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  // looking closely (art window, character outline): the Flash models, which are trained for
  // boxes and masks; Lite misjudged where the art window is
  const VISION_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash', 'gemini-2.5-flash'];
  // thinking off gives better boxes and masks (2.5 and 3.x spell it differently)
  const noThinking = (m) => (m.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' });
  const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

  class KeyError extends Error {}

  // POST to the first model that works; returns the first candidate as { parts, grounding }
  // body: the request, or (model) => request when it differs per model
  async function call(models, body) {
    let lastErr = null;
    for (const model of models) {
      const r = await fetch(URL(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': getKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof body === 'function' ? body(model) : body),
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
    'Use "" for anything you cannot tell. slab: true if the card is sealed in a graded slab (PSA, BGS, CGC, SGC... case with a grade label). ' +
    'Also give corners: the four corners of the card itself (inside any sleeve, top-loader or slab) in this image as [x, y] on a 0-1000 scale ' +
    '(x across, y down), in the order top-left, top-right, bottom-right, bottom-left. ' +
    'slab_corners: if it is in a graded slab, the four OUTER corners of the whole plastic slab including its grade label at the top, same scale and order; otherwise []. ' +
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
            slab: { type: 'BOOLEAN' }, game: { type: 'STRING' }, name: { type: 'STRING' }, set: { type: 'STRING' }, year: { type: 'STRING' },
            number: { type: 'STRING' }, edition: { type: 'STRING' },
            foil: { type: 'STRING', enum: ['holo', 'reverse', 'none'] },
            corners: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
            slab_corners: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
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
    const { parts } = await call(VISION_MODELS, (m) => ({
      contents: [{ parts: [{ text: INSPECT }, jpeg(card)] }],
      generationConfig: {
        thinkingConfig: noThinking(m),
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { art: box, full_art: { type: 'BOOLEAN' }, character: box, ambience: { type: 'STRING', enum: AMBIENCE } },
          required: ['art', 'full_art', 'character', 'ambience'],
        },
      },
    }));
    const r = json(parts);
    if (!r) return null;
    // -> { l, t, r, b } in % of the card
    const pct = (b) => (Array.isArray(b) && b.length === 4 && b[2] > b[0] && b[3] > b[1]
      ? { t: b[0] / 10, l: b[1] / 10, b: b[2] / 10, r: b[3] / 10 } : null);
    // full art only when the picture box really covers the card (the flag alone has been wrong)
    let win = pct(r.art);
    if (win && win.b - win.t > (r.full_art ? 65 : 85)) win = { l: 0, t: 0, r: 100, b: 100 };
    return { win, char: pct(r.character), ambience: AMBIENCE.includes(r.ambience) ? r.ambience : null };
  }

  // Exactly which pixels are the character: Gemini's segmentation masks, drawn into canvases the
  // size of the card whose alpha is the mask. The body and the character's own effects (fire it
  // breathes, the flame on its tail) come back separately, so effects can be switched off; fire
  // or explosions in the background must not be included at all. null if no body was found.
  const SEGMENT = 'Give segmentation masks for the main character in this trading card\'s picture. ' +
    'Use the label "body" for the character itself: the creature or person with its wings, tail, claws, hair and clothes (one entry). ' +
    'Use the label "effect" for each fire, breath, beam or energy that comes OUT of the character itself, like flame breathed from its mouth ' +
    'or the flame on the tip of its tail. ' +
    'Do NOT include the picture background, even where it touches the character: background fire, explosions, lava, smoke, clouds, sky, ' +
    'lightning, water or scenery are not the character. Not the card frame, text or symbols either. ' +
    'Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", ' +
    'the segmentation mask in key "mask", and the text label in the key "label".';
  async function segment(card) {
    const { parts } = await call(VISION_MODELS, (m) => ({
      contents: [{ parts: [{ text: SEGMENT }, jpeg(card)] }],
      generationConfig: { thinkingConfig: noThinking(m), responseMimeType: 'application/json' },
    }));
    const text = parts.map((p) => p.text || '').join('');
    let list;
    try { list = JSON.parse(text.replace(/^```(json)?|```$/g, '')); } catch { const m = text.match(/\[[\s\S]*\]/); try { list = m && JSON.parse(m[0]); } catch {} }
    if (!Array.isArray(list)) list = list ? [list] : [];
    const W = card.width, H = card.height;
    const layer = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
    const body = layer(), fx = layer();
    let drewBody = false, drewFx = false;
    for (const e of list) {
      const isFx = /effect|fire|flame|breath|beam|energy/i.test(e?.label || '');
      const o = (isFx ? fx : body).getContext('2d', { willReadFrequently: true });
      const b = e?.box_2d;
      if (!Array.isArray(b) || b.length !== 4) continue;
      const x0 = (b[1] / 1000) * W, y0 = (b[0] / 1000) * H, bw = ((b[3] - b[1]) / 1000) * W, bh = ((b[2] - b[0]) / 1000) * H;
      if (bw < 4 || bh < 4) continue;
      if (typeof e.mask === 'string' && e.mask.length > 50) {
        // a probability map (0-255) the size of the box, as a PNG
        const src = e.mask.startsWith('data:') ? e.mask : `data:image/png;base64,${e.mask}`;
        const im = await toCanvas(src).catch(() => null);
        if (!im) continue;
        const t = Object.assign(document.createElement('canvas'), { width: Math.round(bw), height: Math.round(bh) });
        const tx = t.getContext('2d', { willReadFrequently: true });
        tx.drawImage(im, 0, 0, t.width, t.height);
        const id = tx.getImageData(0, 0, t.width, t.height), d = id.data;
        // The map is how sure Gemini is (0-255), and how sure varies a lot between cards: a
        // fixed cut-off left some characters half see-through. Cut at half of its most sure,
        // with a short ramp for a clean, solid edge.
        const P = new Float32Array(d.length / 4);
        let pmax = 0;
        for (let k = 0; k < P.length; k++) { P[k] = Math.max(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]) * (d[k * 4 + 3] / 255); pmax = Math.max(pmax, P[k]); }
        if (pmax < 20) continue; // nothing there
        for (let k = 0; k < P.length; k++) {
          d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 255;
          d[k * 4 + 3] = Math.max(0, Math.min(255, ((P[k] - pmax * 0.42) / (pmax * 0.16)) * 255));
        }
        tx.putImageData(id, 0, 0);
        o.drawImage(t, x0, y0);
        if (isFx) drewFx = true; else drewBody = true;
      } else if (Array.isArray(e.mask) && e.mask.length > 2) {
        // a polygon of [x, y] on 0-1000 over the whole image
        o.fillStyle = '#fff';
        o.beginPath();
        e.mask.forEach(([x, y], i) => (i ? o.lineTo : o.moveTo).call(o, (x / 1000) * W, (y / 1000) * H));
        o.fill();
        if (isFx) drewFx = true; else drewBody = true;
      }
    }
    return drewBody ? { body, fx: drewFx ? fx : null } : null;
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

  return { getKey, setKey, layered, identify, inspect, segment, value, KeyError };
})();
