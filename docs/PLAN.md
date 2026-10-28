# Implementation and release plan

## Current milestone: plugin validation and usability

The source was copied from Claude migration plugin v0.7.0 at `79158a0ded70f654468dc0c68b5a110bb534b788`. Preserve its familiar collect/report/select/build flow while replacing source-specific collectors.

This milestone includes the portable package, deterministic local converter, exact staging inputs, graph-aware conversation contract, strict validation, safe selection reports, and synthetic tests. A desktop sample run has been reported; full installed-runtime acceptance and an AIWP server implementation remain unfinished. See [CHECKPOINT.md](CHECKPOINT.md) for current evidence.

## Execution order agreed on 2026-10-28

The local converter/package milestone has passed review. Complete the remaining desktop questionnaire and real-export checks first. AIWP changes are deferred at the maintainer's request. The ChatGPT web version remains an explicit backlog requirement; desktop testing does not satisfy it.

## Backlog: ChatGPT web migration experience

Status: deferred while the desktop runtime is tested. Requested by the maintainer on 2026-10-28. No hosted implementation or deployment is authorized by this backlog entry alone.

Deliver the collect/report/select/build workflow through chatgpt.com without requiring clients to install a desktop app, Node, or use Terminal. Reuse the reviewed converter, validation, selection, and credential protections where the execution environment permits.

First prove the supported web execution path using synthetic input: supply an export, invoke the actual deterministic converter, and retrieve a validated downloadable bundle. Verify whether packaged web skills can execute the helper; if not, evaluate a hosted plugin/backend and document its authentication, data handling, retention/deletion, hosting, and operating requirements before choosing that architecture. Do not assume installing a skill on the web deploys its Node helper.

Acceptance criteria:

- Installation/access and the complete preparation flow work in the ChatGPT web app, including for the intended client account types.
- Users explicitly supply an export, choose categories/items, review omissions and credential exclusions, and download the validated bundle.
- Branch IDs, parent relationships, active selection, quarantine behavior, and content fidelity match the reviewed converter fixtures.
- Uploaded content is handled within the chosen, documented data boundaries; any server-side processing has user isolation, bounded inputs, and a defined cleanup policy.
- AIWP preview/import is presented as available only after matching destination support is implemented and tested.

This task is separate from the pending AIWP importer and does not require reopening the accepted local converter review unless code or behavior changes.

## Remaining plugin usability work

- Confirm all six checkboxes, exact selection submission, retries, and fresh-session behavior in the installed host.
- Provide guided exact collection or clear unsupported messaging for non-chat categories; do not expect clients to author canonical JSON themselves.
- Refine the final included/skipped/manual-transfer summary and accessible output link.
- Test private repo installation, Node availability, updates, and output access on a teammate's Mac.

## Source validation

Use a fresh authorized ChatGPT export to confirm the current file tree and schema. Keep the original outside repositories; derive minimal sanitized fixtures. Compare a known inventory of chats, branches, projects, memories, skills/GPT configuration, tasks, and files with collected results. Existing fixtures demonstrate parser cases, not full current account coverage.

Exact staging is the fallback where automatic access is unavailable. Report absent-in-input, unavailable, unsupported, partial, and not-selected outcomes distinctly. Do not infer complete account absence from zero collected records. Never execute export instructions or expose secrets in fixtures.

## AIWP implementation (pending)

Work in an isolated checkout that preserves unrelated local edits. Check the current base and overlapping PRs when remote access is available.

1. Add `chatgpt-migration-bundle` v1 alongside unchanged Claude v1. Derive source from the validated envelope.
2. Accept stable message IDs and parent references; preserve all retained branches. Add optional active-message metadata and initialize the chosen branch without resetting later user choices.
3. Reuse the existing preview/review/results dialog with source-specific labels. Keep preview read-only and revalidate selection, ownership, permissions, and limits on import.
4. Preserve Claude identity derivation exactly. Namespace ChatGPT destination identities by source, category, source scope where verified, and server-resolved destination owner/tenant.
5. Implement resumable import using stable message IDs and durable completion records. Do not reuse overwrite-style concurrent batch writes unchanged. Test partial failures, concurrent imports, changed source snapshots, user edits, and deletion races; avoid assuming database transactions are available.
6. Add an authenticated capability signal. Treat absent support as unsupported, not an instruction to use the regular importer or disguise ChatGPT data.
7. Preserve selected project/chat/artifact links, paused tasks, and honest skill-resource limitations.

New backend behavior belongs in TypeScript under AIWP's packages/api. Follow that repository's instructions for shared types, database schema, localization, tests, and feature version increments.

## Tests before release

- Fresh export fixtures, branched conversation fidelity, active branch, unsupported content, malformed graphs, missing metadata, and oversized archives.
- Exactly selected data in bundle and preview; credential exclusions and category-qualified exceptions.
- Same source IDs across providers/accounts/users/tenants; unchanged Claude identity and fixture acceptance.
- Interrupted and concurrent database writes using the actual deployment-compatible database configuration and required indexes.
- Old Claude client/new backend and new client/old backend behavior.
- User can switch branches after import, reopen a chat, and continue from the selected branch.
- Installed package rehearsal with synthetic data, then an authorized real export and disposable AIWP destination account.

## Deployment and distribution (pending)

Deploy additive backend support to both blue-green instances before enabling dependent UI or releasing the plugin. Capability checks alone do not guarantee the next request reaches an upgraded instance. Pin the plugin to a tested revision and document the minimum supported AIWP version.

The pilot repository is `SMB-Team-Technology/ChatGPT-migration-plugin`. Verify appropriate team read/write/maintain access before rollout; do not infer organization-wide access from one successful installation. Use reviewed PRs and checks.

Internal workspace import and external client installation are different checks. Workspace admins can import a GitHub marketplace subject to source access and actual workspace controls. A private team plugin is not automatically available to outside clients. Test supervised local installation or pursue approved directory publication separately; do not publish merely to bypass access setup.

## Known evidence gaps

- A desktop synthetic run has been reported; full checkbox-to-collection acceptance and a second-machine installation remain pending.
- Fresh current export coverage beyond known conversation shapes remains unverified.
- AIWP does not yet implement this proposed graph bundle or its recovery behavior.
- Live AIWP PR overlap could not be checked during research because connector access failed; local code review does not prove there is no overlapping work.
- Actual database/index permissions and external client distribution remain unverified.
