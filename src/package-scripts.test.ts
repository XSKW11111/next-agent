import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("package.json runs Next with the install-doc scripts", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  expect(packageJson.scripts.dev).toBe("next dev");
  expect(packageJson.scripts.lint).toBe("eslint");
  expect(packageJson.scripts["lint:fix"]).toBe("eslint --fix");
  expect(packageJson.devDependencies["eslint-config-next"]).toBe("^16.4.0");
});
