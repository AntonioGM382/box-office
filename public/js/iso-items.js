'use strict';
// isometric renderer, item art: sprites, floor art, seating, tables, rugs, the desk and surface items
// (split from the former iso.js; classic scripts share one global scope, load order: iso-core, iso-catalog, iso-items, iso-room, iso-team, then items.js)
// ---- extra sprites for the iso set (one character = one art unit; '@main' / '@hi' / '@lo' = the worker's colour and shades) ----
rsp('beanbag', rmk(14, 9, (x, y) => { const nx = (x + .5 - 7) / 7, ny = (y + .5 - 5.2) / 4.6, d = nx * nx + ny * ny; if (d > 1 || (y < 2 && Math.abs(nx) > .55)) return ''; return y >= 7 ? 'L' : (nx < -.2 && ny < -.1) ? 'h' : d > .72 && ny > 0 ? 'l' : 'm'; }), { m: '@main', h: '@hi', l: '@lo', L: '@lo2' });
rsp('whiteboard', rmk(16, 11, (x, y) => (y === 0 || y === 9 || x === 0 || x === 15) ? (y === 9 ? 't' : 'f') : y === 10 ? (x >= 2 && x <= 13 ? 't' : '') : (y === 2 && x >= 2 && x <= 7) ? 'b' : (y === 4 && x >= 2 && x <= 10) ? 'k' : (y === 6 && x >= 2 && x <= 5) ? 'r' : (x >= 10 && x <= 13 && y >= 5 && y <= 8 && (y === 8 || x === 10 || (x - 10) === (8 - y))) ? 'g' : 'w'), { f: '#9aa3b2', t: '#6b7280', w: '#f4f6f8', b: '#3b82f6', k: '#3a3548', r: '#e0473c', g: '#2f9a5a' });
rsp('neon_off', rmk(16, 7, (x, y) => (y === 0 || y === 6 || x === 0 || x === 15) ? 'f' : 'b'), { f: '#2a2533', b: '#120d1c' });
// shelf smalls (6 wide, like the other desk trinkets)
rsp('trophy', ['.yyyy.', 'yYyyyy', 'y.yyy.', '..yy..', '..yy..', '.bbbb.', '.BBBB.'], { y: '#f0b92c', Y: '#fff1a8', b: '#7a4e2e', B: '#5e3d27' });
rsp('books', ['.rrrr.', '.RRRRw', 'bbbbb.', 'BBBBBw', '.gggg.', '.GGGGw'], { r: '#d0564e', R: '#a33f39', b: '#4f86c6', B: '#3a6aa3', g: '#5fa86b', G: '#3d7a49', w: '#efe8da' });
rsp('figurine', ['.MMMM.', 'MhMMMM', 'MkMMkM', 'MMMMMM', '.l..l.', 'dddddd'], { M: '@main', h: '@hi', l: '@lo', k: '#231a17', d: '#3d3a48' });
rsp('photo', ['ffffff', 'fsssyf', 'fssssf', 'fgghgf', 'ffffff', '.d..d.'], { f: '#c9a36a', s: '#8fc8ee', y: '#ffe39a', g: '#4f8f5c', h: '#3d7349', d: '#6e4630' });
// ---- floor item art: c = { t, n (night 0..1), work, lit, glows[], main (worker colour), seed, W (worker look, desks only) } ----
const ART = {};
ART.lamp_floor = (T, c) => {
  drawBoxes(T, [[.3, .3, .4, .4, 0, 1, '#2b2833'], [.46, .46, .08, .08, 1, 16.5, '#3d3a48']]);
  lbox(T, .24, .24, .52, .52, 17, 5, { t: '#fbeec6', l: '#e8d9b8', r: '#cbbb96' });
  if (c.lit) { c.glows.push([TP(T, .5, .5, 16), 20, '255,204,130', .05 + .16 * c.n]); c.pools.push([TP(T, .5, .5, 0), 30, '255,196,120', .03 + .2 * c.n]); }
};
ART.plant_tall = (T, c) => {
  lbox(T, .27, .27, .46, .46, 0, 6, { t: '#8a4f33', l: '#c4764f', r: '#a0603f' }); lbox(T, .22, .22, .56, .56, 6, 1, { t: '#2f2119', l: '#d68b62', r: '#b36e4c' });
  const [ax, ay] = TP(T, .5, .5, 7), sw = Math.round(Math.sin(c.t * 1.1 + c.seed * 2) * 2) / 4;
  for (const [ox, oy, w, h, k, s] of [[-.5, -17, .75, 13, 0, 0], [-5.5, -15, 5, 2.5, 1, .6], [.5, -17, 5, 2.5, 2, .8], [-5, -11, 4.5, 2, 0, .4], [.5, -12, 4.5, 2, 1, .5], [-3, -19, 4, 2.5, 2, 1], [-2.5, -8, 5, 2, 2, .2], [-4, -14, 1, .5, 2, .6], [2, -16, 1, .5, 0, .8]]) R(ax + ox + sw * s, ay + oy + 2, w, h, LEAF[k]);
};
ART.beanbag = (T, c) => { const [ax, ay] = TP(T, .5, .56, 0); softShadow(ax, ay - .5, 7, 2, .3); spriteAt('beanbag', ax, ay + 1, T.r % 2 === 1, c.main); };
ART.bookshelf = (T, c) => {
  lbox(T, .1, .02, .8, 1.96, 0, 26, { t: '#6e4d35', l: '#5a3e2a', r: '#4a3222' });
  if (!lvis(T, '+u')) return;
  for (let s = 0; s < 3; s++) {
    const z0 = 2 + s * 8; lface(T, '+u', .9, .1, 1.9, z0, z0 + 7, '#2a1d15');
    for (let v = .14, i = 0; v < 1.84; i++) { const h = hashStr('bk' + s + i + c.seed), bw = .07 + (h % 3) * .025, bh = 3.5 + ((h >> 3) % 4) * .8; if ((h >> 6) % 9 === 0) { v += .1; continue; } lface(T, '+u', .9, v, Math.min(1.86, v + bw), z0, z0 + bh, BOOKS[h % BOOKS.length]); v += bw + .02; }
    lface(T, '+u', .9, .08, 1.92, z0 - .8, z0, '#7a5639');
  }
};
// upholstery: one base colour -> frame / cushion / piping tones (top lit, left mid, right shade)
const fab = (hex, k) => ({ t: shade(hex, 1.12 * (k || 1)), l: shade(hex, .92 * (k || 1)), r: shade(hex, .7 * (k || 1)), e: shade(hex, 1.32 * (k || 1)) });
ART.sofa = (T) => {
  const base = '#4f64aa', fr = fab(base, .92), cu = fab('#7d93dc'), bk = fab('#6379c4');
  drawBoxes(T, [[.06, .14, .1, .1, 0, 1.2, INKY], [1.84, .14, .1, .1, 0, 1.2, INKY], [.06, .8, .1, .1, 0, 1.2, INKY], [1.84, .8, .1, .1, 0, 1.2, INKY]]);
  lbox(T, 0, .1, 2, .84, 1.2, 3.2, fr);                                    // base
  lbox(T, .02, .1, 1.96, .3, 4.4, 6.8, bk);                                // back
  drawBoxes(T, [[.26, .4, .73, .52, 4.4, 1.8, cu], [1.01, .4, .73, .52, 4.4, 1.8, cu], [0, .4, .26, .54, 4.4, 3.6, fr], [1.74, .4, .26, .54, 4.4, 3.6, fr]]);
  lface(T, '+v', .92, .3, 1.7, 2.6, 3, shade(base, .78));                 // piping under the seat
  lface(T, '+v', .4, .3, .98, 8.4, 10.6, shade('#6379c4', 1.06)); lface(T, '+v', .4, 1.02, 1.7, 8.4, 10.6, shade('#6379c4', 1.06)); // back cushions
};
// ---- seating (1x1, rot 0 faces +v; the back sits on the low-v side) ----
function starBase(T, col) { drawBoxes(T, [[.44, .14, .12, .72, .6, .8, col], [.14, .44, .72, .12, .6, .8, col]]); for (const [u, v] of [[.5, .14], [.5, .86], [.14, .5], [.86, .5]]) { const [x, y] = TP(T, u, v, 0); R(Math.round(x) - .5, Math.round(y) - 1, 1, 1, shade(col, .55)); } lbox(T, .45, .45, .1, .1, 1.4, 3, shade(col, .8)); }
ART.chair_office = (T) => {
  const base = '#5d6c9e', seat = fab(base), mesh = fab('#414c78'), frame = '#9aa0b3', pad = '#2b2838';
  starBase(T, frame); lbox(T, .46, .46, .08, .08, 3.6, 1, '#d6dae4'); // gas lift with a chrome collar
  lbox(T, .2, .22, .6, .6, 4.4, 1.8, seat); lface(T, '+v', .82, .22, .78, 4.5, 4.9, shade(base, 1.3)); lface(T, '+v', .82, .22, .78, 5.8, 6.2, shade(base, .7)); // seat: bright front lip, piping under the top
  lbox(T, .22, .14, .56, .1, 6.2, 8.4, mesh); for (let k = 0; k < 4; k++) lface(T, '+v', .24, .26, .74, 7.4 + k * 1.9, 8.2 + k * 1.9, k % 2 ? shade('#414c78', .7) : shade('#414c78', 1.25)); // mesh back: ribbed
  lbox(T, .26, .12, .48, .12, 14.4, 1.8, seat); lface(T, '+v', .24, .34, .66, 15.8, 16.2, shade(base, 1.3)); // headrest rail
  lbox(T, .22, .15, .05, .08, 6.2, 8.4, frame); lbox(T, .73, .15, .05, .08, 6.2, 8.4, frame); // back uprights
  lbox(T, .46, .22, .08, .06, 5.4, 1.2, frame);
  for (const u of [.12, .8]) { lbox(T, u + .03, .4, .03, .05, 6.2, 2.4, frame); lbox(T, u, .3, .09, .4, 8.6, .9, pad); lface(T, '+v', .7, u + .01, u + .08, 8.9, 9.3, '#4a4660'); } // arms with soft pads
};
ART.chair_gaming = (T) => {
  const blk = fab('#3d3a4c'), red = '#e0404f';
  starBase(T, '#5a5668'); lbox(T, .18, .2, .64, .62, 4.6, 2, blk); lbox(T, .2, .32, .08, .5, 6.6, .9, fab(red)); lbox(T, .72, .32, .08, .5, 6.6, .9, fab(red));
  lbox(T, .2, .1, .6, .14, 6.6, 11.4, blk); lface(T, '+v', .24, .24, .31, 7, 17.4, red); lface(T, '+v', .24, .69, .76, 7, 17.4, red);
  lface(T, '+v', .24, .38, .62, 14.2, 16.4, '#e9e4f0'); lface(T, '+v', .24, .4, .6, 9, 11, shade(red, .8));
  lbox(T, .12, .36, .07, .42, 6.6, 2.6, '#1c1b22'); lbox(T, .81, .36, .07, .42, 6.6, 2.6, '#1c1b22');
};
ART.chair_cafe = (T) => {
  const w = fab('#a8744a'), dk = '#6e4630', cu = fab('#c2413a');
  drawBoxes(T, [[.22, .22, .07, .07, 0, 6, dk], [.71, .22, .07, .07, 0, 6, dk], [.22, .71, .07, .07, 0, 6, dk], [.71, .71, .07, .07, 0, 6, dk]]);
  lbox(T, .24, .3, .04, .4, 2.4, .7, dk); lbox(T, .72, .3, .04, .4, 2.4, .7, dk); lbox(T, .3, .72, .4, .04, 2.4, .7, dk); // stretchers between the legs
  lbox(T, .18, .18, .64, .64, 6, 1.1, w); lbox(T, .22, .22, .56, .56, 7.1, .9, cu); lface(T, '+v', .78, .24, .76, 7.2, 7.7, shade('#c2413a', 1.3)); // a red seat cushion
  lbox(T, .22, .18, .07, .07, 7.1, 7, dk); lbox(T, .71, .18, .07, .07, 7.1, 7, dk); lbox(T, .2, .17, .6, .08, 11.6, 2.4, w); lbox(T, .2, .17, .6, .08, 9, .8, w);
  for (const u of [.36, .46, .56]) lbox(T, u, .19, .04, .05, 9.8, 1.8, dk); // back spindles
};
ART.stool = (T) => {
  drawBoxes(T, [[.26, .26, .07, .07, 0, 6.4, '#3d3a48'], [.67, .26, .07, .07, 0, 6.4, '#3d3a48'], [.26, .67, .07, .07, 0, 6.4, '#3d3a48'], [.67, .67, .07, .07, 0, 6.4, '#3d3a48']]);
  lbox(T, .28, .28, .44, .44, 2.6, .5, '#6a6578'); lbox(T, .3, .3, .4, .4, 2.6, .5, '#8a8597');
  lpoly(T, circ(.5, .5, .33, 14), 6.4, shade('#c0392b', .7)); lpoly(T, circ(.5, .5, .34, 14), 7, '#a8352d'); lpoly(T, circ(.5, .5, .33, 14), 7.6, '#d9534f'); lpoly(T, circ(.47, .47, .18, 10), 7.6, '#e8736f');
  const [bx, by] = TP(T, .5, .5, 7.6); for (const [dx, dy] of [[0, 0], [-3, 0], [3, 0], [0, -1], [0, 1]]) R(bx + dx - .5, by + dy - .5, 1, 1, '#9b2d27'); // a tufted button pattern
};
ART.armchair = (T) => {
  const f = fab('#c98a3c'), cu = fab('#e0a352');
  drawBoxes(T, [[.1, .16, .08, .08, 0, 1.2, INKY], [.82, .16, .08, .08, 0, 1.2, INKY], [.1, .82, .08, .08, 0, 1.2, INKY], [.82, .82, .08, .08, 0, 1.2, INKY]]);
  lbox(T, .06, .12, .88, .82, 1.2, 3.6, f); lbox(T, .08, .1, .84, .26, 4.8, 6.6, f);
  drawBoxes(T, [[.24, .36, .52, .56, 4.8, 1.6, cu], [.06, .36, .18, .58, 4.8, 3.2, f], [.76, .36, .18, .58, 4.8, 3.2, f]]);
  lface(T, '+v', .36, .26, .74, 7, 10.4, shade('#e0a352', .96));
};
// ---- tables ----
ART.table_side = (T) => { drawBoxes(T, [[.3, .3, .4, .4, 0, .7, INKY], [.45, .45, .1, .1, .7, 6.3, INKY]]); lbox(T, .02, .02, .96, .96, 7, 1.2, fab('#b98357')); };
ART.table_coffee = (T) => {
  const w = fab('#8a5a3c'), top = fab('#b98357');
  drawBoxes(T, [[.08, .1, .1, .1, 0, 4.4, w], [1.82, .1, .1, .1, 0, 4.4, w], [.08, .8, .1, .1, 0, 4.4, w], [1.82, .8, .1, .1, 0, 4.4, w]]);
  lbox(T, .1, .12, 1.8, .76, 1.4, .6, w); lbox(T, 0, 0, 2, 1, 4.4, 1.1, top);
};
ART.table_cafe = (T) => {
  lpoly(T, circ(.5, .5, .24, 12), 0, '#2b2833'); lpoly(T, circ(.5, .5, .2, 12), .6, '#3d3a48'); lbox(T, .46, .46, .08, .08, .6, 8.4, '#3d3a48');
  lpoly(T, circ(.5, .5, .5, 20), 8.6, '#7a7488'); lpoly(T, circ(.5, .5, .5, 20), 10, '#e9e4dc'); lpoly(T, circ(.46, .46, .36, 16), 10, '#f4f0ea');
};
ART.coffee_machine = (T, c) => {
  lbox(T, .12, .12, .76, .76, 0, 8, { t: '#8a6445', l: '#6e4d35', r: '#553a28' });
  lbox(T, .2, .18, .6, .5, 8, 9, { t: '#4d4a5c', l: '#3a3746', r: '#2b2934' });
  lface(T, '+v', .68, .3, .7, 9.3, 12.5, '#15141a'); lbox(T, .42, .5, .16, .14, 8, 1.8, '#f4efe6');
  lface(T, '+v', .68, .6, .68, 14.5, 15.5, c.lit && Math.floor(c.t * 1.2) % 2 ? '#e0473c' : '#6e2a25');
  if (c.lit) { const [ax, ay] = TP(T, .5, .57, 10), k = c.work ? 2 : 1; for (let i = 0; i < k; i++) { const p = (c.t * (c.work ? .5 : .3) + i * .5) % 1; R(Math.round(ax + i * .5 - .5), ay - p * 5, .5, .5, `rgba(235,235,245,${(.45 * (1 - p)).toFixed(2)})`); } }
};
ART.arcade = (T, c) => {
  const bodyC = { t: '#5a3fa0', l: '#43307d', r: '#32245f' }, lit = c.lit, k = Math.floor(c.t * 2.5);
  drawBoxes(T, [[.14, .16, .72, .62, 0, 22, bodyC], [.1, .14, .8, .68, 22, 3.6, { t: '#2a1f4f', l: '#2c2058', r: '#1d1540' }], [.14, .78, .72, .16, 9.5, 1.6, { t: '#4a3a86', l: '#2a1f4f', r: '#221944' }]]);
  lface(T, '+v', .78, .14, .18, 0, 22, '#7a5fd0'); lface(T, '+v', .78, .82, .86, 0, 22, '#2d2060'); lface(T, '+v', .78, .18, .82, 0, 3, '#1c1433'); // edge trim and a kick plate
  lface(T, '+v', .78, .3, .7, 3.6, 8.6, '#16102b'); lface(T, '+v', .78, .33, .47, 5, 7.6, lit ? '#ffcf4a' : '#8a6a1a'); lface(T, '+v', .78, .53, .67, 5, 7.6, lit ? '#ff6b8b' : '#8a3a4a'); lface(T, '+v', .78, .36, .44, 6.3, 6.9, '#15102a'); lface(T, '+v', .78, .56, .64, 6.3, 6.9, '#15102a'); // the coin door
  lface(T, '+v', .78, .2, .8, 12, 20.4, '#0b0a14'); lface(T, '+v', .781, .24, .76, 12.6, 19.8, lit ? '#101a44' : '#0d0d1c'); // bezel and screen
  if (lit) { // a little space-invaders game: a grid of aliens shuffling sideways, a ship that follows them, a shot now and then
    const sh = (k % 2) * .045 + .02;
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) lface(T, '+v', .7815, .3 + i * .1 + sh, .3 + i * .1 + sh + .055, 17.6 - r * 1.35, 18.4 - r * 1.35, ['#ff3ea5', '#41e0ff', '#6bff7a'][r]);
    const sx = .3 + (Math.sin(c.t * .7) * .5 + .5) * .36; lface(T, '+v', .7815, sx, sx + .08, 13.2, 13.7, '#ffe14a'); lface(T, '+v', .7815, sx + .03, sx + .05, 13.7, 14.4, '#ffe14a');
    if (k % 3) lface(T, '+v', .7815, sx + .035, sx + .045, 14.6 + (k % 3) * 1.4, 15.6 + (k % 3) * 1.4, '#ffffff');
    lface(T, '+v', .7815, .24, .76, 12.6, 13, 'rgba(120,255,160,.5)'); lface(T, '+v', .782, .26, .36, 18.6, 19.7, 'rgba(255,255,255,.07)'); // ground line, a glass glint
  }
  lface(T, '+v', .82, .14, .86, 22.4, 25.2, lit ? '#ffcf4a' : '#8a6a1a'); lface(T, '+v', .82, .14, .86, 22.4, 22.9, '#ff3ea5'); // the marquee
  for (let i = 0; i < 6; i++) lface(T, '+v', .82, .22 + i * .1, .22 + i * .1 + .06, 23.4, 24.6 - (i % 2) * .7, '#5a1f6a');
  lface(T, '+u', .86, .16, .78, 0, 22, '#2b1f57'); for (let z = 1; z < 21; z += 2) { const vc = .47 + Math.sin(z * .55) * .15; lface(T, '+u', .86, vc - .07, vc + .07, z, z + 2, '#ff3ea5'); lface(T, '+u', .86, vc - .07, vc - .04, z, z + 2, '#ff8ac6'); } // lightning side art
  const [jx, jy] = TP(T, .3, .86, 11.1); R(jx - .5, jy - 3, 1, 3, '#cfd5e0'); R(jx - 1, jy - 4, 2, 1.4, '#e0473c'); R(jx - 1, jy - 4, .5, .5, '#ff9a8c');
  [[.52, '#41e0ff'], [.63, '#ffe14a'], [.74, '#6bff7a']].forEach(([u, col], i) => { const [bx, by] = TP(T, u, .86, 11.1); R(bx - 1, by - 1 + (i % 2) * .5, 2, 1, col); });
  if (lit) { c.glows.push([TP(T, .5, .8, 16), 12, '120,200,255', .04 + .08 * c.n]); c.glows.push([TP(T, .5, .85, 24), 10, '255,200,80', .03 + .04 * c.n]); c.pools.push([TP(T, .5, 1.3, 0), 16, '150,110,255', .1 * c.n]); }
};
ART.aquarium = (T, c) => {
  lbox(T, .04, .12, 1.92, .76, 0, 7, { t: '#4d4a5c', l: '#3a3746', r: '#2b2934' });
  lbox(T, .08, .16, 1.84, .68, 7, 9.4, { t: 'rgba(175,230,255,.62)', l: 'rgba(70,150,215,.62)', r: 'rgba(45,110,180,.66)' });
  lface(T, '+v', .84, .12, .5, 7, 9.5, '#3d7349'); lface(T, '+v', .84, 1.4, 1.7, 7, 10.5, '#4f8f5c');
  for (let i = 0; i < 3; i++) { const u = .2 + ((c.t * (.12 + i * .05) + i * .37) % 1) * 1.55, z = 9.5 + i * 2.2; lface(T, '+v', .841, u, u + .1, z, z + 1, ['#ff9a3c', '#ffd23f', '#ff6b8b'][i]); }
  for (let i = 0; i < 3; i++) { const p = (c.t * .4 + i / 3) % 1, [bx, by] = TP(T, .5 + i * .45, .5, 8 + p * 8.5); R(Math.round(bx), Math.round(by), .5, .5, 'rgba(230,245,255,.8)'); }
  lbox(T, .04, .12, 1.92, .1, 16.4, 1.2, INKY); lbox(T, .04, .78, 1.92, .1, 16.4, 1.2, INKY);
  if (c.lit) { c.glows.push([TP(T, 1, .5, 12), 16, '90,170,255', .04 + .1 * c.n]); c.pools.push([TP(T, 1, 1.2, 0), 20, '80,160,255', .08 * c.n]); }
};
ART.server_rack = (T, c) => {
  lbox(T, .14, .14, .72, .72, 0, 26, { t: '#34333f', l: '#23222c', r: '#1a1921' });
  const sp = c.work ? 7 : 2;
  for (let k = 0; k < 6; k++) { const z = 2 + k * 3.9; lface(T, '+v', .86, .2, .8, z, z + 3.2, '#2d2c38'); if (!c.lit) continue; for (let j = 0; j < 3; j++) { const on = (hashStr('sr' + k + j + c.seed) + Math.floor(c.t * sp)) % 3 !== 0; lface(T, '+v', .861, .26 + j * .1, .31 + j * .1, z + 1.2, z + 2, on ? (j === 2 ? '#f0b429' : '#4ade80') : '#1f3a28'); } }
};
// rugs lie flat (drawn before everything that stands). Every edge is a tile-axis line and every band is a multiple of 1/8 tile
// (= 1 art px measured across a 2:1 line), so borders and stripes stay exactly parallel to the floor grid in both rotations.
function rugBands(T, u0, v0, u1, v1, bands) { let k = 0; for (const [w, col] of bands) { lflat(T, u0 + k, v0 + k, u1 - k, v1 - k, 0, col); k += w; } }
function rugFringe(T, u, v0, v1, col) { for (let v = v0; v < v1 - .01; v += .25) lflat(T, u - .0625, v + .0625, u + .0625, v + .1875, 0, col); }
ART.rug_round = (T) => {
  const c = [T.sw / 2, T.sd / 2], R0 = T.sw / 2 - .02;
  for (const [f, col] of [[1, '#6e332d'], [.94, '#e5d3ae'], [.86, '#a04a42'], [.66, '#e5d3ae'], [.6, '#7c3a33'], [.38, '#e0a13a'], [.2, '#7c3a33']]) lpoly(T, circ(c[0], c[1], R0 * f, 40), 0, col);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = R0 * .76; lpoly(T, circ(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, .07, 6), 0, '#e0a13a'); }
};
ART.rug_square = (T) => {
  rugBands(T, 0, 0, T.sw, T.sd, [[.125, '#1f4450'], [.125, '#e6dcc2'], [.125, '#2f5d6b'], [.25, '#3f7a8a'], [.125, '#e6dcc2'], [.5, '#2f6f7e']]);
  const cu = T.sw / 2, cv = T.sd / 2; lpoly(T, [[cu, cv - .7], [cu + .45, cv], [cu, cv + .7], [cu - .45, cv]], 0, '#e0a13a'); lpoly(T, [[cu, cv - .4], [cu + .25, cv], [cu, cv + .4], [cu - .25, cv]], 0, '#f0e2b6');
};
ART.rug_stripe = (T) => { // stripes run along the long side (u); the short ends get a fringe
  const L = T.sw, D = T.sd, cols = ['#c2413a', '#f0e2b6', '#3f7fd0', '#f0e2b6', '#e0a13a', '#f0e2b6', '#3f7fd0', '#f0e2b6', '#c2413a'], ws = [.25, .125, .25, .125, .25, .125, .25, .125, .25];
  lflat(T, .125, 0, L - .125, D, 0, '#8e2f2a'); let v = .125; for (let i = 0; i < cols.length; i++) { lflat(T, .25, v, L - .25, v + ws[i], 0, cols[i]); v += ws[i]; }
  rugFringe(T, .125, 0, D, '#efe4c4'); rugFringe(T, L - .125, 0, D, '#efe4c4');
};
// the worker's desk (every desk kind): the chair, the worker, then the desk itself. The monitor and keyboard are surface items
// (ART_S) that stand on the top like everything else and read the worker's state from the desk (host.W).
const WOODT = fab('#a06c43'), LEGC = { t: '#5e3d27', l: '#6e4630', r: '#553520' };
// ---- desk skins: a finish per room (cosmetics.deskSkin, 'desk.xxx'); o.desk -> W.skin. Every desk kind and the team's mini-desks read it. ----
// top = the slab, leg = the leg panel, ped = the drawer pedestal, rail = the inner shelf, drawer/handle = its front, base = a plain hex for shade(), x = the extras painted by deskExtras.
const DESK_PAL = (() => {
  const P = (top, leg, ped, rail, drawer, handle, x, extra) => ({ top: typeof top === 'string' ? fab(top) : top, leg: typeof leg === 'string' ? { t: leg, l: shade(leg, .9), r: shade(leg, .72) } : leg, ped: typeof ped === 'string' ? { t: ped, l: shade(ped, 1.06), r: shade(ped, .86) } : ped,
    rail: typeof rail === 'string' ? { t: rail, l: shade(rail, 1.12), r: shade(rail, .9) } : rail, drawer, handle, x, base: typeof ped === 'string' ? ped : '#8a5a3c', ...extra });
  return {
    standard: { top: fab('#a06c43'), leg: { t: '#5e3d27', l: '#6e4630', r: '#553520' }, ped: { t: '#8a5a3c', l: '#946038', r: '#7a4e2e' }, rail: { t: '#7a4e2e', l: '#8a5a3c', r: '#6e4630' }, drawer: '#6e4630', handle: '#d9b98a', x: null, base: '#8a5a3c' },
    walnut: P('#5b3b27', '#2f1d12', '#4a2f1f', '#3e271a', '#3a2418', '#c9a24a', null),
    laminate: P('#ecebf2', '#9aa0ab', '#dcdae3', '#c9c7d2', '#c9c7d2', '#6b7280', 'laminate'),
    bamboo: P('#cfae62', '#8a6a2c', '#d4b56e', '#b8964a', '#b8964a', '#6b4f1e', 'bamboo'),
    candy: P('#f9a8d4', '#93c5fd', '#fbcfe8', '#f9a8d4', '#f472b6', '#ffffff', 'candy'),
    steel: P('#8b94a3', '#3a404a', '#6b7380', '#59616e', '#59616e', '#d1d5db', 'steel'),
    retro: P('#2d2358', '#1a1533', '#3b2f6b', '#2a2050', '#241b48', '#ff4fd8', 'retro'),
    glass: P({ t: 'rgba(160,220,244,.62)', l: 'rgba(120,190,222,.55)', r: 'rgba(84,150,188,.55)' }, '#b8c2cc', { t: 'rgba(150,215,240,.45)', l: 'rgba(120,190,222,.42)', r: 'rgba(84,150,188,.42)' }, { t: 'rgba(130,200,228,.5)', l: 'rgba(110,180,210,.45)', r: 'rgba(80,140,175,.45)' }, 'rgba(150,215,240,.4)', '#e5e7eb', 'glass', { base: '#9ed5ea' }),
    gaming: P('#2a2838', '#15141d', '#1f1d2b', '#15141d', '#15141d', '#ef4444', 'rgb'),
    gold: P('#d8ad3c', '#8a6a1c', '#e6bf4a', '#b8892a', '#8f6f22', '#fff3c4', 'gold'),
  };
})();
const deskPal = skin => DESK_PAL[String(skin || 'standard').replace(/^desk\./, '')] || DESK_PAL.standard;
function deskExtras(K, T, c, L, v0, v1, zt, still) {
  const x = K.x; if (!x) return; const zf = zt - 1.5, lit = c && c.lit, n = (c && c.n) || 0, fr = (f, o) => f * L + (o || 0);
  if (x === 'laminate') { lflat(T, .12, v0 + .1, L - .12, v0 + .13, zt + .02, 'rgba(255,255,255,.7)'); lface(T, '+v', v1, .02, L - .02, zf, zf + .22, '#9aa0ab'); }
  else if (x === 'bamboo') { for (let u = .5; u < L - .2; u += .5) lflat(T, u, v0 + .05, u + .04, v1 - .05, zt + .02, '#a8873a'); lflat(T, .1, v0 + .4, L - .1, v0 + .43, zt + .02, 'rgba(120,90,30,.35)'); lface(T, '+v', v1, .02, L - .02, zf, zf + .3, '#8a6a2c'); }
  else if (x === 'candy') { for (const [f, v, col] of [[.08, .2, '#fde047'], [.22, .7, '#60a5fa'], [.36, .35, '#ffffff'], [.5, .8, '#34d399'], [.63, .25, '#fde047'], [.77, .65, '#f472b6'], [.9, .3, '#ffffff'], [.44, .12, '#a78bfa']]) lflat(T, fr(f), v0 + (v1 - v0) * v, fr(f, .09), v0 + (v1 - v0) * v + .05, zt + .02, col); lface(T, '+v', v1, .02, L - .02, zf, zf + .25, '#f9a8d4'); }
  else if (x === 'steel') { for (const [u, v] of [[.08, v0 + .08], [L - .16, v0 + .08], [.08, v1 - .16], [L - .16, v1 - .16]]) lflat(T, u, v, u + .09, v + .09, zt + .02, '#3a404a'); lflat(T, .22, v0 + .12, L - .22, v0 + .15, zt + .02, 'rgba(255,255,255,.35)'); lface(T, '+v', v1, .02, L - .02, zf, zf + .35, '#3a404a'); }
  else if (x === 'retro') { const pk = '#ff4fd8', cy = '#22d3ee'; lface(T, '+v', v1, .03, L - .03, zf + .12, zf + .75, pk); for (let u = .4; u < L - .1; u += .42) lflat(T, u, v0 + .05, u + .02, v1 - .05, zt + .02, 'rgba(34,211,238,.5)'); lflat(T, .06, v0 + (v1 - v0) * .45, L - .06, v0 + (v1 - v0) * .45 + .03, zt + .02, 'rgba(255,79,216,.55)'); lface(T, '+v', v1, .03, L - .03, zf, zf + .14, cy); if (lit) c.glows.push([TP(T, L / 2, v1 + .2, zf), 12, '255,79,216', .02 + .04 * n]); }
  else if (x === 'glass') { lflat(T, .25, v0 + .1, .65, v0 + .17, zt + .02, 'rgba(255,255,255,.55)'); lflat(T, .75, v0 + .1, .85, v0 + .17, zt + .02, 'rgba(255,255,255,.45)'); lface(T, '+v', v1, .02, L - .02, zf, zf + .22, '#7dd3fc'); lface(T, '+v', v1, .02, L - .02, zt - .3, zt - .05, 'rgba(255,255,255,.5)'); }
  else if (x === 'rgb') { const rgb = hueRgb(still ? 300 : ((c ? c.t : 0) * 45) % 360), led = 'rgb(' + rgb.join(',') + ')'; lface(T, '+v', v1, .04, L - .04, zf + .2, zf + .9, led); lflat(T, .1, v0 + .06, L - .1, v0 + .1, zt + .02, led); lflat(T, .1, v0 + .1, L - .1, v0 + .14, zt + .02, 'rgba(255,255,255,.08)'); if (lit) { c.pools.push([TP(T, L / 2, v1 + .35, 0), 18, rgb.join(','), .05 + .07 * n]); c.glows.push([TP(T, L / 2, v1, zf), 11, rgb.join(','), .02 + .04 * n]); } }
  else if (x === 'gold') { lface(T, '+v', v1, .02, L - .02, zt - .5, zt - .1, '#fff0a0'); lface(T, '+v', v1, .02, L - .02, zf, zf + .25, '#a8781c'); lflat(T, .14, v0 + .12, L - .14, v0 + .15, zt + .02, 'rgba(255,248,200,.55)'); if (c) { const g = Math.floor(c.t * 2.2) % 5; if (g < 2) lflat(T, fr(.2 + g * .35), v0 + .35, fr(.2 + g * .35, .07), v0 + .42, zt + .03, '#ffffff'); } }
}
function deskChair(T, u, v, back) { // the worker's office chair, turned to face the desk (+v)
  const seat = fab('#48435f'), fr = '#27243a';
  drawBoxes(T, [[u - .06, v - .3, .12, .6, 0, .7, fr], [u - .3, v - .06, .6, .12, 0, .7, fr]]); lbox(T, u - .05, v - .05, .1, .1, .7, 3.4, '#3d3a48');
  if (back) { lbox(T, u - .3, v - .42, .6, .1, 5.6, 13.4, seat); lbox(T, u - .26, v - .43, .52, .02, 16.6, 2, { t: '#6a6390', l: '#5d5780', r: '#4a4566', e: null }); }
  lbox(T, u - .3, v - .28, .6, .56, 3.8, 1.8, seat);
}
function deskWorker(T, c, it, u, v, z) {
  const W = it.W || {}, st = W.st || 'idle', [bx, by] = TP(T, u, v, z), wa = W.alpha == null ? 1 : W.alpha;
  if (W.portal > 0) drawIsoPortal(bx, by - 6, W.portal, c.t);
  if (wa > 0 && W.col) {
    const k = W.k || 1, snap = v => k === 1 ? Math.round(v) : Math.round(v * S) / S; // a smaller copy (the team's workers) snaps to device pixels
    const sc = W.scared, x0 = snap(bx - 6 * k + (sc ? (Math.sin(c.t * 30) > 0 ? (sc > 1 ? 1 : .5) : (sc > 1 ? -1 : -.5)) * (REDUCED.matches ? 0 : 1) : 0)), y0 = snap(by - 10 * k + (W.dy || 0) + (sc ? 1.5 * k : 0)); // a cowering worker ducks down behind the desk
    X.globalAlpha = wa; const yy = sprite(x0, y0, k, sc ? 'waiting' : st, c.t, W.seed || 0, W.col, W.hat, W.acc, W.look || 0, W.wave || 0); X.globalAlpha = 1;
    if (sc) { R(x0 + 13, y0 + (c.t * 6) % 3, 1, 1.5, '#7dd3fc'); R(x0 - 1, y0 + (c.t * 6 + 1.5) % 3, 1, 1.5, '#7dd3fc'); }
    else if (W.nerv) R(x0 + 13, y0 + 1 + (c.t * 3) % 4, 1, 1.5, '#7dd3fc');
    it.head = [bx, yy - (HAT_UP[W.hat] || 0) * k]; it.body = [x0, y0, 12 * k, 10 * k];
  }
}
function drawDesk(T, c, it, part) { // part: none = everything; 'back' = the chair only, 'front' = the desk only (the Team tab's hot desks cache both and draw the worker between them);
  // a room card draws it in three pieces so the still ones can be cached: 'chair', then 'worker', then 'post' (the armrests and the desk)
  const def = IDEF[it.itemId] || IDEF['room.desk'], [su, sv] = def.seat, L = def.size[0];
  const dChair = !part || part === 'back' || part === 'chair', dWorker = !part || part === 'worker', dArms = !part || part === 'back' || part === 'post', dBody = !part || part === 'front' || part === 'post';
  if (dChair) { if (def.stand) { lbox(T, su - .34, sv - .3, .68, .6, 0, 1, '#2f2c3a'); lbox(T, su - .3, sv - .26, .6, .52, 1, 3.4, fab('#3a3648')); } else deskChair(T, su, sv, true); }
  if (dWorker) deskWorker(T, c, it, su, def.stand ? sv : sv + .02, def.stand ? 4.4 : 5.6);
  if (dArms && !def.stand) { lbox(T, su - .36, sv - .1, .08, .36, 5.6, 2.2, '#27243a'); lbox(T, su + .28, sv - .1, .08, .36, 5.6, 2.2, '#27243a'); }
  if (!dBody) return;
  const k = it.itemId.slice(5), K = deskPal(it.W && it.W.skin);
  if (k === 'desk_l') { // an L: the front arm along u, the side arm along v on the right
    drawBoxes(T, [[.06, 2.08, .1, .84, 0, 7, K.leg], [2.1, .08, .82, 1.84, 0, 7, K.ped]]);
    for (let d = 0; d < 3; d++) lface(T, '+u', 2.92, .2, 1.8, 1.2 + d * 2, 1.6 + d * 2, K.drawer);
    lface(T, '+v', 2.92, .2, 2, 1, 7, shade(K.base, .9)); lbox(T, 0, 2, 3, 1, 7, 1.5, K.top); lbox(T, 2, 0, 1, 2, 7, 1.5, K.top); deskExtras(K, T, c, 3, 2, 3, 8.5);
  } else if (k === 'desk_gaming' && typeof drawGamingDesk === 'function') { drawGamingDesk(T, c, L);
  } else if (def.stand) { // sit-stand frame: two lifting columns on T-feet, a crossbar, a thin top
    drawBoxes(T, [[.2, 1.12, .14, .76, 0, .8, INKY], [L - .34, 1.12, .14, .76, 0, .8, INKY], [.22, 1.44, .1, .12, .8, 7.8, '#3d3a48'], [L - .32, 1.44, .1, .12, .8, 7.8, '#3d3a48'], [.3, 1.46, L - .6, .08, 5.4, .8, '#3d3a48']]);
    lbox(T, 0, 1, L, 1, 8.6, 1.4, K.top); deskExtras(K, T, c, L, 1, 2, 10, false); lface(T, '+v', 2, .3, .5, 9, 9.6, '#4ade80');
  } else { // desk / compact: a leg panel on the left, a drawer pedestal on the right
    const pw = L > 2 ? .8 : .56;
    drawBoxes(T, [[.04, 1.06, .1, .88, 0, 7, K.leg], [L - pw - .04, 1.06, pw, .88, 0, 7, K.ped], [.14, 1.1, L - pw - .2, .08, 2.4, 4.6, K.rail]]);
    for (let d = 0; d < 3; d++) { lface(T, '+v', 1.94, L - pw + .04, L - .1, 1 + d * 2.1, 1.3 + d * 2.1, K.drawer); lface(T, '+v', 1.94, L - pw / 2 - .1, L - pw / 2 + .06, 2 + d * 2.1, 2.4 + d * 2.1, K.handle); }
    lbox(T, 0, 1, L, 1, 7, 1.5, K.top); deskExtras(K, T, c, L, 1, 2, 8.5);
  }
  it.plate = TP(T, L / 2, def.size[1] + .05, 3.2);
}
function drawIsoPortal(cx, cy, f, t) { const w = Math.max(3, Math.round(12 * f)), h = Math.max(3, Math.round(16 * f)), x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2), c = Math.floor(t * 10) % 2 ? '#cbbcff' : '#a58cf5'; R(x0 + 1, y0 + 1, w - 2, h - 2, 'rgba(183,162,242,.3)'); R(x0 + 1, y0, w - 2, 1, c); R(x0 + 1, y0 + h - 1, w - 2, 1, c); R(x0, y0 + 1, 1, h - 2, c); R(x0 + w - 1, y0 + 1, 1, h - 2, c); }
// ---- surface items: art in their own cell frame (sw x sd tiles on the host top) ----
const ART_S = {};
ART_S.monitor = (T, c, host) => { // screen on the +u face (a mirrored monitor faces -u)
  const W = (host && host.W) || {}, st = W.st || 'idle', working = st === 'working', kind = toolKind(W.tool);
  lbox(T, .04, .1, .24, .3, 0, .5, INKY); lbox(T, .12, .21, .07, .08, .5, 1.8, '#2a2833');
  lbox(T, .18, .01, .1, .48, 2.1, 7.2, { t: '#2a2833', l: '#1b1a22', r: '#15141b' });
  const scr = !working ? (st === 'offline' ? '#101018' : '#1a1a24') : kind === 'term' ? '#08150d' : (Math.floor(c.t * 6) % 3 === 0 ? '#a5e4ff' : '#6fd0ff');
  lface(T, '+u', .28, .04, .46, 2.7, 8.7, scr); lface(T, '-u', .18, .04, .46, 2.7, 8.7, '#23212c');
  if (working) { for (let i = 0; i < 3; i++) { const len = kind === 'term' ? .08 + ((Math.floor(c.t * 5) + i * 7) % 5) * .05 : .1 + ((Math.floor(c.t * 4) + i * 2) % 4) * .05; lface(T, '+u', .281, .08, .08 + len, 7.3 - i * 1.6, 7.9 - i * 1.6, kind === 'term' ? '#4ade80' : '#0b3a52'); } }
  else if ((st === 'idle' || st === 'waiting') && Math.floor(c.t * 1.6) % 2) lface(T, '+u', .281, .1, .15, 6.8, 8, '#a39fbd');
  if (st !== 'offline' && c.lit) { c.glows.push([TP(T, .4, .25, 5), 14, working ? '110,170,255' : '90,110,170', .03 + .08 * c.n]); if (working) c.pools.push([TP(T, .9, .25, 0), 10, '110,170,255', .08 * c.n]); }
};
ART_S.keyboard = (T) => { lbox(T, .02, .03, .46, .19, 0, .6, { t: '#d9d4e2', l: '#b3adbf', r: '#9690a3' }); for (let i = 0; i < 5; i++) lflat(T, .06 + i * .085, .07, .1 + i * .085, .12, .61, '#8e889c'); lflat(T, .12, .15, .38, .19, .61, '#8e889c'); };
function drawSurface(it, def, HT, hdef, c, alpha, host) {
  const T = surfT(HT, hdef.top || hdef.hz, it, def), [ax, ay] = TP(T, T.sw / 2, T.sd / 2, 0), name = it.itemId.slice(5);
  if (alpha != null) X.globalAlpha = alpha;
  if (ART_S[name]) { ART_S[name](T, c, host); X.globalAlpha = 1; const a = TP(T, 0, T.sd, 0), b = TP(T, T.sw, 0, 0); return [Math.min(a[0], b[0]), ay - (def.hz || 8) - 2, Math.abs(b[0] - a[0]) || 6, (def.hz || 8) + 4]; }
  X.globalAlpha = 1;
  const b = spriteAt(def.spr, ax, ay + .5, T.fl, c.main, alpha);
  if (b && typeof SURF_FX !== 'undefined' && SURF_FX[name]) SURF_FX[name](b, c, it);
  if (def.spr === 'mug' && c.lit) for (let i = 0; i < 2; i++) { const p = (c.t * .45 + i * .5 + (it.cu || 0) * .13) % 1; R(Math.round(ax) - 1 + i * .75 + Math.round(Math.sin(p * 6 + i)) / 2, ay - 5.5 - p * 4, .5, .5, `rgba(235,235,245,${(.45 * (1 - p)).toFixed(2)})`); }
  if (def.spr === 'lamp_desk' && c.lit) { c.glows.push([[ax, ay - 5], 13, '255,204,130', .05 + .15 * c.n]); c.pools.push([[ax, ay + 2], 12, '255,204,130', .1 * c.n]); }
  return b;
}
// every surface item standing on host `h` (floor or wall host), back to front on the grid
function drawTops(items, h, HT, hdef, c, props) {
  const tops = items.filter(s => s.layer === 'surface' && s.onUid === h.uid && IDEF[s.itemId] && IDEF[s.itemId].fp).map(s => { const sd = IDEF[s.itemId], g = tp(HT, (s.cu + sd.fp[0] / 2) / CELL, (s.cv + sd.fp[1] / 2) / CELL); return { s, sd, k: g[0] + g[1] }; });
  tops.sort((a, b) => a.k - b.k);
  for (const { s, sd } of tops) { const b = drawSurface(s, sd, HT, hdef, c, s.ghost ? .75 : null, h); if (b) props.push([sd.label, ...b, s.uid]); }
}
