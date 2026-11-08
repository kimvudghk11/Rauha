#!/usr/bin/env bash
# Rauha 맥 설치 스크립트: 최신 릴리스의 dmg를 받아 응용 프로그램 폴더에 넣는다.
# curl로 받은 파일에는 "인터넷에서 받음" 표시(quarantine)가 붙지 않아서 첫 실행 경고가 뜨지 않는다.
set -uo pipefail

fail() { echo "설치하지 못했어요: $1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "맥에서만 쓸 수 있어요."

case "$(uname -m)" in
  arm64) suffix="mac-arm64" ;;
  x86_64) suffix="mac-x64" ;;
  *) fail "지원하지 않는 칩이에요: $(uname -m)" ;;
esac

# 저장소 이름의 대소문자는 GitHub 응답에 따라 달라질 수 있어서(rauha / Rauha) 대소문자를 가리지 않고 찾는다.
repo="kimvudghk11/Rauha"
pattern="https://github\\.com/[^\"' <>]+/releases/download/[^\"' <>]*-${suffix}\\.dmg"

echo "최신 버전을 찾는 중…"
found="$(curl -fsSL "https://api.github.com/repos/${repo}/releases?per_page=10" 2>/dev/null | grep -oiE "$pattern" || true)"
url="$(printf '%s\n' "$found" | sed -n '1p')"
[ -n "$url" ] || fail "내 맥용 설치 파일을 찾지 못했어요(GitHub 요청 한도일 수 있어요. 잠시 뒤 다시 하거나 https://github.com/${repo}/releases 에서 직접 받아 주세요)."

work="$(mktemp -d)" || fail "임시 폴더를 만들지 못했어요."
mnt="$work/mnt"
cleanup() { hdiutil detach "$mnt" -quiet 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT

echo "내려받는 중: $url"
curl -fL --progress-bar -o "$work/rauha.dmg" "$url" || fail "내려받지 못했어요. 네트워크를 확인해 주세요."
size="$(stat -f%z "$work/rauha.dmg" 2>/dev/null || echo 0)"
[ "$size" -gt 20000000 ] || fail "받은 파일이 너무 작아요(${size} bytes). 잠시 뒤 다시 시도해 주세요."

mkdir -p "$mnt"
hdiutil attach "$work/rauha.dmg" -nobrowse -readonly -quiet -mountpoint "$mnt" || fail "dmg를 열지 못했어요."
app="$(find "$mnt" -maxdepth 1 -name '*.app' | sed -n '1p')"
[ -n "$app" ] || fail "dmg 안에서 앱을 찾지 못했어요."

# 설치할 곳: /Applications에 쓸 수 있으면 거기, 아니면 ~/Applications
if [ -w "/Applications" ]; then
  dest="/Applications"
else
  dest="$HOME/Applications"
  mkdir -p "$dest" || fail "$dest 폴더를 만들지 못했어요."
fi

# 켜져 있으면 끄고(대소문자 이름 모두) 끝날 때까지 잠깐 기다린다.
pkill -xi rauha 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xi rauha >/dev/null 2>&1 || break; sleep 0.5; done

rm -rf "$dest/rauha.app" "$dest/Rauha.app"
cp -R "$app" "$dest/Rauha.app" || fail "$dest 에 복사하지 못했어요(권한을 확인해 주세요)."
xattr -dr com.apple.quarantine "$dest/Rauha.app" 2>/dev/null

version="$(defaults read "$dest/Rauha.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?')"
echo "설치했어요: $dest/Rauha.app (v${version})"
open "$dest/Rauha.app" || echo "앱을 직접 열어 주세요: $dest/Rauha.app"
