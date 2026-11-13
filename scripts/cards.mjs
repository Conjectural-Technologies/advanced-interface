import {MODULE_ID, createButton, localize, reportError} from "./helper.mjs";
import {requestCardOperation} from "./card-operations.mjs";

const report = reportError("Cards");
const DECK_TRANSFER_TYPE = "application/x-advanced-interface-card-transfer";

export function getPlayerHand(user = game.user) {
  const hand = game.cards.get(user.getFlag(MODULE_ID, "playerHand"));
  return hand?.type === "hand" ? hand : null;
}

export async function choosePlayerHand(user = game.user) {
  if (!user.isSelf && !game.user.isGM) throw new Error("You cannot configure another player's hand.");
  const form = document.createElement("div");
  form.className = "standard-form";
  const label = document.createElement("label");
  label.textContent = localize("PlayingCards.PlayerHand");
  const select = document.createElement("select");
  select.name = "hand";
  select.append(new Option(localize("PlayingCards.None"), ""));
  for (const hand of game.cards) {
    if (hand.type !== "hand" || !hand.isOwner) continue;
    select.append(new Option(hand.name, hand.id));
  }
  select.value = getPlayerHand(user)?.id ?? "";
  select.selectedOptions[0]?.setAttribute("selected", "");
  label.append(select);
  const countLabel = document.createElement("label");
  const count = document.createElement("input");
  count.type = "checkbox";
  count.name = "count";
  count.checked = !!user.getFlag(MODULE_ID, "showCardCount");
  if (count.checked) count.setAttribute("checked", "");
  countLabel.append(count, localize("PlayingCards.ShowCount"));
  form.append(label, countLabel);
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {title: localize("PlayingCards.PlayerHand")},
    content: form.outerHTML,
    ok: {
      label: "Save",
      callback: (_event, button) => ({
        hand: button.form.elements.hand.value,
        count: button.form.elements.count.checked
      })
    },
    rejectClose: false
  });
  if (!result) return;
  await user.update({
    [`flags.${MODULE_ID}.playerHand`]: result.hand,
    [`flags.${MODULE_ID}.showCardCount`]: result.count
  });
}

function renderHandButtons() {
  for (const root of [ui.players?.element, ...document.querySelectorAll(".advanced-interface-player-window")]) {
    for (const row of root?.querySelectorAll("li.player[data-user-id]") ?? []) {
      row.querySelector(".advanced-interface-player-hand")?.remove();
      const user = game.users.get(row.dataset.userId);
      const hand = user && getPlayerHand(user);
      if (!hand?.testUserPermission(game.user, "OBSERVER")) continue;
      const button = createButton(row.ownerDocument, "advanced-interface-player-hand ui-control plain", {
        label: `${localize("PlayingCards.OpenHand")}: ${hand.name}`,
        onClick: () => hand.sheet.render({force: true}), context: "Player hand"
      });
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-cards";
      button.append(icon);
      if (user.getFlag(MODULE_ID, "showCardCount")) {
        const count = document.createElement("span");
        count.textContent = String(hand.availableCards.length);
        button.append(count);
      }
      row.append(button);
    }
  }
}

function advancedStackSheet(Base) {
  return class extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["advanced-interface-card-sheet", "advanced-interface-stack-sheet"],
      position: {width: 620, height: "auto"},
      form: {submitOnChange: true, closeOnSubmit: false},
      window: {
        icon: "fa-solid fa-cards",
        controls: [
          {icon: "fa-solid fa-rectangle-vertical-history", label: "ADVANCED_INTERFACE.PlayingCards.Gallery", action: "toggleGallery"},
          {icon: "fa-solid fa-eye", label: "ADVANCED_INTERFACE.PlayingCards.Scry", action: "scry",
            visible: function() { return this.document.type === "deck" && this.isEditable && !this.document.pack; }},
          {icon: "fa-solid fa-user", label: "ADVANCED_INTERFACE.PlayingCards.PlayerHand", action: "playerHand",
            visible: function() { return this.document.type === "hand" && this.isEditable && !this.document.pack; }}
        ]
      },
      actions: {
        toggleSort: function() {
          this.sortMode = this.sortMode === "standard" ? "shuffled" : "standard";
          return this.render({parts: ["cards"], sortMode: this.sortMode});
        },
        shuffle: async function() {
          if (!this.isEditable || this.document.pack) return;
          this.sortMode = "shuffled";
          await this.document.shuffle();
        },
        toggleGallery: async function() {
          await game.settings.set(MODULE_ID, "cardGallery", !game.settings.get(MODULE_ID, "cardGallery"));
        },
        viewCard: function(_event, target) {
          const card = this.document.cards.get(target.closest("[data-card-id]").dataset.cardId);
          new foundry.applications.apps.ImagePopout({src: card.img, uuid: card.uuid, window: {title: card.name}}).render({force: true});
        },
        playCard: async function(_event, target) {
          if (!this.isEditable || this.document.pack) return;
          const card = this.document.cards.get(target.closest("[data-card-id]").dataset.cardId);
          if (!card.drawn || this.document.type !== "deck") await this.document.playDialog(card);
        },
        recallCard: async function(_event, target) {
          if (!this.isEditable || this.document.pack) return;
          const card = this.document.cards.get(target.closest("[data-card-id]").dataset.cardId);
          await game.modules.get(MODULE_ID).api.cards.action("recall", {uuid: card.uuid});
        },
        playerHand: function() { return choosePlayerHand(); },
        scry: function() { return game.modules.get(MODULE_ID).api.cards.scry(this.document); }
      }
    };

    static PARTS = {
      header: {template: "modules/advanced-interface/templates/card-stack-header.hbs"},
      tabs: {template: "templates/generic/tab-navigation.hbs"},
      configuration: {template: "modules/advanced-interface/templates/card-stack-config.hbs", scrollable: [""]},
      cards: {template: "modules/advanced-interface/templates/card-stack-cards.hbs", scrollable: ["ol[data-cards]"]},
      footer: {template: "templates/generic/form-footer.hbs"}
    };

    static TABS = {
      sheet: {
        tabs: [{id: "configuration", icon: "fa-solid fa-gears"}, {id: "cards", icon: "fa-solid fa-id-badge"}],
        initial: "cards", labelPrefix: "ADVANCED_INTERFACE.PlayingCards.Tabs"
      }
    };

    sortMode = "shuffled";
    cardListObserver = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.isDeck = this.document.type === "deck";
      context.isHand = this.document.type === "hand";
      context.isPile = this.document.type === "pile";
      context.canManage = this.isEditable && !this.document.pack;
      return context;
    }

    async _preparePartContext(partId, context, options) {
      const sortMode = options.sortMode ?? this.sortMode;
      const part = await super._preparePartContext(partId, context, partId === "cards" ? {...options, sortMode} : options);
      part.tab = context.tabs[partId];
      if (partId === "tabs") part.tabClasses = "top-tabs";
      if (partId === "cards") {
        part.entries = this._prepareCards(sortMode).map(card => ({
          card, type: card.showFace || context.isDeck ? game.i18n.localize(CONFIG.Card.typeLabels[card.type]) : "",
          suit: card.showFace || context.isDeck ? card.suit : "",
          value: card.showFace || context.isDeck ? card.value : "",
          canPlay: context.canManage && !(context.isDeck && card.drawn),
          primaryRecall: context.canManage && context.isDeck && card.drawn,
          canRecall: context.canManage && ((context.isDeck && card.drawn) || !card.isHome)
        }));
      }
      if (partId === "configuration") {
        part.owners = game.users.map(user => ({id: user.id, name: user.name,
          selected: user.id === this.document.getFlag(MODULE_ID, "primaryOwner")}));
        part.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.document.description, {
          relativeTo: this.document, secrets: this.document.isOwner
        });
      }
      return part;
    }

    _prepareButtons() {
      if (!this.isEditable) return [];
      const empty = !this.document.cards.size;
      const disabled = !!this.document.pack;
      const buttons = [];
      if (this.document.type !== "hand") buttons.push({type: "button", action: "shuffle", icon: "fa-solid fa-shuffle", label: "CARDS.ACTIONS.Shuffle", disabled: disabled || empty});
      if (this.document.type === "hand") buttons.push({type: "button", action: "draw", icon: "fa-solid fa-plus", label: "CARDS.ACTIONS.Draw", disabled});
      buttons.push(this.document.type === "deck"
        ? {type: "button", action: "deal", icon: "fa-solid fa-share-from-square", label: "CARDS.ACTIONS.Deal", disabled: disabled || !this.document.availableCards.length}
        : {type: "button", action: "pass", icon: "fa-solid fa-share-from-square", label: "CARDS.ACTIONS.Pass", disabled: disabled || empty});
      buttons.push({type: "button", action: "reset", icon: "fa-solid fa-rotate-left", label: "CARDS.ACTIONS.Reset",
        disabled: disabled || (this.document.type === "deck" ? !this.document.drawnCards.length : empty)});
      return buttons;
    }

    _onDragStart(event) {
      const transfer = game.modules.get("advanced-drag-and-drop");
      const move = this.document.type === "deck" && transfer?.active && transfer.api?.isTransferHeld?.();
      const result = super._onDragStart(event);
      if (move) event.dataTransfer.setData(DECK_TRANSFER_TYPE, "move");
      return result;
    }

    async _onDrop(event) {
      const transfer = game.modules.get("advanced-drag-and-drop");
      const move = event.dataTransfer?.getData(DECK_TRANSFER_TYPE) === "move" || transfer?.api?.isTransferHeld?.();
      if (this.document.type !== "deck" || !transfer?.active || !move) {
        return super._onDrop(event);
      }
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data.type !== "Card") return super._onDrop(event);
      const card = await foundry.documents.Card.implementation.fromDropData(data);
      if (card?.parent?.type !== "deck" || card.parent === this.document) return super._onDrop(event);
      if (!this.isEditable || this.document.pack) throw new Error("You cannot modify this deck.");
      try {
        return await requestCardOperation("moveDeckCard", {uuid: card.uuid, destinationId: this.document.id});
      } catch (error) { report(error); }
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.element.classList.toggle("advanced-interface-card-gallery", game.settings.get(MODULE_ID, "cardGallery"));
      for (const control of this.element.querySelectorAll('.advanced-interface-card-search, [data-action="toggleSort"], [data-action="toggleGallery"], [data-action="viewCard"]')) {
        control.disabled = false;
      }
      const search = this.element.querySelector(".advanced-interface-card-search");
      if (search) search.oninput = () => {
        const query = search.value.trim().toLocaleLowerCase();
        for (const row of this.element.querySelectorAll("li[data-card-id]")) {
          row.hidden = !row.dataset.cardName.toLocaleLowerCase().includes(query);
        }
      };
      if (search) search.onchange = event => event.stopPropagation();
      this.cardListObserver?.disconnect();
      const list = this.element.querySelector("ol[data-cards]");
      if (list) {
        this.cardListObserver = new ResizeObserver(() => {
          this.element.style.setProperty("--advanced-interface-card-scrollbar", `${list.offsetWidth - list.clientWidth}px`);
        });
        this.cardListObserver.observe(list);
      }
      for (const button of this.element.querySelectorAll("button[data-action='toggleGallery']")) {
        button.setAttribute("aria-pressed", String(game.settings.get(MODULE_ID, "cardGallery")));
      }
      if (!this.element.dataset.advancedCardContext) {
        this.element.dataset.advancedCardContext = "true";
        const cardForRow = row => this.document.cards.get(row.dataset.cardId);
        const editable = () => this.isEditable && !this.document.pack;
        new foundry.applications.ux.ContextMenu.implementation(this.element, "li[data-card-id]", [
          {name: "ADVANCED_INTERFACE.PlayingCards.View", icon: '<i class="fa-solid fa-eye"></i>',
            callback: row => {
              const card = cardForRow(row);
              new foundry.applications.apps.ImagePopout({src: card.img, uuid: card.uuid, window: {title: card.name}}).render({force: true});
            }},
          {name: "CARD.Play", icon: '<i class="fa-solid fa-circle-play"></i>',
            condition: row => editable() && !!row.querySelector('[data-action="playCard"]'),
            callback: row => row.querySelector('[data-action="playCard"]').click()},
          {name: "ADVANCED_INTERFACE.PlayingCards.Recall", icon: '<i class="fa-solid fa-recycle"></i>',
            condition: row => editable() && (this.document.type === "deck" ? cardForRow(row).drawn : !cardForRow(row).isHome),
            callback: row => game.modules.get(MODULE_ID).api.cards.action("recall", {uuid: cardForRow(row).uuid})},
          {name: "CARDS.ACTIONS.Edit", icon: '<i class="fa-solid fa-pen-to-square"></i>',
            condition: editable, callback: row => cardForRow(row).sheet.render({force: true})}
        ], {fixed: true, jQuery: false});
      }
      Hooks.callAll("advancedInterfaceCardSheet", this, this.element);
    }

    async _onClose(options) {
      this.cardListObserver?.disconnect();
      this.cardListObserver = null;
      await super._onClose(options);
    }
  };
}

export function registerCards() {
  game.settings.register(MODULE_ID, "cardGallery", {
    scope: "client", config: false, type: Boolean, default: false,
    onChange: value => {
      for (const element of document.querySelectorAll(".advanced-interface-card-sheet")) {
        element.classList.toggle("advanced-interface-card-gallery", value);
        for (const button of element.querySelectorAll("button[data-action='toggleGallery']")) button.setAttribute("aria-pressed", String(value));
      }
    }
  });
  const {CardDeckConfig, CardHandConfig, CardPileConfig, CardConfig} = foundry.applications.sheets;
  class AdvancedDeckSheet extends advancedStackSheet(CardDeckConfig) {
    static TABS = {sheet: {
      tabs: [{id: "configuration", icon: "fa-solid fa-gears"}, {id: "cards", icon: "fa-solid fa-id-badge"}],
      initial: "configuration", labelPrefix: "ADVANCED_INTERFACE.PlayingCards.Tabs"
    }};
  }
  class AdvancedHandSheet extends advancedStackSheet(CardHandConfig) {}
  class AdvancedPileSheet extends advancedStackSheet(CardPileConfig) {}
  class AdvancedCardSheet extends CardConfig {
    static DEFAULT_OPTIONS = {classes: ["advanced-interface-card-sheet"], position: {width: 500}};
    static PARTS = {
      ...CardConfig.PARTS,
      header: {template: "modules/advanced-interface/templates/card-stack-header.hbs"},
      details: {template: "modules/advanced-interface/templates/card-details.hbs"},
      faces: {template: "modules/advanced-interface/templates/card-faces.hbs", scrollable: [""]},
      back: {template: "modules/advanced-interface/templates/card-back.hbs"}
    };
    static TABS = {sheet: {
      tabs: [
        {id: "details", icon: "fa-solid fa-pen-fancy"},
        {id: "faces", icon: "fa-solid fa-masks-theater"},
        {id: "back", icon: "fa-solid fa-mask"}
      ], initial: "details", labelPrefix: "ADVANCED_INTERFACE.PlayingCards.CardTabs"
    }};

    async _preparePartContext(partId, context, options) {
      const part = await super._preparePartContext(partId, context, options);
      const enrich = value => foundry.applications.ux.TextEditor.implementation.enrichHTML(value ?? "", {
        relativeTo: this.document, secrets: this.document.isOwner
      });
      if (partId === "details") part.descriptionHTML = await enrich(this.document.description);
      if (partId === "faces") {
        part.backLabel = this.document.back.name || localize("PlayingCards.BacksideUp");
        part.faceChoices = Object.fromEntries(this.document.faces.map((face, index) => [index,
          face.name || game.i18n.format("ADVANCED_INTERFACE.PlayingCards.UnnamedFace", {index})]));
        part.faceEntries = await Promise.all(this.document.faces.map(async (face, index) => ({
          index, name: face.name, img: face.img, text: face.text, enriched: await enrich(face.text)
        })));
      }
      if (partId === "back") part.backHTML = await enrich(this.document.back.text);
      return part;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this.element.dataset.advancedCardFaceNames) return;
      this.element.dataset.advancedCardFaceNames = "true";
      this.element.addEventListener("change", event => {
        const input = event.target;
        const select = this.element.querySelector('[name="face"]');
        if (!select) return;
        if (input.name === "back.name") {
          select.querySelector('option[value=""]').textContent = input.value || localize("PlayingCards.BacksideUp");
          return;
        }
        const face = input.closest("[data-face]");
        if (!face || input.name !== `faces.${face.dataset.index}.name`) return;
        const option = select.querySelector(`option[value="${face.dataset.index}"]`);
        if (option) option.textContent = input.value || game.i18n.format("ADVANCED_INTERFACE.PlayingCards.UnnamedFace", {index: face.dataset.index});
      });
    }
  }
  const {DocumentSheetConfig} = foundry.applications.apps;
  for (const [type, Sheet] of [["deck", AdvancedDeckSheet], ["hand", AdvancedHandSheet], ["pile", AdvancedPileSheet]]) {
    DocumentSheetConfig.registerSheet(foundry.documents.Cards, MODULE_ID, Sheet, {
      types: [type], makeDefault: true, label: `ADVANCED_INTERFACE.PlayingCards.Sheets.${type}`
    });
  }
  DocumentSheetConfig.registerSheet(foundry.documents.Card, MODULE_ID, AdvancedCardSheet, {
    makeDefault: true, label: "ADVANCED_INTERFACE.PlayingCards.CardSheet"
  });
  const api = game.modules.get(MODULE_ID).api ??= {};
  api.cards = {getPlayerHand, choosePlayerHand};
  Hooks.on("getUserContextOptions", (_app, options) => {
    const userForRow = row => game.users.get(row.dataset.userId);
    options.push({
      name: "ADVANCED_INTERFACE.PlayingCards.PlayerHand", icon: '<i class="fa-solid fa-cards"></i>',
      condition: row => game.user.isGM || userForRow(row)?.isSelf,
      callback: row => choosePlayerHand(userForRow(row)).catch(report)
    });
  });
  for (const event of ["renderPlayers", "updateUser", "createCard", "deleteCard", "updateCard", "updateCards", "deleteCards"]) {
    Hooks.on(event, renderHandButtons);
  }
  Hooks.on("renderPlayerCardWindow", renderHandButtons);
}