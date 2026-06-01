import LatexSuitePlugin from "src/main";
import { Editor, MarkdownView, Notice } from "obsidian"
import { EditorView } from "@codemirror/view";
import { getContextPlugin } from "src/utils/context";

function ensureMathMode(
    editor: Editor,
    thing: string
): boolean {
    const cm = (editor as any).cm as EditorView;

    if (!cm) {
        new Notice("Could not access CodeMirror editor");
        return false;
    }

    const ctx = getContextPlugin(cm);

    if (!ctx.mode.inMath()) {
        new Notice(
            `Cannot define ${thing} outside of math mode`
        );
        return false;
    }

    return true;
}

function grabSymbolicContext(editor: Editor) {
    const cursor = editor.getCursor();
    const content = editor.getValue();

    const lines = content.split("\n");

    if (/^\s*<!--.*-->\s*$/.test(lines[cursor.line])) {
        return null;
    }

    const boundaries = [-1];

    lines.forEach((line, index) => {
        if (/<!--.*-->/.test(line)) {
            boundaries.push(index);
        }
    });

    boundaries.push(lines.length);

    let start = 0;
    let end = lines.length;

    for (let i = 0; i < boundaries.length - 1; i++) {
        if (
            cursor.line > boundaries[i] &&
            cursor.line < boundaries[i + 1]
        ) {
            start = boundaries[i] + 1;
            end = boundaries[i + 1];
            break;
        }
    }

    return {
        startLine: start,
        endLine: end,
        content: lines.slice(start, end).join("\n"),
    };
}

export const getSymPyCommands = (plugin: LatexSuitePlugin) => {
    return [
        getSympyTestCommand(plugin),
        getNewContextChunkCommand(plugin),
        getCursorMathContext(plugin),
        insertVariableDefinition(plugin),
		insertFunctionDefinition(plugin),
        insertEquationDefinition(plugin),
    ];
};

const getSympyTestCommand = (
    plugin: LatexSuitePlugin
) => ({
    id: "oscribe-sympy-test",
    name: "oScribe SymPy Test",

    editorCallback: async (editor: Editor) => {
        const context = grabSymbolicContext(editor);

        console.log(context);

        new Notice("HELLO", 5000);
    },
});


const getCursorMathContext = (editor) => ({
		id: "oscribe"
});


const getNewContextChunkCommand = (
    plugin: LatexSuitePlugin
) => ({
    id: "oscribe-new-context-chunk",
    name: "New Problem",

	editorCallback: async (editor: Editor) => {
    	const cursor = editor.getCursor();

    	const comment = "\n\n<!--  -->\n\n";

    	editor.replaceRange(
        	comment,
        	{
            	line: cursor.line,
            	ch: editor.getLine(cursor.line).length,
        	}
    	);

    	editor.setCursor({
        	line: cursor.line + 2,
        	ch: "<!-- ".length,
    	});
	},
});

const insertEquationDefinition = (
    plugin: LatexSuitePlugin
) => ({
    id: "oscribe-insert-equation-definition",
    name: "Insert Equation Definition",

    editorCallback: (
        editor: Editor,
        _view: MarkdownView
    ) => {
        if (!ensureMathMode(editor, "equation")) {
            return;
        }

        editor.replaceSelection("\\circeq");
    },
});

const insertVariableDefinition = (
    plugin: LatexSuitePlugin
) => ({
    id: "oscribe-insert-variable-definition",
    name: "Insert Variable Definition",

    editorCallback: (
        editor: Editor,
        _view: MarkdownView
    ) => {
        if (!ensureMathMode(editor, "variable")) {
            return;
        }

        editor.replaceSelection(":=");
    },
});

const insertFunctionDefinition = (
    plugin: LatexSuitePlugin
) => ({
    id: "oscribe-insert-function-definition",
    name: "Insert Function Definition",

    editorCallback: (
        editor: Editor,
        _view: MarkdownView
    ) => {
        if (!ensureMathMode(editor, "function")) {
            return;
        }

        editor.replaceSelection("\\triangleq");
    },
});
