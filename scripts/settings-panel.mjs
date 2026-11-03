import {createButton, createIcon, localize, reportError} from "./helper.mjs";
import {decorateLeadingIcons} from "./interface-components.mjs";

// Settings panel: a compact toolbar, native action sections and merged system information.
Hooks.on("renderSettings", (app, element) => {
  element.querySelector("section.info > .modules")?.remove();
  let toolbar = element.querySelector(".advanced-interface-settings-toolbar");
  if (!toolbar) {
    const content = element.querySelector("section.info")?.parentElement;
    if (!content) throw new Error("Advanced Interface | Cannot locate Settings content.");
    toolbar = element.ownerDocument.createElement("nav");
    toolbar.className = "advanced-interface-settings-toolbar";
    toolbar.setAttribute("aria-label", game.i18n.localize("SIDEBAR.TabSettings"));
    content.prepend(toolbar);
  }
  const settings = element.querySelector("section.settings");
  if (!settings) throw new Error("Advanced Interface | Cannot locate Settings and Configuration.");
  let reset = element.querySelector(".advanced-interface-reset-tabs");
  if (!reset) {
    reset = createButton(element.ownerDocument, "advanced-interface-reset-tabs", {
      context: "Resetting tab locations",
      onClick: async () => {
        reset.disabled = true;
        try {
          await ui.sidebar.resetTabLocations();
        } finally {
          reset.disabled = false;
        }
      }
    });
    const icon = createIcon(element.ownerDocument, "fa-solid fa-table-columns");
    reset.append(icon, localize("Tabs.ResetLocations"));
  }
  let reload = toolbar.querySelector(".advanced-interface-settings-reload");
  if (!reload) {
    reload = createButton(element.ownerDocument, "advanced-interface-settings-reload");
    reload.append(createIcon(element.ownerDocument, ui.menu.items.reload.icon));
    reload.append(game.i18n.localize(ui.menu.items.reload.label));
    reload.addEventListener("click", () => ui.menu.items.reload.onClick());
  }
  let configure = toolbar.querySelector(".advanced-interface-ui-config");
  if (!configure) {
    const menu = game.settings.menus.get("core.uiConfigMenu");
    configure = createButton(element.ownerDocument, "advanced-interface-ui-config", {
      onClick: () => new menu.type().render({force: true})
    });
    configure.append(createIcon(element.ownerDocument, "fa-solid fa-desktop"), game.i18n.localize(menu.label));
  }
  toolbar.append(reload, configure, reset);
  if (game.system.id === "dnd5e") {
    const welcome = element.querySelector("button:has(.fa-handshake)");
    if (welcome) {
      welcome.classList.add("advanced-interface-settings-welcome");
      settings.append(welcome);
    }
  }
  if (game.system.id === "dnd5e") {
    const linkIcons = [
      ['a[href*="/releases/"]', "fa-solid fa-file-lines"],
      ['a[href*="/issues"]', "fa-solid fa-bug"],
      ['a[href*="/wiki"]', "fa-solid fa-book"],
      ['a[href*="discord.com/"]', "fa-brands fa-discord"]
    ];
    for (const [selector, iconClass] of linkIcons) {
      const link = element.querySelector(`.sidebar-info .links ${selector}`);
      if (!link || link.classList.contains("advanced-interface-settings-button")) continue;
      link.classList.add("button");
      const icon = createIcon(element.ownerDocument, iconClass);
      link.prepend(icon);
    }
    const links = element.querySelector(".sidebar-info .links");
    const documentation = element.querySelector("section.documentation");
    if (links && documentation) {
      documentation.append(...links.querySelectorAll("a.button"));
      links.remove();
    }
  }
  const info = element.querySelector("section.info");
  if (info) {
    const title = info.querySelector(":scope > .title");
    if (!title) throw new Error("Advanced Interface | Cannot locate the system information heading.");
    title.textContent = localize("Settings.SystemInformation");
    const version = info.querySelector(":scope > .version");
    const build = info.querySelector(":scope > .build");
    if (version && build) {
      const release = element.ownerDocument.createElement("div");
      release.className = "advanced-interface-release";
      version.append(",");
      version.before(release);
      release.append(version, " ", build);
    }
    const system = element.querySelector("section.sidebar-info");
    if (system) {
      system.querySelector(":scope > h4.divider")?.remove();
      const details = element.ownerDocument.createElement("div");
      details.className = system.className;
      details.classList.remove("advanced-interface-settings-section");
      details.append(...system.childNodes);
      info.append(details);
      system.remove();
    }
  }
  for (const heading of element.querySelectorAll("section > h4.divider, section.info > .title")) {
    const section = heading.parentElement;
    section.classList.add("advanced-interface-settings-section");
    if (heading.querySelector(".advanced-interface-settings-section-icon")) continue;
    const iconName = section.classList.contains("info") ? "fa-dice-d20"
      : section.classList.contains("sidebar-info") ? "fa-puzzle-piece"
      : section.classList.contains("documentation") ? "fa-book"
      : section.classList.contains("access") ? "fa-key"
      : "fa-gears";
    const icon = createIcon(heading.ownerDocument, `fa-solid ${iconName} advanced-interface-settings-section-icon`);
    heading.prepend(icon);
  }
  decorateLeadingIcons(element.querySelectorAll(".advanced-interface-settings-section-icon"), "");
  for (const button of element.querySelectorAll("button, a.button")) {
    if (button.closest(".window-header") || button.classList.contains("advanced-interface-settings-button")) continue;
    const icon = button.querySelector("i");
    if (!icon) throw new Error("Advanced Interface | Settings button is missing its icon.");
    const label = button.textContent.trim();
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    button.dataset.tooltipDirection = "DOWN";
    button.classList.add("advanced-interface-settings-button");
    for (const node of Array.from(button.childNodes)) {
      if (node !== icon) node.remove();
    }
    button.parentElement.classList.add("advanced-interface-settings-actions");
  }
  for (const container of element.querySelectorAll("section.settings, section.documentation, section.access, .info .sidebar-info .links")) {
    const buttons = [...container.children].filter(child =>
      child.matches(".advanced-interface-settings-button")
      || child.querySelector(".advanced-interface-settings-button"));
    if (buttons.length && !container.querySelector(":scope > .advanced-interface-settings-button-divider")) {
      const divider = element.ownerDocument.createElement(container.matches("ul, ol") ? "li" : "div");
      divider.className = "advanced-interface-settings-button-divider";
      divider.setAttribute("role", "separator");
      buttons[0].before(divider);
    }
  }
});

let detached;

/** The main menu once it has left menu mode; it stands in for the Settings popout. */
export function detachedSettingsMenu() {
  return detached?.rendered ? detached : undefined;
}

// Escape opens Settings as a modal main menu; dragging its header turns it into an ordinary popout.
export function registerSettingsMenu() {
  let modal;
  let opening = false;
  class MenuSettings extends CONFIG.ui.settings {
    static DEFAULT_OPTIONS = {
      id: "advanced-interface-settings-menu",
      classes: ["sidebar-popout"],
      window: {frame: true, positioned: true, minimizable: false, resizable: false, controls: []}
    };
    async _onFirstRender(context, options) {
      const previous = ui.sidebar.popouts.settings;
      await super._onFirstRender(context, options);
      if (previous) ui.sidebar.popouts.settings = previous;
      else delete ui.sidebar.popouts.settings;
    }
    _onClose(options) {
      const previous = ui.sidebar.popouts.settings;
      super._onClose(options);
      if (previous && previous !== this) ui.sidebar.popouts.settings = previous;
    }
  }
  const MainMenu = CONFIG.ui.menu;
  let closeHook;
  const release = (app, {keepOpen = false} = {}) => {
    if (!modal?.open) return;
    Hooks.off("closeSettings", closeHook);
    if (app.element?.isConnected) modal.before(app.element);
    modal.close();
    modal.remove();
    modal = undefined;
    if (keepOpen) {
      detached = app;
      ui.sidebar.closeTab("settings");
      if (ui.settings.popout?.rendered) ui.settings.popout.close().catch(reportError("Settings popout"));
      closeHook = Hooks.on("closeSettings", closing => {
        if (closing !== app) return;
        Hooks.off("closeSettings", closeHook);
        if (detached === app) detached = undefined;
      });
    }
    else if (app.rendered) app.close().catch(reportError("Main menu"));
  };
  // Dragging the header leaves menu mode; the popout stays open as an ordinary window.
  const allowDetach = app => {
    const element = app.element;
    element.querySelector(".window-header")?.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button, .header-control") || !modal?.open) return;
      const rect = element.getBoundingClientRect();
      app.setPosition({left: rect.left, top: rect.top});
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = moveEvent => {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
        stop();
        release(app, {keepOpen: true});
        app.bringToFront?.();
      };
      const stop = () => {
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", stop, true);
      };
      element.addEventListener("pointermove", onMove);
      element.addEventListener("pointerup", stop, true);
    }, {capture: true});
  };
  CONFIG.ui.menu = class SettingsMainMenu extends MainMenu {
    // A popout dragged out of menu mode still counts as the open main menu, so Escape returns it to menu mode.
    get rendered() {
      return super.rendered || !!detached?.rendered;
    }

    async toggle() {
      if (modal?.open || opening) return;
      let app = detached?.rendered ? detached : undefined;
      if (app) {
        Hooks.off("closeSettings", closeHook);
        detached = undefined;
      }
      else {
        app = new MenuSettings();
        opening = true;
        try {
          await app.render({force: true});
        } finally {
          opening = false;
        }
        allowDetach(app);
      }
      const element = app.element;
      modal = element.ownerDocument.createElement("dialog");
      modal.className = "advanced-interface-settings-modal";
      element.before(modal);
      modal.append(element);
      modal.addEventListener("cancel", event => event.preventDefault());
      modal.addEventListener("keydown", event => {
        if (!["Tab", "Enter", " "].includes(event.key)) event.preventDefault();
        event.stopImmediatePropagation();
      }, {capture: true});
      modal.showModal();
      closeHook = Hooks.on("closeSettings", closing => {
        if (closing === app) release(app);
      });
      modal.addEventListener("click", event => {
        const button = event.target.closest("button, a.button");
        if (!button) return;
        if (button.dataset.action === "detach") {
          const rect = element.getBoundingClientRect();
          release(app, {keepOpen: true});
          app.setPosition({left: rect.left, top: rect.top});
          return;
        }
        const keepOpen = !button.closest(".window-header");
        queueMicrotask(() => release(app, {keepOpen}));
      }, {capture: true});
      element.querySelector("button")?.focus();
    }
  };
}
