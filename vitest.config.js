// The backend is CommonJS throughout, and vitest's own API can only be
// imported as ESM. Globals let a test file stay `require`-based like every
// other file here, rather than making the tests the one ESM island in the repo.
module.exports = {
  test: {
    globals: true,
    environment: 'node',
  },
};
