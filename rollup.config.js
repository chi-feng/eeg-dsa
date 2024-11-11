// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'viz.js', // Your main JS file
  output: {
    file: 'bundle.js',
    format: 'iife', // Immediately Invoked Function Expression for browser compatibility
    name: 'bundle',
  },
  plugins: [
    resolve(),
    commonjs(),
  ],
};
