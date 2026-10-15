#!/usr/bin/env bash
# Exercises extract-generated.sh and commit-generated.sh against hostile fixtures.
# Run: .github/scripts/spec-regenerate/test.sh   (needs bash, git, python3, unzip and zipinfo)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export GENERATED_PATHS="packages/sdk/src/generated/api.ts packages/mcp/src/generated/catalogue-limits.ts"
export MAX_FILE_BYTES=4096
export MAX_ZIP_BYTES=65536
pass=0; failed=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
nok()  { echo "  FAIL $1"; failed=$((failed+1)); }
expect_fail() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then nok "$name (should have failed)"; else ok "$name"; fi; }
expect_pass() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else nok "$name (should have passed)"; fi; }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else nok "$name"; fi; }
# expect_msg NAME TEXT CMD...: CMD fails with TEXT in its output.
expect_msg() {
  local name="$1" text="$2"; shift 2
  local output
  if output="$("$@" 2>&1)"; then nok "$name (should have failed)"; return; fi
  if grep -qF -- "$text" <<<"$output"; then ok "$name"; else nok "$name (failed without saying: $text)"; fi
}
# expect_quiet NAME MARKER CMD...: CMD fails and its output never contains MARKER (text from an untrusted name).
expect_quiet() {
  local name="$1" marker="$2"; shift 2
  local output
  if output="$("$@" 2>&1)"; then nok "$name (should have failed)"; return; fi
  if grep -qF -- "$marker" <<<"$output"; then nok "$name (printed the untrusted name)"; else ok "$name"; fi
}

# mkzip OUT ENTRY...: builds a zip with python. ENTRY is NAME=CONTENT (a regular file), NAME/ (a directory),
# NAME@TARGET (a symlink), or NAME%SIZE (a regular file of SIZE zero bytes).
mkzip() {
  python3 -I - "$@" <<'PY'
import sys, zipfile, warnings
warnings.simplefilter("ignore")
out, entries = sys.argv[1], sys.argv[2:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for e in entries:
        if e.endswith("/"):
            z.writestr(zipfile.ZipInfo(e), b"")
        elif "@" in e:
            name, target = e.split("@", 1)
            info = zipfile.ZipInfo(name); info.create_system = 3; info.external_attr = (0o120777 << 16)
            z.writestr(info, target)
        elif "%" in e:
            name, size = e.split("%", 1)
            info = zipfile.ZipInfo(name); info.create_system = 3; info.external_attr = (0o100644 << 16)
            z.writestr(info, b"\0" * int(size), zipfile.ZIP_DEFLATED)
        else:
            name, content = e.split("=", 1)
            info = zipfile.ZipInfo(name); info.create_system = 3; info.external_attr = (0o100644 << 16)
            z.writestr(info, content.encode(), zipfile.ZIP_DEFLATED)
PY
}
sdk=packages/sdk/src/generated/api.ts
mcp=packages/mcp/src/generated/catalogue-limits.ts
z() { local f; f="$(mktemp -p "$work" --suffix=.zip)"; rm "$f"; mkzip "$f" "$@"; echo "$f"; }
out() { echo "$work/out-$RANDOM$RANDOM"; }
extract() { "$here/extract-generated.sh" "$@"; }
evil=$'evil\n::error::injected'
secret="$work/private"; mkdir -p "$secret"; echo SECRET > "$secret/token"

echo "extract: the generate artifact holds exactly the generated files"
f="$(z "$sdk=export type A = 1;" "$mcp=export const L = 'x';")"; o="$(out)"
expect_pass "a clean artifact is extracted" extract "$f" "$o"
check "the SDK types are extracted" [ "$(cat "$o/$sdk")" = "export type A = 1;" ]
check "the catalogue limits are extracted" [ "$(cat "$o/$mcp")" = "export const L = 'x';" ]
check "nothing else is extracted" [ "$(find "$o" -type f | wc -l)" -eq 2 ]
f="$(z "packages/" "packages/sdk/" "$sdk=a" "$mcp=b")"
expect_pass "directory entries for ancestors are accepted" extract "$f" "$(out)"

f="$(z "$sdk=a")"
expect_fail "a missing generated file is refused" extract "$f" "$(out)"
f="$(z "$sdk=a" "$mcp=b" "spec/developer-v1.openapi.json={}")"
expect_fail "a spec file in the artifact is refused" extract "$f" "$(out)"
f="$(z "$sdk=a" "$mcp=b" ".github/workflows/x.yml=on: push")"
expect_fail "an extra file is refused" extract "$f" "$(out)"
f="$(z "$sdk=a" "$mcp=b" "other/")"
expect_fail "an unrelated directory entry is refused" extract "$f" "$(out)"
f="$(z "$sdk=a" "$sdk=b" "$mcp=c")"
expect_fail "a duplicate entry is refused" extract "$f" "$(out)"
f="$(z "$sdk@$secret/token" "$mcp=b")"; o="$(out)"
expect_fail "a symlink entry is refused" extract "$f" "$o"
check "nothing was written for the symlink" [ ! -e "$o/$sdk" ]
f="$(z "../$sdk=a" "$mcp=b")"
expect_fail "path traversal is refused" extract "$f" "$(out)"
f="$(z "$sdk%$((MAX_FILE_BYTES + 1))" "$mcp=b")"
expect_fail "a file over the size cap is refused" extract "$f" "$(out)"
f="$(z "$sdk%$MAX_FILE_BYTES" "$mcp=b")"
expect_pass "a file at the size cap is accepted" extract "$f" "$(out)"
f="$(z "$sdk%2000000" "$mcp=b")"
check "the zip bomb fixture is small" [ "$(stat -c %s "$f")" -lt "$MAX_ZIP_BYTES" ]
expect_fail "a small zip that inflates past the cap is refused" extract "$f" "$(out)"
f="$work/big.zip"; head -c $((MAX_ZIP_BYTES + 1)) /dev/zero > "$f"
expect_fail "a zip over the archive cap is refused" extract "$f" "$(out)"
f="$work/garbage.zip"; echo "not a zip" > "$f"
expect_fail "a corrupt zip is refused" extract "$f" "$(out)"
f="$(z "$sdk"$'\n'"$mcp=a")"
expect_fail "one entry whose name lists as both generated paths is refused" extract "$f" "$(out)"
f="$(z "$sdk=a" "$mcp=b" "$evil=c")"
expect_quiet "an unexpected name is refused without printing it" "::error::injected" extract "$f" "$(out)"
f="$(z "$sdk=a" "$mcp=b")"; o="$(out)"; mkdir "$o"
expect_fail "an existing output directory is refused" extract "$f" "$o"

echo "commit: plumbing on the fetched head commit, no working tree"
export REGEN_NAME="drophawk-js spec regenerate" REGEN_EMAIL="spec-regenerate@users.noreply.drophawk.net"
# new_repo: a bare repository whose single commit has the generated files plus a spec file; prints "GIT_DIR HEAD"
new_repo() {
  local src bare; src="$(mktemp -d -p "$work")"; bare="$(mktemp -d -p "$work")"
  git -C "$src" init -q
  mkdir -p "$src/packages/sdk/src/generated" "$src/packages/mcp/src/generated" "$src/spec"
  echo "old sdk" > "$src/$sdk"; echo "old mcp" > "$src/$mcp"; echo "{}" > "$src/spec/developer-v1.openapi.json"
  "$@" "$src"
  git -C "$src" add -A
  git -C "$src" -c user.name=t -c user.email=t@t commit -qm "chore: sync developer API spec"
  git clone -q --bare "$src" "$bare"
  echo "$bare $(git -C "$bare" rev-parse HEAD)"
}
noop() { :; }
payload() { local d; d="$(out)"; mkdir -p "$d/$(dirname "$sdk")" "$d/$(dirname "$mcp")"; echo "$1" > "$d/$sdk"; echo "$2" > "$d/$mcp"; echo "$d"; }
commit() { "$here/commit-generated.sh" "$@"; }

read -r g h <<<"$(new_repo noop)"
check "unchanged files report no change" [ "$(commit "$g" "$h" "$(payload "old sdk" "old mcp")" --check)" = "changed=false" ]
check "changed files report a change" [ "$(commit "$g" "$h" "$(payload "new sdk" "old mcp")" --check)" = "changed=true" ]
objects() { git -C "$g" cat-file --batch-all-objects --batch-check | wc -l; }
before="$(objects)"; commit "$g" "$h" "$(payload "newest sdk" "old mcp")" --check >/dev/null
check "--check writes no objects" [ "$(objects)" = "$before" ]
p="$(payload "new sdk" "new mcp")"
new="$(commit "$g" "$h" "$p")"
check "a commit is created" [ -n "$new" ]
check "its parent is the head commit" [ "$(git -C "$g" rev-parse "$new^")" = "$h" ]
check "it holds the new SDK types" [ "$(git -C "$g" show "$new:$sdk")" = "new sdk" ]
check "it holds the new catalogue limits" [ "$(git -C "$g" show "$new:$mcp")" = "new mcp" ]
check "it changes only the generated paths" [ "$(git -C "$g" diff --name-only "$h" "$new" | sort | tr '\n' ' ')" = "$mcp $sdk " ]
check "it is authored by the regenerate identity" [ "$(git -C "$g" log -1 --format='%an <%ae>' "$new")" = "$REGEN_NAME <$REGEN_EMAIL>" ]
check "the branch ref is not moved" [ "$(git -C "$g" rev-parse HEAD)" = "$h" ]
check "an unchanged payload creates no commit" [ -z "$(commit "$g" "$h" "$(payload "old sdk" "old mcp")")" ]
read -r g2 _ <<<"$(new_repo noop)"
git -C "$g2" fetch -q "$g" "$new" 2>/dev/null || cp -r "$g/objects/." "$g2/objects/"
expect_fail "a further change on top of a regenerate commit is refused (no loop)" commit "$g2" "$new" "$(payload "newer sdk" "new mcp")"
check "a regenerate commit that already matches reports no change" [ "$(commit "$g2" "$new" "$p" --check)" = "changed=false" ]

add_missing() { rm "$1/$mcp"; }
read -r g h <<<"$(new_repo add_missing)"
new="$(commit "$g" "$h" "$(payload "old sdk" "new mcp")")"
check "a generated file missing from the head is added" [ "$(git -C "$g" show "$new:$mcp")" = "new mcp" ]

link_dir() { rm -rf "$1/packages/sdk/src/generated"; ln -s ../../mcp/src/generated "$1/packages/sdk/src/generated"; }
read -r g h <<<"$(new_repo link_dir)"
expect_msg "a symlinked ancestor in the head tree is refused" "is not a directory" commit "$g" "$h" "$(payload "new sdk" "new mcp")"
link_file() { rm "$1/$sdk"; ln -s ../../../../spec/developer-v1.openapi.json "$1/$sdk"; }
read -r g h <<<"$(new_repo link_file)"
expect_fail "a symlink at a generated path in the head tree is refused" commit "$g" "$h" "$(payload "new sdk" "new mcp")"
dir_file() { rm "$1/$sdk"; mkdir "$1/$sdk"; echo x > "$1/$sdk/x"; }
read -r g h <<<"$(new_repo dir_file)"
expect_fail "a directory at a generated path in the head tree is refused" commit "$g" "$h" "$(payload "new sdk" "new mcp")"
file_parent() { rm -rf "$1/packages/mcp/src/generated"; echo x > "$1/packages/mcp/src/generated"; }
read -r g h <<<"$(new_repo file_parent)"
expect_msg "a file where a generated directory belongs is refused" "is not a directory" commit "$g" "$h" "$(payload "new sdk" "new mcp")"
# A crafted tree (git mktree would refuse it) with two entries named api.ts in the generated directory.
dup_repo() {
  local g="$1" h="$2" gen sdk_src sdk_dir pkgs root raw commit
  gen="$(git -C "$g" rev-parse "$h:packages/sdk/src/generated")"
  raw="$(mktemp -p "$work")"
  python3 -I - "$(git -C "$g" rev-parse "$h:$sdk")" "$raw" <<'PY'
import sys
blob, out = bytes.fromhex(sys.argv[1]), sys.argv[2]
open(out, "wb").write((b"100644 api.ts\0" + blob) * 2)
PY
  gen="$(git -C "$g" hash-object -t tree -w --literally "$raw")"
  sdk_src="$(printf '040000 tree %s\tgenerated\n' "$gen" | git -C "$g" mktree)"
  sdk_dir="$(printf '040000 tree %s\tsrc\n' "$sdk_src" | git -C "$g" mktree)"
  pkgs="$(git -C "$g" ls-tree "$h:packages" | grep -v $'\tsdk$'; printf '040000 tree %s\tsdk\n' "$sdk_dir")"
  pkgs="$(printf '%s\n' "$pkgs" | git -C "$g" mktree)"
  root="$( (git -C "$g" ls-tree "$h" | grep -v $'\tpackages$'; printf '040000 tree %s\tpackages\n' "$pkgs") | git -C "$g" mktree)"
  commit="$(git -C "$g" -c user.name=t -c user.email=t@t commit-tree "$root" -m dup)"
  echo "$commit"
}
read -r g h <<<"$(new_repo noop)"
d="$(dup_repo "$g" "$h")"
check "the duplicate-entry fixture has two api.ts entries" [ "$(git -C "$g" ls-tree "$d:packages/sdk/src/generated" | grep -c $'\tapi.ts$')" = 2 ]
expect_msg "a duplicate entry at a generated path is refused" "more than one entry" commit "$g" "$d" "$(payload "new sdk" "new mcp")"
expect_msg "a duplicate entry is refused in --check mode too" "more than one entry" commit "$g" "$d" "$(payload "new sdk" "new mcp")" --check

read -r g h <<<"$(new_repo noop)"
new="$(commit "$g" "$h" "$(payload "new sdk" "new mcp")")"
check "untouched entries keep their object ids" [ "$(git -C "$g" rev-parse "$new:spec")" = "$(git -C "$g" rev-parse "$h:spec")" ]
exec_mode() { chmod +x "$1/$sdk"; git -C "$1" update-index --chmod=+x "$sdk" 2>/dev/null || true; }
read -r g h <<<"$(new_repo exec_mode)"
new="$(commit "$g" "$h" "$(payload "new sdk" "new mcp")")"
check "an executable generated file keeps its mode" [ "$(git -C "$g" ls-tree --format='%(objectmode)' "$new" -- "$sdk")" = 100755 ]

read -r g h <<<"$(new_repo noop)"
expect_fail "a head that is not a full commit id is refused" commit "$g" "HEAD" "$(payload "new sdk" "new mcp")"
expect_fail "a path in .git is refused" env GENERATED_PATHS=".git/config" "$here/commit-generated.sh" "$g" "$h" "$(payload a b)"
p="$(payload "new sdk" "new mcp")"; rm "$p/$sdk"; ln -s "$secret/token" "$p/$sdk"
expect_fail "a symlink in the payload is refused" commit "$g" "$h" "$p"

echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
