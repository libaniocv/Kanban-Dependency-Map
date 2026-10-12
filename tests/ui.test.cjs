const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../dashboard/dist/index.js'), 'utf8');
function renderWithFakeReact() {
  const registered = {};
  const h = (tag, props, ...children) => ({ tag: tag.name || tag, props, children });
  const React = {
    createElement: h, Fragment: 'fragment',
    useState: (val) => [val, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (val) => ({ current: val }),
  };
  const context = { window: {
    __HERMES_PLUGIN_SDK__: { React, fetchJSON: async () => ({}) },
    __HERMES_PLUGINS__: { register: (name, component) => { registered[name] = component; } },
  }, Date, Map, Set, Math, Intl };
  vm.runInNewContext(code, context);
  const page = registered['kanban-dependency-map'];
  return { registered, tree: page() };
}
const flatten = (root, all=[]) => {
  if (!root || typeof root !== 'object') return all;
  if ('tag' in root) { all.push(root); for (const kid of root.children) {
    if (Array.isArray(kid)) kid.forEach(c => flatten(c, all)); else flatten(kid, all);
  }}
  return all;
};
test('bundle registers web SDK page and renders normal control/graph shell without external libraries', () => {
  const { registered, tree } = renderWithFakeReact();
  assert.equal(typeof registered['kanban-dependency-map'], 'function');
  const elements = flatten(tree);
  assert.ok(elements.some(e => e.props?.className === 'kdm-map-viewport'));
  assert.ok(elements.some(e => e.props?.className === 'kdm-inspector'));
  assert.ok(elements.some(e => e.tag === 'svg'));
  assert.ok(elements.some(e => e.tag === 'select'));
});
