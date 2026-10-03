'use strict';
// ================= items v3 (docs/ITEMS_V3.json): 42 floor + 18 wall + 24 desk-top pieces, drawn in the same box language as the rest =================
// Light comes from the back-left; every front detail sits on the local +v face (it faces the viewer at rot 0 and 1, like all fronts).
const V3CAT = {}; // item id -> shop category
const V3_CATS = ['Furniture', 'Plants', 'Tech', 'Fun & games', 'Music', 'Pets', 'Wall', 'Desk-top', 'Rugs'];
const vfl = (id, label, size, rots, hz, cat, o) => { idef(id, { label, layer: 'floor', size, rots, hz, ...o }); V3CAT['room.' + id] = cat; };
const vwl = (id, label, size, row, cat, o) => { idef(id, { label, layer: 'wall', size, row, ...o }); V3CAT['room.' + id] = 'Wall'; };
const vsf = (id, label, o) => { idef(id, { label, layer: 'surface', rots: [0, 1], multi: false, shelf: true, spr: id, fp: [2, 2], hz: 9, ...o }); V3CAT['room.' + id] = 'Desk-top'; };
// filled pixel ellipse on whole art units (front-view drums, globes, cones)
function ell(cx, cy, rx, ry, col) { cx = Math.round(cx); cy = Math.round(cy); for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + .25)))); if (w > 0) R(cx - w, cy + y, w * 2, 1, col); } }
// half-unit painters for the framed wall art: one cell = half an art unit (a whole device pixel at 2x), f(dx, dy, r) -> colour | null over a disc or box
function half(x0, y0, w, h, f) { for (let j = 0; j < h * 2; j++) for (let i = 0; i < w * 2; i++) { const x = x0 + i / 2, y = y0 + j / 2, col = f(x + .25, y + .25); if (col) R(x, y, .5, .5, col); } }
const dot = (x, y, col, s) => R(Math.round(x), Math.round(y), s || 1, s || 1, col);
const STEEL = { t: '#b8bdc9', l: '#9aa0af', r: '#767c8c' }, DARK = { t: '#4a4858', l: '#34323f', r: '#26242f' }, CREAM = { t: '#f4efe6', l: '#e2dccf', r: '#c2bbad' };
const POT = { t: '#8a4f33', l: '#c4764f', r: '#a0603f' };
// ---- floor: plants ----
function potBox(T, u, v, w, z, h) { lbox(T, u, v, w, w, z, h, POT); lbox(T, u - .04, v - .04, w + .08, w + .08, z + h, 1, { t: '#2f2119', l: '#d68b62', r: '#b36e4c' }); }
ART.plant_fern = (T, c) => {
  potBox(T, .28, .28, .44, 0, 5);
  const [ax, ay] = TP(T, .5, .5, 6), sw = Math.sin(c.t * 1.2 + c.seed) * .7;
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2 + .4, dx = Math.cos(a), dy = Math.sin(a) * .5, H = 7 + (k % 3) * 1.5;
    for (let i = 1; i <= 8; i++) { const f = i / 8, x = ax + dx * i * 1.05 + sw * f * f * 1.6, y = ay - H * Math.sin(f * 1.3) + dy * i * 1.05 + f * f * 4.5; dot(x, y, LEAF[(k + i) % 3]); if (i > 2 && i < 8 && k % 2) dot(x + (dx > 0 ? 0 : -1), y + 1, LEAF[(k + i + 1) % 3]); } }
};
ART.cactus_tall = (T) => {
  potBox(T, .3, .3, .4, 0, 4);
  const g = { t: '#6bb57a', l: '#3d7a49', r: '#2d5e38' };
  lbox(T, .4, .4, .2, .2, 5, 18, g); lbox(T, .28, .42, .12, .16, 11, 2.4, g); lbox(T, .28, .42, .1, .16, 13, 6, g); lbox(T, .6, .42, .12, .16, 8, 2.4, g); lbox(T, .62, .42, .1, .16, 10, 5, g);
  lface(T, '+v', .6, .4, .6, 6, 22, '#5fa86b'); for (const [u, z] of [[.44, 8], [.52, 12], [.46, 16], [.54, 19], [.42, 21]]) lface(T, '+v', .6, u, u + .05, z, z + 1, '#e9e4c8');
  const [fx, fy] = TP(T, .5, .5, 23.5); R(fx - 1.5, fy - 1, 3, 2, '#f06595'); R(fx - .5, fy - 2, 1, 1, '#ffc2d9'); R(fx - .5, fy, 1, 1, '#ffd166');
};
ART.bonsai_big = (T, c) => {
  lbox(T, .2, .22, .6, .56, 0, 4, { t: '#5b6b7a', l: '#46535f', r: '#35404a' }); lbox(T, .16, .18, .68, .64, 4, 1, { t: '#2f2119', l: '#6a7988', r: '#525f6c' });
  const [ax, ay] = TP(T, .5, .5, 5), sw = Math.round(Math.sin(c.t * .9 + c.seed) * 2) / 4;
  R(ax - 1, ay - 6, 2, 6, '#6e4630'); R(ax - 3, ay - 9, 2, 4, '#6e4630'); R(ax + 1, ay - 8, 3, 2, '#6e4630'); R(ax - 1, ay - 6, .5, 6, '#8a5a3c');
  for (const [ox, oy, rx, ry, k] of [[-5, -13, 5, 3, 0], [4, -12, 5, 3, 1], [0, -17, 6, 4, 2], [-3, -10, 4, 2, 1], [6, -9, 3, 2, 0]]) { ell(ax + ox + sw * (oy / -17), ay + oy, rx, ry, LEAF[k]); ell(ax + ox - 1 + sw * (oy / -17), ay + oy - 1, rx * .6, ry * .55, k === 2 ? '#8ecf95' : LEAF[2]); }
};
// ---- floor: office appliances and storage ----
ART.fridge_mini = (T) => {
  lbox(T, .06, .06, .88, .88, 0, 16, CREAM); lface(T, '+v', .94, .08, .92, 9.5, 9.9, '#9a94a6'); lface(T, '+v', .94, .7, .78, 11, 15, '#8a8597'); lface(T, '+v', .94, .7, .78, 3, 7, '#8a8597');
  lface(T, '+v', .94, .18, .3, 12.5, 14, '#e0473c'); lface(T, '+v', .94, .34, .44, 5, 6.2, '#4f86c6'); lbox(T, .1, .94, .8, .04, 0, .8, '#3a3746');
};
ART.water_cooler = (T, c) => {
  lbox(T, .22, .22, .56, .56, 0, 15, CREAM); lface(T, '+v', .78, .28, .72, 9, 10, '#9a94a6'); lface(T, '+v', .78, .3, .42, 7, 8.4, '#4f9dea'); lface(T, '+v', .78, .58, .7, 7, 8.4, '#e0473c'); lface(T, '+v', .78, .3, .7, 2, 6, '#c9c2b3');
  lbox(T, .3, .3, .4, .4, 15, 1, '#c9c2b3'); lbox(T, .3, .3, .4, .4, 16, 12, { t: 'rgba(190,230,255,.75)', l: 'rgba(110,180,240,.7)', r: 'rgba(70,140,215,.72)', e: null });
  lbox(T, .4, .4, .2, .2, 28, 1.5, { t: '#cfe8ff', l: '#9cc9f0', r: '#6fa8dc' }); const [bx, by] = TP(T, .5, .5, 17);
  for (let i = 0; i < 3; i++) { const p = (c.t * .35 + i / 3) % 1; R(Math.round(bx + Math.sin(p * 9 + i) * 1.5 - .5), Math.round(by - p * 10), 1, 1, 'rgba(235,248,255,.85)'); }
  if (Math.floor(c.t * .5) % 4 === 0) { const p = (c.t * 2) % 1, [dx, dy] = TP(T, .36, .78, 7); R(dx, dy + 1 + p * 5, 1, 1, '#9fd4ff'); }
};
ART.vending = (T, c) => {
  lbox(T, .08, .1, .84, .8, 0, 30, { t: '#d8453c', l: '#b53730', r: '#8f2a25' });
  lface(T, '+v', .9, .14, .66, 7, 27, '#10131c'); const cols = ['#ffd23f', '#4fb3d9', '#e0473c', '#6bd66b', '#ff9a3c', '#c78bf0', '#f4efe6'];
  for (let s = 0; s < 4; s++) { lface(T, '+v', .9, .14, .66, 7 + s * 5, 7.6 + s * 5, '#8a8597'); for (let k = 0; k < 4; k++) lface(T, '+v', .9, .18 + k * .125, .26 + k * .125, 8.2 + s * 5, 11.6 + s * 5, cols[(s * 3 + k * 2) % 7]); }
  lface(T, '+v', .9, .72, .88, 14, 24, '#2d2a38'); for (let i = 0; i < 4; i++) lface(T, '+v', .9, .75, .85, 16 + i * 2, 17 + i * 2, '#9a94a6'); lface(T, '+v', .9, .74, .86, 22, 23.4, c.lit ? '#6bff9a' : '#2a5a3a');
  lface(T, '+v', .9, .16, .7, 1.5, 5.5, '#15141a'); lface(T, '+v', .9, .18, .68, 28, 29.2, c.lit ? '#fff2b0' : '#8a8260');
  if (c.lit) { c.glows.push([TP(T, .4, .95, 17), 20, '255,240,190', .05 + .07 * c.n]); c.pools.push([TP(T, .4, 1.45, 0), 18, '255,235,180', .06 + .08 * c.n]); }
};
ART.printer = (T, c) => {
  lbox(T, .08, .14, .84, .72, 0, 7, { t: '#8d96ad', l: '#6f7893', r: '#535b73' }); lbox(T, .1, .18, .8, .64, 7, 2.6, { t: '#dfe3ec', l: '#b8becd', r: '#939aac' });
  lface(T, '+v', .86, .16, .84, 3.4, 5, '#23212e'); lface(T, '+v', .82, .18, .4, 7.6, 9, '#3a3848'); lface(T, '+v', .82, .74, .82, 8, 8.8, c.lit && Math.floor(c.t * 2) % 2 ? '#6bff9a' : '#2a5a3a'); lface(T, '+v', .86, .16, .84, 1, 1.5, '#4a4f66');
  const cyc = c.t % 6, pg = cyc < 2 ? cyc / 2 : 0, [px, py] = TP(T, .5, .86, 3.4 - pg * 2.2); if (pg > 0 && pg < 1) { R(px - 3, py, 6, 1 + pg * 3.5, '#fbfaf6'); R(px - 2, py + 1, 3, .5, '#6b6577'); }
  if (cyc < .25) lflat(T, .14, .22, .86, .34, 9.7, 'rgba(180,230,255,.55)');
  const [tx, ty] = TP(T, .5, .86, 1.4); R(tx - 2.5, ty, 5, 1, '#e9e6f0'); R(tx - 2.5, ty + 1, 5, .5, '#9a96ab');
};
ART.filing_cabinet = (T) => {
  const g = { t: '#9aa3b2', l: '#7d8696', r: '#5e6676' }; lbox(T, .12, .12, .76, .76, 0, 15, g);
  for (let d = 0; d < 3; d++) { const z = 1 + d * 4.6; lface(T, '+v', .88, .16, .84, z, z + 4, '#8a93a4'); lface(T, '+v', .88, .36, .64, z + 2.4, z + 3.1, '#cfd5e0'); lface(T, '+v', .88, .4, .6, z + .9, z + 1.7, '#f4efe6'); }
};
ART.locker = (T) => {
  const g = { t: '#6fa8c9', l: '#4f86a8', r: '#3a6a88' }; lbox(T, .14, .14, .72, .72, 0, 28, g);
  lface(T, '+v', .86, .18, .82, 3, 27, '#5d97b9'); lface(T, '+v', .86, .49, .51, 3, 27, '#3a6a88'); for (let i = 0; i < 4; i++) { lface(T, '+v', .86, .22, .44, 22 + i * 1, 22.4 + i * 1, '#2f5a73'); lface(T, '+v', .86, .56, .78, 22 + i, 22.4 + i, '#2f5a73'); }
  lface(T, '+v', .86, .42, .46, 13, 15, '#d8dde6'); lface(T, '+v', .86, .54, .58, 13, 15, '#d8dde6'); lface(T, '+v', .86, .26, .38, 17, 19, '#f4efe6'); lface(T, '+v', .86, .6, .72, 17, 19, '#f4efe6'); lbox(T, .14, .86, .72, .03, 0, 2, '#2f5a73');
};
// ---- catalogue (mirrors ITEMS_V3.json; size, rots, multi and host tops are this file's reading of the contract, the server re-checks them) ----
const FLT = { flat: true, counts: false };
vfl('plant_fern', 'Fern', [1, 1], [0], 18, 'Plants', { multi: true }); vfl('cactus_tall', 'Tall cactus', [1, 1], [0], 26, 'Plants', { multi: true }); vfl('bonsai_big', 'Big bonsai', [1, 1], [0], 22, 'Plants');
vfl('fridge_mini', 'Mini fridge', [1, 1], [0, 1], 16, 'Furniture', { surf: [[0, 0, 4, 4]], top: 16 }); vfl('water_cooler', 'Water cooler', [1, 1], [0, 1], 30, 'Tech'); vfl('vending', 'Vending machine', [1, 1], [0, 1], 30, 'Tech');
vfl('printer', 'Printer', [1, 1], [0, 1], 14, 'Tech'); vfl('filing_cabinet', 'Filing cabinet', [1, 1], [0, 1], 15, 'Furniture', { multi: true, surf: [[0, 0, 4, 4]], top: 15 }); vfl('locker', 'Locker', [1, 1], [0, 1], 28, 'Furniture', { multi: true });
vfl('guitar_stand', 'Guitar on a stand', [1, 1], [0, 1], 24, 'Music'); vfl('drum_kit', 'Drum kit', [2, 2], [0, 1], 22, 'Music'); vfl('piano', 'Upright piano', [2, 1], [0, 1, 2, 3], 26, 'Music');
vfl('treadmill', 'Treadmill desk', [2, 1], [0, 1], 18, 'Fun & games'); vfl('punching_bag', 'Punching bag', [1, 1], [0], 30, 'Fun & games'); vfl('yoga_mat', 'Yoga mat', [2, 1], [0, 1], 1, 'Rugs', { ...FLT, multi: true });
vfl('pool_table', 'Pool table', [3, 2], [0, 1], 12, 'Fun & games'); vfl('foosball', 'Foosball table', [2, 1], [0, 1], 12, 'Fun & games'); vfl('ping_pong', 'Ping-pong table', [3, 2], [0, 1], 13, 'Fun & games');
vfl('hammock', 'Hammock', [2, 1], [0, 1], 22, 'Fun & games'); vfl('telescope', 'Telescope', [1, 1], [0, 1], 26, 'Fun & games'); vfl('globe', 'Floor globe', [1, 1], [0], 20, 'Fun & games', { multi: true }); vfl('easel', 'Painting easel', [1, 1], [0, 1], 30, 'Fun & games');
vfl('pet_cat', 'Cat', [1, 1], [0], 12, 'Pets'); vfl('pet_dog', 'Dog', [1, 1], [0], 13, 'Pets'); vfl('robot_vacuum', 'Robot vacuum', [1, 1], [0], 5, 'Tech');
vfl('fireplace', 'Fireplace', [2, 1], [0, 1], 30, 'Furniture'); vfl('xmas_tree', 'Christmas tree', [1, 1], [0], 36, 'Plants');
vfl('rug_persian', 'Persian rug', [3, 2], [0, 1], 1, 'Rugs', FLT); vfl('rug_hex', 'Hex rug', [2, 2], [0], 1, 'Rugs', { ...FLT, multi: true }); vfl('couch_l', 'L-shaped couch', [3, 2], [0, 1, 2, 3], 14, 'Furniture');
vfl('printer_3d', '3D printer', [1, 1], [0, 1], 18, 'Tech'); vfl('whiteboard_stand', 'Standing whiteboard', [1, 1], [0, 1], 30, 'Tech');
vfl('desk_gaming', 'Gaming desk', [3, 2], [0, 1], 18, 'Furniture', { counts: false, fixed: true, desk: true, top: 8.5, surf: [[0, 4, 12, 8]], seat: [1.5, .55], dflt: D_STD });
vfl('map_table', 'Map table', [2, 2], [0], 9, 'Furniture', { surf: [[0, 0, 8, 8]], top: 9 }); vfl('bench_lab', 'Lab bench', [2, 1], [0, 1], 12, 'Tech', { surf: [[0, 0, 8, 4]], top: 12 });
vfl('zen_sand', 'Zen sand garden', [2, 2], [0], 1, 'Plants', FLT); vfl('koi_pond', 'Koi pond', [2, 2], [0], 1, 'Plants', FLT);
vfl('speaker_tower', 'Speaker tower', [1, 1], [0, 1], 30, 'Music', { multi: true }); vfl('record_player', 'Record player cabinet', [1, 1], [0, 1], 12, 'Music', { surf: [[0, 0, 4, 2]], top: 12 });
vfl('arcade_racer', 'Racing arcade', [1, 2], [0, 1], 32, 'Fun & games'); vfl('bookshelf_tall', 'Tall bookshelf', [1, 2], [0, 1], 38, 'Furniture', { surf: [[0, 0, 4, 8]], top: 38 }); vfl('coat_rack', 'Coat rack', [1, 1], [0], 30, 'Furniture');
for (const k of ['plant_fern', 'cactus_tall', 'bonsai_big', 'xmas_tree', 'globe', 'punching_bag', 'water_cooler', 'locker', 'coat_rack', 'pet_cat', 'pet_dog', 'robot_vacuum']) ROUND_SH.add(k);
// ---- floor: music ----
ART.guitar_stand = (T, c) => {
  const [ax, ay] = TP(T, .5, .5, 0), fl = T.r % 2 === 1, s = fl ? -1 : 1;
  lbox(T, .3, .3, .4, .4, 0, 1, DARK); lbox(T, .47, .47, .06, .06, 1, 9, '#3a3746');
  R(ax - 4 * s - 1, ay - 3, 2, 3, '#3a3746'); R(ax + 4 * s - 1, ay - 3, 2, 3, '#3a3746');
  ell(ax, ay - 8, 5, 4, '#c98a3c'); ell(ax - 1 * s, ay - 9, 3, 2, '#e0a352'); ell(ax, ay - 14, 3.5, 3, '#c98a3c'); ell(ax - s, ay - 15, 2, 1, '#e0a352'); ell(ax, ay - 10, 1.5, 1.5, '#1a1420');
  R(ax - 2 * s - .5, ay - 6, 5, .5, '#6e4630'); R(ax - .5, ay - 25, 1.5, 11, '#4a3222'); R(ax - 1, ay - 28, 3, 4, '#3a2a1e'); dot(ax - 1, ay - 27, '#d9b98a'); dot(ax + 1, ay - 25, '#d9b98a');
  for (let k = 0; k < 4; k++) dot(ax, ay - 23 + k * 2.5, '#cfd5e0', .5);
};
ART.drum_kit = (T, c) => {
  const beat = Math.max(0, 1 - ((c.t * 2.4) % 1) * 3.2), [bx, by] = TP(T, 1, 1.15, 0);
  lflat(T, .1, .2, 1.9, 1.9, .05, 'rgba(60,50,80,.55)');
  const stick = (u, v, z, h, col) => lbox(T, u - .02, v - .02, .04, .04, z, h, col || '#8a90a6');
  stick(.3, .4, 0, 17); stick(1.72, .4, 0, 13); stick(1.65, 1.55, 0, 13, '#8a90a6'); // crash, ride, hi-hat stands
  for (const [u, v, z, r] of [[.3, .4, 17, .32], [1.72, .4, 13.5, .36]]) { lpoly(T, circ(u, v, r, 14), z, '#9a7a1f'); lpoly(T, circ(u - .03, v - .03, r * .8, 12), z + .4, '#e8c14a'); }
  lpoly(T, circ(1.65, 1.55, .26, 12), 13.4, '#9a7a1f'); lpoly(T, circ(1.65, 1.55, .22, 12), 13.9 + beat * .5, '#e8c14a');
  const tom = (u, v, z, r, h) => { lbox(T, u - r, v - r, r * 2, r * 2, z, h, { t: '#f4efe6', l: '#b53730', r: '#8f2a25' }); };
  tom(.72, .55, 12, .26, 4); tom(1.3, .55, 12, .26, 4); tom(1.75, 1.0, 5, .3, 6);
  lbox(T, .55, .75, .9, .7, 0, 10, { t: '#f4efe6', l: '#c2413a', r: '#8f2a25' }); // kick drum
  lbox(T, .9, 1.4, .2, .04, 2, 6, '#d9d4e2'); ell(bx, by - 5, 5, 5, '#f4efe6'); ell(bx, by - 5, 3, 3, '#e8e2d4'); dot(bx - .5, by - 5.5, '#c2413a', 1);
  lbox(T, .22, 1.3, .42, .42, 6, 1.2, { t: '#f4efe6', l: '#d9d4e2', r: '#a9a3b8' }); lbox(T, .28, 1.36, .3, .3, 0, 6, '#8a90a6'); // snare
  lpoly(T, circ(1, 1.72, .22, 12), 7, '#2b2833'); lpoly(T, circ(1, 1.72, .18, 12), 8.4, '#c2413a'); stick(1, 1.72, 0, 7, '#3d3a48');
  for (const [u, v] of [[.72, .55], [1.3, .55]]) { const [tx, ty] = TP(T, u, v, 16.5); R(tx - 1, ty - 1, 2, 1, '#cfd5e0'); }
  if (beat > .02) { const [hx, hy] = TP(T, .72, .55, 16.4); R(hx + 3, hy - 3 - beat * 3, 1, 1, `rgba(255,255,255,${beat.toFixed(2)})`); }
};
const PIANO = { t: '#3d2f3a', l: '#2a1f27', r: '#1d151b' };
ART.piano = (T, c) => {
  // the body stands on the back half (low v); the keyboard, the legs and the music desk are on the +v side. Painter's order: seen from the front (rot 0/1) the body goes
  // first and the keys over it; seen from behind (rot 2/3) the keys are on the far side, so they go first and the body hides them.
  const body = () => { lbox(T, .04, .06, 1.92, .5, 0, 27, PIANO); lface(T, '+v', .56, .12, 1.88, 14, 26, '#241a20'); lface(T, '+v', .56, .3, 1.7, 17, 24, '#352830'); lface(T, '+v', .56, .5, 1.5, 22, 23, '#e8c14a'); };
  const keys = () => {
    lbox(T, .04, .56, 1.92, .34, 10.6, 1.8, { t: '#2d222a', l: '#241a20', r: '#1d151b' });
    lflat(T, .1, .58, 1.9, .88, 12.6, '#f4efe6'); for (let i = 0; i < 14; i++) { lflat(T, .1 + i * .1286, .58, .1 + i * .1286 + .012, .88, 12.62, '#b9b2a6'); if (![2, 6, 9, 13].includes(i)) lbox(T, .1 + i * .1286 + .09, .58, .07, .18, 12.6, .9, '#15141a'); }
    lbox(T, .08, .56, .1, .34, 0, 10.6, '#3d2f3a'); lbox(T, 1.82, .56, .1, .34, 0, 10.6, '#3d2f3a'); lbox(T, .9, .62, .2, .2, 0, 1, '#e8c14a');
  };
  const stand = () => { lbox(T, .5, .54, .8, .05, 14, 2.8, '#f4efe6'); lface(T, '+v', .59, .58, 1.3, 15, 15.4, '#8a8597'); lface(T, '+v', .59, .58, 1.1, 16.4, 16.8, '#8a8597'); };
  if (T.r > 1) { keys(); body(); } else { body(); keys(); stand(); }
};
// ---- floor: fitness ----
ART.treadmill = (T, c) => {
  lbox(T, .04, .2, 1.92, .6, 0, 3, { t: '#6a677e', l: '#4d4a5e', r: '#3a3848' }); lflat(T, .12, .26, 1.9, .74, 3.05, '#3a3848'); const off = (c.t * .9) % .3;
  for (let x = .12 + off; x < 1.88; x += .3) lflat(T, x, .26, x + .05, .74, 3.1, '#6e6b84'); lbox(T, .04, .2, .08, .6, 3, 1.2, '#15141a'); lbox(T, 1.88, .2, .08, .6, 3, 1.2, '#15141a');
  lbox(T, .1, .24, .05, .05, 3, 14, '#8a90a6'); lbox(T, .1, .7, .05, .05, 3, 14, '#8a90a6'); lbox(T, .08, .2, .3, .6, 16.4, 1.4, { t: '#e8e2d4', l: '#c9c2b3', r: '#a39c8c' });
  lbox(T, .1, .24, .7, .04, 12, .8, '#8a90a6'); lbox(T, .1, .7, .7, .04, 12, .8, '#8a90a6'); lface(T, '+v', .8, .14, .36, 17.8, 18.2, '#8a8597');
  const [dx, dy] = TP(T, .23, .8, 17.2); R(dx - 1, dy - 1.5, 3, 1.4, '#10131c'); dot(dx - .5 + Math.floor(c.t * 2) % 2, dy - 1, '#6bff9a', .5);
};
ART.punching_bag = (T, c) => {
  lbox(T, .22, .22, .56, .56, 0, 1.6, DARK); lbox(T, .46, .46, .08, .08, 1.6, 27, '#8a90a6'); lbox(T, .46, .46, .08, .52, 28, 1.6, '#8a90a6');
  const amp = 2.2 * Math.exp(-(c.t % 9) * .55) + .35, sw = Math.sin(c.t * 2.3) * amp, [ax, ay] = TP(T, .5, .94, 28);
  R(Math.round(ax + sw * .15), ay + 1, 1, 3, '#cfd5e0'); const bx = Math.round(ax + sw), by = Math.round(ay + 4);
  R(bx - 3, by, 6, 13, '#c2413a'); R(bx - 2, by - 1, 4, 1, '#c2413a'); R(bx - 3, by, 1, 13, '#e0605a'); R(bx + 2, by, 1, 13, '#8f2a25'); R(bx - 3, by + 4, 6, 1, '#8f2a25'); R(bx - 2, by + 13, 4, 1, '#8f2a25'); R(bx - 1, by + 6, 2, 3, '#f4efe6');
};
ART.yoga_mat = (T) => {
  lflat(T, .04, .08, 1.96, .92, 0, '#2d8a86'); lflat(T, .08, .14, 1.92, .86, 0, '#3fa7a0'); for (let i = 0; i < 6; i++) lflat(T, .2 + i * .28, .14, .22 + i * .28, .86, 0, '#4fbfb8');
  lbox(T, 1.72, .08, .2, .84, 0, 1.8, { t: '#5fd0c8', l: '#3fa7a0', r: '#2d8a86' }); lflat(T, 1.74, .3, 1.9, .34, 1.85, '#2d8a86');
};
// ---- floor: games ----
const WOODR = { t: '#8a5a3c', l: '#6e4630', r: '#553520' };
ART.pool_table = (T, c) => {
  const legs = () => { for (const [u, v] of [[.12, .12], [2.68, .12], [.12, 1.68], [2.68, 1.68]]) lbox(T, u, v, .2, .2, 0, 6, { t: '#5e3d27', l: '#6e4630', r: '#46301f' }); };
  legs(); lbox(T, .06, .06, 2.88, 1.88, 6, 3, { t: '#2f8f5a', l: '#6e4630', r: '#553520' });
  lflat(T, .22, .22, 2.78, 1.78, 9.05, '#2f8f5a'); lflat(T, .22, .22, 2.78, .26, 9.1, '#3aa468'); lflat(T, .22, .22, .26, 1.78, 9.1, '#3aa468');
  lbox(T, 0, 0, 3, .22, 9, 2.2, WOODR); lbox(T, 0, 0, .22, 2, 9, 2.2, WOODR);
  const ball = (u, v, col) => { const [x, y] = TP(T, u, v, 9.2); R(Math.round(x) - .5, Math.round(y) - 1.5, 1.5, 1.5, col); R(Math.round(x) - .5, Math.round(y) - 1.5, .5, .5, 'rgba(255,255,255,.7)'); };
  const cols = ['#e0473c', '#ffd23f', '#4f86c6', '#15141a', '#ff9a3c', '#6bd66b', '#9b5de5', '#c2413a', '#ffd23f', '#4f86c6']; let k = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) ball(2.0 + i * .13, .98 - i * .07 + j * .14, cols[k++]);
  ball(.85, .98, '#f4efe6'); lbox(T, .3, 1.42, 1.1, .04, 9.3, .6, '#d9b98a'); lbox(T, .3, 1.42, .2, .04, 9.3, .6, '#6e4630');
  lbox(T, 0, 1.78, 3, .22, 9, 2.2, WOODR); lbox(T, 2.78, 0, .22, 2, 9, 2.2, WOODR);
  for (const [u, v] of [[0, 0], [2.74, 0], [0, 1.74], [2.74, 1.74], [1.36, 0], [1.36, 1.8]]) lflat(T, u + .02, v + .02, u + .24, v + .24, 11.25, '#15141a');
  lface(T, '+v', 2, .3, 2.7, 6.6, 7.8, '#5e3d27');
};
ART.foosball = (T, c) => {
  for (const [u, v] of [[.12, .14], [1.76, .14], [.12, .72], [1.76, .72]]) lbox(T, u, v, .12, .12, 0, 6, '#3a3746');
  lbox(T, .06, .08, 1.88, .84, 5, 5, { t: '#2f8f5a', l: '#8a5a3c', r: '#6e4630' }); lflat(T, .16, .18, 1.84, .82, 10.05, '#3aa468'); lflat(T, .98, .18, 1.0, .82, 10.1, '#e9e4dc');
  lbox(T, .06, .08, 1.88, .1, 10, 1.6, WOODR); lbox(T, .06, .08, .1, .84, 10, 1.6, WOODR); lbox(T, 1.84, .08, .1, .84, 10, 1.6, WOODR);
  for (let i = 0; i < 6; i++) { const u = .3 + i * .28, col = i % 2 ? '#e0473c' : '#4f86c6'; lbox(T, u - .02, .02, .04, .96, 12, .5, '#cfd5e0'); for (const v of [.3, .5, .7]) lbox(T, u - .05, v - .04, .1, .08, 9.6, 3, col); lbox(T, u - .04, .9, .08, .1, 11.6, 1.2, '#15141a'); }
  lbox(T, .06, .82, 1.88, .1, 10, 1.6, WOODR); lface(T, '+v', .92, .1, 1.9, 6, 9, '#5e3d27');
  const [bx, by] = TP(T, .98 + Math.sin(c.t * .9) * .45, .5, 10.3); dot(bx, by - 1, '#f4efe6', 1);
};
ART.ping_pong = (T, c) => {
  for (const [u, v] of [[.2, .3], [2.7, .3], [.2, 1.6], [2.7, 1.6]]) lbox(T, u, v, .1, .1, 0, 11.6, '#8a90a6');
  lbox(T, .06, .1, 2.88, 1.8, 11.6, 1.4, { t: '#2f6fb5', l: '#245a94', r: '#1a4570' });
  lflat(T, .12, .16, 2.88, .2, 13.05, '#f4efe6'); lflat(T, .12, 1.8, 2.88, 1.84, 13.05, '#f4efe6'); lflat(T, .12, .16, .16, 1.84, 13.05, '#f4efe6'); lflat(T, 2.84, .16, 2.88, 1.84, 13.05, '#f4efe6'); lflat(T, .12, .98, 2.88, 1.02, 13.05, '#e9e4dc');
  lbox(T, 1.46, .02, .08, .08, 13, 3, '#8a90a6'); lbox(T, 1.46, 1.9, .08, .08, 13, 3, '#8a90a6');
  lbox(T, 1.48, .1, .04, 1.8, 13, 2.6, { t: '#f4efe6', l: 'rgba(240,240,240,.42)', r: 'rgba(200,200,210,.4)', e: null });
  lbox(T, .4, 1.5, .16, .02, 13.1, .9, '#c2413a'); lbox(T, .42, 1.4, .05, .22, 13.05, .7, '#d9b98a');
  const bt = (c.t * .8) % 2, bu = bt < 1 ? .4 + bt * 2.2 : 2.6 - (bt - 1) * 2.2, bz = 13.4 + Math.abs(Math.sin(bt * Math.PI)) * 4, [bx, by] = TP(T, bu, .7 + Math.sin(c.t) * .1, bz); dot(bx, by - 1, '#fff6e0', 1);
};
ART.hammock = (T, c) => {
  for (const u of [.12, 1.88]) { lbox(T, u - .05, .42, .1, .16, 0, 1, DARK); lbox(T, u - .03, .47, .06, .06, 1, 21, '#6e4630'); }
  const sw = Math.sin(c.t * .8) * 1.3, N = 18, col = ['#d9b98a', '#5fa86b', '#d9b98a', '#e0a13a'];
  for (let i = 0; i <= N; i++) { const f = i / N, u = .15 + f * 1.7, z = 19 - 9 * Math.sin(f * Math.PI) ** .8, [x, y] = TP(T, u, .5, z), d = sw * Math.sin(f * Math.PI); R(Math.round(x + d) - .5, Math.round(y), 1, 4, col[Math.floor(i / 2) % 4]); R(Math.round(x + d) - .5, Math.round(y) + 4, 1, 1, '#8a5a3c'); }
  const [px, py] = TP(T, .55, .5, 12.2); ell(px + sw * .7, py, 3, 1.4, '#f4efe6');
};
ART.telescope = (T, c) => {
  const [ax, ay] = TP(T, .5, .5, 0), s = T.r % 2 ? -1 : 1;
  for (const [dx, dy] of [[-5, 0], [5, 1], [0, -2]]) for (let i = 0; i < 13; i++) R(ax + (dx * (1 - i / 13)) * s - .5, ay + dy * (1 - i / 13) - 2 - i * .95 - (dy < 0 ? 0 : 0), 1, 1, dy < 0 ? '#3a3746' : '#6e4630');
  R(ax - 2, ay - 15, 4, 2, '#8a90a6');
  for (let i = 0; i < 16; i++) { const x = ax + (-7 + i * .95) * s, y = ay - 13 - i * .95; R(Math.round(x) - 1, Math.round(y) - 1, 3, 3, i < 4 ? '#c9a23a' : i < 12 ? '#f4efe6' : '#e2dccf'); R(Math.round(x) - 1, Math.round(y) + 1, 3, 1, 'rgba(0,0,0,.18)'); }
  R(ax + 7 * s - 2, ay - 29 + 1, 3, 3, '#c9a23a'); dot(ax - 7 * s - 1.5, ay - 12, '#c9a23a', 2);
};
ART.globe = (T, c) => {
  const [ax, ay] = TP(T, .5, .5, 0), sp = Math.floor(c.t * .8);
  lbox(T, .3, .3, .4, .4, 0, 1.4, WOODR); lbox(T, .47, .47, .06, .06, 1.4, 6, '#8a5a3c');
  ell(ax, ay - 14, 7, 7, '#2f6fb5'); ell(ax - 1, ay - 15, 5, 5, '#3f86d0'); ell(ax - 2, ay - 17, 2, 2, '#7cb7ee');
  for (const [dx, dy, w, h] of [[-3, -14, 3, 2], [0, -17, 3, 2], [1, -13, 2, 4], [-4, -10, 2, 2], [3, -10, 2, 2]]) R(ax + dx + (sp % 3) * 0, ay + dy, w, h, '#5fa86b');
  R(ax + 6, ay - 18, .5, 12, '#c9a23a'); R(ax - 7, ay - 11, 1, 6, '#c9a23a'); R(ax - 6, ay - 7, 1, 1, '#c9a23a');
};
ART.easel = (T, c) => {
  lbox(T, .2, .74, .06, .06, 0, 27, '#8a5a3c'); lbox(T, .74, .74, .06, .06, 0, 27, '#8a5a3c'); lbox(T, .47, .2, .06, .06, 0, 28, '#6e4630');
  lbox(T, .22, .73, .56, .05, 9.4, 1, '#6e4630'); lbox(T, .18, .76, .64, .04, 11, 15, { t: '#f4efe6', l: '#f4efe6', r: '#d9d4e2', e: null });
  lface(T, '+v', .8, .21, .79, 12, 25.5, '#8fc8ee'); lface(T, '+v', .8, .21, .79, 12, 17, '#5fa86b'); lface(T, '+v', .8, .22, .46, 12, 15, '#3d7a49'); lface(T, '+v', .8, .62, .7, 21, 23.6, '#ffd23f'); lface(T, '+v', .8, .3, .56, 19, 20.4, '#ffffff'); lface(T, '+v', .8, .5, .7, 15, 16, '#e0473c');
  lbox(T, .5, .84, .3, .12, 6, .8, '#d9b98a'); for (const [u, col] of [[.54, '#e0473c'], [.62, '#ffd23f'], [.7, '#4f86c6']]) lbox(T, u, .88, .05, .05, 6.8, .8, col);
};
// ---- floor: pets and small machines ----
// a pet wanders a little inside its own tile now and then: { du (offset along u), walking, dir (+1 / -1) }
function wander(c, period, span, dur) { const ph = (c.t + c.seed * 3.7) % period, f = (ph - (period - dur)) / dur; if (f < 0 || f > 1) return { du: 0, walking: false, dir: 1, f: 0 }; return { du: span * Math.sin(f * Math.PI * 2), walking: true, dir: Math.cos(f * Math.PI * 2) >= 0 ? 1 : -1, f }; }
ART.pet_cat = (T, c) => {
  const w = wander(c, 22, .28, 3.6), [ax0, ay] = TP(T, .5 + w.du, .5, 0), ax = Math.round(ax0), base = '#e08a3c', lite = '#f2b163', dk = '#a8581f', s = w.dir;
  softShadow(ax, ay + .5, 6, 1.4, .3); const blink = (c.t * .7 + c.seed) % 4 > 3.8;
  if (w.walking) { const k = Math.floor(c.t * 7) % 2;
    R(ax - 5 * s - (s > 0 ? 0 : 1), ay - 10 + (k ? 0 : 1), 1, 6, dk); R(ax - 5 * s - (s > 0 ? 0 : 1), ay - 11, 1, 1, lite);
    ell(ax, ay - 6, 5, 2.5, base); R(ax - 3, ay - 8, 6, 1, lite); for (const x of [-2, 1]) R(ax + x, ay - 7, 1, 2, dk);
    for (const [dx, p] of [[-4, 0], [-2, 1], [2, 1], [4, 0]]) R(ax + dx * s - (dx * s < 0 ? 1 : 0) + (p === k ? 1 : 0) * s, ay - 3, 1.5, 3, p ? base : dk);
    ell(ax + 5 * s, ay - 8, 3, 2.5, base); R(ax + 4 * s - (s > 0 ? 0 : 1), ay - 11, 1.5, 2, base); R(ax + 6 * s - (s > 0 ? 0 : 1), ay - 11, 1.5, 2, base); dot(ax + 6 * s, ay - 9, '#2b2833'); dot(ax + 7 * s - (s > 0 ? 0 : 1), ay - 8, '#f4a6c0');
  } else {
    const tw = Math.sin(c.t * 2.2 + c.seed) * 1.2 + (Math.floor(c.t * .4) % 3 === 0 ? Math.sin(c.t * 9) * .8 : 0);
    for (let i = 0; i < 7; i++) dot(ax + 4 + Math.sin(i * .5) * 1.2 + (i > 3 ? tw * (i - 3) / 3 : 0), ay - 1 - i, i > 5 ? dk : base, 1.5);
    ell(ax, ay - 5, 4, 4.5, base); ell(ax, ay - 4, 2, 3, '#f4efe6'); R(ax - 1, ay - 8, .5, 2, dk); R(ax + 1, ay - 8, .5, 2, dk); R(ax - 3, ay - 1, 2, 1, lite); R(ax + 1, ay - 1, 2, 1, lite);
    ell(ax, ay - 11, 4, 3.2, base); R(ax - 4, ay - 15, 2, 3, base); R(ax + 2, ay - 15, 2, 3, base); dot(ax - 3.5, ay - 14, '#f4a6c0'); dot(ax + 2.5, ay - 14, '#f4a6c0');
    if (blink) { R(ax - 2, ay - 11, 2, .5, '#2b2833'); R(ax + 1, ay - 11, 2, .5, '#2b2833'); } else { R(ax - 2, ay - 12, 1, 2, '#2b2833'); R(ax + 1, ay - 12, 1, 2, '#2b2833'); dot(ax - 2, ay - 12, '#9be7a6', .5); dot(ax + 1, ay - 12, '#9be7a6', .5); }
    dot(ax - .5, ay - 10, '#f4a6c0', 1); for (const y of [-14, -13]) R(ax - 1, ay + y, 2, .5, dk);
  }
};
ART.pet_dog = (T, c) => {
  const w = wander(c, 26, .26, 3.2), [ax0, ay] = TP(T, .5 + w.du, .5, 0), ax = Math.round(ax0), base = '#b8794a', lite = '#e8cda3', dk = '#6e4630', s = w.dir;
  softShadow(ax, ay + .5, 6.5, 1.5, .3); const wag = Math.sin(c.t * 14 + c.seed) * 1.4;
  if (w.walking) { const k = Math.floor(c.t * 7) % 2;
    R(ax - 6 * s - (s > 0 ? 0 : 1) + wag * .4, ay - 10, 1.5, 4, base); ell(ax, ay - 7, 5.5, 3, base); ell(ax, ay - 5.5, 3, 1.5, lite);
    for (const [dx, p] of [[-4, 0], [-2, 1], [2, 1], [4, 0]]) R(ax + dx * s - (dx * s < 0 ? 1 : 0) + (p === k ? 1 : 0) * s, ay - 4, 1.5, 4, p ? base : dk);
    ell(ax + 6 * s, ay - 9, 3.2, 2.6, base); R(ax + 8 * s - (s > 0 ? 0 : 2), ay - 8, 2, 2, lite); dot(ax + 9 * s - (s > 0 ? 0 : 1), ay - 8, '#15141a'); dot(ax + 6 * s, ay - 10, '#15141a'); R(ax + 4 * s - (s > 0 ? 0 : 1.5), ay - 12, 1.5, 4, dk);
  } else {
    for (let i = 0; i < 5; i++) dot(ax + 4 + i * .6 + (i > 1 ? wag * (i - 1) / 4 : 0), ay - 1 - i * .9, base, 1.5);
    ell(ax, ay - 6, 4.5, 6, base); ell(ax, ay - 5, 2.5, 4, lite); R(ax - 3, ay - 1, 2, 1, lite); R(ax + 1, ay - 1, 2, 1, lite);
    ell(ax, ay - 13, 4.2, 3.5, base); R(ax - 6, ay - 15, 2, 6, dk); R(ax + 4, ay - 15, 2, 6, dk); ell(ax, ay - 11, 2.5, 2, lite);
    dot(ax - 2, ay - 14, '#15141a'); dot(ax + 1.5, ay - 14, '#15141a'); R(ax - 1, ay - 12, 2, 1, '#15141a'); if (Math.floor(c.t * 2.5) % 3 === 0) R(ax - .5, ay - 10, 1.5, 2, '#f08aa0');
  }
};
ART.robot_vacuum = (T, c) => {
  const a = c.t * .55 + c.seed, cu = .5 + .2 * Math.cos(a), cv = .5 + .2 * Math.sin(a * 1.3 + 1);
  lpoly(T, circ(cu + .03, cv + .03, .3, 16), 0, 'rgba(0,0,0,.25)');
  for (let z = 0; z < 4; z++) lpoly(T, circ(cu, cv, .28, 16), z, z === 3 ? '#4a4858' : '#2b2833'); lpoly(T, circ(cu, cv, .28, 16), 4, '#5a5870'); lpoly(T, circ(cu - .03, cv - .03, .22, 14), 4, '#6a6882'); lpoly(T, circ(cu, cv, .09, 10), 4.4, '#9a97b0');
  const [lx, ly] = TP(T, cu + .12, cv + .12, 4.6); R(lx, ly - .5, 1, 1, Math.floor(c.t * 2) % 2 ? '#6bff9a' : '#2a5a3a');
};
ART.fireplace = (T, c) => {
  const stone = { t: '#a09a92', l: '#847e76', r: '#66615a' }, fl = Math.sin(c.t * 9) * .5 + Math.sin(c.t * 5.3 + 1) * .5;
  lbox(T, .02, .05, 1.96, .6, 0, 27, stone); lbox(T, 0, .02, 2, .7, 26, 2.4, { t: '#a8744a', l: '#8a5a3c', r: '#6e4630' }); lbox(T, .02, .65, 1.96, .3, 0, 1.6, { t: '#c9c2b8', l: '#9a948a', r: '#7d776f' });
  for (let r = 0; r < 5; r++) for (let k = 0; k < 6; k++) { const a = .05 + k * .33 + (r % 2) * .16; lface(T, '+v', .65, a, Math.min(1.95, a + .3), 4 + r * 4, 4.4 + r * 4, 'rgba(0,0,0,.18)'); }
  lface(T, '+v', .65, .5, 1.5, 1.6, 15, '#c9c2b8'); lface(T, '+v', .66, .56, 1.44, 2, 14, c.lit ? '#2a120a' : '#15100c');
  const [fx, fy] = TP(T, 1, .58, 2.5); lbox(T, .62, .4, .76, .14, 2, 1.4, '#4a3222'); lbox(T, .7, .5, .6, .12, 3.2, 1.4, '#5e3d27');
  if (c.lit) {
    const fr = [[-4, 6 + fl * 1.5, '#e0473c', 5], [1, 8 + fl * -1.2, '#e0473c', 5], [-1.5, 9.5 + fl, '#ff9a3c', 4], [-3, 5, '#ffd23f', 3], [2.5, 5.5, '#ffd23f', 3]];
    for (const [ox, h, col, w] of fr) { const wob = Math.sin(c.t * 11 + ox * 3) * .7; poly([[fx + ox - w / 2, fy + 1], [fx + ox + w / 2, fy + 1], [fx + ox + wob, fy - h]], col); }
    for (let i = 0; i < 3; i++) { const p = (c.t * .7 + i * .33) % 1; R(Math.round(fx - 3 + i * 3 + Math.sin(p * 8 + i) * 1.5), Math.round(fy - 6 - p * 10), 1, 1, 'rgba(255,190,90,' + (1 - p).toFixed(2) + ')'); }
    const q = .10 + .05 * fl; c.glows.push([[fx, fy - 4], 22, '255,150,70', q + .05 * c.n]); c.pools.push([TP(T, 1, 1.7, 0), 26, '255,150,70', .06 + q + .08 * c.n]);
  }
};
ART.xmas_tree = (T, c) => {
  const [ax, ay] = TP(T, .5, .5, 0), tiers = [[18, 15, 8], [11, 12, 6.5], [4, 9, 5]];
  lbox(T, .44, .44, .12, .12, 0, 4, '#6e4630'); const G = ['#2f7a45', '#3d9a5a', '#266a3b'];
  for (const [y0, h, w] of tiers) for (let j = 0; j < h; j++) { const ww = Math.round(w * (j + 1) / h * 2); R(ax - ww / 2, ay - y0 - h + j + 3, ww, 1, G[(j + (j > h / 2 ? 1 : 0)) % 3]); }
  R(ax - 1, ay - 37, 2, 2, '#ffd23f'); R(ax - 2, ay - 36, 4, .5, '#ffd23f'); R(ax - .5, ay - 38, 1, 4, '#fff1a8');
  const pts = [[-3, 28], [2, 25], [-1, 22], [4, 18], [-5, 18], [0, 14], [-3, 10], [5, 9], [2, 6]], cols = ['#ff4040', '#ffd23f', '#4fb3ff', '#ff9a3c', '#c78bf0'];
  pts.forEach(([ox, oy], i) => { const on = c.lit ? (Math.floor(c.t * 2.2 + i * 1.7) % 3 !== 0) : false; R(ax + ox, ay - oy - 2, 1.2, 1.2, on ? cols[i % 5] : '#3a3746'); if (on) c.glows.push([[ax + ox, ay - oy - 2], 5, hexToRgb(cols[i % 5]), .04]); });
  lbox(T, .04, .62, .3, .3, 0, 4.4, { t: '#e0473c', l: '#c2413a', r: '#8f2a25' }); lface(T, '+v', .92, .17, .2, 0, 4.4, '#ffd23f'); lbox(T, .66, .66, .28, .26, 0, 3.2, { t: '#4f86c6', l: '#3a6aa3', r: '#2b4f7a' }); lface(T, '+v', .92, .78, .81, 0, 3.2, '#f4efe6');
};
// ---- floor: rugs, sofas, workshop ----
ART.rug_persian = (T) => {
  const L = T.sw, D = T.sd;
  rugBands(T, .125, 0, L - .125, D, [[.125, '#2a1520'], [.125, '#e6d3a8'], [.125, '#8e2f2a'], [.125, '#e6d3a8'], [.25, '#1f3a5a'], [.125, '#c2413a']]);
  rugFringe(T, .0625, 0, D, '#efe4c4'); rugFringe(T, L - .0625, 0, D, '#efe4c4');
  const cu = L / 2, cv = D / 2;
  lpoly(T, [[cu, cv - .42], [cu + .95, cv], [cu, cv + .42], [cu - .95, cv]], 0, '#e0a13a'); lpoly(T, [[cu, cv - .3], [cu + .7, cv], [cu, cv + .3], [cu - .7, cv]], 0, '#8e2f2a');
  lpoly(T, [[cu, cv - .18], [cu + .4, cv], [cu, cv + .18], [cu - .4, cv]], 0, '#1f3a5a'); lpoly(T, [[cu, cv - .08], [cu + .16, cv], [cu, cv + .08], [cu - .16, cv]], 0, '#e6d3a8');
  for (const k of [-1, 1]) for (const d of [.55, 1.05]) lpoly(T, [[cu + k * d, cv - .1], [cu + k * (d + .1), cv], [cu + k * d, cv + .1], [cu + k * (d - .1), cv]], 0, '#e6d3a8');
};
const hexPts = (cu, cv, rx, ry) => [[cu - rx / 2, cv - ry], [cu + rx / 2, cv - ry], [cu + rx, cv], [cu + rx / 2, cv + ry], [cu - rx / 2, cv + ry], [cu - rx, cv]];
ART.rug_hex = (T) => {
  const cu = T.sw / 2, cv = T.sd / 2;
  for (const [f, col] of [[1, '#1f4f55'], [.9, '#e6dcc2'], [.82, '#2d6a6a'], [.6, '#e6dcc2'], [.54, '#3f8a86']]) lpoly(T, hexPts(cu, cv, .96 * f, .96 * f), 0, col);
  for (const [du, dv] of [[0, 0], [.4, .23], [-.4, .23], [.4, -.23], [-.4, -.23], [0, .46], [0, -.46]]) lpoly(T, hexPts(cu + du, cv + dv, .15, .15), 0, du === 0 && dv === 0 ? '#e0a13a' : '#2d6a6a');
};
ART.couch_l = (T) => {
  const f = fab('#5a7f8a', .95), cu = fab('#7aa3ae'), bk = fab('#6a94a0');
  drawBoxes(T, [[.08, .1, .1, .1, 0, 1.2, INKY], [2.82, .1, .1, .1, 0, 1.2, INKY], [.08, .84, .1, .1, 0, 1.2, INKY], [2.82, 1.84, .1, .1, 0, 1.2, INKY], [2.1, 1.84, .1, .1, 0, 1.2, INKY], [2.1, .84, .1, .1, 0, 1.2, INKY]]);
  drawBoxes(T, [[0, .05, 3, .95, 1.2, 3.6, f], [2, 1, 1, 1, 1.2, 3.6, f], [0, .05, 3, .3, 4.8, 6.6, bk], [0, .35, .26, .65, 4.8, 3.4, f], [2.74, .35, .26, 1.65, 4.8, 3.4, f],
    [.26, .35, .87, .65, 4.8, 1.8, cu], [1.13, .35, .87, .65, 4.8, 1.8, cu], [2, .35, .74, 1.65, 4.8, 1.8, cu]]);
  lface(T, '+v', .35, .3, 1.1, 8.4, 10.8, shade('#6a94a0', 1.08)); lface(T, '+v', .35, 1.14, 1.96, 8.4, 10.8, shade('#6a94a0', 1.08)); lface(T, '+v', .35, 2.04, 2.7, 8.4, 10.8, shade('#6a94a0', 1.08));
  lface(T, '+v', 1, .28, 1.98, 2.6, 3, shade('#5a7f8a', .75)); lface(T, '+v', 2, 2.02, 2.72, 2.6, 3, shade('#5a7f8a', .75));
  lbox(T, 2.2, 1.45, .4, .35, 6.6, 2.2, { t: '#e0a13a', l: '#c98a3c', r: '#a8702a' });
};
ART.printer_3d = (T, c) => {
  lbox(T, .12, .12, .76, .76, 0, 2, DARK); const gh = 1 + ((c.t * .45) % 1) * 9, hu = .5 + .22 * Math.sin(c.t * 2.6), fv = .5 + .18 * Math.sin(c.t * 1.7 + 1);
  lbox(T, .24, .24, .52, .52, 2, .8, '#3a3746'); lbox(T, .4, .4, .2, .2, 2.8, gh, { t: '#ffb066', l: '#ff9a3c', r: '#c97a2a' });
  lbox(T, .12, fv - .03, .76, .06, 3.6 + gh + 1, 1.2, '#8a90a6'); lbox(T, hu - .07, fv - .07, .14, .14, 3.2 + gh + .2, 2.4, '#e0473c'); lbox(T, .4, .22, .2, .28, 17.4, 2, '#ff9a3c');
  for (const [u, v] of [[.12, .12], [.84, .12], [.12, .84], [.84, .84]]) lbox(T, u, v, .04, .04, 2, 15.6, '#8a90a6'); lbox(T, .12, .12, .76, .76, 17.6, 1.2, DARK);
  lbox(T, .14, .14, .72, .72, 2.8, 14.6, { t: 'rgba(170,220,255,.1)', l: 'rgba(150,205,255,.16)', r: 'rgba(120,180,240,.18)', e: null });
  const [lx, ly] = TP(T, .84, .9, 3.4); R(lx, ly, 1, 1, Math.floor(c.t * 3) % 2 ? '#6bff9a' : '#2a5a3a');
};
ART.whiteboard_stand = (T) => {
  lbox(T, .18, .44, .06, .06, 0, 13, '#8a90a6'); lbox(T, .76, .44, .06, .06, 0, 13, '#8a90a6'); lbox(T, .18, .3, .06, .06, 0, 6, '#6a6882'); lbox(T, .76, .3, .06, .06, 0, 6, '#6a6882'); lbox(T, .14, .4, .72, .14, 0, .8, '#6a6882');
  lbox(T, .08, .46, .84, .07, 11, 17, { t: '#9aa3b2', l: '#8a93a4', r: '#6a7382', e: null }); lface(T, '+v', .53, .13, .87, 12, 27, '#f4f6f8');
  lface(T, '+v', .535, .2, .55, 24, 24.8, '#3b82f6'); lface(T, '+v', .535, .2, .7, 21.6, 22.4, '#3a3548'); lface(T, '+v', .535, .2, .42, 19, 19.8, '#e0473c'); lface(T, '+v', .535, .55, .78, 14, 17.6, '#2f9a5a'); lface(T, '+v', .535, .22, .4, 14, 16, '#3b82f6'); lface(T, '+v', .535, .44, .5, 14, 18, '#3b82f6');
  lbox(T, .2, .5, .6, .12, 10.4, .8, '#6a6882'); for (const [u, col] of [[.3, '#3b82f6'], [.42, '#e0473c']]) lbox(T, u, .54, .09, .05, 11.2, .8, col);
};
ART.map_table = (T) => {
  for (const [u, v] of [[.1, .1], [1.74, .1], [.1, 1.74], [1.74, 1.74]]) lbox(T, u, v, .16, .16, 0, 7, { t: '#6e4630', l: '#8a5a3c', r: '#553520' });
  lbox(T, .04, .04, 1.92, 1.92, 6.4, 1, WOODR); lbox(T, 0, 0, 2, 2, 7.4, 1.6, { t: '#b98357', l: '#8a5a3c', r: '#6e4630' });
  lflat(T, .12, .12, 1.88, 1.88, 9.05, '#e6d3a8'); lflat(T, .2, .2, .9, .8, 9.1, '#8fc8ee'); lflat(T, .9, .3, 1.7, 1.2, 9.1, '#b8d68a'); lflat(T, 1.0, .9, 1.4, 1.6, 9.1, '#9cc070');
  for (const [u, v, w, d] of [[.3, 1.2, 1.2, .04], [1.0, .5, .04, 1.2], [.5, 1.5, .8, .04]]) lflat(T, u, v, u + w, v + d, 9.15, '#8a5a3c');
  lflat(T, 1.2, .6, 1.3, .7, 9.2, '#e0473c'); lbox(T, .6, .4, .05, .05, 9.1, 1.6, '#e0473c'); lbox(T, 1.5, 1.4, .05, .05, 9.1, 1.6, '#4f86c6');
};
ART.bench_lab = (T) => {
  const w = { t: '#f4f6f8', l: '#dfe3e8', r: '#b8bec8' };
  lbox(T, .04, .1, 1.92, .8, 0, 10.4, w); lbox(T, 0, .06, 2, .88, 10.4, 1.6, { t: '#2f343f', l: '#23272f', r: '#1a1d24' });
  for (const u of [.06, .52, .98, 1.44]) lface(T, '+v', .9, u, u + .46, 1, 9.4, '#cfd4dc'); for (const u of [.36, .44, .82, .9, 1.28, 1.36, 1.74, 1.82]) lface(T, '+v', .9, u, u + .03, 5, 7, '#6a7382');
  lbox(T, 1.6, .12, .05, .05, 12, 4.4, '#9aa3b2'); lbox(T, 1.45, .12, .2, .05, 15.6, .8, '#9aa3b2'); lbox(T, 1.4, .3, .35, .3, 11.9, .2, '#cfd4dc');
};
ART.zen_sand = (T) => {
  lflat(T, .02, .02, 1.98, 1.98, 0, '#8a5a3c'); lflat(T, .1, .1, 1.9, 1.9, 0, '#e5d3ae');
  for (let v = .15; v < 1.88; v += .25) lflat(T, .12, v, 1.88, v + .0625, 0, '#c9b48a');
  for (const [cu, cv, r] of [[.7, .7, .5], [1.4, 1.35, .36]]) { for (const [k, col] of [[1, '#c9b48a'], [.88, '#e5d3ae'], [.74, '#c9b48a'], [.6, '#e5d3ae']]) lpoly(T, circ(cu, cv, r * k, 24), 0, col); }
  for (const [u, v, w, d, h] of [[.54, .58, .3, .24, 3], [.66, .7, .18, .16, 4.4], [1.3, 1.26, .22, .18, 2.4]]) lbox(T, u, v, w, d, 0, h, { t: '#a9a4b4', l: '#8a8597', r: '#67627a' });
};
const sqc = (cu, cv, r, n) => Array.from({ length: n }, (_, i) => { const a = (i + .5) / n * Math.PI * 2, x = Math.cos(a), y = Math.sin(a), k = Math.pow(x ** 4 + y ** 4, -.25); return [cu + x * k * r, cv + y * k * r]; }); // a rounded square (superellipse) fills a 2x2 tile footprint
ART.koi_pond = (T, c) => {
  const cu = 1, cv = 1;
  lpoly(T, sqc(cu, cv, .99, 44), 0, '#4a4658'); lpoly(T, sqc(cu, cv, .96, 44), 1.4, '#9a95a8'); lpoly(T, sqc(cu, cv, .84, 40), 1.4, '#7d7890'); lpoly(T, sqc(cu, cv, .8, 40), .6, '#2a5f9e'); lpoly(T, sqc(cu - .05, cv - .04, .68, 36), .6, '#3a78b8');
  for (const [u, v, r] of [[.6, .6, .13], [1.45, 1.3, .15], [1.3, .55, .1]]) { lpoly(T, circ(u, v, r, 10), .8, '#3f8f5a'); lpoly(T, circ(u - .02, v - .02, r * .7, 8), .8, '#5fbf7a'); }
  lpoly(T, circ(1.45, 1.3, .05, 6), 1, '#f9b4d4');
  for (let i = 0; i < 3; i++) { const p = (c.t * .22 + i / 3) % 1; lpoly(T, circ(cu + .15, cv - .1, .05 + p * .45, 18), .7, 'rgba(200,230,255,' + (.16 * (1 - p)).toFixed(3) + ')'); }
  const fish = [[0, '#ff9a3c', .5, .34, 1], [2.4, '#f4efe6', .42, .28, -1], [4.3, '#ff6b3c', .48, .3, 1]];
  for (const [ph, col, rx, rv, dir] of fish) for (let k = 0; k < 4; k++) { const a = c.t * .7 * dir + ph - k * .22 * dir, u = cu + Math.cos(a) * rx, v = cv + Math.sin(a) * rv, [sx, sy] = TP(T, u, v, .7); R(Math.round(sx) - (k === 3 ? 0 : 1), Math.round(sy) - 1, k === 3 ? 1 : 2, k === 3 ? 1 : 2, k === 1 && col !== '#f4efe6' ? '#f4efe6' : col); }
  lpoly(T, circ(cu - .08, cv - .1, .05, 6), .7, 'rgba(255,255,255,.35)');
};
// ---- floor: sound, arcade, shelves ----
ART.speaker_tower = (T, c) => {
  const beat = Math.max(0, 1 - ((c.t * 2.1 + c.seed * .13) % 1) * 3), sp = .3 * beat;
  lbox(T, .2, .22, .6, .56, 0, 30, { t: '#3d3a4c', l: '#2b2933', r: '#1f1d27' });
  lface(T, '+v', .78, .24, .76, 2, 28, '#23212c');
  const [wx, wy] = TP(T, .5, .78, 10), [tx, ty] = TP(T, .5, .78, 23), [mx, my] = TP(T, .5, .78, 17);
  ell(wx, wy, 5 + sp, 5 + sp * .7, '#15141a'); ell(wx, wy, 4 + sp, 4 + sp * .6, '#4a4858'); ell(wx, wy, 2.5, 2.5, '#2b2933'); dot(wx - .5, wy - .5, '#6a6882', 1);
  ell(mx, my, 2.5, 2.5, '#15141a'); ell(mx, my, 1.5, 1.5, '#4a4858'); ell(tx, ty, 2, 2, '#15141a'); ell(tx, ty, 1.2, 1.2, '#8a8597');
  if (c.lit) { R(wx + 6, wy - 12, .5, .5, c.lit && beat > .2 ? '#6bff9a' : '#2a5a3a'); for (let i = 0; i < 2; i++) { const p = (c.t * .6 + i * .5) % 1; if (beat > .05 || p < .4) R(Math.round(wx + 8 + p * 5), Math.round(wy - 8 - p * 10 - i * 3), 1, 1, 'rgba(200,190,255,' + (.7 * (1 - p)).toFixed(2) + ')'); } }
};
ART.record_player = (T, c) => {
  lbox(T, .08, .1, .84, .8, 0, 12, { t: '#8a5a3c', l: '#7a4e2e', r: '#5e3d27' });
  lface(T, '+v', .9, .14, .48, 1.4, 10.4, '#6e4630'); lface(T, '+v', .9, .52, .86, 1.4, 10.4, '#6e4630'); lface(T, '+v', .9, .44, .46, 5, 7, '#d9b98a'); lface(T, '+v', .9, .54, .56, 5, 7, '#d9b98a');
  lbox(T, .06, .08, .88, .84, 11.4, .8, { t: '#b98357', l: '#946038', r: '#7a4e2e' });
  lbox(T, .12, .48, .76, .42, 12.2, 1.2, { t: '#2f2b3a', l: '#25222e', r: '#1c1a24' });
  const cu = .4, cv = .7, a = c.t * 3.6;
  lpoly(T, circ(cu, cv, .19, 18), 13.6, '#15141a'); lpoly(T, circ(cu, cv, .15, 16), 13.7, '#23212c'); lpoly(T, circ(cu, cv, .06, 10), 13.8, '#e0473c');
  lpoly(T, [[cu + Math.cos(a) * .1, cv + Math.sin(a) * .1], [cu + Math.cos(a) * .18, cv + Math.sin(a) * .18], [cu + Math.cos(a + .35) * .18, cv + Math.sin(a + .35) * .18]], 13.85, 'rgba(255,255,255,.25)');
  lbox(T, .78, .55, .05, .05, 13.4, 1.6, '#cfd5e0'); lbox(T, .56, .64, .24, .03, 14.8, .4, '#cfd5e0');
  if (c.lit) for (let i = 0; i < 2; i++) { const p = (c.t * .4 + i * .5) % 1, [nx, ny] = TP(T, .7, .6, 16); R(Math.round(nx + Math.sin(p * 7 + i) * 2), Math.round(ny - p * 12), 1, 2, 'rgba(240,230,255,' + (.8 * (1 - p)).toFixed(2) + ')'); R(Math.round(nx + Math.sin(p * 7 + i) * 2) + 1, Math.round(ny - p * 12) - 1, 1, 1, 'rgba(240,230,255,' + (.8 * (1 - p)).toFixed(2) + ')'); }
};
ART.arcade_racer = (T, c) => {
  lbox(T, .14, 1.0, .72, .96, 0, 3.6, { t: '#2b2838', l: '#211f2c', r: '#18161f' });
  lbox(T, .1, .08, .8, .9, 0, 32, { t: '#2d6fd0', l: '#2459a8', r: '#1b4280' });
  lface(T, '+v', .98, .16, .84, 15, 27, '#0b0a14');
  const k = Math.floor(c.t * 9);
  if (c.lit) for (let i = 0; i < 8; i++) { const z = 15.4 + i * 1.4, hw = .06 + i * .05, m = .5; lface(T, '+v', .981, .18, .82, z, z + 1.3, i < 4 ? '#3fa35a' : '#5fc07a'); lface(T, '+v', .982, m - hw, m + hw, z, z + 1.3, (i + k) % 2 ? '#5a5870' : '#6a6882'); if ((i + k) % 2) lface(T, '+v', .983, m - .015, m + .015, z, z + 1.3, '#f4efe6'); }
  lface(T, '+v', .98, .18, .82, 25.4, 26.8, '#8fc8ee'); lface(T, '+v', .98, .18, .82, 28, 31, c.lit ? '#ffcf4a' : '#8a6a1a'); lface(T, '+u', .9, .2, .9, 2, 30, '#ff3ea5');
  lbox(T, .12, .98, .76, .26, 9.6, 1.6, { t: '#3d3a4c', l: '#2b2933', r: '#1f1d27' });
  const [wx, wy] = TP(T, .5, 1.25, 14.5), s = Math.sin(c.t * 2.4) * 1; ell(wx, wy, 3.5, 3.5, '#15141a'); ell(wx, wy, 2.2, 2.2, '#2d6fd0'); R(wx - 3.5 + s, wy - .5, 7, 1, '#15141a'); dot(wx - .5, wy - .5, '#e0473c', 1);
  lbox(T, .3, 1.15, .1, .12, 3.6, 1, '#15141a'); lbox(T, .6, 1.15, .1, .12, 3.6, 1, '#e0473c');
  lbox(T, .22, 1.46, .56, .4, 4.2, 1.6, fab('#e0473c')); lbox(T, .22, 1.84, .56, .12, 5.8, 8, fab('#e0473c')); lbox(T, .4, 1.8, .2, .18, 13.2, 1.6, fab('#c2413a'));
  if (c.lit) { c.glows.push([TP(T, .5, 1.05, 19), 16, '120,200,255', .05 + .07 * c.n]); c.pools.push([TP(T, .5, 2.1, 0), 18, '255,80,180', .08 * c.n]); }
};
ART.bookshelf_tall = (T, c) => {
  lbox(T, .1, .02, .8, 1.96, 0, 38, { t: '#6e4d35', l: '#5a3e2a', r: '#4a3222' });
  if (lvis(T, '+u')) for (let s = 0; s < 4; s++) {
    const z0 = 2 + s * 9, h0 = 8; lface(T, '+u', .9, .1, 1.9, z0, z0 + h0 - .5, '#2a1d15');
    for (let v = .14, i = 0; v < 1.84; i++) { const h = hashStr('bt' + s + i + c.seed), bw = .07 + (h % 3) * .025, bh = 4 + ((h >> 3) % 4) * .9; if ((h >> 6) % 9 === 0) { v += .1; continue; } lface(T, '+u', .9, v, Math.min(1.86, v + bw), z0, z0 + bh, BOOKS[h % BOOKS.length]); v += bw + .02; }
    lface(T, '+u', .9, .08, 1.92, z0 - .8, z0, '#7a5639');
  }
};
ART.coat_rack = (T, c) => {
  const sw = Math.sin(c.t * .8 + c.seed) * .5;
  drawBoxes(T, [[.3, .47, .4, .06, 0, 1.4, WOODR], [.47, .3, .06, .4, 0, 1.4, WOODR], [.46, .46, .08, .08, 1.4, 27.6, '#8a5a3c']]);
  for (const [u, v] of [[.36, .5], [.64, .5], [.5, .36], [.5, .64]]) lbox(T, Math.min(u, .5) - .02, Math.min(v, .5) - .02, Math.abs(u - .5) + .06, Math.abs(v - .5) + .06, 27, 1.2, '#8a5a3c');
  const [ax, ay] = TP(T, .5, .5, 27);
  R(ax - 7, ay + 1, 5 + sw, 1, '#6e4630'); R(ax - 7 + sw, ay + 2, 5, 10, '#33507a'); R(ax - 7 + sw, ay + 2, 1, 10, '#4a6a9a'); R(ax - 3 + sw, ay + 2, 1, 10, '#23374f'); R(ax - 5 + sw, ay + 11, 2, 1, '#23374f');
  R(ax + 3, ay + 3, 4, 7 + sw, '#c2413a'); R(ax + 3, ay + 2, 4, 1, '#8f2a25'); R(ax + 3, ay + 3, 1, 7, '#e0605a');
  R(ax - 2, ay - 3, 4, 1, '#3a3746'); R(ax - 1, ay - 5, 2, 2, '#3a3746'); R(ax - 2, ay - 3, 4, .5, '#c9a23a');
};
// ---- the gaming desk: a desk kind (drawDesk calls this) with a colour-cycling LED strip ----
function hueRgb(h) { const k = n => { const a = (n + h / 60) % 6; return 255 * (1 - Math.max(0, Math.min(a, 4 - a, 1))); }; return [k(5), k(3), k(1)].map(Math.round); }
function drawGamingDesk(T, c, L) {
  const rgb = hueRgb((c.t * 45) % 360), led = 'rgb(' + rgb.join(',') + ')', carbon = { t: '#56547a', l: '#3a3858', r: '#292742' };
  drawBoxes(T, [[.08, 1.06, .12, .88, 0, 7, { t: '#4a4868', l: '#35334f', r: '#26243a' }], [L - .2, 1.06, .12, .88, 0, 7, { t: '#4a4868', l: '#35334f', r: '#26243a' }], [.02, 1.0, .3, 1, 0, .8, { t: '#c2413a', l: '#a03630', r: '#782824' }], [L - .32, 1.0, .3, 1, 0, .8, { t: '#c2413a', l: '#a03630', r: '#782824' }], [.22, 1.12, L - .44, .06, 2.4, 4, '#1a1926']]);
  lbox(T, 0, 1, L, 1, 7, 1.5, carbon); lface(T, '+v', 2, .04, L - .04, 7.2, 7.9, led); lface(T, '+u', L, 1.04, 1.96, 7.2, 7.9, led);
  lflat(T, .1, 1.1, L - .1, 1.14, 8.56, 'rgba(255,255,255,.08)');
  const [mx, my] = TP(T, L * .62, 1.55, 8.6); R(mx - 5, my - .5, 10, 1.4, '#15141d'); R(mx - 5, my - .5, 10, .4, led);
  if (c.lit) { c.pools.push([TP(T, L / 2, 2.35, 0), 20, rgb.join(','), .05 + .08 * c.n]); c.glows.push([TP(T, L / 2, 2, 7), 12, rgb.join(','), .02 + .04 * c.n]); }
}
// ---- wall items: front-view painters into a small offscreen canvas (w x h art units), sheared onto the wall by wallBlit ----
// WALL_PAINT[name](c, th, D) paints at (0,0); WALL_ANIM = repainted every frame, the rest once per size.
const WALL_PAINT = {}, WALL_ANIM = new Set(), WALL_GLOW = {};
const wpw = (id, label, size, row, wh, anim, o) => { vwl(id, label, size, row, 'Wall', o); WALL_ART[id] = wh; if (anim) WALL_ANIM.add(id); };
const frm = (w, h, col, hi) => { R(0, 0, w, h, col); R(0, 0, w, .6, hi || shade(col, 1.25)); R(0, h - .6, w, .6, shade(col, .7)); };
wpw('poster_space', 'Space poster', [1, 1], 1, [8, 11]);
WALL_PAINT.poster_space = () => {
  frm(8, 11, '#e9e1cf'); R(1, 1, 6, 7.5, '#141a44'); R(1, 1, 6, 1, '#1c2460');
  for (const [x, y] of [[1.6, 1.6], [5.6, 2], [2.4, 6.6], [6, 6], [4.4, 1.4], [1.6, 4.4]]) R(x, y, .5, .5, '#ffffff');
  ell(4, 4.6, 2, 2, '#e0a13a'); ell(3.6, 4.2, 1, 1, '#f2c266'); R(1.2, 4.6, 5.6, .6, '#f4d58a'); R(1.2, 4.6, 1.6, .6, '#1c2460'); ell(6, 2.4, .8, .8, '#c9c2b8');
  R(2, 9.2, 4, .6, '#3a3548'); R(3, 10, 2, .5, '#8a8597');
};
wpw('poster_cat', 'Cat poster', [1, 1], 1, [8, 11]);
WALL_PAINT.poster_cat = () => {
  frm(8, 11, '#f0e0c0'); R(1, 1, 6, 7.5, '#9bd0c4'); ell(4, 5.2, 2.6, 2.3, '#e08a3c'); R(1.6, 2.2, 1.4, 1.6, '#e08a3c'); R(5, 2.2, 1.4, 1.6, '#e08a3c'); R(2, 2.6, .6, .8, '#f4a6c0'); R(5.4, 2.6, .6, .8, '#f4a6c0');
  R(2.8, 4.6, 1, 1, '#2b2833'); R(4.4, 4.6, 1, 1, '#2b2833'); R(2.9, 4.6, .4, .4, '#9be7a6'); R(4.5, 4.6, .4, .4, '#9be7a6'); R(3.7, 5.8, .8, .5, '#f4a6c0'); R(1.4, 5.6, 1.4, .3, '#f4efe6'); R(5.2, 5.6, 1.4, .3, '#f4efe6'); R(3, 3.3, .4, 1, '#a8581f'); R(4.6, 3.3, .4, 1, '#a8581f');
  R(2, 9.2, 4, .8, '#c2413a'); R(2.6, 9.4, 2.8, .3, '#f0e0c0');
};
wpw('poster_motivate', 'Motivational poster', [1, 1], 1, [8, 11]);
WALL_PAINT.poster_motivate = () => {
  frm(8, 11, '#15141a', '#3a3746'); R(1, 1, 6, 6.6, '#f0a060'); R(1, 1, 6, 2.6, '#f7c98a'); ell(4, 4.6, 1.6, 1.6, '#ffe39a'); R(1, 5.2, 6, 2.4, '#3d4a6a');
  poly([[1, 7.6], [3.4, 4], [5, 6], [6, 5], [7, 7.6]], '#2b3450'); R(1, 7, 6, .6, '#1a2036');
  R(2, 8.2, 4, .7, '#f4efe6'); R(2.6, 9.2, 2.8, .4, '#cfc9dc'); R(3, 9.9, 2, .3, '#8a8597');
};
wpw('tv_wall', 'Wall TV', [2, 1], 1, [16, 10], true);
WALL_PAINT.tv_wall = (c) => {
  R(0, 0, 16, 10, '#15141a'); R(0, 0, 16, .5, '#3a3746'); R(0, 9.5, 16, .5, '#0c0b10'); const sx = 1, sy = 1, sw = 14, sh = 7.5;
  if (!c.lit) { R(sx, sy, sw, sh, '#0e0e14'); R(sx + 1, sy + 1, 4, .5, '#1a1a24'); }
  else {
    const scene = Math.floor(c.t / 5) % 4;
    if (scene === 0) { for (let y = 0; y < sh; y += .5) for (let x = 0; x < sw; x += .5) { const h = hashStr('tv' + x + y + Math.floor(c.t * 5)); R(sx + x, sy + y, .5, .5, h % 3 ? (h % 5 < 2 ? '#c9c9d4' : '#6a6a78') : '#2a2a34'); } }
    else if (scene === 1) { R(sx, sy, sw, sh, '#f0a060'); R(sx, sy, sw, 2.4, '#f7c98a'); ell(sx + 9, sy + 3.4, 2, 2, '#ffe39a'); R(sx, sy + 4.6, sw, 2.9, '#3d4a6a'); poly([[sx, sy + 7.5], [sx + 4, sy + 3.6], [sx + 7, sy + 6], [sx + 9, sy + 4.6], [sx + 14, sy + 7.5]], '#2b3450'); }
    else if (scene === 2) { const cols = ['#e9e4dc', '#e0d23f', '#3fe0d2', '#3fe03f', '#e03fe0', '#e03f3f', '#3f3fe0']; cols.forEach((col, i) => R(sx + i * 2, sy, 2, sh * .7, col)); R(sx, sy + sh * .7, sw, sh * .3, '#1a1a24'); }
    else { R(sx, sy, sw, sh, '#10131c'); for (let i = 0; i < 6; i++) { const hh = 1 + Math.abs(Math.sin(c.t * 3 + i * 1.3)) * 5; R(sx + 1.5 + i * 2.1, sy + sh - 1 - hh, 1.4, hh, ['#4fb3ff', '#6bd66b', '#ffd23f'][i % 3]); } }
    R(sx, sy, sw, .5, 'rgba(255,255,255,.12)'); R(sx, sy + 2, 3, 4, 'rgba(255,255,255,.05)');
  }
  R(14.4, 9, .6, .5, c.lit ? '#e0473c' : '#3a3746');
};
WALL_GLOW.tv_wall = ['150,190,255', .07, 20];
wpw('dartboard', 'Dartboard', [1, 1], 1, [8, 9]);
WALL_PAINT.dartboard = () => {
  const cx = 3.9, cy = 4.3, K = ['#16141c', '#ece1c0'], RG = ['#d2473f', '#2f9a5e'];
  ell(cx + .3, cy + .45, 3.6, 3.6, 'rgba(0,0,0,.28)'); // a soft shadow on the wall
  half(0, 0, 8, 9, (x, y) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r > 3.75) return null;
    const SW = Math.PI / 4, a = (Math.atan2(dy, dx) + Math.PI / 2 + SW / 2 + Math.PI * 2) % (Math.PI * 2), sec = Math.floor(a / SW), par = sec % 2, off = a % SW, lit = dx + dy < 0 ? 1.1 : 1;
    let col; // bold rings only: the board is 8 units wide and gets sheared onto the wall, so finer rings and numbers turned into confetti
    if (r > 3.2) col = '#1b1922'; // dark surround
    else if (r > 2.3) col = RG[0]; // red band
    else if (r > 1.3) col = K[1]; // cream band
    else if (r > .65) col = '#2f9a5e'; // outer bull
    else col = '#d2473f'; // bull
    return lit > 1 ? shade(col, lit) : col;
  });
  // three darts stuck in it
  const dart = (x, y, col) => { R(x, y, 1.5, .5, '#c9ced9'); R(x + 1.5, y - .5, 1.2, 1.5, col); R(x + 1.5, y + .5, 1.2, .5, shade(col, .75)); };
  dart(4.6, 4.8, '#e0473c');
};
wpw('guitar_wall', 'Wall guitar', [1, 1], 1, [8, 11]);
WALL_PAINT.guitar_wall = () => {
  R(3.4, 0, 1.2, 6, '#4a3222'); R(3.1, 0, 1.8, 1.6, '#3a2a1e'); R(3.1, 1.6, .5, .4, '#d9b98a'); R(4.4, 1.6, .5, .4, '#d9b98a');
  ell(4, 8, 3.4, 2.6, '#b53730'); ell(4, 6.6, 2.4, 1.6, '#b53730'); ell(3.4, 7.6, 2, 1.4, '#d8453c'); R(3.4, 7.2, 1.2, 1.4, '#15141a'); R(2.2, 8.9, 3.6, .5, '#cfd5e0');
  R(3.8, 0, .1, 9, 'rgba(255,255,255,.35)'); R(1, 10, 6, .6, '#6e4630');
};
wpw('map_world', 'World map', [2, 1], 1, [16, 10]);
WALL_PAINT.map_world = () => {
  frm(16, 10, '#6e4630'); R(1, 1, 14, 8, '#3a78b8'); R(1, 1, 14, 1, '#4a88c8');
  for (const [x, y, rx, ry] of [[4, 3.4, 2.2, 1.5], [4.6, 6.4, 1.1, 1.8], [8.2, 3, 1.3, 1.1], [8.4, 5.6, 1.1, 1.9], [11.4, 3.2, 2.6, 1.4], [12.6, 6.8, 1.1, .8]]) { ell(x, y, rx, ry, '#7cb36a'); ell(x - .3, y - .3, rx * .6, ry * .6, '#9cc88a'); }
  ell(11, 3.6, 1.4, .8, '#c9b48a'); R(1, 9, 14, .4, '#2a5f9e');
};
wpw('calendar', 'Calendar', [1, 1], 1, [8, 10]);
WALL_PAINT.calendar = (c, th, D) => {
  R(0, 0, 8, 10, '#f4efe6'); R(0, 0, 8, 2.6, '#c2413a'); R(0, 2.6, 8, .4, '#8f2a25'); for (const x of [1.4, 3.8, 6]) R(x, -.4 + .4, .6, 1, '#cfd5e0');
  for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) R(1 + k * 1, 3.8 + r * 1.4, .6, .8, (r * 6 + k) === 8 ? '#c2413a' : '#8a8597');
  ell(3.6, 6.8, .7, .7, 'rgba(194,65,58,.0)'); R(2.6, 9, 3, .4, '#cfc9dc');
};
wpw('kanban', 'Kanban board', [2, 1], 1, [16, 11]);
WALL_PAINT.kanban = () => {
  frm(16, 11, '#8a90a6'); R(1, 1, 14, 9, '#f4f6f8');
  [['#e0473c', 0], ['#e0a13a', 1], ['#2f9a5a', 2]].forEach(([col, i]) => { R(1.4 + i * 4.6, 1.4, 4, .8, col); R(1.4 + i * 4.6, 2.4, .2, 7, '#dfe3e8'); });
  const notes = [[0, 0, '#ffe39a'], [0, 1, '#f4a6c0'], [0, 2, '#9bd0f4'], [1, 0, '#ffe39a'], [1, 1, '#b7e89a'], [2, 0, '#b7e89a'], [2, 1, '#f4a6c0'], [2, 2, '#ffe39a']];
  for (const [i, j, col] of notes) { R(1.6 + i * 4.6, 2.6 + j * 2.3, 3.6, 1.9, col); R(1.9 + i * 4.6, 3.1 + j * 2.3, 2.4, .3, 'rgba(0,0,0,.3)'); R(1.9 + i * 4.6, 3.8 + j * 2.3, 1.6, .3, 'rgba(0,0,0,.22)'); }
};
wpw('acoustic_panel', 'Acoustic panel', [1, 1], 1, [8, 11]);
WALL_PAINT.acoustic_panel = () => {
  R(0, 0, 8, 11, '#3a4a5a'); R(0, 0, 8, .6, '#5a6a7a'); R(0, 10.4, 8, .6, '#26323e');
  for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) { const x = 1 + k * 1.75, y = 1 + r * 2; R(x, y, 1.75, 1, (k + r) % 2 ? '#56707f' : '#6a8696'); R(x, y + 1, 1.75, 1, (k + r) % 2 ? '#2f4150' : '#3a5060'); }
};
wpw('string_lights', 'String lights', [2, 1], 2, [16, 9], true);
WALL_PAINT.string_lights = (c) => {
  const cols = ['#ffd23f', '#ff7a7a', '#7fe0a0', '#7fc8ff', '#ff9a3c', '#d9a0ff', '#ffd23f'];
  for (let i = 0; i <= 15; i++) { const y = 1.2 + 3.2 * Math.sin(i / 15 * Math.PI); R(i, y, 1, .5, '#3a3746'); }
  for (let k = 0; k < 7; k++) { const x = 1 + k * 2.3, y = 1.2 + 3.2 * Math.sin(x / 15 * Math.PI) + .6, on = c.lit && ((Math.floor(c.t * 2 + k * 1.3) % 4) !== 0), col = on ? cols[k] : '#4a4858'; R(x, y, .6, .8, '#3a3746'); ell(x + .3, y + 1.8, .8, 1.1, col); if (on) { R(x, y + 1.1, .4, .4, '#ffffff'); } }
};
WALL_GLOW.string_lights = ['255,214,140', .06, 18];
wpw('clock_cuckoo', 'Cuckoo clock', [1, 1], 2, [8, 11], true);
WALL_PAINT.clock_cuckoo = (c, th, D) => {
  const now = new Date(), open = window.__cuckoo || (now.getMinutes() === 0 && now.getSeconds() < 14), sw = Math.sin(c.t * 3.1) * 1.4;
  poly([[0, 3.6], [4, 0.2], [8, 3.6]], '#6e4630'); poly([[.6, 3.6], [4, .8], [7.4, 3.6]], '#8a5a3c'); R(0, 3.4, 8, .5, '#553520');
  R(.8, 3.9, 6.4, 4.8, '#a8744a'); R(.8, 3.9, 6.4, .5, '#c48a5a'); R(.8, 8.2, 6.4, .5, '#6e4630');
  R(3, 4.4, 2, 1.4, open ? '#15100c' : '#6e4630'); if (open) { const out = Math.min(1, ((now.getSeconds() % 14) * 4 + (window.__cuckoo ? 4 : 0)) % 8 / 3); R(3.2, 4.6, 1.6, 1, '#4f86c6'); R(3.4 + out * .4, 4.4, 1, 1, '#e0473c'); R(4.2 + out * .4, 4.6, .8, .4, '#e0a13a'); R(3.6 + out * .4, 4.6, .3, .3, '#15141a'); } else R(3.6, 4.8, .8, .4, '#3a2a1e');
  ell(4, 6.9, 1.6, 1.6, '#f4efe6'); ell(4, 6.9, 1.2, 1.2, '#fff8e8'); const hm = (D.mm || now.getMinutes()) / 60 * Math.PI * 2, hh = ((D.hh || now.getHours()) % 12 + (D.mm || 0) / 60) / 12 * Math.PI * 2;
  for (let i = 1; i < 5; i++) R(4 + Math.sin(hm) * i * .3 - .25, 6.9 - Math.cos(hm) * i * .3 - .25, .5, .5, '#2b2833'); for (let i = 1; i < 4; i++) R(4 + Math.sin(hh) * i * .3 - .25, 6.9 - Math.cos(hh) * i * .3 - .25, .5, .5, '#2b2833');
  R(3.9 + sw * .5, 8.9, .3, 1.3, '#c9a23a'); ell(4 + sw * .5 + .15, 10.2, .9, .8, '#e0a13a');
  R(1.2, 8.9, .8, .4, '#8a8597'); R(1.3, 9.3, .6, 1.2, '#6e4630'); R(6, 8.9, .8, .4, '#8a8597'); R(6.1, 9.3, .6, 1.2, '#6e4630');
};
wpw('blueprint', 'Blueprint', [2, 1], 1, [16, 11]);
WALL_PAINT.blueprint = () => {
  R(0, 0, 16, 11, '#2a5a9a'); R(0, 0, 16, .5, '#4a7ab8'); R(0, 10.5, 16, .5, '#1f4478'); for (let x = 1; x < 16; x += 2) R(x, .5, .25, 10, 'rgba(255,255,255,.12)'); for (let y = 1; y < 11; y += 2) R(.5, y, 15, .25, 'rgba(255,255,255,.12)');
  R(3, 4.4, 6, 4, 'rgba(255,255,255,0)'); R(3, 8, 6, .5, '#e0ecff'); R(3, 4.6, .5, 3.9, '#e0ecff'); R(8.5, 4.6, .5, 3.9, '#e0ecff'); poly([[2.6, 4.8], [5.8, 2], [9, 4.8], [8.6, 4.8], [5.8, 2.6], [3, 4.8]], '#e0ecff'); R(4.6, 5.8, 2, 2.7, '#e0ecff'); R(4.9, 6.1, 1.4, 2.4, '#2a5a9a');
  ell(12.2, 5.4, 2, 2, '#e0ecff'); ell(12.2, 5.4, 1.4, 1.4, '#2a5a9a'); ell(12.2, 5.4, .6, .6, '#e0ecff'); for (let i = 0; i < 6; i++) R(12 + Math.cos(i * 1.05) * 2.3, 5.2 + Math.sin(i * 1.05) * 2.3, .6, .6, '#e0ecff');
  R(2.6, 9.4, 4, .3, '#e0ecff'); R(9, 9.4, 5, .3, '#e0ecff'); R(10, 1.2, 4, .3, '#e0ecff'); R(10, 1.9, 3, .3, '#e0ecff');
};
wpw('gold_record', 'Gold record', [1, 1], 1, [8, 11]);
WALL_PAINT.gold_record = () => {
  frm(8, 11, '#17151d', '#3f3b4c'); R(.5, .5, 7, 10, '#2c2a3c'); R(.5, .5, 7, .5, '#1c1a27'); R(.5, .5, .5, 10, '#1c1a27'); R(7, .5, .5, 10, '#3d3a52'); R(.5, 10, 7, .5, '#3d3a52'); // frame, then the dark mat in a bevel
  const cx = 4, cy = 4.3;
  ell(cx + .25, cy + .3, 3.2, 3.2, 'rgba(0,0,0,.3)'); // the disc's shadow on the mat
  half(0, 0, 8, 8, (x, y) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r > 3.1) return null;
    if (r < .22) return '#17151d'; if (r < .55) return '#e8c14a';
    if (r < 1.25) { const s2 = (dx + dy) / 2; return r > 1.1 ? '#8f2a25' : s2 < -.15 ? '#e0605a' : '#c2413a'; } // the red label
    const g = Math.floor(r * 3.4) % 2, lit = (-dx * .62 - dy * .78) / Math.max(r, .01); // grooves catch the light from the top-left
    let col = g ? '#c9a23a' : '#dcb445'; if (r > 2.9) col = '#9a7a1f';
    if (lit > .55 && r > 1.4) col = shade(col, 1.22); else if (lit < -.55) col = shade(col, .82);
    const sh = dx * .8 - dy * .6; if (Math.abs(sh - .6) < .28 && r > 1.5 && r < 2.85) col = '#fff0a4'; // glint
    return col;
  });
  R(1.4, 8.2, 5.2, 1.6, '#6a4f10'); R(1.4, 8.2, 5.2, .5, '#f6dc7a'); R(1.4, 8.7, 5.2, 1.1, '#d2ab3c'); R(1.4, 9.4, 5.2, .4, '#a4812a'); R(2.2, 8.9, 3.6, .3, '#6a4f10'); R(2.8, 9.4, 2.4, .3, '#7d5e14');
};
wpw('ivy', 'Hanging ivy', [1, 1], 1, [8, 11], true);
WALL_PAINT.ivy = (c) => {
  R(2.5, 0, 3, 2.4, '#b8643c'); R(2.2, 0, 3.6, .7, '#d4805a'); R(2.5, 1.9, 3, .5, '#8a4a2c'); const L2 = ['#2f7a45', '#3d9a5a', '#5fbf7a'];
  [[3.2, 10, 0], [4.2, 8, 1], [5, 11, 2], [2.6, 6.4, 3]].forEach(([x0, len, k]) => { for (let y = 2.4; y < len; y += .7) { const f = (y - 2.4) / 8, sw = Math.sin(c.t * 1.1 + k + y * .35) * f * 1.3, x = x0 + sw + Math.sin(y * 1.2 + k) * .5; R(x, y, .4, .8, '#5e7a3a'); if (Math.floor(y * 1.4 + k) % 2) R(x + (k % 2 ? .3 : -1.2), y, 1.2, .9, L2[(Math.floor(y) + k) % 3]); else R(x - .5, y + .2, 1.1, .8, L2[(Math.floor(y) + k + 1) % 3]); } });
};
wpw('periodic_table', 'Periodic table', [2, 1], 1, [16, 10]);
WALL_PAINT.periodic_table = () => {
  R(0, 0, 16, 10, '#f4efe6'); R(0, 0, 16, .5, '#fff8e8'); R(0, 9.5, 16, .5, '#cfc9dc'); const cw = 14 / 18, ch = 6.6 / 7, C = ['#e0605a', '#f0a060', '#ffe39a', '#b7e89a', '#7fd0c8', '#9bc4f0', '#c9a8f0'];
  const has = (p, g) => p === 0 ? (g === 0 || g === 17) : p < 3 ? (g < 2 || g > 11) : true;
  for (let p = 0; p < 7; p++) for (let g = 0; g < 18; g++) if (has(p, g)) R(1 + g * cw, 1 + p * ch, cw - .12, ch - .12, g === 0 ? C[0] : g === 1 ? C[1] : g < 12 ? C[2] : g === 17 ? C[5] : C[3 + (g % 3)]);
  for (let r = 0; r < 2; r++) for (let g = 0; g < 14; g++) R(3.4 + g * cw, 8 + r * .7, cw - .12, .6, C[g % 2 ? 6 : 4]);
};
// ---- two more neon signs (the existing tube renderer: polylines in sign units, a halo, a hot core, a rare flicker) ----
{
  NEON.neon_claude = { c: '#ff8a5c', c2: '#ffd9c4', w: 16, h: 9, s: [
    [Array.from({ length: 11 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 1.6 : 3.8; return [4.2 + Math.cos(a) * r, 4 + Math.sin(a) * r]; })], [[[.5, 8.4], [15.6, 8.4]], 1], // a plain star, not the Claude spark
    [[[9.2, 7.3], [11, .8], [12.8, 7.3]]], [[[9.9, 5], [12.1, 5]], 1], [[[14.6, .8], [14.6, 7.3]]] ] };
  NEON.neon_bug = { c: '#6bff9a', c2: '#d8ffe4', w: 8, h: 11, s: [
    [[[4, 3.6], [5.6, 4.4], [6.2, 6.4], [5.4, 8.6], [4, 9.6], [2.6, 8.6], [1.8, 6.4], [2.4, 4.4]], 0, 1], [[[3, 3], [3.4, 1.9], [4.6, 1.9], [5, 3]]], [[[3.4, 1.9], [2.4, .4]]], [[[4.6, 1.9], [5.6, .4]]],
    [[[1.9, 5], [.4, 4]]], [[[1.8, 6.6], [.2, 6.8]]], [[[2.2, 8.2], [.6, 9.8]]], [[[6.1, 5], [7.6, 4]]], [[[6.2, 6.6], [7.8, 6.8]]], [[[5.8, 8.2], [7.4, 9.8]]], [[[4, 4.2], [4, 9]], 1]] };
  vwl('neon_claude', 'Neon AI', [2, 1], 2, 'Wall', { neon: true }); vwl('neon_bug', 'Neon bug', [1, 1], 2, 'Wall', { neon: true });
}
// ---- desk-top pieces: sprites (RSPR), plus SURF_FX overlays for the animated ones: fx(b = [x, y, w, h] of the sprite, c, it) ----
const SURF_FX = {};
const vs = (id, label, rows, pal, o) => { rsp(id, rows, pal); vsf(id, label, { hz: rows.length + 1, ...o }); };
vs('bonsai', 'Bonsai', ['..gGGg..', '.gGgGGg.', 'gGGgGGGg', '.gGGgGg.', '...tt...', '...tt...', '.dDDDDd.', '.dDDDDd.', '..dddd..'], { g: '#3d7349', G: '#69aa72', t: '#6e4630', d: '#5b6b7a', D: '#7d8ea0' }, { multi: true });
vs('headphones', 'Headphones', ['..hhhh..', '.hH..Hh.', 'h......h', 'hc....ch', 'cMM..MMc', 'cMM..MMc', '.cc..cc.'], { h: '#b9c0d0', H: '#e6eaf2', c: '#2b2833', M: '@main' }, { multi: true });
vs('pizza_box', 'Pizza box', ['.tttttt.', '.tttttt.', 'cppppppc', 'cpRpRppc', 'cppppRpc', 'cccccccc'], { t: '#b8945f', c: '#d9b98a', p: '#f0c040', R: '#c2413a' }, { multi: true, shelf: false });
vs('energy_drink', 'Energy drink', ['.ssss.', 'sKKKKs', 'sKYYKs', 'sKYYKs', 'sKKKKs', 'sKYYKs', 'sKKKKs', '.ssss.'], { s: '#9aa3b2', K: '#15141a', Y: '#9bff3c' }, { multi: true });
vs('snow_globe', 'Snow globe', ['..cccc..', '.cwwwwc.', 'cwwwwwwc', 'cwwrrwwc', 'cwrrrrwc', 'cwwbbwwc', '.cccccc.', 'nnnnnnnn', '.nnnnnn.'], { c: '#bfe3f7', w: '#e8f4fb', r: '#c2413a', b: '#8a5a3c', n: '#6e4630' }, { shelf: true });
vs('lava_lamp', 'Lava lamp', ['..bb..', '.cccc.', '.gggg.', '.gggg.', '.gggg.', '.gggg.', '.gggg.', '..bb..', '.bbbb.', 'bbbbbb'], { b: '#3a3746', c: '#8a8597', g: '#8f3a78' }, { shelf: true });
vs('rubik', "Rubik's cube", ['RRGGBB', 'RRGGBB', 'WWYYOO', 'WWYYOO', 'BBRRGG', 'BBRRGG'], { R: '#e0473c', G: '#2f9a5a', B: '#3b82f6', W: '#f4f6f8', Y: '#ffd23f', O: '#ff9a3c' }, { multi: true });
vs('speaker_small', 'Smart speaker', ['..rrrr..', '.cCCCCc.', 'ccccccc.', 'ccMMMMcc', 'ccMMMMcc', 'ccccccc.', '.cccccc.'].map(r => r.slice(0, 8).padEnd(8, '.')), { r: '#6a6882', c: '#4a4858', C: '#5a5870', M: '#34323f' }, { shelf: true });
vs('laptop', 'Laptop', ['.kkkkkk.', '.kBBBBk.', '.kBBBBk.', '.kBBBBk.', '.kkkkkk.', 'ssssssss', '.gggggg.'], { k: '#b3adbf', B: '#10141c', s: '#d9d4e2', g: '#8e889c' }, { shelf: false });
vs('french_press', 'French press', ['...kk..', '...kk..', '..tttt.', '.cGGGch', '.cGdGcH', '.cGddch', '.cGddc.', '.bbbbb.'], { k: '#15141a', t: '#2b2833', c: '#cfe8ff', G: '#dff0ff', d: '#6e4630', h: '#15141a', H: '#15141a', b: '#2b2833' }, { shelf: true });
vs('fishbowl', 'Fishbowl', ['.cccccc.', 'c.wwww.c', 'cwwwwwwc', 'cwwwwwwc', 'cwwwwwwc', 'cwwwwwwc', '.cwwwwc.', '..cccc..'].map(r => r.slice(0, 8)), { c: '#bfe3f7', w: '#6fb4e8' }, { shelf: false });
vs('hourglass', 'Hourglass', ['wwwwwwww', '.cGGGGc.', '..cGGc..', '...cc...', '..cGGc..', '.cGGGGc.', 'wwwwwwww'], { w: '#8a5a3c', c: '#d8ecf8', G: '#eaf6fd' }, { shelf: true });
vs('lego', 'Brick model', ['..rr..rr', '.rrrr.rr', 'yyyyyyyy', 'yYyYyYyY', 'bbbbbbgg', 'bBbBbBgg', 'bbbbbbgg'].map(r => r.slice(0, 8).padEnd(8, '.')), { r: '#e0473c', y: '#ffd23f', Y: '#e0b82a', b: '#3b82f6', B: '#2b62c0', g: '#2f9a5a' }, { multi: true });
vs('binoculars', 'Binoculars', ['.kk..kk.', 'kaakkaak', 'kaakkaak', 'kaaBBaak', 'kLLkkLLk', '.kk..kk.'], { k: '#2b2833', a: '#7d6a55', B: '#5a4a3a', L: '#8fc8ee' }, { multi: true });
vs('compass', 'Compass', ['..cccc..', '.cwwwwc.', 'cwwrwwwc', 'cwwrrwwc', 'cwwwbwwc', '.cwwwwc.', '..cccc..'], { c: '#c9a23a', w: '#f4efe6', r: '#e0473c', b: '#3b82f6' }, { multi: true });
vs('microscope', 'Microscope', ['..ee......', '..eEa.....', '.ttTaaa...', '.ttTTaaa..', '.ttT..aaa.', '.ttT...aaA', '.lLL...aaA', '.mMM...aaA', 'ssssss..aA', 'SSSSSS..aA', '..y.....aA', 'gggggggggg', 'GGGGGGGGGG'].map(r => r.slice(0, 10).padEnd(10, '.')), { e: '#e4e0ec', E: '#9a94a8', t: '#f0ebe0', T: '#b9b2a4', l: '#2f2c3a', L: '#5a566c', m: '#9aa0af', a: '#6d7d92', A: '#465468', s: '#d3d6df', S: '#8b8fa0', y: '#ffe08a', g: '#6a677e', G: '#3f3c52' }, { shelf: false });
vs('beaker', 'Bubbling beaker', ['.ccccc.', '.c...c.', '.c...c.', 'cLLLLLc', 'cLLLLLc', 'cLLLLLc', 'ccccccc'], { c: '#dff0ff', L: '#62d96a' }, { multi: true });
vs('candle', 'Candle', ['.f.', '.k.', 'cCc', 'cCc', 'cCc', 'cCc', 'ddd'], { f: '#ffd23f', k: '#3a3746', c: '#f4efe6', C: '#e2dccf', d: '#8a8597' }, { multi: true });
vs('incense', 'Incense', ['..s..', '..s..', '.s...', '.s...', 'bbbbb', 'bBBBb'], { s: '#6e4630', b: '#8a5a3c', B: '#6e4630' }, { multi: true });
vs('game_controller', 'Game controller', ['.kkkkkk.', 'kwKkkbBk', 'wwwKkRkY', 'kwKkkGkk', 'kk....kk'], { k: '#3a3746', w: '#cfd5e0', K: '#2b2833', b: '#3b82f6', B: '#3b82f6', R: '#e0473c', Y: '#ffd23f', G: '#2f9a5a' }, { multi: true });
vs('succulent', 'Succulent', ['.g.gg.', 'gGgGgG', '.gGGg.', '..gg..', '.tttt.', '..tt..'], { g: '#5fa86b', G: '#9bd0a0', t: '#b8643c' }, { multi: true });
vs('tea_set', 'Tea set', ['.t.....', 'ttt.cc..', 'wwwwwcc.', 'bbbbwccc', 'bbbbwcc.', '.bbbb...'].map(r => r.padEnd(8, '.')), { t: '#3b6aa3', w: '#f4efe6', b: '#4f86c6', c: '#f4efe6' }, {});
vs('vinyl_stack', 'Vinyl stack', ['..wwww..', '.wkkkkw.', 'wkkMMkkw', '.wkkkkw.', '..wwww..', 'yyyyyyyy', 'YYYYYYYY', 'bbbbbbbb', 'BBBBBBBB', 'rrrrrrrr'], { w: '#8a86a3', k: '#1a1822', M: '@main', y: '#e8c14a', Y: '#b8952a', b: '#4fb3ff', B: '#2f7ac4', r: '#e0473c' }, { multi: true });
vs('trophy_gold', 'Gold trophy', ['yyyyyyyy', 'YyyYYyyY', 'Y.yyyy.Y', '.YyyyyY.', '..yyyy..', '...yy...', '...yy...', '..bbbb..', '.bBBBBb.'], { y: '#f0b92c', Y: '#fff1a8', b: '#5e3d27', B: '#7a4e2e' }, {});
SURF_FX.snow_globe = (b, c) => { if (!c.lit) return; for (let i = 0; i < 6; i++) { const f = (c.t * .7 + i * .37) % 1; R(b[0] + 2 + (i * 7 % 5) + Math.sin(f * 6 + i), b[1] + 1 + f * 4, .5, .5, '#ffffff'); } };
SURF_FX.lava_lamp = (b, c) => { for (const [k, col, r] of [[0, '#ff9fd0', 1], [1.7, '#ffb3de', .8], [3.1, '#ff8ac4', 1.1]]) { const p = (Math.sin(c.t * .35 + k) * .5 + .5), y = b[1] + 2.5 + (1 - p) * 4.5; ell(b[0] + 3 + Math.sin(c.t * .5 + k) * .6, y, r + .7, r + .8, col); } if (c.lit) c.glows.push([[b[0] + 3, b[1] + 5], 11, '255,110,190', .05 + .09 * c.n]); };
SURF_FX.speaker_small = (b, c) => { const p = Math.sin(c.t * 4) * .5 + .5; R(b[0] + 2, b[1], 4, .6, 'rgba(90,220,255,' + (.45 + .5 * p).toFixed(2) + ')'); if (c.lit) c.glows.push([[b[0] + 4, b[1] + 1], 7, '90,220,255', .03 + .05 * p]); };
SURF_FX.laptop = (b, c) => { if (!c.lit) return; for (let i = 0; i < 3; i++) { const len = 2 + (Math.floor(c.t * 2 + i * 3) % 4); R(b[0] + 2, b[1] + 1.5 + i, len, .5, i === 1 ? '#7fd0ff' : '#4ade80'); } if (Math.floor(c.t * 2) % 2) R(b[0] + 5.5, b[1] + 3, .5, .6, '#f4efe6'); c.glows.push([[b[0] + 4, b[1] + 2], 8, '110,170,255', .03 + .05 * c.n]); };
SURF_FX.fishbowl = (b, c) => { const dir = Math.sin(c.t * .8) > 0 ? 1 : -1, x = b[0] + 4 + Math.sin(c.t * .8) * 2.4, y = b[1] + 4 + Math.sin(c.t * 1.3) * .8; R(x, y, 1.5, 1, '#ff9a3c'); R(x - dir * 1, y, 1, 1, '#ff6b3c'); dot(x + (dir > 0 ? 1 : 0), y, '#15141a', .5); for (let i = 0; i < 2; i++) { const p = (c.t * .4 + i * .5) % 1; R(b[0] + 5 - i * 2 + Math.sin(p * 7), b[1] + 6 - p * 5, .5, .5, 'rgba(235,248,255,.85)'); } };
SURF_FX.hourglass = (b, c) => { const p = (c.t % 24) / 24, up = 1 - p, X0 = b[0], Y0 = b[1], S1 = '#e8c14a'; if (up > .15) R(X0 + 3, Y0 + 2, 2, 1, S1); if (up > .55) R(X0 + 2, Y0 + 1, 4, 1, S1); if (p > .15) R(X0 + 2, Y0 + 5, 4, 1, S1); if (p > .55) R(X0 + 3, Y0 + 4, 2, 1, S1); if (p < .97) R(X0 + 3.5, Y0 + 3, 1, 1, S1); };
SURF_FX.beaker = (b, c) => { for (let i = 0; i < 3; i++) { const p = (c.t * .6 + i * .33) % 1; R(b[0] + 2 + i + Math.sin(p * 8 + i) * .4, b[1] + 5 - p * 4.5, .5, .5, 'rgba(200,255,205,' + (1 - p * .6).toFixed(2) + ')'); } if (c.lit) c.glows.push([[b[0] + 3, b[1] + 5], 8, '100,240,120', .04 + .05 * c.n]); };
SURF_FX.candle = (b, c) => { const f = Math.sin(c.t * 13 + c.seed) * .4; R(b[0] + 1 + f * .4, b[1] - 1, 1, 1, '#ffb347'); R(b[0] + 1, b[1], 1, 1, '#ffd23f'); if (c.lit) c.glows.push([[b[0] + 1.5, b[1]], 10, '255,190,100', .06 + .05 * Math.abs(f) + .08 * c.n]); for (let i = 0; i < 2; i++) { const p = (c.t * .5 + i * .5) % 1; R(Math.round(b[0] + 1 + Math.sin(p * 7 + i)), b[1] - 2 - p * 7, .5, .5, 'rgba(235,235,245,' + (.4 * (1 - p)).toFixed(2) + ')'); } };
SURF_FX.incense = (b, c) => { R(b[0] + 1, b[1] - .5, .6, .6, Math.floor(c.t * 3) % 3 ? '#ff6a3c' : '#ffb347'); for (let i = 0; i < 3; i++) { const p = (c.t * .35 + i / 3) % 1; R(Math.round(b[0] + 1 + Math.sin(p * 9 + i * 2) * (1 + p * 2)), b[1] - 2 - p * 11, .6, .6, 'rgba(225,225,240,' + (.5 * (1 - p)).toFixed(2) + ')'); } };
// the server's catalogue is the authority: pieces it lets you place up to 3 of (cheap ones), or turn when the art is the same from both sides, must not be refused by the editor
for (const id of ['bonsai_big', 'coat_rack', 'poster_space', 'poster_cat', 'poster_motivate', 'dartboard', 'calendar', 'acoustic_panel', 'string_lights', 'blueprint', 'ivy', 'periodic_table', 'snow_globe', 'lava_lamp', 'speaker_small', 'laptop', 'french_press', 'fishbowl', 'hourglass', 'microscope', 'tea_set', 'trophy_gold']) if (IDEF['room.' + id]) IDEF['room.' + id].multi = true;
for (const id of ['punching_bag', 'robot_vacuum', 'rug_hex', 'map_table', 'zen_sand', 'coat_rack']) if (IDEF['room.' + id]) IDEF['room.' + id].rots = [0, 1];
// shop category of any room item (old pieces by name and layer, v3 pieces by V3CAT)
function roomCat(id) {
  if (V3CAT[id]) return V3CAT[id]; const d = IDEF[id]; if (!d) return 'Furniture';
  if (d.layer === 'wall') return 'Wall'; if (d.layer === 'surface') return 'Desk-top'; if (d.flat) return 'Rugs';
  const n = id.slice(5); if (/^(plant|cactus|bonsai)/.test(n)) return 'Plants'; if (n === 'server_rack' || n === 'coffee_machine') return 'Tech'; if (n === 'arcade' || n === 'aquarium') return 'Fun & games';
  return 'Furniture';
}
// @@items-end
