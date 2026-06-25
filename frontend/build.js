import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");

mkdirSync(distDir, { recursive: true });
copyFileSync(resolve(process.cwd(), "index.html"), resolve(distDir, "index.html"));

console.log("Built frontend into dist/index.html");
