const CITY = 'Santander';
const LATITUDE = 43.4623;
const LONGITUDE = -3.80998;
const TIMEZONE = 'Europe/Madrid';
const RAIN_THRESHOLD = 50;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isLocalDeliveryHour(date: Date): boolean {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date) === '07';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export async function sendDailyWeather(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const now = new Date();
  if (!isLocalDeliveryHour(now)) {
    return jsonResponse({ skipped: true, reason: 'Outside Santander delivery hour.' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME;
  const listId = Number(process.env.BREVO_LIST_ID);
  if (!apiKey || !senderEmail || !senderName || !Number.isSafeInteger(listId) || listId < 1) {
    console.error('Daily weather email is missing Brevo server configuration.');
    return jsonResponse({ error: 'Email service is not configured.' }, 503);
  }

  try {
    const today = localDate(now);
    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.search = new URLSearchParams({
      latitude: String(LATITUDE),
      longitude: String(LONGITUDE),
      hourly: 'precipitation_probability',
      timezone: TIMEZONE,
      forecast_days: '1',
    }).toString();

    const weatherResponse = await fetch(weatherUrl, { signal: AbortSignal.timeout(10_000) });
    if (!weatherResponse.ok) {
      console.error('Open-Meteo rejected the daily forecast request.', { status: weatherResponse.status });
      return jsonResponse({ error: 'Weather forecast unavailable.' }, 502);
    }

    const weather = await weatherResponse.json();
    const times: unknown = weather.hourly?.time;
    const probabilities: unknown = weather.hourly?.precipitation_probability;
    if (!Array.isArray(times) || !Array.isArray(probabilities) || times.length !== probabilities.length) {
      throw new Error('Open-Meteo returned an incomplete hourly forecast.');
    }

    const todayProbabilities = times.flatMap((time: unknown, index: number) => {
      const probability = probabilities[index];
      return typeof time === 'string' && time.startsWith(`${today}T`) && typeof probability === 'number'
        ? [probability]
        : [];
    });
    if (todayProbabilities.length === 0) {
      throw new Error('Open-Meteo returned no precipitation values for today.');
    }

    const maxRain = Math.max(...todayProbabilities);
    const rainExpected = maxRain >= RAIN_THRESHOLD;
    const subject = rainExpected
      ? 'Hoy puede llover en Santander'
      : 'Hoy pinta buen tiempo en Santander';
    const headline = rainExpected
      ? 'Hoy puede llover en Santander'
      : 'Hoy pinta buen tiempo en Santander';
    const content = `
      <!doctype html>
      <html lang="es">
        <body style="margin:0;padding:32px;background:#f4f5ef;color:#203b35;font-family:Arial,sans-serif">
          <main style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border-radius:12px">
            <p style="color:#75827b;font-size:13px">AVISO DEL TIEMPO · SANTANDER</p>
            <h1 style="font-size:24px">${escapeHtml(headline)}</h1>
            <p>La probabilidad máxima de lluvia prevista para hoy es del <strong>${Math.round(maxRain)}%</strong>.</p>
            <p>Recibes este mensaje porque te suscribiste al aviso diario del tiempo de Santander.</p>
            <p style="margin-top:28px;font-size:12px;color:#75827b">
              <a href="{{ unsubscribe }}" style="color:#245649">Darme de baja</a>
            </p>
          </main>
        </body>
      </html>`;

    const campaignResponse = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Aviso del tiempo Santander ${today}`,
        subject,
        previewText: `${headline}. Probabilidad máxima de lluvia: ${Math.round(maxRain)}%.`,
        sender: { name: senderName, email: senderEmail },
        recipients: { listIds: [listId] },
        htmlContent: content,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!campaignResponse.ok) {
      console.error('Brevo rejected the daily campaign.', { status: campaignResponse.status });
      return jsonResponse({ error: 'Email campaign could not be created.' }, 502);
    }

    const campaign: unknown = await campaignResponse.json();
    if (!campaign || typeof campaign !== 'object' || !('id' in campaign) || typeof campaign.id !== 'number') {
      throw new Error('Brevo returned a campaign without an ID.');
    }

    const sendResponse = await fetch(`https://api.brevo.com/v3/emailCampaigns/${campaign.id}/sendNow`, {
      method: 'POST',
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!sendResponse.ok) {
      console.error('Brevo rejected the daily campaign send request.', { status: sendResponse.status });
      return jsonResponse({ error: 'Email campaign could not be sent.' }, 502);
    }

    console.info('Daily Santander weather campaign sent.', { date: today, campaignId: campaign.id });
    return jsonResponse({ sent: true, date: today, rainProbability: Math.round(maxRain) });
  } catch (error) {
    console.error('Daily weather email failed.', error);
    return jsonResponse({ error: 'Daily weather email failed.' }, 502);
  }
}
