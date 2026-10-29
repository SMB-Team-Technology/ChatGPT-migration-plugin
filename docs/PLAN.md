# Implementation and release plan

## Implemented

The desktop package follows the Claude migration collect/report/select/build workflow. It includes a deterministic converter, exact staging inputs, graph-aware conversation contract, validation, credential exclusions, and an embedded category questionnaire. See [CHECKPOINT.md](CHECKPOINT.md) for evidence and limits.

AIWP ChatGPT import support merged in PR #1075 (merge commit `8d4c7ff2ae3e7db78827238df40f973ad279424e`). It reuses the Claude preview/selection/results flow, preserves chat graph relationships and selected branches, isolates source and destination owners, and uses transactions for ChatGPT chat imports. Synthetic browser rehearsals exercised retries, continuation, all six categories, and existing Claude import. No automatic destination capability check is implemented in this plugin.

## Before client rollout

1. Confirm the intended AIWP deployment includes ChatGPT import and its MongoDB topology supports transactions (replica set or compatible cluster).
2. Finish the installed questionnaire acceptance checks in [runtime-test.md](runtime-test.md): all six checkboxes, exact submitted selection, retries, keyboard access, and fresh-session behavior.
3. Rehearse with a current, explicitly authorized real export. Compare known source chats, branches, and selected records with the bundle and destination. Keep originals and private data outside repositories. Existing synthetic fixtures do not establish complete real-account coverage.
4. Test installation, Node availability, updates, and output access from a fresh external-client account. Public GitHub access does not guarantee host workspace permissions or plugin availability.
5. Improve guided exact collection for non-chat categories. Do not require clients to guess canonical records or present model-generated memories as saved data.

Attachments, original project files, integrations, and skill supporting files still require separate handling. Retained alternate branches cannot currently be switched through AIWP's disabled forking UI. A successful local validation is not a completed migration.

## Public distribution

Distribute the desktop package from the GitHub marketplace catalog. Preserve the MIT license and Claude attribution. Review tracked files and reachable Git history before making the repository public; previous commits remain visible after ordinary cleanup commits. Public visibility is separate from official directory listing, hosted web deployment, and production certification.

Keep package and plugin versions aligned and run the automated suite before publishing an update. Document the exact revision used for installed-runtime and destination rehearsals. The `private` field in package.json prevents accidental npm publication; it does not control GitHub visibility.

## Backlog: ChatGPT web migration experience

Provide the same collect/report/select/build workflow through chatgpt.com without requiring a desktop app, Node, or Terminal. No hosted implementation is included in this package.

First prove a supported web execution path with synthetic input: supply an export, run the actual deterministic converter, and retrieve a validated bundle. If local packaging cannot support this, evaluate a hosted service and document authentication, user isolation, bounded inputs, retention/deletion, hosting and operating requirements before choosing that architecture. Installing a skill does not deploy its Node helper.

Acceptance criteria:

- Complete preparation works in the web app for intended client account types.
- Users supply an export, select categories/items, review omissions and credential exclusions, and download a validated bundle.
- IDs, parent links, active selection, quarantine behavior, and content fidelity match converter fixtures.
- Data boundaries and any server-side cleanup policy are documented and verified.
- Destination preview/import is offered only for a compatible AIWP deployment.

This backlog does not authorize deploying a service or collecting private exports.
