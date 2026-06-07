/**
 * Registrerar resolve-hooken (test-ts-resolve-hook.mjs) i node:s modulladdare.
 * Laddas via `node --import ./scripts/register-test-hooks.mjs` i `yarn test`.
 */
import { register } from 'node:module';

register('./test-ts-resolve-hook.mjs', import.meta.url);
