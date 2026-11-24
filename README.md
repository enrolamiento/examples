# Ejemplos de la API de Enrolamiento

Código listo para clonar y correr contra la [API de Enrolamiento](https://developers.enrolamiento.cl):
la certificación SII para emisores de DTE.

| Ejemplo | Qué muestra | Node |
|---|---|---|
| Consultar una certificación | La primera llamada: autenticarse, leer la respuesta y leer un error | [`node/quickstart`](node/quickstart/get-certification.mjs) |
| Recibir webhooks | Verificar la firma, deduplicar y responder a tiempo | [`node/webhook-receiver`](node/webhook-receiver/server.mjs) |

## Qué necesita

- **Node 22.12 o más nuevo.** Los ejemplos usan el SDK oficial,
  [`enrolamiento`](https://www.npmjs.com/package/enrolamiento), y no tienen otra dependencia.
- **Una cuenta de Enrolamiento**, para el ejemplo que llama a la API: su usuario y su APIKey están en
  el portal de clientes, **Mi Cuenta**, pestaña **Integración**. Si todavía no tiene cuenta, créela en
  [www.enrolamiento.cl](https://www.enrolamiento.cl).

El receptor de webhooks se puede probar sin cuenta, en su máquina.

## Empezar

```bash
git clone https://github.com/enrolamiento/examples.git
cd examples/node
npm install
cp .env.example .env    # complete su usuario y su APIKey
node --env-file=.env quickstart/get-certification.mjs <RUT de la empresa>
```

El RUT es el de la empresa cliente que usted certifica, no el suyo. La salida esperada, la
configuración de cada ejemplo y qué hacer si algo falla están en [`node/README.md`](node/README.md).

## Documentación

| | |
|---|---|
| [Quickstart](https://developers.enrolamiento.cl/docs/quickstart/) | De las credenciales a la primera respuesta |
| [Referencia](https://developers.enrolamiento.cl/docs/referencia/) | Cada operación, con sus parámetros, respuestas y errores |
| [Errores y reintentos](https://developers.enrolamiento.cl/docs/errores-y-reintentos/) | Cómo leer un error y cuándo es seguro reintentar |
| [Webhooks](https://developers.enrolamiento.cl/docs/webhooks/) | Los eventos, la firma y los reintentos |
| [Changelog](https://developers.enrolamiento.cl/docs/changelog/) | Qué cambió en cada versión de la API |
| [SDK de Node](https://github.com/enrolamiento/enrolamiento-node#readme) | El paquete que usan estos ejemplos: errores, reintentos, `ambiente` y webhooks |

## Compatibilidad

Los ejemplos usan la versión 0.2 del SDK, que habla con la versión 1 de la API (`/v1/…`). Un cambio
incompatible de la API sube su versión mayor y se anuncia en el
[changelog](https://developers.enrolamiento.cl/docs/changelog/).

## Soporte

Este repositorio no recibe issues. Para consultas sobre su integración, o si un ejemplo no funciona,
escriba a soporte@enrolamiento.cl. Para reportar una vulnerabilidad, vea la
[política de seguridad](https://github.com/enrolamiento/.github/blob/main/SECURITY.md).

## Licencia

[MIT](LICENSE).
