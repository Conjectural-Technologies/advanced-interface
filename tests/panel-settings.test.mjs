import {beforeEach, test} from "node:test";
import assert from "node:assert/strict";
import {getPanelSetting, setPanelSettings} from "../scripts/helper.mjs";

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