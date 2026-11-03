import {decorateIconButtons} from "./interface-components.mjs";
import {localize, MODULE_ID, reportError} from "./helper.mjs";

// Scene Controls: an idle control and tool, and a second column for wall, drawing and region type tools.
const TYPE_TOOLS = {
  walls: ["solid", "terrain", "invisible", "ethereal", "doors", "secret", "window"],
  drawings: ["rect", "ellipse", "polygon", "freehand", "text"],
  regions: ["rectangle", "circle", "ellipse", "cone", "ring", "line", "emanation", "polygon"]
};
const IDLE_CONTROL = "advancedInterfaceIdle";
let expandedTypes;
let selectedDrawing = "rect";
let selectedRegion = "rectangle";
const sceneListeners = new WeakSet();
const sceneObservers = new WeakMap();

// Layers whose objects can stay displayed while inactive (right-click the layer tab). Notes use core's display setting.
const DISPLAY_LAYERS = {drawings: "DrawingsLayer", walls: "WallsLayer", lighting: "LightingLayer", sounds: "SoundsLayer", regions: "RegionLayer", notes: "NotesLayer"};
const NOTES_SETTING = ["core", "notesDisplayToggle"];

function isLayerDisplayed(name) {
  if (name === "notes") return game.settings.get(...NOTES_SETTING);
  return !!game.settings.get(MODULE_ID, "layerDisplay")[name];
}

function applyLayerDisplay() {
  if (!canvas.ready) return;
  for (const name of ["walls", "lighting", "sounds"]) {
    const layer = canvas[name];
    if (layer?.objects) layer.objects.visible = layer.active || isLayerDisplayed(name);
  }
  // Drawing shapes live in the primary/interface groups, so their own visibility must be refreshed.
  for (const placeable of [...(canvas.regions?.placeables ?? []), ...(canvas.drawings?.placeables ?? [])]) {
    placeable.renderFlags.set({refreshState: true});
  }
}

function syncLayerPips(element) {
  for (const name of Object.keys(DISPLAY_LAYERS)) {
    const li = element.querySelector(`#scene-controls-layers [data-control="${name}"]`)?.closest("li");
    if (!li) continue;
    let pip = li.querySelector(".advanced-interface-layer-pip");
    if (!pip) {
      pip = element.ownerDocument.createElement("div");
      pip.className = "notification-pip advanced-interface-layer-pip";
      li.append(pip);
    }
    pip.classList.toggle("active", isLayerDisplayed(name));
  }
}

async function toggleLayerDisplay(name) {
  const on = !isLayerDisplayed(name);
  if (name === "notes") await game.settings.set(...NOTES_SETTING, on);
  else await game.settings.set(MODULE_ID, "layerDisplay", {...game.settings.get(MODULE_ID, "layerDisplay"), [name]: on});
  applyLayerDisplay();
  if (ui.controls.element) syncLayerPips(ui.controls.element);
}

function layoutSceneTools(app, element) {
  const menu = element.querySelector("#scene-controls-tools");
  if (!menu) return;
  const control = app.control?.name;
  element.dataset.advancedInterfaceControl = control;
  const types = TYPE_TOOLS[control] ?? [];
  if (control === "drawings" || control === "regions") {
    const drawing = types.includes(app.tool?.name);
    expandedTypes = drawing ? control : undefined;
    if (drawing && control === "drawings") selectedDrawing = app.tool.name;
    if (drawing && control === "regions") selectedRegion = app.tool.name;
  } else if (control === "walls") {
    expandedTypes = app.tool?.name === "wall" ? control : undefined;
  } else expandedTypes = undefined;
  menu.querySelector(".advanced-interface-draw-shape")?.remove();
  if (control === "drawings" || control === "regions") {
    const li = element.ownerDocument.createElement("li");
    li.className = "advanced-interface-draw-shape";
    const button = element.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `ui-control icon ${app.controls.walls.tools.wall.icon}`;
    button.dataset.typeLauncher = control;
    button.ariaLabel = localize("Controls.DrawShape");
    button.dataset.tooltip = button.ariaLabel;
    li.append(button);
    menu.querySelector('[data-tool="select"]').closest("li").after(li);
  }
  const launcher = menu.querySelector('[data-tool="wall"], [data-type-launcher]');
  if (launcher) {
    launcher.setAttribute("aria-expanded", String(expandedTypes === control));
    launcher.setAttribute("aria-controls", menu.id);
    if (launcher.dataset.typeLauncher) launcher.setAttribute("aria-pressed", String(types.includes(app.tool?.name)));
  }
  menu.classList.toggle("advanced-interface-types-open", expandedTypes === control);
  let row = 0;
  for (const li of menu.children) {
    const button = li.querySelector("button");
    if (button?.dataset.tool === IDLE_CONTROL) continue;
    const isType = types.includes(button?.dataset.tool);
    li.classList.toggle("advanced-interface-type-tool", isType);
    if (isType) continue;
    li.style.gridColumn = "1";
    li.style.gridRow = String(++row);
  }
  let typeRow = 1;
  for (const name of types) {
    const button = menu.querySelector(`[data-tool="${name}"]`);
    if (!button) continue;
    button.closest("li").style.gridColumn = "2";
    button.closest("li").style.gridRow = String(typeRow++);
  }
  syncWallPresets(element);
  syncLayerPips(element);
  decorateIconButtons(element);
  if (!sceneObservers.has(element)) {
    const observer = new MutationObserver(() => syncWallPresets(element));
    observer.observe(element, {subtree: true, attributes: true, attributeFilter: ["class"]});
    sceneObservers.set(element, observer);
  }
  if (sceneListeners.has(element)) return;
  sceneListeners.add(element);
  element.addEventListener("contextmenu", event => {
    const name = event.target.closest("#scene-controls-layers button[data-control]")?.dataset.control;
    if (!(name in DISPLAY_LAYERS)) return;
    event.preventDefault();
    toggleLayerDisplay(name).catch(reportError("Components"));
  });
  element.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const name = app.control?.name;
    const control = button.dataset.control;
    const tool = button.dataset.tool;
    const launcherActive = button.dataset.typeLauncher
      && (TYPE_TOOLS[name] ?? []).includes(app.tool?.name);
    if ((control && control === name) || launcherActive
      || (tool && tool === app.tool?.name && !app.tools[tool]?.toggle && !app.tools[tool]?.button)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      app.activate(control ? {control: IDLE_CONTROL} : {tool: IDLE_CONTROL}).catch(reportError("Components"));
      return;
    }
    if (button.dataset.typeLauncher) {
      event.preventDefault();
      event.stopImmediatePropagation();
      expandedTypes = name;
      const selected = name === "drawings" ? selectedDrawing : selectedRegion;
      app.activate({tool: selected}).then(() => layoutSceneTools(app, element)).catch(reportError("Components"));
      return;
    }
  }, {capture: true});
}

function syncWallPresets(element) {
  if (element.dataset.advancedInterfaceControl !== "walls") return;
  for (const li of element.querySelectorAll(".advanced-interface-type-tool")) {
    const pip = li.querySelector(".notification-pip");
    if (pip) li.querySelector("button").setAttribute("aria-pressed", String(pip.classList.contains("active")));
  }
}

export function registerSceneControlTools() {
  game.settings.register(MODULE_ID, "layerDisplay", {
    scope: "client", config: false, type: Object, default: {},
    onChange: () => {
      applyLayerDisplay();
      if (ui.controls.element) syncLayerPips(ui.controls.element);
    }
  });
  for (const hookName of Object.values(DISPLAY_LAYERS)) {
    Hooks.on(`activate${hookName}`, applyLayerDisplay);
    Hooks.on(`deactivate${hookName}`, applyLayerDisplay);
  }
  Hooks.on("canvasReady", applyLayerDisplay);
  const DrawingBase = CONFIG.Drawing.objectClass;
  CONFIG.Drawing.objectClass = class extends DrawingBase {
    get isVisible() {
      const visible = super.isVisible;
      if (!visible || this.layer.active || this.isPreview || this.controlled) return visible;
      return isLayerDisplayed("drawings");
    }
  };
  const RegionBase = CONFIG.Region.objectClass;
  CONFIG.Region.objectClass = class extends RegionBase {
    get isVisible() {
      if (super.isVisible) return true;
      if (this.layer.active || this.hasPreview || !isLayerDisplayed("regions") || this.isFilteredOut) return false;
      return this.document.testUserPermission(game.user, "OBSERVER") && (game.user.isGM || !this.document.hidden);
    }
  };
  Hooks.on("getSceneControlButtons", controls => {
    const idle = extra => ({
      name: IDLE_CONTROL,
      order: Number.MAX_SAFE_INTEGER,
      title: "ADVANCED_INTERFACE.Controls.Inactive",
      icon: "fa-solid fa-minus",
      ...extra
    });
    delete controls.notes.tools.toggle;
    for (const control of Object.values(controls)) {
      control.tools[IDLE_CONTROL] = idle({interaction: false, control: false, creation: false});
      if (control.tools.snap) control.tools.snap.icon = "fa-solid fa-border-inner";
      if (control.tools.ellipse) control.tools.ellipse.icon = "fa-regular fa-circle";
    }
    controls.walls.tools.solid.icon = controls.walls.icon;
    controls.walls.tools.ethereal.title = "ADVANCED_INTERFACE.Controls.Curtains";
    controls.walls.tools.ethereal.icon = "fa-solid fa-booth-curtain";
    controls[IDLE_CONTROL] = idle({
      tools: {},
      onChange: (_event, active) => {
        if (active) canvas.activeLayer?.deactivate();
      }
    });
  });
  Hooks.on("renderSceneControls", layoutSceneTools);
  Hooks.on("activateSceneControls", app => layoutSceneTools(app, app.element));
}
