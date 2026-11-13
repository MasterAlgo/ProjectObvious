// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
let target     = 'ABRACADABRA';
let grades     = [];      // unique symbols
let gradeMap   = {};      // symbol → index
let seqLen     = 0;

let latentNodes   = [];   // {pattern:[], label:'', sustainLeft:0}
// latentNodes[i].pattern is an array of grade-indices, length = fanin
// matched against the LEFT-aligned portion of the sensor window
// (sparse demo: sensor wider than fanin → only first fanin slots checked)

let sustainLevels = [];

// Current run
let running          = false;
let timer            = null;
let currentSeq       = [];   // grade indices, length seqLen
let isTargetSeq      = false;
let currentStride    = 0;    // leading edge of sensor window
let inferFiredStride = -1;

// Series
let seriesDone  = 0;
let seriesTotal = 0;

// Stats
let stats = {total:0, early:0, tp:0, fp:0, fn:0, fireStrides:[]};

// ════════════════════════════════════════════════════════
//  INIT / BUILD
// ════════════════════════════════════════════════════════
function init() {
  stopRun();
  currentSeq = []; currentStride = 0; inferFiredStride = -1; seriesDone = 0;
  target   = document.getElementById('targetSeq').value.toUpperCase().replace(/[^A-Z]/g, '') || 'ABRACADABRA';
  document.getElementById('targetSeq').value = target;
  grades   = [...new Set(target.split(''))];
  gradeMap = {};
  grades.forEach((g,i) => gradeMap[g] = i);
  seqLen   = target.length;
  normalizeControls();

  buildLatentNodes();
  buildSustainBars();
  renderSeqRow([]);
  drawNetwork([], [], false);
  resetStats();
}

function normalizeControls() {
  const sensor = document.getElementById('sensorWidth'), fanin = document.getElementById('fanin');
  sensor.min = 1; sensor.max = seqLen; sensor.value = Math.max(1, Math.min(seqLen, Number(sensor.value)));
  fanin.min = 1; fanin.max = Math.min(9, seqLen, Number(sensor.value)); fanin.value = Math.max(1, Math.min(Number(fanin.max), Number(fanin.value)));
  const k = document.getElementById('kInfer'); k.max = Number(document.getElementById('nodeCount').value); k.value = Math.min(Number(k.value), Number(k.max));
  for (const [id, label] of [['sensorWidth','sensorWidthVal'],['fanin','faninVal'],['kInfer','kInferVal']]) document.getElementById(label).textContent = document.getElementById(id).value;
}

function buildLatentNodes() {
  const n      = parseInt(document.getElementById('nodeCount').value);
  const fanin  = Math.min(parseInt(document.getElementById('fanin').value), seqLen);

  // Generate n evenly-spaced consecutive subpatterns of the target.
  // Each is a substring of length=fanin, start positions spread across the target.
  latentNodes = [];
  for (let i = 0; i < n; i++) {
    const maxStart = seqLen - fanin;
    const start    = Math.round((maxStart * i) / Math.max(n - 1, 1));
    const pat      = [];
    for (let j = 0; j < fanin; j++) pat.push(gradeMap[target[start + j]]);
    latentNodes.push({
      pattern: pat,
      label:   target.slice(start, start + fanin),
      startPos: start        // absolute position in target where this subpattern lives
    });
  }
  sustainLevels = new Array(latentNodes.length).fill(0);
}

function buildSustainBars() {
  const bars = document.getElementById('sustainBars');
  bars.innerHTML = '';
  latentNodes.forEach((node, i) => {
    const row = document.createElement('div');
    row.className = 'sustain-row';
    row.innerHTML = `
      <div class="sustain-name" title="${node.label}">${node.label}</div>
      <div class="sustain-track">
        <div class="sustain-fill" id="sbar_${i}" style="width:0%"></div>
      </div>`;
    bars.appendChild(row);
  });
}

// ════════════════════════════════════════════════════════
//  SEQUENCE ROW
// ════════════════════════════════════════════════════════
function renderSeqRow(seq) {
  const row = document.getElementById('seqRow');
  row.innerHTML = '';
  const sw = sensorWidth();
  for (let i = 0; i < seqLen; i++) {
    const cell = document.createElement('div');
    cell.className = 'seq-cell future';
    cell.id = `sc_${i}`;
    const sym = seq.length > i ? grades[seq[i]] : (target[i] || '·');
    cell.innerHTML = `<div class="sym">${sym}</div><div class="pos">${i}</div>`;
    row.appendChild(cell);
  }
}

function updateSeqRow(seq, stride) {
  const sw      = sensorWidth();
  const winStart = Math.max(0, stride - sw + 1);
  const winEnd   = stride; // inclusive, stride = front of window

  for (let i = 0; i < seqLen; i++) {
    const cell = document.getElementById(`sc_${i}`);
    if (!cell) continue;
    const sym = seq.length > i ? grades[seq[i]] : '·';
    cell.querySelector('.sym').textContent = sym;

    let cls = 'seq-cell ';
    if (i < winStart)        cls += 'past';
    else if (i === stride)   cls += 'sensor-front in-sensor';
    else if (i <= winEnd)    cls += 'in-sensor';
    else if (i > stride && inferFiredStride >= 0 && i <= inferFiredStride) cls += 'infer-fired';
    else                     cls += 'future';
    cell.className = cls;
  }

  // Bracket label
  const bracket = document.getElementById('sensorBracket');
  const winContent = seq.slice(winStart, stride + 1).map(g => grades[g]).join('');
  bracket.textContent = `sensor [${winStart}..${stride}] = "${winContent}"  (width ${sw}, fanin ${faninVal()})`;
}

// ════════════════════════════════════════════════════════
//  PROCESS ONE STRIDE
// ════════════════════════════════════════════════════════
function sensorWidth() { return parseInt(document.getElementById('sensorWidth').value); }
function faninVal()    { return Math.min(parseInt(document.getElementById('fanin').value), seqLen); }
function sustainParam(){ return parseInt(document.getElementById('sustain').value); }
function kInferParam() {
  const n = parseInt(document.getElementById('nodeCount').value);
  return Math.min(parseInt(document.getElementById('kInfer').value), n);
}

function processStride(seq, stride) {
  const sw      = sensorWidth();
  const fanin   = faninVal();
  const sustain = sustainParam();

  // Window: the last sw symbols up to and including current stride
  const winStart = Math.max(0, stride - sw + 1);
  const window   = seq.slice(winStart, stride + 1); // length 1..sw

  // Step 1: decay existing sustain
  sustainLevels = sustainLevels.map(s => Math.max(0, s - 1));

  // Step 2: check each latent node
  // A node matches when the window has just fully covered its subpattern.
  // That happens when: stride === node.startPos + fanin - 1
  // (the last symbol of its pattern just entered the window front)
  // We also require the window actually contains those positions.
  latentNodes.forEach((node, i) => {
    const patEnd = node.startPos + fanin - 1; // last absolute position of this pattern
    if (stride === patEnd && node.startPos >= winStart && patEnd <= stride && node.pattern.length <= sw) {
      // Check: seq[node.startPos .. node.startPos+fanin-1] matches node.pattern
      const match = node.pattern.every((g, j) => seq[node.startPos + j] === g);
      if (match) {
        sustainLevels[i] = sustain;
      }
    }
  });

  // Step 3: inference — K or more latent nodes alive simultaneously?
  const latentActive   = sustainLevels.map(s => s > 0);
  const activeCount    = latentActive.filter(Boolean).length;
  const k              = kInferParam();
  const inferenceFired = activeCount >= k;

  return { latentActive, inferenceFired, activeCount, window, winStart };
}



// ════════════════════════════════════════════════════════
//  DRAW NETWORK
// ════════════════════════════════════════════════════════
function drawNetwork(latentActive, window, inferenceFired) {
  const canvas = document.getElementById('netCanvas');
  const W      = canvas.offsetWidth;
  canvas.width = W;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, 260);

  const sw     = sensorWidth();
  const fanin  = faninVal();
  const lCount = latentNodes.length;

  // Y positions
  const sensorY = 210;
  const latentY = 120;
  const inferY  = 38;

  // X positions — sensor nodes
  const sensorXs = Array.from({length: sw}, (_, i) => W * (i + 0.5) / sw);
  // latent nodes
  const latentXs = lCount === 1 ? [W/2] :
    Array.from({length: lCount}, (_, i) => W*0.12 + W*0.76*i/(lCount-1));
  const inferX = W / 2;

  const Rs  = Math.min(18, (W / sw) * 0.38);
  const Rl  = 20;
  const Ri2 = 24;

  // ── Wires: sensor → latent ──
  // Each latent node's pattern occupies specific absolute positions.
  // In the sensor window, its pattern slots map to window positions:
  // window[k] = seq[winStart + k], and node.startPos maps to window offset = node.startPos - winStart
  latentNodes.forEach((node, li) => {
    const active = latentActive[li];
    for (let j = 0; j < sw; j++) {
      if (j >= sensorXs.length) break;
      const isFaninSlot = j < fanin;
      // Is this window slot part of this node's pattern?
      const absPos = (window.length > 0) ? (currentStride - sw + 1 + j) : j;
      const isNodeSlot = (j < fanin); // first fanin slots are the "active" receptive field
      ctx.beginPath();
      ctx.moveTo(sensorXs[j], sensorY - Rs);
      ctx.lineTo(latentXs[li], latentY + Rl);
      if (isNodeSlot) {
        ctx.strokeStyle = active ? 'rgba(167,139,250,0.55)' : 'rgba(26,32,64,0.55)';
        ctx.lineWidth = active ? 1.5 : 0.7;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(20,26,55,0.3)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3,5]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // ── Wires: latent → infer ──
  latentNodes.forEach((_, li) => {
    const active = latentActive[li];
    ctx.beginPath();
    ctx.moveTo(latentXs[li], latentY - Rl);
    ctx.lineTo(inferX, inferY + Ri2);
    ctx.strokeStyle = active ? 'rgba(167,139,250,0.55)' : 'rgba(26,32,64,0.7)';
    ctx.lineWidth = active ? 1.5 : 0.7;
    ctx.stroke();
  });

  // ── Sensor nodes ──
  sensorXs.forEach((x, j) => {
    const sym        = window.length > j ? grades[window[j]] : '·';
    const isFaninSlot = j < fanin;
    const anyActive  = latentActive.some(Boolean);
    const matched    = anyActive && window.length > j &&
                       latentNodes.some((n, li) => latentActive[li] && j < n.pattern.length && window[j] === n.pattern[j]);

    ctx.beginPath();
    ctx.arc(x, sensorY, Rs, 0, Math.PI*2);
    ctx.fillStyle = matched
      ? 'rgba(167,139,250,0.15)'
      : (isFaninSlot ? 'rgba(255,255,255,0.03)' : 'rgba(10,12,30,0.6)');
    ctx.fill();
    ctx.strokeStyle = matched ? '#a78bfa'
      : (isFaninSlot ? '#2a3560' : '#141828');
    ctx.lineWidth = matched ? 1.8 : (isFaninSlot ? 1 : 0.5);
    ctx.stroke();

    ctx.fillStyle = matched ? '#c4b5fd' : (isFaninSlot ? '#556080' : '#232840');
    ctx.font = `bold ${Math.max(9, Rs*0.78)}px Share Tech Mono`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, x, sensorY);

    ctx.fillStyle = isFaninSlot ? '#2a3560' : '#161a30';
    ctx.font = '8px Share Tech Mono';
    ctx.fillText(j, x, sensorY + Rs + 8);
  });

  // ── Latent nodes ──
  latentXs.forEach((x, li) => {
    const active    = latentActive[li];
    const sustPct   = sustainParam() > 0 ? sustainLevels[li] / sustainParam() : 0;

    ctx.beginPath();
    ctx.arc(x, latentY, Rl, 0, Math.PI*2);
    ctx.fillStyle = active ? `rgba(167,139,250,${0.08 + sustPct*0.18})` : 'rgba(14,16,34,0.8)';
    ctx.fill();
    ctx.strokeStyle = active ? '#a78bfa' : '#1a2040';
    ctx.lineWidth   = active ? 2 : 1;
    ctx.stroke();

    if (active) {
      ctx.beginPath();
      ctx.arc(x, latentY, Rl + 5, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(167,139,250,${sustPct * 0.28})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = active ? '#c4b5fd' : '#2a3465';
    ctx.font = 'bold 9px Share Tech Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(latentNodes[li].label.slice(0,6), x, latentY);
  });

  // ── Inference node ──
  const isTp    = isTargetSeq;
  const iColor  = inferenceFired ? (isTp ? '#00ffe0' : '#ff6b35') : '#1a2040';
  ctx.beginPath();
  ctx.arc(inferX, inferY, Ri2, 0, Math.PI*2);
  ctx.fillStyle = inferenceFired
    ? (isTp ? 'rgba(0,255,224,0.13)' : 'rgba(255,107,53,0.13)')
    : 'rgba(14,16,34,0.8)';
  ctx.fill();
  ctx.strokeStyle = iColor;
  ctx.lineWidth   = inferenceFired ? 2.5 : 1;
  ctx.stroke();

  if (inferenceFired) {
    ctx.beginPath();
    ctx.arc(inferX, inferY, Ri2 + 7, 0, Math.PI*2);
    ctx.strokeStyle = isTp ? 'rgba(0,255,224,0.18)' : 'rgba(255,107,53,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = inferenceFired ? iColor : '#2a3465';
  ctx.font = 'bold 8px Orbitron';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const kLabel = `${kInferParam()}/${latentNodes.length}`;
  ctx.fillText(`INFER ${kLabel}`, inferX, inferY);

  // ── Layer labels ──
  ctx.fillStyle = '#1e2850';
  ctx.font = '9px Share Tech Mono';
  ctx.textAlign = 'left';
  ctx.fillText(`SENSOR WINDOW  [width=${sw}, fanin=${fanin}]`, 6, sensorY - Rs - 9);
  ctx.fillText('LATENT AND-NODES  (subpattern detectors)', 6, latentY - Rl - 9);
  ctx.fillText('INFERENCE', 6, inferY - Ri2 - 7);

  ctx.fillStyle = '#3a4878';
  ctx.font = '10px Share Tech Mono';
  ctx.textAlign = 'right';
  ctx.fillText(`stride ${currentStride} / ${seqLen - 1}`, W - 8, inferY - Ri2 - 7);
}

// ════════════════════════════════════════════════════════
//  SUSTAIN BARS
// ════════════════════════════════════════════════════════
function updateSustainBars(latentActive) {
  const max = sustainParam();
  sustainLevels.forEach((s, i) => {
    const bar = document.getElementById(`sbar_${i}`);
    if (!bar) return;
    bar.style.width = (max > 0 ? s / max * 100 : 0) + '%';
    bar.className = 'sustain-fill' + (latentActive[i] ? ' live' : '');
  });
}

// ════════════════════════════════════════════════════════
//  STATS & LOG
// ════════════════════════════════════════════════════════
function resetStats() {
  stats = {total:0, early:0, tp:0, fp:0, fn:0, fireStrides:[]};
  updateStats();
  document.getElementById('logWrap').innerHTML = '';
}

function updateStats() {
  document.getElementById('statTotal').textContent    = stats.total;
  document.getElementById('statEarly').textContent    = stats.early;
  document.getElementById('statTP').textContent       = stats.tp;
  document.getElementById('statFP').textContent       = stats.fp;
  document.getElementById('statFN').textContent       = stats.fn;
  const avg = stats.fireStrides.length
    ? (stats.fireStrides.reduce((a,b)=>a+b,0)/stats.fireStrides.length).toFixed(1)
    : '—';
  document.getElementById('statAvgStride').textContent = avg;
}

function log(msg, cls) {
  const wrap = document.getElementById('logWrap');
  const el   = document.createElement('div');
  el.className = 'entry ' + (cls||'');
  el.textContent = msg;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  while (wrap.children.length > 100) wrap.removeChild(wrap.firstChild);
}

function showBanner(text, cls) {
  const b = document.getElementById('predictBanner');
  b.textContent = text;
  b.className   = 'predict-banner show ' + cls;
  setTimeout(() => b.className = 'predict-banner', 1000);
}

// ════════════════════════════════════════════════════════
//  SEQUENCE HELPERS
// ════════════════════════════════════════════════════════
function randomSeq()  { return Array.from({length: seqLen}, () => Math.floor(Math.random() * grades.length)); }
function targetSeq2() { return target.split('').map(c => gradeMap[c]); }

function resetForNewSeq(seq, isTarget) {
  currentSeq       = seq;
  isTargetSeq      = isTarget;
  currentStride    = 0;
  inferFiredStride = -1;
  sustainLevels    = new Array(latentNodes.length).fill(0);
  renderSeqRow(seq);
}

// ════════════════════════════════════════════════════════
//  MAIN STEP LOOP
// ════════════════════════════════════════════════════════
function step() {
  if (!running) return;

  const spd   = parseInt(document.getElementById('speed').value);
  const delay = Math.round(1000 / spd);

  // Start new sequence?
  if (currentSeq.length === 0) {
    if (seriesDone >= seriesTotal) { stopRun(); log('── series complete ──', 'sep'); return; }
    const seq = (seriesDone % 6 === 0) ? targetSeq2() : randomSeq();
    const isTgt = seq.every((g, i) => g === gradeMap[target[i]]);
    resetForNewSeq(seq, isTgt);
    stats.total++;
    updateStats();
  }

  // Process stride
  const { latentActive, inferenceFired, activeCount, window, winStart } = processStride(currentSeq, currentStride);
  const k = kInferParam();
  const n = latentNodes.length;

  // Did inference just fire?
  if (inferenceFired && inferFiredStride === -1) {
    inferFiredStride = currentStride;
    const isEarly    = currentStride < seqLen - 1;
    const isPredictive = k < n;
    if (isTargetSeq) {
      if (isEarly) {
        stats.early++;
        stats.fireStrides.push(currentStride);
        log(`[${seriesDone}] TARGET ⚡ ${isPredictive ? 'PREDICTED' : 'early fire'} at stride ${currentStride}/${seqLen-1}  (${activeCount}/${n} nodes, K=${k})`, 'early');
        showBanner(`⚡ PREDICTED stride ${currentStride}`, 'tp');
      } else {
        stats.tp++;
        stats.fireStrides.push(currentStride);
        log(`[${seriesDone}] TARGET ✓ recognised at stride ${currentStride}  (${activeCount}/${n} nodes, K=${k})`, 'tp');
        showBanner('✓ RECOGNISED', 'tp');
      }
    } else {
      stats.fp++;
      log(`[${seriesDone}] RANDOM "${currentSeq.map(g=>grades[g]).join('')}" → FP stride ${currentStride}  (${activeCount}/${n} nodes, K=${k})`, 'fp');
      showBanner('✗ FALSE POSITIVE', 'fp');
    }
    updateStats();
  }

  updateSeqRow(currentSeq, currentStride);
  drawNetwork(latentActive, window, inferenceFired);
  updateSustainBars(latentActive);

  currentStride++;

  // Sequence done?
  if (currentStride >= seqLen) {
    if (isTargetSeq && inferFiredStride === -1) {
      stats.fn++;
      log(`[${seriesDone}] TARGET MISSED → false negative`, 'fn');
      showBanner('✗ MISSED', 'fn');
      updateStats();
    }
    seriesDone++;
    currentSeq    = [];
    currentStride = 0;
    timer = setTimeout(step, delay * 3);
    return;
  }

  timer = setTimeout(step, delay);
}

function startRun() {
  if (running) return;
  resetStats();
  seriesDone  = 0;
  seriesTotal = parseInt(document.getElementById('seriesLen').value);
  currentSeq  = [];
  running     = true;
  step();
}

function stopRun() {
  running = false;
  if (timer) clearTimeout(timer);
}

// ════════════════════════════════════════════════════════
//  EVENTS
// ════════════════════════════════════════════════════════
document.getElementById('btnStart').addEventListener('click', () => { init(); startRun(); });
document.getElementById('btnStop').addEventListener('click', stopRun);
document.getElementById('btnRegen').addEventListener('click', () => { init(); });

[
  ['sensorWidth','sensorWidthVal'],
  ['fanin','faninVal'],
  ['nodeCount','nodeCountVal'],
  ['kInfer','kInferVal'],
  ['sustain','sustainVal'],
  ['speed','speedVal'],
  ['seriesLen','seriesVal'],
].forEach(([id, vid]) => {
  document.getElementById(id).addEventListener('input', e => {
    document.getElementById(vid).textContent = e.target.value;
    if (!['speed'].includes(id)) { init(); return; }

  });
});

document.getElementById('targetSeq').addEventListener('change', init);
window.addEventListener('load',   () => { init(); });
window.addEventListener('resize', () => { drawNetwork(sustainLevels.map(s=>s>0), [], false); });
