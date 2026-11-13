const W = 1012, H = 720, NI = 4, L = 5, R = 5;          // inputs, layers, nodes per layer (depth rows)
const STEP = 350;                                         // ms between layer activations (the "fast" wave)
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const dpr = window.devicePixelRatio || 1;
cv.width = W * dpr; cv.height = H * dpr;
cv.style.aspectRatio = W + '/' + H;

// ---- geometry: oblique projection, back rows shift up-right ----
const inP = i => ({x: 70 + i * 37, y: 596 - i * 36.5});
const nP  = (c, r) => ({x: 218 + c * 153 + r * 30.8, y: 602 - r * 30.5});
const INF = {x: 740, y: 232, r: 48};

// ---- network ----
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let net, inputs = [1,1,1,1], act, t0 = performance.now(), seed = 7;
let noise = .3;                                          // chance that any node fails to fire on a given trial
const tally = Array(L + 1).fill(0);                      // tally[0] = nothing fired, tally[c+1] = layer c won
const AUTO_MS = 7000;                                    // auto-repeat period

function build() {
  const rnd = rng(seed);
  net = [];
  for (let c = 0; c < L; c++) {
    const layer = [], prevN = c ? R : NI, k = c ? 3 : 2;
    for (let r = 0; r < R; r++) {
      const pre = [...Array(prevN).keys()].sort(() => rnd() - .5).slice(0, k);
      layer.push({pre, need: 2});                         // fires if >=2 of its preferred inputs are active
    }
    net.push(layer);
  }
  evaluate();
}
function evaluate() {
  let prev = inputs.map(Boolean);
  act = net.map(layer => prev = layer.map(n => Math.random() >= noise && n.pre.filter(i => prev[i]).length >= n.need));
  t0 = performance.now();
  tally[winner() + 1]++;
}
const count = c => act[c].filter(Boolean).length;
const conductionDelay = c => 2400 - c * 500; // ms; explicit toy assumption
const arrivalTime = c => (c + 1) * STEP + conductionDelay(c);
const winner = () => {
  let best = -1;
  for (let c = 0; c < L; c++) if (count(c) && (best < 0 || arrivalTime(c) < arrivalTime(best))) best = c;
  return best;
};

// ---- drawing ----
const lerp = (a, b, t) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
function line(a, b, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function dot(p, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill(); }

function draw(now) {
  if ($('auto').checked && now - t0 > AUTO_MS) evaluate();   // fresh trial, fresh random dropout
  const el = now - t0, win = winner();
  const lit = c => el > (c + 1) * STEP;                  // layer c has fired by now
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // 1. faint all-to-all mesh, brighter where an active chain runs
  for (let c = 0; c < L; c++) for (let r = 0; r < R; r++) {
    const to = nP(c, r), n = net[c][r];
    for (let i = 0; i < (c ? R : NI); i++) {
      const from = c ? nP(c - 1, i) : inP(i), pref = n.pre.includes(i);
      const on = pref && lit(c) && act[c][r] && (c ? act[c - 1][i] : inputs[i]);
      line(from, to, on ? 'rgba(255,230,80,.85)' : 'rgba(168,212,230,.28)', on ? 1.4 : .6);
    }
  }

  // 2. myelinated inference lines: thicker + faster the more complex the layer
  for (let c = 0; c < L; c++) for (let r = 0; r < R; r++) {
    const p = nP(c, r), on = act[c][r] && lit(c), top = on && c === win;
    const a = !on ? .10 : (top ? .95 : .35);   // suppressed backups are dimmed once a higher layer wins
    line(p, {x: INF.x, y: INF.y + 8}, `rgba(255,140,128,${a})`, .6 + c * 1.5);
    if (on) {
      const progress = (el - (c + 1) * STEP) / conductionDelay(c);
      if (progress >= 0 && progress <= 1) dot(lerp(p, INF, progress), 2.5 + c * .6, 'rgba(240,80,70,.9)');
    }
  }

  // 3. nodes
  for (let i = 0; i < NI; i++) { const p = inP(i); dot(p, 11, inputs[i] ? '#6fd36f' : '#1c3a1c'); if (!inputs[i]) { ctx.strokeStyle = '#4a7a4a'; ctx.lineWidth = 1.5; ctx.stroke(); } }
  for (let c = 0; c < L; c++) for (let r = 0; r < R; r++) {
    const p = nP(c, r), on = act[c][r] && lit(c);
    if (on) { ctx.shadowColor = '#ffe600'; ctx.shadowBlur = 12; }
    dot(p, 9, on ? '#ffe600' : '#a8d4e6');
    ctx.shadowBlur = 0;
    if (on && c === win) { ctx.strokeStyle = '#ff9f94'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 6.2832); ctx.stroke(); }
  }

  // 4. inference node: pulses once the winning signal has arrived
  const arrive = win >= 0 ? arrivalTime(win) : 1e9;
  const decided = el > arrive;
  ctx.shadowColor = '#ff9f94'; ctx.shadowBlur = decided ? 40 : 0;
  dot(INF, INF.r, decided ? '#ffc4c4' : '#ffdada'); ctx.shadowBlur = 0;
  ctx.fillStyle = '#8a1c1c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px system-ui,Arial'; ctx.fillText(decided ? 'L' + (win + 1) : (win < 0 && el > STEP * 2 ? '–' : ''), INF.x, INF.y);

  // 5. labels
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui,Arial'; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right'; ctx.fillText('Inference Node', 683, 233);
  ctx.textAlign = 'center'; ctx.fillText('Layer Activation and Inference Arrival Timing', 494, 684);
  ctx.font = '14px system-ui,Arial'; ctx.fillStyle = '#9ab';
  ctx.textAlign = 'left'; ctx.fillText('input', 40, 640);
  for (let c = 0; c < L; c++) { ctx.textAlign = 'center'; ctx.fillText(c < L - 1 ? (c ? 'L' + (c + 1) : 'L1 simple') : 'L5 complex', nP(c, 0).x, 630); }

  info(decided, win);
  requestAnimationFrame(draw);
}

// ---- readout ----
const infoEl = document.getElementById('info'); let lastHTML = '';
function info(decided, win) {
  let h = '';
  for (let c = 0; c < L; c++) {
    const n = count(c), w = decided && c === win;
    h += `<div class="${w ? 'win' : ''}">L${c + 1} <span style="opacity:.6">depth ${c + 1}</span></div>` +
         `<div class="${w ? 'win' : ''}"><div class="bar"><i style="width:${n / R * 100}%"></i></div></div>` +
         `<div class="${w ? 'win' : ''}">${n}/${R} active${w ? ' — wins' : (decided && n && c < win ? ' — backup' : '')}</div>`;
  }
  if (h !== lastHTML) { infoEl.innerHTML = h; lastHTML = h; }

  const silent = win === L - 2 ? 'L5' : `L${win + 2}–L5`;
  const m = !decided ? (win < 0 ? 'Nothing fired — no inference.' : 'Signals travelling…')
          : win === L - 1 ? 'L5 evidence arrived first; other active layers are later alternatives.'
          : `${silent} stayed silent — backup pattern L${win + 1} provides the first arriving evidence.`;
  const t = 'Trials by earliest evidence layer — ' + [...Array(L).keys()].reverse().map(c => `L${c + 1}: ${tally[c + 1]}`).join(' · ') + ` · none: ${tally[0]}`;
  if ($('msg').textContent !== m) $('msg').textContent = m;
  if ($('tally').textContent !== t) $('tally').textContent = t;
}

// ---- interaction ----
cv.addEventListener('pointerdown', e => {
  const b = cv.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width, y = (e.clientY - b.top) * H / b.height;
  for (let i = 0; i < NI; i++) { const p = inP(i); if (Math.hypot(p.x - x, p.y - y) < 20) { inputs[i] ^= 1; evaluate(); return; } }
});
const $ = id => document.getElementById(id);
$('bAll').onclick = () => { inputs = [1,1,1,1]; evaluate(); };
$('bClr').onclick = () => { inputs = [0,0,0,0]; evaluate(); };
$('bRnd').onclick = () => { inputs = inputs.map(() => Math.random() < .6 ? 1 : 0); evaluate(); };
$('bRew').onclick = () => { seed = (Math.random() * 1e9) | 0; tally.fill(0); build(); };
$('noise').oninput = e => { noise = e.target.value / 100; $('nv').textContent = e.target.value + '%'; tally.fill(0); evaluate(); };
$('bRep').onclick = () => { t0 = performance.now(); };

build();
requestAnimationFrame(draw);

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) $('auto').checked = false;
