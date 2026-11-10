// Image processing for new cards, all in the browser:
//   cutout()  - make the character's background transparent (real alpha is kept;
//               a baked-in checkerboard or plain background is flood-filled away)
//   stylize() - the posterized, puffed-up look: rounded shading bands from its outline
//   fadeBottom() - fade the character out where it meets the card
window.HoloProcess = (() => {
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  function loadImage(file) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error(`Could not read ${file.name}`));
      img.src = URL.createObjectURL(file);
    });
  }

  // draw an image scaled down so its longest side is at most `max`
  function fit(img, max) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvasOf(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // 4-neighbour flood fill over pixels where test(k) is true, starting from `seeds`
  function flood(N, W, seeds, test, mark) {
    const st = seeds.slice();
    while (st.length) {
      const k = st.pop();
      if (mark[k] || !test(k)) continue;
      mark[k] = 1;
      const i = k % W;
      if (i > 0) st.push(k - 1);
      if (i < W - 1) st.push(k + 1);
      if (k >= W) st.push(k - W);
      if (k < N - W) st.push(k + W);
    }
  }

  function trim(c) {
    const { width: W, height: H } = c, d = c.getContext('2d').getImageData(0, 0, W, H).data;
    let a = W, b = H, e = -1, f = -1;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      if (d[(y * W + i) * 4 + 3] > 10) { if (i < a) a = i; if (i > e) e = i; if (y < b) b = y; if (y > f) f = y; }
    }
    if (e < 0) throw new Error('The character image looks empty after removing its background.');
    const out = canvasOf(e - a + 1, f - b + 1);
    out.getContext('2d').drawImage(c, a, b, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // plain: also treat a solid background matching the border colour as background. Off for
  // card scans, whose own border would match when the card fills the photo.
  function cutout(img, { plain = true } = {}) {
    const c = fit(img, 1200), W = c.width, H = c.height, N = W * H;
    const x = c.getContext('2d', { willReadFrequently: true });
    const id = x.getImageData(0, 0, W, H), d = id.data;
    let clear = 0;
    for (let k = 0; k < N; k++) if (d[k * 4 + 3] < 200) clear++;
    if (clear > N * 0.03) return trim(c); // already has real transparency

    // average border colour, for plain (non-checkerboard) backgrounds
    let br = 0, bg = 0, bb = 0, bn = 0;
    const seeds = [];
    for (let i = 0; i < W; i++) seeds.push(i, (H - 1) * W + i);
    for (let y = 0; y < H; y++) seeds.push(y * W, y * W + W - 1);
    for (const k of seeds) { br += d[k * 4]; bg += d[k * 4 + 1]; bb += d[k * 4 + 2]; bn++; }
    br /= bn; bg /= bn; bb /= bn;
    const isBg = (k) => {
      const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const checker = mx - mn < 30 && mn > 95;
      const solid = plain && Math.hypot(r - br, g - bg, b - bb) < 45;
      return checker || solid;
    };
    const back = new Uint8Array(N);
    flood(N, W, seeds, isBg, back);

    // keep the big pieces (body, a detached flame...), drop specks
    const label = new Int32Array(N), sizes = [0];
    for (let s = 0; s < N; s++) {
      if (back[s] || label[s]) continue;
      const L = sizes.length;
      let n = 0;
      const st = [s];
      while (st.length) {
        const k = st.pop();
        if (back[k] || label[k]) continue;
        label[k] = L; n++;
        const i = k % W;
        if (i > 0) st.push(k - 1);
        if (i < W - 1) st.push(k + 1);
        if (k >= W) st.push(k - W);
        if (k < N - W) st.push(k + W);
      }
      sizes.push(n);
    }
    const biggest = Math.max(...sizes);
    const keep = (k) => !back[k] && sizes[label[k]] >= biggest * 0.02;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      const k = y * W + i;
      if (!keep(k)) { d[k * 4 + 3] = 0; continue; }
      let n = 0, t = 0; // soften the edge
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = i + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        t++; if (keep(yy * W + xx)) n++;
      }
      d[k * 4 + 3] = Math.round((255 * n) / t);
    }
    x.putImageData(id, 0, 0);
    return trim(c);
  }

  // separable box blur over `ch` interleaved channels
  function blur(src, W, H, ch, r) {
    let a = src;
    for (const horiz of [true, false]) {
      const o = new Float32Array(a.length);
      for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
        const s = new Float32Array(ch); let n = 0;
        for (let t = -r; t <= r; t++) {
          const xx = horiz ? i + t : i, yy = horiz ? y : y + t;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = (yy * W + xx) * ch;
          for (let c = 0; c < ch; c++) s[c] += a[q + c];
          n++;
        }
        const p = (y * W + i) * ch;
        for (let c = 0; c < ch; c++) o[p + c] = s[c] / n;
      }
      a = o;
    }
    return a;
  }

  const toHSL = (R, G, B) => {
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    let L = (mx + mn) / 2, S = 0, Hh = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      S = L > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      Hh = mx === R ? (G - B) / dd + (G < B ? 6 : 0) : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4;
      Hh /= 6;
    }
    return [Hh, S, L];
  };
  const h2 = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const toRGB = (Hh, S, L) => {
    if (!S) return [L, L, L];
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
    return [h2(p, q, Hh + 1 / 3), h2(p, q, Hh), h2(p, q, Hh - 1 / 3)];
  };

  function stylize(c) {
    const W = c.width, H = c.height, N = W * H;
    const x = c.getContext('2d', { willReadFrequently: true });
    const id = x.getImageData(0, 0, W, H), d = id.data;
    const scale = Math.max(W, H) / 1160; // tuned on a ~1160px character

    // height from distance to the outline, shaped round
    const dist = new Float32Array(N);
    for (let k = 0; k < N; k++) dist[k] = d[k * 4 + 3] > 128 ? 1e9 : 0;
    const at = (i, y) => (i < 0 || y < 0 || i >= W || y >= H ? 0 : dist[y * W + i]);
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      const k = y * W + i;
      dist[k] = Math.min(dist[k], at(i - 1, y) + 1, at(i, y - 1) + 1, at(i - 1, y - 1) + 1.414, at(i + 1, y - 1) + 1.414);
    }
    for (let y = H - 1; y >= 0; y--) for (let i = W - 1; i >= 0; i--) {
      const k = y * W + i;
      dist[k] = Math.min(dist[k], at(i + 1, y) + 1, at(i, y + 1) + 1, at(i + 1, y + 1) + 1.414, at(i - 1, y + 1) + 1.414);
    }
    let mx = 1;
    for (let k = 0; k < N; k++) mx = Math.max(mx, dist[k]);
    const R = 90 * scale;
    let h = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!dist[k]) continue;
      const r = Math.min(dist[k], R) / R;
      h[k] = Math.sqrt(1 - (1 - r) * (1 - r)) * R * 0.8 + Math.sqrt(dist[k] / mx) * R * 0.9;
      const L = (Math.max(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]) + Math.min(d[k * 4], d[k * 4 + 1], d[k * 4 + 2])) / 510;
      if (L < 0.2) h[k] -= 10 * scale; // ink lines act as creases
    }
    const br = Math.max(1, Math.round(5 * scale));
    h = blur(blur(h, W, H, 1, br), W, H, 1, br);

    // softened colour
    const pr = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) {
      const a = d[k * 4 + 3] / 255;
      pr[k * 4] = d[k * 4] * a; pr[k * 4 + 1] = d[k * 4 + 1] * a; pr[k * 4 + 2] = d[k * 4 + 2] * a; pr[k * 4 + 3] = a;
    }
    const b = blur(pr, W, H, 4, Math.max(1, Math.round(3 * scale)));

    // light the puffed shape from the top-left in four bold bands
    const Lx = -0.55, Ly = -0.6, Lz = 0.58;
    const Hf = (i, y) => h[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, i))];
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      const k = y * W + i;
      if (d[k * 4 + 3] < 8) continue;
      const a = b[k * 4 + 3] || 1;
      let [Hh, S, L] = toHSL(b[k * 4] / a / 255, b[k * 4 + 1] / a / 255, b[k * 4 + 2] / a / 255);
      if (L < 0.18) L = 0.07;
      else {
        const gx = (Hf(i + 2, y) - Hf(i - 2, y)) / 4, gy = (Hf(i, y + 2) - Hf(i, y - 2)) / 4;
        const len = Math.hypot(gx, gy, 1);
        const ndl = Math.max(0, (-gx * Lx - gy * Ly + Lz) / len);
        let shade = 0.2 + 1.05 * ndl;
        shade = shade < 0.55 ? 0.55 : shade < 0.85 ? 0.8 : shade < 1.05 ? 1.0 : 1.18;
        L = Math.min(0.92, Math.max(0.1, L * shade + (shade > 1.1 ? 0.1 : 0)));
        S = Math.min(1, S * 1.3);
      }
      const [r, g, bl] = toRGB(Hh, S, L);
      d[k * 4] = r * 255; d[k * 4 + 1] = g * 255; d[k * 4 + 2] = bl * 255;
    }
    x.putImageData(id, 0, 0);
    return c;
  }

  // copy of `c` faded to transparent at fraction `cutY` of its height
  function fadeBottom(c, cutY) {
    const out = canvasOf(c.width, c.height);
    const x = out.getContext('2d');
    x.drawImage(c, 0, 0);
    const y1 = cutY * c.height, y0 = y1 - 0.07 * c.height;
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    // destination-in also clears everything outside the filled rect (below the cut);
    // the gradient stays fully opaque above y0
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, Math.max(1, y1));
    return out;
  }

  const toBlob = (c, type, q) => new Promise((ok) => c.toBlob(ok, type, q));

  // the card cropped out of any checkerboard / white background around it
  const cropCard = (img) => cutout(img, { plain: false });

  const pixels = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const scaled = (c, w) => {
    const out = canvasOf(Math.max(1, Math.round(w)), Math.max(1, Math.round((w * c.height) / c.width)));
    out.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, out.width, out.height);
    return out;
  };

  // Find the art window: the long straight border lines around the middle of the
  // upper half. Returns { l, t, r, b } as fractions of the card.
  function findWindow(card, cx = 0.5, cy = 0.3) {
    const c = scaled(card, 300), d = pixels(c), W = c.width, H = c.height;
    const L = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) L[k] = d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11;
    const at = (x, y) => L[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    const run = (n, edge) => { // longest run of edge pixels, allowing gaps of 2px
      let best = 0, cur = 0, gap = 0;
      for (let i = 0; i < n; i++) {
        if (edge(i)) { cur += gap + 1; gap = 0; best = Math.max(best, cur); }
        else if (++gap > 2) { cur = 0; gap = 0; }
      }
      return best;
    };
    const rowLine = (y) => run(W, (x) => Math.abs(at(x, y + 1) - at(x, y - 1)) > 28) >= W * 0.45;
    let t = null, b = null;
    for (let y = Math.round(H * 0.04); y < cy * H; y++) if (rowLine(y)) t = y;
    for (let y = Math.round(H * 0.8); y > cy * H; y--) if (rowLine(y)) b = y;
    t ??= Math.round(H * 0.11); b ??= Math.round(H * 0.5);
    const colLine = (x) => run(b - t, (i) => Math.abs(at(x + 1, t + i) - at(x - 1, t + i)) > 28) >= (b - t) * 0.5;
    let l = null, r = null;
    for (let x = Math.round(W * 0.02); x < cx * W; x++) if (colLine(x)) l = x;
    for (let x = Math.round(W * 0.98); x > cx * W; x--) if (colLine(x)) r = x;
    l ??= Math.round(W * 0.08); r ??= Math.round(W * 0.92);
    return { l: l / W, t: t / H, r: r / W, b: b / H };
  }

  // The art window as its own canvas, and where it sits on the card (px).
  function windowCrop(card, win) {
    const W = card.width, H = card.height;
    const x = Math.round(win.l * W), y = Math.round(win.t * H);
    const crop = canvasOf(Math.round((win.r - win.l) * W), Math.round((win.b - win.t) * H));
    crop.getContext('2d').drawImage(card, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return { crop, x, y };
  }

  // Segment Anything (SlimSAM, ~14 MB, downloaded once and cached by the browser).
  // segmenter(crop) analyses the image once; the function it returns turns tap points
  // ([{ x, y, on }], in crop pixels; on=false means "not this") into a mask quickly.
  const SAM_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const SAM_MODEL = 'Xenova/slimsam-77-uniform';
  let sam = null;
  async function segmenter(crop, onProgress) {
    sam ??= (async () => {
      const T = await import(SAM_LIB);
      const progress_callback = (p) => { if (p.status === 'progress') onProgress?.(p.progress / 100); };
      const [model, processor] = await Promise.all([
        T.SamModel.from_pretrained(SAM_MODEL, { progress_callback }),
        T.AutoProcessor.from_pretrained(SAM_MODEL, { progress_callback }),
      ]);
      return { T, model, processor };
    })();
    const { T, model, processor } = await sam;
    const raw = await T.RawImage.fromURL(crop.toDataURL('image/png'));
    const emb = await model.get_image_embeddings(await processor(raw));
    const plane = crop.width * crop.height;
    return async (points) => {
      const inp = await processor(raw, {
        input_points: [points.map((p) => [p.x, p.y])],
        input_labels: [points.map((p) => (p.on ? 1 : 0))],
      });
      const out = await model({ ...emb, input_points: inp.input_points, input_labels: inp.input_labels });
      const masks = await processor.post_process_masks(out.pred_masks, inp.original_sizes, inp.reshaped_input_sizes);
      const sc = out.iou_scores.data;
      let s = 0;
      for (let k = 1; k < 3; k++) if (sc[k] > sc[s]) s = k;
      return masks[0].data.subarray(s * plane, (s + 1) * plane);
    };
  }

  // the crop with everything outside the mask made transparent (edge softened)
  function applyMask(crop, mask) {
    const W = crop.width, H = crop.height;
    const out = canvasOf(W, H), x = out.getContext('2d', { willReadFrequently: true });
    x.drawImage(crop, 0, 0);
    const id = x.getImageData(0, 0, W, H), d = id.data;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      let n = 0, t = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = i + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        t++; if (mask[yy * W + xx]) n++;
      }
      d[(y * W + i) * 4 + 3] = Math.round((255 * n) / t);
    }
    x.putImageData(id, 0, 0);
    return out;
  }

  // Paint the character out of the card by diffusing the surrounding colours into where
  // it was (slightly widened). `char` is the extracted canvas, drawn at card pixel (x, y).
  function eraseFromCard(card, char, x, y) {
    const W = card.width, H = card.height;
    const out = canvasOf(W, H), ox = out.getContext('2d');
    ox.drawImage(card, 0, 0);
    const mask = canvasOf(W, H), mx = mask.getContext('2d', { willReadFrequently: true });
    const grow = Math.max(3, Math.round(W / 200));
    for (let dy = -grow; dy <= grow; dy += grow) for (let dx = -grow; dx <= grow; dx += grow) {
      mx.drawImage(char, x + dx, y + dy);
    }
    const w = Math.ceil(W / 4), sd = pixels(scaled(card, w)), sm = pixels(scaled(mask, w));
    const h = Math.round((w * H) / W), N = w * h;
    const hole = new Uint8Array(N), col = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      hole[k] = sm[k * 4 + 3] > 10 ? 1 : 0;
      col[k * 3] = sd[k * 4]; col[k * 3 + 1] = sd[k * 4 + 1]; col[k * 3 + 2] = sd[k * 4 + 2];
    }
    const nb = [];
    for (let it = 0; it < 400; it++) {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const k = yy * w + xx;
        if (!hole[k]) continue;
        nb.length = 0;
        if (xx > 0) nb.push(k - 1);
        if (xx < w - 1) nb.push(k + 1);
        if (yy > 0) nb.push(k - w);
        if (yy < h - 1) nb.push(k + w);
        let r = 0, g = 0, b = 0;
        for (const q of nb) { r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; }
        col[k * 3] = r / nb.length; col[k * 3 + 1] = g / nb.length; col[k * 3 + 2] = b / nb.length;
      }
    }
    const fill = canvasOf(w, h), fx = fill.getContext('2d'), fd = fx.createImageData(w, h);
    for (let k = 0; k < N; k++) {
      fd.data[k * 4] = col[k * 3]; fd.data[k * 4 + 1] = col[k * 3 + 1]; fd.data[k * 4 + 2] = col[k * 3 + 2]; fd.data[k * 4 + 3] = 255;
    }
    fx.putImageData(fd, 0, 0);
    const patch = canvasOf(W, H), px = patch.getContext('2d');
    px.drawImage(fill, 0, 0, W, H);
    px.globalCompositeOperation = 'destination-in';
    px.drawImage(mask, 0, 0);
    ox.drawImage(patch, 0, 0);
    return out;
  }

  // trim transparent margins, reporting where the trimmed part was
  function trimAt(c) {
    const { width: W, height: H } = c, d = pixels(c);
    let a = W, b = H, e = -1, f = -1;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      if (d[(y * W + i) * 4 + 3] > 10) { if (i < a) a = i; if (i > e) e = i; if (y < b) b = y; if (y > f) f = y; }
    }
    if (e < 0) return null;
    return { canvas: trim(c), x: a, y: b };
  }

  return { loadImage, fit, cropCard, findWindow, windowCrop, segmenter, applyMask, eraseFromCard, trimAt, stylize, fadeBottom, toBlob };
})();
