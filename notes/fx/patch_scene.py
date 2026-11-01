# Áp đề xuất của agent FX lên bản sao PumpkinScene.tsx (để thử trên sim FX). Giống diff trong notes/fx.md.
import sys
p = sys.argv[1]
s = open(p).read()
old = '                <Particles bursts={bursts} time={time} litAt={litAt} />\n'
already = "<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} />" in s
if not already:
    assert old in s, "Particles line"
    s = s.replace(old, '')
anchor = '''                  <Path path={trail} style="stroke" strokeWidth={0.6} strokeCap="round" strokeJoin="round" color="#fff4dc" opacity={0.55} />
                </Group>
              </Group>
'''
if not already:
    assert anchor in s, "anchor"
    s = s.replace(anchor, anchor + '              <Particles bursts={bursts} time={time} litAt={litAt} basis={basis} />\n')
s = s.replace('<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} />', '<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} impacts={jump.impacts} />')
s = s.replace('<ImpactDust impacts={jump.impacts} time={time} />', '<ImpactDust impacts={jump.impacts} time={time} basis={basis} />')
s = s.replace('<Match x={mx} y={my} burn={burn} fade={matchFade} time={time} />', '<Match x={mx} y={my} burn={burn} fade={matchFade} time={time} basis={basis} />')
# Gust (cơn gió intro) — đề xuất gắn, xem notes/fx.md
if "<Gust " not in s:
    s = s.replace('import { Bats } from "../fx/Bats";', 'import { Bats } from "../fx/Bats";\nimport { Gust } from "../fx/Gust";', 1)
    s = s.replace('<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} impacts={jump.impacts} />', '<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} impacts={jump.impacts} />\n              <Gust layer="scene" time={time} basis={basis} />', 1)
    s = s.replace('<Bats t0={batsAt} time={time} basis={basis} />', '<Gust layer="fg" time={time} basis={basis} />\n              <Bats t0={batsAt} time={time} basis={basis} />', 1)
open(p, 'w').write(s)
print("patched")
# chỉ để soi trên sim FX: slow.txt = "<mốc giây> <hệ số>" → đồng hồ cảnh chạy chậm sau mốc đó
import os
sf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slow.txt")
old_t = "    const t = Math.max(0, (timestamp - t0.value) / 1000);\n"
if os.path.exists(sf) and old_t in s:
    a, k = open(sf).read().split()
    s = s.replace(old_t, f"    const tr = Math.max(0, (timestamp - t0.value) / 1000);\n    const t = tr < {a} ? tr : {a} + (tr - {a}) * {k};\n")
    open(p, 'w').write(s)
    print("slow", a, k)
# chỉ để đo trên sim FX: perf.txt có mặt → gắn PerfHud (log [perf] trong Metro); "off" → tắt toàn bộ FX để so
pf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "perf.txt")
if os.path.exists(pf):
    mode = open(pf).read().strip()
    s = s.replace('import { Bats } from "../fx/Bats";', 'import { Bats } from "../fx/Bats";\nimport { PerfHud } from "../perf/PerfHud";')
    s = s.replace('<Bats t0={batsAt} time={time} basis={basis} />', ('' if mode == 'off' else '<Bats t0={batsAt} time={time} basis={basis} />') + '<PerfHud time={time} />', 1)
    if mode == 'off':
        s = s.replace('<Particles bursts={bursts} time={time} litAt={litAt} basis={basis} impacts={jump.impacts} />', '')
        s = s.replace('<ImpactDust impacts={jump.impacts} time={time} basis={basis} />', '')
    open(p, 'w').write(s)
    print("perf", mode)
