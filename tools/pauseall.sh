#!/bin/bash
# pauseall.sh <command...>: pause every app on other sims (except the main agent's sim), ffmpeg and Blender while the command runs
MY=CA7F5A01-D288-47E0-9CED-0EFBED4178D1
PIDS=$(ps ax -o pid=,command= | awk -v me=$$ '$1!=me' | grep -E 'CoreSimulator/Devices/[^/]+/data/Containers/Bundle/Application/.*\.app/|(^|/| )ffmpeg |Blender' | grep -v "$MY" | grep -v grep | awk '{print $1}' | tr '\n' ' ')
echo "paused: $(echo $PIDS | wc -w) processes"
[ -n "$PIDS" ] && kill -STOP $PIDS 2>/dev/null
trap '[ -n "$PIDS" ] && kill -CONT $PIDS 2>/dev/null; echo "resumed other processes"' EXIT
"$@"
