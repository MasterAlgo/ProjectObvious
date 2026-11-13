// ─── State ───────────────────────────────────────────────────────────────────
let target = 'ABRACADABRA';
let grades = [];        // unique symbols → grade index
let gradeMap = {};      // symbol → grade
let inputLen = 0;

let latentNodes = [];   // [{positions:[], grades:[], label:''}]
let running = false;
let timer = null;
let stats = {total:0, tp:0, fp:0, fn:0, tn:0};
let currentInput = null;
let currentLatent = [];
let currentInference = false;
let isTarget = false;

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  stopRun();
  seriesDone = 0;
  currentInput = null; currentLatent = []; currentInference = false;
  target = document.getElementById('targetSeq').value.toUpperCase().replace(/[^A-Z]/g, '') || 'ABRACADABRA';
  document.getElementById('targetSeq').value = target;
  grades = [...new Set(target.split(''))];
  gradeMap = {};
  grades.forEach((g,i) => gradeMap[g] = i);
  inputLen = target.length;
  buildLatentNodes();
  renderSubpats();
  describeCoverage();
  drawNetwork(null, [], false);
  resetStats();
}

function buildLatentNodes() {
  const n = parseInt(document.getElementById('nodeCount').value);
  const f = parseInt(document.getElementById('fanin').value);
  const overlap = parseInt(document.getElementById('overlapToggle').value) === 1;
  const clampedF = Math.min(f, inputLen);

  latentNodes = [];

  if (overlap) {
    // Overlapping: sliding/random windows that share positions
    for (let i = 0; i < n; i++) {
      // pick a random start, take f consecutive positions (wrapping or clamped)
      const maxStart = Math.max(0, inputLen - clampedF);
      const start = Math.floor(Math.random() * (maxStart + 1));
      const positions = [];
      for (let j = 0; j < clampedF; j++) {
        positions.push(Math.min(start + j, inputLen - 1));
      }
      // grade = what target has at those positions
      const g = positions.map(p => gradeMap[target[p]]);
      latentNodes.push({
        positions,
        grades: g,
        label: positions.map(p => target[p]).join('')
      });
    }
  } else {
    // Non-overlapping: partition positions as evenly as possible
    // Each node gets floor(inputLen/n) positions, non-shared
    const shuffled = Array.from({length: inputLen}, (_,i) => i);
    // shuffle
    for (let i = shuffled.length-1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
    }
    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * inputLen / n), to = Math.floor((i + 1) * inputLen / n);
      const positions = shuffled.slice(from, Math.min(to, from + clampedF)).sort((a,b)=>a-b);
      // Empty partitions contribute no evidence; report their effective fan-in.
      const g = positions.map(p => gradeMap[target[p]]);
      latentNodes.push({
        positions,
        grades: g,
        label: positions.map(p => target[p]).join('')
      });
    }
  }
}

function describeCoverage() {
  const covered = new Set(latentNodes.flatMap(node => node.positions));
  const space = grades.length ** inputLen, matches = grades.length ** (inputLen - covered.size);
  const conditional = space > 1 ? (matches - 1) / (space - 1) : 0;
  document.getElementById('coverageNote').textContent = 'Alphabet: ' + grades.length + ' · input states: ' + space.toLocaleString() + ' · distinct positions checked: ' + covered.size + '/' + inputLen + ' · effective fan-in: ' + latentNodes.map(n => n.positions.length).join(', ') + ' · exact false-positive probability among uniform non-target inputs: ' + conditional.toExponential(3) + '. The rate below is sampled.';
}

function renderSubpats() {
  const ol = parseInt(document.getElementById('overlapToggle').value);
  const list = document.getElementById('subpatList');
  list.innerHTML = '';
  latentNodes.forEach((node, index) => {
    const pill = document.createElement('div');
    pill.className = 'pill ' + (ol ? 'overlap' : 'nooverlap');
    pill.id = 'pill_' + index;
    // show positions too
    pill.textContent = node.label + ' [' + node.positions.join(',') + ']';
    list.appendChild(pill);
  });
}

// ─── Inference ───────────────────────────────────────────────────────────────
function runInference(input) {
  // input: array of grade indices, length = inputLen
  const latentFired = latentNodes.map(node => {
    return node.positions.every((pos, i) => input[pos] === node.grades[i]);
  });
  const inferenceFired = latentFired.every(Boolean);
  return {latentFired, inferenceFired};
}

function randomInput() {
  return Array.from({length: inputLen}, () => Math.floor(Math.random() * grades.length));
}

function targetInput() {
  return target.split('').map(c => gradeMap[c]);
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
function drawNetwork(input, latentFired, inferenceFired) {
  const canvas = document.getElementById('netCanvas');
  const W = canvas.offsetWidth;
  canvas.width = W;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, W, 260);

  const n = inputLen;
  const lCount = latentNodes.length;

  // Layout
  const inputY = 210;
  const latentY = 120;
  const inferY = 36;

  const inputXs = Array.from({length: n}, (_, i) => (W * (i + 0.5)) / n);
  const latentXs = lCount === 1
    ? [W/2]
    : Array.from({length: lCount}, (_, i) => W * 0.15 + (W * 0.7 * i) / (lCount - 1));
  const inferX = W / 2;

  const R_input = Math.min(18, (W / n) * 0.38);
  const R_latent = 20;
  const R_infer = 26;

  // Draw wires: input → latent
  latentNodes.forEach((node, li) => {
    node.positions.forEach((pos, pi) => {
      const fired = input && latentFired && latentFired[li] && input[pos] === node.grades[pi];
      ctx.beginPath();
      ctx.moveTo(inputXs[pos], inputY - R_input);
      ctx.lineTo(latentXs[li], latentY + R_latent);
      ctx.strokeStyle = fired ? 'rgba(0,255,224,0.6)' : 'rgba(30,58,74,0.7)';
      ctx.lineWidth = fired ? 1.5 : 0.8;
      ctx.stroke();
    });
  });

  // Draw wires: latent → inference
  latentNodes.forEach((node, li) => {
    const fired = latentFired && latentFired[li];
    ctx.beginPath();
    ctx.moveTo(latentXs[li], latentY - R_latent);
    ctx.lineTo(inferX, inferY + R_infer);
    ctx.strokeStyle = fired ? 'rgba(0,255,224,0.6)' : 'rgba(30,58,74,0.7)';
    ctx.lineWidth = fired ? 1.5 : 0.8;
    ctx.stroke();
  });

  // Draw input nodes
  inputXs.forEach((x, i) => {
    const gradeIdx = input ? input[i] : -1;
    const symbol = target[i];
    const on = input !== null;
    const matchedByAny = on && latentNodes.some((node, li) =>
      node.positions.includes(i) && latentFired && latentFired[li]
    );

    ctx.beginPath();
    ctx.arc(x, inputY, R_input, 0, Math.PI * 2);
    ctx.fillStyle = matchedByAny ? 'rgba(0,255,224,0.18)' : (on ? 'rgba(255,255,255,0.04)' : 'rgba(26,37,53,0.8)');
    ctx.fill();
    ctx.strokeStyle = matchedByAny ? '#00ffe0' : (on ? '#2a4060' : '#1a2535');
    ctx.lineWidth = matchedByAny ? 1.5 : 1;
    ctx.stroke();

    // symbol
    ctx.fillStyle = matchedByAny ? '#00ffe0' : (on ? '#8899aa' : '#3a5070');
    ctx.font = `bold ${Math.max(9, R_input * 0.8)}px Share Tech Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (input !== null) {
      ctx.fillText(grades[input[i]] || '?', x, inputY);
    } else {
      ctx.fillText(symbol, x, inputY);
    }

    // position index
    ctx.fillStyle = '#3a5070';
    ctx.font = `8px Share Tech Mono`;
    ctx.fillText(i, x, inputY + R_input + 8);
  });

  // Draw latent nodes
  latentXs.forEach((x, li) => {
    const fired = latentFired && latentFired[li];
    ctx.beginPath();
    ctx.arc(x, latentY, R_latent, 0, Math.PI * 2);
    ctx.fillStyle = fired ? 'rgba(0,255,224,0.15)' : 'rgba(26,37,53,0.8)';
    ctx.fill();
    ctx.strokeStyle = fired ? '#00ffe0' : '#1a2535';
    ctx.lineWidth = fired ? 2 : 1;
    ctx.stroke();
    if (fired) {
      ctx.beginPath();
      ctx.arc(x, latentY, R_latent + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,255,224,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = fired ? '#00ffe0' : '#3a5070';
    ctx.font = `bold 10px Share Tech Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(latentNodes[li].label.slice(0,4), x, latentY);
  });

  // Draw inference node
  ctx.beginPath();
  ctx.arc(inferX, inferY, R_infer, 0, Math.PI * 2);
  const infColor = inferenceFired
    ? (isTarget ? '#00ffe0' : '#ff3b3b')
    : 'rgba(26,37,53,0.8)';
  ctx.fillStyle = inferenceFired
    ? (isTarget ? 'rgba(0,255,224,0.15)' : 'rgba(255,59,59,0.15)')
    : 'rgba(26,37,53,0.8)';
  ctx.fill();
  ctx.strokeStyle = infColor;
  ctx.lineWidth = inferenceFired ? 2.5 : 1;
  ctx.stroke();
  if (inferenceFired) {
    ctx.beginPath();
    ctx.arc(inferX, inferY, R_infer + 7, 0, Math.PI * 2);
    ctx.strokeStyle = inferenceFired ? (isTarget ? 'rgba(0,255,224,0.25)' : 'rgba(255,59,59,0.25)') : 'transparent';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = inferenceFired ? infColor : '#3a5070';
  ctx.font = `bold 9px Orbitron, Share Tech Mono`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('INFER', inferX, inferY);

  // Layer labels
  ctx.fillStyle = '#2a4060';
  ctx.font = '9px Share Tech Mono';
  ctx.textAlign = 'left';
  ctx.fillText('INPUT LAYER', 6, inputY - R_input - 10);
  ctx.fillText('LATENT AND-NODES', 6, latentY - R_latent - 10);
  ctx.fillText('INFERENCE', 6, inferY - R_infer - 8);
}

// ─── Run loop ─────────────────────────────────────────────────────────────────
function resetStats() {
  stats = {total:0, tp:0, fp:0, fn:0, tn:0};
  updateStats();
  document.getElementById('logWrap').innerHTML = '';
}

function updateStats() {
  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statTP').textContent = stats.tp;
  document.getElementById('statFP').textContent = stats.fp;
  document.getElementById('statFN').textContent = stats.fn;
  document.getElementById('statTN').textContent = stats.tn;
  const negTotal = stats.fp + stats.tn;
  const fpRate = negTotal > 0 ? ((stats.fp / negTotal) * 100).toFixed(1) + '%' : '0%';
  document.getElementById('statFPRate').textContent = fpRate;
}

function log(msg, cls) {
  const wrap = document.getElementById('logWrap');
  const el = document.createElement('div');
  el.className = 'entry ' + (cls||'');
  el.textContent = msg;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  // keep log short
  while (wrap.children.length > 80) wrap.removeChild(wrap.firstChild);
}

let seriesDone = 0;
let seriesTotal = 0;

function step() {
  if (!running) return;
  if (seriesDone >= seriesTotal) {
    stopRun();
    log(`── Series complete. FP: ${stats.fp}/${stats.fp+stats.tn} negatives, FN: ${stats.fn}/${stats.fn+stats.tp} targets ──`);
    return;
  }

  // Every ~8 steps inject the true target
  const injectTarget = (seriesDone % 8 === 0);
  currentInput = injectTarget ? targetInput() : randomInput();
  isTarget = currentInput.every((g, i) => g === gradeMap[target[i]]);

  const {latentFired, inferenceFired} = runInference(currentInput);
  currentLatent = latentFired;
  currentInference = inferenceFired;

  // Update stats
  stats.total++;
  if (isTarget && inferenceFired) { stats.tp++; }
  else if (!isTarget && inferenceFired) { stats.fp++; }
  else if (isTarget && !inferenceFired) { stats.fn++; }
  else { stats.tn++; }

  updateStats();

  // Update pill highlights
  latentNodes.forEach((node, li) => {
    const pill = document.querySelector(`#subpatList .pill:nth-child(${li+1})`);
    if (pill) pill.classList.toggle('active', latentFired[li]);
  });

  // Log notable events
  if (isTarget && inferenceFired) log(`[${seriesDone}] TARGET → FIRED ✓ (TP)`, 'tp');
  else if (isTarget && !inferenceFired) log(`[${seriesDone}] TARGET → MISSED (FN)`, 'fn');
  else if (!isTarget && inferenceFired) {
    const inputStr = currentInput.map(g => grades[g]).join('');
    log(`[${seriesDone}] RANDOM ${inputStr} → FIRED! (FP)`, 'fp');
  }

  drawNetwork(currentInput, latentFired, inferenceFired);
  seriesDone++;

  const spd = parseInt(document.getElementById('speed').value);
  const delay = Math.round(1100 / spd);
  timer = setTimeout(step, delay);
}

function startRun() {
  if (running) return;
  resetStats();
  seriesDone = 0;
  seriesTotal = parseInt(document.getElementById('seriesLen').value);
  running = true;
  step();
}

function stopRun() {
  running = false;
  if (timer) clearTimeout(timer);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('btnStart').addEventListener('click', () => { init(); startRun(); });
document.getElementById('btnStop').addEventListener('click', stopRun);
document.getElementById('btnRegen').addEventListener('click', () => { init(); drawNetwork(null,[],false); });

for (const [id, label] of [['nodeCount','nodeCountVal'],['fanin','faninVal'],['overlapToggle','overlapVal'],['speed','speedVal'],['seriesLen','seriesVal']]) {
  document.getElementById(id).addEventListener('input', e => {
    document.getElementById(label).textContent = id === 'overlapToggle' ? (e.target.value === '1' ? 'on' : 'off') : e.target.value;
    if (['nodeCount','fanin','overlapToggle','seriesLen'].includes(id)) init();
  });
}
document.getElementById('targetSeq').addEventListener('change', init);
// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => { init(); });
window.addEventListener('resize', () => { drawNetwork(currentInput, currentLatent, currentInference); });
