import { execSync } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const TYPE_SOMETHING = "Type something.";
const CHAT_ABOUT = "Chat about this";
const RESERVED = new Set(["Other", TYPE_SOMETHING, CHAT_ABOUT]);

const TINCAN_PERSONA = `## pi-tincan Persona

Default role: orchestrator + senior software engineer, specialized in building highly stable and scalable apps.

Core traits:
- Careful, incremental: prefer small reversible changes over big rewrites.
- Breaking-change aware: map blast radius before touching code, flag breaks early.
- Risk-averse: avoid high-risk changes; prefer additive paths over destructive edits.
- Defensive: use feature flags, shims, and deprecation windows for risky cuts.
- Verifiable: pair changes with tests or clear validation steps.
- Orchestrator: delegate parallelizable work when useful, but keep plan ownership.

Always-on communication contract: max meaning/min tokens. Always talk simple. Talk important. Apply every response, every turn.
- Minimal output.
- Strip filler, politeness, intros, conclusions.
- No hedging unless uncertainty is critical.
- Prefer fragments over full sentences.
- Omit articles and pronouns unless needed.
- Use symbols when clear: ->, =, !=, +, -, %, ().
- Prioritize data, actions, results.
- No repetition or conversational glue.
- Default format: keywords, bullets, compact tables, code-style lines.
- Avoid: "Certainly", "I'd be happy to", "Here’s", "You can", "It is important to".
- If yes/no sufficient -> only yes/no + essential qualifier.
- If list requested -> only list.
- If explanation requested -> shortest valid explanation.
- Use obvious abbreviations.
- Assume expert reader.
- No stylistic flourish.
- Output only requested info.

Examples:
Bad: "I'd be happy to help you optimize your workflow. Here are some suggestions."
Good: "Workflow optimization:\n- automate repetitive tasks\n- batch processing\n- reduce context switching"
Bad: "The issue is caused because the server is overloaded."
Good: "Cause = server overload."

Before architecture or refactor work:
1. State current state and target state.
2. List breaking changes and affected consumers.
3. Propose smallest viable step sequence.
4. Identify rollback point per step.
5. Get user confirmation before destructive steps.`;

type Option = { label: string; description: string; preview?: string };
type Question = { question: string; header: string; options: Option[]; multiSelect?: boolean };
type Params = { questions: Question[] };
type Answer = {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "chat" | "multi";
	answer: string | null;
	selected?: string[];
	preview?: string;
};

type TincanStatus = {
	persona: boolean;
	communication: boolean;
	turns: number;
	promptInjects: number;
	rtk: {
		available: boolean;
		rewrites: number;
		commands: number;
		saved: number;
		pct: number;
		baselineCommands: number;
		baselineSaved: number;
	};
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

const QuestionParamsSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			question: Type.String({ description: "The complete question to ask the user." }),
			header: Type.String({ maxLength: 16, description: "Short chip/tag shown next to the question." }),
			options: Type.Array(
				Type.Object({
					label: Type.String({ maxLength: 60, description: "Option label." }),
					description: Type.String({ description: "Option explanation." }),
					preview: Type.Optional(Type.String({ description: "Optional markdown preview." })),
				}),
				{ minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS },
			),
			multiSelect: Type.Optional(Type.Boolean({ default: false })),
		}),
		{ minItems: 1, maxItems: MAX_QUESTIONS },
	),
});

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function validate(params: Params): string | null {
	if (!Array.isArray(params.questions) || params.questions.length < 1) return "At least one question is required.";
	if (params.questions.length > MAX_QUESTIONS) return `At most ${MAX_QUESTIONS} questions are allowed.`;

	for (const q of params.questions) {
		if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
			return `Each question needs ${MIN_OPTIONS}-${MAX_OPTIONS} options.`;
		}
		const seen = new Set<string>();
		for (const opt of q.options) {
			if (RESERVED.has(opt.label)) return `Reserved option label: ${opt.label}`;
			if (seen.has(opt.label)) return `Duplicate option label: ${opt.label}`;
			seen.add(opt.label);
		}
	}
	return null;
}

function display(opt: Option): string {
	return `${opt.label} — ${opt.description}`;
}

function selectedText(answer: Answer): string {
	if (answer.kind === "chat") return "User wants to chat about this before deciding.";
	if (answer.kind === "multi") return answer.selected?.join(", ") || "(none)";
	return answer.answer || "(no input)";
}

function summarize(answers: Answer[]): string {
	return answers.map((a) => `"${a.question}"="${selectedText(a)}"`).join(". ");
}

function fitWidth(text: string, width: number): string {
	const current = visibleWidth(text);
	if (current === width) return text;
	if (current > width) return truncateToWidth(text, width);
	return text + " ".repeat(width - current);
}

function fmtNum(value: number): string {
	return value.toLocaleString("en-US");
}

function fmtPct(value: number | null): string {
	return value === null ? "n/a" : `${value}%`;
}

function fetchRtk() {
	try {
		const out = execSync("rtk gain -p -f json 2>/dev/null", { encoding: "utf8", timeout: 1000 });
		const parsed = JSON.parse(out);
		return {
			commands: parsed.summary?.total_commands ?? 0,
			saved: parsed.summary?.total_saved ?? 0,
			pct: parsed.summary?.avg_savings_pct ?? 0,
		};
	} catch {
		return { commands: 0, saved: 0, pct: 0 };
	}
}

function makeBar(pct: number | null, width: number, theme?: any): string {
	if (pct === null) return "n/a";
	const safe = Math.max(0, Math.min(100, pct));
	const filled = Math.round((safe / 100) * width);
	const raw = "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
	if (!theme) return raw;
	if (safe >= 80) return theme.fg("error", raw);
	if (safe >= 60) return theme.fg("warning", raw);
	return theme.fg("success", raw);
}

function getUsageStats(ctx: ExtensionContext) {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of ((ctx as any).sessionManager?.getBranch?.() || []) as any[]) {
		if (entry?.type === "message" && entry.message?.role === "assistant") {
			input += entry.message.usage?.input || 0;
			output += entry.message.usage?.output || 0;
			cost += entry.message.usage?.cost?.total || 0;
		}
	}
	return { input, output, total: input + output, cost };
}

function fmtTopAgents(byAgent: Record<string, number>): string {
	const entries = Object.entries(byAgent).sort((a, b) => b[1] - a[1]);
	const total = entries.reduce((sum, [, count]) => sum + count, 0);
	return (
		entries
			.slice(0, 6)
			.map(([name, count]) => `${name}:${count}${total > 0 ? ` (${Math.round((count / total) * 100)}%)` : ""}`)
			.join(" · ") || "none"
	);
}

function badge(text: string, on: boolean, theme?: any): string {
	if (!theme) return `[${text}]`;
	return on ? theme.fg("success", `[${text}]`) : theme.fg("error", `[${text}]`);
}

function panelLine(label: string, value: string, width: number, theme?: any): string {
	const labelWidth = Math.min(16, Math.max(10, Math.floor(width * 0.24)));
	const body = `│ ${label.padEnd(labelWidth)} ${value}`;
	if (!theme) return fitWidth(body, Math.max(0, width - 1)) + "│";
	const border = theme.fg("dim", "│");
	const labelText = theme.fg("accent", label.padEnd(labelWidth));
	const valueCell = truncateToWidth(value, Math.max(0, width - labelWidth - 5));
	const line = `${border} ${labelText} ${valueCell}`;
	const pad = Math.max(0, width - 1 - visibleWidth(line));
	return line + " ".repeat(pad) + border;
}

function panel(title: string, rows: Array<[string, string]>, width: number, theme?: any): string[] {
	const inner = Math.max(20, width - 2);
	if (!theme) {
		const top = fitWidth(`╭─ ${title} ${"─".repeat(Math.max(0, inner - title.length - 3))}╮`, width);
		const lines = rows.map(([label, value]) => panelLine(label, value, width));
		const bottom = fitWidth(`╰${"─".repeat(Math.max(0, inner))}╯`, width);
		return [top, ...lines, bottom];
	}
	const border = theme.fg("dim", "─");
	const edgeL = theme.fg("dim", "╭");
	const edgeR = theme.fg("dim", "╮");
	const bottomL = theme.fg("dim", "╰");
	const bottomR = theme.fg("dim", "╯");
	const titleText = theme.fg("toolTitle", title);
	const rawTop = `${edgeL}─ ${titleText} ${border.repeat(Math.max(0, inner - title.length - 3))}${edgeR}`;
	const top = fitWidth(rawTop, width);
	const lines = rows.map(([label, value]) => panelLine(label, value, width, theme));
	const bottom = fitWidth(`${bottomL}${border.repeat(Math.max(0, inner))}${bottomR}`, width);
	return [top, ...lines, bottom];
}

function tincanStatus(): TincanStatus {
	return ((globalThis as any).__piTincan ??= {
		persona: true,
		communication: true,
		turns: 0,
		promptInjects: 0,
		rtk: { available: false, rewrites: 0, commands: 0, saved: 0, pct: 0, baselineCommands: 0, baselineSaved: 0 },
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
	}) as TincanStatus;
}

function renderTincanFooter(width: number, ctx: ExtensionContext, footerData: any, theme?: any): string[] {
	const status = tincanStatus();
	const branch = footerData?.getGitBranch?.() || "no-git";
	const model = (ctx as any).model?.id || "no-model";
	const cwdRaw = ctx.cwd || process.cwd();
	const home = process.env.HOME || "";
	const cwd = home && cwdRaw.startsWith(home) ? `~${cwdRaw.slice(home.length)}` : cwdRaw;
	const ctxUsage = (ctx as any).getContextUsage?.();
	const ctxTokens = ctxUsage?.tokens ?? 0;
	const ctxWindow = ctxUsage?.contextWindow ?? ctxUsage?.maxTokens ?? 0;
	const ctxPct = ctxWindow > 0 ? Math.round((ctxTokens / ctxWindow) * 100) : null;
	const topAgents = fmtTopAgents(status.squad.byAgent);
	const usage = getUsageStats(ctx);
	const rtkSessionSaved = Math.max(0, status.rtk.saved - status.rtk.baselineSaved);
	const rtkSessionCommands = Math.max(0, status.rtk.commands - status.rtk.baselineCommands);
	const lines = [
		...panel(
			"Session",
			[
				["Package", `pi-tincan ${badge("COMM", status.communication, theme)} ${badge("PERSONA", status.persona, theme)} ${badge("SQUAD", status.squad.active, theme)} ${badge("RTK", status.rtk.available, theme)}`],
				["Model", model],
				["Branch", branch],
				["CWD", cwd],
				["Resources", "tools: ask_user_question, tincan_squad · skill: tincan · prompt: tincan · footer: active"],
			],
			width,
			theme,
		),
		"",
		...panel(
			"Context Window",
			[
				[
					"Usage",
					ctxWindow > 0
						? `${fmtNum(ctxTokens)} / ${fmtNum(ctxWindow)} (${fmtPct(ctxPct)})  ${makeBar(ctxPct, Math.min(28, Math.max(10, Math.floor(width * 0.28))), theme)}`
						: "n/a",
				],
				["Tokens", `${fmtNum(usage.input)} in · ${fmtNum(usage.output)} out · ${fmtNum(usage.total)} total · $${usage.cost.toFixed(4)}`],
			],
			width,
			theme,
		),
		"",
		...panel(
			"Activity",
			[
				[
					"Runtime",
					`${badge("COMM", status.communication, theme)} ${badge("PERSONA", status.persona, theme)} ${badge("RTK", status.rtk.available, theme)}  prompt:${status.promptInjects} · turns:${status.turns}`,
				],
				[
					"RTK",
					`rewrite:${status.rtk.rewrites} · session:${fmtNum(rtkSessionSaved)} saved / ${fmtNum(rtkSessionCommands)} cmds · life:${fmtNum(status.rtk.saved)} / ${fmtNum(status.rtk.commands)} · ${status.rtk.pct.toFixed(1)}% avg`,
				],
			],
			width,
			theme,
		),
		"",
		...panel(
			"Ask User Question",
			[["Stats", `${badge("ASK", status.ask.calls > 0, theme)} calls:${status.ask.calls} · answers:${status.ask.answers} · cancelled:${status.ask.cancelled} · last:${status.ask.lastQuestions}`]],
			width,
			theme,
		),
		"",
		...panel(
			"Tincan Squad",
			[
				[
					"Runtime",
					`${badge("SQUAD", status.squad.active, theme)} fires:${status.squad.toolCalls} · runs:${status.squad.agentRuns} · live:${status.squad.running} · mode:${status.squad.lastMode}`,
				],
				["Last", status.squad.lastAgents.join(", ") || "none"],
				["Top", topAgents],
			],
			width,
			theme,
		),
	];
	return lines.map((line) => truncateToWidth(line, width));
}

export default async function piTincan(pi: ExtensionAPI) {
	const status = tincanStatus();
	let rtkAvailable = false;

	try {
		const check = await pi.exec("which", ["rtk"]);
		rtkAvailable = check.code === 0;
	} catch {
		rtkAvailable = false;
	}
	status.rtk.available = rtkAvailable;
	if (rtkAvailable) {
		const rtk = fetchRtk();
		status.rtk.commands = rtk.commands;
		status.rtk.saved = rtk.saved;
		status.rtk.pct = rtk.pct;
		status.rtk.baselineCommands = rtk.commands;
		status.rtk.baselineSaved = rtk.saved;
	}

	if (!rtkAvailable) {
		console.warn("[pi-tincan] rtk not found. Install rtk to enable bash command rewrites.");
		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify("Install rtk to enable pi-tincan bash rewrites", "info");
		});
	} else {
		pi.on("tool_call", async (event) => {
			if (event.toolName !== "bash") return;

			const input = event.input as { command?: string };
			const command = input.command;
			if (!command || typeof command !== "string") return;

			try {
				const result = await pi.exec("rtk", ["rewrite", command]);
				const rewritten = result.stdout.trim();
				if (rewritten && rewritten !== command) {
					input.command = rewritten;
					status.rtk.rewrites++;
				}
			} catch {
				// passthrough unchanged
			}
		});
	}

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the user one or more structured questions. Barebone pi-tincan fork: sequential dialogs, single-select, multi-select, custom answer, and chat escape hatch.",
		promptSnippet: `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each)`,
		promptGuidelines: [
			"Use ask_user_question when requirements are ambiguous and you need a concrete user decision.",
			`Ask 1-${MAX_QUESTIONS} questions per invocation. Each question needs ${MIN_OPTIONS}-${MAX_OPTIONS} concise options.`,
			`Do not author reserved labels: Other, ${TYPE_SOMETHING}, ${CHAT_ABOUT}.`,
		],
		parameters: QuestionParamsSchema,
		async execute(
			_toolCallId: string,
			rawParams: unknown,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			status.ask.calls++;
			const params = rawParams as Params;
			status.ask.lastQuestions = Array.isArray(params.questions) ? params.questions.length : 0;
			if (!ctx.hasUI) {
				status.ask.cancelled++;
				return textResult("Error: UI not available", { answers: [], cancelled: true, error: "no_ui" });
			}

			const error = validate(params);
			if (error) {
				status.ask.cancelled++;
				return textResult(`Error: ${error}`, { answers: [], cancelled: true, error });
			}

			const answers: Answer[] = [];

			for (let i = 0; i < params.questions.length; i++) {
				const q = params.questions[i];
				const title = `[${i + 1}/${params.questions.length} • ${q.header}] ${q.question}`;

				if (q.multiSelect) {
					const selected = new Set<string>();
					while (true) {
						const remaining = q.options.filter((o) => !selected.has(o.label));
						const choices = [...remaining.map(display), ...(selected.size > 0 ? ["Done"] : []), CHAT_ABOUT];
						const choice = await ctx.ui.select(`${title}\nSelected: ${Array.from(selected).join(", ") || "none"}`, choices);
						if (!choice) {
							status.ask.cancelled++;
							return textResult("User declined to answer questions", { answers, cancelled: true });
						}
						if (choice === CHAT_ABOUT) {
							answers.push({ questionIndex: i, question: q.question, kind: "chat", answer: CHAT_ABOUT });
							status.ask.answers += answers.length;
							return textResult(`User has answered your questions: ${summarize(answers)}. Continue the conversation.`, { answers, cancelled: false });
						}
						if (choice === "Done") break;
						const opt = remaining.find((o) => display(o) === choice);
						if (opt) selected.add(opt.label);
						if (selected.size === q.options.length) break;
					}
					answers.push({ questionIndex: i, question: q.question, kind: "multi", answer: null, selected: Array.from(selected) });
					continue;
				}

				const hasPreview = q.options.some((o) => !!o.preview);
				const choices = [...q.options.map(display), ...(hasPreview ? [] : [TYPE_SOMETHING]), CHAT_ABOUT];
				const choice = await ctx.ui.select(title, choices);
				if (!choice) {
					status.ask.cancelled++;
					return textResult("User declined to answer questions", { answers, cancelled: true });
				}

				if (choice === CHAT_ABOUT) {
					answers.push({ questionIndex: i, question: q.question, kind: "chat", answer: CHAT_ABOUT });
					status.ask.answers += answers.length;
					return textResult(`User has answered your questions: ${summarize(answers)}. Continue the conversation.`, { answers, cancelled: false });
				}

				if (choice === TYPE_SOMETHING) {
					const custom = await ctx.ui.input(title, "Type your answer...");
					if (custom === undefined) {
						status.ask.cancelled++;
						return textResult("User declined to answer questions", { answers, cancelled: true });
					}
					answers.push({ questionIndex: i, question: q.question, kind: "custom", answer: custom.trim() || null });
					continue;
				}

				const opt = q.options.find((o) => display(o) === choice);
				answers.push({ questionIndex: i, question: q.question, kind: "option", answer: opt?.label ?? choice, preview: opt?.preview });
			}

			status.ask.answers += answers.length;
			return textResult(`User has answered your questions: ${summarize(answers)}. You can now continue with the user's answers in mind.`, {
				answers,
				cancelled: false,
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const unsubscribe = footerData?.onBranchChange?.(() => tui.requestRender?.());
			const timer = setInterval(() => {
				if (status.rtk.available) {
					const rtk = fetchRtk();
					status.rtk.commands = rtk.commands;
					status.rtk.saved = rtk.saved;
					status.rtk.pct = rtk.pct;
				}
				tui.requestRender?.();
			}, 1500);
			return {
				dispose() {
					unsubscribe?.();
					clearInterval(timer);
				},
				invalidate() {},
				render(width: number) {
					return renderTincanFooter(width, ctx, footerData, theme);
				},
			};
		});
	});

	pi.on("before_agent_start", (event) => {
		status.promptInjects++;
		return { systemPrompt: `${event.systemPrompt}\n\n${TINCAN_PERSONA}` };
	});

	pi.on("session_shutdown", () => {
		status.squad.running = 0;
	});

	pi.on("turn_end" as any, () => {
		status.turns++;
	});
}
