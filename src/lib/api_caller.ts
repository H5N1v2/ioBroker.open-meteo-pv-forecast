import type { AxiosInstance } from 'axios';
import axios from 'axios';
import type { Location } from './adapter-config';

/** Hourly data structure from Open-Meteo API */
export interface OpenMeteoHourlyData {
	/** Array of ISO timestamps for each hour */
	time: string[];
	/** Array of irradiance values in W/m² */
	global_tilted_irradiance: number[];
}

/** Response structure from Open-Meteo API */
export interface OpenMeteoResponse {
	/** Latitude of location */
	latitude: number;
	/** Longitude of location */
	longitude: number;
	/** Timezone identifier */
	timezone: string;
	/** Hourly forecast data */
	hourly: OpenMeteoHourlyData;
}

/** Search result from Nominatim API */
//export interface NominatimResult {
/** Unique place identifier */
//	place_id: number;
/** Human-readable location name */
//	display_name: string;
/** Latitude as string */
//	lat: string;
/** Longitude as string */
//	lon: string;
//}

/** API caller for Open-Meteo and Nominatim services */
export class ApiCaller {
	private axiosInstance: AxiosInstance;

	/** Initialize the API caller with axios configuration */
	constructor() {
		this.axiosInstance = axios.create({
			timeout: 10000,
		});
	}

	/**
	 * Fetch PV forecast data from Open-Meteo API
	 *
	 * @param location - Location configuration
	 * @param forecastDays - Number of days to forecast
	 * @returns Promise with forecast data
	 */
	async fetchForecastData(location: Location, forecastDays: number): Promise<OpenMeteoResponse> {
		const hourlyparam_keys = 'global_tilted_irradiance';
		const url = `https://api.open-meteo.com/v1/forecast`;

		try {
			const response = await this.axiosInstance.get<OpenMeteoResponse>(url, {
				params: {
					latitude: location.latitude,
					longitude: location.longitude,
					tilt: location.tilt,
					azimuth: location.azimuth,
					hourly: hourlyparam_keys,
					timezone: location.timezone || 'auto', // 'auto' erkennt lokale Zeitzone
					forecast_days: forecastDays, // Geändert von forecast_hours
				},
			});

			return response.data;
		} catch (error) {
			if (axios.isAxiosError(error)) {
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
