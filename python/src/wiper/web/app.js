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
  edgeScale: "normal",
  nodeScale: "normal",
  edgeFilter: "all",
  nodeFilter: "all",
  selected: null,
  positions: new Map(),
  layoutSignature: "",
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
  edgeTopN: document.getElementById("edgeTopNInput"),
  edgeTopPercent: document.getElementById("edgeTopPercentInput"),
  edgeThreshold: document.getElementById("edgeThresholdInput"),
  nodeTopN: document.getElementById("nodeTopNInput"),
  nodeTopPercent: document.getElementById("nodeTopPercentInput"),
  nodeThreshold: document.getElementById("nodeThresholdInput"),
};

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function edgeValue(edge, metric = state.metric) {
  if (metric === "raw") return edge.rawWeight;
  if (metric === "wiper1") return edge.wiper1 && edge.wiper1.score;
  return edge.wiper2 && edge.wiper2.score;
}

function edgeRank(edge, metric) {
  if (metric === "raw") return edge.rawRank;
  if (metric === "wiper1") return edge.wiper1 && edge.wiper1.rank;
  return edge.wiper2 && edge.wiper2.rank;
}

function nodeValue(node) {
  return state.nodeScale === "log" ? node.logWinner : node.winner;
}

function scaledEdgeValue(edge) {
  const value = edgeValue(edge);
  if (value === null || value === undefined) return null;
  return state.edgeScale === "log" ? Math.log2(Math.max(Number(value), Number.EPSILON)) : Number(value);
}

function finiteValues(items, reader) {
  return items.map(reader).filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
}

function range(items, reader) {
  const vals = finiteValues(items, reader);
  if (!vals.length) return [0, 1];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? [Math.min(0, min), max || 1] : [min, max];
}

function normalize(value, min, max) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(1, (Number(value) - min) / (max - min || 1)));
}

function colorFor(t) {
  const stops = [
    [37, 99, 235],
    [15, 118, 110],
    [180, 83, 9],
    [190, 18, 60],
  ];
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const rgb = stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function filterBy(items, mode, reader, topN, topPercent, threshold) {
  const scored = items
    .filter((item) => reader(item) !== null && reader(item) !== undefined && Number.isFinite(Number(reader(item))))
    .sort((a, b) => Number(reader(b)) - Number(reader(a)));
  if (mode === "all") return new Set(scored.map((item) => item.id));
  if (mode === "topn") return new Set(scored.slice(0, Math.max(1, Number(topN) || 1)).map((item) => item.id));
  if (mode === "percent") {
    const count = Math.max(1, Math.ceil(scored.length * (Math.max(1, Number(topPercent) || 1) / 100)));
    return new Set(scored.slice(0, count).map((item) => item.id));
  }
  const minScore = Number(threshold) || 0;
  return new Set(scored.filter((item) => Number(reader(item)) >= minScore).map((item) => item.id));
}

function activeNodeIds() {
  if (!state.data) return new Set();
  return filterBy(
    state.data.nodes,
    state.nodeFilter,
    (node) => nodeValue(node),
    els.nodeTopN.value,
    els.nodeTopPercent.value,
    els.nodeThreshold.value,
  );
}

function activeEdgeIds(nodeIds = activeNodeIds()) {
  if (!state.data) return new Set();
  const edgeIds = filterBy(
    state.data.edges,
    state.edgeFilter,
    (edge) => scaledEdgeValue(edge),
    els.edgeTopN.value,
    els.edgeTopPercent.value,
    els.edgeThreshold.value,
  );
  return new Set(
    state.data.edges
      .filter((edge) => edgeIds.has(edge.id) && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => edge.id),
  );
}

function selectedEdge() {
  return state.data && state.data.edges.find((edge) => edge.id === state.selected);
}

function ensureLayout(nodeIds, edgeIds) {
  if (!state.data) return;
  const width = 900;
  const height = 620;
  const nodes = state.data.nodes.filter((node) => nodeIds.has(node.id));
  const edges = state.data.edges.filter((edge) => edgeIds.has(edge.id));
  const signature = `${nodes.map((n) => n.id).join(",")}|${edges.map((e) => e.id).join(",")}`;
  if (signature === state.layoutSignature) return;
  state.layoutSignature = signature;
  state.positions = new Map();

  nodes.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, nodes.length);
    const ring = 170 + 28 * (idx % 4);
    state.positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * ring,
      y: height / 2 + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
    });
  });

  const springBase = 105;
  const springRange = 115;
  const repulsion = 7200;
  const damping = 0.76;
  const step = 0.52;
  const visibleNodeIds = nodes.map((node) => node.id);
  for (let tick = 0; tick < 520; tick += 1) {
    const alpha = 1 - tick / 520;
    for (let i = 0; i < visibleNodeIds.length; i += 1) {
      const a = state.positions.get(visibleNodeIds[i]);
      for (let j = i + 1; j < visibleNodeIds.length; j += 1) {
        const b = state.positions.get(visibleNodeIds[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          dx = 1;
          dy = 0;
          dist2 = 1;
        }
        const force = (repulsion * alpha) / dist2;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }
    edges.forEach((edge) => {
      const a = state.positions.get(edge.source);
      const b = state.positions.get(edge.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const strength = Math.max(0.05, edge.rawWeight || 0.3);
      const target = springBase + springRange * (1 - strength);
      const force = ((dist - target) / dist) * 0.035 * alpha;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    });
    visibleNodeIds.forEach((id) => {
      const p = state.positions.get(id);
      p.vx += (width / 2 - p.x) * 0.008 * alpha;
      p.vy += (height / 2 - p.y) * 0.008 * alpha;
      p.x = Math.max(38, Math.min(width - 38, p.x + p.vx * step));
      p.y = Math.max(34, Math.min(height - 34, p.y + p.vy * step));
      p.vx *= damping;
      p.vy *= damping;
    });
  }
}

function edgeReason(edge) {
  if (state.metric === "raw") return `direct rank ${edgeRank(edge, "raw") || "-"}`;
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
  const nodeIds = activeNodeIds();
  const edgeIds = activeEdgeIds(nodeIds);
  ensureLayout(nodeIds, edgeIds);
  els.svg.replaceChildren();

  const nodes = state.data.nodes.filter((node) => nodeIds.has(node.id));
  const edges = state.data.edges.filter((edge) => edgeIds.has(edge.id));
  const [edgeMin, edgeMax] = range(edges, scaledEdgeValue);
  const [nodeMin, nodeMax] = range(nodes, nodeValue);

  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  els.svg.append(edgeLayer, nodeLayer);

  edges.forEach((edge) => {
    const a = state.positions.get(edge.source);
    const b = state.positions.get(edge.target);
    if (!a || !b) return;
    const t = normalize(scaledEdgeValue(edge), edgeMin, edgeMax);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", colorFor(t));
    line.setAttribute("stroke-width", String(1.2 + 9.5 * t));
    line.setAttribute("class", `edge ${edge.id === state.selected ? "selected" : ""}`);
    line.addEventListener("click", () => {
      state.selected = edge.id;
      render();
    });
    edgeLayer.appendChild(line);
  });

  const selected = selectedEdge();
  nodes.forEach((node) => {
    const p = state.positions.get(node.id);
    const t = normalize(nodeValue(node), nodeMin, nodeMax);
    const radius = 7 + 19 * Math.sqrt(t);
    const activeNode = selected && (selected.source === node.id || selected.target === node.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", activeNode ? radius + 3 : radius);
    circle.setAttribute("fill", colorFor(t));
    circle.setAttribute("class", `node ${activeNode ? "active" : ""}`);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", p.x + radius + 5);
    label.setAttribute("y", p.y + 4);
    label.setAttribute("class", "nodeLabel");
    label.textContent = node.id;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${node.id}: WINNER ${fmt(node.winner)} rank ${node.rank}`;
    circle.appendChild(title);
    group.append(circle, label);
    nodeLayer.appendChild(group);
  });
}

function renderTable() {
  if (!state.data) return;
  const nodeIds = activeNodeIds();
  const edgeIds = activeEdgeIds(nodeIds);
  const needle = els.filter.value.trim().toLowerCase();
  const edges = [...state.data.edges]
    .filter((edge) => !needle || edge.id.toLowerCase().replace("\t", "-").includes(needle))
    .sort((a, b) => {
      const av = scaledEdgeValue(a);
      const bv = scaledEdgeValue(b);
      if (av === null || av === undefined || !Number.isFinite(av)) return 1;
      if (bv === null || bv === undefined || !Number.isFinite(bv)) return -1;
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
      <td><strong>${edgeName}</strong><br>${edgeIds.has(edge.id) ? '<span class="badge">shown</span>' : '<span class="rank">hidden</span>'}</td>
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
  const nodeMap = new Map(state.data.nodes.map((node) => [node.id, node]));
  const nodeIds = activeNodeIds();
  const shown = activeEdgeIds(nodeIds).has(edge.id) ? "Yes" : "No";
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  const lines = [
    ["Edge", edge.id.replace("\t", "-")],
    ["Raw weight", fmt(edge.rawWeight)],
    ["WIPER1 score", fmt(edge.wiper1 && edge.wiper1.score)],
    ["WIPER2 score", fmt(edge.wiper2 && edge.wiper2.score)],
    ["Path load", fmt(edge.wiper2 && edge.wiper2.pathLoad)],
    [`${edge.source} WINNER`, source ? `${fmt(source.winner)} (#${source.rank})` : "-"],
    [`${edge.target} WINNER`, target ? `${fmt(target.winner)} (#${target.rank})` : "-"],
    ["Shown", shown],
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
  const nodeIds = activeNodeIds();
  const edgeIds = activeEdgeIds(nodeIds);
  els.summary.textContent = `${nodeIds.size}/${s.nodeCount} nodes, ${edgeIds.size}/${s.inputEdgeCount} edges shown, ${s.iterations} iterations`;
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
  state.positions = new Map();
  state.layoutSignature = "";
  state.selected = result.edges[0] && result.edges[0].id;
  render();
}

function makeRandom() {
  const count = 10 + Math.floor(Math.random() * 6);
  const nodes = Array.from({ length: count }, (_, i) => `N${i + 1}`);
  const edges = [];
  const add = (a, b, w) => {
    if (a === b) return;
    const key = [a, b].sort().join("\t");
    if (edges.some((e) => [e[0], e[1]].sort().join("\t") === key)) return;
    edges.push([a, b, Math.max(0.05, Math.min(0.98, w))]);
  };
  for (let i = 0; i < count - 1; i += 1) add(nodes[i], nodes[i + 1], 0.72 + Math.random() * 0.24);
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

function bindSegments(id, stateKey, dataKey) {
  document.getElementById(id).addEventListener("click", (event) => {
    const button = event.target.closest(`button[${dataKey}]`);
    if (!button) return;
    state[stateKey] = button.getAttribute(dataKey);
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("active", b === button));
    state.layoutSignature = "";
    render();
  });
}

bindSegments("metricSegments", "metric", "data-metric");
bindSegments("edgeScaleSegments", "edgeScale", "data-scale");
bindSegments("nodeScaleSegments", "nodeScale", "data-scale");
bindSegments("edgeFilterSegments", "edgeFilter", "data-mode");
bindSegments("nodeFilterSegments", "nodeFilter", "data-mode");

els.analyze.addEventListener("click", analyze);
els.sample.addEventListener("click", () => {
  els.edgeText.value = sampleNetwork;
  analyze();
});
els.random.addEventListener("click", makeRandom);
els.filter.addEventListener("input", renderTable);
[
  els.edgeTopN,
  els.edgeTopPercent,
  els.edgeThreshold,
  els.nodeTopN,
  els.nodeTopPercent,
  els.nodeThreshold,
].forEach((input) => input.addEventListener("input", () => {
  state.layoutSignature = "";
  render();
}));
els.includeNovel.addEventListener("change", analyze);
els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;
  els.edgeText.value = await file.text();
  analyze();
});

els.edgeText.value = sampleNetwork;
analyze();
