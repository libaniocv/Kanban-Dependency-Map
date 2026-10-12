const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const script = fs.readFileSync(path.join(__dirname, '../src/layout.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(`${script}\nthis.exports = {visibleGraph, buildLayout, edgePath, ancestorsAndDescendants};`, ctx);
const { visibleGraph, buildLayout, edgePath, ancestorsAndDescendants } = ctx.exports;
const data = {
  nodes: [
    { id: 'a', title: 'Setup', status: 'done', assignee: 'planner', tenant: 'proj' },
    { id: 'b', title: 'API', status: 'running', assignee: 'backend', tenant: 'proj' },
    { id: 'c', title: 'Frontend', status: 'ready', assignee: 'frontend', tenant: 'proj' },
    { id: 'd', title: 'Tests', status: 'todo', assignee: 'qa', tenant: 'proj' },
    { id: 'e', title: 'Archive', status: 'archived', assignee: null, tenant: 'other' },
  ],
  edges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' },
    { source: 'b', target: 'd' }, { source: 'c', target: 'd' }],
};
const filters = { showArchived: false, query: '', status: '', assignee: '', tenant: '', focusId: '', scope: 'all' };
test('excludes archived nodes by default, retaining every remaining dependency', () => {
  const g = visibleGraph(data, filters);
  assert.equal(g.nodes.length, 4);
  assert.equal(g.edges.length, 4);
});
test('DAG placement always puts dependencies before their dependents', () => {
  const g = buildLayout(visibleGraph(data, filters), 'LR');
  const byId = Object.fromEntries(g.nodes.map((node) => [node.id, node]));
  for (const e of g.edges) assert.ok(byId[e.source].x < byId[e.target].x);
  assert.equal(g.hasCycle, false);
  assert.ok(g.width > 0 && g.height > 0);
  assert.match(edgePath(g.edges[0], true), /^M /);
});
test('top-to-bottom layout and same-level parallel tasks', () => {
  const g = buildLayout(visibleGraph(data, filters), 'TB');
  const byId = Object.fromEntries(g.nodes.map((node) => [node.id, node]));
  assert.equal(byId.b.y, byId.c.y);
  assert.ok(byId.a.y < byId.b.y && byId.d.y > byId.c.y);
  assert.match(edgePath(g.edges[0], false), /^M /);
});
test('search filters nodes and keeps edges with both endpoints only', () => {
  assert.deepEqual(Array.from(visibleGraph(data, { ...filters, query: 'API' }).nodes.map((n) => n.id)), ['b']);
  assert.equal(visibleGraph(data, { ...filters, query: 'API' }).edges.length, 0);
});
test('connected neighborhood with one-hop and transitive scope', () => {
  const direct = visibleGraph(data, { ...filters, focusId: 'a', scope: 'direct' });
  assert.deepEqual(direct.nodes.map((n) => n.id).sort(), ['a', 'b', 'c']);
  const chain = visibleGraph(data, { ...filters, focusId: 'b', scope: 'chain' });
  assert.equal(chain.nodes.length, 4);
  const r = ancestorsAndDescendants(data, 'b');
  assert.deepEqual(Array.from(r.ancestors), ['a']);
  assert.deepEqual(Array.from(r.descendants), ['d']);
});
test('duplicate links do not create duplicate paths and cycles do not hang', () => {
  const g = buildLayout({ nodes: data.nodes.slice(0, 3), edges: [
    { source: 'a', target: 'b' }, { source: 'a', target: 'b' },
    { source: 'b', target: 'c' }, { source: 'c', target: 'a' },
  ] }, 'LR');
  assert.equal(g.edges.length, 3);
  assert.equal(g.hasCycle, true);
});
test('handles an empty board gracefully', () => {
  const g = buildLayout({ nodes: [], edges: [] }, 'LR');
  assert.equal(g.nodes.length, 0);
  assert.ok(g.width >= 0);
});
