# HAKBa

A VS Code extension for Human-AI Knowledge Bases. Manage human-approved Knowledge separately from external information and AI drafts.

## Features

- Repository-relative wiki links: `[[path/to/file.md]]` and `[[path|label]]`
- File path completion that respects Git ignore rules
- Command/Ctrl+click to open Markdown, CSV, images, and other existing files
- Missing wiki links shown in the theme’s warning color with a warning underline; updates when files are created or deleted
- Create missing Markdown files with category-specific templates
- Initialize Spaces and create child Spaces or classified Markdown files
- Explicitly approve Knowledge (`draft: false`)
- Display Git creation and update dates with CodeLens

## Quick start

1. Open a Git repository in VS Code and trust the workspace.
2. Run `HAKBa: Initialize Repository`.
3. Run `HAKBa: Create Child Space` or `HAKBa: Create Classified Markdown`.
4. Enter `[[_knowledges/example.md]]` in Markdown and Command/Ctrl+click to create it.

Each Space has an `_index.md` and classifies information into `_contexts/`, `_sources/`, `_knowledges/`, and `_outputs/`. Child Space names receive a local-date `yymmdd_` prefix.

Links use paths relative to the Git root, including extensions. Existing files of any format open in VS Code; only missing `.md` files can be created. Trigger completion with Ctrl+Space.

New Knowledge starts with `draft: true`. After reviewing it, use `HAKBa: Approve Current Knowledge`. Manual edits preserve approval status. Use the toolkit’s HAKBa agent skill to mark AI edits as drafts.

## Requirements and limits

Requires VS Code 1.95+, Git, and a trusted file workspace. Git dates require CodeLens and use committer timestamps from current HEAD history. Renames are followed; shallow clones indicate limited history. Uncommitted changes do not change dates.

Works in the Markdown source editor. Heading links, preview rendering, Git-root resolution for standard Markdown links, and automatic link updates after renames are not included. The extension does not identify AI edits or enforce reference boundaries.

License: MIT
