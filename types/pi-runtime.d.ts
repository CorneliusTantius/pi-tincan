// Minimal fallback types for local typechecking without installing pi runtime packages.
// pi provides these modules when the extension is loaded at runtime.

declare module "@earendil-works/pi-ai" {
	export const Type: {
		Object: (properties: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
		Array: (items: unknown, options?: Record<string, unknown>) => unknown;
		String: (options?: Record<string, unknown>) => unknown;
		Number: (options?: Record<string, unknown>) => unknown;
		Boolean: (options?: Record<string, unknown>) => unknown;
		Optional: (schema: unknown) => unknown;
	};
}

declare module "@earendil-works/pi-tui" {
	export function truncateToWidth(text: string, width: number): string;
	export function visibleWidth(text: string): number;
}

declare module "@earendil-works/pi-coding-agent" {
	export interface ExtensionUI {
		notify(message: string, level?: "info" | "success" | "warning" | "error"): void;
		select(title: string, options: string[]): Promise<string | undefined>;
		input(title: string, placeholder?: string): Promise<string | undefined>;
		setStatus(key: string, value: string): void;
		setFooter(factory?: any): void;
	}

	export interface ExtensionContext {
		cwd: string;
		hasUI: boolean;
		ui: ExtensionUI;
		model?: { id?: string; contextWindow?: number };
		getContextUsage?: () => { tokens?: number; contextWindow?: number; maxTokens?: number } | undefined;
		[key: string]: unknown;
	}

	export interface BeforeAgentStartEvent {
		systemPrompt: string;
	}

	export interface ToolCallEvent {
		toolName: string;
		input: unknown;
	}

	export interface ExecResult {
		stdout: string;
		stderr: string;
		code: number;
		killed?: boolean;
	}

	export interface ExtensionAPI {
		registerTool(tool: unknown): void;
		exec(command: string, args?: string[], options?: Record<string, unknown>): Promise<ExecResult>;
		on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown | Promise<unknown>): void;
		on(event: "tool_call", handler: (event: ToolCallEvent, ctx: ExtensionContext) => unknown | Promise<unknown>): void;
		on(event: "session_start" | "session_shutdown" | "turn_end", handler: (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>): void;
	}

	export interface ToolResult {
		content: Array<{ type: "text"; text: string }>;
		details?: Record<string, unknown>;
	}

	export interface ToolDefinition {
		name: string;
		label?: string;
		description: string;
		parameters: unknown;
		execute: (toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: unknown, ctx?: ExtensionContext) => ToolResult | Promise<ToolResult>;
		[key: string]: unknown;
	}

	export function defineTool<T extends ToolDefinition>(tool: T): T;
}

