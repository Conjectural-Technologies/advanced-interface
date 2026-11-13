import {beforeEach, test} from "node:test";
import assert from "node:assert/strict";
import {cardSortOrder, executeCardOperation, placementsFor, requestCardOperation, registerCardOperations} from "../scripts/card-operations.mjs";
import {registerCards} from "../scripts/cards.mjs";

const MODULE_ID = "advanced-interface";

test("combined canvas ordering preserves selected card order", () => {
  const placements = [{id: "first", sort: 1}, {id: "second", sort: 2}, {id: "other", sort: 3}];
  const selected = new Set(["first", "second"]);
  assert.deepEqual(cardSortOrder(placements, selected), {action: "front", ids: ["first", "second"]});
  placements[0].sort = 4;
  placements[1].sort = 5;
  assert.deepEqual(cardSortOrder(placements, selected), {action: "back", ids: ["second", "first"]});
  assert.equal(cardSortOrder(placements, new Set(placements.map(entry => entry.id))), null);
});

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  some(predicate) { return [...this].some(predicate); }
}

class TestCard {
  constructor(id, parent) {
    this.id = id;
    this.parent = parent;
    this.face = 0;
    this.faces = [{}];
    this.sort = parent.cards.size;
  }
  get uuid() { return `${this.parent.uuid}.Card.${this.id}`; }
  get isHome() { return this.parent.type === "deck"; }
  get source() { return this.isHome ? this.parent : this.origin; }
  async flip() { this.face = this.face === null ? 0 : null; }
  async recall() {
    if (this.isHome) this.drawn = false;
    else {
      if (this.source?.cards.get(this.id)) this.source.cards.get(this.id).drawn = false;
      this.parent.cards.delete(this.id);
    }
    return this;
  }
  async pass(destination) {
    this.parent.cards.delete(this.id);
    this.parent = destination;
    destination.cards.set(this.id, this);
    return this;
  }
}

function stack(id, type = "deck", count = 0) {
  const document = {
    id, uuid: `Cards.${id}`, documentName: "Cards", type, width: 2, height: 3, cards: new Map(),
    testUserPermission: user => user.isGM || user.id === "owner",
    get availableCards() { return [...this.cards.values()].filter(card => !card.drawn); },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) Object.assign(this.cards.get(update._id), update);
    },
    async draw(from, count, {updateData = {}} = {}) {
      const selected = from.availableCards.slice(0, count);
      const drawn = [];
      for (const original of selected) {
        original.drawn = true;
        const card = new TestCard(original.id, this);
        card.origin = from;
        card.face = original.face;
        Object.assign(card, updateData);
        this.cards.set(card.id, card);
        drawn.push(card);
      }
      return drawn;
    }
  };
  for (let index = 0; index < count; index++) document.cards.set(`card${index}`, new TestCard(`card${index}`, document));
  return document;
}

let scene;
let deck;
let pile;
let sequence;
beforeEach(() => {
  sequence = 0;
  scene = {
    id: "scene", active: true, grid: {size: 100}, regions: [], flags: {},
    getFlag: (_scope, key) => scene.flags[key],
    setFlag: async (_scope, key, value) => { scene.flags[key] = structuredClone(value); },
    getDimensions: () => ({sceneRect: {x: 0, y: 0, right: 2000, bottom: 1500}})
  };
  deck = stack("deck", "deck", 12);
  pile = stack("pile", "pile");
  globalThis.CONST = {SORT_INTEGER_DENSITY: 100000};
  globalThis.foundry = {documents: {Card: TestCard}, utils: {
    deepClone: structuredClone, randomID: () => `id${sequence++}`,
    getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object)
  }};
  globalThis.game = {
    scenes: new Collection([[scene.id, scene]]), cards: new Collection([[deck.id, deck], [pile.id, pile]]),
    user: {id: "gm", isGM: true, isActiveGM: true, viewedScene: scene.id}
  };
  globalThis.fromUuidSync = uuid => {
    const [, stackId, , cardId] = uuid.split(".");
    return cardId ? game.cards.get(stackId)?.cards.get(cardId) : game.cards.get(stackId);
  };
});

test("placement rejects invalid coordinates before writing scene data", async () => {
  await assert.rejects(executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: NaN, y: 200}));
  assert.deepEqual(placementsFor(scene), []);
});

test("placement rejects duplicate cards", async () => {
  const data = {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200};
  await executeCardOperation("place", data);
  await assert.rejects(executeCardOperation("place", data), /already on/);
  assert.equal(placementsFor(scene).length, 1);
});

test("combined canvas ordering moves selected cards together to front and back", async () => {
  const ids = [];
  for (const cardId of ["card0", "card1", "card2"]) {
    ids.push(await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get(cardId).uuid, x: 200, y: 200}));
  }
  const selected = new Set(ids.slice(0, 2));
  for (const expected of [[ids[2], ids[0], ids[1]], ids]) {
    const order = cardSortOrder(placementsFor(scene), selected);
    for (const id of order.ids) await executeCardOperation(order.action, {sceneId: scene.id, id});
    assert.deepEqual(placementsFor(scene).sort((first, second) => first.sort - second.sort).map(entry => entry.id), expected);
  }
});

test("non-owners cannot place or scry cards", async () => {
  const user = {id: "stranger", isGM: false, viewedScene: scene.id};
  await assert.rejects(executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200}, user), /own/);
  await assert.rejects(executeCardOperation("scryOrder", {stackId: deck.id}, user), /own/);
});

test("locked cards reject player moves until unlocked", async () => {
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200});
  await executeCardOperation("lock", {sceneId: scene.id, id});
  const user = {id: "owner", isGM: false, viewedScene: scene.id};
  await assert.rejects(executeCardOperation("move", {sceneId: scene.id, id, x: 400, y: 400}, user), /locked/);
  await executeCardOperation("unlock", {sceneId: scene.id, id}, user);
  await executeCardOperation("move", {sceneId: scene.id, id, x: 400, y: 400}, user);
  assert.equal(placementsFor(scene)[0].x, 400);
});

test("Region allocation uses document geometry and can remove canvas cards", async () => {
  scene.regions = [{
    testPoint: point => point.elevation === 0,
    behaviors: {find: () => ({system: {targetStack: pile, keepCanvasCard: false}})}
  }];
  await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200});
  assert.equal(pile.cards.size, 1);
  assert.deepEqual(placementsFor(scene), []);
});

test("layouts validate scene bounds before placing source cards", async () => {
  await assert.rejects(executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 2, columns: 2, x: 0, y: 0
  }), /beyond/);
  assert.equal(pile.cards.size, 0);
  assert.equal(deck.availableCards.length, 12);
});

test("right-facing triangle lays out the expected number and direction", async () => {
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "triangle", direction: "right", rows: 2, columns: 2, x: 300, y: 300
  });
  const placements = placementsFor(scene);
  assert.equal(placements.length, 3);
  assert.ok(placements[0].x > placements[1].x);
  assert.equal(placements[1].x, placements[2].x);
  assert.equal(pile.cards.size, 0);
  assert.equal(deck.availableCards.length, 12);
  assert.ok(placements.every(entry => entry.uuid.startsWith(deck.uuid + ".Card.")));
});

test("scrying rejects stale or incomplete deck orders", async () => {
  const expected = deck.availableCards.map(card => card.id);
  await assert.rejects(executeCardOperation("scryOrder", {stackId: deck.id, expected: [], order: expected}), /changed/);
  await assert.rejects(executeCardOperation("scryOrder", {stackId: deck.id, expected, order: expected.slice(1)}), /Invalid/);
  const order = expected.toReversed();
  await executeCardOperation("scryOrder", {stackId: deck.id, expected, order});
  assert.ok(deck.cards.get(order[0]).sort < deck.cards.get(order.at(-1)).sort);
});

test("native transfer rebind preserves placement identity and position", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 300});
  const [drawn] = await pile.draw(deck, 1);
  await executeCardOperation("rebind", {origin: deck.id, destination: pile.id, ids: [card.id]});
  assert.deepEqual(placementsFor(scene).map(entry => ({id: entry.id, x: entry.x, y: entry.y, uuid: entry.uuid})), [
    {id, x: 200, y: 300, uuid: drawn.uuid}
  ]);
});

test("concurrent requests preserve both placements", async () => {
  await Promise.all(["card0", "card1"].map(id => requestCardOperation("place", {
    sceneId: scene.id, uuid: deck.cards.get(id).uuid, x: 200, y: 300
  })));
  assert.equal(placementsFor(scene).length, 2);
});

test("registration preserves the reset lifecycle and rejects unauthorized requests and no-GM transfers", async () => {
  class Model {
    reset() { return this; }
  }
  class Stack extends Model {
    async pass() { this.transferred = true; return []; }
    async recall() { return this; }
  }
  class Card extends TestCard {
    async recall() { return this; }
  }
  const handlers = new Map();
  globalThis.Hooks = {on: (name, handler) => handlers.set(name, handler)};
  foundry.documents.Cards = Stack;
  foundry.documents.Card = Card;
  const reset = Stack.prototype.reset;
  registerCardOperations();
  assert.equal(Stack.prototype.reset, reset);
  assert.equal(Object.hasOwn(Stack.prototype, "reset"), false);
  let replies = 0;
  handlers.get("updateUser")({id: "owner", setFlag: () => { replies++; }}, {
    flags: {[MODULE_ID]: {cardRequest: {id: "spoof", action: "clear", data: {sceneId: scene.id}}}}
  }, {}, "different-user");
  assert.equal(replies, 0);
  const origin = new Stack();
  origin.uuid = "Cards.deck";
  scene.flags.cardPlacements = [{uuid: "Cards.deck.Card.card0"}];
  game.users = {activeGM: null};
  await assert.rejects(origin.pass({}, ["card0"]), /active GM/);
  assert.equal(origin.transferred, undefined);
});

test("player requests read complete flags when User updates contain only diffs", async () => {
  class Stack {
    async pass() { return []; }
    async recall() { return this; }
  }
  class Card extends TestCard {
    async recall() { return this; }
  }
  const handlers = new Map();
  globalThis.Hooks = {on: (name, handler) => handlers.set(name, handler)};
  foundry.documents.Cards = Stack;
  foundry.documents.Card = Card;
  deck.cards.set("card0", new Card("card0", deck));
  registerCardOperations();
  let resolveReply;
  const response = new Promise(resolve => { resolveReply = resolve; });
  const user = {
    id: "owner", isGM: false, viewedScene: scene.id,
    getFlag: () => ({id: "request", action: "place", data: JSON.stringify({
      sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 300
    })}),
    setFlag: async (_scope, _key, reply) => { resolveReply(reply); }
  };
  handlers.get("updateUser")(user, {
    flags: {[MODULE_ID]: {cardRequest: {id: "request"}}}
  }, {}, user.id);
  const reply = await response;
  assert.equal(reply.error, null);
  assert.equal(reply.id, "request");
  assert.equal(placementsFor(scene).length, 1);
});

test("layout offsets begin at the scene edge and preserve faces when requested", async () => {
  deck.cards.get("card0").face = null;
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 1, columns: 2,
    offsetX: 0, offsetY: 0, spacing: 100, face: ""
  });
  const placements = placementsFor(scene);
  assert.equal(placements[0].x, 100);
  assert.equal(placements[0].y, 150);
  assert.equal(placements[1].x - placements[0].x, 300);
  assert.equal(deck.cards.get("card0").face, null);
  assert.equal(placements[0].faceDown, true);
  assert.equal(deck.cards.get("card1").face, 0);
});

test("grid layout defaults to centering the whole layout within the scene", async () => {
  scene.getDimensions = () => ({sceneRect: {x: 400, y: 600, right: 2400, bottom: 2100}});
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 2, columns: 3, spacing: 100, face: ""
  });
  const placements = placementsFor(scene);
  assert.equal((Math.min(...placements.map(entry => entry.x)) + Math.max(...placements.map(entry => entry.x))) / 2, 1400);
  assert.equal((Math.min(...placements.map(entry => entry.y)) + Math.max(...placements.map(entry => entry.y))) / 2, 1350);
  assert.equal(placements[1].x - placements[0].x, 300);
  assert.equal(placements[3].y - placements[0].y, 400);
});

for (const direction of ["up", "down", "left", "right"]) {
  test(`triangle layout centers its entire footprint facing ${direction}`, async () => {
    await executeCardOperation("layout", {
      sceneId: scene.id, from: deck.id, shape: "triangle", direction, rows: 3, columns: 3, spacing: 100, face: ""
    });
    const placements = placementsFor(scene);
    assert.equal(placements.length, 6);
    assert.equal((Math.min(...placements.map(entry => entry.x)) + Math.max(...placements.map(entry => entry.x))) / 2, 1000);
    assert.equal((Math.min(...placements.map(entry => entry.y)) + Math.max(...placements.map(entry => entry.y))) / 2, 750);
  });
}

test("layout First Face uses face zero rather than the second face", async () => {
  deck.cards.get("card0").face = null;
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 1, columns: 1,
    offsetX: 0, offsetY: 0, face: "front"
  });
  assert.equal(deck.cards.get("card0").face, 0);
});

test("layouts skip source cards already placed on the scene", async () => {
  const first = deck.cards.get("card0");
  await executeCardOperation("place", {sceneId: scene.id, uuid: first.uuid, x: 800, y: 800});
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 1, columns: 2, offsetX: 0, offsetY: 0, face: ""
  });
  assert.deepEqual(placementsFor(scene).map(entry => entry.uuid), [first.uuid,
    deck.cards.get("card1").uuid, deck.cards.get("card2").uuid]);
  assert.equal(placementsFor(scene)[0].x, 800);
});

test("layouts use the same scene pile allocation as dragged cards", async () => {
  scene.flags.canvasPile = pile.id;
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", rows: 1, columns: 2, offsetX: 0, offsetY: 0, face: ""
  });
  assert.equal(pile.cards.size, 2);
  assert.ok(placementsFor(scene).every(entry => entry.uuid.startsWith(pile.uuid + ".Card.")));
});

test("recalling from a deck removes its dealt copy and canvas placement", async () => {
  const [copy] = await pile.draw(deck, 1);
  await executeCardOperation("place", {sceneId: scene.id, uuid: copy.uuid, x: 200, y: 200});
  await executeCardOperation("recall", {uuid: deck.cards.get("card0").uuid});
  assert.equal(pile.cards.has("card0"), false);
  assert.equal(deck.cards.get("card0").drawn, false);
  assert.equal(placementsFor(scene).length, 0);
});

test("canvas stacks stay intact, flip independently, and draw cards into the scene pile", async () => {
  scene.flags.canvasPile = pile.id;
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.uuid, x: 200, y: 200});
  assert.equal(placementsFor(scene)[0].uuid, deck.uuid);
  assert.equal(pile.cards.size, 0);
  await executeCardOperation("flip", {sceneId: scene.id, id});
  assert.equal(placementsFor(scene)[0].faceDown, true);
  await executeCardOperation("lock", {sceneId: scene.id, id});
  await executeCardOperation("draw", {sceneId: scene.id, id, x: 500, y: 500});
  assert.equal(pile.cards.has("card11"), true);
  assert.equal(placementsFor(scene).length, 2);
  assert.equal(placementsFor(scene)[0].uuid, deck.uuid);
});

test("canvas elevation accepts finite values and rejects invalid input", async () => {
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200});
  await executeCardOperation("elevation", {sceneId: scene.id, id, elevation: 5});
  assert.equal(placementsFor(scene)[0].elevation, 5);
  await assert.rejects(executeCardOperation("elevation", {sceneId: scene.id, id, elevation: Infinity}), /Invalid/);
  assert.equal(placementsFor(scene)[0].elevation, 5);
});

test("card count determines grid rows and centers the actual footprint", async () => {
  await executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "grid", count: 5, columns: 3, spacing: 100, face: ""
  });
  const placements = placementsFor(scene);
  assert.equal(placements.length, 5);
  assert.deepEqual(placements.map(entry => entry.x), [700, 1000, 1300, 700, 1000]);
  assert.deepEqual(placements.map(entry => entry.y), [550, 550, 550, 950, 950]);
});

for (const direction of ["up", "down", "left", "right"]) {
  test(`incomplete triangle centers its footprint facing ${direction}`, async () => {
    await executeCardOperation("layout", {
      sceneId: scene.id, from: deck.id, shape: "triangle", direction, count: 4, spacing: 100, face: ""
    });
    const placements = placementsFor(scene);
    assert.equal(placements.length, 4);
    assert.equal((Math.min(...placements.map(entry => entry.x)) + Math.max(...placements.map(entry => entry.x))) / 2, 1000);
    assert.equal((Math.min(...placements.map(entry => entry.y)) + Math.max(...placements.map(entry => entry.y))) / 2, 750);
  });
}

test("layout rejects invalid card counts before changing cards", async () => {
  for (const count of [0, -1, 1.5, 251, NaN]) {
    await assert.rejects(executeCardOperation("layout", {sceneId: scene.id, from: deck.id, shape: "triangle", count}));
  }
  assert.deepEqual(placementsFor(scene), []);
});

for (const count of [1, 2, 5, 6]) {
  test(`circle layout evenly spaces ${count} cards around the scene center`, async () => {
    scene.getDimensions = () => ({sceneRect: {x: 400, y: 600, right: 4400, bottom: 4600}});
    await executeCardOperation("layout", {sceneId: scene.id, from: deck.id, shape: "circle", count, spacing: 100, face: ""});
    const placements = placementsFor(scene);
    const center = {x: 2400, y: 2600};
    const radius = count === 1 ? 0 : (Math.hypot(200, 300) + 100) / (2 * Math.sin(Math.PI / count));
    assert.equal(placements.length, count);
    assert.ok(Math.abs(placements[0].x - center.x) < 1e-8);
    assert.ok(Math.abs(placements[0].y - (center.y - radius)) < 1e-8);
    for (const [index, placement] of placements.entries()) {
      const angle = 2 * Math.PI * index / count;
      assert.ok(Math.abs(placement.x - (center.x + radius * Math.sin(angle))) < 1e-8);
      assert.ok(Math.abs(placement.y - (center.y - radius * Math.cos(angle))) < 1e-8);
      assert.equal(placement.rotation, 0);
    }
    assert.equal(pile.cards.size, 0);
  });
}

test("circle layout rejects an oversized footprint before changing cards", async () => {
  await assert.rejects(executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "circle", count: 10, spacing: 100, face: "front"
  }), /beyond/);
  assert.deepEqual(placementsFor(scene), []);
  assert.equal(deck.availableCards.length, 12);
});

test("circle bounds account for existing card rotation", async () => {
  scene.getDimensions = () => ({sceneRect: {x: 0, y: 0, right: 250, bottom: 400}});
  deck.cards.get("card0").rotation = 90;
  await assert.rejects(executeCardOperation("layout", {
    sceneId: scene.id, from: deck.id, shape: "circle", count: 1, face: "front"
  }), /beyond/);
  assert.deepEqual(placementsFor(scene), []);
});

test("canvas card transfer moves the card into a canvas stack and removes its placement", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  const targetId = await executeCardOperation("place", {sceneId: scene.id, uuid: pile.uuid, x: 600, y: 600});
  await executeCardOperation("transfer", {sceneId: scene.id, ids: [id], targetId});
  assert.equal(pile.cards.get("card0"), card);
  assert.deepEqual(placementsFor(scene).map(entry => entry.id), [targetId]);
});

test("canvas transfer into its own stack removes only the canvas placement", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  const targetId = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.uuid, x: 600, y: 600});
  await executeCardOperation("transfer", {sceneId: scene.id, ids: [id], targetId});
  assert.equal(deck.cards.get("card0"), card);
  assert.deepEqual(placementsFor(scene).map(entry => entry.id), [targetId]);
});

test("canvas transfer checks destination ownership and locked selections before moving cards", async () => {
  const first = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card0").uuid, x: 200, y: 200});
  const second = await executeCardOperation("place", {sceneId: scene.id, uuid: deck.cards.get("card1").uuid, x: 300, y: 300});
  const targetId = await executeCardOperation("place", {sceneId: scene.id, uuid: pile.uuid, x: 600, y: 600});
  await executeCardOperation("lock", {sceneId: scene.id, id: second});
  const owner = {id: "owner", isGM: false, viewedScene: scene.id};
  await assert.rejects(executeCardOperation("transfer", {sceneId: scene.id, ids: [first, second], targetId}, owner), /locked/);
  pile.testUserPermission = () => false;
  await assert.rejects(executeCardOperation("transfer", {sceneId: scene.id, ids: [first], targetId}, owner), /own/);
  assert.equal(pile.cards.size, 0);
  assert.equal(placementsFor(scene).length, 3);
});

test("canvas cards can transfer to a world stack without a canvas stack placement", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  await executeCardOperation("transfer", {sceneId: scene.id, ids: [id], destinationId: pile.id});
  assert.equal(pile.cards.get("card0"), card);
  assert.deepEqual(placementsFor(scene), []);
});

test("cancelled native transfers leave the card on the canvas", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  card.pass = async () => undefined;
  await assert.rejects(executeCardOperation("transfer", {sceneId: scene.id, ids: [id], destinationId: pile.id}), /not completed/);
  assert.equal(deck.cards.get("card0"), card);
  assert.equal(placementsFor(scene)[0].id, id);
});

test("canvas transfer moves multiple cards and rebinds their placements on other scenes", async () => {
  const first = deck.cards.get("card0");
  const second = deck.cards.get("card1");
  const firstId = await executeCardOperation("place", {sceneId: scene.id, uuid: first.uuid, x: 200, y: 200});
  const secondId = await executeCardOperation("place", {sceneId: scene.id, uuid: second.uuid, x: 300, y: 300});
  const other = {
    id: "other", flags: {cardPlacements: [{id: "other-card", uuid: first.uuid}]},
    getFlag: (_scope, key) => other.flags[key],
    setFlag: async (_scope, key, value) => { other.flags[key] = structuredClone(value); }
  };
  game.scenes.set(other.id, other);
  await executeCardOperation("transfer", {sceneId: scene.id, ids: [firstId, secondId], destinationId: pile.id});
  assert.equal(pile.cards.size, 2);
  assert.deepEqual(placementsFor(scene), []);
  assert.equal(placementsFor(other)[0].uuid, first.uuid);
});

test("canvas transfer rejects hidden destinations and duplicate selections", async () => {
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  const targetId = await executeCardOperation("place", {sceneId: scene.id, uuid: pile.uuid, x: 600, y: 600});
  await executeCardOperation("hide", {sceneId: scene.id, id: targetId});
  const owner = {id: "owner", isGM: false, viewedScene: scene.id};
  await assert.rejects(executeCardOperation("transfer", {sceneId: scene.id, ids: [id], targetId}, owner), /not available/);
  await assert.rejects(executeCardOperation("transfer", {sceneId: scene.id, ids: [id, id], destinationId: pile.id}), /Invalid/);
  assert.equal(pile.cards.size, 0);
  assert.equal(placementsFor(scene).length, 2);
});

test("moving a deck card creates its destination copy before deleting the source and rebinds placements", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  const originalUuid = card.uuid;
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: originalUuid, x: 200, y: 200});
  card.pass = async target => {
    const copy = new TestCard(card.id, target);
    target.cards.set(card.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async (_type, ids) => {
    assert.ok(destination.cards.has(card.id));
    for (const id of ids) deck.cards.delete(id);
  };
  const result = await executeCardOperation("moveDeckCard", {uuid: originalUuid, destinationId: destination.id});
  assert.equal(deck.cards.has(card.id), false);
  assert.equal(result, destination.cards.get(card.id).uuid);
  assert.deepEqual(placementsFor(scene).map(entry => ({id: entry.id, uuid: entry.uuid})), [{id, uuid: result}]);
});

test("moving a deck card with a colliding ID preserves both cards and rebinds placements", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  const existing = new TestCard(card.id, destination);
  destination.cards.set(existing.id, existing);
  const originalUuid = card.uuid;
  const placementId = await executeCardOperation("place", {sceneId: scene.id, uuid: originalUuid, x: 200, y: 200});
  card.pass = async (target, {updateData} = {}) => {
    const copy = new TestCard(updateData?._id ?? card.id, target);
    target.cards.set(copy.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) deck.cards.delete(id); };
  const result = await executeCardOperation("moveDeckCard", {uuid: originalUuid, destinationId: destination.id});
  const moved = fromUuidSync(result);
  assert.equal(deck.cards.has(card.id), false);
  assert.equal(destination.cards.get(card.id), existing);
  assert.ok(moved);
  assert.notEqual(moved.id, card.id);
  assert.deepEqual(placementsFor(scene).map(entry => ({id: entry.id, uuid: entry.uuid})), [{id: placementId, uuid: result}]);
});

test("failed deck move with a colliding ID preserves the existing destination card", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  const existing = new TestCard(card.id, destination);
  destination.cards.set(existing.id, existing);
  card.pass = async (target, {updateData} = {}) => {
    const copy = new TestCard(updateData?._id ?? card.id, target);
    target.cards.set(copy.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async () => { throw new Error("Deletion denied"); };
  destination.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) destination.cards.delete(id); };
  await assert.rejects(executeCardOperation("moveDeckCard", {uuid: card.uuid, destinationId: destination.id}), /Deletion denied/);
  assert.equal(deck.cards.get(card.id), card);
  assert.equal(destination.cards.get(existing.id), existing);
  assert.equal(destination.cards.size, 1);
});

test("deck moves reject drawn cards and roll back the copy if source deletion fails", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  card.drawn = true;
  await assert.rejects(executeCardOperation("moveDeckCard", {uuid: card.uuid, destinationId: destination.id}), /drawn/);
  card.drawn = false;
  card.pass = async target => {
    const copy = new TestCard(card.id, target);
    target.cards.set(card.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async () => { throw new Error("Deletion denied"); };
  destination.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) destination.cards.delete(id); };
  await assert.rejects(executeCardOperation("moveDeckCard", {uuid: card.uuid, destinationId: destination.id}), /Deletion denied/);
  assert.equal(deck.cards.get(card.id), card);
  assert.equal(destination.cards.size, 0);
});

test("canvas transfer between decks moves the original card into the destination", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  const id = await executeCardOperation("place", {sceneId: scene.id, uuid: card.uuid, x: 200, y: 200});
  const targetId = await executeCardOperation("place", {sceneId: scene.id, uuid: destination.uuid, x: 600, y: 600});
  card.pass = async target => {
    const copy = new TestCard(card.id, target);
    target.cards.set(card.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) deck.cards.delete(id); };
  await executeCardOperation("transfer", {sceneId: scene.id, ids: [id], targetId});
  assert.equal(deck.cards.has(card.id), false);
  assert.ok(destination.cards.has(card.id));
  assert.deepEqual(placementsFor(scene).map(entry => entry.id), [targetId]);
});

test("deck sheet drag retains the Transfer key state after native dragging clears it", async () => {
  const destination = stack("other-deck", "deck");
  game.cards.set(destination.id, destination);
  const card = deck.cards.get("card0");
  card.pass = async target => {
    const copy = new TestCard(card.id, target);
    target.cards.set(card.id, copy);
    return copy;
  };
  deck.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) deck.cards.delete(id); };
  let held = true;
  let DeckSheet;
  let nativeDrops = 0;
  class BaseSheet {
    static PARTS = {};
    constructor(document) { this.document = document; this.isEditable = true; }
    _onDragStart(event) { event.dataTransfer.setData("text/plain", JSON.stringify({type: "Card", uuid: event.uuid})); }
    _onDrop() { nativeDrops++; }
  }
  game.settings = {register() {}};
  game.modules = new Map([
    [MODULE_ID, {api: {}}],
    ["advanced-drag-and-drop", {active: true, api: {isTransferHeld: () => held}}]
  ]);
  globalThis.Hooks = {on() {}};
  foundry.documents.Cards = class {};
  foundry.documents.Card.implementation = {fromDropData: async data => fromUuidSync(data.uuid)};
  foundry.applications = {
    sheets: {CardDeckConfig: BaseSheet, CardHandConfig: BaseSheet, CardPileConfig: BaseSheet, CardConfig: BaseSheet},
    apps: {DocumentSheetConfig: {registerSheet: (_document, _module, Sheet, options) => {
      if (options.types?.includes("deck")) DeckSheet = Sheet;
    }}},
    ux: {TextEditor: {implementation: {getDragEventData: event => JSON.parse(event.dataTransfer.getData("text/plain"))}}}
  };
  registerCards();
  const sourceSheet = new DeckSheet(deck);
  const destinationSheet = new DeckSheet(destination);
  const values = new Map();
  const event = {uuid: card.uuid, dataTransfer: {setData: (key, value) => values.set(key, value),
    getData: key => values.get(key) ?? ""}};
  sourceSheet._onDragStart(event);
  held = false;
  await destinationSheet._onDrop(event);
  assert.equal(deck.cards.has(card.id), false);
  assert.equal(destination.cards.has(card.id), true);
  assert.equal(nativeDrops, 0);
  const unmodified = {uuid: deck.cards.get("card1").uuid, dataTransfer: {
    setData: (key, value) => values.set(key, value), getData: key => values.get(key) ?? ""
  }};
  values.clear();
  sourceSheet._onDragStart(unmodified);
  await destinationSheet._onDrop(unmodified);
  assert.equal(nativeDrops, 1);
});