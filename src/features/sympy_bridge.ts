import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { FileSystemAdapter } from "obsidian";
import type LatexSuitePlugin from "src/main";

export interface SymPyRequest {
	command:
		| "differentiate"
		| "integrate"
		| "definite_integral"
		| "matrix_operation"
		| "pde_analyze_solve"
		| "pde_separate"
		| "simplify_or_solve"
		| "numerical_evaluate"
		| "fourier_transform"
		| "fourier_series";
	context: {
		chunk: string;
		line: number;
		char: number;
		expression: string;
		wrt: string;
		order?: number;
		lower?: string;
		upper?: string;
		operation?: MatrixOperation;
		equation?: string;
		function?: string;
		ansatz?: string;
		precision?: number;
		frequency?: string;
		terms?: number | string;
	};
}

export type MatrixOperation =
	| "evaluate"
	| "determinant"
	| "inverse"
	| "transpose"
	| "trace"
	| "norm"
	| "rref"
	| "rank"
	| "nullspace"
	| "eigenvalues"
	| "eigenvectors"
	| "characteristic_polynomial"
	| "diagonalize";

export interface SymPySuccess {
	ok: true;
	latex: string;
	result?: PDEResult;
}

export interface PDEConditionCheck {
	latex: string;
	status: "satisfied" | "violated" | "undetermined";
}

export type PDEResult =
	| {
			kind: "solved";
			latex: string;
			classification: string[];
			order: number;
			verified: true;
			conditions: PDEConditionCheck[];
	  }
	| {
			kind: "unsupported";
			classification: string[];
			order: number;
			message: string;
	  }
	| {
			kind: "separated";
			latex: string;
			verified: true;
	  };

export interface SymPyFailure {
	ok: false;
	error: {
		type: string;
		message: string;
	};
}

export type SymPyResponse = SymPySuccess | SymPyFailure;

const REQUEST_TIMEOUT_MS = 15_000;

function pluginDirectory(plugin: LatexSuitePlugin): string {
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error("oScribe's SymPy bridge requires a desktop filesystem vault.");
	}
	const directory = plugin.manifest.dir;
	if (!directory) throw new Error("Could not determine the oScribe plugin directory.");
	return adapter.getFullPath(directory);
}

function runtimePaths(plugin: LatexSuitePlugin): {
	interpreter: string;
	script: string;
} {
	const root = pluginDirectory(plugin);
	const script = join(root, "Python", "oScribe.py");
	if (!existsSync(script)) {
		throw new Error(`Python entrypoint not found at ${script}`);
	}

	const bundledInterpreter = join(
		root,
		"Python",
		"venv",
		process.platform === "win32" ? "Scripts" : "bin",
		process.platform === "win32" ? "python.exe" : "python",
	);

	return {
		interpreter: existsSync(bundledInterpreter)
			? bundledInterpreter
			: process.platform === "win32"
				? "python"
				: "python3",
		script,
	};
}

export function pythonBridge(
	plugin: LatexSuitePlugin,
	request: SymPyRequest,
): Promise<SymPyResponse> {
	return new Promise((resolve, reject) => {
		let paths: ReturnType<typeof runtimePaths>;
		try {
			paths = runtimePaths(plugin);
		} catch (error) {
			reject(error);
			return;
		}

		const python = spawn(paths.interpreter, [paths.script], {
			cwd: pluginDirectory(plugin),
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			callback();
		};
		const timeout = setTimeout(() => {
			python.kill();
			finish(() => reject(new Error("SymPy request timed out.")));
		}, REQUEST_TIMEOUT_MS);

		python.stdout.setEncoding("utf8");
		python.stderr.setEncoding("utf8");
		python.stdout.on("data", (data: string) => {
			stdout += data;
		});
		python.stderr.on("data", (data: string) => {
			stderr += data;
		});
		python.on("error", (error) => finish(() => reject(error)));
		python.on("close", (code) => {
			finish(() => {
				if (code !== 0) {
					reject(
						new Error(
							`Python exited with code ${String(code)}${
								stderr ? `: ${stderr.trim()}` : ""
							}`,
						),
					);
					return;
				}
				try {
					resolve(JSON.parse(stdout) as SymPyResponse);
				} catch (error) {
					reject(
						new Error(
							`Invalid response from SymPy worker: ${
								error instanceof Error ? error.message : String(error)
							}`,
						),
					);
				}
			});
		});

		python.stdin.on("error", (error) => finish(() => reject(error)));
		python.stdin.end(JSON.stringify(request), "utf8");
	});
}
