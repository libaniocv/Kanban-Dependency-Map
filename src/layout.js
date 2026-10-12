// Pure, dependency-free graph model and layered DAG layout.
// src/layout.js is concatenated before src/plugin.js by scripts/build.mjs.
const CARD_W = 242;
const CARD_H = 84;
const GAP_X = 98;
const GAP_Y = 32;
const PAD = 56;

function textMatches(node, query) {
  const q = (query || "").toLocaleLowerCase().trim();
  return !q || [node.id, node.title, node.assignee, node.tenant]
    .some((v) => String(v || "").toLocaleLowerCase().includes(q));
}

function visibleGraph(data, filters) {
  const nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data && data.edges) ? data.edges : [];
  const clean = nodes.filter((n) => n && typeof n.id === "string");
  const byId = new Map(clean.map((n) => [n.id, n]));
  let allowed = new Set(clean.filter((n) =>
    (filters.showArchived || n.status !== "archived") &&
    (!filters.status || n.status === filters.status) &&
    (!filters.assignee || (n.assignee || "") === filters.assignee) &&
    (!filters.tenant || (n.tenant || "") === filters.tenant) &&
    textMatches(n, filters.query)
  ).map((n) => n.id));
  if (filters.focusId && byId.has(filters.focusId) && filters.scope !== "all") {
    const adjacency = new Map(clean.map((n) => [n.id, new Set()]));
    for (const edge of edges) {
      if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
      adjacency.get(edge.source).add(edge.target);
      adjacency.get(edge.target).add(edge.source);
    }
    const visited = new Set([filters.focusId]);
    let frontier = [filters.focusId];
    const depth = filters.scope === "direct" ? 1 : Infinity;
    let hop = 0;
    while (frontier.length && hop < depth) {
      const next = [];
      for (const id of frontier) for (const other of adjacency.get(id) || []) {
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
      frontier = next;
      hop++;
    }
    allowed = new Set([...allowed].filter((id) => visited.has(id)));
    // Keep the selected task even when a currently selected filter excludes it.
    if (!filters.query && !filters.status && !filters.assignee && !filters.tenant &&
        (filters.showArchived || byId.get(filters.focusId).status !== "archived")) {
      allowed.add(filters.focusId);
    }
  }
  return {
    nodes: clean.filter((node) => allowed.has(node.id)),
    edges: edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target)),
  };
}

function buildLayout(graph, direction) {
  const horizontal = direction !== "TB";
  const ids = graph.nodes.map((n) => n.id).sort();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parents = new Map(ids.map((id) => [id, []]));
  const children = new Map(ids.map((id) => [id, []]));
  const dedupe = new Set();
  for (const edge of graph.edges) {
    if (!parents.has(edge.target) || !children.has(edge.source) || edge.target === edge.source) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    parents.get(edge.target).push(edge.source);
    children.get(edge.source).push(edge.target);
  }
  // Topological layering: a dependent is always in a later rank than its parents.
  const degree = new Map(ids.map((id) => [id, parents.get(id).length]));
  const rank = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => degree.get(id) === 0);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const child of children.get(id)) {
      rank.set(child, Math.max(rank.get(child), rank.get(id) + 1));
      degree.set(child, degree.get(child) - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  const hasCycle = head !== ids.length;
  // Corrupt/inconsistent cyclic graphs are still rendered deterministically.
  if (hasCycle) for (const id of ids) if (degree.get(id) > 0) rank.set(id, 0);
  const levels = new Map();
  for (const id of ids) {
    const level = rank.get(id);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(id);
  }
  const positions = new Map();
  const levelKeys = [...levels.keys()].sort((a, b) => a - b);
  for (const level of levelKeys) {
    const entries = levels.get(level);
    // Stable barycenter ordering to reduce edge crossings.
    entries.sort((a, b) => {
      const center = (id) => {
        const prev = parents.get(id).filter((p) => positions.has(p));
        if (!prev.length) return Infinity;
        return prev.reduce((sum, p) => sum + positions.get(p).order, 0) / prev.length;
      };
      const diff = center(a) - center(b);
      return Number.isNaN(diff) ? a.localeCompare(b) : (diff || a.localeCompare(b));
    });
    entries.forEach((id, index) => {
      const cross = PAD + index * (CARD_H + GAP_Y);
      const along = PAD + level * (CARD_W + GAP_X);
      positions.set(id, {
        id, order: index, rank: level,
        x: horizontal ? along : cross,
        y: horizontal ? cross : along,
      });
    });
  }
  const maxLayer = Math.max(0, ...levelKeys);
  const maxCross = Math.max(1, ...[...levels.values()].map((v) => v.length));
  const width = horizontal
    ? PAD * 2 + (maxLayer + 1) * CARD_W + maxLayer * GAP_X
    : PAD * 2 + maxCross * CARD_W + (maxCross - 1) * GAP_X;
  const height = horizontal
    ? PAD * 2 + maxCross * CARD_H + (maxCross - 1) * GAP_Y
    : PAD * 2 + (maxLayer + 1) * CARD_H + maxLayer * GAP_Y;
  return {
    width, height, horizontal, hasCycle,
    nodes: ids.map((id) => ({ ...byId.get(id), ...positions.get(id) })),
    edges: [...dedupe].map((key) => {
      const [source, target] = JSON.parse(key);
      return { source, target, from: positions.get(source), to: positions.get(target) };
    }).filter((e) => e.from && e.to),
  };
}

function edgePath(e, horizontal) {
  if (horizontal) {
    const x1 = e.from.x + CARD_W, y1 = e.from.y + CARD_H / 2;
    const x2 = e.to.x, y2 = e.to.y + CARD_H / 2;
    const bend = Math.max(28, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  const x1 = e.from.x + CARD_W / 2, y1 = e.from.y + CARD_H;
  const x2 = e.to.x + CARD_W / 2, y2 = e.to.y;
  const bend = Math.max(25, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

function ancestorsAndDescendants(graph, id) {
  const parents = new Map(), children = new Map();
  for (const edge of graph.edges) {
    if (!parents.has(edge.target)) parents.set(edge.target, []);
    if (!children.has(edge.source)) children.set(edge.source, []);
    parents.get(edge.target).push(edge.source);
    children.get(edge.source).push(edge.target);
  }
  const walk = (adj) => {
    const found = new Set(), queue = [id];
    for (let i = 0; i < queue.length; i++) for (const other of adj.get(queue[i]) || []) {
      if (other === id || found.has(other)) continue;
      found.add(other); queue.push(other);
    }
    return found;
  };
  return { ancestors: walk(parents), descendants: walk(children) };
}
