import {setButtonLabel, syncDirectoryVisibility, targetApp} from "./helper.mjs";

export function registerMacroApps() {
  const clearDropTarget = () => {
    const hotbar = ui.hotbar?.element;
    const slot = hotbar?.querySelector(".slot.drop-target");
    if (!slot?.ondragover) return;
    // Let core clear its private drop-target reference as well as the highlight.
    hotbar.addEventListener("dragover", slot.ondragover, {once: true});
    hotbar.dispatchEvent(new hotbar.ownerDocument.defaultView.DragEvent("dragover"));
  };
  document.addEventListener("dragend", clearDropTarget, {capture: true});
  document.addEventListener("drop", clearDropTarget, {capture: true});
  document.addEventListener("dragleave", event => {
    const hotbar = ui.hotbar?.element;
    if (hotbar?.contains(event.target) && !hotbar.contains(event.relatedTarget)) clearDropTarget();
  }, {capture: true});
  CONFIG.ui.hotbar = class AdvancedHotbar extends CONFIG.ui.hotbar {
    _updateToggles() {
      super._updateToggles();
      for (const action of ["lock", "clear"]) {
        const button = this.element.querySelector(`[data-action="${action}"]`);
        const key = action === "clear" ? "Clear" : this.locked ? "Unlock" : "Lock";
        const label = game.i18n.localize(`SIDEBAR.PLACEABLES.ACTIONS.${key}`);
        setButtonLabel(button, label);
        if (action === "lock") button.setAttribute("aria-pressed", String(this.locked));
      }
    }
  };
  CONFIG.ui.macros = class AdvancedMacroDirectory extends CONFIG.ui.macros {
    _onDetach(from, to) {
      super._onDetach(from, to);
      placeHotbar(ui.macros);
    }

    _onAttach(from, to) {
      super._onAttach(from, to);
      placeHotbar();
    }
  };
}

// Core's previous/next page arrows are replaced by one number button per page, like the encounter numbers.
const HOTBAR_PAGES = 5;

function buildHotbarPages(nav) {
  const doc = nav.ownerDocument;
  let pages = nav.querySelector(":scope > .advanced-interface-hotbar-pages");
  if (!pages) {
    pages = doc.createElement("div");
    pages.className = "advanced-interface-hotbar-pages";
    for (let page = 1; page <= HOTBAR_PAGES; page++) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "inline-control";
      button.dataset.page = String(page);
      button.textContent = String(page);
      button.addEventListener("click", () => ui.hotbar.changePage(page));
      pages.append(button);
    }
    nav.append(pages);
  }
  for (const button of pages.querySelectorAll(":scope > button")) {
    const active = Number(button.dataset.page) === ui.hotbar.page;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function placeHotbar(directory = targetApp("macros")) {
  const hotbar = ui.hotbar?.element;
  const content = directory?.isPopout
    ? directory.element?.querySelector(":scope > .window-content")
    : directory?.element;
  const header = content?.querySelector(":scope > .directory-header");
  if (!hotbar || !header) return;
  hotbar.classList.add("advanced-interface-hotbar");
  syncDirectoryVisibility("macros");
  hotbar.classList.remove("faded-ui");
  hotbar.querySelector("#hotbar-page-controls")?.classList.remove("ui-control");
  for (const control of hotbar.querySelectorAll("#action-bar .slot, .hotbar-page-number")) {
    control.classList.add("ui-control");
  }
  for (const controls of hotbar.querySelectorAll("[data-tooltip-direction]")) {
    controls.dataset.tooltipDirection = "DOWN";
  }
  for (const button of hotbar.querySelectorAll("#hotbar-controls-right button")) {
    button.classList.remove("inline-control");
    button.classList.add("ui-control", "plain");
  }
  const pageControls = hotbar.querySelector("#hotbar-page-controls");
  if (pageControls) buildHotbarPages(pageControls);
  if (hotbar.parentElement !== content || content.firstElementChild !== hotbar) {
    content.prepend(hotbar);
  }
}

Hooks.on("renderHotbar", () => placeHotbar());
Hooks.on("renderMacroDirectory", () => placeHotbar());
Hooks.on("closeMacroDirectory", app => {
  if (app.isPopout) placeHotbar(ui.macros);
});
