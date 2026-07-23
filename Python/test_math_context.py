import unittest

import sympy as sp

from math_context import CyclicDefinition, MathContext, parse_constraint, parse_context
from operations import (
    InvalidDifferentiationVariable,
    InvalidDerivativeOrder,
    InvalidIntegrationVariable,
    UnevaluatedIntegral,
    definite_integral,
    differentiate,
    integrate,
    numerical_evaluate,
    simplify_or_solve,
)


class ConstraintTests(unittest.TestCase):
    def test_variable_definition(self):
        constraint = parse_constraint("a = 2")
        self.assertEqual(constraint.definition().kind, "symbol")

    def test_established_definition_markers(self):
        self.assertEqual(parse_constraint("a := 2").definition().kind, "symbol")
        self.assertEqual(
            parse_constraint(r"f(x) \triangleq x^2").definition().kind,
            "function",
        )

    def test_function_definition(self):
        constraint = parse_constraint("f(x) = x^2 + 1")
        definition = constraint.definition()
        self.assertEqual(definition.kind, "function")
        self.assertIsInstance(definition.value, sp.Lambda)

    def test_circle_is_relational(self):
        constraint = parse_constraint("x^2 + y^2 = 1")
        self.assertIsNone(constraint.definition())
        self.assertIsInstance(constraint.relation, sp.Equality)

    def test_non_bare_function_argument_is_relational(self):
        self.assertIsNone(parse_constraint("f(x+1) = x").definition())

    def test_differential_equation_is_relational(self):
        self.assertIsNone(parse_constraint("f'(x) = f(x)").definition())

    def test_explicit_relational_marker_is_not_definition(self):
        self.assertIsNone(parse_constraint(r"a \circeq 2").definition())

    def test_cycle_is_reported(self):
        context = parse_context("$a=b$\n$b=a$\n", 2)
        with self.assertRaises(CyclicDefinition):
            context.resolve(sp.Symbol("a"))


class ResolutionAndOperationTests(unittest.TestCase):
    def test_nested_resolution(self):
        context = parse_context("$a=2$\n$f(x)=a x^3$\n", 2)
        actual = context.resolve(sp.Function("f")(sp.Symbol("y")))
        self.assertEqual(sp.simplify(actual - 2 * sp.Symbol("y") ** 3), 0)

    def test_plain_derivative(self):
        self.assertEqual(differentiate(MathContext(), "x^2", "x", 1), "2 x")

    def test_function_derivative(self):
        context = parse_context(r"$f(x)=x^3+\sin x$", 1)
        actual = differentiate(context, "f(x)", "x", 1)
        expected = 3 * sp.Symbol("x") ** 2 + sp.cos(sp.Symbol("x"))
        from sympy.parsing.latex import parse_latex
        self.assertEqual(sp.simplify(parse_latex(actual) - expected), 0)

    def test_variable_derivative(self):
        context = parse_context("$a=2$", 1)
        self.assertEqual(differentiate(context, "a x^2", "x", 1), "4 x")

    def test_ordinary_equation_not_used_as_rewrite(self):
        context = parse_context("$x^2+y^2=1$", 1)
        self.assertEqual(differentiate(context, "x^2+y^2", "x", 1), "2 x")

    def test_invalid_wrt(self):
        with self.assertRaises(InvalidDifferentiationVariable):
            differentiate(MathContext(), "x^2", "x+y", 1)

    def test_invalid_order(self):
        with self.assertRaises(InvalidDerivativeOrder):
            differentiate(MathContext(), "x^2", "x", 1.5)

    def test_plain_integral(self):
        self.assertEqual(integrate(MathContext(), "2 x", "x"), "x^{2}")

    def test_simplify_expression(self):
        self.assertEqual(
            simplify_or_solve(MathContext(), r"\frac{x^2-1}{x-1}", "x"),
            "x + 1",
        )

    def test_solve_equation(self):
        result = simplify_or_solve(MathContext(), "x^2=1", "x")
        self.assertIn(r"x \in", result)
        self.assertIn("-1", result)
        self.assertIn("1", result)

    def test_numerical_evaluation(self):
        self.assertEqual(
            numerical_evaluate(MathContext(), r"\pi", 6),
            "3.14159",
        )

    def test_function_integral_uses_constraint_resolution(self):
        context = parse_context("$a=2$\n$f(x)=a x$", 2)
        self.assertEqual(integrate(context, "f(x)", "x"), "x^{2}")

    def test_invalid_integration_variable(self):
        with self.assertRaises(InvalidIntegrationVariable):
            integrate(MathContext(), "x", "x+y")

    def test_unevaluated_indefinite_integral_is_reported(self):
        with self.assertRaises(UnevaluatedIntegral):
            integrate(MathContext(), "x + f(x)", "x")

    def test_unevaluated_integral_after_constant_extraction_is_reported(self):
        with self.assertRaises(UnevaluatedIntegral):
            integrate(MathContext(), "2 f(x)", "x")

    def test_definite_integral(self):
        self.assertEqual(
            definite_integral(MathContext(), "x^2", "x", "0", "1"),
            r"\frac{1}{3}",
        )

    def test_unevaluated_definite_integral_is_reported(self):
        with self.assertRaises(UnevaluatedIntegral):
            definite_integral(MathContext(), "f(x)", "x", "0", "1")


if __name__ == "__main__":
    unittest.main()
