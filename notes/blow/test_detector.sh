#!/bin/bash
# Offline check of the blow detector (fx/blowOut.ts `analyse`) on synthetic clips, no device needed.
#   notes/blow/test_detector.sh            → per clip: max gust / force, time over BLOW_FORCE, "OUT" if it would blow the candle out
# Clips (16 kHz mono float, room noise underneath): blow into mic (brown noise, loud), soft breath, normal speech (say),
# loud speech close to the mic, "shhh" (high-band hiss), short puffs of speech-like bursts.
set -e
cd "$(dirname "$0")/../.."
T=${TMPDIR:-/tmp}/blowtest; rm -rf $T; mkdir -p $T/js
SR=16000
gen() { local out=$1; shift; ffmpeg -y -loglevel error "$@" -ac 1 -ar $SR -f f32le "$out"; }
gen $T/blow.raw -f lavfi -i "anoisesrc=color=brown:amplitude=1:d=1.4:seed=3" -af "volume=-6dB,afade=t=in:d=0.08,afade=t=out:st=1.2:d=0.2"
gen $T/short.raw -f lavfi -i "anoisesrc=color=brown:amplitude=1:d=0.6:seed=9" -af "volume=-8dB,afade=t=in:d=0.06,afade=t=out:st=0.5:d=0.1"
gen $T/soft.raw -f lavfi -i "anoisesrc=color=brown:amplitude=1:d=1.4:seed=4" -af "volume=-30dB,afade=t=in:d=0.1"
gen $T/medium.raw -f lavfi -i "anoisesrc=color=brown:amplitude=1:d=1.4:seed=5" -af "volume=-18dB,afade=t=in:d=0.1"
say -o $T/talk.aiff "Hello there, this pumpkin looks really spooky tonight, doesn't it? Let's carve another one, maybe with a cat face."
gen $T/talk.raw -i $T/talk.aiff -af "loudnorm=I=-28:TP=-6"
gen $T/talk_loud.raw -i $T/talk.aiff -af "loudnorm=I=-12:TP=-1"
gen $T/shh.raw -f lavfi -i "anoisesrc=color=white:amplitude=1:d=1.4:seed=6" -af "highpass=f=2500,volume=-14dB"
gen $T/room.raw -f lavfi -i "anoisesrc=color=pink:amplitude=1:d=4:seed=7" -af "volume=-58dB"
npx --prefix app tsc --ignoreConfig --outDir $T/js --module commonjs --target es2020 --skipLibCheck --esModuleInterop app/src/fx/blowOut.ts >/dev/null || true
cat > $T/run.js <<'JS'
const Module = require("module"); const fs = require("fs");
const load = Module._load;
Module._load = function (req, ...a) {
  if (req === "react") return { useCallback: (f) => f, useEffect() {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}] };
  if (req === "react-native-reanimated") return { Easing: {}, useAnimatedReaction() {}, useDerivedValue() {}, useFrameCallback() {}, useSharedValue: (v) => ({ value: v }), withDelay() {}, withSequence() {}, withTiming() {} };
  if (req === "react-native-worklets") return { scheduleOnRN() {} };
  if (req === "./haptics") return { fireHaptic() {} };
  if (req === "expo-audio") throw new Error("not installed");
  return load.call(this, req, ...a);
};
const B = require(process.argv[2] + "/blowOut.js");
const room = new Float32Array(fs.readFileSync(process.argv[2] + "/../room.raw").buffer.slice(0));
for (const name of ["blow", "short", "medium", "soft", "talk", "talk_loud", "shh"]) {
  const sig = new Float32Array(fs.readFileSync(process.argv[2] + `/../${name}.raw`).buffer.slice(0));
  // 1.5 s of room noise first (noise floor settles), then the clip mixed over room noise, in 100 ms buffers like the native tap
  const n = 24000 + sig.length, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = room[i % room.length] + (i >= 24000 ? sig[i - 24000] : 0);
  const m = B.newMeter(); let gmax = 0, fmax = 0, hold = 0, holdMax = 0;
  for (let o = 0; o < n; o += 1600) {
    const c = x.slice(o, o + 1600);
    B.analyse(m, { data: c.buffer, sampleRate: 16000, channels: 1 }, (g, f) => {
      gmax = Math.max(gmax, g); fmax = Math.max(fmax, f);
      hold = f > B.BLOW_FORCE ? hold + 0.032 : Math.max(0, hold - 0.032); holdMax = Math.max(holdMax, hold);
    });
  }
  console.log(`${name.padEnd(10)} gust max ${gmax.toFixed(2)}  force max ${fmax.toFixed(2)}  held ${holdMax.toFixed(2)} s  ${holdMax >= B.BLOW_HOLD ? "OUT" : "-"}`);
}
JS
node $T/run.js $T/js
