// Generates KelFront's original brand SVGs (logo + favicon) into proprietary/.
// Run: node scripts/generateBrandAssets.mjs
// The letterforms are hand-built polygons so the logo renders identically in
// <img> tags (which cannot load web fonts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "proprietary", "images");
fs.mkdirSync(outDir, { recursive: true });

const AMBER = "#F5A524";
const CRIMSON = "#D7263D";
const INK = "#14161C";

// Letter height 160 (y 40..200), stroke 34.
const T = 40;
const B = 200;
const S = 34;
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}z`;
const poly = (...pts) => "M" + pts.map(([x, y]) => `${x} ${y}`).join("L") + "z";

const letters = {
  K: {
    w: 124,
    d: (x) => [
      rect(x, T, S, B - T),
      poly(
        [x + 34, 100],
        [x + 80, T],
        [x + 124, T],
        [x + 56, 128],
        [x + 34, 128],
      ),
      poly(
        [x + 50, 104],
        [x + 124, B],
        [x + 80, B],
        [x + 34, 140],
        [x + 34, 118],
      ),
    ],
  },
  E: {
    w: 104,
    d: (x) => [
      rect(x, T, S, B - T),
      rect(x, T, 104, S),
      rect(x, 103, 90, S),
      rect(x, B - S, 104, S),
    ],
  },
  L: {
    w: 100,
    d: (x) => [rect(x, T, S, B - T), rect(x, B - S, 100, S)],
  },
  F: {
    w: 104,
    d: (x) => [rect(x, T, S, B - T), rect(x, T, 104, S), rect(x, 106, 90, S)],
  },
  R: {
    w: 122,
    d: (x) => [
      rect(x, T, S, B - T),
      // Bowl: outer minus inner (evenodd on its own path).
      `M${x} ${T}H${x + 72}A48 48 0 0 1 ${x + 120} 88A48 48 0 0 1 ${x + 72} 136H${x}z` +
        `M${x + 34} 72H${x + 70}A16 16 0 0 1 ${x + 86} 88A16 16 0 0 1 ${x + 70} 104H${x + 34}z`,
      poly([x + 54, 128], [x + 92, 128], [x + 122, B], [x + 84, B]),
    ],
  },
  O: {
    w: 130,
    d: (x) =>
      `M${x + 50} ${T}H${x + 80}A50 50 0 0 1 ${x + 130} 90V150A50 50 0 0 1 ${x + 80} ${B}H${x + 50}A50 50 0 0 1 ${x} 150V90A50 50 0 0 1 ${x + 50} ${T}z` +
      `M${x + 52} 74H${x + 78}A18 18 0 0 1 ${x + 96} 92V148A18 18 0 0 1 ${x + 78} 166H${x + 52}A18 18 0 0 1 ${x + 34} 148V92A18 18 0 0 1 ${x + 52} 74z`,
  },
  N: {
    w: 124,
    d: (x) => [
      rect(x, T, S, B - T),
      rect(x + 90, T, S, B - T),
      poly([x, T], [x + 40, T], [x + 124, B], [x + 84, B]),
    ],
  },
  T: {
    w: 116,
    d: (x) => [rect(x, T, 116, S), rect(x + 41, T, S, B - T)],
  },
};

const GAP = 16;

function word(text, x0, fill) {
  const parts = [];
  let x = x0;
  for (const ch of text) {
    const l = letters[ch];
    const d = l.d(x);
    for (const seg of Array.isArray(d) ? d : [d]) {
      parts.push(`<path fill="${fill}" fill-rule="evenodd" d="${seg}"/>`);
    }
    x += l.w + GAP;
  }
  return { svg: parts.join(""), end: x - GAP };
}

// Emblem: a shield split by a jagged front line into two territories.
function emblem(ox, oy, scale = 1) {
  const shield =
    "M90 6L172 36V112C172 164 134 200 90 218C46 200 8 164 8 112V36Z";
  // Zig-zag "front" running top to bottom through the shield.
  const front = [
    [96, 0],
    [74, 46],
    [108, 84],
    [70, 124],
    [104, 166],
    [84, 230],
  ];
  const right =
    "M" + front.map(([x, y]) => `${x} ${y}`).join("L") + "L200 230L200 0Z";
  const frontLine = "M" + front.map(([x, y]) => `${x} ${y}`).join("L");
  return `<g transform="translate(${ox} ${oy}) scale(${scale})">
    <clipPath id="kf-shield"><path d="${shield}"/></clipPath>
    <path d="${shield}" fill="${AMBER}"/>
    <path d="${right}" fill="${CRIMSON}" clip-path="url(#kf-shield)"/>
    <path d="${frontLine}" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linejoin="round" clip-path="url(#kf-shield)"/>
    <path d="${shield}" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
  </g>`;
}

function logo(frontColor) {
  const emblemW = 180;
  const textX = emblemW + 40;
  const kel = word("KEL", textX, AMBER);
  const front = word("FRONT", kel.end + GAP + 6, frontColor);
  const width = front.end + 8;
  const height = 240;
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>KelFront</title>
  ${emblem(0, 8, 1)}
  ${kel.svg}
  ${front.svg}
</svg>
`,
  };
}

const light = logo("#FFFFFF");
fs.writeFileSync(path.join(outDir, "KelFrontLogo.svg"), light.svg);
fs.writeFileSync(path.join(outDir, "KelFrontLogoDark.svg"), logo(INK).svg);

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 224" width="180" height="224">
  <title>KelFront</title>
  ${emblem(0, 0, 1)}
</svg>
`;
fs.writeFileSync(path.join(outDir, "Favicon.svg"), favicon);

console.log(`KelFrontLogo.svg ${light.width}x${light.height}`);
