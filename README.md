# ChatGPT migration plugin — local pilot

Prepare selected ChatGPT data for the **AI Workforce Pro (AIWP)** ChatGPT importer. The workflow follows the Claude migration plugin: choose categories, collect exact inputs, review coverage, select items, and build one bundle.

**This is a desktop pilot. AIWP ChatGPT bundle import support has merged in PR #1075 and passed a synthetic local import rehearsal.** Use a destination with that change deployed and MongoDB transaction support. A real current export, complete installed questionnaire acceptance, and external-client installation remain unverified. Do not relabel the bundle as Claude data. See the [current checkpoint](docs/CHECKPOINT.md) for evidence and the [runtime protocol](docs/runtime-test.md) for remaining checks.

## Start here — your first migration

**The flow:** download your ChatGPT export → let the plugin prepare a bundle → review and import that bundle in AIWP. A **bundle** is the new JSON file the plugin creates; it is different from the ZIP you download from ChatGPT. Your original chats are not deleted.

### 1. Check what you need

- The ChatGPT desktop app with **Work running locally** and permission to use local files/programs. This package does not run in ordinary browser-only ChatGPT.
- **Node.js 20 or newer** on your computer (tested with Node 24). Node runs the helper and questionnaire. If the plugin reports that Node is missing, ask your setup contact to install it from [nodejs.org](https://nodejs.org/) and restart the desktop app. You do not need an API key or an npm install for this plugin.
- Your AIWP login and the correct destination account. Ask your AIWP administrator to confirm **Import from ChatGPT** is enabled and the database supports transactions.

If Work locally or the marketplace controls are missing, ask your workspace administrator about availability. Making this GitHub repository public does not unlock those features.

### 2. Add and install the plugin

In the desktop app, open **Plugins / Plugins Directory**, then **Add plugin marketplace**. Enter:

| Field | What to enter |
|---|---|
| Source | `https://github.com/SMB-Team-Technology/ChatGPT-migration-plugin.git` |
| Git ref | `main` |
| Sparse paths | Leave empty |

Add the marketplace, choose **SMB ChatGPT migration pilot**, and install **chatgpt-migration**. Quit and reopen the desktop app, then start a **new local Work chat**. Adding the marketplace and installing its plugin are separate steps. If GitHub asks for access, the repository is still restricted to authorized accounts.

### 3. Try the sample first

Select the installed **chatgpt-migration** skill in the chat's plugin/skill picker; no custom prompt is needed. When the category form appears, choose **Chats** and continue. Answer the source/account questions, then choose **Try the sample first** when asked about your export.

Success means the plugin reports a created and validated sample bundle and gives you a file you can open. This uses synthetic chats, not your account. Keep this sample separate from your real export; it is a rehearsal, not your migration.

### 4. Get your real ChatGPT export

For an eligible account, sign in to ChatGPT on the web and open **profile menu → Settings → Data controls → Export data → Export → Confirm export**. Wait for the download notification and save the completed ZIP somewhere you can find it, such as Downloads. Do not upload a notification email, manifest alone, or screenshot instead.

Exports can take up to **7 days**, and the download link expires after **24 hours**. Keep the link private and wait for the existing request instead of repeatedly requesting another. Business, Enterprise and Healthcare workspaces do not offer self-service export; contact the workspace owner. [Official export instructions](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data).

### 5. Prepare your bundle

Start a new local Work chat and select the migration skill again. Choose the categories you want. **Chats is the simplest first real run**; other categories need exact records you supply separately. Selecting all six does not automatically collect everything from your account.

Choose **Yes, ready** when asked about the export. Identify the downloaded ZIP using the file picker if offered, or its exact local path. Let the plugin read that selected file, review its found/skipped/missing summary, and choose the items to include. Leave credential-flagged records out unless you have reviewed them deliberately.

The plugin creates a new bundle outside the source and code repository, validates it, and gives you its location. It does not upload anything to AIWP. Keep the original ZIP.

### 6. Preview, import, and verify

In the intended AIWP account, open **Settings → Data controls → Import from ChatGPT**. Choose the **bundle JSON from step 5**, not the original export ZIP or the sample bundle. Review the preview and selection, then confirm import. Read the results and open a few imported chats to check their text and selected branch. Keep the originals until you have verified the destination.

If the ChatGPT button is missing, stop and contact your AIWP administrator. Do not substitute **Import from Claude** or the generic **Import** button. See [category coverage](#category-coverage) for attachments, projects, memories and other limitations.

### If something goes wrong

| What you see | What to do |
|---|---|
| Plugin missing after adding the repo | Select the marketplace and install the plugin; restart and use a new local Work chat. |
| `choose_migration_categories` missing or no form | Check the installed version, local execution and Node availability. Update/reinstall once, then ask your setup contact if it persists. |
| `node` not found | Install Node through your setup contact, restart the app, and repeat the sample. |
| Export rejected or only a manifest available | Confirm the download completed and provide the actual conversation export ZIP/JSON. Never rename a manifest to force acceptance. |
| Some chats skipped or quarantined | Read the coverage report. Valid chats can continue; do not treat the result as a complete account migration. |
| Output already exists | Choose a new output filename. The helper deliberately refuses to overwrite files. |
| AIWP rejects the bundle or requires transactions | Ask the AIWP administrator to verify deployment/database support. Keep the bundle and originals. |

When asking for help, share the plugin version and error message first. Do not post your export, bundle, download link or private chat text in a public GitHub issue.

The desktop installation pattern follows [OpenAI's marketplace documentation](https://developers.openai.com/plugins/build/plugins). Fresh-client installation and real-export compatibility still need rehearsal; these instructions do not certify every account or app version.

---

## Developer reference

The sections below describe the helper, data contract and terminal commands. You do not need to run them for the guided flow above.

## What is implemented

- A deterministic Node helper for `doctor`, `scan`, `build`, and `validate`.
- Explicit ChatGPT conversation JSON, ZIP, or extracted-directory inputs, with graph-aware normalization.
- Optional exact staged records for projects, conversations, memories, skills, scheduled tasks, and artifacts.
- Selection, credential-pattern exclusions, coverage reporting, and local bundle creation.
- A portable plugin manifest, local marketplace catalog, migration skill, and embedded six-checkbox category form served by a local MCP stdio process.

There is no account-wide harvesting, hosted service, automatic browser download, or API-key requirement. The helper uses files you identify. It does not upload the bundle. Local execution does not establish that the surrounding ChatGPT conversation stays exclusively on the device.

## Quick local check

Requires Node 20 or newer. There are no npm dependencies to install.

```sh
cd ChatGPT-migration-plugin
npm test
node scripts/aiwp-migrate.mjs doctor
node scripts/aiwp-migrate.mjs scan --export test/fixtures/chatgpt-synthetic.json --categories conversations
```

Build a synthetic bundle outside this repository using a fresh directory:

```sh
migration_test_dir=$(mktemp -d)
node scripts/aiwp-migrate.mjs build \
  --export test/fixtures/chatgpt-synthetic.json \
  --categories conversations \
  --out "$migration_test_dir/aiwp-chatgpt-bundle.json"
node scripts/aiwp-migrate.mjs validate "$migration_test_dir/aiwp-chatgpt-bundle.json"
```

The validator checks this pilot's contract. It does not contact AIWP or prove destination compatibility, account completeness, or successful import. Existing output files are not overwritten. Keep actual exports and bundles outside code repositories.

## Collect and select

Choose categories before collecting. Identifiers are `projects`, `conversations`, `memories`, `skills`, `scheduledTasks`, and `artifacts`.

```sh
node scripts/aiwp-migrate.mjs scan \
  --export /absolute/path/to/export.zip \
  --inputs /absolute/path/to/approved-staging-folder \
  --categories conversations,projects
```

The helper does not search your home directory for account data. Only supply a staging folder prepared for this migration and source account. See [the staging and bundle contract](docs/bundle-format.md).

An export ZIP or directory must have its conversation files in exactly one folder. Supply either `conversations.json` or numbered split files, never both in the same folder. Multiple conversation folders are also rejected to avoid combining unrelated exports. This checks file layout, not account identity. Staged conversations supplement an export; a duplicate conversation ID is an error, not a replacement.

Malformed or oversized conversations are quarantined individually so valid chats can still be collected. Scan reports accepted, quarantined, and omitted counts, with each issue's source record position and fixed reason. `--show-titles` also identifies omitted and quarantined chats; displayed titles are capped at 300 characters and credential patterns are redacted. Source content is never silently shortened. Entirely invalid input cannot produce an empty successful bundle. Invalid JSON, unknown export formats, duplicate identities, ambiguous export folders, and input resource-limit failures still stop collection.

Default reports avoid raw source IDs, titles, messages, memory values, and artifact contents. Each item has an opaque selection key, such as `conversations:<hash>`. Copy the exact key from the report to `--exclude` or `--allow-flagged`; multiple keys are comma-separated. To review titles/names locally, add `--show-titles` to scan. This deliberately reveals those labels, but not message bodies; detected credential patterns are redacted.

Credential-like content is detected in raw string values and excluded by default. `--allow-flagged` makes an exception only for the specified items, following the user's explicit decision. Selection keys include the item's canonical content: changing a record invalidates its previous approval or exclusion key and requires a new scan. Detection is best-effort and does not guarantee all secrets have been identified. Zero collected items is not proof an account has none.

## Category coverage

| Category | Source in this pilot | Limits |
|---|---|---|
| Chats | Recognized ChatGPT export; exact staged graph records | Retains supported user/assistant text and branches. Unsupported content is reported, not reconstructed. |
| Projects | Exact staged records | No guessed membership from titles or GPT IDs; original project files and connectors are separate. |
| Memories | Exact staged records | No generated recollections presented as saved memory. |
| Skills | Exact staged content and supplied text resources | Authorized GPT instructions may be staged; custom actions and model behavior are not migrated. |
| Scheduled tasks | Exact staged one-time or cron schedules | Must remain paused. Unsupported recurrence/event behavior requires manual handling; no automatic RRULE conversion. |
| Artifacts | Exact staged supported content | Canvas tool calls are omitted with a specific warning; stage the exact document content separately. A title, inventory, or URL alone is not content. Binary attachments are not reconstructed. |

Current account export coverage outside conversations is not established. Local Codex sessions are a separate potential adapter, not synonymous with ChatGPT history.

## Install for a supervised runtime test

The proposed target is **ChatGPT desktop → Work with permitted local execution**, not ordinary Chat mode. A directory listing alone does not establish the execution and file access the helper needs.

For the team repository, add this source in the Plugins Directory marketplace dialog:

- Source: `https://github.com/SMB-Team-Technology/ChatGPT-migration-plugin.git`
- Git ref: `main`
- Sparse paths: leave blank

The repository must be accessible to the installing account; public visibility removes the GitHub access invitation requirement. Alternatively, register it from Terminal:

```sh
codex plugin marketplace add https://github.com/SMB-Team-Technology/ChatGPT-migration-plugin.git
```

For local development, run `codex plugin marketplace add "$PWD"` from this repository's root. The catalog at `.agents/plugins/marketplace.json` points to `./`, relative to that root.

Restart ChatGPT desktop, choose **SMB ChatGPT migration pilot**, install the plugin, and open a fresh local Work chat. Selecting the migration skill starts onboarding without a custom prompt. Use **Try the sample first** for a rehearsal. The developer test prompt and expected results are in [runtime-test.md](docs/runtime-test.md).

For a Git-backed marketplace, refresh with:

```sh
codex plugin marketplace upgrade smb-chatgpt-migration-pilot
```

Then update/reinstall the plugin and start a fresh chat. This upgrade command does **not** apply to a marketplace registered as a local folder. For a local source, update the checkout and reinstall from that local marketplace. Check the installed version against root `plugin.json`; the host runs a cached copy, not necessarily your working tree.

If `choose_migration_categories` is missing, check the installed version, whether the local MCP process is available, and root `mcp.json`. That file must declare its schema. A successful helper `doctor` does not verify MCP discovery or widget rendering. Do not repeatedly reinstall without checking the failure.

Team workspace distribution and external-client installation need separate verification. GitHub visibility does not grant ChatGPT workspace permissions or publish a listing in the official plugin directory. This package runs locally; it does not provide the backlogged web experience.

## Import into AIWP

1. Keep the original export and review the helper's included, omitted, and quarantined item counts.
2. Confirm with the AIWP administrator that ChatGPT import is deployed and the database supports transactions.
3. In the intended AIWP account, open **Settings → Data controls → Import from ChatGPT** and select the generated bundle JSON. Do not use **Import from Claude** or the generic conversation importer.
4. Review the preview and selected items before confirming import. If the ChatGPT action is missing or the bundle is rejected, stop and check destination support.
5. Read the results and open representative imported items. Verify message content, the selected branch, links, and paused tasks before considering the migration complete. Keep originals until verification is finished.

Attachments, original project files, integrations, and skill supporting files require separate handling. Alternate chat branches are retained, but the existing AIWP branch-switching UI remains disabled. The helper never uploads data itself.

## Development and release scope

Read [the implementation plan](docs/PLAN.md) for remaining export, runtime, and distribution checks. AIWP support merged in [PR #1075](https://github.com/SMB-Team-Technology/AI-Workforce-Pro/pull/1075); that implementation repository may require team access. Use a deployment containing merge commit `8d4c7ff2ae3e7db78827238df40f973ad279424e` or its equivalent changes. There is no automatic destination capability check in this helper.

Derived from [SMB Team Technology's Claude migration plugin](https://github.com/SMB-Team-Technology/Claude-migration-plugin), version **0.7.0**, commit **79158a0ded70f654468dc0c68b5a110bb534b788**. The original MIT [license](LICENSE) is preserved; the reference repository is unchanged.

Documentation consulted on 2026-10-28:

- [OpenAI packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Porting a Claude plugin](https://developers.openai.com/plugins/guides/submit-claude-plugin)
- [ChatGPT Work execution boundaries](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview)
- [Workspace import and sync](https://learn.chatgpt.com/docs/enterprise/plugin-management)

## Category questionnaire

Selecting the migration skill calls `choose_migration_categories` from the packaged `migration-questionnaire` MCP server. Root `mcp.json` launches Node with `${PLUGIN_ROOT}`; no dependency installation, API key, listening port, or remote server is required. The form shows all six categories independently with Select all, Clear, and Continue. Nothing is selected initially. Continue validates a nonempty category list and sends the chosen IDs back to the chat for the remaining questions. The form never reads exports or starts collection.

The server has only two questionnaire tools and one fixed UI resource; it keeps no cross-chat selection state. The UI uses the MCP Apps bridge, with timeouts and retryable errors. Real ChatGPT rendering and continuation still require the installed runtime check; SDK interoperability and simulated host tests are not a substitute. If the tool is missing, onboarding reports that limitation rather than reverting to the rejected single-choice category menu.

For Git marketplace installs, refresh the marketplace, update/reinstall the plugin, and open a fresh local Work chat. Confirm the installed version matches root `plugin.json` and that the questionnaire tools are available. This does not implement the backlogged web deployment.

Implementation references: [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), [local MCP packaging](https://developers.openai.com/plugins/deploy/desktop-only), and [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Code and documentation map

| Location | Responsibility |
|---|---|
| `scripts/aiwp-migrate.mjs` | CLI commands and output path protection |
| `scripts/lib/sources/` | Export and exact-staging adapters |
| `scripts/lib/bundle.mjs` | Coverage, item selection, and bundle construction |
| `scripts/lib/validate.mjs` | Canonical category and bundle validation |
| `scripts/lib/zip.mjs`, `secrets.mjs`, `output.mjs` | Archive, credential, and publication safeguards |
| `scripts/lib/metadata.mjs` | Runtime identity from package.json |
| `scripts/questionnaire-server.mjs`, `ui/categories.html` | Local MCP tools and embedded category form |
| `skills/migrate/SKILL.md` | Guided workflow instructions |
| `test/` | Synthetic tests; no customer exports |
| [Bundle contract](docs/bundle-format.md) | Schema, staging examples, limits |
| [Checkpoint](docs/CHECKPOINT.md) / [review history](docs/review-history.md) | Current evidence / historical reviews |
| [Plan](docs/PLAN.md) | Remaining plugin work, web backlog, destination verification |

Before shipping a changed package, keep `package.json` and `plugin.json` versions aligned, run `npm test`, and complete the relevant installed-runtime checks. Runtime version reporting follows `package.json`. Keep private exports outside this repository.
