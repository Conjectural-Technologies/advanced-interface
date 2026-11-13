import {MODULE_ID, reportError} from "./helper.mjs";

const pending = new Map();
let authorityQueue = Promise.resolve();
let requestQueue = Promise.resolve();
const INTERNAL_TRANSFER = Symbol("advanced-interface-card-transfer");

export function placementsFor(scene) {
  return foundry.utils.deepClone(scene?.getFlag(MODULE_ID, "cardPlacements") ?? []);
}

export function cardSortOrder(placements, selectedIds) {
  const selected = placements.filter(entry => selectedIds.has(entry.id));
  const others = placements.filter(entry => !selectedIds.has(entry.id));
  if (!selected.length || !others.length) return null;
  const front = selected.some(entry => entry.sort <= Math.max(...others.map(other => other.sort)));
  selected.sort((first, second) => front ? first.sort - second.sort : second.sort - first.sort);
  return {action: front ? "front" : "back", ids: selected.map(entry => entry.id)};
}

function requireOwner(document, user) {
  if (!document?.testUserPermission(user, "OWNER")) throw new Error("You do not own this card stack.");
}

function resolveCard(uuid, {allowStack = false} = {}) {
  const card = fromUuidSync(uuid);
  if ((!(card instanceof foundry.documents.Card) && !(allowStack && card?.documentName === "Cards")) || card.pack) {
    throw new Error("A world card or card stack is required.");
  }
  return card;
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function sceneFor(id, user) {
  const scene = game.scenes.get(id);
  if (!scene || (!user.isGM && (!scene.active || user.viewedScene !== scene.id))) {
    throw new Error("You cannot manage cards on this scene.");
  }
  return scene;
}

async function savePlacements(scene, placements) {
  await scene.setFlag(MODULE_ID, "cardPlacements", placements);
}

async function moveDeckCard(card, destination, user) {
  const source = card.parent;
  if (source?.type !== "deck" || destination?.type !== "deck" || source.pack || destination.pack || source === destination) {
    throw new Error("Choose two different world decks.");
  }
  requireOwner(source, user);
  requireOwner(destination, user);
  if (card.drawn) throw new Error("A drawn card cannot be moved between decks.");
  let destinationCardId = card.id;
  while (destination.cards.has(destinationCardId)) destinationCardId = foundry.utils.randomID();
  const originalUuid = card.uuid;
  const updateData = destinationCardId === card.id ? undefined : {_id: destinationCardId};
  const created = await card.pass(destination, {chatNotification: false, updateData, [INTERNAL_TRANSFER]: true});
  if (!created || !destination.cards.has(created.id)) throw new Error("The card transfer was not completed.");
  try {
    await source.deleteEmbeddedDocuments("Card", [card.id]);
    if (source.cards.has(card.id)) throw new Error("The source card was not removed.");
  } catch (error) {
    if (source.cards.has(card.id)) {
      try {
        await destination.deleteEmbeddedDocuments("Card", [created.id]);
        if (destination.cards.has(created.id)) throw new Error("The destination copy was not removed.");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "The source card could not be removed and the destination copy could not be rolled back.");
      }
    }
    throw error;
  }
  for (const scene of game.scenes) {
    const placements = placementsFor(scene);
    if (!placements.some(entry => entry.uuid === originalUuid)) continue;
    for (const entry of placements) if (entry.uuid === originalUuid) entry.uuid = created.uuid;
    await savePlacements(scene, placements);
  }
  return created.uuid;
}

async function allocateRegion(scene, card, placement) {
  if (card.documentName === "Cards") return {card, keep: true};
  const point = {x: placement.x, y: placement.y, elevation: placement.elevation ?? 0};
  let destination = game.cards.get(scene.getFlag(MODULE_ID, "canvasPile"));
  let keep = true;
  for (const region of scene.regions) {
    if (!region.testPoint(point)) continue;
    const behavior = region.behaviors.find(entry => !entry.disabled && entry.type === `${MODULE_ID}.allocateCard`);
    if (!behavior) continue;
    destination = behavior.system.targetStack;
    keep = behavior.system.keepCanvasCard;
    break;
  }
  if (!destination) return {card, keep: true};
  if (destination === card.parent) return {card, keep};
  if (destination.type === "deck") throw new Error("Canvas allocation requires a hand or pile.");
  const originalUuid = card.uuid;
  await card.pass(destination, {chatNotification: false, [INTERNAL_TRANSFER]: true});
  card = destination.cards.get(card.id, {strict: true});
  for (const otherScene of game.scenes) {
    if (otherScene.id === scene.id) continue;
    const otherPlacements = placementsFor(otherScene);
    if (!otherPlacements.some(entry => entry.uuid === originalUuid)) continue;
    for (const entry of otherPlacements) if (entry.uuid === originalUuid) entry.uuid = card.uuid;
    await savePlacements(otherScene, otherPlacements);
  }
  return {card, keep};
}

export async function executeCardOperation(action, data, user = game.user) {
  if (action === "moveDeckCard") {
    const card = resolveCard(data.uuid);
    return moveDeckCard(card, game.cards.get(data.destinationId), user);
  }
  if (action === "prune") {
    for (const scene of game.scenes) {
      const placements = placementsFor(scene);
      const valid = placements.filter(entry => !!fromUuidSync(entry.uuid));
      if (valid.length !== placements.length) await savePlacements(scene, valid);
    }
    return;
  }
  if (action === "rebind") {
    const origin = game.cards.get(data.origin);
    const destination = game.cards.get(data.destination);
    requireOwner(origin, user);
    if (!destination?.testUserPermission(user, "OBSERVER") || !Array.isArray(data.ids)) throw new Error("Invalid card transfer.");
    const replacements = new Map();
    for (const id of data.ids) {
      const card = destination.cards.get(id);
      const original = origin.cards.get(id);
      if (!card || (original && !original.drawn)) continue;
      replacements.set(`${origin.uuid}.Card.${id}`, destination.type === "deck" ? null : card.uuid);
    }
    for (const scene of game.scenes) {
      const placements = placementsFor(scene);
      if (!placements.some(entry => replacements.has(entry.uuid))) continue;
      const updated = [];
      for (const entry of placements) {
        if (!replacements.has(entry.uuid)) updated.push(entry);
        else if (replacements.get(entry.uuid)) updated.push({...entry, uuid: replacements.get(entry.uuid)});
      }
      await savePlacements(scene, updated);
    }
    return;
  }
  if (action === "scryOrder") {
    const stack = game.cards.get(data.stackId);
    requireOwner(stack, user);
    if (stack.type !== "deck") throw new Error("Scrying requires a deck.");
    const current = stack.availableCards.toSorted((first, second) => first.sort - second.sort).map(card => card.id);
    if (!Array.isArray(data.expected) || !Array.isArray(data.order)
      || JSON.stringify(current) !== JSON.stringify(data.expected)) throw new Error("The deck changed. Close scrying and try again.");
    if (data.order.length !== current.length || new Set(data.order).size !== current.length
      || data.order.some(id => !current.includes(id))) throw new Error("Invalid deck order.");
    await stack.updateEmbeddedDocuments("Card", data.order.map((id, index) => ({
      _id: id, sort: (index + 1) * CONST.SORT_INTEGER_DENSITY
    })));
    return;
  }
  if (action === "recall") {
    const card = resolveCard(data.uuid);
    requireOwner(card.parent, user);
    if (card.source) requireOwner(card.source, user);
    const recalled = new Set([card.uuid]);
    if (card.isHome && card.parent.type === "deck") {
      for (const stack of game.cards) {
        if (stack === card.parent) continue;
        const copy = stack.cards.get(card.id);
        if (copy?.source !== card.parent) continue;
        recalled.add(copy.uuid);
        await copy.recall({[INTERNAL_TRANSFER]: true});
      }
    }
    await card.recall({[INTERNAL_TRANSFER]: true});
    for (const scene of game.scenes) {
      const placements = placementsFor(scene);
      if (placements.some(entry => recalled.has(entry.uuid))) {
        await savePlacements(scene, placements.filter(entry => !recalled.has(entry.uuid)));
      }
    }
    return;
  }
  const scene = sceneFor(data.sceneId, user);
  let placements = placementsFor(scene);
  if (action === "clear") {
    if (!user.isGM) throw new Error("Only a GM can clear the card layer.");
    return savePlacements(scene, []);
  }
  if (action === "transfer") {
    if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 250
      || new Set(data.ids).size !== data.ids.length) throw new Error("Invalid canvas card selection.");
    const target = data.targetId && placements.find(entry => entry.id === data.targetId);
    if (data.targetId && (!target || (target.hidden && !user.isGM))) throw new Error("The destination stack is not available on this scene.");
    const destination = target ? resolveCard(target.uuid, {allowStack: true}) : game.cards.get(data.destinationId);
    if (!destination || destination.pack || destination.documentName !== "Cards") throw new Error("The destination must be a world card stack.");
    requireOwner(destination, user);
    const selected = data.ids.map(id => {
      const entry = placements.find(item => item.id === id);
      if (!entry || (entry.hidden && !user.isGM)) throw new Error("A selected canvas card is unavailable.");
      if (entry.locked && !user.isGM) throw new Error("This card is locked.");
      const card = resolveCard(entry.uuid);
      requireOwner(card.parent, user);
      if (card.parent.type === "deck" && card.drawn) throw new Error("This card has already been drawn.");
      return {entry, card};
    });
    for (const {entry, card} of selected) {
      const originalUuid = entry.uuid;
      const sameStack = card.parent === destination;
      if (!sameStack) {
        if (card.parent.type === "deck" && destination.type === "deck") {
          await moveDeckCard(card, destination, user);
        } else {
          const returningHome = card.origin === destination && !!destination.cards.get(card.id);
          const transferred = await card.pass(destination, {chatNotification: false, [INTERNAL_TRANSFER]: true});
          if (!transferred && !(returningHome && !destination.cards.get(card.id)?.drawn && !fromUuidSync(originalUuid))) {
            throw new Error("The card transfer was not completed.");
          }
        }
      }
      const original = fromUuidSync(originalUuid);
      const unavailable = !original || (original.parent?.type === "deck" && original.drawn);
      const replacement = destination.type === "deck" ? null : destination.cards.get(card.id)?.uuid;
      for (const currentScene of game.scenes) {
        const current = placementsFor(currentScene);
        let changed = false;
        const updated = [];
        for (const placement of current) {
          if (currentScene.id === scene.id && placement.id === entry.id) { changed = true; continue; }
          if (!sameStack && unavailable && placement.uuid === originalUuid) {
            changed = true;
            if (replacement) updated.push({...placement, uuid: replacement});
          } else updated.push(placement);
        }
        if (changed) await savePlacements(currentScene, updated);
      }
    }
    return;
  }
  if (action === "layout") {
    if (!user.isGM) throw new Error("Only a GM can lay out cards.");
    const from = game.cards.get(data.from);
    if (!from || from.pack) throw new Error("Choose a world source stack.");
    requireOwner(from, user);
    const triangle = data.shape === "triangle";
    const circle = data.shape === "circle";
    if (!["grid", "triangle", "circle"].includes(data.shape)) throw new Error("Unknown layout shape.");
    let rows;
    let columns;
    let count;
    if (data.count !== undefined) {
      count = finite(data.count, "card count");
      if (!Number.isInteger(count) || count < 1 || count > 250) throw new Error("Card count must be an integer between 1 and 250.");
      columns = triangle || circle ? 1 : finite(data.columns, "columns");
      if (!Number.isInteger(columns) || columns < 1 || columns > 50) throw new Error("Columns must be an integer between 1 and 50.");
      rows = triangle ? Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2) : Math.ceil(count / columns);
    } else {
      if (circle) throw new Error("A circle layout requires a card count.");
      rows = finite(data.rows, "rows");
      columns = finite(data.columns, "columns");
      if (![rows, columns].every(value => Number.isInteger(value) && value >= 1 && value <= 50)) {
        throw new Error("Layout dimensions must be integers between 1 and 50.");
      }
      count = triangle ? rows * (rows + 1) / 2 : rows * columns;
    }
    const placed = new Set(placements.map(entry => entry.uuid));
    const available = from.availableCards.filter(card => !placed.has(card.uuid))
      .sort((first, second) => first.sort - second.sort);
    if (available.length < count) throw new Error("Not enough unplaced cards for this layout.");
    if (count > 250) throw new Error("A layout is limited to 250 cards.");
    const width = (from.width || 2) * scene.grid.size;
    const height = (from.height || 3) * scene.grid.size;
    const bounds = scene.getDimensions().sceneRect;
    const spacing = data.spacing === undefined ? 10 : finite(data.spacing, "spacing");
    if (spacing < 0) throw new Error("Card spacing cannot be negative.");
    const direction = data.direction ?? "up";
    if (!["up", "down", "left", "right"].includes(direction)) throw new Error("Unknown triangle direction.");
    const points = [];
    if (circle) {
      const radius = count === 1 ? 0 : (Math.hypot(width, height) + spacing) / (2 * Math.sin(Math.PI / count));
      for (let index = 0; index < count; index++) {
        const angle = 2 * Math.PI * index / count;
        points.push({x: radius * Math.sin(angle), y: -radius * Math.cos(angle)});
      }
    } else {
      for (let row = 0; row < rows; row++) {
        const length = Math.min(triangle ? row + 1 : columns, count - points.length);
        for (let column = 0; column < length; column++) {
          const offset = column + (triangle ? (rows - length) / 2 : 0);
          let pointX = offset * (width + spacing);
          let pointY = row * (height + spacing);
          if (triangle && direction === "down") pointY = (rows - 1 - row) * (height + spacing);
          if (triangle && ["left", "right"].includes(direction)) {
            pointX = (direction === "left" ? row : rows - 1 - row) * (width + spacing);
            pointY = offset * (height + spacing);
          }
          points.push({x: pointX, y: pointY});
        }
      }
    }
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const x = data.offsetX !== undefined ? bounds.x + finite(data.offsetX, "offsetX") + width / 2
      : data.x !== undefined ? finite(data.x, "x") : (bounds.x + bounds.right - (circle ? 0 : minX + maxX)) / 2;
    const y = data.offsetY !== undefined ? bounds.y + finite(data.offsetY, "offsetY") + height / 2
      : data.y !== undefined ? finite(data.y, "y") : (bounds.y + bounds.bottom - (circle ? 0 : minY + maxY)) / 2;
    for (const point of points) { point.x += x; point.y += y; }
    const cards = available.slice(0, count);
    if (points.some((point, index) => {
      const angle = circle ? (cards[index].rotation ?? 0) * Math.PI / 180 : 0;
      const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
      const halfHeight = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
      return point.x - halfWidth < bounds.x || point.y - halfHeight < bounds.y
        || point.x + halfWidth > bounds.right || point.y + halfHeight > bounds.bottom;
    })) {
      throw new Error("This layout would extend beyond the scene. Reduce its size or change its position.");
    }
    const updateData = {};
    if (data.face !== undefined) {
      if (!["", "front", "back"].includes(data.face)) throw new Error("Unknown card face option.");
      if (data.face) updateData.face = data.face === "back" ? null : 0;
    } else updateData.face = data.faceDown ? null : 0;
    if (Object.hasOwn(updateData, "face")) {
      await from.updateEmbeddedDocuments("Card", cards.map(card => ({_id: card.id, ...updateData})));
    }
    for (const [index, point] of points.entries()) {
      await executeCardOperation("place", {sceneId: scene.id, uuid: cards[index].uuid, ...point}, user);
    }
    return;
  }
  let placement = placements.find(entry => entry.id === data.id);
  if (action === "place") {
    const card = resolveCard(data.uuid, {allowStack: true});
    requireOwner(card.parent ?? card, user);
    if (card.parent?.type === "deck" && card.drawn) throw new Error("This card has already been drawn.");
    placement = placements.find(entry => entry.uuid === card.uuid);
    if (placement) throw new Error("This card is already on this scene.");
    placement = {
      id: foundry.utils.randomID(), uuid: card.uuid,
      x: finite(data.x, "x"), y: finite(data.y, "y"),
      rotation: card.rotation ?? 0, sort: Math.max(0, ...placements.map(entry => entry.sort)) + 1,
      hidden: false, locked: false, faceDown: card.face === null
    };
    const allocated = await allocateRegion(scene, card, placement);
    placement.uuid = allocated.card.uuid;
    if (allocated.keep) placements.push(placement);
    await savePlacements(scene, placements);
    return placement.id;
  }
  if (!placement) throw new Error("The canvas card no longer exists.");
  const card = resolveCard(placement.uuid, {allowStack: true});
  const isStack = card.documentName === "Cards";
  requireOwner(card.parent ?? card, user);
  if (placement.locked && !user.isGM && action !== "unlock" && !(isStack && action === "draw")) throw new Error("This card is locked.");
  switch (action) {
    case "draw": {
      if (!isStack) throw new Error("Only card stacks can be drawn from.");
      const available = card.availableCards.toSorted((first, second) => first.sort - second.sort);
      const next = placement.faceDown ? available.at(-1) : available[0];
      if (!next) throw new Error("This stack has no available cards.");
      return executeCardOperation("place", {sceneId: scene.id, uuid: next.uuid,
        x: finite(data.x, "x"), y: finite(data.y, "y")}, user);
    }
    case "shuffle":
      if (!isStack || card.type === "hand") throw new Error("Only decks and piles can be shuffled on the canvas.");
      await card.shuffle({chatNotification: false});
      break;
    case "move": {
      placement.x = finite(data.x, "x");
      placement.y = finite(data.y, "y");
      const allocated = await allocateRegion(scene, card, placement);
      placement.uuid = allocated.card.uuid;
      if (!allocated.keep) placements = placements.filter(entry => entry !== placement);
      break;
    }
    case "rotate": placement.rotation = (placement.rotation + 90) % 360; break;
    case "elevation": placement.elevation = finite(data.elevation, "elevation"); break;
    case "flip":
      if (isStack) { placement.faceDown = !placement.faceDown; break; }
      if (!card.faces.length) throw new Error("This card has no faces.");
      await card.flip();
      placement.faceDown = card.face === null;
      break;
    case "hide":
      if (!user.isGM) throw new Error("Only a GM can hide a canvas card.");
      placement.hidden = !placement.hidden;
      break;
    case "lock": placement.locked = true; break;
    case "unlock": placement.locked = false; break;
    case "front": placement.sort = Math.max(0, ...placements.map(entry => entry.sort)) + 1; break;
    case "back": placement.sort = Math.min(0, ...placements.map(entry => entry.sort)) - 1; break;
    case "remove": placements = placements.filter(entry => entry !== placement); break;
    default: throw new Error("Unknown card operation.");
  }
  await savePlacements(scene, placements);
}

export function requestCardOperation(action, data = {}) {
  const request = async () => {
    if (game.user.isActiveGM) {
      const operation = authorityQueue.then(() => executeCardOperation(action, data));
      authorityQueue = operation.catch(() => {});
      return operation;
    }
    if (!game.users.activeGM) throw new Error("An active GM is required to manage canvas cards.");
    const id = foundry.utils.randomID();
    let timeout;
    const response = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The GM did not respond to the card request."));
      }, 20000);
      pending.set(id, {resolve, reject});
    });
    try {
      await game.user.setFlag(MODULE_ID, "cardRequest", {id, action, data: JSON.stringify(data)});
      return await response;
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  };
  const operation = requestQueue.then(request);
  requestQueue = operation.catch(() => {});
  return operation;
}

export function registerCardOperations() {
  const stackPrototype = foundry.documents.Cards.prototype;
  const originalPass = stackPrototype.pass;
  stackPrototype.pass = async function(destination, ids, options = {}) {
    const uuids = new Set(ids.map(id => `${this.uuid}.Card.${id}`));
    const hasPlacements = !options[INTERNAL_TRANSFER]
      && game.scenes.some(scene => placementsFor(scene).some(entry => uuids.has(entry.uuid)));
    if (hasPlacements && !game.users.activeGM) throw new Error("An active GM is required to transfer canvas cards.");
    const result = await originalPass.call(this, destination, ids, options);
    if (hasPlacements) {
      await requestCardOperation("rebind", {origin: this.id, destination: destination.id, ids});
    }
    return result;
  };
  const originalStackRecall = stackPrototype.recall;
  stackPrototype.recall = async function(...args) {
    const hasPlacements = game.scenes.some(scene => placementsFor(scene).some(entry => {
      const card = fromUuidSync(entry.uuid);
      return card?.parent === this || (this.type === "deck" && card?.source === this);
    }));
    if (hasPlacements && !game.users.activeGM) throw new Error("An active GM is required to recall canvas cards.");
    const result = await originalStackRecall.apply(this, args);
    if (game.scenes.some(scene => placementsFor(scene).some(entry => !fromUuidSync(entry.uuid)))) {
      await requestCardOperation("prune");
    }
    return result;
  };
  const cardPrototype = foundry.documents.Card.prototype;
  const originalRecall = cardPrototype.recall;
  cardPrototype.recall = async function(options = {}) {
    const hasPlacements = !options[INTERNAL_TRANSFER]
      && game.scenes.some(scene => placementsFor(scene).some(entry => entry.uuid === this.uuid));
    if (hasPlacements && !game.users.activeGM) throw new Error("An active GM is required to recall canvas cards.");
    const result = await originalRecall.call(this, options);
    if (hasPlacements) {
      await requestCardOperation("prune");
    }
    return result;
  };
  Hooks.on("updateUser", (user, changes, _options, userId) => {
    const responseChanged = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.cardResponse`);
    if (user.isSelf && responseChanged && game.users.get(userId)?.isGM) {
      const response = user.getFlag(MODULE_ID, "cardResponse");
      const waiter = pending.get(response.id);
      if (response.error) waiter?.reject(new Error(response.error));
      else waiter?.resolve(response.result);
    }
    const requestChanged = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.cardRequest`);
    if (!requestChanged || !game.user.isActiveGM || userId !== user.id) return;
    const request = foundry.utils.deepClone(user.getFlag(MODULE_ID, "cardRequest"));
    authorityQueue = authorityQueue.then(async () => {
      const reply = {id: request.id, result: null, error: null};
      try {
        reply.result = await executeCardOperation(request.action, JSON.parse(request.data), user) ?? null;
      } catch (error) {
        reply.error = error.message;
      }
      await user.setFlag(MODULE_ID, "cardResponse", reply);
    }).catch(reportError("Card request"));
  });
}