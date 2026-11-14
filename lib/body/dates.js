// Body — calendar dates as ISO `YYYY-MM-DD` strings, the same form Finances
// and the Reviews use. A Session belongs to a day on the user's calendar, not
// to an instant, so "today" always arrives from the client and nothing here
// reads the server's clock.

const { isIsoDate, parts, format } = require("../finances/dates");

function addDays(date, n) {
    const { y, m, d } = parts(date);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// 1 = Monday … 7 = Sunday. A week runs Monday to Sunday (spec R7).
function weekdayOf(date) {
    const { y, m, d } = parts(date);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 ? 7 : day;
}

// The Monday that starts the week a date falls in.
function weekStart(date) {
    return addDays(date, 1 - weekdayOf(date));
}

module.exports = { isIsoDate, addDays, weekdayOf, weekStart };
