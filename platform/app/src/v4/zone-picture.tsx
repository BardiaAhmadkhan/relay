import * as React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Rect } from 'react-native-svg';
import type { PixelPlacement } from '../../../packages/core/v4/zone-report';
import { C, F } from '../design';
import { origin, photoUrl, type Photo } from './api';
type Props = {
  id: string;
  photo: Photo;
  box: number[];
  placement: PixelPlacement | null;
  full: boolean;
  partial?: boolean;
  large?: boolean;
};
export function ZonePicture(props: Props) {
  return (
    <SourcePixels
      key={props.id + ':' + props.photo.hash + ':' + (props.placement?.region ?? 'context')}
      {...props}
    />
  );
}
function SourcePixels({ id, photo, box, placement, full, partial = false, large = false }: Props) {
  const exact = placement?.exact
    ? origin + '/v4/items/' + encodeURIComponent(id) + '/zone-source/' + placement.region
    : null;
  const [sourceOkay, setSourceOkay] = React.useState(false),
    [sourceError, setSourceError] = React.useState(false),
    [cropOkay, setCropOkay] = React.useState(false),
    [cropError, setCropError] = React.useState(false);
  // The keyed photograph owns its loading state; cached native images can complete during mount.
  const showCrop = !!exact && !full && !cropError,
    useCrop = showCrop && cropOkay;
  const sx = photo.width,
    sy = photo.height,
    sw = placement?.width ?? 1,
    sh = placement?.height ?? 1;
  return (
    <View style={[s.frame, large && s.large]}>
      {!sourceOkay && !useCrop && (
        <Text style={s.loading}>
          {sourceError ? 'Source photograph unavailable' : 'Opening source photograph…'}
        </Text>
      )}
      {!sourceError && (
        <Image
          resizeMode="contain"
          source={{ uri: photoUrl(id, photo.hash) + (large ? '' : '?thumbnail=1') }}
          onLoad={() => setSourceOkay(true)}
          testID={'zone-parent-' + photo.id}
          onError={() => setSourceError(true)}
          accessibilityLabel="Original source photograph"
          style={[s.fill, { opacity: !useCrop ? 1 : 0 }]}
        />
      )}
      {!sourceError && !useCrop && (
        <Svg
          width="100%"
          height="100%"
          viewBox={'0 0 ' + sx + ' ' + sy}
          preserveAspectRatio="xMidYMid meet"
          style={s.absolute}
          pointerEvents="none"
        >
          <Rect
            x={box[0]! * sx}
            y={box[1]! * sy}
            width={(box[2]! - box[0]!) * sx}
            height={(box[3]! - box[1]!) * sy}
            fill="transparent"
            stroke="#191f15"
            strokeWidth={Math.max(sx, sy) * 0.012}
          />
          <Rect
            x={box[0]! * sx}
            y={box[1]! * sy}
            width={(box[2]! - box[0]!) * sx}
            height={(box[3]! - box[1]!) * sy}
            fill="transparent"
            stroke="#e6ef93"
            strokeWidth={Math.max(sx, sy) * 0.006}
          />
        </Svg>
      )}
      {showCrop && (
        <Image
          resizeMode="contain"
          source={{ uri: exact! }}
          onLoad={() => setCropOkay(true)}
          testID={'zone-exact-' + placement?.region}
          onError={() => setCropError(true)}
          accessibilityLabel="Verified crop read from this garment"
          style={[s.fill, { opacity: useCrop ? 1 : 0 }]}
        />
      )}
      {useCrop && partial && placement && (
        <Svg
          width="100%"
          height="100%"
          viewBox={'0 0 ' + sw + ' ' + sh}
          preserveAspectRatio="xMidYMid meet"
          style={s.absolute}
          pointerEvents="none"
        >
          {placement.outlines.map((o, i) => (
            <Polygon
              key={i}
              points={o.map(([x, y]) => x! * sw + ',' + y! * sh).join(' ')}
              stroke="#edf6a0"
              fill="none"
              strokeWidth={Math.max(sw, sh) * 0.009}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  frame: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e9e0',
  },
  large: { flex: 0, height: 320, borderRadius: 12, overflow: 'hidden' },
  loading: {
    fontFamily: F.medium,
    fontSize: 11,
    lineHeight: 15,
    color: C.muted,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  fill: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    top: 0,
    left: 0,
    backgroundColor: '#e5e9e0',
  },
  absolute: { position: 'absolute', top: 0, left: 0 },
});
