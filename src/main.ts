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

		this.config.forecastHours = this.config.forecastHours || 24;
		this.config.forecastDays = this.config.forecastDays || 7;

		if (this.config.updateInterval === undefined || this.config.updateInterval === null) {
			this.config.updateInterval = 60;
		}

		await this.cleanupStaleObjects();
		await this.createStatesForLocations();

		await this.updateAllLocations();

		// --- INTERVALL ---
		const intervalMinutes = Number(this.config.updateInterval);

		if (intervalMinutes > 0) {
			this.log.info(`Automatisches Update-Intervall aktiviert: Alle ${intervalMinutes} Minuten.`);
			const intervalMs = intervalMinutes * 60 * 1000;
			this.updateInterval = setInterval(() => {
				void this.updateAllLocations();
			}, intervalMs);
		} else {
			this.log.info(
				'Automatic update interval is disabled (0). The adapter is only updated at startup or via external triggers. Please set up a cron job yourself.',
			);
		}
	}

	private async cleanupStaleObjects(): Promise<void> {
		this.log.debug('Starting cleanup of stale objects...');

		// 1. Definition der Summen-Channels und deren Abhängigkeiten
		const sumChannels = [
			{ id: 'sum_peak_locations_Daily', configKey: 'locationsTotal_daily', masterKey: null },
			{ id: 'sum_peak_locations_Hourly', configKey: 'locationsTotal_hourly', masterKey: null },
			{ id: 'sum_peak_locations_15_Minutely', configKey: 'locationsTotal_minutely', masterKey: 'minutes_15' },
		];

		for (const channel of sumChannels) {
			// Prüfung: Muss dieser Summen-Ordner gelöscht werden?
			const masterDisabled = channel.masterKey && !(this.config as any)[channel.masterKey];
			const sumOptionDisabled = !(this.config as any)[channel.configKey];
			const tooFewLocations = this.config.locations.length <= 1;

			if (!this.config.locationsTotal || tooFewLocations || sumOptionDisabled || masterDisabled) {
				const sumObj = await this.getObjectAsync(channel.id);
				if (sumObj) {
					await this.delObjectAsync(channel.id, { recursive: true });
					this.log.info(`Cleanup: Deleted summary channel ${channel.id} (not needed or disabled)`);
				}
			}
		}

		// 2. Locations und deren Unterordner bereinigen
		const configuredNames = new Set(this.config.locations.map(l => this.sanitizeLocationName(l.name)));
		const allObjects = await this.getAdapterObjectsAsync();

		for (const fullId of Object.keys(allObjects)) {
			const localId = fullId.replace(`${this.namespace}.`, '');
			const parts = localId.split('.');
			const locName = parts[0];

			// Ignoriere die Summen-Ordner in dieser Schleife (wurden oben bereits behandelt)
			if (
				['sum_peak_locations_Daily', 'sum_peak_locations_Hourly', 'sum_peak_locations_15_Minutely'].includes(
					locName,
				)
			) {
				continue;
			}

			// A) FALLS DIE LOCATION ENTFERNT WURDE
			if (!configuredNames.has(locName)) {
				// Nur den Haupt-Channel löschen, recursive löscht den Rest
				if (allObjects[fullId].type === 'channel' && parts.length === 1) {
					await this.delObjectAsync(localId, { recursive: true });
					this.log.info(`Cleanup: Deleted removed location: ${locName}`);
				}
				continue;
			}

			// B) FALLS DIE LOCATION NOCH EXISTIERT -> UNTERORDNER PRÜFEN
			if (configuredNames.has(locName)) {
				// 1. Check: 15-Minuten komplett deaktiviert?
				if (localId.includes('.15-min-forecast') && !this.config.minutes_15) {
					await this.delObjectAsync(localId, { recursive: true });
					this.log.debug(`Cleanup: Deleted 15-min-forecast for ${locName} (option disabled)`);
					continue;
				}

				// 2. Check: Reduzierte TAGE (daily-forecast.dayX)
				const dayMatch = localId.match(/\.daily-forecast\.day(\d+)$/);
				if (dayMatch) {
					const dayIndex = parseInt(dayMatch[1]);
					if (dayIndex >= this.config.forecastDays) {
						await this.delObjectAsync(localId, { recursive: true });
						this.log.debug(`Cleanup: Deleted old forecast day ${dayIndex} for ${locName}`);
					}
				}

				// 3. Check: Reduzierte STUNDEN (hourly-forecast.hourX)
				const hourMatch = localId.match(/\.hourly-forecast\.hour(\d+)$/);
				if (hourMatch) {
					const hourIndex = parseInt(hourMatch[1]);
					if (hourIndex >= this.config.forecastHours) {
						await this.delObjectAsync(localId, { recursive: true });
						this.log.debug(`Cleanup: Deleted old forecast hour ${hourIndex} for ${locName}`);
					}
				}

				// 4. Check: 15-Minuten-Intervalle (Sicherheit: Falls i >= 96)
				const minMatch = localId.match(/\.15-min-forecast\.(\d+)$/);
				if (minMatch) {
					const minIndex = parseInt(minMatch[1]);
					if (minIndex >= 96) {
						await this.delObjectAsync(localId, { recursive: true });
					}
				}
			}
			// SUM JSON-Objekt löschen falls deaktiviert
			if (
				!this.config.locationsTotal_minutely_json ||
				!this.config.minutes_15 ||
				this.config.locations.length <= 1
			) {
				const jsonObj = await this.getObjectAsync('sum_peak_15-min-json_chart');
				if (jsonObj) {
					await this.delObjectAsync('sum_peak_15-min-json_chart');
					this.log.debug('Cleanup: Deleted sum_peak_15-min-json_chart (option disabled or not needed)');
				}
			}
			// Location JSON-Objekt löschen falls deaktiviert
			if (!this.config.minutes_15_json) {
				const jsonObj = await this.getObjectAsync(`${locName}.15-min-json_chart`);
				if (jsonObj) {
					await this.delObjectAsync(`${locName}.15-min-json_chart`);
					this.log.debug(`Cleanup: Deleted 15-min-json_chart for ${locName}`);
				}
			}
			// Location StundeJSON-Objekt löschen falls deaktiviert
			if (!this.config.hours_json) {
				const jsonObj = await this.getObjectAsync(`${locName}.hourly-json_chart`);
				if (jsonObj) {
					await this.delObjectAsync(`${locName}.hourly-json_chart`);
					this.log.debug(`Cleanup: Deleted hourly-json_chart for ${locName}`);
				}
			}
		}
		this.log.debug('Cleanup finished.');
	}

	private async createStatesForLocations(): Promise<void> {
		for (const location of this.config.locations) {
			const locationName = this.sanitizeLocationName(location.name);

			await this.setObjectNotExistsAsync(locationName, {
				type: 'channel',
				common: { name: location.name },
				native: {},
			});

			await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast`, {
				type: 'channel',
				common: {
					name: {
						en: 'Hourly Forecast',
						de: 'Stündliche Vorhersage',
						ru: 'Почасовой прогноз',
						pt: 'Previsão horária',
						nl: 'Uurlijkse voorspelling',
						fr: 'Prévisions horaires',
						it: 'Previsioni orarie',
						es: 'Pronóstico por hora',
						pl: 'Prognoza godzinowa',
						uk: 'Погодинний прогноз',
						'zh-cn': '逐小时预报',
					},
				},
				native: {},
			});

			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}`, {
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

				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.time`, {
					type: 'state',
					common: {
						name: {
							en: 'Hour Time',
							de: 'Stundenzeit',
							ru: 'Час Время',
							pt: 'Hora',
							nl: 'Uur Tijd',
							fr: 'Heure',
							it: 'Ora Ora',
							es: 'Hora Tiempo',
							pl: 'Godzina Czas',
							uk: 'Година Час',
							'zh-cn': '小时',
						},
						type: 'string',
						role: 'date',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.unix_time_stamp`, {
					type: 'state',
					common: {
						name: {
							en: 'Unix Time Stamp',
							de: 'Unix-Zeitstempel',
							ru: 'Unix-временная метка',
							pt: 'Carimbo de tempo Unix',
							nl: 'Unix-tijdstempel',
							fr: 'Horodatage Unix',
							it: 'Timestamp Unix',
							es: 'Marca de tiempo Unix',
							pl: 'Znacznik czasu Unix',
							uk: 'Unix-мітка часу',
							'zh-cn': 'Unix时间戳',
						},
						type: 'number',
						role: 'value.time',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(
					`${locationName}.hourly-forecast.hour${hour}.global_tilted_irradiance`,
					{
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
					},
				);
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.temperature_2m`, {
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
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.cloud_cover`, {
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
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.wind_speed_10m`, {
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
						role: 'value.speed.wind',
						unit: 'km/h',
						read: true,
						write: false,
					},
					native: {},
				});
				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.sunshine_duration`, {
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
						role: 'value',
						unit: 'min',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.hourly-forecast.hour${hour}.pv_temperature`, {
					type: 'state',
					common: {
						name: {
							en: 'Estimated PV Module Temperature',
							de: 'Geschätzte PV-Modultemperatur',
							ru: 'Расчетная температура фотоэлектрического модуля',
							pt: 'Temperatura estimada do módulo fotovoltaico',
							nl: 'Geschatte temperatuur van de PV-module',
							fr: 'Température estimée du module PV',
							it: 'Temperatura stimata del modulo fotovoltaico',
							es: 'Temperatura estimada del módulo fotovoltaico',
							pl: 'Szacowana temperatura modułu fotowoltaicznego',
							uk: 'Розрахункова температура фотоелектричного модуля',
							'zh-cn': '光伏组件预估温度',
						},
						type: 'number',
						role: 'value.temperature',
						unit: '°C',
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
						role: 'value.power',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});
			}

			if (this.config.locationsTotal && this.config.locations.length > 1) {
				await this.setObjectNotExistsAsync('sum_peak_locations_Daily', {
					type: 'channel',
					common: {
						name: {
							en: 'Sum Peak from Locations Daily',
							de: 'Tägliche Summe der Spitzenwerte von Standorten',
							ru: 'Суммарный пик из различных мест ежедневно',
							pt: 'Pico de soma de locais diários',
							nl: 'Som van pieken van locaties dagelijks',
							fr: 'Somme des pics quotidiens à partir des emplacements',
							it: 'Somma Picco dalle Posizioni Giornaliere',
							es: 'Suma de picos desde ubicaciones diarias',
							pl: 'Sum Peak z lokalizacji dziennie',
							uk: 'Сума Пік з місць розташування щодня',
							'zh-cn': '每日位置的 Sum Peak',
						},
					},
					native: {},
				});

				for (let day = 0; day < this.config.forecastDays; day++) {
					await this.setObjectNotExistsAsync(`sum_peak_locations_Daily.day${day}`, {
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

					await this.setObjectNotExistsAsync(`sum_peak_locations_Daily.day${day}.sum_locations`, {
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
			if (this.config.minutes_15) {
				// 1. Haupt-Channel erstellen
				await this.setObjectNotExistsAsync(`${locationName}.15-min-forecast`, {
					type: 'channel',
					common: {
						name: {
							en: '15-Minute Forecast',
							de: '15-Minuten-Vorhersage',
							ru: '15-минутный прогноз',
							pt: 'Previsão de 15 minutos',
							nl: '15-minutenvoorspelling',
							fr: 'Prévisions à 15 minutes',
							it: 'Previsioni a 15 minuti',
							es: 'Previsión en 15 minutos',
							pl: '15-minutowa prognoza',
							uk: '15-хвилинний прогноз',
							'zh-cn': '15-Minute Forecast',
						},
					},
					native: {},
				});

				// Definition der Datenpunkte pro 15-Min-Schritt
				const states = {
					unix_time_stamp: {
						name: {
							en: 'unix time stamp',
							de: 'Unix-Zeitstempel',
							ru: 'Unix-временная метка',
							pt: 'Carimbo de tempo Unix',
							nl: 'Unix-tijdstempel',
							fr: 'Horodatage Unix',
							it: 'Timestamp Unix',
							es: 'Sello de tiempo Unix',
							pl: 'Znacznik czasu Unix',
							uk: 'Unix-мітка часу',
							'zh-cn': 'Unix时间戳',
						},
						type: 'number',
						role: 'value.time',
						unit: '',
					},
					time: {
						name: {
							en: 'formatted time',
							de: 'Formatierte Zeit',
							ru: 'Отформатированное время',
							pt: 'Hora formatada',
							nl: 'Opgemaakte tijd',
							fr: 'Heure formatée',
							it: 'Ora formattata',
							es: 'Hora formateada',
							pl: 'Sformatowany czas',
							uk: 'Відформатований час',
							'zh-cn': '格式化时间',
						},
						type: 'string',
						role: 'text',
						unit: '',
					},
					global_tilted_irradiance: {
						name: {
							en: 'Irradiance',
							de: 'Einstrahlung',
							ru: 'Освещенность',
							pt: 'Irradiância',
							nl: 'Straling',
							fr: 'Irradiance',
							it: 'Irradianza',
							es: 'Irradiancia',
							pl: 'Promieniowanie',
							uk: 'Опромінення',
							'zh-cn': '辐照度',
						},
						type: 'number',
						role: 'value.power',
						unit: 'W/m²',
					},
					temperature_2m: {
						name: {
							en: 'Temperature',
							de: 'Temperatur',
							ru: 'Температура',
							pt: 'Temperatura',
							nl: 'Temperatuur',
							fr: 'Température',
							it: 'Temperatura',
							es: 'Temperatura',
							pl: 'Temperatura',
							uk: 'Температура',
							'zh-cn': '温度',
						},
						type: 'number',
						role: 'value.temperature',
						unit: '°C',
					},
					wind_speed_10m: {
						name: {
							en: 'Wind speed',
							de: 'Windgeschwindigkeit',
							ru: 'Скорость ветра',
							pt: 'Velocidade do vento',
							nl: 'Windsnelheid',
							fr: 'Vitesse du vent',
							it: 'Velocità del vento',
							es: 'Velocidad del viento',
							pl: 'Prędkość wiatru',
							uk: 'Швидкість вітру',
							'zh-cn': '风速',
						},
						type: 'number',
						role: 'value.speed.wind',
						unit: 'km/h',
					},
					sunshine_duration: {
						name: {
							en: 'Sunshine duration',
							de: 'Sonnenscheindauer',
							ru: 'Продолжительность солнечного сияния',
							pt: 'Duração da luz solar',
							nl: 'Duur van de zonneschijn',
							fr: "Durée d'ensoleillement",
							it: 'Durata del sole',
							es: 'Duración del sol',
							pl: 'Czas nasłonecznienia',
							uk: 'Тривалість сонячного сяйва',
							'zh-cn': 'Sunshine duration',
						},
						type: 'number',
						role: 'value',
						unit: 'min',
					},
				};

				// Schleife für die Intervalle (z.B. für 24 Stunden = 96 Intervalle)
				// Du kannst '96' auch durch eine Config-Variable ersetzen
				for (let i = 0; i < 96; i++) {
					const channelId = `${locationName}.15-min-forecast.${i}`;

					// Unter-Channel für den Zeitschritt erstellen
					await this.setObjectNotExistsAsync(channelId, {
						type: 'channel',
						common: { name: `Interval ${i}` },
						native: {},
					});

					// Alle Datenpunkte innerhalb des Intervalls erstellen
					for (const [key, info] of Object.entries(states)) {
						await this.setObjectNotExistsAsync(`${channelId}.${key}`, {
							type: 'state',
							common: {
								name: info.name,
								type: info.type as any,
								role: info.role,
								unit: info.unit,
								read: true,
								write: false,
							},
							native: {},
						});
						await this.setObjectNotExistsAsync(`${locationName}.15-min-forecast.${i}.pv_temperature`, {
							type: 'state',
							common: {
								name: {
									en: 'Estimated PV Module Temperature',
									de: 'Geschätzte PV-Modultemperatur',
									ru: 'Расчетная температура фотоэлектрического модуля',
									pt: 'Temperatura estimada do módulo fotovoltaico',
									nl: 'Geschatte temperatuur van de PV-module',
									fr: 'Température estimée du module PV',
									it: 'Temperatura stimata del modulo fotovoltaico',
									es: 'Temperatura estimada del módulo fotovoltaico',
									pl: 'Szacowana temperatura modułu fotowoltaicznego',
									uk: 'Розрахункова температура фотоелектричного модуля',
									'zh-cn': '光伏组件预估温度',
								},
								type: 'number',
								role: 'value.temperature',
								unit: '°C',
								read: true,
								write: false,
							},
							native: {},
						});
					}
				}
			}
			// Optional: JSON-Chart-Datenpunkt für 15-Minuten-Vorhersage
			if (this.config.minutes_15_json) {
				await this.setObjectNotExistsAsync(`${locationName}.15-min-json_chart`, {
					type: 'state',
					common: {
						name: {
							en: 'JSON Chart Data',
							de: 'JSON-Diagrammdaten',
							ru: 'Данные диаграммы в формате JSON',
							pt: 'Dados do gráfico JSON',
							nl: 'JSON-grafiekgegevens',
							fr: 'Données du graphique JSON',
							it: 'Dati del grafico JSON',
							es: 'Datos de gráficos JSON',
							pl: 'Dane wykresu JSON',
							uk: 'Дані діаграми JSON',
							'zh-cn': 'JSON 图表数据',
						},
						type: 'string',
						role: 'json',
						read: true,
						write: false,
						desc: {
							en: 'History data for eCharts in JSON format',
							de: 'Verlaufsdaten für eCharts im JSON-Format',
							ru: 'Исторические данные для eCharts в формате JSON',
							pt: 'Dados históricos do eCharts em formato JSON',
							nl: 'Historische gegevens voor eCharts in JSON-formaat.',
							fr: 'Données historiques pour eCharts au format JSON',
							it: 'Dati storici per eCharts in formato JSON',
							es: 'Datos históricos de eCharts en formato JSON',
							pl: 'Dane historyczne dla eCharts w formacie JSON',
							uk: 'Історичні дані для eCharts у форматі JSON',
							'zh-cn': 'eCharts 的历史数据（JSON 格式）',
						},
					},
					native: {},
				});
			}
			// Optional: JSON-Chart-Datenpunkt für Stunden-Vorhersage
			if (this.config.hours_json) {
				await this.setObjectNotExistsAsync(`${locationName}.hourly-json_chart`, {
					type: 'state',
					common: {
						name: {
							en: 'JSON Chart Data Hours',
							de: 'JSON-Diagrammdaten Stunden',
							ru: 'Данные диаграммы в формате JSON Часы',
							pt: 'Dados do gráfico JSON Horas',
							nl: 'JSON-grafiekgegevens Uren',
							fr: 'Données du graphique JSON Heures',
							it: 'Dati del grafico JSON Ore',
							es: 'Datos de gráficos JSON Horas',
							pl: 'Dane wykresu JSON Godziny',
							uk: 'Дані діаграми JSON Години',
							'zh-cn': 'JSON 图表数据 小时',
						},
						type: 'string',
						role: 'json',
						read: true,
						write: false,
						desc: {
							en: 'Hour History data for eCharts in JSON format',
							de: 'Stündliche Verlaufsdaten für eCharts im JSON-Format',
							ru: 'Часовые исторические данные для eCharts в формате JSON',
							pt: 'Dados históricos por hora do eCharts em formato JSON',
							nl: 'Uur historische gegevens voor eCharts in JSON-formaat.',
							fr: 'Données historiques horaires pour eCharts au format JSON',
							it: 'Dati storici orari per eCharts in formato JSON',
							es: 'Datos históricos por hora de eCharts en formato JSON',
							pl: 'Godzinowe dane historyczne dla eCharts w formacie JSON',
							uk: 'Погодинні історичні дані для eCharts у форматі JSON',
							'zh-cn': 'eCharts 的历史数据（按小时，JSON 格式）',
						},
					},
					native: {},
				});
			}
			if (
				this.config.locationsTotal_minutely_json &&
				this.config.minutes_15 &&
				this.config.locations.length > 1
			) {
				await this.setObjectNotExistsAsync(`sum_peak_15-min-json_chart`, {
					type: 'state',
					common: {
						name: {
							en: 'Sum JSON Chart Data 15 minutes',
							de: 'Summe JSON Diagramm Daten 15 Minuten',
							ru: 'Суммарные данные JSON за 15 минут',
							pt: 'Sum JSON Dados do Gráfico 15 minutos',
							nl: 'Sum JSON Grafiekgegevens 15 minuten',
							fr: 'Sum JSON Données du graphique 15 minutes',
							it: 'Sum JSON Grafico Dati 15 minuti',
							es: 'Sum JSON Datos de carga 15 minutos',
							pl: 'Sum JSON Wykres Dane 15 minut',
							uk: 'Сума JSON Графік даних 15 хвилин',
							'zh-cn': 'JSON总和 图表 15分钟',
						},
						type: 'string',
						role: 'json',
						read: true,
						write: false,
						desc: {
							en: 'Sum History data for eCharts in JSON format',
							de: 'Summe für eCharts im JSON-Format',
							ru: 'Данные истории сумм для электронных диаграммы в формате JSON',
							pt: 'Dados do Sum History para eCharts em JSON',
							nl: 'Som geschiedenisgegevens voor eCharts in JSON-formaat',
							fr: 'Historique des sommes pour eCharts au format JSON',
							it: 'Sum History per eCharts in formato JSON',
							es: 'Sumar datos históricos de ECharts en formato JSON',
							pl: 'Suma danych historii dla eCharts w formacie JSON',
							uk: 'Сума даних історії для eCharts у форматі JSON',
							'zh-cn': '以 JSON 格式汇总 ECharts 的历史数据',
						},
					},
					native: {},
				});
			}
			// sum JSON-Objekt für Stunden-Vorhersage erstellen, falls aktiviert und mehr als 1 Standort
			if (this.config.locationsTotal_hourly_json && this.config.locations.length > 1) {
				await this.setObjectNotExistsAsync(`sum_peak_hourly-json_chart`, {
					type: 'state',
					common: {
						name: {
							en: 'Sum JSON Chart Data Hourly',
							de: 'Summe JSON Diagramm Daten Stündlich',
							ru: 'Суммарные данные JSON за час',
							pt: 'Sum JSON Dados do Gráfico Horário',
							nl: 'Sum JSON Grafiekgegevens Uurlijk',
							fr: 'Sum JSON Données du graphique Horaire',
							it: 'Sum JSON Grafico Dati Orari',
							es: 'Sum JSON Datos de carga Horaria',
							pl: 'Sum JSON Wykres Dane Godzinowe',
							uk: 'Сума JSON Графік даних Щогодини',
							'zh-cn': 'JSON总和 图表 每小时',
						},
						type: 'string',
						role: 'json',
						read: true,
						write: false,
						desc: {
							en: 'Sum History data for eCharts in JSON format',
							de: 'Summe für eCharts im JSON-Format',
							ru: 'Данные истории сумм для электронных диаграммы в формате JSON',
							pt: 'Dados do Sum History para eCharts em JSON',
							nl: 'Som geschiedenisgegevens voor eCharts in JSON-formaat',
							fr: 'Historique des sommes pour eCharts au format JSON',
							it: 'Sum History per eCharts in formato JSON',
							es: 'Sumar datos históricos de ECharts en formato JSON',
							pl: 'Suma danych historii dla eCharts w formacie JSON',
							uk: 'Сума даних історії для eCharts у форматі JSON',
							'zh-cn': '以 JSON 格式汇总 ECharts 的历史数据',
						},
					},
					native: {},
				});
			}
		}

		//minütlich Summe aller Standorte
		if (this.config.minutes_15 && this.config.locationsTotal_minutely && this.config.locations.length > 1) {
			await this.setObjectNotExistsAsync('sum_peak_locations_15_Minutely', {
				type: 'channel',
				common: {
					name: {
						en: 'Sum Peak from Locations 15 Minutely',
						de: 'Summe der Spitzenwerte von Standorten alle 15 Minuten',
						ru: 'Суммарный пиковый расход электроэнергии в различных местах составляет 15 минут.',
						pt: 'Soma dos picos a partir de locais a cada 15 minutos',
						nl: 'Som van pieken vanaf locaties elke 15 minuten',
						fr: 'Somme des pics à partir des emplacements toutes les 15 minutes',
						it: 'Somma dei picchi dalle località ogni 15 minuti',
						es: 'Suma de picos desde ubicaciones cada 15 minutos',
						pl: 'Sum Peak z lokalizacji 15 minut',
						uk: 'Сума піку з місць розташування кожні 15 хвилин',
						'zh-cn': '从指定地点出发，15分钟即可到达萨姆峰',
					},
				},
				native: {},
			});

			for (let i = 0; i < 96; i++) {
				const channelId = `sum_peak_locations_15_Minutely.${i}`;

				// Unter-Channel für den Zeitschritt erstellen
				await this.setObjectNotExistsAsync(channelId, {
					type: 'channel',
					common: { name: `Interval ${i}` },
					native: {},
				});

				await this.setObjectNotExistsAsync(`sum_peak_locations_15_Minutely.${i}.sum_locations`, {
					type: 'state',
					common: {
						name: {
							en: '15 Minutes Sum of all locations',
							de: '15 Minuten Summe aller Standorte',
							ru: '15 минут Сумма всех мест',
							pt: '15 minutos Soma de todos os locais',
							nl: '15 Minuten Som van alle locaties',
							fr: '15 minutes Somme de tous les lieux',
							it: '15 minuti Somma di tutti i luoghi',
							es: '15 Minutos Suma de todas las localizaciones',
							pl: '15 minut Suma wszystkich lokalizacji',
							uk: '15 хвилин Сума всіх локацій',
							'zh-cn': '15 Minutes Sum of all locations',
						},
						type: 'number',
						role: 'value.power.consumption',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`sum_peak_locations_15_Minutely.${i}.time`, {
					type: 'state',
					common: {
						name: {
							en: 'Time',
							de: 'Zeit',
							ru: 'Время',
							pt: 'Tempo',
							nl: 'Tijd',
							fr: "L'heure",
							it: 'Tempo',
							es: 'Tiempo',
							pl: 'Czas',
							uk: 'Час',
							'zh-cn': 'Time',
						},
						type: 'string',
						role: 'date',
						read: true,
						write: false,
					},
					native: {},
				});
			}
		}
		//stündliche Summe aller Standorte
		if (this.config.locationsTotal_hourly && this.config.locations.length > 1) {
			await this.setObjectNotExistsAsync('sum_peak_locations_Hourly', {
				type: 'channel',
				common: {
					name: {
						en: 'Sum Peak from Locations Hourly',
						de: 'Summe der Spitzenwerte von Standorten stündlich',
						ru: 'Суммарный пиковый уровень в зависимости от местоположения (почасовая шкала)',
						pt: 'Soma dos picos de localização por hora',
						nl: 'Som van pieken van locaties per uur',
						fr: 'Somme maximale des emplacements horaires',
						it: 'Somma di picco dalle posizioni orarie',
						es: 'Suma de picos desde ubicaciones por hora',
						pl: 'Suma szczytów z lokalizacji godzinowych',
						uk: 'Сума піку з місць розташування щогодини',
						'zh-cn': '从各个地点每小时计算的总峰值',
					},
				},
				native: {},
			});

			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				await this.setObjectNotExistsAsync(`sum_peak_locations_Hourly.Hour${hour}`, {
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

				await this.setObjectNotExistsAsync(`sum_peak_locations_Hourly.Hour${hour}.sum_locations`, {
					type: 'state',
					common: {
						name: {
							en: 'Hourly Sum of all locations',
							de: 'Stündliche Summe aller Standorte',
							ru: 'Почасовая сумма по всем местоположениям',
							pt: 'Soma horária de todos os locais',
							nl: 'Uurtotaal van alle locaties',
							fr: 'Somme horaire de tous les emplacements',
							it: 'Somma oraria di tutte le posizioni',
							es: 'Suma horaria de todas las ubicaciones',
							pl: 'Suma godzinowa wszystkich lokalizacji',
							uk: 'Погодинна сума всіх локацій',
							'zh-cn': '所有地点每小时总和',
						},
						type: 'number',
						role: 'value.power.consumption',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});

				await this.setObjectNotExistsAsync(`sum_peak_locations_Hourly.Hour${hour}.time`, {
					type: 'state',
					common: {
						name: {
							en: 'Hour Time',
							de: 'Stundenzeit',
							ru: 'Час Время',
							pt: 'Hora',
							nl: 'Uur Tijd',
							fr: 'Heure',
							it: 'Ora Ora',
							es: 'Hora Tiempo',
							pl: 'Godzina Czas',
							uk: 'Година Час',
							'zh-cn': '小时',
						},
						type: 'string',
						role: 'date',
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
		// Summe Täglich
		if (this.config.locationsTotal && this.config.locations.length >= 1) {
			for (let day = 0; day < this.config.forecastDays; day++) {
				let sum = 0;
				for (const location of this.config.locations) {
					const locationName = this.sanitizeLocationName(location.name);
					const state = await this.getStateAsync(`${locationName}.daily-forecast.day${day}.Peak_day`);
					if (state && state.val !== null && state.val !== undefined) {
						sum += state.val as number;
					}
				}
				await this.setState(`sum_peak_locations_Daily.day${day}.sum_locations`, { val: sum, ack: true });
			}
		}
		// Summe Stündlich
		if (this.config.locationsTotal_hourly && this.config.locations.length >= 1) {
			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				let sum = 0;
				for (const location of this.config.locations) {
					const locationName = this.sanitizeLocationName(location.name);
					const state = await this.getStateAsync(
						`${locationName}.hourly-forecast.hour${hour}.global_tilted_irradiance`,
					);
					if (state && state.val !== null && state.val !== undefined) {
						sum += state.val as number;
					}
				}
				await this.setState(`sum_peak_locations_Hourly.Hour${hour}.sum_locations`, { val: sum, ack: true });
			}
		}
		// --- Summe 15 Minuten ---
		if (this.config.minutes_15 && this.config.locationsTotal_minutely && this.config.locations.length > 1) {
			this.log.debug('Starting 15-min sum calculation...');

			for (let i = 0; i < 96; i++) {
				let totalSum = 0;
				let timeVal = '';
				let foundAnyValue = false; // Flag, um zu sehen, ob wir überhaupt Daten finden

				for (const location of this.config.locations) {
					const locationName = this.sanitizeLocationName(location.name);
					const stateId = `${locationName}.15-min-forecast.${i}.global_tilted_irradiance`;
					const timeId = `${locationName}.15-min-forecast.${i}.time`;

					const locState = await this.getStateAsync(stateId);
					const locTime = await this.getStateAsync(timeId);

					if (locState && locState.val !== null && locState.val !== undefined) {
						totalSum += Number(locState.val);
						foundAnyValue = true;
					}
					if (locTime && locTime.val) {
						timeVal = String(locTime.val);
					}
				}

				// Nur schreiben, wenn wir auch wirklich etwas gefunden haben oder die Summe 0 ist
				// (Vermeidet das Schreiben von "0", wenn eigentlich gar keine Daten da waren)
				if (foundAnyValue) {
					await this.setState(`sum_peak_locations_15_Minutely.${i}.sum_locations`, {
						val: totalSum,
						ack: true,
					});
				}

				if (timeVal) {
					await this.setState(`sum_peak_locations_15_Minutely.${i}.time`, { val: timeVal, ack: true });
				}
			}
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
			let startSearchTime: number;

			// --- LOGIK-WEICHE START ---
			if (this.config.hourlyUpdate === 1) {
				// FESTE STUNDEN: Start bei heute 0:00 Uhr
				startSearchTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
			} else {
				// ROLLENDE STUNDEN: Start bei aktueller Stunde (Dein Original-Code)
				startSearchTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
			}

			// Finde den Index im API-Array basierend auf der berechneten Zeit
			let currentHourIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= startSearchTime);

			if (currentHourIndex === -1) {
				currentHourIndex = 0;
			}
			// --- LOGIK-WEICHE ENDE ---

			// Ab hier bleibt dein Code fast gleich, nutzt aber den neuen currentHourIndex
			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				const idx = currentHourIndex + hour;
				if (idx < data.hourly.time.length) {
					const apiDate = new Date(data.hourly.time[idx]);
					const formattedTime = apiDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
					const unixTimestamp = apiDate.getTime();
					const powerW = Math.round(data.hourly.global_tilted_irradiance[idx] * kwpFactor);
					const sunshineMinutes = Math.round((data.hourly.sunshine_duration[idx] || 0) / 60);

					await this.setState(`${locationName}.hourly-forecast.hour${hour}.time`, {
						val: formattedTime,
						ack: true,
					});

					await this.setState(`${locationName}.hourly-forecast.hour${hour}.unix_time_stamp`, {
						val: unixTimestamp,
						ack: true,
					});

					await this.setState(`${locationName}.hourly-forecast.hour${hour}.global_tilted_irradiance`, {
						val: powerW,
						ack: true,
					});
					await this.setState(`${locationName}.hourly-forecast.hour${hour}.temperature_2m`, {
						val: data.hourly.temperature_2m[idx],
						ack: true,
					});
					await this.setState(`${locationName}.hourly-forecast.hour${hour}.cloud_cover`, {
						val: data.hourly.cloud_cover[idx],
						ack: true,
					});
					await this.setState(`${locationName}.hourly-forecast.hour${hour}.wind_speed_10m`, {
						val: data.hourly.wind_speed_10m[idx],
						ack: true,
					});
					await this.setState(`${locationName}.hourly-forecast.hour${hour}.sunshine_duration`, {
						val: sunshineMinutes,
						ack: true,
					});
					// Platten Temperatur berechnen
					const ambientTemp = data.hourly.temperature_2m[idx];
					const irradiance = data.hourly.global_tilted_irradiance[idx];
					const windSpeedKmH = data.hourly.wind_speed_10m[idx] || 0;
					const windSpeedMS = windSpeedKmH / 3.6;

					// Faiman-Berechnung (Werte 25 und 6.84 sind Standard für Aufdach-Montage)
					const pvTemp = Math.round((ambientTemp + irradiance / (25 + 6.84 * windSpeedMS)) * 10) / 10;

					await this.setState(`${locationName}.hourly-forecast.hour${hour}.pv_temperature`, {
						val: pvTemp,
						ack: true,
					});

					if (this.config.locationsTotal_hourly && this.config.locations.length > 1) {
						await this.setState(`sum_peak_locations_Hourly.Hour${hour}.time`, {
							val: formattedTime,
							ack: true,
						});
					}
				}
			}
			// --- 15-MINUTEN VORHERSAGE BEFÜLLEN ---
			if (this.config.minutes_15 && (data as any).minutely_15) {
				this.log.debug(`[${location.name}] Fill in the 15-minute forecast...`);

				// Open-Meteo liefert 15-Min-Daten oft im Key "minutely_15"
				const minData = (data as any).minutely_15;
				let unixTimestamp = 0;

				for (let i = 0; i < 96; i++) {
					// 96 * 15min = 24h
					if (minData.time[i]) {
						const apiDate = new Date(minData.time[i]);
						unixTimestamp = apiDate.getTime();
						const formattedTime = apiDate.toLocaleTimeString('de-DE', {
							hour: '2-digit',
							minute: '2-digit',
						});
						const path = `${locationName}.15-min-forecast.${i}`;

						// Werte schreiben
						await this.setState(`${path}.time`, { val: formattedTime, ack: true });
						await this.setState(`${path}.unix_time_stamp`, { val: unixTimestamp, ack: true });

						if (this.config.locationsTotal_minutely && this.config.locations.length > 1) {
							await this.setState(`sum_peak_locations_15_Minutely.${i}.time`, {
								val: formattedTime,
								ack: true,
							});
						}

						if (minData.global_tilted_irradiance) {
							await this.setState(`${path}.global_tilted_irradiance`, {
								val: Math.round(minData.global_tilted_irradiance[i] * kwpFactor),
								ack: true,
							});
						}
						if (minData.temperature_2m) {
							await this.setState(`${path}.temperature_2m`, {
								val: minData.temperature_2m[i],
								ack: true,
							});
						}
						if (minData.wind_speed_10m) {
							await this.setState(`${path}.wind_speed_10m`, {
								val: minData.wind_speed_10m[i],
								ack: true,
							});
						}
						if (minData.sunshine_duration) {
							const sunMin = Math.round((minData.sunshine_duration[i] || 0) / 60);
							await this.setState(`${path}.sunshine_duration`, {
								val: sunMin,
								ack: true,
							});
							if (
								minData.temperature_2m !== undefined &&
								minData.global_tilted_irradiance !== undefined
							) {
								const ambientTemp = minData.temperature_2m[i];
								const irradiance = minData.global_tilted_irradiance[i];
								const windSpeedKmH = minData.wind_speed_10m ? minData.wind_speed_10m[i] : 0;
								const windSpeedMS = windSpeedKmH / 3.6;

								// Faiman-Modell: T_module = T_ambient + Irradiance / (U0 + U1 * Windspeed)
								// Werte 25 (U0) und 6.84 (U1) sind Standard für Aufdach-Montage
								const pvTemp =
									Math.round((ambientTemp + irradiance / (25 + 6.84 * windSpeedMS)) * 10) / 10;

								await this.setState(`${path}.pv_temperature`, {
									val: pvTemp,
									ack: true,
								});
							}
						}
					}
				}
			}
			// --- Neuer Block für das JSON-Chart nach dem Einzelpunkte-Block ---
			if (this.config.minutes_15_json && (data as any).minutely_15) {
				this.log.debug(`[${location.name}] Generating 15-minute JSON chart...`);

				const minData = (data as any).minutely_15;
				const chartData = [];

				for (let i = 0; i < 96; i++) {
					if (minData.time[i]) {
						const apiDate = new Date(minData.time[i]);
						const unixTimestamp = apiDate.getTime();

						const irradianceValue = minData.global_tilted_irradiance
							? Math.round(minData.global_tilted_irradiance[i] * kwpFactor)
							: 0;

						// Datenpunkt für das Array hinzufügen
						chartData.push({
							ts: unixTimestamp,
							val: irradianceValue,
						});
					}
				}

				// Den fertigen JSON-String in den State schreiben
				await this.setState(`${locationName}.15-min-json_chart`, {
					val: JSON.stringify(chartData),
					ack: true,
				});
			}
			// --- Neuer Stunden Block für das JSON-Chart nach dem Einzelpunkte-Block ---
			if (this.config.hours_json && (data as any).hourly) {
				this.log.debug(`[${location.name}] Generating hourly JSON chart...`);

				const hourlyData = (data as any).hourly;
				const chartData = [];
				const forecastHours = this.config.forecastHours || 24;

				for (let i = 0; i < forecastHours; i++) {
					if (hourlyData.time[i]) {
						const apiDate = new Date(hourlyData.time[i]);
						const unixTimestamp = apiDate.getTime();

						const irradianceValue = hourlyData.global_tilted_irradiance
							? Math.round(hourlyData.global_tilted_irradiance[i] * kwpFactor)
							: 0;

						// Datenpunkt für das Array hinzufügen
						chartData.push({
							ts: unixTimestamp,
							val: irradianceValue,
						});
					}
				}

				// Den fertigen JSON-String in den State schreiben
				await this.setState(`${locationName}.hourly-json_chart`, {
					val: JSON.stringify(chartData),
					ack: true,
				});
			}

			//summe aller Standorte im 15-Minuten-Intervall als JSON für eCharts
			if (
				this.config.locationsTotal_minutely_json &&
				this.config.minutes_15 &&
				this.config.locations.length > 1
			) {
				const sumChartData = [];

				// Wir gehen die 96 Zeitpunkte (15-Min-Intervalle) durch
				for (let i = 0; i < 96; i++) {
					let totalSum = 0;
					let currentTimeStr = '';

					// Wir loopen über alle konfigurierten Locations, um die Werte zu addieren
					for (const location of this.config.locations) {
						const locationName = this.sanitizeLocationName(location.name);

						// Wir holen uns die Werte der einzelnen Locations aus deren States
						const locTimeState = await this.getStateAsync(
							`${locationName}.15-min-forecast.${i}.unix_time_stamp`,
						);
						const locValState = await this.getStateAsync(
							`${locationName}.15-min-forecast.${i}.global_tilted_irradiance`,
						);

						if (locValState && locValState.val !== null) {
							totalSum += locValState.val as number;
						}
						if (locTimeState && locTimeState.val) {
							currentTimeStr = String(locTimeState.val);
						}
					}

					// Nur hinzufügen, wenn wir eine Uhrzeit gefunden haben
					if (currentTimeStr) {
						sumChartData.push({
							ts: currentTimeStr,
							val: totalSum,
						});
					}
				}

				// Das fertige JSON schreiben
				if (sumChartData.length > 0) {
					await this.setState(`sum_peak_15-min-json_chart`, {
						val: JSON.stringify(sumChartData),
						ack: true,
					});
					this.log.debug(`15-min Sum-JSON created.`);
				}
			}
			//summe aller Standorte Stunden als JSON für eCharts
			if (
				this.config.locationsTotal_minutely_json &&
				this.config.minutes_15 &&
				this.config.locations.length > 1
			) {
				const sumChartData = [];
				const forecastHours = this.config.forecastHours || 24;

				for (let i = 0; i < forecastHours; i++) {
					let totalSum = 0;
					let currentTimeStr = '';

					// Wir loopen über alle konfigurierten Locations, um die Werte zu addieren
					for (const location of this.config.locations) {
						const locationName = this.sanitizeLocationName(location.name);

						// Wir holen uns die Werte der einzelnen Locations aus deren States
						const locTimeState = await this.getStateAsync(
							`${locationName}.hourly-forecast.hour${i}.unix_time_stamp`,
						);
						const locValState = await this.getStateAsync(
							`${locationName}.hourly-forecast.hour${i}.global_tilted_irradiance`,
						);

						if (locValState && locValState.val !== null) {
							totalSum += locValState.val as number;
						}
						if (locTimeState && locTimeState.val) {
							currentTimeStr = String(locTimeState.val);
						}
					}

					// Nur hinzufügen, wenn wir eine Uhrzeit gefunden haben
					if (currentTimeStr) {
						sumChartData.push({
							ts: currentTimeStr,
							val: totalSum,
						});
					}
				}

				// Das fertige JSON schreiben
				if (sumChartData.length > 0) {
					await this.setState(`sum_peak_hourly-json_chart`, {
						val: JSON.stringify(sumChartData),
						ack: true,
					});
					this.log.debug(`Hourly Sum-JSON created.`);
				}
			}

			this.log.info(
				`[${location.name}] Update successful. Day0: ${Math.round(dailySums[Object.keys(dailySums)[0]] || 0)} Wh`,
			);
		} catch (error) {
			this.log.error(`[${location.name}] Error: ${(error as Error).message}`);
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
