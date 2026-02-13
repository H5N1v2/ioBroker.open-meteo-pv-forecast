"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_api_caller = require("./lib/api_caller");
class OpenMeteoPvForecast extends utils.Adapter {
  apiCaller;
  updateInterval;
  constructor(options = {}) {
    super({
      ...options,
      name: "open-meteo-pv-forecast"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.apiCaller = new import_api_caller.ApiCaller();
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.log.info("Starting open-meteo-pv-forecast adapter");
    if (!this.config.locations || this.config.locations.length === 0) {
      this.log.warn("No locations configured. Please configure at least one location in the adapter settings.");
      return;
    }
    if (!this.config.forecastHours) {
      this.config.forecastHours = 24;
    }
    if (!this.config.forecastDays) {
      this.config.forecastDays = 7;
    }
    if (!this.config.updateInterval) {
      this.config.updateInterval = 60;
    }
    await this.createStatesForLocations();
    await this.updateAllLocations();
    const intervalMs = this.config.updateInterval * 60 * 1e3;
    this.updateInterval = setInterval(() => {
      void this.updateAllLocations();
    }, intervalMs);
    this.log.info(
      `Adapter configured with ${this.config.locations.length} location(s), updating every ${this.config.updateInterval} minutes`
    );
  }
  /**
   * Create state objects for all configured locations
   */
  async createStatesForLocations() {
    for (const location of this.config.locations) {
      const locationName = this.sanitizeLocationName(location.name);
      await this.setObjectNotExistsAsync(locationName, {
        type: "channel",
        common: {
          name: location.name
        },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${locationName}.pv-forecast`, {
        type: "channel",
        common: {
          name: "PV Forecast"
        },
        native: {}
      });
      for (let hour = 0; hour < this.config.forecastHours; hour++) {
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
          type: "channel",
          common: {
            name: `Hour ${hour}`
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
          type: "state",
          common: {
            name: "Timestamp",
            type: "string",
            role: "date",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
          type: "state",
          common: {
            name: {
              en: "Global Tilted Irradiance",
              de: "Globalstrahlung auf geneigter Fl\xE4che",
              ru: "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u043E\u0435 \u041D\u0430\u043A\u043B\u043E\u043D\u043D\u043E\u0435 \u041E\u0431\u043B\u0443\u0447\u0435\u043D\u0438\u0435",
              pt: "Irradi\xE2ncia Global Inclinada",
              nl: "Globale Gekantelde Instraling",
              fr: "Irradiation Globale Inclin\xE9e",
              it: "Irradianza Globale Inclinata",
              es: "Irradiancia Global Inclinada",
              pl: "Globalne Napromieniowanie Nachylone",
              uk: "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u0435 \u041D\u0430\u0445\u0438\u043B\u0435\u043D\u0435 \u041E\u043F\u0440\u043E\u043C\u0456\u043D\u0435\u043D\u043D\u044F",
              "zh-cn": "\u5168\u5C40\u503E\u659C\u8F90\u7167\u5EA6"
            },
            type: "number",
            role: "value.power",
            unit: "W",
            read: true,
            write: false
          },
          native: {}
        });
      }
      await this.setObjectNotExistsAsync(`${locationName}.daily-forecast`, {
        type: "channel",
        common: {
          name: "Daily Forecast"
        },
        native: {}
      });
      for (let day = 0; day < this.config.forecastDays; day++) {
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}`, {
          type: "channel",
          common: {
            name: `Day ${day}`
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Date`, {
          type: "state",
          common: {
            name: "Date",
            type: "string",
            role: "date",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Peak_day`, {
          type: "state",
          common: {
            name: {
              en: "Daily Peak Energy",
              de: "T\xE4glicher Spitzenertrag",
              ru: "\u0414\u043D\u0435\u0432\u043D\u0430\u044F \u041F\u0438\u043A\u043E\u0432\u0430\u044F \u042D\u043D\u0435\u0440\u0433\u0438\u044F",
              pt: "Energia de Pico Di\xE1ria",
              nl: "Dagelijkse Piekenergie",
              fr: "\xC9nergie de Pointe Quotidienne",
              it: "Energia di Picco Giornaliera",
              es: "Energ\xEDa Pico Diaria",
              pl: "Dzienna Energia Szczytowa",
              uk: "\u0414\u0435\u043D\u043D\u0430 \u041F\u0456\u043A\u043E\u0432\u0430 \u0415\u043D\u0435\u0440\u0433\u0456\u044F",
              "zh-cn": "\u6BCF\u65E5\u5CF0\u503C\u80FD\u91CF"
            },
            type: "number",
            role: "value.power.consumption",
            unit: "Wh",
            read: true,
            write: false
          },
          native: {}
        });
      }
      this.log.debug(`Created states for location: ${location.name}`);
    }
  }
  /**
   * Update forecast data for all locations
   */
  async updateAllLocations() {
    this.log.info("Updating forecast data for all locations");
    for (const location of this.config.locations) {
      try {
        await this.updateLocation(location);
      } catch (error) {
        this.log.error(`Error updating location ${location.name}: ${error.message}`);
      }
    }
  }
  /**
   * Update forecast data for a specific location
   *
   * @param location - Location configuration
   */
  async updateLocation(location) {
    this.log.debug(`Fetching forecast for ${location.name}`);
    try {
      const hoursNeeded = Math.max(this.config.forecastHours, this.config.forecastDays * 24);
      const data = await this.apiCaller.fetchForecastData(location, hoursNeeded);
      if (!data.hourly || !data.hourly.time || !data.hourly.global_tilted_irradiance) {
        this.log.error(`Invalid data received from API for location ${location.name}`);
        return;
      }
      const locationName = this.sanitizeLocationName(location.name);
      const currentTime = /* @__PURE__ */ new Date();
      const currentHour = new Date(
        currentTime.getFullYear(),
        currentTime.getMonth(),
        currentTime.getDate(),
        currentTime.getHours()
      );
      let currentHourIndex = -1;
      for (let i = 0; i < data.hourly.time.length; i++) {
        const apiTime = new Date(data.hourly.time[i]);
        if (apiTime >= currentHour) {
          currentHourIndex = i;
          break;
        }
      }
      if (currentHourIndex === -1) {
        this.log.warn(`Could not find current hour in API response for ${location.name}`);
        currentHourIndex = 0;
      }
      const hoursToUpdate = Math.min(this.config.forecastHours, data.hourly.time.length - currentHourIndex);
      for (let hour = 0; hour < hoursToUpdate; hour++) {
        const dataIndex = currentHourIndex + hour;
        const time = dataIndex < data.hourly.time.length ? data.hourly.time[dataIndex] : null;
        const rawIrradiance = data.hourly.global_tilted_irradiance[dataIndex];
        const kwpFactor = location.kwp || 0;
        const calculatedPower = Math.round(rawIrradiance * kwpFactor);
        if (time) {
          const apiDate = new Date(time);
          const formattedTime = apiDate.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
            val: formattedTime,
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
            val: calculatedPower,
            ack: true
          });
        }
      }
      this.log.debug(`Successfully updated ${hoursToUpdate} hours for ${location.name}`);
      await this.updateDailyForecast(location, data, currentHourIndex, locationName);
    } catch (error) {
      this.log.error(`Failed to fetch data for ${location.name}: ${error.message}`);
      throw error;
    }
  }
  /**
   * Calculate and update daily forecast data from hourly data
   *
   * @param location - Location configuration
   * @param data - API response data
   * @param currentHourIndex - Index of the current hour in the API response
   * @param locationName - Sanitized location name
   */
  async updateDailyForecast(location, data, currentHourIndex, locationName) {
    const kwpFactor = location.kwp || 0;
    const dailySums = /* @__PURE__ */ new Map();
    for (let i = currentHourIndex; i < data.hourly.time.length; i++) {
      const timeStr = data.hourly.time[i];
      const rawIrradiance = data.hourly.global_tilted_irradiance[i];
      if (!timeStr || rawIrradiance === void 0) {
        continue;
      }
      const hourDate = new Date(timeStr);
      const dateKey = hourDate.toISOString().split("T")[0];
      const calculatedPower = rawIrradiance * kwpFactor;
      if (!dailySums.has(dateKey)) {
        dailySums.set(dateKey, { sum: 0, date: hourDate });
      }
      const dayData = dailySums.get(dateKey);
      dayData.sum += calculatedPower;
    }
    const sortedDays = Array.from(dailySums.entries()).map(([dateKey, data2]) => ({ dateKey, ...data2 })).sort((a, b) => a.date.getTime() - b.date.getTime());
    const daysToUpdate = Math.min(this.config.forecastDays, sortedDays.length);
    for (let day = 0; day < daysToUpdate; day++) {
      const dayData = sortedDays[day];
      const formattedDate = dayData.date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      const roundedSum = Math.round(dayData.sum);
      await this.setState(`${locationName}.daily-forecast.day${day}.Date`, {
        val: formattedDate,
        ack: true
      });
      await this.setState(`${locationName}.daily-forecast.day${day}.Peak_day`, {
        val: roundedSum,
        ack: true
      });
    }
    this.log.debug(`Successfully updated ${daysToUpdate} days for ${location.name}`);
  }
  /**
   * Sanitize location name for use in state IDs
   *
   * @param name - Location name to sanitize
   * @returns Sanitized name
   */
  sanitizeLocationName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      this.log.info("Adapter stopped");
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id - State ID
   * @param state - State object
   */
  onStateChange(id, state) {
    if (state && !state.ack) {
      this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    }
  }
  /**
   * Handle messages from admin UI
   *
   * @param obj - Message object
   */
  /*	private async onMessage(obj: ioBroker.Message): Promise<void> {
  		if (typeof obj === 'object' && obj.message) {
  			if (obj.command === 'searchLocation') {
  				try {
  					const query = obj.message as string;
  					this.log.debug(`Searching for location: ${query}`);
  
  					const results = await this.apiCaller.searchLocation(query);
  
  					if (obj.callback) {
  						this.sendTo(obj.from, obj.command, results, obj.callback);
  					}
  				} catch (error) {
  					this.log.error(`Error searching location: ${(error as Error).message}`);
  					if (obj.callback) {
  						this.sendTo(obj.from, obj.command, { error: (error as Error).message }, obj.callback);
  					}
  				}
  			} else if (obj.command === 'getSystemConfig') {
  				try {
  					// Get system configuration (latitude, longitude, timezone)
  					const systemConfig = await this.getForeignObjectAsync('system.config');
  
  					const result = {
  						latitude: systemConfig?.common?.latitude || 0,
  						longitude: systemConfig?.common?.longitude || 0,
  						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  					};
  
  					if (obj.callback) {
  						this.sendTo(obj.from, obj.command, result, obj.callback);
  					}
  				} catch (error) {
  					this.log.error(`Error getting system config: ${(error as Error).message}`);
  					if (obj.callback) {
  						this.sendTo(obj.from, obj.command, { error: (error as Error).message }, obj.callback);
  					}
  				}
  			}
  		}
  	}*/
}
if (require.main !== module) {
  module.exports = (options) => new OpenMeteoPvForecast(options);
} else {
  (() => new OpenMeteoPvForecast())();
}
//# sourceMappingURL=main.js.map
