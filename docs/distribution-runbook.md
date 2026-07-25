# Hermes Action Bridge distribution runbook

This is the maintainer procedure for releasing one new version of Hermes Action
Bridge across every supported distribution surface. It is intentionally
procedural: do not treat a successful npm publication as proof that the MCPB,
registry listing, marketplaces, or directories are ready.

Use this document for a new immutable version only. Never replace an existing
npm version, Git tag, MCP Registry version, or release asset in order to
"repair" a release; publish a corrective version instead.

The release commit must first live on a dedicated `release/<version>` branch,
not on `main`. Its GitHub Release publishes and proves npm, MCPB, and the MCP
Registry. Only after those immutable artifacts succeed may that exact release
commit be promoted to `main`; this is what makes the Git-backed Claude
marketplace and Agent Skills channels public. The ordering prevents `main`
from ever pinning a Claude plugin to an npm package that is not yet available.

## Release model

The release version is the value in `package.json`. It must also be reflected
in these checked-in distribution files before the release commit is created:

| Surface | Version-bearing file |
| --- | --- |
| npm package | `package.json` and `package-lock.json` |
| MCP Registry | `server.json` and `server.json.packages[0]` |
| Codex plugin | `plugins/hermes-action/.codex-plugin/plugin.json` and `plugins/hermes-action/.mcp.json` |
| Claude Code marketplace | `.claude-plugin/marketplace.json` and `plugins/hermes-action/.claude-plugin/plugin.json` |
| Claude Desktop / Smithery MCPB | `extensions/hermes-action/manifest.json` |

The distribution tests reject drift among these files. The GitHub release
workflow independently rewrites `server.json` from `package.json` before MCP
Registry publication, but the committed `server.json` must still match so that
local checks and the next release start from a consistent state.

The GitHub Actions workflow runs only when a GitHub Release is published, not
when a tag is merely pushed. Manual dispatch is deliberately disabled because
the workflow publishes immutable artifacts. It builds the MCPB, publishes npm
through Trusted Publishing when needed, then either uploads a missing MCPB
asset or verifies byte-for-byte that the existing asset matches. Only then does
it publish or byte-for-byte verify the MCP Registry record. The workflow pins
the npm CLI version so that an immutable-release retry uses the same packer as
the initial publication; update that pin only as an intentional release change.

## Roles, authentication, and secrets

| Surface | Required authority | Secret or authentication rule |
| --- | --- | --- |
| Git and GitHub Release | Push access to `TheBlueHouse75/hermes-action-bridge` | Use normal Git/GitHub authentication; the workflow uses its scoped `GITHUB_TOKEN`. |
| npm | npm Trusted Publishing configured for this repository | No `NPM_TOKEN` is stored or supplied to the workflow. |
| MCP Registry | GitHub OIDC authority for `io.github.TheBlueHouse75/*` | No registry token; `mcp-publisher login github-oidc` runs only when a version is absent. |
| Claude Code marketplace | Maintainer access to the GitHub repository | The marketplace reads the checked-in manifest; no separate marketplace secret is configured. |
| Agent Skills / skills.sh | Public GitHub repository | No repository credential or upload token is configured. |
| Smithery Skill / MCPB | Account that owns the Smithery namespace | Authenticate interactively with `smithery auth login`; do not commit an API key or add it to CI. |
| Glama | GitHub account authorized to claim the listing | Complete GitHub OAuth in the Glama UI; do not use a personal token in the repository. |

`main` may be branch-protected. In that case, promotion requires the normal
approved, passing pull request; do not bypass protection for a release. A
fast-forward-only promotion is allowed only when direct pushes to `main` are
explicitly authorized and `main` is still an ancestor of the release branch.

Do not paste credentials into shell history, release notes, documentation, CI
variables, or the generated MCPB. The bundle test rejects obvious secrets and
machine-specific paths.

## Ordered end-to-end checklist

Run these steps from the repository root. Replace `<version>` with a SemVer
version without a leading `v` (for example, `0.5.1`).

1. Start from an up-to-date, clean `main`, create `release/<version>`, and
   choose the release version.
2. Update the version-bearing files listed in [Release model](#release-model),
   update `CHANGELOG.md`, and commit the release changes on that release
   branch only.
3. Run the local validation gate and inspect the exact package and MCPB that
   will be published.
4. Push the release branch and tag the release commit. Publish the GitHub
   Release from that tag; its workflow publishes npm, MCPB, and the MCP
   Registry.
5. Wait for and retain proof of all three automated artifacts. Do not merge or
   fast-forward the release branch into `main` before this succeeds.
6. Promote the release commit to `main` through the protected-branch PR flow,
   or fast-forward only when explicitly authorized. This activates the Git
   Claude marketplace and Agent Skills channels.
7. Verify the Claude marketplace/plugin and Agent Skills surfaces from `main`.
8. Publish and verify the Smithery Skill and Smithery MCPB independently.
9. Claim or update the Glama listing manually, verify its score/listing, and
   update any external directory PR only after the listing is live.
10. Record the proof URLs and command output in the release notes or release
   issue. A release is complete only when every applicable surface has proof.

## 1. Prepare the release commit

### Prerequisites

- Node.js 20 or newer; the release workflow itself uses Node.js 22.
- Git push access to the repository and a clean working tree.
- The intended version has not already been published to npm.

### Commands

```bash
git switch main
git pull --ff-only origin main
git status --short
git switch -c release/<version>
npm version <version> --no-git-tag-version
```

`npm version --no-git-tag-version` updates `package.json` and the lockfile. It
does not update the distribution manifests. Update every version-bearing file
in the table above and add a dated `CHANGELOG.md` entry. Do not edit a prior
release section.

Confirm there is no stale version string before testing:

```bash
rg -n '"version": "[^"]+"|hermes-action-bridge@[0-9]' \
  package.json package-lock.json server.json plugins .claude-plugin extensions
```

### Local publication gate

Run the same behavioral gate used by CI plus artifact inspection:

```bash
npm ci
npm run check
npm pack --dry-run
npm run build:mcpb
npm run inspect:mcpb
```

Expected proof:

- `npm run check` succeeds, including the metadata, skill, MCPB, and MCP
  handshake tests.
- `npm pack --dry-run` lists `dist/` and `plugins/` and does not list local
  configuration, credentials, or `release/`.
- the archive exists at `release/hermes-action-bridge-<version>.mcpb`, includes
  `dist/cli.js` and production `node_modules`, and has no user path or secret.

`release/` is ignored. Delete a local artifact only if needed for local disk
cleanup; it is regenerated by the workflow and is not a rollback mechanism.

### Commit and release-branch proof

```bash
git diff --check
git diff -- .github .claude-plugin assets docs extensions plugins scripts skills tests \
  .gitignore CHANGELOG.md README.md package.json package-lock.json server.json
git add -- .github/workflows/release.yml .claude-plugin assets docs extensions \
  plugins scripts skills tests .gitignore CHANGELOG.md README.md package.json \
  package-lock.json server.json
git diff --cached --check
git diff --cached --stat
git diff --cached -- .github/workflows/release.yml
git commit -m "chore(release): <version>"
git push -u origin release/<version>
```

The explicit staging list is intentional: this first multi-channel release
adds the release workflow, MCPB builder, distribution tests, Skills, icons,
marketplace metadata, and maintainer documentation as one proven release
input. Confirm the staged workflow contains the MCPB asset upload/verification
step before committing. If a future release includes another distribution
surface, add its paths deliberately instead of assuming the version files are
the entire release.

Before continuing, record the pushed commit SHA:

```bash
git rev-parse HEAD
git status --short
```

If a validation fails, fix it in a new commit on `release/<version>` before
creating the tag. Do not tag a commit whose package and manifests disagree, and
do not merge the branch into `main` to test publication.

## 2. GitHub Release, npm, MCPB asset, and MCP Registry

### Prerequisites

- The release commit is pushed to `origin/release/<version>` and is not yet on
  `main`.
- GitHub CLI is authenticated as a maintainer, or the maintainer can create a
  GitHub Release in the web UI.
- The tag must be exactly `v<version>` and `package.json.version` must be
  exactly `<version>`.

### Commands

Tag the release-branch commit, push both refs, then publish a GitHub Release
from the tag:

```bash
git tag -a "v<version>" -m "v<version>"
git push origin release/<version> "v<version>"
gh release create "v<version>" --title "v<version>" --generate-notes
```

The Release event starts `.github/workflows/release.yml`. Do not upload an
MCPB manually before the workflow: it builds and uploads the versioned asset
from the tagged source.

Watch and inspect the workflow:

```bash
gh run list --workflow release.yml --limit 5
gh run watch
gh release view "v<version>"
gh release download "v<version>" --pattern 'hermes-action-bridge-<version>.mcpb' --dir release --clobber
npm run inspect:mcpb -- release/hermes-action-bridge-<version>.mcpb
```

The automated stages are:

1. verify the tag/package version equality;
2. install, test, and build the MCPB;
3. publish npm with GitHub OIDC, or verify that the exact version already
   exists during a retry;
4. upload the MCPB asset only when it is absent; on a retry, download it and
   compare bytes with the fresh build, failing on any difference;
5. query the MCP Registry; publish only a missing version, otherwise compare
   the returned server record exactly with `server.json`.

### Proof after publication

```bash
npm view hermes-action-bridge@<version> version
gh release view "v<version>" --json tagName,isDraft,isPrerelease,assets,url
registry_name='io.github.TheBlueHouse75/hermes-action-bridge'
encoded_name="$(node -p 'encodeURIComponent(process.argv[1])' "$registry_name")"
curl --fail --silent --show-error \
  "https://registry.modelcontextprotocol.io/v0.1/servers/$encoded_name/versions/<version>"
```

Expected proof: npm returns `<version>`, the GitHub Release is published with
one `hermes-action-bridge-<version>.mcpb` asset, and the registry endpoint
returns the matching version. Save the workflow URL and the Release URL.

### Re-run and rollback

For a transient workflow failure, re-run the same GitHub Release workflow
while the release branch remains unmerged. The npm retry rebuilds the tarball
from the release tag and compares its SHA-512 with npm `dist.integrity`; the
MCPB retry compares the rebuilt archive byte-for-byte with the existing release
asset; the MCP Registry retry compares its existing metadata with `server.json`.
If any comparison fails, stop: the existing immutable publication differs from
this source and must not be overwritten.

There is no safe rollback by reusing `<version>`. If publication fails before
promotion to `main`, prepare a new corrective version on a new release branch.
If it fails after promotion, prepare that corrective version from `main`. A
GitHub Release may be marked as a draft or removed only according to the
project’s release authority; never delete npm or MCP Registry history as a
substitute for a corrective version.

## 3. Promote the proven release to main

### Prerequisites

- The GitHub Release workflow is successful and its npm, MCPB, and MCP Registry
  proofs match `<version>`.
- `origin/release/<version>` is exactly the tagged release commit, not merely a
  descendant of it.
- The release authority knows whether `main` requires a pull request or
  explicitly permits a direct fast-forward.

### Protected-main promotion (default)

Open a pull request from the release branch only after the automated proof is
complete. First lock the branch head to the immutable tag SHA. Follow every
required review and status check, then merge with a merge commit so the tagged
release commit remains an ancestor of `main`. Do not use squash or rebase
merging for this promotion: either creates different commit ancestry and cannot
prove that the released commit itself reached `main`.

```bash
release_sha="$(git rev-parse "v<version>^{commit}")"
git fetch origin release/<version>
test "$(git rev-parse "origin/release/<version>")" = "$release_sha"
gh pr create --base main --head release/<version> \
  --title "chore(release): <version>" \
  --body "Promotes the proven v<version> release after npm, MCPB, and MCP Registry verification."
```

Before merging the approved PR, repeat the equality check. Use GitHub CLI’s
head-SHA guard so the merge fails if the PR head changed after verification:

```bash
pr_number="<approved-pr-number>"
git fetch origin release/<version>
test "$(git rev-parse "origin/release/<version>")" = "$release_sha"
gh pr merge "$pr_number" --merge --match-head-commit "$release_sha"
```

After the merge, fetch `main` and prove it contains the release tag before
treating Git-backed channels as published:

```bash
git fetch origin main
git merge-base --is-ancestor "v<version>" origin/main
git show "origin/main:plugins/hermes-action/.mcp.json"
```

### Fast-forward promotion (only when authorized)

Use this path only if branch protection permits direct pushes and `main` has
not advanced beyond the release branch’s base. Do not force-push.

```bash
git switch main
git pull --ff-only origin main
git merge --ff-only "v<version>"
git push origin main
git fetch origin main
git merge-base --is-ancestor "v<version>" origin/main
```

If either promotion path cannot include the tagged commit, stop and resolve the
branch divergence or protection requirement. If protected `main` permits only
squash or rebase merging, obtain an approved merge-commit exception or an
explicitly authorized fast-forward; do not substitute a rewritten commit.
Never copy only the marketplace metadata onto `main`: it must arrive with the
proven release commit.

### Re-run and rollback

If npm, MCPB, or MCP Registry proof fails, leave `release/<version>` out of
`main` and repair through a new version. If the promotion itself is blocked,
the immutable artifacts remain valid but the Git-backed channels are pending;
record that state rather than bypassing protection. After promotion, a bad pin
requires a new corrective release branch and version.

If `origin/release/<version>` differs from `v<version>^{commit}` at either
check, do not create or merge the PR. The branch is no longer the proven
release input; preserve it for diagnosis and prepare a new versioned release
branch instead of resetting, force-pushing, or promoting its newer head.

## 4. Claude Code marketplace and plugin

### Prerequisites

- The proven release commit containing `.claude-plugin/marketplace.json`,
  `plugins/hermes-action/.claude-plugin/plugin.json`, the plugin Skill, and
  `plugins/hermes-action/.mcp.json` is on `main` after the promotion above.
- The matching npm package is published: the plugin MCP configuration pins
  `hermes-action-bridge@<version>` and resolves it at startup with `npx`.
- The verifier has Claude Code installed and an authenticated Claude session.

### Publication and proof

This surface is Git-backed: merging the manifest changes to `main` is the
publication action. It has no separate release API or secret in this
repository. Verify it from a disposable or test Claude Code profile with the
documented consumer commands:

```bash
claude plugin marketplace add TheBlueHouse75/hermes-action-bridge
claude plugin install hermes-action@hermes-action-bridge
claude plugin list
```

Then start Claude Code and confirm that the Hermes Action plugin is present,
the `hermes-action-bridge` Skill is discoverable, and the `hermes_*` MCP tools
are available. Use `hermes_status` as a token-free smoke test before asking
Hermes to perform work.

### Re-run and rollback

Before npm proof, correct metadata only on `release/<version>` and rerun
`npm run check`; do not merge it into `main`. After a promoted plugin points to
a bad npm version, publish a corrective package version on a new release branch
and promote it only after proof. Do not retag or mutate the old version. A
client that already installed the old plugin keeps its prior version until it
updates or reinstalls.

Related files: `.claude-plugin/marketplace.json`,
`plugins/hermes-action/.claude-plugin/plugin.json`,
`plugins/hermes-action/.mcp.json`, and
`tests/claude-plugin-distribution.test.ts`.

## 5. Agent Skills and skills.sh

### Prerequisites

- `skills/hermes-action-bridge/SKILL.md` is byte-identical to the installer
  template and plugin Skill; `npm run check` verifies this.
- The proven release commit is promoted to public `main`.

### Publication and proof

The repository is the distribution source. There is no repository-owned
skills.sh token or manual upload step. Confirm the consumer path after the
release commit is public:

```bash
npx skills add TheBlueHouse75/hermes-action-bridge --skill hermes-action-bridge
```

The command must install the canonical Skill without requesting an MCP
configuration. This is expected: Agent Skills provide instructions only. For
MCP tools, validate the npm installer, Claude Code plugin, or MCPB path
separately.

For a public listing check, search skills.sh for `Hermes Action Bridge` and
open the result that points to `TheBlueHouse75/hermes-action-bridge`. The
listing is directory-managed, so do not claim a synchronous indexing SLA.

### Re-run and rollback

If the Skill content is incorrect, correct it in the repository and verify
`npm run check`; clients must update or reinstall to receive the new content.
Do not rewrite a published Git tag to alter the Skill. If indexing has not
appeared, recheck the public repository and retry the install command before
contacting the directory operator.

Related files: `skills/hermes-action-bridge/SKILL.md`,
`src/install/templates.ts`, and `tests/examples.test.ts`. See the
[Skills CLI documentation](https://www.skills.sh/docs/cli) for client usage.

## 6. Smithery Skill publication

### Prerequisites

- The canonical `skills/hermes-action-bridge/SKILL.md` has passed `npm run check`.
- The proven release commit is public on `main`.
- Publication runs from a clean checkout or worktree whose `HEAD` is exactly
  `v<version>^{commit}`.
- The maintainer is authorized for the target Smithery namespace.

### Commands

Authenticate interactively, then publish the checked-in Skill directory:

```bash
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse "v<version>^{commit}")"
npm install -g @smithery/cli@latest
smithery auth login
smithery skill publish skills/hermes-action-bridge --namespace <namespace> --name hermes-action-bridge
```

The first two commands must produce no error: they prove the worktree is clean
and `HEAD` matches the dereferenced release tag. This is independent from MCPB
publication. The CLI login is interactive and no Smithery credential belongs
in CI.

### Proof, re-run, and rollback

Record the public Skill page URL printed or opened by the CLI in the GitHub
Release notes, together with the command output and source commit SHA. If the
command fails before acceptance, fix the account or namespace state and rerun
the exact command from the proven release commit. If the published Skill is
faulty, publish the corrected release source; do not rewrite a published Git
tag or describe the MCPB listing as proof of the Skill listing.

## 7. Smithery MCPB publication

### Prerequisites

- The GitHub Release MCPB asset has passed the archive inspection above.
- Node.js 20 or newer and the Smithery CLI are available locally.
- The maintainer is authorized for the target Smithery namespace.

### Commands

Use the exact inspected artifact from the GitHub Release (or regenerate it
from the identical clean tag), authenticate interactively, and publish it:

```bash
npm install -g @smithery/cli@latest
smithery auth login
smithery mcp publish release/hermes-action-bridge-<version>.mcpb -n <namespace>/hermes-action-bridge
```

This channel is manual by design. The CLI login is interactive and no
Smithery credential belongs in CI. See the [Smithery context and official
sources](SMITHERY.md) appendix for channel-specific background.

### Proof, re-run, and rollback

Complete the Smithery flow and verify the resulting server page installs the
local MCPB artifact. Record that page URL, the GitHub Release asset URL, and
the command output in the GitHub Release notes. If publication fails before
acceptance, fix the local account/namespace state and retry the exact artifact.
If an accepted artifact is faulty, publish a new corrective MCPB version; do
not upload a different archive under the same version.

If a Smithery MCPB CLI version requires an `inputSchema` in a tool entry, stop
and record the CLI version, complete error, and inspected archive URL in the
release notes. MCPB manifest version 0.3 forbids those tool properties because
its `tools` schema has `additionalProperties: false`; never modify the
generated MCPB artifact to satisfy that request. Keep the MCPB listing pending
and report the incompatibility upstream.

## 8. Glama listing and ownership claim

### Prerequisites

- The GitHub Release, npm package, and MCP Registry record for `<version>` are
  already public, so the listing has stable metadata to inspect.
- A maintainer can authenticate to GitHub in the browser used for Glama OAuth.

### Publication and proof

Glama is not automated by this repository. Open the listing and complete its
**Claim** flow with the authorized GitHub account:

```text
https://glama.ai/mcp/servers/TheBlueHouse75/hermes-action-bridge
```

There is no repository-owned CLI command or secret for this action. Do not
invent a `glama publish` command or add OAuth material to CI. After the claim,
wait for Glama to display the owner and score, then verify the public listing
shows the current server metadata. If the directory PR is still open, inspect
it before editing:

```bash
gh pr view 8988 --repo punkpeye/awesome-mcp-servers
```

Only after the claim and score are visible should the maintainer add the exact
generated score badge or update the external directory entry. Do not guess a
badge URL.

### Re-run and rollback

If OAuth is not authenticated, stop at the browser login boundary and retry
the claim after login. If the listing’s metadata or score is stale, wait for
the directory refresh or contact Glama support rather than changing package
metadata solely to force a refresh. A bad external listing is corrected by the
directory owner’s normal update path; the immutable package release still
requires a new corrective version if its own metadata is wrong.

## Final sign-off

Before declaring the release complete, retain these proofs:

- release commit SHA, tag, GitHub Release URL, and successful workflow URL;
- `npm view hermes-action-bridge@<version> version` output;
- MCP Registry endpoint response for the exact version;
- inspected MCPB archive or Release asset URL;
- merged promotion PR URL or authorized fast-forward proof that `main`
  contains `v<version>`;
- the recorded `v<version>^{commit}` SHA and the matching PR head SHA, when a
  protected-main PR was used;
- Claude Code plugin and Agent Skills smoke-test result;
- Smithery Skill page URL and command output, if published for this version;
- Smithery MCPB page URL, GitHub Release asset URL, and command output, if
  published for this version; and
- Glama claim/listing URL and score status, if applicable.

If any proof is missing, label the channel as pending rather than treating the
whole release as complete.
