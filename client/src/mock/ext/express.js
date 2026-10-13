// Router giả lập Express: lưu handler để gọi trực tiếp trong trình duyệt
export function Router() {
  const routes = [];
  const add = (method) => (path, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, path, re, keys, handlers, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} };
}
export default { Router };
