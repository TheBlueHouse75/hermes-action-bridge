import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readJson } from "./helpers/json.js";

type PackageJson = { version: string };
type RegistryManifest = { version: string; packages: Array<{ version: string }> };
type PluginManifest = { version: string };

describe("published metadata", () => {
  it("keeps package, MCP registry, and Codex plugin versions synchronized", () => {
    const packageJson = readJson<PackageJson>("package.json");
    const serverJson = readJson<RegistryManifest>("server.json");
    const pluginJson = readJson<PluginManifest>("plugins/hermes-action/.codex-plugin/plugin.json");

    expect(serverJson.version).toBe(packageJson.version);
    expect(serverJson.packages[0]?.version).toBe(packageJson.version);
    expect(pluginJson.version).toBe(packageJson.version);
  });

  it("uses the supported Codex plugin MCP shape and pins the package version", () => {
    const packageJson = readJson("package.json");
    const manifest = readJson("plugins/hermes-action/.mcp.json");

    expect(manifest).toHaveProperty("mcpServers.hermes-action");
    expect(manifest).not.toHaveProperty("mcp_servers");
    expect(manifest).toHaveProperty("mcpServers.hermes-action.args", [
      "-y",
      `hermes-action-bridge@${String(packageJson.version)}`,
      "mcp",
    ]);
  });

  it("includes the Codex plugin in the npm package", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files;

    expect(Array.isArray(files)).toBe(true);
    expect(files).toContain("plugins");
  });

  it("verifies npm integrity before immutably uploading or matching the MCPB release asset", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const npmPublishStart = workflow.indexOf("- name: Publish to npm via OIDC Trusted Publishing");
    const mcpbUploadStart = workflow.indexOf("- name: Upload or verify MCPB GitHub release asset");
    const npmPublishStep = workflow.slice(npmPublishStart, mcpbUploadStart);
    const mcpbUploadStep = workflow.slice(mcpbUploadStart);

    expect(npmPublishStart).toBeGreaterThanOrEqual(0);
    expect(mcpbUploadStart).toBeGreaterThan(npmPublishStart);
    expect(workflow).not.toContain("npm@latest");
    expect(workflow).toMatch(/npm install -g npm@\d+\.\d+\.\d+/);
    expect(npmPublishStep).toContain('npm view "$package_name@$package_version" dist.integrity');
    expect(npmPublishStep).toContain('crypto.createHash("sha512")');
    expect(npmPublishStep).toContain('if [ "$local_integrity" != "$published_integrity" ]; then');
    expect(npmPublishStep).toContain("exit 1");
    expect(workflow).not.toContain("--clobber");
    expect(mcpbUploadStep).toContain("gh release view \"$RELEASE_TAG\" --json assets --jq '.assets[].name'");
    expect(mcpbUploadStep).toContain('grep -Fxq "$asset_name"');
    expect(mcpbUploadStep).toContain('gh release download "$RELEASE_TAG" --pattern "$asset_name" --dir "$comparison_directory"');
    expect(mcpbUploadStep).toContain('cmp --silent "$asset_path" "$published_asset"');
    expect(mcpbUploadStep).toContain("matching bytes");
    expect(mcpbUploadStep).toContain("different bytes");
    expect(mcpbUploadStep).toContain('gh release upload "$RELEASE_TAG" "$asset_path"');

    const assetLookup = mcpbUploadStep.indexOf("gh release view");
    const existingAssetBranch = mcpbUploadStep.indexOf("if gh release view");
    const assetDownload = mcpbUploadStep.indexOf("gh release download");
    const byteComparison = mcpbUploadStep.indexOf("cmp --silent");
    const differentAssetExit = mcpbUploadStep.indexOf("different bytes.");
    const uploadCommand = 'gh release upload "$RELEASE_TAG" "$asset_path"';
    const uploadElse = mcpbUploadStep.indexOf(`else\n            ${uploadCommand}`);
    const assetUpload = mcpbUploadStep.indexOf(uploadCommand);

    expect(assetLookup).toBeGreaterThanOrEqual(0);
    expect(assetLookup).toBe(existingAssetBranch + "if ".length);
    expect(assetDownload).toBeGreaterThan(existingAssetBranch);
    expect(byteComparison).toBeGreaterThan(assetDownload);
    expect(differentAssetExit).toBeGreaterThan(byteComparison);
    expect(mcpbUploadStep.indexOf("exit 1", differentAssetExit)).toBeGreaterThan(differentAssetExit);
    expect(uploadElse).toBeGreaterThan(differentAssetExit);
    expect(assetUpload).toBe(uploadElse + "else\n            ".length);
  });
});
