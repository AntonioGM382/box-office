'use strict';
// isometric renderer, item catalogue: IDEF / idef / inSurf
// (split from the former iso.js; classic scripts share one global scope, load order: iso-core, iso-catalog, iso-items, iso-room, iso-team, then items.js)
// ---- item catalogue (mirrors economy.js v2.1; the server is the authority on every rule) ----
// floor: size [w, d] tiles · wall: size [cols, rows], row = default row · surface: fp [a, b] cells (1/4 tile), shelf = may stand on a
// wall shelf, deskOnly = the desk only · hosts: surf = [[u0, v0, u1, v1]] cell rects on the top, top = its z · desk kinds: desk,
// seat = where the worker sits (local tiles), dflt = where the monitor and keyboard stand until they are moved.
const WOOD = '#9a6a45', DARKW = '#6e4630', INKY = '#262431';
const IDEF = {};
const idef = (id, o) => { IDEF['room.' + id] = { id: 'room.' + id, rots: [0], host: 0, flat: false, multi: false, counts: true, hz: 8, ...o }; if (o.surf) IDEF['room.' + id].host = 1; };
const D_STD = { monitor: { cu: 2, cv: 4, rot: 0 }, keyboard: { cu: 5, cv: 4, rot: 0 } };
idef('desk', { label: 'Desk', layer: 'floor', size: [3, 2], rots: [0, 1], counts: false, fixed: true, desk: true, hz: 18, top: 8.5, surf: [[0, 4, 12, 8]], seat: [1.5, .55], dflt: D_STD });
idef('desk_compact', { label: 'Compact desk', layer: 'floor', size: [2, 2], rots: [0, 1], counts: false, fixed: true, desk: true, hz: 18, top: 8.5, surf: [[0, 4, 8, 8]], seat: [1.1, .55], dflt: { monitor: { cu: 0, cv: 4, rot: 0 }, keyboard: { cu: 4, cv: 4, rot: 0 } } });
idef('desk_standing', { label: 'Standing desk', layer: 'floor', size: [3, 2], rots: [0, 1], counts: false, fixed: true, desk: true, stand: true, hz: 24, top: 15, surf: [[0, 4, 12, 8]], seat: [1.5, .6], dflt: D_STD });
idef('desk_l', { label: 'L-desk', layer: 'floor', size: [3, 3], rots: [0, 1], counts: false, fixed: true, desk: true, hz: 18, top: 8.5, surf: [[0, 8, 12, 12], [8, 0, 12, 8]], seat: [1.15, 1.05], dflt: { monitor: { cu: 8, cv: 3, rot: 1 }, keyboard: { cu: 4, cv: 8, rot: 0 } } });
idef('monitor', { label: 'Monitor', layer: 'surface', fp: [2, 2], rots: [0, 1], counts: false, fixed: true, deskOnly: true, hz: 10 });
idef('keyboard', { label: 'Keyboard', layer: 'surface', fp: [2, 1], rots: [0], counts: false, fixed: true, deskOnly: true, hz: 1 });
for (const [id, label, rots, multi, shelf] of [['mug', 'Coffee mug', [0, 1], 1, 1], ['sticky', 'Sticky notes', [0], 1, 1], ['cactus', 'Cactus', [0], 1, 1], ['duck', 'Rubber duck', [0, 1], 1, 1], ['plant_small', 'Small plant', [0], 1, 1], ['lamp_desk', 'Desk lamp', [0, 1], 0, 0],
  ['trophy', 'Trophy', [0, 1], 1, 1], ['books', 'Book stack', [0, 1], 1, 1], ['figurine', 'Pixel figurine', [0, 1], 1, 1], ['photo', 'Photo frame', [0, 1], 1, 1]]) idef(id, { label, layer: 'surface', rots, multi: !!multi, shelf: !!shelf, spr: id, fp: [2, 2] });
idef('poster_works', { label: 'Poster: it works on my machine', layer: 'wall', size: [1, 1], row: 1, spr: 'poster_works' });
idef('clock', { label: 'Wall clock', layer: 'wall', size: [1, 1], row: 2 });
idef('frame_landscape', { label: 'Framed landscape', layer: 'wall', size: [2, 1], row: 1, spr: 'frame_landscape' });
idef('window_city', { label: 'Window scenery: city', layer: 'wall', size: [2, 1], row: 1, winSkin: true, counts: false });
idef('whiteboard', { label: 'Whiteboard', layer: 'wall', size: [2, 1], row: 1, spr: 'whiteboard' });
idef('wall_shelf', { label: 'Wall shelf', layer: 'wall', size: [2, 1], row: 1, surf: [[0, 0, 8, 2]], top: 1.5 });
for (const [id, label, cols] of [['neon', 'Neon sign: CODE', 2], ['neon_code', 'Neon sign: </>', 2], ['neon_coffee', 'Neon sign: coffee cup', 1], ['neon_heart', 'Neon sign: heart', 1], ['neon_onair', 'Neon sign: ON AIR', 2], ['neon_bolt', 'Neon sign: lightning', 1]]) idef(id, { label, layer: 'wall', size: [cols, 1], row: 2, neon: true });
idef('lamp_floor', { label: 'Floor lamp', layer: 'floor', size: [1, 1], rots: [0, 1], hz: 23 });
idef('rug_round', { label: 'Round rug', layer: 'floor', size: [3, 3], flat: true, counts: false, hz: 1 });
idef('rug_square', { label: 'Square rug', layer: 'floor', size: [2, 3], rots: [0, 1], flat: true, counts: false, hz: 1 });
idef('rug_stripe', { label: 'Striped rug', layer: 'floor', size: [3, 2], rots: [0, 1], flat: true, counts: false, hz: 1 });
idef('beanbag', { label: 'Bean bag', layer: 'floor', size: [1, 1], rots: [0, 1], hz: 8 });
idef('table_side', { label: 'Side table', layer: 'floor', size: [1, 1], hz: 8.2, top: 8.2, surf: [[0, 0, 4, 4]] });
idef('table_coffee', { label: 'Coffee table', layer: 'floor', size: [2, 1], rots: [0, 1], hz: 5.5, top: 5.5, surf: [[0, 0, 8, 4]] });
idef('table_cafe', { label: 'Round café table', layer: 'floor', size: [1, 1], hz: 10, top: 10, surf: [[0, 0, 4, 4]] });
idef('plant_tall', { label: 'Monstera', layer: 'floor', size: [1, 1], hz: 24 });
idef('bookshelf', { label: 'Bookshelf', layer: 'floor', size: [1, 2], rots: [0, 1], hz: 26, top: 26, surf: [[0, 0, 4, 8]] });
idef('sofa', { label: 'Sofa', layer: 'floor', size: [2, 1], rots: [0, 1, 2, 3], hz: 12 });
for (const [id, label, rots, hz, multi] of [['chair_office', 'Office chair', [0, 1, 2, 3], 14, 1], ['chair_cafe', 'Café chair', [0, 1, 2, 3], 14, 1], ['stool', 'Stool', [0], 8, 1], ['armchair', 'Armchair', [0, 1, 2, 3], 12, 1], ['chair_gaming', 'Gaming chair', [0, 1, 2, 3], 18]]) idef(id, { label, layer: 'floor', size: [1, 1], rots, hz, multi: !!multi });
idef('coffee_machine', { label: 'Coffee machine', layer: 'floor', size: [1, 1], rots: [0, 1], hz: 18 });
idef('arcade', { label: 'Arcade cabinet', layer: 'floor', size: [1, 1], rots: [0, 1], hz: 25 });
idef('aquarium', { label: 'Aquarium', layer: 'floor', size: [2, 1], rots: [0, 1], hz: 18 });
idef('server_rack', { label: 'Server rack', layer: 'floor', size: [1, 1], rots: [0, 1], hz: 27 });
const isDesk = id => !!(IDEF[id] && IDEF[id].desk);
// cells of a surface footprint inside a host's rects? (the server's OUT_OF_BOUNDS rule)
const inSurf = (hd, cu, cv, a, b) => { for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) if (!hd.surf.some(r => cu + i >= r[0] && cu + i < r[2] && cv + j >= r[1] && cv + j < r[3])) return false; return true; };
