import {MODULE_ID, createButton, localize, reportError} from "./helper.mjs";
import {cardSortOrder, placementsFor, requestCardOperation, registerCardOperations} from "./card-operations.mjs";
import {decorateIconButtons} from "./interface-components.mjs";
import {snapCanvasPoint} from "./grid-snapping.mjs";

const report = reportError("Card canvas");

export function registerCardCanvas() {
  registerCardOperations();
  class AdvancedCardLayer extends foundry.canvas.layers.InteractionLayer {
    static get layerOptions() {
      return {...super.layerOptions, name: "advancedCards", zIndex: 600};
    }

    get hookName() { return "AdvancedCardLayer"; }
    objects = null;
    selected = new Set();
    hud = null;
    generation = 0;
    gesture = null;
    lastTap = null;
    moveListener = event => this.moveGesture(event);
    upListener = event => this.endGesture(event);

    static prepareSceneControls() {
      return {
        name: "advancedCards", title: "ADVANCED_INTERFACE.PlayingCards.Controls",
        icon: "fa-solid fa-cards", layer: "advancedCards", order: 65, activeTool: "select",
        onChange: (_event, active) => { if (active) canvas.advancedCards.activate(); },
        tools: {
          select: {name: "select", order: 0, title: "ADVANCED_INTERFACE.PlayingCards.Select", icon: "fa-solid fa-expand", interaction: true, control: true},
          snap: {...this.FORCE_SNAP_VERTICES, order: 1},
          clear: {
            name: "clear", order: 10, title: "ADVANCED_INTERFACE.PlayingCards.Clear", icon: "fa-solid fa-trash", button: true,
            visible: game.user.isGM,
            onChange: async () => {
              if (await foundry.applications.api.DialogV2.confirm({
                window: {title: localize("PlayingCards.Clear")},
                content: `<p>${localize("PlayingCards.ConfirmClear")}</p>`
              })) await requestCardOperation("clear", {sceneId: canvas.scene.id});
            }
          }
        }
      };
    }

    async _draw(options) {
      await super._draw(options);
      this.objects = this.addChild(new PIXI.Container());
      await this.refresh();
    }

    async _tearDown(options) {
      this.generation++;
      this.cancelGesture();
      this.closeHUD();
      this.selected.clear();
      this.objects = null;
      await super._tearDown(options);
    }

    _activate() {
      if (this.objects) this.objects.visible = true;
    }

    _deactivate() {
      this.cancelGesture();
      this.selected.clear();
      this.closeHUD();
      this.refreshSelection();
      if (this.objects) this.objects.visible = !!game.settings.get(MODULE_ID, "layerDisplay").advancedCards;
    }

    async refresh() {
      if (!this.objects || !canvas.scene) return;
      if (this.gesture) this.cancelGesture();
      const generation = ++this.generation;
      const scene = canvas.scene;
      const entries = [];
      for (const placement of placementsFor(scene)) {
        if (placement.hidden && !game.user.isGM) continue;
        const card = fromUuidSync(placement.uuid);
        if (!card || (card.parent?.type === "deck" && card.drawn)) continue;
        const stack = card.parent ?? card;
        const available = card.documentName === "Cards" && placement.faceDown
          ? card.availableCards.toSorted((first, second) => first.sort - second.sort) : [];
        const source = available.at(-1)?.img ?? card.img;
        let texture;
        try {
          texture = await foundry.canvas.loadTexture(source || "icons/svg/card-hand.svg");
        } catch (error) {
          console.warn("Advanced Interface | Could not load card image", source, error);
          texture = PIXI.Texture.WHITE;
        }
        entries.push({placement, card, stack, texture});
      }
      if (generation !== this.generation || !this.objects || scene !== canvas.scene) return;
      this.objects.removeChildren().forEach(child => child.destroy({children: true}));
      entries.sort((first, second) => (first.placement.elevation ?? 0) - (second.placement.elevation ?? 0)
        || first.placement.sort - second.placement.sort);
      for (const {placement, card, stack, texture} of entries) {
        const object = new PIXI.Container();
        object.placement = placement;
        object.card = card;
        object.position.set(placement.x, placement.y);
        object.angle = placement.rotation;
        object.zIndex = placement.sort;
        object.alpha = placement.hidden ? 0.4 : 1;
        object.eventMode = "static";
        object.cursor = stack.isOwner ? "pointer" : "default";
        const width = (stack.width || 2) * scene.grid.size;
        const height = (stack.height || 3) * scene.grid.size;
        const image = new PIXI.Sprite(texture);
        image.anchor.set(0.5);
        image.width = width;
        image.height = height;
        object.addChild(image);
        object.cardWidth = width;
        object.cardHeight = height;
        object.border = object.addChild(new PIXI.Graphics());
        if (game.settings.get(MODULE_ID, "cardOwnerLabels")) {
          const owner = game.users.get(stack.getFlag(MODULE_ID, "primaryOwner"))
            ?? game.users.find(user => user.getFlag(MODULE_ID, "playerHand") === stack.id)
            ?? game.users.find(user => !user.isGM && stack.testUserPermission(user, "OWNER"));
          if (owner) {
            const text = object.addChild(new PIXI.Text(owner.name, {
              fontFamily: CONFIG.defaultFontFamily, fontSize: 14, fill: "#ffffff", stroke: "#000000", strokeThickness: 3
            }));
            text.anchor.set(0.5, 0);
            text.position.set(0, height / 2 + 4);
          }
        }
        object.on("pointerdown", event => {
          if (!this.active || event.button !== 0 || !stack.isOwner) return;
          event.stopPropagation();
          const shift = event.shiftKey || event.nativeEvent?.shiftKey;
          if (!shift && !this.selected.has(placement.id)) this.selected.clear();
          if (shift && this.selected.has(placement.id)) this.selected.delete(placement.id);
          else this.selected.add(placement.id);
          this.refreshSelection();
          this.openHUD(placement.id);
          if (placement.locked) {
            if (card.documentName !== "Cards") return;
            const preview = this.addChild(new PIXI.Sprite(texture));
            preview.anchor.set(0.5);
            preview.width = width;
            preview.height = height;
            preview.position.copyFrom(object.position);
            preview.alpha = 0.6;
            preview.eventMode = "none";
            this.gesture = {origin: event.getLocalPosition(this), drawFrom: placement.id, preview,
              x: object.x, y: object.y, objects: []};
            document.addEventListener("pointermove", this.moveListener);
            document.addEventListener("pointerup", this.upListener, {once: true});
            return;
          }
          this.gesture = {
            origin: event.getLocalPosition(this),
            objects: this.controlled.filter(entry => !entry.placement.locked).map(entry => ({object: entry, x: entry.x, y: entry.y}))
          };
          document.addEventListener("pointermove", this.moveListener);
          document.addEventListener("pointerup", this.upListener, {once: true});
        });
        object.on("rightclick", event => {
          if (!this.active || !stack.isOwner) return;
          event.stopPropagation();
          this.selected.clear();
          this.selected.add(placement.id);
          this.refreshSelection();
          this.openHUD(placement.id);
        });
        object.on("pointertap", event => {
          if (!this.active || event.button !== 0) return;
          const now = performance.now();
          if (this.lastTap?.id === placement.id && now - this.lastTap.time < 350) {
            this.lastTap = null;
            card.sheet.render({force: true}).catch(report);
          } else this.lastTap = {id: placement.id, time: now};
        });
        this.objects.addChild(object);
      }
      const ids = new Set(entries.map(entry => entry.placement.id));
      for (const id of this.selected) if (!ids.has(id)) this.selected.delete(id);
      this.refreshSelection();
      if (this.hud) this.openHUD(this.hud.dataset.cardId);
      this.objects.visible = this.active || !!game.settings.get(MODULE_ID, "layerDisplay").advancedCards;
    }

    get controlled() {
      return (this.objects?.children ?? []).filter(object => this.selected.has(object.placement.id));
    }

    refreshSelection() {
      for (const object of this.objects?.children ?? []) {
        object.border.clear();
        if (this.selected.has(object.placement.id)) object.border.lineStyle(3 / canvas.stage.scale.x, 0xffd166)
          .drawRect(-object.cardWidth / 2, -object.cardHeight / 2, object.cardWidth, object.cardHeight);
      }
    }

    moveGesture(event) {
      if (!this.gesture) return;
      const global = new PIXI.Point();
      canvas.app.renderer.events.mapPositionToPoint(global, event.clientX, event.clientY);
      const current = this.toLocal(global);
      if (this.gesture.preview) {
        let point = {x: this.gesture.x + current.x - this.gesture.origin.x, y: this.gesture.y + current.y - this.gesture.origin.y};
        point = snapCanvasPoint(point, {shiftKey: event.shiftKey});
        this.gesture.preview.position.set(point.x, point.y);
      }
      for (const {object, x, y} of this.gesture.objects) {
        let point = {x: x + current.x - this.gesture.origin.x, y: y + current.y - this.gesture.origin.y};
        point = snapCanvasPoint(point, {shiftKey: event.shiftKey});
        object.position.set(point.x, point.y);
      }
      this.updateTransferPreview();
      this.positionHUD();
    }

    updateTransferPreview() {
      const gesture = this.gesture;
      if (!gesture) return;
      const transfer = game.modules.get("advanced-drag-and-drop");
      const moved = gesture.preview
        ? Math.hypot(gesture.preview.x - gesture.x, gesture.preview.y - gesture.y) > 2
        : gesture.objects.some(({object, x, y}) => Math.hypot(object.x - x, object.y - y) > 2);
      if (!moved || !transfer?.active || !transfer.api?.isTransferHeld?.() || !transfer.api?.createTransferPreview) {
        this.clearTransferPreview();
        return;
      }
      if (!gesture.transferPreview) {
        const container = transfer.api.createTransferPreview();
        const entries = [];
        gesture.transferPreview = {container, entries};
        try {
          for (const object of gesture.preview ? [gesture.preview] : gesture.objects.map(entry => entry.object)) {
            const renderer = canvas.app.renderer;
            const bounds = object.getBounds().clone();
            const texture = PIXI.RenderTexture.create({width: bounds.width, height: bounds.height,
              resolution: renderer.resolution, multisample: renderer.multisample});
            let image;
            try {
              renderer.render(object, {renderTexture: texture,
                transform: new PIXI.Matrix().translate(-bounds.x, -bounds.y), skipUpdateTransform: true, blit: true});
              image = renderer.extract.canvas(texture);
            } finally { texture.destroy(true); }
            entries.push({object, image, renderable: object.renderable});
            container.append(image);
            object.renderable = false;
          }
        } catch (error) {
          this.clearTransferPreview();
          report(error);
          return;
        }
      }
      const rect = canvas.app.view.getBoundingClientRect();
      for (const {object, image} of gesture.transferPreview.entries) {
        const bounds = object.getBounds();
        Object.assign(image.style, {left: `${bounds.x + rect.left}px`, top: `${bounds.y + rect.top}px`,
          width: `${bounds.width}px`, height: `${bounds.height}px`});
      }
    }

    clearTransferPreview() {
      const preview = this.gesture?.transferPreview;
      if (!preview) return;
      for (const {object, renderable} of preview.entries) if (!object.destroyed) object.renderable = renderable;
      preview.container.remove();
      this.gesture.transferPreview = null;
    }

    transferTarget(event) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return null;
      const sheet = [...foundry.applications.instances.values()].filter(app => app.rendered
        && app.document?.documentName === "Cards" && app.element?.contains(element))
        .sort((first, second) => first.element.contains(second.element) ? 1 : -1)[0];
      if (sheet) return {destinationId: sheet.document.id};
      const row = element.closest('.cards-sidebar .directory-item[data-entry-id], [data-tab="cards"] .directory-item[data-entry-id]');
      if (row && game.cards.get(row.dataset.entryId)) return {destinationId: row.dataset.entryId};
      if (element !== canvas.app.view && !element.closest("#board")) return null;
      const global = new PIXI.Point();
      canvas.app.renderer.events.mapPositionToPoint(global, event.clientX, event.clientY);
      for (const object of [...(this.objects?.children ?? [])].reverse()) {
        if (this.selected.has(object.placement.id) || object.card.documentName !== "Cards") continue;
        const point = object.toLocal(global);
        if (Math.abs(point.x) <= object.cardWidth / 2 && Math.abs(point.y) <= object.cardHeight / 2) {
          return {targetId: object.placement.id};
        }
      }
      return null;
    }

    endGesture(event) {
      if (!this.gesture) return;
      if (this.gesture.drawFrom) {
        const {drawFrom: id, preview, x, y} = this.gesture;
        const data = {id, sceneId: canvas.scene.id, x: preview.x, y: preview.y};
        const moved = Math.hypot(preview.x - x, preview.y - y) > 2;
        this.cancelGesture(false);
        if (moved) requestCardOperation("draw", data).catch(report);
        return;
      }
      const objects = this.gesture.objects.map(({object, x, y}) => ({
        id: object.placement.id, x: object.x, y: object.y, moved: Math.hypot(object.x - x, object.y - y) > 2
      }));
      const sceneId = canvas.scene.id;
      const transfer = game.modules.get("advanced-drag-and-drop");
      if (event && objects.some(entry => entry.moved) && transfer?.active && transfer.api?.isTransferHeld?.()) {
        const target = this.transferTarget(event);
        this.cancelGesture();
        this.positionHUD();
        if (!target) {
          ui.notifications.warn(localize("PlayingCards.InvalidTransferTarget"));
          return;
        }
        requestCardOperation("transfer", {sceneId, ids: objects.map(entry => entry.id), ...target})
          .catch(error => { report(error); this.refresh(); });
        return;
      }
      this.cancelGesture(false);
      (async () => {
        for (const entry of objects) if (entry.moved) await requestCardOperation("move", {sceneId, ...entry});
      })().catch(error => { report(error); this.refresh(); });
    }

    cancelGesture(restore = true) {
      this.clearTransferPreview();
      this.gesture?.preview?.destroy();
      if (restore) for (const {object, x, y} of this.gesture?.objects ?? []) object.position.set(x, y);
      this.gesture = null;
      document.removeEventListener("pointermove", this.moveListener);
      document.removeEventListener("pointerup", this.upListener);
    }

    openHUD(id) {
      this.closeHUD();
      const object = this.objects?.children.find(entry => entry.placement.id === id);
      if (!object) return;
      const hud = document.createElement("div");
      hud.className = "advanced-interface-card-hud";
      hud.dataset.cardId = id;
      hud.setAttribute("role", "toolbar");
      hud.setAttribute("aria-label", localize("PlayingCards.Controls"));
      const buttons = document.createElement("div");
      buttons.className = "advanced-interface-card-hud-buttons";
      const elevation = document.createElement("input");
      elevation.type = "number";
      elevation.step = "any";
      elevation.value = String(object.placement.elevation ?? 0);
      elevation.setAttribute("aria-label", localize("PlayingCards.Elevation"));
      elevation.dataset.tooltip = localize("PlayingCards.Elevation");
      elevation.addEventListener("change", () => {
        (async () => {
          for (const selected of [...this.selected]) {
            await requestCardOperation("elevation", {sceneId: canvas.scene.id, id: selected, elevation: Number(elevation.value)});
          }
        })().catch(report);
      });
      buttons.append(elevation);
      const actions = [
        ["front", "fa-bring-forward", "BringToFront"], ["back", "fa-send-backward", "SendToBack"],
        ["rotate", "fa-rotate-right", "Rotate"],
        [object.placement.locked ? "unlock" : "lock", object.placement.locked ? "fa-lock" : "fa-lock-open", object.placement.locked ? "Unlock" : "Lock"],
        ["flip", "fa-arrows-up-down", "Flip"], ["remove", "fa-trash", "Remove"]
      ];
      if (object.card.documentName === "Cards" && object.card.type !== "hand") {
        actions.splice(0, 2, ["sort", "fa-bring-forward", null]);
        actions.splice(3, 0, ["shuffle", "fa-shuffle", "Shuffle"]);
      }
      if (game.user.isGM) actions.unshift(["hide", object.placement.hidden ? "fa-eye-slash" : "fa-eye", object.placement.hidden ? "ShowCard" : "HideCard"]);
      for (const [action, icon, key] of actions) {
        const button = createButton(document, `ui-control icon fa-solid ${icon}`, {
          label: key ? localize(`PlayingCards.${key}`) : game.i18n.localize("HUD.ToFrontOrBack"), context: "Card action",
          onClick: async () => {
            if (action === "sort") {
              const order = cardSortOrder(placementsFor(canvas.scene), this.selected);
              if (order) for (const id of order.ids) await requestCardOperation(order.action, {sceneId: canvas.scene.id, id});
              return;
            }
            for (const selected of [...this.selected]) await requestCardOperation(action, {sceneId: canvas.scene.id, id: selected});
          }
        });
        button.dataset.cardAction = action;
        const state = action === "flip" ? object.card.documentName === "Cards" ? object.placement.faceDown : object.card.face === null
          : action === "hide" ? object.placement.hidden : ["lock", "unlock"].includes(action) ? object.placement.locked : undefined;
        if (state !== undefined) button.setAttribute("aria-pressed", String(state));
        buttons.append(button);
      }
      hud.append(buttons);
      document.body.append(hud);
      this.hud = hud;
      this.positionHUD();
      decorateIconButtons(hud);
    }

    positionHUD() {
      if (!this.hud) return;
      const object = this.objects?.children.find(entry => entry.placement.id === this.hud.dataset.cardId);
      if (!object) return this.closeHUD();
      const bounds = object.getBounds();
      const rect = canvas.app.view.getBoundingClientRect();
      const zoom = canvas.stage.scale.x;
      const scale = zoom * (game.settings.get(MODULE_ID, "fixedHUDSize")
        ? Math.max(canvas.dimensions.uiScale, 1 / zoom) : canvas.dimensions.uiScale);
      const width = 140 * scale;
      const height = 68 * scale;
      this.hud.style.transform = `scale(${scale})`;
      this.hud.style.left = `${Math.max(4, Math.min(innerWidth - width - 4, bounds.x + rect.left + bounds.width / 2 - width / 2))}px`;
      this.hud.style.top = `${Math.max(4, Math.min(innerHeight - height - 4, bounds.y + rect.top + bounds.height + 8 * scale))}px`;
    }

    closeHUD() { this.hud?.remove(); this.hud = null; }
    _onClickLeft() { this.selected.clear(); this.refreshSelection(); this.closeHUD(); }
    _onClickRight() { this._onClickLeft(); }
    _onDismissKey() { this._onClickLeft(); return true; }
    _onSelectAllKey() {
      for (const object of this.objects?.children ?? []) if ((object.card.parent ?? object.card).isOwner) this.selected.add(object.placement.id);
      this.refreshSelection();
      return true;
    }
    _onDeleteKey() {
      const sceneId = canvas.scene.id;
      Promise.all([...this.selected].map(id => requestCardOperation("remove", {sceneId, id}))).catch(report);
      return true;
    }
    _onDragLeftDrop(event) {
      const {origin, destination} = event.interactionData;
      if (!origin || !destination) return;
      this.selected.clear();
      for (const object of this.objects?.children ?? []) {
        if (!(object.card.parent ?? object.card).isOwner) continue;
        if (object.x >= Math.min(origin.x, destination.x) && object.x <= Math.max(origin.x, destination.x)
          && object.y >= Math.min(origin.y, destination.y) && object.y <= Math.max(origin.y, destination.y)) this.selected.add(object.placement.id);
      }
      this.refreshSelection();
    }
  }
  CONFIG.Canvas.layers.advancedCards = {group: "interface", layerClass: AdvancedCardLayer};
  Hooks.once("ready", () => queueMicrotask(() => {
    game.modules.get("advanced-drag-and-drop")?.api?.onTransferChange?.(() => canvas.advancedCards?.updateTransferPreview());
  }));
  game.settings.register(MODULE_ID, "cardOwnerLabels", {
    name: "ADVANCED_INTERFACE.PlayingCards.OwnerLabels", scope: "client", config: true, type: Boolean, default: true,
    onChange: () => canvas.advancedCards?.refresh().catch(report)
  });
  Hooks.on("dropCanvasData", (_canvas, data) => {
    if (!["Card", "Cards"].includes(data.type)) return;
    const point = snapCanvasPoint(data, {shiftKey: game.keyboard.isModifierActive("SHIFT")});
    requestCardOperation("place", {uuid: data.uuid, sceneId: canvas.scene.id, ...point})
      .then(() => canvas.advancedCards.activate()).catch(report);
    return false;
  });
  for (const event of ["updateScene", "createCard", "updateCard", "deleteCard", "updateCards", "deleteCards"]) {
    Hooks.on(event, () => canvas.advancedCards?.refresh().catch(report));
  }
  Hooks.on("canvasPan", () => { canvas.advancedCards?.positionHUD(); canvas.advancedCards?.refreshSelection(); });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest("#board, .advanced-interface-card-hud")) canvas.advancedCards?.closeHUD();
  });
  Object.assign(game.modules.get(MODULE_ID).api.cards, {
    place: (card, data) => requestCardOperation("place", {sceneId: canvas.scene?.id, ...data, uuid: card.uuid}),
    action: (action, data) => requestCardOperation(action, {sceneId: canvas.scene?.id, ...data}),
    placements: (scene = canvas.scene) => placementsFor(scene)
  });
}