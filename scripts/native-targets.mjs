// Platforms whose prebuilt better-sqlite3 binary the VSIX ships (named as in better-sqlite3's prebuilds/).
// Keep in sync with src/storage/nativeBinding.ts.
export const NATIVE_TARGETS = [
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'linuxmusl-x64',
  'linuxmusl-arm64',
  'win32-x64',
  'win32-arm64',
];

export const binaryName = (target) => `${target}.node`;
