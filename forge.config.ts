import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'fs';
import * as path from 'path';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

// Webpack externals that must be copied into the packaged app's node_modules.
// Forge's webpack plugin does not do this automatically.
const EXTERNALS = ['better-sqlite3', 'xlsx'];

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      for (const pkg of EXTERNALS) {
        const src = path.resolve(__dirname, 'node_modules', pkg);
        const dest = path.join(buildPath, 'node_modules', pkg);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
    },
  },
  packagerConfig: {
    asar: {
      unpack: '**/*.node',
    },
    icon: './resources/icon',
    extraResource: ['./resources'],
    ...(process.env.APPLE_IDENTITY && {
      osxSign: {
        identity: process.env.APPLE_IDENTITY,
      },
      osxNotarize: {
        appleId: process.env.APPLE_ID as string,
        appleIdPassword: process.env.APPLE_ID_PASSWORD as string,
        teamId: process.env.APPLE_TEAM_ID as string,
      },
    }),
  },
  rebuildConfig: {
    // Prebuilts for both Node and Electron are managed by scripts/download-prebuilts.js
    // (run automatically via postinstall). No runtime rebuild needed.
    onlyModules: [],
  },
  makers: [
    new MakerSquirrel({
      setupIcon: './resources/icon.ico',
      ...(process.env.WIN_CERT_FILE && {
        certificateFile: process.env.WIN_CERT_FILE,
        certificatePassword: process.env.WIN_CERT_PASSWORD,
      }),
    }),
    new MakerDMG({
      format: 'ULFO',
    }, ['darwin']),
    new MakerDeb({}),
    new MakerRpm({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
