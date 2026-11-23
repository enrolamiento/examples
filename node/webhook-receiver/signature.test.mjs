import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { esValido } from './signature.mjs';

const SECRETO = 'a'.repeat(64);
const FECHA = '2026-11-14T15:04:05-03:00';
const AHORA = Date.parse(FECHA) + 1000;
const CUERPO = Buffer.from('{"evento":"prueba","id":"5a7e9d10-2b3c-4f6a-8d1e-7c9b0a4e6f21","fecha":"2026-11-14T15:04:05-03:00"}');

const firmar = (secreto, fecha, cuerpo) =>
  'sha256=' + createHmac('sha256', secreto).update(`${fecha}.`).update(cuerpo).digest('hex');

const cabeceras = (extra = {}) => ({
  'x-enrolamiento-fecha': FECHA,
  'x-enrolamiento-firma': firmar(SECRETO, FECHA, CUERPO),
  ...extra,
});

test('acepta un aviso bien firmado', () => {
  assert.equal(esValido(SECRETO, CUERPO, cabeceras(), AHORA), true);
});

test('rechaza un cuerpo cambiado', () => {
  const otro = Buffer.from(CUERPO.toString().replace('prueba', 'certificacion.finalizada'));
  assert.equal(esValido(SECRETO, otro, cabeceras(), AHORA), false);
});

test('rechaza un cuerpo reserializado con espacios', () => {
  const reescrito = Buffer.from(JSON.stringify(JSON.parse(CUERPO.toString()), null, 1));
  assert.equal(esValido(SECRETO, reescrito, cabeceras(), AHORA), false);
});

test('rechaza otro secreto', () => {
  assert.equal(esValido('b'.repeat(64), CUERPO, cabeceras(), AHORA), false);
});

test('rechaza un aviso de hace más de 5 minutos', () => {
  assert.equal(esValido(SECRETO, CUERPO, cabeceras(), AHORA + 6 * 60 * 1000), false);
});

test('rechaza si falta la fecha o la firma', () => {
  assert.equal(esValido(SECRETO, CUERPO, cabeceras({ 'x-enrolamiento-fecha': undefined }), AHORA), false);
  assert.equal(esValido(SECRETO, CUERPO, cabeceras({ 'x-enrolamiento-firma': undefined }), AHORA), false);
});

test('rechaza una firma de otro largo sin tirar', () => {
  assert.equal(esValido(SECRETO, CUERPO, cabeceras({ 'x-enrolamiento-firma': 'sha256=abc' }), AHORA), false);
});

test('rechaza si no hay secreto configurado', () => {
  assert.equal(esValido(undefined, CUERPO, cabeceras(), AHORA), false);
});
