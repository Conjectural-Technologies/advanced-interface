import {createButton, isManagedSidebarTab, localize, reportError, sidebarDocuments} from "./helper.mjs";

let decoratedButtons = new WeakMap();
const BUTTON_ICON = ":scope > i, :scope > .fa-solid, :scope > .fa-regular, :scope > .fa-brands";
export const ICON_BUTTONS = "button, a.button, .context-item";

function nativePanelContent(element) {
  if (element.closest(".chat-message > .message-content")) return true;
  const panel = element.closest(".sidebar-tab");
  return panel && !isManagedSidebarTab({tabName: panel.dataset.tab ?? panel.id.replace(/-popout$/, "")});
}

function glyph(style) {
  const content = style.content;
  return content?.match(/^["'](.*?)["']/)?.[1] ?? "";
}

function buttonSignature(button) {
  const classes = element => [...element.classList].filter(name =>
    !["active", "context", "hovered", "focused", "advanced-interface-card-menu-open"].includes(name)).join(" ");
  const icon = button.querySelector(BUTTON_ICON);
  return `${classes(button)}|${icon ? classes(icon) : ""}`;
}

export function decorateIconButtons(root) {
  const roots = Array.isArray(root) ? root : [root];
  if (!roots.length) return;
  const doc = roots[0].ownerDocument;
  const view = doc.defaultView;
  const buttons = [];
  const candidates = new Set(roots.flatMap(element => [
    ...(element.matches(ICON_BUTTONS) ? [element] : []),
    ...element.querySelectorAll(ICON_BUTTONS)
  ]).filter(button => !nativePanelContent(button) && !button.matches(".advanced-interface-calendar-day, .slot")));
  for (const button of candidates) {
    const icon = button.classList.contains("fa-copy") ? button : button.querySelector(BUTTON_ICON);
    if (!icon?.classList.contains("fa-copy")) continue;
    const classes = ["fa-regular", "fa-light", "fa-thin", "fa-duotone"]
      .filter(name => icon.classList.contains(name));
    if (classes.length) icon.classList.remove(...classes);
    if (!icon.classList.contains("fa-solid")) icon.classList.add("fa-solid");
  }
  for (const button of candidates) {
    const signature = buttonSignature(button);
    // Recheck changed icon classes; highlight states and shutter flips are handled by CSS.
    if (decoratedButtons.get(button) === signature
      && button.querySelector(":scope > .advanced-interface-icon-disc")) continue;
    if (!button.getClientRects().length) continue;
    const icon = glyph(view.getComputedStyle(button, "::before")) ? button
      : button.querySelector(BUTTON_ICON);
    if (!icon) continue;
    buttons.push({button, icon});
  }
  // Read styles before applying decorations to avoid a layout flush for every button.
  const decorations = buttons.map(({button, icon}) => {
    const style = view.getComputedStyle(icon, "::before");
    const iconGlyph = glyph(style);
    if (!iconGlyph) return null;
    const badgeStyle = view.getComputedStyle(button, "::after");
    const badge = glyph(badgeStyle);
    const hasBadge = badge && badge !== iconGlyph;
    const buttonStyle = view.getComputedStyle(button);
    const insets = ["top", "left"].map(side =>
      [side, `${-parseFloat(buttonStyle.getPropertyValue(`border-${side}-width`))}px`]);
    return {button, icon, insets, hasBadge};
  });
  for (const decoration of decorations) {
    if (!decoration) continue;
    const {button, icon, insets, hasBadge} = decoration;
    button.classList.toggle("advanced-interface-badged-button", !!hasBadge);
    for (const [side, inset] of insets) {
      const property = `--advanced-interface-disc-${side}`;
      if (button.style.getPropertyValue(property) !== inset) button.style.setProperty(property, inset);
    }
    if (!button.classList.contains("advanced-interface-cutout-button")) {
      button.classList.add("advanced-interface-cutout-button");
    }
    if (icon !== button && !icon.classList.contains("advanced-interface-cutout-icon")) {
      icon.classList.add("advanced-interface-cutout-icon");
    }
    if (!button.querySelector(":scope > .advanced-interface-icon-disc")) {
      const disc = doc.createElement("span");
      disc.className = "advanced-interface-icon-disc";
      disc.ariaHidden = "true";
      button.append(disc);
    }
    decoratedButtons.set(button, buttonSignature(button));
  }
}

export function decoratePlaylistSoundIcons(root) {
  decorateCardIcons(root.querySelectorAll(".sound > header > i, .playlist > .playlist-header > i.expand"));
}

// Leading icons of bars and cards get the highlight disc behind their glyph.
export function decorateLeadingIcons(icons, decorationClass) {
  decorateCardIcons(icons, decorationClass);
}

export function decoratePlaceableRowIcons(root) {
  decorateCardIcons(root.querySelectorAll(":is(.placeable-entry, .group-header) .advanced-interface-placeable-icon"),
    "advanced-interface-placeable-row-icon");
}

export function decoratePlaceableSearchIcons(root) {
  decorateCardIcons(root.querySelectorAll("search > .advanced-interface-placeable-icon"), "advanced-interface-search-icon");
}

export function decorateDocumentIcons(root) {
  decorateCardIcons(root.querySelectorAll(".advanced-interface-document-icon"), "advanced-interface-document-icon");
}

export function decorateFolderIcons(root) {
  decorateCardIcons(root.querySelectorAll(".folder-header > i"), "advanced-interface-folder-icon");
}

export function decorateCompendiumIcons(root) {
  decorateCardIcons(root.querySelectorAll(".compendium-name > i"), "advanced-interface-compendium-icon");
}

export function decorateCalendarIcons(root) {
  decorateCardIcons(root.querySelectorAll(".advanced-interface-calendar-icon"), "advanced-interface-calendar-icon");
}

function decorateCardIcons(icons, decorationClass = "advanced-interface-sound-icon", attempt = 0) {
  for (const icon of icons) {
    if (icon.classList.contains("fa-thin")) {
      icon.classList.replace("fa-thin", "fa-solid");
    }
  }
  const decorations = [...icons].map(icon => ({
    icon, ready: [...icon.classList].some(name =>
      ["fa-solid", "fa-regular", "fa-brands", "fa-duotone", "fa-light", "fa-thin"].includes(name))
      || !!glyph(icon.ownerDocument.defaultView.getComputedStyle(icon, "::before"))
  }));
  // Icons rendered before their panel is attached have no computed glyph yet; retry once they are in the document.
  const pending = decorations.filter(({ready}) => !ready).map(({icon}) => icon);
  if (pending.length && attempt < 10) {
    pending[0].ownerDocument.defaultView.requestAnimationFrame(() =>
      decorateCardIcons(pending.filter(icon => icon.isConnected || attempt < 5), decorationClass, attempt + 1));
  }
  for (const {icon, ready} of decorations) {
    if (!ready) continue;
    if (decorationClass && !icon.classList.contains(decorationClass)) icon.classList.add(decorationClass);
    if (!icon.querySelector(":scope > .advanced-interface-icon-disc")) {
      const disc = icon.ownerDocument.createElement("span");
      disc.className = "advanced-interface-icon-disc";
      disc.ariaHidden = "true";
      icon.append(disc);
    }
  }
}

export function createPartySheetButton(doc, className) {
  const button = createButton(doc, `${className} fa-solid fa-users advanced-interface-party-sheet`, {
    label: localize("PrimaryPartySheet"),
    context: "Open party sheet",
    onClick: async () => {
      const actor = game.actors.party;
      if (!actor?.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED)) {
        throw new Error("Advanced Interface | No accessible default party is configured.");
      }
      await actor.sheet.render({force: true});
    }
  });
  button.disabled = !game.actors.party?.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED);
  button.setAttribute("aria-pressed", String(!!game.actors.party?.sheet?.rendered));
  return button;
}

function syncPartyButton(closing) {
  const sheet = game.actors.party?.sheet;
  for (const doc of sidebarDocuments()) {
    for (const button of doc.querySelectorAll(".advanced-interface-party-sheet")) {
      button.disabled = !game.actors.party?.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED);
      button.setAttribute("aria-pressed", String(!!sheet?.rendered && closing !== sheet));
    }
  }
}

export function registerInterfaceComponents() {
  Hooks.once("ready", () => {
    const setAnchor = game.tooltip._setAnchor;
    // Tooltips open below their element, flipping above when there is no room below.
    game.tooltip._setAnchor = function(direction, ...args) {
      const directions = this.constructor.TOOLTIP_DIRECTIONS;
      if (this.element) {
        const rect = this.element.getBoundingClientRect();
        const below = rect.bottom + this.constructor.TOOLTIP_MARGIN_PX + this.tooltip.offsetHeight;
        direction = below > this.tooltip.ownerDocument.defaultView.innerHeight ? directions.UP : directions.DOWN;
      }
      return setAnchor.call(this, direction, ...args);
    };
  });
  Hooks.on("renderActorSheet", () => syncPartyButton());
  Hooks.on("closeActorSheet", app => syncPartyButton(app));
  Hooks.on("renderApplicationV2", app => {
    if (app.document === game.actors.party) syncPartyButton();
  });
  Hooks.on("closeApplicationV2", app => {
    if (app.document === game.actors.party) syncPartyButton(app);
  });
  Hooks.on("renderSidebar", () => syncPartyButton());
  Hooks.once("ready", () => document.fonts.ready.then(() => {
    decoratedButtons = new WeakMap();
    for (const root of document.querySelectorAll("#sidebar, .sidebar-popout, .advanced-interface-player-window")) {
      decorateIconButtons(root);
      decorateCardIcons(root.querySelectorAll("i:has(> .advanced-interface-icon-disc):not(.advanced-interface-cutout-icon)"), "");
    }
  }).catch(reportError("Components")));
}

// Browsers don't send pointer events to disabled controls, so core never shows their tooltips. Track the pointer and
// show those tooltips through the tooltip manager instead.
function watchDisabledTooltips() {
  let current = null;
  let timer = null;
  let frame = null;
  let point = null;
  const clear = () => {
    window.clearTimeout(timer);
    timer = null;
  };
  const update = () => {
    frame = null;
    const element = point && document.elementFromPoint(point.x, point.y)
      ?.closest("button:disabled, a.button.disabled, [aria-disabled='true']");
    const label = element && (element.dataset.tooltip || element.dataset.tooltipText || element.dataset.tooltipHtml
      || element.ariaLabel);
    const target = label ? element : null;
    if (target === current) return;
    clear();
    if (current && game.tooltip.element === current) game.tooltip.deactivate();
    current = target;
    if (!target) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (current === target && target.isConnected) game.tooltip.activate(target);
    }, game.tooltip.constructor.TOOLTIP_ACTIVATION_MS ?? 500);
  };
  document.body.addEventListener("pointermove", event => {
    point = {x: event.clientX, y: event.clientY};
    frame ??= window.requestAnimationFrame(update);
  }, {capture: true, passive: true});
  document.addEventListener("pointerleave", () => {
    point = null;
    frame ??= window.requestAnimationFrame(update);
  });
}

Hooks.once("ready", () => watchDisabledTooltips());
