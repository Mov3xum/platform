import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFromHeaders } from './client-ip';

const h = (map: Record<string, string>) => (n: string) => map[n] ?? null;

test('tar det HÖGRA (proxy-tillagda) X-Forwarded-For-värdet, inte det klientstyrda vänstra', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': 'spoofed, 10.0.0.9' })), '10.0.0.9');
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': ' a , b ,  c ' })), 'c');
});

test('faller på X-Real-IP och sist "unknown"', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': ' , ' , 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
  assert.equal(clientIpFromHeaders(h({})), 'unknown');
});
