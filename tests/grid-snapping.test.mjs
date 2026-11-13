import {test} from "node:test";
import assert from "node:assert/strict";
import {installLayerSnapping, registerGridSnapping, snapPoint, withSnapPolicy} from "../scripts/grid-snapping.mjs";

const modes = {CENTER: 1, VERTEX: 2, CORNER: 4, SIDE_MIDPOINT: 8};
const point = {x: 73, y: 126};
const grid = {isSquare: true, isGridless: false, getSnappedPoint: (position, options) => {
  assert.deepEqual(options, {mode: 15, resolution: 1});
  return {x: Math.round(position.x / 50) * 50, y: Math.round(position.y / 50) * 50};
}};

test("square point snapping includes centers, corners and edge midpoints", () => {
  assert.deepEqual(snapPoint(point, {grid, modes, enabled: true}), {x: 50, y: 150});
});

test("disabled, Shift and gridless snapping preserve the point", () => {
  for (const options of [{enabled: false}, {enabled: true, shiftKey: true},
    {enabled: true, grid: {...grid, isGridless: true}}]) {
    assert.deepEqual(snapPoint(point, {grid, modes, ...options}), point);
  }
});

test("hex grids retain native layer snapping", () => {
  const native = position => ({x: position.x + 1, y: position.y + 2});
  assert.deepEqual(snapPoint(point, {grid: {...grid, isSquare: false}, modes, enabled: true, native}), {x: 74, y: 128});
});

test("layer wrappers share enabled state and retain native token snapping", () => {
  let enabled = true;
  let shift = false;
  globalThis.game = {settings: {get: () => enabled}, keyboard: {isModifierActive: () => shift}};
  globalThis.canvas = {grid};
  globalThis.CONST = {GRID_SNAPPING_MODES: modes};
  const wall = {options: {name: "walls"}, getSnappedPoint: () => ({x: 70, y: 120})};
  const token = {options: {name: "tokens"}, getSnappedPoint: () => ({x: 100, y: 100})};
  installLayerSnapping(wall);
  installLayerSnapping(token);
  assert.deepEqual(wall.getSnappedPoint(point), {x: 50, y: 150});
  assert.deepEqual(token.getSnappedPoint(point), {x: 100, y: 100});
  enabled = false;
  assert.deepEqual(wall.getSnappedPoint(point), point);
  assert.deepEqual(token.getSnappedPoint(point), point);
  enabled = true;
  shift = true;
  assert.deepEqual(wall.getSnappedPoint(point), point);
  assert.deepEqual(token.getSnappedPoint(point), point);
});

test("token snap options preserve explicit bypass and unrelated options", () => {
  let enabled = true;
  globalThis.canvas = {grid};
  globalThis.game = {settings: {get: () => enabled}, keyboard: {isModifierActive: () => false}};
  assert.deepEqual(withSnapPolicy({snap: true, hidden: true}), {snap: true, hidden: true});
  assert.deepEqual(withSnapPolicy({snap: false}), {snap: false});
  enabled = false;
  assert.deepEqual(withSnapPolicy({snap: true}), {snap: false});
});

test("registration wires token inputs, note creation, shapes and gridless visibility", async () => {
  let enabled = true;
  let noteData;
  class Token {
    static _getDropActorPosition(_token, position, options) { return {position, ...options}; }
    _updateDragDestination(_point, options) { return options; }
    _addDragWaypoint(_point, options) { return options; }
    _pasteObject(_point, options) { return options; }
    getSnappedPosition() { return {x: 100, y: 100}; }
  }
  class Shape {
    grid = grid;
    _getSnappedPoint() { return {x: 70, y: 120}; }
    _calculateSize(_length, _direction, options) { return options; }
  }
  const hooks = new Map();
  globalThis.Hooks = {on: (name, callback) => hooks.set(name, callback)};
  globalThis.CONFIG = {Token: {objectClass: Token}};
  globalThis.foundry = {data: {BaseShapeData: {TYPES: {rectangle: Shape}}},
    utils: {getDocumentClass: () => ({createDialog: async data => { noteData = data; }})}};
  globalThis.game = {activeTool: "journal", settings: {register() {}, get: () => enabled},
    keyboard: {isModifierActive: () => false}};
  globalThis.canvas = {grid, stage: {}};
  globalThis.CONST = {GRID_SNAPPING_MODES: modes};
  globalThis.ui = {controls: {element: null}};
  for (const name of ["tokens", "tiles", "drawings", "walls", "lighting", "sounds", "regions", "notes"]) {
    canvas[name] = {options: {name}, getSnappedPoint: () => ({x: 100, y: 100}), _onClickLeft() {}};
  }
  registerGridSnapping();
  const controls = {notes: {tools: {}}, walls: {tools: {snap: {}}}, cards: {tools: {snap: {}}}};
  hooks.get("getSceneControlButtons")(controls);
  assert.equal(controls.walls.tools.snap, undefined);
  assert.equal(controls.cards.tools.snap, undefined);
  hooks.get("canvasReady")();
  const wrapped = canvas.notes.getSnappedPoint;
  hooks.get("canvasReady")();
  assert.equal(canvas.notes.getSnappedPoint, wrapped);
  const token = new Token();
  token.document = {x: 0, y: 0};
  assert.equal(token._updateDragDestination(point, {snap: true}).snap, true);
  assert.equal(token._addDragWaypoint(point, {snap: false}).snap, false);
  assert.deepEqual(new Shape()._getSnappedPoint(point), {x: 50, y: 150});
  await canvas.notes._onClickLeft({shiftKey: false, getLocalPosition: () => point});
  assert.deepEqual(noteData, {x: 50, y: 150});
  enabled = false;
  assert.equal(Token._getDropActorPosition(token, point, {snap: true}).snap, false);
  assert.equal(token._updateDragDestination(point, {snap: true}).snap, false);
  assert.equal(token._addDragWaypoint(point, {snap: true}).snap, false);
  assert.equal(token._pasteObject(point).snap, false);
  assert.deepEqual(token.getSnappedPosition(point), point);
  assert.deepEqual(new Shape()._getSnappedPoint(point), point);
  assert.equal(new Shape()._calculateSize(120, 0, {snap: true}).snap, false);
  await canvas.notes._onClickLeft({shiftKey: false, getLocalPosition: () => point});
  assert.deepEqual(noteData, point);
  enabled = true;
  await canvas.notes._onClickLeft({shiftKey: true, getLocalPosition: () => point});
  assert.deepEqual(noteData, point);
  canvas.grid = {...grid, isGridless: true};
  let removed = false;
  hooks.get("renderSceneControls")({}, {querySelector: () => ({remove: () => { removed = true; }})});
  assert.equal(removed, true);
});