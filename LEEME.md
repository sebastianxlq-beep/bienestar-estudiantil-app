# Bienestar estudiantil – Sistema con servidor y correo automático

Sistema web con cuentas de usuario (cédula y contraseña), estudiantes separados por grado y sección, estados de cuenta con abonos mensuales, carga desde Excel y correos al encargado. En Render utiliza PostgreSQL (Supabase) para conservar los datos aunque el servicio se reinicie. También puede ejecutarse localmente con archivo JSON.

## 1. Requisitos
- Una computadora o servidor con **Node.js 18 o más nuevo** (https://nodejs.org).
- Una cuenta de correo para enviar los avisos (por ejemplo, una de Gmail del colegio).

## 2. Probarlo en su computadora (10 minutos)
1. Descomprima la carpeta y ábrala en una terminal.
2. Ejecute: `npm install`
3. Copie el archivo `.env.example` con el nombre `.env` y complete sus datos (ver sección 3).
4. Ejecute: `npm start`
5. Abra http://localhost:3000 en el navegador.
6. Elija **Administrador**, vaya a **Crear cuenta** y cree la cuenta principal con su cédula.
   Con esa cuenta aprueba a los profes guía y administra todo.

## 3. Configurar el correo automático
Edite el archivo `.env`:
- **Gmail:** active la verificación en dos pasos, cree una “contraseña de aplicación” en su cuenta de Google
  y úsela en `SMTP_PASS`. Deje `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`.
- **Otro proveedor:** use los datos SMTP que le indique (servidor, puerto y si es seguro).
- Si el correo no está configurado, el sistema funciona igual, pero muestra un aviso y **no envía** correos.
- Gmail y otros proveedores limitan cuántos correos se pueden enviar por día; revise el límite de su cuenta.

## 4. Cómo se usa
- **Cualquier persona puede crear su cuenta** desde la pantalla de entrada (cédula + contraseña).
  Las cuentas de profe guía quedan **pendientes** hasta que un administrador las apruebe en **Usuarios**
  (puede desactivar esto con `REQUIRE_APPROVAL=false`, pero no se recomienda: son datos de menores).
- El **administrador** ve todos los grados, importa Excel, maneja usuarios, usa “Nuevo año” y elimina.
- El **profe guía** solo ve y maneja su sección.
- **Finalizar año (administrador):** guarda TODOS los datos con el nombre que usted escriba (por ejemplo
  “Año lectivo 2026”) y abre un año nuevo, en blanco o conservando a los estudiantes con las cuentas en cero.
  **Años anteriores** lista cada año guardado y permite **descargar todo en Excel** (resumen del año, una hoja
  por grado, movimientos y abonos por mes). Los años guardados nunca se borran con “Borrar datos”.
- Al registrar un abono se abre un correo para el encargado con todos los detalles ya escritos. Usted lo revisa o lo
  edita y presiona **Enviar correo** (no sale solo). También hay “Enviar correo” junto a cada abono, “Recordatorio de pago”
  y “Escribir y enviar estado de cuenta”.
- **Excel:** “Descargar plantilla Excel” trae las columnas y las instrucciones. Al subirlo, cada estudiante
  se coloca en su grado y sección. Si la cédula ya existe, se actualizan sus datos.
  (Las funciones de Excel cargan la librería SheetJS desde internet; el navegador necesita conexión.)

## 5. Ponerlo en internet para que cualquiera entre
Necesita un lugar donde el servidor esté encendido siempre:
- Un servidor propio o de la institución, o un servicio en la nube que ejecute Node.js
  (por ejemplo Render, Railway o Fly.io). Comando de inicio: `npm start`.
- **Guardado de datos:** en Render configure `DATABASE_URL` con la URI PostgreSQL de Supabase (preferiblemente Session Pooler). El servidor crea automáticamente la tabla `public.app_state` y guarda allí los datos. No necesita contratar un disco de Render. Si `DATABASE_URL` falta en producción, el servidor no arranca para evitar guardar datos en almacenamiento temporal.
- Use **https** (los servicios en la nube lo dan) y ponga `COOKIE_SECURE=true`.
- Ponga su cédula en `ADMIN_CEDULA` para que solo usted pueda crear la primera cuenta de administrador.
- Configure las variables del archivo `.env` en el panel del servicio (no suba el archivo `.env` a ningún sitio público).

### Publicar en Render con el archivo render.yaml (la forma más sencilla)
1. Cree una cuenta en https://github.com y un repositorio nuevo (puede ser privado).
2. En el repositorio, elija **Add file → Upload files**, suba **el contenido** de la carpeta (no el .zip) y confirme.
   No suba el archivo `.env`.
3. En https://dashboard.render.com elija **New → Blueprint**, seleccione ese repositorio y presione continuar.
4. Render le pedirá los datos privados: `ADMIN_CEDULA` (su cédula), `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`.
5. Al terminar, Render le da una dirección https://….onrender.com. Ábrala y cree la cuenta de administrador.
El plano incluye un **disco persistente** (por eso usa un plan de pago de Render; revise el precio actual en su sitio).
Sin disco persistente los datos se pierden al reiniciar.

## 6. Respaldos y seguridad
- En producción los datos están en PostgreSQL/Supabase. Configure y revise los respaldos disponibles en su plan de Supabase y descargue el Excel con frecuencia. En ejecución local con JSON, el sistema conserva copias en `data/backups`.
- Las contraseñas se guardan cifradas. Se bloquean los intentos repetidos de entrada.
- Son datos de menores y de sus familias: use https, limite quién es administrador y consulte la
  normativa de protección de datos que aplique a su institución.

## 7. Instalarlo como app
Abra la dirección en Chrome (Android o computadora) y elija **Instalar** o **Agregar a la pantalla de inicio**.
En iPhone: Safari → Compartir → **Agregar a pantalla de inicio**. Requiere que el sistema esté en https.

## 8. Límites conocidos
- En Render, los datos se guardan en una fila JSONB de PostgreSQL; localmente, en un archivo JSON.
- Si dos personas editan el mismo estudiante al mismo tiempo, prevalece el último guardado.
- Si olvida la contraseña del único administrador, hay que restaurar o editar el archivo `data/db.json`.


## 9. Novedades de esta versión
- **Aprobación de profes guía:** al crear una cuenta, el sistema avisa por correo a **todos** los administradores
  y muestra un aviso en su pantalla. Con que **uno** la apruebe (en “Usuarios”) la persona ya puede entrar y recibe un
  correo de confirmación. Toda cuenta debe llevar un correo electrónico.
- **¿Olvidó su contraseña?:** en la pantalla de entrada. Se envía un enlace al correo de la cuenta; vence en 1 hora y se
  puede usar una sola vez. Al cambiarla se cierran las sesiones abiertas. Si una cuenta no tiene correo, un administrador
  le cambia la contraseña desde “Usuarios”.
- **Código de barras del carnet (Code 128):** cada estudiante tiene su código en la ficha. Se imprime un carnet individual o
  “Imprimir carnets de la sección” (tarjetas de 85,6 × 54 mm, 10 por hoja). El código es el campo **Carnet** (columna J del
  Excel); si está vacío se usa la cédula.
- **Escanear carnet:** botón “Escanear carnet”. Funciona con un lector de código de barras USB o Bluetooth (el cursor queda
  listo en el campo) y con la cámara en navegadores compatibles (Chrome en Android y computadora). Safari en iPhone no
  permite leer códigos con la cámara: allí use un lector o escriba el código. Identifica por carnet o por cédula.
- **Recordatorios:** el día 1 de cada mes, a partir de las 8:00 (zona horaria `TZ`, por defecto Costa Rica), se envía un
  correo a cada encargado con saldo pendiente (uno por encargado, con todos sus estudiantes). Botón “Recordatorios de pago”
  para ver el último envío o enviarlos a mano. Se configura con `RECORDATORIO_MENSUAL`, `REMINDER_DAY` y `REMINDER_HOUR`.
- Las fechas de los abonos ahora usan la hora local (antes, después de las 6 p. m. se guardaba la fecha del día siguiente).
