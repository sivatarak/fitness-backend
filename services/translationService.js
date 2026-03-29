const translate = require("google-translate-api-x");
const sql = require("../api/db");
const logger = require("../utils/logger");

class TranslationService {
  async translateToEnglish(text) {
    try {
      // Check translation cache first
      const cached = await sql`
        SELECT translated_text 
        FROM translation_cache 
        WHERE source_text = ${text.toLowerCase()}
      `;

      if (cached.length > 0) {
        // Update usage stats
        await sql`
          UPDATE translation_cache 
          SET times_used = times_used + 1, last_used = NOW() 
          WHERE source_text = ${text.toLowerCase()}
        `;
        logger.debug(`Translation from cache: ${cached[0].translated_text}`);
        return cached[0].translated_text;
      }

      // First translation
      let result = await translate(text, { to: "en" });
      let translated = result.text.toLowerCase();

      logger.debug(`Translated step1: ${translated}`);

      // If it looks like transliteration, try again
      if (translated === text.toLowerCase()) {
        const retry = await translate(translated, { from: "te", to: "en" });
        translated = retry.text.toLowerCase();
        logger.debug(`Translated step2: ${translated}`);
      }

      // Cache the translation
      await sql`
        INSERT INTO translation_cache (source_text, translated_text, times_used)
        VALUES (${text.toLowerCase()}, ${translated}, 1)
        ON CONFLICT (source_text) DO UPDATE
        SET translated_text = ${translated}, times_used = translation_cache.times_used + 1, last_used = NOW()
      `;

      return translated;
    } catch (error) {
      logger.error(`Translation error: ${error.message}`);
      return text.toLowerCase();
    }
  }
}

module.exports = new TranslationService();