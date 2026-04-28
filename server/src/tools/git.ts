import { execSync } from 'child_process'
import type { ToolCategory, ToolContext, ToolResult } from './registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cmd: string, ctx: ToolContext): string {
  return execSync(`git ${cmd}`, {
    cwd: ctx.cwd,
    encoding: 'utf8',
    timeout: 30000,
  }).trim()
}

function ok(result: string): ToolResult {
  return { result: result || '(no output)', isError: false }
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err)
  return { result: msg, isError: true }
}

// ---------------------------------------------------------------------------
// Tool definitions & handlers
// ---------------------------------------------------------------------------

export const gitTools: ToolCategory = {
  name: 'git',
  description:
    'Git version control — status, diff, log, branch, commit, stash, blame, and more.',
  tools: [
    // 1. git_status --------------------------------------------------------
    {
      definition: {
        name: 'git_status',
        description:
          'Get the current git status including staged, unstaged, and untracked files.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler(_, ctx) {
        try {
          const status = git('status --porcelain=v1', ctx)
          if (!status) return ok('Working tree clean — nothing to report.')

          const staged: string[] = []
          const unstaged: string[] = []
          const untracked: string[] = []

          for (const line of status.split('\n')) {
            const x = line[0] // index
            const y = line[1] // worktree
            const file = line.slice(3)
            if (x === '?' && y === '?') {
              untracked.push(file)
            } else {
              if (x && x !== ' ' && x !== '?') staged.push(`${x} ${file}`)
              if (y && y !== ' ' && y !== '?') unstaged.push(`${y} ${file}`)
            }
          }

          const parts: string[] = []
          if (staged.length) parts.push(`Staged (${staged.length}):\n${staged.map(s => '  ' + s).join('\n')}`)
          if (unstaged.length) parts.push(`Unstaged (${unstaged.length}):\n${unstaged.map(s => '  ' + s).join('\n')}`)
          if (untracked.length) parts.push(`Untracked (${untracked.length}):\n${untracked.map(s => '  ' + s).join('\n')}`)
          return ok(parts.join('\n\n'))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 2. git_diff ----------------------------------------------------------
    {
      definition: {
        name: 'git_diff',
        description: 'Show the diff of current changes.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            staged: {
              type: 'boolean',
              description: 'Show staged (cached) diff instead of unstaged.',
              default: false,
            },
            file: {
              type: 'string',
              description: 'Limit diff to a specific file path.',
            },
            context_lines: {
              type: 'number',
              description: 'Number of context lines around changes.',
              default: 3,
            },
          },
          required: [],
        },
      },
      handler(input, ctx) {
        try {
          const staged = input.staged ? ' --cached' : ''
          const ctxLines = ` -U${input.context_lines ?? 3}`
          const file = input.file ? ` -- "${input.file}"` : ''
          return ok(git(`diff${staged}${ctxLines}${file}`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 3. git_log ------------------------------------------------------------
    {
      definition: {
        name: 'git_log',
        description: 'Show commit history.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of commits to show.',
              default: 10,
            },
            file: {
              type: 'string',
              description: 'Show history for a specific file.',
            },
            author: {
              type: 'string',
              description: 'Filter by author name or email.',
            },
            since: {
              type: 'string',
              description: 'Show commits since this date (e.g. "2024-01-01").',
            },
          },
          required: [],
        },
      },
      handler(input, ctx) {
        try {
          const n = input.count ?? 10
          let cmd = `log -n ${n} --pretty=format:"%h %ad %an | %s" --date=short`
          if (input.author) cmd += ` --author="${input.author}"`
          if (input.since) cmd += ` --since="${input.since}"`
          if (input.file) cmd += ` -- "${input.file}"`
          return ok(git(cmd, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 4. git_branch --------------------------------------------------------
    {
      definition: {
        name: 'git_branch',
        description: 'List, create, switch, or delete branches.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'create', 'switch', 'delete'],
              description: 'Branch operation to perform.',
            },
            name: {
              type: 'string',
              description: 'Branch name (required for create/switch/delete).',
            },
          },
          required: ['action'],
        },
      },
      handler(input, ctx) {
        try {
          const action = input.action as string
          const name = input.name as string | undefined

          switch (action) {
            case 'list':
              return ok(git('branch -a', ctx))
            case 'create':
              if (!name) return fail('Branch name is required for "create".')
              return ok(git(`branch "${name}"`, ctx))
            case 'switch':
              if (!name) return fail('Branch name is required for "switch".')
              return ok(git(`checkout "${name}"`, ctx))
            case 'delete':
              if (!name) return fail('Branch name is required for "delete".')
              return ok(git(`branch -d "${name}"`, ctx))
            default:
              return fail(`Unknown action "${action}". Use list, create, switch, or delete.`)
          }
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 5. git_commit --------------------------------------------------------
    {
      definition: {
        name: 'git_commit',
        description: 'Stage files and create a commit.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Commit message.',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Files to stage before committing. If omitted, stages all changes.',
            },
            amend: {
              type: 'boolean',
              description: 'Amend the previous commit.',
              default: false,
            },
          },
          required: ['message'],
        },
      },
      handler(input, ctx) {
        try {
          const files = input.files as string[] | undefined
          if (files && files.length) {
            for (const f of files) git(`add "${f}"`, ctx)
          } else {
            git('add -A', ctx)
          }

          const amend = input.amend ? ' --amend' : ''
          const msg = (input.message as string).replace(/"/g, '\\"')
          return ok(git(`commit${amend} -m "${msg}"`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 6. git_stash ---------------------------------------------------------
    {
      definition: {
        name: 'git_stash',
        description: 'Stash or restore uncommitted changes.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['push', 'pop', 'list', 'drop'],
              description: 'Stash operation.',
            },
            message: {
              type: 'string',
              description: 'Optional message when pushing a stash.',
            },
          },
          required: ['action'],
        },
      },
      handler(input, ctx) {
        try {
          const action = input.action as string
          switch (action) {
            case 'push': {
              const msg = input.message ? ` -m "${input.message}"` : ''
              return ok(git(`stash push${msg}`, ctx))
            }
            case 'pop':
              return ok(git('stash pop', ctx))
            case 'list':
              return ok(git('stash list', ctx))
            case 'drop':
              return ok(git('stash drop', ctx))
            default:
              return fail(`Unknown stash action "${action}".`)
          }
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 7. git_blame ---------------------------------------------------------
    {
      definition: {
        name: 'git_blame',
        description: 'Show line-by-line blame annotations for a file.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File to blame.' },
            start_line: {
              type: 'number',
              description: 'Start line for a range.',
            },
            end_line: {
              type: 'number',
              description: 'End line for a range.',
            },
          },
          required: ['file'],
        },
      },
      handler(input, ctx) {
        try {
          const file = input.file as string
          let range = ''
          if (input.start_line != null && input.end_line != null) {
            range = ` -L ${input.start_line},${input.end_line}`
          } else if (input.start_line != null) {
            range = ` -L ${input.start_line},+50`
          }
          return ok(git(`blame${range} -- "${file}"`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 8. git_cherry_pick ---------------------------------------------------
    {
      definition: {
        name: 'git_cherry_pick',
        description: 'Cherry-pick a specific commit onto the current branch.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            commit_hash: {
              type: 'string',
              description: 'The commit hash to cherry-pick.',
            },
          },
          required: ['commit_hash'],
        },
      },
      handler(input, ctx) {
        try {
          return ok(git(`cherry-pick ${input.commit_hash}`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 9. git_merge ---------------------------------------------------------
    {
      definition: {
        name: 'git_merge',
        description: 'Merge a branch into the current branch.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            branch: {
              type: 'string',
              description: 'Branch to merge.',
            },
            no_ff: {
              type: 'boolean',
              description: 'Create a merge commit even if fast-forward is possible.',
              default: false,
            },
          },
          required: ['branch'],
        },
      },
      handler(input, ctx) {
        try {
          const noff = input.no_ff ? ' --no-ff' : ''
          return ok(git(`merge${noff} "${input.branch}"`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 10. git_tag ----------------------------------------------------------
    {
      definition: {
        name: 'git_tag',
        description: 'List existing tags or create a new tag.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'create'],
              description: 'Tag operation.',
            },
            name: {
              type: 'string',
              description: 'Tag name (required for create).',
            },
            message: {
              type: 'string',
              description: 'Tag message (creates an annotated tag).',
            },
          },
          required: ['action'],
        },
      },
      handler(input, ctx) {
        try {
          const action = input.action as string
          if (action === 'list') {
            return ok(git('tag -l --sort=-creatordate', ctx))
          }
          if (action === 'create') {
            const name = input.name as string | undefined
            if (!name) return fail('Tag name is required for "create".')
            if (input.message) {
              return ok(git(`tag -a "${name}" -m "${input.message}"`, ctx))
            }
            return ok(git(`tag "${name}"`, ctx))
          }
          return fail(`Unknown tag action "${action}".`)
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 11. git_remote -------------------------------------------------------
    {
      definition: {
        name: 'git_remote',
        description: 'List remotes or show verbose remote info.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            verbose: {
              type: 'boolean',
              description: 'Show remote URLs.',
              default: false,
            },
          },
          required: [],
        },
      },
      handler(input, ctx) {
        try {
          const v = input.verbose ? ' -v' : ''
          return ok(git(`remote${v}`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },

    // 12. git_reset --------------------------------------------------------
    {
      definition: {
        name: 'git_reset',
        description: 'Reset the current HEAD to a specified commit.',
        category: 'git',
        input_schema: {
          type: 'object',
          properties: {
            commit: {
              type: 'string',
              description: 'Target commit (default HEAD).',
              default: 'HEAD',
            },
            mode: {
              type: 'string',
              enum: ['soft', 'mixed', 'hard'],
              description: 'Reset mode.',
              default: 'mixed',
            },
          },
          required: [],
        },
      },
      handler(input, ctx) {
        try {
          const commit = (input.commit as string) || 'HEAD'
          const mode = (input.mode as string) || 'mixed'
          if (!['soft', 'mixed', 'hard'].includes(mode)) {
            return fail(`Invalid mode "${mode}". Use soft, mixed, or hard.`)
          }
          return ok(git(`reset --${mode} ${commit}`, ctx))
        } catch (err) {
          return fail(err)
        }
      },
    },
  ],
}
