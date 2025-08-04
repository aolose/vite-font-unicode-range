import {Alias, createFilter, Plugin} from "vite"
import {Block, parse} from "css-tree"
import subsetFont from "subset-font"
import path from "path"
import fs from "fs"

interface FontUnicodeRangePluginOptions {
    include?: RegExp
    exclude?: RegExp
    fontExtensions?: RegExp
}

const results: {
    fileName: string
    rate: string
}[] = []

export default function fontUnicodeRangePlugin(
    options: FontUnicodeRangePluginOptions = {}
): Plugin {
    const {
        include = /\.(css|scss|sass|less|styl|stylus)$/,
        exclude,
        fontExtensions = /\.(woff2?|ttf|eot|otf)$/i,
    } = options
    const cssFilter = createFilter(include, exclude)
    const fontMap = new Map<string, string>()
    let cacheDir = ""
    let alias: Alias[] = []
    const resolvedCss = new Set()
    return {
        name: "vite-plugin-font-unicode-range",
        enforce: "pre",
        apply: "build",
        configResolved(c) {
            cacheDir = c.cacheDir
            alias = c.resolve.alias
        },
        generateBundle() {
            if (!results.length) return
            const max = Math.max(...results.map(({fileName}) => fileName.length))
            console.log(
                "\n\n✨ [vite-plugin-font-unicode-range] - optimized:\n" +
                results
                    .map(
                        ({fileName, rate}) =>
                            `\x1b[34m${fileName.padEnd(max + 4)}\x1b[0m\x1b[90m-${rate}\x1b[0m`
                    )
                    .join("\n")
            )
        },
        async resolveId(id: string) {
            if (resolvedCss.has(id) || !cssFilter(id) || /node_modules/.test(id))
                return
            resolvedCss.add(id)
            const res = await this.resolve(id)
            if (!res) return
            id = res.id
            const code = await fs.promises.readFile(id, "utf8")
            try {
                const ast = parse(code) as Block
                await Promise.all(
                    ast.children.map(async (node) => {
                        if (node.type === "Atrule" && node.name === "font-face") {
                            const fontFamily = getDeclarationValue(node, "font-family")
                            const src = getDeclarationValue(node, "src")
                            const unicodeRange = getDeclarationValue(node, "unicode-range")
                            if (!fontFamily || !src || !unicodeRange) return
                            const ranges = parseUnicodeRange(unicodeRange)
                            if (ranges.length === 0) return
                            await Promise.all(
                                extractFontUrls(src).map(async (url) => {
                                    if (!fontExtensions.test(url)) return
                                    if (!alias.find((a) => a.find === url)) {
                                        const res = await this.resolve(url)
                                        if (!res) return
                                        const name = getFileName(url)
                                        let replacement = fontMap.get(name)
                                        if (!replacement) {
                                            const fontData = await fs.promises.readFile(res.id)
                                            const ext = getTargetFormat(res.id)
                                            const optimizedFontData = await subsetFont(
                                                fontData,
                                                rangStr(ranges),
                                                {
                                                    targetFormat: ext,
                                                }
                                            )
                                            const reduction = 100 - (optimizedFontData.length * 100) / fontData.length
                                            if (!fs.existsSync(cacheDir)) {
                                                await fs.promises.mkdir(cacheDir)
                                            }
                                            const fileName = `${cacheDir}/subset-${name}`
                                            if (optimizedFontData.length < fontData.length) {
                                                replacement = fileName
                                                await fs.promises.writeFile(fileName, optimizedFontData)
                                                fontMap.set(name, fileName)
                                                results.push({
                                                    fileName: name,
                                                    rate:
                                                        `${reduction.toFixed(0)}%`.padEnd(8) +
                                                        `${formatSize(fontData.length)} → ${formatSize(optimizedFontData.length)}`,
                                                })
                                            } else replacement = 'skip'
                                        }
                                        if (replacement !== 'skip') alias.push({
                                            find: url,
                                            replacement: replacement,
                                        })
                                    }
                                })
                            )
                        }
                    })
                )
            } catch (error) {
                console.error("Error analyzing CSS:", error)
            }
        },
    }
}

function formatSize(bytes: number) {
    return (bytes / 1024).toFixed(1) + "KB"
}

function extractFontUrls(src: string): string[] {
    return src.split(",").map((a) => a.trim())
}

function rangStr(s: Array<{ start: number; end: number }>): string {
    const v: number[] = []
    s.forEach(({start, end}) => {
        for (let i = start; i < end; i++) {
            v.push(i)
        }
    })
    return String.fromCharCode(...new Set(v))
}

function getFileName(a: string): string {
    const file = a.split("/").pop() || ""
    return file.replace(/\..*?([a-z]+\d?)$/, ".$1")
}

function getDeclarationValue(node: any, property: string): string | null {
    const child = Array.from(node.block?.children || []).find((a: any) => {
        return a.type === "Declaration" && a.property === property
    })
    if (child) {
        return (
            // @ts-ignore
            Array.from(child.value?.children || [])
                .filter((a: any) => a.value)
                .map((a: any) => a.value)
                .join(" ") || null
        )
    }
    return null
}

function parseUnicodeRange(
    rangeValue: string
): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = []
    const parts = rangeValue.split(/\s*,\s*/)

    for (const part of parts) {
        if (part.includes("?")) {
            const prefix = part.match(/U\+([0-9A-Fa-f?]+)/)?.[1] || ""
            const start = parseInt(prefix.replace(/\?/g, "0"), 16)
            const end = parseInt(prefix.replace(/\?/g, "F"), 16)
            ranges.push({start, end})
        } else if (part.includes("-")) {
            const match = part.match(/U\+([0-9A-Fa-f]+)-([0-9A-Fa-f]+)/)
            if (match) {
                ranges.push({
                    start: parseInt(match[1], 16),
                    end: parseInt(match[2], 16),
                })
            }
        } else {
            const codePoint = part.match(/U\+([0-9A-Fa-f]+)/)?.[1] || "0"
            const value = parseInt(codePoint, 16)
            ranges.push({start: value, end: value})
        }
    }

    return ranges
}

function getTargetFormat(
    fileName: string
): "woff" | "woff2" | "sfnt" | "truetype" {
    const ext = path.extname(fileName).toLowerCase()
    switch (ext) {
        case ".woff":
            return "woff"
        case ".woff2":
            return "woff2"
        case ".sfnt":
            return "sfnt"
        case ".ttf":
            return "truetype"
        default:
            return "woff2"
    }
}
