/**
 * ESM resolve-hook för testkörningen (`yarn test`).
 *
 * Repots TS-källor använder extensionslösa relativa importer (`./foo`), vilket
 * tsc/Next (`moduleResolution: bundler`) hanterar — men node:s ESM-resolver
 * kräver explicita filändelser. Den här hooken provar `<spec>.ts` (och
 * `<spec>/index.ts`) när en extensionslös relativ import annars inte hittas, så
 * att `node --experimental-strip-types --test` kan ladda källorna oförändrade.
 *
 * Inget app-beteende påverkas — hooken laddas BARA av testkommandot.
 */
export async function resolve(specifier, context, next) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExt = /\.[a-z0-9]+$/i.test(specifier);
  if (!isRelative || hasExt) {
    return next(specifier, context);
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      return next(`${specifier}/index.ts`, context);
    }
  }
}
