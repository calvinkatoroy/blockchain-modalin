import hre from "hardhat"; // ensures HRE + plugins are fully initialized
import Mocha from "mocha";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { readdirSync } from "fs";

const testDir = resolve(fileURLToPath(import.meta.url), "../../test");
const testFiles = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => resolve(testDir, f));

const mocha = new Mocha({ timeout: 60000, reporter: "spec" });
for (const file of testFiles) mocha.addFile(file);
await mocha.loadFilesAsync();

const failures = await new Promise((resolve) => mocha.run(resolve));
process.exitCode = failures ? 1 : 0;
