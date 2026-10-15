#!/usr/bin/env bash
# Usage: apply-generated.sh PAYLOAD_DIR CHECKOUT_DIR     (GENERATED_PATHS: space-separated paths relative to both)
# Copies exactly the GENERATED_PATHS files from the payload into a checkout of the pull request, after refusing
# anything that could write outside them: a symlink at any destination or ancestor, a destination inside .git, a
# non-regular existing destination, and .gitattributes that enable filter, diff, merge or conversion drivers.
# The checkout is pull request content, so failures never print names found in it.
set -euo pipefail
payload="${1:?payload dir}"
checkout="${2:?checkout dir}"
: "${GENERATED_PATHS:?}"
fail() { echo "::error::$*"; exit 1; }

# Attribute drivers could make `git add` run a program named by repository content.
while IFS= read -r -d '' attrs; do
  if grep -Eq '(^|[[:space:]])(filter|diff|merge|textconv|working-tree-encoding)[=]|[[:space:]]-?(filter|diff|merge)([[:space:]]|$)' "$attrs"; then
    fail "a .gitattributes file in the pull request enables a filter, diff, merge or encoding driver"
  fi
done < <(find "$checkout" -path "$checkout/.git" -prune -o -name .gitattributes -print0)
[ ! -e "$checkout/.git/info/attributes" ] || ! grep -Eq '[=]' "$checkout/.git/info/attributes" || fail ".git/info/attributes sets attributes"

for rel in $GENERATED_PATHS; do
  case "$rel" in /*|*..*|.git|.git/*|*/.git|*/.git/*) fail "refusing a path in GENERATED_PATHS" ;; esac
  [ -f "$payload/$rel" ] && [ ! -L "$payload/$rel" ] || fail "payload $rel is not a regular file"
  # Every ancestor, then the destination itself, must not be a symlink.
  walk="$checkout"
  IFS=/ read -ra parts <<<"$rel"
  for part in "${parts[@]}"; do
    walk="$walk/$part"
    [ ! -L "$walk" ] || fail "a path component of $rel is a symlink in the pull request"
  done
  [ ! -e "$checkout/$rel" ] || [ -f "$checkout/$rel" ] || fail "$rel exists in the pull request and is not a regular file"
done

for rel in $GENERATED_PATHS; do
  mkdir -p "$checkout/$(dirname "$rel")"
  [ ! -L "$checkout/$(dirname "$rel")" ] || fail "the directory of $rel became a symlink"
  cp --no-dereference --no-preserve=all "$payload/$rel" "$checkout/$rel"
done
