module.exports = {
  dependencies: {
    // The new offline engine is Android-only; keep the existing iOS client independent of it.
    'llama.rn': {
      platforms:
        process.env.RELAY_MOBILE_PROFILE === 'offline'
          ? { ios: null }
          : { ios: null, android: null },
    },
  },
};
