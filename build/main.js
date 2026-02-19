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
  }
  async onReady() {
    this.apiCaller = new import_api_caller.ApiCaller(this);
    this.log.info("Starting open-meteo-pv-forecast adapter");
    if (!this.config.locations || this.config.locations.length === 0) {
      this.log.warn("No locations configured. Please configure at least one location in the adapter settings.");
      return;
    }
    this.config.forecastHours = this.config.forecastHours || 24;
    this.config.forecastDays = this.config.forecastDays || 7;
    this.config.updateInterval = this.config.updateInterval || 60;
    await this.createStatesForLocations();
    await this.updateAllLocations();
    const intervalMs = this.config.updateInterval * 60 * 1e3;
    this.updateInterval = setInterval(() => {
      void this.updateAllLocations();
    }, intervalMs);
  }
  async createStatesForLocations() {
    for (const location of this.config.locations) {
      const locationName = this.sanitizeLocationName(location.name);
      await this.setObjectNotExistsAsync(locationName, {
        type: "channel",
        common: { name: location.name },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${locationName}.pv-forecast`, {
        type: "channel",
        common: { name: "PV Forecast" },
        native: {}
      });
      for (let hour = 0; hour < this.config.forecastHours; hour++) {
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
          type: "channel",
          common: { name: `Hour ${hour}` },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
          type: "state",
          common: { name: "Timestamp", type: "string", role: "date", read: true, write: false },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
          type: "state",
          common: {
            name: { en: "Global Tilted Irradiance", de: "Globalstrahlung auf geneigter Fl\xE4che" },
            type: "number",
            role: "value.power",
            unit: "Wh",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.temperature_2m`, {
          type: "state",
          common: {
            name: { en: "Temperature 2m", de: "Temperatur 2m" },
            type: "number",
            role: "value.temperature",
            unit: "\xB0C",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.cloud_cover`, {
          type: "state",
          common: {
            name: { en: "Cloud Cover", de: "Bew\xF6lkung" },
            type: "number",
            role: "value.percent",
            unit: "%",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.wind_speed_10m`, {
          type: "state",
          common: {
            name: { en: "Wind Speed 10m", de: "Windgeschwindigkeit 10m" },
            type: "number",
            role: "value.speed",
            unit: "km/h",
            read: true,
            write: false
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.sunshine_duration`, {
          type: "state",
          common: {
            name: { en: "Sunshine Duration", de: "Sonnenscheindauer" },
            type: "number",
            role: "value.duration",
            unit: "min",
            read: true,
            write: false
          },
          native: {}
        });
      }
      await this.setObjectNotExistsAsync(`${locationName}.daily-forecast`, {
        type: "channel",
        common: { name: "Daily Forecast" },
        native: {}
      });
      for (let day = 0; day < this.config.forecastDays; day++) {
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}`, {
          type: "channel",
          common: { name: `Day ${day}` },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Date`, {
          type: "state",
          common: { name: "Date", type: "string", role: "date", read: true, write: false },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Peak_day`, {
          type: "state",
          common: {
            name: { en: "Daily Peak Energy", de: "T\xE4glicher Spitzenertrag" },
            type: "number",
            role: "value.power.consumption",
            unit: "Wh",
            read: true,
            write: false
          },
          native: {}
        });
      }
    }
  }
  async updateAllLocations() {
    for (const location of this.config.locations) {
      try {
        await this.updateLocation(location);
      } catch (error) {
        this.log.error(`Error updating location ${location.name}: ${error.message}`);
      }
    }
  }
  async updateLocation(location) {
    var _a, _b;
    const locationName = this.sanitizeLocationName(location.name);
    const effectiveLocation = { ...location };
    const latMissing = effectiveLocation.latitude === void 0 || effectiveLocation.latitude === null || effectiveLocation.latitude === "";
    const lonMissing = effectiveLocation.longitude === void 0 || effectiveLocation.longitude === null || effectiveLocation.longitude === "";
    if (latMissing || lonMissing) {
      this.log.debug(`[${location.name}] Debug:longitude and/or latitude not set, loading system configuration`);
      const sysConfig = await this.getForeignObjectAsync("system.config");
      const sysLat = (_a = sysConfig == null ? void 0 : sysConfig.common) == null ? void 0 : _a.latitude;
      const sysLon = (_b = sysConfig == null ? void 0 : sysConfig.common) == null ? void 0 : _b.longitude;
      if (sysLat !== void 0 && sysLat !== null && sysLon !== void 0 && sysLon !== null) {
        effectiveLocation.latitude = sysLat;
        effectiveLocation.longitude = sysLon;
        this.log.info(
          `[${location.name}] using system latitude: ${effectiveLocation.latitude}, system longitude: ${effectiveLocation.longitude}`
        );
      } else {
        this.log.error(
          `[${location.name}] latitude and/or longitude not set and no system coordinates available. Skipping location.`
        );
        return;
      }
    }
    try {
      const data = await this.apiCaller.fetchForecastData(effectiveLocation, this.config.forecastDays);
      if (!data || !data.hourly || !data.hourly.time) {
        this.log.error(`[${location.name}] API lieferte keine Daten.`);
        return;
      }
      let kwpRaw = location.kwp;
      if (typeof kwpRaw === "string") {
        kwpRaw = kwpRaw.replace(",", ".");
      }
      const kwpFactor = parseFloat(kwpRaw) || 0;
      const dailySums = {};
      for (let i = 0; i < data.hourly.time.length; i++) {
        const timeStr = data.hourly.time[i];
        const rawIrradiance = data.hourly.global_tilted_irradiance[i];
        if (timeStr && rawIrradiance !== void 0) {
          const dateKey = timeStr.split("T")[0];
          if (!dailySums[dateKey]) {
            dailySums[dateKey] = 0;
          }
          dailySums[dateKey] += rawIrradiance * kwpFactor;
        }
      }
      const todayObj = /* @__PURE__ */ new Date();
      for (let day = 0; day < this.config.forecastDays; day++) {
        const targetDate = new Date(todayObj);
        targetDate.setDate(todayObj.getDate() + day);
        const dateKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
        const totalWh = Math.round(dailySums[dateKey] || 0);
        const formattedDisplayDate = `${String(targetDate.getDate()).padStart(2, "0")}.${String(targetDate.getMonth() + 1).padStart(2, "0")}.${targetDate.getFullYear()}`;
        await this.setState(`${locationName}.daily-forecast.day${day}.Date`, {
          val: formattedDisplayDate,
          ack: true
        });
        await this.setState(`${locationName}.daily-forecast.day${day}.Peak_day`, { val: totalWh, ack: true });
      }
      const now = /* @__PURE__ */ new Date();
      const currentHourStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours()
      ).getTime();
      let currentHourIndex = data.hourly.time.findIndex((t) => new Date(t).getTime() >= currentHourStart);
      if (currentHourIndex === -1) {
        currentHourIndex = 0;
      }
      for (let hour = 0; hour < this.config.forecastHours; hour++) {
        const idx = currentHourIndex + hour;
        if (idx < data.hourly.time.length) {
          const apiDate = new Date(data.hourly.time[idx]);
          const formattedTime = apiDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
          const powerW = Math.round(data.hourly.global_tilted_irradiance[idx] * kwpFactor);
          const totalSeconds = Math.round(data.hourly.sunshine_duration[idx] || 0);
          await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
            val: formattedTime,
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
            val: powerW,
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.temperature_2m`, {
            val: data.hourly.temperature_2m[idx],
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.cloud_cover`, {
            val: data.hourly.cloud_cover[idx],
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.wind_speed_10m`, {
            val: data.hourly.wind_speed_10m[idx],
            ack: true
          });
          await this.setState(`${locationName}.pv-forecast.hour${hour}.sunshine_duration`, {
            val: totalSeconds,
            ack: true
          });
        }
      }
      this.log.info(
        `[${location.name}] Update erfolgreich. Day0: ${Math.round(dailySums[Object.keys(dailySums)[0]] || 0)} Wh`
      );
    } catch (error) {
      this.log.error(`[${location.name}] Fehler: ${error.message}`);
    }
  }
  sanitizeLocationName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }
  onUnload(callback) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    callback();
  }
  onStateChange(id, state) {
    if (state && !state.ack) {
      this.log.debug(`DEBUG:state ${id} changed: ${state.val}`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new OpenMeteoPvForecast(options);
} else {
  (() => new OpenMeteoPvForecast())();
}
//# sourceMappingURL=main.js.map
