const translationService = require("../services/translationService");
const logger = require("../utils/logger");

class TranslationController {
  async translate(req, res) {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ 
          error: "Text is required" 
        });
      }

      const translated = await translationService.translateToEnglish(text);
      
      res.json({
        success: true,
        original: text,
        translated: translated,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Translated: "${text.substring(0, 50)}..."`);
    } catch (error) {
      logger.error(`Translation error: ${error.message}`);
      res.status(500).json({ 
        error: "Failed to translate text",
        details: error.message 
      });
    }
  }
}

module.exports = new TranslationController();