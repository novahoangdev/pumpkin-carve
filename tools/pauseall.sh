#!/bin/bash
# pauseall.sh <lệnh...>: tạm dừng mọi app trên sim khác (trừ sim của agent chính), ffmpeg, Blender trong lúc chạy lệnh
MY=CA7F5A01-D288-47E0-9CED-0EFBED4178D1
PIDS=$(ps ax -o pid=,command= | awk -v me=$$ '$1!=me' | grep -E 'CoreSimulator/Devices/[^/]+/data/Containers/Bundle/Application/.*\.app/|(^|/| )ffmpeg |Blender' | grep -v "$MY" | grep -v grep | awk '{print $1}' | tr '\n' ' ')
echo "tạm dừng: $(echo $PIDS | wc -w) process"
[ -n "$PIDS" ] && kill -STOP $PIDS 2>/dev/null
trap '[ -n "$PIDS" ] && kill -CONT $PIDS 2>/dev/null; echo "tiếp tục process khác"' EXIT
"$@"
