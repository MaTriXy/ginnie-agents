#!/usr/bin/env bash
# Install whisper.cpp + small multilingual model into listener/.whisper/.
# Used by the setup skill's optional voice-transcription step. Idempotent —
# safe to re-run; skips work that's already done.
#
# After this completes, the listener can transcribe Slack voice memos and
# attached audio files locally (zero per-message cost, fully offline).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="$REPO_ROOT/listener/.whisper"
WHISPER_REPO="$WHISPER_DIR/whisper.cpp"
MODEL_DIR="$WHISPER_REPO/models"
MODEL_NAME="ggml-small.bin"
MODEL_PATH="$MODEL_DIR/$MODEL_NAME"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
info()  { printf "\033[36m▸\033[0m %s\n" "$1"; }

# ── Prerequisites ──────────────────────────────────────────────
info "Checking prerequisites…"
missing=()
for cmd in git ffmpeg make; do
	command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
# Either cmake (preferred) or just make is acceptable for whisper.cpp build.
if ! command -v cmake >/dev/null 2>&1; then
	info "cmake not found — falling back to plain Makefile build (less reliable on newer whisper.cpp)"
fi
# Compiler must be present.
if ! command -v g++ >/dev/null 2>&1 && ! command -v clang++ >/dev/null 2>&1; then
	missing+=("g++ or clang++")
fi

if [ ${#missing[@]} -gt 0 ]; then
	red "✗ missing required tools: ${missing[*]}"
	cat <<-EOF
	Install with:
	  macOS:        brew install ffmpeg cmake
	  Ubuntu/Debian: sudo apt install -y ffmpeg cmake build-essential
	EOF
	exit 1
fi
green "✓ prerequisites ok"

# ── Clone whisper.cpp ──────────────────────────────────────────
mkdir -p "$WHISPER_DIR"
if [ ! -d "$WHISPER_REPO/.git" ]; then
	info "Cloning whisper.cpp…"
	git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$WHISPER_REPO"
else
	green "✓ whisper.cpp already cloned"
fi

# ── Build ──────────────────────────────────────────────────────
BIN_NEW="$WHISPER_REPO/build/bin/whisper-cli"
BIN_OLD="$WHISPER_REPO/main"
if [ -x "$BIN_NEW" ] || [ -x "$BIN_OLD" ]; then
	green "✓ whisper.cpp binary already built"
else
	info "Building whisper.cpp (~2-3 min)…"
	cd "$WHISPER_REPO"
	if command -v cmake >/dev/null 2>&1; then
		cmake -B build
		cmake --build build --config Release -j
	else
		make -j
	fi
	if [ ! -x "$BIN_NEW" ] && [ ! -x "$BIN_OLD" ]; then
		red "✗ build completed but no binary found at expected path"
		exit 1
	fi
	green "✓ whisper.cpp built"
fi

# ── Download model ─────────────────────────────────────────────
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_PATH" ]; then
	green "✓ model already downloaded ($MODEL_NAME)"
else
	info "Downloading whisper-small model (~466MB, one-time)…"
	tmp="$MODEL_PATH.part"
	if command -v curl >/dev/null 2>&1; then
		curl -fL --progress-bar "$MODEL_URL" -o "$tmp"
	else
		wget --show-progress "$MODEL_URL" -O "$tmp"
	fi
	mv "$tmp" "$MODEL_PATH"
	green "✓ model downloaded"
fi

green "✅ whisper.cpp ready at $WHISPER_DIR"
echo "   Voice messages sent to any agent will now be transcribed locally."
