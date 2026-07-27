# oScribe

oScribe is a desktop-only Obsidian plugin for writing LaTeX quickly and applying
symbolic mathematics without leaving the note.

It is a fork of
[Obsidian LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite), and
retains LaTeX Suite's snippets, tabstops, auto-fractions, matrix editing,
bracket handling, concealment, and inline previews. oScribe adds a mathematical
context, a TypeScript-to-Python bridge, and command-palette operations backed by
[SymPy](https://www.sympy.org/).

The intended workflow is not "open a separate computer algebra console." The
note is the interface:

1. Write mathematics normally inside `$...$` or `$$...$$`.
2. Put the cursor in an expression, or select the exact expression to operate
   on.
3. Invoke an `oScribe:` command from Obsidian's command palette.
4. Edit the inline command fields with the ordinary editor.
5. Press <kbd>Enter</kbd> to evaluate.

oScribe is under active development. Its symbolic operations are usable, but it
is not yet distributed as a polished Obsidian Community Plugin release.

## Contents

- [What oScribe adds](#what-oscribe-adds)
- [Requirements](#requirements)
- [Installation](#installation)
- [Python backend setup](#python-backend-setup)
- [Core editor interaction](#core-editor-interaction)
- [Mathematical context](#mathematical-context)
- [Symbolic commands](#symbolic-commands)
- [Matrices](#matrices)
- [Partial differential equations](#partial-differential-equations)
- [Fourier analysis](#fourier-analysis)
- [LaTeX parsing](#latex-parsing)
- [Architecture](#architecture)
- [Failure and safety behavior](#failure-and-safety-behavior)
- [Development and testing](#development-and-testing)
- [Known limitations](#known-limitations)
- [Upstream LaTeX Suite](#upstream-latex-suite)

## What oScribe adds

LaTeX Suite is an editor productivity system. oScribe keeps that system and
adds symbolic meaning:

- Variables, callable symbols, matrices, and mathematical constraints are
  recovered from earlier math in the current problem.
- Definitions are derived conservatively from constraints instead of being
  stored in a separate, competing database.
- The expression under the cursor can be differentiated, integrated,
  simplified, solved, numerically evaluated, transformed, or used in a matrix
  operation.
- Function and variable definitions are recursively resolved before an
  operation.
- First-order PDEs supported by SymPy can be classified, solved, and verified.
- Higher-order PDEs can be separated with a product ansatz where SymPy supports
  the separation.
- Standard LaTeX matrix environments and partial-derivative fractions are
  injected into the SymPy expression tree rather than being treated as
  meaningless text.

The plugin deliberately does **not** convert every equation into a global
substitution. A definition and a relation are different mathematical claims,
even though both can be represented by a SymPy `Eq`.

## Requirements

### Runtime

- Obsidian desktop. Mobile is not supported.
- A filesystem-backed Obsidian vault.
- Python with the packages in
  [`Python/requirements.txt`](Python/requirements.txt):
  - SymPy 1.14
  - ANTLR Python runtime 4.11
  - Lark 1.3.1

The plugin is marked `"isDesktopOnly": true` because it launches a local Python
process with Node's `child_process` API.

### Development

- Node.js and npm
- Python 3
- The TypeScript and Python dependencies described below

## Installation

### Development installation

Clone the repository into a normal development directory:

```bash
git clone https://github.com/0xykr/oScribe.git
cd oScribe/prod/oScribe
npm install
```

Create the project-local Python environment:

```bash
python3 -m venv Python/venv
Python/venv/bin/python -m pip install -r Python/requirements.txt
```

On Windows, use `Python\venv\Scripts\python.exe` and the corresponding `pip`.

Build the plugin:

```bash
npm run build
```

The directory loaded by Obsidian must contain at least:

```text
manifest.json
main.js
Python/
  oScribe.py
  math_context.py
  matrix_parser.py
  operations.py
  pde_operations.py
  venv/                 # recommended
```

For development, link the repository directory into a vault:

```bash
ln -s "/absolute/path/to/oScribe/prod/oScribe" \
  "/absolute/path/to/vault/.obsidian/plugins/oScribe"
```

Then enable **oScribe** under Obsidian → Settings → Community plugins. Reload
Obsidian after rebuilding if the development setup does not reload plugins
automatically.

### Python interpreter selection

At runtime, the bridge resolves paths from the installed Obsidian plugin
directory, not from the shell's current working directory.

Interpreter order:

1. `Python/venv/bin/python` on macOS/Linux, or
   `Python/venv/Scripts/python.exe` on Windows.
2. `python3` on macOS/Linux.
3. `python` on Windows.

Keeping the virtual environment inside the plugin directory is the most
predictable setup. A system interpreter works only if it already contains the
pinned dependencies.

## Python backend setup

The symbolic commands do not run SymPy inside JavaScript. Obsidian starts
`Python/oScribe.py` for each request, sends it one JSON object through standard
input, and reads one JSON object from standard output. A working `main.js`
without a working Python environment therefore gives you the LaTeX Suite editor
features but not the symbolic backend.

The following procedure sets up and verifies the backend independently of
Obsidian.

### 1. Open the actual plugin directory

Run these commands from the directory containing both `manifest.json` and the
`Python` folder:

```bash
pwd
test -f manifest.json
test -f Python/oScribe.py
```

On PowerShell:

```powershell
Get-Location
Test-Path manifest.json
Test-Path Python\oScribe.py
```

Both file checks must succeed. Creating `Python/venv` in a different checkout
will not help the copy or symlink that Obsidian actually loads.

### 2. Check Python

macOS/Linux:

```bash
python3 --version
```

Windows:

```powershell
python --version
```

If the command is missing, install Python before continuing. Do not install
SymPy globally merely to avoid creating the project environment; a local
environment makes the runtime reproducible and is the first interpreter oScribe
looks for.

### 3. Create the plugin-local virtual environment

macOS/Linux:

```bash
python3 -m venv Python/venv
```

Windows PowerShell:

```powershell
python -m venv Python\venv
```

Activation is optional. Every command below uses the environment's interpreter
directly, which avoids accidentally invoking a different Python from `PATH`.

### 4. Install the pinned packages

macOS/Linux:

```bash
Python/venv/bin/python -m pip install --upgrade pip
Python/venv/bin/python -m pip install -r Python/requirements.txt
```

Windows PowerShell:

```powershell
Python\venv\Scripts\python.exe -m pip install --upgrade pip
Python\venv\Scripts\python.exe -m pip install -r Python\requirements.txt
```

Do not omit the ANTLR and Lark dependencies. SymPy may import successfully while
LaTeX or matrix parsing still fails if only `sympy` was installed.

### 5. Verify imports and versions

macOS/Linux:

```bash
Python/venv/bin/python -c \
  "import sympy, antlr4, lark; print('SymPy', sympy.__version__); print('Lark', lark.__version__)"
```

Windows PowerShell:

```powershell
Python\venv\Scripts\python.exe -c "import sympy, antlr4, lark; print('SymPy', sympy.__version__); print('Lark', lark.__version__)"
```

The installed SymPy version should match `Python/requirements.txt`. When
debugging parser behavior, version drift matters: SymPy's LaTeX and PDE
implementations change between releases.

### 6. Test the JSON worker directly

macOS/Linux:

```bash
printf '%s\n' \
  '{"command":"differentiate","context":{"chunk":"","line":0,"char":0,"expression":"x^2","wrt":"x","order":1}}' \
  | Python/venv/bin/python Python/oScribe.py
```

Expected output:

```json
{"ok": true, "latex": "2 x"}
```

PowerShell:

```powershell
'{"command":"differentiate","context":{"chunk":"","line":0,"char":0,"expression":"x^2","wrt":"x","order":1}}' |
  Python\venv\Scripts\python.exe Python\oScribe.py
```

This test exercises the same entrypoint, imports, request envelope, dispatcher,
SymPy operation, and response serialization used by Obsidian. If it fails, fix
the Python environment before debugging CodeMirror or the command palette.

### 7. Confirm Obsidian loads the same directory

The active plugin directory should be:

```text
<vault>/.obsidian/plugins/oScribe/
```

It may be a symlink to the repository. Inside it, confirm that these paths
resolve:

```text
main.js
manifest.json
Python/oScribe.py
Python/venv/bin/python                 # macOS/Linux
Python/venv/Scripts/python.exe         # Windows
```

If you copied only `main.js` and `manifest.json`, the bridge will report:

```text
Python entrypoint not found
```

If the entrypoint exists but the local environment does not, oScribe falls back
to the system Python. That fallback is convenient for development, but it can
hide an incorrectly packaged plugin or select an interpreter without the pinned
packages.

### 8. Reload and perform an Obsidian smoke test

After building and enabling the plugin:

1. Create `$x^2$`.
2. Put the cursor on `x^2`.
3. Run **oScribe: `\differentiate`**.
4. Press <kbd>Enter</kbd> with the default `x` and order `1`.

The inner expression should become `2x` while both `$` delimiters remain in
place.

### Backend troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `Python entrypoint not found` | The active plugin directory does not contain `Python/oScribe.py` | Inspect `<vault>/.obsidian/plugins/oScribe` |
| `spawn ... ENOENT` | No plugin-local interpreter and fallback Python is missing from `PATH` | Create `Python/venv` in the active plugin directory |
| `No module named sympy`, `antlr4`, or `lark` | Dependencies were installed into another interpreter | Run `Python/venv/bin/python -m pip show sympy antlr4-python3-runtime lark` |
| JSON worker succeeds in Terminal but Obsidian fails | Obsidian is loading a different plugin copy, or `main.js` is stale | Resolve the plugin symlink and rebuild |
| `SymPy request timed out` | Symbolic work exceeded the 15-second bridge limit | Simplify assumptions/input, request a finite Fourier truncation, or inspect the Python operation |
| LaTeX parse errors despite SymPy importing | ANTLR version mismatch or unsupported LaTeX | Reinstall from `Python/requirements.txt` and test a minimal expression |
| Matrix parsing fails | Lark is missing or the matrix is ragged | Verify Lark and check every row has the same number of cells |
| Commands do nothing on mobile | Process spawning is unavailable | Use Obsidian desktop; the manifest is desktop-only |

### Production packaging

`main.js` is intentionally ignored by Git and must be built or included as a
release artifact. The Python source directory must also be shipped beside it.
The current build script bundles TypeScript only; it does not create a complete
release archive or install a Python environment for the user.

## Core editor interaction

### Command targeting

Most mathematical commands use this priority:

1. A non-empty selection contained inside the current math region.
2. Otherwise, the relation-delimited expression under the cursor.

For example, in:

```latex
$f'(x)=f(x)$
```

placing the cursor on the right side targets `f(x)`, while placing it on the
left targets `f'(x)`. Top-level `=`, `:=`, `\triangleq`, and `\circeq` markers
separate expression regions. Markers inside braces, parentheses, or brackets
do not.

PDE analysis is an exception: it needs the complete equation and therefore
targets the whole current math region unless an explicit equation is selected.

### Inline command scaffolds

Commands requiring parameters temporarily replace the target with an editable
LaTeX scaffold. For example, differentiation produces:

```latex
\differentiate{x^2}{x}{1}
```

While the cursor is inside an active oScribe scaffold:

- <kbd>Tab</kbd> selects the next field.
- <kbd>Shift</kbd>+<kbd>Tab</kbd> selects the previous field.
- <kbd>Enter</kbd> reparses the current document and submits the current field
  values.
- <kbd>Escape</kbd> removes the scaffold and restores its expression.

Outside an active scaffold, oScribe returns `false` from its key handlers. The
event continues to LaTeX Suite or Obsidian. oScribe does not install a competing
global Tab behavior.

### The document is authoritative

Field offsets are not captured once and trusted forever. Each navigation or
submission reparses the command from the current CodeMirror document. Editing
an early field can move every later field without corrupting the command.

When a Python request is running, successful output is applied only if the
source command or expression is still unchanged. If the note changed, oScribe
shows a notice and does not overwrite newer text.

### Math delimiters

`$...$` and `$$...$$` are containers, not operands. oScribe replaces only the
inner expression or command range. It does not remove and recreate math
wrappers.

## Mathematical context

### Problem chunks

The command **New Problem** inserts:

```markdown
<!--  -->
```

Standalone HTML comments divide a note into independent symbolic-context
chunks. Normal operations see mathematical constraints earlier than the cursor
within the current chunk. PDE analysis reads the complete chunk so that initial
or boundary conditions written below the PDE can also be checked.

### The core model: symbols and constraints

The backend has one canonical mathematical environment:

```text
MathContext
├── symbols
└── constraints
```

Functions and equations are not separate persistent universes. A function
application remains a SymPy expression type, and an equality remains a SymPy
relational type, but oScribe stores the entered mathematical statement as a
constraint.

### Constraint syntax

oScribe recognizes these top-level relation markers:

| Marker | Intended use |
| --- | --- |
| `:=` | Explicit variable definition |
| `\triangleq` | Explicit function definition |
| `=` | Shape-classified equality |
| `\circeq` | Explicit relational constraint; never a rewrite definition |

All equality constraints preserve the original relation with:

```python
sp.Eq(lhs, rhs, evaluate=False)
```

This prevents an entered mathematical statement from collapsing immediately to
Python `True` or `False`.

The command palette also contains helpers to insert the three explicit markers:

- **Insert Variable Definition**
- **Insert Function Definition**
- **Insert Equation Definition**

### Variable definitions

```latex
$a := 2$
```

is stored canonically as:

```python
Eq(a, 2, evaluate=False)
```

Because the left side is one symbol, oScribe derives a rewrite definition for
`a`. The symbol itself is not replaced by a Python assignment.

Example:

```latex
$a := 2$

$a x^2$
```

Running differentiation with respect to `x` resolves `a x^2` to `2x^2` and
returns `4x`.

### Function definitions

```latex
$f(x) \triangleq a x^3$
```

is stored as the original equality constraint. Operationally, oScribe derives:

```python
Lambda(x, a*x**3)
```

for definition expansion. Therefore, with `a := 2`, resolving `f(y)` produces
`2y^3`.

A function definition is recognized only when the left side is a bare
application of an undefined function to distinct symbols:

```latex
f(x) = ...
g(x,y) = ...
```

These are not automatically function definitions:

```latex
f(x+1)=x
f'(x)=f(x)
x^2+y^2=1
```

### Ordinary equations

```latex
$x^2+y^2 \circeq 1$
```

remains relational. It is not turned into `y = sqrt(1-x^2)` and is not used as
a global replacement rule. An explicit solve command may solve it for a chosen
variable, but ordinary context resolution does not.

### Resolution and cycles

Definitions are recursively expanded only when an operation requests a resolved
expression:

```latex
$a := 2$
$f(x) \triangleq a x^3$
$f(y)$
```

resolves through:

```text
f(y) → a y³ → 2y³
```

Cycles such as:

```latex
$a := b$
$b := a$
```

raise a structured `CyclicDefinition` error instead of recursing indefinitely.

## Symbolic commands

All commands below are available through Obsidian's command palette.

### Differentiate

Command:

```text
oScribe: \differentiate
```

Scaffold:

```latex
\differentiate{expression}{variable}{order}
```

Defaults:

```text
variable = x
order = 1
```

The differentiation variable must parse as one symbol, and the order must be a
positive integer.

Example:

```latex
$x^3+\sin x$
```

becomes:

```latex
$3x^2+\cos x$
```

### Indefinite integral

Command:

```text
oScribe: Indefinite integral
```

Scaffold:

```latex
\integrate{expression}{variable}
```

SymPy must eliminate every remaining `Integral` node. Pulling out a constant or
splitting a sum without actually evaluating the integral is reported as an
unevaluated result, and the original scaffold remains intact.

### Definite integral

Command:

```text
oScribe: Definite integral
```

Scaffold:

```latex
\definiteintegral{expression}{variable}{lower}{upper}
```

Defaults:

```text
variable = x
lower = 0
upper = 1
```

### Solve / Simplify

Command:

```text
oScribe: Solve / Simplify
```

Scaffold:

```latex
\solvesimplify{expression-or-equation}{variable}
```

If the first field is an expression, oScribe resolves definitions and applies
`sympy.simplify`.

If it is an equality, oScribe resolves both sides and calls `solveset` over the
complex domain for the selected variable. Results are written as set
membership:

```latex
$x^2=1$ \quad\longrightarrow\quad $x\in\{-1,1\}$
```

`ConditionSet` results are currently treated as unresolved rather than inserted
as a misleading closed-form solution.

### Numerical evaluation

Command:

```text
oScribe: Evaluate numerically
```

Scaffold:

```latex
\evaluate{expression}{precision}
```

The default precision is 15 decimal digits. Accepted precision is an integer
from 1 through 1000.

This operation uses SymPy arbitrary-precision evaluation. It is appropriate for
individual symbolic expressions, not large numerical arrays or discretized
PDEs. A future NumPy/SciPy backend can share the bridge, but would require
explicit numerical data, grids, tolerances, and algorithms.

## Matrices

### Matrix literals

oScribe recognizes standard LaTeX matrix environments:

```latex
\begin{matrix} ... \end{matrix}
\begin{pmatrix} ... \end{pmatrix}
\begin{bmatrix} ... \end{bmatrix}
\begin{Bmatrix} ... \end{Bmatrix}
\begin{vmatrix} ... \end{vmatrix}
\begin{Vmatrix} ... \end{Vmatrix}
```

Rows are separated by `\\` and cells by `&`.

`vmatrix` is interpreted as a determinant. `Vmatrix` is interpreted as the
Frobenius norm. The remaining environments produce concrete immutable matrices.
Ragged rows, empty cells, and matrices embedded inside a matrix cell are
rejected.

### Matrix definitions and declarations

A literal definition infers shape:

```latex
$$
A :=
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$
```

An abstract matrix may be declared by shape and domain:

```latex
$$
A \in \mathbb{R}^{m\times n}
$$
```

Supported domains are `\mathbb{R}` and `\mathbb{C}`. Dimensions must be
positive integers or symbols.

Known matrix names are registered as noncommutative `MatrixSymbol` objects.
Consequently, `AB` and `BA` preserve order rather than being simplified as
commutative scalar products.

### Matrix command palette operations

| Command | Requirement |
| --- | --- |
| Evaluate matrix expression | Matrix-valued expression |
| Matrix determinant | Square matrix expression |
| Matrix inverse | Invertible square matrix |
| Matrix transpose | Matrix expression |
| Matrix trace | Square matrix expression |
| Matrix norm | Explicit matrix |
| Matrix RREF | Explicit matrix |
| Matrix rank | Explicit matrix |
| Matrix nullspace | Explicit matrix |
| Matrix eigenvalues | Explicit square matrix |
| Matrix eigenvectors | Explicit square matrix |
| Matrix characteristic polynomial | Explicit square matrix |
| Diagonalize matrix | Diagonalizable Explicit square matrix |

These commands run immediately on the selected/current expression rather than
creating a scaffold.

### Nullspace output

A nontrivial nullspace is rendered as a span:

```latex
\operatorname{span}\left\{
\begin{bmatrix} \cdots \end{bmatrix},
\begin{bmatrix} \cdots \end{bmatrix}
\right\}
```

An empty basis returned by SymPy means the nullspace contains only the zero
vector. For an `n`-column matrix, oScribe renders:

```latex
\left\{\mathbf{0}_{n\times1}\right\}
```

This is not an empty vector space. It is the one-element set containing the
zero vector of the correct dimension.

## Partial differential equations

PDE support is a workbench around SymPy's limited PDE solver. It is not a
general-purpose boundary-value problem solver.

### Supported derivative notation

Use standard fraction notation:

```latex
\frac{\partial u(x,y)}{\partial x}
\frac{\partial^2 u(x,y)}{\partial x^2}
\frac{\partial^2 u(x,y)}{\partial x\partial y}
```

oScribe parses the balanced groups, verifies numerator/denominator order, and
injects unevaluated SymPy `Derivative` nodes into the expression tree.

Subscript notation such as `u_x`, `u_{xx}`, and `u_{xy}` is not interpreted as
a derivative because it is ambiguous with indexed symbols.

Every derivative in one PDE must act on the same explicit dependent function.
For example, this is rejected:

```latex
\frac{\partial u^2(x,y)}{\partial x}
+
\frac{\partial u(x,y)}{\partial y}
=0
```

Write the intended applied function in each numerator. This guard prevents a
malformed derivative from being simplified away as the derivative of an
unrelated symbol.

### Analyze / Solve PDE

Command:

```text
oScribe: Analyze / Solve PDE
```

The command:

1. Parses the complete equality.
2. Infers the one dependent function appearing inside derivatives.
3. Classifies the PDE with `classify_pde`.
4. Calls `pdsolve` only when SymPy reports a supported hint.
5. Verifies the returned solution with `checkpdesol`.
6. Checks relevant conditions in the current problem chunk.
7. Inserts the result below the original equation.

Example:

```latex
$$
\frac{\partial u(x,y)}{\partial x}
+
\frac{\partial u(x,y)}{\partial y}
=0
$$
```

returns a solution equivalent to:

```latex
u(x,y)=F(x-y)
```

SymPy 1.14 primarily implements first-order linear PDE families. Heat, wave,
Laplace, Burgers, systems of PDEs, and general boundary-value problems are not
directly solved by this command. Unsupported equations receive a diagnostic
rather than a fabricated result.

### Separate PDE

Command:

```text
oScribe: Separate PDE
```

Scaffold:

```latex
\separatepde{equation}{u(x,t)}{X(x)T(t)}
```

The ansatz must be a product of applied functions. Each factor must depend on
one distinct independent variable, and the factors together must cover every
independent variable.

For the heat equation:

```latex
\frac{\partial u(x,t)}{\partial t}
=
k\frac{\partial^2u(x,t)}{\partial x^2}
```

the default product ansatz separates the expression into relations equivalent
to:

```latex
\frac{X''(x)}{X(x)}=\lambda,
\qquad
\frac{T'(t)}{kT(t)}=\lambda.
```

The command does not solve the resulting ODEs or apply boundary conditions
automatically.

### Initial and boundary conditions

Conditions remain ordinary constraints:

```latex
$$
u(x,0)=g(x)
$$
```

When a candidate PDE solution is available, oScribe substitutes it into
relevant conditions and classifies each result as:

- `satisfied`
- `violated`
- `undetermined`

An undetermined arbitrary function is not guessed or silently solved.

## Fourier analysis

### Fourier transform

Command:

```text
oScribe: Calculate Fourier transform
```

Scaffold:

```latex
\fouriertransform{expression}{source-variable}{frequency-variable}
```

Defaults:

```text
source variable = x
frequency variable = k
```

The convention is SymPy's ordinary-frequency transform:

```latex
\mathcal{F}[f](k)
=
\int_{-\infty}^{\infty}f(x)e^{-2\pi i kx}\,dx.
```

For example:

```latex
\fouriertransform{\exp(-x^2)}{x}{k}
```

returns:

```latex
\sqrt{\pi}e^{-\pi^2k^2}.
```

If SymPy leaves a `FourierTransform` node unevaluated, oScribe reports that no
closed form was found and preserves the scaffold.

### Fourier series expansion

Command:

```text
oScribe: Calculate Fourier series expansion
```

Scaffold:

```latex
\fourierseries{expression}{variable}{lower}{upper}{terms}
```

Defaults:

```text
variable = x
lower = -\pi
upper = \pi
terms = \infty
```

Finite positive integers from 1 through 1000 request a truncated series:

```latex
\fourierseries{x}{x}{-\pi}{\pi}{3}
```

returns:

```latex
2\sin x-\sin(2x)+\frac{2}{3}\sin(3x).
```

The following values request an explicit infinite sigma formula:

```text
\infty
infty
infinity
oo
∞
```

For example:

```latex
\fourierseries{x}{x}{-\pi}{\pi}{\infty}
```

returns an equivalent form of:

```latex
\sum_{n=1}^{\infty}
-\frac{2(-1)^n\sin(nx)}{n}.
```

The infinite path computes the constant, cosine, and sine coefficients with a
positive integer harmonic symbol and constructs an actual SymPy `Sum`. It does
not merely append `+\ldots` to a finite truncation.

The interval cannot have zero length. Complicated symbolic coefficient
integrals may still hit the bridge timeout.

## LaTeX parsing

Generic LaTeX parsing is provided by SymPy's ANTLR parser. That parser does not
correctly represent every mathematical construct used by oScribe, so the
project adds a structural layer.

### AST injection

The parser:

1. Locates supported matrix environments and partial-derivative fractions.
2. Parses their balanced internal structure.
3. Replaces each construct with a collision-resistant atomic placeholder.
4. Parses the surrounding LaTeX expression.
5. Injects the concrete matrix or `Derivative` object at the placeholder.

Matrix expressions use a customized Lark transformer so registered matrix
symbols remain noncommutative.

This is deliberately narrower than attempting to rewrite arbitrary LaTeX with
regular expressions.

### Mathematical constants

At the shared expression boundary:

- `\pi` is normalized to SymPy's `pi`.
- mathematical `e` is normalized to SymPy's Euler constant `E`.

This matters for symbolic integration. Treating `e` in `e^{3x}` as an
unconstrained base can produce enormous conditional expressions involving
`log(e)` and cause avoidable timeouts.

### Parser boundaries

The parser is intentionally not a complete TeX engine. Unsupported macros,
custom semantic commands, ambiguous subscripts, and some deeply nested
constructs may fail or parse differently than their visual rendering suggests.
When exact symbolic meaning matters, inspect the source LaTeX rather than only
the MathJax preview.

## Architecture

### End-to-end data flow

```text
Obsidian math source
        │
        ▼
command-palette action
        │
        ▼
CodeMirror inline scaffold / direct operation
        │
        ├── current expression
        ├── current fields
        └── current problem chunk
        │
        ▼
TypeScript JSON bridge
        │
        ▼
one Python process per request
        │
        ▼
LaTeX parser + symbols + constraints
        │
        ▼
definition resolution
        │
        ▼
thin SymPy operation
        │
        ▼
structured JSON response
        │
        ▼
safe CodeMirror replacement
```

### TypeScript/editor layer

Important files:

```text
src/features/sympy_commands.ts
    command registration, math-mode checks, problem chunks

src/features/sympy_math_commands.ts
    command targeting, inline scaffolds, key ownership, result insertion

src/features/sympy_bridge.ts
    Python path resolution, process lifecycle, JSON protocol, timeout

src/main.ts
    plugin initialization and CodeMirror extension registration
```

Editor code does not implement mathematical semantics. It supplies source text
and parameters to Python.

### Python layer

```text
Python/oScribe.py
    one-request protocol dispatcher

Python/math_context.py
    symbols, canonical constraints, definition classification, resolution

Python/matrix_parser.py
    scalar LaTeX parsing, matrix parsing, partial-derivative AST injection

Python/operations.py
    scalar, Fourier, numerical, and matrix operations

Python/pde_operations.py
    PDE classification, solving, verification, conditions, separation
```

Operations are deliberately thin. Differentiation, for example, does not
contain separate branches for variables and function definitions:

```text
parse expression → context.resolve(expression) → sympy.diff
```

### Bridge protocol

Each request starts one Python process:

```text
spawn(interpreter, [script], shell=false)
```

The request is written as JSON to standard input. Python writes exactly one JSON
response to standard output and flushes it. Diagnostic tracebacks go to
standard error.

Conceptual request:

```json
{
  "command": "differentiate",
  "context": {
    "chunk": "$a := 2$",
    "line": 1,
    "char": 12,
    "expression": "a x^2",
    "wrt": "x",
    "order": 1
  }
}
```

Success:

```json
{
  "ok": true,
  "latex": "4 x"
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "type": "InvalidDifferentiationVariable",
    "message": "Expected a single symbol for the differentiation variable."
  }
}
```

The bridge timeout is currently 15 seconds. On timeout, the child process is
killed and the source note remains unchanged.

One process per request keeps lifecycle and failure handling simple. A future
newline-delimited persistent worker could reduce startup overhead, but would
need request IDs, crash recovery, pending-request rejection, and unload
cleanup.

## Failure and safety behavior

oScribe computes first and edits second.

These failures do not replace the target expression:

- Python is missing.
- The plugin-local virtual environment is incomplete.
- LaTeX cannot be parsed.
- A variable field contains an expression instead of one symbol.
- Derivative order, precision, Fourier term count, or matrix shape is invalid.
- A cyclic definition is encountered.
- SymPy leaves an integral or Fourier transform unevaluated.
- A PDE is ambiguous or unsupported.
- A matrix operation is invalid for the supplied shape.
- The request exceeds 15 seconds.
- The note changes while the request is running.
- The Python worker exits or emits invalid JSON.

The user sees a concise Obsidian `Notice`. Developer details are logged to the
console. Python tracebacks are never inserted into the note.

## Development and testing

### Install dependencies

```bash
npm install
python3 -m venv Python/venv
Python/venv/bin/python -m pip install -r Python/requirements.txt
```

### Development watcher

```bash
npm run dev
```

This starts esbuild in watch mode. It is not a finite validation command.

### Production build and typecheck

```bash
npm run build
```

This runs:

```text
tsc --noEmit --skipLibCheck
esbuild production bundle
```

For typechecking alone:

```bash
npm run tsc
```

### Python tests

From the plugin directory:

```bash
Python/venv/bin/python -m unittest discover -s Python -v
```

Or from `Python/`:

```bash
venv/bin/python -m unittest discover -v
```

Current focused suites:

```text
Python/test_math_context.py
    constraint classification, resolution, calculus, solve/simplify,
    numerical evaluation, Fourier operations

Python/test_matrix.py
    matrix parsing, declarations, shape checks, matrix operations

Python/test_pde.py
    partial parsing, PDE classification, solving, verification,
    separation, conditions, unsupported cases
```

### Direct worker smoke test

The Python entrypoint can be tested without Obsidian:

```bash
printf '%s\n' \
  '{"command":"differentiate","context":{"chunk":"","line":0,"char":0,"expression":"x^2","wrt":"x","order":1}}' \
  | Python/venv/bin/python Python/oScribe.py
```

Expected response:

```json
{"ok": true, "latex": "2 x"}
```

### Adding an operation

A new symbolic operation normally requires:

1. A thin Python function that parses input, resolves definitions, invokes
   SymPy, validates unevaluated output, and returns LaTeX.
2. A dispatcher branch in `Python/oScribe.py`.
3. Request fields and command discriminants in `sympy_bridge.ts`.
4. A command-palette action and, when needed, a document-derived scaffold in
   `sympy_math_commands.ts`.
5. Python unit tests and a direct protocol smoke test.
6. A production TypeScript build.

Do not place SymPy semantics in TypeScript or process-spawning code in
CodeMirror handlers.

## Known limitations

- Desktop only.
- Installation is currently developer-oriented.
- The Python environment is not automatically provisioned.
- Every symbolic request pays Python process startup cost.
- Requests time out after 15 seconds.
- SymPy's LaTeX parser is permissive and incomplete.
- Subscript partial-derivative notation is not supported.
- General PDE solving is far beyond SymPy's implemented PDE families.
- PDE conditions are checked but not generally applied to solve arbitrary
  functions or constants.
- PDE systems are not supported.
- PDE separation supports multiplicative product ansätze, not arbitrary
  additive or nonlinear separation strategies.
- Solve / Simplify solves one equality for one symbol over the complex domain.
- Numerical evaluation is SymPy-based and is not a NumPy/SciPy large-scale
  numerical engine.
- Abstract matrix differentiation and integration are not supported.
- Several matrix algorithms require a concrete matrix.
- Infinite Fourier coefficients can still be expensive for complicated
  symbolic expressions.
- There is no automated CodeMirror integration test harness yet; editor
  behavior is validated through build checks, pure parsing logic, and manual
  Obsidian testing.

## Upstream LaTeX Suite

oScribe exists because LaTeX Suite already provides an unusually effective
math-writing experience. The fork retains upstream behavior including:

- configurable snippets and snippet variables
- automatic and regex snippets
- tabstops
- auto-fractions
- matrix editing shortcuts
- tab-out behavior
- automatic bracket enlargement
- bracket coloring and matching
- optional concealment
- inline math previews
- visual snippets
- equation selection and boxing commands

For the full snippet language and inherited editor settings, see:

- [LaTeX Suite repository](https://github.com/artisticat1/obsidian-latex-suite)
- [`DOCS.md`](DOCS.md)

The original project is by
[artisticat1](https://github.com/artisticat1) and is inspired by
[Gilles Castel's mathematical note-taking workflow](https://castel.dev/post/lecture-notes-1/).

## License

oScribe retains the upstream MIT license. See [`LICENSE.md`](LICENSE.md).
