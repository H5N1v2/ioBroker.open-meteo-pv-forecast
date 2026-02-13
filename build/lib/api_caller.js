"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var api_caller_exports = {};
__export(api_caller_exports, {
  ApiCaller: () => ApiCaller
});
module.exports = __toCommonJS(api_caller_exports);
var import_axios = __toESM(require("axios"));
class ApiCaller {
  axiosInstance;
  /** Initialize the API caller with axios configuration */
  constructor() {
    this.axiosInstance = import_axios.default.create({
      timeout: 1e4
    });
  }
  /**
   * Fetch PV forecast data from Open-Meteo API
   *
   * @param location - Location configuration
   * @param forecastHours - Number of hours to forecast
   * @returns Promise with forecast data
   */
  async fetchForecastData(location, forecastHours) {
    const hourlyparam_keys = "global_tilted_irradiance";
    const url = `https://api.open-meteo.com/v1/forecast`;
    try {
      const response = await this.axiosInstance.get(url, {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          tilt: location.tilt,
          azimuth: location.azimuth,
          hourly: hourlyparam_keys,
          timezone: location.timezone,
          forecast_hours: forecastHours
        }
      });
      return response.data;
    } catch (error) {
      if (import_axios.default.isAxiosError(error)) {
        throw new Error(`Open-Meteo API error: ${error.message}`);
      }
      throw error;
    }
  }
  /**
   * Search for locations using Nominatim API
   *
   * @param query - Search query (address, city, etc.)
   * @returns Promise with search results
   */
  /*async searchLocation(query: string): Promise<NominatimResult[]> {
  		const url = `https://nominatim.openstreetmap.org/search`;
  
  		try {
  			const response = await this.axiosInstance.get<NominatimResult[]>(url, {
  				params: {
  					q: query,
  					format: 'json',
  				},
  				headers: {
  					'User-Agent': 'ioBroker.open-meteo-pv-forecast',
  				},
  			});
  
  			return response.data;
  		} catch (error) {
  			if (axios.isAxiosError(error)) {
  				throw new Error(`Nominatim API error: ${error.message}`);
  			}
  			throw error;
  		}
  	}*/
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApiCaller
});
//# sourceMappingURL=api_caller.js.map
