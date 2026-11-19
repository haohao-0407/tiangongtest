# ForgeAX Game Project Guide

AI-first TypeScript game on `@forgeax/engine`. Hard rules and routing here;
open a reference only when its task applies. Never read whole large `SKILL.md` files;
stop after their short start section unless the task needs more.

## Start here

1. Imports and signatures: [the API index](skills/forgeax-engine-sdk/references/api-index.md) before searching `node_modules`.
2. Effects in an `empty` project: [the effects cookbook](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/effects-cookbook.md)
   indexes topics; open ONLY one.
3. Commands: the Quick contract atop [`forgeax-engine-cli`](skills/forgeax-engine-cli/SKILL.md);
   exact inputs come from `pnpm exec forgeax help <path> --json`, never guesses.
4. Pick the route in [Run, test, build, and release](#run-test-build-and-release), then edit.
5. Rendering has native equivalents for most Three.js core features: look an effect up in
   [the Three.js equivalence guide](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/three-equivalents.md) (with gaps) before simplifying it.

## Hard rules

- `forge.json` owns project configuration and `forge.json#roots` is the sole plugin
  assembly authority; stable GUIDs own asset identity. Never add parallel manifests,
  lifecycles or runtime entrypoints.
- Assets: author source → importer/cooker → DDC → catalog → `assets.load(guid, kind)`.
  Author in `assets/` (`*.pack.ts`, `*.pack.json`, `<file>.meta.json`); never edit `dist/`,
  `pack-index.json`, DDC or `.forgeax/`, or fetch assets manually.
- Content made during play skips Packs: bind `ctx.assets.create(...)` output, release it
  from the effect ([`forgeax-engine-assets`](skills/forgeax-engine-assets/SKILL.md#runtime-identity-and-content)).
- Each Pack `build()` key is a `sourceKey`: lowercase segments matching
  `^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$` (`mesh/crate`). GUID =
  `UUIDv5(packageId, sourceKey)`. ScriptablePack files end in `.pack.ts`.
- Import only `@forgeax/engine` or `@forgeax/engine/<package-directory>`, never
  `@forgeax/engine-*`.
- Add dependencies with `pnpm add <name>`, not by editing `package.json`. If a frozen
  lockfile rejects an edit or `packageManager` change, run `pnpm install --no-frozen-lockfile`.
- Game logic is a native Cordis `Plugin`; cleanup belongs to `ctx.effect()`. DOM, Web
  Audio and browser SDKs belong to the frontend root, never Engine Workers.
- Expected failures return `Result`: branch on `.code`, keep `.expected`/`.hint`/`.detail`.
- Run `pnpm exec forgeax <path> --json`; add `--detail` only for `omitted.fields` you need.
- `game-3d` content is a reference, not the game: record its
  [Template Disposition](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-project-guide.md#game-3d-template-disposition) first.
- Before delivery, list each requested requirement; the playthrough asserts each through
  the read projection and saves one named screenshot per requirement (every ending, each
  object type, multi-enemy states, the core input's visible effect; failure and debug
  frames belong in `.forgeax/diag/`, not `artifacts/`). Never bend game code
  for the test (enemies spawned ahead, exposed aim targets). See
  [Requirement coverage](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-delivery.md#requirement-coverage).
- Append confirmed Engine/SDK issues to `docs/feedback.md` at once (no secrets);
  `project package` ships it.
- Edit this project directly. A ForgeAX closed loop needs explicit user agreement.
- Capture with [`forgeax-engine-rhi-debug`](skills/forgeax-engine-rhi-debug/SKILL.md) only for
  unexplained black frames, missing objects, wrong lighting or flicker, before editing
  shaders; never to deliver.

## Run, test, build, and release

| User intent | Route |
|:--|:--|
| Create, change or locally play (default) | [Local playable delivery](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-delivery.md#local-playable-delivery) |
| Publish, deploy or distribute | [Game release](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-delivery.md#game-release) |
| Engine/SDK change, SDK publication, performance | Owning package, [SDK production](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/sdk-production.md), performance skill |

```bash
pnpm exec forgeax project check --json
pnpm test && pnpm typecheck
pnpm exec forgeax project play scripts/playthrough.mjs --json
```

Accept local delivery only on the final code: `project play` (or `dev verify`) passes; you opened the PNG, see the requested scene/UI and passed the
[visual self-review](skills/forgeax-engine-sdk/SKILL.md#visual-self-review); you drove
the core input and saw its result; both survive a reload. A build, URL, HTTP 200 or unit
test alone accepts nothing. A blocked check stays unverified: report it, never a pass.

Evidence comes only from these commands' owner browser. Hand over the `dev status` URL;
never open or drive another tab for acceptance (it may be backgrounded; its
`live-bridge-not-owner` warning is expected). Run `project play` and `dev verify` blocking
in one call with a large exec yield (21+ min at default budgets: ~14 per play, +7 when queued),
or lower `--timeout-ms`; never background or poll them. Each prints one JSON result and at
most one stderr progress line per 30 s. The live owner is optional: `dev` observations start
it on demand; upkeep is only `dev start`/`dev stop`. For timers or long waits, call
`play.advance(seconds)`, not `play.wait`/long `waitFor` timeouts. Fix its `layout` warnings (HUD text overlapping
or clipped at 1280x720/1280x600) before committing.

On an unchanged `empty` template, `play-runtime-failed` with reason `flat-canvas` is the
expected start, not an environment failure.

## Task routing

| To | Read |
|:--|:--|
| Layout, SDK setup, skill links, Engine model, View | [project guide](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-project-guide.md) |
| Asset forms, import, verify | [Asset authority](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-project-guide.md#asset-authority-and-formats), then `forgeax-engine-assets` |
| Roots, plugins, third-party SDK startup | [Game code](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-project-guide.md#game-code-and-plugins), `forgeax-engine-app` |
| Pick Engine capabilities | [SDK skill](skills/forgeax-engine-sdk/SKILL.md) table; feature catalog on demand |
| Camera, lights, shadows, post | Quick contract of `forgeax-engine-render-pipeline` |
| Materials, textures, WGSL | `forgeax-engine-material`, `forgeax-engine-shader` |
| Input, frame loop, HUD, pointer lock | `forgeax-engine-app`; cursor games call `gameHost.setPointerLockAllowed(false)` once |
| Physics, character motion | `forgeax-engine-physics` |
| Blocked checks, Linux headless, release | [delivery guide](https://github.com/ForgeaXGame/forgeax-engine-harness/blob/main/docs/engine/skills/forgeax-engine-sdk/references/game-delivery.md) |
| Scripted playthrough and acceptance | `forgeax project play` in the CLI skill quick contract; edit `scripts/playthrough.mjs` |

<!-- BEGIN FORGEAX GAME PLUGIN (v1 sha256:7247ca36815b) -->
## ForgeaX game development

This project is a ForgeaX game workspace. Route game work through the `forgeax` MCP
server rather than reconstructing it from shell commands. The current host Agent owns
reasoning and game-code edits; the plugin owns the exact Engine Preview adapter.

- Game implementation and failure recovery: follow the `forgeax-game` project skill.
  The published plugin carries the Skill and host rules; install or refresh it with
  `forgeax-game devkit install`. A local `forgeax-install` checkout is optional.

- Starting or resuming work, or unsure what is running: read the `forgeax://status`
  resource first. Clients without resource support call `forgeax_status_lite`.
  Status is read-only and never writes to the workspace.
- Running, previewing, or verifying the game ("run it", "let me see it", "does it
  work"): call `forgeax_run_current_game`. It invokes the exact installed Engine
  CLI build, starts or reuses Engine-owned Preview, and reports its verified
  release/build/instance identity.
- Native application View: when the optional `forgeax_view_start` tool is
  actually exposed and the user wants the in-app interface, open the SDK-owned
  View with it. Keep the build/Preview checks above; opening View is not gameplay
  acceptance. If absent, explain `forgeax-game view enable --ide codex` (or the
  target application's supported plugin installation), without guessing a UI tool
  or navigating a localhost iframe. Never report an unopened native panel as seen.
- Reading build or Preview errors: read the returned `preview.stdout_log` and
  `preview.stderr_log` paths with your own file-reading tool. Log tailing is
  deliberately not an MCP tool — the log is a file, so read it like one.
- Generating art or 3D assets ("make a sprite", "I need a texture", "generate a
  model of…"): call `forgeax_generate_image` (text-to-image, or image-to-image
  with a local `image`) or `forgeax_generate_3d` (text-to-3D via `prompt`,
  image-to-3D via `image`). Both save into the active game's `assets/` directory
  and return the project-relative path to reference from code. Image-to-3D accepts a
  public https URL, or a local file path when COS is configured (it is uploaded and
  passed as a short-lived presigned URL). They need `FORGEAX_LITELLM_API_KEY` (and
  `FORGEAX_COS_*` for local-file image-to-3D) in the environment.
- Reusing a library 3D asset: read the installed `art-3d-asset-library` Skill
  and use its pinned CLI to search candidates and import the selected ID.
  If not enabled, report the missing setup. Do not relabel procedural geometry
  or generated models as library results.
- Creating a game, switching the active game, installing or upgrading the plugin:
  these are one-time operations and are CLI subcommands, not MCP tools. Run
  `npx -y @forgeax/game <init|use|doctor|devkit|upgrade>`.

In an empty standalone directory, `forgeax-game init` creates the released Engine
game and installs this guidance. In an existing exact Engine game it refreshes the
binding idempotently. Follow `forge.json` and the installed Engine authoring layout
(v2 uses `assets/` and `plugins[]`), rather than prescribing `src/`. Studio's
`.forgeax/games/<slug>` layout is a different hosted-project boundary and must not be
invented here. Before claiming a requested game complete, replace the Empty template
identity in `forge.json`, `package.json`, and README, keep tests/controls accurate,
and call `forgeax_run_current_game`. Mount UI under the Engine Host `uiRoot` or
`#game-ui`; the released Host provides `#game-ui`, so direct `document.body`
mutation is rejected. Export and behavior-test at least one named game-specific state
transition or rule; renaming the Empty template test is not completion.
Any run-tool error means the game is not previewed: never curl, reuse, open, or report
an existing localhost port. HTTP 200 is not ownership evidence. Only a successful tool
result containing `preview.status: ready`, root, build digest, instance ID, and its own
`preview_url` authorizes a Preview claim, not a gameplay-verification claim.
For playable-game requests, check the requested interactions and visible feedback
with an available browser tool. If unavailable, report gameplay as unverified and
provide manual checks; do not stop useful implementation or invent test results.
Use the installed Engine contract for Host access and UI lifecycle, and verify
requested UI is mounted rather than silently skipping it when a Host lookup fails.
Never substitute Studio, Editor, PATH, or a source checkout for the installed Engine
release.
<!-- END FORGEAX GAME PLUGIN -->
