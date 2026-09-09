declare module '*.txt' {
  const text: string;
  export default text;
}
declare module '*.wasm' {
  const base64: string;
  export default base64;
}
declare module '*/vendor/highs.cjs' {
  const factory: (options: { wasmBinary: Uint8Array }) => Promise<import('./ip.js').HighsModule>;
  export default factory;
}
