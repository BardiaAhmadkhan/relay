export const BASELINE_COMMIT = 'e3a6f5876d1c6c7341d4fae7d460ca632af8923c';
export const PROTOCOL_ID = 'relay-quality-round-02-v1';
export const SPLIT_SEED = 'relay-quality-round-02-v1-group-split';
export const METRICS = [
  'laplacian192',
  'normalizedLaplacian192',
  'tenengrad192',
  'normalizedTenengrad192',
  'multiscaleNormalizedTenengrad',
] as const;
export type Metric = (typeof METRICS)[number];
export type Transform =
  | { id: string; family: 'identity' }
  | { id: string; family: 'blur'; sigma: number }
  | { id: string; family: 'gain'; gain: number }
  | { id: string; family: 'resolution'; longEdge: number }
  | { id: string; family: 'rotation'; degrees: 90 | 180 | 270 }
  | { id: string; family: 'jpeg'; quality: number };
export const TRANSFORMS: Transform[] = [
  { id: 'identity', family: 'identity' },
  ...[0.5, 1, 2, 4, 8].map((sigma) => ({ id: 'blur-' + sigma, family: 'blur' as const, sigma })),
  ...[0.0625, 0.125, 0.25, 0.5, 1.5, 2, 4].map((gain) => ({
    id: 'gain-' + gain,
    family: 'gain' as const,
    gain,
  })),
  ...[96, 192, 320, 480].map((longEdge) => ({
    id: 'resolution-' + longEdge,
    family: 'resolution' as const,
    longEdge,
  })),
  ...([90, 180, 270] as const).map((degrees) => ({
    id: 'rotation-' + degrees,
    family: 'rotation' as const,
    degrees,
  })),
  ...[95, 70, 40, 15].map((quality) => ({
    id: 'jpeg-' + quality,
    family: 'jpeg' as const,
    quality,
  })),
];
export const PRIMARY_HEAVY_BLUR = [4, 8] as const;
export const THRESHOLD_RULE =
  'For each metric, 0.5 times the minimum server-direct identity score among development images. Existing soft threshold 20 is also reported unchanged. No evaluation image participates.';
export const SOURCES = [
  {
    title: 'Analysis of focus measure operators for shape-from-focus',
    authors: 'Said Pertuz, Domenec Puig, Miguel Angel Garcia',
    url: 'https://www.sciencedirect.com/science/article/pii/S0031320312004736',
    publication: '2013-05',
    doi: '10.1016/j.patcog.2012.11.011',
    accessed: '2026-10-26',
    use: 'Focus measures depend on noise, contrast, saturation and window size; this paper motivates comparisons rather than a universal blur threshold.',
    limit:
      'Shape-from-focus research, not motorcycle intake validation. The variance normalization and two-scale aggregate here are explicitly experimental variants.',
  },
  {
    title: 'Image Gradients',
    organization: 'OpenCV',
    url: 'https://docs.opencv.org/4.13.0/d5/d0f/tutorial_py_gradients.html',
    publication: null,
    accessed: '2026-10-26',
    use: 'Sobel first derivatives and Laplacian second derivatives are established image operators.',
    limit: 'The documentation does not establish a threshold for rider photo utility.',
  },
  {
    title: 'Image operations',
    organization: 'sharp',
    url: 'https://sharp.pixelplumbing.com/api-operation/',
    publication: null,
    accessed: '2026-10-26',
    use: 'Defines Gaussian blur, gain via linear, EXIF orientation and alpha flattening used in controlled transformations.',
    limit:
      'Library operation documentation; synthetic transformations do not recreate all camera failures.',
  },
  {
    title: 'Output options',
    organization: 'sharp',
    url: 'https://sharp.pixelplumbing.com/api-output/',
    publication: null,
    accessed: '2026-10-26',
    use: 'Metadata-stripped image output and explicit JPEG options.',
    limit: 'Sharp JPEG is not asserted to match native Expo codecs.',
  },
];
