"""Canonical symbols + constraints model for oScribe."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable

import sympy as sp
from sympy.core.function import AppliedUndef
from sympy.sets.sets import Set

from matrix_parser import parse_math


class MathContextError(Exception):
    """Base class for errors safe to return through the JSON protocol."""


class ParseError(MathContextError):
    pass


class CyclicDefinition(MathContextError):
    pass


class MatrixShapeError(MathContextError):
    pass


class MatrixSpace(Set):
    def __new__(cls, rows, cols, domain):
        return sp.Basic.__new__(
            cls,
            sp.sympify(rows),
            sp.sympify(cols),
            domain,
        )

    @property
    def rows(self):
        return self.args[0]

    @property
    def cols(self):
        return self.args[1]

    @property
    def domain(self):
        return self.args[2]

    def _contains(self, other):
        if getattr(other, "is_Matrix", False):
            return sp.And(sp.Eq(other.rows, self.rows), sp.Eq(other.cols, self.cols))
        return sp.S.false

    def _latex(self, printer):
        domain = "R" if self.domain == sp.S.Reals else "C"
        return (
            rf"\mathbb{{{domain}}}"
            rf"^{{{printer._print(self.rows)} \times {printer._print(self.cols)}}}"
        )


@dataclass(frozen=True)
class Definition:
    kind: str
    name: str
    value: sp.Basic


@dataclass(frozen=True)
class Constraint:
    relation: sp.Basic
    marker: str

    def definition(self) -> Definition | None:
        """Derive conservative rewrite metadata from the canonical relation."""
        if self.marker == r"\circeq":
            return None
        if not isinstance(self.relation, sp.Equality):
            return None
        lhs = self.relation.lhs
        rhs = self.relation.rhs
        if isinstance(lhs, sp.MatrixSymbol):
            return Definition("matrix", lhs.name, rhs)
        if isinstance(lhs, sp.Symbol):
            return Definition("symbol", lhs.name, rhs)
        if (
            isinstance(lhs, AppliedUndef)
            and "'" not in lhs.func.__name__
            and "prime" not in lhs.func.__name__.lower()
            and all(isinstance(arg, sp.Symbol) for arg in lhs.args)
            and len(set(lhs.args)) == len(lhs.args)
        ):
            return Definition(
                "function",
                lhs.func.__name__,
                sp.Lambda(tuple(lhs.args), rhs),
            )
        return None


class MathContext:
    """One source of truth: named expression objects and entered constraints."""

    def __init__(self) -> None:
        self.symbols: dict[str, sp.Basic] = {}
        self.constraints: list[Constraint] = []

    def add_constraint(self, constraint: Constraint) -> None:
        self.constraints.append(constraint)
        for symbol in constraint.relation.free_symbols:
            if isinstance(symbol, sp.MatrixSymbol):
                self.symbols[symbol.name] = symbol
            else:
                self.symbols.setdefault(symbol.name, symbol)
        for function in constraint.relation.atoms(AppliedUndef):
            self.symbols.setdefault(function.func.__name__, function.func)

    def matrix_symbols(self) -> dict[str, sp.MatrixExpr]:
        return {
            name: value
            for name, value in self.symbols.items()
            if isinstance(value, sp.MatrixExpr)
        }

    def definitions(self) -> dict[tuple[str, str], Definition]:
        derived: dict[tuple[str, str], Definition] = {}
        for constraint in self.constraints:
            definition = constraint.definition()
            if definition is not None:
                derived[(definition.kind, definition.name)] = definition
        return derived

    def relational_constraints(self) -> list[Constraint]:
        return [item for item in self.constraints if item.definition() is None]

    def resolve(self, expression: sp.Expr) -> sp.Expr:
        definitions = self.definitions()

        def visit(node: sp.Basic, stack: frozenset[tuple[str, str]]) -> sp.Basic:
            if isinstance(node, sp.MatrixSymbol):
                key = ("matrix", node.name)
                definition = definitions.get(key)
                if definition is None:
                    return node
                if key in stack:
                    raise CyclicDefinition(
                        f"Cyclic definition encountered while resolving {node.name}."
                    )
                return visit(definition.value, stack | {key})

            if isinstance(node, sp.Symbol):
                key = ("symbol", node.name)
                definition = definitions.get(key)
                if definition is None:
                    return node
                if key in stack:
                    raise CyclicDefinition(
                        f"Cyclic definition encountered while resolving {node.name}."
                    )
                return visit(definition.value, stack | {key})

            if isinstance(node, AppliedUndef):
                key = ("function", node.func.__name__)
                arguments = tuple(visit(arg, stack) for arg in node.args)
                definition = definitions.get(key)
                if definition is None:
                    return node.func(*arguments)
                if key in stack:
                    raise CyclicDefinition(
                        f"Cyclic definition encountered while resolving {node.func.__name__}."
                    )
                assert isinstance(definition.value, sp.Lambda)
                applied = definition.value(*arguments)
                return visit(applied, stack | {key})

            if isinstance(node, sp.MatrixBase):
                return sp.ImmutableMatrix(
                    node.rows,
                    node.cols,
                    [visit(entry, stack) for entry in node],
                )

            if not node.args:
                return node
            arguments = tuple(visit(arg, stack) for arg in node.args)
            try:
                return node.func(*arguments)
            except TypeError:
                return node

        return visit(expression, frozenset())


RELATION_MARKERS = (r"\triangleq", r"\circeq", ":=", "=")


def parse_expression(
    source: str,
    matrix_symbols: dict[str, sp.MatrixExpr] | None = None,
) -> sp.Basic:
    source = source.strip()
    if not source or source == r"\placeholder":
        raise ParseError("Expected a mathematical expression.")
    try:
        parsed = parse_math(source, matrix_symbols)
    except Exception as error:
        raise ParseError(
            f"Could not parse LaTeX expression: {source}. {error}"
        ) from error
    if not isinstance(parsed, sp.Basic):
        raise ParseError("Expected an expression rather than a relation.")
    return parsed


def parse_constraint(
    source: str,
    context: MathContext | None = None,
) -> Constraint | None:
    context = context or MathContext()
    declaration = _parse_matrix_declaration(source)
    if declaration is not None:
        name, rows, cols, domain = declaration
        existing = context.symbols.get(name)
        if isinstance(existing, sp.MatrixExpr) and existing.shape != (rows, cols):
            raise MatrixShapeError(
                f"Matrix {name} was already declared with shape {existing.shape}."
            )
        matrix = sp.MatrixSymbol(name, rows, cols)
        context.symbols[name] = matrix
        relation = sp.Contains(
            matrix,
            MatrixSpace(rows, cols, domain),
            evaluate=False,
        )
        return Constraint(relation, r"\in")

    split = _split_top_level_relation(source)
    if split is None:
        return None
    lhs_source, marker, rhs_source = split
    rhs = parse_expression(rhs_source, context.matrix_symbols())
    if getattr(rhs, "is_Matrix", False) and re.fullmatch(
        r"[A-Za-z]", lhs_source.strip()
    ):
        name = lhs_source.strip()
        existing = context.symbols.get(name)
        if isinstance(existing, sp.MatrixExpr) and existing.shape != rhs.shape:
            raise MatrixShapeError(
                f"Matrix {name} has shape {existing.shape}, not {rhs.shape}."
            )
        lhs = sp.MatrixSymbol(name, rhs.rows, rhs.cols)
        context.symbols[name] = lhs
    else:
        lhs = parse_expression(lhs_source, context.matrix_symbols())
    if (
        isinstance(lhs, sp.MatrixExpr)
        and getattr(rhs, "is_Matrix", False)
        and lhs.shape != rhs.shape
    ):
        raise MatrixShapeError(
            f"Cannot constrain matrix shapes {lhs.shape} and {rhs.shape}."
        )
    return Constraint(sp.Eq(lhs, rhs, evaluate=False), marker)


def parse_context(markdown: str, up_to_line: int | None = None) -> MathContext:
    if up_to_line is not None:
        markdown = "\n".join(markdown.splitlines()[: max(0, up_to_line)])
    context = MathContext()
    for segment in _math_segments(markdown):
        constraint = parse_constraint(segment, context)
        if constraint is not None:
            context.add_constraint(constraint)
    return context


def _math_segments(markdown: str) -> Iterable[str]:
    occupied: list[tuple[int, int]] = []
    for match in re.finditer(r"\$\$(.*?)\$\$", markdown, re.DOTALL):
        occupied.append(match.span())
        yield match.group(1).strip()
    for match in re.finditer(r"(?<!\\)\$(?!\$)(.*?)(?<!\\)\$", markdown):
        if not any(start <= match.start() < end for start, end in occupied):
            yield match.group(1).strip()


def _split_top_level_relation(source: str) -> tuple[str, str, str] | None:
    brace_depth = paren_depth = bracket_depth = 0
    index = 0
    while index < len(source):
        char = source[index]
        escaped = index > 0 and source[index - 1] == "\\"
        if not escaped:
            brace_depth += (char == "{") - (char == "}")
            paren_depth += (char == "(") - (char == ")")
            bracket_depth += (char == "[") - (char == "]")
        if brace_depth == paren_depth == bracket_depth == 0:
            for marker in RELATION_MARKERS:
                if source.startswith(marker, index):
                    lhs = source[:index].strip()
                    rhs = source[index + len(marker) :].strip()
                    if lhs and rhs:
                        return lhs, marker, rhs
        index += 1
    return None


def _parse_matrix_declaration(
    source: str,
) -> tuple[str, sp.Basic, sp.Basic, sp.Set] | None:
    match = re.fullmatch(
        r"\s*([A-Za-z])\s*\\in\s*\\mathbb\{([RC])\}"
        r"\^\{\s*(.+?)\s*\\times\s*(.+?)\s*\}\s*",
        source,
        re.DOTALL,
    )
    if not match:
        return None
    name, domain_name, rows_source, cols_source = match.groups()
    rows = parse_expression(rows_source)
    cols = parse_expression(cols_source)
    for label, dimension in (("row", rows), ("column", cols)):
        if dimension.is_number and (not dimension.is_integer or dimension <= 0):
            raise MatrixShapeError(
                f"Matrix {label} dimension must be a positive integer."
            )
        if not isinstance(dimension, (sp.Symbol, sp.Integer)):
            raise MatrixShapeError(
                f"Matrix {label} dimension must be a symbol or positive integer."
            )
    domain = sp.S.Reals if domain_name == "R" else sp.S.Complexes
    return name, rows, cols, domain
