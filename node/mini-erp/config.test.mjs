// Lo que el ERP lee del entorno: los valores de fábrica y lo que se ignora por inválido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { leerConfig, leerCredenciales, RUT_DE_LA_EMPRESA } from './config.mjs';

test('sin variables, el ERP arranca con la marca de fábrica, en modo prueba y sin secretos', () => {
  assert.deepEqual(leerConfig({}), {
    puerto: 3000,
    modo: 'prueba',
    widget: 'https://widget.enrolamiento.cl',
    urlBase: 'https://api.enrolamiento.cl',
    marca: { nombre: 'Andes ERP', color: '#1D4ED8', textoSobreColor: '#FFFFFF' },
    secretoCertificacion: null,
    secretoRespaldo: null,
    datos: fileURLToPath(new URL('./datos/', import.meta.url)),
  });
});

test('la carpeta de datos se puede cambiar con MINI_ERP_DATOS', () => {
  assert.equal(leerConfig({ MINI_ERP_DATOS: '/tmp/otra' }).datos, '/tmp/otra');
  assert.equal(leerConfig({ MINI_ERP_DATOS: '' }).datos, fileURLToPath(new URL('./datos/', import.meta.url)));
});

test('las credenciales se leen aparte, y vacías cuentan como ausentes', () => {
  assert.deepEqual(leerCredenciales({ ENROLAMIENTO_USUARIO: '11111111-1', ENROLAMIENTO_APIKEY: 'apikey-de-prueba' }), {
    usuario: '11111111-1',
    apikey: 'apikey-de-prueba',
  });
  assert.deepEqual(leerCredenciales({ ENROLAMIENTO_USUARIO: '', ENROLAMIENTO_APIKEY: undefined }), { usuario: null, apikey: null });
  assert.equal('apikey' in leerConfig({ ENROLAMIENTO_APIKEY: 'apikey-de-prueba' }), false);
});

test('la empresa del recorrido es un RUT de prueba fijo', () => {
  assert.equal(RUT_DE_LA_EMPRESA, '11111111-1');
});

test('lee el puerto, el widget, la API y los dos secretos del entorno', () => {
  const config = leerConfig({
    PUERTO: '4100',
    ENROLAMIENTO_WIDGET: 'http://127.0.0.1:5173',
    ENROLAMIENTO_URL: 'http://127.0.0.1:8080',
    ENROLAMIENTO_WEBHOOK_SECRETO: 'secreto-de-prueba-1',
    ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: 'secreto-de-prueba-2',
  });
  assert.equal(config.puerto, 4100);
  assert.equal(config.widget, 'http://127.0.0.1:5173');
  assert.equal(config.urlBase, 'http://127.0.0.1:8080');
  assert.equal(config.secretoCertificacion, 'secreto-de-prueba-1');
  assert.equal(config.secretoRespaldo, 'secreto-de-prueba-2');
});

test('un secreto vacío en el .env cuenta como ausente', () => {
  const config = leerConfig({ ENROLAMIENTO_WEBHOOK_SECRETO: '', ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: '   ' });
  assert.equal(config.secretoCertificacion, null);
  assert.equal(config.secretoRespaldo, null);
});

test('un puerto que no es un número queda en 3000', () => {
  assert.equal(leerConfig({ PUERTO: 'tres mil' }).puerto, 3000);
  assert.equal(leerConfig({ PUERTO: '' }).puerto, 3000);
});

test('solo MINI_ERP_MODO=real es modo real; cualquier otro valor es prueba', () => {
  assert.equal(leerConfig({ MINI_ERP_MODO: 'real' }).modo, 'real');
  for (const modo of ['prueba', 'REAL', 'produccion', '', ' real']) {
    assert.equal(leerConfig({ MINI_ERP_MODO: modo }).modo, 'prueba', modo);
  }
});

test('un color que no es #RRGGBB se ignora y queda el de fábrica', () => {
  for (const color of ['azul', '#12345', 'javascript:x', '#1D4ED8;x', '1D4ED8', '#GGGGGG', '']) {
    assert.equal(leerConfig({ MINI_ERP_COLOR: color }).marca.color, '#1D4ED8', color);
  }
});

test('un color válido se usa en mayúsculas, con el texto encima que más contrasta', () => {
  assert.deepEqual(leerConfig({ MINI_ERP_COLOR: '#0b5fff' }).marca, { nombre: 'Andes ERP', color: '#0B5FFF', textoSobreColor: '#FFFFFF' });
  assert.equal(leerConfig({ MINI_ERP_COLOR: '#FACC15' }).marca.textoSobreColor, '#000000');
  assert.equal(leerConfig({ MINI_ERP_COLOR: '#000000' }).marca.textoSobreColor, '#FFFFFF');
  assert.equal(leerConfig({ MINI_ERP_COLOR: '#FFFFFF' }).marca.textoSobreColor, '#000000');
});

test('el nombre se recorta a 60 caracteres, sin espacios a los lados; vacío queda el de fábrica', () => {
  assert.equal(leerConfig({ MINI_ERP_NOMBRE: '  Ferretería Contable  ' }).marca.nombre, 'Ferretería Contable');
  assert.equal(leerConfig({ MINI_ERP_NOMBRE: 'x'.repeat(80) }).marca.nombre, 'x'.repeat(60));
  assert.equal(leerConfig({ MINI_ERP_NOMBRE: '   ' }).marca.nombre, 'Andes ERP');
  // Un carácter fuera del plano básico no se corta por la mitad.
  const nombre = leerConfig({ MINI_ERP_NOMBRE: `${'x'.repeat(59)}🏔️` }).marca.nombre;
  assert.ok(nombre.length <= 60);
  assert.ok(!/[\uD800-\uDBFF]$/.test(nombre));
});
