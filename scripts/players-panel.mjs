import {decorateIconButtons} from "./interface-components.mjs";
import {panelWidth} from "./sidebar.mjs";
import {MODULE_ID, createButton, getPanelSetting, localize, reportError, setButtonLabel, setPanelSettings, targetApp} from "./helper.mjs";

const report = reportError("Players panel");

function addPlayerAvatars(players = ui.players?.element) {
  if (!players) return;
  for (const row of players.querySelectorAll("li.player[data-user-id]")) {
    delete row.dataset.tooltipText;
    const user = game.users.get(row.dataset.userId);
    if (!user) continue;
    const src = user.avatar || user.character?.img || CONST.DEFAULT_TOKEN;
    let avatar = row.querySelector(":scope > .advanced-interface-player-avatar");
    if (!avatar) {
      avatar = row.ownerDocument.createElement("img");
      avatar.className = "advanced-interface-player-avatar";
      avatar.alt = "";
      avatar.draggable = false;
      row.prepend(avatar);
    }
    if (avatar.getAttribute("src") !== src) avatar.src = src;
  }
  syncPlayerVideos(players);
}

function activeVideoStream(userId) {
  const webrtc = game.webrtc;
  if (!webrtc?.client || !(webrtc.settings.world.mode & foundry.av.AVSettings.AV_MODES.VIDEO)) return null;
  let stream;
  try {
    stream = webrtc.client.getMediaStreamForUser(userId);
  } catch {
    return null;
  }
  if (!stream?.getVideoTracks().some(track => track.enabled && (track.readyState === "live"))) return null;
  if (!webrtc.canUserShareVideo(userId)) return null;
  if (userId !== game.userId) {
    if (webrtc.settings.client.disableVideo || webrtc.settings.getUser(userId)?.blocked) return null;
  }
  return stream;
}

function playerAVState(userId, kind) {
  const webrtc = game.webrtc;
  const isSelf = userId === game.userId;
  const audio = kind === "audio";
  let on = false;
  let allowed = true;
  try {
    on = audio ? webrtc.canUserShareAudio(userId) : webrtc.canUserShareVideo(userId);
    allowed = audio ? webrtc.canUserBroadcastAudio(userId) : webrtc.canUserBroadcastVideo(userId);
  } catch {
    on = false;
  }
  const mode = webrtc?.settings.world.mode ?? 0;
  const {AUDIO, VIDEO} = foundry.av.AVSettings.AV_MODES;
  const enabled = !!(mode & (audio ? AUDIO : VIDEO));
  let action = null;
  let label;
  if (enabled && isSelf) {
    action = audio ? "toggleAudio" : "toggleVideo";
    label = `ADVANCED_INTERFACE.PlayerAV.${audio ? (on ? "MuteAudio" : "EnableAudio") : (on ? "DisableVideo" : "EnableVideo")}`;
  } else if (enabled && game.user.isGM) {
    action = audio ? "blockAudio" : "blockVideo";
    label = `ADVANCED_INTERFACE.PlayerAV.${allowed ? "Block" : "Allow"}${audio ? "Audio" : "Video"}`;
  } else {
    label = `ADVANCED_INTERFACE.PlayerAV.${audio ? "Audio" : "Video"}${on ? "On" : "Off"}`;
  }
  const icon = audio ? (on ? "fa-microphone" : "fa-microphone-slash") : (on ? "fa-video" : "fa-video-slash");
  return {on, action, icon, label: game.i18n.localize(label)};
}

// Microphone and camera status icons in each player card header; clicking forwards to the camera dock's own actions.
function syncPlayerAVIcons(row) {
  const userId = row.dataset.userId;
  let group = row.querySelector(":scope > .advanced-interface-player-av");
  if (!group) {
    group = row.ownerDocument.createElement("div");
    group.className = "advanced-interface-player-av";
    for (const kind of ["audio", "video"]) {
      const button = row.ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.kind = kind;
      button.dataset.user = userId;
      button.dataset.tooltipDirection = "DOWN";
      group.append(button);
    }
    group.addEventListener("click", onPlayerAVClick);
    group.addEventListener("contextmenu", event => event.stopPropagation());
    row.append(group);
  }
  for (const button of group.children) {
    const {on, action, icon, label} = playerAVState(userId, button.dataset.kind);
    button.classList.remove(...[...button.classList].filter(c => /^fa-(microphone|video)/.test(c)));
    button.classList.add("ui-control", "plain", "icon", "fa-solid", "fa-fw", icon);
    button.classList.toggle("advanced-interface-player-av-off", !on);
    button.setAttribute("aria-pressed", String(on));
    button.disabled = !action;
    if (action) button.dataset.avAction = action;
    else delete button.dataset.avAction;
    setButtonLabel(button, label);
  }
}

function onPlayerAVClick(event) {
  const button = event.target.closest("button[data-av-action]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const action = ui.webrtc?.options.actions?.[button.dataset.avAction];
  const handler = typeof action === "function" ? action : action?.handler;
  Promise.resolve().then(() => {
    if (typeof handler !== "function") throw new Error(`Advanced Interface | A/V action "${button.dataset.avAction}" is unavailable.`);
    return handler.call(ui.webrtc, event, button);
  }).finally(() => syncAllPlayerVideos()).catch(report);
}

function syncAllPlayerVideos() {
  syncPlayerVideos();
  for (const app of floatingCards.values()) app.refresh();
}

/* -------------------------------------------- */
/*  Floating player cards                       */
/* -------------------------------------------- */

const FLOATING_SETTING = "floatingPlayers";
const DRAG_THRESHOLD = 5;
const floatingCards = new Map();

function floatingState() {
  return getPanelSetting(FLOATING_SETTING, {});
}

function saveFloating(userId, position) {
  const state = floatingState();
  if (position) state[userId] = {left: Math.round(position.left), top: Math.round(position.top)};
  else delete state[userId];
  return setPanelSettings({[FLOATING_SETTING]: state}).catch(report);
}

function markFloatingRows(players = ui.players?.element) {
  for (const row of players?.querySelectorAll("li.player[data-user-id]") ?? []) {
    row.classList.toggle("advanced-interface-player-floating", floatingCards.has(row.dataset.userId));
  }
}

function playersPanelElement() {
  const players = ui.players?.element;
  return players?.closest(".sidebar-tab") ?? players ?? null;
}

function overPlayersPanel(x, y) {
  const panel = playersPanelElement();
  if (!panel?.offsetParent || panel.ownerDocument !== document) return false;
  const rect = panel.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function dragGhost(row, rect) {
  const doc = row.ownerDocument;
  const wrapper = doc.createElement("ol");
  wrapper.className = "advanced-interface-player-window advanced-interface-player-drag-ghost plain";
  wrapper.style.width = `${rect.width}px`;
  const clone = row.cloneNode(true);
  clone.classList.remove("advanced-interface-player-floating", "context");
  const video = row.querySelector(":scope > video");
  const cloneVideo = clone.querySelector(":scope > video");
  if (video && cloneVideo) {
    cloneVideo.srcObject = video.srcObject;
    cloneVideo.play().catch(() => {});
  }
  wrapper.append(clone);
  doc.body.append(wrapper);
  return wrapper;
}

/**
 * Track a pointer drag beginning on a player card.
 * @param {PointerEvent} event
 * @param {HTMLElement} row
 * @param {object} handlers
 * @param {Function} [handlers.start]  Called once the pointer passes the drag threshold; may return a move handler.
 * @param {Function} [handlers.end]    Called with the release event if the drag started.
 */
function trackPlayerDrag(event, row, {start, end}) {
  const doc = row.ownerDocument;
  const origin = {x: event.clientX, y: event.clientY};
  const rect = row.getBoundingClientRect();
  const offset = {x: event.clientX - rect.left, y: event.clientY - rect.top};
  let onMove = null;
  let started = false;
  const move = ev => {
    if (ev.pointerId !== event.pointerId) return;
    if (!started) {
      if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_THRESHOLD) return;
      started = true;
      game.tooltip?.deactivate?.();
      onMove = start?.(rect) ?? null;
    }
    onMove?.(ev.clientX - offset.x, ev.clientY - offset.y);
  };
  const finish = ev => {
    if (ev.pointerId !== event.pointerId) return;
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", finish);
    doc.removeEventListener("pointercancel", finish);
    if (started) end?.(ev, {left: ev.clientX - offset.x, top: ev.clientY - offset.y}, ev.type === "pointercancel");
  };
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", finish);
  doc.addEventListener("pointercancel", finish);
}

function onPanelPlayerPointerDown(event) {
  if (event.button !== 0) return;
  const row = event.target.closest("li.player[data-user-id]");
  if (!row || event.target.closest("button, a, input, select, textarea, [role='button'], .advanced-interface-card-actions")) return;
  event.preventDefault();
  let ghost = null;
  trackPlayerDrag(event, row, {
    start: rect => {
      ghost = dragGhost(row, rect);
      return (left, top) => Object.assign(ghost.style, {left: `${left}px`, top: `${top}px`});
    },
    end: (ev, position, cancelled) => {
      ghost?.querySelector("video")?.removeAttribute("src");
      ghost?.remove();
      if (cancelled || overPlayersPanel(ev.clientX, ev.clientY)) return;
      if (row.ownerDocument !== document) position = {left: undefined, top: undefined};
      openPlayerCard(row.dataset.userId, position).catch(report);
    }
  });
}

function bindPanelDrag(players = ui.players?.element) {
  if (!players || players.dataset.advancedInterfaceDrag) return;
  players.dataset.advancedInterfaceDrag = "true";
  players.addEventListener("pointerdown", onPanelPlayerPointerDown);
}

class PlayerCardWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "ol",
    classes: ["advanced-interface-player-window", "plain"],
    window: {frame: false, positioned: true},
    position: {width: panelWidth("advancedPlayers"), height: "auto"}
  };

  get userId() {
    return this.options.userId;
  }

  async _renderHTML() {
    return null;
  }

  _replaceHTML() {
    this.refresh();
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
    new ContextMenu(this.element, ".player", ui.players?._getContextMenuOptions?.() ?? [], {fixed: true, jQuery: false});
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.raise();
  }

  // Floating player cards stay in the main window; they have no individual detach.
  _canDetach() {
    return false;
  }

  // Frameless cards have no closing transition, so animating would just wait out Foundry's 1s timeout.
  close(options = {}) {
    return super.close({animate: false, ...options});
  }

  _onClose(options) {
    super._onClose(options);
    if (floatingCards.get(this.userId) === this) floatingCards.delete(this.userId);
    markFloatingRows();
    if (!options.keepSaved) saveFloating(this.userId, null);
  }

  raise() {
    if (!this.element) return;
    const Base = foundry.applications.api.ApplicationV2;
    this.element.style.zIndex = String(++Base._maxZ);
  }

  refresh() {
    const element = this.element;
    if (!element) return;
    const user = game.users.get(this.userId);
    if (!user) {
      this.close();
      return;
    }
    const doc = element.ownerDocument;
    let row = element.querySelector(":scope > li.player");
    if (!row) {
      row = doc.createElement("li");
      const name = doc.createElement("span");
      name.className = "player-name ellipsis";
      row.append(name);
      element.append(row);
    }
    const idle = user.active && user.idle;
    const classes = ["player", "flexrow", user.active && "active", user.isGM && "gm", user.isSelf && "self", idle && "idle",
      row.classList.contains("advanced-interface-player-has-video") && "advanced-interface-player-has-video",
      row.classList.contains("advanced-interface-card") && "advanced-interface-card",
      row.classList.contains("advanced-interface-card-menu-open") && "advanced-interface-card-menu-open",
      row.classList.contains("context") && "context"];
    row.className = classes.filter(Boolean).join(" ");
    row.dataset.userId = user.id;
    row.style.setProperty("--player-color", user.active ? user.color.css : "#333333");
    row.style.setProperty("--player-border", user.active ? user.border.css : "#000000");
    row.querySelector(":scope > .player-name").textContent = ui.players?._formatName?.(user) ?? user.name;
    addPlayerAvatars(element);
    this.#syncControls(row);
    const video = row.querySelector(":scope > video");
    if (video?.paused) video.play().catch(() => {});
    decorateIconButtons(element);
  }

  #syncControls(row) {
    const doc = row.ownerDocument;
    let group = row.querySelector(":scope > .advanced-interface-player-window-controls");
    if (!group) {
      group = doc.createElement("div");
      group.className = "advanced-interface-player-window-controls";
      const button = createButton(doc, "ui-control plain icon fa-solid fa-fw fa-xmark", {
        label: game.i18n.localize("APPLICATION.TOOLS.Close"),
        context: "Close player card",
        onClick: () => {
          game.tooltip?.deactivate?.();
          return this.close();
        }
      });
      button.dataset.tooltipDirection = "DOWN";
      group.append(button);
      group.addEventListener("contextmenu", event => event.stopPropagation());
    }
    if (row.lastElementChild !== group) row.append(group);
  }

  #onPointerDown(event) {
    this.raise();
    if (event.button !== 0) return;
    if (event.target.closest("button, a, input, select, textarea, [role='button'], .advanced-interface-card-actions")) return;
    const row = event.target.closest("li.player");
    if (!row) return;
    event.preventDefault();
    trackPlayerDrag(event, row, {
      start: () => {
        this.element.classList.add("advanced-interface-player-dragging");
        return (left, top) => this.setPosition({left, top});
      },
      end: (ev, position, cancelled) => {
        this.element?.classList.remove("advanced-interface-player-dragging");
        if (!cancelled && overPlayersPanel(ev.clientX, ev.clientY)) this.close();
        else saveFloating(this.userId, this.position);
      }
    });
  }
}

async function openPlayerCard(userId, position = {}, {save = true} = {}) {
  if (!game.users.get(userId)) return;
  let app = floatingCards.get(userId);
  if (!app) {
    app = new PlayerCardWindow({id: `advanced-interface-player-${userId}`, userId});
    floatingCards.set(userId, app);
  }
  markFloatingRows();
  await app.render({force: true, position: {...position, width: panelWidth("advancedPlayers")}});
  if (save) await saveFloating(userId, app.position);
  return app;
}

function restoreFloatingCards() {
  for (const [userId, position] of Object.entries(floatingState())) {
    if (!game.users.get(userId)) {
      saveFloating(userId, null);
      continue;
    }
    openPlayerCard(userId, position, {save: false}).catch(report);
  }
}

// Mirror each user's live camera into the body of their player card; audio stays with the camera dock.
function syncPlayerVideos(players = ui.players?.element) {
  if (!players) return;
  for (const row of players.querySelectorAll("li.player[data-user-id]")) {
    syncPlayerAVIcons(row);
    const stream = activeVideoStream(row.dataset.userId);
    let video = row.querySelector(":scope > .advanced-interface-player-video");
    row.classList.toggle("advanced-interface-player-has-video", !!stream);
    if (!stream) {
      if (video) {
        video.srcObject = null;
        video.remove();
      }
      continue;
    }
    if (!video) {
      video = row.ownerDocument.createElement("video");
      video.className = "advanced-interface-player-video";
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      const fit = () => {
        if (video.videoWidth && video.videoHeight) {
          video.style.setProperty("--advanced-interface-video-ratio", `${video.videoWidth} / ${video.videoHeight}`);
        }
      };
      video.addEventListener("loadedmetadata", fit);
      video.addEventListener("resize", fit);
      row.append(video);
    }
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }
}

let avControls = null;

// The camera dock itself is hidden (it still plays everyone's audio); minimizing it would stop all video.
function keepDockExpanded() {
  const settings = game.webrtc?.settings;
  if (settings?.client.hideDock) settings.set("client", "hideDock", false);
}

// The A/V buttons are built by the module rather than borrowed from the camera dock, so they stay available even when
// A/V is disabled for the world (the dock does not render then). Audio and video toggle the world's conferencing mode.
async function toggleConferencingMode(flag) {
  if (!game.user.isGM) throw new Error("Only a GM can change the world's conferencing mode.");
  const settings = foundry.utils.deepClone(game.settings.get("core", "rtcWorldSettings"));
  settings.mode ^= flag;
  await game.settings.set("core", "rtcWorldSettings", settings);
  return foundry.applications.settings.SettingsConfig.reloadConfirm({world: true});
}

const AV_BAR_ACTIONS = {
  configure: () => game.webrtc.config.render({force: true}),
  mutePeers: () => toggleConferencingMode(foundry.av.AVSettings.AV_MODES.AUDIO),
  disableVideo: () => toggleConferencingMode(foundry.av.AVSettings.AV_MODES.VIDEO)
};

function createAVControls() {
  const bar = document.createElement("div");
  bar.className = "user-controls advanced-interface-av-controls";
  bar.setAttribute("role", "menu");
  for (const action of ["configure", "mutePeers", "disableVideo"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "av-control inline-control icon fa-solid fa-fw";
    if (action !== "configure") button.classList.add("toggle");
    button.dataset.action = action;
    button.dataset.tooltip = "";
    bar.append(button);
  }
  bar.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    const action = AV_BAR_ACTIONS[button?.dataset.action];
    if (!action || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    Promise.resolve().then(action).catch(report).finally(() => updateAVControls());
  });
  return bar;
}

// Audio and video icons and tooltips follow the world's conferencing mode, which only a GM can change.
function updateAVControls(bar = avControls) {
  const settings = game.webrtc?.settings;
  if (!bar || !settings) return;
  const {AUDIO, VIDEO} = foundry.av.AVSettings.AV_MODES;
  const mode = settings.world.mode;
  const usable = {mutePeers: game.user.isGM, disableVideo: game.user.isGM, configure: true};
  const states = {
    mutePeers: mode & AUDIO ? ["fa-microphone", "MuteAudio"] : ["fa-microphone-slash", "UnmuteAudio"],
    disableVideo: mode & VIDEO ? ["fa-video", "DisableVideo"] : ["fa-video-slash", "EnableVideo"],
    configure: ["fa-headset", "Configuration"]
  };
  for (const [action, [icon, key]] of Object.entries(states)) {
    const button = bar.querySelector(`:scope > [data-action="${action}"]`);
    if (!button) continue;
    button.classList.remove("fa-microphone", "fa-microphone-slash", "fa-video", "fa-video-slash", "fa-cog");
    button.classList.add(icon);
    button.disabled = !usable[action];
    if (action === "configure") button.removeAttribute("aria-pressed");
    else button.setAttribute("aria-pressed", String(!icon.endsWith("-slash")));
    button.setAttribute("aria-label", localize(`PlayerAV.${key}`));
  }
  decorateIconButtons(bar);
}

const playerGroupsExpanded = {online: true, offline: false};

function placePlayerHeadings(players) {
  for (const [group, id] of [["online", "players-active"], ["offline", "players-inactive"]]) {
    const list = players.querySelector(`#${id}`);
    if (!list) continue;
    let header = players.querySelector(`[data-player-group="${group}"]`);
    if (!header) {
      header = players.ownerDocument.createElement("header");
      header.className = "advanced-interface-player-heading";
      header.dataset.playerGroup = group;
      const label = players.ownerDocument.createElement("span");
      label.className = "advanced-interface-player-heading-label";
      label.textContent = localize(`PlayerGroups.${group}`);
      const shutter = createButton(players.ownerDocument, "ui-control icon fa-solid fa-chevron-up", {
        label: label.textContent
      });
      shutter.classList.add("advanced-interface-player-shutter");
      shutter.setAttribute("aria-controls", id);
      const sync = () => {
        const expanded = playerGroupsExpanded[group];
        shutter.setAttribute("aria-expanded", String(expanded));
        list.hidden = !expanded;
      };
      shutter.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        playerGroupsExpanded[group] = !playerGroupsExpanded[group];
        sync();
      });
      header.append(label, shutter);
      sync();
    }
    players.append(header, list);
  }
  decorateIconButtons(players);
}

function placeAVControls() {
  const players = ui.players?.element;
  const content = players?.closest(".advanced-interface-utility-content");
  const stats = players?.querySelector("#performance-stats");
  if (!content || !stats) return;
  stats.querySelector(":scope > #players-expand")?.remove();
  placePlayerHeadings(players);
  avControls ??= createAVControls();
  for (const old of content.parentElement.querySelectorAll(":scope > .user-controls, #players > .user-controls")) {
    if (old !== avControls) old.remove();
  }
  if (avControls.parentElement !== stats) stats.append(avControls);
  updateAVControls();
}

export function placePlayers(app = targetApp("advancedPlayers", {includeDetached: true})) {
  const host = app?.element?.querySelector(".advanced-interface-utility-content");
  const players = ui.players?.element;
  if (host && players) {
    const stats = players.querySelector("#performance-stats");
    if (stats && players.firstElementChild !== stats) players.prepend(stats);
    if (players.parentElement !== host) {
      players.classList.remove("faded-ui");
      host.append(players);
    }
    placeAVControls();
  }
}

export function registerFloatingPlayersSetting() {
  game.settings.register(MODULE_ID, FLOATING_SETTING, {scope: "client", config: false, type: Object, default: {}});
}

Hooks.on("renderPlayers", (app, element) => {
  addPlayerAvatars(element);
  markFloatingRows(element);
  bindPanelDrag(element);
  placePlayers();
  for (const card of floatingCards.values()) card.refresh();
});
Hooks.on("updateUser", (user, changes) => {
  if ("avatar" in changes || "character" in changes) addPlayerAvatars();
  else if ("permissions" in changes || "role" in changes) syncPlayerVideos();
  floatingCards.get(user.id)?.refresh();
});
Hooks.on("deleteUser", user => floatingCards.get(user.id)?.close());
Hooks.on("renderCameraViews", () => {
  placeAVControls();
  syncAllPlayerVideos();
});
Hooks.on("rtcSettingsChanged", () => {
  keepDockExpanded();
  updateAVControls();
  syncAllPlayerVideos();
});
Hooks.on("ready", () => {
  keepDockExpanded();
  placePlayers();
  bindPanelDrag();
  const players = ui.players;
  if (players && !players._advancedInterfaceIdle) {
    players._advancedInterfaceIdle = true;
    const onChangeIdleStatus = players._onChangeIdleStatus;
    players._onChangeIdleStatus = function(user, row) {
      onChangeIdleStatus.call(this, user, row);
      floatingCards.get(user.id)?.refresh();
    };
  }
  restoreFloatingCards();
});
