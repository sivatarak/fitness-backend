require("dotenv").config();

module.exports = {
  // Server config
  port: process.env.PORT || 10000,
  env: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL,
  
  // FatSecret API
  fatsecret: {
    clientId: process.env.FATSECRET_CLIENT_ID,
    clientSecret: process.env.FATSECRET_CLIENT_SECRET,
  },
  
  // USDA API
  usda: {
    apiKey: process.env.USDA_API_KEY,
  },
  
  // Translation config
  translation: {
    defaultTarget: "en",
    fallbackLang: "te",
  }
};