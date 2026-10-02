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
    // Web Workers (the audio export's renderer and MP3 encoder)
    files: ['public/js/**/*.worker.js'],
    languageOptions: { globals: globals.worker },
  },
  {
    // A classic worker: loads the LAME encoder with importScripts
    files: ['public/js/lehra/mp3.worker.js'],
    languageOptions: { sourceType: 'script', globals: { lamejs: 'readonly' } },
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
