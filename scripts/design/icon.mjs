// Draws the app icon from Lucide's brain, the same shape Mark.tsx shows in the app: npm run design:icon
//
// Writes into packaging/, where electron-builder finds them by name:
//   icon.svg, icon.png, icon.ico   Windows and Linux: the brain in teal on a transparent ground, so a taskbar shows
//                                  just the brain
//   icon-mac.svg, icon.icns        macOS: a white brain on a Lagoon tile, on Apple's 824 px grid inside 1024
// resvg renders with no browser or system fonts, so the same SVG always gives the same bytes.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { __iconNode as brain } from "lucide-react/dist/esm/icons/brain.js";
import { solidColours } from "../../src/core/design.ts";

const dir = fileURLToPath(new URL("../../packaging/", import.meta.url));
const light = solidColours("light").accent;
const dark = solidColours("dark").accent;

/** One icon file can't follow the taskbar's theme, so it takes the midpoint of the two accents, which reads on both. */
const mix = (a, b) =>
  `#${[1, 3, 5].map((i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, "0")).join("")}`;
const teal = mix(light, dark);

const strokes = (colour) =>
  `<g fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${brain.map(([, { d }]) => `<path d="${d}"/>`).join("")}</g>`;

const svgs = {
  icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 24 24">${strokes(teal)}</svg>\n`,
  "icon-mac": `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="185" fill="${light}"/><g transform="translate(212 212) scale(25)">${strokes("#ffffff")}</g></svg>\n`,
};
for (const [name, svg] of Object.entries(svgs)) writeFileSync(`${dir}${name}.svg`, svg);

const render = (name, size) => new Resvg(svgs[name], { fitTo: { mode: "width", value: size } }).render().asPng();

writeFileSync(`${dir}icon.png`, render("icon", 1024));

// An .ico of PNG frames keeps every taskbar size sharp and keeps the alpha.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const frames = icoSizes.map((size) => render("icon", size));
const dirEntries = Buffer.alloc(6 + 16 * icoSizes.length);
dirEntries.writeUInt16LE(1, 2);
dirEntries.writeUInt16LE(icoSizes.length, 4);
let offset = dirEntries.length;
icoSizes.forEach((size, i) => {
  const at = 6 + i * 16;
  dirEntries[at] = dirEntries[at + 1] = size === 256 ? 0 : size;
  dirEntries.writeUInt16LE(1, at + 4);
  dirEntries.writeUInt16LE(32, at + 6);
  dirEntries.writeUInt32LE(frames[i].length, at + 8);
  dirEntries.writeUInt32LE(offset, at + 12);
  offset += frames[i].length;
});
writeFileSync(`${dir}icon.ico`, Buffer.concat([dirEntries, ...frames]));

// An .icns of PNG chunks, one per size macOS asks for, Retina included.
const chunks = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
  const png = render("icon-mac", size);
  const head = Buffer.alloc(8);
  head.write(type, "ascii");
  head.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([head, png]);
});
const icnsHead = Buffer.alloc(8);
icnsHead.write("icns", "ascii");
icnsHead.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
writeFileSync(`${dir}icon.icns`, Buffer.concat([icnsHead, ...chunks]));

console.log(`wrote icon.svg, icon.png and icon.ico in ${teal}, icon-mac.svg and icon.icns on ${light}`);
