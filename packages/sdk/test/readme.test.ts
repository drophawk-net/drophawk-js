import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The ```ts blocks of the README, each wrapped so it can be checked on its own. */
function snippets(): string[] {
  const md = readFileSync(`${root}README.md`, "utf8");
  return [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => {
    const body = m[1]!.replace(/^import .*\n/gm, "");
    return [
      `import { DropHawk, DropHawkError } from "./src/index.ts";`,
      `declare const done: boolean;`,
      `declare const myFetch: typeof fetch;`,
      `declare const dh: DropHawk;`,
      `export async function main() {`,
      body,
      `}`,
    ].join("\n");
  });
}

it("README snippets type-check under strict and noUncheckedIndexedAccess", () => {
  const blocks = snippets();
  expect(blocks.length).toBeGreaterThan(4);
  const files = new Map(blocks.map((code, i) => [`${root}readme-snippet-${i}.ts`, code]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    strict: true,
    noUncheckedIndexedAccess: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    types: ["node"],
    typeRoots: [`${root}node_modules/@types`, `${root}../../node_modules/@types`],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (f) => files.get(f) ?? readFile(f);
  host.fileExists = (f) => files.has(f) || fileExists(f);
  host.getSourceFile = ((orig) => (f, lang, ...rest) => {
    const code = files.get(f);
    return code !== undefined ? ts.createSourceFile(f, code, lang) : orig(f, lang, ...rest);
  })(host.getSourceFile.bind(host));
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file && files.has(d.file.fileName));
  const messages = diagnostics.map((d) => `${d.file!.fileName.split("/").pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  expect(messages).toEqual([]);
});
