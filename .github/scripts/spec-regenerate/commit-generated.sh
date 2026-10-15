#!/usr/bin/env bash
# Usage: commit-generated.sh GIT_DIR HEAD_SHA PAYLOAD_DIR [--check]
#   GENERATED_PATHS         space-separated paths of the generated files, relative to PAYLOAD_DIR and the tree
#   REGEN_NAME, REGEN_EMAIL the identity of regenerate commits
#
# Builds the regenerate commit on top of HEAD_SHA with git plumbing alone: no working tree is checked out, so
# nothing in the pull request (symlinks, .gitattributes, hooks) is ever written to disk or interpreted. The commit
# replaces exactly GENERATED_PATHS, and refuses a head tree where one of them, or one of its ancestors, is anything
# but a regular file or a directory. Prints the new commit id, or nothing if the files already match.
# With --check, writes nothing and prints changed=true or changed=false.
#
# Loop guard: if HEAD_SHA is itself a regenerate commit and the files still differ, the generator is not
# deterministic, and this fails rather than stacking another commit.
set -euo pipefail
git_dir="${1:?git dir}"
head="${2:?head sha}"
payload="${3:?payload dir}"
mode="${4:-commit}"
: "${GENERATED_PATHS:?}" "${REGEN_NAME:?}" "${REGEN_EMAIL:?}"
fail() { echo "::error::$*" >&2; exit 1; }
export GIT_DIR="$git_dir" GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1
g() { git -c core.hooksPath=/dev/null "$@"; }
subject="chore: regenerate code from the synced spec"

[[ "$head" =~ ^[0-9a-f]{40}$ ]] || fail "the head is not a full commit id"
[ "$(g cat-file -t "$head" 2>/dev/null)" = commit ] || fail "the head commit is not in the repository"

changed=false
blobs=()
for rel in $GENERATED_PATHS; do
  case "$rel" in /*|*..*|.git|.git/*|*/.git|*/.git/*) fail "refusing a path in GENERATED_PATHS" ;; esac
  [ -f "$payload/$rel" ] && [ ! -L "$payload/$rel" ] || fail "payload $rel is not a regular file"
  # Each ancestor must be a directory (or absent), and the path itself a regular file (or absent).
  d="$(dirname "$rel")"
  while [ "$d" != . ]; do
    t="$(g ls-tree --format='%(objectmode)' "$head" -- "$d")"
    [ -z "$t" ] || [ "$t" = 040000 ] || fail "an ancestor of $rel is not a directory in the pull request"
    d="$(dirname "$d")"
  done
  t="$(g ls-tree --format='%(objectmode) %(objectname)' "$head" -- "$rel")"
  case "${t%% *}" in ""|100644|100755) ;; *) fail "$rel is not a regular file in the pull request" ;; esac
  if [ "$mode" = --check ]; then blob="$(g hash-object --no-filters -- "$payload/$rel")"
  else blob="$(g hash-object -w --no-filters -- "$payload/$rel")"; fi
  [ "${t#* }" = "$blob" ] || changed=true
  blobs+=("${t%% *}" "$blob" "$rel")
done

if [ "$changed" = true ] && [ "$(g log -1 --format='%ae%n%s' "$head")" = "$REGEN_EMAIL"$'\n'"$subject" ]; then
  fail "the head is already a regenerate commit and the generated files still differ; the generator is not deterministic"
fi
if [ "$mode" = --check ]; then echo "changed=$changed"; exit 0; fi
[ "$changed" = true ] || exit 0

index="$(mktemp)"; trap 'rm -f "$index"' EXIT
export GIT_INDEX_FILE="$index"
g read-tree "$head"
for ((i = 0; i < ${#blobs[@]}; i += 3)); do
  g update-index --add --cacheinfo "${blobs[i]:-100644},${blobs[i+1]},${blobs[i+2]}"
done
tree="$(g write-tree)"
GIT_AUTHOR_NAME="$REGEN_NAME" GIT_AUTHOR_EMAIL="$REGEN_EMAIL" GIT_COMMITTER_NAME="$REGEN_NAME" GIT_COMMITTER_EMAIL="$REGEN_EMAIL" \
  g commit-tree "$tree" -p "$head" -m "$subject"
