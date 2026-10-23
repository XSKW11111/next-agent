import nextConfig from "eslint-config-next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**", ".next/**", ".agents/**", "scripts/local-load/.data/**"] },
  ...nextConfig,
  tseslint.configs.recommended,
);
