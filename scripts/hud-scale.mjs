import {MODULE_ID, reportError} from "./helper.mjs";

const SETTING = "fixedHUDSize";
const reportZoomError = reportError("Zoom controls");
const fixedIcons = new Map();
const fixedSizes = { hud: false, doors: false };

function syncCanvasControlIcons() {
  if ( !canvas.ready ) return;
  const zoom = canvas.stage.scale.x;
  const update = (icon, factor, wall) => {
    if ( !icon || icon.destroyed ) return;
    if ( !fixedIcons.has(icon) ) fixedIcons.set(icon, { x: icon.scale.x, y: icon.scale.y, wall });
    const original = fixedIcons.get(icon);
    const x = original.x * factor;
    const y = original.y * factor;
    if ( icon.scale.x !== x || icon.scale.y !== y ) icon.scale.set(x, y);
    if ( wall ) {
      const offset = (icon.controlSize ?? 40) / 2 * canvas.dimensions.uiScale;
      const [midX, midY] = wall.midpoint;
      const px = midX - offset * x;
      const py = midY - offset * y;
      if ( icon.position.x !== px || icon.position.y !== py ) icon.position.set(px, py);
    }
  };
  if ( fixedSizes.doors ) {
    for ( const wall of canvas.walls.placeables ) {
      update(wall.doorControl, Math.max(1, 1 / (zoom * canvas.dimensions.uiScale)), wall);
    }
  }
  if ( fixedSizes.hud ) {
    const factor = Math.max(1, 1 / (zoom * canvas.dimensions.uiScale));
    for ( const layer of canvas.layers ) {
      for ( const container of [layer.objects, layer.preview] ) {
        for ( const object of container?.children ?? [] ) {
          for ( const handle of object.controls?.handles?.children ?? [] ) update(handle, factor);
        }
      }
    }
  }
  for ( const [icon] of fixedIcons ) if ( icon.destroyed ) fixedIcons.delete(icon);
}

function restoreCanvasControlIcons() {
  for ( const [icon, { x, y, wall }] of fixedIcons ) {
    if ( icon.destroyed ) continue;
    icon.scale.set(x, y);
    if ( wall ) {
      const offset = (icon.controlSize ?? 40) / 2 * canvas.dimensions.uiScale;
      icon.position.set(wall.midpoint[0] - offset, wall.midpoint[1] - offset);
    }
  }
  fixedIcons.clear();
}

export function stopFixedCanvasControls() {
  canvas.app?.ticker.remove(syncCanvasControlIcons);
  restoreCanvasControlIcons();
}

export function syncHUDScale() {
  const fixed = game.settings.get(MODULE_ID, SETTING);
  fixedSizes.hud = fixed;
  fixedSizes.doors = game.settings.get(MODULE_ID, "fixedDoorSize");
  if ( canvas.ready ) {
    canvas.app.ticker.remove(syncCanvasControlIcons);
    restoreCanvasControlIcons();
    if ( fixed || fixedSizes.doors ) {
      syncCanvasControlIcons();
      canvas.app.ticker.add(syncCanvasControlIcons);
    }
  }
  for ( const hud of [canvas.hud?.token, canvas.hud?.tile, canvas.hud?.drawing] ) {
    const element = hud?.element;
    if ( !element ) continue;
    element.classList.toggle("advanced-interface-fixed-hud", fixed);
    if ( !fixed || !hud.object || !canvas.ready ) continue;
    const zoom = canvas.stage.scale.x;
    const scale = Math.max(canvas.dimensions.uiScale, 1 / zoom);
    const bounds = hud.object.bounds;
    element.style.setProperty("--advanced-interface-hud-inverse-zoom", String(scale));
    element.style.setProperty("--advanced-interface-hud-width", `${bounds.width / scale}px`);
    element.style.setProperty("--advanced-interface-hud-height", `${bounds.height / scale}px`);
  }
  canvas.advancedCards?.positionHUD();
}

export function registerHUDScale() {
  for (const key of [SETTING, "fixedDoorSize"]) {
    game.settings.register(MODULE_ID, key, {scope: "client", config: false, type: Boolean, default: false, onChange: syncHUDScale});
  }
  Hooks.on("getSceneControlButtons", controls => {
    controls.advancedInterfaceZoom = {
      name: "advancedInterfaceZoom", title: "ADVANCED_INTERFACE.FixedHUDSize",
      icon: "fa-solid fa-arrows-to-circle", order: (controls.advancedCards?.order ?? 65) + 1,
      tools: Object.fromEntries([
        [SETTING, "HUD", "fa-solid fa-grip"],
        ["fixedDoorSize", "Doors", "fa-solid fa-door-open"]
      ].map(([key, label, icon], order) => [key, {
        name: key, title: `ADVANCED_INTERFACE.Zoom.${label}`, icon, order,
        toggle: true, active: game.settings.get(MODULE_ID, key),
        onChange: (_event, active) => {
          game.settings.set(MODULE_ID, key, active).catch(error => {
            const tool = ui.controls.controls.advancedInterfaceZoom.tools[key];
            tool.active = game.settings.get(MODULE_ID, key);
            ui.controls.render();
            reportZoomError(error);
          });
        }
      }]))
    };
  });
}
