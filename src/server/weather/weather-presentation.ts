export type WeatherPresentationInput = {
  recorded_date: string;
  temperature: number | null;
  humidity: number | null;
  uv_index: number | null;
  weather_code: string | null;
};

export type WeatherViewModel = {
  recorded_date: string;
  location_label: string;
  temperature_c: number | null;
  humidity_percent: number | null;
  uv_index: number | null;
  condition: string | null;
};

const weatherConditions: Record<string, string> = {
  "0": "晴",
  "1": "晴",
  "2": "多云",
  "3": "阴",
  "45": "雾",
  "48": "雾",
  "51": "毛毛雨",
  "53": "毛毛雨",
  "55": "毛毛雨",
  "56": "冻毛毛雨",
  "57": "冻毛毛雨",
  "61": "小雨",
  "63": "雨",
  "65": "大雨",
  "66": "冻雨",
  "67": "冻雨",
  "71": "小雪",
  "73": "雪",
  "75": "大雪",
  "77": "雪粒",
  "80": "阵雨",
  "81": "阵雨",
  "82": "强阵雨",
  "85": "阵雪",
  "86": "强阵雪",
  "95": "雷雨",
  "96": "雷雨",
  "99": "强雷雨",
};

export function formatWeatherCondition(weatherCode: string | null): string | null {
  return weatherCode ? weatherConditions[weatherCode] ?? null : null;
}

export function toWeatherViewModel(
  weather: WeatherPresentationInput,
  locationLabel: string,
): WeatherViewModel {
  return {
    recorded_date: weather.recorded_date,
    location_label: locationLabel,
    temperature_c: weather.temperature,
    humidity_percent: weather.humidity,
    uv_index: weather.uv_index,
    condition: formatWeatherCondition(weather.weather_code),
  };
}
