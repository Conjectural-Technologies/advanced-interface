# Advanced Interface

**Release:** 2.0.0.

A complete interface overhaul for Foundry VTT v14 and the D&D 5e system. It replaces the stock sidebar, scene controls, chat, combat tracker, players list, token HUD and settings screens with a cohesive card-based layout, and adds several quality-of-life tools for GMs and players.

**Requirements:** Foundry VTT v14 and the D&D 5e system 6.0.6 or newer.

## Installation

In Foundry's **Add-on Modules** tab choose **Install Module** and paste this manifest URL:

```
https://github.com/Conjectural-Technologies/advanced-interface/releases/latest/download/module.json
```

## Features

### Sidebar, tabs and popouts
- Tabs can be reordered and placed on different sides and rows by dragging.
- Tabs can be pinned, shown or hidden. **Reset Tabs** in the settings panel restores the default arrangement.
- Layout and panel states are remembered per client.
- Tabs open as managed popouts that keep the module's styling.
- Cards, headers, icon buttons, tooltips and scrollbars are consistent across every panel.

### Directories
- The Actors, Scenes, Items and Macros directories can each be hidden or shown independently, per client.
- Entries become cards with thumbnails and an options menu. Folders collapse with shutters.
- The Compendium Browser button is restyled.
- Macro pages use numbered page buttons.

### Token navigation
- Actor tokens on the current scene are listed in the **Actors** directory. Object (item) tokens are listed in the **Items** directory. Each list collapses.
- A per-token navigation setting and a matching token HUD control.

### Scene controls
- Reorganised into an idle control plus tool columns, with launchers for drawing, region and wall tools, and an added curtain wall tool.
- Right-click a layer control to keep that layer's objects visible while another layer is active.
- Door controls are sized sensibly at different zoom levels.

### Scenes
- Scene cards have navigation, activate and view buttons with clear pressed states.
- Activating a scene also views it.
- Scene cards show user pips and level buttons.
- Activation preserves the activating GM's view.

### Chat
- Card-style messages, a **Jump to Top** control, and redesigned accessible options and Format menus.
- Messages can be opened as popouts from the context menu.
- Chat notifications default to pip, and the chat background follows the core setting.

### Combat tracker
- Encounter navigation bar and information bar, combatant cards, and Roll All and Roll NPCs in a submenu.
- Dice So Nice is supported.

### Players panel and A/V
- Player cards with microphone and camera icons and A/V controls, grouped into online and offline players.
- Cards can float freely, and the camera dock can be hidden.

### Playlists and volume
- Inline sound playback controls, volume icons and a mute toggle.
- Right-click the Volume tab to mute everything and restore it.

### Time and calendar
- A Time panel with date and time editing and forward and back buttons in steps of 1 minute, 10 minutes, 1 hour, 8 hours, 1 day or 7 days.
- A **Fixed Calendar** option with 13 standard months, 1 intercalary month, 7 days in a week, 2 days of rest, and four seasons.

### Token HUD, resource bars and rings
- HUD buttons sit in aligned rows with equal spacing below the token's highlight ring.
- Resource bars sit horizontally below the ring, always visible, with tooltips, colour-coded backgrounds and contrast text. They match the HUD button width.
- Status effects are accessible buttons. Blink is relabelled Teleport.
- The HUD closes when you click outside the canvas.
- **Ring Above Image** draws the dynamic ring over the token art.
- **Offset Artwork Rotation** turns the artwork independently of facing.
- **HUD** and **Doors** toggles keep those controls a constant on-screen size at any zoom.

### Settings panel
- A compact toolbar with **Reload**, **Configure UI** and **Reset Tabs**.
- One consolidated **System Information** section, and D&D 5e links become icon buttons.
