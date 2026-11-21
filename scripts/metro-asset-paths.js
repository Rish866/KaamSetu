// Metro asset plugin: keeps exported web assets out of folders named `node_modules`.
// `expo export` writes package assets (icon fonts, expo-router images) to assets/node_modules/..., and the website host
// (OpenAI Sites) does not publish directories with that name, so every icon font returned 404 in production (2026-11-21).
// The export path and the runtime URL are both derived from httpServerLocation, so rewriting it here keeps them in sync.
// Example: /assets/node_modules/@expo/vector-icons/... -> /assets/vendor/expo/vector-icons/...
// Only for production exports (`expo export` runs with NODE_ENV=production). The development server resolves asset URLs
// back to files on disk, so rewriting them there would break icons in `expo start`.
module.exports = function vendorAssetPaths(asset) {
  if (process.env.NODE_ENV === 'production' && typeof asset.httpServerLocation === 'string') {
    asset.httpServerLocation = asset.httpServerLocation
      .replace(/\/_*node_modules\//g, '/vendor/')
      .replace(/\/@/g, '/');
  }
  return asset;
};
