"""Build a small online-source audition gallery. No audio is downloaded."""
from pathlib import Path
import html
import json

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art-review/audio/v01'
tracks=[
    dict(id='WEB-001',title='Oriental',author='Shadowfire452',direction='东方短主题',
         description='页面标注 peaceful、exploration、town。适合先比较短小、带东方色彩的主题方向。',
         source='https://opengameart.org/content/oriental',
         audio='https://opengameart.org/sites/default/files/Oriental.wav',format='WAV',size='约 4 MB',
         loop='原页未明确标注无缝循环，需另做衔接检查。',
         attribution='CC0，无强制署名；交付清单保留作者与来源。',
         production='页面未说明具体制作方式。'),
    dict(id='WEB-002',title='Asianoriental2',author='Tozan',direction='筝弦与弦乐',
         description='作者称尝试中国风，标签包含 Koto、strings。可比较器乐感，但 Koto 属日式筝方向，不能直接视作明代音乐。',
         source='https://opengameart.org/content/asianoriental2',
         audio='https://opengameart.org/sites/default/files/asianoriental2_0.ogg',format='OGG',size='约 3.6 MB',
         loop='原页未明确标注无缝循环，需另做衔接检查。',
         attribution='作者写明 cc0 atrib if you wish；署名自愿，清单保留来源。',
         production='作者描述为自制音乐，未披露工具及采样来源细节。'),
    dict(id='WEB-003',title='Sunset Plains',author='Yoiyami',direction='开阔、柔和的探索',
         description='作者描述为轻柔吉他、持续音与舒缓旋律。用来对比不强调古风、偏开阔风景的背景音乐。',
         source='https://opengameart.org/content/sunset-plains',
         audio='https://opengameart.org/sites/default/files/sunset_plains.wav',format='WAV',size='约 63.3 MB',
         loop='完整音乐候选；未明确标注无缝循环。原文件较大，点击后才加载。',
         attribution='作者明确写明 CC0、无需署名；清单保留作者与来源。',
         production='页面未说明具体制作工具或是否使用生成工具。'),
    dict(id='WEB-004',title='Forest Ambience',author='TinyWorlds',direction='低存在感氛围',
         description='为游戏 The Woods 制作的森林氛围音乐。用来比较弱化主题旋律的方向；不是遗址实地录音。',
         source='https://opengameart.org/content/forest-ambience',
         audio='https://opengameart.org/sites/default/files/Forest_Ambience.mp3',format='MP3',size='约 717 KB',
         loop='作者标注可无缝循环；浏览器及微信解码后的接缝仍需验听。',
         attribution='CC0，无强制署名；交付清单保留作者与来源。',
         production='作者称为 Ludum Dare 29 作品 The Woods 制作，未披露具体工具。'),
]
for track in tracks:
    track.update(license='CC0 1.0',license_url='https://creativecommons.org/publicdomain/zero/1.0/',
                 checked_on='2026-09-04',status='来源页已核对，方向试听待审；未接入游戏',
                 downloaded=False,processing='无裁切、无响度调整、无格式转换；直接播放原站公开音频',
                 sha256=None)
(OUT/'online-sources.json').write_text(json.dumps(tracks,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
escape=html.escape
cards=[]
for i,track in enumerate(tracks,1):
    cards.append(f'''<article class="candidate" data-id="{track['id']}">
<div class="eyebrow">0{i} / {escape(track['direction'])}</div>
<h2>{escape(track['title'])}</h2><div class="author">{escape(track['author'])} <span class="license">CC0</span></div>
<p class="description">{escape(track['description'])}</p>
<audio controls preload="none" src="{escape(track['audio'])}" aria-label="{escape(track['title'])} 试听"></audio>
<div class="audio-tools"><label><input class="loop-check" type="checkbox">重复播放</label><span>{escape(track['format'])} · {escape(track['size'])}</span></div>
<p class="play-status" role="status">点击播放器试听 · 从原站加载</p>
<p class="loop-note">{escape(track['loop'])}</p>
<div class="source-links"><a href="{escape(track['source'])}" target="_blank" rel="noopener noreferrer">来源与作者 ↗</a><a href="{track['license_url']}" target="_blank" rel="noopener noreferrer">CC0 条款 ↗</a></div>
<label class="choice-label" for="decision-{track['id']}">这一首的方向</label><select id="decision-{track['id']}" aria-label="{escape(track['title'])} 审查结论"><option value="pending">尚未决定</option><option value="like">方向合适</option><option value="maybe">部分可取</option><option value="reject">不适合</option></select>
<textarea rows="2" maxlength="3000" aria-label="{escape(track['title'])} 修改意见" placeholder="喜欢哪里？希望保留或调整什么？"></textarea>
<span class="save-status">意见保存在本机</span>
</article>''')
template=(ROOT/'tools/audio/review-template.html').read_text(encoding='utf-8')
css=template.split('<style>',1)[1].split('</style>',1)[0]
page='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>网络声音候选 · 明中都</title><style>'''+css+'''
.candidate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.candidate{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:26px}.candidate h2{font:26px/1.35 Georgia,"Microsoft YaHei",serif;letter-spacing:.4px;margin:10px 0 6px}.author{color:var(--muted);font-size:12px}.license{font-size:10px;margin-left:9px;border:1px solid #c4d2bb;border-radius:20px;padding:2px 8px;color:#658354}.description{font-size:13px;min-height:66px;margin:16px 0;color:#69776a}audio{width:100%;height:40px}.audio-tools{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--muted);margin-top:9px}.audio-tools input{accent-color:var(--ink)}.play-status{font-size:11px;color:#758a6c;min-height:19px;margin:9px 0}.loop-note{font-size:11px;min-height:39px;color:var(--muted);margin:0 0 10px}.source-links{display:flex;gap:20px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:16px;font-size:12px}.source-links a{text-decoration:none}.source-links a:hover{text-decoration:underline}.choice-label{font-size:12px;margin-right:12px}select{font:inherit;font-size:12px;color:var(--ink);border:1px solid var(--line);border-radius:5px;background:#f6f7f1;padding:6px 10px}textarea{margin-top:11px;min-height:69px;font-size:12px}.save-status{font-size:10px;color:var(--muted);display:block;margin-top:6px}.review-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:22px}.review-actions p{font-size:12px;color:var(--muted)}.intro{max-width:770px}.note{font-size:11px;color:var(--muted);line-height:1.9;max-width:960px;margin-top:22px}h1{font-size:39px}.top-link{font-size:12px;white-space:nowrap}.error{color:#a34335}@media(max-width:700px){.candidate-grid{grid-template-columns:1fr}.candidate{padding:21px}.description{min-height:0}.review-actions{display:block}h1{font-size:31px;letter-spacing:3px}.nav{flex-wrap:wrap}}
</style></head><body><header><div class="nav"><div class="brand"><span class="seal">中</span>明中都 · 声音审查</div><a class="top-link" href="single-track.html">回听原合成样音 ↗</a></div></header><main>
<section class="hero"><div><div class="eyebrow">ONLINE SOUND SELECTION / 01 — 04</div><h1>从不同方向，听一听</h1><p class="intro">四个网络素材候选：东方主题、筝弦配器、开阔风景、森林氛围。先比较声音方向，再处理循环与游戏接入。</p></div><span class="version">来源页已核对 · 待试听</span></section>
<div class="candidate-grid">'''+''.join(cards)+'''</div>
<div class="review-actions"><p id="export-status" role="status">切换播放会暂停上一首；意见只保存在本机，导出后手动交回。</p><button class="primary" id="export" type="button">导出四首审查意见 ↓</button></div>
<p class="note">四个来源页均标注 CC0，核对日期为 2026-09-04。上方风格说明依据作者描述与标签，尚未代你作听感审批。此页需要联网，直接播放原站文件；未下载、剪辑或统一响度。“重复播放”仅重复原曲，不代表已完成无缝循环处理。详细作者、授权及处理记录保存在 online-sources.json。</p>
<footer><span>明中都遗址探索 / 网络声音候选</span><span>仅供方向审查 · 尚未接入游戏</span></footer></main>
<script type="application/json" id="source-data">'''+json.dumps(tracks,ensure_ascii=False)+'''</script><script>
'use strict';
const tracks=JSON.parse(document.getElementById('source-data').textContent);
const cards=[...document.querySelectorAll('.candidate')];
const session=new Map();
function read(card){return{id:card.dataset.id,decision:card.querySelector('select').value,notes:card.querySelector('textarea').value,updatedAt:new Date().toISOString()};}
function save(card){const value=read(card);session.set(value.id,value);try{localStorage.setItem('mzd-online-'+value.id,JSON.stringify(value));card.querySelector('.save-status').textContent='已保存在本机';}catch{card.querySelector('.save-status').textContent='本机存储不可用，请导出意见保留';}}
cards.forEach(card=>{
 const audio=card.querySelector('audio'),status=card.querySelector('.play-status');
 audio.volume=.6;
 audio.addEventListener('play',()=>{cards.forEach(other=>{if(other!==card)other.querySelector('audio').pause();});status.textContent='正在试听';status.classList.remove('error');});
 audio.addEventListener('waiting',()=>{status.textContent='正在从原站加载音频…';});
 audio.addEventListener('playing',()=>{status.textContent='正在试听 · 原站音频';status.classList.remove('error');});
 audio.addEventListener('pause',()=>{status.textContent='已暂停';});
 audio.addEventListener('ended',()=>{status.textContent='试听结束';});
 audio.addEventListener('error',()=>{status.textContent='原站音频暂不可播放，请使用下方来源页试听。';status.classList.add('error');});
 card.querySelector('.loop-check').addEventListener('change',event=>{audio.loop=event.target.checked;});
 try{const old=JSON.parse(localStorage.getItem('mzd-online-'+card.dataset.id)||'null');if(old){if(['pending','like','maybe','reject'].includes(old.decision))card.querySelector('select').value=old.decision;card.querySelector('textarea').value=typeof old.notes==='string'?old.notes:'';session.set(card.dataset.id,old);}}catch{}
 card.querySelector('select').addEventListener('change',()=>save(card));card.querySelector('textarea').addEventListener('input',()=>save(card));
});
document.getElementById('export').addEventListener('click',()=>{const reviews=cards.map(card=>({...read(card),source:tracks.find(track=>track.id===card.dataset.id).source}));const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),reviews},null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='mingzhongdu-online-audio-review.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);document.getElementById('export-status').textContent='已发起导出，请将 JSON 手动交回。';});
</script></body></html>'''
archive=OUT/'single-track.html'
if not archive.exists():
    archive.write_bytes((OUT/'index.html').read_bytes())
(OUT/'index.html').write_text(page,encoding='utf-8')
(OUT/'ONLINE-REVIEW.md').write_text('''# 网络音频候选

index.html 现为四个网络来源的试听审查页，需要联网。原单曲离线审查页保留为 single-track.html。
此轮没有下载或制作新增音频，播放器按点击从公开原站地址加载。
未切片、改响度或处理循环，未接入 Cocos 游戏。标题、作者、来源、授权、处理状态见 online-sources.json。
未下载的文件没有本地 SHA-256；正式入库时补充原始文件哈希与许可证快照。
原先的 REVIEW.md、manifest.json 和 qa.json 仅对应首版本地合成 WAV，不代表本轮网络候选的检查结果。

复现：python tools/audio/create-online-review.py。没有 Python 第三方依赖。
''',encoding='utf-8')
print('Built online gallery:',OUT/'index.html')
