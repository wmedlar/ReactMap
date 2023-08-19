// @ts-check
/* eslint-disable no-continue */
/* eslint-disable import/no-extraneous-dependencies */

const { defineConfig, loadEnv } = require('vite')
const { default: react } = require('@vitejs/plugin-react')
const { default: checker } = require('vite-plugin-checker')
const { viteStaticCopy } = require('vite-plugin-static-copy')
const removeFiles = require('rollup-plugin-delete')
const { resolve, extname } = require('path')
const fs = require('fs')
const { sentryVitePlugin } = require('@sentry/vite-plugin')
const config = require('@rm/config')

const { log, HELPERS } = require('@rm/logger')
const { locales } = require('./locales/scripts/create')

config.getSafe = config.get

/**
 * @param {boolean} isDevelopment
 * @returns {import('vite').Plugin}
 */
const customFilePlugin = (isDevelopment) => {
  const fileRegex = /\.(jsx?|css)$/
  const customPaths = []
  return {
    name: 'vite-plugin-custom-file-checker',
    load(id) {
      if (fileRegex.test(id) && !/node_modules/.test(id)) {
        const ext = extname(id)
        const newPath = id.replace(ext, `.custom${ext}`)
        if (fs.existsSync(newPath)) {
          customPaths.push(newPath)
          return {
            code: fs.readFileSync(newPath, 'utf8'),
            map: null,
          }
        }
      }
    },
    buildEnd() {
      if (customPaths.length && !isDevelopment) {
        log.warn(`
======================================================
             WARNING:
Custom files aren't officially supported
Be sure to watch for breaking changes!

${customPaths.map((x, i) => ` ${i + 1}. src/${x.split('src/')[1]}`).join('\n')}

======================================================
`)
      }
    },
  }
}

/**
 * @returns {import('vite').Plugin}
 */
const localePlugin = () => ({
  name: 'vite-plugin-locales',
  async buildStart() {
    await locales()
  },
})

const viteConfig = defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, resolve(process.cwd(), './'), '')
  const isRelease = process.argv.includes('-r')
  const serverPort = +(env.PORT || config.getSafe('port') || '8080')

  const pkg = JSON.parse(
    fs.readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
  )
  const version = env.npm_package_version || pkg.version
  const hasCustom = (function checkFolders(folder, isCustom = false) {
    const files = fs.readdirSync(folder)
    for (let i = 0; i < files.length; i += 1) {
      if (isCustom) return true
      if (files[i].startsWith('.')) continue
      if (!files[i].includes('.'))
        isCustom = checkFolders(`${folder}/${files[i]}`, isCustom)
      if (/\.custom.(jsx?|css)$/.test(files[i])) return true
    }
    return isCustom
  })(resolve(__dirname, 'src'))

  if (mode === 'production') {
    log.info(HELPERS.build, `Building production version: ${version}`)
  }

  return {
    plugins: [
      react({
        jsxRuntime: 'classic',
      }),
      ...(mode === 'development'
        ? [
            checker({
              overlay: {
                initialIsOpen: false,
              },
              eslint: {
                lintCommand: 'eslint "./src/**/*.{js,jsx}"',
              },
            }),
          ]
        : []),
      ...(hasCustom ? [customFilePlugin(mode === 'development')] : []),
      viteStaticCopy({
        targets: [
          {
            src: fs.existsSync(resolve(__dirname, 'public/favicon/favicon.ico'))
              ? resolve(__dirname, 'public/favicon/favicon.ico')
              : resolve(__dirname, 'public/favicon/fallback.ico'),
            dest: '.',
            rename: 'favicon.ico',
          },
        ],
      }),
      ...(process.env.SENTRY_AUTH_TOKEN &&
      process.env.SENTRY_ORG &&
      process.env.SENTRY_PROJECT
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
            }),
          ]
        : []),
      localePlugin(),
    ],
    optimizeDeps:
      mode === 'development'
        ? { exclude: ['@mui/*'], include: ['@rm/logger'] }
        : undefined,
    publicDir: 'public',
    resolve: {
      alias: {
        '@components': resolve(__dirname, './src/components'),
        '@assets': resolve(__dirname, './src/assets'),
        '@hooks': resolve(__dirname, './src/hooks'),
        '@services': resolve(__dirname, './src/services'),
      },
    },
    define: {
      process: {
        env: {
          NODE_ENV: mode,
          VERSION: version,
          SENTRY_DSN: env.SENTRY_DSN || '',
          SENTRY_TRACES_SAMPLE_RATE: env.SENTRY_TRACES_SAMPLE_RATE || 0.1,
          SENTRY_DEBUG: env.SENTRY_DEBUG || false,
          CUSTOM: hasCustom,
          LOCALES: fs
            .readdirSync(resolve(__dirname, './locales'))
            .filter((x) => x.endsWith('.json'))
            .map((x) => x.replace('.json', '')),
        },
      },
      CONFIG: {
        analytics: config.getSafe('analytics'),
        map: config.getSafe('map'),
      },
    },
    esbuild: {
      legalComments: 'none',
    },
    build: {
      target: ['safari11.1', 'chrome64', 'firefox66', 'edge88'],
      outDir: resolve(__dirname, './dist'),
      sourcemap: mode === 'development' || isRelease,
      minify:
        mode === 'development' || config.getSafe('devOptions.skipMinified')
          ? false
          : 'esbuild',
      input: { main: resolve(__dirname, 'index.html') },
      assetsDir: '',
      emptyOutDir: true,
      commonjsOptions: {
        include: [/@rm/],
      },
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        plugins: [
          // @ts-ignore
          removeFiles({
            targets: ['dist/favicon'],
            hook: 'generateBundle',
          }),
        ],
        output: {
          manualChunks: (id) => {
            if (id.endsWith('.css')) return 'index'
            if (id.includes('node_modules')) return 'vendor'
            // return id.replace(/.*node_modules\//, '').split('/')[0]
            if (id.includes('src')) return version.replaceAll('.', '-')
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      open: true,
      port: serverPort + 1,
      fs: {
        strict: false,
      },
      proxy: {
        '/api': {
          target: `http://0.0.0.0:${serverPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/auth': {
          target: `http://0.0.0.0:${serverPort}`,
          changeOrigin: true,
          secure: false,
        },
        '/graphql': {
          target: `http://0.0.0.0:${serverPort}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})

module.exports = viteConfig
