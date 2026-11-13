import {MODULE_ID, localize, reportError} from "./helper.mjs";
import {requestCardOperation} from "./card-operations.mjs";

const report = reportError("Card tools");

function stackSelect(name, stacks, selected = "") {
  const select = document.createElement("select");
  select.name = name;
  for (const stack of stacks) select.append(new Option(stack.name, stack.id, false, stack.id === selected));
  select.selectedOptions[0]?.setAttribute("selected", "");
  return select;
}

function field(root, key, input) {
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.textContent = localize(`PlayingCards.${key}`);
  label.append(input);
  group.append(label);
  root.append(group);
}

export async function layoutCardsDialog(shape = "grid", fromId = "") {
  if (!game.user.isGM || !canvas.scene) throw new Error("A GM viewing a scene is required.");
  if (!["grid", "triangle", "circle"].includes(shape)) throw new Error("Unknown layout shape.");
  const content = document.createElement("div");
  const {createFormGroup, createSelectInput} = foundry.applications.fields;
  const {HTMLRangePickerElement} = foundry.applications.elements;
  const scene = canvas.scene;
  const stacks = game.cards.filter(stack => stack.isOwner);
  const options = stacks.map(stack => ({value: stack.id, label: stack.name, group: stack.typeLabel}));
  const from = stacks.find(stack => stack.id === fromId) ?? stacks.find(stack => stack.type === "deck") ?? stacks[0];
  const group = (key, input, layout) => {
    const element = createFormGroup({
      label: `ADVANCED_INTERFACE.PlayingCards.${key}`,
      hint: `ADVANCED_INTERFACE.PlayingCards.${key}Hint`, localize: true, input
    });
    if (layout) {
      element.dataset.layoutType = layout;
      element.hidden = layout !== shape;
    }
    content.append(element);
  };
  group("LayoutType", createSelectInput({name: "shape", value: shape, options: [
    {value: "grid", label: localize("PlayingCards.LayoutGrid")},
    {value: "triangle", label: localize("PlayingCards.LayoutTriangle")},
    {value: "circle", label: localize("PlayingCards.LayoutCircle")}
  ]}));
  group("From", createSelectInput({name: "from", options, value: from?.id}));
  group("Face", createSelectInput({name: "face", options: [
    {value: "", label: localize("PlayingCards.NoChange")},
    {value: "front", label: localize("PlayingCards.FirstFace")},
    {value: "back", label: localize("PlayingCards.CardBack")}
  ]}));
  group("NumberOfCards", HTMLRangePickerElement.create({name: "count", min: 1, max: 250, step: 1, value: 1}));
  const {sceneWidth} = scene.getDimensions();
  const size = scene.grid.size;
  const maxColumns = Math.max(1, Math.min(50, Math.floor((sceneWidth + size) / (size * 3))));
  const range = (name, key, max, layout) => group(key,
    HTMLRangePickerElement.create({name, min: 1, max, step: 1, value: 1}), layout);
  range("columns", "Columns", maxColumns, "grid");
  group("Direction", createSelectInput({name: "direction", options: ["up", "down", "left", "right"]
    .map(value => ({value, label: localize(`PlayingCards.${value}`)}))}), "triangle");
  const data = await foundry.applications.api.DialogV2.prompt({
    classes: ["advanced-interface-card-layout"], position: {width: 480},
    window: {title: localize("PlayingCards.LayoutTitle"), icon: "fa-solid fa-cards"},
    content,
    render: (_event, dialog) => {
      const select = dialog.element.querySelector('[name="shape"]');
      select.addEventListener("change", () => {
        for (const group of dialog.element.querySelectorAll("[data-layout-type]")) {
          group.hidden = group.dataset.layoutType !== select.value;
        }
        dialog.setPosition({height: "auto"});
      });
    },
    ok: {
      icon: "fa-solid fa-cards",
      label: localize("PlayingCards.Layout"),
      callback: (_event, button) => {
        const fields = button.form.elements;
        const selectedShape = fields.shape.value;
        return {
          sceneId: scene.id, shape: selectedShape, from: fields.from.value,
          count: Number(fields.count.value),
          columns: selectedShape === "grid" ? Number(fields.columns.value) : undefined,
          spacing: size, direction: fields.direction?.value ?? "up", face: fields.face.value
        };
      }
    }, rejectClose: false
  });
  if (data) await requestCardOperation("layout", data);
}

export function registerCardTools() {
  class AdvancedCardScry extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: ["advanced-interface-card-scry"], position: {width: 620, height: 600},
      window: {title: "ADVANCED_INTERFACE.PlayingCards.Scry", icon: "fa-solid fa-eye"},
      actions: {
        top: function(_event, target) { this.moveCard(target.dataset.cardId, true); },
        bottom: function(_event, target) { this.moveCard(target.dataset.cardId, false); },
        save: async function() { await this.saveOrder(); },
        shuffle: async function() {
          const revealed = [...this.revealed];
          for (let index = revealed.length - 1; index > 0; index--) {
            const other = Math.floor(Math.random() * (index + 1));
            [revealed[index], revealed[other]] = [revealed[other], revealed[index]];
          }
          let index = 0;
          this.order = this.order.map(id => this.revealed.has(id) ? revealed[index++] : id);
          await this.saveOrder();
        },
        cancel: async function() { await this.close(); }
      }
    };
    static PARTS = {cards: {template: "modules/advanced-interface/templates/card-scry.hbs", scrollable: ["ol"]}};

    constructor(stack, count) {
      super();
      this.stack = stack;
      this.initial = stack.availableCards.toSorted((first, second) => first.sort - second.sort).map(card => card.id);
      this.order = [...this.initial];
      this.revealed = new Set(this.order.slice(0, count));
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (!this.stack.isOwner) throw new Error("You no longer own this deck.");
      context.name = this.stack.name;
      context.cards = this.order.filter(id => this.revealed.has(id)).map(id => {
        const card = this.stack.cards.get(id);
        return {id, name: card?.faces[0]?.name || card?._source.name, img: card?.faces[0]?.img || card?.img,
          position: this.order.indexOf(id) + 1};
      });
      return context;
    }

    moveCard(id, top) {
      if (!this.revealed.has(id)) return;
      this.order = this.order.filter(entry => entry !== id);
      if (top) this.order.unshift(id);
      else this.order.push(id);
      this.render();
    }

    async saveOrder() {
      try {
        await requestCardOperation("scryOrder", {stackId: this.stack.id, expected: this.initial, order: this.order});
        await this.close();
      } catch (error) { report(error); }
    }
  }

  async function scry(stack, count) {
    if (!stack?.isOwner || stack.type !== "deck") throw new Error("You must own a deck to scry.");
    if (count === undefined) {
      count = await foundry.applications.api.DialogV2.prompt({
        window: {title: localize("PlayingCards.Scry")},
        content: `<label>${localize("PlayingCards.Amount")}<input type="number" name="amount" value="${Math.min(3, stack.availableCards.length)}" min="1" max="${stack.availableCards.length}" required></label>`,
        ok: {callback: (_event, button) => Number(button.form.elements.amount.value)}, rejectClose: false
      });
      if (count == null) return;
    }
    if (!Number.isInteger(count) || count < 1 || count > stack.availableCards.length) throw new Error("Invalid scry amount.");
    return new AdvancedCardScry(stack, count).render({force: true});
  }

  class AllocateCardBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
    static defineSchema() {
      const {ForeignDocumentField, BooleanField} = foundry.data.fields;
      return {
        targetStack: new ForeignDocumentField(foundry.documents.Cards, {label: "ADVANCED_INTERFACE.PlayingCards.To", required: true}),
        keepCanvasCard: new BooleanField({initial: true, label: "ADVANCED_INTERFACE.PlayingCards.KeepCanvasCard"})
      };
    }
  }
  CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.allocateCard`] = AllocateCardBehavior;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.allocateCard`] = "fa-solid fa-cards";
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM || !controls.advancedCards) return;
    controls.advancedCards.tools.layout = {
      name: "layout", order: 5, title: "ADVANCED_INTERFACE.PlayingCards.LayoutTitle", icon: "fa-solid fa-table-cells",
      button: true, onChange: () => layoutCardsDialog().catch(report)
    };
  });
  Hooks.on("renderSceneConfig", (app, element) => {
    if (!app.isEditable || element.querySelector(".advanced-interface-canvas-pile")) return;
    const section = element.querySelector('.tab[data-tab="basic"], .tab[data-tab="basics"]') ?? element.querySelector(".window-content");
    if (!section) return;
    const select = stackSelect(`flags.${MODULE_ID}.canvasPile`, game.cards.filter(stack => stack.type === "pile"), app.document.getFlag(MODULE_ID, "canvasPile"));
    const none = new Option(localize("PlayingCards.None"), "", !app.document.getFlag(MODULE_ID, "canvasPile"), !app.document.getFlag(MODULE_ID, "canvasPile"));
    select.prepend(none);
    select.className = "advanced-interface-canvas-pile";
    field(section, "CanvasPile", select);
  });
  Object.assign(game.modules.get(MODULE_ID).api.cards, {
    scry, layoutDialog: layoutCardsDialog,
    layout: data => requestCardOperation("layout", {sceneId: canvas.scene?.id, ...data})
  });
  Hooks.on("getCardsContextOptions", (_app, options) => {
    const stackForRow = row => game.cards.get(row.dataset.entryId);
    options.push({
      name: "ADVANCED_INTERFACE.PlayingCards.Scry", icon: '<i class="fa-solid fa-eye"></i>',
      condition: row => {
        const stack = stackForRow(row);
        return stack?.type === "deck" && stack.isOwner && stack.availableCards.length > 0;
      },
      callback: row => scry(stackForRow(row)).catch(report)
    });
  });
}