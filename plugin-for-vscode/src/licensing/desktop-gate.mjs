// Kept as a compatibility seam for existing desktop and IDE entry points.
// The free release never gates local features on an installation or payment.
export function requiresDesktopLicense(method, pathname) {
  void method;
  void pathname;
  return false;
}
