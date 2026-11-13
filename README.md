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
- Layout and panel states are remembered per client and world.
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
- One **Snap to Grid** toggle at the top of the controls applies across tokens, tiles, drawings, walls, lights, sounds, regions, notes, and cards. **Zoom Controls** sits directly below **Card Controls**. Snapping is enabled by default and remembered per client. On square grids, point objects snap to corners, edge midpoints, and cell centers; tokens retain native size-aware alignment. Hex grids retain native snapping. Turn it off for free placement, or hold Shift to bypass snapping temporarily. The toggle is hidden on gridless scenes.
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
- A **Fixed Calendar** option with 13 standard months, 1 intercalary month, 7 days in a week, and four seasons.
- Each standard month has 28 days and always starts on Sunday. Intercalaris has 1 intercalary day (2 in leap years, every 4 years starting at year 0) outside the weekday cycle, displayed without weekday headings. This applies only to Intercalaris, not to holidays on regular dates. Years remain 365 or 366 days; existing dates and elapsed world time are unchanged.

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

### Playing cards
- Dedicated deck, hand, and pile sheets with Configuration and Cards tabs, search, list/gallery views, primary-owner selection, context actions, and type-specific shuffle/deal/draw/pass/reset controls. The individual-card sheet retains Foundry's face and back editing. Configuration saves on change.
- Assign a player hand from a player's context menu or a hand sheet. An optional count and open-hand button appear on player cards, including floating player cards. Opening a hand requires Observer permission.
- Drag cards from sheets or whole stacks from the Cards directory onto the canvas. An unlocked stack moves as a stack; dragging a locked stack draws its top card, or bottom card when the stack is flipped. A scene pile or allocating Region receives that card when configured. Without allocation, the same top card cannot be placed twice. Select multiple cards with Shift-click, a selection rectangle, or Select All. Card drops and dragging use the shared **Snap to Grid** toggle; Shift bypasses snapping.
- With **Advanced Drag & Drop** active, hold its configurable **Transfer** key while dragging canvas cards onto a canvas stack, an open stack sheet, or a stack in the Cards directory. The cards move into that stack and their canvas placements are removed. An invalid drop leaves them on the canvas. Source and destination ownership and the active GM are required; multiple cards are transferred individually.
- Hold **Transfer** before dragging a card between deck sheets to move it instead of making Foundry's usual copy. Both decks must be owned; drawn cards cannot be moved this way.
- A two-row canvas HUD below the card provides elevation, rotate, front/back ordering, lock/unlock, flip, and removal. Decks and piles also have a shuffle action and combined front/back ordering. GMs can hide cards or clear placements without deleting cards. Double-click a card or stack to open its sheet. Primary-owner labels take precedence over inferred hand ownership.
- Right-click **Card Controls** to show or hide cards while another layer is active. The visibility pip and per-client persistence match the other Advanced Interface layer controls.
- Choose a **Canvas Card Pile** in Scene Configuration > Basics. An **Allocate Card** Region Behavior can override that pile within a Region and optionally remove allocated cards from the canvas. When multiple allocating Regions overlap, the first matching Region in scene order wins. Allocation uses a card's center and elevation (zero by default). Whole stack placements are not allocated into other stacks.
- The GM's **Layout Cards** tool offers grid, triangle, and circle layouts directly from a source stack without a destination selector. Triangles can face up, down, left, or right; a partially filled final row is centered. Circles start at the top and proceed clockwise, with cards retaining their existing rotation. Choose the total number of cards and, for grids, the number of columns. Cards already on the scene are skipped. Cards remain in their source stack unless the scene pile or a Region allocates them, just as when dragging cards. The layout is centered within the playable scene. Card counts and scene bounds are validated before placement.
- Deck owners can scry a chosen number of top cards, move those cards to the top or bottom, or shuffle and replace them. Changes are saved explicitly; saving is rejected if the deck's available-card order changed in the meantime.
- Canvas updates are serialized through the active GM. Players can manipulate cards they own on the active scene; an active GM is required for those scene writes. GM requests use native authenticated User updates rather than an unrestricted module socket.

## Card Cutover

The card subsystem is independent of Complete Card Management. It does not import CCM code or assets, read CCM flags, provide a CCM API adapter, migrate existing CCM layouts or Regions, or register a docked hand sheet.

Restart the Foundry server after installing this change so Foundry reads the new Region Behavior declaration in the module manifest. A browser refresh alone is insufficient. Disable CCM before using the replacement normally: the two modules register overlapping card workflows and sheets, and running both is not supported. Existing explicit CCM sheet selections may need to be changed through **Configure Sheet**.

This is a fresh-start cutover. Back up the world, keep native card stacks as desired, and recreate hand assignments, canvas layouts, and allocating Regions using Advanced Interface. Test a GM and a player session with CCM disabled before uninstalling CCM. No existing CCM data is automatically deleted.

### Card Macro API

```js
const cards = game.modules.get("advanced-interface").api.cards;
const hand = cards.getPlayerHand();
const card = hand.availableCards[0];
const placementId = await cards.place(card, {x: 1000, y: 1000});
await cards.action("rotate", {id: placementId});
```

`place`, `action`, and `layout` accept an optional `sceneId`, defaulting to the viewed scene. `place` accepts a Card or Cards stack. Placement coordinates are centers in world pixels. `placements(scene)` returns a copy of the scene's placement data, including each placement's `id` and document `uuid`. Native transfers update those references; recalls remove obsolete card placements. Native card faces remain authoritative across scenes; stack flipping is scene-local.

```js
await cards.layout({
	from: deck.id, shape: "triangle", direction: "up",
	count: 6, faceDown: true
});
await cards.layout({from: deck.id, shape: "circle", count: 8, face: "back"});
await cards.scry(deck, 3);
```

`layout` is GM-only; `count` is the total number of cards, and grid layouts also require `columns`. Legacy calls using `rows` and `columns` remain supported for grids and triangles; for triangles, `rows` is the number of cards per side. Layouts are limited to 250 cards and default to centering within the playable scene. For circles, explicit `x`/`y` macro coordinates specify the circle center; for other layouts they retain their existing placement behavior. Legacy `offsetX`/`offsetY` options remain supported by the API but are not shown in the dialogs. Optional `spacing` is in pixels (legacy macro default: 10); circles use the card diagonal plus spacing to avoid overlap. `face` accepts `""`, `"front"`, or `"back"`; the existing `faceDown` option remains supported.

Other actions are `flip`, `front`, `back`, `lock`, `unlock`, `remove`, `elevation` with a numeric `elevation`, stack-only `shuffle`, stack-only `draw` with destination `x`/`y`, GM-only `hide` and `clear`, and `recall` with a card `uuid`. To transfer canvas placements into a stack, use `cards.action("transfer", {ids: [placementId], destinationId: stack.id})`; a canvas stack placement can instead be supplied as `targetId`. Deck-origin recall also returns dealt copies and removes their placements. `choosePlayerHand(user)` opens hand configuration. Continue to use Foundry's native Card/Cards API for ordinary card operations.

### Card Tests

Run the focused operation tests with Node.js from the module directory:

```sh
node --test tests/cards.test.mjs
```

These tests cover local operation logic, not the Foundry server or multi-client synchronization. Verify Region creation after a server restart and player permissions, private hands, and simultaneous requests in separate Foundry clients before removing CCM.

Standalone validation on Foundry v14.370 (2026-11-10), with CCM disabled, passed persisted Region creation, allocation with and without canvas retention, scene-wide pile allocation, layouts, scrying, and native recall cleanup. Two isolated player sessions passed simultaneous placements, owner/non-owner action checks, private hand sheet and button restrictions, hidden-card rendering, and Region transfers while the GM viewed another scene. All 12 focused regression tests passed. The multi-client checks also exposed and fixed incremental User-update handling: request data is stored atomically, complete flags are read after sender validation, and each response explicitly clears any previous error.
