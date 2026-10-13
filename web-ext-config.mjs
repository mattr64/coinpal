// Options for `npx web-ext build` / `sign`; keeps repo-only files out of the uploaded package
export default {
  ignoreFiles: [
    'README.md',
    'currency_tooltip_icon.png',
    'currency_tooltip_icon_v2.png',
    'web-ext-config.mjs'
  ]
};
