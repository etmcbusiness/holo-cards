// Gemini image editing, called straight from this browser with the user's own API key
// (kept in this browser's localStorage only, never in the code).
//   separate(card) -> { erased, characterOnWhite }: two edits of the same card photo, run
//   together: the card with the character painted out, and the character alone, in place,
//   on plain white.
window.HoloAI = (() => {
  const KEY = 'holo-gemini-key';
  // newest first; a model this key can't use (404) falls through to the next
  const MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
  const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

  class KeyError extends Error {}

  async function edit(prompt, canvas) {
    const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data } }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
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
      return toCanvas(`data:${mimeType || mime_type || 'image/png'};base64,${out}`, canvas.width, canvas.height);
    }
    throw lastErr;
  }

  // decode and resize to the size of the photo that was sent, so positions line up
  async function toCanvas(src, w, h) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    return c;
  }

  const ERASE = 'This is a photo of a trading card. Remove the main character (the creature or person in the artwork) completely, ' +
    'including its fire, breath or effects. Repaint the artwork background where it was so it matches the surrounding art seamlessly. ' +
    'Keep everything else exactly the same: the card frame, border, text, symbols, colours, size, framing and position. Output the whole card.';
  const ISOLATE = 'This is a photo of a trading card. Keep only the main character from the artwork (the creature or person, with its fire, ' +
    'breath or effects), exactly where it is, at exactly the same size, angle and colours, with all its detail. Replace everything else ' +
    '(the art background, the card frame, border and all text) with plain solid white #FFFFFF. Do not move, resize, crop or redraw the character. ' +
    'Keep the same framing as the photo.';

  const separate = async (card) => {
    const [erased, characterOnWhite] = await Promise.all([edit(ERASE, card), edit(ISOLATE, card)]);
    return { erased, characterOnWhite };
  };

  return { getKey, setKey, separate, KeyError };
})();
