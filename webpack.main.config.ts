import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';

export const mainConfig: Configuration = {
  entry: './src/main.ts',
  module: {
    rules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    'better-sqlite3': 'commonjs better-sqlite3',
    'xlsx': 'commonjs xlsx',
    // @llamaindex/liteparse is ESM-only — loaded via dynamic import() hidden from webpack.
    // Its native deps (sharp, tesseract.js, pdfium) are resolved from node_modules at runtime.
    'sharp': 'commonjs sharp',
    'tesseract.js': 'commonjs tesseract.js',
    '@hyzyla/pdfium': 'commonjs @hyzyla/pdfium',
  },
};
