// This file extends the AdapterConfig type from "@iobroker/types"

export interface Location {
	name: string;
	latitude: number;
	longitude: number;
	tilt: number;
	azimuth: number;
	kwp: number;
	timezone: string;
}

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			locations: Location[];
			forecastHours: number;
			updateInterval: number;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};