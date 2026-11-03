import {getHighlightColor, MODULE_ID} from "./helper.mjs";

const outlines = new WeakMap();
const HIGHLIGHT_THICKNESS = 12;
const BAR_HEIGHT = 16;
const BAR_GAP = 4;
const BAR_KEYS = ["bar1", "bar2"];

// document.bar1/bar2 are derived once and stay empty if the actor data wasn't ready then, so resolve them live.
function getBarData(token, key) {
  return token.document.getBarAttribute(key);
}

function getVisibleBars(token) {
  return BAR_KEYS.filter(key => getBarData(token, key)?.max);
}

function getVisibleBarCount(token) {
  return getVisibleBars(token).length;
}

// Canvas units per HUD CSS pixel, accounting for HUD scaling.
function getHUDUnit() {
  const element = canvas.tokens?.hud?.element;
  if ( element?.isConnected && element.offsetWidth ) {
    return element.getBoundingClientRect().width / element.offsetWidth / canvas.stage.scale.x;
  }
  const scale = canvas.dimensions.uiScale;
  return game.settings.get(MODULE_ID, "fixedHUDSize") ? Math.max(scale, 1 / canvas.stage.scale.x) : scale;
}

export function getTokenBarMetrics(token) {
  const {width, height} = token.document.getSize();
  const scale = canvas.dimensions.uiScale;
  const outerRadius = getOuterRadius(width, height, scale);
  const count = token.actor ? getVisibleBarCount(token) : 0;
  const stack = count ? count * BAR_HEIGHT + (count - 1) * BAR_GAP + BAR_GAP : 0;
  // Bars scale with the canvas like the ring; the HUD offset is expressed in HUD pixels.
  return {hudOffset: (outerRadius - height / 2 + stack * scale) / getHUDUnit()};
}

export function getTokenBarColor(token, index, data) {
  const fraction = Math.clamp(Number(data.value), 0, data.max) / data.max;
  const colors = token._getBarColors(index, data);
  return Color.mix(colors.empty, colors.full, fraction);
}

// The ring is drawn outside this radius, so it is the ring's inner radius.
function getHighlightRadius(width, height) {
  return Math.max(width, height) / 2;
}

function getOuterRadius(width, height, scale) {
  return getHighlightRadius(width, height) + HIGHLIGHT_THICKNESS * scale;
}

function getEffectOutline(texture) {
  let outline = outlines.get(texture);
  if ( outline ) return outline;
  const sprite = new PIXI.Sprite(texture);
  let image;
  try {
    image = canvas.app.renderer.extract.canvas(sprite);
  } finally {
    sprite.destroy();
  }
  const mask = document.createElement("canvas");
  mask.width = mask.height = 72;
  const context = mask.getContext("2d");
  for ( let y = -6; y <= 6; y++ ) {
    for ( let x = -6; x <= 6; x++ ) {
      if ( x * x + y * y <= 36 ) context.drawImage(image, 6 + x, 6 + y, 60, 60);
    }
  }
  context.globalCompositeOperation = "destination-out";
  context.drawImage(image, 6, 6, 60, 60);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#000000";
  context.fillRect(0, 0, 72, 72);
  outline = PIXI.Texture.from(mask);
  outlines.set(texture, outline);
  return outline;
}

export function registerTokenEffects() {
  const Base = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class AdvancedInterfaceToken extends Base {
    _refreshSize() {
      super._refreshSize();
      this._refreshNameplate();
    }

    _refreshNameplate() {
      super._refreshNameplate();
      const {width, height} = this.document.getSize();
      const scale = canvas.dimensions.uiScale;
      const ringTop = height / 2 - getOuterRadius(width, height, scale);
      this.nameplate.anchor.set(0.5, 1);
      this.nameplate.position.set(width / 2, ringTop - 2 * scale);
    }

    _refreshBorder() {
      const {width, height} = this.document.getSize();
      const scale = canvas.dimensions.uiScale;
      this.border.clear().lineStyle({
        width: HIGHLIGHT_THICKNESS * scale,
        color: 0xFFFFFF, alpha: 1, alignment: 1
      }).drawCircle(width / 2, height / 2, getHighlightRadius(width, height));
    }

    drawBars() {
      if ( !this.actor ) return;
      BAR_KEYS.forEach((key, index) => {
        const bar = this.bars[key];
        const data = getBarData(this, key);
        if ( !data?.max ) {
          bar.clear();
          return bar.visible = false;
        }
        this._drawBar(index, bar, data);
        bar.visible = true;
      });
    }

    _drawBar(index, bar, data) {
      const value = Number(data.value);
      const pct = Math.clamp(value, 0, data.max) / data.max;
      const {width, height} = this.document.getSize();
      const scale = canvas.dimensions.uiScale;
      const color = getTokenBarColor(this, index, data);
      const outerRadius = getOuterRadius(width, height, scale);
      const barHeight = BAR_HEIGHT * scale;
      const gap = BAR_GAP * scale;
      const slot = getVisibleBars(this).indexOf(BAR_KEYS[index]);
      const barWidth = 2 * outerRadius;

      bar.clear();
      bar.beginFill(0x000000, 0.5).drawRect(0, 0, barWidth, barHeight);
      bar.beginFill(color, 1.0).drawRect(0, 0, barWidth * pct, barHeight);
      bar.endFill();
      bar.position.set(width / 2 - barWidth / 2, height / 2 + outerRadius + gap + slot * (barHeight + gap));
    }

    // Bars show only on hovered, controlled, or HUD-targeted tokens, and must survive depth and sort refreshes.
    _refreshBarsVisibility() {
      const active = this.hover || this.controlled || canvas.tokens?.hud?.object === this;
      this.bars.visible = !!this.actor && !this.document.isSecret && active;
    }

    _refreshVisibility() {
      super._refreshVisibility();
      this._refreshBarsVisibility();
    }

    _refreshState() {
      super._refreshState();
      this._refreshBarsVisibility();
      this.border.zIndex = Infinity;
      this.bars.zIndex = Infinity;
      this.border.tint = getHighlightColor(this.hover || !this.controlled ? "hover" : "active");
      this.zIndex = this.isPreview ? 3 : this.hover ? 2 : this.controlled ? 1 : 0;
      this.mesh.zIndex = this.zIndex;
      this.effects.alpha = this.document.alpha;
    }

    _refreshMesh() {
      super._refreshMesh();
      this.effects.alpha = this.document.alpha;
    }

    _refreshEffects() {
      super._refreshEffects();
      this.effects.alpha = this.document.alpha;
      const bg = this.effects.bg.clear();
      const s = canvas.dimensions.uiScale;
      for ( const effect of this.effects.children ) {
        if ( effect === bg || effect === this.effects.overlay ) continue;
        const texture = getEffectOutline(effect.texture);
        const matrix = new PIXI.Matrix().scale(24 * s / texture.width, 24 * s / texture.height)
          .translate(effect.x - 2 * s, effect.y - 2 * s);
        bg.beginTextureFill({ texture, matrix, alpha: 0.4 })
          .drawRect(effect.x - 2 * s, effect.y - 2 * s, 24 * s, 24 * s).endFill();
      }
    }
  };
}
