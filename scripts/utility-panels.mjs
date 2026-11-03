import {decorateIconButtons} from "./interface-components.mjs";
import {placePlayers, registerFloatingPlayersSetting} from "./players-panel.mjs";
import {watchVolumeIcons} from "./playlists.mjs";
import {createTimePanel, placeCalendar} from "./time-panel.mjs";
import {reportError, targetApp} from "./helper.mjs";

const report = reportError("Utility panels");

function placeSceneControls(app = targetApp("advancedControls", {includeDetached: true})) {
  const host = app?.element?.querySelector(".advanced-interface-utility-content");
  const controls = ui.controls?.element;
  if (host && controls && controls.parentElement !== host) {
    controls.classList.remove("faded-ui");
    host.append(controls);
  }
}

function placeVolumeControls(app = targetApp("advancedVolume", {includeDetached: true})) {
  const host = app?.element?.querySelector(".advanced-interface-utility-content");
  const source = ui.playlists?.element?.querySelector(".global-volume");
  if (!host || !source) return;
  const controls = source.cloneNode(true);
  controls.classList.add("expanded");
  controls.querySelector("header")?.remove();
  for (const slider of controls.querySelectorAll(".global-volume-slider")) {
    slider.value = foundry.audio.AudioHelper.volumeToInput(game.settings.get("core", slider.name));
  }
  for (const icon of controls.querySelectorAll("button.volume-icon")) {
    const replacement = controls.ownerDocument.createElement("i");
    replacement.className = "volume-icon fa-solid fa-volume";
    icon.replaceWith(replacement);
  }
  host.replaceChildren(controls);
  controls.addEventListener("change", event => {
    const slider = event.target.closest(".global-volume-slider");
    if (slider) ui.playlists._onGlobalVolume(slider);
  });
  watchVolumeIcons(controls);
  decorateIconButtons(controls);
}

export function registerUtilityPanels(Sidebar) {
  registerFloatingPlayersSetting();
  const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sidebar.AbstractSidebarTab);
  class UtilityPanel extends Base {
    static PARTS = {content: {template: "modules/advanced-interface/templates/utility-panel.hbs"}};
    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.tabName === "advancedPlayers") placePlayers();
      if (this.tabName === "advancedControls") placeSceneControls();
      if (this.tabName === "advancedVolume") placeVolumeControls();
    }
    async _onClose(options) {
      await super._onClose(options);
      if (this.isPopout) {
        if (this.tabName === "advancedPlayers") placePlayers(ui.advancedPlayers);
        else if (this.tabName === "advancedControls") placeSceneControls(ui.advancedControls);
        else if (this.tabName === "advancedVolume") placeVolumeControls(ui.advancedVolume);
        else placeCalendar(ui.advancedTime);
      }
    }
  }
  class PlayersPanel extends UtilityPanel {
    static tabName = "advancedPlayers";
    static DEFAULT_OPTIONS = {id: "advancedPlayers"};
  }
  class SceneControlsPanel extends UtilityPanel {
    static tabName = "advancedControls";
    static DEFAULT_OPTIONS = {id: "advancedControls"};
  }
  class VolumeControlsPanel extends UtilityPanel {
    static tabName = "advancedVolume";
    static DEFAULT_OPTIONS = {id: "advancedVolume", classes: ["playlists-sidebar"]};
  }
  const TimePanel = createTimePanel(UtilityPanel);
  CONFIG.ui.advancedPlayers = PlayersPanel;
  CONFIG.ui.advancedTime = TimePanel;
  CONFIG.ui.advancedControls = SceneControlsPanel;
  CONFIG.ui.advancedVolume = VolumeControlsPanel;
  Sidebar.TABS = {...Sidebar.TABS,
    advancedVolume: {tooltip: "ADVANCED_INTERFACE.Volume.Title", icon: "fa-solid fa-volume-high"},
    advancedControls: {tooltip: "ADVANCED_INTERFACE.SceneControls.Title", icon: "fa-solid fa-grid-round"},
    advancedTime: {tooltip: "ADVANCED_INTERFACE.Time.Title", icon: "fa-solid fa-calendar-clock"},
    advancedPlayers: {tooltip: "ADVANCED_INTERFACE.Players", icon: "fa-solid fa-users"}
  };
}

Hooks.once("i18nInit", () => {
  if (game.i18n.has("ADVANCED_INTERFACE.Time.Set")) return;
  // A running server can still have the module's old language manifest cached.
  fetch("modules/advanced-interface/lang/en.json").then(async response => {
    if (!response.ok) throw new Error(`Advanced Interface | Language load failed: ${response.status}`);
    const translations = foundry.utils.expandObject(await response.json());
    foundry.utils.mergeObject(game.i18n.translations, translations, {overwrite: false});
  }).catch(report);
});

Hooks.on("renderSceneControls", () => placeSceneControls());
Hooks.on("renderPlaylistDirectory", () => placeVolumeControls());
Hooks.on("ready", () => placeSceneControls());
function onVolumeSettingChanged(key) {
  if (["core.globalPlaylistVolume", "core.globalAmbientVolume", "core.globalInterfaceVolume"].includes(key)) {
    placeVolumeControls();
  }
}

Hooks.on("updateSetting", setting => onVolumeSettingChanged(setting.key));
Hooks.on("clientSettingChanged", key => onVolumeSettingChanged(key));
