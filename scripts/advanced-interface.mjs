// Entry point. Feature modules register their render hooks on import; class and patch registration waits for init.
import {registerUtilityPanels} from "./utility-panels.mjs";
import {registerChatLog} from "./chat.mjs";
import {registerCardMenus} from "./card-menus.mjs";
import {registerCards} from "./cards.mjs";
import {registerCardCanvas} from "./card-canvas.mjs";
import {registerCardTools} from "./card-tools.mjs";
import "./combat.mjs";
import "./directories.mjs";
import {registerInterfaceComponents} from "./interface-components.mjs";
import {registerMacroApps} from "./macros.mjs";
import {patchPlaylistTimestamps} from "./playlists.mjs";
import {patchPopoutClose} from "./popouts.mjs";
import {registerSceneControlTools} from "./scene-controls.mjs";
import {registerGridSnapping} from "./grid-snapping.mjs";
import {registerSceneDocument} from "./scenes.mjs";
import "./scrollbars.mjs";
import {registerSettingsMenu} from "./settings-panel.mjs";
import {AdvancedSidebar} from "./sidebar.mjs";
import {registerTabDrops} from "./tab-drops.mjs";
import {registerTokenEffects} from "./token-effects.mjs";
import {registerHUDScale, syncHUDScale, stopFixedCanvasControls} from "./hud-scale.mjs";
import {onRenderPlaceableHUDButtons, refreshTokenHUDBarBackgrounds, registerHUDAutoClose, syncTokenHUDBars}
  from "./token-hud.mjs";
import {onRenderNavigationDirectory, refreshActorDirectories, refreshActorNavigationVisibility,
  onRenderTokenNavigationHUD, onTokenNavigationChange, clearTokenNavigation} from "./actor-navigation.mjs";
import {onRenderSidebarScrolling, onCloseSidebarScrolling} from "./sidebar-scrolling.mjs";
import {registerDoorButtons} from "./door-buttons.mjs";
import {MODULE_ID, syncDirectoryVisibility} from "./helper.mjs";

Hooks.once("diceSoNiceInit", dice3d => {
  const computeDimensions = dice3d._computeDimensions;
  dice3d._computeDimensions = function(rollingArea, ...args) {
    const dimensions = computeDimensions.call(this, rollingArea, ...args);
    // Our sidebar spans the tab rows, not an occupied strip at the right edge.
    if (!rollingArea && ui.sidebar.element.classList.contains("advanced-interface")) dimensions.margin.right = 0;
    return dimensions;
  };
});

function registerSettings() {
  game.settings.register(MODULE_ID, "worldPanelSettings", {scope: "client", config: false, type: Object, default: {}});
}

Hooks.once("init", () => {
  // Core registers its settings after init, so this becomes the uiConfig default and the UI Configuration reset value.
  foundry.applications.settings.menus.UIConfig.schema.fields.chatNotifications.initial = "pip";
  registerCardMenus();
  registerCards();
  registerCardCanvas();
  registerCardTools();
  registerTokenEffects();
  registerHUDScale();
  registerHUDAutoClose();
  registerDoorButtons();
  registerInterfaceComponents();
  registerGridSnapping();
  registerSceneControlTools();
  registerSettingsMenu();
  registerUtilityPanels(AdvancedSidebar);
  registerSceneDocument();
  registerSettings();
  registerTabDrops();
  CONFIG.ui.sidebar = AdvancedSidebar;
  CONFIG.ui.placeables = class AdvancedPlaceableDirectory extends CONFIG.ui.placeables {
    _canRender(options) {
      if (options.isFirstRender && !game.ready) return false;
      return super._canRender(options);
    }
  };
  registerMacroApps();
  registerChatLog();
  patchPopoutClose();
  patchPlaylistTimestamps();
});

Hooks.on("renderBasePlaceableHUD", onRenderPlaceableHUDButtons);
Hooks.on("renderBasePlaceableHUD", syncHUDScale);
Hooks.on("closeTokenHUD", syncTokenHUDBars);
Hooks.on("canvasPan", () => {
  syncHUDScale();
  if ( game.settings.get(MODULE_ID, "fixedHUDSize") && canvas.tokens?.hud?.object ) syncTokenHUDBars();
});
Hooks.on("canvasReady", syncHUDScale);
Hooks.on("canvasTearDown", stopFixedCanvasControls);
for ( const hook of ["updateActor", "updateToken"] ) Hooks.on(hook, refreshTokenHUDBarBackgrounds);
Hooks.on("renderAbstractSidebarTab", onRenderSidebarScrolling);
Hooks.on("closeAbstractSidebarTab", onCloseSidebarScrolling);
for ( const hook of ["renderActorDirectory", "renderItemDirectory"] ) {
  Hooks.on(hook, (app, element) => {
    syncDirectoryVisibility(app.tabName);
    onRenderNavigationDirectory(app, element);
  });
}
Hooks.on("updateActor", refreshActorDirectories);
Hooks.on("deleteActor", refreshActorDirectories);
Hooks.on("renderTokenHUD", onRenderTokenNavigationHUD);
Hooks.on("canvasTearDown", clearTokenNavigation);
Hooks.on("canvasReady", refreshActorDirectories);
Hooks.on("sightRefresh", refreshActorNavigationVisibility);
for (const hook of ["createToken", "updateToken", "deleteToken"]) Hooks.on(hook, onTokenNavigationChange);
