import * as esbuild from 'esbuild'
import { writeFileSync } from 'node:fs'

const buildResult = await esbuild.build({
  entryPoints: ['src/client.jsx'],
  bundle: true,
  format: 'iife',
  globalName: 'DshTerminalPlugin',
  target: 'es2020',
  write: false,
  external: [
    'react',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-connection',
  ],
})

const bundledJs = buildResult.outputFiles[0].text

const finalOutput = `(function ensureCryptoRandomUUID() {
  if (typeof globalThis === "undefined") return;
  const crypto = globalThis.crypto || (globalThis.crypto = {});
  if (typeof crypto.randomUUID === "function") return;
  crypto.randomUUID = function randomUUID() {
    if (typeof crypto.getRandomValues === "function") {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (digit) =>
        (digit ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> digit / 4).toString(16)
      );
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholder) => {
      const random = Math.random() * 16 | 0;
      return (placeholder === "x" ? random : random & 3 | 8).toString(16);
    });
  };
})();

window.__ModuleLoader__.load({
  id: "dsh-terminal",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    ${bundledJs}

    var result = typeof DshTerminalPlugin !== 'undefined' ? DshTerminalPlugin : module.exports;
    exports.apply = result.apply;
    exports.inject = ['slots', 'connection'];
    return module.exports;
  }
});
`

writeFileSync('lib/client.js', finalOutput)
console.log('Successfully bundled lib/client.js with iife wrapper and explicit inject!')
