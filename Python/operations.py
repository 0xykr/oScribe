"""Thin mathematical operations built on MathContext resolution."""

from __future__ import annotations

import sympy as sp

from math_context import MathContext, MathContextError, parse_expression


class InvalidDifferentiationVariable(MathContextError):
    pass


class InvalidDerivativeOrder(MathContextError):
    pass


class InvalidIntegrationVariable(MathContextError):
    pass


class UnevaluatedIntegral(MathContextError):
    pass


class MatrixOperationError(MathContextError):
    pass


class SolveError(MathContextError):
    pass


class NumericalEvaluationError(MathContextError):
    pass


class FourierOperationError(MathContextError):
    pass


def _integration_variable(wrt_source: str) -> sp.Symbol:
    wrt = parse_expression(wrt_source)
    if not isinstance(wrt, sp.Symbol):
        raise InvalidIntegrationVariable(
            "Expected a single symbol for the integration variable."
        )
    return wrt


def differentiate(
    context: MathContext,
    expression_source: str,
    wrt_source: str,
    order_value: object,
) -> str:
    expression = parse_expression(expression_source, context.matrix_symbols())
    wrt = parse_expression(wrt_source)
    if not isinstance(wrt, sp.Symbol):
        raise InvalidDifferentiationVariable(
            "Expected a single symbol for the differentiation variable."
        )
    if isinstance(order_value, bool):
        raise InvalidDerivativeOrder("Derivative order must be a positive integer.")
    try:
        order = int(order_value)
    except (TypeError, ValueError) as error:
        raise InvalidDerivativeOrder(
            "Derivative order must be a positive integer."
        ) from error
    if order < 1 or order != order_value:
        raise InvalidDerivativeOrder("Derivative order must be a positive integer.")

    resolved = context.resolve(expression)
    if isinstance(resolved, sp.MatrixExpr) and not isinstance(
        resolved, sp.MatrixBase
    ):
        raise MatrixOperationError(
            "Abstract matrix differentiation is not supported yet."
        )
    return sp.latex(sp.diff(resolved, wrt, order))


def integrate(
    context: MathContext,
    expression_source: str,
    wrt_source: str,
) -> str:
    expression = parse_expression(expression_source, context.matrix_symbols())
    wrt = _integration_variable(wrt_source)
    resolved = context.resolve(expression)
    if isinstance(resolved, sp.MatrixExpr) and not isinstance(
        resolved, sp.MatrixBase
    ):
        raise MatrixOperationError(
            "Abstract matrix integration is not supported yet."
        )
    result = sp.integrate(resolved, wrt)
    _require_evaluated_integral(result)
    return sp.latex(result)


def definite_integral(
    context: MathContext,
    expression_source: str,
    wrt_source: str,
    lower_source: str,
    upper_source: str,
) -> str:
    expression = context.resolve(
        parse_expression(expression_source, context.matrix_symbols())
    )
    wrt = _integration_variable(wrt_source)
    lower = context.resolve(parse_expression(lower_source))
    upper = context.resolve(parse_expression(upper_source))
    result = sp.integrate(expression, (wrt, lower, upper))
    _require_evaluated_integral(result)
    return sp.latex(result)


def simplify_or_solve(
    context: MathContext,
    expression_source: str,
    variable_source: str,
) -> str:
    from math_context import parse_constraint

    constraint = parse_constraint(expression_source, context)
    if constraint is None:
        expression = context.resolve(
            parse_expression(expression_source, context.matrix_symbols())
        )
        return sp.latex(sp.simplify(expression))
    if not isinstance(constraint.relation, sp.Equality):
        raise SolveError("Only equality constraints can currently be solved.")
    variable = parse_expression(variable_source)
    if not isinstance(variable, sp.Symbol):
        raise SolveError("Expected a single symbol to solve for.")
    lhs = context.resolve(constraint.relation.lhs)
    rhs = context.resolve(constraint.relation.rhs)
    try:
        solutions = sp.solveset(lhs - rhs, variable, domain=sp.S.Complexes)
    except Exception as error:
        raise SolveError(f"Could not solve this equation: {error}") from error
    if isinstance(solutions, sp.ConditionSet):
        raise SolveError("SymPy could not express the solution as a known set.")
    return sp.latex(sp.Contains(variable, solutions, evaluate=False))


def numerical_evaluate(
    context: MathContext,
    expression_source: str,
    precision_value: object,
) -> str:
    try:
        precision = int(precision_value)
    except (TypeError, ValueError) as error:
        raise NumericalEvaluationError(
            "Numerical precision must be an integer from 1 to 1000."
        ) from error
    if isinstance(precision_value, bool) or not 1 <= precision <= 1000:
        raise NumericalEvaluationError(
            "Numerical precision must be an integer from 1 to 1000."
        )
    expression = context.resolve(
        parse_expression(expression_source, context.matrix_symbols())
    )
    expression = expression.xreplace(
        {
            symbol: sp.pi if symbol.name == "pi" else sp.E
            for symbol in expression.free_symbols
            if symbol.name in {"pi", "e"}
        }
    )
    try:
        result = sp.N(expression, precision)
    except Exception as error:
        raise NumericalEvaluationError(
            f"Could not numerically evaluate this expression: {error}"
        ) from error
    return sp.latex(result)


def fourier_transform(
    context: MathContext,
    expression_source: str,
    variable_source: str,
    frequency_source: str,
) -> str:
    expression = context.resolve(
        parse_expression(expression_source, context.matrix_symbols())
    )
    variable = parse_expression(variable_source)
    frequency = parse_expression(frequency_source)
    if not isinstance(variable, sp.Symbol) or not isinstance(frequency, sp.Symbol):
        raise FourierOperationError(
            "Fourier transform variables must each be a single symbol."
        )
    try:
        result = sp.fourier_transform(expression, variable, frequency)
    except Exception as error:
        raise FourierOperationError(
            f"Could not calculate this Fourier transform: {error}"
        ) from error
    if result.has(sp.FourierTransform):
        raise FourierOperationError(
            "SymPy could not reduce this Fourier transform to a closed form."
        )
    return sp.latex(result)


def fourier_series_expansion(
    context: MathContext,
    expression_source: str,
    variable_source: str,
    lower_source: str,
    upper_source: str,
    terms_value: object,
) -> str:
    variable = parse_expression(variable_source)
    if not isinstance(variable, sp.Symbol):
        raise FourierOperationError(
            "The Fourier series variable must be a single symbol."
        )
    try:
        terms = int(terms_value)
    except (TypeError, ValueError) as error:
        raise FourierOperationError(
            "Fourier series terms must be an integer from 1 to 1000."
        ) from error
    if isinstance(terms_value, bool) or not 1 <= terms <= 1000:
        raise FourierOperationError(
            "Fourier series terms must be an integer from 1 to 1000."
        )
    expression = context.resolve(
        parse_expression(expression_source, context.matrix_symbols())
    )
    lower = context.resolve(parse_expression(lower_source))
    upper = context.resolve(parse_expression(upper_source))
    if sp.simplify(upper - lower) == 0:
        raise FourierOperationError("Fourier series interval cannot have zero length.")
    try:
        series = sp.fourier_series(expression, (variable, lower, upper))
        result = series.truncate(n=terms)
    except Exception as error:
        raise FourierOperationError(
            f"Could not calculate this Fourier series: {error}"
        ) from error
    return sp.latex(result)


def _require_evaluated_integral(result: sp.Expr) -> None:
    if result.has(sp.Integral):
        raise UnevaluatedIntegral(
            "SymPy could not simplify this integral to a closed-form result."
        )


MATRIX_OPERATIONS = {
    "evaluate",
    "determinant",
    "inverse",
    "transpose",
    "trace",
    "norm",
    "rref",
    "rank",
    "nullspace",
    "eigenvalues",
    "eigenvectors",
    "characteristic_polynomial",
    "diagonalize",
}


def matrix_operation(
    context: MathContext,
    expression_source: str,
    operation: str,
) -> str:
    if operation not in MATRIX_OPERATIONS:
        raise MatrixOperationError(f"Unknown matrix operation: {operation}")
    expression = parse_expression(expression_source, context.matrix_symbols())
    resolved = context.resolve(expression)
    if not getattr(resolved, "is_Matrix", False):
        raise MatrixOperationError("Expected a matrix-valued expression.")
    try:
        if operation == "evaluate":
            result = resolved.doit()
        elif operation == "determinant":
            result = sp.Determinant(resolved).doit()
        elif operation == "inverse":
            result = resolved.inv()
        elif operation == "transpose":
            result = resolved.T
        elif operation == "trace":
            result = sp.Trace(resolved).doit()
        else:
            concrete = _concrete_matrix(resolved, operation)
            if operation == "norm":
                result = concrete.norm("frobenius")
            elif operation == "rref":
                result = concrete.rref()
            elif operation == "rank":
                result = concrete.rank()
            elif operation == "nullspace":
                return _latex_nullspace(concrete.nullspace(), concrete.cols)
            elif operation == "eigenvalues":
                result = concrete.eigenvals()
            elif operation == "eigenvectors":
                result = concrete.eigenvects()
            elif operation == "characteristic_polynomial":
                result = concrete.charpoly()
            else:
                result = concrete.diagonalize()
    except Exception as error:
        raise MatrixOperationError(
            f"Could not compute matrix {operation.replace('_', ' ')}: {error}"
        ) from error
    return sp.latex(result)


def _concrete_matrix(value: sp.Basic, operation: str) -> sp.MatrixBase:
    evaluated = value.doit()
    if not isinstance(evaluated, sp.MatrixBase):
        raise MatrixOperationError(
            f"Matrix {operation.replace('_', ' ')} requires a concrete matrix."
        )
    return evaluated


def _latex_nullspace(
    basis: list[sp.MatrixBase],
    columns: int,
) -> str:
    if not basis:
        return rf"\left\{{\mathbf{{0}}_{{{columns} \times 1}}\right\}}"
    vectors = ", ".join(sp.latex(vector) for vector in basis)
    return rf"\operatorname{{span}}\left\{{{vectors}\right\}}"
