# Bienestar estudiantil – Sistema con servidor y correo automático

Sistema web con cuentas de usuario (cédula y contraseña), estudiantes separados por grado y sección,
estados de cuenta con abonos mensuales, carga desde Excel y **correo automático al encargado** cada vez
que se registra un abono. También se puede instalar como app en el celular o la computadora.

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
- Al registrar un abono, el correo con todos los detalles sale solo hacia el correo del encargado.
  En la ficha hay “Reenviar correo” y, en el estado de cuenta, “Enviar estado de cuenta”.
- **Excel:** “Descargar plantilla Excel” trae las columnas y las instrucciones. Al subirlo, cada estudiante
  se coloca en su grado y sección. Si la cédula ya existe, se actualizan sus datos.
  (Las funciones de Excel cargan la librería SheetJS desde internet; el navegador necesita conexión.)

## 5. Ponerlo en internet para que cualquiera entre
Necesita un lugar donde el servidor esté encendido siempre:
- Un servidor propio o de la institución, o un servicio en la nube que ejecute Node.js
  (por ejemplo Render, Railway o Fly.io). Comando de inicio: `npm start`.
- **MUY IMPORTANTE – guardado de datos:** el sistema guarda todo en la carpeta `data`. En muchos servicios
  en la nube el disco normal **se borra al reiniciar**. Use un **disco o volumen persistente** y apunte
  `DATA_DIR` a esa ruta. Sin eso, perderá los datos.
- Use **https** (los servicios en la nube lo dan) y ponga `COOKIE_SECURE=true`.
- Ponga su cédula en `ADMIN_CEDULA` para que solo usted pueda crear la primera cuenta de administrador.
- Configure las variables del archivo `.env` en el panel del servicio (no suba el archivo `.env` a ningún sitio público).

## 6. Respaldos y seguridad
- El sistema copia la base de datos cada día a `data/backups` (guarda los últimos 30 días).
  Copie esa carpeta a otro lugar con regularidad. Además, descargue el Excel con frecuencia.
- Las contraseñas se guardan cifradas. Se bloquean los intentos repetidos de entrada.
- Son datos de menores y de sus familias: use https, limite quién es administrador y consulte la
  normativa de protección de datos que aplique a su institución.

## 7. Instalarlo como app
Abra la dirección en Chrome (Android o computadora) y elija **Instalar** o **Agregar a la pantalla de inicio**.
En iPhone: Safari → Compartir → **Agregar a pantalla de inicio**. Requiere que el sistema esté en https.

## 8. Límites conocidos
- Los datos se guardan en un archivo JSON: ideal para un colegio (hasta unos pocos miles de estudiantes).
  Si necesita más, conviene pasar a una base de datos.
- Si dos personas editan el mismo estudiante al mismo tiempo, prevalece el último guardado.
- Si olvida la contraseña del único administrador, hay que restaurar o editar el archivo `data/db.json`.
