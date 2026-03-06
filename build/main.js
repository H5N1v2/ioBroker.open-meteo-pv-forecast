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
    await this.cleanupStaleObjects();
    await this.createStatesForLocations();
    await this.updateAllLocations();
    const intervalMs = this.config.updateInterval * 60 * 1e3;
    this.updateInterval = setInterval(() => {
      void this.updateAllLocations();
    }, intervalMs);
  }
  async cleanupStaleObjects() {
    if (!this.config.locationsTotal || this.config.locations.length <= 1) {
      const sumObj = await this.getObjectAsync("sum_peak_locations");
      if (sumObj) {
        await this.delObjectAsync("sum_peak_locations", { recursive: true });
        this.log.info(
          "Deleted sum_peak_locations channel (locationsTotal disabled or insufficient locations)."
        );
      }
    }
    const configuredNames = new Set(this.config.locations.map((l) => this.sanitizeLocationName(l.name)));
    const allObjects = await this.getAdapterObjectsAsync();
    for (const fullId of Object.keys(allObjects)) {
      const localId = fullId.replace(`${this.namespace}.`, "");
      if (!localId.includes(".") && allObjects[fullId].type === "channel" && localId !== "sum_peak_locations" && !configuredNames.has(localId)) {
        await this.delObjectAsync(localId, { recursive: true });
        this.log.info(`Deleted stale location channel: ${localId}`);
      }
    }
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
        common: {
          name: {
            en: "PV Forecast",
            de: "PV Prognose",
            ru: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 PV",
            pt: "Previs\xE3o PV",
            nl: "PV Voorspelling",
            fr: "Pr\xE9vision PV",
            it: "Previsione PV",
            es: "Pron\xF3stico PV",
            pl: "Prognoza PV",
            uk: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437 PV",
            "zh-cn": "\u5149\u4F0F\u9884\u6D4B"
          }
        },
        native: {}
      });
      for (let hour = 0; hour < this.config.forecastHours; hour++) {
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
          type: "channel",
          common: {
            name: {
              en: `Hour ${hour}`,
              de: `Stunde ${hour}`,
              ru: `\u0427\u0430\u0441 ${hour}`,
              pt: `Hora ${hour}`,
              nl: `Uur ${hour}`,
              fr: `Heure ${hour}`,
              it: `Ora ${hour}`,
              es: `Hora ${hour}`,
              pl: `Godzina ${hour}`,
              uk: `\u0413\u043E\u0434\u0438\u043D\u0430 ${hour}`,
              "zh-cn": `\u5C0F\u65F6 ${hour}`
            }
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
          type: "state",
          common: {
            name: {
              en: "Timestamp",
              de: "Zeitstempel",
              ru: "\u041C\u0435\u0442\u043A\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u0438",
              pt: "Carimbo de data/hora",
              nl: "Tijdstempel",
              fr: "Horodatage",
              it: "Timestamp",
              es: "Marca de tiempo",
              pl: "Znacznik czasu",
              uk: "\u041F\u043E\u0437\u043D\u0430\u0447\u043A\u0430 \u0447\u0430\u0441\u0443",
              "zh-cn": "\u65F6\u95F4\u6233"
            },
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
              de: "Globale Strahlung auf geneigter Fl\xE4che",
              ru: "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u0430\u044F \u043D\u0430\u043A\u043B\u043E\u043D\u043D\u0430\u044F \u043E\u0441\u0432\u0435\u0449\u0435\u043D\u043D\u043E\u0441\u0442\u044C",
              pt: "Irradi\xE2ncia Global Inclinada",
              nl: "Globale gekantelde instraling",
              fr: "Irradiance globale inclin\xE9e",
              it: "Irradianza inclinata globale",
              es: "Irradiancia global inclinada",
              pl: "Globalne pochylone nat\u0119\u017Cenie promieniowania",
              uk: "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u0435 \u043D\u0430\u0445\u0438\u043B\u0435\u043D\u0435 \u0432\u0438\u043F\u0440\u043E\u043C\u0456\u043D\u044E\u0432\u0430\u043D\u043D\u044F",
              "zh-cn": "\u5168\u7403\u503E\u659C\u8F90\u7167\u5EA6"
            },
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
            name: {
              en: "Temperature 2m",
              de: "Temperatur 2 m",
              ru: "\u0422\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u0430 2 \u043C",
              pt: "Temperatura 2m",
              nl: "Temperatuur 2m",
              fr: "Temp\xE9rature 2m",
              it: "Temperatura 2m",
              es: "Temperatura 2m",
              pl: "Temperatura 2m",
              uk: "\u0422\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u0430 2 \u043C",
              "zh-cn": "\u6E29\u5EA6 2 \u7C73"
            },
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
            name: {
              en: "Cloud Cover",
              de: "Wolkenbedeckung",
              ru: "\u041E\u0431\u043B\u0430\u0447\u043D\u043E\u0441\u0442\u044C",
              pt: "Cobertura de nuvens",
              nl: "Bewolking",
              fr: "Couverture nuageuse",
              it: "Copertura nuvolosa",
              es: "Cobertura de nubes",
              pl: "Zachmurzenie",
              uk: "\u0425\u043C\u0430\u0440\u043D\u0438\u0439 \u043F\u043E\u043A\u0440\u0438\u0432",
              "zh-cn": "\u4E91\u5C42\u8986\u76D6"
            },
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
            name: {
              en: "Wind Speed 10m",
              de: "Windgeschwindigkeit 10 m",
              ru: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0432\u0435\u0442\u0440\u0430 10 \u043C",
              pt: "Velocidade do vento 10m",
              nl: "Windsnelheid 10 m",
              fr: "Vitesse du vent 10 m",
              it: "Velocit\xE0 del vento 10 m",
              es: "Velocidad del viento 10m",
              pl: "Pr\u0119dko\u015B\u0107 wiatru 10m",
              uk: "\u0428\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C \u0432\u0456\u0442\u0440\u0443 10 \u043C",
              "zh-cn": "\u98CE\u901F 10 \u7C73"
            },
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
            name: {
              en: "Sunshine Duration",
              de: "Sonnenscheindauer",
              ru: "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u0441\u043E\u043B\u043D\u0435\u0447\u043D\u043E\u0433\u043E \u0441\u0438\u044F\u043D\u0438\u044F",
              pt: "Dura\xE7\xE3o da luz solar",
              nl: "Zonneschijnduur",
              fr: "Dur\xE9e d'ensoleillement",
              it: "Durata del sole",
              es: "Duraci\xF3n de la luz solar",
              pl: "Czas trwania nas\u0142onecznienia",
              uk: "\u0422\u0440\u0438\u0432\u0430\u043B\u0456\u0441\u0442\u044C \u0441\u043E\u043D\u044F\u0447\u043D\u043E\u0433\u043E \u0441\u0432\u0456\u0442\u043B\u0430",
              "zh-cn": "\u65E5\u7167\u65F6\u957F"
            },
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
        common: {
          name: {
            en: "Daily Forecast",
            de: "T\xE4gliche Prognose",
            ru: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043F\u0440\u043E\u0433\u043D\u043E\u0437",
            pt: "Previs\xE3o di\xE1ria",
            nl: "Dagelijkse voorspelling",
            fr: "Pr\xE9vision quotidienne",
            it: "Previsione giornaliera",
            es: "Pron\xF3stico diario",
            pl: "Prognoza dzienna",
            uk: "\u0429\u043E\u0434\u0435\u043D\u043D\u0438\u0439 \u043F\u0440\u043E\u0433\u043D\u043E\u0437",
            "zh-cn": "\u6BCF\u65E5\u9884\u6D4B"
          }
        },
        native: {}
      });
      for (let day = 0; day < this.config.forecastDays; day++) {
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}`, {
          type: "channel",
          common: {
            name: {
              en: `Day ${day}`,
              de: `Tag ${day}`,
              ru: `\u0414\u0435\u043D\u044C ${day}`,
              pt: `Dia ${day}`,
              nl: `Dag ${day}`,
              fr: `Jour ${day}`,
              it: `Giorno ${day}`,
              es: `D\xEDa ${day}`,
              pl: `Dzie\u0144 ${day}`,
              uk: `\u0414\u0435\u043D\u044C ${day}`,
              "zh-cn": `\u5929 ${day}`
            }
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Date`, {
          type: "state",
          common: {
            name: {
              en: "Date",
              de: "Datum",
              ru: "\u0414\u0430\u0442\u0430",
              pt: "Data",
              nl: "Datum",
              fr: "Date",
              it: "Data",
              es: "Fecha",
              pl: "Data",
              uk: "\u0414\u0430\u0442\u0430",
              "zh-cn": "\u65E5\u671F"
            },
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
              de: "T\xE4gliche Spitzenenergie",
              ru: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043F\u0438\u043A \u044D\u043D\u0435\u0440\u0433\u0438\u0438",
              pt: "Energia de pico di\xE1ria",
              nl: "Dagelijkse piekenergie",
              fr: "\xC9nergie maximale quotidienne",
              it: "Energia di picco giornaliera",
              es: "Energ\xEDa m\xE1xima diaria",
              pl: "Dzienny szczyt energetyczny",
              uk: "\u0414\u043E\u0431\u043E\u0432\u0438\u0439 \u043F\u0456\u043A\u043E\u0432\u0438\u0439 \u0435\u043D\u0435\u0440\u0433\u043E\u0441\u043F\u043E\u0436\u0438\u0432\u0430\u043D\u043D\u044F",
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
    }
    if (this.config.locationsTotal && this.config.locations.length > 1) {
      await this.setObjectNotExistsAsync("sum_peak_locations", {
        type: "channel",
        common: {
          name: {
            en: "Sum Peak from Locations",
            de: "Summe der Spitzenwerte von Standorten",
            ru: "\u0421\u0443\u043C\u043C\u0430\u0440\u043D\u044B\u0439 \u043F\u0438\u043A \u0438\u0437 \u0440\u0430\u0437\u043D\u044B\u0445 \u043C\u0435\u0441\u0442",
            pt: "Soma dos Picos a partir de Localiza\xE7\xF5es",
            nl: "Som van pieken vanaf locaties",
            fr: "Somme des sommets depuis les emplacements",
            it: "Somma Picco da Posizioni",
            es: "Sum Peak desde Ubicaciones",
            pl: "Sum Peak z lokalizacji",
            uk: "\u0421\u0443\u043C\u0430 \u041F\u0456\u043A \u0437 \u043C\u0456\u0441\u0446\u044C \u0440\u043E\u0437\u0442\u0430\u0448\u0443\u0432\u0430\u043D\u043D\u044F",
            "zh-cn": "\u4ECE\u4F4D\u7F6E\u4E0A\u770B\uFF0CSum Peak"
          }
        },
        native: {}
      });
      for (let day = 0; day < this.config.forecastDays; day++) {
        await this.setObjectNotExistsAsync(`sum_peak_locations.day${day}`, {
          type: "channel",
          common: {
            name: {
              en: `Day ${day}`,
              de: `Tag ${day}`,
              ru: `\u0414\u0435\u043D\u044C ${day}`,
              pt: `Dia ${day}`,
              nl: `Dag ${day}`,
              fr: `Jour ${day}`,
              it: `Giorno ${day}`,
              es: `D\xEDa ${day}`,
              pl: `Dzie\u0144 ${day}`,
              uk: `\u0414\u0435\u043D\u044C ${day}`,
              "zh-cn": `\u5929 ${day}`
            }
          },
          native: {}
        });
        await this.setObjectNotExistsAsync(`sum_peak_locations.day${day}.sum_locations`, {
          type: "state",
          common: {
            name: {
              en: "Sum of all locations",
              de: "Summe aller Standorte",
              ru: "\u0421\u0443\u043C\u043C\u0430 \u0432\u0441\u0435\u0445 \u043C\u0435\u0441\u0442",
              pt: "Soma de todas as localiza\xE7\xF5es",
              nl: "Som van alle locaties",
              fr: "Somme de tous les emplacements",
              it: "Somma di tutte le posizioni",
              es: "Suma de todas las ubicaciones",
              pl: "Suma wszystkich lokalizacji",
              uk: "\u0421\u0443\u043C\u0430 \u0432\u0441\u0456\u0445 \u043C\u0456\u0441\u0446\u044C \u0440\u043E\u0437\u0442\u0430\u0448\u0443\u0432\u0430\u043D\u043D\u044F",
              "zh-cn": "\u6240\u6709\u4F4D\u7F6E\u7684\u603B\u548C"
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
    await this.updateSumLocations();
  }
  async updateSumLocations() {
    if (!this.config.locationsTotal || this.config.locations.length <= 1) {
      return;
    }
    for (let day = 0; day < this.config.forecastDays; day++) {
      let sum = 0;
      for (const location of this.config.locations) {
        const locationName = this.sanitizeLocationName(location.name);
        const state = await this.getStateAsync(`${locationName}.daily-forecast.day${day}.Peak_day`);
        if (state && state.val !== null && state.val !== void 0) {
          sum += state.val;
        }
      }
      await this.setState(`sum_peak_locations.day${day}.sum_locations`, { val: sum, ack: true });
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
