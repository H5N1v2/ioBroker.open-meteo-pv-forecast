/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';
import { ApiCaller } from './lib/api_caller';
import type { Location } from './lib/adapter-config';

class OpenMeteoPvForecast extends utils.Adapter {
	private apiCaller: ApiCaller;
	private updateInterval?: NodeJS.Timeout;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'open-meteo-pv-forecast',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.apiCaller = new ApiCaller();
	}

	private async onReady(): Promise<void> {
		this.log.info('Starting open-meteo-pv-forecast adapter');

		if (!this.config.locations || this.config.locations.length === 0) {
			this.log.warn('No locations configured. Please configure at least one location in the adapter settings.');
			return;
		}

		// Defaults
		this.config.forecastHours = this.config.forecastHours || 24;
		this.config.forecastDays = this.config.forecastDays || 7;
		this.config.updateInterval = this.config.updateInterval || 60;

		await this.createStatesForLocations();
		await this.updateAllLocations();

		const intervalMs = this.config.updateInterval * 60 * 1000;
		this.updateInterval = setInterval(() => {
			void this.updateAllLocations();
		}, intervalMs);
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
				common: { name: 'PV Forecast' },
				native: {},
			});

			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
					type: 'channel',
					common: { name: `Hour ${hour}` },
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
					type: 'state',
					common: { name: 'Timestamp', type: 'string', role: 'date', read: true, write: false },
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
					type: 'state',
					common: {
						name: { en: 'Global Tilted Irradiance', de: 'Globalstrahlung auf geneigter Fläche' },
						type: 'number',
						role: 'value.power',
						unit: 'Wh',
						read: true,
						write: false,
					},
					native: {},
				});
			}

			await this.setObjectNotExistsAsync(`${locationName}.daily-forecast`, {
				type: 'channel',
				common: { name: 'Daily Forecast' },
				native: {},
			});

			for (let day = 0; day < this.config.forecastDays; day++) {
				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}`, {
					type: 'channel',
					common: { name: `Day ${day}` },
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Date`, {
					type: 'state',
					common: { name: 'Date', type: 'string', role: 'date', read: true, write: false },
					native: {},
				});

				await this.setObjectNotExistsAsync(`${locationName}.daily-forecast.day${day}.Peak_day`, {
					type: 'state',
					common: {
						name: { en: 'Daily Peak Energy', de: 'Täglicher Spitzenertrag' },
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
	}

	private async updateLocation(location: Location): Promise<void> {
		const locationName = this.sanitizeLocationName(location.name);

		try {
			// Wir übergeben jetzt die Anzahl der TAGE an den ApiCaller
			const data = await this.apiCaller.fetchForecastData(location, this.config.forecastDays);

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

					await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
						val: formattedTime,
						ack: true,
					});
					await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
						val: powerW,
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
			this.log.debug(`state ${id} changed: ${state.val}`);
		}
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new OpenMeteoPvForecast(options);
} else {
	(() => new OpenMeteoPvForecast())();
}
