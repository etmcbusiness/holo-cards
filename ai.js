// Gemini image editing, called straight from this browser with the user's own API key
// (kept in this browser's localStorage only, never in the code).
//   layered(card) -> one image: the card with the character painted out, and the character
//   cut out beside it, on white. One call per card, cheapest model first.
window.HoloAI = (() => {
  const KEY = 'holo-gemini-key';
  // newest first; a model this key can't use (404) falls through to the next
  // cheapest first (one 1K image per card); a model this key can't use (404) falls through
  const MODELS = ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
  const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

  class KeyError extends Error {}

  async function edit(prompt, canvas, aspectRatio) {
    const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data } }] }],
      generationConfig: { responseModalities: ['IMAGE'], ...(aspectRatio && { imageConfig: { aspectRatio } }) },
    });
    let lastErr = null;
    for (const model of MODELS) {
      const r = await fetch(URL(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': getKey(), 'Content-Type': 'application/json' },
        body,
      });
      if (r.status === 404) { lastErr = new Error(`${model} not available`); continue; }
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = json.error?.message || `Gemini error ${r.status}`;
        if (r.status === 400 && /api key/i.test(msg)) throw new KeyError('That Gemini API key was not accepted.');
        if (r.status === 403) throw new KeyError('That Gemini API key is not allowed to use image editing.');
        if (r.status === 429) {
          // quota: another model may still have some, so try it before giving up
          lastErr = /limit: 0|free_tier|billing/i.test(msg)
            ? new Error('Your Gemini key has no allowance for image editing. Turn on billing for it at aistudio.google.com (Settings → Billing), then try again.')
            : new Error(`Gemini says: ${msg.split('\n')[0]}`);
          continue;
        }
        throw new Error(msg);
      }
      const parts = json.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData || p.inline_data);
      if (!img) throw new Error("Gemini didn't return an image. Try a clearer photo.");
      const { data: out, mimeType, mime_type } = img.inlineData || img.inline_data;
      return toCanvas(`data:${mimeType || mime_type || 'image/png'};base64,${out}`);
    }
    throw lastErr;
  }

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

  const layered = (card) => edit(LAYERED, card, '4:3');

  return { getKey, setKey, layered, KeyError };
})();
