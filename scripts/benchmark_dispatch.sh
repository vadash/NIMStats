#!/usr/bin/env bash
# Dynamic dispatch: keeps N workers running, grabs next model when one finishes.
set -euo pipefail

PARALLEL="${PARALLEL:-2}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_SCRIPT="$SCRIPT_DIR/test_models.py"
TOTAL_MODELS=$(python3 -c "
import sys; sys.path.insert(0, '$SCRIPT_DIR')
from test_models import ALL_MODELS
print(len(ALL_MODELS))
")

# Build queue of model indices
queue=()
for i in $(seq 0 $((TOTAL_MODELS - 1))); do
    queue+=("$i")
done

# Shuffle queue so benchmark order is random
queue=($(printf '%s\n' "${queue[@]}" | shuf))

# Active workers: assoc array pid -> model_index
declare -A active_pids=()

dispatch() {
    local idx="${queue[0]}"
    queue=("${queue[@]:1}")
    echo ":: Dispatching model index $idx"
    MODEL_INDEX="$idx" python3 "$TEST_SCRIPT" &
    active_pids[$!]="$idx"
}

reap_finished() {
    # Find a finished PID and remove it from active set
    for pid in "${!active_pids[@]}"; do
        if ! kill -0 "$pid" 2>/dev/null; then
            wait "$pid" || true
            local idx="${active_pids[$pid]}"
            echo ":: Worker (model $idx) finished"
            unset "active_pids[$pid]"
            return 0
        fi
    done
    return 1
}

echo ":: Starting benchmark dispatch: ${TOTAL_MODELS} models, ${PARALLEL} parallel workers"

# Fill initial worker slots
while [[ ${#active_pids[@]} -lt "$PARALLEL" && ${#queue[@]} -gt 0 ]]; do
    dispatch
done

# Main loop: reap finished workers, dispatch next from queue
while [[ ${#active_pids[@]} -gt 0 ]]; do
    # If queue has items, wait for any worker then dispatch
    if [[ ${#queue[@]} -gt 0 ]]; then
        wait -n 2>/dev/null || true
        reap_finished || true
        while [[ ${#active_pids[@]} -lt "$PARALLEL" && ${#queue[@]} -gt 0 ]]; do
            dispatch
        done
    else
        # Queue empty, just wait for remaining workers
        for pid in "${!active_pids[@]}"; do
            wait "$pid" || true
            unset "active_pids[$pid]"
        done
    fi
done

echo ":: All workers complete"
