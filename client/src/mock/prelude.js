// Chạy trước mọi module server: giả lập biến môi trường Node
globalThis.process = globalThis.process || { env: {}, argv: [], cwd: () => '/' };
globalThis.process.env = globalThis.process.env || {};
globalThis.process.cwd = globalThis.process.cwd || (() => '/');
globalThis.__MOCK_READY = new Promise((r) => { globalThis.__MOCK_RESOLVE = r; });
