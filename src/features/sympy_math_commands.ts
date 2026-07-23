import type LatexSuitePlugin from "src/main";
import { Editor, Notice } from "obsidian";
import { EditorView, KeyBinding } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { ensureMathMode, grabSymbolicContext } from "./sympy_commands";
import { getContextPlugin } from "src/utils/context";
import { pythonBridge } from "./sympy_bridge";
import type { SymPyRequest } from "./sympy_bridge";
import type { MatrixOperation } from "./sympy_bridge";

const COMMAND = "\\differentiate";
const INTEGRATE_COMMAND = "\\integrate";
const DEFINITE_INTEGRAL_COMMAND = "\\definiteintegral";
const SEPARATE_PDE_COMMAND = "\\separatepde";
const SOLVE_SIMPLIFY_COMMAND = "\\solvesimplify";
const EVALUATE_COMMAND = "\\evaluate";
const FOURIER_TRANSFORM_COMMAND = "\\fouriertransform";
const FOURIER_SERIES_COMMAND = "\\fourierseries";
const PLACEHOLDER = "\\placeholder";

interface ActiveDiff {
	editor: Editor;
}

export interface ParsedInlineDiff {
	expression: string;
	wrt: string;
	orderRaw: string;
	exprFrom: number;
	exprTo: number;
	wrtFrom: number;
	wrtTo: number;
	orderFrom: number;
	orderTo: number;
	commandFrom: number;
	commandTo: number;
	mathFrom: number;
	mathTo: number;
}

const activeDiffs = new WeakMap<EditorView, ActiveDiff>();
const activeIntegrals = new WeakMap<EditorView, ActiveDiff>();
const activeDefiniteIntegrals = new WeakMap<EditorView, ActiveDiff>();
const activePDESeparations = new WeakMap<EditorView, ActiveDiff>();
const activeSolveSimplifies = new WeakMap<EditorView, ActiveDiff>();
const activeEvaluations = new WeakMap<EditorView, ActiveDiff>();
const activeFourierTransforms = new WeakMap<EditorView, ActiveDiff>();
const activeFourierSeries = new WeakMap<EditorView, ActiveDiff>();

export const getSymPyMathCommands = (plugin: LatexSuitePlugin) => [
	differentiateCommand(plugin),
	integrateCommand(plugin),
	definiteIntegralCommand(plugin),
	solveSimplifyCommand(plugin),
	evaluateCommand(plugin),
	fourierTransformCommand(plugin),
	fourierSeriesCommand(plugin),
	analyzeSolvePDECommand(plugin),
	separatePDECommand(plugin),
	...getMatrixCommands(plugin),
];

export function getSymPyMathKeymap(
	plugin: LatexSuitePlugin,
): KeyBinding[] {
	return [
		{
			key: "Tab",
			run: (view) =>
				moveField(view, false) ||
				moveIntegralField(view, false) ||
				moveDefiniteIntegralField(view, false) ||
				moveComputeField(view, activeSolveSimplify, false) ||
				moveComputeField(view, activeEvaluation, false) ||
				moveFourierTransformField(view, false) ||
				moveFourierSeriesField(view, false) ||
				movePDEField(view, false),
		},
		{
			key: "Shift-Tab",
			run: (view) =>
				moveField(view, true) ||
				moveIntegralField(view, true) ||
				moveDefiniteIntegralField(view, true) ||
				moveComputeField(view, activeSolveSimplify, true) ||
				moveComputeField(view, activeEvaluation, true) ||
				moveFourierTransformField(view, true) ||
				moveFourierSeriesField(view, true) ||
				movePDEField(view, true),
		},
		{
			key: "Enter",
			run(view) {
				const parsed = activeCommand(view);
				if (parsed) {
					void submitDiff(plugin, view, parsed);
					return true;
				}
				const integral = activeIntegral(view);
				if (integral) {
					void submitIntegral(plugin, view, integral);
					return true;
				}
				const definite = activeDefiniteIntegral(view);
				if (definite) {
					void submitDefiniteIntegral(plugin, view, definite);
					return true;
				}
				const solve = activeSolveSimplify(view);
				if (solve) {
					void submitSolveSimplify(plugin, view, solve);
					return true;
				}
				const evaluation = activeEvaluation(view);
				if (evaluation) {
					void submitEvaluation(plugin, view, evaluation);
					return true;
				}
				const transform = activeFourierTransform(view);
				if (transform) {
					void submitFourierTransform(plugin, view, transform);
					return true;
				}
				const series = activeFourierSeriesCommand(view);
				if (series) {
					void submitFourierSeries(plugin, view, series);
					return true;
				}
				const pde = activePDESeparation(view);
				if (!pde) return false;
				void submitPDESeparation(plugin, view, pde);
				return true;
			},
		},
		{
			key: "Escape",
			run(view) {
				const parsed = activeCommand(view);
				if (!parsed) {
					const integral = activeIntegral(view);
					if (integral) {
						cancelInlineCommand(view, integral);
						activeIntegrals.delete(view);
						return true;
					}
					const definite = activeDefiniteIntegral(view);
					if (definite) {
						cancelInlineCommand(view, definite);
						activeDefiniteIntegrals.delete(view);
						return true;
					}
					const solve = activeSolveSimplify(view);
					if (solve) {
						cancelInlineCommand(view, solve);
						activeSolveSimplifies.delete(view);
						return true;
					}
					const evaluation = activeEvaluation(view);
					if (evaluation) {
						cancelInlineCommand(view, evaluation);
						activeEvaluations.delete(view);
						return true;
					}
					const transform = activeFourierTransform(view);
					if (transform) {
						cancelInlineCommand(view, transform);
						activeFourierTransforms.delete(view);
						return true;
					}
					const series = activeFourierSeriesCommand(view);
					if (series) {
						cancelInlineCommand(view, series);
						activeFourierSeries.delete(view);
						return true;
					}
					const pde = activePDESeparation(view);
					if (!pde) return false;
					cancelInlineCommand(view, pde);
					activePDESeparations.delete(view);
					return true;
				}
				cancelInlineCommand(view, parsed);
				activeDiffs.delete(view);
				return true;
			},
		},
	];
}

function cancelInlineCommand(
	view: EditorView,
	parsed: Pick<ParsedInlineDiff, "commandFrom" | "commandTo" | "expression">,
): void {
	view.dispatch({
		changes: {
			from: parsed.commandFrom,
			to: parsed.commandTo,
			insert: parsed.expression,
		},
		selection: { anchor: parsed.commandFrom + parsed.expression.length },
	});
}

function activeCommand(view: EditorView): ParsedInlineDiff | null {
	if (!activeDiffs.has(view)) return null;
	const parsed = parseInlineDiff(view);
	if (!parsed) activeDiffs.delete(view);
	return parsed;
}

function activeIntegral(view: EditorView): ParsedInlineIntegral | null {
	if (!activeIntegrals.has(view)) return null;
	const parsed = parseInlineIntegral(view);
	if (!parsed) activeIntegrals.delete(view);
	return parsed;
}

function activeDefiniteIntegral(
	view: EditorView,
): ParsedInlineDefiniteIntegral | null {
	if (!activeDefiniteIntegrals.has(view)) return null;
	const parsed = parseInlineDefiniteIntegral(view);
	if (!parsed) activeDefiniteIntegrals.delete(view);
	return parsed;
}

function activePDESeparation(view: EditorView): ParsedInlinePDE | null {
	if (!activePDESeparations.has(view)) return null;
	const parsed = parseInlinePDE(view);
	if (!parsed) activePDESeparations.delete(view);
	return parsed;
}

function activeSolveSimplify(view: EditorView): ParsedInlineIntegral | null {
	if (!activeSolveSimplifies.has(view)) return null;
	const parsed = parseTwoFieldCommand(view, SOLVE_SIMPLIFY_COMMAND);
	if (!parsed) activeSolveSimplifies.delete(view);
	return parsed;
}

function activeEvaluation(view: EditorView): ParsedInlineIntegral | null {
	if (!activeEvaluations.has(view)) return null;
	const parsed = parseTwoFieldCommand(view, EVALUATE_COMMAND);
	if (!parsed) activeEvaluations.delete(view);
	return parsed;
}

function activeFourierTransform(view: EditorView): ParsedFourierTransform | null {
	if (!activeFourierTransforms.has(view)) return null;
	const parsed = parseFourierTransform(view);
	if (!parsed) activeFourierTransforms.delete(view);
	return parsed;
}

function activeFourierSeriesCommand(view: EditorView): ParsedFourierSeries | null {
	if (!activeFourierSeries.has(view)) return null;
	const parsed = parseFourierSeries(view);
	if (!parsed) activeFourierSeries.delete(view);
	return parsed;
}

function moveField(view: EditorView, backwards: boolean): boolean {
	const parsed = activeCommand(view);
	if (!parsed) return false;
	const fields = [
		[parsed.exprFrom, parsed.exprTo],
		[parsed.wrtFrom, parsed.wrtTo],
		[parsed.orderFrom, parsed.orderTo],
	] as const;
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

function moveIntegralField(view: EditorView, backwards: boolean): boolean {
	const parsed = activeIntegral(view);
	if (!parsed) return false;
	const fields = [
		[parsed.exprFrom, parsed.exprTo],
		[parsed.wrtFrom, parsed.wrtTo],
	] as const;
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

function moveDefiniteIntegralField(
	view: EditorView,
	backwards: boolean,
): boolean {
	const parsed = activeDefiniteIntegral(view);
	if (!parsed) return false;
	const fields = [
		[parsed.exprFrom, parsed.exprTo],
		[parsed.wrtFrom, parsed.wrtTo],
		[parsed.lowerFrom, parsed.lowerTo],
		[parsed.upperFrom, parsed.upperTo],
	] as const;
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

function movePDEField(view: EditorView, backwards: boolean): boolean {
	const parsed = activePDESeparation(view);
	if (!parsed) return false;
	const fields = [
		[parsed.exprFrom, parsed.exprTo],
		[parsed.functionFrom, parsed.functionTo],
		[parsed.ansatzFrom, parsed.ansatzTo],
	] as const;
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

function moveComputeField(
	view: EditorView,
	parser: (view: EditorView) => ParsedInlineIntegral | null,
	backwards: boolean,
): boolean {
	const parsed = parser(view);
	if (!parsed) return false;
	const fields = [
		[parsed.exprFrom, parsed.exprTo],
		[parsed.wrtFrom, parsed.wrtTo],
	] as const;
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

function moveFourierTransformField(view: EditorView, backwards: boolean): boolean {
	const parsed = activeFourierTransform(view);
	if (!parsed) return false;
	return moveRanges(
		view,
		[
			[parsed.exprFrom, parsed.exprTo],
			[parsed.variableFrom, parsed.variableTo],
			[parsed.frequencyFrom, parsed.frequencyTo],
		],
		backwards,
	);
}

function moveFourierSeriesField(view: EditorView, backwards: boolean): boolean {
	const parsed = activeFourierSeriesCommand(view);
	if (!parsed) return false;
	return moveRanges(
		view,
		[
			[parsed.exprFrom, parsed.exprTo],
			[parsed.variableFrom, parsed.variableTo],
			[parsed.lowerFrom, parsed.lowerTo],
			[parsed.upperFrom, parsed.upperTo],
			[parsed.termsFrom, parsed.termsTo],
		],
		backwards,
	);
}

function moveRanges(
	view: EditorView,
	fields: ReadonlyArray<readonly [number, number]>,
	backwards: boolean,
): boolean {
	const selection = view.state.selection.main;
	let current = fields.findIndex(
		([from, to]) => selection.from >= from && selection.to <= to,
	);
	if (current < 0) current = backwards ? 0 : -1;
	const next = (current + (backwards ? -1 : 1) + fields.length) % fields.length;
	view.dispatch({
		selection: EditorSelection.single(fields[next][0], fields[next][1]),
	});
	return true;
}

const differentiateCommand = (plugin: LatexSuitePlugin) => ({
	// Keep the historical ID so existing Obsidian hotkey assignments survive
	// the user-facing migration from \diff to \differentiate.
	id: "oscribe-sympy-diff",
	name: "oScribe: \\differentiate",

	editorCallback(editor: Editor) {
		if (!ensureMathMode(editor, "differentiate")) return;
		const view = editor.cm;
		const ctx = getContextPlugin(view);
		if (!ctx.mode.strictlyInMath()) {
			new Notice("Differentiate must be used directly in a math expression.");
			return;
		}
		const bounds = ctx.getInnerBounds();
		if (!bounds) {
			new Notice("Could not determine the current math expression.");
			return;
		}

		const selection = view.state.selection.main;
		const hasMathSelection =
			!selection.empty &&
			selection.from >= bounds.inner_start &&
			selection.to <= bounds.inner_end;
		const inferredRange = expressionRangeAtCursor(
			view.state.doc.toString(),
			bounds.inner_start,
			bounds.inner_end,
			selection.head,
		);
		const from = hasMathSelection ? selection.from : inferredRange.from;
		const to = hasMathSelection ? selection.to : inferredRange.to;
		const expression = view.state.sliceDoc(from, to) || PLACEHOLDER;
		const scaffold = `${COMMAND}{${expression}}{x}{1}`;

		view.dispatch({
			changes: { from, to, insert: scaffold },
			selection: EditorSelection.single(
				from + COMMAND.length + 1,
				from + COMMAND.length + 1 + expression.length,
			),
		});
		activeDiffs.set(view, { editor });
	},
});

const integrateCommand = (_plugin: LatexSuitePlugin) => ({
	id: "oscribe-sympy-integrate",
	name: "oScribe: Indefinite integral",

	editorCallback(editor: Editor) {
		if (!ensureMathMode(editor, "integrate")) return;
		const view = editor.cm;
		const ctx = getContextPlugin(view);
		if (!ctx.mode.strictlyInMath()) {
			new Notice("Integrate must be used directly in a math expression.");
			return;
		}
		const bounds = ctx.getInnerBounds();
		if (!bounds) {
			new Notice("Could not determine the current math expression.");
			return;
		}
		const selection = view.state.selection.main;
		const hasMathSelection =
			!selection.empty &&
			selection.from >= bounds.inner_start &&
			selection.to <= bounds.inner_end;
		const inferred = expressionRangeAtCursor(
			view.state.doc.toString(),
			bounds.inner_start,
			bounds.inner_end,
			selection.head,
		);
		const from = hasMathSelection ? selection.from : inferred.from;
		const to = hasMathSelection ? selection.to : inferred.to;
		const expression = view.state.sliceDoc(from, to) || PLACEHOLDER;
		const scaffold = `${INTEGRATE_COMMAND}{${expression}}{x}`;
		view.dispatch({
			changes: { from, to, insert: scaffold },
			selection: EditorSelection.single(
				from + INTEGRATE_COMMAND.length + 1,
				from + INTEGRATE_COMMAND.length + 1 + expression.length,
			),
		});
		activeIntegrals.set(view, { editor });
	},
});

const definiteIntegralCommand = (_plugin: LatexSuitePlugin) => ({
	id: "oscribe-sympy-definite-integral",
	name: "oScribe: Definite integral",

	editorCallback(editor: Editor) {
		if (!ensureMathMode(editor, "definite integral")) return;
		const view = editor.cm;
		const ctx = getContextPlugin(view);
		if (!ctx.mode.strictlyInMath()) {
			new Notice("Definite integral must be used directly in a math expression.");
			return;
		}
		const bounds = ctx.getInnerBounds();
		if (!bounds) {
			new Notice("Could not determine the current math expression.");
			return;
		}
		const selection = view.state.selection.main;
		const hasMathSelection =
			!selection.empty &&
			selection.from >= bounds.inner_start &&
			selection.to <= bounds.inner_end;
		const inferred = expressionRangeAtCursor(
			view.state.doc.toString(),
			bounds.inner_start,
			bounds.inner_end,
			selection.head,
		);
		const from = hasMathSelection ? selection.from : inferred.from;
		const to = hasMathSelection ? selection.to : inferred.to;
		const expression = view.state.sliceDoc(from, to) || PLACEHOLDER;
		const scaffold = `${DEFINITE_INTEGRAL_COMMAND}{${expression}}{x}{0}{1}`;
		view.dispatch({
			changes: { from, to, insert: scaffold },
			selection: EditorSelection.single(
				from + DEFINITE_INTEGRAL_COMMAND.length + 1,
				from + DEFINITE_INTEGRAL_COMMAND.length + 1 + expression.length,
			),
		});
		activeDefiniteIntegrals.set(view, { editor });
	},
});

const solveSimplifyCommand = (_plugin: LatexSuitePlugin) =>
	createTwoFieldCommand(
		"oscribe-sympy-solve-simplify",
		"oScribe: Solve / Simplify",
		SOLVE_SIMPLIFY_COMMAND,
		"x",
		activeSolveSimplifies,
		true,
	);

const evaluateCommand = (_plugin: LatexSuitePlugin) =>
	createTwoFieldCommand(
		"oscribe-sympy-numerical-evaluate",
		"oScribe: Evaluate numerically",
		EVALUATE_COMMAND,
		"15",
		activeEvaluations,
		false,
	);

const fourierTransformCommand = (_plugin: LatexSuitePlugin) =>
	createParameterizedCommand(
		"oscribe-sympy-fourier-transform",
		"oScribe: Calculate Fourier transform",
		FOURIER_TRANSFORM_COMMAND,
		["x", "k"],
		activeFourierTransforms,
	);

const fourierSeriesCommand = (_plugin: LatexSuitePlugin) =>
	createParameterizedCommand(
		"oscribe-sympy-fourier-series",
		"oScribe: Calculate Fourier series expansion",
		FOURIER_SERIES_COMMAND,
		["x", String.raw`-\pi`, String.raw`\pi`, String.raw`\infty`],
		activeFourierSeries,
	);

function createParameterizedCommand(
	id: string,
	name: string,
	command: string,
	defaults: string[],
	active: WeakMap<EditorView, ActiveDiff>,
) {
	return {
		id,
		name,
		editorCallback(editor: Editor) {
			if (!ensureMathMode(editor, name)) return;
			const view = editor.cm;
			const ctx = getContextPlugin(view);
			if (!ctx.mode.strictlyInMath()) {
				new Notice(`${name} must be used directly in a math expression.`);
				return;
			}
			const bounds = ctx.getInnerBounds();
			if (!bounds) {
				new Notice("Could not determine the current mathematical expression.");
				return;
			}
			const selection = view.state.selection.main;
			const selected =
				!selection.empty &&
				selection.from >= bounds.inner_start &&
				selection.to <= bounds.inner_end;
			const inferred = expressionRangeAtCursor(
				view.state.doc.toString(),
				bounds.inner_start,
				bounds.inner_end,
				selection.head,
			);
			const from = selected ? selection.from : inferred.from;
			const to = selected ? selection.to : inferred.to;
			const expression = view.state.sliceDoc(from, to) || PLACEHOLDER;
			const scaffold =
				`${command}{${expression}}` +
				defaults.map((value) => `{${value}}`).join("");
			view.dispatch({
				changes: { from, to, insert: scaffold },
				selection: EditorSelection.single(
					from + command.length + 1,
					from + command.length + 1 + expression.length,
				),
			});
			active.set(view, { editor });
		},
	};
}

function createTwoFieldCommand(
	id: string,
	name: string,
	command: string,
	secondField: string,
	active: WeakMap<EditorView, ActiveDiff>,
	wholeEquation: boolean,
) {
	return {
		id,
		name,
		editorCallback(editor: Editor) {
			if (!ensureMathMode(editor, name)) return;
			const view = editor.cm;
			const ctx = getContextPlugin(view);
			if (!ctx.mode.strictlyInMath()) {
				new Notice(`${name} must be used directly in a math expression.`);
				return;
			}
			const bounds = ctx.getInnerBounds();
			if (!bounds) {
				new Notice("Could not determine the current mathematical expression.");
				return;
			}
			const selection = view.state.selection.main;
			const selected =
				!selection.empty &&
				selection.from >= bounds.inner_start &&
				selection.to <= bounds.inner_end;
			const inner = trimRange(
				view.state.doc.toString(),
				bounds.inner_start,
				bounds.inner_end,
			);
			const inferred =
				wholeEquation && view.state.sliceDoc(inner.from, inner.to).includes("=")
					? inner
					: expressionRangeAtCursor(
							view.state.doc.toString(),
							bounds.inner_start,
							bounds.inner_end,
							selection.head,
						);
			const from = selected ? selection.from : inferred.from;
			const to = selected ? selection.to : inferred.to;
			const expression = view.state.sliceDoc(from, to) || PLACEHOLDER;
			const scaffold = `${command}{${expression}}{${secondField}}`;
			view.dispatch({
				changes: { from, to, insert: scaffold },
				selection: EditorSelection.single(
					from + command.length + 1,
					from + command.length + 1 + expression.length,
				),
			});
			active.set(view, { editor });
		},
	};
}

const analyzeSolvePDECommand = (plugin: LatexSuitePlugin) => ({
	id: "oscribe-pde-analyze-solve",
	name: "oScribe: Analyze / Solve PDE",

	editorCallback(editor: Editor) {
		if (!ensureMathMode(editor, "PDE analysis")) return;
		const view = editor.cm;
		const ctx = getContextPlugin(view);
		if (!ctx.mode.strictlyInMath()) {
			new Notice("PDE analysis must be used directly in a math equation.");
			return;
		}
		const bounds = ctx.getInnerBounds();
		if (!bounds) {
			new Notice("Could not determine the current PDE.");
			return;
		}
		const selection = view.state.selection.main;
		const range =
			!selection.empty &&
			selection.from >= bounds.inner_start &&
			selection.to <= bounds.inner_end
				? { from: selection.from, to: selection.to }
				: trimRange(view.state.doc.toString(), bounds.inner_start, bounds.inner_end);
		const equation = view.state.sliceDoc(range.from, range.to);
		if (!equation.includes("=")) {
			new Notice("Select or place the cursor in a complete PDE containing =.");
			return;
		}
		void submitPDEAnalysis(plugin, editor, view, equation, range, bounds.outer_end);
	},
});

const separatePDECommand = (_plugin: LatexSuitePlugin) => ({
	id: "oscribe-pde-separate",
	name: "oScribe: Separate PDE",

	editorCallback(editor: Editor) {
		if (!ensureMathMode(editor, "PDE separation")) return;
		const view = editor.cm;
		const ctx = getContextPlugin(view);
		if (!ctx.mode.strictlyInMath()) {
			new Notice("PDE separation must be used directly in a math equation.");
			return;
		}
		const bounds = ctx.getInnerBounds();
		if (!bounds) {
			new Notice("Could not determine the current PDE.");
			return;
		}
		const selection = view.state.selection.main;
		const range =
			!selection.empty &&
			selection.from >= bounds.inner_start &&
			selection.to <= bounds.inner_end
				? { from: selection.from, to: selection.to }
				: trimRange(view.state.doc.toString(), bounds.inner_start, bounds.inner_end);
		const equation = view.state.sliceDoc(range.from, range.to);
		if (!equation.includes("=")) {
			new Notice("Select or place the cursor in a complete PDE containing =.");
			return;
		}
		const dependent = inferDependentFunction(equation);
		const ansatz = defaultProductAnsatz(dependent);
		const scaffold = `${SEPARATE_PDE_COMMAND}{${equation}}{${dependent}}{${ansatz}}`;
		view.dispatch({
			changes: { from: range.from, to: range.to, insert: scaffold },
			selection: EditorSelection.single(
				range.from + SEPARATE_PDE_COMMAND.length + 1,
				range.from + SEPARATE_PDE_COMMAND.length + 1 + equation.length,
			),
		});
		activePDESeparations.set(view, { editor });
	},
});

function trimRange(
	doc: string,
	from: number,
	to: number,
): { from: number; to: number } {
	while (from < to && /\s/.test(doc.charAt(from))) from++;
	while (to > from && /\s/.test(doc.charAt(to - 1))) to--;
	return { from, to };
}

function inferDependentFunction(equation: string): string {
	const match = equation.match(
		/\\partial(?:\s*\^\s*(?:\{\s*\d+\s*\}|\d+))?\s*([A-Za-z]+)\s*\(([^)]*)\)/,
	);
	return match ? `${match[1]}(${match[2]})` : "u(x,t)";
}

function defaultProductAnsatz(dependent: string): string {
	const match = dependent.match(/^[A-Za-z]+\(([^)]*)\)$/);
	if (!match) return "X(x)T(t)";
	const variables = match[1].split(",").map((item) => item.trim()).filter(Boolean);
	return variables
		.map((variable, index) => {
			const letter = variable.match(/[A-Za-z]/)?.[0]?.toUpperCase();
			return `${letter ?? String.fromCharCode(88 + index)}(${variable})`;
		})
		.join("");
}

/**
 * Return the relation-delimited expression containing the cursor. Relations
 * nested in braces/parentheses are expression content, not document structure.
 */
export function expressionRangeAtCursor(
	doc: string,
	mathFrom: number,
	mathTo: number,
	cursor: number,
): { from: number; to: number } {
	const markers = ["\\triangleq", "\\circeq", ":=", "="];
	const separators: Array<{ from: number; to: number }> = [];
	let braces = 0;
	let parentheses = 0;
	let brackets = 0;

	for (let index = mathFrom; index < mathTo; index++) {
		const char = doc.charAt(index);
		if (!isEscaped(doc, index)) {
			braces += Number(char === "{") - Number(char === "}");
			parentheses += Number(char === "(") - Number(char === ")");
			brackets += Number(char === "[") - Number(char === "]");
		}
		if (braces !== 0 || parentheses !== 0 || brackets !== 0) continue;
		const marker = markers.find((candidate) => doc.startsWith(candidate, index));
		if (!marker) continue;
		separators.push({ from: index, to: index + marker.length });
		index += marker.length - 1;
	}

	let from = mathFrom;
	let to = mathTo;
	for (const separator of separators) {
		if (cursor < separator.from) {
			to = separator.from;
			break;
		}
		from = separator.to;
	}
	while (from < to && /\s/.test(doc.charAt(from))) from++;
	while (to > from && /\s/.test(doc.charAt(to - 1))) to--;
	return { from, to };
}

const MATRIX_COMMANDS: Array<{
	operation: MatrixOperation;
	label: string;
}> = [
	{ operation: "evaluate", label: "Evaluate matrix expression" },
	{ operation: "determinant", label: "Matrix determinant" },
	{ operation: "inverse", label: "Matrix inverse" },
	{ operation: "transpose", label: "Matrix transpose" },
	{ operation: "trace", label: "Matrix trace" },
	{ operation: "norm", label: "Matrix norm" },
	{ operation: "rref", label: "Matrix RREF" },
	{ operation: "rank", label: "Matrix rank" },
	{ operation: "nullspace", label: "Matrix nullspace" },
	{ operation: "eigenvalues", label: "Matrix eigenvalues" },
	{ operation: "eigenvectors", label: "Matrix eigenvectors" },
	{
		operation: "characteristic_polynomial",
		label: "Matrix characteristic polynomial",
	},
	{ operation: "diagonalize", label: "Diagonalize matrix" },
];

function getMatrixCommands(plugin: LatexSuitePlugin) {
	return MATRIX_COMMANDS.map(({ operation, label }) => ({
		id: `oscribe-matrix-${operation.replaceAll("_", "-")}`,
		name: `oScribe: ${label}`,
		editorCallback(editor: Editor) {
			void runMatrixOperation(plugin, editor, operation);
		},
	}));
}

async function runMatrixOperation(
	plugin: LatexSuitePlugin,
	editor: Editor,
	operation: MatrixOperation,
): Promise<void> {
	if (!ensureMathMode(editor, "matrix operation")) return;
	const view = editor.cm;
	const ctx = getContextPlugin(view);
	if (!ctx.mode.strictlyInMath()) {
		new Notice("Matrix operations must be used directly in a math expression.");
		return;
	}
	const bounds = ctx.getInnerBounds();
	if (!bounds) {
		new Notice("Could not determine the current matrix expression.");
		return;
	}
	const selection = view.state.selection.main;
	const selected =
		!selection.empty &&
		selection.from >= bounds.inner_start &&
		selection.to <= bounds.inner_end;
	const inferred = expressionRangeAtCursor(
		view.state.doc.toString(),
		bounds.inner_start,
		bounds.inner_end,
		selection.head,
	);
	const from = selected ? selection.from : inferred.from;
	const to = selected ? selection.to : inferred.to;
	const expression = view.state.sliceDoc(from, to);
	const originalDocument = view.state.doc.toString();
	const cursor = editor.getCursor();
	const symbolicContext = grabSymbolicContext(editor);
	if (!expression || !symbolicContext) {
		new Notice("Could not determine the current matrix expression.");
		return;
	}
	const request: SymPyRequest = {
		command: "matrix_operation",
		context: {
			chunk: symbolicContext.content,
			line: cursor.line - symbolicContext.startLine,
			char: cursor.ch,
			expression,
			wrt: "",
			operation,
		},
	};
	try {
		const response = await pythonBridge(plugin, request);
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe matrix error", response.error);
			return;
		}
		if (view.state.doc.toString() !== originalDocument) {
			new Notice("The note changed while SymPy was running; no text was replaced.");
			return;
		}
		view.dispatch({
			changes: { from, to, insert: response.latex },
			selection: { anchor: from + response.latex.length },
		});
	} catch (error) {
		new Notice(
			`Could not run SymPy: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe matrix bridge failure", error);
	}
}

async function submitDiff(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineDiff,
): Promise<void> {
	const active = activeDiffs.get(view);
	if (!active) return;
	const order = Number(parsed.orderRaw.trim() || "1");
	const cursor = active.editor.getCursor();
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const request: SymPyRequest = {
		command: "differentiate",
		context: {
			chunk: symbolicContext.content,
			line: cursor.line - symbolicContext.startLine,
			char: cursor.ch,
			expression: parsed.expression,
			wrt: parsed.wrt,
			order,
		},
	};

	try {
		const response = await pythonBridge(plugin, request);
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe SymPy error", response.error);
			return;
		}

		// Reparse after the asynchronous request. The document, not captured
		// offsets, remains authoritative; edited commands are never overwritten.
		const current = activeCommand(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.wrt !== parsed.wrt ||
			current.orderRaw !== parsed.orderRaw
		) {
			new Notice("The differentiate command changed while SymPy was running; no text was replaced.");
			return;
		}
		view.dispatch({
			changes: {
				from: current.commandFrom,
				to: current.commandTo,
				insert: response.latex,
			},
			selection: { anchor: current.commandFrom + response.latex.length },
		});
		activeDiffs.delete(view);
	} catch (error) {
		new Notice(
			`Could not run SymPy: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe Python bridge failure", error);
	}
}

async function submitIntegral(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineIntegral,
): Promise<void> {
	const active = activeIntegrals.get(view);
	if (!active) return;
	const cursor = active.editor.getCursor();
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const request: SymPyRequest = {
		command: "integrate",
		context: {
			chunk: symbolicContext.content,
			line: cursor.line - symbolicContext.startLine,
			char: cursor.ch,
			expression: parsed.expression,
			wrt: parsed.wrt,
		},
	};
	try {
		const response = await pythonBridge(plugin, request);
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe SymPy error", response.error);
			return;
		}
		const current = activeIntegral(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.wrt !== parsed.wrt
		) {
			new Notice("The integrate command changed while SymPy was running; no text was replaced.");
			return;
		}
		view.dispatch({
			changes: {
				from: current.commandFrom,
				to: current.commandTo,
				insert: response.latex,
			},
			selection: { anchor: current.commandFrom + response.latex.length },
		});
		activeIntegrals.delete(view);
	} catch (error) {
		new Notice(
			`Could not run SymPy: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe Python bridge failure", error);
	}
}

async function submitDefiniteIntegral(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineDefiniteIntegral,
): Promise<void> {
	const active = activeDefiniteIntegrals.get(view);
	if (!active) return;
	const cursor = active.editor.getCursor();
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const request: SymPyRequest = {
		command: "definite_integral",
		context: {
			chunk: symbolicContext.content,
			line: cursor.line - symbolicContext.startLine,
			char: cursor.ch,
			expression: parsed.expression,
			wrt: parsed.wrt,
			lower: parsed.lower,
			upper: parsed.upper,
		},
	};
	try {
		const response = await pythonBridge(plugin, request);
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe SymPy error", response.error);
			return;
		}
		const current = activeDefiniteIntegral(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.wrt !== parsed.wrt ||
			current.lower !== parsed.lower ||
			current.upper !== parsed.upper
		) {
			new Notice("The definite integral changed while SymPy was running; no text was replaced.");
			return;
		}
		view.dispatch({
			changes: {
				from: current.commandFrom,
				to: current.commandTo,
				insert: response.latex,
			},
			selection: { anchor: current.commandFrom + response.latex.length },
		});
		activeDefiniteIntegrals.delete(view);
	} catch (error) {
		new Notice(
			`Could not run SymPy: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe Python bridge failure", error);
	}
}

async function submitPDEAnalysis(
	plugin: LatexSuitePlugin,
	editor: Editor,
	view: EditorView,
	equation: string,
	range: { from: number; to: number },
	outerEnd: number,
): Promise<void> {
	const symbolicContext = grabSymbolicContext(editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const cursor = editor.getCursor();
	try {
		const response = await pythonBridge(plugin, {
			command: "pde_analyze_solve",
			context: {
				chunk: symbolicContext.content,
				line: cursor.line - symbolicContext.startLine,
				char: cursor.ch,
				expression: "",
				wrt: "",
				equation,
			},
		});
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe PDE error", response.error);
			return;
		}
		if (view.state.sliceDoc(range.from, range.to) !== equation) {
			new Notice("The PDE changed while SymPy was running; no result was inserted.");
			return;
		}
		const result = response.result;
		if (!result || result.kind === "separated") {
			new Notice("The PDE worker returned an unexpected response.");
			return;
		}
		const insertion =
			result.kind === "solved"
				? `\n\n$$\n${result.latex}\n$$`
				: `\n\n> **oScribe PDE:** ${result.message}`;
		view.dispatch({
			changes: { from: outerEnd, to: outerEnd, insert: insertion },
			selection: { anchor: outerEnd + insertion.length },
		});
		if (result.kind === "solved") {
			const conditionSummary = result.conditions.length
				? ` Conditions: ${result.conditions
						.map((item) => item.status)
						.join(", ")}.`
				: "";
			new Notice(`PDE solution verified.${conditionSummary}`);
		} else {
			new Notice(result.message);
		}
	} catch (error) {
		new Notice(
			`Could not run PDE analysis: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe PDE bridge failure", error);
	}
}

async function submitSolveSimplify(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineIntegral,
): Promise<void> {
	await submitTwoFieldOperation(
		plugin,
		view,
		parsed,
		"simplify_or_solve",
		activeSolveSimplifies,
		activeSolveSimplify,
	);
}

async function submitEvaluation(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineIntegral,
): Promise<void> {
	await submitTwoFieldOperation(
		plugin,
		view,
		parsed,
		"numerical_evaluate",
		activeEvaluations,
		activeEvaluation,
	);
}

async function submitFourierTransform(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedFourierTransform,
): Promise<void> {
	const active = activeFourierTransforms.get(view);
	if (!active) return;
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const cursor = active.editor.getCursor();
	try {
		const response = await pythonBridge(plugin, {
			command: "fourier_transform",
			context: {
				chunk: symbolicContext.content,
				line: cursor.line - symbolicContext.startLine,
				char: cursor.ch,
				expression: parsed.expression,
				wrt: parsed.variable,
				frequency: parsed.frequency,
			},
		});
		if (!response.ok) {
			new Notice(response.error.message);
			return;
		}
		const current = activeFourierTransform(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.variable !== parsed.variable ||
			current.frequency !== parsed.frequency
		) {
			new Notice("The Fourier transform command changed; no text was replaced.");
			return;
		}
		replaceInlineResult(view, current, response.latex);
		activeFourierTransforms.delete(view);
	} catch (error) {
		reportBridgeFailure("Fourier transform", error);
	}
}

async function submitFourierSeries(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedFourierSeries,
): Promise<void> {
	const active = activeFourierSeries.get(view);
	if (!active) return;
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const cursor = active.editor.getCursor();
	try {
		const response = await pythonBridge(plugin, {
			command: "fourier_series",
			context: {
				chunk: symbolicContext.content,
				line: cursor.line - symbolicContext.startLine,
				char: cursor.ch,
				expression: parsed.expression,
				wrt: parsed.variable,
				lower: parsed.lower,
				upper: parsed.upper,
				terms: parsed.terms.trim(),
			},
		});
		if (!response.ok) {
			new Notice(response.error.message);
			return;
		}
		const current = activeFourierSeriesCommand(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.variable !== parsed.variable ||
			current.lower !== parsed.lower ||
			current.upper !== parsed.upper ||
			current.terms !== parsed.terms
		) {
			new Notice("The Fourier series command changed; no text was replaced.");
			return;
		}
		replaceInlineResult(view, current, response.latex);
		activeFourierSeries.delete(view);
	} catch (error) {
		reportBridgeFailure("Fourier series", error);
	}
}

function replaceInlineResult(
	view: EditorView,
	parsed: { commandFrom: number; commandTo: number },
	latex: string,
): void {
	view.dispatch({
		changes: { from: parsed.commandFrom, to: parsed.commandTo, insert: latex },
		selection: { anchor: parsed.commandFrom + latex.length },
	});
}

function reportBridgeFailure(label: string, error: unknown): void {
	new Notice(
		`Could not calculate ${label}: ${
			error instanceof Error ? error.message : String(error)
		}`,
	);
	console.error(`oScribe ${label} bridge failure`, error);
}

async function submitTwoFieldOperation(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlineIntegral,
	command: "simplify_or_solve" | "numerical_evaluate",
	activeMap: WeakMap<EditorView, ActiveDiff>,
	reparse: (view: EditorView) => ParsedInlineIntegral | null,
): Promise<void> {
	const active = activeMap.get(view);
	if (!active) return;
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const cursor = active.editor.getCursor();
	const request: SymPyRequest = {
		command,
		context: {
			chunk: symbolicContext.content,
			line: cursor.line - symbolicContext.startLine,
			char: cursor.ch,
			expression: parsed.expression,
			wrt: parsed.wrt,
			precision:
				command === "numerical_evaluate" ? Number(parsed.wrt.trim()) : undefined,
		},
	};
	try {
		const response = await pythonBridge(plugin, request);
		if (!response.ok) {
			new Notice(response.error.message);
			console.error(`oScribe ${command} error`, response.error);
			return;
		}
		const current = reparse(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.wrt !== parsed.wrt
		) {
			new Notice("The command changed while SymPy was running; no text was replaced.");
			return;
		}
		view.dispatch({
			changes: {
				from: current.commandFrom,
				to: current.commandTo,
				insert: response.latex,
			},
			selection: { anchor: current.commandFrom + response.latex.length },
		});
		activeMap.delete(view);
	} catch (error) {
		new Notice(
			`Could not run SymPy: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error(`oScribe ${command} bridge failure`, error);
	}
}

async function submitPDESeparation(
	plugin: LatexSuitePlugin,
	view: EditorView,
	parsed: ParsedInlinePDE,
): Promise<void> {
	const active = activePDESeparations.get(view);
	if (!active) return;
	const symbolicContext = grabSymbolicContext(active.editor);
	if (!symbolicContext) {
		new Notice("Could not determine the current mathematical context.");
		return;
	}
	const cursor = active.editor.getCursor();
	try {
		const response = await pythonBridge(plugin, {
			command: "pde_separate",
			context: {
				chunk: symbolicContext.content,
				line: cursor.line - symbolicContext.startLine,
				char: cursor.ch,
				expression: "",
				wrt: "",
				equation: parsed.expression,
				function: parsed.function,
				ansatz: parsed.ansatz,
			},
		});
		if (!response.ok) {
			new Notice(response.error.message);
			console.error("oScribe PDE separation error", response.error);
			return;
		}
		const current = activePDESeparation(view);
		if (
			!current ||
			current.commandFrom !== parsed.commandFrom ||
			current.expression !== parsed.expression ||
			current.function !== parsed.function ||
			current.ansatz !== parsed.ansatz
		) {
			new Notice("The separation command changed while SymPy was running; no result was inserted.");
			return;
		}
		if (!response.result || response.result.kind !== "separated") {
			new Notice("The PDE worker returned an unexpected separation response.");
			return;
		}
		const restoredOuterEnd =
			current.outerTo -
			(current.commandTo - current.commandFrom) +
			current.expression.length;
		view.dispatch({
			changes: {
				from: current.commandFrom,
				to: current.commandTo,
				insert: current.expression,
			},
		});
		const insertion = `\n\n$$\n${response.result.latex}\n$$`;
		view.dispatch({
			changes: {
				from: restoredOuterEnd,
				to: restoredOuterEnd,
				insert: insertion,
			},
			selection: { anchor: restoredOuterEnd + insertion.length },
		});
		activePDESeparations.delete(view);
		new Notice("PDE separated into ordinary differential equations.");
	} catch (error) {
		new Notice(
			`Could not separate PDE: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		console.error("oScribe PDE bridge failure", error);
	}
}

interface ParsedInlineIntegral {
	expression: string;
	wrt: string;
	exprFrom: number;
	exprTo: number;
	wrtFrom: number;
	wrtTo: number;
	commandFrom: number;
	commandTo: number;
}

function parseInlineIntegral(view: EditorView): ParsedInlineIntegral | null {
	return parseTwoFieldCommand(view, INTEGRATE_COMMAND);
}

function parseTwoFieldCommand(
	view: EditorView,
	command: string,
): ParsedInlineIntegral | null {
	const ctx = getContextPlugin(view);
	const bounds = ctx.getInnerBounds();
	if (!bounds) return null;
	const doc = view.state.doc.toString();
	const cursor = view.state.selection.main.head;
	let start = doc.lastIndexOf(command + "{", cursor);
	if (start < bounds.inner_start) {
		start = doc.indexOf(command + "{", cursor);
	}
	if (start < bounds.inner_start || start >= bounds.inner_end) return null;
	const expression = parseBracedField(doc, start + command.length);
	if (!expression) return null;
	const wrt = parseBracedField(doc, expression.close + 1);
	if (!wrt) return null;
	const commandTo = wrt.close + 1;
	if (commandTo > bounds.inner_end || cursor < start || cursor > commandTo) return null;
	return {
		expression: doc.slice(expression.from, expression.to),
		wrt: doc.slice(wrt.from, wrt.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		wrtFrom: wrt.from,
		wrtTo: wrt.to,
		commandFrom: start,
		commandTo,
	};
}

interface ParsedInlineDefiniteIntegral extends ParsedInlineIntegral {
	lower: string;
	upper: string;
	lowerFrom: number;
	lowerTo: number;
	upperFrom: number;
	upperTo: number;
}

function parseInlineDefiniteIntegral(
	view: EditorView,
): ParsedInlineDefiniteIntegral | null {
	const ctx = getContextPlugin(view);
	const bounds = ctx.getInnerBounds();
	if (!bounds) return null;
	const doc = view.state.doc.toString();
	const cursor = view.state.selection.main.head;
	let start = doc.lastIndexOf(DEFINITE_INTEGRAL_COMMAND + "{", cursor);
	if (start < bounds.inner_start) {
		start = doc.indexOf(DEFINITE_INTEGRAL_COMMAND + "{", cursor);
	}
	if (start < bounds.inner_start || start >= bounds.inner_end) return null;
	const expression = parseBracedField(
		doc,
		start + DEFINITE_INTEGRAL_COMMAND.length,
	);
	if (!expression) return null;
	const wrt = parseBracedField(doc, expression.close + 1);
	if (!wrt) return null;
	const lower = parseBracedField(doc, wrt.close + 1);
	if (!lower) return null;
	const upper = parseBracedField(doc, lower.close + 1);
	if (!upper) return null;
	const commandTo = upper.close + 1;
	if (commandTo > bounds.inner_end || cursor < start || cursor > commandTo) return null;
	return {
		expression: doc.slice(expression.from, expression.to),
		wrt: doc.slice(wrt.from, wrt.to),
		lower: doc.slice(lower.from, lower.to),
		upper: doc.slice(upper.from, upper.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		wrtFrom: wrt.from,
		wrtTo: wrt.to,
		lowerFrom: lower.from,
		lowerTo: lower.to,
		upperFrom: upper.from,
		upperTo: upper.to,
		commandFrom: start,
		commandTo,
	};
}

interface ParsedFourierTransform {
	expression: string;
	variable: string;
	frequency: string;
	exprFrom: number;
	exprTo: number;
	variableFrom: number;
	variableTo: number;
	frequencyFrom: number;
	frequencyTo: number;
	commandFrom: number;
	commandTo: number;
}

interface ParsedFourierSeries {
	expression: string;
	variable: string;
	lower: string;
	upper: string;
	terms: string;
	exprFrom: number;
	exprTo: number;
	variableFrom: number;
	variableTo: number;
	lowerFrom: number;
	lowerTo: number;
	upperFrom: number;
	upperTo: number;
	termsFrom: number;
	termsTo: number;
	commandFrom: number;
	commandTo: number;
}

function parseFourierTransform(view: EditorView): ParsedFourierTransform | null {
	const parsed = parseCommandFields(view, FOURIER_TRANSFORM_COMMAND, 3);
	if (!parsed) return null;
	const [expression, variable, frequency] = parsed.fields;
	return {
		expression: parsed.doc.slice(expression.from, expression.to),
		variable: parsed.doc.slice(variable.from, variable.to),
		frequency: parsed.doc.slice(frequency.from, frequency.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		variableFrom: variable.from,
		variableTo: variable.to,
		frequencyFrom: frequency.from,
		frequencyTo: frequency.to,
		commandFrom: parsed.commandFrom,
		commandTo: parsed.commandTo,
	};
}

function parseFourierSeries(view: EditorView): ParsedFourierSeries | null {
	const parsed = parseCommandFields(view, FOURIER_SERIES_COMMAND, 5);
	if (!parsed) return null;
	const [expression, variable, lower, upper, terms] = parsed.fields;
	return {
		expression: parsed.doc.slice(expression.from, expression.to),
		variable: parsed.doc.slice(variable.from, variable.to),
		lower: parsed.doc.slice(lower.from, lower.to),
		upper: parsed.doc.slice(upper.from, upper.to),
		terms: parsed.doc.slice(terms.from, terms.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		variableFrom: variable.from,
		variableTo: variable.to,
		lowerFrom: lower.from,
		lowerTo: lower.to,
		upperFrom: upper.from,
		upperTo: upper.to,
		termsFrom: terms.from,
		termsTo: terms.to,
		commandFrom: parsed.commandFrom,
		commandTo: parsed.commandTo,
	};
}

function parseCommandFields(
	view: EditorView,
	command: string,
	count: number,
): {
	doc: string;
	fields: Array<{ from: number; to: number; close: number }>;
	commandFrom: number;
	commandTo: number;
} | null {
	const ctx = getContextPlugin(view);
	const bounds = ctx.getInnerBounds();
	if (!bounds) return null;
	const doc = view.state.doc.toString();
	const cursor = view.state.selection.main.head;
	let start = doc.lastIndexOf(command + "{", cursor);
	if (start < bounds.inner_start) start = doc.indexOf(command + "{", cursor);
	if (start < bounds.inner_start || start >= bounds.inner_end) return null;
	const fields: Array<{ from: number; to: number; close: number }> = [];
	let offset = start + command.length;
	for (let index = 0; index < count; index++) {
		const field = parseBracedField(doc, offset);
		if (!field) return null;
		fields.push(field);
		offset = field.close + 1;
	}
	const commandTo = fields[fields.length - 1].close + 1;
	if (commandTo > bounds.inner_end || cursor < start || cursor > commandTo) return null;
	return { doc, fields, commandFrom: start, commandTo };
}

interface ParsedInlinePDE {
	expression: string;
	function: string;
	ansatz: string;
	exprFrom: number;
	exprTo: number;
	functionFrom: number;
	functionTo: number;
	ansatzFrom: number;
	ansatzTo: number;
	commandFrom: number;
	commandTo: number;
	outerTo: number;
}

function parseInlinePDE(view: EditorView): ParsedInlinePDE | null {
	const ctx = getContextPlugin(view);
	const bounds = ctx.getInnerBounds();
	if (!bounds) return null;
	const doc = view.state.doc.toString();
	const cursor = view.state.selection.main.head;
	let start = doc.lastIndexOf(SEPARATE_PDE_COMMAND + "{", cursor);
	if (start < bounds.inner_start) {
		start = doc.indexOf(SEPARATE_PDE_COMMAND + "{", cursor);
	}
	if (start < bounds.inner_start || start >= bounds.inner_end) return null;
	const expression = parseBracedField(doc, start + SEPARATE_PDE_COMMAND.length);
	if (!expression) return null;
	const dependent = parseBracedField(doc, expression.close + 1);
	if (!dependent) return null;
	const ansatz = parseBracedField(doc, dependent.close + 1);
	if (!ansatz) return null;
	const commandTo = ansatz.close + 1;
	if (commandTo > bounds.inner_end || cursor < start || cursor > commandTo) return null;
	return {
		expression: doc.slice(expression.from, expression.to),
		function: doc.slice(dependent.from, dependent.to),
		ansatz: doc.slice(ansatz.from, ansatz.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		functionFrom: dependent.from,
		functionTo: dependent.to,
		ansatzFrom: ansatz.from,
		ansatzTo: ansatz.to,
		commandFrom: start,
		commandTo,
		outerTo: bounds.outer_end,
	};
}

export function parseInlineDiff(view: EditorView): ParsedInlineDiff | null {
	const ctx = getContextPlugin(view);
	const bounds = ctx.getInnerBounds();
	if (!bounds) return null;
	const doc = view.state.doc.toString();
	const selection = view.state.selection.main;
	const cursor = selection.head;

	let start = doc.lastIndexOf(COMMAND + "{", cursor);
	if (start < bounds.inner_start) {
		start = doc.indexOf(COMMAND + "{", cursor);
	}
	if (start < bounds.inner_start || start >= bounds.inner_end) return null;

	let offset = start + COMMAND.length;
	const expression = parseBracedField(doc, offset);
	if (!expression) return null;
	offset = expression.close + 1;
	const wrt = parseBracedField(doc, offset);
	if (!wrt) return null;
	offset = wrt.close + 1;
	const order = parseBracedField(doc, offset);
	if (!order) return null;
	const commandTo = order.close + 1;
	if (commandTo > bounds.inner_end) return null;
	if (cursor < start || cursor > commandTo) return null;

	return {
		expression: doc.slice(expression.from, expression.to),
		wrt: doc.slice(wrt.from, wrt.to),
		orderRaw: doc.slice(order.from, order.to),
		exprFrom: expression.from,
		exprTo: expression.to,
		wrtFrom: wrt.from,
		wrtTo: wrt.to,
		orderFrom: order.from,
		orderTo: order.to,
		commandFrom: start,
		commandTo,
		mathFrom: bounds.inner_start,
		mathTo: bounds.inner_end,
	};
}

function parseBracedField(
	doc: string,
	open: number,
): { from: number; to: number; close: number } | null {
	if (doc.charAt(open) !== "{") return null;
	let depth = 1;
	for (let index = open + 1; index < doc.length; index++) {
		const char = doc.charAt(index);
		if (char === "{" && !isEscaped(doc, index)) depth++;
		if (char === "}" && !isEscaped(doc, index)) depth--;
		if (depth === 0) {
			return { from: open + 1, to: index, close: index };
		}
	}
	return null;
}

function isEscaped(doc: string, index: number): boolean {
	let slashes = 0;
	for (let cursor = index - 1; cursor >= 0 && doc.charAt(cursor) === "\\"; cursor--) {
		slashes++;
	}
	return slashes % 2 === 1;
}
