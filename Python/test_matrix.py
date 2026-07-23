import unittest

import sympy as sp

from math_context import (
    MatrixShapeError,
    MatrixSpace,
    ParseError,
    parse_context,
    parse_expression,
)
from matrix_parser import MatrixParseError, parse_math
from operations import MatrixOperationError, differentiate, matrix_operation


MATRIX = r"\begin{pmatrix}1&2\\3&4\end{pmatrix}"
SWAP = r"\begin{bmatrix}0&1\\1&0\end{bmatrix}"


class MatrixParserTests(unittest.TestCase):
    def test_matrix_container_family(self):
        for environment in ("matrix", "pmatrix", "bmatrix", "Bmatrix"):
            with self.subTest(environment=environment):
                source = rf"\begin{{{environment}}}1&2\\3&4\end{{{environment}}}"
                self.assertEqual(parse_math(source), sp.ImmutableMatrix([[1, 2], [3, 4]]))

    def test_vmatrix_is_determinant(self):
        source = r"\begin{vmatrix}1&2\\3&4\end{vmatrix}"
        self.assertEqual(parse_math(source), -2)

    def test_Vmatrix_is_frobenius_norm(self):
        source = r"\begin{Vmatrix}1&2\\3&4\end{Vmatrix}"
        self.assertEqual(parse_math(source), sp.sqrt(30))

    def test_matrix_cells_parse_scalar_latex(self):
        source = r"\begin{pmatrix}\frac{1}{2}&\sin x\\x^2&y\end{pmatrix}"
        result = parse_math(source)
        self.assertEqual(sp.simplify(result[0, 0] - sp.Rational(1, 2)), 0)
        self.assertEqual(result[1, 0], sp.Symbol("x") ** 2)

    def test_adjacent_matrix_product_preserves_order(self):
        left = sp.ImmutableMatrix([[1, 2], [3, 4]])
        right = sp.ImmutableMatrix([[0, 1], [1, 0]])
        self.assertEqual(parse_math(MATRIX + SWAP).doit(), left * right)
        self.assertEqual(parse_math(SWAP + MATRIX).doit(), right * left)

    def test_ragged_matrix_is_rejected(self):
        with self.assertRaises(MatrixParseError):
            parse_math(r"\begin{pmatrix}1&2\\3\end{pmatrix}")

    def test_matrix_entry_cannot_be_matrix(self):
        with self.assertRaises(MatrixParseError):
            parse_math(
                r"\begin{pmatrix}"
                r"\begin{pmatrix}1\end{pmatrix}&2"
                r"\end{pmatrix}"
            )


class MatrixConstraintTests(unittest.TestCase):
    def test_explicit_matrix_declaration(self):
        context = parse_context(r"$A \in \mathbb{R}^{m \times n}$", 1)
        matrix = context.symbols["A"]
        self.assertIsInstance(matrix, sp.MatrixSymbol)
        self.assertEqual(matrix.shape, (sp.Symbol("m"), sp.Symbol("n")))
        relation = context.constraints[0].relation
        self.assertIsInstance(relation, sp.Contains)
        self.assertIsInstance(relation.args[1], MatrixSpace)

    def test_literal_definition_infers_shape_and_resolves(self):
        context = parse_context(f"$A := {MATRIX}$", 1)
        self.assertEqual(context.symbols["A"].shape, (2, 2))
        expression = parse_expression("A^T", context.matrix_symbols())
        self.assertEqual(context.resolve(expression).doit(), sp.ImmutableMatrix([[1, 3], [2, 4]]))

    def test_conflicting_declared_shape_is_rejected(self):
        source = rf"$A \in \mathbb{{R}}^{{2 \times 3}}$" + "\n" + rf"$A := {MATRIX}$"
        with self.assertRaises(MatrixShapeError):
            parse_context(source, 2)

    def test_symbolic_matrix_multiplication_is_noncommutative(self):
        context = parse_context(
            "$A \\in \\mathbb{R}^{2 \\times 2}$\n"
            "$B \\in \\mathbb{R}^{2 \\times 2}$",
            2,
        )
        ab = parse_expression("A B", context.matrix_symbols())
        ba = parse_expression("B A", context.matrix_symbols())
        self.assertEqual(ab.args, (context.symbols["A"], context.symbols["B"]))
        self.assertEqual(ba.args, (context.symbols["B"], context.symbols["A"]))
        self.assertEqual(
            parse_expression("AB", context.matrix_symbols()).args,
            (context.symbols["A"], context.symbols["B"]),
        )


class MatrixOperationTests(unittest.TestCase):
    def setUp(self):
        self.context = parse_context(f"$A := {MATRIX}$", 1)

    def test_core_operations(self):
        self.assertEqual(matrix_operation(self.context, "A", "determinant"), "-2")
        self.assertEqual(matrix_operation(self.context, "A", "rank"), "2")
        self.assertIn(r"\begin{matrix}", matrix_operation(self.context, "A", "inverse"))
        self.assertIn(r"\begin{matrix}", matrix_operation(self.context, "A", "rref"))

    def test_extended_operations(self):
        for operation in (
            "trace",
            "norm",
            "nullspace",
            "eigenvalues",
            "eigenvectors",
            "characteristic_polynomial",
            "diagonalize",
        ):
            with self.subTest(operation=operation):
                self.assertTrue(matrix_operation(self.context, "A", operation))

    def test_trivial_nullspace_is_formatted_as_zero_space(self):
        self.assertEqual(
            matrix_operation(self.context, "A", "nullspace"),
            r"\left\{\mathbf{0}_{2 \times 1}\right\}",
        )

    def test_nontrivial_nullspace_is_formatted_as_span(self):
        context = parse_context(
            r"$S := \begin{pmatrix}1&2\\2&4\end{pmatrix}$",
            1,
        )
        result = matrix_operation(context, "S", "nullspace")
        self.assertTrue(result.startswith(r"\operatorname{span}"))
        self.assertIn(r"\begin{matrix}", result)

    def test_non_matrix_is_rejected(self):
        with self.assertRaises(MatrixOperationError):
            matrix_operation(self.context, "x^2", "rank")

    def test_singular_inverse_is_reported(self):
        context = parse_context(
            r"$S := \begin{pmatrix}1&2\\2&4\end{pmatrix}$",
            1,
        )
        with self.assertRaises(MatrixOperationError):
            matrix_operation(context, "S", "inverse")

    def test_dimension_mismatch_is_reported(self):
        context = parse_context(
            "$A \\in \\mathbb{R}^{2 \\times 3}$\n"
            "$B \\in \\mathbb{R}^{2 \\times 2}$",
            2,
        )
        with self.assertRaises(ParseError):
            parse_expression("AB", context.matrix_symbols())

    def test_concrete_matrix_differentiation_is_elementwise(self):
        context = parse_context(
            r"$A := \begin{pmatrix}x^2&x\\0&1\end{pmatrix}$",
            1,
        )
        result = differentiate(context, "A", "x", 1)
        self.assertIn("2 x", result)


if __name__ == "__main__":
    unittest.main()
