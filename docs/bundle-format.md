# ChatGPT migration pilot contract (v1)

**This v1 contract is implemented by the local helper and the AIWP ChatGPT importer merged in PR #1075.** A destination must have that support deployed; local validation does not check deployment or database transaction support. Keep it distinct from the Claude bundle. Validation here establishes structural consistency only.

The validator in `scripts/lib/validate.mjs` is the local authority. Unknown fields are rejected rather than silently discarded.

## Envelope and graph

```json
{
  "format": "chatgpt-migration-bundle",
  "version": 1,
  "createdAt": "2026-10-28T12:00:00.000Z",
  "generator": { "name": "chatgpt-migration-plugin", "version": "0.1.5" },
  "migrationWarnings": ["Destination import has not been verified."],
  "conversations": [
    {
      "id": "source-conversation",
      "title": "Synthetic example",
      "activeMessageId": "assistant-b",
      "messages": [
        { "id": "user-a", "parentId": null, "role": "user", "text": "A test question." },
        { "id": "assistant-a", "parentId": "user-a", "role": "assistant", "text": "First answer." },
        { "id": "assistant-b", "parentId": "user-a", "role": "assistant", "text": "Alternate answer." }
      ]
    }
  ]
}
```

Each category is optional; a bundle must contain at least one selected item. Source item IDs must be nonblank strings, unique within their category, and no more than 300 characters. Message IDs are unique within their conversation. Every `parentId` is null or refers to a retained message in that conversation. Cycles and dangling references are invalid. `activeMessageId`, when supplied, references a retained message.

Conversations may have `createdAt`, `updatedAt`, and `projectId`. Messages may have `createdAt` and assistant-only visible `thinking`. Dates must be valid ISO timestamps with timezone. A message must have nonblank text or visible thinking. This does not authorize recovering hidden model reasoning.

The export adapter bridges excluded message nodes to retained parents and reports omissions. Do not infer project membership from `gizmo_id`, conversation titles, or folder names. A linked project must be included in the same bundle. An artifact's optional `conversationId` must likewise reference an included conversation.

## Collection and omission reports

For ZIP and directory inputs, conversation payload files must belong to exactly one folder. Supply either the whole `conversations.json` payload or numbered `conversations-NNN.json` split files in that folder. A mixture of whole and split payloads, or more than one conversation folder, is rejected before payload parsing; this layout check cannot establish that files belong to the same account.

Each exported or staged conversation is normalized/validated independently. Malformed graphs and records exceeding per-conversation limits are quarantined, while valid neighbors remain available for selection. Invalid export timestamps are omitted with a warning. No source title or message is silently truncated. Invalid JSON, unknown export shapes, duplicate identities, ambiguous export roots, and aggregate/input resource limits remain fatal. The final bundle still passes the full strict validator.

Scan coverage includes `conversationCounts` for source records, accepted, quarantined, and omitted conversations. `conversationIssues` contains an opaque `sourceKey`, source kind and one-based record index, status, fixed reason when rejected, warnings, and omission counts. Accepted partial records also have their content-bound `selectionKey`. Quarantined records are already excluded and have no selection key. With `--show-titles`, issue titles are revealed except for detected credentials; report titles alone are capped at 300 characters with `titleTruncated` when applicable.

Per-conversation `omissions` counts explain affected content, including Canvas tool messages, unsupported content, and omitted user turns. Counts can overlap and include metadata events; do not sum them as a unique count of omitted messages. An omitted image-only user turn may bridge two assistant messages. A `user_turn_gaps` count and warning expose that gap without inventing replacement text. Canvas documents are not reconstructed from `canmore.*` calls; stage their exact content as artifacts separately. These structured details are scan reports, not new fields in the v1 bundle; the bundle retains aggregate warning text.

## Exact staging inputs

Pass `--inputs /absolute/path/to/fresh-staging-folder`. Each selected category is read from the corresponding file below. These are arrays of canonical records, not account export schemas. Only stage exact content from authorized sources. Use stable source IDs; do not regenerate positional IDs on each run.

| File | Category |
|---|---|
| `projects.json` | `projects` |
| `conversations.json` | `conversations` |
| `memories.json` | `memories` |
| `skills.json` | `skills` |
| `scheduled-tasks.json` | `scheduledTasks` |
| `artifacts.json` | `artifacts` |

Conversation staging uses the graph shape above. Other canonical item examples:

```json
{
  "projects": [
    { "id": "project-1", "name": "Example", "description": "Exact description", "instructions": "Exact instructions", "context": "" }
  ],
  "memories": [
    { "id": "memory-1", "value": "Exact saved memory text", "key": "optional-topic" }
  ],
  "skills": [
    { "id": "skill-1", "name": "example-skill", "description": "When to use it", "content": "---\nname: example-skill\ndescription: An example\n---\nExact instructions", "files": [] }
  ],
  "scheduledTasks": [
    { "id": "task-1", "name": "Example reminder", "prompt": "Exact task prompt", "scheduleType": "recurring", "cron": "0 8 * * 1-5", "timezone": "America/Los_Angeles", "enabled": false }
  ],
  "artifacts": [
    { "id": "artifact-1", "title": "Example note", "type": "text/markdown", "content": "Exact artifact content" }
  ]
}
```

The object above groups examples for readability. Each staging file contains **only its array**, not this wrapper object.

Staged conversations supplement exported conversations; they never replace them. Duplicate IDs within or across supplied conversation sources stop collection, including IDs belonging to quarantined export records. Supply each conversation once. Other staging categories retain strict category-level validation.

Project `description` is optional; `instructions` and `context` are required strings and may be empty. Memory `key` is optional. Skill `description` is required; optional `files` entries have a safe relative `path` and text `content`. No absolute paths, traversal, backslashes, or duplicate resource paths.

Tasks must have `enabled: false`. A one-time task uses `scheduleType: "once"` with `runAt` instead of `cron`. Recurring tasks accept only five numeric cron fields and a supported timezone. RRULE, event triggers, retained-chat context, and automatic schedule translation are not supported. Do not approximate them silently.

Artifacts may also contain `language`, `conversationId`, and `createdAt`. Providing HTML or executable-looking text records content only; it must never be executed during collection.

## Pilot limits

The complete serialized bundle is limited to **25 MiB**. Limits reject oversized inputs rather than silently truncating them.

| Field/category | Limit |
|---|---|
| Projects / conversations | 1,000 / 10,000 items |
| Memories / skills / tasks / artifacts | 500 / 200 / 100 / 1,000 items |
| Messages per conversation | 5,000 |
| Message text or visible thinking | 500,000 characters each |
| Project name / task name | 128 characters |
| Project description/instructions/context and task prompt | 100,000 characters each |
| Conversation/artifact title | 300 characters |
| Skill name / description | 200 / 2,000 characters |
| Memory value, skill content/resource content, artifact content | 1,000,000 characters each |
| Skill supporting files | 50; path up to 500 characters |
| Bundle warnings | 1,000; each up to 2,000 characters |

These bounds are the pilot contract, not a promise about every destination deployment. The destination importer validates its own limits and graph semantics.

## Local output

Output uses a private temporary file and refuses to overwrite existing files or symlinks. Publication first attempts a hard link; when the filesystem reports unsupported linking, it creates the destination exclusively and copies into that open file. A reported copy failure removes the incomplete output after checking that it still refers to the file this run created. Cleanup failures are reported explicitly. That identity check and removal are not atomic against external path replacement. The copy fallback is also not atomic: abrupt process termination can still leave an incomplete destination. Validate a completed file before using it. Permissions are `0600` on supported filesystems; actual exFAT/SMB permissions and behavior have not been tested in this pilot.

## Compatibility and changes

Keep source IDs in the file for graph and relationship mapping; derive destination identities on the server with source/provider and owner isolation. Never put destination user or tenant authorization into the bundle. Future fields require an explicit validator change and tests. Breaking changes require a new version. Preserve existing Claude v1 acceptance in subsequent AIWP changes.
