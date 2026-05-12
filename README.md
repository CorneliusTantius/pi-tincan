# pi-tincan

Barebone all-in-one package for [pi](https://pi.dev/).

Includes:
- tools: `ask_user_question`, `tincan_squad`
- always-on persona + communication injection
- always-on footer
- RTK bash rewrite hook via `rtk rewrite`
- skill: `skills/tincan/SKILL.md`
- prompt: `prompts/tincan.md`

## ask_user_question

- sequential questions only
- built from `ctx.ui.select()` + `ctx.ui.input()`
- single-select, multi-select, custom text, `Chat about this`
- `preview` accepted in schema, no rich preview pane

## tincan_squad

Focused subagents for complex work.

| agent | role |
|---|---|
| `context-builder` | requirements/codebase context |
| `delegate` | lightweight helper |
| `explorer` | try approaches |
| `planner` | implementation plan |
| `researcher` | web research |
| `reviewer` | review diffs/plans |
| `scout` | repo reconnaissance |
| `worker` | bounded implementation |

## footer

Shows:
- persona/communication state
- squad fires/runs/live count
- top agent usage
- ask-user-question stats
- RTK status
- model/branch/context usage

## install

```bash
pi install git:github.com/CorneliusTantius/pi-tincan
```

Reload:

```text
/reload
```

Update:

```bash
pi update git:github.com/CorneliusTantius/pi-tincan
```

## notes

- no slash commands registered
- pi core packages stay peer deps; pi provides them at runtime
- `types/pi-runtime.d.ts` = fallback shim for local typecheck
