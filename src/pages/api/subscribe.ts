import type { APIRoute } from 'astro';

export const prerender = false;

function jsonResponse(message: string, status = 200): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return jsonResponse('No se pudo verificar el origen de la solicitud.', 403);
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse('Formato de solicitud no válido.', 415);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 4096) {
    return jsonResponse('La solicitud es demasiado grande.', 413);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse('No se pudo leer el formulario.', 400);
  }

  if (!payload || typeof payload !== 'object') {
    return jsonResponse('Completa el formulario para suscribirte.', 400);
  }

  const form = payload as Record<string, unknown>;
  const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : '';
  const consent = form.consent === true;
  const honeypot = typeof form.website === 'string' ? form.website : '';

  if (honeypot) {
    return jsonResponse('Si el correo se puede añadir, recibirás los avisos.');
  }

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return jsonResponse('Escribe una dirección de correo válida.', 400);
  }

  if (!consent) {
    return jsonResponse('Debes aceptar recibir el aviso diario para suscribirte.', 400);
  }

  const apiKey = process.env.BREVO_API_KEY;
  const listId = Number(process.env.BREVO_LIST_ID);
  if (!apiKey || !Number.isSafeInteger(listId) || listId < 1) {
    console.error('Brevo subscription is missing server configuration.');
    return jsonResponse('El servicio de suscripción no está configurado todavía.', 503);
  }

  let brevoResponse: Response;
  try {
    brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        listIds: [listId],
        updateEnabled: false,
      }),
    });
  } catch (error) {
    console.error('Brevo contact request failed.', error);
    return jsonResponse('No se pudo conectar con el servicio de correo. Inténtalo más tarde.', 502);
  }

  if (brevoResponse.status === 201 || brevoResponse.status === 204) {
    return jsonResponse('Suscripción confirmada. Recibirás el aviso diario a las 7:30.');
  }

  if (brevoResponse.status === 400 || brevoResponse.status === 409) {
    return jsonResponse('No se pudo añadir ese correo. Puede que ya esté suscrito o que no se pueda volver a suscribir.', 409);
  }

  console.error('Brevo rejected the contact request.', { status: brevoResponse.status });
  return jsonResponse('No se pudo guardar la suscripción. Inténtalo más tarde.', 502);
};
