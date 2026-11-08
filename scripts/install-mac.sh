#!/usr/bin/env bash
# rauha 맥 설치 스크립트: 최신 릴리스의 dmg를 받아 /Applications 에 넣는다.
# curl로 받은 파일에는 "인터넷에서 받음" 표시(quarantine)가 붙지 않아서 첫 실행 경고가 뜨지 않는다.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then echo "맥에서만 쓸 수 있어요." >&2; exit 1; fi

case "$(uname -m)" in
  arm64) suffix="mac-arm64" ;;
  x86_64) suffix="mac-x64" ;;
  *) echo "지원하지 않는 칩: $(uname -m)" >&2; exit 1 ;;
esac

repo="kimvudghk11/rauha"
echo "최신 버전을 찾는 중…"
url="$(curl -fsSL "https://api.github.com/repos/${repo}/releases?per_page=10" \
  | grep -o "https://github.com/${repo}/releases/download/[^\"]*-${suffix}\.dmg" | head -n 1)"
if [ -z "$url" ]; then echo "내 맥용 설치 파일을 찾지 못했어요: https://github.com/${repo}/releases" >&2; exit 1; fi

work="$(mktemp -d)"
mnt="$work/mnt"
cleanup() { hdiutil detach "$mnt" -quiet 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

echo "내려받는 중: $url"
curl -fL --progress-bar -o "$work/rauha.dmg" "$url"

mkdir -p "$mnt"
hdiutil attach "$work/rauha.dmg" -nobrowse -readonly -quiet -mountpoint "$mnt"
app="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n 1)"
if [ -z "$app" ]; then echo "dmg 안에서 앱을 찾지 못했어요." >&2; exit 1; fi

pkill -xi rauha 2>/dev/null || true
rm -rf "/Applications/rauha.app" "/Applications/Rauha.app"
cp -R "$app" "/Applications/Rauha.app"
xattr -dr com.apple.quarantine "/Applications/Rauha.app" 2>/dev/null || true

echo "설치했어요: /Applications/Rauha.app"
open "/Applications/Rauha.app"
