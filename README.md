# Aviso del tiempo de Santander

La web muestra el tiempo de Santander y permite suscribirse a un correo diario de Brevo. A las 7:30, hora local, se consulta la probabilidad máxima de lluvia del día en Open-Meteo: con un 50% o más se envía un aviso de lluvia; por debajo del 50%, un mensaje de buen tiempo.

El proyecto requiere Node.js 22.23.4 o posterior.

## Configuración en Brevo y Vercel

1. **Revoca cualquier clave API que se haya compartido en un chat o publicado.** Genera una nueva en Brevo y guárdala solo en las variables de entorno de Vercel. No la añadas al código ni a Git.
2. En Brevo, crea una lista para los avisos, configura y verifica el remitente, y autentica el dominio remitente para mejorar la entregabilidad.
3. En Vercel, abre **Project → Settings → Environment Variables** y crea estas variables para **Production**:
   - `BREVO_API_KEY`: una clave API nueva de Brevo.
   - `BREVO_LIST_ID`: ID numérico de la lista para estos suscriptores.
   - `BREVO_SENDER_EMAIL`: dirección del remitente verificado.
   - `BREVO_SENDER_NAME`: nombre visible del remitente.
   - `CRON_SECRET`: valor aleatorio largo para proteger las rutas programadas.
4. Vuelve a desplegar en Vercel después de guardar las variables. Las tareas programadas de `vercel.json` se ejecutan en producción. Las dos franjas UTC cubren el horario de verano e invierno; la función envía solo cuando en Santander son las 7:30.

La suscripción requiere aceptación explícita y añade el contacto a la lista configurada. Los correos incluyen un enlace de baja gestionado por Brevo. La previsión usa Open-Meteo; si el servicio o Brevo no están disponibles, la función informa del error en los registros de Vercel y no envía un mensaje de éxito.

Para desarrollo local, copia `.env.example` a `.env.local` y completa los valores allí. No subas `.env.local` a Git. Las rutas programadas no se ejecutan automáticamente en local.
