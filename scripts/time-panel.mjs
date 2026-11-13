import {decorateCalendarIcons} from "./interface-components.mjs";
import {createButton, createIcon, localize, reportError, targetApp} from "./helper.mjs";

const INCREMENTS = [
  ["1 min.", "minute", 1], ["10 min.", "minute", 10],
  ["1 hr.", "hour", 1], ["8 hrs.", "hour", 8],
  ["1 day", "day", 1], ["7 days", "day", 7]
];
const report = reportError("Time panel");

function button(doc, icon, label, handler) {
  const element = createButton(doc, `ui-control plain icon fa-solid fa-${icon}`, {label, onClick: handler, context: "Utility panels"});
  element.dataset.tooltipDirection = "DOWN";
  return element;
}

// Replaces a select's native option list with a menu that shares the chat Format menu's look (see chat.mjs).
// The menu lives on <body> (the sidebar clips overflow) and focus stays on the select so its panel keeps :focus-within.
function useDropdownMenu(select) {
  const doc = select.ownerDocument;
  let menu = null;
  let focused = -1;
  const items = () => menu ? [...menu.querySelectorAll("li[data-index]")] : [];
  const highlight = index => {
    const list = items();
    if (!list.length) return;
    focused = (index + list.length) % list.length;
    list.forEach((item, i) => item.classList.toggle("focused", i === focused));
    select.setAttribute("aria-activedescendant", list[focused].id);
  };
  const close = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    focused = -1;
    select.classList.remove("advanced-interface-dropdown-open");
    select.removeAttribute("aria-expanded");
    select.removeAttribute("aria-activedescendant");
    doc.removeEventListener("pointerdown", onOutside, true);
    doc.defaultView.removeEventListener("blur", close);
    doc.defaultView.removeEventListener("resize", close);
    select.removeEventListener("blur", close);
  };
  const onOutside = event => {
    if (!menu?.contains(event.target) && event.target !== select) close();
  };
  const pick = index => {
    close();
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", {bubbles: true}));
  };
  const open = () => {
    if (select.disabled) return;
    if (menu) return close();
    game.tooltip?.deactivate?.();
    menu = doc.createElement("div");
    const theme = [...(select.closest(".themed")?.classList ?? [])].find(name => name.startsWith("theme-")) ?? "theme-dark";
    menu.className = `advanced-interface-dropdown themed ${theme}`;
    const list = doc.createElement("ul");
    list.setAttribute("role", "listbox");
    list.id = `advanced-interface-dropdown-${foundry.utils.randomID()}`;
    for (const [index, option] of [...select.options].entries()) {
      const item = doc.createElement("li");
      item.setAttribute("role", "option");
      item.id = `${list.id}-${index}`;
      item.dataset.index = String(index);
      const active = index === select.selectedIndex;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      const label = doc.createElement("span");
      label.textContent = option.text;
      item.append(label);
      if (active) {
        const check = doc.createElement("i");
        check.className = "fa-solid fa-check";
        item.append(check);
      }
      list.append(item);
    }
    // Keep focus on the select while interacting with the menu.
    menu.addEventListener("mousedown", event => event.preventDefault());
    list.addEventListener("click", event => {
      const item = event.target.closest("li[data-index]");
      if (item) pick(Number(item.dataset.index));
    });
    list.addEventListener("pointerover", event => {
      const item = event.target.closest("li[data-index]");
      if (item) highlight(Number(item.dataset.index));
    });
    menu.append(list);
    doc.body.append(menu);
    const rect = select.getBoundingClientRect();
    list.style.minWidth = `${rect.width}px`;
    const height = menu.getBoundingClientRect().height;
    const below = rect.bottom + 2 + height <= doc.documentElement.clientHeight;
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${below ? rect.bottom + 2 : rect.top - 2 - height}px`;
    select.classList.add("advanced-interface-dropdown-open");
    select.setAttribute("aria-expanded", "true");
    select.setAttribute("aria-controls", list.id);
    highlight(Math.max(select.selectedIndex, 0));
    doc.addEventListener("pointerdown", onOutside, true);
    doc.defaultView.addEventListener("blur", close);
    doc.defaultView.addEventListener("resize", close);
    select.addEventListener("blur", close);
  };
  select.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    select.focus();
    open();
  });
  select.addEventListener("keydown", event => {
    if (menu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") highlight(focused + (event.key === "ArrowDown" ? 1 : -1));
      else if (event.key === "Home") highlight(0);
      else if (event.key === "End") highlight(-1);
      else if (event.key === "Enter" || event.key === " ") pick(focused);
      else if (event.key === "Escape" || (event.altKey && event.key === "ArrowUp")) close();
      else if (event.key === "Tab") return close();
      else return;
    }
    else if (event.key === "Enter" || event.key === " " || (event.altKey && event.key === "ArrowDown") || event.key === "F4") open();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  return close;
}

function dateComponents(year, month, day, hour, minute) {
  const calendar = game.time.calendar;
  const days = calendar.months.values.map(m => calendar.isLeapYear(year) ? (m.leapDays ?? m.days) : m.days);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !days[month]
    || !Number.isInteger(day) || day < 1 || day > days[month]
    || !Number.isInteger(hour) || hour < 0 || hour >= calendar.days.hoursPerDay
    || !Number.isInteger(minute) || minute < 0 || minute >= calendar.days.minutesPerHour) {
    throw new Error(localize("Time.InvalidDate"));
  }
  return {year, day: days.slice(0, month).reduce((sum, count) => sum + count, day - 1), hour, minute, second: 0};
}

async function setDateTime(components) {
  const calendar = game.time.calendar;
  const actual = calendar.timeToComponents(calendar.componentsToTime(components));
  if (Object.entries(components).some(([key, value]) => actual[key] !== value)) {
    throw new Error(localize("Time.UnrepresentableDate"));
  }
  await game.time.set(components);
}

export function placeCalendar(app = targetApp("advancedTime", {includeDetached: true})) {
  const host = app?.element?.querySelector(".advanced-interface-sundial");
  const hud = dnd5e.ui.calendar?.element;
  if (host && hud && hud.parentElement !== host) {
    hud.classList.remove("faded-ui");
    host.append(hud);
  }
}

function refreshTimeLabel() {
  if (game.system.id !== "dnd5e") return;
  const calendar = game.time.calendar;
  const {formatters} = game.settings.get("dnd5e", "calendarPreferences");
  const format = name => calendar.format(undefined, `format${name[0].toUpperCase()}${name.slice(1)}`);
  const full = `${format(formatters.date)}, ${format(formatters.time)}`;
  const tab = ui.sidebar?.element?.querySelector('[data-tab="advancedTime"]');
  if (tab) {
    tab.setAttribute("aria-label", full);
    tab.dataset.advancedInterfaceTooltip = full;
    if (!tab.classList.contains("active")) tab.dataset.tooltip = full;
    const label = tab.querySelector(".advanced-interface-tab-label");
    if (label) label.textContent = full;
  }
}

async function editDateTime() {
  if (!game.user.isGM) return;
  class SetDateTimeDialog extends dnd5e.applications.calendar.SetDateDialog {
    static DEFAULT_OPTIONS = {
      classes: ["advanced-interface-set-date-time"],
      window: {title: "ADVANCED_INTERFACE.Time.Set"},
      form: {
        closeOnSubmit: false,
        handler: async function(event, form, formData) {
          try {
            const {year, month, day, hour, minute} = formData.object;
            await setDateTime(dateComponents(year - game.time.calendar.years.yearZero, month, day, hour, minute));
            await this.close({submitted: true});
          } catch (error) {
            report(error);
          }
        }
      }
    };

    async _prepareContentContext(context, options) {
      context = await super._prepareContentContext(context, options);
      for (const entry of context.fields) {
        entry.field = new foundry.data.fields.NumberField({integer: true, required: true, nullable: false});
      }
      for (const name of ["hour", "minute"]) {
        context.fields.push({
          classes: "label-top",
          field: new foundry.data.fields.NumberField({integer: true, required: true, nullable: false}),
          label: localize(`Time.${name}`),
          name,
          value: game.time.components[name]
        });
      }
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const form = this.element.querySelector("form");
      const calendar = game.time.calendar;
      form.elements.day.min = "1";
      form.elements.hour.min = form.elements.minute.min = "0";
      form.elements.hour.max = calendar.days.hoursPerDay - 1;
      form.elements.minute.max = calendar.days.minutesPerHour - 1;
      const updateDayLimit = () => {
        const year = Number(form.elements.year.value) - calendar.years.yearZero;
        const month = calendar.months.values[Number(form.elements.month.value)];
        if (!Number.isInteger(year) || !month) return;
        form.elements.day.max = calendar.isLeapYear(year) ? (month.leapDays ?? month.days) : month.days;
      };
      form.addEventListener("change", updateDayLimit);
      updateDayLimit();
    }
  }
  await new SetDateTimeDialog().render({force: true});
}

export function createTimePanel(UtilityPanel) {
  return class TimePanel extends UtilityPanel {
    static tabName = "advancedTime";
    static DEFAULT_OPTIONS = {id: "advancedTime"};
    #month;
    #year;
    #expanded = false;
    #increment = 2;
    #closeIncrements;

    _canRender(options) {
      return game.system.id === "dnd5e" && game.settings.get("dnd5e", "calendarConfig").enabled
        && super._canRender(options);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      if (options.refreshDate) {
        this.#month = game.time.components.month;
        this.#year = game.time.components.year;
      }
      const host = this.element.querySelector(".advanced-interface-utility-content");
      const doc = host.ownerDocument;
      // Preserve the native sundial across panel re-renders.
      const hud = !this.isPopout && this.popout?.rendered ? null : dnd5e.ui.calendar?.element;
      const controls = doc.createElement("div");
      controls.className = "advanced-interface-time-controls";
      const back = button(doc, "clock-rotate-left", localize("Time.Back"), () => this.#advance(-1));
      const forward = button(doc, "clock-rotate-left fa-flip-horizontal", localize("Time.Forward"), () => this.#advance(1));
      const increments = doc.createElement("select");
      increments.setAttribute("aria-label", localize("Time.Increment"));
      INCREMENTS.forEach(([label], index) => increments.add(new Option(label, index, false, index === this.#increment)));
      increments.addEventListener("change", () => { this.#increment = Number(increments.value); });
      this.#closeIncrements?.();
      this.#closeIncrements = useDropdownMenu(increments);
      const config = game.settings.get("dnd5e", "bastionConfiguration");
      const eligible = config.enabled && config.button;
      const bastionMenu = game.settings.menus.get("dnd5e.bastionConfiguration");
      const bastion = button(doc, "chess-rook", eligible ? localize("Time.Bastion") : game.i18n.localize(bastionMenu.label),
        () => eligible ? dnd5e.bastion.confirmAdvance() : new bastionMenu.type().render({force: true}));
      bastion.disabled = !game.user.isGM;
      bastion.classList.toggle("advanced-interface-bastion-ineligible", !eligible);
      for (const el of [back, forward, increments]) el.disabled = !game.user.isGM;
      controls.append(back, increments, forward, bastion);
      const sundial = doc.createElement("div");
      sundial.className = "advanced-interface-sundial";
      if (hud) sundial.append(hud);
      const set = button(doc, "calendar-pen", localize("Time.Set"), editDateTime);
      set.disabled = !game.user.isGM;
      const grid = this.#calendar(doc);
      const toggle = button(doc, "angle-up", localize("Time.Calendar"), () => {
        this.#expanded = !this.#expanded;
        toggle.setAttribute("aria-expanded", String(this.#expanded));
        grid.hidden = !this.#expanded;
      });
      toggle.classList.add("advanced-interface-shutter");
      toggle.setAttribute("aria-expanded", String(this.#expanded));
      controls.prepend(sundial);
      controls.append(set, toggle);
      grid.hidden = !this.#expanded;
      host.replaceChildren(controls, grid);
      decorateCalendarIcons(host);
      placeCalendar();
      refreshTimeLabel();
    }

    async #advance(direction) {
      if (!game.user.isGM) return;
      const [, unit, value] = INCREMENTS[this.#increment];
      await game.time.advance({[unit]: direction * value});
    }

    #calendar(doc) {
      const calendar = game.time.calendar, current = game.time.components;
      this.#month ??= current.month;
      this.#year ??= current.year;
      const wrapper = doc.createElement("section");
      wrapper.className = "advanced-interface-calendar";
      const heading = doc.createElement("header");
      const icon = createIcon(doc, "fa-solid fa-calendar-days advanced-interface-calendar-icon");
      const title = doc.createElement("strong");
      title.textContent = `${game.i18n.localize(calendar.months.values[this.#month].name)}, ${this.#year + calendar.years.yearZero}`;
      const cycle = delta => {
        this.#month += delta;
        if (this.#month < 0) { this.#month = calendar.months.values.length - 1; this.#year--; }
        if (this.#month >= calendar.months.values.length) { this.#month = 0; this.#year++; }
        return this.render({force: true});
      };
      heading.append(icon, title,
        button(doc, "play-flip", localize("Time.PreviousMonth"), () => cycle(-1)),
        button(doc, "play", localize("Time.NextMonth"), () => cycle(1)));
      const grid = doc.createElement("div");
      grid.className = "advanced-interface-calendar-grid";
      const first = calendar.timeToComponents(calendar.componentsToTime(dateComponents(this.#year, this.#month, 1, 0, 0)));
      const weekdayCount = calendar.days.values.length;
      const intercalary = first.dayOfWeek === null;
      grid.style.setProperty("--calendar-weekdays", intercalary ? 1 : weekdayCount);
      if (!intercalary) {
        calendar.days.values.forEach(day => {
          const label = doc.createElement("abbr");
          label.title = game.i18n.localize(day.name);
          label.textContent = game.i18n.localize(day.abbreviation || day.name).slice(0, 3);
          grid.append(label);
        });
      }
      const offset = intercalary ? 0 : ((first.dayOfWeek % weekdayCount) + weekdayCount) % weekdayCount;
      for (let index = 0; index < offset; index++) grid.append(doc.createElement("span"));
      const month = calendar.months.values[this.#month];
      const count = calendar.isLeapYear(this.#year) ? (month.leapDays ?? month.days) : month.days;
      for (let day = 1; day <= count; day++) {
        const control = button(doc, "", `${title.textContent} ${day}`, async () => {
          if (!game.user.isGM) return;
          const c = game.time.components;
          await setDateTime(dateComponents(this.#year, this.#month, day, c.hour, c.minute));
        });
        control.className = "ui-control plain advanced-interface-calendar-day";
        delete control.dataset.tooltip;
        delete control.dataset.tooltipDirection;
        control.textContent = day;
        control.disabled = !game.user.isGM;
        if (this.#year === current.year && this.#month === current.month && day === current.dayOfMonth + 1) {
          control.setAttribute("aria-current", "date");
        }
        grid.append(control);
      }
      wrapper.append(heading, grid);
      return wrapper;
    }
  };
}

Hooks.on("renderCalendarHUD", () => {
  placeCalendar();
  refreshTimeLabel();
});
Hooks.on("renderAdvancedSidebar", () => refreshTimeLabel());
Hooks.on("ready", () => {
  if (game.system.id !== "dnd5e") return;
  document.getElementById("bastion-turn")?.remove();
  placeCalendar();
  refreshTimeLabel();
});
Hooks.on("updateWorldTime", () => {
  refreshTimeLabel();
  if (ui.advancedTime?.rendered) ui.advancedTime.render({refreshDate: true});
});
Hooks.on("updateSetting", setting => {
  if (setting.key === "dnd5e.calendarPreferences") refreshTimeLabel();
  if (["dnd5e.bastionConfiguration", "dnd5e.calendarConfig"].includes(setting.key)) {
    const available = game.settings.get("dnd5e", "calendarConfig").enabled;
    ui.sidebar?.setTabAvailable?.("advancedTime", available);
    if (available) ui.advancedTime?.render({force: true});
    else if (ui.advancedTime?.popout?.rendered) ui.advancedTime.popout.close();
    document.getElementById("bastion-turn")?.remove();
  }
});
Hooks.on("clientSettingChanged", key => {
  if (key === "dnd5e.calendarPreferences") refreshTimeLabel();
});
