class Logger {
  info(message, ...args) {
    console.log(`✅ ${new Date().toISOString()} - ${message}`, ...args);
  }

  error(message, ...args) {
    console.error(`❌ ${new Date().toISOString()} - ${message}`, ...args);
  }

  warn(message, ...args) {
    console.warn(`⚠️ ${new Date().toISOString()} - ${message}`, ...args);
  }

  debug(message, ...args) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`🔍 ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
}

module.exports = new Logger();