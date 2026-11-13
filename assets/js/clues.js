// =========================================================================
    // LIGHTBOX HELPER FOR Clue 7 DIAGRAMS (stocks.png & cortical-layers.png)
    // =========================================================================
    const lightboxOverlay = document.getElementById("lightboxOverlay");
    const lightboxImg = document.getElementById("lightboxImg");
    const lightboxCaption = document.getElementById("lightboxCaption");

    let lightboxTrigger = null;
    const lightboxClose = document.getElementById("lightboxClose");
    function openLightbox(src, captionText) {
      lightboxTrigger = document.activeElement;
      lightboxImg.src = src; lightboxImg.alt = captionText || "Expanded diagram";
      lightboxCaption.textContent = captionText || "";
      lightboxOverlay.classList.add("active"); document.body.classList.add("lightbox-open");
      lightboxClose.focus();
    }
    function closeLightbox() {
      lightboxOverlay.classList.remove("active"); document.body.classList.remove("lightbox-open");
      lightboxImg.removeAttribute("src");
      lightboxTrigger?.focus();
    }
    lightboxOverlay.addEventListener("keydown", event => {
      if (event.key === "Tab") { event.preventDefault(); lightboxClose.focus(); }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lightboxOverlay.classList.contains("active")) {
        closeLightbox();
      }
    });

    // =========================================================================
    // INSTANTANEOUS WEIGHTED-INPUT BAND DETECTOR AND CONTRIBUTOR DIAGNOSTICS
    // =========================================================================
    const canvas = document.getElementById("javaLifCanvas");
    const ctx = canvas.getContext("2d");
    const sigGenSelect = document.getElementById("sigGenSelect");
    const somaSumDisplay = document.getElementById("somaSumDisplay");
    const axonOutputLog = document.getElementById("axonOutputLog");
    const lowerThreshSlider = document.getElementById("lowerThreshSlider");
    const upperThreshSlider = document.getElementById("upperThreshSlider");
    const lowerThreshVal = document.getElementById("lowerThreshVal");
    const upperThreshVal = document.getElementById("upperThreshVal");

    let simTime = 0;
    let integrationRunning = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let logEntries = [];
    let lastFireTime = -999;

    const channels = [
      { name: "A", weight: 0.79, phase: 0.0, freq: 0.03 },
      { name: "B", weight: 0.19, phase: 1.2, freq: 0.05 },
      { name: "C", weight: 0.64, phase: 2.4, freq: 0.04 },
      { name: "D", weight: 0.68, phase: 0.8, freq: 0.06 },
      { name: "E", weight: 0.01, phase: 3.1, freq: 0.08 }
    ];

    function getChannelSignal(ch, t, mode) {
      if (mode === "sine") {
        return Math.max(0, Math.sin(t * ch.freq * 1.5 + ch.phase));
      } else if (mode === "spikes") {
        const val = Math.sin(t * ch.freq * 2 + ch.phase);
        return val > 0.8 ? 1.0 : 0.0;
      } else {
        // random mode with smooth noise interpolation
        const knot = Math.floor(t / 24), mix = (t % 24) / 24;
        const noise = n => { const value = Math.sin(n * 127.1 + ch.phase * 311.7) * 43758.5453; return value - Math.floor(value); };
        return noise(knot) * (1 - mix) + noise(knot + 1) * mix;
      }
    }

    function runIntegrationStep() {
      if (integrationRunning) simTime++;
      const mode = sigGenSelect.value;
      const lowerT = parseFloat(lowerThreshSlider.value);
      const upperT = parseFloat(upperThreshSlider.value);
      lowerThreshVal.textContent = lowerT.toFixed(2);
      upperThreshVal.textContent = upperT.toFixed(2);

      let totalSum = 0;
      let activeNames = [];

      channels.forEach((ch) => {
        ch.currentVal = getChannelSignal(ch, simTime, mode);
        ch.effectiveInput = ch.currentVal * ch.weight;
        totalSum += ch.effectiveInput;
        if (ch.currentVal > 0.35) {
          activeNames.push(ch.name);
        }
      });

      somaSumDisplay.textContent = `\u03A3 = ${totalSum.toFixed(2)}`;

      // Instantaneous, inclusive amplitude-band check. This is not a LIF neuron.
      let firedThisStep = false;
      if (integrationRunning && totalSum >= lowerT && totalSum <= upperT) {
        // Debounce firing slightly to mimic discrete axon packets
        if (simTime - lastFireTime > 35 && activeNames.length > 0) {
          firedThisStep = true;
          lastFireTime = simTime;
          const tokenStr = activeNames.join(" ");
          logEntries.unshift(tokenStr);
          if (logEntries.length > 15) logEntries.pop();
          
          // Update HTML list box
          axonOutputLog.innerHTML = logEntries.map(e => `<span>${e}</span>`).join("");
        }
      }

      // --- RENDER JAVA-LIKE GRAPHIC ---
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const somaX = 310;
      const somaY = 130;

      // 1. Draw 5 input channels on the left
      channels.forEach((ch, i) => {
        const cy = 28 + i * 48;
        
        // Signal mini-waveform preview
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x < 75; x++) {
          const sampleT = simTime - (75 - x);
          const val = getChannelSignal(ch, sampleT, mode);
          const py = cy + 12 - val * 22;
          if (x === 0) ctx.moveTo(10 + x, py);
          else ctx.lineTo(10 + x, py);
        }
        ctx.stroke();

        // Connecting dendrite line to Soma
        const isContrib = ch.currentVal > 0.35;
        ctx.strokeStyle = isContrib ? "#38bdf8" : "#1e293b";
        ctx.lineWidth = isContrib ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(90, cy + 6);
        ctx.lineTo(somaX - 22, somaY);
        ctx.stroke();

        // Node circle with weight
        ctx.fillStyle = isContrib ? "rgba(56, 189, 248, 0.25)" : "#101622";
        ctx.strokeStyle = isContrib ? "#38bdf8" : "#334155";
        ctx.beginPath();
        ctx.arc(130, cy + 6, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#e2e8f0";
        ctx.font = "11px monospace";
        ctx.fillText(ch.name, 126, cy + 10);

        // Weight text
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px monospace";
        ctx.fillText(ch.weight.toFixed(2), 152, cy + 9);
      });

      // 2. Draw central Soma
      const somaGrad = ctx.createRadialGradient(somaX, somaY, 2, somaX, somaY, 26);
      somaGrad.addColorStop(0, firedThisStep ? "#fda4af" : "#fbcfe8");
      somaGrad.addColorStop(0.7, firedThisStep ? "#f43f5e" : "#f472b6");
      somaGrad.addColorStop(1, "#be185d");

      ctx.fillStyle = somaGrad;
      ctx.beginPath();
      ctx.arc(somaX, somaY, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffe4e6";
      ctx.lineWidth = firedThisStep ? 3 : 1.5;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px monospace";
      ctx.fillText("Soma", somaX - 15, somaY - 4);
      ctx.font = "10px monospace";
      ctx.fillText(`\u03A3=${totalSum.toFixed(1)}`, somaX - 17, somaY + 11);

      // 3. Draw Axon line to the right
      const axonStartX = somaX + 26;
      ctx.strokeStyle = firedThisStep ? "#f43f5e" : "#475569";
      ctx.lineWidth = firedThisStep ? 3.5 : 2;
      ctx.beginPath();
      ctx.moveTo(axonStartX, somaY);
      ctx.lineTo(canvas.width - 15, somaY);
      ctx.stroke();

      // Axon packet nodes traveling out
      if (firedThisStep || logEntries.length > 0) {
        ctx.fillStyle = "#f43f5e";
        ctx.beginPath();
        ctx.arc(axonStartX + 45, somaY, 5, 0, Math.PI * 2);
        ctx.arc(axonStartX + 95, somaY, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(runIntegrationStep);
    }

    const pauseButton = document.getElementById("integrationPause");
    const syncPause = () => { pauseButton.textContent = integrationRunning ? "Pause demonstration" : "Resume demonstration"; };
    syncPause();
    pauseButton.addEventListener("click", () => { integrationRunning = !integrationRunning; syncPause(); });
    document.getElementById("integrationReset").addEventListener("click", () => { simTime = 0; lastFireTime = -999; logEntries = []; axonOutputLog.textContent = "Waiting for threshold-band match..."; });
    lowerThreshSlider.addEventListener("input", () => { if (Number(lowerThreshSlider.value) > Number(upperThreshSlider.value)) upperThreshSlider.value = lowerThreshSlider.value; });
    upperThreshSlider.addEventListener("input", () => { if (Number(upperThreshSlider.value) < Number(lowerThreshSlider.value)) lowerThreshSlider.value = upperThreshSlider.value; });
    requestAnimationFrame(runIntegrationStep);
  


    // Clue 8 uses trusted, project-owned standalone documents in separate frames.
    // An opaque-origin sandbox blocks their local CSS/JS under file://, so keep
    // normal frame loading. Each document still has its own JavaScript scope.
    (() => {
      const names = ['process', 'architecture'];
      const tabs = Object.fromEntries(names.map(n => [n, document.getElementById('c8-tab-' + n)]));
      const panels = Object.fromEntries(names.map(n => [n, document.getElementById('c8-panel-' + n)]));
      const frames = Object.fromEntries(names.map(n => [n, document.getElementById('c8-frame-' + n)]));
      let active = 'process';
      function showC8(name) {
        if (!names.includes(name)) return;
        active = name;
        for (const n of names) {
          const selected = n === name;
          tabs[n].setAttribute('aria-selected', String(selected));
          tabs[n].tabIndex = selected ? 0 : -1;
          panels[n].hidden = !selected;
          if (!selected && frames[n].hasAttribute('src')) {
            // A hidden demo must not keep animating in the background.
            frames[n].removeAttribute('src');

          }
        }
        const frame = frames[name];
        if (!frame.hasAttribute('src')) {
          frame.src = frame.getAttribute('data-c8-src');
        }
      }
      for (const name of names) {
        tabs[name].addEventListener('click', () => showC8(name));
        tabs[name].addEventListener('keydown', e => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          let next = (names.indexOf(name) + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
          if (e.key === 'Home') next = 0;
          if (e.key === 'End') next = names.length - 1;
          showC8(names[next]);
          tabs[names[next]].focus();
        });
      }
      window.addEventListener('message', event => {
        const data = event.data;
        if (!data || data.obviousC8 !== 'resize' || !Number.isFinite(data.height)) return;
        const frame = frames[active];
        if (event.source !== frame.contentWindow) return;
        frame.style.height = Math.min(6000, Math.max(340, Math.ceil(data.height))) + 'px';
      });
      // Initialize only as Clue 8 approaches the viewport. This leaves Clue 1-Clue 7
      // responsive and avoids unnecessary animation when Clue 8 isn't being read.
      const host = document.getElementById('c8-presentations');
      if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)) {
            showC8(active);
            observer.disconnect();
          }
        }, {rootMargin: '250px'});
        observer.observe(host);
      } else {
        showC8(active);
      }
    })();
