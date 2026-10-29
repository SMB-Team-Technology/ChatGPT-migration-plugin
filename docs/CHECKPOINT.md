# Current checkpoint — 2026-10-28

Current package version: **0.1.5** (destination guidance update; installed runtime evidence below is from 0.1.3). The plugin is distributed through the [team repository](https://github.com/SMB-Team-Technology/ChatGPT-migration-plugin). Read [README](../README.md) for setup, [runtime-test.md](runtime-test.md) for acceptance checks, and [PLAN.md](PLAN.md) for remaining work. Earlier findings and review decisions are preserved in [review-history.md](review-history.md).

## Working implementation

- JSON, ZIP, and directory conversation export parsing with preserved supported branches and active-message selection.
- Exact staging for all six categories; non-chat collection is not automatic.
- Per-chat quarantine, omission reporting, content-bound selection, credential exclusions, and strict bundle validation.
- Private non-overwriting local output, with exclusive-copy fallback where hard links are unavailable.
- Embedded category checkbox form, local MCP server, and guided migration skill.

## Evidence and its limits

| Check | Evidence | Remaining limit |
|---|---|---|
| Local automated suite | 76 tests passed, including the 0.1.5 publication-preparation run on Node 24.22.1 | Node 20 has not been exercised separately |
| Independent converter review | Accepted with no blockers; L4 deferred | Review predates the custom questionnaire implementation |
| MCP integration | Standard SDK client discovers tools and reads UI resource; packaged launcher test passes | Not equivalent to complete host UI acceptance |
| Desktop installation | Version 0.1.3 skill installed; questionnaire tools became available in the active tool inventory | Checkbox rendering, Continue, and subsequent question flow still need explicit confirmation |
| Installed sample run | A tester supplied a screenshot reporting a created, validated synthetic bundle and showing the output file | Output contents and overwrite refusal were not independently checked from that screenshot |
| Real export | Waiting for the export email | Current real-export layout and completeness remain unverified |
| Manual-staging rehearsal | Independently compared the user-produced demo bundle to both original synthetic transcripts: 2 conversations, 10 exact message bodies, correct roles and linear parent links; local validation passed; no inferred timestamps or active branch | Tests synthetic manual staging, not real account data, export parsing, or destination import |
| AIWP import | PR #1075 merged; synthetic browser rehearsal covered preview, six categories, retries, Claude compatibility, branches and continuation. On tested AIWP main `079b84fd8`, 795 targeted tests, four shared-package type checks and the frontend production build passed | Full repository suites on that main revision, real-export import, real-provider rehearsal and production MongoDB topology remain unverified |

## Known limits

- Non-chat categories need exact supplied records; clients do not yet have a finished guided collection experience for them.
- Non-conversation staged categories retain strict category-level validation (review finding L4, intentionally deferred).
- Actual exFAT/SMB behavior and abrupt termination during fallback copying remain untested. Copy publication and cleanup are not atomic.
- Browser visual tests could not run in this development session; UI tests use a simulated DOM/host.
- The Python skill validator requires PyYAML, absent here. This does not affect the Node helper.
- Team-member installation, external-client access, and web deployment remain unverified.

## Next plugin checks

1. Complete the checkbox acceptance checks in the runtime protocol.
2. Rehearse against an explicitly selected real export without uploading or importing it.
3. Improve guided non-chat collection and the results handoff.
4. Repeat installation on a teammate's machine.

AIWP importer support is implemented. Confirm that the destination has the merged support and MongoDB transactions before client use. The web experience remains backlogged. Public repository availability does not establish external-client runtime compatibility.
