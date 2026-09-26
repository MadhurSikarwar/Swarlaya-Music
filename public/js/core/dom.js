export const $ = id => document.getElementById(id);

/** Set a .vol-slider's gold fill (the --val CSS variable) to its current value. */
export function fillSlider(el) {
  const min = el.min === '' ? 0 : +el.min, max = el.max === '' ? 100 : +el.max;
  el.style.setProperty('--val', ((+el.value - min) / (max - min || 1) * 100).toFixed(1) + '%');
}

/** Keep a slider's fill in step with the user's changes (call fillSlider after setting .value in code). */
export function trackSliderFill(el) {
  el.addEventListener('input', () => fillSlider(el));
  fillSlider(el);
}
