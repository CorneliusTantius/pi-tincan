# pi-tincan

All-in-one, simple, barebone package for [pi coding agent](https://pi.dev/).

Includes:

- Extension: `extensions/index.ts`
- Tool: `ask_user_question`
- Tool: `tincan_squad`
- Always-on persona + communication injection via `before_agent_start`
- Tincan Squad orchestration prompt for auto-delegation on complex tasks
- Always-on custom Tincan footer
- RTK bash rewrite hook via `rtk rewrite` when `rtk` exists in `PATH`
- Install-RTK suggestion when `rtk` missing
- Skill: `skills/tincan/SKILL.md`
- Prompt: `prompts/tincan.md`

`ask_user_question` is a barebone local clone of the Ungabunga Pi version:

- sequential questions only
- built from `ctx.ui.select()` and `ctx.ui.input()`
- supports single-select, multi-select, custom text, and "Chat about this"
- accepts `preview` in the schema but does not render rich preview panes

Persona adds:

- orchestrator + senior software engineer role
- highly stable and scalable apps focus
- careful, incremental, breaking-change aware, risk-averse, defensive, verifiable traits
- architecture/refactor checklist with rollback and confirmation rules
- always-on compact communication style: max meaning/min tokens, simple + important only
- communication examples showing bad -> good output
- optional RTK rewrite system for bash commands

## Tincan Squad

`tincan_squad` delegates complex work to focused subagents. Simple tasks should stay with the orchestrator.

Agents:

| Agent | Role |
|---|---|
| `context-builder` | Analyze requirements/codebase, generate context + meta-prompt |
| `delegate` | Lightweight general-purpose helper |
| `explorer` | Try approaches/prototypes, report what works |
| `planner` | Build implementation plans |
| `researcher` | Web research + synthesis |
| `reviewer` | Review diffs, plans, PRs, code health |
| `scout` | Fast codebase reconnaissance |
| `worker` | Implementation for approved bounded tasks |

Subagents can call `tincan_squad` if truly needed. Recursive delegation discouraged.

## Tincan Footer

Always-on footer. Tincan-only stats:

- communication/persona active state
- squad active state
- squad fires
- subagent runs + live count
- top agents by usage
- ask-user-question calls/answers/cancels
- RTK availability + rewrite count
- model + branch + context usage

## Use locally

From this directory:

```bash
pi -e .
```

Or install into the current project settings:

```bash
pi install -l .
```

Then reload pi:

```text
/reload
```

## Development

```bash
npm install
npm run typecheck
npm run pack:dry
```

## Structure

```text
pi-tincan/
├── extensions/
│   └── index.ts
├── skills/
│   └── tincan/
│       └── SKILL.md
├── prompts/
│   └── tincan.md
├── package.json
├── tsconfig.json
└── types/
    └── pi-runtime.d.ts
```

No slash commands are registered.

## Notes

Core pi packages are optional peer dependencies because pi provides them at runtime. `types/pi-runtime.d.ts` is a tiny fallback shim so this scaffold can typecheck without installing the full pi runtime locally.
