#!/usr/bin/env python3
"""
Modified LLM Judge using QWEN model via OpenAI-compatible API
"""

import json
import os
import re
from pathlib import Path
from openai import OpenAI


def parse_rubric_levels(rubric_text: str) -> dict[str, dict[str, int]]:
    """Parse the rubric into {criterion_<N>: {"A": pts, "B": pts, "C": pts}}.

    Supports the current rubric format (single `Levels: A=X B=Y C=0` header per
    criterion) and the legacy format (per-line `[A] (N points): ...`).
    """
    out: dict[str, dict[str, int]] = {}
    parts = re.split(r"^Criterion\s+(\d+)\s*:", rubric_text, flags=re.MULTILINE)
    for i in range(1, len(parts), 2):
        n = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        levels: dict[str, int] = {}
        # Current format: single "Levels: A=X B=Y C=0" header
        m = re.search(
            r"Levels:\s*((?:[A-Z]=\d+\s*)+)",
            body,
        )
        if m:
            for lm in re.finditer(r"([A-Z])=(\d+)", m.group(1)):
                levels[lm.group(1).upper()] = int(lm.group(2))
        # Legacy fallback: per-line "[A] (N points)"
        if not levels:
            for lm in re.finditer(r"\[([A-Z])\]\s*\(\s*(\d+)\s*points?\s*\)", body):
                levels[lm.group(1).upper()] = int(lm.group(2))
        if levels:
            out[f"criterion_{n}"] = levels
    return out


def main():
    import sys

    # Parse command line arguments
    if len(sys.argv) < 4:
        print("Usage: python llm_judge_qwen.py <trace_path> <answer_path> <rubric_path> [output_path]")
        sys.exit(1)

    trace_path = Path(sys.argv[1])
    answer_path = Path(sys.argv[2])
    rubric_path = Path(sys.argv[3])
    output_path = Path(sys.argv[4]) if len(sys.argv) > 4 else Path("judge_result.json")

    # Read rubric
    if not rubric_path.exists():
        print(f"ERROR: rubric file not found: {rubric_path}")
        sys.exit(1)

    rubric = rubric_path.read_text()

    # Read agent outputs
    trace_content = ""
    answer_content = ""

    if trace_path.exists():
        trace_content = trace_path.read_text()
    else:
        print(f"Warning: trace.md not found at {trace_path}")

    if answer_path.exists():
        answer_content = answer_path.read_text()
    else:
        print(f"Warning: answer.txt not found at {answer_path}")

    # If no output files exist, score is 0
    if not trace_content and not answer_content:
        print("No output files found. Score: 0")
        result = {"score": 0, "error": "No output files found"}
        output_path.write_text(json.dumps(result, indent=2))
        sys.exit(0)

    # Use OpenAI-compatible API with QWEN model
    client = OpenAI(
        api_key=os.getenv("QWEN_API_KEY", os.getenv("OPENAI_API_KEY", "dummy")),
        base_url=os.getenv("QWEN_BASE_URL", "https://api.gpugeek.com/v1")
    )

    prompt = f"""You are an expert evaluator for a data analysis task.

Evaluate the agent's work using the following rubric:

{rubric}

Here is the agent's analysis trace:

<trace>
{trace_content if trace_content else "[No trace file provided]"}
</trace>

Here is the agent's final answer:

<answer>
{answer_content if answer_content else "[No answer file provided]"}
</answer>

For each criterion in the rubric, choose ONE level: A, B, or C — based purely on which level description best describes the agent's work. Do not output numerical points; the score for each level is computed automatically from the rubric.

You MUST respond with a JSON object in exactly this format:
{{
  "criteria": {{
    "criterion_1": {{"level": "A", "reason": "<one-sentence explanation>"}},
    "criterion_2": {{"level": "B", "reason": "<one-sentence explanation>"}},
    ...
  }},
  "overall_reasoning": "<short summary>"
}}

Each "level" value must be exactly the single character "A", "B", or "C". Only output the JSON object, nothing else."""

    try:
        response = client.chat.completions.create(
            model=os.getenv("QWEN_MODEL", "Qwen/Qwen2.5-72B-Instruct"),
            max_tokens=8192,
            temperature=0.3,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        )

        response_text = response.choices[0].message.content
        print(f"Raw response (first 1000 chars): {response_text[:1000]}...")

    except Exception as e:
        print(f"API call failed: {e}")
        result = {"score": 0, "error": str(e)}
        output_path.write_text(json.dumps(result, indent=2))
        sys.exit(1)

    # Parse JSON from response
    total_score = 0
    criteria = {}
    reasoning = ""

    try:
        # Try to find JSON object in response
        start_idx = response_text.find('{')
        if start_idx != -1:
            brace_count = 0
            end_idx = start_idx
            for i, char in enumerate(response_text[start_idx:], start_idx):
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        end_idx = i + 1
                        break
            json_str = response_text[start_idx:end_idx]
            result = json.loads(json_str)
        else:
            result = json.loads(response_text)

        criteria = result.get("criteria", {})
        reasoning = result.get("overall_reasoning", result.get("reasoning", "No reasoning provided"))

        # Parse rubric levels and compute score
        try:
            criterion_levels = parse_rubric_levels(rubric)
        except Exception as parse_err:
            print(f"NOTE: failed to parse rubric levels: {parse_err}")
            criterion_levels = {}

        # Compute total score from levels
        detailed_scores = {}
        for crit_key, crit_data in criteria.items():
            if not isinstance(crit_data, dict):
                continue
            level = crit_data.get("level", "C").upper()
            if crit_key in criterion_levels and level in criterion_levels[crit_key]:
                points = criterion_levels[crit_key][level]
                detailed_scores[crit_key] = {
                    "level": level,
                    "points": points,
                    "reason": crit_data.get("reason", "")
                }
                total_score += points
            else:
                detailed_scores[crit_key] = {
                    "level": level,
                    "points": 0,
                    "reason": crit_data.get("reason", "")
                }

        criteria = detailed_scores

    except (json.JSONDecodeError, ValueError) as e:
        print(f"Failed to parse JSON: {e}")
        print(f"Response was: {response_text}")

        # Try to extract total score from text
        score_match = re.search(r'"total_score"\s*:\s*(\d+)', response_text)
        if not score_match:
            score_match = re.search(r'"score"\s*:\s*(\d+)', response_text)

        if score_match:
            total_score = int(score_match.group(1))
        else:
            total_score = 0

        criteria = {}
        reasoning = f"Failed to parse full response: {str(e)}"

    # Clamp score to valid range
    total_score = max(0, min(100, total_score))

    print(f"\n{'='*70}")
    print(f"Total Score: {total_score}/100")
    print(f"{'='*70}")
    print(f"\nCriteria Scores:")
    for crit_key, crit_data in criteria.items():
        if isinstance(crit_data, dict):
            level = crit_data.get("level", "?")
            points = crit_data.get("points", 0)
            reason = crit_data.get("reason", "")
            print(f"  {crit_key}: Level {level} ({points} pts) - {reason}")
    print(f"\nOverall Reasoning: {reasoning}")
    print(f"{'='*70}\n")

    # Write result
    evaluation_data = {
        "total_score": total_score,
        "max_score": 100,
        "criteria": criteria,
        "overall_reasoning": reasoning,
        "model": os.getenv("QWEN_MODEL", "Qwen/Qwen2.5-72B-Instruct"),
        "trace_file": str(trace_path),
        "answer_file": str(answer_path),
        "rubric_file": str(rubric_path)
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(evaluation_data, indent=2))

    print(f"Results saved to: {output_path}")


if __name__ == "__main__":
    main()
