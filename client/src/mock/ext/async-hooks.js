// Bản prototype chỉ có 1 người dùng đăng nhập tại một thời điểm: giữ ngữ cảnh đơn giản
export class AsyncLocalStorage {
  run(store, fn) { this.store = store; return fn(); }
  getStore() { return this.store; }
}
