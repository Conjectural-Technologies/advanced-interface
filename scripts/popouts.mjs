import {decorateIconButtons, decorateLeadingIcons} from "./interface-components.mjs";
import {panelWidth} from "./sidebar.mjs";
import {createButton, isManagedSidebarTab, setButtonLabel} from "./helper.mjs";

// Managed popouts close immediately instead of playing Foundry's shrink animation.
export function patchPopoutClose() {
  const AbstractSidebarTab = foundry.applications.sidebar.AbstractSidebarTab;
  const close = AbstractSidebarTab.prototype.close;
  AbstractSidebarTab.prototype.close = function(options = {}) {
    if (this.isPopout && isManagedSidebarTab(this)) options = {animate: false, ...options};
    return close.call(this, options);
  };
}

const popoutWindowControls = new WeakMap();
const popoutWindowLifecycles = new WeakSet();
const popoutTabControls = new WeakMap();

function syncPopoutTabControls(app) {
  const header = app.element?.querySelector(":scope > .window-header");
  const source = ui.sidebar?.element?.querySelector(`#sidebar-tabs [data-tab="${app.tabName}"]`)
    ?.closest("li")?.querySelector(".advanced-interface-tab-actions");
  if (!header || !source) return;
  let state = popoutTabControls.get(app);
  if (state?.header !== header || state?.source !== source) {
    state?.observer.disconnect();
    header.querySelectorAll(".advanced-interface-popout-tab-action").forEach(button => button.remove());
    state = {header, source, buttons: new Map()};
    state.observer = new source.ownerDocument.defaultView.MutationObserver(() => syncPopoutTabControls(app));
    state.observer.observe(source, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "aria-label", "aria-pressed", "aria-expanded", "data-tooltip", "disabled", "data-settings-menu"]
    });
    popoutTabControls.set(app, state);
  }
  const originals = [...source.querySelectorAll(":scope > button:not([data-tab-control])")];
  for (const [original, button] of state.buttons) {
    if (originals.includes(original)) continue;
    button.remove();
    state.buttons.delete(original);
  }
  let anchor = header.querySelector('[data-action="detach"], [data-action="attach"], [data-action="toggleControls"], [data-action="close"]');
  for (const original of originals.toReversed()) {
    let button = state.buttons.get(original);
    if (!button) {
      const directoryClass = [...original.classList].find(name => name.startsWith("advanced-interface-toggle-"));
      if (directoryClass) header.querySelector(`button.${directoryClass}:not(.advanced-interface-popout-tab-action)`)?.remove();
      button = createButton(header.ownerDocument, "", {onClick: () => original.click()});
      state.buttons.set(original, button);
    }
    const classes = [...new Set(["header-control", "icon", "advanced-interface-popout-tab-action",
      ...[...original.classList].filter(name => !["ui-control", "plain"].includes(name))])].join(" ");
    if (button.className !== classes) button.className = classes;
    setButtonLabel(button, original.getAttribute("aria-label") ?? original.dataset.tooltip ?? "");
    button.dataset.tooltipDirection = "DOWN";
    if (original.dataset.settingsMenu) button.dataset.settingsMenu = original.dataset.settingsMenu;
    for (const attribute of ["aria-pressed", "aria-expanded"]) {
      const value = original.getAttribute(attribute);
      if (value === null) button.removeAttribute(attribute);
      else if (button.getAttribute(attribute) !== value) button.setAttribute(attribute, value);
    }
    button.disabled = original.disabled;
    if (button.nextElementSibling !== anchor) header.insertBefore(button, anchor);
    anchor = button;
  }
  decorateIconButtons(header);
}

function syncPopoutWindowControls(app) {
  const header = app.element?.querySelector(":scope > .window-header");
  if (!header) return;
  header.querySelectorAll(".advanced-interface-window-control").forEach(button => button.remove());
  for (const control of popoutWindowControls.get(app) ?? []) {
    const visible = typeof control.visible === "function"
      ? control.visible.call(app) : control.visible ?? true;
    if (!visible) continue;
    const button = createButton(header.ownerDocument, `header-control icon advanced-interface-window-control ${control.icon}`, {
      label: game.i18n.localize(control.label)
    });
    button.dataset.action = control.action;
    header.insertBefore(button, header.querySelector('[data-action="toggleControls"], [data-action="close"]'));
  }
  decorateIconButtons(header);
}

Hooks.on("getHeaderControlsAbstractSidebarTab", (app, controls) => {
  if (!app.isPopout || !isManagedSidebarTab(app)) return;
  const windowControls = controls.filter(control => ["detach", "attach"].includes(control.action));
  popoutWindowControls.set(app, windowControls);
  for (let index = controls.length - 1; index >= 0; index--) {
    if (windowControls.includes(controls[index])) controls.splice(index, 1);
  }
});

Hooks.on("renderAbstractSidebarTab", (app, element) => {
  if (!app.isPopout || !isManagedSidebarTab(app) || element.classList.contains("compendium-directory")) return;
  if (!popoutWindowLifecycles.has(app)) {
    popoutWindowLifecycles.add(app);
    for (const method of ["_onDetach", "_onAttach"]) {
      const original = app[method];
      app[method] = function(...args) {
        const result = original.apply(this, args);
        syncPopoutWindowControls(this);
        syncPopoutTabControls(this);
        if (method === "_onDetach") this.element.style.removeProperty("max-height");
        return result;
      };
    }
  }
  element.classList.add(`${app.tabName}-sidebar`, "advanced-interface-matched-popout");
  element.dataset.tab = app.tabName;
  const width = panelWidth(app.tabName);
  element.style.setProperty("--advanced-interface-popout-width", `${width}px`);
  if (app.position.width !== width) app.setPosition({width});
  const header = element.querySelector(":scope > .window-header");
  if (!header) return;
  header.classList.add("ui-control");
  const tab = ui.sidebar.element.querySelector(`#sidebar-tabs [data-tab="${app.tabName}"]`);
  if (!tab) throw new Error(`Advanced Interface | Missing popout tab "${app.tabName}".`);
  const title = header.querySelector(".window-title");
  title.textContent = tab.getAttribute("aria-label");
  title.hidden = app.tabName === "advancedControls";
  const icon = header.querySelector(".window-icon");
  icon.className = `window-icon ${Array.from(tab.classList).filter(name => name.startsWith("fa-")).join(" ")}`;
  decorateLeadingIcons([icon], "advanced-interface-popout-leader");
  header.setAttribute("aria-label", tab.getAttribute("aria-label"));
  syncPopoutWindowControls(app);
  syncPopoutTabControls(app);
  decorateIconButtons(element);
});

Hooks.on("renderSidebar", () => {
  for (const app of Object.values(ui.sidebar?.popouts ?? {})) {
    if (app.rendered && isManagedSidebarTab(app)) syncPopoutTabControls(app);
  }
});

Hooks.on("closeAbstractSidebarTab", app => {
  popoutTabControls.get(app)?.observer.disconnect();
  popoutTabControls.delete(app);
});
