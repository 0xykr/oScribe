import unittest
import json

import sympy as sp

from math_context import MathContext, parse_constraint, parse_context, parse_expression
from pde_operations import PDEError, analyze_and_solve_pde, separate_pde
from oScribe import dispatch


class PartialDerivativeParserTests(unittest.TestCase):
    def test_first_second_and_mixed_partials(self):
        x, y = sp.symbols("x y")
        f = sp.Function("f")
        self.assertEqual(
            parse_expression(r"\frac{\partial f(x,y)}{\partial x}"),
            sp.Derivative(f(x, y), x),
        )
        self.assertEqual(
            parse_expression(r"\frac{\partial^2 f(x,y)}{\partial x^2}"),
            sp.Derivative(f(x, y), (x, 2)),
        )
        self.assertEqual(
            parse_expression(
                r"\frac{\partial^{2} f(x,y)}{\partial x\partial y}"
            ),
            sp.Derivative(f(x, y), x, y),
        )

    def test_inconsistent_order_is_rejected(self):
        with self.assertRaisesRegex(Exception, "orders do not match"):
            parse_expression(r"\frac{\partial^2 f(x,y)}{\partial x}")

    def test_powered_function_name_is_not_silently_ignored(self):
        with self.assertRaisesRegex(PDEError, "Every partial derivative"):
            analyze_and_solve_pde(
                MathContext(),
                (
                    r"\frac{\partial u^2(x,y)}{\partial x}"
                    r"+\frac{\partial u(x,y)}{\partial y}=0"
                ),
            )


class PDEOperationTests(unittest.TestCase):
    def test_transport_equation_solves_and_verifies(self):
        result = analyze_and_solve_pde(
            MathContext(),
            (
                r"\frac{\partial u(x,y)}{\partial x}"
                r"+\frac{\partial u(x,y)}{\partial y}=0"
            ),
        )
        self.assertEqual(result["kind"], "solved")
        self.assertTrue(result["verified"])
        self.assertIn("u", result["latex"])

    def test_worker_response_is_json_serializable(self):
        response = dispatch(
            {
                "command": "pde_analyze_solve",
                "context": {
                    "chunk": "",
                    "line": 0,
                    "char": 0,
                    "equation": (
                        r"\frac{\partial u(x,y)}{\partial x}"
                        r"+\frac{\partial u(x,y)}{\partial y}=0"
                    ),
                },
            }
        )
        json.dumps(response)

    def test_heat_equation_is_honestly_unsupported(self):
        result = analyze_and_solve_pde(
            MathContext(),
            (
                r"\frac{\partial u(x,t)}{\partial t}"
                r"=k\frac{\partial^2 u(x,t)}{\partial x^2}"
            ),
        )
        self.assertEqual(result["kind"], "unsupported")
        self.assertEqual(result["order"], 2)

    def test_common_higher_order_and_nonlinear_pdes_are_unsupported(self):
        equations = [
            (
                r"\frac{\partial^2 u(x,t)}{\partial t^2}"
                r"=c^2\frac{\partial^2 u(x,t)}{\partial x^2}"
            ),
            (
                r"\frac{\partial^2 u(x,y)}{\partial x^2}"
                r"+\frac{\partial^2 u(x,y)}{\partial y^2}=0"
            ),
            (
                r"\frac{\partial u(x,t)}{\partial t}"
                r"+u(x,t)\frac{\partial u(x,t)}{\partial x}=0"
            ),
        ]
        for equation in equations:
            with self.subTest(equation=equation):
                self.assertEqual(
                    analyze_and_solve_pde(MathContext(), equation)["kind"],
                    "unsupported",
                )

    def test_product_separation(self):
        result = separate_pde(
            MathContext(),
            (
                r"\frac{\partial u(x,t)}{\partial t}"
                r"=k\frac{\partial^2 u(x,t)}{\partial x^2}"
            ),
            "u(x,t)",
            "X(x)T(t)",
        )
        self.assertEqual(result["kind"], "separated")
        self.assertIn(r"\lambda", result["latex"])

    def test_invalid_ansatz_is_rejected(self):
        with self.assertRaises(PDEError):
            separate_pde(
                MathContext(),
                r"\frac{\partial u(x,t)}{\partial t}=0",
                "u(x,t)",
                "X(x)+T(t)",
            )

    def test_conditions_remain_relational(self):
        context = parse_context(
            r"$u(x,0)=0$" "\n"
            r"$\frac{\partial u(x,t)}{\partial t}=0$"
        )
        condition = context.constraints[0]
        self.assertIsNone(condition.definition())

    def test_condition_checks_report_all_three_states(self):
        context = parse_context(
            r"$\frac{\partial u(x,t)}{\partial t}=0$" "\n"
            r"$u(x,0)=u(x,0)$" "\n"
            r"$u(x,0)=u(x,0)+1$" "\n"
            r"$u(x,0)=x$"
        )
        result = analyze_and_solve_pde(
            context,
            r"\frac{\partial u(x,t)}{\partial t}=0",
        )
        self.assertEqual(
            [item["status"] for item in result["conditions"]],
            ["satisfied", "violated", "undetermined"],
        )

    def test_derivative_equation_is_not_a_definition(self):
        constraint = parse_constraint(r"f'(x)=f(x)")
        self.assertIsNotNone(constraint)
        self.assertIsNone(constraint.definition())


if __name__ == "__main__":
    unittest.main()
