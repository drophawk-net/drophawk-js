#!/usr/bin/env bash
# Usage: push-generated.sh GIT_DIR URL HEAD_SHA NEW_SHA     (SYNC_BRANCH: the branch to update)
# Pushes NEW_SHA to SYNC_BRANCH at URL only if the branch still points at HEAD_SHA: an exact compare-and-swap, which
# fails if the branch moved or no longer exists, and never creates it.
#
# Losing the swap is expected, not an error, and ends with a notice: the spec sync may have rewritten or deleted the
# branch, or another run for the same head may already have pushed its regenerate commit. Only a rejection while the
# branch still points at HEAD_SHA, or a remote that cannot be read, fails.
set -euo pipefail
git_dir="${1:?git dir}"
url="${2:?url}"
head="${3:?head sha}"
new="${4:?new sha}"
: "${SYNC_BRANCH:?}"
ref="refs/heads/$SYNC_BRANCH"
export GIT_DIR="$git_dir" GIT_CONFIG_NOSYSTEM=1

if git -c core.hooksPath=/dev/null push --quiet --no-verify --force-with-lease="$ref:$head" "$url" "$new:$ref"; then
  echo "Pushed the regenerated files to $SYNC_BRANCH."
  exit 0
fi

status=0
remote="$(git ls-remote --exit-code "$url" "$ref")" || status=$?
case "$status" in
  0) ;;
  2) echo "::notice::$SYNC_BRANCH no longer exists (the sync pull request was closed); nothing was pushed."; exit 0 ;;
  *) echo "::error::the push was rejected and $SYNC_BRANCH could not be read back"; exit 1 ;;
esac
if [ "${remote%%$'\t'*}" != "$head" ]; then
  echo "::notice::$SYNC_BRANCH moved on while this run was working (the spec sync rewrote it, or another run already pushed the regenerate commit for this head); nothing was pushed."
  exit 0
fi
echo "::error::the push was rejected although $SYNC_BRANCH has not moved"
exit 1
