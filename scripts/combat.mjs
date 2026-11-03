import {decorateLeadingIcons} from "./interface-components.mjs";
import {createButton, createIcon, localize, setButtonLabel} from "./helper.mjs";

// Combat Encounters: an encounter navigation bar, then (with an encounter) a separate encounter information bar.
const BUTTON_SIZE = 32;
const encounterObservers = new WeakMap();

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") return;
  CONFIG.ui.combat = class AdvancedCombatTracker extends CONFIG.ui.combat {
    renderGroups() {}

    _getEntryContextOptions() {
      const options = super._getEntryContextOptions();
      const reroll = options.find(option => (option.label ?? option.name) === "COMBATANT.ACTIONS.Reroll");
      if (reroll) reroll.onClick = (event, card) => {
        const combatant = this.viewed?.combatants.get(card.dataset.combatantId);
        if (combatant) return foundry.documents.Combat.prototype.rollInitiative.call(this.viewed, [combatant.id]);
      };
      return options;
    }
  };
});

function iconButton(doc, {action, icon, label, combatId, disabled = false, text, className = ""}) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = `inline-control ${text === undefined ? `icon fa-solid ${icon}` : ""} ${className}`.trim();
  if (action) button.dataset.action = action;
  if (combatId) button.dataset.combatId = combatId;
  if (label) setButtonLabel(button, label);
  if (text !== undefined) button.textContent = text;
  button.disabled = disabled;
  return button;
}

function buildEncounterNavigation(app, nav) {
  const doc = nav.ownerDocument;
  const combats = app.combats;
  const index = combats.indexOf(app.viewed);
  const create = iconButton(doc, {action: "createCombat", icon: "fa-plus", label: game.i18n.localize("COMBAT.Create")});
  const numbers = doc.createElement("div");
  numbers.className = "advanced-interface-encounter-numbers";
  combats.forEach((combat, i) => {
    const button = iconButton(doc, {action: "cycleCombat", combatId: combat.id, text: String(i + 1),
      label: combat.name || undefined, className: i === index ? "active" : ""});
    numbers.append(button);
  });
  const cycle = doc.createElement("div");
  cycle.className = "advanced-interface-encounter-cycle";
  const previous = combats[index - 1];
  const next = combats[index + 1];
  const last = combats.at(-1);
  const separator = doc.createElement("span");
  separator.className = "advanced-interface-encounter-separator";
  separator.ariaHidden = "true";
  separator.textContent = "/";
  cycle.append(
    iconButton(doc, {action: "cycleCombat", icon: "fa-left", combatId: previous?.id, disabled: !previous,
      label: game.i18n.localize("COMBAT.EncounterPrevious")}),
    iconButton(doc, {text: String(index + 1), className: "active advanced-interface-encounter-current",
      label: app.viewed?.name || undefined}),
    separator,
    iconButton(doc, {action: "cycleCombat", combatId: last?.id, text: String(combats.length),
      disabled: !last || last === app.viewed, label: last?.name || undefined}),
    iconButton(doc, {action: "cycleCombat", icon: "fa-right", combatId: next?.id, disabled: !next,
      label: game.i18n.localize("COMBAT.EncounterNext")})
  );
  const settings = iconButton(doc, {action: "trackerSettings", icon: "fa-gear",
    label: game.i18n.localize("COMBAT.Settings")});
  nav.classList.remove("cycle", "tabbed");
  nav.classList.add("advanced-interface-encounters");
  nav.replaceChildren(create, numbers, cycle, settings);

  encounterObservers.get(app)?.disconnect();
  const fit = () => {
    const available = nav.clientWidth - (2 * BUTTON_SIZE) - 16;
    nav.classList.toggle("advanced-interface-encounters-cycle", combats.length * BUTTON_SIZE > available);
  };
  const observer = new ResizeObserver(fit);
  observer.observe(nav);
  encounterObservers.set(app, observer);
  fit();
}

// Footer buttons are cloned rather than moved so independent part re-renders always see core's own markup.
function cloneTurnControls(element, controls) {
  const right = controls.querySelector(".control-buttons.right");
  if (!right) return;
  right.querySelectorAll(".advanced-interface-combat-clone").forEach(button => button.remove());
  const footer = element.querySelector("nav.combat-controls");
  for (const source of footer?.querySelectorAll(":scope > button") ?? []) {
    const button = source.cloneNode(true);
    button.querySelectorAll(".advanced-interface-icon-disc").forEach(el => el.remove());
    button.classList.remove("advanced-interface-cutout-button");
    button.classList.add("advanced-interface-combat-clone");
    if (button.classList.contains("combat-control-lg")) {
      const icon = button.querySelector("i");
      const label = button.querySelector("span")?.textContent.trim() ?? "";
      const glyph = {startCombat: "fa-play", endCombat: "fa-stop"}[button.dataset.action]
        ?? [...(icon?.classList ?? [])].find(name => name.startsWith("fa-") && name !== "fa-solid");
      button.replaceChildren();
      button.className = `inline-control combat-control icon fa-solid ${glyph ?? "fa-swords"} advanced-interface-combat-clone`;
      button.ariaLabel = label;
      button.dataset.tooltip = "";
    }
    const turnIcon = {
      previousRound: "fa-backward-fast", previousTurn: "fa-backward-step",
      nextTurn: "fa-forward-step", nextRound: "fa-forward-fast"
    }[button.dataset.action];
    if (turnIcon) {
      button.classList.remove(...[...button.classList].filter(name => name.startsWith("fa-") && name !== "fa-solid"));
      button.classList.add(turnIcon);
    }
    right.append(button);
  }
  // Start/End Combat sits at the far right, after the turn and round controls.
  const toggle = right.querySelector(':scope > .advanced-interface-combat-clone:is([data-action="startCombat"], [data-action="endCombat"])');
  if (toggle) right.append(toggle);
}

// The encounter information bar names the viewed encounter between its roll and turn controls.
function buildEncounterName(app, controls) {
  const combat = app.viewed;
  controls.querySelector(".advanced-interface-encounter-name")?.remove();
  if (!combat) return;
  const doc = controls.ownerDocument;
  const label = doc.createElement("label");
  label.className = "advanced-interface-encounter-name";
  const icon = createIcon(doc, "fa-solid fa-swords advanced-interface-encounter-name-icon");
  const input = doc.createElement("input");
  input.type = "text";
  input.name = "advancedInterfaceEncounterName";
  input.value = combat.name ?? "";
  input.placeholder = `${localize("Encounter")} ${app.combats.indexOf(combat) + 1}`;
  input.ariaLabel = game.i18n.localize("Name");
  input.disabled = !combat.canUserModify(game.user, "update");
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      input.value = combat.name ?? "";
      input.blur();
    }
    event.stopPropagation();
  });
  input.addEventListener("change", () => {
    const name = input.value.trim();
    if (name !== (combat.name ?? "")) combat.update({name}).catch(error => {
      input.value = combat.name ?? "";
      ui.notifications.error(error.message);
    });
  });
  label.append(icon, input);
  controls.querySelector(".control-buttons.right")?.before(label);
  decorateLeadingIcons([icon], "advanced-interface-encounter-name-icon");
}

function arrangeCombatants(app, element) {
  const resourcePath = game.settings.get("core", "combatTrackerConfig").resource ?? "";
  for (const card of element.querySelectorAll(".combatant[data-combatant-id]")) {
    if (card.querySelector(".advanced-interface-combatant-actions")) continue;
    const combatant = app.viewed?.combatants.get(card.dataset.combatantId);
    if (!combatant) continue;
    const doc = card.ownerDocument;
    const row = doc.createElement("div");
    row.className = "advanced-interface-combatant-actions";
    for (const action of ["toggleHidden", "toggleDefeated", "pingCombatant"]) {
      const control = card.querySelector(`[data-action="${action}"]`);
      if (!control) continue;
      if (action === "pingCombatant") {
        control.classList.remove("fa-bullseye-arrow", "fa-bullseye", "fa-crosshairs");
        control.classList.add("fa-location-dot");
      }
      row.append(control);
    }
    const initiative = card.querySelector(".token-initiative");
    let initiativeControls;
    if (initiative) {
      initiativeControls = doc.createElement("div");
      initiativeControls.className = "advanced-interface-combatant-initiative";
      const roll = initiative.querySelector('[data-action="rollInitiative"]');
      if (roll || combatant.isOwner) {
        const reroll = combatant.initiative == null ? null : app._getEntryContextOptions()
          .find(option => (option.label ?? option.name) === "COMBATANT.ACTIONS.Reroll");
        const button = reroll ? createButton(doc, "", {
          context: "Reroll initiative",
          onClick: event => reroll.onClick(event, card)
        }) : roll ?? iconButton(doc, {action: "rollInitiative"});
        if (reroll) button.disabled = typeof reroll.visible === "function" ? !reroll.visible(card) : reroll.visible === false;
        button.className = "inline-control combatant-control icon fa-solid fa-dice-d20";
        button.removeAttribute("style");
        button.replaceChildren();
        setButtonLabel(button, game.i18n.localize(combatant.initiative == null ? "COMBAT.InitiativeRoll" : "COMBATANT.ACTIONS.Reroll"));
        initiativeControls.append(button);
      }
      if (combatant.initiative != null) initiativeControls.append(initiative);
      else initiative.remove();
    }
    const resource = card.querySelector(".token-resource");
    if (resource) {
      const icon = /(?:^|\.)(?:hp|hitPoints)(?:\.|$)/i.test(resourcePath) ? "heart"
        : /(?:^|\.)(?:ac|armor)(?:\.|$)/i.test(resourcePath) ? "shield-halved"
        : /spell|slot|mana|mp/i.test(resourcePath) ? "hat-wizard"
        : /ki|focus|psi/i.test(resourcePath) ? "yin-yang"
        : /rage|fury/i.test(resourcePath) ? "fire" : "bars-progress";
      resource.prepend(createIcon(doc, `fa-solid fa-${icon}`));
      const field = combatant.actor?.system.schema?.getField(resourcePath);
      resource.dataset.tooltip = field?.label ? game.i18n.localize(field.label) : resourcePath;
      row.append(resource);
    }
    if (initiativeControls?.childElementCount) row.append(initiativeControls);
    card.append(row);
    card.classList.toggle("advanced-interface-combatant-effects", !!card.querySelector(".token-effects > *"));
  }
}

// Active effects use the orange disc technique: each effect icon is cut out of an orange circle.
function discTokenEffects(app, element) {
  const doc = element.ownerDocument;
  for (const effects of element.querySelectorAll(".combatant .token-effects")) {
    for (const attribute of ["data-tooltip-html", "data-tooltip", "data-tooltip-text", "title"]) {
      effects.removeAttribute(attribute);
    }
    const combatant = app.viewed?.combatants.get(effects.closest("[data-combatant-id]")?.dataset.combatantId);
    const available = [...(combatant?.actor?.appliedEffects ?? [])];
    for (const img of effects.querySelectorAll(":scope > img")) {
      const source = new URL(img.getAttribute("src"), doc.baseURI).href;
      const index = available.findIndex(effect => effect.name === (img.alt || img.title)
        && new URL(effect.img, doc.baseURI).href === source);
      const effect = index < 0 ? null : available.splice(index, 1)[0];
      const disc = createButton(doc, "advanced-interface-effect-disc", {
        label: img.alt || img.title,
        context: "Disable combatant effect",
        onClick: async () => {
          if (!effect?.canUserModify(game.user, "update")) return;
          disc.disabled = true;
          try {
            await effect.update({disabled: true});
          } finally {
            disc.disabled = !effect.canUserModify(game.user, "update");
          }
        }
      });
      disc.disabled = !effect?.canUserModify(game.user, "update");
      if (effect) disc.dataset.effectUuid = effect.uuid;
      disc.style.setProperty("--advanced-interface-effect-icon", `url("${source}")`);
      img.replaceWith(disc);
    }
  }
}

function arrangeCombatBar(app, element) {
  arrangeCombatants(app, element);
  discTokenEffects(app, element);
  const header = element.querySelector(".combat-tracker-header");
  if (!header) return;
  const nav = header.querySelector("nav.encounters");
  if (nav) buildEncounterNavigation(app, nav);
  const controls = header.querySelector(".encounter-controls");
  if (!controls) return;
  const left = controls.querySelector(".control-buttons.left");
  const menu = controls.querySelector(".encounter-context-menu");
  if (menu && left && left.firstElementChild !== menu) {
    menu.ariaLabel ||= localize("Cards.Menu");
    menu.dataset.tooltip = "";
    left.prepend(menu);
  }
  // Roll All and Roll NPCs live in the encounter submenu instead.
  for (const button of left?.querySelectorAll(':scope > [data-action="rollAll"], :scope > [data-action="rollNPC"]') ?? []) {
    button.remove();
  }
  cloneTurnControls(element, controls);
  buildEncounterName(app, controls);
}

function keepAnimatedInitiativeVisible(app, element) {
  const pending = element.querySelectorAll(".combatant.dsn-initiative-pending");
  if (!pending.length) return;
  for (const card of pending) {
    card.classList.remove("dsn-initiative-pending");
    card.querySelectorAll(".dsn-initiative-pending-icon").forEach(icon => icon.remove());
  }
  const tracker = element.querySelector(".combat-tracker");
  if (!tracker || !app.viewed) return;
  const rows = new Map([...tracker.querySelectorAll(":scope > [data-combatant-id]")]
    .map(card => [card.dataset.combatantId, card]));
  let anchor = tracker.firstElementChild;
  for (const combatant of app.viewed.turns) {
    const card = rows.get(combatant.id);
    if (!card) continue;
    if (card !== anchor) tracker.insertBefore(card, anchor);
    anchor = card.nextElementSibling;
  }
}

Hooks.once("ready", () => {
  if (game.modules.get("dice-so-nice")?.active) {
    Hooks.on("renderCombatTracker", keepAnimatedInitiativeVisible);
  }
});

// The encounter submenu leads with the bulk rolls; its Edit Name entry is redundant with the editable name field.
Hooks.on("getCombatContextOptions", (app, options) => {
  const index = options.findIndex(option => option.label === "COMBAT.ACTIONS.EditName");
  const rolls = [
    {action: "rollAll", label: "COMBAT.RollAll", icon: "fa-solid fa-users"},
    {action: "rollNPC", label: "COMBAT.RollNPC", icon: "fa-solid fa-users-cog"}
  ].map(({action, label, icon}) => ({
    label, icon,
    visible: () => game.user.isGM && (app.viewed?.turns.length > 0),
    onClick: () => app.viewed?.[action]()
  }));
  options.splice(index < 0 ? 0 : index, index < 0 ? 0 : 1, ...rolls);
});

Hooks.on("getCombatantContextOptions", (app, options) => {
  const index = options.findIndex(option => (option.label ?? option.name) === "COMBATANT.ACTIONS.Reroll");
  if (index >= 0) options.splice(index, 1);
});

Hooks.on("renderCombatTracker", (app, element) => {
  arrangeCombatBar(app, element);
});

Hooks.on("closeCombatTracker", app => {
  encounterObservers.get(app)?.disconnect();
  encounterObservers.delete(app);
});
