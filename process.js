// Image processing for new cards, all in the browser:
//   splitLayered() - split one image of card + cut-out character side by side
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

  // draw an image (or canvas) scaled down so its longest side is at most `max`
  function fit(img, max) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = canvasOf(Math.round(w * s), Math.round(h * s));
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
    out.offset = { x: a, y: b }; // where the trimmed part was, in the (fitted) source
    return out;
  }

  // The grey tones of a checkerboard background (light or dark), read from the grey pixels
  // among `idx` (usually the image border). [] if the border isn't mostly grey; one tone for
  // a plain white/grey background; two for a checkerboard.
  function checkerTones(d, idx) {
    const hist = new Float64Array(64);
    let grey = 0;
    for (const k of idx) {
      const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 30) continue;
      hist[Math.min(63, ((r + g + b) / 3) >> 2)]++;
      grey++;
    }
    if (grey < idx.length * 0.3) return [];
    const peak = (h) => h.reduce((best, v, i) => (v > h[best] ? i : best), 0);
    const p1 = peak(hist), n1 = hist[p1];
    for (let i = Math.max(0, p1 - 5); i <= Math.min(63, p1 + 5); i++) hist[i] = 0;
    const p2 = peak(hist);
    return hist[p2] > n1 * 0.15 ? [p1 * 4 + 2, p2 * 4 + 2] : [p1 * 4 + 2];
  }
  // grey, and within (or just beyond) the range spanned by the background's tones
  const isCheckerPixel = (r, g, b, tones) => {
    if (!tones.length || Math.max(r, g, b) - Math.min(r, g, b) >= 30) return false;
    const L = (r + g + b) / 3;
    return L >= Math.min(...tones) - 16 && L <= Math.max(...tones) + 16;
  };

  // plain: also treat a solid background matching the border colour as background. Off for
  // card scans, whose own border would match when the card fills the photo.
  function cutout(img, { plain = true, minPiece = 0.02 } = {}) {
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
    const tones = checkerTones(d, seeds);
    const isBg = (k) => {
      const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
      if (isCheckerPixel(r, g, b, tones)) return true;
      return plain && tones.length < 2 && Math.hypot(r - br, g - bg, b - bb) < 45; // plain background
    };
    const back = new Uint8Array(N);
    flood(N, W, seeds, isBg, back);

    // Checkerboard trapped inside the character (e.g. inside a curled tail) can't be reached
    // from the edges. A pocket of background-like pixels that mixes the checker's two tones
    // is checkerboard; a white claw or a black shadow is mostly one tone.
    const seen = new Uint8Array(N), minPocket = Math.max(300, N * 0.0008);
    for (let s = 0; s < N; s++) {
      if (tones.length < 2 || !plain) break; // characters only: a card has no enclosed background
      if (back[s] || seen[s] || !isBg(s)) continue;
      const pocket = [], st = [s];
      let hi = 0, lo = 0;
      while (st.length) {
        const k = st.pop();
        if (seen[k] || back[k] || !isBg(k)) continue;
        seen[k] = 1; pocket.push(k);
        const L = (d[k * 4] + d[k * 4 + 1] + d[k * 4 + 2]) / 3;
        if (Math.abs(L - tones[0]) < Math.abs(L - tones[1])) hi++; else lo++;
        const i = k % W;
        if (i > 0) st.push(k - 1);
        if (i < W - 1) st.push(k + 1);
        if (k >= W) st.push(k - W);
        if (k < N - W) st.push(k + W);
      }
      const n = pocket.length;
      if (n >= minPocket && hi > n * 0.2 && lo > n * 0.2) for (const k of pocket) back[k] = 1;
    }

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
    const keep = (k) => !back[k] && sizes[label[k]] >= biggest * minPiece;
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

    // Light the puffed shape from the top-left, keeping every original pixel's detail:
    // a soft shade multiplies the colour (darker edges away from the light, a gentle
    // highlight toward it), plus a little extra saturation. No blur, no banding.
    const Lx = -0.55, Ly = -0.6, Lz = 0.58, BANDS = [0.55, 0.75, 0.95, 1.15, 1.3];
    const Hf = (i, y) => h[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, i))];
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      const k = y * W + i;
      if (d[k * 4 + 3] < 8) continue;
      const gx = (Hf(i + 2, y) - Hf(i - 2, y)) / 4, gy = (Hf(i, y + 2) - Hf(i, y - 2)) / 4;
      const len = Math.hypot(gx, gy, 1);
      const ndl = Math.max(0, (-gx * Lx - gy * Ly + Lz) / len);
      // light 0.38 (turned away) .. 1.31 (facing the light), pulled mostly toward a few bands
      // for the puffy, banded look while the original pixels keep their detail
      const v = 1 + (0.72 + 0.42 * ndl - 1) * 2.2;
      let band = BANDS[0];
      for (const t of BANDS) if (Math.abs(t - v) < Math.abs(band - v)) band = t;
      const shade = band * 0.75 + v * 0.25;
      const shine = Math.max(0, ndl - 0.92) * 2.2 * 255;     // small soft highlight
      let [Hh, S, L] = toHSL(d[k * 4] / 255, d[k * 4 + 1] / 255, d[k * 4 + 2] / 255);
      S = Math.min(1, S * 1.12);
      const [r, g, bl] = toRGB(Hh, S, L);
      d[k * 4] = Math.min(255, r * 255 * shade + shine);
      d[k * 4 + 1] = Math.min(255, g * 255 * shade + shine);
      d[k * 4 + 2] = Math.min(255, bl * 255 * shade + shine);
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

  // One image with the card (character removed) and the cut-out character side by side,
  // on a checkerboard or plain background.
  // Returns { card, char } or null if the image isn't laid out like that.
  function splitLayered(img) {
    const c = fit(img, 2000), W = c.width, H = c.height, d = pixels(c);
    const border = [];
    for (let i = 0; i < W; i++) border.push(i, (H - 1) * W + i);
    for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
    const tones = checkerTones(d, border);
    if (!tones.length) return null;
    const isBg = (p) => isCheckerPixel(d[p], d[p + 1], d[p + 2], tones);
    const frac = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = 0; y < H; y += 2) if (isBg((y * W + x) * 4)) n++;
      frac[x] = n / Math.ceil(H / 2);
    }
    // The card side has much less background than the checkerboard side (a card's silver or
    // white areas count a little, so compare the two sides rather than use a fixed cut-off):
    // split where the average on each side differs most.
    const sum = new Float64Array(W + 1);
    for (let x = 0; x < W; x++) sum[x + 1] = sum[x] + frac[x];
    let split = -1, gap = 0;
    for (let x = Math.round(W * 0.2); x <= Math.round(W * 0.8); x++) {
      const g = Math.abs(sum[x] / x - (sum[W] - sum[x]) / (W - x));
      if (g > gap) { gap = g; split = x; }
    }
    if (gap < 0.25) return null;
    const cardLeft = sum[split] / split < (sum[W] - sum[split]) / (W - split);
    const region = (x0, x1) => {
      const r = canvasOf(x1 - x0, H);
      r.getContext('2d', { willReadFrequently: true }).drawImage(c, x0, 0, x1 - x0, H, 0, 0, x1 - x0, H);
      return r;
    };
    const m = 6; // stay clear of the seam
    const card = cropCard(cardLeft ? region(0, split - m) : region(split + m, W));
    const char = cutout(cardLeft ? region(split + m, W) : region(0, split - m), { minPiece: 0.002 }); // keep embers
    return { card, char };
  }

  const pixels = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const scaled = (c, w) => {
    const out = canvasOf(Math.max(1, Math.round(w)), Math.max(1, Math.round((w * c.height) / c.width)));
    out.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, out.width, out.height);
    return out;
  };

  // If the card still shows the character, where? Template match of the cut-out against the
  // card, coarse then fine. Returns { x, y, w } as fractions of the card, or null.
  function locate(card, char) {
    function search(cardW, scales, xs, ys) {
      const cs = scaled(card, cardW), cd = pixels(cs), CW = cs.width, CH = cs.height;
      let best = { score: Infinity }, sum = 0, n = 0;
      for (const s of scales) {
        const ch = scaled(char, s * CW), hd = pixels(ch), w = ch.width, h = ch.height;
        const pts = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          if (hd[p + 3] > 200) pts.push(x, y, hd[p], hd[p + 1], hd[p + 2]);
        }
        if (pts.length < 250) continue;
        for (const oy of ys(h, CH)) for (const ox of xs(w, CW)) {
          let dsum = 0, m = 0;
          for (let k = 0; k < pts.length; k += 5) {
            const X = ox + pts[k], Y = oy + pts[k + 1];
            if (X < 0 || Y < 0 || X >= CW || Y >= CH) continue;
            const q = (Y * CW + X) * 4;
            dsum += Math.abs(cd[q] - pts[k + 2]) + Math.abs(cd[q + 1] - pts[k + 3]) + Math.abs(cd[q + 2] - pts[k + 4]);
            m++;
          }
          if (m < (pts.length / 5) * 0.8) continue; // mostly on the card
          const score = dsum / m;
          sum += score; n++;
          if (score < best.score) best = { score, x: ox / CW, y: oy / CH, w: s };
        }
      }
      best.mean = sum / n;
      return best;
    }
    const range = (a, b, step) => { const r = []; for (let v = a; v <= b; v += step) r.push(Math.round(v)); return r; };
    const coarse = search(64, range(40, 110, 3).map((v) => v / 100),
      (w, CW) => range(-w * 0.2, CW - w * 0.8, 1), (h, CH) => range(-h * 0.2, CH - h * 0.8, 1));
    if (!(coarse.score < coarse.mean * 0.62)) return null; // nothing clearly matches
    const fine = search(200, range(coarse.w * 95, coarse.w * 105, 1).map((v) => v / 100),
      (w, CW) => range(coarse.x * CW - 5, coarse.x * CW + 5, 1), (h, CH) => range(coarse.y * CH - 5, coarse.y * CH + 5, 1));
    return { x: fine.x, y: fine.y, w: fine.w };
  }

  // Glitter to match the card: is the art window holo (lots of tiny bright specks), and
  // which colours does its art use? Returns { holo, hues: [degrees…] }.
  function glitterFor(card, win) {
    const W = card.width, H = card.height;
    const x0 = Math.round(win.l * W), y0 = Math.round(win.t * H);
    const ww = Math.round((win.r - win.l) * W), wh = Math.round((win.b - win.t) * H);
    const art = canvasOf(300, Math.max(1, Math.round((300 * wh) / ww)));
    art.getContext('2d', { willReadFrequently: true }).drawImage(card, x0, y0, ww, wh, 0, 0, art.width, art.height);
    const d = pixels(art), w = art.width, h = art.height, N = w * h;
    const L = new Float32Array(N), hist = new Float64Array(36);
    for (let k = 0; k < N; k++) {
      const r = d[k * 4] / 255, g = d[k * 4 + 1] / 255, b = d[k * 4 + 2] / 255;
      L[k] = (r * 0.3 + g * 0.59 + b * 0.11) * 255;
      const [hh, s, l] = toHSL(r, g, b);
      if (s > 0.35 && l > 0.3 && l < 0.85) hist[Math.floor(hh * 36) % 36] += s;
    }
    // colours: the strongest hues, at least 30° apart
    const hues = [];
    for (let i = 0; i < 4; i++) {
      let p = 0;
      for (let k = 1; k < 36; k++) if (hist[k] > hist[p]) p = k;
      if (!hist[p]) break;
      hues.push(p * 10 + 5);
      for (let k = -2; k <= 2; k++) hist[(p + k + 36) % 36] = 0;
    }
    // holo: bright pixels that stand out from their surroundings
    let specks = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const k = y * w + x;
      if (L[k] < 150) continue;
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += L[k + dy * w + dx];
      if (L[k] - s / 25 > 32) specks++;
    }
    return { holo: specks / N > 0.004, hues: hues.length ? hues : [190, 300, 50], specks: specks / N };
  }

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

  return { loadImage, fit, cropCard, splitLayered, locate, findWindow, glitterFor, stylize, fadeBottom, toBlob };
})();
