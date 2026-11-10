// Gemini, called straight from this browser with the user's own API key (kept in this
// browser's localStorage only, never in the code).
//   layered(card)  -> one image: the card with the character painted out, and the character
//                     cut out beside it, on white (one image call per card)
//   identify(photo) -> { name, set, year, number, edition, foil, corners } read from the card (one
//                     cheap text call)
window.HoloAI = (() => {
  const KEY = 'holo-gemini-key';
  // cheapest first; a model this key can't use (404, or no quota) falls through to the next
  const IMAGE_MODELS = ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
  const TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

  class KeyError extends Error {}

  // POST to the first model that works; returns the first candidate's parts
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
      return json.candidates?.[0]?.content?.parts || [];
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

  async function layered(card) {
    const parts = await call(IMAGE_MODELS, {
      contents: [{ parts: [{ text: LAYERED }, jpeg(card)] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3' } },
    });
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) throw new Error("Gemini didn't return an image. Try a clearer photo.");
    const { data, mimeType, mime_type } = img.inlineData || img.inline_data;
    return toCanvas(`data:${mimeType || mime_type || 'image/png'};base64,${data}`);
  }

  const IDENTIFY = 'Identify this trading card. Give its exact printed name (as on the card), the set it is from, the year that set was released, ' +
    'the card number (like 4/102), the edition or print (for example "1st Edition", "Shadowless", "Unlimited", "Japanese", or "" if none), ' +
    'and its foil: "holo" if the artwork is holographic, "reverse" if the card is foil everywhere except the artwork, or "none". ' +
    'Use "" for anything you cannot tell. Also give corners: the four corners of the card outer edge in this image as [x, y] on a 0-1000 scale ' +
    '(x across, y down), in the order top-left, top-right, bottom-right, bottom-left of the card.';

  async function identify(card) {
    const parts = await call(TEXT_MODELS, {
      contents: [{ parts: [{ text: IDENTIFY }, jpeg(card)] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' }, set: { type: 'STRING' }, year: { type: 'STRING' },
            number: { type: 'STRING' }, edition: { type: 'STRING' },
            foil: { type: 'STRING', enum: ['holo', 'reverse', 'none'] },
            corners: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'NUMBER' } } },
          },
          required: ['name', 'set', 'year', 'number', 'edition', 'foil'],
        },
      },
    });
    const text = parts.map((p) => p.text || '').join('');
    try { return JSON.parse(text); } catch { return null; }
  }

  return { getKey, setKey, layered, identify, KeyError };
})();
