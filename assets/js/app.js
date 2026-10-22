/* Li-S Polysulfide Benchmark - interactive site logic.
   All data is embedded (window.GEOMETRIES, ENERGIES, VIB_MODES, ...); no network calls. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- constants
  const LI = 0x69f8f7, S = 0xffff27;
  const CPK = { prop: "elem", map: { Li: LI, S: S } };
  const SOLVENTS = ["DMSO", "TEGDME"];

  // Author block mirrored from main.tex (13 authors, 7 affiliations, as printed; 2026-10-16).
  const AUTHORS = [
    ["Rafael Ferreira de Menezes", [1]], ["Tiago Cassiano", [2, 3]], ["Lydia Meyer", [4]],
    ["Jason Porter", [5]], ["Flavio O. Sanches-Neto", [6, 7]], ["Benjamin Diehl", [5]],
    ["Joanna Maratos", [5]], ["Tristan Schiess", [5]], ["Jared Landetta Espinoza", [5]], ["Ana Costa", [1]],
    ["Andrew Colclasure", [4]], ["Ricardo Gargano*", [2]],
    ["Kayla G. Sprenger*", [1]],
  ];
  const AFFILS = [
    "Department of Chemical Engineering, University of Colorado Boulder, United States",
    "Institute of Physics, University of Brasília, Brazil",
    "International Center of Physics, Institute of Physics, University of Brasília, 70910-900, Brasília, DF, Brazil",
    "National Laboratory of the Rockies, United States",
    "Brigham Young University, United States",
    "Federal Institute of Education, Science and Technology of Goiás, Goiânia, GO, 72876-601, Brazil",
    "Theoretical and Structural Chemistry Group of Anápolis, State University of Goiás, Anápolis, GO, 75132-400, Brazil",
  ];
  const BIBTEX =
    "@article{ferreira_lis_benchmark,\n" +
    "  title   = {Lithium Polysulfide Speciation in Lithium--Sulfur Batteries:\n" +
    "             A First-Principles Benchmark of Thermodynamics, Bonding, and Solvent Control},\n" +
    "  author  = {Ferreira de Menezes, Rafael and Cassiano, Tiago and Meyer, Lydia and Porter, Jason\n" +
    "             and Sanches-Neto, Flavio O. and Diehl, Benjamin and Maratos, Joanna and Schiess, Tristan\n" +
    "             and Landetta Espinoza, Jared and Costa, Ana and Colclasure, Andrew\n" +
    "             and Gargano, Ricardo and Sprenger, Kayla G.},\n" +
    "  journal = {ChemRxiv},\n" +
    "  doi     = {10.26434/chemrxiv.15010681/v1},\n" +
    "  url     = {https://doi.org/10.26434/chemrxiv.15010681/v1},\n" +
    "  year    = {2026}\n" +
    "}";

  const fmt = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
  const qLabel = (q) => (q === 0 ? "0" : q === -1 ? "−1" : "−2");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ----------------------------------------- species labels + search folding
  // Unicode sub/superscript digit maps (mirror build_data.py SUB / CHARGE_SUP)
  const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉", SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const toSub = (s) => String(s).replace(/\d/g, (d) => SUB_DIGITS[+d]);
  const chargeSup = (q) => (q === 0 ? "" : q === -1 ? "⁻" : "²⁻");
  // Radical-dot rule of the paper (lis_energetics.is_radical): a species is a
  // radical iff n_Li + |q| is odd, so S_x•⁻, Li2S_x•⁻ and neutral LiS_x• carry
  // the dot; dianions and LiS_x⁻ do not.
  const isRadical = (nli, q) => ((nli + Math.abs(q)) % 2) === 1;

  // Fold a display/query string to a plain lowercase ASCII search key: Unicode
  // sub/superscript digits -> ASCII digits, sub/superscript minus and dash
  // variants -> "-", the radical dot dropped. e.g. "Li₂S₆•⁻" -> "li2s6-", "Li–S" -> "li-s".
  function asciiFold(s) {
    return String(s)
      .replace(/[₀-₉]/g, (c) => String(SUB_DIGITS.indexOf(c)))
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(SUP_DIGITS.indexOf(c)))
      .replace(/ₓ/g, "x")            // subscript x in family names (Li₂Sₓ, LiSₓ, Sₓ)
      .replace(/[•·]/g, "")
      .replace(/[⁻₋–—−]/g, "-")
      .toLowerCase();
  }

  const chargeWord = (q) => (q === 0 ? "neutral" : q === -1 ? "anion radical monoanion" : "dianion");

  // ASCII spellings for a base formula (e.g. "li2s6") + charge, so plain,
  // suffixed, and spaced queries all match as substrings of the search index.
  function speciesSearchTokens(base, q) {
    base = String(base).toLowerCase();
    const parts = [base];
    if (q === -1) parts.push(base + "-", base + "-1", base + " 1-");
    if (q === -2) parts.push(base + "-2", base + " -2", base + " 2-", base + "2-");
    parts.push(chargeWord(q));
    return parts.join(" ");
  }

  // Parse a raw QTAIM System string (Li2S6, Li2S6-2, LiS-, S6-1, Li2S, ...)
  // into {nli, x, q, base}. base is the lowercase ASCII formula sans charge.
  function parseSystemRaw(raw) {
    const m = /^(Li2|Li|)(S)(\d*)(-1|-2|-|)$/.exec(String(raw).trim());
    if (!m) return null;
    const nli = m[1] === "Li2" ? 2 : m[1] === "Li" ? 1 : 0;
    const x = m[3] === "" ? 1 : parseInt(m[3], 10);
    const q = m[4] === "-2" ? -2 : m[4] === "" ? 0 : -1;
    return { nli, x, q, base: (m[1] + m[2] + m[3]).toLowerCase() };
  }

  // Render a raw System string as a Unicode label (mirrors display_label).
  // Falls back to the raw string for anything that doesn't parse.
  function formatSystem(raw) {
    const p = parseSystemRaw(raw);
    if (!p) return raw;
    const li = p.nli === 2 ? "Li₂" : p.nli === 1 ? "Li" : "";
    const xs = p.x === 1 ? "" : toSub(p.x);
    return `${li}S${xs}${isRadical(p.nli, p.q) ? "•" : ""}${chargeSup(p.q)}`;
  }

  // Recover the ASCII base formula from a Unicode label + known charge q.
  function baseFromLabel(label, q) {
    const folded = asciiFold(label);
    const suf = q === -2 ? "2-" : q === -1 ? "-" : "";
    return suf && folded.endsWith(suf) ? folded.slice(0, folded.length - suf.length) : folded;
  }

  function downloadText(text, mime, filename) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // -------------------------------------------------------------- tab routing
  let activateTab = null;
  function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".panel");
    const names = Array.from(tabs).map((t) => t.dataset.tab);
    function activate(name, fromHash) {
      if (!names.includes(name)) return;
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
      panels.forEach((p) => p.classList.toggle("active", p.id === name));
      if (!fromHash) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      // Size the 3-D viewers synchronously now that their tab is visible (a
      // render while the canvas is 0 x 0 is skipped, see patch3Dmol), then redraw.
      if (name === "geometries") { if (viewer) viewer.resize(); renderGeometry(); }
      if (name === "qtaim" && bcpViewer) { bcpViewer.resize(); if (lastBcpRow) highlightBcp(lastBcpRow); }
      if (name === "vibrational") renderModeViewer(); // SVG width known only when shown
      if (history.replaceState) history.replaceState(null, "", "#" + name);
    }
    activateTab = activate;
    tabs.forEach((t) => t.addEventListener("click", () => activate(t.dataset.tab)));
    document.querySelectorAll("[data-goto]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); activate(a.dataset.goto); })
    );
    window.addEventListener("hashchange", () => activate(location.hash.slice(1), true));
    const initial = location.hash.slice(1);
    if (initial && names.includes(initial)) activate(initial, true);
  }

  // ---------------------------------------------------------- sortable tables
  // opts (all optional): onRowClick(rowObj) — delegated, survives re-render;
  // rowClass(rowObj) — extra <tr> class (e.g. "selected"), reapplied each render.
  function dataTable(tableEl, columns, getRows, opts) {
    opts = opts || {};
    let sortKey = null, sortDir = 1, lastRows = [];
    function cmp(a, b) {
      const an = a === null || a === undefined || a === "", bn = b === null || b === undefined || b === "";
      if (an && bn) return 0; if (an) return 1; if (bn) return -1;
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    }
    function render() {
      let rows = getRows();
      if (sortKey) rows = rows.slice().sort((r1, r2) => cmp(r1[sortKey], r2[sortKey]) * sortDir);
      lastRows = rows;
      const thead = "<thead><tr>" + columns.map((c) => {
        const cls = (c.txt ? "txt" : "") + (c.key === sortKey ? (sortDir === 1 ? " sorted-asc" : " sorted-desc") : "");
        return `<th data-k="${c.key}" class="${cls}" title="${c.tip || ""}">${c.label}</th>`;
      }).join("") + "</tr></thead>";
      const tbody = "<tbody>" + rows.map((r, ri) => {
        const cls = [r._flag ? "flagged" : "", opts.rowClass ? opts.rowClass(r) : ""].filter(Boolean).join(" ");
        return `<tr data-ri="${ri}"${cls ? ` class="${cls}"` : ""}>` + columns.map((c) => {
          const val = c.render ? c.render(r) : r[c.key];
          return `<td class="${c.txt ? "txt" : ""}${c.cellcls ? " " + c.cellcls(r) : ""}">${val}</td>`;
        }).join("") + "</tr>";
      }).join("") + "</tbody>";
      tableEl.innerHTML = thead + tbody;
      tableEl.querySelectorAll("th").forEach((th) =>
        th.addEventListener("click", () => {
          const k = th.dataset.k;
          if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
          render();
        })
      );
    }
    if (opts.onRowClick) {
      tableEl.addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-ri]");
        if (!tr || !tableEl.contains(tr)) return;
        const r = lastRows[+tr.dataset.ri];
        if (r) opts.onRowClick(r);
      });
    }
    return { render };
  }

  // ------------------------------------------------- 3Dmol hidden-tab guard
  // 3Dmol watches every viewer's container (ResizeObserver, window resize,
  // IntersectionObserver) and calls resize(); when a tab is hidden the
  // container measures 0 x 0, the viewer's canvas is shrunk to nothing, and
  // the next render asks 3Dmol's shared OffscreenCanvas for a 0 x 0 image
  // bitmap, which Firefox refuses ("UnknownError: transferToImageBitmap:
  // Failed to create ImageBitmap"). Leave a hidden viewer alone: the observers
  // fire again with a real size when its tab comes back and activate()
  // re-renders. Must run before any createViewer(): the constructor binds
  // resize for its observers, so only a prototype patched beforehand is seen.
  function patch3Dmol() {
    const GV = window.$3Dmol && window.$3Dmol.GLViewer;
    if (!GV || !GV.prototype || GV.prototype.__lisHiddenGuard) return;
    const hidden = (v) => !v.container || v.container.offsetWidth === 0 || v.container.offsetHeight === 0;
    const origResize = GV.prototype.resize, origRender = GV.prototype.render;
    GV.prototype.resize = function () {
      if (hidden(this)) return this;
      return origResize.apply(this, arguments);
    };
    GV.prototype.render = function () {
      const c = this.renderer && this.renderer.getCanvas && this.renderer.getCanvas();
      if (hidden(this) || (c && (c.width === 0 || c.height === 0))) return this;
      return origRender.apply(this, arguments);
    };
    GV.prototype.__lisHiddenGuard = true;
  }

  // ------------------------------------------------------ 3D viewers (shared)
  let viewer = null, geoUnion = [], curSpecies = null;
  let bcpViewer = null;  // second, independent 3Dmol viewer for the QTAIM tab
  let bcpLabelsOn = false, lastBcpRow = null;
  const HL_COVALENT = 0xff3b5c, HL_CLOSED = 0xff9e2c;

  function ensureBcpViewer() {
    if (bcpViewer) return bcpViewer;
    if (!window.$3Dmol) return null;
    bcpViewer = window.$3Dmol.createViewer($("bcp-viewer"), { backgroundAlpha: 0 });
    return bcpViewer;
  }

  function addAtomLabels(v) {
    const n = v.selectedAtoms({}).length;
    for (let k = 0; k < n; k++) {
      const a = v.selectedAtoms({ index: k })[0];
      if (!a) continue;
      v.addLabel(`${a.elem}${k + 1}`, {
        position: { x: a.x, y: a.y, z: a.z }, fontSize: 10, fontColor: "white",
        backgroundColor: 0x1a1a1a, backgroundOpacity: 0.72, inFront: true, alignment: "center",
      });
    }
  }

  // Highlight a single BCP (atom pair i,j) of the given row in the QTAIM viewer.
  function highlightBcp(row) {
    lastBcpRow = row;
    const meta = $("bcp-viewer-meta");
    const p = parseSystemRaw(row.system);
    const key = p ? `${p.nli}_${p.x}_${p.q}` : null;
    const rec = key && window.GEOMETRIES[row.solvent] && window.GEOMETRIES[row.solvent][key];
    if (!rec) { if (meta) meta.textContent = `No optimized geometry for ${row.system} in ${row.solvent}.`; return; }
    const v = ensureBcpViewer();
    if (!v) { if (meta) meta.textContent = "3D viewer unavailable in this browser."; return; }
    const i = row.i - 1, j = row.j - 1, hl = row.covalent ? HL_COVALENT : HL_CLOSED;
    v.clear();
    v.addModel(rec.xyz, "xyz");
    v.setStyle({}, { stick: { radius: 0.12, colorscheme: CPK }, sphere: { scale: 0.26, colorscheme: CPK } });
    v.addStyle({ index: [i, j] }, { sphere: { scale: 0.42, color: hl } });
    const a = v.selectedAtoms({ index: i })[0], b = v.selectedAtoms({ index: j })[0];
    if (a && b) v.addCylinder({
      start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z },
      radius: 0.16, color: hl, fromCap: 1, toCap: 1,
    });
    if (bcpLabelsOn) addAtomLabels(v);
    v.zoomTo();
    v.render();
    if (meta) meta.innerHTML =
      `<b>${row.atoms}</b> &middot; ${formatSystem(row.system)} &middot; ${row.solvent} &middot; ` +
      `d = ${fmt(row.d, 3)} Å &middot; ${row.covalent ? "covalent (shared-shell)" : "closed-shell contact"}`;
  }

  // ------------------------------------------------------------- geometry tab

  function buildSpeciesUnion() {
    const map = new Map();
    SOLVENTS.forEach((s) =>
      Object.entries(window.GEOMETRIES[s]).forEach(([k, v]) => {
        if (!map.has(k)) map.set(k, { key: k, label: v.label, family: v.family, n_Li: v.n_Li, x: v.x, q: v.q });
      })
    );
    geoUnion = Array.from(map.values()).sort((a, b) =>
      b.n_Li - a.n_Li || a.x - b.x || b.q - a.q
    );
  }

  function populateGeoControls() {
    const sel = $("geo-species");
    const groups = { 2: "Li₂Sₓ", 1: "LiSₓ", 0: "Sₓ" };
    let html = "";
    [2, 1, 0].forEach((nli) => {
      const items = geoUnion.filter((g) => g.n_Li === nli);
      if (!items.length) return;
      html += `<optgroup label="${groups[nli]}">`;
      items.forEach((g) => (html += `<option value="${g.key}">${g.label}</option>`));
      html += "</optgroup>";
    });
    sel.innerHTML = html;
    const solv = $("geo-solvent");
    solv.innerHTML = SOLVENTS.map((s) => `<option>${s}</option>`).join("");
    // default to Li2S6 if present
    if (window.GEOMETRIES.DMSO["2_6_0"]) sel.value = "2_6_0";
    curSpecies = sel.value;

    sel.addEventListener("change", () => { curSpecies = sel.value; renderGeometry(); });
    solv.addEventListener("change", renderGeometry);
    document.querySelectorAll("input[name=rep]").forEach((r) => r.addEventListener("change", applyStyle));
    $("geo-download").addEventListener("click", downloadXYZ);
  }

  function ensureViewer() {
    if (viewer) return;
    if (!window.$3Dmol) return;
    viewer = window.$3Dmol.createViewer($("viewer"), { backgroundAlpha: 0 });
  }

  function applyStyle() {
    if (!viewer) return;
    const rep = document.querySelector("input[name=rep]:checked").value;
    if (rep === "stick") viewer.setStyle({}, { stick: { radius: 0.18, colorscheme: CPK } });
    else viewer.setStyle({}, { stick: { radius: 0.14, colorscheme: CPK }, sphere: { scale: 0.3, colorscheme: CPK } });
    viewer.render();
  }

  function renderGeometry() {
    ensureViewer();
    const solvent = $("geo-solvent").value;
    const key = curSpecies || $("geo-species").value;
    const rec = window.GEOMETRIES[solvent] && window.GEOMETRIES[solvent][key];
    const meta = $("geo-meta"), flagBox = $("geo-flag"), noteBox = $("geo-note"), xyzBox = $("geo-xyz");
    const uni = geoUnion.find((g) => g.key === key) || {};

    if (!rec) {
      if (viewer) { viewer.clear(); viewer.render(); }
      meta.innerHTML =
        `<span class="badge">${uni.label || key}</span>` +
        `<span class="badge">${solvent}</span>` +
        `<span class="badge flagged">not available in ${solvent}</span>`;
      flagBox.hidden = false;
      flagBox.innerHTML = uni.n_Li === 1 && uni.x === 3 && uni.q === 0
        ? window.NOTES.lis3_dmso
        : `This species has no optimized geometry in ${solvent}. Try the other solvent.`;
      noteBox.hidden = true;
      xyzBox.textContent = "";
      return;
    }

    meta.innerHTML =
      `<span class="badge">${rec.label}</span>` +
      `<span class="badge">${solvent}</span>` +
      `<span class="badge">charge ${qLabel(rec.q)}</span>` +
      `<span class="badge">${rec.natom} atoms</span>` +
      `<span class="badge set-${setOf(rec)}">${setOf(rec)} set</span>` +
      (rec.flag ? `<span class="badge flagged">flagged</span>` : "");
    flagBox.hidden = !rec.flag;
    if (rec.flag) flagBox.textContent = rec.flag;
    noteBox.hidden = !rec.note;
    if (rec.note) noteBox.textContent = rec.note;
    xyzBox.textContent = rec.xyz;

    if (viewer) {
      viewer.clear();
      viewer.addModel(rec.xyz, "xyz");
      applyStyle();
      viewer.zoomTo();
      viewer.render();
    }
  }

  function setOf(rec) {
    // main set: Li2Sx neutral, LiSx-, all Sx; else SI
    if (rec.n_Li === 0) return "main";
    if (rec.n_Li === 2 && rec.q === 0) return "main";
    if (rec.n_Li === 1 && rec.q === -1) return "main";
    return "SI";
  }

  function downloadXYZ() {
    const solvent = $("geo-solvent").value;
    const key = curSpecies || $("geo-species").value;
    const rec = window.GEOMETRIES[solvent] && window.GEOMETRIES[solvent][key];
    if (!rec) return;
    downloadText(rec.xyz, "chemical/x-xyz", `${rec.formula}_${solvent}.xyz`);
  }

  // ------------------------------------------------------------- energies tab
  function markOf(r) {
    const f = r.flag ? ` <span class="flag-mark" title="${esc(r.flag)}">†</span>` : "";
    const n = r.note ? ` <span class="note-mark" title="${esc(r.note)}">ⓘ</span>` : "";
    return f + n;
  }

  function initEnergies() {
    const words = (r) => [
      speciesSearchTokens(baseFromLabel(r.label, r.q), r.q),
      asciiFold(r.family), r.solvent, r.set, r.flag ? "flagged" : "",
    ].join(" ").toLowerCase();
    window.ENERGIES.forEach((r) => { r._search = words(r); r._flag = !!r.flag; });

    const cols = [
      { key: "label", label: "Species", txt: true, render: (r) => `${r.label}${markOf(r)}` },
      { key: "solvent", label: "Solvent", txt: true },
      { key: "set", label: "Set", txt: true, render: (r) => `<span class="tag ${r.set}">${r.set}</span>` },
      { key: "q", label: "q", render: (r) => qLabel(r.q) },
      { key: "mult", label: "M", render: (r) => (r.mult ?? "—") },
      { key: "dG_dft", label: "ΔG DFT (eV)", render: (r) => fmt(r.dG_dft, 3) },
      { key: "dG_dft_pa", label: "ΔG DFT /atom", render: (r) => fmt(r.dG_dft_pa, 3) },
      { key: "dG_ccsd", label: "ΔG CCSD (eV)", render: (r) => fmt(r.dG_ccsd, 3) },
      { key: "dG_ccsd_pa", label: "ΔG CCSD /atom", render: (r) => fmt(r.dG_ccsd_pa, 3) },
      { key: "dev", label: "CCSD−DFT", tip: "dG_ccsd_minus_dft: positive = DFT over-stabilisation (the paper's deviation is the negative of this)", render: (r) => fmt(r.dev, 3) },
      { key: "homo", label: "HOMO (eV)", render: (r) => fmt(r.homo, 2) },
    ];
    const search = $("en-search"), solv = $("en-solvent"), set = $("en-set");
    const t = dataTable($("en-table"), cols, () => {
      const q = asciiFold(search.value.trim());
      return window.ENERGIES.filter((r) =>
        (!solv.value || r.solvent === solv.value) &&
        (!set.value || r.set === set.value) &&
        (!q || r._search.includes(q))
      );
    });
    [search, solv, set].forEach((el) => el.addEventListener("input", t.render));
    t.render();

    // voltage table (computed by build_data.py with lis_energetics)
    const vcols = [
      { key: "solvent", label: "Medium", txt: true },
      { key: "bulk_ccsd", label: "Bulk-Li, CCSD", render: (r) => fmt(r.bulk_ccsd, 3) },
      { key: "bulk_dft", label: "Bulk-Li, M06-2X", render: (r) => fmt(r.bulk_dft, 3) },
      { key: "atomic_ccsd", label: "Atomic, CCSD", render: (r) => fmt(r.atomic_ccsd, 3) },
      { key: "atomic_dft", label: "Atomic, M06-2X", render: (r) => fmt(r.atomic_dft, 3) },
    ];
    dataTable($("volt-table"), vcols, () => window.VOLTAGES.avg).render();
  }

  // ---------------------------------------------------------------- qtaim tab
  function initQtaim() {
    window.QTAIM_BCP.forEach((r, idx) => {
      const p = parseSystemRaw(r.system);
      r._id = idx;  // stable identity for selected-row tracking
      r._search = [p ? speciesSearchTokens(p.base, p.q) : asciiFold(r.system),
                   asciiFold(r.bond), asciiFold(r.atoms || "")].join(" ");
    });
    // populate bond-type filter
    const bonds = Array.from(new Set(window.QTAIM_BCP.map((r) => r.bond))).sort();
    $("bcp-bond").innerHTML = '<option value="">all</option>' + bonds.map((b) => `<option>${b}</option>`).join("");

    let selectedId = null;
    const cols = [
      { key: "system", label: "System", txt: true, render: (r) => formatSystem(r.system) },
      { key: "atoms", label: "Atoms", txt: true, tip: "atom pair (element + index); click a row to highlight it in 3D",
        render: (r) => r.atoms || "—" },
      { key: "solvent", label: "Solvent", txt: true },
      { key: "bond", label: "Bond", txt: true },
      { key: "covalent", label: "Covalent", render: (r) => (r.covalent ? "✓" : "—") },
      { key: "d", label: "d (Å)", render: (r) => fmt(r.d, 3) },
      { key: "rho", label: "ρ (a.u.)", render: (r) => fmt(r.rho, 4) },
      { key: "lap", label: "∇²ρ", render: (r) => fmt(r.lap, 4) },
      { key: "H", label: "H (a.u.)", render: (r) => fmt(r.H, 4) },
      { key: "EHB", label: "E_int (kcal/mol)", render: (r) => fmt(r.EHB, 1) },
      { key: "cls", label: "Class", txt: true },
    ];
    const search = $("bcp-search"), solv = $("bcp-solvent"), bond = $("bcp-bond"), count = $("bcp-count");
    const filtered = () => {
      const q = asciiFold(search.value.trim());
      return window.QTAIM_BCP.filter((r) =>
        (!solv.value || r.solvent === solv.value) &&
        (!bond.value || r.bond === bond.value) &&
        (!q || r._search.includes(q))
      );
    };
    const t = dataTable($("bcp-table"), cols, () => {
      const rows = filtered();
      count.textContent = `${rows.length} of ${window.QTAIM_BCP.length} bond critical points`;
      return rows;
    }, {
      rowClass: (r) => (r._id === selectedId ? "selected" : ""),
      onRowClick: (r) => { selectedId = r._id; t.render(); highlightBcp(r); },
    });
    [search, solv, bond].forEach((el) => el.addEventListener("input", t.render));
    t.render();

    // "show atom numbers" toggle for the inline viewer
    const labelToggle = $("bcp-labels");
    if (labelToggle) labelToggle.addEventListener("change", () => {
      bcpLabelsOn = labelToggle.checked;
      if (lastBcpRow) highlightBcp(lastBcpRow);
    });

    const ncols = [
      { key: "channel", label: "Channel", txt: true },
      { key: "solvent", label: "Solvent", txt: true },
      { key: "n", label: "N" },
      { key: "median", label: "Median" },
      { key: "p5", label: "5th %ile" },
      { key: "p95", label: "95th %ile" },
      { key: "max", label: "Max" },
    ];
    dataTable($("nbo-table"), ncols, () => window.NBO_CHANNELS).render();
  }

  // ---------------------------------------------------------- vibrational tab
  function initVibrational() {
    window.VIB_DOMINANT.forEach((r) => {
      r._search = [
        speciesSearchTokens(baseFromLabel(r.label, r.q), r.q),
        asciiFold(r.family), chargeWord(r.q),
      ].join(" ");
    });
    const cols = [
      { key: "label", label: "Species", txt: true },
      { key: "family", label: "Family", txt: true },
      // Harmonic is the primary number: the paper reports polysulfide bands
      // unscaled and keeps 0.96 for the solvents only. The scaled value is
      // shown in parentheses so neither convention is hidden.
      { key: "raman_dmso_harm", label: "Raman DMSO", render: (r) => fmt(r.raman_dmso_harm, 0) + " (" + fmt(r.raman_dmso_scaled, 0) + ")" },
      { key: "raman_tegdme_harm", label: "Raman TEGDME", render: (r) => fmt(r.raman_tegdme_harm, 0) + " (" + fmt(r.raman_tegdme_scaled, 0) + ")" },
      { key: "ir_dmso_harm", label: "IR DMSO", render: (r) => fmt(r.ir_dmso_harm, 0) + " (" + fmt(r.ir_dmso_scaled, 0) + ")" },
      { key: "ir_tegdme_harm", label: "IR TEGDME", render: (r) => fmt(r.ir_tegdme_harm, 0) + " (" + fmt(r.ir_tegdme_scaled, 0) + ")" },
    ];
    const search = $("vib-search");
    const t = dataTable($("vib-table"), cols, () => {
      const q = asciiFold(search.value.trim());
      return window.VIB_DOMINANT.filter((r) => !q || r._search.includes(q));
    });
    search.addEventListener("input", t.render);
    t.render();

    // reference bands table (dynamic columns)
    if (window.VIB_REFERENCE.length) {
      const keys = Object.keys(window.VIB_REFERENCE[0]);
      const rcols = keys.map((k, i) => ({
        key: k, txt: i < 2,
        label: k.replace(/_cm1/, " (cm⁻¹)").replace(/_/g, " "),
        render: (r) => (typeof r[k] === "number" ? Number(r[k]).toFixed(k.includes("act") ? 1 : 0) : r[k]),
      }));
      dataTable($("vibref-table"), rcols, () => window.VIB_REFERENCE).render();
    }

    initModeViewer();
  }

  // ------------------------------------------------ per-species mode viewer
  // Every harmonic normal mode of every species (window.VIB_MODES, unscaled),
  // drawn as sticks plus a Lorentzian-broadened envelope, in either or both
  // solvents, under the paper's frequency convention or either single factor.
  const MV = {
    W: 760, H: 240, PAD: { l: 62, r: 14, t: 26, b: 40 },
    scale: (window.VIB_META && window.VIB_META.solvent_scale) || 0.96,
    species: [], cur: null, hits: [], rows: [], table: null, drawn: false,
  };
  const KIND_INFO = {
    ir: { col: 1, name: "IR", unit: "km/mol", axis: "IR intensity (km/mol)" },
    raman: { col: 2, name: "Raman", unit: "Å⁴/amu", axis: "Raman activity (Å⁴/amu)" },
  };
  // Styles inlined into the exported SVG so it renders standalone (the page's
  // own classes come from style.css, which a saved file does not carry).
  const MV_EXPORT_CSS =
    ".mv-grid{stroke:#e6eaef;stroke-width:1}.mv-frame{fill:none;stroke:#57606a;stroke-width:1}" +
    ".mv-tick{font-size:10px;fill:#57606a}.mv-axis{font-size:11px;fill:#1b1f24}" +
    ".mv-kindlabel{font-size:12px;font-weight:600;fill:#1b1f24}.mv-empty{font-size:11px;fill:#57606a;font-style:italic}";
  const CONV_LABEL = {
    paper: "paper convention: polysulfides unscaled, solvents and TFSI⁻ ×0.96",
    harmonic: "all unscaled harmonic",
    scaled: "all ×0.96",
  };

  function famInfo(key) {
    const fams = (window.VIB_META && window.VIB_META.families) || [];
    return fams.find((f) => f.key === key) || { key, label: key, color: "#555555" };
  }
  // Darken a #rrggbb colour by a fraction (TEGDME series in an overlay).
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 - k))));
    const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }
  function mvScale(rec, conv) {
    if (conv === "harmonic") return 1;
    if (conv === "scaled") return MV.scale;
    return rec.electrolyte ? MV.scale : 1;   // paper convention
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1;
    const raw = span / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    const step = (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function fmtY(v) {
    if (v === 0) return "0";
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    const a = Math.abs(v);
    return a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2);
  }

  function mvSpeciesList() {
    const seen = new Map();
    SOLVENTS.forEach((s) => Object.entries(window.VIB_MODES[s] || {}).forEach(([k, v]) => {
      if (!seen.has(k)) seen.set(k, { key: k, label: v.label, family: v.family, n_Li: v.n_Li, x: v.x, q: v.q, electrolyte: v.electrolyte, solvents: [] });
      seen.get(k).solvents.push(s);
    }));
    const order = (window.VIB_META && window.VIB_META.order) || [];
    const rank = new Map(order.map((k, i) => [k, i]));
    return Array.from(seen.values()).sort((a, b) => (rank.has(a.key) ? rank.get(a.key) : 999) - (rank.has(b.key) ? rank.get(b.key) : 999));
  }

  function mvState() {
    return {
      kind: $("mv-kind").value, solvent: $("mv-solvent").value, conv: $("mv-conv").value,
      gamma: parseFloat($("mv-gamma").value) || 6,
      xmin: parseFloat($("mv-xmin").value), xmax: parseFloat($("mv-xmax").value),
    };
  }

  // The series to draw for the current species: one per selected solvent
  // that has data, with the convention applied.
  function mvSeries(st) {
    const sp = MV.cur;
    const sols = st.solvent === "both" ? SOLVENTS : [st.solvent];
    const out = [];
    sols.forEach((s, si) => {
      const rec = window.VIB_MODES[s] && window.VIB_MODES[s][sp];
      if (!rec) { out.push({ solvent: s, missing: true }); return; }
      const fam = famInfo(rec.family);
      const k = mvScale(rec, st.conv);
      const color = s === "TEGDME" && st.solvent === "both" ? shade(fam.color, 0.35) : fam.color;
      out.push({
        solvent: s, rec, fam, color, dash: s === "TEGDME" ? "6 4" : "", scale: k,
        modes: rec.modes.map((m, i) => ({ idx: i + 1, harm: m[0], shown: m[0] * k, ir: m[1], raman: m[2], sym: m[3] })),
      });
    });
    return out;
  }

  // Lorentzian envelope with every line's peak equal to its stick height, so
  // an isolated band reads directly as its activity and overlapping bands add.
  function envelope(modes, col, xs, gamma) {
    const g2 = gamma * gamma;
    const y = new Float64Array(xs.length);
    modes.forEach((m) => {
      const a = col === 1 ? m.ir : m.raman;
      if (!(a > 0)) return;
      for (let i = 0; i < xs.length; i++) {
        const d = xs[i] - m.shown;
        y[i] += a * g2 / (d * d + g2);
      }
    });
    return y;
  }

  function mvPanelSVG(kind, series, st, top) {
    const info = KIND_INFO[kind];
    const { W, H, PAD } = MV;
    const x0 = PAD.l, x1 = W - PAD.r, y0 = top + PAD.t, y1 = top + H - PAD.b;
    const xr = [st.xmin, st.xmax];
    const sx = (v) => x0 + (v - xr[0]) / (xr[1] - xr[0]) * (x1 - x0);
    const N = 900;
    const xs = new Float64Array(N);
    for (let i = 0; i < N; i++) xs[i] = xr[0] + (xr[1] - xr[0]) * i / (N - 1);
    const curves = series.filter((s) => !s.missing).map((s) => ({ s, y: envelope(s.modes, info.col, xs, st.gamma) }));
    let ymax = 0;
    curves.forEach(({ s, y }) => {
      for (let i = 0; i < N; i++) if (y[i] > ymax) ymax = y[i];
      s.modes.forEach((m) => { const a = info.col === 1 ? m.ir : m.raman; if (m.shown >= xr[0] && m.shown <= xr[1] && a > ymax) ymax = a; });
    });
    const empty = !(ymax > 0);
    if (empty) ymax = 1;
    ymax *= 1.08;
    const sy = (v) => y1 - v / ymax * (y1 - y0);

    let g = `<g class="mv-panel" data-kind="${kind}">`;
    // frame + grid
    niceTicks(xr[0], xr[1], 8).forEach((v) => {
      g += `<line x1="${sx(v).toFixed(1)}" y1="${y0}" x2="${sx(v).toFixed(1)}" y2="${y1}" class="mv-grid"/>`;
      g += `<text x="${sx(v).toFixed(1)}" y="${y1 + 15}" class="mv-tick" text-anchor="middle">${v}</text>`;
    });
    niceTicks(0, ymax, 4).forEach((v) => {
      if (v > ymax) return;
      g += `<line x1="${x0}" y1="${sy(v).toFixed(1)}" x2="${x1}" y2="${sy(v).toFixed(1)}" class="mv-grid"/>`;
      g += `<text x="${x0 - 6}" y="${(sy(v) + 3.5).toFixed(1)}" class="mv-tick" text-anchor="end">${fmtY(v)}</text>`;
    });
    g += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" class="mv-frame"/>`;
    g += `<text x="${x0 + 8}" y="${y0 + 14}" class="mv-kindlabel">${info.name}</text>`;
    g += `<text transform="translate(14 ${(y0 + y1) / 2}) rotate(-90)" class="mv-axis" text-anchor="middle">${info.axis}</text>`;
    g += `<text x="${(x0 + x1) / 2}" y="${y1 + 31}" class="mv-axis" text-anchor="middle">Frequency (cm⁻¹)</text>`;
    // envelopes (area + line)
    curves.forEach(({ s, y }) => {
      let d = `M${sx(xs[0]).toFixed(1)},${sy(0).toFixed(1)}`;
      for (let i = 0; i < N; i++) d += `L${sx(xs[i]).toFixed(1)},${sy(y[i]).toFixed(1)}`;
      const line = d.slice(d.indexOf("L")).replace(/^L/, "M");
      d += `L${sx(xs[N - 1]).toFixed(1)},${sy(0).toFixed(1)}Z`;
      g += `<path d="${d}" fill="${s.color}" fill-opacity="0.13" stroke="none"/>`;
      g += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="1.3"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
    });
    // sticks + hit targets
    curves.forEach(({ s }) => {
      s.modes.forEach((m) => {
        const a = info.col === 1 ? m.ir : m.raman;
        if (m.shown < xr[0] || m.shown > xr[1]) return;
        const X = sx(m.shown).toFixed(1), Y = sy(a > 0 ? a : 0).toFixed(1);
        const h = MV.hits.push({ s, m, kind }) - 1;
        g += `<line x1="${X}" y1="${sy(0).toFixed(1)}" x2="${X}" y2="${Y}" stroke="${s.color}" stroke-width="1.5" class="mv-stick" id="mv-stick-${h}"/>`;
        g += `<rect x="${(+X - 4).toFixed(1)}" y="${y0}" width="8" height="${y1 - y0}" class="mv-hit" data-h="${h}"/>`;
      });
    });
    if (empty) g += `<text x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2}" class="mv-empty" text-anchor="middle">no ${info.name}-active mode in this range</text>`;
    series.filter((s) => s.missing).forEach((s, i) => {
      g += `<text x="${x1 - 8}" y="${y0 + 14 + 14 * i}" class="mv-empty" text-anchor="end">no data in ${s.solvent}</text>`;
    });
    g += "</g>";
    return g;
  }

  function mvTitle(st, series) {
    const uni = MV.species.find((s) => s.key === MV.cur) || {};
    const fam = famInfo(uni.family || "");
    const sols = series.filter((s) => !s.missing).map((s) => s.solvent).join(" + ");
    return `${uni.label || MV.cur} (${fam.label}) · ${sols} · ${CONV_LABEL[st.conv]} · Lorentzian half-width ${st.gamma} cm⁻¹ · M06-2X/def2-TZVPPD/SMD harmonic modes`;
  }

  function renderModeViewer() {
    const svg = $("mv-svg");
    if (!svg || !MV.cur) return;
    const st = mvState();
    if (!(st.xmax > st.xmin)) { $("mv-xmax").value = st.xmin + 100; st.xmax = st.xmin + 100; }
    const kinds = st.kind === "both" ? ["ir", "raman"] : [st.kind];
    const series = mvSeries(st);
    MV.hits = [];
    let body = "";
    kinds.forEach((k, i) => { body += mvPanelSVG(k, series, st, i * MV.H); });
    const H = kinds.length * MV.H;
    svg.setAttribute("viewBox", `0 0 ${MV.W} ${H}`);
    svg.innerHTML = `<title>${esc(mvTitle(st, series))}</title>` + body;
    $("mv-tip").hidden = true;

    // legend
    const uni = MV.species.find((s) => s.key === MV.cur) || {};
    const fam = famInfo(uni.family || "");
    $("mv-legend").innerHTML =
      `<span class="mv-species">${esc(uni.label || MV.cur)}</span> <span class="mv-fam">${esc(fam.label)}</span> ` +
      series.map((s) => s.missing
        ? `<span class="mv-key muted">${s.solvent}: no data</span>`
        : `<span class="mv-key"><svg width="34" height="10" viewBox="0 0 34 10"><line x1="1" y1="5" x2="33" y2="5" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/></svg>${s.solvent}${s.scale !== 1 ? " (×" + s.scale + ")" : " (unscaled)"}</span>`
      ).join(" ");

    // mode table rows
    MV.rows = [];
    series.filter((s) => !s.missing).forEach((s) => s.modes.forEach((m) => MV.rows.push({
      solvent: s.solvent, idx: m.idx, sym: m.sym, harm: m.harm, scaled: m.harm * MV.scale,
      shown: m.shown, ir: m.ir, raman: m.raman, conv: s.scale === 1 ? "unscaled" : "×" + s.scale,
    })));
    MV.table.render();
    MV.drawn = true;
  }

  function mvTooltip(e) {
    const hit = e.target.closest && e.target.closest(".mv-hit");
    const tip = $("mv-tip");
    document.querySelectorAll(".mv-stick.hot").forEach((el) => el.classList.remove("hot"));
    if (!hit) { tip.hidden = true; return; }
    const h = MV.hits[+hit.dataset.h];
    if (!h) { tip.hidden = true; return; }
    const stick = $("mv-stick-" + hit.dataset.h);
    if (stick) stick.classList.add("hot");
    const { s, m } = h;
    tip.innerHTML =
      `<b>${esc(s.rec.label)}</b> · ${s.solvent} · mode ${m.idx} (${esc(m.sym)})<br>` +
      `${m.harm.toFixed(1)} cm⁻¹ harmonic · ${(m.harm * MV.scale).toFixed(1)} at ×${MV.scale}` +
      (s.scale === 1 ? " · shown unscaled" : ` · shown at ×${s.scale}`) + `<br>` +
      `IR ${m.ir.toFixed(2)} km/mol · Raman ${m.raman.toFixed(2)} Å⁴/amu`;
    tip.hidden = false;
    const box = $("mv-plot").getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width - 4) x = Math.max(4, e.clientX - box.left - tip.offsetWidth - 14);
    if (y + tip.offsetHeight > box.height - 4) y = Math.max(4, e.clientY - box.top - tip.offsetHeight - 14);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function mvDownloadCSV() {
    const st = mvState();
    const uni = MV.species.find((s) => s.key === MV.cur) || {};
    const head = "species,solvent,mode_index,symmetry,freq_harmonic_cm1,freq_x0.96_cm1,freq_shown_cm1,shown_convention,ir_km_mol,raman_A4_amu";
    const lines = MV.rows.map((r) => [
      MV.cur, r.solvent, r.idx, r.sym, r.harm.toFixed(3), r.scaled.toFixed(3), r.shown.toFixed(3), r.conv, r.ir.toFixed(4), r.raman.toFixed(4),
    ].join(","));
    downloadText(head + "\n" + lines.join("\n") + "\n", "text/csv", `${MV.cur}_modes_${st.solvent === "both" ? "DMSO_TEGDME" : st.solvent}_${st.conv}.csv`);
  }

  function mvDownloadSVG() {
    downloadText(mvExportSVG(), "image/svg+xml", `${MV.cur}_${mvState().kind}_${mvState().solvent === "both" ? "DMSO_TEGDME" : mvState().solvent}_${mvState().conv}.svg`);
  }

  // Standalone SVG of the current plot: inline styles, white ground, a title
  // line, the invisible hover targets removed.
  function mvExportSVG() {
    const svg = $("mv-svg");
    const H = svg.viewBox.baseVal.height + 22;
    const title = svg.querySelector("title") ? svg.querySelector("title").textContent : MV.cur;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${MV.W}" height="${H}" viewBox="0 -22 ${MV.W} ${H}" font-family="Helvetica, Arial, sans-serif">\n` +
      `<style>${MV_EXPORT_CSS}</style>\n<rect x="0" y="-22" width="${MV.W}" height="${H}" fill="white"/>\n` +
      `<text x="8" y="-8" font-size="9" fill="#333">${esc(title)}</text>\n` +
      svg.innerHTML.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<rect[^>]*class="mv-hit"[^>]*?(?:\/>|><\/rect>)/g, "") + "\n</svg>\n");
  }

  function mvFitRange() {
    const st = mvState();
    let lo = Infinity, hi = -Infinity;
    mvSeries(st).filter((s) => !s.missing).forEach((s) => s.modes.forEach((m) => { lo = Math.min(lo, m.shown); hi = Math.max(hi, m.shown); }));
    if (!isFinite(lo)) return;
    $("mv-xmin").value = Math.max(0, Math.floor((lo - 30) / 10) * 10);
    $("mv-xmax").value = Math.ceil((hi + 30) / 10) * 10;
    renderModeViewer();
  }

  function mvStep(delta) {
    const sel = $("mv-species");
    const i = MV.species.findIndex((s) => s.key === MV.cur);
    const j = (i + delta + MV.species.length) % MV.species.length;
    sel.value = MV.species[j].key;
    MV.cur = sel.value;
    renderModeViewer();
  }

  function initModeViewer() {
    if (!window.VIB_MODES || !$("mv-species")) return;
    MV.species = mvSpeciesList();
    const sel = $("mv-species");
    const fams = (window.VIB_META && window.VIB_META.families) || [];
    let html = "";
    fams.forEach((f) => {
      const items = MV.species.filter((s) => s.family === f.key);
      if (!items.length) return;
      html += `<optgroup label="${esc(f.label)}">` + items.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("") + "</optgroup>";
    });
    const rest = MV.species.filter((s) => !fams.some((f) => f.key === s.family));
    if (rest.length) html += `<optgroup label="Other">` + rest.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join("") + "</optgroup>";
    sel.innerHTML = html;
    sel.value = MV.species.some((s) => s.key === "Li2S6") ? "Li2S6" : MV.species[0].key;
    MV.cur = sel.value;

    const cols = [
      { key: "solvent", label: "Solvent", txt: true },
      { key: "idx", label: "Mode" },
      { key: "sym", label: "Symmetry", txt: true },
      { key: "harm", label: "Harmonic (cm⁻¹)", render: (r) => fmt(r.harm, 1) },
      { key: "scaled", label: "×0.96 (cm⁻¹)", render: (r) => fmt(r.scaled, 1) },
      { key: "shown", label: "Shown (cm⁻¹)", tip: "under the selected convention", render: (r) => fmt(r.shown, 1) },
      { key: "ir", label: "IR (km/mol)", render: (r) => fmt(r.ir, 2) },
      { key: "raman", label: "Raman (Å⁴/amu)", render: (r) => fmt(r.raman, 2) },
    ];
    MV.table = dataTable($("mv-table"), cols, () => MV.rows);

    sel.addEventListener("change", () => { MV.cur = sel.value; renderModeViewer(); });
    ["mv-kind", "mv-solvent", "mv-conv"].forEach((id) => $(id).addEventListener("change", renderModeViewer));
    const gamma = $("mv-gamma"), gval = $("mv-gamma-val");
    gamma.addEventListener("input", () => { gval.textContent = `${parseFloat(gamma.value)} cm⁻¹`; renderModeViewer(); });
    gval.textContent = `${parseFloat(gamma.value)} cm⁻¹`;
    ["mv-xmin", "mv-xmax"].forEach((id) => $(id).addEventListener("change", renderModeViewer));
    $("mv-fit").addEventListener("click", mvFitRange);
    $("mv-csv").addEventListener("click", mvDownloadCSV);
    $("mv-svg-dl").addEventListener("click", mvDownloadSVG);
    $("mv-prev").addEventListener("click", () => mvStep(-1));
    $("mv-next").addEventListener("click", () => mvStep(1));
    const plot = $("mv-plot");
    plot.addEventListener("mousemove", mvTooltip);
    plot.addEventListener("mouseleave", () => { $("mv-tip").hidden = true; document.querySelectorAll(".mv-stick.hot").forEach((el) => el.classList.remove("hot")); });
    plot.addEventListener("click", mvTooltip);
    document.addEventListener("keydown", (e) => {
      if (!$("vibrational").classList.contains("active")) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (e.key === "ArrowRight") { mvStep(1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { mvStep(-1); e.preventDefault(); }
    });
    renderModeViewer();
  }

  // ------------------------------------------------- numbers from the build
  // Elements carrying data-meta="key" or "key.sub" print the counts computed by
  // build_data.py (window.META), several of them asserted against the paper, so the prose cannot drift.
  function fillMeta() {
    const meta = window.META || {};
    document.querySelectorAll("[data-meta]").forEach((el) => {
      const v = el.dataset.meta.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), meta);
      if (v !== undefined && v !== null) el.textContent = typeof v === "number" ? v.toLocaleString("en-US") : v;
    });
    const ul = $("extra-figs");
    if (ul && window.EXTRA_FIGURES) {
      ul.innerHTML = window.EXTRA_FIGURES.map((f) =>
        `<li><a href="data/si_extra_figures/${f.file}" download>${f.file}</a> — ${esc(f.caption)}</li>`).join("");
    }
    const fl = $("flag-list");
    if (fl && meta.flagged) fl.textContent = meta.flagged.join(", ");
  }

  function renderAuthors() {
    $("authors").innerHTML = AUTHORS.map(([n, a]) => `${esc(n)}<sup>${a.join(",")}</sup>`).join(", ");
    $("affils").innerHTML = AFFILS.map((a, i) => `<sup>${i + 1}</sup>${esc(a)}`).join(" · ") + " · *corresponding authors";
    $("bibtex").textContent = BIBTEX;
  }

  // -------------------------------------------------------------------- start
  document.addEventListener("DOMContentLoaded", function () {
    patch3Dmol();
    renderAuthors();
    fillMeta();
    buildSpeciesUnion();
    populateGeoControls();
    initEnergies();
    initQtaim();
    initVibrational();
    initTabs();
    renderGeometry();
  });
})();
