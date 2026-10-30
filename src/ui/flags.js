// Procedural nation flags (canvas). Each seat gets a distinct pattern in its colour.

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (f < 1) {
    r *= f;
    g *= f;
    b *= f;
  } else {
    r += (255 - r) * (f - 1);
    g += (255 - g) * (f - 1);
    b += (255 - b) * (f - 1);
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function star(g, cx, cy, r, color) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

export function drawFlag(canvas, color, pattern) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d');
  const light = '#f1e9d6';
  const dark = shadeHex(color, 0.5);
  const isLight = (() => {
    const n = parseInt(color.slice(1), 16);
    return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 190;
  })();
  const contrast = isLight ? '#3a3228' : light;
  g.clearRect(0, 0, w, h);
  switch (pattern % 4) {
    case 0: {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = isLight ? dark : light;
      g.fillRect(0, h / 3, w, h / 3);
      star(g, w / 2, h / 2, h * 0.2, isLight ? light : color);
      break;
    }
    case 1: {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = contrast;
      g.fillRect(w * 0.28, 0, h * 0.2, h);
      g.fillRect(0, h * 0.4, w, h * 0.2);
      g.fillStyle = dark;
      g.fillRect(w * 0.28 + h * 0.06, 0, h * 0.08, h);
      g.fillRect(0, h * 0.46, w, h * 0.08);
      break;
    }
    case 2: {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = contrast;
      g.fillRect(0, 0, w * 0.32, h);
      g.save();
      g.translate(w * 0.66, h / 2);
      g.rotate(Math.PI / 4);
      g.fillStyle = contrast;
      g.fillRect(-h * 0.16, -h * 0.16, h * 0.32, h * 0.32);
      g.fillStyle = color;
      g.fillRect(-h * 0.08, -h * 0.08, h * 0.16, h * 0.16);
      g.restore();
      break;
    }
    default: {
      g.fillStyle = dark;
      g.fillRect(0, 0, w, h);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, 0);
      g.lineTo(0, h);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.beginPath();
      g.arc(w * 0.3, h * 0.36, h * 0.17, 0, Math.PI * 2);
      g.fillStyle = contrast;
      g.fill();
      g.beginPath();
      g.arc(w * 0.3, h * 0.36, h * 0.09, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = Math.max(1, w / 48);
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
}

const cache = new Map();
export function flagURL(color, pattern, w = 60, h = 40) {
  const key = color + pattern + w;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawFlag(c, color, pattern);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function flagCanvas(color, pattern, w = 128, h = 84) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawFlag(c, color, pattern);
  return c;
}

export function banditFlagCanvas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 84;
  const g = c.getContext('2d');
  g.fillStyle = '#16110f';
  g.fillRect(0, 0, 128, 84);
  g.fillStyle = '#9b1c16';
  g.fillRect(0, 60, 128, 10);
  // crossed blades
  g.strokeStyle = '#d8d0c0';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(40, 16);
  g.lineTo(88, 52);
  g.moveTo(88, 16);
  g.lineTo(40, 52);
  g.stroke();
  return c;
}
