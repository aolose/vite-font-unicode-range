# vite-font-unicode-range

[![npm version](https://img.shields.io/npm/v/vite-font-unicode-range)](https://www.npmjs.com/package/vite-font-unicode-range)
[![license](https://img.shields.io/npm/l/vite-font-unicode-range)](https://github.com/yourusername/vite-font-unicode-range/blob/main/LICENSE)

A Vite plugin that automatically analyzes your CSS and creates optimized font subsets based on actual unicode-range
usage, significantly reducing font file sizes.

## Features

- 🔍 **Automatic Analysis** - Scans your CSS files for `@font-face` rules with `unicode-range`
- ✂️ **Smart Subsetting** - Creates font subsets containing only the glyphs you actually use
- 🛠 **Flexible Configuration** - Supports multiple font formats (WOFF2, TTF, EOT, OTF)

## Installation

```bash
npm install vite-font-unicode-range --save-dev
# or
yarn add vite-font-unicode-range -D
# or
pnpm add vite-font-unicode-range -D
```

## Usage

vite.config.js

```js
import optimizedFontSubset from 'vite-font-unicode-range';

export default {
    plugins: [
        optimizedFontSubset({
            // Optional configuration
            // Currently only tested css
            include: /\.(css|scss|sass|less|styl|stylus)$/,
            exclude: undefined,
            fontExtensions: /\.(woff2?|ttf|eot|otf)$/i,
        })
    ]
}
```

example.css

```css
@font-face {
  font-family: "Nanum Gothic";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src:
    url(@fontsource/nanum-gothic/files/nanum-gothic-latin-400-normal.woff2)
      format("woff2"),
    url(@fontsource/nanum-gothic/files/nanum-gothic-latin-400-normal.woff)
      format("woff");
  unicode-range: U+0030-0039;
}
```


### How It Works

1. Analysis Phase: The plugin scans all your CSS files during the Vite transform phase, looking for @font-face rules
   that specify unicode-range.

2. Mapping: Creates a mapping between font files and their actual unicode range usage.

3. Subsetting: During the generate phase, the plugin creates optimized subsets of each font file containing only the
   glyphs specified in the unicode ranges.

4. Replacement: Original font files in the bundle are replaced with their optimized versions.