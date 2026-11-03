import {isManagedSidebarTab} from "./helper.mjs";

const observers = new WeakMap();
const FADE_SIZE = 12;
const CONTROL_BARS = [
  ".directory-header", ".directory-footer", ".combat-tracker-header", ".combat-controls",
  ".advanced-interface-navigation-heading", ".advanced-interface-actor-navigation-heading",
  ".advanced-interface-hotbar", ".global-control", ".advanced-interface-settings-toolbar",
  ".advanced-interface-time-controls", ".advanced-interface-player-heading",
  ".placeable-tab > search", ".placeables-sidebar > .tabs", ".chat-form"
].join(", ");
const SECTIONS = [
  ".directory-list", ".directory-wrapper", ".chat-scroll", ".combat-tracker",
  ".placeable-directory", ".advanced-interface-utility-content", ".placeable-tab",
  ".advanced-interface-navigation-group", ".advanced-interface-navigation-scenes",
  ".advanced-interface-actor-navigation", ".advanced-interface-actor-navigation-list"
].join(", ");

export function onRenderSidebarScrolling(app, element) {
  if ( !isManagedSidebarTab(app) ) return;
  observers.get(app)?.disconnect();
  const root = element.querySelector(":scope > .window-content") ?? element;
  root.classList.add("advanced-interface-panel-scroll");
  const view = element.ownerDocument.defaultView;
  const observed = new Set();
  const contentStyles = new Map();
  const itemOrders = new Map();
  const restoreOrder = item => {
    const original = itemOrders.get(item);
    if ( original.value ) item.style.setProperty("order", original.value, original.priority);
    else item.style.removeProperty("order");
    itemOrders.delete(item);
  };
  const layoutItems = container => [...container.children].flatMap(item =>
    view.getComputedStyle(item).display === "contents" ? layoutItems(item) : [item]);
  const restoreContent = (content, styles) => {
    content.style.clipPath = styles.clipPath;
    content.style.maskImage = styles.maskImage;
    contentStyles.delete(content);
  };
  let chatScroll;
  let disconnected = false;
  const chatProperties = ["scrollTop", "scrollHeight", "clientHeight"];
  const chatDescriptors = new Map();
  const restoreChatScroll = () => {
    if ( !chatScroll ) return;
    for ( const key of chatProperties ) {
      const descriptor = chatDescriptors.get(key);
      if ( descriptor ) Object.defineProperty(chatScroll, key, descriptor);
      else delete chatScroll[key];
    }
    chatDescriptors.clear();
    chatScroll = undefined;
  };
  const forwardChatScroll = event => {
    if ( event.target !== root ) return;
    chatScroll?.dispatchEvent(new view.Event("scroll"));
    schedule();
  };
  root.addEventListener("scroll", forwardChatScroll);
  let frame;
  const update = () => {
    frame = undefined;
    if ( disconnected ) return;
    mutations.disconnect();
    try {
      const reversed = element.classList.contains("advanced-interface-bottom-row");
      const items = reversed ? layoutItems(root) : [];
      for ( const item of itemOrders.keys() ) {
        if ( !items.includes(item) ) restoreOrder(item);
      }
      for ( const item of items ) {
        if ( itemOrders.has(item) ) continue;
        itemOrders.set(item, {
          value: item.style.getPropertyValue("order"), priority: item.style.getPropertyPriority("order"),
          order: Number(view.getComputedStyle(item).order)
        });
      }
      items.sort((first, second) => itemOrders.get(first).order - itemOrders.get(second).order);
      for ( const [index, item] of items.entries() ) {
        const order = String(items.length - index - 1);
        if ( item.style.order !== order ) item.style.order = order;
      }
      const sections = [...root.querySelectorAll(SECTIONS)];
      for ( const section of sections ) {
        section.classList.add("advanced-interface-panel-section");
      }
      root.classList.toggle("advanced-interface-panel-overflow", root.scrollHeight > root.clientHeight + 1);
      const chat = root.querySelector(".chat-scroll");
      if ( chat !== chatScroll ) {
        restoreChatScroll();
      }
      if ( chat && !chatScroll ) {
        chatScroll = chat;
        for ( const key of chatProperties ) chatDescriptors.set(key, Object.getOwnPropertyDescriptor(chat, key));
        // Chat's history loader and jump controls still address its original scroll element.
        Object.defineProperties(chat, {
          scrollTop: { configurable: true, get: () => root.scrollTop, set: value => { root.scrollTop = value; } },
          scrollHeight: { configurable: true, get: () => root.scrollHeight },
          clientHeight: { configurable: true, get: () => root.clientHeight }
        });
      }
      const bars = [...root.querySelectorAll(CONTROL_BARS)];
      for ( const bar of bars ) {
        bar.classList.add("advanced-interface-panel-control");
        bar.classList.toggle("advanced-interface-sticky-bottom", reversed);
      }
      const heights = bars.map(bar => bar.offsetHeight);
      const offsets = [];
      let offset = 0;
      for ( const [index, bar] of bars.entries() ) {
        offsets.push(offset);
        const value = `${offset}px`;
        if ( bar.style.getPropertyValue("--advanced-interface-sticky-offset") !== value ) {
          bar.style.setProperty("--advanced-interface-sticky-offset", value);
        }
        if ( heights[index] > 0 ) offset += heights[index] + 4;
      }
      const panel = root.getBoundingClientRect();
      const pinned = bars.map(bar => bar.getBoundingClientRect()).filter((rect, index) => {
        if ( !heights[index] ) return false;
        const inset = offsets[index];
        return reversed ? rect.bottom >= panel.bottom - inset - 1 : rect.top <= panel.top + inset + 1;
      });
      const boundary = reversed
        ? Math.min(panel.bottom, ...pinned.map(rect => rect.top - 4))
        : Math.max(panel.top, ...pinned.map(rect => rect.bottom + 4));
      const contents = [...new Set([...root.children, ...sections])]
        .filter(node => !node.matches(CONTROL_BARS) && !node.querySelector(CONTROL_BARS)
          && view.getComputedStyle(node).display !== "contents");
      const contentBounds = contents.filter(content =>
        !contents.some(parent => parent !== content && parent.contains(content)))
        .map(content => ({ content, rect: content.getBoundingClientRect() }));
      for ( const { content, rect } of contentBounds ) {
        if ( !contentStyles.has(content) ) contentStyles.set(content, {
          clipPath: content.style.clipPath, maskImage: content.style.maskImage
        });
        const original = contentStyles.get(content);
        const clip = Math.min(rect.height, Math.max(0, reversed ? rect.bottom - boundary : boundary - rect.top));
        // Clip the content itself so the 4px gaps remain transparent, not painted toolbar extensions.
        const path = clip > 0
          ? (reversed ? `inset(0px -100px ${clip}px)` : `inset(${clip}px -100px 0px)`)
          : original.clipPath;
        if ( content.style.clipPath !== path ) content.style.clipPath = path;
        const top = reversed ? panel.top : boundary;
        const bottom = reversed ? boundary : panel.bottom;
        const scale = rect.height > 0 ? content.offsetHeight / rect.height : 1;
        const start = Math.max(0, (top - rect.top) * scale);
        const end = Math.min(content.offsetHeight, (bottom - rect.top) * scale);
        const fadeTop = root.scrollTop > 1 && rect.top < top && rect.bottom > top;
        const fadeBottom = root.scrollHeight - root.clientHeight - root.scrollTop > 1
          && rect.top < bottom && rect.bottom > bottom;
        const size = Math.min(FADE_SIZE, Math.max(0, (end - start) / 2));
        const stops = [
          ...(fadeTop ? [`transparent ${start}px`, `black ${start + size}px`] : ["black 0px"]),
          ...(fadeBottom ? [`black ${end - size}px`, `transparent ${end}px`] : [])
        ];
        const mask = fadeTop || fadeBottom
          ? `linear-gradient(to bottom, ${stops.join(", ")})`
          : original.maskImage;
        if ( content.style.maskImage !== mask ) content.style.maskImage = mask;
      }
      for ( const [content, styles] of contentStyles ) {
        if ( contents.includes(content) ) continue;
        restoreContent(content, styles);
      }
      const targets = new Set([root, ...bars, ...sections]);
      for ( const target of observed ) {
        if ( targets.has(target) ) continue;
        resize.unobserve(target);
        observed.delete(target);
      }
      for ( const target of targets ) {
        if ( observed.has(target) ) continue;
        resize.observe(target);
        observed.add(target);
      }
    } finally {
      mutations.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "hidden"] });
    }
  };
  const schedule = () => {
    if ( !disconnected ) frame ??= view.requestAnimationFrame(update);
  };
  const mutations = new view.MutationObserver(schedule);
  const resize = new view.ResizeObserver(schedule);
  const observer = {
    disconnect() {
      disconnected = true;
      mutations.disconnect();
      resize.disconnect();
      root.removeEventListener("scroll", forwardChatScroll);
      for ( const item of itemOrders.keys() ) restoreOrder(item);
      for ( const [content, styles] of contentStyles ) restoreContent(content, styles);
      restoreChatScroll();
      if ( frame !== undefined ) view.cancelAnimationFrame(frame);
    }
  };
  observers.set(app, observer);
  queueMicrotask(update);
}

export function onCloseSidebarScrolling(app) {
  observers.get(app)?.disconnect();
  observers.delete(app);
}
