const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Soportar archivos WebAssembly (.wasm) para expo-sqlite en entorno Web
config.resolver.assetExts.push("wasm");

// Fix: jsmediatags tiene "browser": "dist/jsmediatags.js" en su package.json,
// pero ese archivo no existe (solo dist/jsmediatags.min.js). Metro usa el campo
// "browser" con prioridad y falla. Forzamos la resolución al campo "main" correcto (build2/).
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "expo-file-system" &&
    context.originModulePath &&
    context.originModulePath.includes("@missingcore/audio-metadata")
  ) {
    return context.resolveRequest(context, "expo-file-system/legacy", platform);
  }
  if (platform === "web" && moduleName === "react-native-safe-area-context") {
    return {
      filePath: path.resolve(__dirname, "services/safe-area-context-mock.web.ts"),
      type: "sourceFile",
    };
  }
  if (moduleName === "jsmediatags") {
    return {
      filePath: path.resolve(__dirname, "node_modules/jsmediatags/dist/jsmediatags.min.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
