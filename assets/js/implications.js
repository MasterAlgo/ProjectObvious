// =========================================================================
    // DATA FOR D1 (14 AI BOTTLENECKS) & D2 (26 BIO/PSYCH PHENOMENA)
    // =========================================================================
    const d1Items = readItems("d1-container", "theme");

    const d1ThemeOrder = [
      { key: "Learning", subtitle: "Incremental adaptation, local updates, and structural plasticity" },
      { key: "Inference and transparency", subtitle: "Bidirectional recall, inspectable contributions, and symbolic-subsymbolic unity" },
      { key: "Knowledge as manageable objects", subtitle: "Modular repositories, keyed merges, and out-of-core scaling" },
      { key: "Heterogeneous inputs", subtitle: "Per-channel hierarchies and cross-modal binding" }
    ];

    const d2Items = readItems("d2-container", "tier");

    const d2TierOrder = [
      {
        key: "Tier A",
        cls: "tier-a",
        title: "Tier A: Established phenomena; proposed computational accounts",
        tagCls: "tag-obs",
        tagLabel: "Tier A // Independent Evidence"
      },
      {
        key: "Tier B",
        cls: "tier-b",
        title: "Tier B: Plausible mappings that still need to be specified",
        tagCls: "tag-design",
        tagLabel: "Tier B // Plausible Mapping"
      },
      {
        key: "Tier C",
        cls: "tier-c",
        title: "Tier C: Speculative, resting on additional conjectures",
        tagCls: "tag-conj",
        tagLabel: "Tier C // Conjectural & Affective"
      }
    ];

    // =========================================================================
    // RENDERING LOGIC FOR D1 AND D2
    // =========================================================================
    let d1Filter = "all";
    let d1Grouped = true;

    let d2Filter = "all";
    let d2Grouped = true;


    // The initial, readable HTML is the canonical content source. Filtering
    // and layout changes reuse those cards, including their literature links.
    function readItems(containerId, groupKey) {
      return [...document.querySelectorAll('#' + containerId + ' article.item-card')].map(card => ({
        num: Number(card.dataset.num),
        [groupKey]: card.dataset.group,
        markup: card.outerHTML,
        citations: [...card.querySelectorAll('.cite-pill')].map(link => link.outerHTML).join('')
      }));
    }

    function createItemCardHTML(item, prefix, badgeTagHTML) {
      const template = document.createElement('template');
      template.innerHTML = item.markup;
      template.content.querySelector('.item-badges').innerHTML = (badgeTagHTML || '') + item.citations;
      return template.innerHTML;
    }

    function renderD1() {
      const container = document.getElementById("d1-container");
      const filtered = d1Items.filter(it => d1Filter === "all" || it.theme === d1Filter);

      if (d1Grouped) {
        const themesToRender = d1ThemeOrder.filter(t => d1Filter === "all" || t.key === d1Filter);
        container.innerHTML = themesToRender.map(t => {
          const groupItems = filtered.filter(it => it.theme === t.key);
          const cards = groupItems.map(it => createItemCardHTML(it, "3.1", "")).join("");
          return `
            <div class="group-block">
              <div class="group-header">
                <h3>${t.key}</h3>
                <span>${t.subtitle} (${groupItems.length})</span>
              </div>
              <div class="items-grid">${cards}</div>
            </div>
          `;
        }).join("");
      } else {
        const sorted = [...filtered].sort((a, b) => a.num - b.num);
        const cards = sorted.map(it => {
          const themeBadge = `<span class="tag tag-neutral" style="font-size:0.66rem;">${it.theme}</span>`;
          return createItemCardHTML(it, "3.1", themeBadge);
        }).join("");
        container.innerHTML = `<div class="items-grid">${cards}</div>`;
      }
    }

    function renderD2() {
      const container = document.getElementById("d2-container");
      const filtered = d2Items.filter(it => d2Filter === "all" || it.tier === d2Filter);

      if (d2Grouped) {
        const tiersToRender = d2TierOrder.filter(t => d2Filter === "all" || t.key === d2Filter);
        container.innerHTML = tiersToRender.map(t => {
          const groupItems = filtered.filter(it => it.tier === t.key);
          const cards = groupItems.map(it => createItemCardHTML(it, "3.2", `<span class="tag ${t.tagCls}" style="font-size:0.65rem;">${t.key}</span>`)).join("");
          return `
            <div class="group-block">
              <div class="group-header ${t.cls}">
                <h3>${t.title}</h3>
                <span class="tag ${t.tagCls}">${t.tagLabel} (${groupItems.length})</span>
              </div>
              <div class="items-grid">${cards}</div>
            </div>
          `;
        }).join("");
      } else {
        const sorted = [...filtered].sort((a, b) => a.num - b.num);
        const cards = sorted.map(it => {
          const tierMeta = d2TierOrder.find(t => t.key === it.tier);
          const badge = `<span class="tag ${tierMeta.tagCls}" style="font-size:0.65rem;">${it.tier}</span>`;
          return createItemCardHTML(it, "3.2", badge);
        }).join("");
        container.innerHTML = `<div class="items-grid">${cards}</div>`;
      }
    }

    // Wire D1 Filter Buttons
    document.querySelectorAll("#d1-theme-filters .filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#d1-theme-filters .filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        d1Filter = btn.getAttribute("data-filter");
        renderD1();
      });
    });

    document.getElementById("d1-mode-grouped").addEventListener("click", (e) => {
      d1Grouped = true;
      e.target.classList.add("active");
      document.getElementById("d1-mode-seq").classList.remove("active");
      renderD1();
    });

    document.getElementById("d1-mode-seq").addEventListener("click", (e) => {
      d1Grouped = false;
      e.target.classList.add("active");
      document.getElementById("d1-mode-grouped").classList.remove("active");
      renderD1();
    });

    // Wire D2 Filter Buttons
    document.querySelectorAll("#d2-tier-filters .filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#d2-tier-filters .filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        d2Filter = btn.getAttribute("data-filter");
        renderD2();
      });
    });

    document.getElementById("d2-mode-grouped").addEventListener("click", (e) => {
      d2Grouped = true;
      e.target.classList.add("active");
      document.getElementById("d2-mode-seq").classList.remove("active");
      renderD2();
    });

    document.getElementById("d2-mode-seq").addEventListener("click", (e) => {
      d2Grouped = false;
      e.target.classList.add("active");
      document.getElementById("d2-mode-grouped").classList.remove("active");
      renderD2();
    });

    // Initial render
    renderD1();
    renderD2();
