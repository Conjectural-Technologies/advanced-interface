const fixedCalendarConfig = {
    name: "Fixed Calendar",
    description: "A 13 month calendar.",
    years: {
        yearZero: 0,
        firstWeekday: 0,
        leapYear: {
            leapStart: 0,
            leapInterval: 4
        }
    },
    months: {
        values: [
            { name: "March",        abbreviation: "Mar",    ordinal: 1,     days: 28 },
            { name: "April",        abbreviation: "Apr",    ordinal: 2,     days: 28 },
            { name: "May",          abbreviation: "May",    ordinal: 3,     days: 28 },
            { name: "June",         abbreviation: "Jun",    ordinal: 4,     days: 28 },
            { name: "Quintilis",    abbreviation: "Qui",    ordinal: 5,     days: 28 },
            { name: "Sextilis",     abbreviation: "Sex",    ordinal: 6,     days: 28 },
            { name: "September",    abbreviation: "Sep",    ordinal: 7,     days: 28 },
            { name: "October",      abbreviation: "Oct",    ordinal: 8,     days: 28 },
            { name: "November",     abbreviation: "Nov",    ordinal: 9,     days: 28 },
            { name: "December",     abbreviation: "Dec",    ordinal: 10,    days: 28 },
            { name: "January",      abbreviation: "Jan",    ordinal: 11,    days: 28 },
            { name: "February",     abbreviation: "Feb",    ordinal: 12,    days: 28 },
            { name: "Mercedonius",  abbreviation: "Mer",    ordinal: 13,    days: 28 },
            { name: "Intercalaris", abbreviation: "Int",    ordinal: 14,    days: 1,    leapDays: 2,    intercalary: true }
        ]
    },
    days: {
        values: [
            { name: "Moonday",  abbreviation: "M",  ordinal: 1 },
            { name: "Tidesday", abbreviation: "T",  ordinal: 2 },
            { name: "Windsday", abbreviation: "W",  ordinal: 3 },
            { name: "Earthday", abbreviation: "R",  ordinal: 4 },
            { name: "Fireday",  abbreviation: "F",  ordinal: 5 },
            { name: "Starsday", abbreviation: "S",  ordinal: 6, isRestDay: true },
            { name: "Sunday",   abbreviation: "U",  ordinal: 7, isRestDay: true }
        ],
        daysPerYear: 365,
        hoursPerDay: 24,
        minutesPerHour: 60,
        secondsPerMinute: 60
    },
    seasons: {
        values: [
            { name: "Spring",   dayStart: 1,    dayEnd: 92 },
            { name: "Summer",   dayStart: 93,   dayEnd: 184 },
            { name: "Autumn",   dayStart: 185,  dayEnd: 275 },
            { name: "Winter",   dayStart: 276,  dayEnd: 365 }        ]
    }
};

function registerDnd5eCalendarOption() {
    CONFIG.DND5E.calendar.calendars.push({
        value: "fixed_calendar",
        label: fixedCalendarConfig.name,
        config: fixedCalendarConfig
    });
}

Hooks.on("dnd5e.setupCalendar", () => {
    registerDnd5eCalendarOption();
});