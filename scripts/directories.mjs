import {decorateCompendiumIcons, decorateDocumentIcons, decorateFolderIcons, decoratePlaceableRowIcons, decoratePlaceableSearchIcons} from "./interface-components.mjs";
import {AdvancedSidebar} from "./sidebar.mjs";
import {createButton, createIcon, isManagedSidebarTab, localize, setButtonLabel, sidebarDocuments} from "./helper.mjs";

Hooks.on("renderCompendiumDirectory", (app, element) => {
  decorateCompendiumIcons(element);
  for (const card of element.querySelectorAll(".compendium[data-pack]")) {
    card.dataset.action = "activateEntry";
    const pack = game.packs.get(card.dataset.pack);
    if (!pack) continue;
    const icons = card.querySelector(".status-icons");
    if (!icons) continue;
    icons.querySelector(".fa-lock")?.remove();
    icons.querySelector(".advanced-interface-pack-lock")?.remove();
    const button = createButton(element.ownerDocument,
      `ui-control plain icon fa-solid fa-lock${pack.locked ? "" : "-open"} advanced-interface-pack-lock`, {
        label: game.i18n.localize(`COMPENDIUM.ToggleLocked.${pack.locked ? "Unlock" : "Lock"}`),
        context: "Compendium lock",
        onClick: async () => {
          if (button.disabled || !game.user.isGM) return;
          button.disabled = true;
          try {
            await pack.toggleLockDialog();
          } finally {
            button.disabled = !game.user.isGM;
          }
        }
      });
    button.setAttribute("aria-pressed", String(pack.locked));
    button.disabled = !game.user.isGM;
    button.addEventListener("dblclick", event => event.stopPropagation());
    icons.append(button);
    card.style.setProperty("--advanced-interface-pack-status-width", `${icons.children.length * 40}px`);
  }
  if (!(ui.sidebar instanceof AdvancedSidebar)) return;
  if (app.isPopout) element.querySelector("button.open-compendium-browser")?.remove();
  else ui.sidebar.moveCompendiumBrowserButton(element);
});

function setSearchPlaceholders(element) {
  for (const input of element.querySelectorAll('input[type="search"]')) {
    input.placeholder = localize("Search");
  }
}

const placeableCountObservers = new WeakSet();
const collapsedPlaceableGroups = new Set();

function addPlaceableGroupShutters(app, element) {
  for (const [index, group] of [...element.querySelectorAll(".placeable-group")].entries()) {
    const header = group.querySelector(":scope > .group-header");
    const list = group.querySelector(":scope > .placeable-directory");
    if (!header || !list || header.querySelector(".advanced-interface-placeable-shutter")) continue;
    const key = JSON.stringify([app.constructor.name, Object.entries(group.dataset).sort()]);
    list.id ||= `${app.id}-group-${index}`;
    const shutter = createButton(element.ownerDocument,
      "ui-control icon fa-solid fa-chevron-up advanced-interface-placeable-shutter", {
        label: header.querySelector(".label")?.textContent.trim() ?? group.dataset.category
      });
    shutter.setAttribute("aria-controls", list.id);
    const sync = () => {
      const expanded = !collapsedPlaceableGroups.has(key);
      shutter.setAttribute("aria-expanded", String(expanded));
      list.hidden = !expanded;
    };
    shutter.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (collapsedPlaceableGroups.has(key)) collapsedPlaceableGroups.delete(key);
      else collapsedPlaceableGroups.add(key);
      sync();
    });
    header.append(shutter);
    sync();
  }
}

// Synthetic placeables (e.g. Complete Card Management canvas cards) lack core's `viewed` getter, so the
// default "Viewed Only" filter hides every entry.
function patchSyntheticViewed(app) {
  const proto = app.documentClass?.prototype;
  if (!proto || "viewed" in proto) return false;
  Object.defineProperty(proto, "viewed", {
    configurable: true,
    get() {
      const levels = this.levels;
      const view = canvas.scene?._view;
      const viewId = typeof view === "string" ? view : view?.id;
      if (!viewId || !(levels?.size ?? levels?.length)) return true;
      return levels.has ? levels.has(viewId) : levels.includes(viewId);
    }
  });
  return true;
}

Hooks.on("renderPlaceableTab", (app, element) => {
  setSearchPlaceholders(element);
  if (patchSyntheticViewed(app)) app._applyFilters();
  for (const count of element.querySelectorAll(".group-header > .meta")) {
    const normalize = () => {
      const text = count.textContent.trim();
      if (/^\(\d+\)$/.test(text)) count.textContent = text.slice(1, -1);
    };
    normalize();
    if (!placeableCountObservers.has(count)) {
      const observer = new MutationObserver(normalize);
      observer.observe(count, {childList: true, characterData: true, subtree: true});
      placeableCountObservers.add(count);
    }
  }
  const categoryIcon = app.layer.constructor.prepareSceneControls().icon;
  const search = element.querySelector("search");
  if (search && !search.querySelector(".advanced-interface-placeable-icon")) {
    search.prepend(createIcon(element.ownerDocument, `advanced-interface-placeable-icon ${categoryIcon}`));
  }
  if (search) decoratePlaceableSearchIcons(element);
  for (const label of element.querySelectorAll(".placeable-entry > .description > .label, .group-header > .label")) {
    const row = label.parentElement;
    const group = row.closest(".placeable-group");
    const color = row.querySelector(":scope > .color");
    if (row.classList.contains("group-header") && group.hasAttribute("data-author-id") && color) {
      row.querySelector(".advanced-interface-placeable-icon")?.remove();
      row.prepend(color);
      continue;
    }
    if (row.querySelector(".advanced-interface-placeable-icon")) continue;
    const iconClass = row.classList.contains("group-header")
      ? group.hasAttribute("data-author-id") ? "fa-solid fa-user"
        : group.hasAttribute("data-level-id") ? "fa-solid fa-layer-group" : categoryIcon
      : categoryIcon;
    row.prepend(createIcon(element.ownerDocument, `advanced-interface-placeable-icon ${iconClass}`));
    if (color) label.after(color);
  }
  decoratePlaceableEntries(app, element);
  addPlaceableGroupShutters(app, element);
  decoratePlaceableRowIcons(element);
});

const WALL_CATEGORY_TOOLS = {
  secret: "secret", door: "doors", window: "window", invisible: "invisible",
  ethereal: "ethereal", terrain: "terrain", normal: "solid", blank: "wall"
};

const PLACEABLE_TOGGLES = {
  hidden: {
    on: "fa-eye-slash", off: "fa-eye", handler: "_onToggleHidden",
    labelOn: "SIDEBAR.PLACEABLES.ACTIONS.Show", labelOff: "SIDEBAR.PLACEABLES.ACTIONS.Hide"
  },
  locked: {
    on: "fa-lock", off: "fa-lock-open", handler: "_onToggleLocked",
    labelOn: "SIDEBAR.PLACEABLES.ACTIONS.Unlock", labelOff: "SIDEBAR.PLACEABLES.ACTIONS.Lock"
  }
};

function wallCategoryIcon(category) {
  const tool = ui.controls?.controls?.walls?.tools?.[WALL_CATEGORY_TOOLS[category]];
  return tool?.icon ?? "fa-solid fa-block-brick";
}

function placeableToggle(app, li, doc, key) {
  const config = PLACEABLE_TOGGLES[key];
  const state = !!doc?.[key];
  const button = createButton(li.ownerDocument,
    `ui-control icon fa-solid ${state ? config.on : config.off} advanced-interface-placeable-toggle`, {
      label: game.i18n.localize(state ? config.labelOn : config.labelOff),
      context: "Placeable toggle",
      onClick: () => app[config.handler](null, button)
    });
  button.dataset.toggle = key;
  button.setAttribute("aria-pressed", String(state));
  button.disabled = !doc?.canUserModify?.(game.user, "update", {[key]: !state});
  button.addEventListener("dblclick", event => event.stopPropagation());
  return button;
}

function regionRange(app, li, meta) {
  const match = meta.textContent.trim().match(/^([[(])\s*(.+?)\s*,\s*(.+?)\s*([\])])$/);
  if (!match) return;
  const doc = li.ownerDocument;
  const range = doc.createElement("span");
  range.className = "advanced-interface-region-range";
  const mark = text => {
    const span = doc.createElement("span");
    span.className = "advanced-interface-region-range-mark";
    span.setAttribute("aria-hidden", "true");
    span.textContent = text;
    return span;
  };
  const value = (text, label) => {
    const button = createButton(doc, "ui-control advanced-interface-region-range-value", {
      label, context: "Region elevation", onClick: () => app._onConfigureEntry?.(null, button)
    });
    button.textContent = text;
    button.addEventListener("dblclick", event => event.stopPropagation());
    return button;
  };
  range.setAttribute("aria-label", meta.textContent.trim());
  range.append(mark(match[1]), value(match[2], game.i18n.localize("REGION.FIELDS.elevation.bottom.label")),
    mark(","), value(match[3], game.i18n.localize("REGION.FIELDS.elevation.top.label")), mark(match[4]));
  meta.replaceWith(range);
}

// Token cards lead with their actor's portrait, like actor directory cards.
function placeableThumbnail(app, li) {
  if (li.querySelector(":scope > img.thumbnail")) return;
  const doc = app._getPlaceableFromElement(li);
  const src = doc?.actor?.img ?? doc?.texture?.src;
  if (!src) return;
  const img = li.ownerDocument.createElement("img");
  img.className = "thumbnail";
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.draggable = false;
  li.prepend(img);
  li.classList.add("advanced-interface-card-thumbnail");
}

function decoratePlaceableEntries(app, element) {
  const always = app.collectionName === "tiles" ? ["hidden", "locked"] : ["hidden"];
  for (const group of element.querySelectorAll(".placeable-group[data-category]")) {
    const iconClass = `advanced-interface-placeable-icon ${wallCategoryIcon(group.dataset.category)}`;
    for (const icon of group.querySelectorAll(".advanced-interface-placeable-icon")) icon.className = iconClass;
  }
  for (const group of element.querySelectorAll(".placeable-group:is([data-author-id], [data-category])")) {
    group.querySelector(":scope > .group-header")?.classList.add("advanced-interface-placeable-bar");
  }
  if (app.collectionName === "tokens") {
    for (const li of element.querySelectorAll(".placeable-entry.token[data-entry-id]")) placeableThumbnail(app, li);
  }
  for (const li of element.querySelectorAll(".placeable-entry[data-entry-id]")) {
    if (li.querySelector(".advanced-interface-placeable-toggle")) continue;
    const doc = app._getPlaceableFromElement(li);
    const description = li.querySelector(":scope > .description");
    const keys = new Set(always.filter(key => app.schema?.has?.(key) ?? true));
    for (const icon of description?.querySelectorAll(":scope > .meta-icon") ?? []) {
      if (icon.classList.contains("fa-eye-slash")) keys.add("hidden");
      else if (icon.classList.contains("fa-lock")) keys.add("locked");
      else continue;
      icon.remove();
    }
    for (const icon of description?.querySelectorAll(":scope > .meta-icon") ?? []) {
      const button = createButton(li.ownerDocument, `ui-control icon ${[...icon.classList]
        .filter(c => c.startsWith("fa-") && c !== "fa-fw").join(" ")} advanced-interface-placeable-indicator`, {
        label: icon.getAttribute("aria-label") ?? ""
      });
      button.disabled = true;
      icon.replaceWith(button);
    }
    if (li.classList.contains("region")) {
      for (const meta of description?.querySelectorAll(":scope > .meta") ?? []) regionRange(app, li, meta);
    }
    if (!keys.size) continue;
    let controls = li.querySelector(":scope > .controls");
    if (!controls) {
      controls = li.ownerDocument.createElement("div");
      controls.className = "controls";
      li.append(controls);
    }
    for (const key of ["hidden", "locked"]) {
      if (keys.has(key)) controls.append(placeableToggle(app, li, doc, key));
    }
  }
}

const folderCreateExpanders = new WeakSet();
const folderIconObservers = new WeakSet();

function decorateFolderSorting(app, element) {
  const folders = app.tabName === "compendium" ? game.packs.folders : app.collection?.folders;
  for (const row of element.querySelectorAll(".directory-item.folder[data-folder-id]")) {
    const folder = folders?.get(row.dataset.folderId);
    const header = row.querySelector(":scope > .folder-header");
    if (!folder || !header) continue;
    let button = header.querySelector(":scope > .advanced-interface-folder-sort");
    if (!button) {
      button = createButton(element.ownerDocument, "ui-control inline-control toggle-sort icon fa-solid advanced-interface-folder-sort", {
        context: "Folder sorting",
        onClick: async () => {
          if (button.disabled) return;
          button.disabled = true;
          try {
            await folder.update({sorting: folder.sorting === "a" ? "m" : "a"});
          } finally {
            button.disabled = !folder.canUserModify(game.user, "update");
          }
        }
      });
      const create = header.querySelector('[data-action="createFolder"], [data-action="createEntry"]');
      if (create) create.before(button);
      else header.append(button);
    }
    const alphabetical = folder.sorting === "a";
    button.classList.toggle("fa-arrow-down-a-z", alphabetical);
    button.classList.toggle("fa-arrow-down-short-wide", !alphabetical);
    setButtonLabel(button, game.i18n.localize(alphabetical ? "SIDEBAR.SortModeAlpha" : "SIDEBAR.SortModeManual"));
    button.disabled = !folder.canUserModify(game.user, "update");
  }
}

function expandFolderBeforeCreate(event) {
  const button = event.target.closest('.folder-header :is([data-action="createFolder"], [data-action="createEntry"])');
  const folder = button?.closest(".directory-item.folder");
  if (!folder || folder.classList.contains("expanded")) return;
  folder.classList.add("expanded");
  if (folder.dataset.uuid) game.folders._expanded[folder.dataset.uuid] = true;
}

function decorateDocumentDirectoryCards(app, element) {
  const documentConfig = CONFIG[app.documentName];
  if (!documentConfig || typeof app.collection?.get !== "function") return;
  for (const entry of element.querySelectorAll(".directory-item.entry.document[data-entry-id]")) {
    const document = app.collection.get(entry.dataset.entryId);
    if (!document) continue;
    const iconClass = documentConfig.typeIcons?.[document.type] ?? documentConfig.sidebarIcon;
    if (!iconClass) continue;
    let icon = entry.querySelector(":scope > .advanced-interface-document-icon, :scope > .advanced-interface-scene-title-icon, :scope > .advanced-interface-journal-icon");
    if (!icon) icon = element.ownerDocument.createElement("i");
    icon.className = `${iconClass} advanced-interface-document-icon`;
    if (entry.classList.contains("scene")) icon.classList.add("advanced-interface-scene-title-icon");
    if (entry.classList.contains("journalentry")) icon.classList.add("advanced-interface-journal-icon");
    icon.setAttribute("aria-hidden", "true");
    const label = entry.querySelector(":scope > .entry-name");
    if (label) label.before(icon);
    else entry.prepend(icon);
  }
  decorateDocumentIcons(element);
  decoratePrimaryPartyButtons(app, element);
}

// The dnd5e Set/Remove Primary Party menu options become a toggle beside each group card's menu button.
function decoratePrimaryPartyButtons(app, element) {
  if (game.system.id !== "dnd5e" || app.documentName !== "Actor" || !game.user.isGM) return;
  for (const entry of element.querySelectorAll(".directory-item.entry.document[data-entry-id]")) {
    const actor = app.collection.get(entry.dataset.entryId);
    let button = entry.querySelector(":scope > .advanced-interface-primary-party-button");
    if (actor?.type !== "group") {
      button?.remove();
      continue;
    }
    if (!button) {
      button = createButton(element.ownerDocument, "ui-control icon fa-solid fa-star advanced-interface-primary-party-button", {
        context: "Toggle primary party",
        onClick: () => {
          const target = game.actors.get(entry.dataset.entryId);
          return game.settings.set("dnd5e", "primaryParty", {actor: target === game.actors.party ? null : target});
        }
      });
      entry.append(button);
    }
    const primary = actor === game.actors.party;
    setButtonLabel(button, game.i18n.localize(primary ? "DND5E.Group.Primary.Remove" : "DND5E.Group.Primary.Set"));
    button.setAttribute("aria-pressed", String(primary));
  }
}

Hooks.on("renderAbstractSidebarTab", (app, element) => {
  if (isManagedSidebarTab(app) || element.classList.contains("compendium-directory")) setSearchPlaceholders(element);
  element.classList.toggle("advanced-interface-native-panel", !isManagedSidebarTab(app));
  if (!isManagedSidebarTab(app)) return;
  if (element.classList.contains("compendium-directory")) return;
  decorateFolderIcons(element);
  decorateFolderSorting(app, element);
  if (!folderIconObservers.has(element)) {
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target.matches(".directory-item.folder"))) decorateFolderIcons(element);
    });
    observer.observe(element, {subtree: true, attributes: true, attributeFilter: ["class"]});
    folderIconObservers.add(element);
  }
  decorateDocumentDirectoryCards(app, element);
  if (!folderCreateExpanders.has(element)) {
    element.addEventListener("click", expandFolderBeforeCreate, {capture: true});
    folderCreateExpanders.add(element);
  }
  element.classList.toggle("advanced-interface-chat-style", app.tabName !== "chat");
  const header = element.querySelector(":scope > header.directory-header, :scope > .window-content > header.directory-header");
  const search = header?.querySelector("search");
  const actions = header?.querySelector(".header-actions");
  if (!search || !actions) return;
  const buttons = [
    ...actions.querySelectorAll('button[data-action="createFolder"]'),
    ...actions.querySelectorAll('button[data-action="createEntry"]')
  ];
  for (const button of buttons) {
    const icon = button.querySelector("i");
    if (!icon) throw new Error("Advanced Interface | Directory creation button is missing its icon.");
    button.setAttribute("aria-label", button.textContent.trim());
    button.setAttribute("data-tooltip", "");
    button.classList.add("icon", "icon-plus", "advanced-interface-create", ...icon.classList);
    button.replaceChildren();
  }
  const collapse = search.querySelector('[data-action="collapseFolders"]');
  if (collapse) collapse.after(...buttons);
  else search.append(...buttons);
  if (buttons.length) search.classList.add("advanced-interface-search");
  if (!actions.childElementCount) actions.remove();
});

// The Players tab's party-sheet button and the actor cards' primary-party toggles follow the dnd5e primary party.
// They are updated in place: re-rendering the whole sidebar for this took about two seconds.
function syncPrimaryParty() {
  const party = game.actors.party;
  const accessible = !!party?.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED);
  for (const doc of sidebarDocuments()) {
    for (const button of doc.querySelectorAll(".advanced-interface-party-sheet")) button.disabled = !accessible;
    for (const button of doc.querySelectorAll(".advanced-interface-primary-party-button")) {
      const id = button.closest("[data-entry-id]")?.dataset.entryId;
      const primary = !!party && id === party.id;
      setButtonLabel(button, game.i18n.localize(primary ? "DND5E.Group.Primary.Remove" : "DND5E.Group.Primary.Set"));
      button.setAttribute("aria-pressed", String(primary));
    }
  }
}

Hooks.on("updateSetting", setting => {
  if (setting.key === "dnd5e.primaryParty") syncPrimaryParty();
});
for (const hook of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(hook, actor => {
    if (game.system.id === "dnd5e" && actor.type === "group") syncPrimaryParty();
  });
}

// A card whose name opens its document opens it from any spot that is not a control (thumbnail, icon, blank space).
document.addEventListener("click", event => {
  if (event.button !== 0 || event.defaultPrevented) return;
  const card = event.target.closest?.(".advanced-interface-chat-style .directory-item.entry");
  if (!card || card.classList.contains("advanced-interface-card-menu-open")) return;
  if (event.target.closest("button, a, input, select, textarea, label, [data-action], [role='button'], .advanced-interface-card-actions")) return;
  card.querySelector(":scope > .entry-name[data-action='activateEntry']")?.click();
});
