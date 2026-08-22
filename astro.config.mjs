// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages project site: https://att14.github.io/arewehealthyyet
export default defineConfig({
  site: 'https://att14.github.io',
  base: '/arewehealthyyet',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
