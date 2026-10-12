---
name: paraguas
description: Create or adapt a static Astro website that uses local weather to recommend practical clothing for going outside. Use for weather-based outfit planner requests; ask for a city only if it cannot be inferred from context.
metadata:
  short-description: Weather-based outfit web app in Astro
---

# Qué me pongo según el tiempo

Create a usable, static Astro website that helps someone decide what to wear before going outside, based on current local weather. The reference implementation is the Santander app in this project: Spanish UI, practical restrained styling, current conditions, a short outfit recommendation, and a compact near-term forecast.

## Build the app

- Work in the user's existing project when available. If it is empty, initialize a minimal Astro project with static output and the usual `dev`, `build`, and `preview` scripts.
- Treat the requested city as configuration for the experience: resolve its latitude, longitude, display name, and IANA time zone. Use Santander, Cantabria, Spain (43.4623, -3.80998; `Europe/Madrid`) when Santander is requested or clearly established by context. Do not silently substitute a different city.
- Keep the site static. Fetch current conditions in the browser from a suitable public weather API; Open-Meteo's forecast endpoint can provide current temperature, apparent temperature, precipitation, wind, and daily highs/lows without an API key. Request only fields the interface uses, set the city's timezone, and handle failed or unavailable requests in the UI.
- Turn the weather into a few clear clothing suggestions. Base warmth primarily on apparent temperature; account for rain and strong wind explicitly. Keep the advice practical, concise, and easy to scan. Treat forecast rain probability as a useful signal, not as certainty.
- For this app, recommend taking an umbrella when the precipitation probability is 50% or higher at any hourly forecast point in the next three hours. Otherwise clearly say that an umbrella is not needed.
- Show an initial loading state, the last update time, and a refresh action. On fetch failure, show a helpful retry message and a safe generic suggestion instead of leaving the app blank.
- Use an accessible, responsive layout with semantic headings, readable contrast, and status updates that assistive technology can announce. Keep visual choices aligned with the requested mood; the Santander reference is simple, calm, and functional.
- Make the city and date presentation consistent with the weather API's local timezone. Avoid adding accounts, server infrastructure, a database, or paid APIs unless the user asks for them.

## Finish

- Provide the working Astro page and project configuration, not just a mockup or plan.
- If the project is already populated, inspect it and preserve its conventions instead of replacing unrelated work.
- Tell the user how to start the site and whether it is currently running. Mention any external weather-service dependency that affects live data.
