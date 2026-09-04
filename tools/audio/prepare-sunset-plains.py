"""Create the approved in-game loop from the original CC0 WAV. No network calls."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import wave
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tmp/audio-deps'))
import imageio_ffmpeg
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
source=ROOT/'art-review/audio/sunset-plains-source/sunset_plains.wav'
out=ROOT/'assets/resources/audio/sunset-plains-loop.mp3'
out.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(source),'rb') as wav:
    rate=wav.getframerate()
    assert wav.getsampwidth()==2 and wav.getnchannels()==2
    data=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').reshape(-1,2).astype(np.float32).mean(axis=1)/32768
# Wrap the tail into the opening with a two-second linear overlap. Rotate the
# file so the encoded boundary is in contiguous audio, not across the crossfade.
overlap=round(rate*2)
blend=np.linspace(0,1,overlap,endpoint=False,dtype=np.float32)
loop=np.concatenate([data[overlap:-overlap],data[-overlap:]*(1-blend)+data[:overlap]*blend])
temp=ROOT/'tmp/sunset-loop.wav'
with wave.open(str(temp),'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate)
    wav.writeframes(np.rint(loop*32767).astype('<i2').tobytes())

def measure(path):
    result=subprocess.run([ffmpeg,'-hide_banner','-i',str(path),'-af','loudnorm=I=-22:TP=-2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    return json.loads(re.findall(r'\{\s*"input_i".*?\}',result.stderr,re.S)[-1])

first=measure(temp)
filter_string=('loudnorm=I=-22:TP=-2:LRA=11:linear=true:measured_I='+first['input_i']+
               ':measured_TP='+first['input_tp']+':measured_LRA='+first['input_lra']+
               ':measured_thresh='+first['input_thresh']+':offset='+first['target_offset'])
subprocess.run([ffmpeg,'-y','-hide_banner','-loglevel','error','-i',str(temp),'-af',filter_string,
                '-ar','32000','-ac','1','-c:a','libmp3lame','-b:a','96k',
                '-metadata','title=Sunset Plains (Ming Zhong Du loop)',
                '-metadata','artist=Yoiyami','-metadata','copyright=CC0 1.0',str(out)],check=True)
measured=measure(out)
assert float(measured['input_tp']) <= -1.0
assert abs(float(measured['input_i'])+22)<1.5
record={
    'title':'Sunset Plains','author':'Yoiyami',
    'source_url':'https://opengameart.org/content/sunset-plains',
    'download_url':'https://opengameart.org/sites/default/files/sunset_plains.wav',
    'license':'CC0 1.0','license_url':'https://creativecommons.org/publicdomain/zero/1.0/',
    'attribution':'No attribution required by source; author/source preserved in project credits.',
    'selected_by_user':'第三个，接入游戏','checked_on':'2026-09-04',
    'generation':'Existing third-party track; production tools not disclosed by author; no AI regeneration performed.',
    'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
    'runtime_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
    'source_seconds':len(data)/rate,'loop_seconds_before_encoding':len(loop)/rate,
    'source_bytes':source.stat().st_size,'runtime_bytes':out.stat().st_size,
    'processing':['Stereo to mono','2-second tail/head linear crossfade; rotate by two seconds',
                  'Two-pass loudness normalization: -22 LUFS target, -2 dBTP ceiling',
                  'MP3 96 kbps, mono, 32 kHz; full song retained except overlap'],
    'tool':subprocess.run([ffmpeg,'-version'],capture_output=True,text=True,check=True).stdout.splitlines()[0],
    'decoded_mp3_loudness':measured,
    'loop_note':'Crossfade prepared; compressed-loop playback still needs WeChat device listening check.',
}
(ROOT/'docs/sunset-plains-audio.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(record,ensure_ascii=False,indent=2))
