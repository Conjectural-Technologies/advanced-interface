import {decorateIconButtons, decoratePlaylistSoundIcons} from "./interface-components.mjs";
import {localize, reportError, setButtonLabel} from "./helper.mjs";

const SOUND_PARTIAL_TEMPLATE = "templates/sidebar/tabs/playlist/sound-partial.hbs";
const playlistPlaybackRenders = new WeakMap();

// Playing: loop, stop, pause. Paused: loop, stop, resume.
function placePlaybackButtons(row, playback) {
  const controls = row.querySelector(":scope > header > .sound-controls");
  if (!controls) throw new Error("Advanced Interface | Sound controls are unavailable.");
  const pause = playback.querySelector("[data-action='soundPause']");
  const stop = controls.querySelector("[data-action='soundStop']");
  const resume = controls.querySelector("[data-action='soundPlay']");
  if (stop && pause) {
    pause.classList.add("advanced-interface-playback-control");
    controls.append(pause);
    return;
  }
  pause?.remove();
  if (!resume) return;
  resume.classList.replace("fa-play-circle", "fa-play");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-control sound-control icon fa-solid fa-square advanced-interface-playback-control";
  button.dataset.action = "soundStop";
  button.dataset.tooltip = "";
  button.setAttribute("aria-label", game.i18n.localize("PLAYLIST.SoundStop"));
  button.disabled = resume.disabled;
  resume.before(button);
}

async function addPlaybackToPlaylistSounds(app, element) {
  const contexts = app._playing?.context;
  if (!Array.isArray(contexts)) throw new Error("Advanced Interface | Playlist playback context is unavailable.");
  const token = {};
  playlistPlaybackRenders.set(element, token);
  const rendered = await Promise.all(contexts.map(async context => ({
    uuid: context.uuid,
    html: await foundry.applications.handlebars.renderTemplate(SOUND_PARTIAL_TEMPLATE, {
      ...context, duration: context.durationTime, playback: true
    })
  })));
  if (playlistPlaybackRenders.get(element) !== token) return;
  for (const row of element.querySelectorAll(".directory-list .sound.advanced-interface-sound-playback")) {
    row.querySelector(":scope > .sound-playback")?.remove();
    for (const control of row.querySelectorAll(".advanced-interface-playback-control")) control.remove();
    row.classList.remove("advanced-interface-sound-playback");
  }
  for (const {uuid, html} of rendered) {
    const row = element.querySelector(`.directory-list .sound[data-sound-uuid="${CSS.escape(uuid)}"]`);
    if (!row) continue;
    const template = document.createElement("template");
    template.innerHTML = html;
    const playback = template.content.querySelector(".sound-playback");
    if (!playback) throw new Error(`Advanced Interface | Playback controls for "${uuid}" are unavailable.`);
    placePlaybackButtons(row, playback);
    row.append(playback);
    row.classList.add("advanced-interface-sound-playback");
    playback.addEventListener("pointerdown", () => {
      const draggables = [];
      for (let node = playback.parentElement; node; node = node.parentElement) {
        if (node.draggable) draggables.push(node);
      }
      if (!draggables.length) return;
      for (const node of draggables) node.draggable = false;
      const restore = () => {
        for (const node of draggables) node.draggable = true;
        window.removeEventListener("pointerup", restore);
        window.removeEventListener("pointercancel", restore);
      };
      window.addEventListener("pointerup", restore);
      window.addEventListener("pointercancel", restore);
    });
    const slider = playback.querySelector(".sound-volume");
    if (slider) updateVolumeIcon(slider);
  }
}

function updatePlaylistTimestamps(app) {
  const {formatTimestamp} = app.constructor;
  for (const sound of app._playing?.sounds ?? []) {
    const selector = `.playlists-sidebar .directory-list .sound[data-sound-uuid="${CSS.escape(sound.uuid)}"]`;
    for (const row of document.querySelectorAll(selector)) {
      const playback = row.querySelector(":scope > .sound-playback");
      if (!playback) continue;
      const current = playback.querySelector(".current");
      if (current) current.textContent = formatTimestamp(sound.playing ? sound.sound.currentTime : sound.pausedTime);
      const duration = playback.querySelector(".duration");
      if (duration) duration.textContent = formatTimestamp(sound.sound.duration);
      const pause = row.querySelector(".pause");
      if (pause?.classList.contains("fa-spinner")) {
        pause.classList.remove("fa-spin");
        pause.classList.replace("fa-spinner", "fa-pause");
      }
    }
  }
}

// Keeps the inline playback timestamps of playing sounds current.
export function patchPlaylistTimestamps() {
  const PlaylistDirectory = foundry.applications.sidebar.tabs.PlaylistDirectory;
  const updateTimestamps = PlaylistDirectory.prototype.updateTimestamps;
  if (typeof updateTimestamps !== "function") {
    throw new Error("Advanced Interface | PlaylistDirectory#updateTimestamps is unavailable.");
  }
  PlaylistDirectory.prototype.updateTimestamps = function(...args) {
    const result = updateTimestamps.apply(this, args);
    updatePlaylistTimestamps(this);
    return result;
  };
}

function volumeIconClass(value) {
  if (value <= 0) return "fa-volume-xmark";
  if (value < 0.25) return "fa-volume-off";
  if (value < 0.5) return "fa-volume-low";
  if (value < 0.75) return "fa-volume";
  return "fa-volume-high";
}

const unmutedVolumes = new Map();
const mutedVolumeControls = new Set();
const volumeButtonChanges = new WeakSet();

function volumeControlKey(slider) {
  return slider.closest("[data-sound-uuid]")?.dataset.soundUuid || slider.name;
}

function updateVolumeIcon(slider, rawValue = slider.value) {
  let icon = slider.closest("li, .sound-playback")?.querySelector(".volume-icon");
  if (!icon) return;
  if (icon.tagName !== "BUTTON") {
    const button = icon.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `${icon.className} ui-control icon`;
    icon.replaceWith(button);
    icon = button;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const key = volumeControlKey(slider);
      const current = Number(slider.value);
      if (current > 0) unmutedVolumes.set(key, current);
      const mute = current > 0;
      if (mute) mutedVolumeControls.add(key);
      else mutedVolumeControls.delete(key);
      volumeButtonChanges.add(slider);
      try {
        slider.value = mute ? 0 : (unmutedVolumes.get(key) ?? (Number(slider.max) || 1));
      } finally {
        volumeButtonChanges.delete(slider);
      }
      updateVolumeIcon(slider);
    });
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new Error(`Advanced Interface | Invalid volume value "${rawValue}".`);
  icon.classList.remove("fa-volume-xmark", "fa-volume-off", "fa-volume-low", "fa-volume", "fa-volume-high");
  icon.classList.add(volumeIconClass(value));
  if (value > 0) mutedVolumeControls.delete(volumeControlKey(slider));
  icon.setAttribute("aria-pressed", String(mutedVolumeControls.has(volumeControlKey(slider))));
  setButtonLabel(icon, localize(`Volume.${value === 0 ? "Unmute" : "Mute"}`));
  decorateIconButtons(icon.parentElement);
}

const GLOBAL_VOLUMES = ["globalPlaylistVolume", "globalAmbientVolume", "globalInterfaceVolume"];
const VOLUME_RESTORE_KEY = "advanced-interface.volumeRestore";

function allVolumesMuted() {
  return GLOBAL_VOLUMES.every(key => !(game.settings.get("core", key) > 0));
}

// Right-clicking the Volume tab mutes every global volume, remembering the levels so a second right-click restores them.
export async function toggleAllVolumes() {
  const {volumeToInput} = foundry.audio.AudioHelper;
  if (allVolumesMuted()) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(VOLUME_RESTORE_KEY)) ?? {};
    } catch {
      saved = {};
    }
    await Promise.all(GLOBAL_VOLUMES.map(key => {
      mutedVolumeControls.delete(key);
      const value = saved[key] > 0 ? saved[key] : game.settings.settings.get(`core.${key}`).default;
      return game.settings.set("core", key, value);
    }));
  } else {
    const values = Object.fromEntries(GLOBAL_VOLUMES.map(key => [key, game.settings.get("core", key)]));
    localStorage.setItem(VOLUME_RESTORE_KEY, JSON.stringify(values));
    await Promise.all(GLOBAL_VOLUMES.map(key => {
      if (values[key] > 0) unmutedVolumes.set(key, volumeToInput(values[key]));
      mutedVolumeControls.add(key);
      return game.settings.set("core", key, 0);
    }));
  }
  syncVolumeTabIcon();
}

function syncVolumeTabIcon() {
  const button = document.querySelector('#sidebar-tabs [data-tab="advancedVolume"]');
  if (!button || !game.ready) return;
  const muted = allVolumesMuted();
  button.classList.toggle("fa-volume-high", !muted);
  button.classList.toggle("fa-volume-xmark", muted);
  decorateIconButtons(button.parentElement);
}

function onGlobalVolumeChanged(settingKey) {
  const key = GLOBAL_VOLUMES.find(key => settingKey === `core.${key}`);
  if (!key) return;
  if (game.settings.get("core", key) > 0) mutedVolumeControls.delete(key);
  syncVolumeTabIcon();
}

Hooks.on("updateSetting", setting => onGlobalVolumeChanged(setting.key));
Hooks.on("clientSettingChanged", key => onGlobalVolumeChanged(key));
Hooks.on("renderAdvancedSidebar", () => syncVolumeTabIcon());
Hooks.on("ready", () => syncVolumeTabIcon());

const volumeIconElements = new WeakSet();

export function watchVolumeIcons(element) {
  for (const slider of element.querySelectorAll(".global-volume-slider, .sound-volume")) updateVolumeIcon(slider);
  if (volumeIconElements.has(element)) return;
  volumeIconElements.add(element);
  for (const eventName of ["input", "change"]) {
    element.addEventListener(eventName, event => {
      const slider = event.target.closest(".global-volume-slider, .sound-volume");
      if (slider) {
        if (!volumeButtonChanges.has(slider)) mutedVolumeControls.delete(volumeControlKey(slider));
        const value = event.target instanceof HTMLInputElement ? event.target.value : slider.value;
        updateVolumeIcon(slider, value);
        const tooltip = foundry.audio.AudioHelper.volumeToPercentage(Number(value));
        slider.dataset.tooltipText = tooltip;
        slider.ariaValueText = foundry.audio.AudioHelper.volumeToPercentage(Number(value), {label: true});
        game.tooltip.activate(slider, {text: tooltip});
      }
    });
  }
}

// Playlist skip controls read Previous Sound / Next Sound with step glyphs, Sequential Playback uses a 1-9 sort glyph,
// and an active Loop Sound shows as pressed.
function relabelPlaylistSkipControls(element) {
  for (const button of element.querySelectorAll('[data-action="playlistMode"].fa-circle-right')) {
    button.classList.replace("fa-circle-right", "fa-arrow-down-1-9");
    button.classList.replace("fa-regular", "fa-solid");
  }
  for (const button of element.querySelectorAll('[data-action="soundRepeat"]')) {
    button.setAttribute("aria-pressed", String(!button.classList.contains("inactive")));
  }
  for (const [action, icon, old, key] of [
    ["playlistBackward", "fa-backward-step", "fa-backward", "Previous"],
    ["playlistForward", "fa-forward-step", "fa-forward", "Next"]
  ]) {
    for (const button of element.querySelectorAll(`[data-action="${action}"]`)) {
      button.classList.remove(old);
      button.classList.add(icon);
      setButtonLabel(button, localize(`Playlists.${key}`));
    }
  }
  decorateIconButtons(element);
}

Hooks.on("renderPlaylistDirectory", (app, element) => {
  decoratePlaylistSoundIcons(element);
  relabelPlaylistSkipControls(element);
  watchVolumeIcons(element);
  addPlaybackToPlaylistSounds(app, element).catch(reportError("Playlist playback controls"));
});
