![Logo](admin/open-meteo-pv-forecast.png)
# ioBroker.open-meteo-pv-forecast (--ALPHA--)

[![NPM version](https://img.shields.io/npm/v/iobroker.open-meteo-pv-forecast.svg)](https://www.npmjs.com/package/iobroker.open-meteo-pv-forecast)
[![Downloads](https://img.shields.io/npm/dm/iobroker.open-meteo-pv-forecast.svg)](https://www.npmjs.com/package/iobroker.open-meteo-pv-forecast)
![Number of Installations](https://iobroker.live/badges/open-meteo-pv-forecast-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/open-meteo-pv-forecast-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.open-meteo-pv-forecast.png?downloads=true)](https://nodei.co/npm/iobroker.open-meteo-pv-forecast/)

**Tests:** ![Test and Release](https://github.com/H5N1v2/ioBroker.open-meteo-pv-forecast/workflows/Test%20and%20Release/badge.svg)

## open-meteo-pv-forecast adapter for ioBroker (ALPHA)

PV Forecast Data


## Changelog
### 0.2.0-alpha.0 (2026-02-19)
* (H5N1v2) Added temperature_2m, cloud_cover, wind_speed_10m, sunshine_duration to hourly forecast.
* (H5N1v2) feat: Leave latitude and longitude empty to use system coordinates.
* (H5N1v2) Added URL debug output for API calls.
* (H5N1v2) Update dev dependencies.

### 0.1.1-alpha.0 (2026-02-15)
* (H5N1v2) Fix: Daily peak was incorrect, it only recorded the period from the current hour until the end of the day.

### 0.1.0-alpha.0 (2026-02-13)
* (H5N1v2) feat: add forecastDays for Sum
* (H5N1v2) Modified the fetching logic to retrieve enough hourly data to cover both hourly and daily forecasts.
* (H5N1v2) Implemented a new method to calculate and update daily forecast data based on hourly data.
* (H5N1v2) Adjusted the time format for hourly forecast states to display only HH:mm.

### 0.0.1-alpha.0 (2026-02-13)
* (H5N1v2) initial release

## License
MIT License

Copyright (c) 2026 H5N1v2 <h5n1@iknox.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.