import {createFilter} from "vite";
import {parse, Declaration} from "css-tree";
import subsetFont from "subset-font";

import path from "path";
import fs from "fs";

interface FontInfo {
    ranges: { start: number; end: number }[];
    fontFamily: string;
}

interface PluginOptions {
    include?: RegExp;
    exclude?: RegExp;
    fontExtensions?: RegExp;
}

interface CssNode {
    type: string;
    block?: {
        children: Iterable<CssNode>;
    };
    property?: string;
    value?: {
        children: Iterable<{ value?: string }>;
    };
    name?: string;
}

const fontMap = new Map<string, FontInfo>();

export default function fontUnicodeRangePlugin(options: PluginOptions = {}) {
    const {
        include = /\.(css|scss|sass|less|styl|stylus)$/,
        exclude,
        fontExtensions = /\.(woff2?|ttf|eot|otf)$/i,
    } = options;

    const cssFilter = createFilter(include, exclude);

    return {
        name: "vite-plugin-font-unicode-range",
        enforce: "post",

        // Phase 1: Analyze CSS and collect font resource information
        async transform(code: string, id: string) {
            if (!cssFilter(id) || /node_module/.test(id)) return;
            const raw = code;
            if (!code) {
                code = fs.readFileSync(path.resolve(id), "utf8");
            }
            try {
                const ast = parse(code);
                ((ast as CssNode["block"])?.children as CssNode[]).forEach((node) => {
                    if (node.type === "Atrule" && node.name === "font-face") {
                        const fontFamily = getDeclarationValue(node, "font-family");
                        const src = getDeclarationValue(node, "src");
                        const unicodeRange = getDeclarationValue(node, "unicode-range");
                        if (!fontFamily || !src || !unicodeRange) return;
                        const ranges = parseUnicodeRange(unicodeRange);
                        if (ranges.length === 0) return;
                        // Create mapping from font file path to resources
                        src.split(",").forEach((a: string) => {
                            fontMap.set(fontName(a).trim(), {
                                ranges,
                                fontFamily,
                            });
                        });
                    }
                });
            } catch (error) {
                console.error("Error analyzing font resources:", error);
            }
            return raw;
        },

        // Phase 2: Process font files during generation
        async generateBundle(_: any, bundle: Record<string, any>) {
            const fontAssets = Object.entries(bundle).filter(([_, asset]) => {
                return asset.type === "asset" && fontExtensions.test(asset.fileName);
            });
            for (const [fileName, asset] of fontAssets) {
                try {
                    const fontInfo = fontMap.get(fontName(fileName));
                    if (!fontInfo) continue;
                    // Subset the font
                    const subsettedFont = await subsetFont(
                        asset.source,
                        rangStr(fontInfo.ranges),
                        {
                            targetFormat: getTargetFormat(fileName) as 'woff',
                        }
                    );
                    const old = asset.source.length;
                    asset.source = subsettedFont;
                    console.log(
                        `Optimized font ${fileName} for ${fontInfo.fontFamily} [${Math.floor((subsettedFont.length - old) * 100 / old)}%]`
                    );
                } catch (error) {
                    console.error(`Error subsetting font ${fileName}:`, error);
                }
            }
        },
    };
}

function rangStr(s: { start: number; end: number }[]): string {
    const v: number[] = [];
    s.forEach(({start, end}) => {
        for (let i = start; i < end; i++) {
            const o = i;
            v.push(o);
        }
    });
    // @ts-ignore
    return String.fromCharCode(...new Set(v));
}

function fontName(a: string): string {
    const file = a.split("/").pop() || "";
    return file.replace(/\..*?([a-z]+\d?)$/, ".$1");
}

function getDeclarationValue(node: CssNode, property: string): string | null {
    const child = Array.from(node.block?.children || []).find((a) => {
        return a.type === "Declaration" && a.property === property;
    }) as Declaration | undefined;

    if (child) {
        return (
            // @ts-ignore
            Array.from(child.value?.children || [])
                .filter((a) => (a as any).value)
                .map((a) => (a as any).value)
                .join(" ") || null
        );
    }
    return null;
}

// Helper function: Parse unicode-range
function parseUnicodeRange(rangeValue: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    const parts = rangeValue.split(/\s*,\s*/);

    for (const part of parts) {
        if (part.includes("?")) {
            const prefix = part.match(/U\+([0-9A-Fa-f?]+)/)![1];
            const start = parseInt(prefix.replace(/\?/g, "0"), 16);
            const end = parseInt(prefix.replace(/\?/g, "F"), 16);
            ranges.push({start, end});
        } else if (part.includes("-")) {
            const [startHex, endHex] = part
                .match(/U\+([0-9A-Fa-f]+)-([0-9A-Fa-f]+)/)!
                .slice(1);
            ranges.push({
                start: parseInt(startHex, 16),
                end: parseInt(endHex, 16),
            });
        } else {
            const codePoint = part.match(/U\+([0-9A-Fa-f]+)/)![1];
            const value = parseInt(codePoint, 16);
            ranges.push({start: value, end: value});
        }
    }

    return ranges;
}

function getTargetFormat(fileName: string): string | undefined {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case ".woff":
            return "woff";
        case ".woff2":
            return "woff2";
        case ".ttf":
            return "truetype";
        case ".eot":
            return "eot";
        case ".otf":
            return "opentype";
        default:
            return undefined; // Default to woff2
    }
}