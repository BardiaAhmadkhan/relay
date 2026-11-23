import { type Decision, type PhotoEvidence, type PhotoView } from './schema';
export function recoveryAction(decision: Decision, photos: Pick<PhotoEvidence, 'id' | 'view'>[]) {
  if (decision.reasons.some((r) => r.code.startsWith('unknown_')))
    return {
      screen: 'history' as const,
      view: 'front' as PhotoView,
      label: 'Review history answers',
    };
  for (const reason of decision.reasons) {
    const direct = /^(?:missing_|vision_missing_)(front|back|label|detail)$/.exec(reason.code);
    if (direct) {
      const view = direct[1] as PhotoView;
      return { screen: 'capture' as const, view, label: 'Add the ' + view + ' view' };
    }
    if (reason.code.startsWith('quality_')) {
      const photo = photos.find((p) => p.id === reason.code.slice(8));
      if (photo)
        return {
          screen: 'capture' as const,
          view: photo.view,
          label: 'Retake the ' + photo.view + ' view',
        };
    }
  }
  if (decision.reasons.some((r) => r.code.startsWith('concern_')))
    return {
      screen: 'capture' as const,
      view: 'detail' as PhotoView,
      label: 'Add a closer photograph',
    };
  return { screen: 'capture' as const, view: 'front' as PhotoView, label: 'Revisit photographs' };
}
