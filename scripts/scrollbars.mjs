import {decorateIconButtons, ICON_BUTTONS} from "./interface-components.mjs";
import {isManagedSidebarTab} from "./helper.mjs";

const sidebarScrollObservers = new WeakMap();
const sidebarScrollRegions = [
  ".chat-scroll", ".directory-list", ".directory-wrapper", ".combat-tracker",
  ".placeable-directory", ".advanced-interface-utility-content", ".editor-content",
  ".scrollable", ".settings-sidebar", ".settings-sidebar > .window-content"
].join(", ");

function watchSidebarScrollbars(app, element) {
  if (!isManagedSidebarTab(app)) return;
  if (element.classList.contains("compendium-directory")) return;
  sidebarScrollObservers.get(app)?.disconnect();
  const view = element.ownerDocument.defaultView;
  let frame;
  const mutationOptions = {subtree: true, childList: true, attributes: true,
    attributeFilter: ["class", "style", "hidden", "open"], characterData: true};
  const observed = new Set();
  const decorations = new Set([element]);
  // Chromium can report native thumb pseudo-states without repainting them.
  let hoveredScrollbar;
  let grabbedScrollbar;
  const setScrollbarState = (region, state) => {
    if (!region) return;
    if (state) region.dataset.advancedInterfaceScrollbar = state;
    else delete region.dataset.advancedInterfaceScrollbar;
  };
  const scrollbarAt = event => {
    for (let region = event.target; region instanceof view.HTMLElement && element.contains(region); region = region.parentElement) {
      if (region !== element && !region.classList.contains("advanced-interface-scroll-region")) continue;
      const style = view.getComputedStyle(region);
      const rect = region.getBoundingClientRect();
      const scale = rect.width / region.offsetWidth;
      const gutter = region.offsetWidth - region.clientWidth
        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      if (gutter <= 0 || region.scrollHeight <= region.clientHeight || !/^(auto|scroll)$/.test(style.overflowY)) continue;
      const left = rect.left + parseFloat(style.borderLeftWidth) * scale;
      const right = rect.right - parseFloat(style.borderRightWidth) * scale;
      if (style.direction === "rtl" ? event.clientX < left + gutter * scale : event.clientX >= right - gutter * scale) return region;
    }
  };
  const moveScrollbar = event => {
    const region = scrollbarAt(event);
    if (hoveredScrollbar !== region) {
      if (hoveredScrollbar !== grabbedScrollbar) setScrollbarState(hoveredScrollbar);
      hoveredScrollbar = region;
    }
    if (region !== grabbedScrollbar) setScrollbarState(region, "hover");
  };
  const leaveScrollbar = () => {
    if (hoveredScrollbar !== grabbedScrollbar) setScrollbarState(hoveredScrollbar);
    hoveredScrollbar = undefined;
  };
  const pressScrollbar = event => {
    if (event.button !== 0) return;
    grabbedScrollbar = scrollbarAt(event);
    setScrollbarState(grabbedScrollbar, "active");
  };
  const releaseScrollbar = () => {
    setScrollbarState(grabbedScrollbar, grabbedScrollbar === hoveredScrollbar ? "hover" : undefined);
    grabbedScrollbar = undefined;
  };
  element.addEventListener("pointermove", moveScrollbar);
  element.addEventListener("pointerleave", leaveScrollbar);
  element.addEventListener("pointerdown", pressScrollbar, true);
  view.addEventListener("pointerup", releaseScrollbar, true);
  view.addEventListener("pointercancel", releaseScrollbar, true);
  view.addEventListener("blur", releaseScrollbar);
  const update = () => {
    frame = undefined;
    // Decoration and overflow markers must not schedule another update themselves.
    mutations.disconnect();
    try {
      const content = element.closest("#sidebar-content");
      if (decorations.size) {
        const roots = [...decorations].filter(node => element.contains(node));
        decorateIconButtons(roots.filter(node => !roots.some(parent => parent !== node && parent.contains(node))));
        decorations.clear();
      }
      const regions = [...element.querySelectorAll(sidebarScrollRegions)];
      if (element.matches(sidebarScrollRegions)) regions.push(element);
      const targets = new Set([element]);
      if (content) targets.add(content);
      const overflow = regions.map(region => {
        const style = view.getComputedStyle(region);
        const scrollable = /^(auto|scroll)$/.test(style.overflowY);
        return {region, overflowing: scrollable && region.clientHeight > 0 && region.scrollHeight > region.clientHeight};
      });
      for (const {region, overflowing} of overflow) {
        if (!region.classList.contains("advanced-interface-scroll-region")) {
          region.classList.add("advanced-interface-scroll-region");
        }
        region.classList.toggle("advanced-interface-scroll-overflow", overflowing);
        targets.add(region);
        for (const child of region.children) targets.add(child);
      }
      for (const target of observed) {
        if (targets.has(target)) continue;
        resize.unobserve(target);
        observed.delete(target);
      }
      for (const target of targets) {
        if (observed.has(target)) continue;
        resize.observe(target);
        observed.add(target);
      }
    } finally {
      mutations.observe(element, mutationOptions);
    }
  };
  const schedule = () => { frame ??= view.requestAnimationFrame(update); };
  const resize = new view.ResizeObserver(schedule);
  view.addEventListener("resize", schedule);
  const mutations = new view.MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        const button = record.target.closest(ICON_BUTTONS);
        if (button) decorations.add(button);
        else if (record.target.querySelector(ICON_BUTTONS)) decorations.add(record.target);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof view.Element)) continue;
        const button = node.closest(ICON_BUTTONS);
        if (button) decorations.add(button);
        else if (node.querySelector(ICON_BUTTONS)) decorations.add(node);
      }
    }
    schedule();
  });
  mutations.observe(element, mutationOptions);
  sidebarScrollObservers.set(app, {
    disconnect() {
      resize.disconnect();
      view.removeEventListener("resize", schedule);
      mutations.disconnect();
      element.removeEventListener("pointermove", moveScrollbar);
      element.removeEventListener("pointerleave", leaveScrollbar);
      element.removeEventListener("pointerdown", pressScrollbar, true);
      view.removeEventListener("pointerup", releaseScrollbar, true);
      view.removeEventListener("pointercancel", releaseScrollbar, true);
      view.removeEventListener("blur", releaseScrollbar);
      setScrollbarState(hoveredScrollbar);
      setScrollbarState(grabbedScrollbar);
      if (frame !== undefined) view.cancelAnimationFrame(frame);
    }
  });
  schedule();
}

Hooks.on("closeAbstractSidebarTab", app => {
  sidebarScrollObservers.get(app)?.disconnect();
  sidebarScrollObservers.delete(app);
});

Hooks.on("renderAbstractSidebarTab", watchSidebarScrollbars);
