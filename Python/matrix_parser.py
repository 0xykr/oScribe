"""Matrix-aware LaTeX parsing layered over SymPy's scalar parser."""

from __future__ import annotations

from collections.abc import Mapping
import re

import sympy as sp
from sympy.parsing.latex import parse_latex


MATRIX_ENVIRONMENTS = {
    "matrix",
    "pmatrix",
    "bmatrix",
    "Bmatrix",
    "vmatrix",
    "Vmatrix",
}


class MatrixParseError(Exception):
    pass


def parse_math(
    source: str,
    matrix_symbols: Mapping[str, sp.MatrixExpr] | None = None,
) -> sp.Basic:
    source = source.strip()
    known = dict(matrix_symbols or {})
    normalized, partials = _extract_partials(source, known)
    normalized, matrices = _extract_matrices(normalized, {**known, **partials})
    extracted = {**partials, **matrices}
    registry = {**known, **extracted}
    normalized = _insert_partial_products(normalized)
    normalized = _insert_matrix_products(normalized, registry)
    if not extracted and not _mentions_matrix_symbol(normalized, known):
        return parse_latex(normalized, strict=False)
    return _parse_lark(normalized, registry)


def _insert_partial_products(source: str) -> str:
    placeholder = r"\\mathit\{ospartial[a-z]+\}"
    source = re.sub(
        rf"([A-Za-z0-9)}}\)])(\s*)({placeholder})",
        r"\1\2\\cdot \3",
        source,
    )
    source = re.sub(
        rf"({placeholder})(\s*)(?=[A-Za-z\\])",
        r"\1\2\\cdot ",
        source,
    )
    return source


def _extract_partials(
    source: str,
    known: Mapping[str, sp.MatrixExpr],
) -> tuple[str, dict[str, sp.Basic]]:
    extracted: dict[str, sp.Basic] = {}
    output: list[str] = []
    cursor = 0
    while cursor < len(source):
        start = source.find(r"\frac", cursor)
        if start < 0:
            output.append(source[cursor:])
            break
        output.append(source[cursor:start])
        numerator = _braced_group(source, start + len(r"\frac"))
        if numerator is None:
            output.append(source[start : start + len(r"\frac")])
            cursor = start + len(r"\frac")
            continue
        denominator = _braced_group(source, numerator[1])
        if denominator is None:
            output.append(source[start:numerator[1]])
            cursor = numerator[1]
            continue
        derivative = _partial_derivative(
            numerator[0],
            denominator[0],
            known,
        )
        if derivative is None:
            output.append(source[start:denominator[1]])
        else:
            name = "ospartial" + _alphabetic_index(len(extracted))
            extracted[name] = derivative
            output.append(rf"\mathit{{{name}}}")
        cursor = denominator[1]
    return "".join(output), extracted


def _partial_derivative(
    numerator: str,
    denominator: str,
    known: Mapping[str, sp.MatrixExpr],
) -> sp.Derivative | None:
    numerator_match = re.fullmatch(
        r"\s*\\partial\s*(?:\^\s*(?:\{\s*(\d+)\s*\}|(\d+)))?\s*(.+?)\s*",
        numerator,
        re.DOTALL,
    )
    if numerator_match is None:
        return None
    numerator_order = int(
        numerator_match.group(1) or numerator_match.group(2) or "1"
    )
    operand_source = numerator_match.group(3)
    factors = list(
        re.finditer(
            r"\\partial\s*"
            r"(\\[A-Za-z]+|[A-Za-z])\s*"
            r"(?:\^\s*(?:\{\s*(\d+)\s*\}|(\d+)))?",
            denominator,
        )
    )
    if not factors:
        return None
    consumed = "".join(match.group(0) for match in factors)
    if re.sub(r"\s+", "", consumed) != re.sub(r"\s+", "", denominator):
        return None
    variables: list[tuple[sp.Symbol, int]] = []
    total_order = 0
    for factor in factors:
        variable = parse_latex(factor.group(1), strict=False)
        if not isinstance(variable, sp.Symbol):
            raise MatrixParseError("A partial derivative variable must be a symbol.")
        order = int(factor.group(2) or factor.group(3) or "1")
        if order < 1:
            raise MatrixParseError("Partial derivative orders must be positive.")
        variables.append((variable, order))
        total_order += order
    if numerator_order != total_order:
        raise MatrixParseError(
            "Partial derivative numerator and denominator orders do not match."
        )
    operand = parse_math(operand_source, known)
    return sp.Derivative(operand, *variables, evaluate=False)


def _braced_group(source: str, start: int) -> tuple[str, int] | None:
    while start < len(source) and source[start].isspace():
        start += 1
    if start >= len(source) or source[start] != "{":
        return None
    depth = 1
    cursor = start + 1
    while cursor < len(source):
        if source[cursor] == "{" and source[cursor - 1] != "\\":
            depth += 1
        elif source[cursor] == "}" and source[cursor - 1] != "\\":
            depth -= 1
            if depth == 0:
                return source[start + 1 : cursor], cursor + 1
        cursor += 1
    return None


def _alphabetic_index(index: int) -> str:
    letters = ""
    value = index
    while True:
        letters = chr(ord("a") + value % 26) + letters
        value = value // 26 - 1
        if value < 0:
            return letters


def _parse_lark(source: str, registry: Mapping[str, sp.MatrixExpr]) -> sp.Basic:
    try:
        from sympy.parsing.latex.lark import (
            LarkLaTeXParser,
            TransformToSymPyExpr,
        )
    except ImportError as error:
        raise MatrixParseError(
            "Matrix parsing requires the project's pinned lark dependency."
        ) from error

    class MatrixTransformer(TransformToSymPyExpr):
        def SYMBOL(self, token):
            name = str(token)
            if name.startswith("\\"):
                name = name[1:]
            return registry.get(name, sp.Symbol(name))

        def multi_letter_symbol(self, tokens):
            name = str(tokens[2])
            return registry.get(name, super().multi_letter_symbol(tokens))

        def adjacent_expressions(self, tokens):
            left, right = tokens
            if _is_matrix(left) or _is_matrix(right):
                return sp.MatMul(left, right)
            return super().adjacent_expressions(tokens)

        def matrix(self, tokens):
            return sp.ImmutableMatrix(super().matrix(tokens))

    try:
        return LarkLaTeXParser(transformer=MatrixTransformer).doparse(source)
    except Exception as error:
        raise MatrixParseError(f"Could not parse matrix expression: {source}") from error


def _extract_matrices(
    source: str,
    known: Mapping[str, sp.MatrixExpr],
) -> tuple[str, dict[str, sp.Basic]]:
    extracted: dict[str, sp.Basic] = {}
    cursor = 0
    output: list[str] = []
    while True:
        match = re.search(r"\\begin\{([A-Za-z]+)\}", source[cursor:])
        if not match:
            output.append(source[cursor:])
            break
        start = cursor + match.start()
        environment = match.group(1)
        if environment not in MATRIX_ENVIRONMENTS:
            output.append(source[cursor : cursor + match.end()])
            cursor += match.end()
            continue
        body_start = cursor + match.end()
        end = _matching_environment_end(source, body_start, environment)
        if end is None:
            raise MatrixParseError(f"Missing \\end{{{environment}}}.")
        end_start, end_after = end
        body = source[body_start:end_start]
        matrix = _parse_matrix_body(body, known)
        value: sp.Basic
        if environment == "vmatrix":
            if matrix.rows != matrix.cols:
                raise MatrixParseError("A determinant requires a square matrix.")
            value = matrix.det()
        elif environment == "Vmatrix":
            value = matrix.norm("frobenius")
        else:
            value = matrix
        name = _placeholder_name(len(extracted))
        extracted[name] = value
        output.extend((source[cursor:start], rf"\mathit{{{name}}}"))
        cursor = end_after
    return "".join(output), extracted


def _matching_environment_end(
    source: str,
    body_start: int,
    environment: str,
) -> tuple[int, int] | None:
    begin_token = f"\\begin{{{environment}}}"
    end_token = f"\\end{{{environment}}}"
    depth = 1
    cursor = body_start
    while cursor < len(source):
        next_begin = source.find(begin_token, cursor)
        next_end = source.find(end_token, cursor)
        if next_end < 0:
            return None
        if 0 <= next_begin < next_end:
            depth += 1
            cursor = next_begin + len(begin_token)
            continue
        depth -= 1
        if depth == 0:
            return next_end, next_end + len(end_token)
        cursor = next_end + len(end_token)
    return None


def _parse_matrix_body(
    body: str,
    known: Mapping[str, sp.MatrixExpr],
) -> sp.ImmutableMatrix:
    row_sources = _split_top_level(body, r"\\")
    if row_sources and not row_sources[-1].strip():
        row_sources.pop()
    if not row_sources or any(not row.strip() for row in row_sources):
        raise MatrixParseError("Matrix rows cannot be empty.")
    rows: list[list[sp.Basic]] = []
    width: int | None = None
    for row_source in row_sources:
        cells = _split_top_level(row_source, "&")
        if any(not cell.strip() for cell in cells):
            raise MatrixParseError("Matrix cells cannot be empty.")
        if width is None:
            width = len(cells)
        elif len(cells) != width:
            raise MatrixParseError("All matrix rows must have the same length.")
        row: list[sp.Basic] = []
        for cell in cells:
            value = parse_math(cell, known)
            if _is_matrix(value):
                raise MatrixParseError("A matrix cannot be used as a matrix entry.")
            row.append(value)
        rows.append(row)
    return sp.ImmutableMatrix(rows)


def _split_top_level(source: str, delimiter: str) -> list[str]:
    pieces: list[str] = []
    start = 0
    braces = parentheses = brackets = 0
    index = 0
    while index < len(source):
        char = source[index]
        escaped = index > 0 and source[index - 1] == "\\"
        if not escaped:
            braces += int(char == "{") - int(char == "}")
            parentheses += int(char == "(") - int(char == ")")
            brackets += int(char == "[") - int(char == "]")
        if (
            braces == parentheses == brackets == 0
            and source.startswith(delimiter, index)
        ):
            pieces.append(source[start:index])
            index += len(delimiter)
            start = index
            continue
        index += 1
    pieces.append(source[start:])
    return pieces


def _mentions_matrix_symbol(
    source: str,
    known: Mapping[str, sp.MatrixExpr],
) -> bool:
    return any(name in source for name in known)


def _placeholder_name(index: int) -> str:
    # A control-sequence symbol remains one atomic token in the Lark grammar.
    letters = ""
    value = index
    while True:
        letters = chr(ord("a") + value % 26) + letters
        value = value // 26 - 1
        if value < 0:
            return "osmatrix" + letters


def _insert_matrix_products(
    source: str,
    registry: Mapping[str, sp.Basic],
) -> str:
    matrix_names = [
        name for name, value in registry.items() if _is_matrix(value)
    ]
    placeholder = r"\\mathit\{osmatrix[a-z]+\}"
    source = re.sub(
        rf"({placeholder})(\s*)(?={placeholder})",
        r"\1\2\\cdot ",
        source,
    )
    for name in sorted(matrix_names, key=len, reverse=True):
        if name.startswith("osmatrix"):
            continue
        source = re.sub(
            rf"({placeholder})(\s*)(?={re.escape(name)}(?![A-Za-z]))",
            r"\1\2\\cdot ",
            source,
        )
        source = re.sub(
            rf"(?<![A-Za-z])({re.escape(name)})(\s*)(?={placeholder})",
            r"\1\2\\cdot ",
            source,
        )
    return source


def _is_matrix(value: object) -> bool:
    return bool(getattr(value, "is_Matrix", False))
