// Plays one camera move with the scrollbar. Scrolling works from the first moment: a light
// film streams straight away, and if someone scrolls ahead of the download the picture eases
// along behind them. On larger screens the 1080p film downloads quietly in the background
// and takes over from the same spot once all of it has arrived.

const FULL_FILM = 'film.mp4'; // 1080p.
const SMOOTHING = 0.12; // Share of the remaining distance covered per frame.
const SEEK_STEP = 1 / 30; // Smallest change in seconds worth a new seek.
const BUFFER_MARGIN = 0.6; // Seconds kept back from the end of the downloaded part.
const STALL_MS = 1500; // How long the download may sit still before seeking past it.
const FADE = 0.012; // Share of the film each caption takes to fade in or out.
const TRAVEL = 40; // Pixels a caption drifts while it fades.

const film = document.getElementById('film');
const topbar = document.getElementById('topbar');
const liteVideo = document.getElementById('film-video');
const progressBar = document.getElementById('progress');
const hint = document.getElementById('hint');
const beats = [...document.querySelectorAll('.beat')].map((element) => ({
  element,
  start: Number(element.dataset.start),
  end: Number(element.dataset.end),
}));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const largeScreen = matchMedia('(min-width: 861px)').matches;

const state = {
  video: liteVideo,
  inMemory: false,
  duration: 0,
  target: 0,
  position: 0,
  raf: 0,
  bufferEnd: 0,
  bufferMoved: 0,
};

const once = (target, event) => new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));

function scrollProgress() {
  const bounds = film.getBoundingClientRect();
  const distance = bounds.height - window.innerHeight;
  return Math.min(1, Math.max(0, -bounds.top / distance));
}

function poseCaptions(progress) {
  beats.forEach(({ element, start, end }) => {
    const fadeIn = start <= 0 ? 1 : Math.min(1, Math.max(0, (progress - start) / FADE));
    const fadeOut = Math.min(1, Math.max(0, (end - progress) / FADE));
    const opacity = Math.min(fadeIn, fadeOut);
    element.style.opacity = opacity.toFixed(3);
    element.style.transform = `translateY(${((1 - fadeIn) * TRAVEL - (1 - fadeOut) * TRAVEL).toFixed(1)}px)`;
  });
  hint.style.opacity = Math.max(0, 1 - progress * 80).toFixed(3);
  progressBar.style.transform = `scaleX(${progress.toFixed(4)})`;
}

function bufferedEnd() {
  const { buffered } = liteVideo;
  let end = 0;
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= state.position + 0.5) end = Math.max(end, buffered.end(index));
  }
  return end;
}

// How far the film can go without showing a pause for data.
function readableEnd(now) {
  if (state.inMemory) return state.duration;

  const end = bufferedEnd();
  if (end >= state.duration - 0.1) return state.duration;
  if (end > state.bufferEnd) {
    state.bufferEnd = end;
    state.bufferMoved = now;
  }
  // Some browsers stop fetching a paused video; a seek past the end restarts them.
  if (now - state.bufferMoved > STALL_MS) return state.duration;
  return Math.max(state.position, end - BUFFER_MARGIN);
}

function tick(now) {
  const goal = Math.min(state.target, readableEnd(now));
  const distance = goal - state.position;
  state.position += reducedMotion ? distance : distance * SMOOTHING;
  if (Math.abs(distance) < 0.01) state.position = goal;

  const { video } = state;
  const gap = Math.abs(video.currentTime - state.position);
  if (!video.seeking && gap >= SEEK_STEP) video.currentTime = state.position;
  poseCaptions(state.position / state.duration);

  const done = state.position === state.target && !video.seeking && gap < SEEK_STEP;
  state.raf = done ? 0 : requestAnimationFrame(tick);
}

function handleScroll() {
  const progress = scrollProgress();
  topbar.classList.toggle('is-solid', film.getBoundingClientRect().bottom <= window.innerHeight);

  if (!state.duration) {
    poseCaptions(progress);
    return;
  }
  state.target = progress * state.duration;
  if (!state.raf) state.raf = requestAnimationFrame(tick);
}

function ready() {
  state.duration = liteVideo.duration;
  state.bufferMoved = performance.now();
  liteVideo.classList.add('is-ready');
  handleScroll();
}

// Phones may not fetch a video until it has been asked to play once.
function wakeVideo() {
  const playing = liteVideo.play();
  if (playing) playing.then(() => liteVideo.pause()).catch(() => {});
}

async function waitForLiteFilm() {
  while (!state.duration || bufferedEnd() < state.duration - 0.1) {
    await once(liteVideo, 'progress');
  }
}

// Brings in the 1080p film behind the light one, lines it up, then shows it.
async function upgradeFilm() {
  if (!largeScreen || navigator.connection?.saveData) return;
  await waitForLiteFilm();

  const response = await fetch(FULL_FILM);
  if (!response.ok) return;
  const blob = await response.blob();

  const fullVideo = liteVideo.cloneNode(false);
  fullVideo.removeAttribute('id');
  fullVideo.removeAttribute('src');
  fullVideo.classList.remove('is-ready');
  fullVideo.setAttribute('aria-hidden', 'true');
  fullVideo.src = URL.createObjectURL(blob);
  liteVideo.after(fullVideo);

  await once(fullVideo, 'loadeddata');
  fullVideo.currentTime = state.position;
  await once(fullVideo, 'seeked');

  fullVideo.classList.add('is-ready');
  state.video = fullVideo;
  state.inMemory = true;
  handleScroll();
}

window.addEventListener('scroll', handleScroll, { passive: true });
window.addEventListener('resize', handleScroll);
window.addEventListener('touchstart', wakeVideo, { once: true, passive: true });

if (liteVideo.readyState >= 2) ready();
else liteVideo.addEventListener('loadeddata', ready, { once: true });

wakeVideo();
handleScroll();
upgradeFilm().catch((error) => console.error(error));
