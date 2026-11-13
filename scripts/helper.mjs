export const MODULE_ID = "advanced-interface";

let panelSettingsQueue = Promise.resolve();

export function getPanelSetting(key, fallback) {
  const settings = game.settings.get(MODULE_ID, "worldPanelSettings");
  return foundry.utils.deepClone(settings?.[game.world.id]?.[key] ?? fallback);
}

export function setPanelSettings(updates) {
  const save = async () => {
    const settings = foundry.utils.deepClone(game.settings.get(MODULE_ID, "worldPanelSettings") ?? {});
    const world = settings[game.world.id] ??= {};
    for (const [key, value] of Object.entries(updates)) world[key] = foundry.utils.deepClone(value);
    await game.settings.set(MODULE_ID, "worldPanelSettings", settings);
  };
  panelSettingsQueue = panelSettingsQueue.then(save, save);
  return panelSettingsQueue;
}

const MANAGED_SIDEBAR_TABS = new Set([
  "chat", "combat", "scenes", "actors", "items", "journal", "tables", "cards",
  "macros", "playlists", "compendium", "settings", "placeables",
  "advancedVolume", "advancedControls", "advancedTime", "advancedPlayers"
]);

export function isManagedSidebarTab(app) {
  return MANAGED_SIDEBAR_TABS.has(app.tabName);
}

export const localize = key => game.i18n.localize(`ADVANCED_INTERFACE.${key}`);

export function getHighlightColor(state) {
  const active = state === "active";
  const variable = active ? "--advanced-interface-selected-color" : "--advanced-interface-hover-color";
  const value = getComputedStyle(document.body).getPropertyValue(variable).trim();
  return Number(foundry.utils.Color.fromString(value || (active ? "#ff3f00" : "#4f4fff")));
}

/** Returns an error handler that logs and notifies under an "Advanced Interface | context" heading. */
export function reportError(context) {
  return error => Hooks.onError(`Advanced Interface | ${context}`, error, {log: "error", notify: "error"});
}

/**
 * Create an icon button. A label sets both the accessible name and the tooltip.
 * @param {Document} doc
 * @param {string} className
 * @param {object} [options]
 * @param {string} [options.label]
 * @param {Function} [options.onClick]  Called after the event is prevented and stopped; rejections are reported.
 * @param {string} [options.context]    Error-report heading for onClick.
 */
export function createButton(doc, className, {label, onClick, context = "Button"} = {}) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  if (label !== undefined) setButtonLabel(button, label);
  if (onClick) button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve().then(() => onClick(event)).catch(reportError(context));
  });
  return button;
}

export function setButtonLabel(button, label) {
  if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
  if (button.dataset.tooltip !== label) button.dataset.tooltip = label;
}

/** Navigation copies forward button clicks to the original controls and their permission checks. */
export function cloneWithButtonActions(element) {
  const copy = element.cloneNode(true);
  const originals = [...element.querySelectorAll("button")];
  copy.querySelectorAll("button").forEach((button, index) => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      originals[index].click();
    });
  });
  return copy;
}

export const DIRECTORY_VISIBILITY = {
  actors: {setting: "hideActorDirectory", name: "actor"},
  scenes: {setting: "hideSceneDirectory", name: "scene"},
  items: {setting: "hideItemDirectory", name: "item"},
  macros: {setting: "hideMacroDirectory", name: "macro"}
};

export function createDirectoryToggle(doc, tab, className) {
  const {setting, name} = DIRECTORY_VISIBILITY[tab];
  const button = createButton(doc, `${className} fa-solid fa-list advanced-interface-toggle-${name}-directory`, {
    context: `Toggle ${name} directory`,
    onClick: async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await setPanelSettings({[setting]: !getPanelSetting(setting, false)});
      } finally {
        button.disabled = false;
      }
    }
  });
  return button;
}

export function syncDirectoryVisibility(tab) {
  const {setting, name} = DIRECTORY_VISIBILITY[tab];
  const hidden = getPanelSetting(setting, false);
  for (const app of [ui[tab], ui[tab]?.popout]) {
    app?.element?.classList.toggle(`advanced-interface-${name}-directory-hidden`, hidden);
  }
  const label = localize(hidden ? "ShowDirectory" : "HideDirectory");
  for (const root of [ui.sidebar?.element, ui[tab]?.popout?.element]) {
    for (const toggle of root?.querySelectorAll(`.advanced-interface-toggle-${name}-directory`) ?? []) {
      setButtonLabel(toggle, label);
      if (toggle.getAttribute("aria-pressed") !== String(hidden)) toggle.setAttribute("aria-pressed", String(hidden));
    }
  }
}

/** Creates a decorative Font Awesome icon hidden from assistive technology. */
export function createIcon(doc, className) {
  const icon = doc.createElement("i");
  icon.className = className;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

/** The tab's content host; detached popouts are opt-in so the hotbar stays in the main window. */
export function targetApp(tab, {includeDetached = false} = {}) {
  const app = ui[tab];
  return app?.popout?.rendered && (includeDetached || app.popout.element.ownerDocument === document) ? app.popout : app;
}

export function sidebarDocuments() {
  const documents = new Set([document]);
  for (const app of Object.values(ui.sidebar?.popouts ?? {})) {
    if (app.rendered && isManagedSidebarTab(app)) documents.add(app.element.ownerDocument);
  }
  return documents;
}
