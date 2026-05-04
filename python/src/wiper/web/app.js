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
  metric: "wiper2",
  edgeMeasure: "ufc",
  edgeScale: "normal",
  nodeScale: "normal",
  nodeSizeMode: "relative",
  generatorModel: "random",
  resultTab: "edges",
  sidebarCollapsed: false,
  zoom: 1,
  panX: 0,
  panY: 0,
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
  geneterrain: document.getElementById("geneterrainBtn"),
  summary: document.getElementById("summary"),
  viewSummary: document.getElementById("viewSummary"),
  svg: document.getElementById("networkSvg"),
  rows: document.getElementById("edgeRows"),
  nodeRows: document.getElementById("nodeRows"),
  filter: document.getElementById("filterInput"),
  selected: document.getElementById("selectedDetails"),
  tooltip: document.getElementById("graphTooltip"),
  sizeLegend: document.getElementById("sizeLegend"),
  edgeLegend: document.getElementById("edgeLegend"),
  edgeTopN: document.getElementById("edgeTopNInput"),
  edgeTopPercent: document.getElementById("edgeTopPercentInput"),
  edgeThreshold: document.getElementById("edgeThresholdInput"),
  nodeTopN: document.getElementById("nodeTopNInput"),
  nodeTopPercent: document.getElementById("nodeTopPercentInput"),
  nodeThreshold: document.getElementById("nodeThresholdInput"),
  nodeMinRadius: document.getElementById("nodeMinRadiusInput"),
  nodeMaxRadius: document.getElementById("nodeMaxRadiusInput"),
  nodeRadiusFold: document.getElementById("nodeRadiusFoldInput"),
  generatorNodeCount: document.getElementById("generatorNodeCountInput"),
  generatorEdgeCount: document.getElementById("generatorEdgeCountInput"),
  generatorMinWeight: document.getElementById("generatorMinWeightInput"),
  generatorMaxWeight: document.getElementById("generatorMaxWeightInput"),
  chatLog: document.getElementById("chatLog"),
  chatInput: document.getElementById("chatInput"),
  chatApply: document.getElementById("chatApplyBtn"),
  exportEdges: document.getElementById("exportEdgesBtn"),
  exportNodes: document.getElementById("exportNodesBtn"),
  exportShown: document.getElementById("exportShownBtn"),
  exportExcel: document.getElementById("exportExcelBtn"),
  exportMarkdown: document.getElementById("exportMarkdownBtn"),
  exportWord: document.getElementById("exportWordBtn"),
  exportFigure: document.getElementById("exportFigureBtn"),
  networkSettings: document.getElementById("networkSettingsPanel"),
  networkSettingsBtn: document.getElementById("networkSettingsBtn"),
  networkSettingsClose: document.getElementById("networkSettingsCloseBtn"),
  zoomReset: document.getElementById("zoomResetBtn"),
  leftPane: document.getElementById("leftPane"),
  sidebarToggle: document.getElementById("sidebarToggleBtn"),
  leftResize: document.getElementById("leftResizeHandle"),
  agentResize: document.getElementById("agentResizeHandle"),
  resultsResize: document.getElementById("resultsResizeHandle"),
  agentPanel: document.querySelector(".agentPanel"),
  resultsPanel: document.querySelector(".resultsPanel"),
};

function apiUrl(path) {
  if (window.location.protocol === "file:") {
    return `http://127.0.0.1:8765${path}`;
  }
  return path;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metricLabel(metric = state.metric) {
  if (metric === "raw") return "Raw";
  return metric === "wiper1" ? "WIPER1" : "WIPER2";
}

function tooltipMove(event) {
  if (!els.tooltip || els.tooltip.hidden) return;
  const pad = 14;
  const rect = els.tooltip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  els.tooltip.style.left = `${Math.max(8, x)}px`;
  els.tooltip.style.top = `${Math.max(8, y)}px`;
}

function showTooltip(event, html) {
  if (!els.tooltip) return;
  els.tooltip.innerHTML = html;
  els.tooltip.hidden = false;
  tooltipMove(event);
}

function hideTooltip() {
  if (!els.tooltip) return;
  els.tooltip.hidden = true;
}

function wiperWeightLine(label, scores) {
  if (!scores) return `<div class="tipLine"><span>${label}</span><strong>-</strong></div>`;
  return `<div class="tipLine"><span>${label} W</span><strong>${fmt(scores.w0)} -> ${fmt(scores.weight)}</strong></div>`;
}

function edgeTooltip(edge) {
  return `
    <div class="tipTitle">${escapeHtml(edge.id.replace("\t", "-"))}</div>
    <div class="tipGrid">
      <div class="tipLine"><span>Raw weight</span><strong>${fmt(edge.rawWeight)}</strong></div>
      ${wiperWeightLine("WIPER1", edge.wiper1)}
      <div class="tipLine"><span>WIPER1 UFC</span><strong>${fmt(edge.wiper1 && edge.wiper1.ufc0)} -> ${fmt(edge.wiper1 && edge.wiper1.score)}</strong></div>
      ${wiperWeightLine("WIPER2", edge.wiper2)}
      <div class="tipLine"><span>WIPER2 UFC</span><strong>${fmt(edge.wiper2 && edge.wiper2.ufc0)} -> ${fmt(edge.wiper2 && edge.wiper2.score)}</strong></div>
      <div class="tipLine"><span>Path load</span><strong>${fmt(edge.wiper2 && edge.wiper2.pathLoad)}</strong></div>
    </div>`;
}

function nodeTooltip(node) {
  const incident = state.data.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .sort((a, b) => (edgeValue(b) || 0) - (edgeValue(a) || 0))
    .slice(0, 6);
  const rows = incident.map((edge) => {
    const w1 = edge.wiper1 ? `${fmt(edge.wiper1.w0)} -> ${fmt(edge.wiper1.weight)}` : "-";
    const w2 = edge.wiper2 ? `${fmt(edge.wiper2.w0)} -> ${fmt(edge.wiper2.weight)}` : "-";
    return `<tr><td>${escapeHtml(edge.id.replace("\t", "-"))}</td><td>${w1}</td><td>${w2}</td></tr>`;
  }).join("");
  return `
    <div class="tipTitle">${escapeHtml(node.id)}</div>
    <div class="tipGrid">
      <div class="tipLine"><span>WINNER UFC</span><strong>${fmt(node.winner0)} -> ${fmt(node.winner)}</strong></div>
      <div class="tipLine"><span>WINNER W</span><strong>${fmt(node.winnerInitialWeight)} -> ${fmt(node.winnerWeight)}</strong></div>
      <div class="tipLine"><span>Rank</span><strong>#${node.rank}</strong></div>
      <div class="tipLine"><span>Degree</span><strong>${node.degree}</strong></div>
    </div>
    <div class="tipSubhead">Incident edge W[0] -> W[n]</div>
    <table class="tipTable"><thead><tr><th>Edge</th><th>WIPER1</th><th>WIPER2</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function edgeScoreObject(edge, metric = state.metric) {
  if (metric === "wiper1") return edge.wiper1;
  if (metric === "wiper2") return edge.wiper2;
  return null;
}

function edgeValue(edge, metric = state.metric) {
  if (metric === "raw") return edge.rawWeight;
  const scores = edgeScoreObject(edge, metric);
  if (!scores) return null;
  return state.edgeMeasure === "weight" ? scores.weight : scores.score;
}

function edgeRank(edge, metric) {
  if (metric === "raw") return edge.rawRank;
  if (metric === "wiper1") return edge.wiper1 && edge.wiper1.rank;
  return edge.wiper2 && edge.wiper2.rank;
}

function nodeValue(node) {
  return state.nodeScale === "log" ? node.logWinner : node.winner;
}

function nodeSizeValue(node) {
  return node.winner;
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

function nodeRadiusBounds() {
  const minRadius = Math.max(1, Number(els.nodeMinRadius.value) || 7);
  if (state.nodeSizeMode === "absolute") {
    return [
      minRadius,
      Math.max(minRadius + 1, Number(els.nodeMaxRadius.value) || 28),
    ];
  }
  const fold = Math.max(1, Number(els.nodeRadiusFold.value) || 4);
  return [minRadius, minRadius * fold];
}

function nodeRadius(node, minScore, maxScore) {
  const [minRadius, maxRadius] = nodeRadiusBounds();
  const t = normalize(nodeSizeValue(node), minScore, maxScore);
  return minRadius + (maxRadius - minRadius) * t;
}

function renderSizeLegend(nodes, minScore, maxScore) {
  if (!els.sizeLegend) return;
  if (!nodes.length) {
    els.sizeLegend.textContent = "";
    return;
  }
  const [minRadius, maxRadius] = nodeRadiusBounds();
  const legendScale = Math.min(1, 24 / Math.max(1, maxRadius));
  const minLegendRadius = Math.max(2, minRadius * legendScale);
  const maxLegendRadius = Math.max(minLegendRadius + 1, maxRadius * legendScale);
  const mode = state.nodeSizeMode === "absolute"
    ? `${fmt(minRadius, 0)}-${fmt(maxRadius, 0)} px`
    : `${fmt(maxRadius / Math.max(1, minRadius), 1)}x radius`;
  els.sizeLegend.innerHTML = `
    <div class="legendTitle">Node size = final WINNER</div>
    <svg viewBox="0 0 180 58" aria-hidden="true">
      <circle cx="35" cy="31" r="${minLegendRadius}" class="legendNode"></circle>
      <circle cx="118" cy="31" r="${maxLegendRadius}" class="legendNode"></circle>
    </svg>
    <div class="legendLabels">
      <span>${fmt(minScore)}</span>
      <span>${fmt(maxScore)}</span>
    </div>
    <div class="legendMode">${mode}</div>`;
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

function edgeStrokeWidth(t) {
  return 1.2 + 9.5 * Math.max(0, Math.min(1, t));
}

function edgeLegendLabel() {
  if (state.metric === "raw") return "Edge width = raw weight";
  const measure = state.edgeMeasure === "weight" ? "final W" : "final UFC";
  return `Edge width = ${metricLabel()} ${measure}`;
}

function renderEdgeLegend(edges, minScore, maxScore) {
  if (!els.edgeLegend) return;
  if (!edges.length) {
    els.edgeLegend.textContent = "";
    return;
  }
  const values = [0, 0.5, 1].map((t) => minScore + (maxScore - minScore) * t);
  const scaleText = state.edgeScale === "log" ? "log2 scale" : "linear scale";
  els.edgeLegend.innerHTML = `
    <div class="legendTitle">${edgeLegendLabel()}</div>
    <svg viewBox="0 0 214 48" aria-hidden="true">
      ${[0, 0.5, 1].map((t, i) => `
        <line x1="${18 + i * 76}" y1="25" x2="${58 + i * 76}" y2="25"
          stroke="${colorFor(t)}" stroke-width="${edgeStrokeWidth(t)}" stroke-linecap="round"></line>
      `).join("")}
    </svg>
    <div class="legendLabels">
      <span>${fmt(values[0])}</span>
      <span>${fmt(values[1])}</span>
      <span>${fmt(values[2])}</span>
    </div>
    <div class="legendMode">${scaleText}</div>`;
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

function connectedComponents(nodes, edges) {
  const ids = nodes.map((node) => node.id);
  const adjacent = new Map(ids.map((id) => [id, []]));
  edges.forEach((edge) => {
    if (adjacent.has(edge.source) && adjacent.has(edge.target)) {
      adjacent.get(edge.source).push(edge.target);
      adjacent.get(edge.target).push(edge.source);
    }
  });
  const seen = new Set();
  const components = [];
  ids.forEach((id) => {
    if (seen.has(id)) return;
    const stack = [id];
    const component = [];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      adjacent.get(current).forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    components.push(component);
  });
  return components.sort((a, b) => b.length - a.length);
}

function seededJitter(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) - 0.5;
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

  const components = connectedComponents(nodes, edges);
  const componentCenters = new Map();
  const componentRing = Math.min(width, height) * 0.23;
  components.forEach((component, componentIndex) => {
    const angle = (2 * Math.PI * componentIndex) / Math.max(1, components.length);
    const cx = width / 2 + (components.length > 1 ? Math.cos(angle) * componentRing : 0);
    const cy = height / 2 + (components.length > 1 ? Math.sin(angle) * componentRing : 0);
    component.forEach((id) => componentCenters.set(id, { x: cx, y: cy }));
    component.forEach((id, idx) => {
      const nodeAngle = (2 * Math.PI * idx) / Math.max(1, component.length);
      const radius = 42 + 18 * Math.sqrt(component.length);
      state.positions.set(id, {
        x: cx + Math.cos(nodeAngle) * radius + seededJitter(`${id}:x`) * 24,
        y: cy + Math.sin(nodeAngle) * radius + seededJitter(`${id}:y`) * 24,
        dx: 0,
        dy: 0,
      });
    });
  });

  const area = width * height;
  const visibleNodeIds = nodes.map((node) => node.id);
  const ideal = Math.sqrt(area / Math.max(1, visibleNodeIds.length));
  let temperature = Math.min(width, height) * 0.24;
  for (let tick = 0; tick < 640; tick += 1) {
    visibleNodeIds.forEach((id) => {
      const p = state.positions.get(id);
      p.dx = 0;
      p.dy = 0;
    });
    for (let i = 0; i < visibleNodeIds.length; i += 1) {
      const a = state.positions.get(visibleNodeIds[i]);
      for (let j = i + 1; j < visibleNodeIds.length; j += 1) {
        const b = state.positions.get(visibleNodeIds[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = seededJitter(`${visibleNodeIds[i]}:${visibleNodeIds[j]}:x`);
          dy = seededJitter(`${visibleNodeIds[i]}:${visibleNodeIds[j]}:y`);
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }
        const force = (ideal * ideal) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.dx += fx;
        a.dy += fy;
        b.dx -= fx;
        b.dy -= fy;
      }
    }
    edges.forEach((edge) => {
      const a = state.positions.get(edge.source);
      const b = state.positions.get(edge.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const strength = 0.65 + 1.35 * Math.max(0.05, edge.rawWeight || 0.3);
      const force = ((dist * dist) / ideal) * strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.dx += fx;
      a.dy += fy;
      b.dx -= fx;
      b.dy -= fy;
    });
    visibleNodeIds.forEach((id) => {
      const p = state.positions.get(id);
      const center = componentCenters.get(id) || { x: width / 2, y: height / 2 };
      p.dx += (center.x - p.x) * 0.045;
      p.dy += (center.y - p.y) * 0.045;
      const disp = Math.max(0.01, Math.sqrt(p.dx * p.dx + p.dy * p.dy));
      p.x += (p.dx / disp) * Math.min(disp, temperature);
      p.y += (p.dy / disp) * Math.min(disp, temperature);
    });
    temperature *= 0.985;
  }

  const positions = visibleNodeIds.map((id) => state.positions.get(id));
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxY = Math.max(...positions.map((p) => p.y));
  const padding = 58;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY, 1.35);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  visibleNodeIds.forEach((id) => {
    const p = state.positions.get(id);
    p.x = p.x * scale + offsetX;
    p.y = p.y * scale + offsetY;
  });
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
  const [nodeSizeMin, nodeSizeMax] = range(nodes, nodeSizeValue);
  renderEdgeLegend(edges, edgeMin, edgeMax);
  renderSizeLegend(nodes, nodeSizeMin, nodeSizeMax);

  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewport.setAttribute("transform", `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  viewport.append(edgeLayer, nodeLayer);
  els.svg.append(viewport);

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
    line.setAttribute("stroke-width", String(edgeStrokeWidth(t)));
    line.setAttribute("class", `edge ${edge.id === state.selected ? "selected" : ""}`);
    line.addEventListener("mouseenter", (event) => showTooltip(event, edgeTooltip(edge)));
    line.addEventListener("mousemove", tooltipMove);
    line.addEventListener("mouseleave", hideTooltip);
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
    const radius = nodeRadius(node, nodeSizeMin, nodeSizeMax);
    const activeNode = selected && (selected.source === node.id || selected.target === node.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", activeNode ? radius + 3 : radius);
    circle.setAttribute("fill", colorFor(t));
    circle.setAttribute("class", `node ${activeNode ? "active" : ""}`);
    circle.addEventListener("mouseenter", (event) => showTooltip(event, nodeTooltip(node)));
    circle.addEventListener("mousemove", tooltipMove);
    circle.addEventListener("mouseleave", hideTooltip);
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

function svgPointFromEvent(event) {
  const rect = els.svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 900,
    y: ((event.clientY - rect.top) / rect.height) * 620,
  };
}

function resetZoom() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  drawNetwork();
}

function setupNetworkZoom() {
  els.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = svgPointFromEvent(event);
    const previous = state.zoom;
    const next = clamp(previous * (event.deltaY < 0 ? 1.12 : 0.88), 0.35, 5);
    const worldX = (point.x - state.panX) / previous;
    const worldY = (point.y - state.panY) / previous;
    state.zoom = next;
    state.panX = point.x - worldX * next;
    state.panY = point.y - worldY * next;
    drawNetwork();
  }, { passive: false });

  let panStart = null;
  els.svg.addEventListener("pointerdown", (event) => {
    if (event.target !== els.svg) return;
    const point = svgPointFromEvent(event);
    panStart = { x: point.x, y: point.y, panX: state.panX, panY: state.panY };
    els.svg.setPointerCapture(event.pointerId);
    els.svg.classList.add("panning");
  });
  els.svg.addEventListener("pointermove", (event) => {
    if (!panStart) return;
    const point = svgPointFromEvent(event);
    state.panX = panStart.panX + point.x - panStart.x;
    state.panY = panStart.panY + point.y - panStart.y;
    drawNetwork();
  });
  const endPan = () => {
    panStart = null;
    els.svg.classList.remove("panning");
  };
  els.svg.addEventListener("pointerup", endPan);
  els.svg.addEventListener("pointercancel", endPan);
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

function renderNodesTable() {
  if (!state.data || !els.nodeRows) return;
  const nodeIds = activeNodeIds();
  const needle = els.filter.value.trim().toLowerCase();
  const nodes = [...state.data.nodes]
    .filter((node) => !needle || node.id.toLowerCase().includes(needle))
    .sort((a, b) => Number(nodeValue(b)) - Number(nodeValue(a)));
  els.nodeRows.replaceChildren();
  nodes.forEach((node) => {
    const row = document.createElement("tr");
    row.className = nodeIds.has(node.id) ? "" : "mutedRow";
    row.innerHTML = `
      <td><strong>${escapeHtml(node.id)}</strong><br>${nodeIds.has(node.id) ? '<span class="badge">shown</span>' : '<span class="rank">hidden</span>'}</td>
      <td>${fmt(node.winner0)} -> ${fmt(node.winner)}</td>
      <td>${fmt(node.winnerInitialWeight)} -> ${fmt(node.winnerWeight)}</td>
      <td>${node.degree}</td>
      <td>#${node.rank}</td>`;
    els.nodeRows.appendChild(row);
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
    ["WIPER1 UFC", fmt(edge.wiper1 && edge.wiper1.score)],
    ["WIPER1 W", fmt(edge.wiper1 && edge.wiper1.weight)],
    ["WIPER2 UFC", fmt(edge.wiper2 && edge.wiper2.score)],
    ["WIPER2 W", fmt(edge.wiper2 && edge.wiper2.weight)],
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
  if (els.viewSummary) {
    els.viewSummary.textContent = `${metricLabel()} ${state.metric === "raw" ? "raw" : state.edgeMeasure.toUpperCase()} view, ${state.edgeScale} edge scale`;
  }
  drawNetwork();
  renderTable();
  renderNodesTable();
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
  const response = await fetch(apiUrl("/api/analyze"), {
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

function generatorSettings() {
  const nodeCount = Math.max(3, Math.min(80, Math.round(Number(els.generatorNodeCount.value) || 12)));
  const maxEdges = (nodeCount * (nodeCount - 1)) / 2;
  const edgeCount = Math.max(nodeCount - 1, Math.min(maxEdges, Math.round(Number(els.generatorEdgeCount.value) || 18)));
  let minWeight = Math.max(0, Math.min(1, Number(els.generatorMinWeight.value) || 0));
  let maxWeight = Math.max(0, Math.min(1, Number(els.generatorMaxWeight.value) || 1));
  if (minWeight > maxWeight) [minWeight, maxWeight] = [maxWeight, minWeight];
  els.generatorNodeCount.value = nodeCount;
  els.generatorEdgeCount.value = edgeCount;
  els.generatorMinWeight.value = minWeight.toFixed(2);
  els.generatorMaxWeight.value = maxWeight.toFixed(2);
  return { nodeCount, edgeCount, minWeight, maxWeight };
}

function randomWeight(minWeight, maxWeight) {
  return minWeight + Math.random() * (maxWeight - minWeight);
}

function makeGeneratedEdges(settings) {
  const nodes = Array.from({ length: settings.nodeCount }, (_, i) => `N${i + 1}`);
  const edges = [];
  const keys = new Set();
  const degrees = new Map(nodes.map((node) => [node, 0]));
  const add = (a, b, weight) => {
    if (a === b) return false;
    const key = [a, b].sort().join("\t");
    if (keys.has(key)) return false;
    keys.add(key);
    degrees.set(a, (degrees.get(a) || 0) + 1);
    degrees.set(b, (degrees.get(b) || 0) + 1);
    edges.push([a, b, Math.max(0, Math.min(1, weight))]);
    return true;
  };
  const randomPair = () => {
    const a = nodes[Math.floor(Math.random() * nodes.length)];
    let b = nodes[Math.floor(Math.random() * nodes.length)];
    while (b === a) b = nodes[Math.floor(Math.random() * nodes.length)];
    return [a, b];
  };
  const weightedPick = (candidates, avoid = new Set()) => {
    const pool = candidates.filter((node) => !avoid.has(node));
    const total = pool.reduce((sum, node) => sum + (degrees.get(node) || 0) + 1, 0);
    let draw = Math.random() * total;
    for (const node of pool) {
      draw -= (degrees.get(node) || 0) + 1;
      if (draw <= 0) return node;
    }
    return pool[pool.length - 1];
  };

  if (state.generatorModel === "scale-free") {
    add(nodes[0], nodes[1], randomWeight(settings.minWeight, settings.maxWeight));
    for (let i = 2; i < nodes.length && edges.length < settings.edgeCount; i += 1) {
      const existing = nodes.slice(0, i);
      const first = weightedPick(existing);
      add(nodes[i], first, randomWeight(settings.minWeight, settings.maxWeight));
      if (edges.length < settings.edgeCount && Math.random() < 0.35) {
        const second = weightedPick(existing, new Set([first]));
        if (second) add(nodes[i], second, randomWeight(settings.minWeight, settings.maxWeight));
      }
    }
    let attempts = 0;
    while (edges.length < settings.edgeCount && attempts < settings.edgeCount * 80) {
      const a = weightedPick(nodes);
      const b = weightedPick(nodes, new Set([a]));
      add(a, b, randomWeight(settings.minWeight, settings.maxWeight));
      attempts += 1;
    }
  } else {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const high = 0.65 + Math.random() * 0.35;
      add(nodes[i], nodes[i + 1], settings.minWeight + (settings.maxWeight - settings.minWeight) * high);
    }
    let attempts = 0;
    while (edges.length < settings.edgeCount && attempts < settings.edgeCount * 80) {
      const [a, b] = randomPair();
      add(a, b, randomWeight(settings.minWeight, settings.maxWeight));
      attempts += 1;
    }
  }
  return edges;
}

function makeRandom() {
  const edges = makeGeneratedEdges(generatorSettings());
  els.edgeText.value = ["node1\tnode2\tweight", ...edges.map((e) => `${e[0]}\t${e[1]}\t${e[2].toFixed(3)}`)].join("\n");
  analyze();
}

function makeGeneterrain() {
  setSegment("generatorModelSegments", "generatorModel", "scale-free", "data-generator");
  els.generatorNodeCount.value = 24;
  els.generatorEdgeCount.value = 44;
  els.generatorMinWeight.value = "0.08";
  els.generatorMaxWeight.value = "0.98";
  const edges = makeGeneratedEdges(generatorSettings());
  const boosted = edges.map(([a, b, w]) => {
    const ai = Number(a.slice(1));
    const bi = Number(b.slice(1));
    const sameNeighborhood = Math.floor((ai - 1) / 6) === Math.floor((bi - 1) / 6);
    return [a, b, Math.min(0.99, sameNeighborhood ? w + 0.18 : w)];
  });
  els.edgeText.value = ["node1\tnode2\tweight", ...boosted.map((e) => `${e[0]}\t${e[1]}\t${e[2].toFixed(3)}`)].join("\n");
  analyze();
}

function rowsToTsv(rows) {
  return rows.map((row) => row.map((value) => value === null || value === undefined ? "" : String(value)).join("\t")).join("\n");
}

function downloadText(filename, text, type = "text/tab-separated-values;charset=utf-8") {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function edgeExportRows() {
  if (!state.data) return;
  const rows = [[
    "nodeA", "nodeB", "rawWeight", "rawRank", "wiper1UFC", "wiper1W", "wiper1Rank",
    "wiper2UFC", "wiper2W", "wiper2Rank", "pathLoad", "shown",
  ]];
  const shown = activeEdgeIds();
  state.data.edges.forEach((edge) => rows.push([
    edge.source,
    edge.target,
    edge.rawWeight,
    edge.rawRank,
    edge.wiper1 && edge.wiper1.score,
    edge.wiper1 && edge.wiper1.weight,
    edge.wiper1 && edge.wiper1.rank,
    edge.wiper2 && edge.wiper2.score,
    edge.wiper2 && edge.wiper2.weight,
    edge.wiper2 && edge.wiper2.rank,
    edge.wiper2 && edge.wiper2.pathLoad,
    shown.has(edge.id) ? "Yes" : "No",
  ]));
  return rows;
}

function nodeExportRows() {
  if (!state.data) return;
  const shown = activeNodeIds();
  const rows = [["node", "winner0UFC", "winnerUFC", "winner0W", "winnerW", "degree", "rank", "shown"]];
  state.data.nodes.forEach((node) => rows.push([
    node.id,
    node.winner0,
    node.winner,
    node.winnerInitialWeight,
    node.winnerWeight,
    node.degree,
    node.rank,
    shown.has(node.id) ? "Yes" : "No",
  ]));
  return rows;
}

function shownNetworkRows() {
  if (!state.data) return;
  const shown = activeEdgeIds();
  const rows = [["node1", "node2", "weight", "score"]];
  state.data.edges
    .filter((edge) => shown.has(edge.id))
    .forEach((edge) => rows.push([edge.source, edge.target, edge.rawWeight, edgeValue(edge)]));
  return rows;
}

function exportEdges() {
  downloadText("spinner_edge_scores.tsv", rowsToTsv(edgeExportRows()));
}

function exportNodes() {
  downloadText("spinner_node_scores.tsv", rowsToTsv(nodeExportRows()));
}

function exportShownNetwork() {
  downloadText("spinner_backbone_network.tsv", rowsToTsv(shownNetworkRows()));
}

function htmlTable(rows) {
  return `<table>${rows.map((row, i) => `<tr>${row.map((cell) => `<${i === 0 ? "th" : "td"}>${escapeHtml(cell === null || cell === undefined ? "" : cell)}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`;
}

function methodSummary() {
  const s = state.data && state.data.summary;
  const edgeIds = activeEdgeIds();
  const nodeIds = activeNodeIds();
  return [
    "network SPINNER ranks protein interaction network edges using WIPER1 and WIPER2 edge scoring with WINNER-style node scoring.",
    `Current view: ${metricLabel()} edge score, ${state.edgeMeasure.toUpperCase()} measure, ${state.edgeScale} scale.`,
    s ? `The analyzed network contains ${s.nodeCount} nodes and ${s.inputEdgeCount} input edges; ${nodeIds.size} nodes and ${edgeIds.size} edges are visible after filtering.` : "",
  ].filter(Boolean).join(" ");
}

function exportExcel() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>SPINNER results</title></head><body>
    <h1>SPINNER results</h1>
    <h2>Edges</h2>${htmlTable(edgeExportRows())}
    <h2>Nodes</h2>${htmlTable(nodeExportRows())}
    <h2>Shown network</h2>${htmlTable(shownNetworkRows())}
  </body></html>`;
  downloadText("spinner_results.xls", html, "application/vnd.ms-excel;charset=utf-8");
}

function exportMarkdown() {
  const topEdges = edgeExportRows().slice(0, 11);
  const table = topEdges.map((row) => `| ${row.map((cell) => String(cell ?? "").replaceAll("|", "\\|")).join(" | ")} |`);
  table.splice(1, 0, `| ${topEdges[0].map(() => "---").join(" | ")} |`);
  const text = `# SPINNER Results\n\n## Method\n\n${methodSummary()}\n\n## Top Edges\n\n${table.join("\n")}\n`;
  downloadText("spinner_report.md", text, "text/markdown;charset=utf-8");
}

function exportWord() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>SPINNER method and results</title></head><body>
    <h1>SPINNER Method and Results</h1>
    <h2>Method</h2><p>${escapeHtml(methodSummary())}</p>
    <h2>Edge Results</h2>${htmlTable(edgeExportRows().slice(0, 26))}
    <h2>Node Results</h2>${htmlTable(nodeExportRows().slice(0, 26))}
  </body></html>`;
  downloadText("spinner_method_results.doc", html, "application/msword;charset=utf-8");
}

function exportFigure() {
  const clone = els.svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.insertAdjacentHTML("afterbegin", `<style>
    .edge{stroke-linecap:round}.node{stroke:#334155;stroke-width:2}.node.active{stroke:#b45309;stroke-width:3}
    .nodeLabel{font:700 12px sans-serif;fill:#1f2937;paint-order:stroke;stroke:#fff;stroke-width:4px}
  </style>`);
  downloadText("spinner_network_figure.svg", new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8");
}

function addChatMessage(role, text) {
  if (!els.chatLog) return;
  const div = document.createElement("div");
  div.className = `chatMessage ${role}`;
  div.textContent = text;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function setSegment(id, stateKey, value, dataKey) {
  const buttons = document.querySelectorAll(`#${id} button`);
  buttons.forEach((button) => {
    const active = button.getAttribute(dataKey) === value;
    button.classList.toggle("active", active);
    if (active) state[stateKey] = value;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setCssPxVar(name, value) {
  document.documentElement.style.setProperty(name, `${Math.round(value)}px`);
}

function setupDrag(handle, onMove) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    handle.classList.add("dragging");
    document.body.classList.add("isResizing");
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
    };
    const end = () => {
      handle.classList.remove("dragging");
      document.body.classList.remove("isResizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}

function setupResizablePanels() {
  let sidebarStart = 318;
  let agentStart = 292;
  let resultsStart = 260;
  setupDrag(els.leftResize, (dx) => {
    if (state.sidebarCollapsed) {
      state.sidebarCollapsed = false;
      document.body.classList.remove("sidebarCollapsed");
      els.sidebarToggle.textContent = "Input";
      sidebarStart = 260;
    }
    setCssPxVar("--sidebar-width", clamp(sidebarStart + dx, 180, 520));
  });
  els.leftResize && els.leftResize.addEventListener("pointerdown", () => {
    sidebarStart = state.sidebarCollapsed ? 46 : els.leftPane.getBoundingClientRect().width;
  });

  setupDrag(els.agentResize, (dx) => {
    setCssPxVar("--agent-width", clamp(agentStart - dx, 220, 560));
  });
  els.agentResize && els.agentResize.addEventListener("pointerdown", () => {
    agentStart = els.agentPanel.getBoundingClientRect().width;
  });

  setupDrag(els.resultsResize, (_dx, dy) => {
    const maxHeight = Math.max(180, window.innerHeight - 240);
    setCssPxVar("--results-height", clamp(resultsStart - dy, 170, maxHeight));
  });
  els.resultsResize && els.resultsResize.addEventListener("pointerdown", () => {
    resultsStart = els.resultsPanel.getBoundingClientRect().height;
  });

  els.sidebarToggle.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    document.body.classList.toggle("sidebarCollapsed", state.sidebarCollapsed);
    els.sidebarToggle.textContent = state.sidebarCollapsed ? "Input" : "Input";
    if (!state.sidebarCollapsed) {
      setCssPxVar("--sidebar-width", Math.max(240, Number.parseFloat(getComputedStyle(els.leftPane).width) || 318));
    }
    state.layoutSignature = "";
    render();
  });
}

function applyChatInstruction() {
  const text = (els.chatInput.value || "").trim();
  if (!text) return;
  addChatMessage("user", text);
  const lower = text.toLowerCase();
  const notes = [];

  const topMatch = lower.match(/top\s+(\d+)/);
  const percentMatch = lower.match(/(\d+)\s*%/);
  const thresholdMatch = lower.match(/(?:threshold|min|score)\s+([0-9.]+)/);
  const nodesMatch = lower.match(/(\d+)\s+nodes?/);
  const edgesMatch = lower.match(/(\d+)\s+edges?/);
  const iterationsMatch = lower.match(/(\d+)\s+iterations?/);

  if (lower.includes("wiper2")) {
    setSegment("metricSegments", "metric", "wiper2", "data-metric");
    notes.push("using WIPER2");
  } else if (lower.includes("wiper1")) {
    setSegment("metricSegments", "metric", "wiper1", "data-metric");
    notes.push("using WIPER1");
  } else if (lower.includes("raw")) {
    setSegment("metricSegments", "metric", "raw", "data-metric");
    notes.push("using raw weights");
  }
  if (lower.includes(" log")) {
    setSegment("edgeScaleSegments", "edgeScale", "log", "data-scale");
    notes.push("edge scale set to log");
  } else if (lower.includes("normal") || lower.includes("linear")) {
    setSegment("edgeScaleSegments", "edgeScale", "normal", "data-scale");
    notes.push("edge scale set to normal");
  }
  if (lower.includes(" ufc")) {
    setSegment("edgeMeasureSegments", "edgeMeasure", "ufc", "data-measure");
    notes.push("edge measure set to UFC");
  } else if (lower.includes(" final w") || lower.includes(" weight")) {
    setSegment("edgeMeasureSegments", "edgeMeasure", "weight", "data-measure");
    notes.push("edge measure set to W");
  }
  if (topMatch) {
    setSegment("edgeFilterSegments", "edgeFilter", "topn", "data-mode");
    els.edgeTopN.value = topMatch[1];
    notes.push(`showing top ${topMatch[1]} edges`);
  } else if (percentMatch) {
    setSegment("edgeFilterSegments", "edgeFilter", "percent", "data-mode");
    els.edgeTopPercent.value = percentMatch[1];
    notes.push(`showing top ${percentMatch[1]}% edges`);
  } else if (thresholdMatch) {
    setSegment("edgeFilterSegments", "edgeFilter", "threshold", "data-mode");
    els.edgeThreshold.value = thresholdMatch[1];
    notes.push(`edge threshold set to ${thresholdMatch[1]}`);
  }
  if (lower.includes("include novel")) {
    els.includeNovel.checked = true;
    notes.push("WIPER1 novel edges enabled");
  }
  if (lower.includes("scale-free") || lower.includes("scale free")) {
    setSegment("generatorModelSegments", "generatorModel", "scale-free", "data-generator");
    notes.push("generator set to scale-free");
  } else if (lower.includes("random")) {
    setSegment("generatorModelSegments", "generatorModel", "random", "data-generator");
    notes.push("generator set to random");
  }
  if (nodesMatch) {
    els.generatorNodeCount.value = nodesMatch[1];
    notes.push(`${nodesMatch[1]} generator nodes`);
  }
  if (edgesMatch) {
    els.generatorEdgeCount.value = edgesMatch[1];
    notes.push(`${edgesMatch[1]} generator edges`);
  }
  if (iterationsMatch) {
    els.iterations.value = iterationsMatch[1];
    notes.push(`${iterationsMatch[1]} iterations`);
  }
  if (lower.includes("geneterrain")) {
    makeGeneterrain();
    addChatMessage("agent", "Generated a Geneterrain-style seeded neighborhood and rescored it.");
  } else if (lower.includes("generate")) {
    makeRandom();
    addChatMessage("agent", `Generated and rescored a ${state.generatorModel} network.`);
  } else if (lower.includes("analyze") || lower.includes("rescore") || lower.includes("novel")) {
    analyze();
    addChatMessage("agent", notes.length ? `Applied: ${notes.join("; ")}. Rescored network.` : "Rescored the current network.");
  } else {
    state.layoutSignature = "";
    render();
    addChatMessage("agent", notes.length ? `Applied: ${notes.join("; ")}.` : "I can adjust scoring, filters, generator size, scale, and analysis settings from short commands.");
  }
  els.chatInput.value = "";
}

function bindSegments(id, stateKey, dataKey) {
  document.getElementById(id).addEventListener("click", (event) => {
    const button = event.target.closest(`button[${dataKey}]`);
    if (!button) return;
    setSegment(id, stateKey, button.getAttribute(dataKey), dataKey);
    state.layoutSignature = "";
    render();
  });
}

bindSegments("metricSegments", "metric", "data-metric");
bindSegments("edgeMeasureSegments", "edgeMeasure", "data-measure");
bindSegments("edgeScaleSegments", "edgeScale", "data-scale");
bindSegments("nodeScaleSegments", "nodeScale", "data-scale");
bindSegments("nodeSizeModeSegments", "nodeSizeMode", "data-size-mode");
bindSegments("generatorModelSegments", "generatorModel", "data-generator");
bindSegments("edgeFilterSegments", "edgeFilter", "data-mode");
bindSegments("nodeFilterSegments", "nodeFilter", "data-mode");
setupResizablePanels();
setupNetworkZoom();

document.getElementById("resultTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (!button) return;
  state.resultTab = button.getAttribute("data-tab");
  document.querySelectorAll("#resultTabs button").forEach((b) => b.classList.toggle("active", b === button));
  document.querySelectorAll(".tabPanel").forEach((panel) => panel.classList.toggle("active", panel.id === `${state.resultTab}Tab`));
});

els.analyze.addEventListener("click", analyze);
els.sample.addEventListener("click", () => {
  els.edgeText.value = sampleNetwork;
  analyze();
});
els.random.addEventListener("click", makeRandom);
els.geneterrain.addEventListener("click", makeGeneterrain);
els.zoomReset.addEventListener("click", resetZoom);
els.networkSettingsBtn.addEventListener("click", () => {
  els.networkSettings.hidden = !els.networkSettings.hidden;
});
els.networkSettingsClose.addEventListener("click", () => {
  els.networkSettings.hidden = true;
});
els.filter.addEventListener("input", () => {
  renderTable();
  renderNodesTable();
});
els.chatApply.addEventListener("click", applyChatInstruction);
els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    applyChatInstruction();
  }
});
els.exportEdges.addEventListener("click", exportEdges);
els.exportNodes.addEventListener("click", exportNodes);
els.exportShown.addEventListener("click", exportShownNetwork);
els.exportExcel.addEventListener("click", exportExcel);
els.exportMarkdown.addEventListener("click", exportMarkdown);
els.exportWord.addEventListener("click", exportWord);
els.exportFigure.addEventListener("click", exportFigure);
[
  els.edgeTopN,
  els.edgeTopPercent,
  els.edgeThreshold,
  els.nodeTopN,
  els.nodeTopPercent,
  els.nodeThreshold,
  els.nodeMinRadius,
  els.nodeMaxRadius,
  els.nodeRadiusFold,
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
addChatMessage("agent", "Tell me how to shape the network: choose WIPER1 or WIPER2, show top N edges, generate a scale-free graph, or run Geneterrain.");
analyze();
