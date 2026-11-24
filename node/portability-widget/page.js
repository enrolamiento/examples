// Paso 3 de la guía: montar el widget y escuchar sus eventos.
// Es un script clásico, no un módulo: `Enrolamiento` lo dejó global el script del widget.

const eventos = document.querySelector('#eventos');
const escenario = document.querySelector('#escenario');

function anotar(texto) {
  const fila = document.createElement('li');
  fila.textContent = `${new Date().toLocaleTimeString()}  ${texto}`;
  eventos.append(fila);
}

// Le pide una sesión al servidor de este ejemplo. La APIKey vive ahí; acá llega solo el client_secret.
async function pedirSesion(conEscenario) {
  const respuesta = await fetch(`/sesion${conEscenario ? `?escenario=${encodeURIComponent(conEscenario)}` : ''}`, { method: 'POST' });
  const cuerpo = await respuesta.json();
  if (!respuesta.ok) throw new Error(cuerpo.error);
  return cuerpo.client_secret;
}

let portabilidad;

async function empezar() {
  eventos.replaceChildren();
  let clientSecret;
  try {
    clientSecret = await pedirSesion(escenario.value);
  } catch (error) {
    anotar(`No se pudo crear la sesión: ${error.message}. Mire la consola del servidor.`);
    return;
  }

  portabilidad?.unmount();
  portabilidad = Enrolamiento().portabilidad({ clientSecret, locale: 'es-CL' });

  // Los oyentes se registran antes de cualquier await: un client_secret mal formado avisa por `error`
  // un instante después de mount, y un oyente que llega tarde no lo ve.
  // No es el fin del recorrido: también llega por un rechazo que la empresa corrige en el widget.
  portabilidad.on('error', (e) => anotar(`error: ${e.codigo}`));
  portabilidad.on('ready', () => anotar('ready'));
  portabilidad.on('step_change', (e) => anotar(`step_change: paso ${e.paso}, pantalla ${e.pantalla}`));
  // `balde` dice quién lo resuelve: reintentable, resuelve_el_contribuyente o escalar_al_proveedor.
  portabilidad.on('requires_action', (e) => anotar(`requires_action: ${e.codigo} (${e.balde})`));
  // Sirve para la pantalla. Lo que su sistema activa, lo activa el webhook certificacion.finalizada.
  // resolucion y resumen pueden venir en null.
  portabilidad.on('completed', (e) => anotar(`completed: resolución ${e.resolucion?.numero}, ${e.resumen?.emitidos} emitidos`));
  // La sesión vence a los 60 minutos: se pide otra para la misma empresa, sin escenario para no
  // reiniciar el guion, y el widget sigue sin recargarse.
  portabilidad.on('session_expired', async () => {
    anotar('session_expired: se pide otra sesión');
    portabilidad.update({ clientSecret: await pedirSesion() });
  });

  portabilidad.mount('#portabilidad');
}

document.querySelector('#reiniciar').addEventListener('click', empezar);
empezar();
