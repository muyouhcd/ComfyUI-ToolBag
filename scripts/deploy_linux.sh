#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TOOLBAG_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="${COMFYUI_ROOT:-$(cd -- "$TOOLBAG_DIR/../.." && pwd)}"
VENV_DIR="${COMFYUI_VENV_DIR:-$ROOT_DIR/venv-linux}"
HOST="${COMFYUI_HOST:-127.0.0.1}"
PORT="${COMFYUI_PORT:-8188}"
MODE="foreground"

case "${1:-}" in
    --background|--setup-only)
        MODE="${1#--}"
        shift
        ;;
esac

log() {
    printf '[ComfyUI] %s\n' "$*"
}

fail() {
    printf '[ComfyUI] ERROR: %s\n' "$*" >&2
    exit 1
}

retry() {
    local attempt=1

    until "$@"; do
        if (( attempt >= 3 )); then
            return 1
        fi
        log "Command failed. Retrying in $((attempt * 3)) seconds ($((attempt + 1))/3)..."
        sleep "$((attempt * 3))"
        ((attempt += 1))
    done
}

as_root() {
    if (( EUID == 0 )); then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        fail "System packages are missing and sudo is unavailable. Run this script as root."
    fi
}

install_system_dependencies() {
    log "Installing Python, venv, pip, and Git..."

    if command -v apt-get >/dev/null 2>&1; then
        retry as_root apt-get update
        retry as_root apt-get install -y python3 python3-venv python3-pip git
    elif command -v dnf >/dev/null 2>&1; then
        retry as_root dnf install -y python3 python3-pip git
    elif command -v yum >/dev/null 2>&1; then
        retry as_root yum install -y python3 python3-pip git
    elif command -v pacman >/dev/null 2>&1; then
        retry as_root pacman -Sy --needed --noconfirm python python-pip git
    elif command -v zypper >/dev/null 2>&1; then
        retry as_root zypper --non-interactive install python3 python3-pip git
    else
        fail "Unsupported package manager. Install Python 3.10+, python venv, pip, and Git, then rerun."
    fi
}

find_python() {
    local candidate

    for candidate in "${COMFYUI_PYTHON:-}" python3 python3.13 python3.12 python3.11 python3.10; do
        [[ -n "$candidate" ]] || continue
        command -v "$candidate" >/dev/null 2>&1 || continue
        if "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
            PYTHON_BIN="$(command -v "$candidate")"
            return 0
        fi
    done
    return 1
}

pip_install() {
    if retry "$VENV_PYTHON" -m pip install --prefer-binary "$@"; then
        return 0
    fi

    log "Normal installation failed. Retrying without the pip cache..."
    retry "$VENV_PYTHON" -m pip install --no-cache-dir --prefer-binary "$@"
}

detect_torch_index() {
    if [[ -n "${COMFYUI_TORCH_INDEX_URL:-}" ]]; then
        TORCH_INDEX_URL="$COMFYUI_TORCH_INDEX_URL"
        TORCH_DEVICE="custom"
    elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
        TORCH_INDEX_URL="https://download.pytorch.org/whl/cu130"
        TORCH_DEVICE="NVIDIA CUDA"
    elif [[ -e /dev/kfd ]] || command -v rocm-smi >/dev/null 2>&1; then
        TORCH_INDEX_URL="https://download.pytorch.org/whl/rocm7.2"
        TORCH_DEVICE="AMD ROCm"
    elif command -v xpu-smi >/dev/null 2>&1; then
        TORCH_INDEX_URL="https://download.pytorch.org/whl/xpu"
        TORCH_DEVICE="Intel XPU"
    else
        TORCH_INDEX_URL="https://download.pytorch.org/whl/cpu"
        TORCH_DEVICE="CPU"
    fi
}

cd "$ROOT_DIR"
[[ -f main.py && -f requirements.txt ]] || fail "ComfyUI root not found: $ROOT_DIR"

if ! find_python; then
    install_system_dependencies
    find_python || fail "Python 3.10 or newer could not be found after package installation."
fi

if ! command -v git >/dev/null 2>&1 || ! "$PYTHON_BIN" -m venv --help >/dev/null 2>&1; then
    install_system_dependencies
fi

if [[ -d "$VENV_DIR" && ! -x "$VENV_DIR/bin/python" ]]; then
    if [[ "$VENV_DIR" == "$ROOT_DIR/venv-linux" ]]; then
        BROKEN_VENV="$VENV_DIR.broken-$(date +%Y%m%d-%H%M%S)"
        log "Moving the incomplete environment to $BROKEN_VENV"
        mv -- "$VENV_DIR" "$BROKEN_VENV"
    else
        fail "The configured environment is invalid: $VENV_DIR"
    fi
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    log "Creating Linux virtual environment with $PYTHON_BIN..."
    if ! "$PYTHON_BIN" -m venv "$VENV_DIR"; then
        install_system_dependencies
        "$PYTHON_BIN" -m venv "$VENV_DIR"
    fi
fi

VENV_PYTHON="$VENV_DIR/bin/python"
export PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-120}"
export PIP_RETRIES="${PIP_RETRIES:-10}"

log "Updating Python packaging tools..."
pip_install --upgrade pip setuptools wheel

detect_torch_index
log "Installing PyTorch for $TORCH_DEVICE..."
pip_install torch torchvision torchaudio --index-url "$TORCH_INDEX_URL"

log "Installing ComfyUI dependencies..."
pip_install -r requirements.txt

if [[ -f manager_requirements.txt ]]; then
    log "Installing ComfyUI Manager..."
    pip_install -r manager_requirements.txt
fi

if ! "$VENV_PYTHON" -m pip check; then
    log "Repairing inconsistent dependencies..."
    pip_install --upgrade -r requirements.txt
    [[ ! -f manager_requirements.txt ]] || pip_install --upgrade -r manager_requirements.txt
    "$VENV_PYTHON" -m pip check
fi

log "Environment is ready: $VENV_DIR"
if [[ "$MODE" == "setup-only" ]]; then
    exit 0
fi

COMFYUI_ARGS=(main.py --enable-manager --listen "$HOST" --port "$PORT" "$@")
log "ComfyUI will listen on $HOST:$PORT"

if [[ "$MODE" == "background" ]]; then
    LOG_FILE="$ROOT_DIR/comfyui.log"
    PID_FILE="$VENV_DIR/comfyui.pid"
    if [[ -f "$PID_FILE" ]]; then
        EXISTING_PID="$(<"$PID_FILE")"
        if [[ "$EXISTING_PID" =~ ^[0-9]+$ ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
            log "ComfyUI is already running (PID $EXISTING_PID)."
            exit 0
        fi
        rm -f -- "$PID_FILE"
    fi
    nohup "$VENV_PYTHON" "${COMFYUI_ARGS[@]}" >"$LOG_FILE" 2>&1 &
    printf '%s\n' "$!" >"$PID_FILE"
    log "Started in the background (PID $!). Log: $LOG_FILE"
    exit 0
fi

exec "$VENV_PYTHON" "${COMFYUI_ARGS[@]}"
