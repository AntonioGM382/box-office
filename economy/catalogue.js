'use strict';
// The catalogue: tiers, items (hats, colours, themes, desks, bosses, room items incl. the V3 tables), room grids, achievements, and pure item / room-key lookups. No state.
const { S2_PER_BEAN, now, pad } = require('./config');

const DEFAULTS = { hat: 'none', color: '#2dd4bf', theme: 'purple' };
const TIERS = {
  T: { name: 'Trinket', beans: 10, gems: 0 }, S: { name: 'Starter', beans: 25, gems: 0 }, B: { name: 'Basic', beans: 60, gems: 0 }, C: { name: 'Common', beans: 100, gems: 0 }, R: { name: 'Rare', beans: 250, gems: 0 },
  E: { name: 'Epic', beans: 600, gems: 0 }, L: { name: 'Legendary', beans: 1500, gems: 50 }, M: { name: 'Mythic', beans: 4000, gems: 200 }, G: { name: 'Gem-only', beans: 0, gems: 0 },
};

// ---------- catalogue: prices follow the plan's ladder (10 / 25 / 60 / 100 / 250 / 600 / 1.500 / 4.000; L and M also cost Gems) ----------
const ITEMS = [];
const addItem = (id, cat, tier, art, extra = {}) => {
  const t = TIERS[tier];
  ITEMS.push({ id, cat, tier: t ? tier : 'free', beans: t ? t.beans : 0, gems: t ? t.gems : 0, tokens: t ? t.beans * S2_PER_BEAN : 0, gemOnly: false, event: null, art, free: !t, ...extra });
};
// HATS ARE FREE IN EVERY MODE (owner ruling): item.free is the one rule (FREE_IDS -> ownsL, the shop, checkWorkerFields, buy). The tier below is the
// price hats USED to have: it is kept only so old 'buy' ledger lines still match the catalogue price in verify() (no refunds, no history change).
// Nothing shows it: catalogueView() (index.js) presents every free item with price 0 and tier 'free'.
addItem('hat.none', 'hat', 'free', 'none', { value: 'none' });
for (const [h, tier] of [['cap', 'C'], ['glasses', 'C'], ['headphones', 'C'], ['party', 'R'], ['crown', 'E'],
  ['beanie', 'C'], ['hardhat', 'C'], ['chef', 'C'], ['tophat', 'R'], ['cowboy', 'R'], ['propeller', 'R'], ['pirate', 'R'], ['wizard', 'E'], ['viking', 'E'], ['astronaut', 'L'], ['halo', 'L']]) {
  const label = { hardhat: 'Hard hat', chef: 'Chef toque', tophat: 'Top hat', propeller: 'Propeller cap', pirate: 'Pirate tricorne', astronaut: 'Astronaut helmet' }[h];
  addItem('hat.' + h, 'hat', tier, h, { value: h, free: true, ...(label ? { label } : {}) });
}
for (const [a, tier] of [['tie', 'S'], ['bowtie', 'S'], ['badge', 'S'], ['scarf', 'B'], ['mustache', 'C'], ['glasses', 'C']]) addItem('accessory.' + a, 'accessory', tier, a, { value: a });
addItem('color.2dd4bf', 'color', 'free', 'swatch', { value: '#2dd4bf' }); // the default body colour (the Pixel mascot's teal)
addItem('color.d97757', 'color', 'free', 'swatch', { value: '#d97757' }); // the old default, kept free so existing workers keep their colour
const SWATCH_S = ['#e0a13a', '#5ec27a', '#4fb3d9', '#7c83ff', '#c084fc', '#f472b6', '#e5e7eb', '#ef6b6b'];
const SWATCH_X = ['#f97316', '#facc15', '#a3e635', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e',
  '#78716c', '#94a3b8', '#1e293b', '#fca5a5', '#fdba74', '#fde68a', '#bef264', '#99f6e4', '#93c5fd', '#c4b5fd', '#f9a8d4', '#a16207'];
for (const hex of SWATCH_S.concat(SWATCH_X)) addItem('color.' + hex.slice(1), 'color', 'S', 'swatch', { value: hex });
for (const g of ['sunset', 'ocean', 'forest', 'berry', 'ember', 'twilight']) addItem('color.grad-' + g, 'color', 'E', 'fx', { value: 'fx:grad-' + g, special: 'gradient', label: 'Gradient ' + g });
for (const m of ['gold', 'chrome', 'copper']) addItem('color.' + m, 'color', 'L', 'fx', { value: 'fx:' + m, special: 'metal', label: 'Metallic ' + m });
addItem('color.rainbow', 'color', 'G', 'fx', { value: 'fx:rainbow', special: 'rainbow', gemOnly: true, gems: 600, label: 'Rainbow cycle' });
addItem('color.holo', 'color', 'G', 'fx', { value: 'fx:holo', special: 'holo', gemOnly: true, gems: 1200, label: 'Holo shimmer' });
addItem('color.hexpicker', 'color', 'M', 'picker', { noEquip: true, label: 'Hex picker unlock' }); // after this, minting any colour is free
addItem('theme.purple', 'theme', 'free', 'purple', { value: 'purple' });
for (const [th, tier, label] of [['teal', 'C'], ['wood', 'C'], ['mint', 'C'], ['sunset', 'R'], ['midnight', 'R'], ['sakura', 'R'], ['library', 'R'], ['terminal', 'E', 'Terminal'], ['beach', 'E'], ['snow', 'E', 'Snow cabin'], ['space', 'L', 'Space station'], ['neon', 'L', 'Neon city']]) addItem('theme.' + th, 'theme', tier, th, { value: th, ...(label ? { label } : {}) });
addItem('nameTag.plain', 'nameTag', 'free', 'plain');
for (const [s, tier] of [['plate', 'S'], ['wood', 'S'], ['chalk', 'B'], ['silver', 'C'], ['gold', 'R'], ['pixel', 'R'], ['neon', 'E']]) addItem('nameTag.' + s, 'nameTag', tier, s);
addItem('desk.standard', 'desk', 'free', 'standard', { label: 'Standard oak' });
// Desk skins (design decision): a finish per room (equipped per worker:/cwd: key, slot deskSkin); the subagent mini-desks use the room's skin.
for (const [d, tier, label] of [['walnut', 'S', 'Walnut'], ['laminate', 'S', 'White laminate'], ['bamboo', 'B', 'Bamboo'], ['candy', 'B', 'Candy pastel'], ['steel', 'C', 'Industrial steel'], ['retro', 'C', 'Retro 80s'], ['glass', 'R', 'Glass'], ['gaming', 'R', 'Gaming RGB'], ['gold', 'R', 'Gold executive']]) addItem('desk.' + d, 'desk', tier, d, { label });
addItem('boss.suit', 'boss', 'free', 'suit', { label: 'Classic suit' });
// Coordinator skins (same request): sprite, shout bubble and signature entrance are drawn client-side (office.js BOSS_SKINS); the equipped skin is global.
for (const [b, tier, label] of [['hoodie', 'S', 'Casual Friday CEO'], ['referee', 'B', 'Referee'], ['sergeant', 'B', 'Drill sergeant'], ['pirate', 'C', 'Pirate captain'], ['knight', 'C', 'Knight'], ['robot', 'R', 'Robot overseer'], ['wizard', 'R', 'Wizard headmaster'], ['space', 'E', 'Space commander']]) addItem('boss.' + b, 'boss', tier, b, { label });
addItem('boss.cat', 'boss', 'G', 'cat', { gemOnly: true, gems: 400, label: 'Cat in a suit' });
// Room builder v2.1 (design decision: isometric pixel rooms + decoratable subagent cubicles). Layout format
//   { v:2.1, grid:{w,h}, items:[{ uid, itemId, layer:'floor'|'surface'|'wall', x, y, rot, wall?, slot?, row?, onUid?, cu?, cv? }] }
// floor: x,y = back corner tile of the footprint (size [w,d], swapped on odd rot) · wall: wall + slot (first column) + row (bottom row),
// the item spans size[0] columns and size[1] rows (x = slot, y = row) · surface: stands on the host `onUid` (an item with `surf` rects:
// desks, bookshelf, tables, wall shelf) at cell cu,cv of the host's local frame, footprint fp [a,b] cells. The desk is default furniture:
// when a layout has no desk-kind item the grid's desk kind stands at its default spot (uid 'desk'), so it can move but never go away;
// the monitor and keyboard likewise sit at the desk kind's default cells unless the layout moves them (uids 'monitor' / 'keyboard').
// Grids: rooms (worker:<id>, cwd:<path>) 8x8 tiles, both back walls 8 slots, the door (left wall slots 5-6) and the window (right wall
// slots 3-4) reserved; cubicles (agent:<type lowercased>, one layout per subagent type) 4x4 tiles (3x3 until 30-09-2026: every old position is still valid), 3 wall slots on the right partition (was 2; the old slots 0-1 are unchanged).
// v2.1 (design decision): walls have rows (0 low, 1 mid, 2 high) and reserved CELLS ({c0,c1,r0,r1} inclusive), the desk is a
// desk KIND (room.desk 3x2 in rooms, room.desk_compact 2x2 in cubicles), surfaces are 1/4-tile cells (`cell`: 4 per tile).
// `reserved` (whole columns) is the v2 view, kept only to migrate v1 layouts; the v2.1 rules use reservedCells.
const ISO = {
  room: { w: 8, h: 8, walls: { left: 8, right: 8 }, rows: 3, reserved: { left: [5, 6], right: [3, 4] }, reservedCells: { left: [{ c0: 5, c1: 6, r0: 0, r1: 2 }], right: [{ c0: 3, c1: 4, r0: 1, r1: 2 }] }, window: { wall: 'right', slot: 3, w: 2 }, desk: { itemId: 'room.desk', x: 3, y: 1, rot: 0 }, cell: 4 },
  cube: { w: 4, h: 4, walls: { left: 0, right: 3 }, rows: 2, reserved: { left: [], right: [] }, reservedCells: { left: [], right: [] }, window: null, desk: { itemId: 'room.desk_compact', x: 1, y: 1, rot: 0 }, cell: 4 },
};
// Legacy v1 grids (front view), kept to validate old-format PUTs and to migrate old layouts:
// floor 10x6, wall 10x2, 6 desk-top cells (4 on the desk top, 2 on top of the monitor), one window slot.
// Reserved: the desk + chair block (cols 3-7, rows 1-3) and the fixed plant (col 0, rows 4-5) on the floor; the built-in window (cols 0-2) and status light (col 9, row 0) on the wall.
const ROOM = {
  floor: { w: 10, h: 6 }, wall: { w: 10, h: 2 }, desk: { cells: 6 }, window: { slots: 1 },
  floorReserved: [{ x: 3, y: 1, w: 5, h: 3, why: 'desk' }, { x: 0, y: 4, w: 1, h: 2, why: 'plant' }],
  wallReserved: [{ x: 0, y: 0, w: 3, h: 2, why: 'window' }, { x: 9, y: 0, w: 1, h: 1, why: 'status light' }],
  front: { y: 4, x0: 3, x1: 7 },            // at least one of these floor cells stays free so the worker is never walled in
  cap: { base: Number(process.env.ECONOMY_ROOM_CAP_BASE) || 20, step: 5, gems: [100, 200, 400] }, // (the env override is for tests only)
  cubeCap: { base: Number(process.env.ECONOMY_CUBE_CAP_BASE) || 10, step: 2, gems: [50, 100, 200, 400, 800] }, // subagent cubicles (4x4): 10 objects, +2 per Gem step, max 20 (the first three step prices are the old ones)
  multiMax: 3, maxEntries: 60, maxRooms: 400,
};
// v2.1 fields: layer, size ([w,d] tiles for floor items, [cols, rows] for wall items), rots (0 = as drawn, 1 = mirrored with the footprint
// swapped, 2/3 = the back views of 4-way items; for surface items rot is a mirror flip, fp never swaps), surf (host: [u0,v0,u1,v1) cell
// rects on top, host = 1), fp ([a,b] cells of a surface item), shelf (may stand on a wall host), deskOnly (only on the desk), desk (a desk
// kind: uid 'desk', at most one, with defaults for the monitor and keyboard), row (a wall item's default row), flat (rugs: walkable, never
// block), winSkin (sits on the fixed window). v1 fields (area, fp, rot under `v1`) exist only on the 12 starter items: old-format layouts
// are still validated with them.
const addRoom = (id, label, tier, v2, v1, extra = {}) => addItem('room.' + id, 'room', tier, id, { label, rots: [0], host: 0, flat: false, multi: false, counts: true, ...v2, ...(v2.surf ? { host: 1 } : {}), ...(v1 ? { v1 } : {}), ...extra });
const V1 = (area, fp, rot = [0]) => ({ area, fp, rot });
const DESK_TOP = [[0, 4, 12, 8]], DESK_DEF = { monitor: { cu: 2, cv: 4, rot: 0 }, keyboard: { cu: 5, cv: 4, rot: 0 } };
addRoom('desk', 'Desk', 'free', { layer: 'floor', size: [3, 2], rots: [0, 1], surf: DESK_TOP, desk: true, defaults: DESK_DEF, counts: false }, null, { fixed: true, hidden: true });
addRoom('desk_compact', 'Compact desk', 'free', { layer: 'floor', size: [2, 2], rots: [0, 1], surf: [[0, 4, 8, 8]], desk: true, defaults: { monitor: { cu: 0, cv: 4, rot: 0 }, keyboard: { cu: 4, cv: 4, rot: 0 } }, counts: false }, null, { fixed: true, hidden: true });
addRoom('monitor', 'Monitor', 'free', { layer: 'surface', fp: [2, 2], rots: [0, 1], deskOnly: true, counts: false }, null, { fixed: true, hidden: true });
addRoom('keyboard', 'Keyboard', 'free', { layer: 'surface', fp: [2, 1], rots: [0], deskOnly: true, counts: false }, null, { fixed: true, hidden: true });
const SMALL = { layer: 'surface', fp: [2, 2], shelf: true, multi: true };
addRoom('mug', 'Coffee mug', 'T', { ...SMALL, rots: [0, 1] }, V1('surface', [1, 1], [0, 2]));
addRoom('sticky', 'Sticky notes', 'T', SMALL, V1('surface', [1, 1]));
addRoom('cactus', 'Cactus', 'T', SMALL, V1('surface', [1, 1]));
addRoom('duck', 'Rubber duck', 'S', { ...SMALL, rots: [0, 1] }, V1('surface', [1, 1], [0, 2]));
addRoom('plant_small', 'Small plant', 'S', SMALL, V1('surface', [1, 1]));
addRoom('poster_works', 'Poster: it works on my machine', 'S', { layer: 'wall', size: [1, 1], row: 1 }, V1('wall', [1, 2]));
addRoom('clock', 'Wall clock', 'B', { layer: 'wall', size: [1, 1], row: 2 }, V1('wall', [1, 1]));
addRoom('lamp_desk', 'Desk lamp', 'B', { layer: 'surface', fp: [2, 2], shelf: false, rots: [0, 1] }, V1('surface', [1, 1]));
addRoom('frame_landscape', 'Framed landscape', 'B', { layer: 'wall', size: [2, 1], row: 1 }, V1('wall', [2, 1]));
addRoom('lamp_floor', 'Floor lamp', 'B', { layer: 'floor', size: [1, 1], rots: [0, 1] }, V1('floor', [1, 1], [0, 2]));
addRoom('window_city', 'Window scenery: city', 'C', { layer: 'wall', size: [2], row: 1, winSkin: true, counts: false }, V1('window', [3, 2]));
addRoom('rug_round', 'Round rug', 'C', { layer: 'floor', size: [3, 3], flat: true, counts: false }, V1('floor', [3, 2]));
// the iso set (design decision: common and mid items, 10 to 100 Beans)
addRoom('beanbag', 'Bean bag', 'S', { layer: 'floor', size: [1, 1], rots: [0, 1] });
addRoom('table_side', 'Side table', 'S', { layer: 'floor', size: [1, 1], surf: [[0, 0, 4, 4]] });
addRoom('plant_tall', 'Monstera', 'B', { layer: 'floor', size: [1, 1] });
addRoom('rug_square', 'Square rug', 'B', { layer: 'floor', size: [2, 3], rots: [0, 1], flat: true, counts: false });
addRoom('rug_stripe', 'Striped rug', 'B', { layer: 'floor', size: [3, 2], rots: [0, 1], flat: true, counts: false });
addRoom('bookshelf', 'Bookshelf', 'B', { layer: 'floor', size: [1, 2], rots: [0, 1], surf: [[0, 0, 4, 8]] });
addRoom('whiteboard', 'Whiteboard', 'B', { layer: 'wall', size: [2, 1], row: 1 });
addRoom('sofa', 'Sofa', 'C', { layer: 'floor', size: [2, 1], rots: [0, 1, 2, 3] });
addRoom('neon', 'Neon sign', 'C', { layer: 'wall', size: [2, 1], row: 2 });
addRoom('coffee_machine', 'Coffee machine', 'C', { layer: 'floor', size: [1, 1], rots: [0, 1] });
addRoom('arcade', 'Arcade cabinet', 'C', { layer: 'floor', size: [1, 1], rots: [0, 1] });
addRoom('aquarium', 'Aquarium', 'C', { layer: 'floor', size: [2, 1], rots: [0, 1] });
addRoom('server_rack', 'Server rack', 'C', { layer: 'floor', size: [1, 1], rots: [0, 1] });
// the v2.1 set (design decision): trinkets, a wall shelf, neon signs, seating, tables and two desk kinds
for (const [id, label, tier] of [['trophy', 'Trophy', 'S'], ['books', 'Book stack', 'T'], ['figurine', 'Pixel figurine', 'S'], ['photo', 'Photo frame', 'T']]) addRoom(id, label, tier, { ...SMALL, rots: [0, 1] });
addRoom('wall_shelf', 'Wall shelf', 'S', { layer: 'wall', size: [2, 1], row: 1, surf: [[0, 0, 8, 2]] });
for (const [id, label, tier, cols] of [['neon_code', 'Neon sign: </>', 'B', 2], ['neon_coffee', 'Neon sign: coffee cup', 'B', 1], ['neon_heart', 'Neon sign: heart', 'B', 1], ['neon_onair', 'Neon sign: ON AIR', 'C', 2], ['neon_bolt', 'Neon sign: lightning', 'B', 1]]) addRoom(id, label, tier, { layer: 'wall', size: [cols, 1], row: 2 });
// seating comes in sets (chairs round a table): up to 3 of each, like the desk trinkets; the gaming chair stays one per room
for (const [id, label, tier, rots, multi] of [['chair_office', 'Office chair', 'S', null, 1], ['chair_cafe', 'Café chair', 'S', null, 1], ['stool', 'Stool', 'T', [0], 1], ['armchair', 'Armchair', 'B', null, 1], ['chair_gaming', 'Gaming chair', 'C']]) addRoom(id, label, tier, { layer: 'floor', size: [1, 1], rots: rots || [0, 1, 2, 3], multi: !!multi });
addRoom('table_coffee', 'Coffee table', 'B', { layer: 'floor', size: [2, 1], rots: [0, 1], surf: [[0, 0, 8, 4]] });
addRoom('table_cafe', 'Round café table', 'S', { layer: 'floor', size: [1, 1], surf: [[0, 0, 4, 4]] });
addRoom('desk_l', 'L-desk', 'C', { layer: 'floor', size: [3, 3], rots: [0, 1], surf: [[0, 8, 12, 12], [8, 0, 12, 8]], desk: true, defaults: { monitor: { cu: 8, cv: 3, rot: 1 }, keyboard: { cu: 4, cv: 8, rot: 0 } }, counts: false });
addRoom('desk_standing', 'Standing desk', 'B', { layer: 'floor', size: [3, 2], rots: [0, 1], surf: DESK_TOP, desk: true, defaults: DESK_DEF, counts: false });
// ---- v3 expansion (docs/ITEMS_V3.json): 42 floor, 18 wall, 24 surface items. Price ladder -> tier; cheap (<= 25) items are multi (3 copies); flat = walkable rug layer (never counts toward the cap) ----
const V3_FLOOR = [
  ["plant_fern", "Fern", 'S', [1,1]],
  ["cactus_tall", "Tall cactus", 'S', [1,1]],
  ["bonsai_big", "Big bonsai", 'B', [1,1]],
  ["fridge_mini", "Mini fridge", 'B', [1,1], "host"],
  ["water_cooler", "Water cooler", 'S', [1,1], "anim"],
  ["vending", "Vending machine", 'C', [1,1], "anim"],
  ["printer", "Printer", 'B', [1,1], "anim"],
  ["filing_cabinet", "Filing cabinet", 'S', [1,1], "host"],
  ["locker", "Locker", 'S', [1,1]],
  ["guitar_stand", "Guitar on a stand", 'B', [1,1]],
  ["drum_kit", "Drum kit", 'R', [2,2]],
  ["piano", "Upright piano", 'R', [2,1]],
  ["treadmill", "Treadmill desk", 'C', [2,1], "anim"],
  ["punching_bag", "Punching bag", 'B', [1,1], "anim"],
  ["yoga_mat", "Yoga mat", 'S', [2,1], "flat"],
  ["pool_table", "Pool table", 'R', [3,2]],
  ["foosball", "Foosball table", 'C', [2,1]],
  ["ping_pong", "Ping-pong table", 'R', [3,2]],
  ["hammock", "Hammock", 'C', [2,1], "anim"],
  ["telescope", "Telescope", 'C', [1,1]],
  ["globe", "Floor globe", 'S', [1,1]],
  ["easel", "Painting easel", 'B', [1,1]],
  ["pet_cat", "Cat", 'C', [1,1], "anim"],
  ["pet_dog", "Dog", 'C', [1,1], "anim"],
  ["robot_vacuum", "Robot vacuum", 'B', [1,1], "anim"],
  ["fireplace", "Fireplace", 'R', [2,1], "anim"],
  ["xmas_tree", "Christmas tree", 'B', [1,1], "anim"],
  ["rug_persian", "Persian rug", 'C', [3,2], "flat"],
  ["rug_hex", "Hex rug", 'S', [2,2], "flat"],
  ["couch_l", "L-shaped couch", 'C', [3,2]],
  ["printer_3d", "3D printer", 'C', [1,1], "anim"],
  ["whiteboard_stand", "Standing whiteboard", 'B', [1,1]],
  ["desk_gaming", "Gaming desk", 'C', [3,2], "desk"],
  ["map_table", "Map table", 'C', [2,2], "host"],
  ["bench_lab", "Lab bench", 'C', [2,1], "host"],
  ["zen_sand", "Zen sand garden", 'B', [2,2], "flat"],
  ["koi_pond", "Koi pond", 'R', [2,2], "anim flat"],
  ["speaker_tower", "Speaker tower", 'B', [1,1], "anim"],
  ["record_player", "Record player cabinet", 'B', [1,1], "anim host"],
  ["arcade_racer", "Racing arcade", 'R', [1,2], "anim"],
  ["bookshelf_tall", "Tall bookshelf", 'B', [1,2], "host"],
  ["coat_rack", "Coat rack", 'T', [1,1]],
];
const V3_WALL = [
  ["poster_space", "Space poster", 'S', 1, 1],
  ["poster_cat", "Cat poster", 'S', 1, 1],
  ["poster_motivate", "Motivational poster", 'S', 1, 1],
  ["tv_wall", "Wall TV", 'C', 2, 1, "anim"],
  ["dartboard", "Dartboard", 'S', 1, 1],
  ["guitar_wall", "Wall guitar", 'B', 1, 1],
  ["map_world", "World map", 'B', 2, 1],
  ["calendar", "Calendar", 'T', 1, 2],
  ["kanban", "Kanban board", 'B', 2, 1],
  ["acoustic_panel", "Acoustic panel", 'T', 1, 1],
  ["string_lights", "String lights", 'S', 2, 2, "anim"],
  ["clock_cuckoo", "Cuckoo clock", 'B', 1, 2, "anim"],
  ["neon_claude", "Neon AI", 'C', 2, 2, "anim"],
  ["neon_bug", "Neon bug", 'B', 1, 2, "anim"],
  ["blueprint", "Blueprint", 'S', 2, 1],
  ["gold_record", "Gold record", 'B', 1, 1],
  ["ivy", "Hanging ivy", 'S', 1, 2, "anim"],
  ["periodic_table", "Periodic table", 'S', 2, 1],
];
const V3_SURF = [
  ["bonsai", "Bonsai", 'S'],
  ["headphones", "Headphones", 'T'],
  ["pizza_box", "Pizza box", 'T'],
  ["energy_drink", "Energy drink", 'T'],
  ["snow_globe", "Snow globe", 'S', "anim"],
  ["lava_lamp", "Lava lamp", 'B', "anim"],
  ["rubik", "Rubik's cube", 'T'],
  ["speaker_small", "Smart speaker", 'S', "anim"],
  ["laptop", "Laptop", 'S', "anim"],
  ["french_press", "French press", 'S'],
  ["fishbowl", "Fishbowl", 'B', "anim"],
  ["hourglass", "Hourglass", 'S', "anim"],
  ["lego", "Brick model", 'S'],
  ["binoculars", "Binoculars", 'T'],
  ["compass", "Compass", 'T'],
  ["microscope", "Microscope", 'B'],
  ["beaker", "Bubbling beaker", 'S', "anim"],
  ["candle", "Candle", 'T', "anim"],
  ["incense", "Incense", 'T', "anim"],
  ["game_controller", "Game controller", 'T'],
  ["succulent", "Succulent", 'T'],
  ["tea_set", "Tea set", 'S'],
  ["vinyl_stack", "Vinyl stack", 'T'],
  ["trophy_gold", "Gold trophy", 'B'],
];
const V3_SURF_RECTS = {
  "fridge_mini": [[0, 0, 4, 4]],
  "filing_cabinet": [[0, 0, 4, 4]],
  "record_player": [[0, 0, 4, 4]],
  "map_table": [[0, 0, 8, 8]],
  "bench_lab": [[0, 0, 8, 4]],
  "bookshelf_tall": [[0, 0, 4, 8]],
};
for (const [id, label, tier, size, fl = ''] of V3_FLOOR) {
  const f = fl.split(' '), flat = f.includes('flat'), desk = f.includes('desk'), cheap = TIERS[tier].beans <= 25 && !f.includes('anim'), still = /^(plant_fern|cactus_tall|bonsai_big|pet_cat|pet_dog|globe|xmas_tree|koi_pond)$/.test(id), four = id === 'piano' || id === 'couch_l';
  addRoom(id, label, tier, { layer: 'floor', size, rots: four ? [0, 1, 2, 3] : still ? [0] : [0, 1], multi: (cheap || id === 'bonsai_big' || id === 'speaker_tower') && !desk, ...(flat ? { flat: true, counts: false } : {}), ...(V3_SURF_RECTS[id] ? { surf: V3_SURF_RECTS[id] } : {}),
    ...(desk ? { surf: DESK_TOP, desk: true, counts: false, defaults: { monitor: { cu: 3, cv: 4, rot: 0 }, keyboard: { cu: 6, cv: 4, rot: 0 } } } : {}) }, null, f.includes('anim') ? { anim: true } : {});
}
for (const [id, label, tier, cols, row, fl = ''] of V3_WALL) addRoom(id, label, tier, { layer: 'wall', size: [cols, 1], row, multi: TIERS[tier].beans <= 25 }, null, fl.includes('anim') ? { anim: true } : {});
for (const [id, label, tier, fl = ''] of V3_SURF) addRoom(id, label, tier, { ...SMALL, rots: [0, 1], ...(/^(laptop|microscope|pizza_box)$/.test(id) ? { shelf: false } : {}) }, null, fl.includes('anim') ? { anim: true } : {});
const ROOM_ITEMS = ITEMS.filter(i => i.cat === 'room'), ROOM_BY_ID = Object.fromEntries(ROOM_ITEMS.map(i => [i.id, i]));
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const isFree = item => !!(item && item.free); // the single rule: free items are owned by everyone, in every mode
const FREE_IDS = new Set(ITEMS.filter(isFree).map(i => i.id));
// "any colour is an item": buying color.hex with {hex} mints color.<rrggbb> at the mint price and it is owned from then on
const MINT_RE = /^color\.[0-9a-f]{6}$/, MINT_BEANS = TIERS.C.beans;
const mintItem = id => ({ id, cat: 'color', tier: 'C', beans: MINT_BEANS, gems: 0, tokens: MINT_BEANS * S2_PER_BEAN, gemOnly: false, event: null, art: 'swatch', free: false, value: '#' + id.slice(6), minted: true });
const itemById = id => ITEM_BY_ID[id] || (MINT_RE.test(String(id)) ? mintItem(String(id)) : null);

// ---------- achievements (plan 5.1 / 5.2 / 5.3 rows that need only counters, transcripts and office actions) ----------
const ACHIEVEMENTS = [
  { id: 'clocked-in', name: 'Clocked in', desc: 'First active day', metric: 'activeDays', target: 1, reward: { beans: 50 } },
  { id: 'first-subagent', name: 'First subagent', desc: 'First subagent transcript', metric: 'subagents', target: 1, reward: { beans: 25 } },
  { id: 'first-workflow', name: 'First workflow', desc: 'First workflow run', metric: 'workflows', target: 1, reward: { beans: 100, gems: 10 } },
  { id: 'first-hire', name: 'First hire', desc: 'First worker hired through the office', metric: 'hires', target: 1, reward: { beans: 100 } },
  { id: 'interior-designer', name: 'Interior designer', desc: 'First item equipped', metric: 'equips', target: 1, reward: { beans: 25 } },
  { id: 'access-denied', name: 'Access denied', desc: 'First coordinator block', metric: 'coordBlocks', target: 1, reward: { beans: 50 } },
  { id: 'model-sommelier', name: 'Model sommelier', desc: 'Opus, Sonnet, Haiku and Fable in one Mon-Sun week', metric: 'sommelierWeeks', target: 1, reward: { beans: 100 } },
  { id: '100m-club', name: '100M club', desc: 'Lifetime S2 of 100M', metric: 'lifetimeS2', target: 1e8, reward: { beans: 100 } },
  { id: 'billionaire', name: 'Billionaire', desc: 'Lifetime S2 of 1B', metric: 'lifetimeS2', target: 1e9, reward: { beans: 600, gems: 50, items: ['color.holo'] } },
  { id: '10b-legend', name: '10B legend', desc: 'Lifetime S2 of 10B', metric: 'lifetimeS2', target: 1e10, reward: { items: ['decor.trophy-mythic'] } },
  { id: 'staffing-agency', name: 'Staffing agency', desc: '100 subagents', metric: 'subagents', target: 100, reward: { beans: 250 } },
  { id: 'outsourcing-king', name: 'Outsourcing king', desc: '1.000 subagents', metric: 'subagents', target: 1000, reward: { beans: 600, gems: 50 } },
  { id: 'big-day', name: 'Big day', desc: 'One day with 50M S2', metric: 'maxDayS2', target: 5e7, reward: { beans: 250 } },
  { id: 'workflow-week', name: 'Workflow week', desc: '5 workflows in one Mon-Sun week', metric: 'maxWeekWorkflows', target: 5, reward: { beans: 250 } },
  { id: 'boss-shouted', name: 'Boss shouted', desc: '10 coordinator denials', metric: 'coordBlocks', target: 10, reward: { beans: 100, items: ['decor.megaphone'] } },
  { id: 'middle-manager', name: 'Middle manager', desc: '100 coordinator denials', metric: 'coordBlocks', target: 100, reward: { items: ['boss.stressed'] } },
  { id: 'talk-to-the-hand', name: 'Talk to the hand', desc: '5 subagents retried on Sonnet after a block', metric: 'sonnetRetries', target: 5, reward: { beans: 100 } },
  { id: 'golden-ticket', name: 'Golden ticket', desc: '10 [opus-ok] bypasses', metric: 'opusOk', target: 10, reward: { items: ['decor.poster-golden-ticket'] } },
  { id: 'rubber-stamp', name: 'Rubber stamp', desc: '50 Approve clicks', metric: 'approves', target: 50, reward: { beans: 100 } },
  { id: 'micromanager', name: 'Micromanager', desc: '100 Deny clicks', metric: 'denies', target: 100, reward: { items: ['nameTag.micromanager'] } },
  { id: 'night-owl', name: 'Night owl', desc: 'Work after 22:00 on 3 days', metric: 'nightOwlDays', target: 3, reward: { items: ['decor.poster-moon'] } },
];
function itemForField(field, v) {
  if (v == null) return null;
  const s = String(v);
  if (field === 'hat') return 'hat.' + s;
  if (field === 'theme') return 'theme.' + s;
  if (field === 'color') { if (/^#[0-9a-f]{6}$/i.test(s)) return 'color.' + s.slice(1).toLowerCase(); const m = /^fx:([a-z0-9-]+)$/.exec(s); return m ? 'color.' + m[1] : null; } // #hex, or a special finish 'fx:<name>'
  return null;
}

function eventOpen(ev) {
  if (!ev) return true;
  const d = new Date(now()), md = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return ev.from <= ev.to ? md >= ev.from && md <= ev.to : md >= ev.from || md <= ev.to;
}
const isCube = key => String(key).startsWith('agent:');
const gridOf = key => (isCube(key) ? ISO.cube : ISO.room);
const capCfg = key => (isCube(key) ? ROOM.cubeCap : ROOM.cap);
Object.assign(module.exports, { DEFAULTS, TIERS, ITEMS, ISO, ROOM, ROOM_BY_ID, ITEM_BY_ID, FREE_IDS, isFree, MINT_RE, MINT_BEANS, mintItem, itemById, ACHIEVEMENTS, itemForField, eventOpen, isCube, gridOf, capCfg });
