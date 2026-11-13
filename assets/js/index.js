// =========================================================================
    // 1. EXACT BIGINT COMBINATORICS: C(N, K) = N! / (K! * (N - K)!)
    // =========================================================================
    function combinationsBigInt(n, k) {
      if (k < 0 || k > n) return 0n;
      if (k === 0 || k === n) return 1n;
      const effK = Math.min(k, n - k);
      let result = 1n;
      const bigN = BigInt(n);
      for (let i = 1n; i <= BigInt(effK); i++) {
        result = (result * (bigN - i + 1n)) / i;
      }
      return result;
    }

    function formatCombinatorialResult(bigVal) {
      const str = bigVal.toString();
      const digits = str.length;
      if (digits <= 6) {
        return {
          displayHTML: Number(str).toLocaleString("en-US"),
          digits,
          fullStr: str
        };
      }
      // Scientific notation to 3 decimal places
      const lead = str[0];
      const frac = str.slice(1, 4);
      const exp = digits - 1;
      return {
        displayHTML: `&approx; ${lead}.${frac} &times; 10<sup>${exp.toLocaleString("en-US")}</sup>`,
        digits,
        fullStr: str
      };
    }

    // =========================================================================
    // 2. STATE & SLIDER MAPPING (Logarithmic 10,000 -> 10)
    // =========================================================================
    let state = {
      N: 10000,
      K: 200,
      manualK: false,
      running: !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    };

    const nSlider = document.getElementById("nSlider");
    const nDisplay = document.getElementById("nDisplay");
    const kDisplay = document.getElementById("kDisplay");
    const legInactive = document.getElementById("legInactive");
    const legActive = document.getElementById("legActive");
    const formulaExpr = document.getElementById("formulaExpr");
    const sciResult = document.getElementById("sciResult");
    const digitBadge = document.getElementById("digitBadge");
    const exactSummaryCount = document.getElementById("exactSummaryCount");
    const fullIntegerBox = document.getElementById("fullIntegerBox");
    const manualKCheck = document.getElementById("manualKCheck");
    const manualKInput = document.getElementById("manualKInput");
    const toggleAnimBtn = document.getElementById("toggleAnimBtn");
    const resetBtn = document.getElementById("resetBtn");

    // Slider t in [0, 1000]: t=0 -> 10,000; t=1000 -> 10
    function sliderToN(t) {
      if (t <= 0) return 10000;
      if (t >= 1000) return 10;
      const exp = 4 - (3 * t) / 1000; // 10^4 down to 10^1
      return Math.max(10, Math.min(10000, Math.round(Math.pow(10, exp))));
    }

    function updateStateFromControls() {
      state.N = sliderToN(Number(nSlider.value));
      manualKInput.max = state.N;

      if (state.manualK) {
        let userK = parseInt(manualKInput.value, 10);
        if (isNaN(userK) || userK < 1) userK = 1;
        if (userK > state.N) userK = state.N;
        manualKInput.value = userK;
        state.K = userK;
      } else {
        // Illustrative 2% active rule, rounded to at least 1
        state.K = Math.max(1, Math.round(state.N * 0.02));
        manualKInput.value = state.K;
      }

      const nFmt = state.N.toLocaleString("en-US");
      const kFmt = state.K.toLocaleString("en-US");
      const inactFmt = (state.N - state.K).toLocaleString("en-US");

      nDisplay.textContent = nFmt;
      kDisplay.textContent = kFmt;
      legActive.textContent = kFmt;
      legInactive.textContent = inactFmt;
      formulaExpr.textContent = `C(${nFmt}, ${kFmt})`;

      const comb = combinationsBigInt(state.N, state.K);
      const formatted = formatCombinatorialResult(comb);
      sciResult.innerHTML = formatted.displayHTML;
      const digitLabel = `${formatted.digits.toLocaleString("en-US")} decimal digit${formatted.digits === 1 ? "" : "s"}`;
      digitBadge.textContent = digitLabel;
      exactSummaryCount.textContent = formatted.digits.toLocaleString("en-US");
      fullIntegerBox.textContent = formatted.fullStr;

      selectNewActiveSet();
    }

    nSlider.addEventListener("input", updateStateFromControls);

    manualKCheck.addEventListener("change", () => {
      state.manualK = manualKCheck.checked;
      manualKInput.disabled = !state.manualK;
      updateStateFromControls();
    });

    manualKInput.addEventListener("input", () => {
      if (state.manualK) updateStateFromControls();
    });

    toggleAnimBtn.addEventListener("click", () => {
      state.running = !state.running;
      toggleAnimBtn.textContent = state.running ? "Pause Animation" : "Resume Animation";
    });

    resetBtn.addEventListener("click", () => {
      nSlider.value = 0;
      manualKCheck.checked = false;
      state.manualK = false;
      manualKInput.disabled = true;
      state.running = true;
      toggleAnimBtn.textContent = "Pause Animation";
      updateStateFromControls();
    });

    // =========================================================================
    // 3. TWINKLING NEURON CANVAS (10,000 SYNAPSES ON DENDRITIC ARBOR)
    // =========================================================================
    const canvas = document.getElementById("neuronCanvas");
    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const branches = [];
    const synapses = [];
    const MAX_SYNAPSES = 10000;

    function buildDendriticArbor() {
      // Create recursive dendritic tree segments radiating from soma
      function growBranch(x1, y1, angle, length, depth) {
        if (depth <= 0 || length < 8) return;
        const x2 = x1 + Math.cos(angle) * length;
        const y2 = y1 + Math.sin(angle) * length;
        branches.push({ x1, y1, x2, y2, depth });

        const subBranches = depth === 5 ? 2 : (Math.random() < 0.78 ? 2 : 1);
        for (let i = 0; i < subBranches; i++) {
          const spread = (i === 0 ? -1 : 1) * (0.22 + Math.random() * 0.32);
          growBranch(
            x2,
            y2,
            angle + spread + (Math.random() - 0.5) * 0.15,
            length * (0.72 + Math.random() * 0.12),
            depth - 1
          );
        }
      }

      const primaryCount = 11;
      for (let i = 0; i < primaryCount; i++) {
        const baseAngle = (i / primaryCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
        growBranch(cx, cy, baseAngle, 72 + Math.random() * 18, 5);
      }

      // Place 10,000 synapses along the dendritic segments with slight local scatter
      for (let i = 0; i < MAX_SYNAPSES; i++) {
        const b = branches[i % branches.length];
        const t = Math.random();
        const bx = b.x1 + (b.x2 - b.x1) * t;
        const by = b.y1 + (b.y2 - b.y1) * t;
        const jitterR = 2 + Math.random() * 11;
        const jitterA = Math.random() * Math.PI * 2;
        synapses.push({
          x: bx + Math.cos(jitterA) * jitterR,
          y: by + Math.sin(jitterA) * jitterR,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    let activeIndices = new Uint32Array(200);
    let somaPulse = 0;
    let lastSwitchTime = 0;

    function selectNewActiveSet() {
      const N = state.N;
      const K = state.K;
      activeIndices = new Uint32Array(K);

      // Partial reservoir/random selection of K distinct indices from [0, N)
      const chosen = new Set();
      while (chosen.size < K) {
        chosen.add(Math.floor(Math.random() * N));
      }
      let idx = 0;
      for (const val of chosen) {
        activeIndices[idx++] = val;
      }
      if (K > 0) somaPulse = 1.0;
    }

    let visualTimestamp = 0;
    function renderLoop(timestamp) {
      if (state.running) visualTimestamp = timestamp;
      if (state.running && timestamp - lastSwitchTime > 420) {
        selectNewActiveSet();
        lastSwitchTime = timestamp;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw Dendritic Branches
      ctx.lineCap = "round";
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        ctx.strokeStyle = "rgba(51, 65, 85, 0.38)";
        ctx.lineWidth = Math.max(0.6, b.depth * 0.65);
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
      }

      // 2. Draw Inactive Synapses up to N
      const N = state.N;
      ctx.fillStyle = "rgba(100, 116, 139, 0.42)";
      const inactiveSize = N > 2500 ? 1.5 : N > 400 ? 2.2 : 3.5;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const s = synapses[i];
        ctx.rect(s.x, s.y, inactiveSize, inactiveSize);
      }
      ctx.fill();

      // 3. Draw Active Twinkling Synapses (K)
      const activeRadius = N > 2500 ? 2.3 : N > 400 ? 3.2 : 4.8;
      for (let i = 0; i < activeIndices.length; i++) {
        const s = synapses[activeIndices[i]];
        const twinkle = 0.65 + 0.35 * Math.sin(visualTimestamp * 0.012 + s.phase);
        ctx.fillStyle = `rgba(56, 189, 248, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, activeRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Draw Soma & Integration Pulse
      if (somaPulse > 0.01) {
        const ringRadius = 18 + (1 - somaPulse) * 38;
        ctx.strokeStyle = `rgba(244, 63, 94, ${somaPulse * 0.7})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        if (state.running) somaPulse *= 0.91;
      }

      const somaGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22);
      somaGrad.addColorStop(0, somaPulse > 0.35 ? "#fda4af" : "#7dd3fc");
      somaGrad.addColorStop(0.55, somaPulse > 0.35 ? "#f43f5e" : "#0284c7");
      somaGrad.addColorStop(1, "rgba(2, 132, 199, 0)");

      ctx.fillStyle = somaGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();

      requestAnimationFrame(renderLoop);
    }

    toggleAnimBtn.textContent = state.running ? "Pause Animation" : "Resume Animation";
    buildDendriticArbor();
    updateStateFromControls();
    requestAnimationFrame(renderLoop);
