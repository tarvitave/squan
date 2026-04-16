import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Squan',
    executableName: 'squan',
    appBundleId: 'com.squan.app',
    out: process.env.SQUAN_BUILD_DIR || './out',
    asar: {
      unpack: '**/node_modules/node-pty/**',
    },
    extraResource: [
      './dist-server',
      './client/dist',
      './assets/icon.ico',
    ],
    icon: './assets/icon',
    // macOS-specific
    appCategoryType: 'public.app-category.developer-tools',
    darwinDarkModeSupport: true,
    osxSign: false as any, // Skip code signing for now
  },

  // ── Installers ────────────────────────────────────────────────────

  makers: [
    // Windows: Squirrel installer (.exe auto-updater) + ZIP
    new MakerSquirrel({
      name: 'squan',
      authors: 'Colin',
      description: 'Squan — Multi-agent AI development command center',
      // setupIcon: './assets/icon.ico',  // Add custom icon later
    }),

    // All platforms: ZIP (portable, no install needed)
    new MakerZIP({}),

    // macOS: DMG installer
    new MakerDMG({
      name: 'Squan',
      format: 'ULFO',
    }),

    // Linux: .deb package
    new MakerDeb({
      options: {
        name: 'squan',
        productName: 'Squan',
        genericName: 'AI Development Tool',
        description: 'Multi-agent AI development command center',
        categories: ['Development', 'IDE'],
        homepage: 'https://squan.dev',
        maintainer: 'Colin',
        section: 'devel',
        depends: ['git', 'nodejs'],
      },
    }),
  ],

  // ── Plugins ───────────────────────────────────────────────────────

  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'electron/src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],

  // ── Hooks ─────────────────────────────────────────────────────────

  hooks: {
    // Verify the server bundle exists before packaging
    prePackage: async () => {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const serverEntry = join(process.cwd(), 'dist-server', 'dist', 'index.js')
      if (!existsSync(serverEntry)) {
        throw new Error(
          `Server bundle not found at ${serverEntry}.\n` +
          `Run 'node scripts/package-server.mjs' first, or use 'npm run make'.`
        )
      }
      console.log('[forge] ✓ Server bundle found')
    },
  },
}

export default config
