#!/usr/bin/env bash
# Usage: commit-generated.sh GIT_DIR HEAD_SHA PAYLOAD_DIR [--check]
#   GENERATED_PATHS         space-separated paths of the generated files, relative to PAYLOAD_DIR and the tree
#   REGEN_NAME, REGEN_EMAIL the identity of regenerate commits
#
# Builds the regenerate commit on top of HEAD_SHA with git plumbing alone. No working tree is checked out and no
# index is built: it reads only the trees along the generated paths (one directory at a time, NUL-delimited, names
# matched exactly), rebuilds just those trees with mktree, and leaves every other entry as the same object id. So
# nothing in the pull request (symlinks, .gitattributes, hooks) is written to disk or interpreted, and the rest of
# the head tree is never parsed.
#
# Refuses a head tree where a generated path or one of its ancestors is anything but a regular file or a directory,
# or appears more than once. Prints the new commit id, or nothing if the files already match.
# With --check, writes nothing and prints changed=true or changed=false.
#
# Loop guard: if HEAD_SHA is itself a regenerate commit and the files still differ, the generator is not
# deterministic, and this fails rather than stacking another commit.
set -euo pipefail
set -f  # GENERATED_PATHS is split unquoted; never glob it
git_dir="${1:?git dir}"
head="${2:?head sha}"
payload="${3:?payload dir}"
mode="${4:-commit}"
: "${GENERATED_PATHS:?}" "${REGEN_NAME:?}" "${REGEN_EMAIL:?}"
fail() { echo "::error::$*" >&2; exit 1; }
export GIT_DIR="$git_dir" GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1
g() { git -c core.hooksPath=/dev/null "$@"; }
subject="chore: regenerate code from the synced spec"
listing="$(mktemp)"; trap 'rm -f "$listing"' EXIT

[[ "$head" =~ ^[0-9a-f]{40}$ ]] || fail "the head is not a full commit id"
[ "$(g cat-file -t "$head" 2>/dev/null)" = commit ] || fail "the head commit is not in the repository"
root="$(g rev-parse --verify --quiet "$head^{tree}")" || fail "the head commit has no tree"

# lookup TREE NAME: prints "MODE TYPE OID" for the one entry named NAME in TREE, or nothing if there is none.
lookup() {
  local found="" count=0 entry
  g ls-tree -z "$1" > "$listing" || fail "cannot read a tree of the pull request"
  while IFS= read -r -d '' entry; do
    if [ "${entry#*$'\t'}" = "$2" ]; then found="${entry%%$'\t'*}"; count=$((count + 1)); fi
  done < "$listing"
  [ "$count" -le 1 ] || fail "the pull request has more than one entry named $2 on a generated path"
  echo "$found"
}

declare -A blob=() file_mode=()
changed=false
for rel in $GENERATED_PATHS; do
  case "$rel" in /*|*..*|.git|.git/*|*/.git|*/.git/*|*//*|*/|*[[*?\\]*) fail "refusing a path in GENERATED_PATHS" ;; esac
  [ -f "$payload/$rel" ] && [ ! -L "$payload/$rel" ] || fail "payload $rel is not a regular file"
  # Walk down from the root: each ancestor must be a directory (or absent), the path itself a regular file
  # (or absent).
  tree="$root"; current=""
  IFS=/ read -ra parts <<<"$rel"
  for ((i = 0; i < ${#parts[@]} - 1; i++)); do
    [ -n "$tree" ] || break
    entry="$(lookup "$tree" "${parts[i]}")"
    if [ -z "$entry" ]; then tree=""; break; fi
    [ "${entry%% *}" = 040000 ] && [ "$(cut -d' ' -f2 <<<"$entry")" = tree ] \
      || fail "an ancestor of $rel is not a directory in the pull request"
    tree="${entry##* }"
  done
  if [ -n "$tree" ]; then current="$(lookup "$tree" "${parts[-1]}")"; fi
  case "${current%% *}" in ""|100644|100755) ;; *) fail "$rel is not a regular file in the pull request" ;; esac
  if [ -n "$current" ] && [ "$(cut -d' ' -f2 <<<"$current")" != blob ]; then fail "$rel is not a regular file in the pull request"; fi
  file_mode[$rel]="${current%% *}"; file_mode[$rel]="${file_mode[$rel]:-100644}"
  if [ "$mode" = --check ]; then blob[$rel]="$(g hash-object --no-filters -- "$payload/$rel")"
  else blob[$rel]="$(g hash-object -w --no-filters -- "$payload/$rel")"; fi
  [ "${current##* }" = "${blob[$rel]}" ] || changed=true
done

if [ "$changed" = true ] && [ "$(g log -1 --format='%ae%n%s' "$head")" = "$REGEN_EMAIL"$'\n'"$subject" ]; then
  fail "the head is already a regenerate commit and the generated files still differ; the generator is not deterministic"
fi
if [ "$mode" = --check ]; then echo "changed=$changed"; exit 0; fi
[ "$changed" = true ] || exit 0

# build TREE PREFIX: prints the id of TREE (empty for a new directory) with the generated paths under PREFIX
# replaced. Only TREE's own listing is read; untouched entries are copied as they are.
build() {
  local tree="$1" prefix="$2" entry name rel child sub
  local -a out=()
  local -A replace=()
  for rel in $GENERATED_PATHS; do
    [[ "$rel" == "$prefix"* ]] || continue
    child="${rel#"$prefix"}"; replace[${child%%/*}]=1
  done
  if [ -n "$tree" ]; then
    g ls-tree -z "$tree" > "$listing" || fail "cannot read a tree of the pull request"
    while IFS= read -r -d '' entry; do
      name="${entry#*$'\t'}"
      [ -n "${replace[$name]+x}" ] || out+=("$entry")
    done < "$listing"
  fi
  for name in "${!replace[@]}"; do
    rel="$prefix$name"
    if [ -n "${blob[$rel]+x}" ]; then
      out+=("${file_mode[$rel]} blob ${blob[$rel]}"$'\t'"$name")
    else
      sub=""
      if [ -n "$tree" ]; then entry="$(lookup "$tree" "$name")"; sub="${entry:+${entry##* }}"; fi
      sub="$(build "$sub" "$rel/")"
      out+=("040000 tree $sub"$'\t'"$name")
    fi
  done
  printf '%s\0' "${out[@]}" | g mktree -z
}

tree="$(build "$root" "")"
GIT_AUTHOR_NAME="$REGEN_NAME" GIT_AUTHOR_EMAIL="$REGEN_EMAIL" GIT_COMMITTER_NAME="$REGEN_NAME" GIT_COMMITTER_EMAIL="$REGEN_EMAIL" \
  g commit-tree "$tree" -p "$head" -m "$subject"
