import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['public/separator/**', 'stem-frontend/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    // Site scripts: ES modules running in the page
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, html2pdf: 'readonly' },
    },
  },
  {
    // AudioWorklets run in AudioWorkletGlobalScope
    files: ['public/js/**/*.worklet.js'],
    languageOptions: {
      globals: {
        registerProcessor: 'readonly',
        AudioWorkletProcessor: 'readonly',
        sampleRate: 'readonly',
        currentFrame: 'readonly',
      },
    },
  },
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
];
