import {MODULE_ID} from "./helper.mjs";
const FLAG_NAME = "artworkRotationOffset";

function addArtworkRotationOffsetField(application, html) {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.querySelector(`[name="flags.${MODULE_ID}.${FLAG_NAME}"]`)) return;

    const rotationInput = root.querySelector('[name="rotation"]');
    const rotationGroup = rotationInput?.closest(".form-group");
    const lockRotationInput = root.querySelector('[name="lockRotation"]');
    const lockRotationGroup = lockRotationInput?.closest(".form-group");
    if (!rotationGroup || !lockRotationGroup) return;

    const offset = application.document?.getFlag(MODULE_ID, FLAG_NAME) ?? 0;
    const field = rotationGroup.cloneNode(true);
    const label = field.querySelector("label");
    const input = field.querySelector('[name="rotation"]');
    if (!label || !input) return;

    const labelText = Array.from(label.childNodes).find(node => node.nodeType === 3 && node.textContent.trim());
    if (labelText) labelText.textContent = "Offset Artwork Rotation ";
    else label.prepend("Offset Artwork Rotation ");
    input.name = `flags.${MODULE_ID}.${FLAG_NAME}`;
    input.value = offset;
    input.removeAttribute("min");
    input.removeAttribute("max");
    const hint = field.querySelector(".hint") ?? document.createElement("p");
    hint.classList.add("hint");
    hint.textContent = "Rotate the token artwork independently of its facing direction.";
    if (!hint.parentElement) field.append(hint);
    lockRotationGroup.after(field);
}

function applyArtworkRotationOffset(token) {
    if (!token.mesh) return;

    const offset = Number(token.document.getFlag(MODULE_ID, FLAG_NAME)) || 0;
    const tokenRotation = token.document.lockRotation ? 0 : token.document.rotation;
    token.mesh.angle = tokenRotation + offset;
}

Hooks.on("renderTokenConfig", addArtworkRotationOffsetField);
Hooks.on("renderPrototypeTokenConfig", addArtworkRotationOffsetField);
Hooks.on("refreshToken", applyArtworkRotationOffset);