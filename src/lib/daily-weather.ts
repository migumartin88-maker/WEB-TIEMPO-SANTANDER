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

// Vercel Hobby fires a cron at any minute of its hour, so the cron runs in the hour
// before delivery (06:xx in Santander) and Brevo sends the campaign at the exact time.
const PREPARE_HOUR = '06';
const DELIVERY_TIME = '07:30:00';
// The email answers one question: do I take the umbrella when I leave home for work?
// It only looks at the morning commute (hourly values 07:00, 08:00 and 09:00, local time).
const FIRST_HOUR = 7;
const LAST_HOUR = 9;
const WINDOW_LABEL = 'de 7:30 a 9:30';
const SITE_URL = 'https://sacoparaguas.vercel.app/?utm_source=brevo&utm_medium=email&utm_campaign=aviso-diario';

function isLocalPrepareHour(date: Date): boolean {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date) === PREPARE_HOUR;
}

// ISO date-time of today's delivery in Santander, with its UTC offset (+01:00 or +02:00).
function deliveryDateTime(date: Date, today: string): string {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(date).find(({ type }) => type === 'timeZoneName')?.value.replace('GMT', '');
  return `${today}T${DELIVERY_TIME}${offset || '+00:00'}`;
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

// Avisa por email al administrador (ALERT_EMAIL) cuando el envío diario falla.
async function sendFailureAlert(reason: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'Saco Paraguas';
  if (!apiKey || !alertEmail || !senderEmail) {
    console.error('Failure alert not sent: missing ALERT_EMAIL or Brevo configuration.');
    return;
  }
  const when = new Intl.DateTimeFormat('es-ES', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: alertEmail }],
        subject: '⚠️ Saco Paraguas: hoy NO ha salido el aviso diario',
        htmlContent: `<p><strong>El aviso diario de Saco Paraguas no se ha enviado.</strong></p>
          <p>Fecha: ${escapeHtml(when)}</p>
          <p>Motivo: ${escapeHtml(reason)}</p>
          <p>Revisa Vercel (Logs) y Brevo (Campañas).</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error('Failure alert rejected by Brevo.', { status: response.status, detail: (await response.text()).slice(0, 300) });
    }
  } catch (error) {
    console.error('Failure alert could not be sent.', error);
  }
}

async function fail(reason: string, status = 502): Promise<Response> {
  console.error(`Daily weather email failed: ${reason}`);
  await sendFailureAlert(reason);
  return jsonResponse({ error: reason }, status);
}

export async function sendDailyWeather(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const now = new Date();
  if (!isLocalPrepareHour(now)) {
    return jsonResponse({ skipped: true, reason: 'Outside Santander delivery hour.' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME;
  const listId = Number(process.env.BREVO_LIST_ID);
  if (!apiKey || !senderEmail || !senderName || !Number.isSafeInteger(listId) || listId < 1) {
    return fail('Falta configuración de Brevo en Vercel (clave, remitente o lista).', 503);
  }

  try {
    const today = localDate(now);
    const scheduledAt = deliveryDateTime(now, today);
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
      return fail(`Open-Meteo no devolvió la previsión (HTTP ${weatherResponse.status}).`);
    }

    const weather = await weatherResponse.json();
    const times: unknown = weather.hourly?.time;
    const probabilities: unknown = weather.hourly?.precipitation_probability;
    if (!Array.isArray(times) || !Array.isArray(probabilities) || times.length !== probabilities.length) {
      throw new Error('Open-Meteo returned an incomplete hourly forecast.');
    }

    const todayProbabilities = times.flatMap((time: unknown, index: number) => {
      const probability = probabilities[index];
      const hour = typeof time === 'string' ? Number(time.slice(11, 13)) : NaN;
      return typeof time === 'string' && time.startsWith(`${today}T`) && hour >= FIRST_HOUR && hour <= LAST_HOUR
        && typeof probability === 'number'
        ? [probability]
        : [];
    });
    if (todayProbabilities.length === 0) {
      throw new Error('Open-Meteo returned no precipitation values for today.');
    }

    const maxRain = Math.max(...todayProbabilities);
    const rainExpected = maxRain >= RAIN_THRESHOLD;
    const subject = rainExpected
      ? '☂️ Sal de casa con paraguas'
      : '😎 Hoy puedes salir sin paraguas';
    const headline = rainExpected
      ? 'Llévate el paraguas al salir de casa'
      : 'Hoy puedes salir sin paraguas';
    const advice = rainExpected
      ? 'Es probable que te mojes de camino al trabajo.'
      : 'En principio llegas seco al trabajo. Aunque en Santander nunca se sabe…';
    const content = `
      <!doctype html>
      <html lang="es">
        <body style="margin:0;padding:32px;background:#f4f5ef;color:#203b35;font-family:Arial,sans-serif">
          <main style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border-radius:12px">
            <p style="color:#75827b;font-size:13px">AVISO DEL TIEMPO · SANTANDER</p>
            <h1 style="font-size:24px">${escapeHtml(headline)}</h1>
            <p>🚶 Salida de casa (${WINDOW_LABEL}): probabilidad de lluvia de hasta el <strong>${Math.round(maxRain)}%</strong>.</p>
            <p>${escapeHtml(advice)}</p>
            <p style="margin:24px 0">
              <a href="${SITE_URL}" style="display:inline-block;padding:12px 18px;background:#245649;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">¿Sales a otra hora? Mira tu tramo</a>
            </p>
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
        previewText: `Salida de casa ${WINDOW_LABEL}: lluvia de hasta el ${Math.round(maxRain)}%.`,
        sender: { name: senderName, email: senderEmail },
        recipients: { listIds: [listId] },
        htmlContent: content,
        scheduledAt,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!campaignResponse.ok) {
      const detail = (await campaignResponse.text()).slice(0, 300);
      return fail(`Brevo rechazó crear la campaña (HTTP ${campaignResponse.status}): ${detail}`);
    }

    const campaign: unknown = await campaignResponse.json();
    if (!campaign || typeof campaign !== 'object' || !('id' in campaign) || typeof campaign.id !== 'number') {
      throw new Error('Brevo returned a campaign without an ID.');
    }

    console.info('Daily Santander weather campaign scheduled.', { date: today, scheduledAt, campaignId: campaign.id });
    return jsonResponse({ scheduled: true, date: today, scheduledAt, rainProbability: Math.round(maxRain) });
  } catch (error) {
    return fail(`Error inesperado: ${error instanceof Error ? error.message : String(error)}`);
  }
}
