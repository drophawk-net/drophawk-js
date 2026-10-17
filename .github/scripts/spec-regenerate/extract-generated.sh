#!/usr/bin/env bash
# Usage: extract-generated.sh ZIP OUT_DIR
#   GENERATED_PATHS  space-separated paths of the generated files, the only members ZIP may hold
#   MAX_FILE_BYTES   size cap for each generated file
#   MAX_ZIP_BYTES    size cap for the zip itself
#
# ZIP is the artifact of the spec-regenerate workflow, which ran pull request code and is untrusted. It must hold
# exactly GENERATED_PATHS as regular files (directory entries for their ancestors are allowed), and nothing else:
# no other paths, duplicates, symlinks or traversal. Members are never extracted by the names in the archive: each
# expected path is read with `unzip -p` into a file this script names, and reading stops at the size cap, so a
# zip bomb cannot fill the disk. Failures never print names read from the archive.
set -euo pipefail
set -f  # GENERATED_PATHS is split unquoted; never glob it
zip="${1:?zip}"
out="${2:?out dir}"
: "${GENERATED_PATHS:?}" "${MAX_FILE_BYTES:?}" "${MAX_ZIP_BYTES:?}"
fail() { echo "::error::$*"; exit 1; }

expected=()
for rel in $GENERATED_PATHS; do
  case "$rel" in /*|*..*|.git|.git/*|*/.git|*/.git/*|*[[*?\\]*) fail "refusing a path in GENERATED_PATHS" ;; esac
  expected+=("$rel")
done

[ -f "$zip" ] && [ ! -L "$zip" ] || fail "the artifact is not a regular file"
size="$(stat -c %s "$zip")"
[ "$size" -le "$MAX_ZIP_BYTES" ] || fail "the artifact is $size bytes, over the $MAX_ZIP_BYTES byte cap"

listing="$(zipinfo -1 "$zip" 2>/dev/null)" || fail "the artifact is not a readable zip"
count="$(zipinfo -t "$zip" 2>/dev/null | awk '{print $1}')" || fail "the artifact is not a readable zip"
# A name holding a newline would list as several lines, so the entry count must match the line count too.
[ "$count" = "$(printf '%s\n' "$listing" | wc -l)" ] || fail "the artifact lists an entry with an unusual name"

want_dirs="$(for p in "${expected[@]}"; do d="$(dirname "$p")"; while [ "$d" != . ]; do echo "$d/"; d="$(dirname "$d")"; done; done | sort -u)"
files="$(printf '%s\n' "$listing" | grep -v '/$' | sort || true)"
dirs="$(printf '%s\n' "$listing" | grep '/$' | sort || true)"
[ "$files" = "$(printf '%s\n' "${expected[@]}" | sort)" ] \
  || fail "the artifact does not hold exactly the ${#expected[@]} generated files ($count entries found)"
[ -z "$dirs" ] || [ -z "$(comm -23 <(printf '%s\n' "$dirs") <(printf '%s\n' "$want_dirs"))" ] \
  || fail "the artifact holds a directory that is not an ancestor of a generated file"

for rel in "${expected[@]}"; do
  mode="$(zipinfo "$zip" "$rel" 2>/dev/null | head -n1)" || fail "cannot read the mode of $rel"
  [ "${mode:0:1}" = "-" ] || fail "$rel is not a regular file in the artifact"
done

[ ! -e "$out" ] && [ ! -L "$out" ] || fail "the output directory already exists"
for rel in "${expected[@]}"; do
  mkdir -p "$out/$(dirname "$rel")"
  if ! unzip -p "$zip" "$rel" 2>/dev/null | head -c "$((MAX_FILE_BYTES + 1))" > "$out/$rel"; then
    fail "could not read $rel from the artifact (corrupt, or over the size cap)"
  fi
  [ "$(stat -c %s "$out/$rel")" -le "$MAX_FILE_BYTES" ] || fail "$rel is over the $MAX_FILE_BYTES byte cap"
done
