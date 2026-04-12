# .squan/

This directory contains Squan project state — tasks, documentation, charters, and templates.

Everything here is version-controlled. Changes show up in git history and PR diffs.

## Structure

- `config.yaml` — Project configuration and agent roles
- `board/` — Kanban board (tasks organized by status directory)
- `charters/` — Accumulated agent knowledge per role
- `templates/` — Reusable task templates
- `docs/` — Project documentation
- `security/` — Security reviews and audit trail

## Task format

Each task is a markdown file with YAML frontmatter:

```markdown
---
id: "001"
title: Task title
status: open
type: ai
priority: high
---

## Description
What needs to be done...
```

Moving a task = moving its file between status directories.
`git log .squan/board/` shows the full board history.
