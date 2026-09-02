import { readFile, readdir, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("data/catalog.json", root), "utf8"));
const productFiles = await readdir(new URL("products/", root));
const expected = new Set(catalog.map(item => item.image_url.split("/").pop()));
const missing = [...expected].filter(name => !productFiles.includes(name));
const empty = [];
for (const name of productFiles) if ((await stat(new URL(`products/${name}`, root))).size === 0) empty.push(name);

if (catalog.length !== 88) throw new Error(`Esperados 88 produtos; encontrados ${catalog.length}.`);
if (expected.size !== 83) throw new Error(`Esperadas 83 imagens únicas; encontradas ${expected.size}.`);
if (missing.length) throw new Error(`Imagens ausentes: ${missing.join(", ")}`);
if (empty.length) throw new Error(`Imagens vazias: ${empty.join(", ")}`);

const options = catalog.flatMap(item => item.option_groups.flatMap(group => group.options));
if (options.length !== 304) throw new Error(`Esperadas 304 opções; encontradas ${options.length}.`);
console.log(`OK: ${catalog.length} produtos, ${expected.size} imagens e ${options.length} opções.`);
