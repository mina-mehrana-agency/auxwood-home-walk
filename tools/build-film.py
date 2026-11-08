"""Joins the source clips into the scroll films and fills in the page.

Needs ffmpeg. Run from the repo root:  python tools/build-film.py
"""
import base64
import json
import subprocess

CLIPS = ['a', 'b', 'c', 'd', 'e', 'f']
FADE = 0.4  # Seconds of crossfade where one clip meets the next, hiding the small jump between them.
LABELS = ['کابینت تمام‌قد', 'کافی‌بار', 'بوفه', 'آشپزخانه', 'اتاق خواب', 'کمد دیواری']


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=duration,r_frame_rate',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    s = json.loads(out)['streams'][0]
    return float(s['duration']), s['r_frame_rate']


def main():
    paths = [f'source/clips/clip-{c}.mp4' for c in CLIPS]
    durations = [probe(p)[0] for p in paths]
    chain, label, offset = [], '[0:v]', 0.0
    for i in range(1, len(paths)):
        offset += durations[i - 1] - FADE
        out = f'[x{i}]'
        chain.append(f'{label}[{i}:v]xfade=transition=fade:duration={FADE}:offset={offset:.3f}{out}')
        label = out
    total = offset + durations[-1]
    args = [x for p in paths for x in ('-i', p)]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args, '-filter_complex', ';'.join(chain), '-map', label, '-r', '24',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-an', 'source/joined.mp4'], check=True)

    # No B-frames and a single reference frame: every scroll movement is a seek, and with x264's defaults seeks take so long the film stops.
    common = ['-c:v', 'libx264', '-preset', 'slow', '-bf', '0', '-refs', '1', '-pix_fmt', 'yuv420p', '-an', '-sc_threshold', '0', '-movflags', '+faststart']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'source/joined.mp4', '-vf', 'scale=1280:720:flags=lanczos', '-crf', '29',
                    '-g', '6', '-keyint_min', '6', *common, 'film-lite.mp4'], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'source/joined.mp4', '-vf', 'unsharp=5:5:0.4', '-crf', '25',
                    '-g', '12', '-keyint_min', '12', *common, 'film.mp4'], check=True)

    # First picture, inlined so it paints with the page.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'source/joined.mp4', '-vf', 'scale=1280:720:flags=lanczos', '-frames:v', '1',
                    '-c:v', 'libwebp', '-quality', '52', '-update', '1', 'source/poster.webp'], check=True)
    poster = 'data:image/webp;base64,' + base64.b64encode(open('source/poster.webp', 'rb').read()).decode()

    # Each label shows as the camera reaches that space.
    beats, t = [], 0.0
    for i, text in enumerate(LABELS):
        t += durations[i] - (FADE if i else 0)
        centre = min(t, total - 0.8) / total
        start, end = max(0.0, centre - 0.045), min(1.2, centre + 0.03) if i < len(LABELS) - 1 else 1.2
        beats.append(f'          <div class="beat" data-start="{start:.3f}" data-end="{end:.3f}"><h2>{text}</h2></div>')
    html = open('index.template.html', encoding='utf8').read().replace('__POSTER__', poster).replace('__BEATS__', '\n'.join(beats))
    open('index.html', 'w', encoding='utf8', newline='\n').write(html)
    print('film seconds', round(total, 1), 'poster bytes', len(poster))


if __name__ == '__main__':
    main()
