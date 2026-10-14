#!/usr/bin/env bash
# Vendoriza llama.cpp en vendor/llama.cpp para compilar el motor nativo de KIU.
# Uso:
#   ./scripts/vendor_llama.sh          # clona (shallow) o actualiza
#   ./scripts/vendor_llama.sh --pull   # fuerza pull al último commit
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="vendor/llama.cpp"
PIN="${LLAMA_PIN:-}"   # opcional: LLAMA_PIN=b476d9a ./scripts/vendor_llama.sh

if [ ! -d "$DIR/.git" ]; then
  echo ">> clonando llama.cpp (shallow)…"
  mkdir -p vendor
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$DIR"
else
  echo ">> actualizando llama.cpp…"
  git -C "$DIR" fetch --depth 1 origin master
  git -C "$DIR" reset --hard origin/master
fi

if [ -n "$PIN" ]; then
  echo ">> fijando commit $PIN"
  git -C "$DIR" fetch --depth 1 origin "$PIN" || true
  git -C "$DIR" checkout "$PIN"
fi

echo ">> OK: $(git -C "$DIR" rev-parse --short HEAD)"

# ---- Inyección nativa ----
# Las .so del motor NO viven en Git (app/src/main/jniLibs está en .gitignore).
# 1) Si existen precompiladas viejas en app/lib (repositorios anteriores a la
#    tanda 7), se trasladan a la ubicación estándar.
# 2) Al compilar con Gradle, el CMake deja las .so frescas en
#    app/src/main/jniLibs/<ABI> y el APK las empaqueta desde ahí.
LIBS_DIR="app/src/main/jniLibs"
OLD_DIR="app/lib/arm64-v8a"
mkdir -p "$LIBS_DIR/arm64-v8a"
if [ -d "$OLD_DIR" ] && ls "$OLD_DIR"/*.so >/dev/null 2>&1; then
  echo ">> migrando .so precompiladas de app/lib a $LIBS_DIR/arm64-v8a (fuera de Git)"
  cp -n "$OLD_DIR"/*.so "$LIBS_DIR/arm64-v8a/" 2>/dev/null || true
fi

echo ">> El build Gradle compila el motor (arm64-v8a + x86_64) al correr: ./gradlew :app:assembleDebug"
echo ">> Los .so compilados quedan en $LIBS_DIR/<ABI>/ (precompiladas reutilizables, fuera de Git)"
