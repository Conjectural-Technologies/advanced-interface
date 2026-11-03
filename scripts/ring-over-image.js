import {MODULE_ID} from "./helper.mjs";

const FLAG_NAME = "ringOverImage";
// Where the inner black circle of every ring starts, as a fraction of the ring radius (the steel ring's color band).
const IMAGE_RADIUS = 0.666;

// The ring mesh draws the token image over the ring. For "Ring Above Image" tokens the mesh keeps a transparent
// texture of the same size, and the real image is redrawn by a circle-masked child, which renders above the ring.
const blankTextures = new Map();
const pulsingSprites = new Set();

// The shader's spectral pulse (INVISIBILITY ring effect) is reproduced here, since the overlay bypasses the shader.
const GREY = [0.299, 0.587, 0.114];
const SPECTRAL_MATRIX = [
    ...GREY.map(w => w * 0.5), 0, 0,
    ...GREY, 0, 0,
    ...GREY, 0, 0,
    0, 0, 0, 1, 0
];

function isRingOverImage(document) {
    return !!document?.getFlag(MODULE_ID, FLAG_NAME);
}

function getBlankTexture({width, height}) {
    const key = `${width}x${height}`;
    if (!blankTextures.has(key)) blankTextures.set(key, PIXI.RenderTexture.create({width, height}));
    return blankTextures.get(key);
}

function isBlankTexture(texture) {
    return texture === blankTextures.get(`${texture.width}x${texture.height}`);
}

function createOverlay(mesh) {
    const holder = new PIXI.Container();
    const sprite = new PIXI.Sprite();
    const mask = new PIXI.Graphics();
    holder.eventMode = "none";
    holder.addChild(sprite, mask);
    sprite.mask = mask;
    mesh.addChild(holder);
    return mesh._ringOverImage = {holder, sprite, mask, spectralFilter: null, shape: null};
}

function removeOverlay(mesh) {
    const overlay = mesh._ringOverImage;
    if (!overlay) return;
    mesh.texture = overlay.sprite.texture;
    pulsingSprites.delete(overlay.sprite);
    mesh.removeChild(overlay.holder);
    overlay.holder.destroy({children: true});
    mesh._ringOverImage = null;
}

function pulseSprites() {
    const time = canvas.app.ticker.lastTime / 1000;
    const alpha = 0.55 + (Math.cos(time * 2) + 1) * 0.125;
    for (const sprite of pulsingSprites) sprite.alpha = alpha;
}

function syncSpectralPulse(overlay, effects) {
    const {sprite} = overlay;
    if (!(effects & CONFIG.Token.ring.ringClass.effects.INVISIBILITY)) {
        pulsingSprites.delete(sprite);
        sprite.filters = null;
        sprite.alpha = 1;
        return;
    }
    overlay.spectralFilter ??= Object.assign(new PIXI.ColorMatrixFilter(), {matrix: SPECTRAL_MATRIX});
    sprite.filters = [overlay.spectralFilter];
    pulsingSprites.add(sprite);
}

function syncRingOverImage(token) {
    const mesh = token.mesh;
    if (!mesh || mesh.destroyed) return;
    if (!token.hasDynamicRing || !isRingOverImage(token.document)) return removeOverlay(mesh);

    const overlay = mesh._ringOverImage ?? createOverlay(mesh);
    const {sprite, mask} = overlay;
    if (!isBlankTexture(mesh.texture)) {
        sprite.texture = mesh.texture;
        mesh.texture = getBlankTexture(sprite.texture);
    }
    sprite.anchor.copyFrom(mesh.anchor);
    sprite.tint = mesh.tint;
    // The shader samples the image at 1 / textureScaleAdjustment of the quad, which this sprite has to match.
    sprite.scale.set(1 / token.ring.textureScaleAdjustment);
    syncSpectralPulse(overlay, token.ring.effects);

    const {width, height} = sprite.texture;
    const radius = IMAGE_RADIUS * (width / 2 + mesh.paddingX) / token.ring.scaleCorrection;
    const x = (0.5 - mesh.anchor.x) * width;
    const y = (0.5 - mesh.anchor.y) * height;
    const shape = `${radius}|${x}|${y}`;
    if (overlay.shape === shape) return;
    overlay.shape = shape;
    mask.clear().beginFill(0xFFFFFF).drawCircle(x, y, radius).endFill();
}

function addRingOverImageField(application, html) {
    const root = html instanceof HTMLElement ? html : html[0];
    const name = `flags.${MODULE_ID}.${FLAG_NAME}`;
    if (!root || root.querySelector(`[name="${name}"]`)) return;

    const enabledGroup = root.querySelector('[name="ring.enabled"]')?.closest(".form-group");
    if (!enabledGroup) return;

    const label = document.createElement("label");
    label.textContent = "Ring Above Image";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.checked = isRingOverImage(application.document ?? application.token);
    const fields = document.createElement("div");
    fields.className = "form-fields";
    fields.append(input);
    const field = document.createElement("div");
    field.className = "form-group";
    field.append(label, fields);
    enabledGroup.after(field);
}

Hooks.once("ready", () => canvas.app.ticker.add(pulseSprites));
Hooks.on("refreshToken", syncRingOverImage);
Hooks.on("renderTokenConfig", addRingOverImageField);
Hooks.on("renderPrototypeTokenConfig", addRingOverImageField);
Hooks.on("updateToken", (document, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_NAME}`)) return;
    document.object?.renderFlags.set({refreshMesh: true});
});