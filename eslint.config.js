// ESLint Flat-Config: TS/React-Regeln fuers Projekt, gelockerte Regeln fuer Test-Dateien.
import js from '@eslint/js'
import babelParser from '@babel/eslint-parser'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [['@babel/preset-typescript', { ignoreExtensions: true }]],
          plugins: ['@babel/plugin-syntax-jsx'],
        },
      },
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      // Testdateien exportieren oft Helfer neben Komponenten - Fast-Refresh-Regel hier irrelevant.
      'react-refresh/only-export-components': 'off',
    },
  },
])
