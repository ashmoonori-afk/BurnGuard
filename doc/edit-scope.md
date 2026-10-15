# Edit scope and revision comparison

## Request contract

A user turn may include `generation.edit_scope` in the existing JSON or multipart generation options. The composer exposes this beside its model settings and passes the current selection with each send. The existing generation draft handling retains the selection; choosing `unrestricted` explicitly widens the next request. Omission means `unrestricted`; invalid modes or targets are rejected rather than widened.

```json
{
  "mode": "image_only",
  "targets": [
    { "rel_path": "index.html", "artboard_id": "p1", "node_id": "photo1" },
    { "rel_path": "index.html", "artboard_id": "p2", "node_id": "photo2" }
  ]
}
```

Targets are optional. With no targets, the chosen content restriction covers the whole artifact. Targets form a union; the fields within one target form an intersection. A node target includes descendants. Paths use project-relative URL slashes on every OS; absolute paths, backslashes, traversal and non-HTML targets are invalid. At most 64 targets are accepted.

## Publication contract

`ArtifactCoordinator.run` captures the parsed scope before mutation and stores it beside the operation snapshot. After the complete mutation, including generation review, repair, runtime provisioning and interrupted-output handling, it compares the original snapshot with the final stage. The comparison digests must match the coordinator's base and result manifests before publication begins.

- `text_only` permits normalized visible and accessible text changes inside the targets. Image sources, asset bytes, styles, scripts, element structure and other attributes must remain unchanged.
- `image_only` preserves normalized text everywhere. Only image source attributes and referenced image bytes inside the targets may change. Styles, scripts, structure and non-image assets remain unchanged. Changing an asset used by both a targeted and an untargeted placement is rejected.
- `unrestricted` records the comparison without enforcing either content restriction.

HTML text is NFC-normalized and whitespace-collapsed. Known non-visible source text is excluded from the text summary and preserved as structure. CSS-derived visibility is not evaluated; source text without an explicit hidden marker is conservatively included. Accessible text attributes such as image alt text are treated as text. Inline styles and style blocks are compared exactly; external files use the canonical manifest's SHA-256 hashes. Image source attributes include `img`, responsive sources, SVG image references and video posters. Non-image references remain structural attributes.

Artboards are recognized by `data-slide`, `data-graphic-artboard` and `data-bg-artboard`. Their `data-bg-node-id` is preferred; otherwise a declared artboard value, element ID or deterministic ordinal identifies the board. Node findings use the closest authored `data-bg-node-id` when present. Untagged changes still identify their page and kind.

An unreferenced changed image cannot be attributed to a target and is rejected in restricted modes. CSS background source edits are stylesheet edits, so they require unrestricted scope. Changing background-image bytes whose placement cannot be attributed from the HTML inventory is also rejected rather than assumed in scope. This is a conservative source contract, not a CSS layout interpreter.

Violations raise `edit_scope_violation` with typed page/artboard/node and change-kind findings. The existing rollback keeps the last committed tree and revision. Corrections or a new explicitly widened request are required; prompt text and a successful design audit cannot waive the check. A bounded `burnguard-edit-scope-v1` harness line gives the model the mode and up to four targets, with an omitted-target count. The complete scope, not that summary, is enforced.

## Comparison history

The operation writes and flushes `revision-comparison.json` outside the authored stage before committing. The existing operation retention policy owns this metadata. The history response includes the current committed comparison and the newest scope refusal, where retained receipts are available. The history dialog opens when a new comparison arrives and shows changed pages, change kinds and bounded before/after text excerpts.

There is no revision-thumbnail endpoint to reuse cheaply, so this version shows a list only. It does not produce new thumbnails, rerender historical revisions, or claim rendered equality. The sampled export-parity score remains an export diagnostic and is never used as an edit-scope equality check.

## Decision

Keep scope in the existing generation request envelope so JSON uploads, multipart uploads, generation resolution and draft persistence share one contract. Enforce it at the coordinator boundary, not in the adapter or design-review prompt, so automatic repairs and partial-output publication cannot bypass it. Reuse retained operation directories instead of adding a second revision store or a database migration.
