// El recorrido: monta el widget con la marca del ERP y, al terminar, muestra «Esperando el aviso».
// Es un script clásico, no un módulo: `Enrolamiento` lo dejó global el script del widget.

// La marca llega en atributos data- del <body>, no en un script en línea: la CSP no lo dejaría correr.
const marca = { nombre: document.body.dataset.marcaNombre, color: document.body.dataset.marcaColor };

const seccionWidget = document.querySelector('#widget');
const cargando = document.querySelector('#cargando');
const esperando = document.querySelector('#esperando');
const cajaDeError = document.querySelector('#recorrido-error');
const textoDeError = document.querySelector('#recorrido-error-texto');

function mostrarError(texto) {
  textoDeError.textContent = texto;
  cajaDeError.hidden = false;
}

// Le pide una sesión al servidor del ERP. La APIKey vive ahí; acá llega solo el client_secret.
async function pedirSesion(ruta) {
  const respuesta = await fetch(ruta, { method: 'POST' });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(cuerpo.mensaje ?? `El servidor respondió ${respuesta.status}.`);
  return cuerpo.client_secret;
}

let portabilidad;
let turno = 0;

async function empezar() {
  // Si llega otro «Reintentar» mientras se espera la sesión, este pedido queda viejo y no monta nada.
  const miTurno = ++turno;
  cajaDeError.hidden = true;
  esperando.hidden = true;
  seccionWidget.hidden = false;
  cargando.hidden = false;
  let clientSecret;
  try {
    clientSecret = await pedirSesion('/sesion');
  } catch (error) {
    if (miTurno === turno) {
      cargando.hidden = true;
      mostrarError(`No se pudo crear la sesión. ${error.message}`);
    }
    return;
  }
  if (miTurno !== turno) return;

  portabilidad?.unmount();
  // Solo las claves básicas de la apariencia: funcionan igual con o sin marca blanca. El logo se
  // publica en el portal; el widget no lo toma de acá.
  portabilidad = Enrolamiento().portabilidad({
    clientSecret,
    locale: 'es-CL',
    appearance: { nombre: marca.nombre, variables: { colorPrimary: marca.color } },
  });

  // Los oyentes se registran antes de montar: un client_secret mal formado avisa por `error` un
  // instante después de mount, y un oyente que llega tarde no lo ve.
  portabilidad.on('ready', () => {
    cargando.hidden = true;
  });
  // No es el fin del recorrido: también llega por un rechazo que la empresa corrige en el widget, y
  // el widget le muestra el mensaje. Acá queda anotado para quien depura.
  portabilidad.on('error', (e) => console.info(`El widget avisó un error: ${e.codigo}`));
  // Sirve para la pantalla. Lo que el ERP activa, lo activa el webhook certificacion.finalizada.
  portabilidad.on('completed', () => {
    seccionWidget.hidden = true;
    esperando.hidden = false;
  });
  // La sesión vence a los 60 minutos: se pide otra para la misma empresa, sin reiniciar el guion, y el
  // widget sigue sin recargarse.
  portabilidad.on('session_expired', async () => {
    try {
      portabilidad.update({ clientSecret: await pedirSesion('/sesion?seguir=1') });
    } catch (error) {
      mostrarError(`No se pudo renovar la sesión. ${error.message}`);
    }
  });

  portabilidad.mount('#portabilidad');
}

document.querySelector('#reintentar').addEventListener('click', empezar);
empezar();
