import {MODULE_ID, localize, reportError} from "./helper.mjs";

export function snapPoint(point, {grid, modes, enabled, shiftKey = false, native} = {}) {
  if (!enabled || shiftKey || grid.isGridless) return {x: point.x, y: point.y};
  if (!grid.isSquare && native) return native(point);
  return grid.getSnappedPoint(point, {
    mode: modes.CENTER | modes.VERTEX | modes.CORNER | modes.SIDE_MIDPOINT,
    resolution: 1
  });
}

export function isGridSnapEnabled() {
  return game.settings.get(MODULE_ID, "snapToGrid");
}

export function snapCanvasPoint(point, {shiftKey = false, native} = {}) {
  return snapPoint(point, {grid: canvas.grid, modes: CONST.GRID_SNAPPING_MODES,
    enabled: isGridSnapEnabled(), shiftKey, native});
}

export function installLayerSnapping(layer) {
  const native = layer.getSnappedPoint.bind(layer);
  layer.getSnappedPoint = point => {
    const shiftKey = game.keyboard.isModifierActive("SHIFT");
    if (layer.options.name === "tokens") {
      return !isGridSnapEnabled() || shiftKey || canvas.grid.isGridless
        ? {x: point.x, y: point.y} : native(point);
    }
    return snapCanvasPoint(point, {shiftKey, native});
  };
}

export function withSnapPolicy(options = {}) {
  return {...options, snap: (options.snap ?? false) && isGridSnapEnabled()
    && !canvas.grid.isGridless && !game.keyboard.isModifierActive("SHIFT")};
}

export function registerGridSnapping() {
  game.settings.register(MODULE_ID, "snapToGrid", {
    scope: "client", config: false, type: Boolean, default: true,
    onChange: () => {
      const button = ui.controls.element?.querySelector("[data-grid-snap]");
      button?.setAttribute("aria-pressed", String(isGridSnapEnabled()));
    }
  });
  Hooks.on("getSceneControlButtons", controls => {
    for (const control of Object.values(controls)) delete control.tools?.snap;
  });
  const Token = CONFIG.Token.objectClass;
  for (const method of ["_updateDragDestination", "_addDragWaypoint", "_pasteObject"]) {
    const native = Token.prototype[method];
    Token.prototype[method] = function(point, options = {}) {
      return native.call(this, point, withSnapPolicy({...options, snap: options.snap ?? method === "_pasteObject"}));
    };
  }
  const nativeDrop = Token._getDropActorPosition;
  Token._getDropActorPosition = function(token, point, options) {
    return nativeDrop.call(this, token, point, withSnapPolicy(options));
  };
  const nativeTokenSnap = Token.prototype.getSnappedPosition;
  Token.prototype.getSnappedPosition = function(point) {
    if (isGridSnapEnabled() && !game.keyboard.isModifierActive("SHIFT")) return nativeTokenSnap.call(this, point);
    return {x: point?.x ?? this.document.x, y: point?.y ?? this.document.y};
  };
  for (const Shape of Object.values(foundry.data.BaseShapeData.TYPES)) {
    if (typeof Shape.prototype._getSnappedPoint !== "function") continue;
    const nativePoint = Shape.prototype._getSnappedPoint;
    Shape.prototype._getSnappedPoint = function(point) {
      if (this.grid !== canvas.grid) return nativePoint.call(this, point);
      return snapCanvasPoint(point, {shiftKey: game.keyboard.isModifierActive("SHIFT"),
        native: position => nativePoint.call(this, position)});
    };
    const nativeSize = Shape.prototype._calculateSize;
    Shape.prototype._calculateSize = function(length, direction, options = {}) {
      return nativeSize.call(this, length, direction, this.grid === canvas.grid ? withSnapPolicy(options) : options);
    };
  }
  const installed = new WeakSet();
  Hooks.on("canvasReady", () => {
    canvas.forceSnapVertices = false;
    for (const name of ["tokens", "tiles", "drawings", "walls", "lighting", "sounds", "regions", "notes"]) {
      const layer = canvas[name];
      if (!layer || installed.has(layer)) continue;
      installLayerSnapping(layer);
      if (name === "notes") {
        const nativeClick = layer._onClickLeft.bind(layer);
        layer._onClickLeft = async event => {
          if (game.activeTool !== "journal") return nativeClick(event);
          const point = snapCanvasPoint(event.getLocalPosition(canvas.stage), {shiftKey: event.shiftKey,
            native: position => canvas.grid.getCenterPoint(position)});
          return foundry.utils.getDocumentClass("Note").createDialog(point);
        };
      }
      installed.add(layer);
    }
  });
  Hooks.on("renderSceneControls", (_app, element) => {
    element.querySelector(".advanced-interface-grid-snap")?.remove();
    if (canvas.grid?.isGridless) return;
    const menu = element.querySelector("#scene-controls-layers");
    if (!menu) return;
    const row = element.ownerDocument.createElement("li");
    row.className = "advanced-interface-grid-snap";
    const button = element.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "ui-control icon fa-solid fa-border-inner";
    button.dataset.gridSnap = "true";
    button.dataset.tooltip = localize("Controls.SnapToGrid");
    button.setAttribute("aria-label", button.dataset.tooltip);
    button.setAttribute("aria-pressed", String(isGridSnapEnabled()));
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      game.settings.set(MODULE_ID, "snapToGrid", !isGridSnapEnabled()).catch(reportError("Grid snapping"));
    });
    row.append(button);
    menu.prepend(row);
  });
}