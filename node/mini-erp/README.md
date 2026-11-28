# Mini ERP

Un software ficticio, «Andes ERP», que trae a una empresa con el
[widget de Portabilidad](https://developers.enrolamiento.cl/docs/portabilidad/) y termina con sus datos
adentro: productos, clientes, proveedores, ventas y compras, cada documento con su XML y su PDF.

Muestra la integración completa, de punta a punta:

1. su servidor crea la sesión con su APIKey;
2. la página monta el widget con la marca de su software;
3. Enrolamiento avisa con un webhook firmado que la certificación terminó y que el respaldo está listo;
4. su servidor descarga el respaldo y lo importa.

En una prueba el camino es el mismo que en producción. Solo cambia de dónde sale el aviso: en la prueba lo
manda la línea de comandos del SDK y en producción, Enrolamiento.

## Probarlo en su máquina

Necesita Node 22.12 o más nuevo, y su usuario y su APIKey del portal de clientes (**Mi Cuenta**, pestaña
**Integración**). Es una sesión de prueba: no hace falta contratar nada.

Todos los comandos se corren desde la carpeta `node/`.

```bash
git clone https://github.com/enrolamiento/examples.git
cd examples/node
npm install
cp .env.example .env    # ENROLAMIENTO_USUARIO, ENROLAMIENTO_APIKEY y ENROLAMIENTO_WEBHOOK_SECRETO
npm run mini-erp        # http://localhost:3000
```

En `ENROLAMIENTO_WEBHOOK_SECRETO` sirve cualquier texto: en la prueba, el aviso lo firma el CLI con ese mismo
secreto, el que verifica el ERP. Si quiere uno al azar:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

1. Abra `http://localhost:3000`. El ERP está vacío: «Trae tu empresa desde el facturador gratuito». Pulse
   **Traer mi empresa**.
2. Recorra el widget, como en el ejemplo `portability-widget`. Suba cualquier archivo `.pfx` o `.p12` de hasta
   75 KB, escriba cualquier contraseña y acepte el uso del certificado. Confirme los datos de ejemplo y
   agregue un producto y un servicio, cada uno con su nombre y su precio en números. En cerca de un minuto el
   recorrido termina.
3. La página pasa a **Esperando el aviso**. Pulse **Simular el aviso**: debajo aparecen el comando y su salida,
   línea por línea.
4. Cuando el respaldo queda importado, la página vuelve al inicio con la empresa, «Ferretería El Faro SpA»
   (`11111111-1`), y cuántos productos, clientes, proveedores, ventas y compras trajo. Cada lista se abre desde
   ahí. El detalle de una venta o una compra trae el encabezado, las líneas, los totales, el PDF y el XML, con
   botones para descargar los dos.
5. Para repetir la demo, pulse **Borrar los datos**, en «Empezar de nuevo», al pie del inicio.

La sesión de prueba no consulta al SII, no crea una certificación y no descuenta cupos.

### Qué hace «Simular el aviso»

El servidor del ERP corre el CLI del SDK como un proceso aparte:

```text
enrolamiento webhooks enviar certificacion.finalizada --url http://localhost:3000/webhooks/certificacion
```

El CLI firma un aviso `certificacion.finalizada` con `ENROLAMIENTO_WEBHOOK_SECRETO`, con el respaldo en
`listo`, y se lo manda al ERP. Deja el respaldo de ejemplo del paquete para descargar desde un servidor en
`127.0.0.1`, que imita la descarga de la API, y espera hasta 120 segundos a que el ERP lo baje. Del lado del
ERP pasa lo mismo que con un aviso real: verifica la firma, responde, pide la URL firmada con su usuario y su
APIKey, baja el archivo y lo importa.

- **Existe solo en modo prueba.** En modo real, la ruta `POST /simular` responde 404.
- **No recibe nada del navegador.** Los argumentos son siempre los mismos y el comando corre sin shell, de a uno:
  una segunda pulsación mientras corre no lanza otro.
- **La página no ve direcciones ni el secreto.** La salida llega con `[dirección]` en lugar de cada URL y
  `[secreto]` en lugar del secreto.
- Si el comando no termina en 150 segundos, el servidor lo corta y la página lo dice.

El mismo comando se puede correr a mano, en otra terminal:

```bash
npm run mini-erp:aviso
```

Es un script de `package.json` con el comando completo, `node --env-file=.env node_modules/enrolamiento/dist/cli.js
webhooks enviar certificacion.finalizada --url http://localhost:3000/webhooks/certificacion`: lee el secreto del
mismo `.env` que el ERP. El secreto no va en una opción del comando, porque quedaría en el historial de la
consola. El script apunta al puerto 3000. Si usted cambió `PUERTO`, la página muestra el comando con el suyo.

El respaldo de ejemplo es de «Ferretería El Faro SpA», un RUT sintético, con 20 ventas y 10 compras, su XML y su
PDF, en el formato del respaldo real. Los documentos no tienen firma ni validez tributaria.

El ERP importa un aviso solo si antes se creó una sesión, es decir, si ya pulsó **Traer mi empresa** y no borró
los datos desde entonces, y si el RUT del aviso es el de la sesión. Otro aviso se responde con 200 y se ignora.

### Probar el aviso `respaldo.finalizado`

El CLI firma siempre con `ENROLAMIENTO_WEBHOOK_SECRETO`. Para probar la segunda ruta, defina
`ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO` con el mismo valor, reinicie el ERP, recorra el widget y corra:

```bash
node --env-file=.env node_modules/enrolamiento/dist/cli.js webhooks enviar respaldo.finalizado --url http://localhost:3000/webhooks/respaldo
```

## Su marca

El ERP y el widget llevan la marca del `.env`, sin tocar código. Sirve para ver su propia marca y para una
demo de venta.

| Variable | Qué es | Por omisión |
|---|---|---|
| `MINI_ERP_NOMBRE` | El nombre del software, hasta 60 caracteres. Uno más largo se corta | `Andes ERP` |
| `MINI_ERP_COLOR` | El color principal, como `#RRGGBB`. Otro valor se ignora | `#1D4ED8` |

Escriba el color entre comillas, `MINI_ERP_COLOR="#0F766E"`: sin ellas, `node --env-file` lee el `#` como el
comienzo de un comentario y el color queda vacío. El texto sobre el color es blanco o negro, el que más
contrasta.

El ejemplo le pasa al widget solo las claves básicas de `appearance`, `nombre` y `variables.colorPrimary`
([`public/journey.js`](public/journey.js)).

El logo se publica en el portal de clientes, en **Portabilidad › Apariencia del widget**. El widget no lo toma de
`appearance`.

## Por qué hay dos rutas de aviso

En **Mi Cuenta**, pestaña **Notificaciones**, cada evento es una suscripción aparte, con su dirección y su propio
secreto de firma. Por eso el ERP tiene una ruta por evento, y cada una verifica con el secreto de su suscripción:

| Ruta | Evento | Secreto |
|---|---|---|
| `POST /webhooks/certificacion` | `certificacion.finalizada` | `ENROLAMIENTO_WEBHOOK_SECRETO` |
| `POST /webhooks/respaldo` | `respaldo.finalizado` | `ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO`, opcional |

`certificacion.finalizada` llega siempre, con el bloque `respaldo`. El ERP decide por `respaldo.estado`:

| `respaldo` | Qué hace el ERP |
|---|---|
| `listo` | Descarga e importa |
| `en_proceso` | Muestra «El respaldo sigue armándose» y espera el aviso `respaldo.finalizado` |
| `fallido` | Muestra el código del motivo, sin importar |
| `vencido` | Muestra que el respaldo venció, sin importar |
| `null` | Muestra que la certificación terminó sin respaldo: la cuenta no lo tiene contratado o la empresa no es MiPyme |

`respaldo.finalizado` trae el mismo bloque, cuando el respaldo termina después de la certificación. Para
recibirlo, el ERP necesita `ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO`. Sin esa variable, su ruta responde 404, y
con `en_proceso` el ERP le recuerda que la defina.

Las dos rutas importan con la misma función. Un respaldo que llega por las dos se importa una vez.

## Qué hace el receptor, y por qué

| Paso | Por qué |
|---|---|
| Verifica con `webhooks.verificar` del SDK, sobre el cuerpo crudo y con el secreto de esa ruta | La firma cubre los bytes exactos. Una firma mala recibe 400 |
| Sin el secreto de `certificacion.finalizada`, responde 503 y dice qué variable falta | Así el ERP arranca igual y el motivo queda a la vista |
| Responde 200 enseguida y descarga después | La API espera 10 segundos, y el respaldo tarda más |
| Ignora un aviso ya visto, por su `id` | Un aviso puede llegar más de una vez |
| Ignora el aviso de otro RUT, o si no se creó una sesión | El RUT es el de la sesión, nunca el que trae el aviso |
| Responde 200 a un evento que no conoce, y lo ignora | La API puede agregar eventos. También ignora el de **Enviar prueba** |
| Pide `respaldo.url` con `?formato=json` y `Authorization: Basic`, y baja la URL firmada con otro GET, sin `Authorization` | El almacenamiento rechaza un pedido con las dos firmas |
| No sigue redirecciones | Un cliente HTTP que las sigue puede reenviar su credencial a otro host |
| Manda su usuario y su APIKey solo a la API configurada, por `https`. En modo prueba, también a `localhost` y `127.0.0.1` | La URL del aviso no decide a quién se le entregan las credenciales |
| Compara el archivo con `respaldo.bytes` y corta lo que pase de ese tamaño | Un archivo de otro tamaño no es el respaldo del aviso |
| Abre el `.zip` y acepta solo la forma de un respaldo (abajo) | El `.zip` llega por la red: ningún nombre de adentro se usa como ruta en el disco |
| Reemplaza lo importado todo o nada | Un `.zip` dañado o rechazado deja intactos los datos que ya había |

El importador ([`import.mjs`](import.mjs)) acepta una sola carpeta raíz, `mipyme-backup-<RUT>/`, con el RUT de la
sesión. Adentro, solo los JSON del respaldo y las carpetas `emitidos/` y `recibidos/`, con documentos
`<RUT>_<TIPO>_<FOLIO>.xml` o `.pdf`. Rechaza `..`, las rutas absolutas, las barras invertidas, las entradas
repetidas y las compresiones que un respaldo no usa. También topa las entradas (50.000) y lo descomprimido
(200 MB). Los archivos en el disco toman el nombre del `id` de cada documento, ya validado.

### El tope de tamaño

El ERP descarga e importa respaldos de hasta 50 MB (`TOPE_DE_BYTES`, en [`import.mjs`](import.mjs)). Uno más
grande se rechaza antes de descargarlo, con el mensaje `El respaldo pesa … bytes: este ejemplo importa hasta
52428800.`

El respaldo de ejemplo pesa unos 220 KB. El de una empresa con varios años de documentos puede pesar cientos de
MB. Este ejemplo lo lee entero en memoria. **Antes de llevarlo a producción, ajuste el tope** y procese el
archivo por partes, desde el disco.

## Modo real

Con `MINI_ERP_MODO=real` el código es el mismo. Cambia esto:

- la sesión es real, de la empresa de `MINI_ERP_RUT`: se pide con `prueba: false` y sin escenario. Consulta al
  SII, crea la certificación y descuenta cupos;
- los avisos se procesan solo si son de `MINI_ERP_RUT`. Sin un `MINI_ERP_RUT` válido, el ERP arranca igual, pero
  el recorrido no monta el widget y dice qué falta;
- «Simular el aviso» no existe: `POST /simular` responde 404;
- el ERP manda su usuario y su APIKey solo a la API configurada, por `https`. Un aviso con una URL de
  `localhost`, como el del CLI, se rechaza.

Para recibir un aviso de verdad hace falta:

- el respaldo activo en **Mi plan**;
- sesiones reales habilitadas para su cuenta;
- una dirección `https` pública que llegue al puerto del ERP, por ejemplo un túnel. Regístrela en **Mi Cuenta ›
  Notificaciones** para `certificacion.finalizada`, con su secreto en `ENROLAMIENTO_WEBHOOK_SECRETO`. Si
  quiere, regístrela también para `respaldo.finalizado`, con su secreto en `ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO`;
- el RUT de una empresa real en `MINI_ERP_RUT`, con guion y dígito verificador.

## Variables

Además de las de [`node/README.md`](../README.md#configuración):

| Variable | Qué es | Por omisión |
|---|---|---|
| `ENROLAMIENTO_WEBHOOK_SECRETO` | El secreto de la suscripción a `certificacion.finalizada`. En modo prueba, cualquier texto | Ninguno: sin él, el ERP arranca y el aviso dice qué falta |
| `ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO` | El secreto de la suscripción a `respaldo.finalizado` | Ninguno: la ruta `/webhooks/respaldo` responde 404 |
| `MINI_ERP_NOMBRE`, `MINI_ERP_COLOR` | La marca. Vea [Su marca](#su-marca) | `Andes ERP`, `#1D4ED8` |
| `MINI_ERP_MODO` | `prueba` o `real`. Cualquier otro valor es `prueba` | `prueba` |
| `MINI_ERP_RUT` | Solo en modo real: el RUT de la empresa, como `12345678-5`. Se revisa el dígito verificador. En modo prueba se ignora | Ninguno. En modo prueba, la empresa es `11111111-1`, la del respaldo de ejemplo |
| `PUERTO` | El puerto del ERP | `3000` |
| `MINI_ERP_DATOS` | La carpeta donde se guarda lo importado | `mini-erp/datos/`, en `.gitignore` |
| `ENROLAMIENTO_WIDGET` | Opcional: otro origen del script del widget | `https://widget.enrolamiento.cl` |
| `ENROLAMIENTO_URL` | Opcional: otra dirección de la API | `https://api.enrolamiento.cl` |

## Los archivos, y cuáles copiar

| Archivo | Qué hace | ¿Lo copia a su sistema? |
|---|---|---|
| [`notices.mjs`](notices.mjs) | Verifica el aviso, decide por el estado del respaldo, descarga | Sí. Es el centro de la integración |
| [`import.mjs`](import.mjs) | Abre y valida el `.zip`, y guarda su contenido | Sí, con su almacenamiento y su tope |
| [`public/journey.js`](public/journey.js) | Monta el widget con la marca, renueva la sesión vencida y espera el aviso | La parte del widget, sí |
| [`server.mjs`](server.mjs) | Arranca el servidor, reparte las rutas y pone las cabeceras. Crea la sesión en `POST /sesion` | La creación de la sesión y las cabeceras, adaptadas a su servidor |
| [`config.mjs`](config.mjs) | Lee el entorno: modo, marca, secretos, puerto y carpeta de datos | No: use su configuración |
| [`store.mjs`](store.mjs) | El almacén de archivos en `datos/` | No: en su sistema, su base de datos |
| [`simulate.mjs`](simulate.mjs) | Corre el CLI para «Simular el aviso» | No: en producción el aviso lo manda Enrolamiento |
| [`views.mjs`](views.mjs), [`public/app.css`](public/app.css) | Las pantallas del ERP ficticio | No |
| `*.test.mjs` | Las pruebas, junto a cada archivo | Como guía para las suyas |

Las páginas traen la política de seguridad `default-src 'self'; script-src 'self' <widget>; frame-src 'self'
<widget>; object-src 'none'`, sin scripts ni estilos en línea. El XML se muestra siempre escapado y nunca se
parsea. El PDF se sirve desde el mismo origen con `Content-Type: application/pdf` y `X-Content-Type-Options:
nosniff`.

Las pruebas corren en su máquina, sin salir a la red: una API falsa, y el CLI contra el ERP con un secreto de
prueba.

```bash
npm test                                  # todos los ejemplos
node --test 'mini-erp/**/*.test.mjs'      # solo el Mini ERP
```

## Qué no es

- **No es un ERP.** No emite documentos, no edita datos y no tiene usuarios.
- **Las rutas no piden inicio de sesión.** En su sistema, crear una sesión y borrar datos exigen la sesión de su
  usuario.
- **La empresa sale del `.env`.** En modo prueba es la del respaldo de ejemplo; en modo real, `MINI_ERP_RUT`. En
  su sistema sale de lo que ya sabe del usuario, nunca del navegador.
- **Guarda una sola empresa.** Importar de nuevo reemplaza lo anterior.
- **Recuerda los avisos vistos en memoria.** Se olvidan al reiniciar. En su sistema, guárdelos en su base de datos.
- **No se expone a la red.** Escucha solo en `127.0.0.1`. En modo real, el aviso llega por el túnel.

## Si algo falla

| Qué ve | Causa | Qué hacer |
|---|---|---|
| `No se pudo crear la sesión. Faltan las credenciales en el servidor…` | Falta `ENROLAMIENTO_USUARIO` o `ENROLAMIENTO_APIKEY` | Complete el `.env` y reinicie el ERP |
| `No se pudo crear la sesión. El widget no está habilitado para su cuenta.` | El widget todavía no está habilitado para su cuenta | No lo reintente |
| `No se pudo crear la sesión. La API respondió …` | La API rechazó el pedido | La consola del servidor trae el código y el mensaje |
| `No cargó el script del widget (enrolamiento.js)…` | El navegador no pudo bajar el script del widget | Revise su conexión, los bloqueadores de contenido y `ENROLAMIENTO_WIDGET`, si la definió |
| `Falta MINI_ERP_RUT en el .env, o no es un RUT válido…` | Modo real sin el RUT de la empresa, o con un dígito verificador que no corresponde | Defina `MINI_ERP_RUT` y reinicie el ERP |
| `El comando terminó con el código 2.` | Falta `ENROLAMIENTO_WEBHOOK_SECRETO`, o el comando está mal escrito | La salida dice cuál. Complete el `.env` y reinicie el ERP |
| El comando espera 120 s y termina con el código 1 | El ERP ignoró el aviso: no se había creado una sesión | Pulse **Traer mi empresa** y recorra el widget antes de mandar el aviso |
| `No está instalado el paquete enrolamiento…` | Falta instalar el SDK | `npm install`, desde `node/` |
| `El respaldo pesa … bytes: este ejemplo importa hasta 52428800.` | El respaldo pasa el tope del ejemplo | Vea [El tope de tamaño](#el-tope-de-tamaño) |
| `La url del respaldo no es de la API configurada…` | En modo real llegó un aviso con una URL local, como el del CLI | En modo real, el aviso lo manda Enrolamiento |
| `Solo se borran los datos desde el propio ERP.` | La página se abrió desde otra dirección | Abra el ERP en `http://localhost:3000` o `http://127.0.0.1:3000`, con su `PUERTO` si lo cambió |
| `EADDRINUSE` al arrancar | Otro programa usa el puerto 3000 | Defina otro en `PUERTO` |
