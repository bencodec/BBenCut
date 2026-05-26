const esbuild = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const watchLogPlugin = {
  name: "watch-log",
  setup(build) {
    build.onEnd((result) => {
      const ts = new Date().toLocaleTimeString();
      if (result.errors.length) {
        console.log(`[${ts}] esbuild: failed (${result.errors.length} errors)`);
      } else {
        console.log(`[${ts}] esbuild: rebuilt dist/extension.js`);
      }
    });
  },
};

const inlineCssPlugin = {
  name: "inline-css-html",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, async (args) => {
      const dir = path.dirname(args.path);
      const cssPath = path.join(dir, "main.css");
      const svgPath = path.join(dir, "bbencut.svg");
      const [html, css, svg] = await Promise.all([
        fs.readFile(args.path, "utf8"),
        fs.readFile(cssPath, "utf8"),
        fs.readFile(svgPath, "utf8"),
      ]);
      const inlined = html
        .replace("/* __INLINE_CSS__ */", () => css)
        .replace("<!-- __INLINE_SVG__ -->", () => svg);
      return {
        contents: inlined,
        loader: "text",
        watchFiles: [cssPath, svgPath],
      };
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    sourcemap: !production,
    sourcesContent: false,
    minify: production,
    platform: "node",
    outfile: "dist/extension.js",
    logLevel: "info",
    plugins: [inlineCssPlugin, ...(watch ? [watchLogPlugin] : [])],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
