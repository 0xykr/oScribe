#!/usr/bin/env python3
"""One-request JSON worker for the oScribe desktop plugin."""

from __future__ import annotations

import json
import sys
from typing import Any

from math_context import MathContextError, parse_context
from operations import (
    definite_integral,
    differentiate,
    integrate,
    matrix_operation,
    numerical_evaluate,
    simplify_or_solve,
)
from pde_operations import analyze_and_solve_pde, separate_pde


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    command = request.get("command")
    context_data = request.get("context")
    if not isinstance(context_data, dict):
        raise ValueError("Request context must be an object.")
    context_chunk = str(context_data.get("chunk", ""))
    context = parse_context(
        context_chunk,
        None
        if command in {"pde_analyze_solve", "pde_separate"}
        else int(context_data.get("line", 0)),
    )
    if command == "differentiate":
        latex = differentiate(
            context,
            str(context_data.get("expression", "")),
            str(context_data.get("wrt", "")),
            context_data.get("order", 1),
        )
    elif command == "integrate":
        latex = integrate(
            context,
            str(context_data.get("expression", "")),
            str(context_data.get("wrt", "")),
        )
    elif command == "definite_integral":
        latex = definite_integral(
            context,
            str(context_data.get("expression", "")),
            str(context_data.get("wrt", "")),
            str(context_data.get("lower", "")),
            str(context_data.get("upper", "")),
        )
    elif command == "matrix_operation":
        latex = matrix_operation(
            context,
            str(context_data.get("expression", "")),
            str(context_data.get("operation", "")),
        )
    elif command == "simplify_or_solve":
        latex = simplify_or_solve(
            context,
            str(context_data.get("expression", "")),
            str(context_data.get("wrt", "")),
        )
    elif command == "numerical_evaluate":
        latex = numerical_evaluate(
            context,
            str(context_data.get("expression", "")),
            context_data.get("precision", 15),
        )
    elif command == "pde_analyze_solve":
        result = analyze_and_solve_pde(
            context,
            str(context_data.get("equation", "")),
        )
        return {
            "ok": True,
            "latex": str(result.get("latex", "")),
            "result": result,
        }
    elif command == "pde_separate":
        result = separate_pde(
            context,
            str(context_data.get("equation", "")),
            str(context_data.get("function", "")),
            str(context_data.get("ansatz", "")),
        )
        return {
            "ok": True,
            "latex": str(result.get("latex", "")),
            "result": result,
        }
    else:
        raise ValueError(f"Unknown command: {command}")
    return {"ok": True, "latex": latex}


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object.")
        response = dispatch(request)
    except (MathContextError, ValueError, TypeError, KeyError) as error:
        response = {
            "ok": False,
            "error": {
                "type": type(error).__name__,
                "message": str(error),
            },
        }
    except Exception as error:
        print(f"Unhandled oScribe worker error: {error!r}", file=sys.stderr)
        response = {
            "ok": False,
            "error": {
                "type": "InternalSymPyError",
                "message": "The SymPy worker could not complete the request.",
            },
        }
    json.dump(response, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
