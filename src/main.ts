/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';
import { ApiCaller } from './lib/api_caller';
import type { Location } from './lib/adapter-config';

class OpenMeteoPvForecast extends utils.Adapter {
	private apiCaller!: ApiCaller;
	private updateInterval?: NodeJS.Timeout;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'open-meteo-pv-forecast',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	private async onReady(): Promise<void> {
		this.apiCaller = new ApiCaller(this);

		this.log.info('Starting open-meteo-pv-forecast adapter');

		if (!this.config.locations || this.config.locations.length === 0) {
			this.log.warn('No locations configured. Please configure at least one location in the adapter settings.');
			return;
		}

		// Defaults
		this.config.forecastHours = this.config.forecastHours || 24;
		this.config.forecastDays = this.config.forecastDays || 7;
		this.config.updateInterval = this.config.updateInterval || 60;

		await this.cleanupStaleObjects();
		await this.createStatesForLocations();
		await this.updateAllLocations();

		const intervalMs = this.config.updateInterval * 60 * 1000;
		this.updateInterval = setInterval(() => {
			void this.updateAllLocations();
		}, intervalMs);
	}

	private async cleanupStaleObjects(): Promise<void> {
		// 1. sum_peak_locations löschen falls locationsTotal deaktiviert oder weniger als 2 Locations
		if (!this.config.locationsTotal || this.config.locations.length <= 1) {
			const sumObj = await this.getObjectAsync('sum_peak_locations');
			if (sumObj) {
				await this.delObjectAsync('sum_peak_locations', { recursive: true });
				this.log.info(
					'Deleted sum_peak_locations channel (locationsTotal disabled or insufficient locations).',
				);
			}
		}

		// 2. Verwaiste Location-Channels löschen (Standort wurde aus den Einstellungen entfernt)
		const configuredNames = new Set(this.config.locations.map(l => this.sanitizeLocationName(l.name)));
		const allObjects = await this.getAdapterObjectsAsync();
		for (const fullId of Object.keys(allObjects)) {
			const localId = fullId.replace(`${this.namespace}.`, '');
			if (
				!localId.includes('.') &&
				allObjects[fullId].type === 'channel' &&
				localId !== 'sum_peak_locations' &&
				!configuredNames.has(localId)
			) {
				await this.delObjectAsync(localId, { recursive: true });
				this.log.info(`Deleted stale location channel: ${localId}`);
			}
		}
	}

	private async createStatesForLocations(): Promise<void> {
		for (const location of this.config.locations) {
			const locationName = this.sanitizeLocationName(location.name);

			await this.setObjectNotExistsAsync(locationName, {
				type: 'channel',
				common: { name: location.name },
				native: {},
			});

			await this.setObjectNotExistsAsync(`${locationName}.pv-forecast`, {
				type: 'channel',
				common: {
					name: {
						en: 'PV Forecast',
						de: 'PV Prognose',
						ru: 'Прогноз PV',
						pt: 'Previsão PV',
						nl: 'PV Voorspelling',
						fr: 'Prévision PV',
						it: 'Previsione PV',
						es: 'Pronóstico PV',
						pl: 'Prognoza PV',
						uk: 'Прогноз PV',
						'zh-cn': '光伏预测',
					},
				},
				native: {},
			});

			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
					type: 'channel',
					common: {
						name: {
							en: `Hour ${hour}`,
							de: `Stunde ${hour}`,
							ru: `Час ${hour}`,
							pt: `Hora ${hour}`,
							nl: `Uur ${hour}`,
							fr: `Heure ${hour}`,
							it: `Ora ${hour}`,
							es: `Hora ${hour}`,
							pl: `Godzina ${hour}`,
							uk: `Година ${hour}`,
							'zh-cn': `小时 ${hour}`,
						},
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
					type: 'state',
					common: {
						name: {
							en: 'Timestamp',
							de: 'Zeitstempel',
							ru: 'Метка времени',
							pt: 'Carimbo de data/hora',
							nl: 'Tijdstempel',
							fr: 'Horodatage',
							it: 'Timestamp',
							es: 'Marca de tiempo',
							pl: 'Znacznik czasu',
							uk: 'Позначка часу',
							'zh-cn': '时间戳',
						},
						type: 'string',
						role: 'date',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
					type: 'state',
					common: {
						name: {
							en: 'Global Tilted Irradiance',
							de: 'Globale Strahlung auf geneigter Fläche',
							ru: 'Глобальная наклонная освещенность',
							pt: 'Irradiância Global Inclinada',
							nl: 'Globale gekantelde instraling',
							fr: 'Irradiance globale inclinée',
							it: 'Irradianza inclinata globale',
							es: 'Irradiancia global inclinada',
							pl: 'Globalne pochylone natężenie promieniowania',
							uk: 'Глобальне нахилене випромінювання',
							'zh-cn': '全球倾斜辐照度',
						},
						type: 'number',
						role: 'value.power',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.temperature_2m`, {
					type: 'state',
					common: {
						name: {
							en: 'Temperature 2m',
							de: 'Temperatur 2 m',
							ru: 'Температура 2 м',
							pt: 'Temperatura 2m',
							nl: 'Temperatuur 2m',
							fr: 'Température 2m',
							it: 'Temperatura 2m',
							es: 'Temperatura 2m',
							pl: 'Temperatura 2m',
							uk: 'Температура 2 м',
							'zh-cn': '温度 2 米',
						},
						type: 'number',
						role: 'value.temperature',
						unit: '°C',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.cloud_cover`, {
					type: 'state',
					common: {
						name: {
							en: 'Cloud Cover',
							de: 'Wolkenbedeckung',
							ru: 'Облачность',
							pt: 'Cobertura de nuvens',
							nl: 'Bewolking',
							fr: 'Couverture nuageuse',
							it: 'Copertura nuvolosa',
							es: 'Cobertura de nubes',
							pl: 'Zachmurzenie',
							uk: 'Хмарний покрив',
							'zh-cn': '云层覆盖',
						},
						type: 'number',
						role: 'value.percent',
						unit: '%',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.wind_speed_10m`, {
					type: 'state',
					common: {
						name: {
							en: 'Wind Speed 10m',
							de: 'Windgeschwindigkeit 10 m',
							ru: 'Скорость ветра 10 м',
							pt: 'Velocidade do vento 10m',
							nl: 'Windsnelheid 10 m',
							fr: 'Vitesse du vent 10 m',
							it: 'Velocità del vento 10 m',
							es: 'Velocidad del viento 10m',
							pl: 'Prędkość wiatru 10m',
							uk: 'Швидкість вітру 10 м',
							'zh-cn': '风速 10 米',
						},
						type: 'number',
						role: 'value.speed',
						unit: 'km/h',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.sunshine_duration`, {
					type: 'state',
					common: {
						name: {
							en: 'Sunshine Duration',
							de: 'Sonnenscheindauer',
							ru: 'Продолжительность солнечного сияния',
							pt: 'Duração da luz solar',
							nl: 'Zonneschijnduur',
							fr: "Durée d'ensoleillement",
							it: 'Durata del sole',
							es: 'Duración de la luz solar',
							pl: 'Czas trwania nasłonecznienia',
							uk: 'Тривалість сонячного світла',
							'zh-cn': '日照时长',
						},
						type: 'number',
						role: 'value.duration',
						unit: 'min',
						read: true,
						write: false,
					},
					native: {},
				});
			}

			await this.setObjectNotExistsAsync(`${locationName}.daily-forecast`, {
				type: 'channel',
				common: {
					name: {
						en: 'Daily Forecast',
						de: 'Tägliche Prognose',
						ru: 'Ежедневный прогноз',
						pt: 'Previsão diária',
						nl: 'Dagelijkse voorspelling',
						fr: 'Prévision quotidienne',
						it: 'Previsione giornaliera',
						es: 'Pronóstico diario',
						pl: 'Prognoza dzienna',
						uk: 'Щоденний прогноз',
						'zh-cn': '每日预测',
					},
				},
				native: {},
			});

			for (let day = 0; day < this.config.forecastDays; day++) {
				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}`, {
					type: 'channel',
					common: {
						name: {
							en: `Day ${day}`,
							de: `Tag ${day}`,
							ru: `День ${day}`,
							pt: `Dia ${day}`,
							nl: `Dag ${day}`,
							fr: `Jour ${day}`,
							it: `Giorno ${day}`,
							es: `Día ${day}`,
							pl: `Dzień ${day}`,
							uk: `День ${day}`,
							'zh-cn': `天 ${day}`,
						},
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Date`, {
					type: 'state',
					common: {
						name: {
							en: 'Date',
							de: 'Datum',
							ru: 'Дата',
							pt: 'Data',
							nl: 'Datum',
							fr: 'Date',
							it: 'Data',
							es: 'Fecha',
							pl: 'Data',
							uk: 'Дата',
							'zh-cn': '日期',
						},
						type: 'string',
						role: 'date',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Peak_day`, {
					type: 'state',
					common: {
						name: {
							en: 'Daily Peak Energy',
							de: 'Tägliche Spitzenenergie',
							ru: 'Ежедневный пик энергии',
							pt: 'Energia de pico diária',
							nl: 'Dagelijkse piekenergie',
							fr: 'Énergie maximale quotidienne',
							it: 'Energia di picco giornaliera',
							es: 'Energía máxima diaria',
							pl: 'Dzienny szczyt energetyczny',
							uk: 'Добовий піковий енергоспоживання',
							'zh-cn': '每日峰值能量',
						},
						type: 'number',
						role: 'value.power.consumption',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});
			}
		}

		if (this.config.locationsTotal && this.config.locations.length > 1) {
			await this.setObjectNotExistsAsync('sum_peak_locations', {
				type: 'channel',
				common: {
					name: {
						en: 'Sum Peak from Locations',
						de: 'Summe der Spitzenwerte von Standorten',
						ru: 'Суммарный пик из разных мест',
						pt: 'Soma dos Picos a partir de Localizações',
						nl: 'Som van pieken vanaf locaties',
						fr: 'Somme des sommets depuis les emplacements',
						it: 'Somma Picco da Posizioni',
						es: 'Sum Peak desde Ubicaciones',
						pl: 'Sum Peak z lokalizacji',
						uk: 'Сума Пік з місць розташування',
						'zh-cn': '从位置上看，Sum Peak',
					},
				},
				native: {},
			});

			for (let day = 0; day < this.config.forecastDays; day++) {
				await this.setObjectNotExistsAsync(`sum_peak_locations.day${day}`, {
					type: 'channel',
					common: {
						name: {
							en: `Day ${day}`,
							de: `Tag ${day}`,
							ru: `День ${day}`,
							pt: `Dia ${day}`,
							nl: `Dag ${day}`,
							fr: `Jour ${day}`,
							it: `Giorno ${day}`,
							es: `Día ${day}`,
							pl: `Dzień ${day}`,
							uk: `День ${day}`,
							'zh-cn': `天 ${day}`,
						},
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`sum_peak_locations.day${day}.sum_locations`, {
					type: 'state',
					common: {
						name: {
							en: 'Sum of all locations',
							de: 'Summe aller Standorte',
							ru: 'Сумма всех мест',
							pt: 'Soma de todas as localizações',
							nl: 'Som van alle locaties',
							fr: 'Somme de tous les emplacements',
							it: 'Somma di tutte le posizioni',
							es: 'Suma de todas las ubicaciones',
							pl: 'Suma wszystkich lokalizacji',
							uk: 'Сума всіх місць розташування',
							'zh-cn': '所有位置的总和',
						},
						type: 'number',
						role: 'value.power.consumption',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});
			}
		}
	}

	private async updateAllLocations(): Promise<void> {
		for (const location of this.config.locations) {
			try {
				await this.updateLocation(location);
			} catch (error) {
				this.log.error(`Error updating location ${location.name}: ${(error as Error).message}`);
			}
		}
		await this.updateSumLocations();
	}

	private async updateSumLocations(): Promise<void> {
		if (!this.config.locationsTotal || this.config.locations.length <= 1) {
			return;
		}

		for (let day = 0; day < this.config.forecastDays; day++) {
			let sum = 0;
			for (const location of this.config.locations) {
				const locationName = this.sanitizeLocationName(location.name);
				const state = await this.getStateAsync(`${locationName}.daily-forecast.day${day}.Peak_day`);
				if (state && state.val !== null && state.val !== undefined) {
					sum += state.val as number;
				}
			}
			await this.setState(`sum_peak_locations.day${day}.sum_locations`, { val: sum, ack: true });
		}
	}

	private async updateLocation(location: Location): Promise<void> {
		const locationName = this.sanitizeLocationName(location.name);

		// Prüfen ob Latitude/Longitude gesetzt sind, ggf. Systemkonfiguration verwenden
		const effectiveLocation = { ...location };
		const latMissing =
			effectiveLocation.latitude === undefined ||
			effectiveLocation.latitude === null ||
			(effectiveLocation.latitude as unknown as string) === '';
		const lonMissing =
			effectiveLocation.longitude === undefined ||
			effectiveLocation.longitude === null ||
			(effectiveLocation.longitude as unknown as string) === '';

		if (latMissing || lonMissing) {
			this.log.debug(`[${location.name}] Debug:longitude and/or latitude not set, loading system configuration`);

			const sysConfig = await this.getForeignObjectAsync('system.config');
			const sysLat = sysConfig?.common?.latitude;
			const sysLon = sysConfig?.common?.longitude;

			if (sysLat !== undefined && sysLat !== null && sysLon !== undefined && sysLon !== null) {
				effectiveLocation.latitude = sysLat;
				effectiveLocation.longitude = sysLon;
				this.log.info(
					`[${location.name}] using system latitude: ${effectiveLocation.latitude}, system longitude: ${effectiveLocation.longitude}`,
				);
			} else {
				this.log.error(
					`[${location.name}] latitude and/or longitude not set and no system coordinates available. Skipping location.`,
				);
				return;
			}
		}

		try {
			// Wir übergeben jetzt die Anzahl der TAGE an den ApiCaller
			const data = await this.apiCaller.fetchForecastData(effectiveLocation, this.config.forecastDays);

			if (!data || !data.hourly || !data.hourly.time) {
				this.log.error(`[${location.name}] API lieferte keine Daten.`);
				return;
			}

			// kwp sicher als Zahl interpretieren (Komma durch Punkt ersetzen falls String)
			let kwpRaw = location.kwp as any;
			if (typeof kwpRaw === 'string') {
				kwpRaw = kwpRaw.replace(',', '.');
			}
			const kwpFactor = parseFloat(kwpRaw) || 0;

			const dailySums: Record<string, number> = {};

			// 1. Alle Stunden summieren
			for (let i = 0; i < data.hourly.time.length; i++) {
				const timeStr = data.hourly.time[i];
				const rawIrradiance = data.hourly.global_tilted_irradiance[i];

				if (timeStr && rawIrradiance !== undefined) {
					const dateKey = timeStr.split('T')[0]; // "2026-02-15"
					if (!dailySums[dateKey]) {
						dailySums[dateKey] = 0;
					}
					dailySums[dateKey] += rawIrradiance * kwpFactor;
				}
			}

			// 2. Daily States schreiben
			const todayObj = new Date();
			for (let day = 0; day < this.config.forecastDays; day++) {
				const targetDate = new Date(todayObj);
				targetDate.setDate(todayObj.getDate() + day);

				const dateKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

				const totalWh = Math.round(dailySums[dateKey] || 0);
				const formattedDisplayDate = `${String(targetDate.getDate()).padStart(2, '0')}.${String(targetDate.getMonth() + 1).padStart(2, '0')}.${targetDate.getFullYear()}`;

				await this.setState(`${locationName}.daily-forecast.day${day}.Date`, {
					val: formattedDisplayDate,
					ack: true,
				});
				await this.setState(`${locationName}.daily-forecast.day${day}.Peak_day`, { val: totalWh, ack: true });
			}

			// 3. Stündliche Rolling-Werte (für die Anzeige "was kommt als nächstes")
			const now = new Date();
			// Finde den Index der aktuellen Stunde
			const currentHourStart = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate(),
				now.getHours(),
			).getTime();

			let currentHourIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= currentHourStart);
			if (currentHourIndex === -1) {
				currentHourIndex = 0;
			}

			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				const idx = currentHourIndex + hour;
				if (idx < data.hourly.time.length) {
					const apiDate = new Date(data.hourly.time[idx]);
					const formattedTime = apiDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
					const powerW = Math.round(data.hourly.global_tilted_irradiance[idx] * kwpFactor);
					// 1. Hol den Wert (z.B. 3600) und stelle sicher, dass es eine ganze Zahl ist
					const totalSeconds = Math.round(data.hourly.sunshine_duration[idx] || 0);

					// 2. Berechne die vollen Minuten (3600 / 60 = 60)
					//const minutes = Math.floor(totalSeconds / 60);

					// 3. Berechne die restlichen Sekunden (3600 % 60 = 0)
					//const seconds = totalSeconds % 60;

					// 4. Formatierung (Ergebnis: "60:00")
					//const formattedSunTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

					await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
						val: formattedTime,
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
						val: powerW,
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.temperature_2m`, {
						val: data.hourly.temperature_2m[idx],
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.cloud_cover`, {
						val: data.hourly.cloud_cover[idx],
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.wind_speed_10m`, {
						val: data.hourly.wind_speed_10m[idx],
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.sunshine_duration`, {
						val: totalSeconds,
						ack: true,
					});
				}
			}

			this.log.info(
				`[${location.name}] Update erfolgreich. Day0: ${Math.round(dailySums[Object.keys(dailySums)[0]] || 0)} Wh`,
			);
		} catch (error) {
			this.log.error(`[${location.name}] Fehler: ${(error as Error).message}`);
		}
	}

	private sanitizeLocationName(name: string): string {
		return name
			.replace(/[^a-zA-Z0-9_-]/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '');
	}

	private onUnload(callback: () => void): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
		}
		callback();
	}

	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (state && !state.ack) {
			this.log.debug(`DEBUG:state ${id} changed: ${state.val}`);
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new OpenMeteoPvForecast(options);
} else {
	(() => new OpenMeteoPvForecast())();
}
