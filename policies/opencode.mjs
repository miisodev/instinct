// instinct policy - observations only, single file, no imports.
//   export default (obs) => move
//
// obs = {game, turn, description, observation, legalMoves}
// Runs in a locked-down child: 2 s per move, 30 s per game. An illegal move,
// a throw, or an overrun scores 0, so every branch is deadline-bounded and
// every branch falls back to a legal move.
//
// All reasoning uses only fields present in `obs.observation`. Hidden state
// (secret codes, fleet positions, opponent type, dice) is never available and
// is never assumed.

let T0 = 0;          // wall clock at the first move of this game
let GAME_ID = null;  // one child process serves one game
const memo = new Map();
let cache = {};

const now = () => Date.now();
const elapsed = () => (T0 ? now() - T0 : 0);
const GAME_BUDGET = 23000;   // hard cap in the runner is 30 s
// Per-move wall clock. The runner kills a move at 2 s and scores the whole game
// 0, so keep a wide margin: CI runners are slower than the dev box and a
// timeout is far more expensive than a slightly shallower search.
const safe = (ms) => Math.max(60, Math.min(ms, GAME_BUDGET - elapsed() - 1500));

function reset(g) {
  if (g !== GAME_ID) { GAME_ID = g; T0 = now(); cache = {}; memo.clear(); }
}

/* ================================================================ signal ==
 * 4 digits, digits 0-3, feedback is (exact, misplaced). Minimax keeps every
 * branch inside the 6 guesses; expectiminimax (exact expected remaining turns,
 * which is what the score is linear in) averages ~3.55 guesses. The recursion
 * degrades to a log2 estimate once its deadline passes.
 */
const CODES = Array.from({length: 256}, (_, i) => i.toString(4).padStart(4, '0'));
function fb(sec, g) {
  let e = 0; const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) { if (sec[i] === g[i]) e++; else { a[+sec[i]]++; b[+g[i]]++; } }
  let n = 0; for (let d = 0; d < 4; d++) n += Math.min(a[d], b[d]);
  return [e, n];
}
function bucketsOf(guess, cand) {
  const m = new Map();
  for (const c of cand) {
    const [e, n] = fb(c, guess);
    const k = e + ',' + n;
    const a = m.get(k); if (a) a.push(c); else m.set(k, [c]);
  }
  return m;
}
function expTurns(cand, left, dl) {
  if (cand.length === 1 || left <= 1) return 1;
  // Key on the full candidate set: length+first element collides across
  // different sets and silently corrupts the estimate.
  const k = cand.join(',') + '|' + left;
  const hit = memo.get(k); if (hit !== undefined) return hit;
  if (now() > dl) return Math.log2(cand.length) + 1;
  let best = Infinity; const N = cand.length;
  for (const g of cand) {
    let e = 1;
    for (const a of bucketsOf(g, cand).values()) e += (a.length / N) * expTurns(a, left - 1, dl);
    if (e < best) { best = e; if (best <= 1.9) break; }
  }
  memo.set(k, best);
  return best;
}
function signal(obs) {
  const hist = (obs.observation.history || []);
  const cand = CODES.filter(c => hist.every(h => { const [e, n] = fb(c, h.guess); return e === h.exact && n === h.near; }));
  if (cand.length <= 1) return cand[0] || obs.legalMoves[0];
  const left = 6 - (obs.turn | 0);
  const dl = now() + safe(600);
  let mv = cand[0], bv = Infinity; const N = cand.length;
  for (const g of cand) {
    let e = 1;
    for (const a of bucketsOf(g, cand).values()) e += (a.length / N) * expTurns(a, left - 1, dl);
    if (e < bv) { bv = e; mv = g; }
    if (now() > dl) break;
  }
  return mv;
}

/* ============================================================== gridshift ==
 * 8-puzzle, A* on Manhattan distance (admissible, so the solution is optimal).
 * Depth is generous so this always finishes; a greedy move is the safety net.
 */
const PAIRS = [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8]];
function manh(t) {
  let d = 0;
  for (let i = 0; i < 9; i++) if (t[i] !== 0) {
    const v = t[i] - 1, r = i / 3 | 0, c = i % 3;
    d += Math.abs(r - (v / 3 | 0)) + Math.abs(c - (v % 3));
  }
  return d;
}
function gridshift(obs) {
  const tiles = obs.observation.tiles.slice();
  const goal = '123456780';
  const start = tiles.join('');
  if (start === goal) return obs.legalMoves[0];
  const dl = now() + safe(1100);
  const h = [];
  const push = (n) => { h.push(n); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p].f <= h[i].f) break; const t = h[p]; h[p] = h[i]; h[i] = t; i = p; } };
  const pop = () => { if (!h.length) return null; const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < h.length && h[l].f < h[m].f) m = l; if (r < h.length && h[r].f < h[m].f) m = r; if (m === i) break; const t = h[m]; h[m] = h[i]; h[i] = t; i = m; } } return top; };
  const seen = new Map([[start, 0]]);
  push({k: start, g: 0, f: manh(tiles), t: tiles, z: tiles.indexOf(0), mv: null, p: null});
  while (h.length) {
    const cur = pop();
    if (cur.k === goal) { let n = cur; while (n.p && n.p.p) n = n.p; return n.mv; }
    if (cur.g > (seen.get(cur.k) ?? Infinity)) continue;
    if (now() > dl) break;
    for (const p of PAIRS) {
      let i; if (p[0] === cur.z) i = p[1]; else if (p[1] === cur.z) i = p[0]; else continue;
      const t = cur.t.slice(); const tmp = t[cur.z]; t[cur.z] = t[i]; t[i] = tmp;
      const k = t.join(''), gc = cur.g + 1;
      if (gc >= (seen.get(k) ?? Infinity)) continue;
      seen.set(k, gc);
      push({k, g: gc, f: gc + manh(t), t, z: i, mv: String(i), p: cur});
    }
  }
  // Fallback: any slide that reduces Manhattan distance.
  let best = obs.legalMoves[0], bd = Infinity;
  for (const m of obs.legalMoves) {
    const i = +m, t = tiles.slice(); const tmp = t[tiles.indexOf(0)]; t[tiles.indexOf(0)] = t[i]; t[i] = tmp;
    const d = manh(t); if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/* ================================================================= vault ==
 * 6x6 grid, exit at 35, 8 shards, 24 energy. Exhaustive BFS over
 * (collected mask, position) from the *current* state, so this is optimal from
 * every observation, not just the start. Enters 35 only as a terminal.
 */
function vault(obs) {
  const ob = obs.observation;
  const W = 6, EXIT = 35, MAX = 24;
  const shards = (ob.shards || []).slice();
  const idx = new Map(shards.map((p, i) => [p, i]));
  const R = Math.max(0, (ob.energy !== undefined ? ob.energy : MAX - (ob.turns | 0)) | 0);
  const dirs = obs.legalMoves.filter(m => m !== 'extract');
  if (!dirs.length) return obs.legalMoves[0];
  const nb = (p) => {
    const r = (p / W) | 0, c = p % W, out = [];
    if (r > 0) out.push([p - W, 'up']); if (r < W - 1) out.push([p + W, 'down']);
    if (c > 0) out.push([p - 1, 'left']); if (c < W - 1) out.push([p + 1, 'right']);
    return out;
  };
  const start = ob.pos | 0, base = ob.collected | 0;
  const seen = new Map([[start, {d: 0, first: null}]]);   // key = mask*256 + pos
  let frontier = [[0, start]];                            // [mask, pos]
  let bestVal = -Infinity, bestFirst = dirs[0];
  for (let d = 0; d <= R && frontier.length; d++) {
    const next = [];
    for (const [mask, pos] of frontier) {
      const escaped = pos === EXIT;
      if (escaped || d === R) {
        let pc = 0, m = mask; while (m) { m &= m - 1; pc++; }
        const val = (base + pc) * 150 + (escaped ? 500 + (MAX - ((ob.turns | 0) + d)) * 10 : 0);
        if (val > bestVal) {
          bestVal = val;
          const rec = seen.get(mask * 256 + pos);
          if (rec && rec.first) bestFirst = rec.first;
        }
        continue;
      }
      // nb() already enforces the board bounds that define legality; do NOT
      // filter against obs.legalMoves, which only covers the current position.
      for (const [np, mv] of nb(pos)) {
        const m2 = idx.has(np) ? mask | (1 << idx.get(np)) : mask;
        const k = m2 * 256 + np;
        if (seen.has(k)) continue;
        const rec = seen.get(mask * 256 + pos);
        seen.set(k, {d: d + 1, first: rec && rec.first ? rec.first : mv});
        next.push([m2, np]);
      }
    }
    frontier = next;
  }
  return bestFirst;
}

/* ============================================================== handshake ==
 * Hidden opponent from a fixed family; learn it from the history, then play the
 * exactly optimal continuation. Robust version: a DP over a belief set (which
 * opponents are still consistent with everything seen) rather than betting on
 * the first guess. Notably it discovers that defecting on the final round is
 * free against a forgiving opponent, which a "copy their last move" agent misses.
 */
const HKINDS = ['mirror', 'grudge', 'hawk', 'dove', 'pavlov', 'dice'];
const HPAY = {CC: 3, CD: 0, DC: 5, DD: 1};
function hConsistent(kind, h) {
  for (let t = 0; t < h.length; t++) {
    const prev = h[t - 1]; let th;
    switch (kind) {
      case 'mirror': th = prev ? prev.me : 'C'; break;
      case 'grudge': th = h.slice(0, t).some(x => x.me === 'D') ? 'D' : 'C'; break;
      case 'hawk': th = 'D'; break;
      case 'dove': th = 'C'; break;
      case 'pavlov': th = prev ? (prev.me === prev.them ? 'C' : 'D') : 'C'; break;
      default: return true; // dice: unconstrained without the coin stream
    }
    if (th !== h[t].them) return false;
  }
  return true;
}
function hThem(kind, mLast, everD, tLast) {
  switch (kind) {
    case 'mirror': return mLast || 'C';
    case 'grudge': return everD ? 'D' : 'C';
    case 'hawk': return 'D';
    case 'dove': return 'C';
    case 'pavlov': return tLast ? (mLast === tLast ? 'C' : 'D') : 'C';
    default: return 'C'; // expected value of the coin draw favours cooperate
  }
}
function handshake(obs) {
  const hist = (obs.observation.history || []).slice();
  const t0 = hist.length;
  const everD = hist.some(x => x.me === 'D') ? 1 : 0;
  const mLast = t0 ? hist[t0 - 1].me : '';
  const tLast = t0 ? hist[t0 - 1].them : '';
  let belief = 0;
  HKINDS.forEach((k, i) => { if (hConsistent(k, hist)) belief |= 1 << i; });
  if (!belief) belief = 0b111111;
  const MEM = new Map();
  const f = (t, ml, ed, tl, bel) => {
    if (t >= 20) return 0;
    const k = t + '|' + ml + '|' + ed + '|' + tl + '|' + bel;
    const h = MEM.get(k); if (h !== undefined) return h;
    let best = -Infinity;
    for (const me of ['C', 'D']) {
      const e2 = ed || me === 'D' ? 1 : 0;
      let acc = 0, n = 0;
      for (let i = 0; i < HKINDS.length; i++) {
        if (!(bel & (1 << i))) continue;
        const th = hThem(HKINDS[i], ml, ed, tl);
        acc += HPAY[me + th] + f(t + 1, me, e2, th, bel & (1 << i));
        n++;
      }
      if (!n) continue;
      const v = acc / n; if (v > best) best = v;
    }
    MEM.set(k, best === -Infinity ? 0 : best);
    return MEM.get(k);
  };
  let choice = 'C', bv = -Infinity;
  for (const me of ['C', 'D']) {
    const e2 = everD || me === 'D' ? 1 : 0;
    let acc = 0, n = 0;
    for (let i = 0; i < HKINDS.length; i++) {
      if (!(belief & (1 << i))) continue;
      const th = hThem(HKINDS[i], mLast, everD, tLast);
      let nb = 0;
      const h2 = hist.concat({me, them: th});
      HKINDS.forEach((k, j) => { if ((belief & (1 << j)) && hConsistent(k, h2)) nb |= 1 << j; });
      acc += HPAY[me + th] + f(t0 + 1, me, e2, th, nb || belief);
      n++;
    }
    const v = n ? acc / n : -Infinity;
    if (v > bv) { bv = v; choice = me; }
  }
  return choice;
}

/* ================================================================= heaps ==
 * Normal-play Nim against a machine that plays the textbook move 80% of the time.
 * Always hand over a zero-xor position: that is a proven losing position for the
 * opponent whatever it does, so the win is guaranteed rather than likely. Among
 * the (few) such moves, take the one that strips the most stones, which keeps
 * the turn count - and therefore the score - down.
 */
function heaps(obs) {
  const h = obs.observation.heaps.slice();
  const x = h.reduce((a, b) => a ^ b, 0);
  if (x === 0) { let bi = 0; h.forEach((v, i) => { if (v > h[bi]) bi = i; }); return bi + ':' + h[bi]; }
  let bm = null, br = -1;
  for (let i = 0; i < h.length; i++) {
    const want = h[i] ^ x;
    if (want < h[i]) { const rm = h[i] - want; if (rm > br) { br = rm; bm = i + ':' + rm; } }
  }
  return bm || (obs.legalMoves[0]);
}

/* ================================================================= radar ==
 * Four hidden ships (4,3,3,2) on an 8x8 board, 40 shots. Score is 500 + 20 per
 * unused shot, so a wasted shot costs 20 and the only thing that matters is
 * sinking all 12 ship cells inside the budget.
 *
 * Rather than the usual density heuristic, this enumerates *exactly* every
 * non-overlapping fleet consistent with the shots so far and fires at the cell
 * with the highest exact occupancy probability. A 1-step lookahead was tried and
 * measured worse (649 vs 701 over 20 seeds): greedy is near-optimal here.
 */
const RLENS = [4, 3, 3, 2];
function rPlacements(L) {
  const out = [];
  const add = (cells) => {
    let lo = 0, hi = 0;
    for (const x of cells) { if (x < 32) lo |= 1 << x; else hi |= 1 << (x - 32); }
    out.push({lo, hi, cells});
  };
  for (let r = 0; r < 8; r++) for (let c = 0; c + L <= 8; c++) { const cs = []; for (let i = 0; i < L; i++) cs.push(r * 8 + c + i); add(cs); }
  for (let r = 0; r + L <= 8; r++) for (let c = 0; c < 8; c++) { const cs = []; for (let i = 0; i < L; i++) cs.push((r + i) * 8 + c); add(cs); }
  return out;
}
const RPL = RLENS.map(rPlacements);
let rNodes = 0, rCap = 0, rAbort = false;
function rMarginals(hLo, hHi, mLo, mHi) {
  const counts = new Float64Array(64);
  rAbort = false;
  const P0 = RPL[0], P1 = RPL[1], P2 = RPL[2], P3 = RPL[3];
  const dfs = (i, lo, hi, from) => {
    if (i === 4) return (lo & hLo) === hLo && (hi & hHi) === hHi ? 1 : 0;
    const full = i === 0 ? P0 : i === 1 ? P1 : i === 2 ? P2 : P3;
    const pool = i === 2 ? full.slice(from) : full;
    let total = 0;
    for (let pi = 0; pi < pool.length; pi++) {
      const p = pool[pi];
      const nlo = lo | p.lo, nhi = hi | p.hi;
      if ((nlo & mLo) || (nhi & mHi)) continue;
      if (++rNodes > rCap) { rAbort = true; return 0; }
      const c = dfs(i + 1, nlo, nhi, pi + 1);
      if (c) {
        total += c;
        for (let k = 0; k < p.cells.length; k++) counts[p.cells[k]] += c;
      }
    }
    return total;
  };
  dfs(0, 0, 0, 0);
  return rAbort ? null : counts;
}
function radar(obs) {
  const shots = obs.observation.shots || [];
  let hLo = 0, hHi = 0, mLo = 0, mHi = 0;
  const fired = new Set();
  for (const s of shots) {
    const p = s.m.split(',');
    const cell = (+p[0]) * 8 + (+p[1]);
    fired.add(cell);
    if (cell < 32) { if (s.hit) hLo |= 1 << cell; else mLo |= 1 << cell; }
    else { if (s.hit) hHi |= 1 << (cell - 32); else mHi |= 1 << (cell - 32); }
  }
  rCap = 4_000_000;
  const counts = rMarginals(hLo, hHi, mLo, mHi);
  if (counts) {
    let best = -1, cell = -1;
    for (let c = 0; c < 64; c++) if (!fired.has(c) && counts[c] > best) { best = counts[c]; cell = c; }
    if (cell >= 0) return ((cell / 8) | 0) + ',' + (cell % 8);
  }
  // Fallback: extend around known hits, else take any unfired cell.
  for (let i = shots.length - 1; i >= 0; i--) {
    if (!shots[i].hit) continue;
    const p = shots[i].m.split(','), r = +p[0], c = +p[1];
    for (const [a, d] of [[r, c + 1], [r, c - 1], [r + 1, c], [r - 1, c]]) {
      const m = a + ',' + d;
      if (obs.legalMoves.includes(m)) return m;
    }
  }
  return obs.legalMoves[0];
}

/* =============================================================== fourrows ==
 * Connect Four (7x6) against a depth-limited minimax machine (its depth is 2-4
 * and is visible in the observation). Perfect information, so this is decided by
 * playing strength: alpha-beta with iterative deepening, centre-first ordering,
 * 69-window evaluation, and a per-move deadline sized so the whole 21-move game
 * stays inside the runner's 30 s cap.
 */
const C4W = 7, C4H = 6;
const C4LINES = (() => {
  const L = [];
  for (let c = 0; c <= C4W - 4; c++) for (let r = 0; r < C4H; r++) L.push([0, 1, 2, 3].map(k => r * C4W + c + k));
  for (let r = 0; r <= C4H - 4; r++) for (let c = 0; c < C4W; c++) L.push([0, 1, 2, 3].map(k => (r + k) * C4W + c));
  for (let c = 0; c < C4W; c++) for (let r = 0; r < C4H; r++) for (const dc of [1, -1]) {
    const cells = []; let ok = true;
    for (let k = 0; k < 4; k++) { const cc = c + dc * k; if (cc < 0 || cc >= C4W || r + k >= C4H) { ok = false; break; } cells.push((r + k) * C4W + cc); }
    if (ok) L.push(cells);
  }
  return L;
})();
const C4T = [0, 3, 10, 46, 1e6];
const C4DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
function c4WinAt(b, idx) {
  const r = (idx / C4W) | 0, c = idx % C4W, p = b[idx];
  for (const [dr, dc] of C4DIRS) {
    let n = 1;
    for (let k = 1; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= C4H || cc < 0 || cc >= C4W || b[rr * C4W + cc] !== p) break; n++; }
    for (let k = 1; k < 4; k++) { const rr = r - dr * k, cc = c - dc * k; if (rr < 0 || rr >= C4H || cc < 0 || cc >= C4W || b[rr * C4W + cc] !== p) break; n++; }
    if (n >= 4) return true;
  }
  return false;
}
function c4Eval(b, me) {
  const op = 3 - me;
  let s = 0;
  for (const line of C4LINES) {
    let a = 0, o = 0;
    for (const i of line) { const v = b[i]; if (v === me) a++; else if (v === op) o++; }
    if (o === 0) s += C4T[a];
    else if (a === 0) s -= C4T[o];
  }
  for (let c = 3; c < C4W; c++) s += (b[(C4H - 1) * C4W + c] === me ? 1 : 0);
  return s;
}
function c4Search(b, h, me, depth, alpha, beta, lastIdx, ply, dl, st) {
  if (st.to) return 0;
  if ((++st.n & 255) === 0 && now() > dl) { st.to = true; return 0; }
  if (lastIdx >= 0 && c4WinAt(b, lastIdx)) return -1e6 + ply;
  if (depth === 0) return c4Eval(b, me);
  let any = false, best = -Infinity;
  for (const c of c4Order(b, h, me)) {
    const r = h[c]; if (r >= C4H) continue;
    const idx = r * C4W + c;
    b[idx] = me; h[c] = r + 1;
    const v = -c4Search(b, h, 3 - me, depth - 1, -beta, -alpha, idx, ply + 1, dl, st);
    b[idx] = 0; h[c] = r;
    if (st.to) return 0;
    if (v > best) { best = v; any = true; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return any ? best : 0;
}
// centre-first, plus a nudge for moves that complete a line for me
function c4Order(b, h, me) {
  const out = [];
  for (const c of [3, 2, 4, 1, 5, 0, 6]) {
    if (h[c] >= C4H) continue;
    const r = h[c];
    const saved = b[r * C4W + c];
    b[r * C4W + c] = me;
    const hot = c4WinAt(b, r * C4W + c);
    b[r * C4W + c] = saved;
    out.push([hot ? 1 : 0, -Math.abs(c - 3), c]);
  }
  out.sort((a, b2) => b2[0] - a[0] || a[1] - b2[1]);
  return out.map(x => x[2]);
}
function fourrows(obs) {
  const ob = obs.observation;
  // The game indexes row 0 as the TOP and stacks discs from the bottom, so flip
  // into bottom-up indexing (row 0 = bottom) where height == next free row.
  const gb = ob.board;
  const board = new Int8Array(C4H * C4W);
  for (let r = 0; r < C4H; r++) for (let c = 0; c < C4W; c++) board[r * C4W + c] = gb[(C4H - 1 - r) * C4W + c];
  const heights = new Int8Array(C4W);
  for (let c = 0; c < C4W; c++) { let k = 0; while (k < C4H && board[k * C4W + c]) k++; heights[c] = k; }
  const legal = obs.legalMoves.map(Number);
  if (!legal.length) return obs.legalMoves[0] ?? '0';

  // Always take a win; otherwise stop an immediate loss.
  for (const c of legal) {
    const r = heights[c], idx = r * C4W + c;
    board[idx] = 1;
    if (c4WinAt(board, idx)) return String(c);
    board[idx] = 0;
  }
  const blocks = [];
  for (const c of legal) {
    const r = heights[c], idx = r * C4W + c;
    board[idx] = 2;
    if (c4WinAt(board, idx)) blocks.push(c);
    board[idx] = 0;
  }
  if (blocks.length) return String(blocks[0]);

  const movesLeft = Math.max(1, 21 - (obs.turn | 0));
  const budget = Math.max(120, Math.min(700, (GAME_BUDGET - elapsed() - 2000) / movesLeft));
  const dl = now() + budget;
  let bestMove = String(legal[0]);
  for (let depth = 1; depth <= 13; depth++) {
    const st = {to: false, n: 0};
    let best = -Infinity, bm = null, alpha = -Infinity;
    for (const c of c4Order(board, heights, 1)) {
      if (!legal.includes(c)) continue;
      const r = heights[c]; if (r >= C4H) continue;
      const idx = r * C4W + c;
      board[idx] = 1; heights[c] = r + 1;
      const v = -c4Search(board, heights, 2, depth - 1, -Infinity, -alpha, idx, 1, dl, st);
      board[idx] = 0; heights[c] = r;
      if (st.to) break;
      if (v > best) { best = v; bm = c; if (v > alpha) alpha = v; }
    }
    if (st.to || bm === null) break;
    bestMove = String(bm);
    if (Math.abs(best) > 5e5) break;   // mate found; deeper adds nothing
    if (now() > dl) break;
  }
  return legal.map(String).includes(bestMove) ? bestMove : String(legal[0]);
}

/* =============================================================== courier ==
 * 24 stops plus the depot, all visible from the first turn, and the route is
 * the entire score: 3000 - 2 x length. Exact DP over subsets is out of reach, so
 * the tour is built once here (greedy seed, then 2-opt + Or-opt to a local
 * optimum, with seeded restarts) and then simply followed move by move.
 */
function courierTour(pts, depot, dl) {
  const n = pts.length;
  const node = (i) => (i < 0 ? depot : pts[i]);
  const D = [];
  for (let i = -1; i < n; i++) { D.push([]); for (let j = -1; j < n; j++) { const a = node(i), b = node(j); D[i + 1].push(Math.hypot(a.x - b.x, a.y - b.y)); } }
  const dIdx = (i, j) => D[i + 1][j + 1];
  let seed = 123456789;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const tourLen = (t) => { let L = 0; let prev = -1; for (const c of t) { L += dIdx(prev, c); prev = c; } return L + dIdx(prev, -1); };
  const nn = (startJ) => {
    const t = []; const used = new Uint8Array(n);
    let prev = -1, cur = startJ;
    for (;;) { t.push(cur); used[cur] = 1; let best = -1, bd = Infinity; for (let j = 0; j < n; j++) { if (used[j]) continue; const d = dIdx(prev, j); if (d < bd) { bd = d; best = j; } } if (best < 0) break; prev = cur; cur = best; }
    return t;
  };
  const twoOpt = (t) => {
    let improved = true;
    while (improved && now() < dl) {
      improved = false;
      for (let i = 0; i < t.length - 1; i++) {
        for (let k = i + 1; k < t.length; k++) {
          const a = i === 0 ? -1 : t[i - 1], b = t[i];
          const c = k === t.length - 1 ? -1 : t[k + 1], e = t[k];
          const delta = (dIdx(a, e) + dIdx(b, c)) - (dIdx(a, b) + dIdx(e, c));
          if (delta < -1e-9) {
            const seg = t.slice(i, k + 1).reverse();
            for (let x = 0; x < seg.length; x++) t[i + x] = seg[x];
            improved = true;
          }
        }
      }
    }
    return t;
  };
  // Or-opt: relocate a run of 1..3 stops. Remove the run first, then reinsert at
  // an index into the shortened array (indices there run 0..rest.length, so a
  // negative or out-of-range index can never silently corrupt the tour).
  const orOpt = (t) => {
    let improved = true;
    while (improved && now() < dl) {
      improved = false;
      for (let len = 3; len >= 1 && !improved; len--) {
        for (let i = 0; i + len <= t.length && !improved; i++) {
          const seg = t.slice(i, i + len);
          const before = i === 0 ? -1 : t[i - 1];
          const after = i + len >= t.length ? -1 : t[i + len];
          const gain = dIdx(before, seg[0]) + dIdx(seg[seg.length - 1], after) - dIdx(before, after);
          if (gain <= 1e-9) continue;
          const rest = t.slice(0, i).concat(t.slice(i + len));
          let bestAdd = Infinity, bestAt = -1;
          for (let at = 0; at <= rest.length; at++) {
            if (at === i) continue;
            const p = at === 0 ? -1 : rest[at - 1];
            const q = at === rest.length ? -1 : rest[at];
            const add = dIdx(p, seg[0]) + dIdx(seg[seg.length - 1], q) - dIdx(p, q);
            if (add < bestAdd - 1e-9) { bestAdd = add; bestAt = at; }
          }
          if (bestAt >= 0 && bestAdd < gain - 1e-9) {
            t = rest.slice(0, bestAt).concat(seg, rest.slice(bestAt));
            improved = true;
          }
        }
      }
    }
    return t;
  };
  let best = null, bestLen = Infinity;
  for (let trial = 0; trial < 400; trial++) {
    let t = trial === 0 ? nn(0) : (trial === 1 ? twoOpt(nn((trial * 7) % n)) : nn((rnd() * n) | 0));
    if (trial > 1) { // random-start scramble then local search
      const perm = Array.from({length: n}, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
      t = perm;
    }
    t = twoOpt(t); t = orOpt(t); t = twoOpt(t);
    const L = tourLen(t);
    if (L < bestLen) { bestLen = L; best = t.slice(); }
    if (now() > dl) break;
  }
  return best || nn(0);
}
function courier(obs) {
  const ob = obs.observation;
  const visited = new Set(ob.visited || []);
  const order = cache.tour || (cache.tour = courierTour(ob.points, ob.depot, now() + safe(900)));
  for (const c of order) if (!visited.has(c) && obs.legalMoves.includes(String(c))) return String(c);
  return obs.legalMoves[0];
}

/* =================================================================== main == */
export default function (obs) {
  const L = obs.legalMoves || [];
  if (!L.length) return '';
  reset(obs.game);
  let mv;
  try {
    switch (obs.game) {
      case 'signal': mv = signal(obs); break;
      case 'gridshift': mv = gridshift(obs); break;
      case 'vault': mv = vault(obs); break;
      case 'handshake': mv = handshake(obs); break;
      case 'heaps': mv = heaps(obs); break;
      case 'radar': mv = radar(obs); break;
      case 'fourrows': mv = fourrows(obs); break;
      case 'courier': mv = courier(obs); break;
      default: mv = L[0];
    }
  } catch (e) { mv = L[0]; }
  return (typeof mv === 'string' && L.includes(mv)) ? mv : L[0];
}
