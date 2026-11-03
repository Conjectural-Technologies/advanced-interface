import {MODULE_ID, cloneWithButtonActions, createIcon, setButtonLabel} from "./helper.mjs";

const localize = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);
const FLAG_KEY = "tokenNavigation";
const navigationEnabled = token => token.getFlag(MODULE_ID, FLAG_KEY) === true;
const navigationExpanded = {actors: true, items: true};
const pendingDirectories = new WeakSet();
const navigationApps = tab => tab === "items" ? [ui.items, ui.items?.popout] : [ui.actors, ui.actors?.popout];
const allNavigationApps = () => [...navigationApps("actors"), ...navigationApps("items")];
// Object tokens are backed by items, so they belong to the Items panel.
const isItemToken = token => token.actor?.flags?.["advanced-items"]?.object === true;

function navigationTokens(tab) {
  return (canvas.ready ? canvas.tokens.placeables : []).filter(token =>
    navigationEnabled(token.document) && token.visible && token.document.actor
    && isItemToken(token.document) === (tab === "items")
    && token.document.actor.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED));
}

export function refreshActorNavigationVisibility() {
  for ( const app of allNavigationApps() ) {
    if ( !app?.rendered ) continue;
    const ids = new Set(navigationTokens(app.tabName).map(token => token.id));
    const list = app.element.querySelector(".advanced-interface-actor-navigation-list");
    const entries = [...(list?.children ?? [])];
    if ( !list || entries.length !== ids.size
      || entries.some(entry => !ids.has(entry.dataset.tokenId)) ) {
      onRenderNavigationDirectory(app, app.element);
    }
  }
}

export function refreshActorDirectories() {
  for ( const app of allNavigationApps() ) {
    if ( app?.rendered ) onRenderNavigationDirectory(app, app.element);
  }
}

function selectNavigationToken(document) {
  const token = canvas.ready && document.parent === canvas.scene ? canvas.tokens.get(document.id) : null;
  if ( !token?.isOwner || !token.isInteractable || !token.control({ releaseOthers: true }) ) {
    ui.notifications.warn(localize("ADVANCED_INTERFACE.ActorNavigationUnavailable", { name: document.name }));
    return;
  }
  canvas.animatePan(token.center);
}

function createNavigationEntry(card, token, doc, tab) {
  const actor = token.actor;
  const entry = card ? cloneWithButtonActions(card) : doc.createElement("li");
  if ( !card ) {
    entry.className = `directory-item entry document ${tab === "items" ? "item" : "actor"} flexrow`;
    const image = doc.createElement("img");
    image.className = "thumbnail";
    image.src = actor.img;
    image.alt = token.name;
    const name = doc.createElement("span");
    name.className = "entry-name";
    entry.append(image, name);
  }
  entry.dataset.entryId = actor.id;
  entry.dataset.tokenId = token.id;
  entry.classList.add("advanced-interface-actor-navigation-entry");
  entry.classList.remove("active", "context", "advanced-interface-card-menu-open");
  entry.style.removeProperty("display");
  entry.removeAttribute("draggable");
  entry.querySelectorAll(".advanced-interface-card-menu-button, "
    + ".advanced-interface-actor-navigation-toggle, .advanced-interface-card-header-background")
    .forEach(button => button.remove());
  if ( token.isOwner ) entry.append(createNavigationToggle(entry.ownerDocument, token));
  entry.querySelectorAll(".advanced-interface-card-menu-hidden").forEach(child =>
    child.classList.remove("advanced-interface-card-menu-hidden"));
  const name = entry.querySelector(".entry-name");
  if ( name ) name.textContent = token.name;
  name?.removeAttribute("data-action");
  name?.setAttribute("role", "button");
  name?.setAttribute("tabindex", "0");
  const activate = event => {
    if ( event.target.closest("button, a:not(.entry-name), input, select, textarea, .advanced-interface-card-actions") ) return;
    event.preventDefault();
    event.stopPropagation();
    selectNavigationToken(token);
  };
  entry.addEventListener("click", activate);
  entry.addEventListener("keydown", event => {
    if ( event.key === "Enter" || event.key === " " ) activate(event);
  });
  return entry;
}

function updateNavigationToggle(button, token) {
  const active = navigationEnabled(token);
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("active", active);
  setButtonLabel(button, localize("ADVANCED_INTERFACE.Navigation"));
}

function createNavigationToggle(doc, token) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "ui-control plain icon fa-solid fa-compass advanced-interface-actor-navigation-toggle";
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if ( button.disabled ) return;
    button.disabled = true;
    try {
      if ( !token.isOwner ) throw new Error(localize("ADVANCED_INTERFACE.ActorNavigationUnavailable", { name: token.name }));
      await token.update({ [`flags.${MODULE_ID}.${FLAG_KEY}`]: !navigationEnabled(token) });
    } catch ( error ) {
      console.error(`${MODULE_ID} | Could not update token navigation for "${token.name}".`, error);
      ui.notifications.error(localize("ADVANCED_INTERFACE.ActorNavigationUpdateFailed", {
        name: token.name,
        error: error?.message ?? String(error)
      }));
    } finally {
      button.disabled = false;
      updateNavigationToggle(button, token);
      refreshActorDirectories();
    }
  });
  updateNavigationToggle(button, token);
  return button;
}

function createNavigationGroup(app, directory, element) {
  const doc = element.ownerDocument;
  const tab = app.tabName;
  const group = doc.createElement("section");
  group.className = "advanced-interface-actor-navigation";

  const header = doc.createElement("header");
  header.className = "advanced-interface-actor-navigation-heading";
  const label = doc.createElement("span");
  label.textContent = localize("ADVANCED_INTERFACE.Navigation");

  const list = doc.createElement("ol");
  list.className = "plain advanced-interface-actor-navigation-list";
  list.id = `${app.id}-navigation-entries`;

  const shutter = doc.createElement("button");
  shutter.type = "button";
  shutter.className = "ui-control icon fa-solid fa-chevron-up advanced-interface-player-shutter advanced-interface-actor-navigation-shutter";
  setButtonLabel(shutter, label.textContent);
  shutter.setAttribute("aria-controls", list.id);
  shutter.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    navigationExpanded[tab] = !navigationExpanded[tab];
    for ( const app of navigationApps(tab) ) {
      if ( !app?.rendered || app.element.ownerDocument !== doc ) continue;
      for ( const panel of app.element.querySelectorAll(".advanced-interface-actor-navigation") ) {
        const panelList = panel.querySelector(".advanced-interface-actor-navigation-list");
        const panelShutter = panel.querySelector(".advanced-interface-actor-navigation-shutter");
        panelShutter?.setAttribute("aria-expanded", String(navigationExpanded[tab]));
        if ( panelList ) panelList.hidden = !navigationExpanded[tab];
      }
    }
  });
  header.append(label, shutter);

  for ( const token of navigationTokens(tab) ) {
    const document = token.document;
    const card = directory.querySelector(`.directory-item.entry[data-entry-id="${document.actor.id}"]`);
    list.append(createNavigationEntry(card, document, doc, tab));
  }

  group.append(header, list);
  const container = directory.parentElement;
  const directoryHeader = container.querySelector(":scope > .directory-header");
  if ( directoryHeader ) directoryHeader.before(group);
  else directory.before(group);
  shutter.setAttribute("aria-expanded", String(navigationExpanded[tab]));
  list.hidden = !navigationExpanded[tab];
}

export function onRenderNavigationDirectory(app, element) {
  const directory = element.querySelector(".directory-list");
  if ( !directory ) return;

  if ( pendingDirectories.has(element) ) return;
  pendingDirectories.add(element);
  queueMicrotask(() => {
    pendingDirectories.delete(element);
    if ( !app.rendered || app.element !== element || !directory.parentElement ) return;
    directory.parentElement.querySelector(":scope > .advanced-interface-actor-navigation")?.remove();
    createNavigationGroup(app, directory, element);
  });
}

export function onRenderTokenNavigationHUD(app, element) {
  const token = app.object?.document;
  if ( !token?.isOwner || !token.actor ) return;
  element.querySelector(".advanced-interface-actor-navigation-toggle")?.remove();
  const button = createNavigationToggle(element.ownerDocument, token);
  button.className = "control-icon advanced-interface-actor-navigation-toggle";
  updateNavigationToggle(button, token);
  button.append(createIcon(element.ownerDocument, "fa-solid fa-compass"));
  element.querySelector(".col.right")?.append(button);
}

export function onTokenNavigationChange() {
  refreshActorDirectories();
  const hud = canvas.tokens?.hud;
  const token = hud?.object?.document;
  const button = hud?.element?.querySelector(".advanced-interface-actor-navigation-toggle");
  if ( token && button ) updateNavigationToggle(button, token);
}

export function clearTokenNavigation() {
  for ( const app of allNavigationApps() ) {
    app?.element?.querySelector(".advanced-interface-actor-navigation-list")?.replaceChildren();
  }
}
