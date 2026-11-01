# Hotel amanecer en campos: proyecto de prueba

Angular 22 + Node.js 26 + PostgreSQL, con un **gateway** entre el frontend y el backend.

```
Navegador → Angular (:4200) ──/api──► Gateway (:3000) ──► Backend (:4000) ──► PostgreSQL (:5432)
```

La configuración local está en `.env` en la raíz. El backend usa `DATABASE_URL`; Angular no recibe credenciales de base de datos.

## Requisitos

- Node.js 24.15 o superior (recomendado Node 26)
- Servicio PostgreSQL local accesible con `DATABASE_URL` (en este entorno, PostgreSQL 17 de Windows)
- Docker solo si quieres levantar una base aislada para pruebas

## Arranque local

```bash
npm run setup  # instala dependencias de la raíz, backend, gateway y frontend
npm run dev    # arranca backend, gateway y frontend a la vez
```

Abre http://localhost:4200

El `.env` de la raíz está excluido de Git. Backend y gateway lo cargan desde sus scripts de npm; no copies sus secretos al frontend. Angular usa `/api` y el proxy de desarrollo, por lo que no necesita un `environment.ts` para esta configuración local.

## Qué hace cada pieza

- `frontend/`: Angular. Solo llama a rutas relativas `/api/...`; el proxy de desarrollo (`proxy.conf.js`) las manda al gateway.
- `gateway/`: Express + http-proxy-middleware. Reenvía `/api/*` al backend. Aquí añadirías autenticación, límites de peticiones, etc.
- `backend/`: Express + pg + Nodemailer. Rutas públicas: `GET /api/health`, `GET /api/rooms`, `GET /api/rooms/availability?check_in=AAAA-MM-DD&check_out=AAAA-MM-DD&adults=2&children=0`, `POST /api/bookings`, `POST /api/contact`, `GET /api/reservations/:token`, `GET /api/site-settings`, `GET /api/testimonials` y `GET/POST /api/pre-check-in/:token`. Escucha solo en 127.0.0.1, así que solo el gateway llega a él.
- `db/init.sql`: crea las tablas `rooms`, `room_availability_blocks`, `bookings`, `pre_checkings`, `site_settings`, `site_closures`, `booking_testimonials` y `administradores`, y añade 3 habitaciones de ejemplo. Docker ejecuta este archivo solo al inicializar un volumen de datos vacío.
- `backend/src/index.js`: al arrancar, migra las características de habitaciones de `TEXT[]` a `JSONB`, migra los datos antiguos de pre-check-in desde `bookings` a `pre_checkings`, elimina las columnas antiguas tras copiarlas, genera referencias para reservas anteriores y crea el primer administrador si la tabla aún está vacía. También crea las tablas de contenido/opiniones/cierres y añade la configuración inicial del sitio. No vuelve a cargar los datos de ejemplo en cada arranque.

El backend envía por SMTP el enlace de pre-check-in. El `.env` raíz debe incluir `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` y `FRONTEND_BASE_URL`. El token se genera aleatoriamente, solo se almacena su hash, queda inutilizado tras completar el formulario y el pre-check-in solo se habilita desde 72 horas antes hasta 24 horas después de la entrada.

El correo de confirmación incluye un QR para consultar la reserva, una vista previa del mapa con el enlace `Cómo llegar`, el resumen y el precio. El QR utiliza un token aleatorio independiente del pre-check-in: solo se guarda su hash en `bookings.access_token_hash`. Quien tenga el QR puede ver los datos personales de la reserva y, si el pre-check-in ya se completó, sus datos identificativos; por ello el enlace debe tratarse como confidencial y no compartirse. El QR también permite abrir el pre-check-in únicamente durante la ventana válida. Los valores `HOTEL_ADDRESS`, `HOTEL_MAP_URL`, `HOTEL_PHONE`, `HOTEL_CHECK_IN_TIME` y `HOTEL_CHECK_OUT_TIME` proporcionan los valores iniciales; el nombre, teléfono, dirección y textos de la web se pueden editar después desde el panel.

El formulario de `/contacto` envía las solicitudes al email de contacto configurado en el sitio, o a `EMAIL_USER` si no se ha indicado uno, usando el SMTP ya configurado. La cuenta `EMAIL_USER` sigue siendo el remitente SMTP. También envía un acuse al correo del visitante; se limita a tres envíos por dirección cada 15 minutos. El formulario solo usa los datos para contestar la solicitud y no los guarda en la base de datos.

La sección `/carmen-admin/configuracion` permite editar datos de contacto (incluidos email y segundo teléfono), número de estrellas, textos de inicio y de `/conocenos`, servicios, enlaces sociales activos, contenido de las políticas, dirección, enlace del mapa y horario de recepción. Los servicios y redes se guardan como JSON en `site_settings`. Las imágenes de portada, bienvenida y experiencia se cargan como JPG/PNG/WebP (máximo 5 MB), se optimizan y guardan en `backend/assets/imagenes/web/`; `site_settings` solo guarda rutas locales como `/api/web-images/hero.webp`. Las imágenes web no dependen de servicios externos y el paneo de la portada se desactiva si el dispositivo solicita movimiento reducido.

El pie de página muestra sitemap, habitaciones activas, contacto, redes, estrellas configuradas y enlaces a `/politica-privacidad`, `/aviso-legal` y `/politica-cookies`. Completa y revisa el contenido legal desde el panel antes de publicar el sitio. El aviso de cookies permite aceptar o rechazar opciones y recordar la elección durante seis meses; el sitio actualmente no carga cookies de análisis ni publicidad, y la preferencia puede cambiarse desde el footer.

La galería pública está en `/galeria`; desde `/carmen-admin/galeria` se crean álbumes, se suben fotos y se moderan las fotos y comentarios enviados por visitantes. Las imágenes se convierten a WebP en el navegador y el backend las vuelve a optimizar antes de guardarlas en el bucket público, bajo `gallery/{slug-del-álbum}/`. Las aportaciones públicas y comentarios se guardan como pendientes y solo se muestran tras aprobación. El esquema repetible está en `db/gallery.sql`: el backend lo aplica al arrancar en la base indicada por `DATABASE_URL`; para crear estas tablas directamente en Supabase, ejecuta el mismo SQL desde Supabase SQL Editor con la conexión de backend existente. Las tablas tienen RLS habilitado sin políticas de acceso desde clientes; la aplicación accede a través del backend autenticado.

En esa sección también se pueden crear, editar y eliminar periodos de cierre. Las fechas son inclusivas; la búsqueda pública, la creación de reservas y la edición administrativa rechazan cualquier estancia que coincida con un cierre activo. Los cierres pasados no se aplican y el dashboard avisa de los periodos futuros. Cada día a las 10:00 (hora de `Europe/Madrid`), el backend busca estancias finalizadas durante los últimos siete días y envía una invitación individual. El enlace de `/testimonio/:token` es de un solo uso; el token solo se almacena como hash, y el huésped elige las estrellas, el texto, el tipo de viaje y el alias público, además de aceptar su publicación. Las opiniones pendientes no aparecen en la web: solo se muestran las que un administrador haya aprobado. Tras enviarla, el huésped recibe un correo de agradecimiento.

El panel de administración está en `/carmen-admin`. La tabla `administradores` guarda el usuario, el hash bcrypt de la contraseña, su estado y las fechas de creación y actualización. Para crear el primer administrador, configura temporalmente `ADMIN_USERNAME` y `ADMIN_PASSWORD` en el `.env` raíz antes de arrancar el backend; se guardará el hash y esos valores no se vuelven a usar ni sobrescriben la cuenta en siguientes arranques. Después puedes retirar ambas variables. Las contraseñas iniciales admiten hasta 72 bytes UTF-8, límite de bcrypt.

Configura también `ADMIN_JWT_SECRET` con una clave aleatoria de al menos 32 bytes. Puedes generarla con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. El backend entrega un JWT firmado en una cookie `HttpOnly`, `SameSite=Strict` y, en producción, `Secure`, con expiración de ocho horas. Al cerrar sesión se incrementa la versión de sesión del administrador en la base de datos y el token queda invalidado. El dashboard comprueba la sesión con el backend, que limita a cinco los intentos fallidos por IP cada 15 minutos. Para revisar las cuentas sin exponer hashes: `SELECT id, username, is_active, created_at, updated_at FROM administradores;`.

La sección de habitaciones del panel está en `/carmen-admin/habitaciones`. Permite crear, editar, activar, desactivar y eliminar alojamientos; las características se guardan como una lista JSONB. Las imágenes JPG, PNG y WebP de hasta 5 MB se guardan en `backend/assets/imagenes/habitaciones/{slug}/habitacion.{extension}` y su URL en `rooms.image_url`. El cambio de imagen reemplaza la anterior. Las habitaciones con reservas históricas no se pueden borrar: desactívalas para conservar el historial. En la edición también puedes bloquear intervalos de fechas; `room_availability_blocks` se consulta en la búsqueda y se vuelve a comprobar al confirmar cada reserva. El precio, la imagen y las características actualizados se muestran en las tarjetas públicas, el detalle de reserva y el correo de confirmación.

El formulario recoge datos identificativos, contacto, preferencias y consentimientos en `pre_checkings`, relacionado con la reserva y la habitación. Las horas previstas de llegada y salida son opcionales. El OCR de las imágenes del documento se ejecuta localmente en el navegador con Tesseract.js; las fotos no se envían a un servicio OCR externo y solo se envían al backend al completar el pre-check-in. El backend guarda las imágenes en `assets/imagenes/pre-checking/{año}/{mes}/{identificación}/` y sus rutas en `pre_checkings`. No se almacenan números/CVV de tarjetas. Las imágenes identificativas requieren controles de acceso y retención; la firma de texto y los campos implementados no sustituyen una revisión legal/operativa ni la integración con SES.HOSPEDAJES.

## Cosas útiles

- La base usada por el backend es la indicada en `DATABASE_URL`. En la configuración actual conecta a `amanecer` en `127.0.0.1:5432`, usuario `postgres`; el servidor activo es PostgreSQL 17 de Windows y guarda sus datos en `C:/Program Files/PostgreSQL/17/data`.
- En DBeaver crea una conexión PostgreSQL con host `127.0.0.1`, puerto `5432`, base `amanecer` y usuario `postgres`. Borrar la conexión de DBeaver solo borra el perfil, no la base ni sus datos.
- Consultar las reservas en PostgreSQL local: `psql -h 127.0.0.1 -p 5432 -U postgres -d amanecer -c "SELECT * FROM bookings;"`.
- Docker es opcional y crea una base separada: `npm run db:up`. El contenedor publica por defecto en el puerto `5433`, usa el volumen `pgdata` y ejecuta `db/init.sql` solo en su primera inicialización. No es la base a la que apunta el `DATABASE_URL` actual.
- `npm run db:reset` elimina el volumen Docker `pgdata` y sus datos; no borra el PostgreSQL local de Windows. No lo ejecutes si necesitas conservar los datos de ese contenedor.
- Cambiar un puerto: edita `.env` y reinicia `npm run dev`. Para el puerto expuesto por Docker, usa `DOCKER_POSTGRES_PORT`.
- Fotos reales: pon `image_url` en la tabla `rooms` (por ejemplo `/img/suite.jpg`) y deja los archivos en `frontend/public/img/`.
- Todos los textos, nombres y datos de contacto son ficticios. No se ha copiado ningún texto ni imagen de otras plantillas.
# amanecer
# amanecer
