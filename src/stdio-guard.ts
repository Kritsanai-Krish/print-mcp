// MUST be the first import of the entry point. stdout belongs to the MCP protocol;
// any library that logs there (mupdf's WASM runtime does) would corrupt the stream.
console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;
