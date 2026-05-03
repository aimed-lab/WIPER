const sampleNetwork = `node1\tnode2\tweight
A\tB\t0.92
B\tC\t0.88
C\tD\t0.84
D\tE\t0.80
E\tF\t0.77
A\tC\t0.50
B\tD\t0.45
C\tE\t0.42
B\tF\t0.18
A\tF\t0.12
G\tH\t0.90
H\tI\t0.86
I\tJ\t0.82
G\tI\t0.48
F\tG\t0.62
D\tH\t0.38`;

const state = {
  data: null,
  metric: "raw",
  backbone: "all",
  selected: null,
  positions: new Map(),
};

const els = {
  edgeText: document.getElementById("edgeText"),
  fileInput: document.getElementById("fileInput"),
  iterations: document.getElementById("iterationsInput"),
  device: document.getElementById("deviceInput"),
  includeNovel: document.getElementById("includeNovelInput"),
  analyze: document.getElementById("analyzeBtn"),
  sample: document.getElementById("sampleBtn"),
  random: document.getElementById("randomBtn"),
  summary: document.getElementById("summary"),
  svg: document.getElementById("networkSvg"),
  rows: document.getElementById("edgeRows"),
  filter: document.getElementById("filterInput"),
  selected: document.getElementById("selectedDetails"),
  topN: document.getElementById("topNInput"),
  topPercent: document.getElementById("topPercentInput"),
};

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function metricValue(edge, metric = state.metric) {
  if (metric === "raw") return edge.rawWeight;
  if (metric === "wiper1") return edge.wiper1 && edge.wiper1.score;
  return edge.wiper2 && edge.wiper2.score;
}

function metricRank(edge, metric) {
  if (metric === "raw") return edge.rawRank;
  if (metric === "wiper1") return edge.wiper1 && edge.wiper1.rank;
  return edge.wiper2 && edge.wiper2.rank;
}

function scoreRange(edges) {
  const vals = edges.map((e) => metricValue(e)).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return [0, 1];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? [0, max || 1] : [min, max];
}

function colorFor(value, min, max) {
  if (value === null || value === undefined) return "#cbd5e1";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const stops = [
    [37, 99, 235],
    [15, 118, 110],
    [180, 83, 9],
    [190, 18, 60],
  ];
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const rgb = stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function activeEdges() {
  if (!state.data) return [];
  const scored = state.data.edges
    .filter((edge) => metricValue(edge) !== null && metricValue(edge) !== undefined)
    .sort((a, b) => metricValue(b) - metricValue(a));
  if (state.backbone === "all") return scored;
  if (state.backbone === "topn") return scored.slice(0, Math.max(1, Number(els.topN.value) || 1));
  const count = Math.max(1, Math.ceil(scored.length * (Math.max(1, Number(els.topPercent.value) || 1) / 100)));
  return scored.slice(0, count);
}

function ensureLayout() {
  if (!state.data) return;
  const width = 900;
  const height = 620;
  const nodes = state.data.nodes.map((n) => n.id);
  const nodeSet = new Set(nodes);
  for (const key of Array.from(state.positions.keys())) {
    if (!nodeSet.has(key)) state.positions.delete(key);
  }
  nodes.forEach((id, idx) => {
    if (!state.positions.has(id)) {
      const angle = (2 * Math.PI * idx) / Math.max(1, nodes.length);
      state.positions.set(id, {
        x: width / 2 + Math.cos(angle) * 230,
        y: height / 2 + Math.sin(angle) * 210,
        vx: 0,
        vy: 0,
      });
    }
  });

  const edges = state.data.edges.filter((e) => e.isInput);
  for (let tick = 0; tick < 180; tick += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = state.positions.get(nodes[i]);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = state.positions.get(nodes[j]);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = Math.max(80, dx * dx + dy * dy);
        const force = 1700 / dist2;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }
    edges.forEach((edge) => {
      const a = state.positions.get(edge.source);
      const b = state.positions.get(edge.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const target = 118 + (1 - (edge.rawWeight || 0.5)) * 96;
      const force = (dist - target) * 0.004;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    });
    nodes.forEach((id) => {
      const p = state.positions.get(id);
      p.vx += (width / 2 - p.x) * 0.002;
      p.vy += (height / 2 - p.y) * 0.002;
      p.x = Math.max(45, Math.min(width - 45, p.x + p.vx));
      p.y = Math.max(35, Math.min(height - 35, p.y + p.vy));
      p.vx *= 0.72;
      p.vy *= 0.72;
    });
  }
}

function selectedEdge() {
  return state.data && state.data.edges.find((edge) => edge.id === state.selected);
}

function edgeReason(edge) {
  if (state.metric === "raw") {
    return `direct rank ${metricRank(edge, "raw") || "-"}`;
  }
  if (state.metric === "wiper1") {
    if (!edge.wiper1) return "no WIPER1 score";
    const ext = edge.wiper1.extended ? "novel candidate" : "input edge";
    return `edge-neighborhood degree ${edge.wiper1.degree}; ${ext}`;
  }
  if (!edge.wiper2) return "no WIPER2 score";
  return `path load ${fmt(edge.wiper2.pathLoad)}; co-path degree ${edge.wiper2.coPathDegree || 0}`;
}

function drawNetwork() {
  if (!state.data) return;
  ensureLayout();
  els.svg.replaceChildren();
  const active = new Set(activeEdges().map((edge) => edge.id));
  const [min, max] = scoreRange(state.data.edges);

  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  els.svg.append(edgeLayer, nodeLayer);

  state.data.edges.forEach((edge) => {
    const a = state.positions.get(edge.source);
    const b = state.positions.get(edge.target);
    if (!a || !b) return;
    const value = metricValue(edge);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", colorFor(value, min, max));
    line.setAttribute("stroke-width", String(1.6 + 7 * ((value || 0) - min) / (max - min || 1)));
    line.setAttribute("class", `edge ${active.has(edge.id) ? "" : "dim"} ${edge.id === state.selected ? "selected" : ""}`);
    line.addEventListener("click", () => {
      state.selected = edge.id;
      render();
    });
    edgeLayer.appendChild(line);
  });

  const selected = selectedEdge();
  state.data.nodes.forEach((node) => {
    const p = state.positions.get(node.id);
    const activeNode = selected && (selected.source === node.id || selected.target === node.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", activeNode ? 12 : 9);
    circle.setAttribute("class", `node ${activeNode ? "active" : ""}`);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", p.x + 12);
    label.setAttribute("y", p.y + 4);
    label.setAttribute("class", "nodeLabel");
    label.textContent = node.id;
    group.append(circle, label);
    nodeLayer.appendChild(group);
  });
}

function renderTable() {
  if (!state.data) return;
  const active = new Set(activeEdges().map((edge) => edge.id));
  const needle = els.filter.value.trim().toLowerCase();
  const edges = [...state.data.edges]
    .filter((edge) => !needle || edge.id.toLowerCase().replace("\t", "-").includes(needle))
    .sort((a, b) => {
      const av = metricValue(a);
      const bv = metricValue(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });
  els.rows.replaceChildren();
  edges.forEach((edge) => {
    const row = document.createElement("tr");
    row.className = edge.id === state.selected ? "selected" : "";
    row.addEventListener("click", () => {
      state.selected = edge.id;
      render();
    });
    const edgeName = edge.id.replace("\t", "-");
    row.innerHTML = `
      <td><strong>${edgeName}</strong><br>${active.has(edge.id) ? '<span class="badge">shown</span>' : '<span class="rank">hidden</span>'}</td>
      <td>${fmt(edge.rawWeight)}<br><span class="rank">#${edge.rawRank || "-"}</span></td>
      <td>${fmt(edge.wiper1 && edge.wiper1.score)}<br><span class="rank">#${(edge.wiper1 && edge.wiper1.rank) || "-"}</span></td>
      <td>${fmt(edge.wiper2 && edge.wiper2.score)}<br><span class="rank">#${(edge.wiper2 && edge.wiper2.rank) || "-"}</span></td>
      <td>${fmt(edge.wiper2 && edge.wiper2.pathLoad)}</td>
      <td class="reason">${edgeReason(edge)}</td>`;
    els.rows.appendChild(row);
  });
}

function renderSelected() {
  const edge = selectedEdge();
  if (!edge) {
    els.selected.textContent = "None";
    return;
  }
  const shown = new Set(activeEdges().map((e) => e.id)).has(edge.id) ? "Yes" : "No";
  const lines = [
    ["Edge", edge.id.replace("\t", "-")],
    ["Raw weight", fmt(edge.rawWeight)],
    ["WIPER1 score", fmt(edge.wiper1 && edge.wiper1.score)],
    ["WIPER1 p", fmt(edge.wiper1 && edge.wiper1.pvalue, 4)],
    ["WIPER2 score", fmt(edge.wiper2 && edge.wiper2.score)],
    ["WIPER2 p", fmt(edge.wiper2 && edge.wiper2.pvalue, 4)],
    ["Path load", fmt(edge.wiper2 && edge.wiper2.pathLoad)],
    ["Backbone", shown],
  ];
  els.selected.replaceChildren();
  lines.forEach(([label, value]) => {
    const div = document.createElement("div");
    div.className = "detailLine";
    div.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.selected.appendChild(div);
  });
}

function render() {
  if (!state.data) return;
  const s = state.data.summary;
  const shown = activeEdges().length;
  els.summary.textContent = `${s.nodeCount} nodes, ${s.inputEdgeCount} input edges, ${shown} shown, ${s.iterations} iterations`;
  drawNetwork();
  renderTable();
  renderSelected();
}

async function analyze() {
  els.summary.textContent = "Scoring...";
  els.summary.className = "";
  const payload = {
    text: els.edgeText.value,
    iterations: Number(els.iterations.value) || 80,
    device: els.device.value,
    includeNovel: els.includeNovel.checked,
  };
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    els.summary.textContent = result.error || "Analysis failed";
    els.summary.className = "error";
    return;
  }
  state.data = result;
  state.selected = result.edges[0] && result.edges[0].id;
  render();
}

function makeRandom() {
  const count = 10 + Math.floor(Math.random() * 5);
  const nodes = Array.from({ length: count }, (_, i) => `N${i + 1}`);
  const edges = [];
  const add = (a, b, w) => {
    if (a === b) return;
    const key = [a, b].sort().join("\t");
    if (edges.some((e) => [e[0], e[1]].sort().join("\t") === key)) return;
    edges.push([a, b, Math.max(0.05, Math.min(0.98, w))]);
  };
  for (let i = 0; i < count - 1; i += 1) {
    add(nodes[i], nodes[i + 1], 0.72 + Math.random() * 0.24);
  }
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 2; j < count; j += 1) {
      const sameZone = Math.floor(i / 4) === Math.floor(j / 4);
      const p = sameZone ? 0.34 : 0.12;
      if (Math.random() < p) add(nodes[i], nodes[j], sameZone ? 0.38 + Math.random() * 0.42 : 0.14 + Math.random() * 0.48);
    }
  }
  els.edgeText.value = ["node1\tnode2\tweight", ...edges.map((e) => `${e[0]}\t${e[1]}\t${e[2].toFixed(3)}`)].join("\n");
  analyze();
}

document.getElementById("metricSegments").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-metric]");
  if (!button) return;
  state.metric = button.dataset.metric;
  document.querySelectorAll("#metricSegments button").forEach((b) => b.classList.toggle("active", b === button));
  render();
});

document.getElementById("backboneSegments").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  state.backbone = button.dataset.mode;
  document.querySelectorAll("#backboneSegments button").forEach((b) => b.classList.toggle("active", b === button));
  render();
});

els.analyze.addEventListener("click", analyze);
els.sample.addEventListener("click", () => {
  els.edgeText.value = sampleNetwork;
  analyze();
});
els.random.addEventListener("click", makeRandom);
els.filter.addEventListener("input", renderTable);
els.topN.addEventListener("input", render);
els.topPercent.addEventListener("input", render);
els.includeNovel.addEventListener("change", analyze);
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;
  els.edgeText.value = await file.text();
  analyze();
});

els.edgeText.value = sampleNetwork;
analyze();
