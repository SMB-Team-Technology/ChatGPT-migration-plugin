# ChatGPT migration plugin — local pilot

Prepare selected ChatGPT data for a future **AI Workforce Pro (AIWP)** importer. The workflow follows the Claude migration plugin: choose categories, collect exact inputs, review coverage, select items, and build one bundle.

**This is a local development pilot. The inspected AIWP importer accepts Claude bundles; support for this ChatGPT format has not been implemented or verified in this milestone. Do not upload a generated bundle to production or relabel it as a Claude bundle.** Package discovery and helper execution inside ChatGPT Work remain unverified until the [runtime smoke test](docs/runtime-test.md) is completed. A successful CLI run is not that test.

## What is implemented

- A deterministic Node helper for `doctor`, `scan`, `build`, and `validate`.
- Explicit ChatGPT conversation JSON, ZIP, or extracted-directory inputs, with graph-aware normalization.
- Optional exact staged records for projects, conversations, memories, skills, scheduled tasks, and artifacts.
- Selection, credential-pattern exclusions, coverage reporting, and local bundle creation.
- A portable plugin manifest, local marketplace catalog, and migration skill for the proposed ChatGPT Work desktop runtime.

There is no account-wide harvesting, hosted service, automatic browser download, or API-key requirement. The helper uses files you identify. It does not upload the bundle. Local execution does not establish that the surrounding ChatGPT conversation stays exclusively on the device.

## Quick local check

Requires Node 20 or newer. There are no npm dependencies to install.

```sh
cd /path/to/ChatGPT-migration-plugin
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

This repository includes `.agents/plugins/marketplace.json`; its `./` source is relative to the repository root. Where the current CLI is available, register this local source with:

```sh
codex plugin marketplace add /path/to/ChatGPT-migration-plugin
```

Then restart ChatGPT desktop, find **SMB ChatGPT migration pilot** in the Plugins Directory, install it, and start a new Work chat. Select the installed migration skill and run the [synthetic runtime test](docs/runtime-test.md). Registration changes local plugin configuration; it is a manual test step, not something this build performs.

Installed packages may be cached. After source changes, refresh the marketplace and confirm the installed version and helper behavior. Stop if the surface does not expose local package resources or shell access.

Team workspace import and external-client distribution are separate release checks. No remote repository, workspace installation, or public plugin submission is created by this local build.

## Development and release scope

Read [the implementation plan](docs/PLAN.md) for pending AIWP import, identity, retry, deployment, and distribution work. A distinct `chatgpt-migration-bundle` requires corresponding AIWP support.

Derived from [SMB Team Technology's Claude migration plugin](https://github.com/SMB-Team-Technology/Claude-migration-plugin), version **0.7.0**, commit **79158a0ded70f654468dc0c68b5a110bb534b788**. The original MIT [license](LICENSE) is preserved; the reference repository is unchanged.

Documentation consulted on 2026-10-28:

- [OpenAI packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Porting a Claude plugin](https://developers.openai.com/plugins/guides/submit-claude-plugin)
- [ChatGPT Work execution boundaries](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview)
- [Workspace import and sync](https://learn.chatgpt.com/docs/enterprise/plugin-management)
