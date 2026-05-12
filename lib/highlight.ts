// Straightens nearly-straight strokes for highlight tool.
// Input: flat points [x0,y0,x1,y1,...]
// If the stroke is close to a straight line (low residual + small angle vs nearest axis),
// snap to a clean horizontal or diagonal line.

export function straightenHighlight(pts: number[], thresholdDeg = 8): number[] {
  if (pts.length < 8) return pts;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    xs.push(pts[i]);
    ys.push(pts[i + 1]);
  }
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1) return pts;
  const slope = sxy / sxx;
  const angle = (Math.atan(slope) * 180) / Math.PI;
  // residual std
  const intercept = meanY - slope * meanX;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const py = slope * xs[i] + intercept;
    ss += (ys[i] - py) ** 2;
  }
  const rms = Math.sqrt(ss / n);
  // If too curved, return as-is
  if (rms > 6) return pts;

  const x0 = xs[0];
  const xN = xs[n - 1];

  // Snap to horizontal
  if (Math.abs(angle) < thresholdDeg) {
    return [x0, meanY, xN, meanY];
  }
  // Otherwise use linear regression line endpoints
  return [x0, slope * x0 + intercept, xN, slope * xN + intercept];
}
