import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type AgentName = keyof typeof AGENTS;
type Task = { agent: AgentName; task: string };
type ChainStep = { agent: AgentName; task?: string };
type Params = {
	action?: "list" | "run";
	agent?: AgentName;
	task?: string;
	tasks?: Task[];
	chain?: ChainStep[];
	timeoutMs?: number;
};

type TincanStatus = {
	persona: boolean;
	communication: boolean;
	turns: number;
	promptInjects: number;
	rtk: { available: boolean; rewrites: number };
	ask: { calls: number; answers: number; cancelled: number; lastQuestions: number };
	squad: {
		active: boolean;
		toolCalls: number;
		agentRuns: number;
		running: number;
		byAgent: Record<string, number>;
		lastMode: "idle" | "single" | "parallel" | "chain";
		lastAgents: string[];
	};
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(dirname(HERE));
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_PARALLEL = 4;

const SHARED = `Communication: max meaning/min tokens. Simple + important only.
Subagent nesting: allowed only when needed. Prefer direct work. No recursive delegation loops.
If delegating, use tincan_squad with precise task + expected output.`;

const AGENT_MODELS: Record<string, string> = {
	"context-builder": "azure-foundry-openai/gpt-5.4",
	delegate: "azure-foundry-openai/gpt-5.4",
	explorer: "azure-foundry-openai/gpt-5.4",
	planner: "azure-foundry-responses/gpt-5.5",
	researcher: "azure-foundry-openai/gpt-5.4",
	reviewer: "azure-foundry-responses/gpt-5.5",
	scout: "azure-foundry-openai/DeepSeek-V4-Flash",
	worker: "azure-foundry-responses/gpt-5.3-Codex",
};

const AGENTS = {
	"context-builder": {
		description: "Analyze requirements/codebase, generate context + meta-prompt",
		prompt: `${SHARED}
Role = context-builder.
Goal = gather requirements/codebase facts + produce compressed context/meta-prompt.
Use scout via tincan_squad if codebase reconnaissance needed.
Output: facts, assumptions, open questions, recommended next agent/task.`,
	},
	delegate: {
		description: "Lightweight inherited-model helper, general-purpose",
		prompt: `${SHARED}
Role = delegate.
Goal = quick general-purpose helper for small bounded tasks.
Do not delegate unless blocked or task clearly needs specialist.
Output: concise answer + evidence.`,
	},
	explorer: {
		description: "Try multiple approaches/prototypes, report what works",
		prompt: `${SHARED}
Role = explorer.
Goal = test options/prototypes, compare outcomes.
May ask researcher for external facts or worker for tiny implementation spike if truly needed.
Output: approaches tried, result, recommendation.`,
	},
	planner: {
		description: "Build implementation plans from context/requirements",
		prompt: `${SHARED}
Role = planner.
Goal = implementation plan from context/requirements.
May call explorer for uncertain technical approaches or researcher for external unknowns.
Output: current state, target state, risks, steps, validation, rollback.`,
	},
	researcher: {
		description: "Web research + synthesis",
		prompt: `${SHARED}
Role = researcher.
Goal = research external facts + synthesize.
Use browser/web tools if available. Delegate only for codebase-specific checks.
Output: findings, sources/paths, confidence, recommendation.`,
	},
	reviewer: {
		description: "Review diffs, plans, PRs, code health",
		prompt: `${SHARED}
Role = reviewer.
Goal = review code/diff/plan for correctness, risk, maintainability.
May call scout for codebase context if missing.
Output format: issue bullets with severity + fix.`,
	},
	scout: {
		description: "Fast codebase reconnaissance, compressed context",
		prompt: `${SHARED}
Role = scout.
Goal = fast repo reconnaissance.
Use read/grep/find/bash as needed. No edits.
Delegate only if task becomes research/planning-heavy.
Output: compressed map, relevant files, key facts, unknowns.`,
	},
	worker: {
		description: "Implementation agent for normal tasks / approved handoffs",
		prompt: `${SHARED}
Role = worker.
Goal = implement approved bounded task.
Make small changes. Validate. Avoid destructive edits.
May call scout for missing code context or reviewer after changes if useful.
Output: changed files, validation, risks.`,
	},
} as const;

const agentNames = Object.keys(AGENTS) as AgentName[];

const TaskSchema = Type.Object({
	agent: Type.String({ description: `Agent name: ${agentNames.join(", ")}` }),
	task: Type.String({ description: "Delegated task" }),
});

const ChainSchema = Type.Object({
	agent: Type.String({ description: `Agent name: ${agentNames.join(", ")}` }),
	task: Type.Optional(Type.String({ description: "Task template. Use {task} and {previous}." })),
});

const ParamsSchema = Type.Object({
	action: Type.Optional(Type.String({ description: "list or run. Default: run" })),
	agent: Type.Optional(Type.String({ description: "Agent name for single run" })),
	task: Type.Optional(Type.String({ description: "Task for single run, root task for chain, or context for parallel tasks" })),
	tasks: Type.Optional(Type.Array(TaskSchema, { description: "Parallel fan-out" })),
	chain: Type.Optional(Type.Array(ChainSchema, { description: "Sequential pipeline" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Timeout per subagent/process. Default 600000" })),
});

function tincanStatus(): TincanStatus {
	return (((globalThis as any).__piTincan ??= {
		persona: true,
		communication: true,
		turns: 0,
		promptInjects: 0,
		rtk: { available: false, rewrites: 0 },
		ask: { calls: 0, answers: 0, cancelled: 0, lastQuestions: 0 },
		squad: {
			active: true,
			toolCalls: 0,
			agentRuns: 0,
			running: 0,
			byAgent: {} as Record<string, number>,
			lastMode: "idle",
			lastAgents: [],
		},
	}) as TincanStatus);
}

function result(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function finalText(stdout: string): string {
	let last = "";
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as any;
			if (event.type === "message_end" && event.message?.role === "assistant") {
				const text = event.message.content?.find((p: any) => p.type === "text")?.text;
				if (text) last = text;
			}
		} catch {
			last = line;
		}
	}
	return last.trim() || stdout.trim();
}

async function runProcess(
	agentName: AgentName,
	task: string,
	timeoutMs: number,
	cwd: string,
	promptPath: string,
	model: string | undefined,
	signal?: AbortSignal,
) {
	const args = ["-e", PACKAGE_ROOT, "--mode", "json", "-p", "--no-session"];
	if (model) args.push("--model", model);
	args.push("--append-system-prompt", promptPath, task);
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	const code = await new Promise<number>((resolve) => {
		const proc = spawn("pi", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
		}, timeoutMs);
		proc.stdout.on("data", (d) => (stdout += d.toString()));
		proc.stderr.on("data", (d) => (stderr += d.toString()));
		proc.on("close", (c) => {
			clearTimeout(timer);
			resolve(c ?? 0);
		});
		proc.on("error", () => {
			clearTimeout(timer);
			resolve(1);
		});
		if (signal) {
			const abort = () => proc.kill("SIGTERM");
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		}
	});
	return { ok: code === 0 && !timedOut, agent: agentName, code, timedOut, output: finalText(stdout), stderr, modelUsed: model };
}

async function runOne(
	agentName: AgentName,
	task: string,
	timeoutMs: number,
	cwd: string,
	fallbackModel?: string,
	signal?: AbortSignal,
) {
	const status = tincanStatus();
	const agent = AGENTS[agentName];
	if (!agent) {
		return {
			ok: false,
			agent: agentName,
			error: "unknown agent",
			output: "",
			stderr: "unknown agent",
			code: 1,
			timedOut: false,
			modelUsed: undefined,
			fallbackUsed: false,
			fallbackModel,
		};
	}
	status.squad.agentRuns++;
	status.squad.running++;
	status.squad.byAgent[agentName] = (status.squad.byAgent[agentName] || 0) + 1;

	const designatedModel = AGENT_MODELS[agentName];
	const dir = await mkdtemp(join(tmpdir(), "tincan-squad-"));
	const promptPath = join(dir, `${agentName}.md`);
	await writeFile(promptPath, agent.prompt, "utf8");

	try {
		const primary = await runProcess(agentName, task, timeoutMs, cwd, promptPath, designatedModel, signal);
		if (primary.ok || !fallbackModel || fallbackModel === designatedModel) {
			return { ...primary, fallbackUsed: false, fallbackModel };
		}
		const fallback = await runProcess(agentName, task, timeoutMs, cwd, promptPath, fallbackModel, signal);
		return {
			...(fallback.ok ? fallback : primary),
			fallbackUsed: true,
			fallbackModel,
			primaryModel: designatedModel,
			primaryError: primary.stderr || primary.output,
		};
	} finally {
		status.squad.running = Math.max(0, status.squad.running - 1);
		await rm(dir, { recursive: true, force: true });
	}
}

export default function tincanSquad(pi: ExtensionAPI) {
	pi.registerTool({
		name: "tincan_squad",
		label: "Tincan Squad",
		description:
			"Delegate complex work to focused subagents. Use for multi-file/codebase/architecture/research/review/implementation tasks. Do not use for simple tasks.",
		promptSnippet: "Delegate complex tasks to subagents: context-builder, delegate, explorer, planner, researcher, reviewer, scout, worker",
		promptGuidelines: [
			"Use tincan_squad only when task benefits from specialist context or parallel work; do not delegate simple tasks.",
			"Orchestrator remains responsible for final answer, plan, risk, validation, and rollback.",
			"Suggested routing: scout=code recon, context-builder=requirements/context, planner=plan, explorer=approach trials, researcher=web facts, reviewer=review, worker=implementation, delegate=small helper.",
			"Subagents may call tincan_squad only when genuinely needed; avoid recursive delegation loops.",
		],
		parameters: ParamsSchema,
		async execute(_id: string, raw: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const status = tincanStatus();
			const params = raw as Params;
			const action = params.action ?? "run";
			const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

			const fallbackProvider = (ctx as any).model?.provider as string | undefined;
			const fallbackId = (ctx as any).model?.id as string | undefined;
			const fallbackModel = fallbackProvider && fallbackId ? `${fallbackProvider}/${fallbackId}` : fallbackId;

			if (action === "list") {
				const agents = agentNames.map((name) => ({ name, description: AGENTS[name].description, designatedModel: AGENT_MODELS[name] }));
				return result(JSON.stringify({ agents }, null, 2), { agents });
			}

			if (params.tasks?.length) {
				status.squad.toolCalls++;
				status.squad.lastMode = "parallel";
				status.squad.lastAgents = params.tasks.map((t) => t.agent);
				const tasks = params.tasks.slice(0, MAX_PARALLEL);
				const results = await Promise.all(tasks.map((t) => runOne(t.agent, t.task, timeoutMs, ctx.cwd, fallbackModel, signal)));
				return result(results.map((r) => `## ${r.agent}\n${r.output || r.stderr}`).join("\n\n"), { mode: "parallel", results });
			}

			if (params.chain?.length) {
				status.squad.toolCalls++;
				status.squad.lastMode = "chain";
				status.squad.lastAgents = params.chain.map((t) => t.agent);
				let previous = "";
				const results = [];
				for (const step of params.chain) {
					const task = (step.task ?? params.task ?? "").replaceAll("{task}", params.task ?? "").replaceAll("{previous}", previous);
					const r = await runOne(step.agent, task, timeoutMs, ctx.cwd, fallbackModel, signal);
					results.push(r);
					previous = r.output;
					if (!r.ok) break;
				}
				return result(previous || "No output", { mode: "chain", results });
			}

			if (!params.agent || !params.task) {
				return result(`Missing agent/task. Available: ${agentNames.join(", ")}`, { ok: false, agents: agentNames });
			}

			status.squad.toolCalls++;
			status.squad.lastMode = "single";
			status.squad.lastAgents = [params.agent];
			const r = await runOne(params.agent, params.task, timeoutMs, ctx.cwd, fallbackModel, signal);
			return result(r.output || r.stderr || "No output", { mode: "single", result: r });
		},
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n## Tincan Squad Orchestration\nAuto-delegate complex work with tincan_squad when specialist/parallel context helps. For simple tasks, do not delegate. Available agents: ${agentNames.map((n) => `${n}=${AGENTS[n].description}`).join("; ")}. Subagents may call tincan_squad only if truly needed.`,
	}));
}
