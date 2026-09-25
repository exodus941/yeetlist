/* THE MARK, AS NUMBERS, IN ONE PLACE.
 *
 * Their instruction, 25 September 2026: give the app its own identity and
 * replace the play button with "an accurate recreation of the attached
 * image", taking "only the shape, not the colour".
 *
 * MEASURED OFF THEIR DRAWING, a 512px square, rather than traced by eye:
 *
 *   ring     centre 254.8, 254.8. Outer radius 213.7, inner 171.0, so 42.7
 *            thick. Cut straight across at 199.5 and 250.5 degrees, measured
 *            clockwise from the right, and the cut is the same angle at the
 *            inner, middle and outer edge, so each end is radial.
 *   dot      centre 116.8, 116.8, radius 32.0, from its own area. It sits
 *            195 from the centre, on the ring's middle line, at 225 degrees:
 *            exactly the middle of the gap.
 *   triangle 213,161  213,350  340,255 by the dark pixels. The edges were
 *            then moved out 0.3 to 0.6px, where the missing and extra pixels
 *            along them balance.
 *
 * Everything is moved 1.2 so the ring is centred on 256. The drawing sat
 * 1.2px up and left of its own canvas.
 *
 * The page's symbol in index.html, the launcher icons and the Android
 * adaptive icon all read these numbers. tools/brand-guard.mjs checks the
 * copies that cannot import this file.
 */

export const VIEW = 512;
export const CENTRE = 256;
export const RING = { outer: 213.7, inner: 171.0, from: 250.5, to: 199.5 + 360 };
export const DOT = { x: 118, y: 118, r: 32 };
export const TRIANGLE = [[213.5, 161.2], [213.5, 352.2], [342.3, 256.7]];

const at = (radius, deg) => [
  CENTRE + radius * Math.cos((deg * Math.PI) / 180),
  CENTRE + radius * Math.sin((deg * Math.PI) / 180),
].map((v) => +v.toFixed(2));

/* An annular sector: along the outer edge the long way round, straight in,
   and back along the inner edge. Both arcs are the large one. */
export function ringPath() {
  const { outer, inner, from, to } = RING;
  const a = at(outer, from), b = at(outer, to), c = at(inner, to), d = at(inner, from);
  return `M${a} A${outer} ${outer} 0 1 1 ${b} L${c} A${inner} ${inner} 0 1 0 ${d} Z`;
}

export const dotPath = () => {
  const { x, y, r } = DOT;
  return `M${x - r},${y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
};

export const trianglePath = () => `M${TRIANGLE.map((p) => p.join(',')).join(' L')} Z`;

/* The whole mark spans the ring's outer diameter. */
export const SPAN = 2 * RING.outer;

/* HOW MUCH OF ITS SQUARE THE MARK FILLS, ring edge to ring edge. One share
   for the header, the launcher icon and the store art, so all three read as
   one object at different sizes. */
export const MARK_ANY = 0.64;

const inTriangle = (px, py) => {
  let hit = false;
  for (let i = 0, j = TRIANGLE.length - 1; i < TRIANGLE.length; j = i++) {
    const [xi, yi] = TRIANGLE[i], [xj, yj] = TRIANGLE[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/* Is this point, in the 512 square, ink? */
export function inMark(px, py) {
  const dx = px - CENTRE, dy = py - CENTRE;
  const d = Math.hypot(dx, dy);
  if (d >= RING.inner && d <= RING.outer) {
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    while (deg < RING.from) deg += 360;
    if (deg <= RING.to) return true;
  }
  if (Math.hypot(px - DOT.x, py - DOT.y) <= DOT.r) return true;
  return inTriangle(px, py);
}
