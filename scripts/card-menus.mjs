import {decorateIconButtons} from "./interface-components.mjs";
import {isManagedSidebarTab, localize} from "./helper.mjs";

// Sidebar cards get an Options button; their context menu opens as inline actions in the card's top row.
const CARD_MENU_ROOTS = "#sidebar, .sidebar-tab, .placeable-tab, #players, .advanced-interface-player-window, .chat-popout";
const CARD_THUMBNAILS = ":scope > :is(img.thumbnail, img.token-image, img.advanced-interface-player-avatar)";

const CARD_TOP_ROW_KEEP = "img.thumbnail, img.token-image, img.advanced-interface-player-avatar, .message-sender .avatar, .compendium-banner, .advanced-interface-scene-background";
const SCENE_ACTION_LABELS = {
  navigation: "SCENE.ToggleNav",
  activate: "SCENE.Activate",
  view: "SCENE.View"
};

function normalizedLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function removeDuplicateCardActions(items, card) {
  const labels = new Set();
  for (const button of card.querySelectorAll("button:not(.advanced-interface-card-menu-button)")) {
    const label = button.getAttribute("aria-label") || button.dataset.tooltip;
    if (label) labels.add(normalizedLabel(label));
    const sceneLabel = SCENE_ACTION_LABELS[button.dataset.sceneAction];
    if (sceneLabel) labels.add(normalizedLabel(game.i18n.localize(sceneLabel)));
  }
  if (!labels.size) return items;
  return items.filter(item => {
    const label = item.label ?? item.name;
    if (typeof label !== "string") return true;
    return !labels.has(normalizedLabel(game.i18n.localize(label)));
  });
}

// Measure before hiding content so each child does not force another layout.
function hideCardContent(row, button, menu) {
  // Measure from inside the top border so accent borders (chat cards) don't push the header out of the top row.
  const top = row.getBoundingClientRect().top + row.clientTop;
  const doc = row.ownerDocument;
  const bottom = menu ? menu.getBoundingClientRect().bottom - top : 33;
  if (menu && bottom <= 33) return;
  const hidden = [];
  const text = [];
  const visit = parent => {
    // Loose text in a container that also spans lower rows is wrapped so it can be hidden on its own.
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (menu ? rect.top - top >= bottom - 1 || rect.bottom - top <= 33
        : !rect.width || rect.top - top >= 31) continue;
      text.push(node);
    }
    for (const child of parent.children) {
      if (child === button || child === menu || child.id === "context-menu"
        || child.matches(".advanced-interface-card-menu-hidden, .advanced-interface-card-header-background")
        || child.matches(CARD_TOP_ROW_KEEP)) continue;
      if (child.classList.contains("advanced-interface-card-menu-text")) continue;
      const rect = child.getBoundingClientRect();
      // Boxless containers (display: contents) still hold top-row content.
      if (!rect.width && !rect.height) {
        if (child.childElementCount || child.textContent.trim()) visit(child);
        continue;
      }
      if (menu ? rect.top - top >= bottom - 1 || rect.bottom - top <= 33 : rect.top - top >= 31) continue;
      if ((rect.bottom - top <= bottom + (menu ? 1 : 0) || (menu && !child.childElementCount))
        && !child.contains(button) && !child.contains(menu) && !child.querySelector(CARD_TOP_ROW_KEEP)) hidden.push(child);
      else visit(child);
    }
  };
  visit(row);
  for (const node of text) {
    const wrapper = doc.createElement("span");
    wrapper.className = "advanced-interface-card-menu-text advanced-interface-card-menu-hidden";
    node.replaceWith(wrapper);
    wrapper.append(node);
  }
  for (const child of hidden) child.classList.add("advanced-interface-card-menu-hidden");
}

// Grow the card when its actions wrap past its height, so every row of actions stays visible.
function fitCardActions(row, menu, availableWidth) {
  if (menu.querySelectorAll(".context-item").length * 32 <= availableWidth) {
    row.style.setProperty("--advanced-interface-card-header-height", "32px");
    return false;
  }
  const needed = Math.ceil(menu.getBoundingClientRect().bottom - row.getBoundingClientRect().top - row.clientTop);
  row.style.setProperty("--advanced-interface-card-header-height", `${Math.max(32, needed)}px`);
  // A single row of actions never grows the card, even when a border leaves slightly less than 32px inside.
  if (menu.getBoundingClientRect().height <= 33) return false;
  // Standard 32px action rows fit the card's outer height; do not add its borders again.
  if (needed <= row.offsetHeight) return true;
  const height = `${needed + row.offsetHeight - row.clientHeight}px`;
  // Thumbnails and backgrounds keep their height and fade out at the bottom instead of stretching.
  const media = [...row.querySelectorAll(CARD_TOP_ROW_KEEP)].filter(el => !menu.contains(el))
    .map(el => [el, el.getBoundingClientRect().height, getComputedStyle(el).maskImage]);
  row.dataset.advancedInterfaceActionsHeight = "true";
  for (const prop of ["height", "min-height", "max-height"]) row.style.setProperty(prop, height, "important");
  const fade = "linear-gradient(to bottom, #000 calc(100% - 16px), transparent)";
  for (const [el, mediaHeight, mask] of media) {
    if (!mediaHeight) continue;
    el.classList.add("advanced-interface-card-actions-media");
    for (const prop of ["height", "min-height", "max-height"]) el.style.setProperty(prop, `${mediaHeight}px`, "important");
    el.style.setProperty("align-self", "flex-start", "important");
    el.style.setProperty("mask-image", mask && mask !== "none" ? `${mask}, ${fade}` : fade, "important");
    el.style.setProperty("mask-composite", "intersect", "important");
  }
  return true;
}

function revealCardTopRow(row) {
  row?.style.removeProperty("--advanced-interface-card-header-height");
  if (row?.dataset.advancedInterfaceActionsHeight) {
    delete row.dataset.advancedInterfaceActionsHeight;
    for (const prop of ["height", "min-height", "max-height"]) row.style.removeProperty(prop);
    for (const el of row.querySelectorAll(".advanced-interface-card-actions-media")) {
      el.classList.remove("advanced-interface-card-actions-media");
      for (const prop of ["height", "min-height", "max-height", "align-self", "mask-image", "mask-composite"]) el.style.removeProperty(prop);
    }
  }
  for (const wrapper of row?.querySelectorAll(".advanced-interface-card-menu-text") ?? []) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const el of row?.querySelectorAll(".advanced-interface-card-menu-hidden") ?? []) {
    el.classList.remove("advanced-interface-card-menu-hidden");
  }
}

function watchCardHeaderTint() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  const tints = new Map();
  const pending = new Set();
  let frame;
  const update = () => {
    frame = undefined;
    const colors = [...pending].filter(card => card.isConnected).map(card => {
      const label = card.querySelector(".folder-name, .entry-name, .compendium-name strong, .combatant-name, .player-name, .message-sender, .playlist-name, .label")
        ?? card;
      return {card, color: getComputedStyle(label).color};
    });
    pending.clear();
    for (const {card, color} of colors) {
      if (!tints.has(color)) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        tints.set(color, (0.299 * r + 0.587 * g + 0.114 * b) >= 128 ? "0 0 0" : "255 255 255");
      }
      if (card.style.getPropertyValue("--advanced-interface-card-header-color") !== color) {
        card.style.setProperty("--advanced-interface-card-header-color", color);
      }
      const tint = tints.get(color);
      if (card.style.getPropertyValue("--advanced-interface-card-header-tint") !== tint) {
        card.style.setProperty("--advanced-interface-card-header-tint", tint);
      }
    }
  };
  const queue = card => {
    if (!card) return;
    pending.add(card);
    frame ??= requestAnimationFrame(update);
  };
  const queueCards = root => {
    if (root.matches(".advanced-interface-card")) queue(root);
    for (const card of root.querySelectorAll(".advanced-interface-card")) queue(card);
  };
  queueCards(document.body);
  document.addEventListener("transitionend", event => {
    if (event.propertyName !== "color" || !(event.target instanceof Element)) return;
    queue(event.target.closest(".advanced-interface-card"));
  });
  document.addEventListener("pointerover", event => {
    if (!(event.target instanceof Element)) return;
    let card = event.target.closest(".advanced-interface-card");
    while (card) {
      if (!card.contains(event.relatedTarget)) queue(card);
      card = card.parentElement?.closest(".advanced-interface-card");
    }
  }, {passive: true});
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") {
        if (record.target instanceof Element) queue(record.target.closest(".advanced-interface-card"));
        for (const node of record.addedNodes) {
          if (node instanceof Element) queueCards(node);
        }
        continue;
      }
      queue(record.target.closest(".advanced-interface-card"));
      const previous = record.oldValue?.match(/\btheme-(?:light|dark)\b/)?.[0];
      const current = record.target.getAttribute("class")?.match(/\btheme-(?:light|dark)\b/)?.[0];
      if (previous !== current) queueCards(record.target);
    }
  }).observe(document.body, {childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true});
}

export function registerCardMenus() {
  Hooks.once("ready", watchCardHeaderTint);
  const Base = CONFIG.ux.ContextMenu;
  CONFIG.ux.ContextMenu = class CardContextMenu extends Base {
    #cards = false;
    #rowMenu = false;
    #target;
    #row;
    #actionsWidth;
    constructor(container, selector, items, options = {}) {
      const root = container instanceof HTMLElement ? container : container[0];
      const panel = root.closest(".sidebar-tab");
      const inSidebar = !!root.closest(CARD_MENU_ROOTS) && !root.closest(".compendium-directory, #hotbar")
        && (!panel || isManagedSidebarTab({tabName: panel.dataset.tab ?? panel.id.replace(/-popout$/, "")}));
      const rowMenu = inSidebar && options.eventName === "click" && selector === ".encounter-context-menu";
      const managed = inSidebar && (rowMenu || options.eventName !== "click");
      if (managed && game.system.id === "dnd5e" && Array.isArray(items)) {
        items = items.filter(item => !String(item.label ?? item.name ?? "").startsWith("DND5E.Group.Primary."));
      }
      super(container, selector, items,
        managed && !rowMenu ? {...options, fixed: false, eventName: "advanced-interface-card-menu"} : options);
      this.#cards = managed;
      this.#rowMenu = rowMenu;
      if (!managed || rowMenu) return;
      const refresh = cards => {
        const added = [];
        for (const card of cards) {
          if (card.matches(".combatant-group")) continue;
          if (card.querySelector(":scope > .advanced-interface-card-menu-button")) continue;
          card.classList.add("advanced-interface-card");
          if (!card.querySelector(":scope > .advanced-interface-card-header-background")) {
            const background = root.ownerDocument.createElement("span");
            background.className = "advanced-interface-card-header-background";
            background.setAttribute("aria-hidden", "true");
            card.prepend(background);
          }
          const button = root.ownerDocument.createElement("button");
          button.type = "button";
          button.className = "ui-control icon fa-solid fa-ellipsis-vertical advanced-interface-card-menu-button";
          button.ariaLabel = localize("Cards.Menu");
          button.dataset.tooltip = button.ariaLabel;
          button.setAttribute("aria-expanded", "false");
          button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            card.dispatchEvent(new CustomEvent("advanced-interface-card-menu", {bubbles: true}));
          });
          button.addEventListener("dblclick", event => event.stopPropagation());
          const thumbnail = card.querySelector(CARD_THUMBNAILS);
          if (thumbnail) thumbnail.after(button);
          else card.prepend(button);
          card.classList.toggle("advanced-interface-card-thumbnail", !!thumbnail);
          added.push(card);
        }
        // Decorate in one batch so computed styles are read once instead of once per card.
        decorateIconButtons(added);
      };
      refresh(root.querySelectorAll(selector));
      const observer = new MutationObserver(records => {
        const cards = new Set();
        for (const record of records) {
          const parent = record.target.closest?.(selector);
          if (parent && !parent.querySelector(":scope > .advanced-interface-card-menu-button")) cards.add(parent);
          for (const node of record.addedNodes) {
            if (!(node instanceof root.ownerDocument.defaultView.Element)) continue;
            if (node.matches(selector)) cards.add(node);
            for (const card of node.querySelectorAll(selector)) cards.add(card);
          }
        }
        if (cards.size) refresh([...cards].filter(card => root.contains(card)));
      });
      observer.observe(root, {childList: true, subtree: true});
      root.addEventListener("contextmenu", event => {
        if (!event.target.closest(selector)) return;
        event.preventDefault();
        event.stopPropagation();
      });
    }
    _setPosition(menu, target, options) {
      if (!this.#cards) return super._setPosition(menu, target, options);
      const row = this.#row;
      const button = this.#rowMenu ? target : target.querySelector(":scope > .advanced-interface-card-menu-button");
      const buttonRect = button?.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const scale = row.offsetWidth ? rowRect.width / row.offsetWidth : 1;
      const start = buttonRect ? Math.round((buttonRect.right - rowRect.left) / scale) : 32;
      this.#actionsWidth = row.clientWidth - start + row.clientLeft;
      hideCardContent(row, button);
      row.classList.add("advanced-interface-card-menu-open");
      menu.classList.add("advanced-interface-card-actions");
      menu.removeAttribute("popover");
      menu.style.setProperty("--advanced-interface-card-actions-start", `${start}px`);
      // Inline actions need no native dropdown measurement or up/down placement.
      row.append(menu);
      target.classList.add("context");
    }
    async render(target, options = {}) {
      if (!this.#cards) return super.render(target, options);
      this.#target = target;
      const row = this.#row = this.#rowMenu ? (target.closest(".encounter-controls") ?? target.parentElement) : target;
      const button = this.#rowMenu ? target : target.querySelector(":scope > .advanced-interface-card-menu-button");
      const menuItems = this.menuItems;
      if (!this.#rowMenu) this.menuItems = removeDuplicateCardActions(menuItems, target);
      try {
        await super.render(target, {...options, animate: false});
      } finally {
        this.menuItems = menuItems;
      }
      const menu = this.element;
      if (!menu?.querySelector(".context-item")) {
        row.classList.remove("advanced-interface-card-menu-open");
        revealCardTopRow(row);
        return;
      }
      button?.setAttribute("aria-expanded", "true");
      for (const item of menu.querySelectorAll(".context-item")) {
        item.setAttribute("role", "button");
        item.tabIndex = 0;
        item.ariaLabel = item.textContent.trim();
        item.dataset.tooltip = item.ariaLabel;
        item.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            item.click();
          }
        });
      }
      decorateIconButtons(menu);
      if (fitCardActions(row, menu, this.#actionsWidth)) hideCardContent(row, button, menu);
      menu.animate([{opacity: 0}, {opacity: 1}], {duration: 150});
    }
    async close(options = {}) {
      if (this.#cards) {
        const row = this.#row ?? this.#target;
        row?.classList.remove("advanced-interface-card-menu-open");
        revealCardTopRow(row);
        const button = this.#rowMenu ? this.#target
          : this.#target?.querySelector(":scope > .advanced-interface-card-menu-button");
        button?.setAttribute("aria-expanded", "false");
      }
      return super.close(this.#cards ? {...options, animate: false} : options);
    }
  };
}
