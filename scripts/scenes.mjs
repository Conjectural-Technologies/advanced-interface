import {decorateDocumentIcons, decorateIconButtons} from "./interface-components.mjs";
import {MODULE_ID, cloneWithButtonActions, createButton, createIcon, getPanelSetting, localize, reportError,
  setPanelSettings, syncDirectoryVisibility} from "./helper.mjs";

let navigationExpanded = true;

function copySceneNavigationCard(card) {
  const copy = cloneWithButtonActions(card);
  copy.querySelectorAll(".advanced-interface-card-menu-button, .advanced-interface-card-header-background")
    .forEach(element => element.remove());
  copy.classList.remove("context", "advanced-interface-card-menu-open");
  copy.querySelectorAll(".advanced-interface-card-menu-hidden").forEach(child =>
    child.classList.remove("advanced-interface-card-menu-hidden"));
  copy.querySelector(".entry-name")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const scene = game.scenes.get(copy.dataset.entryId);
    if (!scene) throw new Error(`Advanced Interface | Scene "${copy.dataset.entryId}" is unavailable.`);
    scene.view().catch(reportError("Scene view"));
  });
  return copy;
}

function groupNavigationScenes(app, element) {
  const directory = element.querySelector(".directory-list");
  if (!directory) return;
  element.querySelector(".advanced-interface-navigation-group")?.remove();
  const doc = element.ownerDocument;
  const group = doc.createElement("section");
  group.className = "advanced-interface-navigation-group";
  const header = doc.createElement("header");
  header.className = "advanced-interface-navigation-heading";
  const label = doc.createElement("span");
  label.textContent = localize("Scene.Navigation");
  const list = doc.createElement("ol");
  list.className = "plain advanced-interface-navigation-scenes";
  list.id = `${app.id}-navigation-scenes`;
  const shutter = createButton(doc, "ui-control icon fa-solid fa-chevron-up advanced-interface-player-shutter", {
    label: label.textContent
  });
  shutter.setAttribute("aria-controls", list.id);
  const sync = () => {
    shutter.setAttribute("aria-expanded", String(navigationExpanded));
    list.hidden = !navigationExpanded;
  };
  shutter.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    navigationExpanded = !navigationExpanded;
    for (const panel of doc.querySelectorAll(".advanced-interface-navigation-group")) {
      panel.querySelector("button").setAttribute("aria-expanded", String(navigationExpanded));
      panel.querySelector(".advanced-interface-navigation-scenes").hidden = !navigationExpanded;
    }
  });
  header.append(label, shutter);
  const cards = [...directory.querySelectorAll(".scene[data-entry-id]")]
    .filter(card => game.scenes.get(card.dataset.entryId)?.navigation)
    .sort((a, b) => game.scenes.get(a.dataset.entryId).navOrder - game.scenes.get(b.dataset.entryId).navOrder);
  for (const card of cards) {
    const levels = card.nextElementSibling?.matches(".advanced-interface-scene-levels") ? card.nextElementSibling : null;
    list.append(copySceneNavigationCard(card));
    if (levels) list.append(cloneWithButtonActions(levels));
  }
  group.append(header, list);
  const directoryHeader = directory.parentElement.querySelector(":scope > .directory-header");
  if (directoryHeader) directoryHeader.before(group);
  else directory.before(group);
  sync();
  decorateIconButtons(group);
}

// Scenes activated from the directory keep the activating GM on their current view.
export function registerSceneDocument() {
  CONFIG.Scene.documentClass = class AdvancedScene extends CONFIG.Scene.documentClass {
    _onActivate(active, operation) {
      if (game.user.isGM && operation.advancedInterfacePreserveView === game.user.id) return;
      return super._onActivate(active, operation);
    }
  };
}

function activateScene(scene) {
  return scene.activate({updateOptions: {advancedInterfacePreserveView: game.user.id}});
}

function sceneUserPip(doc, user) {
  const pip = doc.createElement("span");
  pip.className = "advanced-interface-scene-user";
  pip.textContent = user.name[0];
  pip.style.backgroundColor = user.color.multiply(0.5).css;
  pip.style.borderColor = user.color.css;
  pip.dataset.tooltip = user.name;
  pip.setAttribute("aria-label", user.name);
  return pip;
}

function updateSceneIndicators(element) {
  element.querySelectorAll(".advanced-interface-scene-levels").forEach(levels => levels.remove());
  for (const card of element.querySelectorAll(".directory-item.scene[data-entry-id]")) {
    const scene = game.scenes.get(card.dataset.entryId);
    if (!scene) continue;
    card.querySelector(".advanced-interface-scene-indicators")?.remove();
    card.querySelector(".advanced-interface-scene-users")?.remove();
    const doc = element.ownerDocument;
    card.querySelector(".advanced-interface-document-icon")?.remove();
    const titleIcon = createIcon(doc, `${CONFIG.Scene.typeIcons?.[scene.type] ?? CONFIG.Scene.sidebarIcon} advanced-interface-document-icon advanced-interface-scene-title-icon`);
    card.querySelector(":scope > .entry-name")?.before(titleIcon);
    decorateDocumentIcons(card);
    const indicators = doc.createElement("div");
    indicators.className = "advanced-interface-scene-indicators";
    const users = doc.createElement("div");
    users.className = "advanced-interface-scene-users";
    for (const user of game.users) {
      if (!user.active || user.viewedScene !== scene.id) continue;
      users.append(sceneUserPip(doc, user));
    }
    for (const [selected, icon, action, key] of [
      [scene.navigation, "compass", "navigation", "SCENE.ToggleNav"],
      [scene.active, "bullseye", "activate", scene.active ? "ADVANCED_INTERFACE.Scene.Deactivate" : "SCENE.Activate"],
      [scene.isView, "eye", "view", scene.isView ? "ADVANCED_INTERFACE.Scene.StopViewing" : "SCENE.View"]
    ]) {
      const isDisabled = () => action === "activate" || action === "navigation" ? !game.user.isGM : false;
      const status = createButton(doc, `ui-control plain icon fa-solid fa-${icon}`, {
        label: game.i18n.localize(key),
        context: `Scene ${action}`,
        onClick: async () => {
          if (status.disabled || isDisabled()) return;
          status.disabled = true;
          try {
            if (action === "navigation") await scene.update({navigation: !scene.navigation});
            else if (action === "activate") {
              if (scene.active) await scene.update({active: false}, {advancedInterfacePreserveView: game.user.id});
              else {
                await activateScene(scene);
                if (!scene.isView) await scene.view();
              }
            } else if (scene.isView) await scene.unview();
            else await scene.view();
          } finally {
            status.disabled = isDisabled();
          }
        }
      });
      status.dataset.sceneAction = action;
      if (selected !== null) status.setAttribute("aria-pressed", String(selected));
      status.disabled = isDisabled();
      status.addEventListener("dblclick", event => event.stopPropagation());
      indicators.append(status);
    }
    card.append(indicators, users);
    if (!scene.isView) continue;
    const levels = Array.from(scene.availableLevels);
    if (levels.length < 2) continue;
    const group = doc.createElement("li");
    group.className = "advanced-interface-scene-levels";
    const list = doc.createElement("ul");
    list.className = "plain";
    for (const level of levels.reverse()) {
      const row = doc.createElement("li");
      const control = createButton(doc, "advanced-interface-scene-level", {
        context: "Scene level",
        onClick: () => scene.view({level: level.id})
      });
      control.dataset.levelId = level.id;
      control.setAttribute("aria-pressed", String(level.isView));
      const icon = createIcon(doc, "fa-solid fa-layer-group");
      const name = doc.createElement("span");
      name.className = "ellipsis";
      name.textContent = level.name;
      control.append(icon, name);
      for (const user of game.users) {
        if (user.active && user.viewedScene === scene.id && user.viewedLevel === level.id) {
          control.append(sceneUserPip(doc, user));
        }
      }
      control.addEventListener("dblclick", event => event.stopPropagation());
      row.append(control);
      list.append(row);
    }
    group.append(list);
    card.after(group);
  }
}

const sceneInteractionElements = new WeakSet();

Hooks.on("renderSceneDirectory", (app, element) => {
  updateSceneIndicators(element);
  groupNavigationScenes(app, element);
  syncDirectoryVisibility("scenes");
  if (sceneInteractionElements.has(element)) return;
  sceneInteractionElements.add(element);
  for (const eventName of ["click", "dblclick"]) {
    element.addEventListener(eventName, event => {
      if (event.button !== 0
        || event.target.closest("button, a, input, select, textarea, [role='button'], .advanced-interface-card-actions")) return;
      const card = event.target.closest(".directory-item.scene[data-entry-id]");
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (eventName === "dblclick" || event.detail > 1) return;
      const scene = game.scenes.get(card.dataset.entryId);
      if (!scene) throw new Error(`Advanced Interface | Scene "${card.dataset.entryId}" is unavailable.`);
      scene.view().catch(reportError("Scene view"));
    }, {capture: true});
  }
});

Hooks.on("renderSceneNavigation", () => {
  for (const app of [ui.scenes, ui.scenes?.popout]) {
    if (app?.rendered) {
      updateSceneIndicators(app.element);
      groupNavigationScenes(app, app.element);
    }
  }
});

let toolSelectionRestored = false;

function rememberSelectedTool(app) {
  if (!toolSelectionRestored || !canvas.ready || !app.control || !app.tool) return;
  const selection = {control: app.control.name, tool: app.tool.name};
  const saved = getPanelSetting("selectedTool", {});
  if (saved.control === selection.control && saved.tool === selection.tool) return;
  setPanelSettings({selectedTool: selection}).catch(reportError("Saving selected tool"));
}

Hooks.on("activateSceneControls", rememberSelectedTool);
Hooks.on("renderSceneControls", rememberSelectedTool);
Hooks.once("canvasReady", () => {
  const restore = async () => {
    const saved = getPanelSetting("selectedTool", {});
    if (saved.control) {
      const control = ui.controls.controls[saved.control];
      const tool = control?.tools[saved.tool];
      if (!control || !tool || tool.button || tool.toggle) {
        console.warn("Advanced Interface | Saved scene tool is no longer available.", saved);
      } else {
        await ui.controls.activate({control: saved.control, tool: saved.tool});
      }
    }
    toolSelectionRestored = true;
    rememberSelectedTool(ui.controls);
  };
  restore().catch(reportError("Restoring selected tool"));
});
