import {reportError} from "./helper.mjs";

// Directory tab buttons accept the same documents and folders as their directory, dropping them at its root.
const TAB_ENTRY = "#sidebar.advanced-interface > #sidebar-tabs li";
const DROP_TARGET = "advanced-interface-drop-target";

// Drag data can only be read on dragstart and drop, so the payload is kept for dragover checks.
let dragData = null;
let highlighted = null;

function parseDragData(text) {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

function readDragData(event) {
  return parseDragData(event.dataTransfer?.getData("text/plain"));
}

function acceptedType(app) {
  const {DocumentDirectory, tabs} = foundry.applications.sidebar;
  if (app instanceof DocumentDirectory) return app.documentName;
  if (app instanceof tabs.CompendiumDirectory) return "Compendium";
  return null;
}

function dropDirectory(entry, data) {
  if (!entry || !data?.type) return null;
  const app = ui[entry.querySelector("[data-tab]")?.dataset.tab];
  const type = acceptedType(app);
  if (!type || !app._canDragDrop(".directory-item")) return null;
  if (data.type === type) return app;
  if (data.type !== "Folder" || !data.uuid) return null;
  const folder = foundry.utils.fromUuidSync(data.uuid, {strict: false});
  return folder?.type === type ? app : null;
}

function highlight(entry) {
  if (highlighted === entry) return;
  highlighted?.classList.remove(DROP_TARGET);
  highlighted = entry;
  entry?.classList.add(DROP_TARGET);
}

export function registerTabDrops() {
  // Sheets and directories often stop dragstart from bubbling, so the payload is captured as it is set.
  document.addEventListener("dragstart", event => {
    dragData = null;
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const setData = transfer.setData;
    transfer.setData = function(format, data) {
      if (format === "text/plain") dragData = parseDragData(data);
      return setData.call(this, format, data);
    };
  }, {capture: true});
  document.addEventListener("dragover", event => {
    const entry = event.target.closest?.(TAB_ENTRY) ?? null;
    const app = dropDirectory(entry, dragData);
    highlight(app ? entry : null);
    if (!app) return;
    event.preventDefault();
    app._onDragOver(event);
  });
  document.addEventListener("dragleave", event => {
    if (!event.relatedTarget?.closest?.(TAB_ENTRY)) highlight(null);
  });
  document.addEventListener("drop", event => {
    highlight(null);
    const app = dropDirectory(event.target.closest?.(TAB_ENTRY), readDragData(event));
    dragData = null;
    if (!app) return;
    event.preventDefault();
    event.stopPropagation();
    // The tab is outside every folder, so the directory's own drop handling places the drop at its root.
    Promise.resolve(app._onDrop(event)).catch(reportError("Tab drop"));
  });
  document.addEventListener("dragend", () => {
    dragData = null;
    highlight(null);
  });
}
