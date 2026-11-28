/**
 * Makes a picture from the in-app camera look like it came from a better
 * camera: levels set from the picture itself (no muddy blacks or grey
 * whites), dark shots lifted, a gentle contrast curve, richer colours that
 * leave skin and already-bright colours alone, and a little sharpening that
 * skips flat areas (so it doesn't sharpen noise). Settings → Photos turns it off.
 */

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Enhances the canvas in place. A 1600 px picture takes a moment on a phone. */
export function enhancePhoto(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  const { width: w, height: h } = canvas;
  if (!w || !h) return;
  const frame = g.getImageData(0, 0, w, h);
  const px = frame.data;

  // 1. Levels: where the darkest and brightest bits really are.
  const hist = new Uint32Array(256);
  let sampled = 0;
  for (let i = 0; i < px.length; i += 8) {
    hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
    sampled++;
  }
  const at = (share: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= sampled * share) return v;
    }
    return 255;
  };
  // Never stretch a picture that's dark or bright on purpose all the way.
  const lo = Math.min(at(0.004), 36);
  const hi = Math.max(at(0.996), 206);
  const stretch = Math.min(1.3, 255 / Math.max(1, hi - lo));
  let mean = 0;
  for (let v = 0; v < 256; v++) mean += hist[v] * clamp((v - lo) * stretch);
  mean /= Math.max(1, sampled);
  // 2. Lift dark pictures (never darken).
  const gamma = mean > 1 && mean < 112 ? Math.max(0.72, Math.log(112 / 255) / Math.log(mean / 255)) : 1;

  // One lookup for levels, lift and a gentle S-curve.
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = clamp((v - lo) * stretch) / 255;
    x = Math.pow(x, gamma);
    const s = x * x * (3 - 2 * x);
    lut[v] = Math.round((x * 0.86 + s * 0.14) * 255);
  }

  // 3. Levels, then richer colours: more for dull pixels, less for bright ones.
  for (let i = 0; i < px.length; i += 4) {
    let r = lut[px[i]];
    let gr = lut[px[i + 1]];
    let b = lut[px[i + 2]];
    const max = r > gr ? (r > b ? r : b) : gr > b ? gr : b;
    const min = r < gr ? (r < b ? r : b) : gr < b ? gr : b;
    const sat = (max - min) / 255;
    // Skin (warm, middling saturation) gets less, so faces don't go orange.
    const skin = r > gr && gr > b && sat > 0.1 && sat < 0.55 ? 0.5 : 1;
    const boost = 1 + (0.06 + 0.2 * (1 - sat)) * skin;
    const avg = (r + gr + b) / 3;
    r = avg + (r - avg) * boost;
    gr = avg + (gr - avg) * boost;
    b = avg + (b - avg) * boost;
    px[i] = r;
    px[i + 1] = gr;
    px[i + 2] = b;
  }

  // 4. Sharpen: the picture minus a soft copy of itself, only where there's detail.
  if (w > 2 && h > 2) {
    const soft = new Uint8ClampedArray(px.length);
    const row = new Float32Array(w * 4);
    // Box blur 3 × 3, rows then columns.
    for (let y = 0; y < h; y++) {
      const base = y * w * 4;
      for (let x = 0; x < w; x++) {
        const l = base + Math.max(0, x - 1) * 4;
        const c = base + x * 4;
        const r = base + Math.min(w - 1, x + 1) * 4;
        row[x * 4] = (px[l] + px[c] + px[r]) / 3;
        row[x * 4 + 1] = (px[l + 1] + px[c + 1] + px[r + 1]) / 3;
        row[x * 4 + 2] = (px[l + 2] + px[c + 2] + px[r + 2]) / 3;
      }
      soft.set(row, base);
    }
    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        const c = (y * w + x) * 4;
        const up = c - w * 4;
        const down = c + w * 4;
        for (let k = 0; k < 3; k++) {
          const blur = (soft[up + k] + soft[c + k] + soft[down + k]) / 3;
          const detail = px[c + k] - blur;
          if (detail > 2.5 || detail < -2.5) out[c + k] = px[c + k] + detail * 0.55;
        }
      }
    }
    px.set(out);
  }
  g.putImageData(frame, 0, 0);
}
