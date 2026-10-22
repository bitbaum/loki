"use client";

import { Sun, CloudRain, Cloud, CloudSnow, CloudFog } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { REFRESH_CADENCE } from "@/config/refresh";
import { WEATHER_CITY } from "@/lib/constants/today";

function parseWeather(raw: string) {
  // Format: "Now: Mainly clear, 22.3°C, wind 6.1 km/h, humidity 31%\n2026-04-07: 6.8-22.3°C, Foggy"
  const lines = raw.split("\n").filter(Boolean);
  const now = lines[0] ?? "";
  const forecast = lines[1] ?? "";

  const tempMatch = now.match(/([\d.]+)°C/);
  const condMatch = now.match(/Now:\s*([^,]+)/);
  const windMatch = now.match(/wind\s+([\d.]+)\s*km/);
  const humMatch = now.match(/humidity\s+(\d+)/);
  const rangeMatch = forecast.match(/([\d.]+-[\d.]+)°C/);
  const foreCondMatch = forecast.match(/°C,\s*(.+)/);

  return {
    temp: tempMatch?.[1] ?? "--",
    condition: condMatch?.[1]?.trim() ?? "Unknown",
    wind: windMatch?.[1] ?? "--",
    humidity: humMatch?.[1] ?? "--",
    range: rangeMatch?.[1] ?? "",
    forecastCondition: foreCondMatch?.[1]?.trim() ?? "",
  };
}

function WeatherIcon({ condition, className }: { condition: string; className?: string }) {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return <CloudRain className={className} />;
  if (c.includes("snow")) return <CloudSnow className={className} />;
  if (c.includes("fog") || c.includes("mist")) return <CloudFog className={className} />;
  if (c.includes("cloud") || c.includes("overcast")) return <Cloud className={className} />;
  return <Sun className={className} />;
}

/**
 * The weather as one line under the greeting — "14° · Partly cloudy in
 * Zurich · 9–16° today" — not a card with its own heading beside the
 * calendar (design reset, 2026-10). It is nice to know, never something to
 * act on, so it says nothing while loading or when the source is down.
 */
export function WeatherCard() {
  const { data } = useFetch<{
    weather: string | null;
    city?: string;
    error?: string;
  }>("/api/weather", { intervalMs: REFRESH_CADENCE.weather, timeoutMs: 8_000 });

  if (!data?.weather || data.error) return null;

  const w = parseWeather(data.weather);
  if (w.temp === "--") return null;
  const cityName = data.city ?? WEATHER_CITY;

  return (
    <p className="ui-today-weather">
      <WeatherIcon condition={w.condition} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">
        {w.temp}° · {w.condition} in {cityName}
        {w.range && ` · ${w.range.replace("-", "–")}° today`}
      </span>
    </p>
  );
}
