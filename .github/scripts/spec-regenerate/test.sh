#!/usr/bin/env bash
# Exercises extract-generated.sh and apply-generated.sh against hostile fixtures.
# Run: .github/scripts/spec-regenerate/test.sh   (needs bash, python3, unzip and zipinfo)
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

echo "apply: destination symlinks, .git and drivers in the pull request checkout"
new_clone() {
  local d; d="$(mktemp -d -p "$work")"
  mkdir -p "$d/.git" "$d/packages/sdk/src/generated" "$d/packages/mcp/src/generated"
  echo old > "$d/$sdk"; echo "$d"
}
p="$(out)"; extract "$(z "$sdk=new sdk" "$mcp=new mcp")" "$p" >/dev/null
c="$(new_clone)"
expect_pass "a clean checkout gets the generated files" "$here/apply-generated.sh" "$p" "$c"
check "the SDK types were copied" [ "$(cat "$c/$sdk")" = "new sdk" ]
check "the catalogue limits were copied" [ "$(cat "$c/$mcp")" = "new mcp" ]

c="$(new_clone)"; rm -rf "$c/packages/sdk/src/generated"; ln -s "$secret" "$c/packages/sdk/src/generated"
expect_fail "a symlinked generated directory is refused" "$here/apply-generated.sh" "$p" "$c"
check "nothing was written through it" [ ! -e "$secret/api.ts" ]
c="$(new_clone)"; rm -rf "$c/packages/mcp"; ln -s "$secret" "$c/packages/mcp"
expect_fail "a symlinked ancestor is refused" "$here/apply-generated.sh" "$p" "$c"
c="$(new_clone)"; rm "$c/$sdk"; ln -s "$secret/token" "$c/$sdk"
expect_fail "a symlinked destination file is refused" "$here/apply-generated.sh" "$p" "$c"
check "the link target is untouched" [ "$(cat "$secret/token")" = SECRET ]
c="$(new_clone)"; rm "$c/$sdk"; mkdir "$c/$sdk"
expect_fail "a directory at a destination is refused" "$here/apply-generated.sh" "$p" "$c"
c="$(new_clone)"
expect_fail "a destination inside .git is refused" env GENERATED_PATHS=".git/config" "$here/apply-generated.sh" "$p" "$c"
expect_fail "path traversal is refused" env GENERATED_PATHS="packages/../../x" "$here/apply-generated.sh" "$p" "$c"
c="$(new_clone)"; echo '* filter=evil' > "$c/.gitattributes"
expect_fail "a .gitattributes filter driver is refused" "$here/apply-generated.sh" "$p" "$c"
c="$(new_clone)"; mkdir -p "$c/$evil"; echo '*.ts diff=evil' > "$c/$evil/.gitattributes"
expect_quiet "a driver under an untrusted directory name is refused without printing the name" "::error::injected" "$here/apply-generated.sh" "$p" "$c"
c="$(new_clone)"; echo '*.png binary' > "$c/.gitattributes"
expect_pass "a harmless .gitattributes is accepted" "$here/apply-generated.sh" "$p" "$c"

echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ]
