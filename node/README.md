# Ejemplos en Node

Tres ejemplos sobre el SDK oficial, [`enrolamiento`](https://www.npmjs.com/package/enrolamiento). Corren con
Node 22.12 o más nuevo.

| Ejemplo | Archivo | Necesita |
|---|---|---|
| Consultar una certificación | [`quickstart/get-certification.mjs`](quickstart/get-certification.mjs) | Su usuario y su APIKey |
| Recibir webhooks | [`webhook-receiver/server.mjs`](webhook-receiver/server.mjs) | Un secreto de firma |
| Widget de Portabilidad | [`portability-widget/server.mjs`](portability-widget/server.mjs) | Su usuario y su APIKey |

## Configuración

Todos los comandos se corren desde esta carpeta.

```bash
npm install
cp .env.example .env
```

| Variable | Qué es | Dónde se obtiene |
|---|---|---|
| `ENROLAMIENTO_USUARIO` | El RUT de su empresa, con guion y dígito verificador | El mismo con el que entra al portal de clientes |
| `ENROLAMIENTO_APIKEY` | Su «Llave de acceso» | Portal de clientes: **Mi Cuenta**, pestaña **Integración** |
| `ENROLAMIENTO_WEBHOOK_SECRETO` | El secreto de firma de los webhooks | Portal de clientes: **Mi Cuenta**, pestaña **Notificaciones**. Se muestra una sola vez |

`.env` está en `.gitignore`: no lo suba a un repositorio.

## Consultar una certificación

```bash
node --env-file=.env quickstart/get-certification.mjs <RUT de la empresa>
```

El RUT es el de la empresa cliente que usted certifica, no el suyo. Es una lectura: no cambia nada y
se puede repetir.

Con una certificación en curso, la salida tiene esta forma:

```text
RUT:        11111111-1
Estado:     1 (en progreso)
Etapa:      2
Comentario: Set de prueba enviado al SII.
```

Si usted todavía no creó una certificación para ese RUT, la API responde 404 y el ejemplo lo dice.
No es una falla de su integración:

```text
No hay certificación para 11111111-1: No existe una certificación…
```

Qué significa cada valor de `Estado` y `Etapa` está en
[Ciclo de vida de una certificación](https://developers.enrolamiento.cl/docs/ciclo-de-vida/).

## Recibir webhooks

### Probarlo en su máquina

No hace falta publicar nada. Use cualquier secreto de prueba en `ENROLAMIENTO_WEBHOOK_SECRETO`, por
ejemplo el que da este comando:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

En una terminal, arranque el receptor:

```bash
node --env-file=.env webhook-receiver/server.mjs
```

En otra, pruébelo con la línea de comandos del SDK, que lee ese mismo secreto de `.env`:

```bash
npm run webhooks:probar
```

Le envía 15 avisos firmados como los firma Enrolamiento: los que el receptor debe aceptar, uno por
evento y por estado del respaldo, y cuatro que debe rechazar (firmado con otro secreto, con el cuerpo
alterado, con una fecha vencida y sin firma). Termina con `15 de 15 casos respondieron como se
esperaba.`, y el receptor imprime una línea por cada aviso válido.

El mismo comando prueba un receptor escrito en cualquier lenguaje: `npx enrolamiento webhooks probar
--url http://localhost:8080/su-ruta`, con `ENROLAMIENTO_WEBHOOK_SECRETO` en el entorno.

### Recibir avisos reales

Enrolamiento entrega solo a direcciones `https` públicas, en el puerto 443 y con un certificado
válido.

1. Publique el receptor detrás de su proxy o de un túnel `https`.
2. En el portal de clientes, **Mi Cuenta**, pestaña **Notificaciones**, escriba esa dirección en el
   evento que quiere recibir y marque **Activa**.
3. Guarde y copie el secreto de firma a `ENROLAMIENTO_WEBHOOK_SECRETO`. Reinicie el receptor.
4. Pulse **Enviar prueba**.

Los eventos, sus campos y los reintentos están en la guía de
[Webhooks](https://developers.enrolamiento.cl/docs/webhooks/).

### Qué hace el receptor, y por qué

| Paso | Por qué |
|---|---|
| Lee el cuerpo crudo y se lo pasa a `webhooks.verificar` | La firma cubre los bytes exactos: un cuerpo reescrito ya no coincide |
| Rechaza un aviso de hace más de 5 minutos (lo hace `verificar`) | Protege contra la repetición de un aviso capturado |
| Compara la firma en tiempo constante (lo hace `verificar`) | Una comparación común filtra información por el tiempo que tarda |
| Responde 204 antes de procesar | Pasados 10 segundos sin respuesta, la entrega cuenta como fallida y se reintenta |
| Ignora un aviso ya visto, por su `id` | Un aviso puede llegar más de una vez, con el mismo `id` |
| Deja una rama `default` al leer `evento` | La API puede agregar eventos que esta versión no conoce |

El receptor guarda los avisos vistos en memoria. En su sistema, guárdelos en su base de datos.

[`webhook-receiver/receiver.test.mjs`](webhook-receiver/receiver.test.mjs) arranca el receptor y le envía avisos
bien y mal firmados. Corre en su máquina, sin salir a la red:

```bash
npm test
```

## Si algo falla

| Qué ve | Causa | Qué hacer |
|---|---|---|
| `Cannot find package 'enrolamiento'` | Falta instalar el SDK | `npm install`, desde esta carpeta |
| `Faltan las credenciales de la API` | `.env` no se cargó o está incompleto | Corra el comando desde esta carpeta, con `--env-file=.env` |
| `node: .env: not found` | No existe `.env` | `cp .env.example .env` |
| `node: bad option: --env-file=.env` | Node anterior a 20.6 | Instale Node 22.12 o más nuevo |
| `401: revise ENROLAMIENTO_USUARIO…` | La API no aceptó la credencial | Escriba el usuario como lo muestra el portal (con guion, y `K` mayúscula si corresponde). Si generó una APIKey nueva, la anterior dejó de servir |
| `No hay certificación para…` | No hay una certificación para ese RUT | Es la respuesta esperada para un RUT que todavía no certificó |
| `409: se alcanzó el límite de llamadas` | Más de 120 llamadas por minuto | Espere al menos 60 segundos antes de reintentar |
| El receptor responde 401 | La firma no coincide | Revise que el secreto sea el del portal, que el reloj del servidor esté en hora y que su proxy no modifique el cuerpo |

## Llevarlo a su sistema

Instale el SDK en su proyecto con `npm install enrolamiento`. Trae lo que toda integración necesita: la
credencial, los errores con su código, los reintentos y la verificación de webhooks. Su
[README](https://github.com/enrolamiento/enrolamiento-node#readme) lo explica entero.

- **Decida por el código de error, no por el status.** Los rechazos de negocio llegan como HTTP 500
  ([Errores y reintentos](https://developers.enrolamiento.cl/docs/errores-y-reintentos/)).
- **Fije `ambiente` al crear el cliente**: `new Enrolamiento({ ambiente: Ambiente.Homologacion })`. La API corre
  en producción si `ambiente` falta o no se reconoce; el SDK no envía una operación que lo recibe sin él
  ([Ambientes](https://developers.enrolamiento.cl/docs/ambientes/)).
- **No ponga la APIKey en código que corra en el navegador.**

## Widget de Portabilidad

El recorrido con el que una empresa deja el facturador gratuito del SII y pasa a su sistema, dentro
de una página suya. El ejemplo hace las dos mitades de la integración:

| Archivo | Dónde corre | Qué hace |
|---|---|---|
| [`server.mjs`](portability-widget/server.mjs) | Su servidor | Crea la sesión con su APIKey y entrega solo el `client_secret` |
| [`index.html`](portability-widget/index.html) | El navegador | El contenedor y el script del widget |
| [`page.js`](portability-widget/page.js) | El navegador | Monta el widget y anota los eventos que recibe |

```bash
node --env-file=.env portability-widget/server.mjs
```

Abra `http://localhost:3000`. Aparece el widget pidiendo el certificado digital: suba cualquier
archivo, porque en una sesión de prueba no se valida ni se guarda. En cerca de un minuto el recorrido
llega a la pantalla de cierre, y debajo quedan los eventos: `ready`, varios `step_change` y
`completed`.

- **Es una sesión de prueba.** No consulta al SII, no crea una certificación y no descuenta cupos.
  No hace falta contratar nada: alcanza con una cuenta.
- **El selector cambia el escenario** y «Reiniciar» empieza el guion de cero. Los cinco están en la
  [guía](https://developers.enrolamiento.cl/docs/portabilidad/#probar).
- **Desde `localhost` no hay que registrar el origen.** En cualquier otro dominio, regístrelo antes
  en el portal de clientes, **Portabilidad › Instalación**.
- **Una sesión de prueba no envía webhooks.** Para probar su receptor, use `npm run webhooks:probar`.

Si la página dice que no pudo crear la sesión, la consola del servidor trae el motivo:

| Motivo | Qué significa |
|---|---|
| `WIDGET_NO_HABILITADO` | El widget todavía no está habilitado para su cuenta. No lo reintente |
| `FUNCION_NO_CONTRATADA` | Se pidió una sesión real sin el respaldo activo. Este ejemplo pide siempre una de prueba |
| `DATOS_INVALIDOS` | Un campo del pedido no es válido; el mensaje dice cuál |

Lo que este ejemplo simplifica, y que su sistema tiene que hacer:

- La ruta `/sesion` no pide que el usuario haya iniciado sesión. La suya, sí.
- El RUT es fijo. El suyo sale de lo que su sistema ya sabe del usuario, nunca del navegador.
- Nada se activa al recibir `completed`: la confirmación es el webhook `certificacion.finalizada`.

La explicación de cada paso está en
[Widget de Portabilidad](https://developers.enrolamiento.cl/docs/portabilidad/), y cada método,
evento y opción, en la [referencia del widget](https://developers.enrolamiento.cl/docs/widget/).
