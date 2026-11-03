import {getHighlightColor} from "./helper.mjs";

export function registerDoorButtons() {
  const Base = CONFIG.Canvas.doorControlClass;
  CONFIG.Canvas.doorControlClass = class AdvancedInterfaceDoorControl extends Base {
    get controlSize() {
      return 32;
    }

    async draw() {
      await super.draw();
      if ( this.destroyed ) return this;
      const s = canvas.dimensions.uiScale;
      this.bg.clear();
      this.border.clear();
      this.icon.width = this.icon.height = 32 * s;
      this.icon.position.set(0, 0);
      this.icon.alpha = 0.6;
      this.icon.tint = 0xefe6d8;
      this.icon.roundPixels = true;
      this.hitArea = new PIXI.Rectangle(0, 0, 32 * s, 32 * s);
      this.refreshButtonHighlight(false);
      return this;
    }

    reposition() {
      const offset = this.controlSize / 2 * canvas.dimensions.uiScale;
      this.position.set(this.wall.midpoint[0] - offset * this.scale.x,
        this.wall.midpoint[1] - offset * this.scale.y);
      canvas.perception.update({ refreshVision: true });
    }

    refreshButtonHighlight(hover) {
      this.bg.alpha = 1;
      this.icon.alpha = hover ? 1 : 0.6;
      this.icon.tint = hover ? getHighlightColor("hover") : 0xefe6d8;
      this.border.visible = false;
    }

    _onMouseOver(event) {
      super._onMouseOver(event);
      this.refreshButtonHighlight(this.border.visible);
    }

    _onMouseOut(event) {
      super._onMouseOut(event);
      this.refreshButtonHighlight(false);
    }
  };
}
