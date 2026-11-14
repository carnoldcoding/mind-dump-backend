// Body — a refused write. Like FinanceError, it carries a machine-readable
// `code` so the controller maps it to an HTTP status without string-matching
// the message; the message itself is shown in the window.

class BodyError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "BodyError";
        this.code = code;
    }
}

const invalid = (message) => new BodyError("invalid_input", message);
const notFound = (what) => new BodyError("not_found", `${what} not found`);
const conflict = (code, message) => new BodyError(code, message);

module.exports = { BodyError, invalid, notFound, conflict };
