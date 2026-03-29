const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

class FatSecretService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.clientId = config.fatsecret.clientId;
    this.clientSecret = config.fatsecret.clientSecret;
  }

  async getToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        "https://oauth.fatsecret.com/connect/token",
        new URLSearchParams({
          grant_type: "client_credentials",
          scope: "premier"
        }),
        {
          auth: {
            username: this.clientId,
            password: this.clientSecret
          },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;

      logger.info("FatSecret token refreshed");
      return this.accessToken;
    } catch (error) {
      logger.error(`FatSecret token error: ${error.message}`);
      if (error.response) {
        logger.error(`Response: ${JSON.stringify(error.response.data)}`);
      }
      return null;
    }
  }

  async searchFoods(query) {
    try {
      const token = await this.getToken();
      if (!token) return [];

      const response = await axios.post(
        "https://platform.fatsecret.com/rest/server.api",
        null,
        {
          params: {
            method: "foods.search.v4",
            search_expression: query,
            format: "json"
          },
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const foods = response.data?.foods_search?.results?.food || [];
      const list = Array.isArray(foods) ? foods : [foods];

      return list.slice(0, 5).map(f => {
        const serving = Array.isArray(f.servings?.serving)
          ? f.servings.serving[0]
          : f.servings?.serving;

        return {
          name: f.food_name,
          calories: Number(serving?.calories || 0),
          protein: Number(serving?.protein || 0),
          carbs: Number(serving?.carbohydrate || 0),
          fat: Number(serving?.fat || 0),
          source: "fatsecret"
        };
      });
    } catch (error) {
      logger.error("FatSecret search failed");
      return [];
    }
  }
}

module.exports = new FatSecretService();