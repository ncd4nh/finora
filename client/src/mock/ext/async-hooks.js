// Bản prototype chỉ có 1 người dùng đăng nhập: ngữ cảnh người dùng giữ nguyên ("dính").
// Ngữ cảnh giao dịch DB (có tx) được trả lại như cũ khi giao dịch kết thúc.
export class AsyncLocalStorage {
  run(store, fn) {
    const prev = this.store;
    this.store = store;
    const r = fn();
    if (store?.tx && r && typeof r.then === 'function') {
      return r.finally(() => { if (this.store === store) this.store = prev; });
    }
    return r;
  }
  getStore() { return this.store; }
}
