// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exported web assets must not live under a `node_modules` folder (see scripts/metro-asset-paths.js).
config.transformer.assetPlugins = [...(config.transformer.assetPlugins ?? []), require.resolve('./scripts/metro-asset-paths.js')];

module.exports = config;
