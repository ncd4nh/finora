const R = window.React;
export const Fragment = R.Fragment;
export function jsx(type, props, key) {
  return R.createElement(type, key !== undefined ? { ...props, key } : props);
}
export const jsxs = jsx;
export const jsxDEV = jsx;
