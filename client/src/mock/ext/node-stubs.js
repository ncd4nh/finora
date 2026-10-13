// Thay thế các module Node trong trình duyệt
export const mkdirSync = () => {};
export const existsSync = () => false;
export const renameSync = () => {};
export const unlinkSync = () => {};
export const resolve = (...p) => p.filter(Boolean).join('/');
export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => String(p).split('/').slice(0, -1).join('/') || '.';
export default { mkdirSync, existsSync, renameSync, unlinkSync, resolve, join, dirname };
