import {decorateIconButtons} from "./interface-components.mjs";
import {localize} from "./helper.mjs";
import {getTokenBarColor, getTokenBarMetrics} from "./token-effects.mjs";

let barToken = null;

// Real user clicks on any interface button outside the HUDs dismiss the canvas HUDs.
export function registerHUDAutoClose() {
  document.addEventListener("click", event => {
    if ( !event.isTrusted || !(event.target instanceof Element) ) return;
    const target = event.target;
    if ( !target.closest("button, a[data-action], [role='button']") || target.closest(".placeable-hud, #board") ) return;
    for ( const hud of [canvas.hud?.token, canvas.hud?.tile, canvas.hud?.drawing] ) {
      if ( hud?.rendered ) hud.close();
    }
  }, true);
}

// Keeps canvas resource bars and the HUD button rows stacked with equal spacing below the highlight ring.
export function syncTokenHUDBars() {
  const hud = canvas.tokens?.hud;
  const open = !!hud?.object && hud.element?.isConnected;
  const token = open ? hud.object : null;
  const previous = barToken;
  barToken = token;
  if ( open ) {
    const {hudOffset} = getTokenBarMetrics(token);
    const top = hudOffset + 4;
    hud.element.style.setProperty("--advanced-interface-hud-rows-top", `calc(100% + ${top}px)`);
  }
  for ( const object of new Set([previous, token]) ) {
    if ( object && !object.destroyed ) object.renderFlags.set({refreshState: true, refreshBars: true});
  }
}

function getBarForeground(color) {
  const [red, green, blue] = color.rgb.map(channel => channel <= 0.04045
    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export function refreshTokenHUDBarBackgrounds(document) {
  const hud = canvas.tokens?.hud;
  if ( !hud?.object || !hud.element?.isConnected ) return;
  if ( document?.documentName === "Actor" && document !== hud.object.actor ) return;
  if ( document?.documentName === "Token" && document !== hud.object.document ) return;
  for ( const [index, key] of ["bar1", "bar2"].entries() ) {
    const attribute = hud.element.querySelector(`.attribute.${key}`);
    const input = attribute?.querySelector("input");
    if ( !input ) continue;
    const data = hud.object.document.getBarAttribute(key);
    const path = hud.object.document[key]?.attribute;
    if ( path ) {
      const label = hud.object.actor?.system?.schema?.getField(path.replace(/^system\./, ""))?.label;
      input.dataset.tooltip = label ? game.i18n.localize(label) : path;
    }
    else delete input.dataset.tooltip;
    if ( !data?.max ) {
      input.style.removeProperty("background");
      attribute.style.removeProperty("--advanced-interface-resource-foreground");
      continue;
    }
    const color = Color.from(getTokenBarColor(hud.object, index, data));
    input.style.background = color.css;
    attribute.style.setProperty("--advanced-interface-resource-foreground", getBarForeground(color));
  }
}

function arrangePlaceableHUD(element) {
  if ( element.querySelector(":scope > .advanced-interface-hud-rows") ) return;
  const doc = element.ownerDocument;
  const rows = doc.createElement("div");
  rows.className = "advanced-interface-hud-rows";
  const first = doc.createElement("div");
  const second = doc.createElement("div");
  first.className = second.className = "advanced-interface-hud-row";
  element.querySelector(".attribute.elevation > .caret")?.remove();
  const append = (row, control) => {
    if ( !control ) return;
    const slot = doc.createElement("div");
    slot.className = "advanced-interface-hud-slot";
    row.append(slot);
    slot.append(control);
    if ( control.dataset.palette ) {
      const palette = element.querySelector(`.palette[data-palette="${control.dataset.palette}"]`);
      if ( palette ) slot.append(palette);
    }
  };
  for ( const selector of [
    ".attribute.bar1:has(input)", ".attribute.bar2:has(input)", ".attribute.elevation",
    '[data-action="sort"]', '[data-action="locked"]', '[data-action="config"]'
  ] ) append(first, element.querySelector(selector));
  for ( const selector of [
    ".advanced-interface-actor-navigation-toggle", '[data-action="target"]', '[data-action="combat"]',
    '[data-action="visibility"]', '.control-icon[data-palette="movementActions"]',
    '.control-icon[data-palette="effects"]'
  ] ) append(second, element.querySelector(selector));
  // Preserve conditional level controls and controls supplied by other modules.
  for ( const control of element.querySelectorAll(":scope > .col > button, :scope > .col > .attribute:has(input)") ) {
    append(first, control);
  }
  if ( element.id === "token-hud" ) rows.append(first, second);
  else {
    first.append(...second.children);
    first.classList.add("advanced-interface-hud-wrapping-row");
    rows.append(first);
  }
  element.append(rows);
}

export function onRenderPlaceableHUDButtons(app, element) {
  element.classList.add("advanced-interface-placeable-hud");
  queueMicrotask(() => {
    if ( app.element !== element || !element.isConnected ) return;
    arrangePlaceableHUD(element);
    if ( app === canvas.tokens?.hud ) {
      refreshTokenHUDBarBackgrounds();
      syncTokenHUDBars();
    }
    for ( const image of element.querySelectorAll(".status-effects > img.effect-control") ) {
      const button = element.ownerDocument.createElement("button");
      button.type = "button";
      button.className = image.className;
      for ( const [key, value] of Object.entries(image.dataset) ) button.dataset[key] = value;
      button.setAttribute("aria-label", image.dataset.tooltipText ?? image.dataset.statusId);
      button.setAttribute("aria-pressed", String(image.classList.contains("active")));
      image.removeAttribute("data-action");
      image.className = "";
      image.alt = "";
      image.replaceWith(button);
      button.append(image);
    }
    for ( const entry of element.querySelectorAll(".palette-list-entry") ) {
      if ( entry.dataset.movementAction === "blink" ) {
        const label = localize("TokenHUD.Teleport");
        const content = entry.querySelector(":scope > span");
        for ( const node of content?.childNodes ?? [] ) {
          if ( node.nodeType === 3 && node.textContent.trim() ) node.textContent = label;
        }
        const image = entry.querySelector("img");
        if ( image ) image.alt = label;
      }
      entry.classList.add("button");
      let icon = entry.querySelector("i");
      if ( !icon && !entry.querySelector("img") ) {
        icon = element.ownerDocument.createElement("i");
        icon.className = "fa-solid fa-layer-group";
      }
      if ( icon ) {
        if ( !icon.className.match(/\bfa-(solid|regular|brands)\b/) ) icon.className = "fa-solid fa-arrow-rotate-left";
        icon.setAttribute("aria-hidden", "true");
        entry.prepend(icon);
      }
    }
    for ( const button of element.querySelectorAll("button:has(> img), .palette-list-entry:has(> span > img)") ) {
      const image = button.querySelector("img");
      button.classList.add("advanced-interface-hud-image-button");
      button.style.setProperty("--advanced-interface-hud-image", `url("${image.src}")`);
      if ( !button.querySelector(":scope > .advanced-interface-hud-image-disc") ) {
        const disc = element.ownerDocument.createElement("span");
        disc.className = "advanced-interface-hud-image-disc";
        disc.setAttribute("aria-hidden", "true");
        button.append(disc);
      }
    }
    decorateIconButtons(element);
  });
}
