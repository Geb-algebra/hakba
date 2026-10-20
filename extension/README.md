# HAKBa

A VS Code extension for Human-AI Knowledge Bases. Manage human-approved Knowledge separately from external information and AI drafts.

## Features

- Repository-relative wiki links: `[[path/to/file.md]]` and `[[path|label]]`
- Shared directory prefixes in wiki links use the theme’s CodeLens color, emphasizing the path below the nearest common parent (aliases stay unchanged)
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

Each Space has an `_index.md` and classifies information into `_contexts/`, `_sources/`, `_knowledges/`, and `_outputs/`. Child Space names receive a local-date `yymmdd_` prefix. Source and Output allow duplicate information and use acquisition/creation dates in `yymmdd_name.ext` filenames. Create Classified Markdown adds the prefix to the basename, including within subdirectories, unless already present. Context and Knowledge filenames remain undated. Link-based creation preserves the exact target path; include the date yourself for Source and Output.

Links use paths relative to the Git root, including extensions. Existing files of any format open in VS Code; only missing `.md` files can be created. Trigger completion with Ctrl+Space.

Place new Knowledge in the highest ancestor Space where its content is valid and useful, considering parents, grandparents, and all further ancestors. Use the root for generally useful knowledge and the current Space for knowledge valid only under its specific premises. Create Classified Markdown offers the current and ancestor Spaces, highest first. For link-based creation, specify that Space in the link target. The extension preserves the exact path and does not judge usefulness automatically.

The active file identifies the working Space, but does not determine where Knowledge belongs: always reconsider ancestor placement. When general knowledge and case-specific material coexist, split out coherent portions that can be generalized and have reusable value, placing the general Knowledge in the highest valid and useful ancestor Space. Line-by-line fragmentation is not required. The extension provides placement guidance; content assessment and splitting remain with the author or agent skill.

New Knowledge starts with `draft: true`. After reviewing it, use `HAKBa: Approve Current Knowledge`. Manual edits preserve approval status. Use the toolkit’s HAKBa agent skill to mark AI edits as drafts.

## Requirements and limits

Requires VS Code 1.95+, Git, and a trusted file workspace. Git dates require CodeLens and use committer timestamps from current HEAD history. Renames are followed; shallow clones indicate limited history. Uncommitted changes do not change dates.

Works in the Markdown source editor. Heading links, preview rendering, Git-root resolution for standard Markdown links, and automatic link updates after renames are not included. The extension does not identify AI edits or enforce reference boundaries.

License: MIT
