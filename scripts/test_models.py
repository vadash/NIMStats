#!/usr/bin/env python3

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db_utils import write_run  # noqa: E402

API_BASE = os.getenv("API_BASE", "https://integrate.api.nvidia.com/v1")
API_KEY = os.getenv("NIM_API_KEY", "")
MODEL_INDEX = os.getenv("MODEL_INDEX")  # set by dispatch to test a single model
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "180"))
PROMPT = "Write a C# 10 function named IsPrime that takes an int parameter and returns a bool. Use a traditional for loop checking divisibility up to the square root of the number. Do not use advanced pattern matching, LINQ, top-level statements, or external libraries. Provide only the valid C# code inside a markdown code block, with absolutely no introductory, explanatory, or concluding text."

SCRIPT_DIR = Path(__file__).resolve().parent

ALL_MODELS = [
    "moonshotai/kimi-k2.6",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3-super-120b-a12b",
    "openai/gpt-oss-120b",
    "minimaxai/minimax-m3",
    "minimaxai/minimax-m2.7",
    "stepfun-ai/step-3.7-flash",
    "deepseek-ai/deepseek-v4-pro",
    "deepseek-ai/deepseek-v4-flash",
    "qwen/qwen3.5-397b-a17b",
    "qwen/qwen3.5-122b-a10b",
]

# DEAD
# "z-ai/glm-5.1",

def selected_models() -> list[str]:
    if MODEL_INDEX is not None:
        idx = int(MODEL_INDEX)
        if 0 <= idx < len(ALL_MODELS):
            return [ALL_MODELS[idx]]
        print(f"Error: MODEL_INDEX={idx} out of range (0-{len(ALL_MODELS)-1})", file=sys.stderr)
        sys.exit(1)
    return ALL_MODELS


def build_runtime_prompt() -> str:
    cache_buster = uuid.uuid4()
    return f"{PROMPT}\n\nRequest ID for cache isolation, ignore in your answer: {cache_buster}"


def failure_result(model: str, error: str) -> dict[str, Any]:
    return {
        "model": model,
        "success": False,
        "error": error,
        "responseTime": None,
        "tokensGenerated": None,
        "totalTokens": None,
        "response": None,
    }


def normalize_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def call_model(model: str, prompt: str) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 500,
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"{API_BASE}/chat/completions",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )

    started = time.perf_counter()
    raw_body = ""
    status_code = 0

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status_code = response.status
            raw_body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        status_code = getattr(exc, "code", 0) or 0
        raw_body = exc.read().decode("utf-8", errors="replace")
    except TimeoutError:
        return failure_result(model, f"Request timed out after {REQUEST_TIMEOUT_SECONDS}s")
    except Exception as exc:
        return failure_result(model, f"Request failed: {exc}")

    response_time = int((time.perf_counter() - started) * 1000)

    if not raw_body.strip():
        return failure_result(model, "Empty response from API")

    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        return {
            "model": model,
            "success": False,
            "error": f"Invalid JSON response: {exc.msg} at line {exc.lineno} column {exc.colno}",
            "responseTime": response_time,
            "tokensGenerated": None,
            "totalTokens": None,
            "response": raw_body,
        }

    error_obj = data.get("error")
    error_message = ""
    if isinstance(error_obj, dict):
        error_message = str(error_obj.get("message") or "").strip()
    elif isinstance(error_obj, str):
        error_message = error_obj.strip()

    if status_code >= 400:
        if not error_message:
            error_message = f"HTTP {status_code} returned by API"
        else:
            error_message = f"HTTP {status_code}: {error_message}"
        return failure_result(model, error_message)

    if error_message:
        return failure_result(model, error_message)

    choices = data.get("choices")
    content = ""
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        if isinstance(first_choice, dict):
            message = first_choice.get("message")
            if isinstance(message, dict):
                content = normalize_content(message.get("content"))

    if not content.strip():
        return failure_result(model, "No content in response")

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    completion_tokens = to_int(usage.get("completion_tokens"))
    total_tokens = to_int(usage.get("total_tokens"))

    return {
        "model": model,
        "success": True,
        "responseTime": response_time,
        "tokensGenerated": completion_tokens,
        "totalTokens": total_tokens,
        "response": content,
        "error": None,
    }


def compile_output(timestamp: str, prompt: str, models: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [item for item in models if item.get("success")]
    success_count = len(successful)
    total_count = len(models)

    if successful:
        fastest = min(
            successful,
            key=lambda item: item.get("responseTime")
            if isinstance(item.get("responseTime"), int)
            else float("inf"),
        )
        fastest_model = fastest.get("model", "N/A")
        fastest_time = fastest.get("responseTime", 0) or 0
    else:
        fastest_model = "N/A"
        fastest_time = 0

    return {
        "timestamp": timestamp,
        "prompt": prompt,
        "models": models,
        "summary": {
            "successCount": success_count,
            "totalModels": total_count,
            "fastestModel": fastest_model,
            "fastestTime": fastest_time,
        },
    }


def update_history(new_run: dict[str, Any]) -> None:
    write_run(new_run)
    print(f"History updated: {str(SCRIPT_DIR.parent / 'history.db')}")


def main() -> int:
    if not API_KEY:
        print("Error: NIM_API_KEY environment variable not set", file=sys.stderr)
        return 1

    models = selected_models()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    runtime_prompt = build_runtime_prompt()

    mode_label = f" (model {MODEL_INDEX}: {models[0]})" if MODEL_INDEX is not None else ""
    print(f"Starting NVIDIA NIM Model Benchmarks{mode_label}...")
    print(f"Timestamp: {timestamp}")
    print(f"Testing {len(models)} model(s)...")
    print()

    results: list[dict[str, Any]] = []
    for model in models:
        print(f"Testing: {model}")
        result = call_model(model, runtime_prompt)
        if result.get("success"):
            print(
                f"  ✓ Success ({result['responseTime']}ms, {result.get('tokensGenerated', 0)} tokens)"
            )
        else:
            print(f"  ✗ Failed: {result.get('error') or 'Unknown error'}")
        results.append(result)
        time.sleep(0.5)

    print()
    print("Compiling results...")

    final_json = compile_output(timestamp, runtime_prompt, results)

    if MODEL_INDEX is not None:
        output_file = SCRIPT_DIR / f"results-worker{MODEL_INDEX}.json"
    else:
        output_file = SCRIPT_DIR / "results.json"

    output_file.write_text(json.dumps(final_json, indent=2), encoding="utf-8")

    success_count = final_json["summary"]["successCount"]
    total_count = final_json["summary"]["totalModels"]
    print(f"Results saved to {output_file.name}")
    print(f"Summary: {success_count}/{total_count} successful")

    if MODEL_INDEX is None:
        update_history(final_json)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
