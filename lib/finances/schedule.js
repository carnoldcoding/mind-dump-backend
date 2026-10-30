// Finances — the days a Scheduled transaction still owes (spec R26–R28).
//
// A schedule remembers the last date it was recorded through. Every read asks
// it which scheduled days fall after that date and on or before today, so a
// window that has not been opened since the 1st still gets the 1st's pay, dated
// the 1st. A new schedule starts with lastRecorded set to the day before it was
// created, which is all R28 (nothing back-dated) needs.

const { daysInMonth, parts, format, dayBefore } = require("./dates");

// Every scheduled date in (lastRecorded, today], oldest first. A day the month
// lacks — the 31st in November — falls on the month's last day (R27); two days
// that clamp onto the same date record it once.
function dueDates(schedule, today) {
    const from = schedule.lastRecorded;
    if (from >= today) return [];

    const due = [];
    let { y, m } = parts(from);
    const end = parts(today);

    while (y < end.y || (y === end.y && m <= end.m)) {
        const last = daysInMonth(y, m);
        const days = [...new Set(schedule.days.map((d) => Math.min(d, last)))].sort((a, b) => a - b);
        for (const d of days) {
            const date = format(y, m, d);
            if (date > from && date <= today) due.push(date);
        }
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return due;
}

module.exports = { dueDates, dayBefore };
