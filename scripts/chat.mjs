import {decorateIconButtons} from "./interface-components.mjs";
import {panelWidth} from "./sidebar.mjs";
import {reportError, setButtonLabel} from "./helper.mjs";

function syncChatBackground() {
  const chatBackground = game.ready && ui.chat?.element
    ? ui.chat.element.classList.contains("with-background")
    : game.settings.get("core", "uiConfig").chatBackground;
  const opacity = chatBackground ? "1" : "0.6";
  for (const doc of new Set([document, ui.chat?.popout?.element?.ownerDocument].filter(Boolean))) {
    doc.getElementById("chat-message")?.style.setProperty("--advanced-interface-chat-background-opacity", opacity);
  }
}

Hooks.once("ready", () => {
  const root = ui.chat?.element;
  if (!root) return;
  new root.ownerDocument.defaultView.MutationObserver(syncChatBackground)
    .observe(root, {attributes: true, attributeFilter: ["class"]});
  syncChatBackground();
});

Hooks.on("renderChatLog", () => syncChatBackground());
Hooks.on("updateSetting", setting => {
  if (setting.key === "core.uiConfig") syncChatBackground();
});
Hooks.on("clientSettingChanged", key => {
  if (key === "core.uiConfig") syncChatBackground();
  if (key === "core.animateRollTable") ui.sidebar?.render();
});

export function registerChatLog() {
  CONFIG.ui.chat = class AdvancedChatLog extends CONFIG.ui.chat {
    // Bottom-row chat mirrors the top-row layout, which is Foundry's native newest-at-bottom log.
    get #nativeOrder() {
      return !!this.element?.classList.contains("advanced-interface-bottom-row");
    }

    get isAtBottom() {
      const scroll = this.element?.querySelector(".chat-scroll");
      if (!scroll) return true;
      if (this.#nativeOrder) {
        const range = scroll.scrollHeight - scroll.clientHeight;
        return range <= 0 || scroll.scrollTop >= range - 1;
      }
      return scroll.scrollTop <= 1;
    }

    _attachLogListeners(element, options) {
      // Keep native message-change listeners, but replace oldest-first scrolling.
      element.addEventListener("scroll", event => {
        if (this.#nativeOrder) {
          queueMicrotask(() => this.#updateChatScroll());
          return;
        }
        event.stopImmediatePropagation();
        this.#updateChatScroll();
        const range = element.scrollHeight - element.clientHeight;
        if (range > 0 && element.scrollTop >= range - 1) {
          this.renderBatch(CONFIG.ChatMessage.batchSize).catch(reportError("Chat history"));
        }
      }, {capture: true, passive: true});
      super._attachLogListeners(element, options);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#updateChatScroll();
    }

    async scrollBottom({popout = false, waitImages = false, scrollOptions = {}} = {}) {
      if (!this.rendered) return;
      const scroll = this.element.querySelector(".chat-scroll");
      if (waitImages) await this.constructor.waitForImages(scroll);
      scroll.scrollTop = this.#nativeOrder ? scroll.scrollHeight : 0;
      this.#updateChatScroll();
      if (popout) await this.popout?.scrollBottom({waitImages, scrollOptions});
    }

    #updateChatScroll() {
      const scroll = this.element?.querySelector(".chat-scroll");
      if (!scroll) return;
      scroll.classList.toggle("scrolled", !this.isAtBottom);
      const actions = this.element.querySelector("#chat-controls .control-buttons");
      const exportButton = actions?.querySelector('[data-action="export"]');
      let jump = actions?.querySelector(".advanced-interface-newest");
      if (!jump && exportButton) {
        jump = document.createElement("button");
        jump.type = "button";
        jump.className = "ui-control plain icon fa-solid fa-arrow-up advanced-interface-newest";
        jump.dataset.action = "jumpToBottom";
        exportButton.before(jump);
      }
      if (jump) {
        const native = this.#nativeOrder;
        jump.hidden = this.isAtBottom;
        jump.classList.toggle("fa-arrow-up", !native);
        jump.classList.toggle("fa-arrow-down", native);
        const key = native ? "CHAT.JumpToBottom" : "ADVANCED_INTERFACE.Chat.Newest";
        const label = game.i18n.has(key) ? game.i18n.localize(key) : "Jump to Top";
        setButtonLabel(jump, label);
        jump.dataset.tooltipDirection = native ? "UP" : "DOWN";
      }
    }

    _toggleNotifications(options = {}) {
      const {closing = false} = options;
      if (ui.chat.popout?.rendered && !this.isPopout) return super._toggleNotifications(options);
      const input = document.getElementById("chat-message");
      for (const button of document.querySelectorAll("#chat-controls button")) {
        button.classList.add("plain");
      }
      const embedInput = !this._shouldShowNotifications({closing});
      const target = embedInput
        ? (ui.chat.popout?.rendered && !closing ? ui.chat.popout : ui.chat).element?.querySelector(".chat-form")
        : document.getElementById("chat-notifications");
      // Re-appending the connected editor destroys and asynchronously rebuilds it.
      // Expansion and activation can request the same placement in one call stack.
      if (input && target && input.parentElement === target) {
        this.#updateChatScroll();
        return;
      }
      const result = super._toggleNotifications(options);
      this.#updateChatScroll();
      return result;
    }
  };
}

// The system's emphasized bottom line (message type color) moves to the top edge of the card.
// Messages are often rendered before they are inserted into the log, so wait (up to about two seconds) for insertion.
function moveChatAccentLineToTop(html, attempts = 120) {
  if (!html.isConnected) {
    if (attempts > 0) requestAnimationFrame(() => moveChatAccentLineToTop(html, attempts - 1));
    return;
  }
  if (!html.closest(".chat-sidebar, .chat-popout") || html.dataset.advancedInterfaceAccentTop) return;
  const details = html.querySelectorAll(":scope > .message-header > :is(.flavor-text, .whisper-to)");
  const content = html.querySelector(":scope > .message-content");
  if (content) content.prepend(...details);
  const style = getComputedStyle(html);
  const top = {width: style.borderTopWidth, color: style.borderTopColor};
  const bottom = {width: style.borderBottomWidth, color: style.borderBottomColor};
  html.dataset.advancedInterfaceAccentTop = "true";
  if (top.width === bottom.width && top.color === bottom.color) return;
  html.style.borderTopWidth = bottom.width;
  html.style.borderTopColor = bottom.color;
  html.style.borderBottomWidth = top.width;
  html.style.borderBottomColor = top.color;
}

// Chat cards lead with the author's color dot, right of the card menu button.
const CHAT_FORMAT_BUTTON = "#chat-message .editor-menu button.pm-dropdown.format";

// The chat editor's Format menu looks and behaves like the module's other dropdowns (the Time increment menu):
// toggled by its button, positioned 2px from it, with one highlighted item shared by mouse and keyboard.
function registerChatFormatMenu() {
  const doc = document;
  const view = doc.defaultView;
  // A non-interactive native select supplies the same face as Time; the button retains the nested menu and focus.
  const decorateTriggers = () => {
    for (const trigger of doc.querySelectorAll(CHAT_FORMAT_BUTTON)) {
      if (trigger.parentElement.querySelector(".advanced-interface-format-select")) continue;
      const select = doc.createElement("select");
      select.className = "advanced-interface-format-select";
      select.tabIndex = -1;
      select.setAttribute("aria-hidden", "true");
      select.add(new Option(trigger.querySelector(":scope > span")?.textContent ?? trigger.textContent.trim()));
      trigger.after(select);
    }
  };
  decorateTriggers();
  new MutationObserver(decorateTriggers).observe(doc.body, {childList: true, subtree: true});
  let menu = null;
  let button = null;
  let wasOpen = false;
  const isItem = li => li?.matches("li:not(.divider)");
  const submenu = li => li?.querySelector(":scope > ul");
  const parentItem = li => li?.parentElement?.closest("li");
  const levelItems = li => [...(li?.parentElement?.children ?? [])].filter(isItem);
  const focused = () => menu?.querySelector("li.focused");
  const showPath = li => {
    const open = new Set();
    for (let item = li; item; item = parentItem(item)) if (submenu(item)) open.add(item);
    for (const item of menu.querySelectorAll("li.advanced-interface-open")) {
      if (!open.has(item)) item.classList.remove("advanced-interface-open");
    }
    for (const item of open) {
      if (item.classList.contains("advanced-interface-open")) continue;
      item.classList.add("advanced-interface-open");
      // Foundry keeps an opened submenu on screen when it is hovered; run that for keyboard opens too.
      item.onpointerover?.({currentTarget: item, target: item});
    }
  };
  const highlight = (li, {open = !!submenu(li)} = {}) => {
    if (!menu || !isItem(li)) return;
    for (const item of menu.querySelectorAll("li.focused")) item.classList.remove("focused");
    li.classList.add("focused");
    showPath(open ? li : parentItem(li));
    li.scrollIntoView({block: "nearest"});
  };
  const enter = li => {
    const first = levelItems(submenu(li)?.firstElementChild)[0];
    if (!first) return false;
    highlight(li);
    highlight(first);
    return true;
  };
  const close = () => menu?.remove();
  const cleanup = () => {
    button?.setAttribute("aria-expanded", "false");
    view.removeEventListener("blur", close);
    view.removeEventListener("resize", close);
    menu = button = null;
  };
  const decorate = (dropdown, trigger) => {
    menu = dropdown;
    button = trigger;
    menu.classList.add("advanced-interface-format-dropdown");
    menu.querySelector(":scope > ul")?.setAttribute("role", "menu");
    for (const ul of menu.querySelectorAll("li > ul")) ul.setAttribute("role", "menu");
    for (const li of menu.querySelectorAll("li")) {
      if (isItem(li)) li.setAttribute("role", "menuitem");
      else li.setAttribute("role", "separator");
      if (submenu(li)) li.setAttribute("aria-haspopup", "menu");
    }
    // Keep focus on the Format button while using the menu.
    menu.addEventListener("mousedown", event => event.preventDefault());
    // Capture so the hovered submenu is visible before Foundry measures it in the item's own handler.
    menu.addEventListener("pointerover", event => {
      const li = event.target.closest("li");
      if (isItem(li)) highlight(li);
    }, true);
    // Category items open their submenu instead of closing the menu.
    menu.addEventListener("click", event => {
      const li = event.target.closest("li");
      if (!isItem(li) || !submenu(li)) return;
      event.preventDefault();
      event.stopPropagation();
      enter(li);
    }, true);
    button.setAttribute("aria-expanded", "true");
    view.addEventListener("blur", close);
    view.addEventListener("resize", close);
    // Runs after Foundry's own placement frame.
    requestAnimationFrame(() => {
      const list = menu?.querySelector(":scope > ul");
      if (!list || !button) return;
      const rect = button.getBoundingClientRect();
      list.style.minWidth = `${rect.width}px`;
      const {width, height} = list.getBoundingClientRect();
      const {clientWidth, clientHeight} = doc.documentElement;
      const below = rect.bottom + 2 + height <= clientHeight;
      menu.style.left = `${Math.max(0, Math.min(rect.left, clientWidth - width))}px`;
      menu.style.top = `${below ? rect.bottom + 2 : rect.top - 2 - height}px`;
      highlight(levelItems(list.firstElementChild)[0], {open: false});
    });
  };
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node === menu) cleanup();
      for (const node of record.addedNodes) {
        if (node.id !== "prosemirror-dropdown") continue;
        const trigger = doc.activeElement?.closest?.(CHAT_FORMAT_BUTTON);
        if (trigger) decorate(node, trigger);
      }
    }
  }).observe(doc.body, {childList: true});
  // Window capture runs before Foundry's document listener removes the open menu, so a second click can close it.
  view.addEventListener("pointerdown", event => {
    wasOpen = !!menu && !!event.target.closest?.(CHAT_FORMAT_BUTTON);
  }, true);
  view.addEventListener("click", event => {
    if (!wasOpen || !event.target.closest?.(CHAT_FORMAT_BUTTON)) return;
    wasOpen = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  view.addEventListener("keydown", event => {
    if (!menu) {
      const trigger = event.target.closest?.(CHAT_FORMAT_BUTTON);
      if (!trigger || !((event.altKey && event.key === "ArrowDown") || event.key === "ArrowDown" || event.key === "F4")) return;
      event.preventDefault();
      event.stopPropagation();
      trigger.click();
      return;
    }
    const li = focused();
    const items = levelItems(li);
    const index = items.indexOf(li);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (items.length) highlight(items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length], {open: false});
        break;
      case "Home":
      case "End":
        if (items.length) highlight(items.at(event.key === "Home" ? 0 : -1), {open: false});
        break;
      case "ArrowRight":
        enter(li);
        break;
      case "ArrowLeft":
        if (parentItem(li)) highlight(parentItem(li), {open: false});
        break;
      case "Enter":
      case " ":
        if (!enter(li)) li?.click();
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        close();
        return;
      default:
        if (event.altKey && event.key === "ArrowUp") close();
        else return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

Hooks.once("ready", registerChatFormatMenu);

Hooks.on("renderChatMessageHTML", (message, html) => {
  moveChatAccentLineToTop(html);
  const header = html.querySelector(".message-header");
  if (!header || header.querySelector(":scope > .advanced-interface-chat-color")) return;
  const dot = document.createElement("span");
  dot.className = "advanced-interface-chat-color";
  dot.ariaHidden = "true";
  const color = message.author?.color;
  if (color) dot.style.setProperty("--advanced-interface-chat-author-color", color.css ?? String(color));
  header.prepend(dot);
});

function syncChatPopoutTheme(element) {
  const theme = [...(ui.chat?.element?.classList ?? document.body.classList)].find(name => name.startsWith("theme-"));
  const content = element.querySelector(":scope > .window-content");
  if (!content) return;
  content.classList.remove("theme-light", "theme-dark");
  content.classList.add("themed", theme ?? "theme-dark");
}

// Core re-themes the chat panel when the interface theme changes, but not a chat pop-out's content.
Hooks.on("clientSettingChanged", key => {
  if (key !== "core.uiConfig") return;
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof foundry.applications.sidebar.apps.ChatPopout && app.rendered) syncChatPopoutTheme(app.element);
  }
});

// Chat pop-outs match the chat panel's width and format their message like a chat log card. The card's Options menu holds
// the log's message options plus the window's header controls; the close button sits at the right end of the card's
// top row, and the rest of that row moves the window.
Hooks.on("renderChatPopout", (app, element, context, options) => {
  const card = element.querySelector(".window-content > .chat-message");
  if (card) card.draggable = false;
  if (!options.isFirstRender) return;
  const width = panelWidth("chat");
  if (width && app.position.width !== width) app.setPosition({width});
  syncChatPopoutTheme(element);
  const header = element.querySelector(":scope > .window-header");
  if (header) decorateIconButtons(header);
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !header) return;
    const row = event.target.closest(".window-content > .chat-message > .message-header");
    if (!row || event.target.closest("button, a, input, [data-action]")) return;
    event.preventDefault();
    header.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX,
      screenY: event.screenY, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary,
      button: event.button, buttons: event.buttons
    }));
  });
  if (!ui.chat) return;
  ui.chat._createContextMenu(function() {
    const windowOptions = app._getHeaderControls().map(control => ({
      label: control.label,
      icon: control.icon,
      visible: () => typeof control.visible === "function" ? control.visible.call(app) : control.visible ?? true,
      onClick: event => {
        if (typeof control.onClick === "function") return control.onClick(event);
        let handler = app.options.actions[control.action];
        if (typeof handler === "object") handler = handler.handler;
        const target = event.target.closest(".context-item") ?? event.target;
        target.dataset.action = control.action;
        try {
          if (handler) handler.call(app, event, target);
          else app._onClickAction(event, target);
        } finally {
          delete target.dataset.action;
        }
      }
    }));
    return [...this._getEntryContextOptions(), ...windowOptions];
  }, ".message[data-message-id]", {
    container: element,
    hookName: "getChatMessageContextOptions",
    parentClassHooks: false,
    fixed: true
  });
});

// Pop Out leaves the card menu: a card that can pop out is dragged instead, and dropping it outside its chat log onto
// the canvas or anything that does not accept it opens the pop-out at the drop point.
let chatDropTarget = null;
document.addEventListener("drop", event => chatDropTarget = event.target, {capture: true});
Hooks.on("getChatMessageContextOptions", (app, options) => {
  const index = options.findIndex(option => option.label === "CHAT.PopoutMessage" || option.name === "CHAT.PopoutMessage");
  if (index >= 0) options.splice(index, 1);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (message.getFlag("core", "canPopout") !== true || html.draggable) return;
  html.draggable = true;
  html.addEventListener("dragstart", event => {
    if (event.target !== html) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(message.toDragData()));
    event.dataTransfer.effectAllowed = "copyMove";
    chatDropTarget = null;
  });
  html.addEventListener("dragend", event => {
    if (event.target !== html) return;
    const onCanvas = chatDropTarget instanceof Element && !!chatDropTarget.closest("#board");
    if (event.dataTransfer.dropEffect !== "none" && !onCanvas) return;
    const log = html.closest(".chat-log, .chat-popout");
    const rect = log?.getBoundingClientRect();
    const {clientX: x, clientY: y} = event;
    if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return;
    new CONFIG.ChatMessage.popoutClass({message, position: {left: x, top: y}}).render({force: true});
  });
});
