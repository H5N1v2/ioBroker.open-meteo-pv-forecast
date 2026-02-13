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
    this.on("message", this.onMessage.bind(this));
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
            unit: "W/m\xB2",
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
      const data = await this.apiCaller.fetchForecastData(location, this.config.forecastHours);
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
          await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
            val: time,
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
            val: calculatedPower,
            ack: true
          });
        }
      }
      this.log.debug(`Successfully updated ${hoursToUpdate} hours for ${location.name}`);
    } catch (error) {
      this.log.error(`Failed to fetch data for ${location.name}: ${error.message}`);
      throw error;
    }
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
  async onMessage(obj) {
    var _a, _b;
    if (typeof obj === "object" && obj.message) {
      if (obj.command === "searchLocation") {
        try {
          const query = obj.message;
          this.log.debug(`Searching for location: ${query}`);
          const results = await this.apiCaller.searchLocation(query);
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, results, obj.callback);
          }
        } catch (error) {
          this.log.error(`Error searching location: ${error.message}`);
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
          }
        }
      } else if (obj.command === "getSystemConfig") {
        try {
          const systemConfig = await this.getForeignObjectAsync("system.config");
          const result = {
            latitude: ((_a = systemConfig == null ? void 0 : systemConfig.common) == null ? void 0 : _a.latitude) || 0,
            longitude: ((_b = systemConfig == null ? void 0 : systemConfig.common) == null ? void 0 : _b.longitude) || 0,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
          };
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, result, obj.callback);
          }
        } catch (error) {
          this.log.error(`Error getting system config: ${error.message}`);
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
          }
        }
      }
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new OpenMeteoPvForecast(options);
} else {
  (() => new OpenMeteoPvForecast())();
}
//# sourceMappingURL=main.js.map
