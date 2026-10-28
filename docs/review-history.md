# Review history

Historical evidence and decisions from development on 2026-10-28. Version-specific instructions below are archival, not current setup instructions. See [CHECKPOINT.md](CHECKPOINT.md) for current status.

## Implemented

- Distinct ChatGPT bundle and package identities; no relabeling as Claude.
- Explicit JSON/ZIP/directory export adapter preserving supported message branches, parent IDs, and active-message selection.
- Six-category canonical staging; unselected sources are not read.
- Global and per-conversation coverage reports, including quarantine, source record positions, optional redacted titles, and omission counts.
- Content-bound selection keys, item-specific credential exceptions, and linked-record exclusions.
- Strict graph/category validation, bounded archive handling, and private non-overwriting bundle output outside repositories/package roots.
- Portable manifest, local marketplace catalog, migration skill, source attribution, and runtime test protocol.

## Verification performed

- `npm test`: **68 passed, 0 failed**, Node 24.22.1 on macOS.
- Independent synthetic skill rehearsal: one chat, three retained messages, both answer branches, active branch, Unicode/text preservation, bundle validation, and overwrite refusal.
- Copied helper runs from an unrelated working directory without relying on the original checkout.
- Package/catalog versions and references, skill helper path, minimal frontmatter, and whitespace checks passed.
- Existing AIWP compatibility fixtures: standard conversation and branching examples parse. The partial citation example has a dangling parent; that record is now quarantined without blocking valid neighbors. Citation metadata restoration is not implemented.
- Independent review identified stale credential approval and blocking FIFO-read defects. Both were corrected with regression coverage. Visually hidden messages and null recipients also have regression tests.
- A final independent read-only review of credential scanning, quarantine/reporting, and fatal-input boundaries found no remaining concrete blockers for the local CLI/package milestone; its focused checks passed 12/12 tests.

## Second review fixes

| Finding | Change and regression coverage |
|---|---|
| B1: multiline credentials escaped detection | Scan individual raw string values, not JSON serialization. Newline, tab, and carriage-return cases cover all six credential families, title redaction, and item-specific approval. |
| B2: one bad chat blocks an export | Normalize and validate each chat separately; quarantine malformed graphs, overlong titles/messages, and over-limit message counts. Valid neighbors build; all-rejected input cannot produce an empty successful bundle. Invalid dates are omitted and reported. Source content is not truncated. |
| N1: unrelated export folders merged | Reject multiple folders containing conversation payloads for ZIP and directory inputs; allow split payloads within one folder. This does not prove account identity. |
| N2: omissions cannot be identified | Report accepted/quarantined/omitted counts, source kind and record position, optional redacted/capped titles, and per-reason counters. |
| N3: Canvas omitted generically | Report Canvas tool messages explicitly; exact document content requires separate artifact staging. |
| N4: missing user turn creates misleading adjacency | Report `user_turn_gaps` and a conversation warning; no invented placeholder text. |
| N5: duplicate staging behavior unclear | Give a specific duplicate-source error and document that staging supplements, never replaces, export records. |
| N6: hard links unavailable | Fall back to exclusive copying for supported link-failure codes. Injected failure, overwrite, symlink, concurrent-write, and local permission tests pass. Actual exFAT/SMB execution remains untested; fallback copying is not atomic. |

The Node 20 minimum is the implementation target; this environment ran Node 24, not a separate Node 20 runtime. The bundled Python skill validator could not run because PyYAML is absent; minimal frontmatter/reference checks and the functional skill rehearsal were used instead.

## Third review follow-up

The external re-review confirmed B1/B2 and N1–N6 and accepted the local converter/package milestone. Follow-up changes:

- **L1 fixed:** the copy fallback now opens the output exclusively before writing so ownership is known. Copy/read failures clean up this run's incomplete file; existing files, symlinks, and detected replacement files are preserved. Regression tests cover partial writes, source read failure, retries, concurrent publication, and copying multiple chunks. Abrupt process termination and actual exFAT/SMB operation remain unverified.
- **L2 fixed:** directory and ZIP inputs reject a whole `conversations.json` alongside numbered split files, including mixed-case names, before parsing them. Whole-only, split-only, and explicitly selected JSON inputs still work.
- **L3 fixed:** when no selected data remains and conversations were quarantined or omitted, the build error gives those counts and directs the user to `scan` with the same inputs/categories. No output file is created.
- **L4 deferred as recommended:** non-conversation staged categories retain documented strict category-level validation. Per-item quarantine for those categories is not required for this milestone.

## Final external review acceptance

The final read-only re-review supplied by the maintainer on 2026-10-28 confirmed L1–L3, reported no new findings, and accepted the local converter/package milestone. The reviewer reran probes Q1, Q3, and Q6 against fresh synthetic temporary inputs, passed 52/52 affected tests and 68/68 full-suite tests on Node 24.22.1, and confirmed that the Claude reference and unrelated AIWP changes were untouched. L4 remains deferred. This closes the current converter review cycle; it does not establish installed ChatGPT execution or destination compatibility.

## Not verified or implemented

- Installation or execution inside an actual ChatGPT Work session.
- A fresh current customer export and all-account/category completeness.
- Matching AIWP importer, active-branch rendering, identity/recovery changes, or production acceptance.
- Team/private workspace installation or external-client distribution.

The reference Claude repository remains clean at `79158a0ded70f654468dc0c68b5a110bb534b788`. This build did not modify AIWP, install plugins globally, upload account data, or create a remote repository.

## Next milestones

1. Run the installed ChatGPT Work synthetic rehearsal in [runtime-test.md](runtime-test.md). Confirm discovery, installed helper/resource paths, local Node execution, branch fidelity, output access, and overwrite refusal. Record failures rather than substituting a generated helper or treating terminal success as installed-runtime success.
2. Rehearse with an explicitly selected, sanitized current ChatGPT export. Check actual source layout and content coverage; synthetic fixtures do not establish these.
3. Implement the matching AIWP importer, graph preservation/rendering, ownership isolation, and retry/recovery behavior described in [PLAN.md](PLAN.md), then verify destination behavior before production use.

Reopen converter review for new changes or concrete failures, rather than repeating the completed review without new evidence.

## Guided onboarding update — 0.1.1

Audited the reference Claude skill: category multi-selection, web/desktop/both source context, and all/choose/none item selection are instruction-driven, with the host providing question UI. The ChatGPT skill now explicitly requests native choice tools, starts on selection without a custom prompt, and adapts multi-selection to single-select hosts. Source/account/export questions are progressive; unsupported category collection and pending AIWP import remain explicit. No Claude collectors were copied.

Installed UI acceptance remains pending: refresh/reinstall version 0.1.1, open a fresh chat, select migrate without additional text, and confirm native question cards appear. Check Chats only, Choose categories, and Try the sample first; verify answers carry forward and no private source is read before selection. If native choice tools are unavailable, the skill discloses this and uses one short question at a time. This is not a custom embedded form or proof of identical Claude checkbox rendering.

## Embedded multi-select implementation — 0.1.2

Replaced the single-choice category fallback with an MCP Apps checkbox form. Added root `mcp.json`, a bounded dependency-free stdio server, and a self-contained HTML resource. The skill opens the form and consumes its submitted category IDs before continuing. Six categories, Select all, Clear, nonempty Continue, retryable errors, no source reads, and no persisted cross-chat state are implemented. Other single-choice onboarding questions remain native.

Validation: seven new tests cover all 63 nonempty subsets, invalid/duplicate input, no initial selection, all/clear/subset UI behavior, validation/message failure retention, unknown tools/resources, and protocol initialization. The existing SDK 1.29.0 client successfully initialized, discovered both tools, confirmed a subset, and read the UI resource from an unrelated working directory. UI event tests use a simulated DOM/host. Browser rendering could not be exercised: the bundled test browser was absent and the installed browser could not launch in this session. Native ChatGPT rendering, permissions, and automatic continuation remain pending the runtime acceptance check. No personal export or destination import was used.

Full suite after the 0.1.2 implementation: **75 passed, 0 failed** on Node 24.22.1. The seven questionnaire tests also pass after formatting.

## Installed discovery failure — 0.1.3

The user reported that the 0.1.2 skill and helper loaded but `choose_migration_categories` was unavailable. The installed source matches the repository; plugin settings report installed/enabled. Found and corrected a concrete packaging defect: root `mcp.json` omitted the mandatory `$schema` property required by the Agent Plugins 1.0.0 MCP schema. Added regression coverage that checks that declaration and launches the server through the actual configured command/arguments/cwd, then discovers the questionnaire tool. This proves local configuration execution, not the host's plugin-loader behavior. Installed ChatGPT tool discovery and embedded UI rendering must still be verified; no log evidence establishes that this omission was the sole cause.
