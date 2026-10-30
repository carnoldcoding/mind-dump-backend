// Finances — calendar dates as ISO `YYYY-MM-DD` strings, the same canonical
// form the Reviews use. A Transaction's date is a day on the user's calendar,
// not an instant, so these never touch a time zone: the server runs in UTC
// and the user does not, and "today" always arrives from the client.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(date) {
    const [y, m, d] = date.split("-").map(Number);
    return { y, m, d };
}

function format(y, m, d) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// A real calendar day, not just the right shape: 2026-02-30 is refused.
function isIsoDate(value) {
    if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
    const { y, m, d } = parts(value);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// `YYYY-MM` — the month a date falls in.
function monthOf(date) {
    return date.slice(0, 7);
}

function startOfMonth(date) {
    return `${monthOf(date)}-01`;
}

function dayBefore(date) {
    const { y, m, d } = parts(date);
    const t = new Date(Date.UTC(y, m - 1, d - 1));
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

module.exports = { isIsoDate, daysInMonth, monthOf, startOfMonth, dayBefore, parts, format };
