import {beforeEach, test} from "node:test";
import assert from "node:assert/strict";
import {createDirectoryToggle, getPanelSetting, setPanelSettings, syncDirectoryVisibility} from "../scripts/helper.mjs";

let worldId;
let settings;

beforeEach(() => {
  worldId = "first-world";
  settings = {};
  globalThis.foundry = {utils: {deepClone: structuredClone}};
  globalThis.game = {
    world: {get id() { return worldId; }},
    settings: {
      get: (_module, key) => settings[key],
      set: async (_module, key, value) => { settings[key] = structuredClone(value); }
    }
  };
});

test("panel settings persist per world without carrying into a new world", async () => {
  await Promise.all([
    setPanelSettings({tabOrder: ["chat", "actors"]}),
    setPanelSettings({panelStates: {pinned: ["chat"], shown: []}})
  ]);
  assert.deepEqual(getPanelSetting("tabOrder", []), ["chat", "actors"]);
  assert.deepEqual(getPanelSetting("panelStates", {}), {pinned: ["chat"], shown: []});

  worldId = "second-world";
  assert.deepEqual(getPanelSetting("tabOrder", []), []);
  assert.deepEqual(getPanelSetting("panelStates", {}), {});
  await setPanelSettings({tabOrder: ["cards"]});

  worldId = "first-world";
  assert.deepEqual(getPanelSetting("tabOrder", []), ["chat", "actors"]);
  assert.deepEqual(getPanelSetting("panelStates", {}), {pinned: ["chat"], shown: []});
  worldId = "second-world";
  assert.deepEqual(getPanelSetting("tabOrder", []), ["cards"]);
});

test("directory toggles update both panels immediately and recover from save failures", async () => {
  const element = () => ({
    dataset: {},
    attributes: {},
    classes: new Set(),
    classList: {toggle(name, on) { on ? this.owner.classes.add(name) : this.owner.classes.delete(name); }},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(_type, listener) { this.listener = listener; },
    click() { this.listener({preventDefault() {}, stopPropagation() {}}); }
  });
  const panel = element();
  const popout = element();
  panel.classList.owner = panel;
  popout.classList.owner = popout;
  const button = createDirectoryToggle({createElement: element}, "scenes", "");
  const popoutButton = element();
  const root = control => ({querySelectorAll: () => [control]});
  popout.querySelectorAll = () => [popoutButton];
  globalThis.ui = {scenes: {element: panel, popout: {element: popout}}, sidebar: {element: root(button)}};
  game.i18n = {localize: key => key};
  const errors = [];
  globalThis.Hooks = {onError: (...args) => errors.push(args)};
  let resolveSave;
  let rejectSave;
  game.settings.set = (_module, key, value) => new Promise((resolve, reject) => {
    resolveSave = () => { settings[key] = structuredClone(value); resolve(); };
    rejectSave = reject;
  });

  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, true);
  assert.equal(panel.classes.has("advanced-interface-scene-directory-hidden"), true);
  assert.equal(popout.classes.has("advanced-interface-scene-directory-hidden"), true);
  assert.equal(button.getAttribute("aria-label"), "ADVANCED_INTERFACE.ShowDirectory");
  assert.equal(popoutButton.getAttribute("aria-pressed"), "true");
  syncDirectoryVisibility("scenes");
  assert.equal(panel.classes.has("advanced-interface-scene-directory-hidden"), true);
  resolveSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getPanelSetting("hideSceneDirectory", false), true);
  assert.equal(button.disabled, false);

  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.classes.has("advanced-interface-scene-directory-hidden"), false);
  rejectSave(new Error("save failed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.classes.has("advanced-interface-scene-directory-hidden"), true);
  assert.equal(popoutButton.getAttribute("aria-pressed"), "true");
  assert.equal(button.disabled, false);
  assert.equal(errors.length, 1);
});