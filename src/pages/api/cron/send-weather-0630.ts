import type { APIRoute } from 'astro';
import { sendDailyWeather } from '../../../lib/daily-weather';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => sendDailyWeather(request);
