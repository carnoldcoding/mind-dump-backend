// Finances — a refused write. Like Mind's DomainError, it carries a
// machine-readable `code` so the controller maps it to an HTTP status without
// string-matching the message; the message itself is shown in the window.

class FinanceError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FinanceError";
        this.code = code;
    }
}

const invalid = (message) => new FinanceError("invalid_input", message);
const notFound = (what) => new FinanceError("not_found", `${what} not found`);

module.exports = { FinanceError, invalid, notFound };
