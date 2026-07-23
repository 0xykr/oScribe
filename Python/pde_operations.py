"""PDE analysis, verified solving, and separation assistance."""

from __future__ import annotations

from typing import Any

import sympy as sp
from sympy.core.function import AppliedUndef
from sympy.solvers.pde import (
    checkpdesol,
    classify_pde,
    pde_separate_mul,
    pdsolve,
)

from math_context import (
    Constraint,
    MathContext,
    MathContextError,
    parse_constraint,
    parse_expression,
)


class PDEError(MathContextError):
    pass


def analyze_and_solve_pde(
    context: MathContext,
    equation_source: str,
) -> dict[str, Any]:
    equation = _equation(equation_source, context)
    function = _dependent_function(equation)
    hints = tuple(classify_pde(equation, function))
    order = _pde_order(equation, function)
    if not hints:
        return {
            "kind": "unsupported",
            "classification": [],
            "order": order,
            "message": (
                f"SymPy cannot directly solve this order-{order} PDE. "
                "Try oScribe: Separate PDE with a product ansatz."
            ),
        }
    try:
        solution = pdsolve(equation, function)
    except NotImplementedError:
        return {
            "kind": "unsupported",
            "classification": list(hints),
            "order": order,
            "message": "SymPy classified this PDE but has no implemented solver for it.",
        }
    checked = checkpdesol(equation, solution, func=function)
    verified = bool(checked[0] if isinstance(checked, tuple) else checked)
    if not verified:
        raise PDEError("SymPy returned a PDE solution that could not be verified.")
    conditions = _condition_checks(context, equation, function, solution)
    return {
        "kind": "solved",
        "latex": sp.latex(solution),
        "classification": list(hints),
        "order": order,
        "verified": True,
        "conditions": conditions,
    }


def separate_pde(
    context: MathContext,
    equation_source: str,
    function_source: str,
    ansatz_source: str,
) -> dict[str, Any]:
    equation = _equation(equation_source, context)
    function = parse_expression(function_source, context.matrix_symbols())
    if not isinstance(function, AppliedUndef):
        raise PDEError("The dependent function must look like u(x,t).")
    inferred = _dependent_function(equation)
    if function.func != inferred.func:
        raise PDEError("The dependent function does not match the PDE.")
    ansatz = parse_expression(ansatz_source, context.matrix_symbols())
    factors = list(ansatz.args) if isinstance(ansatz, sp.Mul) else [ansatz]
    if len(factors) < 2 or any(not isinstance(item, AppliedUndef) for item in factors):
        raise PDEError("The separation ansatz must be a product such as X(x)T(t).")
    used: set[sp.Symbol] = set()
    independent = set(function.args)
    for factor in factors:
        variables = set(factor.free_symbols)
        if len(variables) != 1 or not variables <= independent or used & variables:
            raise PDEError(
                "Each ansatz factor must depend on one distinct PDE variable."
            )
        used |= variables
    if used != independent:
        raise PDEError("The ansatz must cover every independent PDE variable.")
    try:
        separated = pde_separate_mul(equation, function, factors)
    except Exception as error:
        raise PDEError(f"Could not separate this PDE: {error}") from error
    if not separated or len(separated) < 2:
        raise PDEError("SymPy could not separate this PDE with the given ansatz.")
    constant = sp.Symbol("lambda")
    equations = [
        sp.Eq(expression, constant, evaluate=False) for expression in separated
    ]
    latex = r"\begin{aligned}" + r" \\ ".join(
        sp.latex(item) for item in equations
    ) + r"\end{aligned}"
    return {
        "kind": "separated",
        "latex": latex,
        "verified": True,
    }


def _equation(source: str, context: MathContext) -> sp.Equality:
    constraint = parse_constraint(source, context)
    if constraint is None or not isinstance(constraint.relation, sp.Equality):
        raise PDEError("Expected a complete PDE containing an equals sign.")
    return constraint.relation


def _dependent_function(equation: sp.Equality) -> AppliedUndef:
    functions: dict[type[sp.Function], AppliedUndef] = {}
    derivatives = equation.atoms(sp.Derivative)
    for derivative in derivatives:
        for function in derivative.expr.atoms(AppliedUndef):
            functions[function.func] = function
    if len(functions) != 1:
        raise PDEError(
            "Expected exactly one dependent function inside partial derivatives."
        )
    dependent = next(iter(functions.values()))
    if any(
        not any(
            applied.func == dependent.func
            for applied in derivative.expr.atoms(AppliedUndef)
        )
        for derivative in derivatives
    ):
        raise PDEError(
            "Every partial derivative must act on the same dependent function. "
            f"Write {dependent.func.__name__}(...) explicitly in each numerator."
        )
    return dependent


def _pde_order(equation: sp.Equality, function: AppliedUndef) -> int:
    orders = [
        sum(count for _, count in derivative.variable_count)
        for derivative in equation.atoms(sp.Derivative)
        if derivative.expr.has(function.func)
    ]
    return int(max(orders, default=0))


def _condition_checks(
    context: MathContext,
    equation: sp.Equality,
    function: AppliedUndef,
    solution: sp.Equality,
) -> list[dict[str, str]]:
    if not isinstance(solution.lhs, AppliedUndef):
        return []
    parameters = solution.lhs.args
    rhs = solution.rhs

    def replace_application(node: sp.Basic) -> sp.Basic:
        if isinstance(node, AppliedUndef) and node.func == function.func:
            return rhs.subs(dict(zip(parameters, node.args)))
        return node

    checks: list[dict[str, str]] = []
    for item in context.relational_constraints():
        relation = item.relation
        if relation == equation or not relation.has(function.func):
            continue
        if not isinstance(relation, sp.Equality):
            continue
        residual = (relation.lhs - relation.rhs).replace(
            lambda node: isinstance(node, AppliedUndef)
            and node.func == function.func,
            replace_application,
        )
        simplified = sp.simplify(residual.doit())
        if simplified == 0:
            status = "satisfied"
        elif simplified.is_number and simplified != 0:
            status = "violated"
        else:
            status = "undetermined"
        checks.append({"latex": sp.latex(relation), "status": status})
    return checks
