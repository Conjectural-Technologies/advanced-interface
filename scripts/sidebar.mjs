import {createPartySheetButton, decorateIconButtons} from "./interface-components.mjs";
import {toggleAllVolumes} from "./playlists.mjs";
import {detachedSettingsMenu} from "./settings-panel.mjs";
import {DIRECTORY_VISIBILITY, MODULE_ID, createButton, createDirectoryToggle, getPanelSetting, isManagedSidebarTab, localize, reportError, setButtonLabel, setPanelSettings, syncDirectoryVisibility} from "./helper.mjs";

const PANEL_WIDTHS = {
  advancedControls: 104,
  advancedVolume: 256,
  placeables: 288,
  settings: 224,
  compendium: 288,
  playlists: 288,
  cards: 288,
  tables: 288,
  journal: 288,
  items: 288,
  actors: 288,
  scenes: 288,
  chat: 288,
  advancedPlayers: 288,
  advancedTime: 352,
  combat: 296,
  macros: 288
};

const TAB_CONFIGURATIONS = {
  advancedTime: [["dnd5e.calendarConfiguration", "calendar-days"]],
  combat: [["dnd5e.combatConfiguration", "swords"]],
  compendium: [["dnd5e.packSourceConfiguration", "books"]]
};

/** Shared tab, embedded panel, and popout width in pixels; undefined preserves native sizing. */
export function panelWidth(tab) {
  return PANEL_WIDTHS[tab];
}

const DEFAULT_TAB_ORDER = [
  "chat", "combat", "actors", "items", "journal", "tables", "cards",
  "advancedVolume", "advancedPlayers", "advancedTime", "macros", "playlists", "compendium",
  "settings", "advancedControls", "placeables", "scenes", "dice-so-nice"
];
const DEFAULT_TAB_SIDES = {
  advancedControls: "left",
  placeables: "left",
  scenes: "left",
  advancedPlayers: "left",
  advancedVolume: "left",
  advancedTime: "center",
  macros: "center",
  chat: "right"
};
const DEFAULT_TAB_ROWS = {
  advancedPlayers: "bottom",
  advancedVolume: "bottom",
  macros: "bottom",
  chat: "bottom"
};

function setStyles(element, properties) {
  for (const [property, value] of Object.entries(properties)) {
    if (element.style[property] !== value) element.style[property] = value;
  }
}

export class AdvancedSidebar extends CONFIG.ui.sidebar {
  #openTabs = new Set();
  #scrollContainers = new WeakSet();
  #dragContainers = new WeakSet();
  #fadePanels = new WeakSet();
  #fadeEntries = new WeakSet();
  #tabOrder;
  #tabSides;
  #tabRows;
  #draggedEntry;
  #dragAnchor;
  #pinned = new Set();
  #shown = new Set();
  #ignoreClickUntil = 0;
  #closingFades = new Map();
  #panelLayer = 0;
  #layoutObserver;
  #layoutMenu;

  async resetTabLocations() {
    await Promise.all([
      setPanelSettings({tabOrder: [], tabSides: {}, tabRows: {},
        ...Object.fromEntries(Object.values(DIRECTORY_VISIBILITY).map(({setting}) => [setting, false]))}),
      ...["fixedHUDSize", "fixedDoorSize"].map(key => game.settings.set(MODULE_ID, key, false)),
      game.settings.set(MODULE_ID, "layerDisplay", {}),
      game.settings.set("core", "notesDisplayToggle", false)
    ]);
    ui.controls.render({force: true});
    this.#tabOrder = [];
    this.#tabSides = {};
    this.#tabRows = {};
    const released = [...this.#pinned];
    this.#pinned.clear();
    this.#shown.clear();
    this.#savePanelStates();
    this.#syncPanels();
    for (const tab of released) this.#hoverTab(tab, false);
  }

  #savePanelStates() {
    const value = {pinned: [...this.#pinned], shown: [...this.#shown]};
    const saved = getPanelSetting("panelStates", {});
    if (JSON.stringify(saved) === JSON.stringify(value)) return;
    setPanelSettings({panelStates: value}).catch(reportError("Saving panel states"));
  }

  #restorePanelStates() {
    const {pinned = [], shown = []} = getPanelSetting("panelStates", {});
    for (const tab of pinned) {
      const entry = this.element.querySelector(`#sidebar-tabs [data-tab="${tab}"]`)?.closest("li");
      if (!entry || entry.hidden || !ui[tab]) continue;
      this.#pinned.add(tab);
      if (shown.includes(tab)) this.#shown.add(tab);
      this.changeTab(tab, "primary");
    }
  }

  async _onFirstRender(context, options) {
    for (const tab of Object.keys(this.constructor.TABS)) {
      const app = ui[tab];
      if (!app) continue;
      // Native tab.active assumes that only one sidebar panel can be open.
      Object.defineProperty(app, "active", {
        configurable: true,
        get: () => this.#openTabs.has(tab)
      });
    }
    await super._onFirstRender(context, options);
    this.element.classList.add("advanced-interface");
    const syncForeground = event => {
      if (!(event.target instanceof Element)) return;
      const panel = event.target.closest("#sidebar-content > .sidebar-tab");
      if (panel && this.element.contains(panel)) this.#raisePanel(panel.dataset.tab);
      if (!this.element.contains(event.target) || ui.activeWindow === this) return;
      const ApplicationV2 = foundry.applications.api.ApplicationV2;
      const layer = ++ApplicationV2._maxZ;
      this.element.parentElement.style.setProperty("--advanced-interface-sidebar-layer", String(layer));
      ui.activeWindow = this;
    };
    for (const eventName of ["pointerdown", "focusin"]) {
      this.element.ownerDocument.addEventListener(eventName, syncForeground, {capture: true});
    }
    this.#restorePanelStates();
    this.#syncPanels();
    if (!this.#openTabs.size) this.collapse();
    this.element.classList.add("advanced-interface-ready");
    if (!ui.placeables.rendered && !game.settings.get("core", "noCanvas")) {
      const renderPlaceables = () => {
        this.render({parts: ["placeables"]}).catch(reportError("Placeables initialization"));
      };
      if (game.ready) renderPlaceables();
      else Hooks.once("ready", renderPlaceables);
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#syncPanels();
  }

  _onClickTab(event) {
    const button = event.target.closest("#sidebar-tabs [data-tab]")
      ?? (event.button === 2 ? event.target.closest("#sidebar-tabs li")?.querySelector("[data-tab]") : null);
    if (!button) return super._onClickTab(event);
    event.preventDefault();
    if (button.disabled) return;
    const tab = button.dataset.tab;
    if (this.#draggedEntry || Date.now() < this.#ignoreClickUntil || ui[tab]?.popout?.rendered) return;
    if (tab === "settings" && detachedSettingsMenu()) return;
    if (event.button === 2) {
      // A closed Volume tab mutes or restores every volume; open tabs cycle Pin and Show.
      if (tab === "advancedVolume" && !this.#openTabs.has(tab)) toggleAllVolumes().catch(reportError("Mute all volumes"));
      else this.#cyclePanelVisibility(tab);
      return;
    }
    if (event.button !== 0) return;
    if (this.#openTabs.has(tab)) this.closeTab(tab);
    else this.changeTab(tab, "primary");
  }

  #cyclePanelVisibility(tab) {
    if (!this.#openTabs.has(tab)) return;
    if (!this.#pinned.has(tab)) {
      this.#pinned.add(tab);
      this.#shown.delete(tab);
    } else if (!this.#shown.has(tab)) {
      this.#shown.add(tab);
    } else {
      this.#pinned.delete(tab);
      this.#shown.delete(tab);
    }
    this.#cancelClosingFade(tab);
    this.#savePanelStates();
    this.#syncPanels();
    this.#hoverTab(tab, false);
  }

  #cancelClosingFade(tab) {
    const animations = this.#closingFades.get(tab);
    if (!animations) return;
    this.#closingFades.delete(tab);
    for (const animation of animations) animation.cancel();
  }

  #hoverTab(tab, entered) {
    const entry = this.element.querySelector(`#sidebar-tabs [data-tab="${tab}"]`)?.closest("li");
    const panel = ui[tab]?.element;
    if (entered || this.#pinned.has(tab) || this.#draggedEntry
      || entry?.matches(":hover, :has(:focus-visible)") || panel?.matches(":hover, :has(:focus-visible)")) {
      this.#cancelClosingFade(tab);
      return;
    }
    if (!this.#openTabs.has(tab) || this.#closingFades.has(tab)) return;
    const style = getComputedStyle(entry);
    const milliseconds = property => {
      const value = style.getPropertyValue(property).trim();
      return parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
    };
    const nativeDuration = milliseconds("--ui-fade-delay");
    const opacity = Number(style.getPropertyValue("--ui-fade-opacity"));
    // Foundry uses fade-delay as the transition duration and fade-duration as its delay.
    const duration = nativeDuration / (opacity < 1 ? 1 - opacity : 1);
    const fading = this.#shown.has(tab) ? [panel] : [entry, panel];
    const animations = fading.map(element => element.animate(
      [{opacity: 1}, {opacity: 0}],
      {duration, endDelay: 100, easing: "linear", fill: "both"}
    ));
    this.#closingFades.set(tab, animations);
    animations.at(-1).onfinish = () => {
      if (this.#closingFades.get(tab) === animations) this.closeTab(tab);
    };
  }

  changeTab(tab, group, options = {}) {
    if (group !== "primary") return super.changeTab(tab, group, options);
    const button = Array.from(this.element.querySelectorAll("#sidebar-tabs [data-tab]"))
      .find(element => element.dataset.tab === tab);
    if (!button || button.closest("li").hidden) {
      throw new Error(`Advanced Interface | Sidebar tab "${tab}" is not available.`);
    }

    const wasOpen = this.#openTabs.has(tab);
    this.#cancelClosingFade(tab);
    this.#openTabs.add(tab);
    this.tabGroups.primary = tab;
    if (!this.expanded) this.expand();
    else this.#syncPanels();
    if (!wasOpen) {
      this.#notifyTab(tab, true);
      Hooks.callAll("changeSidebarTab", ui[tab]);
    }
    this.#raisePanel(tab);
    ui[tab].element?.scrollIntoView({block: "nearest", inline: "nearest"});
  }

  #raisePanel(tab) {
    if (!this.#openTabs.has(tab)) return;
    const panel = Array.from(this.element.querySelector("#sidebar-content").children)
      .find(panel => panel.dataset.tab === tab);
    if (panel) panel.style.zIndex = String(++this.#panelLayer);
  }

  closeTab(tab) {
    this.#cancelClosingFade(tab);
    if (!this.#openTabs.delete(tab)) return;
    if (this.#openTabs.size && this.tabGroups.primary === tab) {
      this.tabGroups.primary = Array.from(this.#openTabs).at(-1);
    }
    this.#syncPanels();
    this.#notifyTab(tab, false);
    if (!this.#openTabs.size) this.collapse();
  }

  // Core only hides unavailable tabs on first render; this keeps a tab's button in step with later changes.
  setTabAvailable(tab, available) {
    const entry = this.element?.querySelector(`#sidebar-tabs [data-tab="${tab}"]`)?.closest("li");
    if (!entry) return;
    if (!available) {
      this.#pinned.delete(tab);
      this.#shown.delete(tab);
      this.#savePanelStates();
      this.closeTab(tab);
    }
    entry.hidden = !available;
    this.#syncPanels();
  }

  toggleExpanded(expanded = !this.expanded) {
    if (expanded && !this.#openTabs.size) {
      this.changeTab(this.tabGroups.primary, "primary");
      return;
    }
    super.toggleExpanded(expanded);
    this.#syncPanels();
  }

  moveCompendiumBrowserButton(element) {
    const button = element.querySelector("button.open-compendium-browser");
    if (!button) return;
    this.#syncPanels();
    const entry = this.element.querySelector('#sidebar-tabs [data-tab="compendium"]')?.closest("li");
    const controls = entry?.querySelector(".advanced-interface-tab-actions");
    if (!controls) throw new Error("Advanced Interface | Cannot locate the Compendium Packs tab actions.");
    const icon = button.querySelector("i");
    if (!icon) throw new Error("Advanced Interface | Compendium Browser button is missing its icon.");
    button.className = `ui-control plain icon advanced-interface-compendium-browser ${icon.className}`;
    setButtonLabel(button, localize("CompendiumBrowser"));
    button.draggable = false;
    button.addEventListener("click", event => event.stopPropagation());
    button.replaceChildren();
    controls.querySelector(".advanced-interface-compendium-browser")?.remove();
    controls.prepend(button);
    this.#syncPanels();
  }

  #syncPanels() {
    const content = this.element.querySelector("#sidebar-content");
    if (!content) return;
    const panelsByTab = new Map(Array.from(content.children, panel => [panel.dataset.tab, panel]));
    const navigation = this.element.querySelector("#sidebar-tabs");
    navigation.classList.remove("faded-ui");
    navigation.dataset.tooltipDirection = "DOWN";
    navigation.setAttribute("aria-multiselectable", "true");
    navigation.setAttribute("aria-orientation", "horizontal");
    const placeables = navigation.querySelector('[data-tab="placeables"]');
    if (placeables && !game.settings.get("core", "noCanvas")) {
      placeables.closest("li").hidden = false;
      placeables.disabled = !ui.placeables.rendered;
    }
    const menu = navigation.querySelector("menu");
    if (this.#layoutMenu !== menu) {
      this.#layoutObserver?.disconnect();
      this.#layoutMenu = menu;
      let rowWidth = menu.clientWidth;
      this.#layoutObserver = new ResizeObserver(() => {
        if (menu.clientWidth === rowWidth) return;
        rowWidth = menu.clientWidth;
        this.#syncPanels();
      });
      this.#layoutObserver.observe(menu);
    }
    for (const button of menu.querySelectorAll(":scope > li > button:not([data-tab])")) {
      if (!button.dataset.tooltip && !button.dataset.tooltipText && !button.dataset.tooltipHtml) {
        button.dataset.tooltip = button.getAttribute("aria-label") || button.title;
      }
      button.removeAttribute("title");
      button.dataset.tooltipDirection = "DOWN";
    }
    this.#tabOrder ??= getPanelSetting("tabOrder", []);
    this.#tabSides ??= getPanelSetting("tabSides", {});
    this.#tabRows ??= getPanelSetting("tabRows", {});
    const tabOrder = this.#tabOrder.length ? this.#tabOrder : DEFAULT_TAB_ORDER;
    const entryKey = entry => entry.querySelector("[data-tab]")?.dataset.tab || entry.id;
    const entrySide = entry => this.#tabSides[entryKey(entry)]
      ?? DEFAULT_TAB_SIDES[entryKey(entry)] ?? "right";
    const entryRow = entry => (this.#tabRows[entryKey(entry)]
      ?? DEFAULT_TAB_ROWS[entryKey(entry)]) === "bottom" ? "bottom" : "top";
    const ordered = Array.from(menu.children);
    ordered.sort((a, b) => {
      const aIndex = tabOrder.indexOf(entryKey(a));
      const bIndex = tabOrder.indexOf(entryKey(b));
      return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
    });
    for (const [index, entry] of ordered.entries()) {
      if (menu.children[index] !== entry) menu.insertBefore(entry, menu.children[index]);
    }
    const entries = ordered.filter(entry => !entry.hidden && getComputedStyle(entry).display !== "none");
    const availableWidth = menu.clientWidth;
    const widthForEntry = entry => {
      const tab = entry.querySelector("[data-tab]")?.dataset.tab;
      if (!this.expanded || !this.#openTabs.has(tab)) return 32;
      const panel = panelsByTab.get(tab);
      const width = panelWidth(tab) ?? (panel ? parseFloat(getComputedStyle(panel).width)
        : parseFloat(getComputedStyle(this.element).getPropertyValue("--sidebar-width")));
      if (!Number.isFinite(width)) throw new Error(`Advanced Interface | Cannot measure sidebar tab "${tab}".`);
      return width;
    };
    const rows = ["top", "bottom"].map(row => {
      const groups = ["left", "center", "right"].map(side => {
        const group = entries.filter(entry => entryRow(entry) === row && entrySide(entry) === side);
        if (row === "bottom") group.reverse();
        const widths = group.map(widthForEntry);
        const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 4;
        return {side, group, widths, total};
      });
      return {row, groups};
    });
    const automaticallyClosed = [];
    for (const {groups} of rows) {
      const occupied = groups.filter(({group}) => group.length);
      let requiredWidth = occupied.reduce((sum, {total}) => sum + total, 0)
        + Math.max(0, occupied.length - 1) * 4;
      if (availableWidth <= 0 || requiredWidth <= availableWidth) continue;
      const protectedTab = this.#draggedEntry ? entryKey(this.#draggedEntry) : this.tabGroups.primary;
      const drivingSide = groups.find(({group}) => group.some(entry => entryKey(entry) === protectedTab))?.side;
      const priority = drivingSide === "left" ? ["right", "center", "left"]
        : drivingSide === "right" ? ["left", "center", "right"]
        : ["left", "right", "center"];
      for (const side of priority) {
        const group = groups.find(group => group.side === side);
        for (const [index, entry] of group.group.entries()) {
          if (requiredWidth <= availableWidth) break;
          const tab = entryKey(entry);
          if (tab === protectedTab || !this.#openTabs.has(tab) || group.widths[index] <= 32) continue;
          this.#cancelClosingFade(tab);
          this.#openTabs.delete(tab);
          automaticallyClosed.push(tab);
          const saved = group.widths[index] - 32;
          group.widths[index] = 32;
          group.total -= saved;
          requiredWidth -= saved;
        }
      }
    }
    if (automaticallyClosed.includes(this.tabGroups.primary)) {
      this.tabGroups.primary = Array.from(this.#openTabs).at(-1);
    }
    for (const entry of ordered) {
      if (!entry.classList.contains("faded-ui")) entry.classList.add("faded-ui");
      if (!this.#fadeEntries.has(entry)) {
        this.#fadeEntries.add(entry);
        const syncFade = () => {
          const tab = entry.querySelector("[data-tab]")?.dataset.tab;
          const panel = Array.from(content.children).find(panel => panel.dataset.tab === tab);
          panel?.classList.toggle("advanced-interface-tab-unmuted",
            entry.matches(":hover, :has(:focus-visible)"));
          if (tab) this.#hoverTab(tab, entry.matches(":hover, :has(:focus-visible)")
            || !!panel?.matches(":hover, :has(:focus-visible)"));
        };
        for (const eventName of ["pointerenter", "pointerleave", "focusin", "focusout"]) {
          entry.addEventListener(eventName, () => queueMicrotask(syncFade));
        }
      }
    }
    for (const button of menu.querySelectorAll("[data-tab]")) {
      button.draggable = true;
    }
    if (!this.#dragContainers.has(navigation)) {
      this.#dragContainers.add(navigation);
      navigation.addEventListener("contextmenu", event => {
        const entry = event.target.closest("#sidebar-tabs li");
        if (!entry?.querySelector("[data-tab]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this._onClickTab(event);
      }, {capture: true});
      navigation.addEventListener("auxclick", event => {
        if (event.button !== 2 || !event.target.closest("[data-tab]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, {capture: true});
      navigation.ownerDocument.addEventListener("pointermove", event => {
        const entry = event.target.closest("#sidebar-tabs li");
        const hovered = entry?.querySelector("[data-tab]")?.dataset.tab
          ?? event.target.closest("#sidebar-content > .sidebar-tab")?.dataset.tab;
        if (hovered) this.#hoverTab(hovered, true);
        for (const tab of this.#openTabs) {
          if (tab !== hovered) this.#hoverTab(tab, false);
        }
      });
      navigation.addEventListener("dragstart", event => {
        const button = event.target.closest("button[draggable]");
        if (!button) return;
        this.#draggedEntry = button.closest("li");
        const rect = button.getBoundingClientRect();
        const scale = rect.height / button.offsetHeight || 1;
        this.#dragAnchor = {x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale};
        for (const tab of this.#closingFades.keys()) this.#cancelClosingFade(tab);
        event.dataTransfer.setData("text/plain", entryKey(this.#draggedEntry));
        event.dataTransfer.effectAllowed = "move";
        event.stopPropagation();
      });
      navigation.ownerDocument.addEventListener("dragover", event => {
        if (!this.#draggedEntry) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      navigation.ownerDocument.addEventListener("drop", event => {
        if (!this.#draggedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        const tab = this.#draggedEntry.querySelector("[data-tab]")?.dataset.tab;
        // Each row docks drops within 16px of its tabs; anything between the rows becomes a popout.
        const navRect = navigation.getBoundingClientRect();
        const scale = navRect.height / navigation.offsetHeight || 1;
        const band = (4 + 32 + 16) * scale;
        const row = event.clientY < navRect.top + band ? "top"
          : event.clientY > navRect.bottom - band ? "bottom" : null;
        if (tab && !row) {
          const anchor = this.#dragAnchor;
          const point = {x: event.clientX, y: event.clientY};
          this.#draggedEntry = undefined;
          this.#dragAnchor = undefined;
          this.#ignoreClickUntil = Date.now() + 250;
          this.#pinned.delete(tab);
          this.#savePanelStates();
          this.closeTab(tab);
          this.#openDraggedPopout(tab, point, anchor).catch(reportError("Tab popout"));
          return;
        }
        const area = (navigation.closest("#interface") ?? navigation).getBoundingClientRect();
        const fraction = (event.clientX - area.left) / area.width;
        const side = fraction < 1 / 3 ? "left" : fraction < 2 / 3 ? "center" : "right";
        const key = entryKey(this.#draggedEntry);
        this.#tabSides[key] = side;
        this.#tabRows[key] = row;
        const candidates = Array.from(menu.children).filter(entry =>
          entry !== this.#draggedEntry && !entry.hidden && getComputedStyle(entry).display !== "none"
          && entryRow(entry) === row && entrySide(entry) === side);
        // Bottom-row groups render in reverse DOM order, so compare against their visual order.
        const visual = row === "bottom" ? candidates.toReversed() : candidates;
        const target = visual.find(entry => {
          const rect = entry.getBoundingClientRect();
          return event.clientX < rect.left + rect.width / 2;
        });
        if (candidates.length) {
          if (row === "bottom") {
            if (target) target.after(this.#draggedEntry);
            else candidates[0].before(this.#draggedEntry);
          }
          else if (target) target.before(this.#draggedEntry);
          else candidates.at(-1).after(this.#draggedEntry);
        }
        this.#tabOrder = Array.from(menu.children).map(entryKey).filter(Boolean);
        this.#syncPanels();
        if (tab) this.#raisePanel(tab);
        setPanelSettings({tabOrder: this.#tabOrder, tabSides: this.#tabSides, tabRows: this.#tabRows})
          .catch(reportError("Saving tab layout"));
        this.#draggedEntry = undefined;
        this.#dragAnchor = undefined;
        this.#ignoreClickUntil = Date.now() + 250;
      });
      navigation.addEventListener("dragend", () => {
        const tab = this.#draggedEntry?.querySelector("[data-tab]")?.dataset.tab;
        this.#draggedEntry = undefined;
        this.#dragAnchor = undefined;
        this.#ignoreClickUntil = Date.now() + 250;
        if (tab) this.#hoverTab(tab, false);
      });
    }
    for (const button of this.element.querySelectorAll("#sidebar-tabs [data-tab]")) {
      const active = this.#openTabs.has(button.dataset.tab);
      button.classList.toggle("active", active);
      if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", String(active));
      if (active) {
        for (const attribute of ["data-tooltip", "data-tooltip-text", "data-tooltip-html", "title"]) {
          button.removeAttribute(attribute);
        }
        if (game.tooltip.element === button) game.tooltip.deactivate();
      } else {
        button.dataset.tooltip = button.dataset.advancedInterfaceTooltip || button.getAttribute("aria-label");
      }
      button.dataset.tooltipDirection = "DOWN";
      let label = button.querySelector(".advanced-interface-tab-label");
      if (!label) {
        label = button.ownerDocument.createElement("span");
        label.className = "advanced-interface-tab-label";
        label.setAttribute("aria-hidden", "true");
        button.append(label);
      }
      const title = button.getAttribute("aria-label");
      if (label.textContent !== title) label.textContent = title;
      const entry = button.closest("li");
      let controls = entry.querySelector(".advanced-interface-tab-actions");
      if (!controls) {
        controls = button.ownerDocument.createElement("span");
        controls.className = "advanced-interface-tab-actions";
        for (const [action, icon, state] of [
          ["Show", "eye", this.#shown], ["Pin", "thumbtack", this.#pinned]
        ]) {
          const control = createButton(button.ownerDocument, `ui-control plain icon fa-solid fa-${icon}`, {
            label: localize(`Tabs.${action}`),
            context: `Tab ${action}`,
            onClick: () => {
              const tab = button.dataset.tab;
              if (!state.delete(tab)) state.add(tab);
              this.#cancelClosingFade(tab);
              this.#syncPanels();
              this.#hoverTab(tab, false);
            }
          });
          control.dataset.tabControl = action;
          controls.append(control);
        }
        entry.append(controls);
      }
      const configurations = TAB_CONFIGURATIONS[button.dataset.tab] ?? [];
      for (const [key, icon] of configurations) {
        const menu = game.settings.menus.get(key);
        if (!menu || controls.querySelector(`[data-settings-menu="${key}"]`)) continue;
        const configure = createButton(button.ownerDocument, `ui-control plain icon fa-solid fa-${icon}`, {
          label: game.i18n.localize(menu.label),
          onClick: () => new menu.type().render({force: true})
        });
        configure.dataset.settingsMenu = key;
        configure.disabled = !!menu.restricted && !game.user.isGM;
        controls.insertBefore(configure, controls.querySelector('[data-tab-control="Show"]'));
      }
      if (button.dataset.tab === "tables") {
        let animate = controls.querySelector(".advanced-interface-animate-tables");
        if (!animate) {
          const setting = game.settings.settings.get("core.animateRollTable");
          animate = createButton(button.ownerDocument, "ui-control plain icon fa-solid fa-dice advanced-interface-animate-tables", {
            label: game.i18n.localize(setting.name),
            onClick: async () => {
              await game.settings.set("core", "animateRollTable", !game.settings.get("core", "animateRollTable"));
              this.#syncPanels();
            }
          });
          controls.insertBefore(animate, controls.querySelector('[data-tab-control="Show"]'));
        }
        animate.setAttribute("aria-pressed", String(game.settings.get("core", "animateRollTable")));
      }
      const directory = DIRECTORY_VISIBILITY[button.dataset.tab]?.name;
      if (directory) {
        if (!controls.querySelector(`.advanced-interface-toggle-${directory}-directory`)) {
          controls.prepend(createDirectoryToggle(button.ownerDocument, button.dataset.tab, "ui-control plain icon"));
        }
        syncDirectoryVisibility(button.dataset.tab);
      }
      if (button.dataset.tab === "advancedPlayers" && game.system.id === "dnd5e") {
        let party = controls.querySelector(".advanced-interface-party-sheet");
        if (!party) {
          party = createPartySheetButton(button.ownerDocument, "ui-control plain icon");
          controls.prepend(party);
        }
        party.disabled = !game.actors.party?.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED);
      }
      controls.hidden = !active;
      entry.style.setProperty("--advanced-interface-tab-actions-width", `${controls.children.length * 32}px`);
      for (const control of controls.querySelectorAll("[data-tab-control]")) {
        const pin = control.dataset.tabControl === "Pin";
        const on = (pin ? this.#pinned : this.#shown).has(button.dataset.tab);
        if (control.getAttribute("aria-pressed") !== String(on)) control.setAttribute("aria-pressed", String(on));
        setButtonLabel(control, localize(`Tabs.${pin ? (on ? "Unpin" : "Pin") : (on ? "Hide" : "Show")}`));
        if (game.tooltip?.element === control) game.tooltip.activate(control, {text: control.dataset.tooltip});
      }
      entry.classList.toggle("advanced-interface-always-shown", this.#shown.has(button.dataset.tab));
      entry.classList.toggle("advanced-interface-pinned", this.#pinned.has(button.dataset.tab));
    }
    for (const panel of content.children) {
      const width = panelWidth(panel.dataset.tab);
      if (width !== undefined) setStyles(panel, {width: `${width}px`});
      if (!panel.classList.contains("faded-ui")) panel.classList.add("faded-ui");
      panel.classList.toggle("active", this.#openTabs.has(panel.dataset.tab));
      panel.classList.toggle("advanced-interface-always-shown", this.#shown.has(panel.dataset.tab));
      panel.classList.toggle("advanced-interface-pinned", this.#pinned.has(panel.dataset.tab));
      if (!this.#fadePanels.has(panel)) {
        this.#fadePanels.add(panel);
        const syncFade = () => {
          const entry = Array.from(menu.children).find(entry =>
            entry.querySelector("[data-tab]")?.dataset.tab === panel.dataset.tab);
          entry?.classList.toggle("advanced-interface-panel-unmuted",
            panel.classList.contains("active") && panel.matches(":hover, :has(:focus-visible)"));
          this.#hoverTab(panel.dataset.tab, panel.matches(":hover, :has(:focus-visible)")
            || !!entry?.matches(":hover, :has(:focus-visible)"));
        };
        for (const eventName of ["pointerenter", "pointerleave", "focusin", "focusout"]) {
          panel.addEventListener(eventName, () => queueMicrotask(syncFade));
        }
        // Managed panels cycle Pin and Show; third-party panels retain their context menus.
        panel.addEventListener("contextmenu", event => {
          if (!isManagedSidebarTab({tabName: panel.dataset.tab})) return;
          if (event.target.closest("#scene-controls [data-grid-snap]")) return;
          if (event.target.closest("#scene-controls-layers button[data-control]:is([data-control=drawings], [data-control=walls], [data-control=lighting], [data-control=sounds], [data-control=regions], [data-control=notes], [data-control=advancedCards])")) return;
          if (!this.#openTabs.has(panel.dataset.tab)) return;
          if (!event.target.closest("input, textarea, select, [contenteditable]")) event.preventDefault();
          this.#cyclePanelVisibility(panel.dataset.tab);
        }, {capture: true});
      }
    }
    for (const className of Array.from(content.classList)) {
      if (className.startsWith("active-") && !this.#openTabs.has(className.slice(7))) content.classList.remove(className);
    }
    for (const tab of this.#openTabs) {
      if (!content.classList.contains(`active-${tab}`)) content.classList.add(`active-${tab}`);
    }
    for (const {row, groups} of rows) {
      const [left, center, right] = groups;
      const leftGap = left.group.length ? 4 : 0;
      const rightGap = right.group.length ? 4 : 0;
      const requiredWidth = groups.filter(({group}) => group.length)
        .reduce((sum, {total}) => sum + total + 4, -4);
      let centerStart = Math.max(left.total + leftGap,
        Math.min((availableWidth - center.total) / 2,
          availableWidth - right.total - rightGap - center.total));
      centerStart = Math.max(0, Math.min(centerStart, availableWidth - center.total));
      const starts = requiredWidth > availableWidth
        ? [0, left.total + leftGap, left.total + leftGap + center.total + (center.group.length ? rightGap : 0)]
        : center.group.length
        ? [Math.min(0, centerStart - leftGap - left.total), centerStart,
          Math.max(availableWidth - right.total, centerStart + center.total + rightGap)]
        : [0, centerStart, availableWidth - right.total];
      for (const [column, {side, group, widths}] of groups.entries()) {
        let offset = 0;
        for (const [index, entry] of group.entries()) {
          const width = `${widths[index]}px`;
          const anchor = side === "left" ? 0 : side === "center"
            ? (availableWidth - widths[index]) / 2 : availableWidth - widths[index];
          const translate = `${starts[column] + offset - anchor}px 0`;
          offset += widths[index] + 4;
          const button = entry.querySelector("[data-tab]");
          const panel = button && panelsByTab.get(button.dataset.tab);
          setStyles(entry, {width, gridRow: row === "bottom" ? "3" : "1", alignSelf: row === "bottom" ? "end" : "start"});
          for (const element of [entry, ...entry.querySelectorAll("[data-tooltip]")]) {
            const direction = row === "bottom" ? "UP" : "DOWN";
            if (element.dataset.tooltipDirection !== direction) element.dataset.tooltipDirection = direction;
          }
          for (const item of [entry, panel]) {
            if (!item) continue;
            const rowChanged = item.classList.contains("advanced-interface-bottom-row") !== (row === "bottom");
            item.classList.toggle("advanced-interface-bottom-row", row === "bottom");
            if (rowChanged && item === ui.chat?.element) ui.chat.scrollBottom();
            setStyles(item, {
              gridColumn: String(column + 1),
              justifySelf: side === "left" ? "start" : side === "center" ? "center" : "end",
              translate
            });
          }
          if (panel) {
            setStyles(panel, {gridRow: "1", alignSelf: row === "bottom" ? "end" : "start"});
          }
        }
      }
    }
    this.element.classList.toggle("advanced-interface-has-bottom-row",
      entries.some(entry => entryRow(entry) === "bottom"));
    decorateIconButtons(menu);
    for (const container of [navigation, content]) {
      if (this.#scrollContainers.has(container)) continue;
      this.#scrollContainers.add(container);
      container.addEventListener("scroll", () => {
        const other = container === navigation ? content : navigation;
        if (other.scrollLeft !== container.scrollLeft) other.scrollLeft = container.scrollLeft;
      }, {passive: true});
    }
    for (const tab of automaticallyClosed) this.#notifyTab(tab, false);
    if (automaticallyClosed.length && !this.#openTabs.size) this.collapse();
  }

  async #openDraggedPopout(tab, point, anchor) {
    let app = tab === "settings" ? detachedSettingsMenu() : undefined;
    if (!app) {
      await ui[tab].renderPopout();
      app = ui[tab].popout;
    }
    const header = app?.element?.querySelector(":scope > .window-header");
    if (!header || !anchor) throw new Error(`Advanced Interface | Cannot position dragged "${tab}" popout.`);
    const rect = header.getBoundingClientRect();
    const scale = rect.height / header.offsetHeight || 1;
    app.setPosition({
      left: app.position.left + point.x - rect.left - anchor.x * scale,
      top: app.position.top + point.y - rect.top - anchor.y * scale
    });
    app.bringToFront();
  }

  #notifyTab(tab, active) {
    const app = ui[tab];
    const eventName = active ? "activate" : "deactivate";
    app._doEvent(active ? app._onActivate : app._onDeactivate, {
      eventName,
      hookName: eventName
    });
  }
}
