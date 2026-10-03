'use strict';
// isometric renderer, the team: subagent strip, hot desks, the Team tab
// (split from the former iso.js; classic scripts share one global scope, load order: iso-core, iso-catalog, iso-items, iso-room, iso-team, then items.js)
// ================= subagents: the team strip under a room card, the Team tab in the drawer =================
// The card is always just the office at its normal scale. While subagents work, a slim TEAM STRIP hangs under the room: the same floor and
// wall as the room's theme, a row of hot desks (a fixed slot each, evenly spread, a second row instead of shrinking), the mini worker at
// every desk with its tool bubble, a type stripe and a name tag. The full building (the office and a row of small rooms, one per agent)
// is the drawer's Team tab (below). Both read the same pods (syncPods in office.js): { id, a (the agent), ord, born, gone }.
const agentRoomOf = type => { const ar = state && state.economy && state.economy.agentRooms; return ar && ar[String(type || 'agent').toLowerCase()] ? { v: 2, rev: 1, ...ar[String(type || 'agent').toLowerCase()] } : null; };
const DONE_RE = /^(done|completed|finished|stopped)$/i;
Object.assign(BFONT, { '/': '001001010100100', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000' });
const ease = f => f * f * (3 - 2 * f);
// the look + motion of a pod's mini worker while it fades in / out (workflow seats): working / quiet / done
function podLook(pd, t, look) {
  const a = pd.a || {}, age = t - pd.born, g = pd.gone != null ? t - pd.gone : -1;
  const done = DONE_RE.test(a.status || ''), busy = !done && !/^idle$/i.test(a.status || '');
  let fade = 1, wA = 1, wy = 0, portal = 0;
  if (g >= 0) { fade = clamp(1 - g / .7, 0, 1); wA = clamp(1 - g / .35, 0, 1); wy = -Math.round(clamp(g / .35, 0, 1) * 8); portal = g < .2 ? g / .2 : g < .45 ? 1 : clamp(1 - (g - .45) / .2, 0, 1); }
  else if (age < .8) { fade = clamp(age / .3, 0, 1); wA = age < .15 ? 0 : 1; wy = -Math.round((1 - clamp((age - .15) / .3, 0, 1)) * 8); portal = age < .2 ? age / .2 : age < .55 ? 1 : clamp(1 - (age - .55) / .2, 0, 1); }
  const quiet = quietSec(a) > 0, settled = g < 0 && age >= .55, kind = done ? 'done' : quiet ? '' : toolKind(a.tool), working = busy && settled && !quiet;
  const col = look && look.color != null ? look.color : typeColor(a.type);
  return { a, done, busy, quiet, settled, kind, working, fade, W: { st: working ? 'working' : 'idle', tool: a.tool, col, hat: look ? look.hat : 'none', acc: look ? look.acc : null, alpha: wA, dy: wy, portal, seed: (pd.ord * 3 + 1) % 10 } };
}
// the tool bubble over a mini worker (device px; c = bubble cell size)
function podBubbleAt(tipX, tipY, kind, busy, t, i, c) {
  const ic = ICONS[kind], cols = [0, '#5b5470', WHITE, INK, '#c4633f', '#2f9a5a'];
  if (ic) { const g = speechGrid(ic, null, 1, 'C'); g.lit = -1; gdraw(g, tipX - Math.round((g.tipX + .5) * c), Math.max(1, tipY - g.h * c), c, cols); }
  else placeBubble(cloudGrid(true, 'L'), cloudGrid(true, 'R'), tipX, tipY, c, X.canvas.width, cols, busy ? Math.floor(t * 3 + i) % 3 : -1);
}
// ---- walking helpers (art units): polylines, a position along one, things carried, a walking copy of the worker ----
function polyLen(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; }
function along(pts, L, f) {
  if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], dx: 0 };
  const d = clamp(f, 0, 1) * L[L.length - 1]; let i = 1; while (i < L.length - 1 && L[i] < d) i++;
  const a = pts[i - 1], b = pts[i], s = L[i] - L[i - 1], u = s > 1e-6 ? clamp((d - L[i - 1]) / s, 0, 1) : 1;
  return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, dx: (b[0] - a[0]) - (b[1] - a[1]) }; // dx: the screen direction (x - y)
}
function drawCarry(kind, x, y, k) {
  if (kind === 'folder') { R(x, y - .75 * k, 2 * k, .75 * k, '#d9a94a'); R(x, y, 4.5 * k, 3.5 * k, '#e3b95a'); R(x + .5 * k, y + .5 * k, 3.5 * k, .5 * k, '#f3d58c'); R(x, y + 3 * k, 4.5 * k, .5 * k, '#a8812e'); }
  else { R(x, y - .5 * k, 4 * k, 4.5 * k, '#f7f4ec'); R(x + 3.5 * k, y - .5 * k, .5 * k, 4.5 * k, '#c9c2b3'); for (let i = 0; i < 3; i++) R(x + .75 * k, y + .4 * k + i * 1.1 * k, (2.5 - (i === 2 ? 1 : 0)) * k, .4 * k, '#8e889c'); }
}
// a walking (or standing) copy of the worker, feet at art point (fx, fy); returns the carry point (for the hand-offs)
function drawWalker(w, fx, fy, lk, t, k) {
  if (w.portal > 0) drawIsoPortal(fx, fy - 7 * k, w.portal, t);
  if (w.a <= 0) return null;
  const x0 = Math.round((fx - 6 * k) * S) / S, y0 = Math.round((fy - 10 * k) * S) / S;
  X.globalAlpha = w.a; softShadow(fx, fy, 5 * k, 1.3 * k, .3);
  sprite(x0, y0, k, 'walk', t, lk.seed, lk.col, lk.hat, lk.acc, w.look || 0, 0, w.step, false);
  if (w.carry) drawCarry(w.carry, x0 + 9.5 * k, y0 + 4.5 * k, k);
  X.globalAlpha = 1;
  return [x0 + 9.5 * k, y0 + 4.5 * k];
}
// ================= the hot desk (strip): a 2 x 1.6 tile desk, the chair behind it; cached in two layers so the worker can sit between them =====
const HD_T = { x: 0, y: 0, r: 0, sw: 2, sd: 1.6, gw: 2, gd: 1.6, z: 0 }, HD_HT = { x: 0, y: .7, r: 0, sw: 2, sd: .9, gw: 2, gd: .9, z: 0 };
const HD_KB = { uid: 'kb', itemId: 'room.keyboard', layer: 'surface', cu: 4, cv: 1, rot: 0 }, HD_MON = { uid: 'mon', itemId: 'room.monitor', layer: 'surface', cu: 0, cv: 0, rot: 0 };
const HD_OX = 15, HD_OY = 19, HD_CW = 34, HD_CH = 35; // the cached layer: origin (the desk's back corner) and size in art units
const HD_SLOT = 38, HD_EDGE = 6, STRIP_MAX = 6, HD_AISLE = 15; // slot = the narrowest a desk gets; the aisle runs HD_AISLE below the back corner
const HD_CC = () => ({ t: 0, n: 0, work: false, lit: false, glows: [], pools: [], main: '#888', seed: 0 });
function hdLayer(part, stripe, skin) {
  const c = offCanvas('hd|' + part + '|' + S + '|' + (stripe || '') + '|' + (part === 'front' && skin ? String(skin) : ''), HD_CW, HD_CH);
  if (!c._fresh) return c;
  paintOff(c, () => {
    RW = HD_CW; F = { g: ISO_G.cube, OX: HD_OX, OY: HD_OY, H: 0 }; const T = HD_T, hdef = IDEF['room.desk_compact'];
    if (part === 'back') {
      poly([P(-.12, -.1), P(2.12, -.1), P(2.12, 1.72), P(-.12, 1.72)], 'rgba(0,0,0,.16)'); poly([P(.06, .1), P(1.94, .1), P(1.94, 1.58), P(.06, 1.58)], 'rgba(0,0,0,.14)');
      deskChair(T, 1, .42, true); lbox(T, .64, .32, .08, .36, 5.6, 2.2, '#27243a'); lbox(T, 1.28, .32, .08, .36, 5.6, 2.2, '#27243a');
    } else {
      const pw = .6, K = deskPal(skin);
      drawBoxes(T, [[.04, .76, .1, .8, 0, 7, K.leg], [2 - pw - .04, .76, pw, .8, 0, 7, K.ped], [.14, .8, 2 - pw - .2, .08, 2.4, 4.6, K.rail]]);
      for (let d = 0; d < 3; d++) { lface(T, '+v', 1.56, 2 - pw + .04, 1.9, 1 + d * 2.1, 1.3 + d * 2.1, K.drawer); lface(T, '+v', 1.56, 2 - pw / 2 - .1, 2 - pw / 2 + .06, 2 + d * 2.1, 2.4 + d * 2.1, K.handle); }
      lbox(T, 0, .7, 2, .9, 7, 1.5, K.top); deskExtras(K, T, HD_CC(), 2, .7, 1.6, 8.5, true);
      if (stripe) lface(T, '+v', 1.6, .1, 1.9, 7.15, 8.35, stripe);
      drawSurface(HD_KB, IDEF['room.keyboard'], HD_HT, hdef, HD_CC(), null, {});
    }
  });
  return c;
}
// one hot desk at art point (cx, oy) = its back corner: chair, the worker (seat alpha), the desk, the monitor; returns the head tip (art units) or null
function hotDesk(cx, oy, dA, dy, W, stripe, hov, t, cc) {
  const ox = Math.round(cx), y0 = Math.round(oy + dy), px = Math.round((ox - HD_OX) * S), py = Math.round((y0 - HD_OY) * S);
  X.globalAlpha = dA; X.drawImage(hdLayer('back'), px, py);
  F = { g: ISO_G.cube, OX: ox, OY: y0, H: 0 }; const it = { W };
  if (W.alpha > 0) deskWorker(HD_T, cc, it, 1, .44, 5.6);
  X.drawImage(hdLayer('front', stripe, W.skin), px, py);
  drawSurface(HD_MON, IDEF['room.monitor'], HD_HT, IDEF['room.desk_compact'], cc, null, { W });
  if (hov) poly([P(0, 0), P(2, 0), P(2, 1.6), P(0, 1.6)], 'rgba(183,162,242,.18)');
  X.globalAlpha = 1; return it.head || null;
}
// ---- the strip's backdrop (cached per theme / size): the room's wall on top, its floor below, a door on each side ----
function drawExitArt(th) { const fr = shade(th.trim, .75); R(0, 0, 14, 28, fr); R(1.5, 1.5, 11, 26.5, '#0b0a12'); R(1.5, 1.5, 11, 1.5, shade('#0b0a12', 1.6)); for (let i = 0; i < 6; i++) R(1.5 + i * 2, 18 + i * 1.3, 2, 9.5 - i * 1.3, `rgba(240,230,190,${(.05 + i * .012).toFixed(3)})`); R(1.5, 1.5, .75, 26.5, shade(fr, 1.2)); }
function stripBg(th, theme, Wu, Hu, wb) {
  const c = offCanvas(['sbg', theme, S, Wu, Hu, wb].join('|'), Wu, Hu);
  if (!c._fresh) return c;
  paintOff(c, () => {
    RW = Wu; F = { g: ISO_G.room, OX: 0, OY: wb, H: Hu };
    const alt = mixHex(th.a, th.b, .55), q = .125, ny = Math.ceil((Hu - wb) / 4) + 2;
    for (let s = -2; s <= ny; s++) for (let d = -3; d <= Wu / 8 + 3; d++) {
      if ((s + d) & 1) continue; const x = (s + d) / 2, y = (s - d) / 2, col = (x + y) % 2 ? alt : th.a;
      poly([P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], col); poly([P(x, y), P(x + 1, y), P(x + 1, y + q), P(x, y + q)], shade(col, 1.08)); poly([P(x, y + q), P(x + q, y + q), P(x + q, y + 1), P(x, y + 1)], shade(col, 1.05));
    }
    R(0, wb, Wu, 3, 'rgba(0,0,0,.1)'); R(0, wb, Wu, 1.5, 'rgba(0,0,0,.14)'); R(0, wb, Wu, .75, 'rgba(0,0,0,.16)');
    const RWc = th.wall, sk = shade(th.trim, .62);
    R(0, 0, Wu, wb, RWc); for (let x = 12; x < Wu; x += 12) R(x, 2, .5, wb - 5, shade(RWc, .92));
    R(0, wb - 12, Wu, 1.5, shade(RWc, .84)); R(0, wb - 2.5, Wu, 2.5, shade(sk, .9)); R(0, wb - 3, Wu, .5, shade(th.trim, .85)); R(0, 0, Wu, 1.5, shade(th.trim, .8));
    const d = offCanvas('door|' + theme + '|' + S, 14, 28); paintOff(d, () => drawDoorArt(th));
    const dh = Math.min(28, wb - 1); X.drawImage(d, 0, (28 - dh) * S, d.width, dh * S, Math.round(1 * S), Math.round((wb - dh) * S), d.width, Math.round(dh * S));
    const e = offCanvas('exit|' + theme + '|' + S, 14, 28); paintOff(e, () => drawExitArt(th));
    X.drawImage(e, 0, (28 - dh) * S, e.width, dh * S, Math.round((Wu - 15) * S), Math.round((wb - dh) * S), e.width, Math.round(dh * S));
  });
  return c;
}
// ---- the strip: a pod's motion. Arrive: the desk fades in, the mini worker comes out of the left door with a folder, walks to its desk, sits.
// Finish: it stands up with a report, walks to the right door, hands it over (a puff) and the desk slides away. A page that loads mid-run
// finds everyone seated.
function stripMotion(pd, t, cx, cy, Lg) {
  if (REDUCED.matches) return pd.gone == null ? { deskA: 1, seatA: 1, w: null } : { deskA: 0, seatA: 0, w: null, gone: true }; // reduced motion: seated at once, gone at once
  const inS = pd.stIn || (pd.stIn = {}), wi = Lg.wall + 4, doorL = [Lg.xl, wi], doorR = [Lg.xr, wi], lane = y => y + HD_AISLE;
  const inPts = [doorL, [Lg.lm, lane(cy)], [cx, lane(cy)]];
  if (inS.dur == null) { const L = polyLen(inPts); inS.dur = clamp(L[L.length - 1] / 55, 1.2, 3.2); }
  const inEnd = .25 + inS.dur + .3;
  const enter = a => {
    const L = polyLen(inPts), deskA = ease(clamp(a / .45, 0, 1));
    if (a < .25) return { deskA, seatA: 0, w: { x: doorL[0], y: doorL[1], a: clamp((a - .05) / .2, 0, 1), portal: Math.sin(clamp(a / .25, 0, 1) * Math.PI), carry: 'folder', step: null, look: .7 } };
    if (a < .25 + inS.dur) { const p = along(inPts, L, (a - .25) / inS.dur); return { deskA, seatA: 0, w: { x: p.x, y: p.y, a: 1, carry: 'folder', step: Math.floor(t * 8) % 2, look: Math.sign(p.dx) * .7 } }; }
    const f = clamp((a - .25 - inS.dur) / .3, 0, 1), q = inPts[inPts.length - 1];
    return { deskA: 1, seatA: ease(f), w: { x: q[0], y: q[1], a: 1 - ease(f), carry: f < .5 ? 'folder' : null, step: null, look: 0 } };
  };
  if (pd.gone == null) { const a = t - pd.born; return a < inEnd ? enter(a) : { deskA: 1, seatA: 1, w: null }; }
  if (!pd.stOut || pd.stOut.g !== pd.gone) {
    const g0 = Math.max(pd.gone, pd.born + inEnd), out0 = [cx, lane(cy)], L = polyLen([out0, [Lg.rm, lane(cy)], doorR]), d = clamp(L[L.length - 1] / 55, .8, 3.2);
    pd.stOut = { g: pd.gone, g0, d, end: (g0 - pd.gone) + .3 + d + .55, puff: false };
  }
  const o = pd.stOut, g = t - o.g0;
  if (g < 0) return enter(t - pd.born);
  const y = lane(cy), pts = [[cx, y], [Lg.rm, y], doorR], L = polyLen(pts);
  if (g < .3) return { deskA: 1, seatA: 1 - ease(g / .3), w: { x: cx, y, a: clamp(g / .2, 0, 1), carry: 'report', step: null, look: 0 } };
  if (g < .3 + o.d) { const p = along(pts, L, (g - .3) / o.d); return { deskA: 1, seatA: 0, w: { x: p.x, y: p.y, a: 1, carry: 'report', step: Math.floor(t * 8) % 2, look: Math.sign(p.dx) * .7 } }; }
  const h = g - .3 - o.d, f = clamp(h / .45, 0, 1);
  return { deskA: 1 - ease(f), seatA: 0, deskDy: ease(f) * 8, w: h < .3 ? { x: doorR[0], y: doorR[1], a: 1 - h / .3, portal: Math.sin(clamp(h / .3, 0, 1) * Math.PI), carry: null, step: null, look: -.7 } : null, puff: { x: doorR[0], y: doorR[1] - 4, f: clamp(h / .5, 0, 1) }, gone: g >= .3 + o.d + .4 };
}
// "report delivered": a few sheets and sparks fly out of the door
function drawPuff(p, k) {
  if (!p || p.f >= 1) return;
  for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * .55, r = (2 + p.f * 9) * k, x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r + p.f * p.f * 5 * k; X.globalAlpha = clamp(1.4 - p.f * 1.4, 0, 1); if (i % 2) R(x - k, y - k, 2 * k, 2.4 * k, '#f7f4ec'); else R(x - .5 * k, y - .5 * k, k, k, '#9be3b0'); }
  X.globalAlpha = 1;
}
// ---- the workflow's meeting table (a cell of the strip, three slots wide): a long table seen from the front, the phase agents seated behind it
// in phase order, a place card in their phase colour in front of each ----
function stripMeeting(cx, oy, M, e, t, dpr, cellW, tops, sm, ps, bc) {
  const s = M.strip, wf = s.wf, list = orderPods([...s.pods.values()], wf), nSeat = clamp(Math.floor(cellW / 14), 1, 6), shown = list.slice(0, nSeat), more = list.length - shown.length;
  const lks = shown.map(pd => podLook(pd, t, e.o)), pcol = shown.map(pd => phaseColor(phaseIdx(wf, pd.a), wf)), n = shown.length, sp = 14, x0 = cx - (n - 1) * sp / 2, tw = Math.max(n * sp + 8, 36), tx = Math.round(cx - tw / 2), ty = oy - 1, heads = [];
  softShadow(cx, oy + 12.5, tw / 2 + 2, 2.4, .32);
  shown.forEach((pd, i) => { // chair back, then the worker
    const sx = x0 + i * sp, lk = lks[i], W = lk.W, col = pcol[i], sc = shade(col, .62);
    R(sx - 6.5, oy - 6, 13, 13, sc); R(sx - 6.5, oy - 6, 13, 1, shade(col, .9)); R(sx - 6.5, oy - 6, .75, 13, shade(col, .8)); R(sx + 5.75, oy - 6, .75, 13, shade(col, .45));
    if (W.portal > 0) drawIsoPortal(sx, oy - 4, W.portal, t);
    if (W.alpha > 0) { X.globalAlpha = W.alpha * lk.fade; const xx = Math.round((sx - 6) * S) / S, yy0 = Math.round((oy - 9 + (W.dy || 0)) * S) / S, yy = sprite(xx, yy0, 1, W.st, t, W.seed, W.col, W.hat, W.acc, 0, 0, null, false); X.globalAlpha = 1; heads[i] = [sx, yy - (HAT_UP[W.hat] || 0), xx, yy0]; }
  });
  R(tx + 2, ty + 7, 2.5, 5.5, '#6e4630'); R(tx + tw - 4.5, ty + 7, 2.5, 5.5, '#6e4630'); R(tx + 2, ty + 7, .75, 5.5, '#8a5a3c'); R(tx + tw - 4.5, ty + 7, .75, 5.5, '#8a5a3c');
  R(tx + 1, ty + 3, tw - 2, 4.5, '#8a5a3c'); R(tx + 1, ty + 7, tw - 2, .75, '#5e3d27'); R(tx + 1, ty + 3, tw - 2, .75, '#6e4630');
  R(tx, ty, tw, 3, '#c9925f'); R(tx, ty, tw, .75, '#e6b98b'); R(tx, ty + 2.25, tw, .75, '#a8743f'); R(tx - .75, ty + .75, .75, 1.75, '#a8743f'); R(tx + tw, ty + .75, .75, 1.75, '#a8743f');
  shown.forEach((pd, i) => { const sx = x0 + i * sp, col = pcol[i]; R(sx - 3.5, ty + 3.75, 7, 3, shade(col, .7)); R(sx - 3.25, ty + 4, 6.5, 2.5, col); R(sx - 3.25, ty + 4, 6.5, .5, shade(col, 1.25)); R(sx - 2.5, ty + .6, 3, 1.25, '#f4efe6'); });
  shown.forEach((pd, i) => {
    const h = heads[i], lk = lks[i]; if (!h) return;
    if (lk.settled) tops.push(() => podBubbleAt(Math.round(h[0] * ps), Math.round((h[1] - 1) * ps), lk.kind, lk.busy, t, i, bc));
    if (pd.gone == null) sm.hits.push({ id: pd.id, a: lk.a, x0: (h[2] - 1) * ps / dpr, y0: (h[3] - 2) * ps / dpr, x1: (h[2] + 13) * ps / dpr, y1: (oy + 12) * ps / dpr });
  });
  return { wf, n: list.length, more };
}
// ---- the strip itself ----
function stripGone(pd, e, t) { // when has a pod finished leaving (strip, and the Team tab's longer walk while it is open)?
  if (pd.gone == null) return false; const g = t - pd.gone, watching = typeof teamWatching === 'function' && teamWatching(e);
  return g > Math.max(pd.stOut ? pd.stOut.end : 3.6, watching ? (pd.twEnd || 7.5) : 0) + .05;
}
function drawTeamStrip(e, t, dpr) {
  const s = e.annex, box = s.box, o = e.o, u = e.u || 6;
  for (const [id, pd] of s.pods) if (pd.gone != null && pd.stOut && stripGone(pd, e, t)) s.pods.delete(id); else if (pd.gone != null && !pd.stOut && t - pd.gone > 4) s.pods.delete(id);
  let M = null; for (const W of e.wfs.values()) { if (!M && W.strip.pods.size) M = W; W.strip.hits = []; }
  if (M) for (const [id, pd] of M.strip.pods) if (pd.gone != null && t - pd.gone > .75) M.strip.pods.delete(id);
  const vis = orderPods([...s.pods.values()].filter(p => !p.stDone)), n = vis.length, mN = M ? M.strip.pods.size : 0, total = n + mN;
  if (total) s.holdTo = t + .9;
  const show = total > 0 || t < (s.holdTo || 0);
  if (!show) { if (!box.hidden) { if (s.shown) { s.shown = false; box.style.height = '0px'; s.hideT = setTimeout(() => { if (!s.shown) setHidden(box, true); }, 520); } } return; }
  if (!s.shown) { clearTimeout(s.hideT); s.shown = true; if (box.hidden) { setHidden(box, false); box.style.height = '0px'; void box.offsetHeight; } }
  const Wpx = Math.floor(box.clientWidth * dpr); if (!Wpx) return;
  // scale: the mini worker is at least 60 % of the main worker's height (whole device pixels per art unit)
  const ps = clamp(Math.ceil(u * .62), 2, 8), RWu = Math.floor(Wpx / ps), bc = Math.max(2, Math.round(ps * .75)), bubU = Math.ceil(14 * bc / ps), oy0 = bubU + 14, tagU = Math.ceil(TAG_H * dpr / ps) + 1, rowH = oy0 + HD_AISLE + tagU;
  const perRow = Math.max(1, Math.floor((RWu - 2 * HD_EDGE) / HD_SLOT)), usable = RWu - 2 * HD_EDGE;
  // cells: a desk each (up to STRIP_MAX, the last slot is "+N" beyond that), then the workflow's table (two slots)
  const shownN = n > STRIP_MAX ? STRIP_MAX - 1 : n, moreN = n - shownN, cells = vis.slice(0, shownN).map(pd => ({ pd, w: 1 }));
  if (moreN) cells.push({ more: moreN, w: 1 }); if (M) cells.push({ meet: M, w: Math.min(3, perRow) });
  const totalW = cells.reduce((a, c) => a + c.w, 0), rows = Math.max(1, Math.ceil(totalW / perRow)), target = Math.ceil(totalW / rows), rowsOf = [[]];
  { let acc = 0; for (const c of cells) { if (acc + c.w > target && rowsOf[rowsOf.length - 1].length && rowsOf.length < rows) { rowsOf.push([]); acc = 0; } rowsOf[rowsOf.length - 1].push(c); acc += c.w; } }
  const Hpx = rowsOf.length * rowH * ps, wb = oy0 - 2;
  if (s.wpx !== Wpx || s.hpx !== Hpx || s.dpr !== dpr) { s.wpx = Wpx; s.hpx = Hpx; s.dpr = dpr; s.canvas.width = Wpx; s.canvas.height = Hpx; s.canvas.style.width = (Wpx / dpr) + 'px'; s.canvas.style.height = (Hpx / dpr) + 'px'; s.tagSig = null; if (M) M.strip.tagSig = null; }
  box.style.height = (Hpx / dpr + 1) + 'px';
  X = s.ctx; S = ps; RW = RWu; X.imageSmoothingEnabled = false; X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.clearRect(0, 0, Wpx, Hpx);
  const th = THEMES[o.theme] || THEMES.purple, Hu = rowsOf.length * rowH;
  X.drawImage(stripBg(th, o.theme || 'purple', RWu, Hu, wb), 0, 0);
  // where every cell sits (art units); a pod eases towards its slot so the row closes up smoothly
  const dt = clamp(t - (s.lastT || t), 0, .2); s.lastT = t; const k = 1 - Math.exp(-dt * 9), Lg = { wall: wb, xl: 8, xr: RWu - 8, lm: HD_EDGE - 1, rm: RWu - HD_EDGE + 1 };
  const pos = new Map(), meetAt = [];
  rowsOf.forEach((row, r) => {
    const rw = row.reduce((a, c) => a + c.w, 0), unit = usable / rw; let acc = 0;
    for (const c of row) { const cx = HD_EDGE + (acc + c.w / 2) * unit, oy = oy0 + r * rowH; acc += c.w; c.cx = cx; c.oy = oy; c.unit = unit; if (c.pd) { const p = c.pd; if (p.sx == null) { p.sx = cx; p.sy = oy; } else { p.sx += (cx - p.sx) * k; p.sy += (oy - p.sy) * k; } pos.set(p.id, c); } }
  });
  const cc = { t, n: 0, work: false, lit: false, glows: [], pools: [], main: '#888', seed: 0 }, items = [], hits = [], tops = [], walkers = [], puffs = [], heads = new Map();
  s.hits = hits; const look = { color: o.color, hat: o.hat, acc: o.acc };
  // connectors: a spawned agent is wired to the one that spawned it
  for (const p of vis) { const par = p.a && p.a.parentAgentId != null ? s.pods.get(String(p.a.parentAgentId)) : null; if (!par || par === p || par.sx == null || p.sx == null || p.gone != null || par.gone != null || !pos.has(p.id) || !pos.has(par.id)) continue; const y = Math.round(Math.min(par.sy, p.sy) + 8), x0 = Math.round(Math.min(par.sx, p.sx)), x1 = Math.round(Math.max(par.sx, p.sx)); X.globalAlpha = .85; R(x0, y, x1 - x0, 1, hexA(typeColor(p.a.type), .7)); R(x0, y - .5, x1 - x0, .5, 'rgba(255,255,255,.12)'); X.globalAlpha = 1; }
  // desks, row by row (back to front)
  vis.slice().sort((a, b) => (a.sy || 0) - (b.sy || 0)).forEach(pd => {
    const c = pos.get(pd.id), cx = pd.sx, cy = pd.sy; if (!c && pd.gone == null) return;
    if (!c && pd.gone != null && !pd.stOut) return;
    const a = pd.a || {}, done = DONE_RE.test(a.status || ''), busy = !done && !/^idle$/i.test(a.status || ''), qs = quietSec(a), col = typeColor(a.type);
    const m = stripMotion(pd, t, cx, cy, Lg), seated = m.seatA > .98 && pd.gone == null, working = busy && !qs && seated;
    const W = { st: working ? 'working' : 'idle', tool: a.tool, col: look.color != null ? look.color : col, hat: look.hat, acc: look.acc, alpha: m.seatA, seed: (pd.ord * 3 + 1) % 10, k: 1, skin: o.desk || null };
    if (m.deskA <= .01) { if (m.gone) pd.stDone = true; return; }
    const head = hotDesk(cx, cy, m.deskA, m.deskDy || 0, W, col, hoverKey === s.key + '|' + pd.id, t, cc);
    if (m.w) walkers.push({ m: m.w, pd, look: { seed: (pd.ord * 3 + 1) % 10, col: W.col, hat: look.hat, acc: look.acc } });
    if (m.puff) puffs.push(m.puff);
    if (head && seated) { const kind = done ? 'done' : qs ? '' : toolKind(a.tool); tops.push(() => podBubbleAt(Math.round(head[0] * ps), Math.round((head[1] - 1) * ps), kind, busy, t, pd.ord, bc)); }
    if (pd.gone == null) {
      hits.push({ id: pd.id, a, x0: (cx - 13) * ps / dpr, y0: (cy - 16) * ps / dpr, x1: (cx + 16) * ps / dpr, y1: (cy + HD_AISLE) * ps / dpr });
      items.push({ id: pd.id, x: cx * ps / dpr, y: (cy + HD_AISLE + 1) * ps / dpr, w: Math.max(60, (pos.get(pd.id).unit - 2) * ps / dpr), col, label: agentLabel(a), model: modelKey(a.model), quiet: qs && !done ? fmtQuiet(qs) : '', done });
    }
  });
  // the workflow's table
  let chip = null, moreAt = null; const sm = M ? M.strip : null; if (sm) { sm.hits = []; sm.wf = M.strip.wf; sm.tagBox = s.tagBox; }
  for (const row of rowsOf) for (const c of row) {
    if (c.meet) chip = { c, info: stripMeeting(c.cx, c.oy, c.meet, e, t, dpr, c.w * c.unit - 4, tops, sm, ps, bc) };
    if (c.more) moreAt = { x: c.cx * ps / dpr, y: (c.oy + HD_AISLE * .35) * ps / dpr, n: c.more };
  }
  for (const w of walkers) w.hand = drawWalker({ ...w.m }, w.m.x, w.m.y, w.look, t, 1);
  for (const p of puffs) drawPuff(p, 1);
  for (const f of tops) f();
  // light: the room's night
  const night = o.st === 'offline' ? 0 : dayNow().night; X.globalAlpha = 1;
  if (night > .02) { X.fillStyle = `rgba(10,12,34,${(.34 * night).toFixed(3)})`; X.fillRect(0, 0, Wpx, Hpx); }
  { const vg = X.createLinearGradient(0, 0, 0, Hpx * .22); vg.addColorStop(0, 'rgba(6,5,14,.34)'); vg.addColorStop(1, 'rgba(6,5,14,0)'); X.fillStyle = vg; X.fillRect(0, 0, Wpx, Hpx * .22); }
  if (o.st === 'offline') { X.fillStyle = 'rgba(8,6,22,.5)'; X.fillRect(0, 0, Wpx, Hpx); }
  syncStripTags(s, items, moreAt);
  if (sm) { syncStripTags(sm, [], null); }
  stripChrome(e, s, chip, total, ps, dpr);
}
// DOM over the strip: the caption, the "View subagents" link, the workflow's phase chip
function stripChrome(e, s, chip, total, ps, dpr) {
  if (!s.link) { s.link = document.createElement('button'); s.link.type = 'button'; s.link.className = 'tvl'; s.link.dataset.act = 'team'; s.link.textContent = 'View subagents ›'; s.link.dataset.full = 'Open the Team tab: the office and one small room per subagent'; s.box.appendChild(s.link); }
  if (!s.chipEl) { s.chipEl = document.createElement('span'); s.chipEl.className = 'tchip'; s.tagBox.appendChild(s.chipEl); }
  const nAll = (e.raw && (e.raw.agents || []).length) || total;
  if (s.cap) setText(s.cap, 'Subagents · ' + nAll);
  if (chip && chip.info.wf) {
    const wf = chip.info.wf, pr = wfProgress(wf), ph = (wf.phases || []), act = ph.findIndex(p => p.state === 'active'), i = act >= 0 ? act : Math.max(0, pr.k - 1), col = phaseColor(i, wf);
    setHidden(s.chipEl, false); s.chipEl.style.setProperty('--pc', col); s.chipEl.style.left = (chip.c.cx * ps / dpr) + 'px'; s.chipEl.style.top = ((chip.c.oy + HD_AISLE + 1) * ps / dpr) + 'px';
    setText(s.chipEl, (pr.n ? `PHASE ${pr.k}/${pr.n}` : 'WORKFLOW') + (ph[i] && ph[i].title ? ' · ' + String(ph[i].title) : '') + (chip.info.n ? ` · ${chip.info.n}` : ''));
  } else if (s.chipEl) setHidden(s.chipEl, true);
}
// ================= the Team tab (drawer): the office on the left, then a tidy ROW of small rooms =================
// One room per live subagent (up to TEAM_ROOMS), each a solid-walled cubicle of the office's own theme, decorated per agent TYPE
// (economy snapshot agentRooms[type], else the free default look, both edited in the studio's Cubicles tab). Room k stands at tile
// (8 + k * w, 0): the back wall of the office simply goes on, and a doorway in every room's left wall (the wall is 2 tiles short at the
// front) joins it to the one before. A workflow run gets a meeting room at the end of the row. A new subagent is handed a folder by
// its parent (or at the main desk), walks the row to its chair; when it finishes it walks back with a report, drops it on the desk
// and leaves by the office door. Every part shares the office's grid, so the office's frame places everything.
const TEAM_ROOMS = 6, TEAM_SPEED = 5;
// walls of a room in the row (painted into its cached shell): solid, in the room's own wall colours, the left one stops 2 tiles short of
// the front (a doorway with a jamb) and leaves a threshold on the floor
function teamWalls(g, th, LW, RWc, cap, sk, stripe) {
  const { w, h, wallH: WH } = g, top = stripe || cap, gp = g.gapL, segs = gp ? [[0, gp[0]], [gp[1], h]] : [[0, h]], rail = Math.round(WH * .38);
  poly(wallQuad('right', 0, w, 0, WH), RWc);
  for (let a = 1; a < w; a++) poly(wallQuad('right', a - .02, a + .02, 3, WH - 1), shade(RWc, .92));
  poly(wallQuad('right', 0, w, rail, rail + 1.5), shade(RWc, .84)); poly(wallQuad('right', 0, w, 0, 2.5), shade(sk, .9)); poly(wallQuad('right', 0, w, 2.5, 3), shade(th.trim, .85));
  poly([P(0, 0, WH), P(w, 0, WH), P(w, -.3, WH), P(-.3, -.3, WH)], top); poly([P(w, -.3, -3), P(w, 0, -3), P(w, 0, WH), P(w, -.3, WH)], shade(th.wall, .5));
  for (const [a0, a1] of segs) {
    if (a1 - a0 < .01) continue;
    poly(wallQuad('left', a0, a1, 0, WH), LW);
    for (let a = Math.ceil(a0 + .01); a < a1 - .01; a++) poly(wallQuad('left', a - .02, a + .02, 3, WH - 1), shade(LW, .94));
    poly(wallQuad('left', a0, a1, rail, rail + 1.5), shade(LW, .86)); poly(wallQuad('left', a0, a1, 0, 2.5), sk); poly(wallQuad('left', a0, a1, 2.5, 3), shade(th.trim, .95));
    poly([P(0, a0, WH), P(0, a1, WH), P(-.3, a1, WH), P(-.3, a0, WH)], top);
    if (a1 >= h - .01) poly([P(-.3, h, -3), P(0, h, -3), P(0, h, WH), P(-.3, h, WH)], shade(th.wall, .6)); // the front end of the wall
    else poly([P(-.3, a1, 0), P(0, a1, 0), P(0, a1, WH), P(-.3, a1, WH)], shade(th.wall, .7));             // the wall's end at the doorway: its thickness
  }
  if (gp) poly([P(0, gp[0], 0), P(.25, gp[0], 0), P(.25, gp[1], 0), P(0, gp[1], 0)], shade(th.trim, .72));
}
// the part grids: a room is ISO_G.cube (same cells, so every saved layout fits) with solid walls + a doorway; the meeting room is wider
function teamGrids() {
  const c = ISO_G.cube, key = c.w + 'x' + c.h; let G = teamGrids.c; if (G && G.key === key) return G;
  const gap = [Math.max(0, c.h - 2), c.h], room = { ...c, key: 'cubeT', team: true, gapL: gap, skey: key };
  const mh = Math.max(6, c.h + 2), meet = { key: 'meetT', w: 6, h: mh, wallH: 26, top: 3, walls: { left: 0, right: 5 }, off: { left: 0, right: .5 }, reserved: { left: [], right: [] }, rows: 2, rowZ: [3, 14], rowH: 11, resv: { left: [], right: [] }, window: null, door: null, desk: { itemId: 'room.desk_compact', x: 0, y: 0, rot: 0 }, team: true, gapL: gap, skey: key };
  return (teamGrids.c = { key, room, meet, LY: c.h - .8 });
}
// is this card's Team tab open right now (so leaving pods stay until their long walk is over)?
const teamWatching = e => !!(typeof drawer !== 'undefined' && drawer && !drawer.agent && curTab === 'team' && drawer.kind + drawer.id === e.key);
// which pods stand in which room: stable slots (a pod keeps its room until it has walked out), first come first served, parents before their
// children; the meeting room takes the first workflow run that has agents.
function teamSync(tv, e, t) {
  const pods = e.annex.pods, sl = tv.slots || (tv.slots = new Array(TEAM_ROOMS).fill(null));
  for (let i = 0; i < TEAM_ROOMS; i++) {
    const id = sl[i]; if (id == null) continue; const pd = pods.get(id);
    if (!pd || (pd.gone != null && t - pd.gone > (pd.wo && pd.wo.g === pd.gone ? pd.wo.end : 1))) sl[i] = null;
  }
  for (const pd of orderPods([...pods.values()])) { if (pd.gone != null || sl.includes(pd.id)) continue; const i = sl.indexOf(null); if (i < 0) break; sl[i] = pd.id; pd.tslot = i; }
  let M = null; for (const W of e.wfs.values()) if (!M && W.strip.pods.size > 0) M = W;
  tv.smeet = M;
}
function teamPlan(tv, e) {
  const G = teamGrids(), cw = G.room.w, ch = G.room.h, sl = tv.slots || [], cubes = []; let K = 0;
  for (let i = 0; i < TEAM_ROOMS; i++) if (sl[i] != null) K = i + 1;
  for (let i = 0; i < K; i++) cubes.push({ i, gx: 8 + i * cw, gy: 0, g: { ...G.room, ox: 8 + i * cw, oy: 0, end: i === K - 1 && !tv.smeet }, pd: sl[i] != null ? e.annex.pods.get(sl[i]) : null });
  const cx1 = 8 + K * cw, meet = tv.smeet ? { gx: cx1, gy: 0, g: { ...G.meet, ox: cx1, oy: 0, end: true }, W: tv.smeet } : null, xEnd = meet ? cx1 + G.meet.w : cx1;
  // the rooms only fill the back of the building: a walkway in front of them (the office's depth) makes one slab with a single front line
  const hall = K || meet ? { gx: 8, gy: ch, g: { key: 'hallT', w: xEnd - 8, h: 8 - ch, wallH: 0, top: 3, team: true, hall: true, end: true, ox: 8, oy: ch, skey: G.key } } : null;
  const rects = [[0, 0, 8, 8], ...(hall ? [[8, ch, xEnd, 8]] : []), ...cubes.map(q => [q.gx, 0, q.gx + cw, ch]), ...(meet ? [[cx1, 0, xEnd, G.meet.h]] : [])];
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a, b, c2, d] of rects) { x0 = Math.min(x0, (a - d) * 8); x1 = Math.max(x1, (c2 - b) * 8); y1 = Math.max(y1, (c2 + d) * 4); }
  const B = { x0: x0 - 2, x1: x1 + 3, y0: -(ISO_G.room.wallH + ISO_G.room.top), y1: y1 + 5, tags: cubes.some(q => q.pd) };
  B.sig = [cubes.map(q => q.i + (q.pd ? '' : 'v')).join(''), meet ? 'm' : '', cw, ch, xEnd].join('|');
  return { G, cw, ch, cubes, K, cx1, meet, xEnd, hall, B };
}
// the canvas of the Team tab: the whole row at whole device pixels per art unit (at least 2), centred; wider than the tab -> it scrolls
function fitTeam(tv, dpr) {
  const W = Math.max(1, Math.floor(tv.wrap.clientWidth * dpr)), B = tv.B, bw = B.x1 - B.x0, u = clamp(Math.floor(W / bw), 2, 6), cw = Math.max(W, Math.ceil(bw * u));
  const tagPx = B.tags ? Math.ceil((TAG_H + 8) * dpr) : 0, hpx = Math.ceil((B.y1 - B.y0) * u) + tagPx, OX = Math.round((cw / u - bw) / 2 - B.x0), OY = Math.round(-B.y0);
  tv.u = u; tv.dpr = dpr; tv.wdev = W; tv.so = [OX, OY]; tv.canvas.width = cw; tv.canvas.height = hpx; tv.canvas.style.width = (cw / dpr) + 'px'; tv.canvas.style.height = (hpx / dpr) + 'px'; tv.stage.style.width = (cw / dpr) + 'px';
  for (const s of [tv.sc, tv.sm]) if (s) s.tagSig = null;
}
// where a pod's subagent is right now: null while it sits at its desk (or has left), else a walker
// { x, y (tiles), a (alpha), carry: 'folder' | 'report' | null, step (walk phase | null), look, portal, lift?, pass?, drop? }.
// Enter: the giver lifts a folder (0-.45 s), a copy of the worker pops up at the main desk (or beside its parent's chair) and takes it (.45-.8 s),
// then it walks to its chair. Exit: it stands up with a report, walks back, drops the report on the desk (the paper stack grows) and leaves
// through the office door. A page that loads mid-run finds everyone seated.
const teamOut = (L, Sp) => (L < 0 ? [Sp.D, Sp.M] : Sp.c[L].out);
const teamRoute = (A, B, Sp) => (A === B ? [A < 0 ? Sp.D : Sp.c[A].out[1]] : [...teamOut(A, Sp), ...teamOut(B, Sp).reverse()]);
function podWalker(tv, pd, t, Sp) {
  const me = Sp.c[pd.tslot]; if (!me) return null;
  const parentLoc = () => { const par = pd.a && pd.a.parentAgentId != null ? Sp.pods.get(String(pd.a.parentAgentId)) : null; return par && par.gone == null && par.tslot != null && Sp.c[par.tslot] ? par.tslot : -1; };
  if (!pd.wi || pd.wi.b !== pd.born) { const from = parentLoc(), pts = [...teamRoute(from, pd.tslot, Sp), me.seat], L = polyLen(pts); pd.wi = { b: pd.born, hand: t - pd.born < 1.5, from, pts, L, dur: clamp(L[L.length - 1] / TEAM_SPEED, 1.5, 3) }; }
  const wi = pd.wi, inEnd = wi.hand ? .8 + wi.dur : 0;
  const entering = a => {
    if (a < .8) return { x: wi.pts[0][0], y: wi.pts[0][1], a: clamp((a - .12) / .3, 0, 1), portal: a < .6 ? Math.sin(clamp(a / .6, 0, 1) * Math.PI) : 0, carry: a >= .8 ? 'folder' : null, step: null, look: 0, lift: clamp(a / .45, 0, 1), pass: a >= .45 ? (a - .45) / .35 : -1, from: wi.from };
    const p = along(wi.pts, wi.L, (a - .8) / wi.dur); return { x: p.x, y: p.y, a: 1, carry: 'folder', step: Math.floor(t * 8) % 2, look: Math.sign(p.dx) * .7 };
  };
  if (pd.gone == null) return wi.hand && t - pd.born < inEnd ? entering(t - pd.born) : null;
  if (!pd.wo || pd.wo.g !== pd.gone) {
    const to = parentLoc(), p1 = [me.seat, ...teamRoute(pd.tslot, to, Sp)], p2 = to < 0 ? [Sp.D, Sp.Door] : [...teamRoute(to, -1, Sp), Sp.Door];
    const L1 = polyLen(p1), L2 = polyLen(p2), d1 = clamp(L1[L1.length - 1] / TEAM_SPEED, 1.2, 3), d2 = clamp(L2[L2.length - 1] / 4, .5, 2);
    const g0 = wi.hand ? Math.max(pd.gone, pd.born + inEnd) : pd.gone, s0 = .35, s1 = s0 + d1, s2 = s1 + .45, s3 = s2 + d2, s4 = s3 + .35;
    pd.wo = { g: pd.gone, g0, to, p1, L1, p2, L2, d1, d2, s0, s1, s2, s3, s4, end: (g0 - pd.gone) + s4 + .05, dropped: false }; pd.twEnd = pd.wo.end;
  }
  const w = pd.wo, g = t - w.g0;
  if (g < 0) return entering(t - pd.born);
  if (g < w.s0) return { x: me.seat[0], y: me.seat[1], a: 1, carry: 'report', step: null, look: 0 };
  if (g < w.s1) { const p = along(w.p1, w.L1, (g - w.s0) / w.d1); return { x: p.x, y: p.y, a: 1, carry: 'report', step: Math.floor(t * 8) % 2, look: Math.sign(p.dx) * .7 }; }
  if (g < w.s2) {
    if (!w.dropped && g > w.s1 + .38) { w.dropped = true; if (w.to < 0) (tv.papers || (tv.papers = [])).push(t); }
    const q = w.p1[w.p1.length - 1]; return { x: q[0], y: q[1], a: 1, carry: null, step: null, look: 0, drop: (g - w.s1) / .4, to: w.to };
  }
  if (g < w.s3) { const p = along(w.p2, w.L2, (g - w.s2) / w.d2); return { x: p.x, y: p.y, a: 1, carry: null, step: Math.floor(t * 8) % 2, look: Math.sign(p.dx) * .7 }; }
  const q = w.p2[w.p2.length - 1]; return { x: q[0], y: q[1], a: clamp(1 - (g - w.s3) / .35, 0, 1), carry: null, step: null, look: -.7 };
}
// the paper stack on the main desk: every report a subagent brings back adds a sheet; it clears 8 s after the last one
function teamPapers(tv, t, ms) {
  const L0 = tv.papers; if (!L0 || !L0.length || !ms) return null; while (L0.length && t - L0[0] > 8) L0.shift(); if (!L0.length) return null;
  const { dk, dd, T } = ms, n = Math.min(5, L0.length), last = L0[L0.length - 1];
  return { bx: { x0: dk.x, y0: dk.y, x1: dk.x + T.gw, y1: dk.y + T.gd }, k: 2 * dk.x + T.gw + 2 * dk.y + T.gd + .01, draw: () => {
    const HT = hostTopT(T, dd.top || dd.hz), u0 = dd.size[0] - .95, v0 = dd.size[1] - .82, pop = clamp((t - last) / .25, 0, 1);
    X.globalAlpha = clamp((8 - (t - last)) / .6, 0, 1);
    for (let i = 0; i < n; i++) { const z = .2 + i * .55 + (i === n - 1 ? (1 - pop) * 2 : 0), du = ((hashStr('pp' + i) % 5) - 2) * .025; lflat(HT, u0 + du, v0, u0 + .5 + du, v0 + .38, z - .35, '#bdb6a6'); lflat(HT, u0 + du, v0, u0 + .5 + du, v0 + .38, z, i % 2 ? '#f7f4ec' : '#ece7db'); }
    const zt = .2 + (n - 1) * .55; for (let j = 0; j < 3; j++) lflat(HT, u0 + .08, v0 + .07 + j * .1, u0 + .4 - j * .07, v0 + .11 + j * .1, zt + .01, '#8e889c');
    X.globalAlpha = 1;
  } };
}
// the meeting room's banner (front view, sheared onto its right wall): PHASE k/n and the active phase, a dot per phase
function meetBanner(e, wf, t) {
  const ph = (wf && wf.phases) || [], pr = wfProgress(wf || {}), act = ph.findIndex(p => p.state === 'active'), i = act >= 0 ? act : Math.max(0, pr.k - 1), col = phaseColor(i, wf);
  const l1 = (pr.n ? `PHASE ${pr.k}/${pr.n}` : 'WORKFLOW').slice(0, 18), l2 = String((ph[i] && ph[i].title) || (wf && wf.name) || '').toUpperCase().replace(/[^A-Z0-9 /:.-]/g, '').slice(0, 18), BW = 40, BH = 11;
  const oc = offCanvas('banner|' + e.key + '|' + S, BW, BH), sig = [l1, l2, col, ph.map(p => p.state).join(',')].join('|');
  if (oc._sig !== sig || oc._fresh) { oc._sig = sig; paintOff(oc, () => {
    R(0, 0, BW, BH - 1, shade(col, .5)); R(.5, .5, BW - 1, BH - 2, col); R(.5, .5, BW - 1, .5, shade(col, 1.25)); R(1, BH - 1, 1, 1, shade(col, .5)); R(BW - 2, BH - 1, 1, 1, shade(col, .5));
    const tw = s => { let w = 0; for (const ch of s) w += ch === ' ' ? 1.5 : BFONT[ch] ? (BFONT[ch].length / 5 + 1) * .5 : 2; return w; };
    const txt2 = (s, y, c2) => { let x = Math.round((BW - tw(s)) / 2 * 2) / 2; for (const ch of s) { if (ch === ' ') { x += 1.5; continue; } const gl = BFONT[ch]; if (!gl) { x += 2; continue; } const gw = gl.length / 5; for (let k = 0; k < gl.length; k++) if (gl[k] === '1') R(x + (k % gw) * .5, y + Math.floor(k / gw) * .5, .5, .5, c2); x += (gw + 1) * .5; } };
    txt2(l1, 1.5, INK); if (l2) txt2(l2, 4.75, shade(col, .38));
    const n = ph.length, dw = 2, gap = 1, x0 = Math.round((BW - (n * dw + (n - 1) * gap)) / 2); for (let k = 0; k < n; k++) R(x0 + k * (dw + gap), 8, dw, 1, ph[k].state === 'done' ? INK : ph[k].state === 'active' ? WHITE : shade(col, .7));
  }); }
  wallBlit('right', .5, 5, oc, BW, BH, 12.5);
  return col;
}
const MEET_SEATS = [[1.65, 1.05, 'b'], [2.55, 1.05, 'b'], [3.45, 1.05, 'b'], [4.35, 1.05, 'b'], [.62, 2.5, 'l'], [5.38, 2.5, 'r'], [1.65, 4, 'f'], [2.55, 4, 'f'], [3.45, 4, 'f'], [4.35, 4, 'f']];
// the meeting room: a big table, agents seated in phase order (the back row faces you), phase-coloured mats and place cards
function drawMeeting(tv, e, plan, t, lk0, parts, props, k, tops) {
  const m = plan.meet, s = m.W.strip, wf = s.wf, list = orderPods([...s.pods.values()], wf), shown = list.slice(0, MEET_SEATS.length), more = list.length - shown.length;
  const Tm = { x: 0, y: 0, r: 0, sw: m.g.w, sd: m.g.h, gw: m.g.w, gd: m.g.h, z: 0 }, wood = fab('#8a5a3c'), top = fab('#b98357');
  const lks = shown.map(pd => podLook(pd, t, lk0)), pcol = shown.map(pd => phaseColor(phaseIdx(wf, pd.a), wf)), heads = [];
  const actors = [{ bx: { x0: 1.2, y0: 1.55, x1: 4.8, y1: 3.45 }, k: 6 + 5, draw: () => {
    drawBoxes(Tm, [[1.35, 1.7, .14, .14, 0, 7, wood], [4.51, 1.7, .14, .14, 0, 7, wood], [1.35, 3.16, .14, .14, 0, 7, wood], [4.51, 3.16, .14, .14, 0, 7, wood]]);
    lbox(Tm, 1.2, 1.55, 3.6, 1.9, 7, 1.5, top); lflat(Tm, 1.5, 1.85, 4.5, 3.15, 8.51, shade('#b98357', 1.07));
    shown.forEach((pd, i) => { const [u, v, f] = MEET_SEATS[i], cu = f === 'l' ? 1.42 : f === 'r' ? 4.46 : u - .12, cv = f === 'b' ? 1.72 : f === 'f' ? 3.18 : 2.42; lbox(Tm, cu, cv, f === 'l' || f === 'r' ? .12 : .24, f === 'l' || f === 'r' ? .24 : .1, 8.5, 1.4, pcol[i]); });
  } }];
  shown.forEach((pd, i) => {
    const [u, v, f] = MEET_SEATS[i], lk = lks[i], seat = fab(shade(pcol[i], .8));
    actors.push({ bx: { x0: u - .3, y0: v - .3, x1: u + .3, y1: v + .3 }, k: 2 * (u + v), draw: () => {
      lbox(Tm, u - .05, v - .05, .1, .1, 0, 3.8, '#3d3a48');
      const backAt = f === 'b' ? [u - .28, v - .42, .56, .1] : f === 'f' ? [u - .28, v + .32, .56, .1] : f === 'l' ? [u - .42, v - .28, .1, .56] : [u + .32, v - .28, .1, .56], behind = f === 'b' || f === 'l';
      if (behind) lbox(Tm, backAt[0], backAt[1], backAt[2], backAt[3], 5.6, 8.4, seat);
      lbox(Tm, u - .28, v - .28, .56, .56, 3.8, 1.8, seat);
      const W = lk.W, [bx, by] = TP(Tm, u, v, 5.6), x0 = Math.round((bx - 6 * k) * S) / S, y0 = Math.round((by - 10 * k + (W.dy || 0)) * S) / S;
      if (W.portal > 0) drawIsoPortal(bx, by - 6, W.portal, t);
      if (W.alpha > 0) { X.globalAlpha = W.alpha * lk.fade; const yy = sprite(x0, y0, k, W.st, t, W.seed, W.col, W.hat, W.acc, 0, 0, null, f === 'f'); X.globalAlpha = 1; heads[i] = [bx, yy - (HAT_UP[W.hat] || 0) * k, x0, y0]; }
      if (!behind) lbox(Tm, backAt[0], backAt[1], backAt[2], backAt[3], 5.6, 8.4, seat);
    } });
  });
  const om = { kind: 'meet', grid: m.g, st: 'idle', theme: lk0.theme, items: [], stripe: null, noClear: 1, noDim: 1, noFx: 1, defer: 1, room: { rev: 1 }, at: [tv.so[0] + (m.gx - m.gy) * 8, tv.so[1] + (m.gx + m.gy) * 4], actors,
    under: () => { const col = meetBanner(e, wf, t); lpoly(Tm, [[1, 1.35], [5, 1.35], [5, 3.65], [1, 3.65]], 0, hexA(col, .1)); shown.forEach((pd, i) => { const [u, v] = MEET_SEATS[i]; lflat(Tm, u - .4, v - .4, u + .4, v + .4, 0, hexA(pcol[i], .38)); }); } };
  props.push(...drawScene(om, t, e.key + '|meet')); parts.push(om);
  const sm = tv.sm; sm.pods = s.pods; sm.wf = wf; sm.hits = []; const dpr = tv.dpr || 1, bc = Math.max(1, Math.round(S * .5));
  shown.forEach((pd, i) => {
    const h = heads[i], lk = lks[i]; if (!h) return;
    if (lk.settled && lk.kind) tops.push(() => podBubbleAt(Math.round(h[0] * S), Math.round((h[1] - 1) * S), lk.kind, lk.busy, t, i, bc));
    if (pd.gone == null) sm.hits.push({ id: pd.id, a: lk.a, x0: h[2] * S / dpr, y0: (h[3] - 2) * S / dpr, x1: (h[2] + 12 * k) * S / dpr, y1: (h[3] + 12 * k) * S / dpr });
  });
  const mp = more ? P(m.g.w - .6, m.g.h, 0) : null; F = { g: ISO_G.room, OX: tv.so[0], OY: tv.so[1], H: 0 };
  syncStripTags(sm, [], mp ? { x: mp[0] * S / dpr, y: (mp[1] + 6) * S / dpr, n: more } : null);
}
// one frame of the Team tab's canvas: the office, the row of rooms, the walkers, the light over all of it. e = the card entry (its pods and look).
function drawTeamView(tv, e, t, dpr) {
  teamSync(tv, e, t);
  const plan = teamPlan(tv, e), want = plan.B.sig, Wdev = Math.max(1, Math.floor(tv.wrap.clientWidth * dpr));
  // A refit changes the canvas height, which can add/remove the drawer's scrollbar, which changes clientWidth by ~one
  // scrollbar and triggers another refit: an endless bigger/smaller flicker. Ignore width changes smaller than a scrollbar.
  const widthMoved = tv.wdev == null || Math.abs(tv.wdev - Wdev) > Math.ceil(40 * dpr);
  if (want !== tv.sig || tv.dpr !== dpr || widthMoved) { // the row changes shape (or the tab is resized): refit, and crossfade from the last frame so the step is soft
    let snap = null;
    try { if (tv.u && tv.canvas.width && tv.canvas.height && !REDUCED.matches && want !== tv.sig) { snap = document.createElement('canvas'); snap.width = tv.canvas.width; snap.height = tv.canvas.height; snap.getContext('2d').drawImage(tv.canvas, 0, 0); } } catch (er) { snap = null; }
    tv.B = plan.B; tv.sig = want; fitTeam(tv, dpr); tv.xf = snap ? { c: snap, t0: t } : null;
  }
  X = tv.ctx; S = tv.u; RW = tv.canvas.width / tv.u;
  const o = { ...e.o, at: null, noFx: 0, defer: 0, noClear: 0, actors: null, cam: 0 };
  const decorated = !!(o.room && o.room.rev > 0), mItems = isoItems(o.room, ISO_G.room, decorated ? null : ROOM_DEFAULTS), dk = mItems.find(i => isDesk(i.itemId));
  const ms = dk ? (() => { const dd = IDEF[dk.itemId], T = itemT(dk, dd); return { dk, dd, T, D: tp(T, dd.size[0] - .35, dd.size[1] + .55) }; })() : null;
  const papers = teamPapers(tv, t, ms);
  const xfade = () => { if (!tv.xf) return; const f = (t - tv.xf.t0) / .4; if (f >= 1 || f < 0) { tv.xf = null; return; } X.globalAlpha = 1 - ease(f); X.drawImage(tv.xf.c, 0, 0); X.globalAlpha = 1; };
  const [OX, OY] = tv.so, k = 1, th = THEMES[o.theme] || THEMES.purple, SW = X.canvas.width, SH = X.canvas.height, G = plan.G, cw = plan.cw, ch = plan.ch, LY = G.LY;
  const Pm = (x, y, z) => [OX + (x - y) * 8, OY + (x + y) * 4 - (z || 0)], mainF = () => { F = { g: ISO_G.room, OX, OY, H: SH / S }; };
  const lk0 = { color: o.color, hat: o.hat, acc: o.acc, theme: o.theme }, look = { col: validCol(o.color) ? o.color : defCol(), hat: o.hat, acc: o.acc };
  // where people stand
  const pods = e.annex.pods, Sp = { D: ms ? ms.D : [4, 4], M: [7.7, LY], Door: [.6, ISO_G.room.door.slot + ISO_G.room.door.w / 2], c: [], pods };
  for (const q of plan.cubes) {
    const ty = q.pd && q.pd.a && q.pd.a.type; q.items = isoItems(q.pd ? (agentRoomOf(ty) || (typeof agentDefaultOf === 'function' ? agentDefaultOf(ty) : null)) : null, ISO_G.cube, null);
    q.desk = q.items.find(i => isDesk(i.itemId)); const dd = IDEF[q.desk.itemId], T = itemT(q.desk, dd), s0 = tp(T, dd.seat[0], dd.seat[1]), xd = cw - .5;
    q.dd = dd; q.T = T;
    Sp.c[q.i] = { seat: [q.gx + s0[0], q.gy + s0[1]], out: [[q.gx + s0[0], q.gy + s0[1]], [q.gx + xd, q.gy + s0[1]], [q.gx + xd, LY], [q.gx + .3, LY]] };
  }
  // who walks, and in which part of the row they are drawn (so furniture and walls overlap them correctly)
  const byPart = new Map(), push = (key, v) => { if (!byPart.has(key)) byPart.set(key, []); byPart.get(key).push(v); }, hand = [];
  for (const q of plan.cubes) {
    const pd = q.pd; if (!pd || pd.tslot !== q.i) { q.w = null; q.seated = false; continue; } const w = podWalker(tv, pd, t, Sp); q.w = w; q.seated = pd.gone == null && !w;
    if (!w) continue; const L = { seed: (pd.ord * 3 + 1) % 10, ...look };
    let part = 'r'; if (w.x < 8) part = 'm'; else { const kk = Math.floor((w.x - 8) / cw); if (kk >= 0 && kk < plan.K && w.y < ch + .01) part = 'c' + kk; }
    const ox = part[0] === 'c' ? plan.cubes[+part.slice(1)] : null, lx = w.x - (ox ? ox.gx : 0), ly = w.y - (ox ? ox.gy : 0);
    const rec = { w, q, pd };
    push(part, { bx: { x0: lx - .2, y0: ly - .2, x1: lx + .2, y1: ly + .2 }, k: 2 * (lx + ly), draw: () => { const p = P(lx, ly, 0); rec.hand = drawWalker(w, p[0], p[1], L, t, k); rec.foot = p; } });
    hand.push(rec);
  }
  // 1. the office
  X.imageSmoothingEnabled = false; X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.clearRect(0, 0, SW, SH);
  { const bg = X.createLinearGradient(0, 0, 0, SH); bg.addColorStop(0, '#0f0e16'); bg.addColorStop(1, '#17151f'); X.fillStyle = bg; X.fillRect(0, 0, SW, SH); }
  o.at = [OX, OY]; o.noFx = 1; o.defer = 1; o.noClear = 1; o.actors = [...(papers ? [papers] : []), ...(byPart.get('m') || [])];
  const props = drawScene(o, t, e.key + '|team'), parts = [o], tops = [];
  if (plan.hall) { const hg = plan.hall.g, at = Pm(plan.hall.gx, plan.hall.gy, 0); F = isoFrame(hg); F.OX = at[0]; F.OY = at[1]; const sh = isoShell(hg, th, o.theme || 'purple', null); X.drawImage(sh, Math.round((F.OX - sh._ox) * S), Math.round((F.OY - sh._oy) * S)); }
  // 2. the rooms, left to right (every one is nearer to you than the one before)
  for (const q of plan.cubes) {
    const pd = q.pd, a = pd ? pd.a || {} : {}, done = DONE_RE.test(a.status || ''), busy = !done && !/^idle$/i.test(a.status || ''), quiet = quietSec(a) > 0;
    const working = q.seated && busy && !quiet;
    q.desk.W = { st: working ? 'working' : 'idle', tool: a.tool, col: look.col, hat: look.hat, acc: look.acc, alpha: pd && q.seated ? 1 : 0, seed: pd ? (pd.ord * 3 + 1) % 10 : 0, k, skin: o.desk || null };
    const oc = { kind: 'cube', grid: q.g, st: q.desk.W.st, tool: a.tool, theme: o.theme, color: look.col, hat: look.hat, acc: look.acc, items: q.items, stripe: pd ? typeColor(a.type) : null, noClear: 1, noDim: 1, noFx: 1, defer: 1, room: { rev: 1 }, at: Pm(q.gx, q.gy, 0), actors: byPart.get('c' + q.i) || null };
    for (const p of drawScene(oc, t, e.key + '|c' + q.i)) if (p[0] !== 'Worker') props.push(p);
    q.o = oc; parts.push(oc);
    if (pd && hoverKey === tv.sc.key + '|' + pd.id) poly([P(0, 0), P(q.g.w, 0), P(q.g.w, q.g.h), P(0, q.g.h)], 'rgba(183,162,242,.14)');
    q.done = done; q.busy = busy; q.kind = done ? 'done' : quiet ? '' : toolKind(a.tool);
  }
  mainF();
  for (const r of (byPart.get('r') || []).sort((a, b) => a.k - b.k)) r.draw();
  // 3. the meeting room at the end of the row
  if (plan.meet) drawMeeting(tv, e, plan, t, lk0, parts, props, k, tops); else if (tv.sm && tv.sm.moreEl && !tv.sm.moreEl.hidden) syncStripTags(tv.sm, [], null);
  // 4. light: one vignette and one night over the whole row, then every part's glows
  mainF();
  const n = o.st === 'offline' ? 0 : dayNow().night, vg = X.createRadialGradient(SW / 2, SH * .5, SH * .2, SW / 2, SH * .5, Math.max(SW, SH) * .72);
  vg.addColorStop(0, 'rgba(6,5,14,0)'); vg.addColorStop(1, `rgba(6,5,14,${(.24 + .12 * n).toFixed(3)})`); X.fillStyle = vg; X.fillRect(0, 0, SW, SH);
  if (n > .02) { X.fillStyle = `rgba(10,12,34,${(.34 * n).toFixed(3)})`; X.fillRect(0, 0, SW, SH); }
  for (const p of parts) if (p._light) p._light();
  // 5. the top layer: the office's visitors, bubbles and boss; the agents' bubbles; folders and reports changing hands
  if (o._top) o._top(); mainF();
  const bc = Math.max(1, Math.round(S * .5));
  plan.cubes.forEach((q, i) => { const h = q.o && q.o._head; if (q.seated && h && q.pd) podBubbleAt(Math.round(h[0] * S), Math.round((h[1] - 1) * S), q.kind, q.busy, t, i, bc); });
  for (const f of tops) f();
  const headOf = L => { if (L < 0) return o._head; const c = plan.cubes.find(q => q.i === L); return c && c.seated && c.o && c.o._head; };
  for (const r of hand) if (r.foot && r.w.a > 0) drawWalker({ ...r.w, a: r.w.a * .38, portal: 0 }, r.foot[0], r.foot[1], { seed: (r.pd.ord * 3 + 1) % 10, ...look }, t, k); // x-ray: a walker behind furniture stays readable
  for (const r of hand) {
    const w = r.w;
    if (w.lift != null && w.pass < 1) { // the giver's folder: lifted over the head, then tossed to the new subagent's hand
      const h = headOf(w.from); if (!h) continue; const up = [h[0] + 1, h[1] - 4 - 3 * ease(w.lift)];
      if (w.pass < 0) drawCarry('folder', up[0] - 2.25 * k, up[1], k);
      else if (r.hand) { const f = ease(clamp(w.pass, 0, 1)), x = up[0] + (r.hand[0] + 2.25 * k - up[0]) * f, y = up[1] + (r.hand[1] - up[1]) * f - Math.sin(f * Math.PI) * 6; drawCarry('folder', x - 2.25 * k, y, k); }
    }
    if (w.drop != null && w.drop < 1 && r.foot && ms) { // the report lands on the desk it was brought to
      const f = ease(clamp(w.drop, 0, 1)); let to;
      if (w.to < 0) { const HT = hostTopT(ms.T, ms.dd.top || ms.dd.hz), g = tp(HT, ms.dd.size[0] - .7, ms.dd.size[1] - .62); to = Pm(g[0], g[1], (HT.z || 0) + 1 + Math.min(5, (tv.papers || []).length) * .55); }
      else { const c = plan.cubes.find(q => q.i === w.to); if (c) { const g = tp(c.T, c.dd.size[0] / 2, c.dd.size[1] * .75); to = Pm(c.gx + g[0], c.gy + g[1], (c.dd.top || c.dd.hz) + 1); } }
      if (to) { const x0 = r.foot[0] + 3 * k, y0 = r.foot[1] - 6 * k, x = x0 + (to[0] - x0) * f, y = y0 + (to[1] - y0) * f - Math.sin(f * Math.PI) * 5; drawCarry('report', x - 2 * k, y - 2 * k, k); }
    }
  }
  if (o.st === 'offline') { X.fillStyle = 'rgba(8,6,22,.5)'; X.fillRect(0, 0, SW, SH); }
  xfade();
  // tags (under each room's front corner) and the hit boxes for hover cards and clicks
  const sc = tv.sc; sc.pods = pods; sc.hits = []; const items = [], cssOf = v => v * S / dpr;
  for (const q of plan.cubes) {
    const pd = q.pd; if (!pd || pd.gone != null) continue; const a = pd.a || {}, qs = quietSec(a), an = Pm(q.gx + cw, q.gy + ch, 0);
    const label = agentLabel(a), ew = Math.min(190, label.length * 6.4 + 34 + (a.model ? 16 : 0) + (qs ? 28 : 0)); // the tags hang one room lower than the last, so they may be wider than a room
    items.push({ id: pd.id, x: clamp(cssOf(an[0]), ew / 2 + 3, SW / dpr - ew / 2 - 3), y: cssOf(an[1]) + 3, w: 190, col: typeColor(a.type), label, model: modelKey(a.model), quiet: qs && !q.done ? fmtQuiet(qs) : '', done: q.done });
    const r = hand.find(h => h.q === q);
    if (r && r.foot) sc.hits.push({ id: pd.id, a, x0: cssOf(r.foot[0] - 7 * k), y0: cssOf(r.foot[1] - 13 * k), x1: cssOf(r.foot[0] + 7 * k), y1: cssOf(r.foot[1] + 1) });
    else { const l = Pm(q.gx, q.gy + ch), rr = Pm(q.gx + cw, q.gy), tt = Pm(q.gx, q.gy, q.g.wallH), bb = Pm(q.gx + cw, q.gy + ch); sc.hits.push({ id: pd.id, a, x0: cssOf(l[0]), y0: cssOf(tt[1]), x1: cssOf(rr[0]), y1: cssOf(bb[1]) }); }
  }
  syncStripTags(sc, items, null);
  tv.props = props;
}
// the Team tab's canvas answers hover cards (hover.js reads canvas._s): the agent strip under the pointer; clicks are handled by drawer.js
function teamHitStrip(tv) {
  const p = tv.ptr; if (!p) return undefined;
  for (const s of [tv.sc, tv.sm]) if (s && s.hits.some(b => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1)) return s;
  return undefined;
}
// the card strip's canvas does the same: a desk or a seat of the workflow table (their strips each carry their own workflow)
function stripHitStrip(e) {
  const p = e.sptr; if (p) for (const s of [e.annex, ...[...e.wfs.values()].map(W => W.strip)]) if (s.hits && s.hits.some(b => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1)) return s;
  return e.annex;
}
// called every frame (render.js) while the drawer's Team tab is showing
function teamFrame(t, dpr) {
  if (!drawer || drawer.agent || curTab !== 'team' || typeof teamView !== 'function') return;
  const e = cards.get(drawer.kind + drawer.id), tv = teamView(); if (!e || !e.o || !tv || tv.el.parentNode.hidden || !tv.wrap.clientWidth) return;
  drawTeamView(tv, e, t, dpr);
}
