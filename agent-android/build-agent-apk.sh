#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
BUILD_TOOLS_DIR="$(find "$SDK_DIR/build-tools" -maxdepth 1 -mindepth 1 -type d | sort -V | tail -1)"
PLATFORM_JAR="$(find "$SDK_DIR/platforms" -maxdepth 2 -name android.jar | sort -V | tail -1)"
OUT_DIR="$ROOT_DIR/build"
CLASSES_DIR="$OUT_DIR/classes"
DEX_DIR="$OUT_DIR/dex"
RES_FLAT_DIR="$OUT_DIR/res-flat"
UNALIGNED_APK="$OUT_DIR/adb-manager-agent-unaligned.apk"
SIGNED_APK="$REPO_DIR/src-tauri/resources/agent/adb-manager-agent.apk"
DEBUG_KEYSTORE="$ROOT_DIR/debug.keystore"

find_jdk_bin() {
  for candidate in \
    "${JAVA_HOME:+$JAVA_HOME/bin}" \
    "/opt/homebrew/opt/openjdk@17/bin" \
    "/usr/local/opt/openjdk@17/bin" \
    "/opt/homebrew/opt/openjdk/bin" \
    "/usr/local/opt/openjdk/bin" \
    /opt/homebrew/Cellar/openjdk@17/*/bin \
    /usr/local/Cellar/openjdk@17/*/bin \
    /opt/homebrew/Cellar/openjdk/*/bin \
    /usr/local/Cellar/openjdk/*/bin; do
    if [ -n "$candidate" ] && [ -x "$candidate/javac" ] && "$candidate/javac" -version >/dev/null 2>&1; then
      printf "%s" "$candidate"
      return 0
    fi
  done

  local javac_path
  javac_path="$(command -v javac 2>/dev/null || true)"
  if [ -n "$javac_path" ] && "$javac_path" -version >/dev/null 2>&1; then
    dirname "$javac_path"
    return 0
  fi
  return 1
}

JDK_BIN="$(find_jdk_bin || true)"
if [ -z "$JDK_BIN" ]; then
  echo "A working JDK is required to build the Agent APK. Install openjdk@17 or set JAVA_HOME." >&2
  exit 1
fi
export PATH="$JDK_BIN:$PATH"
export JAVA_HOME="$(cd "$JDK_BIN/.." && pwd)"

rm -rf "$OUT_DIR"
mkdir -p "$CLASSES_DIR" "$DEX_DIR" "$RES_FLAT_DIR" "$(dirname "$SIGNED_APK")"

"$JDK_BIN/javac" -source 8 -target 8 \
  -bootclasspath "$PLATFORM_JAR" \
  -d "$CLASSES_DIR" \
  $(find "$ROOT_DIR/src/main/java" -name '*.java' | sort)

"$BUILD_TOOLS_DIR/d8" \
  --lib "$PLATFORM_JAR" \
  --output "$DEX_DIR" \
  $(find "$CLASSES_DIR" -name '*.class' | sort)

RESOURCE_ARGS=()
if [ -d "$ROOT_DIR/src/main/res" ]; then
  "$BUILD_TOOLS_DIR/aapt2" compile \
    --dir "$ROOT_DIR/src/main/res" \
    -o "$RES_FLAT_DIR"
  while IFS= read -r resource_file; do
    RESOURCE_ARGS+=("$resource_file")
  done < <(find "$RES_FLAT_DIR" -name '*.flat' | sort)
fi

"$BUILD_TOOLS_DIR/aapt2" link \
  --manifest "$ROOT_DIR/AndroidManifest.xml" \
  -I "$PLATFORM_JAR" \
  --min-sdk-version 23 \
  --target-sdk-version 35 \
  --version-code 4 \
  --version-name 0.1.3 \
  -o "$UNALIGNED_APK" \
  --java "$OUT_DIR/generated" \
  "${RESOURCE_ARGS[@]}"

zip -j "$UNALIGNED_APK" "$DEX_DIR/classes.dex" >/dev/null

if [ ! -f "$DEBUG_KEYSTORE" ]; then
  "$JDK_BIN/keytool" -genkeypair \
    -keystore "$DEBUG_KEYSTORE" \
    -storepass android \
    -keypass android \
    -alias androiddebugkey \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi

"$BUILD_TOOLS_DIR/zipalign" -f 4 "$UNALIGNED_APK" "$OUT_DIR/adb-manager-agent-aligned.apk"
"$BUILD_TOOLS_DIR/apksigner" sign \
  --ks "$DEBUG_KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --v4-signing-enabled false \
  --out "$SIGNED_APK" \
  "$OUT_DIR/adb-manager-agent-aligned.apk"

"$BUILD_TOOLS_DIR/apksigner" verify "$SIGNED_APK"
rm -f "$SIGNED_APK.idsig"
echo "Built $SIGNED_APK"
