/*
 * Created with @iobroker/create-adapter v3.1.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
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
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.apiCaller = new ApiCaller();
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		this.log.info('Starting open-meteo-pv-forecast adapter');

		// Validate configuration
		if (!this.config.locations || this.config.locations.length === 0) {
			this.log.warn('No locations configured. Please configure at least one location in the adapter settings.');
			return;
		}

		// Set default values if not configured
		if (!this.config.forecastHours) {
			this.config.forecastHours = 24;
		}
		if (!this.config.updateInterval) {
			this.config.updateInterval = 60; // Default: 60 minutes
		}

		// Create states for all locations
		await this.createStatesForLocations();

		// Initial data fetch
		await this.updateAllLocations();

		// Set up periodic updates
		const intervalMs = this.config.updateInterval * 60 * 1000;
		this.updateInterval = setInterval(() => {
			void this.updateAllLocations();
		}, intervalMs);

		this.log.info(
			`Adapter configured with ${this.config.locations.length} location(s), updating every ${this.config.updateInterval} minutes`,
		);
	}

	/**
	 * Create state objects for all configured locations
	 */
	private async createStatesForLocations(): Promise<void> {
		for (const location of this.config.locations) {
			const locationName = this.sanitizeLocationName(location.name);

			// Create channel for location
			await this.setObjectNotExistsAsync(locationName, {
				type: 'channel',
				common: {
					name: location.name,
				},
				native: {},
			});

			// Create pv-forecast channel
			await this.setObjectNotExistsAsync(`${locationName}.pv-forecast`, {
				type: 'channel',
				common: {
					name: 'PV Forecast',
				},
				native: {},
			});

			// Create state objects for forecast hours
			for (let hour = 0; hour < this.config.forecastHours; hour++) {
				// Create hour channel
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}`, {
					type: 'channel',
					common: {
						name: `Hour ${hour}`,
					},
					native: {},
				});

				// Create time state
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.time`, {
					type: 'state',
					common: {
						name: 'Timestamp',
						type: 'string',
						role: 'date',
						read: true,
						write: false,
					},
					native: {},
				});

				// Create global_tilted_irradiance state
				await this.setObjectNotExistsAsync(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
					type: 'state',
					common: {
						name: {
							en: 'Global Tilted Irradiance',
							de: 'Globalstrahlung auf geneigter Fläche',
							ru: 'Глобальное Наклонное Облучение',
							pt: 'Irradiância Global Inclinada',
							nl: 'Globale Gekantelde Instraling',
							fr: 'Irradiation Globale Inclinée',
							it: 'Irradianza Globale Inclinata',
							es: 'Irradiancia Global Inclinada',
							pl: 'Globalne Napromieniowanie Nachylone',
							uk: 'Глобальне Нахилене Опромінення',
							'zh-cn': '全局倾斜辐照度',
						},
						type: 'number',
						role: 'value.power',
						unit: 'W/m²',
						read: true,
						write: false,
					},
					native: {},
				});
			}

			this.log.debug(`Created states for location: ${location.name}`);
		}
	}

	/**
	 * Update forecast data for all locations
	 */
	private async updateAllLocations(): Promise<void> {
		this.log.info('Updating forecast data for all locations');

		for (const location of this.config.locations) {
			try {
				await this.updateLocation(location);
			} catch (error) {
				this.log.error(`Error updating location ${location.name}: ${(error as Error).message}`);
			}
		}
	}

	/**
	 * Update forecast data for a specific location
	 *
	 * @param location - Location configuration
	 */
	private async updateLocation(location: Location): Promise<void> {
		this.log.debug(`Fetching forecast for ${location.name}`);

		try {
			const data = await this.apiCaller.fetchForecastData(location, this.config.forecastHours);

			if (!data.hourly || !data.hourly.time || !data.hourly.global_tilted_irradiance) {
				this.log.error(`Invalid data received from API for location ${location.name}`);
				return;
			}

			const locationName = this.sanitizeLocationName(location.name);
			const currentTime = new Date();
			const currentHour = new Date(
				currentTime.getFullYear(),
				currentTime.getMonth(),
				currentTime.getDate(),
				currentTime.getHours(),
			);

			// Find the index of the current hour in the API response
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

			// Update states with rolling data (hour0 = current hour)
			const hoursToUpdate = Math.min(this.config.forecastHours, data.hourly.time.length - currentHourIndex);

			for (let hour = 0; hour < hoursToUpdate; hour++) {
				const dataIndex = currentHourIndex + hour;
				const time = dataIndex < data.hourly.time.length ? data.hourly.time[dataIndex] : null;
				const rawIrradiance = data.hourly.global_tilted_irradiance[dataIndex];

				// Berechnung: W/m² von der API * installierte kWp
				// Beispiel: 500 W/m² * 5 kWp = 2500 Watt (2.5 kW)
				const kwpFactor = location.kwp || 0;
				const calculatedPower = Math.round(rawIrradiance * kwpFactor);

				if (time) {
					await this.setState(`${locationName}.pv-forecast.hour${hour}.time`, {
						val: time,
						ack: true,
					});

					// Wir schreiben den berechneten Watt-Wert in den State
					await this.setState(`${locationName}.pv-forecast.hour${hour}.global_tilted_irradiance`, {
						val: calculatedPower,
						ack: true,
					});
				}
			}

			this.log.debug(`Successfully updated ${hoursToUpdate} hours for ${location.name}`);
		} catch (error) {
			this.log.error(`Failed to fetch data for ${location.name}: ${(error as Error).message}`);
			throw error;
		}
	}

	/**
	 * Sanitize location name for use in state IDs
	 *
	 * @param name - Location name to sanitize
	 * @returns Sanitized name
	 */
	private sanitizeLocationName(name: string): string {
		return name
			.replace(/[^a-zA-Z0-9_-]/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '');
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - Callback function
	 */
	private onUnload(callback: () => void): void {
		try {
			if (this.updateInterval) {
				clearInterval(this.updateInterval);
			}
			this.log.info('Adapter stopped');
			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${(error as Error).message}`);
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param id - State ID
	 * @param state - State object
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (state && !state.ack) {
			this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		}
	}

	/**
	 * Handle messages from admin UI
	 *
	 * @param obj - Message object
	 */
	private async onMessage(obj: ioBroker.Message): Promise<void> {
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
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new OpenMeteoPvForecast(options);
} else {
	// otherwise start the instance directly
	(() => new OpenMeteoPvForecast())();
}
